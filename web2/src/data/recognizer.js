/* ---------- 课表图片识别层（一期后段加速入口）----------
   设计方案口径：图片 → 多模态 AI 识别 → 确认页纠错 → 入库；定位是「省录入的加速入口」。
   「规则优先，AI 兜底」原则在这里的体现：AI 只输出「星期数字 + 节次数字 + 单双周判断」，
   节次→时间由本地 periods 换算，冲突检测走 Rules.findConflicts——AI 不做任何计算题。

   图片链路复用纪要的 DeepSeek 配置（web2.llm）：deepseek-flash 已支持图片输入
   （OpenAI 兼容，content 数组里放 base64 的 image_url，api-docs 官方 vision 指南）。
   key 只落设备本地，不进导出 JSON、不进仓库。 */

import { loadLlmConfig } from './summarizer.js'
import { segmentView } from './periods.js'
import { segName } from './weekGrid.js'

export const RECOGNIZER_PROMPT_VERSION = 3

/* ---------- 图片压缩 ----------
   相机原图动辄 3-8MB，base64 后直接顶到请求体上限；长边压到 maxEdge、转 JPEG。
   用 Image + canvas（App WebView / 浏览器都支持），不用 createImageBitmap 以兼容旧 WebView。
   支持裁剪（cropY/cropH），供长图切块用。 */
export function compressImage(file, { maxEdge = 2000, quality = 0.9, cropY = 0, cropH = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const sy = Math.max(0, Math.round(cropY))
        const sh = Math.max(1, Math.round(cropH == null ? img.naturalHeight - sy : cropH))
        const sw = img.naturalWidth
        const scale = Math.min(1, maxEdge / Math.max(sw, sh))
        const w = Math.max(1, Math.round(sw * scale))
        const h = Math.max(1, Math.round(sh * scale))
        const cv = document.createElement('canvas')
        cv.width = w
        cv.height = h
        const ctx = cv.getContext('2d')
        ctx.imageSmoothingEnabled = true
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, sy, sw, sh, 0, 0, w, h)
        URL.revokeObjectURL(url)
        resolve({ dataUrl: cv.toDataURL('image/jpeg', quality), width: w, height: h, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight })
      } catch (e) {
        URL.revokeObjectURL(url)
        reject(new Error('图片处理失败，换一张试试。'))
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败，请换一张图片（支持 JPG/PNG/WebP）。'))
    }
    img.src = url
  })
}

/* ---------- 长图切块规划（纯函数，便于单测）----------
   教务网页截图常是竖长条（如 1264×6315），整体压到 1500 长边会把宽度压到 300px——字全糊。
   策略：高宽比 > 2.2 时纵向切成若干块，每块保持「高 ≤ 宽×1.6」的比例，压到长边 2000 后
   约 1250×2000，文字可读。相邻块重叠 8%（课表常有跨行大格，防止课程在切缝处被截断）。 */
export function calcTilePlan(naturalW, naturalH, { tileAspect = 1.6, maxTiles = 4 } = {}) {
  const w = Math.max(1, Math.round(naturalW))
  const h = Math.max(1, Math.round(naturalH))
  if (h / w <= 2.2) return null // 普通比例截图不切块
  let n = Math.ceil(h / w / tileAspect)
  n = Math.min(Math.max(n, 2), maxTiles)
  const baseH = Math.ceil(h / n)
  const overlap = Math.round(baseH * 0.08)
  const tiles = []
  for (let i = 0; i < n; i++) {
    const y = Math.max(0, i * baseH - (i > 0 ? overlap : 0))
    const end = Math.min(h, (i + 1) * baseH + (i < n - 1 ? overlap : 0))
    if (end > y) tiles.push({ y, h: end - y })
  }
  return { tiles, overlap }
}

/* 识别专用压缩入口：普通截图返回单图，长图返回切块数组（caller 原样传给识别调用）。 */
export async function compressImageForRecognize(file) {
  const probe = await compressImage(file, { maxEdge: 8, quality: 0.5 }) // 只为拿原始尺寸
  const plan = calcTilePlan(probe.naturalWidth, probe.naturalHeight)
  if (!plan) return { dataUrls: [(await compressImage(file)).dataUrl], tiles: 0 }
  const dataUrls = []
  for (const seg of plan.tiles) {
    const r = await compressImage(file, { cropY: seg.y, cropH: seg.h })
    dataUrls.push(r.dataUrl)
  }
  return { dataUrls, tiles: dataUrls.length }
}

/* ---------- 提示词 ----------
   用户要求：除了约束输出，还要把国内高校课表的通用结构讲清楚，让模型先看懂结构再提取。
   结构描述覆盖：列=星期、行=节次、合并大格、单元格内容三件套、单双周写法、上下叠课、
   需要排除的非课程区域（标题/备注/日期表头）。「宁缺勿猜」是对抗幻觉的关键约束。
   v3（2026-10-01）：把用户自己的节次表（分上午/下午/晚上三段、午休晚休在哪）喂给模型，
   并明令「同一门课不得跨段」——实测 AI 数错行序时会输出第 1–8 节这种横跨午休的范围。 */
export function buildRecognizerPrompt(tiled = false, periods = null) {
  const lines = [
    '你是课表识别助手。输入是一张大学课表的图片（教务系统截图、课表 App 截图或拍照均可）。请把图里的课程逐格提取出来。',
    '',
    '【课表的常见结构】先看懂结构再提取：',
    '- 表格的「列」是星期：通常周一到周五，有的课表还带周六、周日列。列头可能写「星期一」「周一」「MON」等。',
    '- 表格的「行」是节次：行首常见写法「第1,2节」「1-2节」「第一大节」「08:00-09:40」等，可能附带每节起止时间和节次序号（1、2、3…）。行间可能有「午休」「晚饭」等空行，那些不是课。',
    '- 一个格子 = 「某星期 + 某节次范围」上的一门课。同一门课常连排两节（格子合并成跨两行的大格）。',
    '- 也有的课表是卡片式布局（课表 App 常见）：列仍是星期，每门课是一个圆角卡片，卡片上写课程名和教室；左侧是时间轴和节次序号。卡片从哪一行起到哪一行止，决定 startSec 和 endSec。',
    '- 格子/卡片里的文字通常有：课程名（必需）、教室/地点、教师姓名、周次范围。排列顺序不固定，也可能缺一部分；截断显示（如「北4-3…」）就照抄可见部分。',
    '- 周次的常见写法：「1-16周」「1-8周(单)」「9-16周(双)」「第1-17周」等。「单」「奇」表示单周上课，「双」「偶」表示双周上课；不标注就当每周都上。',
    '- 有的格子上下叠了两门课（单双周交替上不同的课），要拆成两条记录。',
    '- 排除项：课表标题、学期名、学生姓名班级、备注栏、底部日期条都不是课程；只提取「星期×节次」网格里的课。',
    '',
    '【节次怎么数（重要）】startSec / endSec 只输出「第几节」，不要输出时间：',
    '- 一律取行首/时间轴上的节次序号（1、2、3…），按那个数字填。',
    '- 不要用图上的时间换算节次，也不要把图上的时间当成课程时间：那是这所学校自己的作息（课表截图上的时间常常还是期末考时间），每所学校都不一样；上课时间由用户填的节次表换算。',
    '- 行首只写时间、没写序号时（如只有「08:00-09:40」），按该行在节次行里从上到下的顺序推断序号：第 1 行 = 第 1 节；「午休」「晚饭」这类空行不占序号。',
    '- 行首写「第一大节」这种两节合排的写法，按它占的节次数展开（第一大节 = 第 1 节到第 2 节）。',
  ]
  /* 用户的节次表（分段作息）。没有 periods（异常路径）时整段跳过，靠代码侧钳制兜底 */
  if (Array.isArray(periods) && periods.length) {
    const segs = segmentView(periods)
    if (segs.length >= 2) {
      const desc = segs
        .map((g, i) => {
          const head = i === 0 ? '' : `（与上一段之间隔 ${Math.round((g.gapBefore || 0))} 分钟休息）`
          return `- ${segName(g)}：第 ${g.nos[0]} 到 ${g.nos[g.nos.length - 1]} 节（${g.start}–${g.end}）${head}`
        })
        .join('\n')
      lines.push(
        '',
        '【用户学校的作息表（重要）】一天被午休/晚休分成几段，节次序号这样排：',
        desc,
        '硬规则：同一门课的 startSec 和 endSec 必须落在同一段里，绝不允许跨段——上午的课最多到本段最后一节（第 ' + segs[0].nos[segs[0].nos.length - 1] + ' 节），不存在「从第 1 节上到第 8 节」这种连上午带下午的课。',
        '如果图片上某个格子看起来横跨了段间休息，说明你把「午休」「晚饭」空行数进了序号，请重数：这类空行不占节次序号。',
        '真实场景提示：有的学校上午 4 节、下午 4 节；连堂课一般是 2 节，极少数 3 节。连续 5 节以上的课大概率是你数错了。'
      )
    }
  }
  lines.push(
    '',
    '【输出要求】只输出一个 JSON 对象，不要输出任何其他文字或代码块标记，结构如下：',
    '{"courses":[{"title":"课程名","weekday":1,"startSec":1,"endSec":2,"weekRule":"every","location":"教室","teacher":"教师"}],"notes":["看不清或拿不准的地方，没有则空数组"]}',
    '- weekday：数字，1=周一 … 7=周日。',
    '- startSec / endSec：该课从第几节开始、到第几节结束（数字，取行首的节次序号；连排两节就是 1 和 2）。',
    '- weekRule：只能取 "every"（每周）、"odd"（单周）、"even"（双周）之一。',
    '- 不要编造：看不清的字段给空字符串，宁缺勿猜。',
    '- 但也不要因为图不完美就整张放弃：能认出一门课就输出一门课；只有整格完全无法辨认时才写进 notes。',
    '- 全部用简体中文。'
  )
  if (tiled) {
    lines.splice(2, 0,
      '- 【多图说明】本次提供了多张图片：它们是同一张竖长课表截图从上到下依次切成的几段（相邻段有少量重叠，用于防止课程被切缝截断）。请把它们拼成一张完整课表来识别：重叠区域里重复出现的课只算一次；跨段出现一半的课也要还原成一条完整记录。')
  }
  return lines.join('\n')
}

/* ---------- 结果解析与校验 ----------
   剥代码块壳 → JSON.parse → 逐条校验/纠偏，不合格的丢弃并记 warning（确认页顶部展示）。
   校验口径与 store 一致：weekday 1-7、节次 1-15 且 start<=end、weekRule 三值。 */
export function parseScheduleJson(text) {
  let t = String(text || '').trim()
  const m = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (m) t = m[1]
  let obj
  try {
    obj = JSON.parse(t)
  } catch {
    throw new Error('识别结果不是有效 JSON，重试一次通常可解。')
  }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.courses)) {
    throw new Error('识别结果不完整（缺课程列表），重试一次。')
  }
  const warnings = []
  const seen = new Set()
  const courses = []
  for (const raw of obj.courses) {
    if (!raw || typeof raw !== 'object') continue
    const c = {
      title: String(raw.title || '').trim(),
      weekday: Math.round(Number(raw.weekday)),
      startSec: Math.round(Number(raw.startSec)),
      endSec: Math.round(Number(raw.endSec)),
      weekRule: String(raw.weekRule || 'every').trim(),
      location: String(raw.location || '').trim(),
      teacher: String(raw.teacher || '').trim(),
    }
    if (!c.title) { warnings.push('丢弃一条没有课程名的记录'); continue }
    if (!(c.weekday >= 1 && c.weekday <= 7)) { warnings.push('丢弃「' + c.title + '」：星期无效'); continue }
    if (!(c.startSec >= 1 && c.startSec <= 15 && c.endSec >= c.startSec && c.endSec <= 15)) {
      warnings.push('丢弃「' + c.title + '」：节次无效')
      continue
    }
    if (c.weekRule !== 'every' && c.weekRule !== 'odd' && c.weekRule !== 'even') {
      warnings.push('「' + c.title + '」周次规则无法判断，先按每周上课处理')
      c.weekRule = 'every'
    }
    const key = c.weekday + '|' + c.startSec + '|' + c.title
    if (seen.has(key)) continue // 完全重复的丢弃，不刷屏
    seen.add(key)
    courses.push(c)
  }
  const notes = Array.isArray(obj.notes) ? obj.notes.map((n) => String(n).trim()).filter(Boolean) : []
  return { courses, notes, warnings }
}

/* ---------- 识别调用 ----------
   dataUrl(s)：compressImage 的产物；传数组 = 长图切块（多 image_url 一次请求）。
   与纪要同款错误映射（401/402/429/400），同款模型白名单回落。 */
export async function recognizeScheduleImage(dataUrls, opts = {}) {
  const urls = Array.isArray(dataUrls) ? dataUrls : [dataUrls]
  if (!urls.length) throw new Error('没有可识别的图片。')
  const c = loadLlmConfig()
  if (c.provider !== 'deepseek' || !c.key) {
    throw new Error('还没配置 DeepSeek API Key（课表识别与课堂纪要共用同一个 Key）。')
  }
  // 视觉能力只有 deepseek-flash 有（官方 vision 文档）。纪要配置的模型可能是纯文字型
  // （如 deepseek-v4-pro）——给它发图不报错、图片被静默忽略，模型会凭空编课表。识别固定用 flash。
  const model = 'deepseek-flash'
  if (opts.onStage) opts.onStage('call')
  let res
  try {
    res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: buildRecognizerPrompt(urls.length > 1, opts.periods) },
              ...urls.map((u) => ({ type: 'image_url', image_url: { url: u } })),
            ],
          },
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        temperature: 0.1, // 提取任务：越确定越好，不要发散
        max_tokens: 4000, // 满课表 ~30 格，宽裕兜底
      }),
      signal: opts.signal,
    })
  } catch (e) {
    if (e && e.name === 'AbortError') throw e
    throw new Error('网络请求失败，请检查网络后重试。')
  }
  if (opts.onStage) opts.onStage('parse')
  if (res.status === 401) throw new Error('API Key 无效（401），请检查 Key 是否填对。')
  if (res.status === 402) throw new Error('DeepSeek 账户余额不足（402），请充值后重试。')
  if (res.status === 429) throw new Error('请求太频繁（429），稍等几秒再试。')
  if (res.status === 400) throw new Error('请求被拒（400）：通常是图片格式不支持或模型名无效，请重试。')
  if (!res.ok) throw new Error('DeepSeek 服务返回 ' + res.status + '，稍后重试。')
  const data = await res.json()
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
  if (!text) throw new Error('DeepSeek 返回了空内容。')
  return parseScheduleJson(text)
}

/* 可用性检查：与纪要共用配置。**文案里不再写「去我的页配」**——引导页那层是全屏的，
   第一次用的人按这句话根本走不到；调用方缺 Key 时应把用户引到引导流程内的配置页。 */
export function recognizerAvailable() {
  const c = loadLlmConfig()
  if (c.provider !== 'deepseek' || !c.key) {
    return '还没配置 DeepSeek API Key（课表识别与课堂纪要共用同一个 Key）。'
  }
  return null
}
