/* 复习建议（施工单 S2）——「今晚这一段 90 分钟先看哪门」交给 AI 说一句。

   为什么要有这一层（用户 m00554 原话）：
     「复习时间可以先划出整块时间，然后让 ai 给出复习建议，就不用严格划分了」
   时间由程序算（exams.js 的 reviewDaysFor，一天只挖一块，不会重叠），
   「先看哪门」这种判断交出去 —— 程序按天数排序只能给出「最近的那门」，
   给不出「两门都还有一周，今晚先动哪门更划算」。

   纪律（与前几条一致，逐条都是踩过的）：
     · **只建议，不落库**：不写课表、不建待办、不改考试数据。
     · **只基于程序算好的事实**：哪几门、各剩几天、这段多长。
       **不许提具体章节 / 页码 / 题号 / 资料名** —— 这些我们根本不知道，
       模型编出来就是假事实，用户照着找会找不到（同 02 的 due_hint 教训：
       宁可空着也不许推算）。
     · **不评判不催促**：命中「加油/来不及/你应该/拖延」这类词整句丢弃
       （与 exams.js 的 examPlanLine 同一条纪律，界面两处口径必须一致）。
     · **失败一律静默**：返回 { ok:false, message }，界面回落到规则句
       （exams.js 的 examPlanLine），绝不因为 AI 挂了就空着或报错弹窗。
     · **一天一次**：按日期缓存（web2.review.advice），当天已有就不再请求。
       打开页面就请求、每次进页都请求，会把 Key 的额度和用户的耐心一起烧掉。

   Key 复用「纪要」那份配置（web2.llm，summarizer.js 的 loadLlmConfig）：
   用户只需要在一个地方配一次 DeepSeek Key，不为这个功能再要一个。
*/

import { loadLlmConfig, DEEPSEEK_MODELS } from './summarizer.js'

export const ADVICE_KEY = 'web2.review.advice'
export const ADVICE_PROMPT_VERSION = 1
/* 缓存超过这个天数就当作过期（换了学期、久没开 App 时不要拿半个月前的建议）。 */
export const ADVICE_CACHE_DAYS = 1

const ADVICE_TIMEOUT_MS = 10000
const ADVICE_MAX_TOKENS = 160
/* 一句话的上限：比纪要的 60 字更短，因为它要跟「19:00–20:30」挤在同一行。 */
export const ADVICE_MAX_LEN = 60

/* 催促 / 评判词。与 exams.js 的纪律同源：出现即丢弃，不「差不多能用」。 */
export const ADVICE_BANNED = [
  '加油', '努力', '赶紧', '必须', '来不及', '怎么办', '懒', '拖延',
  '你应该', '你怎么', '还不', '抓紧', '别再', '否则',
]

function pad2(n) { return String(n).padStart(2, '0') }

/* 事实串：给模型看的**全部**输入，也是单测断言的锚点。
   写成「编号. 科目 —— 还有 N 天（日期 时间）」的固定形状，
   模型要照抄天数时不会找不到来源。 */
export function adviceFacts(block) {
  if (!block || !Array.isArray(block.exams) || !block.exams.length) return ''
  const head = [
    '这段复习时间：' + String(block.time || ''),
    '长度：' + String(Number(block.mins) || 0) + ' 分钟',
  ].join('\n')
  const rows = block.exams.map((e, i) => {
    const dl = Number(e.daysLeft)
    const when = Number.isFinite(dl) && dl >= 0 ? '还有 ' + dl + ' 天' : '日期未定'
    return (i + 1) + '. ' + String(e.title || '') + ' —— ' + when
  })
  return head + '\n这段里的考试：\n' + rows.join('\n')
}

export function buildAdvicePrompt(block) {
  const system = [
    '你在帮一个大学生安排今天这一段复习时间。',
    '规则：',
    '1) 只输出一句话，不超过 45 个字；不要引号、不要 emoji、不要任何前后缀；',
    '2) 说清先看哪一门（一般是剩下天数最少的那门），以及这段时间大致怎么分；',
    '3) 不许提具体章节、页码、题号、教材或资料名 —— 你不知道他手上有什么，编出来就是错的；',
    '4) 不许评价这个人（懒、拖延、来不及、应该更努力），只安排时间；',
    '5) 天数照抄下面给的事实，不要自己算，也不要换算成星期几。',
  ].join('\n')
  return { system, user: adviceFacts(block) }
}

/* 把模型输出收成一句能直接上屏的话。**认不出就丢**，不猜、不修补。
   返回 { ok:true, line } 或 { ok:false, message }。 */
export function sanitizeAdvice(text, block) {
  let line = String(text || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '') // emoji（模型爱加）
    .trim()
    .replace(/^["'“”「『]+|["'“”」』]+$/g, '')
    .trim()
  line = (line.split('\n').map((x) => x.trim()).filter(Boolean)[0] || '')
    .replace(/^[-*·•\d.、]+\s*/, '') // 列表符号
    .trim()
  if (!line) return { ok: false, message: 'AI 回了空内容' }
  /* 只留第一句：宁可少说，也不要把两三层意思挤进一行。 */
  const firstStop = line.search(/[。！!？?；;]/)
  if (firstStop > 0) line = line.slice(0, firstStop).trim()
  line = line.replace(/[，,、]+$/, '').trim()
  if (!line) return { ok: false, message: 'AI 回了空内容' }
  if (line.length > ADVICE_MAX_LEN) return { ok: false, message: 'AI 说得太长' }
  const hit = ADVICE_BANNED.find((w) => line.includes(w))
  if (hit) return { ok: false, message: 'AI 说了催促 / 评判的话（' + hit + '），已丢弃' }
  /* 「还有 N 天」里的 N 必须是这一段里真实存在过的天数 —— 防止模型自己算错日期。
     注意只校验这个固定说法，不去校验「前 50 分钟」这类时段划分（那是它该做的安排）。 */
  const days = new Set(
    (Array.isArray(block && block.exams) ? block.exams : [])
      .map((e) => Number(e.daysLeft))
      .filter((n) => Number.isFinite(n) && n >= 0)
      .map((n) => String(n))
  )
  const re = /还有\s*(\d+)\s*天/g
  let m = re.exec(line)
  while (m) {
    if (days.size && !days.has(m[1])) return { ok: false, message: 'AI 把剩余天数说错了（' + m[1] + ' 天），已丢弃' }
    m = re.exec(line)
  }
  return { ok: true, line }
}

/* ---------- 当天缓存 ----------
   { date:'2026-10-16', line:'…', at:毫秒 }。只存一条 —— 建议是「今天这句」，
   留历史没有用处，反而会让「清一下」变复杂。 */
export function loadAdvice(today = '') {
  try {
    const raw = JSON.parse(localStorage.getItem(ADVICE_KEY) || '')
    if (!raw || typeof raw !== 'object') return null
    const line = String(raw.line || '').trim()
    const date = String(raw.date || '')
    if (!line || !date) return null
    if (today && date !== today) return null // 不是今天的 → 当作没有
    return { date, line, at: Number(raw.at) || 0 }
  } catch {
    return null
  }
}

export function saveAdvice(date, line, now = Date.now()) {
  try {
    localStorage.setItem(ADVICE_KEY, JSON.stringify({ date: String(date || ''), line: String(line || ''), at: Number(now) || 0 }))
    return true
  } catch {
    return false
  }
}

export function clearAdvice() {
  try {
    localStorage.removeItem(ADVICE_KEY)
    return true
  } catch {
    return false
  }
}

/* 主入口：拿今天那一段 → 有缓存就复用 → 否则请求一句 → 收干净再存。
   返回 { ok:true, line, cached? } 或 { ok:false, message }。
   fetchImpl 只为单测注入（生产不传）。 */
export async function reviewAdvice({
  block = null,
  today = '',
  now = Date.now(),
  fetchImpl = null,
  timeoutMs = ADVICE_TIMEOUT_MS,
} = {}) {
  if (!block || !Array.isArray(block.exams) || !block.exams.length) {
    return { ok: false, message: '今天没有复习安排' }
  }
  const cached = loadAdvice(today)
  if (cached) return { ok: true, line: cached.line, cached: true }
  const c = loadLlmConfig()
  if (c.provider !== 'deepseek' || !c.key) return { ok: false, message: '没配 DeepSeek Key' }
  const model = DEEPSEEK_MODELS.some((m) => m.id === c.model) ? c.model : 'deepseek-flash'
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : (typeof fetch === 'function' ? fetch : null)
  if (!doFetch) return { ok: false, message: '这个环境没有 fetch' }
  const { system, user } = buildAdvicePrompt(block)
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null
  let res
  try {
    res = await doFetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' }, // 排一句话不需要思考模式（快、省、不跑题）
        temperature: 0.6,
        max_tokens: ADVICE_MAX_TOKENS,
      }),
      signal: ctl ? ctl.signal : undefined,
    })
  } catch (e) {
    return { ok: false, message: e && e.name === 'AbortError' ? 'AI 超时' : '网络请求失败' }
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (!res || !res.ok) return { ok: false, message: 'AI 返回 ' + (res ? res.status : '未知') }
  let content = ''
  try {
    const data = await res.json()
    const choice = data && data.choices && data.choices[0]
    content = choice && choice.message && choice.message.content ? String(choice.message.content) : ''
  } catch {
    return { ok: false, message: 'AI 回的不是合法 JSON' }
  }
  const got = sanitizeAdvice(content, block)
  if (!got.ok) return got
  if (today) saveAdvice(today, got.line, now)
  return { ok: true, line: got.line }
}
