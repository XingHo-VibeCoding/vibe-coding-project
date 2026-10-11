/* ---------- 日程识别层（「✨ 智能填写」）----------
   用户需求（2026-10-12，m05813 / m06155）：在「添加日程」表单里加一个小按钮，
   支持「拍照/选图」和「粘贴文字」两条路，自动把日程信息填进表单。

   与课表识别（recognizer.js）的关系：**共用管道，不用同一套口径**。
   - 能复用的：LlmConfig（同一个 Key）、compressImage、错误映射 401/402/429/400。
   - 不能复用的：课表识别的输出是「星期几 + 第几节」，因为课表图上的时间一律不采信
     （那是学校自己的作息）；而日程要的恰恰是**具体日期 + 具体时刻**，口径正好相反。
     所以本文件自带一套提示词与解析。

   定位同课表识别：「省录入的加速入口」，规则优先、AI 兜底。AI 只负责把自然语言/图片
   里的「事、哪天、几点、多久、在哪」抽出来，算第二天/下周三这种日期推算交给提示词里
   写明的「今天是哪天」，但**最终结果一律回填表单让用户核对**，不直接落库——
   日期时间识别是最容易出错的一环，直接创建等于让用户替 AI 背锅。

   Key 只落设备本地（web2.llm），不进导出 JSON、不进仓库。 */

import { loadLlmConfig } from './summarizer.js'
import { compressImage } from './recognizer.js'

export const EVENT_PARSE_PROMPT_VERSION = 1

/* 表单只支持这四档时长（App.vue 的 DURATIONS），识别出的分钟数吸附到最近一档 */
export const EVENT_DURATIONS = [40, 45, 60, 90]

/* 输出上限：日程是短任务，一条记录，给足冗余即可 */
const MAX_TOKENS = 800

/* ---------- 提示词 ----------
   两个关键设计：
   1. 必须把「今天是哪天、今天周几」写进提示词——「明天」「下周三」这类相对说法
      没有锚点必错。锚点由调用方传入（App 用的是界面同一份 today，含时间后门 ?t=）。
   2. 时间一律输出 24 小时制 HH:MM，日期一律 YYYY-MM-DD，时长输出分钟数。
      不输出「下午三点」这类人话，避免二次解析再错一遍。 */
export function buildEventPrompt({ today = '', weekdayCN = '', isImage = false } = {}) {
  const lines = [
    '你是日程录入助手。从用户给的' + (isImage ? '图片（活动通知、群消息截图、海报、课表照片等）' : '一段话') + '里抽出一条日程，输出结构化字段。',
    '',
    '【今天是哪天】' + (today ? `今天 = ${today}${weekdayCN ? '（' + weekdayCN + '）' : ''}。所有「明天」「后天」「下周三」「这周五」都要基于这一天算成具体日期。` : '（缺锚点，请只输出图上明确写出的绝对日期，不要推算相对日期）'),
    '',
    '【要抽什么】',
    '- title：日程名称，取最能代表这件事的短名（如「班会」「高数期中考试」「项目答辩」）。去掉「通知」「关于」这类套话。',
    '- date：YYYY-MM-DD。图上/文字里写了绝对日期就照抄；写了「明天」这类相对说法就按上面的今天是哪天算。',
    '- start：24 小时制 HH:MM。写了时间就填；只写了「下午」这种半天，取该半天最常见的整点（下午=14:00，上午=09:00，晚上=19:00）。',
    '- duration：分钟数（数字）。写了结束时间就用结束减开始；只写「大约两小时」就填 120；完全没提就填 60。',
    '- place：地点，没有则空字符串。',
    '',
    '【别编造】看不清或没写的字段：title 必须尽力给一个（实在没有就给「新日程」），其余字段没提就按上面的默认值，不要瞎猜具体地点。',
    '',
    '【输出要求】只输出一个 JSON 对象，不要输出任何其他文字或代码块标记，结构如下：',
    '{"title":"班会","date":"2026-10-13","start":"18:00","duration":60,"place":"教二 110","notes":["拿不准的地方，没有则空数组"]}',
    '- duration 是数字，不要带单位。',
    '- 全部用简体中文。',
  ]
  return lines.join('\n')
}

/* ---------- 结果解析与校验 ----------
   剥代码块壳 → JSON.parse → 逐字段收敛；不合格给 warning 并回落默认值。
   设计取舍：title 缺失不致命（回落「新日程」），因为用户就在表单里、改个字比重新识别快；
   但 date/start 格式不合法时必须留空并进 warnings，让界面提示用户补——宁可空着，不要填个错的。 */
const DUR_OK = /^\d{1,4}$/
const DATE_OK = /^\d{4}-\d{2}-\d{2}$/
const TIME_OK = /^\d{1,2}:\d{2}$/

function pad2(n) { return String(n).padStart(2, '0') }

/* 时分收敛：把 "9:5" "09:05" "9：05"（全角冒号）都规整成 "09:05"；越界返回 null */
function normTime(raw) {
  const t = String(raw == null ? '' : raw).trim().replace(/[：]/g, ':')
  const m = t.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return null
  return pad2(h) + ':' + pad2(mi)
}

/* 日期收敛：要求 YYYY-MM-DD 且真实存在（挡掉 2026-02-31 这种） */
function normDate(raw) {
  const d = String(raw == null ? '' : raw).trim()
  if (!DATE_OK.test(d)) return null
  const [y, mo, da] = d.split('-').map(Number)
  const dt = new Date(y, mo - 1, da)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== da) return null
  return d
}

/* 时长吸附到表单支持的档位：取最近的一档，并列时取小的（宁可短一点） */
export function snapDuration(min) {
  const n = Number(min)
  if (!Number.isFinite(n) || n <= 0) return 60
  let best = EVENT_DURATIONS[0]
  for (const d of EVENT_DURATIONS) {
    if (Math.abs(d - n) < Math.abs(best - n)) best = d
  }
  return best
}

export function parseEventJson(text) {
  let t = String(text || '').trim()
  const m = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (m) t = m[1]
  let obj
  try {
    obj = JSON.parse(t)
  } catch {
    throw new Error('识别结果不是有效 JSON，重试一次通常可解。')
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('识别结果不完整，重试一次。')
  }
  const warnings = []
  const title = String(obj.title == null ? '' : obj.title).trim() || (warnings.push('没认出日程名称，先填了「新日程」，请改一下'), '新日程')
  const date = normDate(obj.date)
  if (!date) warnings.push('没认出日期（或格式不对），请自己选一下')
  const start = normTime(obj.start)
  if (!start) warnings.push('没认出开始时间（或格式不对），请自己选一下')
  let duration = 60
  if (obj.duration == null || String(obj.duration).trim() === '') {
    warnings.push('没提时长，先按 60 分钟填')
  } else if (!DUR_OK.test(String(obj.duration).trim())) {
    warnings.push('时长不是数字，先按 60 分钟填')
  } else {
    duration = snapDuration(obj.duration)
    if (duration !== Number(obj.duration)) warnings.push('时长吸附到最接近的一档（' + duration + ' 分钟）')
  }
  const place = String(obj.place == null ? '' : obj.place).trim()
  const notes = Array.isArray(obj.notes) ? obj.notes.map((n) => String(n).trim()).filter(Boolean) : []
  return { event: { title, date: date || '', start: start || '', duration, place }, notes, warnings }
}

/* ---------- 识别调用（文字） ----------
   opts.today / opts.weekdayCN：日期锚点，必传（否则相对日期必错）。
   与纪要/课表同款错误映射，同款 provider 校验。 */
export async function parseEventText(text, opts = {}) {
  const src = String(text || '').trim()
  if (!src) throw new Error('没填内容。')
  const c = loadLlmConfig()
  if (c.provider !== 'deepseek' || !c.key) {
    throw new Error('还没配置 DeepSeek API Key（识别与课堂纪要共用同一个 Key）。')
  }
  if (opts.onStage) opts.onStage('call')
  let res
  try {
    res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
      body: JSON.stringify({
        model: 'deepseek-flash',
        messages: [{ role: 'user', content: buildEventPrompt({ today: opts.today, weekdayCN: opts.weekdayCN, isImage: false }) + '\n\n【用户给的文字】\n' + src }],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        temperature: 0.1,
        max_tokens: MAX_TOKENS,
      }),
      signal: opts.signal,
    })
  } catch (e) {
    if (e && e.name === 'AbortError') throw e
    throw new Error('网络请求失败，请检查网络后重试。')
  }
  if (opts.onStage) opts.onStage('parse')
  return parseEventResponse(res)
}

/* 图片版：管道与课表识别一致（先压缩，长图交给 recognizer 的切块逻辑不合适——
   日程图多为通知截图/海报，单图压缩即可；真的要长图，用户会切屏再传）。 */
export async function parseEventImage(file, opts = {}) {
  const c = loadLlmConfig()
  if (c.provider !== 'deepseek' || !c.key) {
    throw new Error('还没配置 DeepSeek API Key（识别与课堂纪要共用同一个 Key）。')
  }
  if (opts.onStage) opts.onStage('compress')
  const { dataUrl } = await compressImage(file, { maxEdge: 2000, quality: 0.9 })
  if (opts.onStage) opts.onStage('call')
  let res
  try {
    res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
      body: JSON.stringify({
        model: 'deepseek-flash', // 视觉能力只有 flash 有，同课表识别
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: buildEventPrompt({ today: opts.today, weekdayCN: opts.weekdayCN, isImage: true }) },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        temperature: 0.1,
        max_tokens: MAX_TOKENS,
      }),
      signal: opts.signal,
    })
  } catch (e) {
    if (e && e.name === 'AbortError') throw e
    throw new Error('网络请求失败，请检查网络后重试。')
  }
  if (opts.onStage) opts.onStage('parse')
  return parseEventResponse(res)
}

/* 共用的响应处理 + 错误映射（与 recognizer.js 逐条对齐，文案改成日程口径） */
async function parseEventResponse(res) {
  if (res.status === 401) throw new Error('API Key 无效（401），请检查 Key 是否填对。')
  if (res.status === 402) throw new Error('DeepSeek 账户余额不足（402），请充值后重试。')
  if (res.status === 429) throw new Error('请求太频繁（429），稍等几秒再试。')
  if (res.status === 400) throw new Error('请求被拒（400）：通常是图片格式不支持或模型名无效，请重试。')
  if (!res.ok) throw new Error('DeepSeek 服务返回 ' + res.status + '，稍后重试。')
  const data = await res.json()
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
  if (!text) throw new Error('DeepSeek 返回了空内容。')
  return parseEventJson(text)
}

/* 可用性检查：与纪要/课表识别共用配置。 */
export function eventParserAvailable() {
  const c = loadLlmConfig()
  if (c.provider !== 'deepseek' || !c.key) {
    return '还没配置 DeepSeek API Key（智能填写与课堂纪要共用同一个 Key）。'
  }
  return null
}
