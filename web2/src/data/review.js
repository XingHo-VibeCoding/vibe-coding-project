/* 五期：每日复盘（2026-10-04）
   纯逻辑 + localStorage，只管数据形状、日精进生成与设置归一化；UI 在 App.vue 里。
   与练耳（listen.js）同一条口径：**只写本机 localStorage（web2.review / web2.review.set），
   不进主项目导出** —— 复盘存档属于「个人反思」，导出给主项目的数据保持「课程 + 日程 + 待办」的干净口径；
   将来要归档进主项目，再扩 `reviews` 表与 store.js 的导入导出。

   记录形状：
     { date:'YYYY-MM-DD', mood:0..5, answers:{proud,keep,focus},
       stats:{courses,todosDone,todosTotal,habitsDone,habitsTotal,listenPlayed,listenSeconds},
       summary:'…', created_at:ms, updated_at:ms }
   · mood = 0 表示没答（不是「很差」，1 才是很差，所以 0 与 1 必须分清）
   · summary 生成后就存下来：历史列表直接显示，不再重算（避免以后改模板把旧记录改样） */

export const REVIEW_KEY = 'web2.review'
export const REVIEW_SET_KEY = 'web2.review.set'
/* 复盘提醒的批次标记与通知渠道：applySchedule 只清 extra.src === 自己 的那批，所以必须独立 */
export const REVIEW_TAG = 'web2-review'
export const REVIEW_CHANNEL = 'review-reminder'

export const DEFAULTS = {
  enabled: true, // 每晚一条轻提醒（设计口径：23:00 轻提醒），不打断已有课前提醒与练耳提醒
  at: '23:00',
}

/* 五档状态：0 = 没答，1..5 = 很差..很好 */
export const MOODS = [
  { v: 1, label: '很累', emoji: '😞' },
  { v: 2, label: '一般', emoji: '😐' },
  { v: 3, label: '还行', emoji: '🙂' },
  { v: 4, label: '不错', emoji: '😄' },
  { v: 5, label: '很爽', emoji: '🤩' },
]

/* 引导问题（限时 2–3 分钟 → 4 题、每题可跳过；文案放这里，App 与测试共用同一份） */
export const QUESTIONS = [
  {
    key: 'proud',
    title: '今天最值得记的一件事？',
    hint: '一句就够，想不到就跳过',
    placeholder: '比如：终于把录音转写跑通了',
    multi: true,
  },
  {
    key: 'mood',
    title: '今天状态怎么样？',
    hint: '点一下就行',
    kind: 'mood',
  },
  {
    key: 'keep',
    title: '今天没做完的，明天还继续吗？',
    hint: '留着明天，还是就放掉',
    kind: 'keep',
  },
  {
    key: 'focus',
    title: '明天最重要的一件事？',
    hint: '可以一键加进明天的待办',
    placeholder: '比如：把复盘卡片做出来',
    multi: false,
  },
]

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{1,2}:\d{2}$/
const MAX_ANSWER = 200

const str = (v, cap = MAX_ANSWER) => String(v == null ? '' : v).trim().slice(0, cap)
const int = (v, min = 0, max = 1e6) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}
const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

export function isDateKey(v) {
  return typeof v === 'string' && DATE_RE.test(v)
}
export function isTimeStr2(v) {
  if (typeof v !== 'string' || !TIME_RE.test(v)) return false
  const m = minOfTime(v)
  return m >= 0 && m < 1440
}
export function minOfTime(v) {
  if (typeof v !== 'string' || !TIME_RE.test(v)) return -1
  const [h, mi] = v.split(':').map(Number)
  if (h > 23 || mi > 59) return -1
  return h * 60 + mi
}

export function moodOf(v) {
  const n = int(v, 0, 5)
  if (!n) return null
  return MOODS.find((m) => m.v === n) || null
}

/* ---------- 记录 ---------- */

export function sanitizeStats(s) {
  const o = s && typeof s === 'object' ? s : {}
  const done = int(o.todosDone, 0, 9999)
  return {
    courses: int(o.courses, 0, 99),
    todosDone: done,
    todosTotal: Math.max(done, int(o.todosTotal, 0, 9999)), // 总数不可能小于已完成（脏数据自愈）
    habitsDone: int(o.habitsDone, 0, 99),
    habitsTotal: int(o.habitsTotal, 0, 99),
    listenToday: int(o.listenToday, 0, 999), // 今天听过的段数（按 clip.last_played_at 落在今天算）
  }
}

export function sanitizeRecord(r) {
  if (!r || typeof r !== 'object') return null
  const date = isDateKey(r.date) ? r.date : ''
  if (!date) return null
  const a = r.answers && typeof r.answers === 'object' ? r.answers : {}
  const created = Number(r.created_at)
  const updated = Number(r.updated_at)
  return {
    date,
    mood: int(r.mood, 0, 5),
    answers: { proud: str(a.proud), keep: str(a.keep), focus: str(a.focus) },
    stats: sanitizeStats(r.stats),
    summary: str(r.summary, 2000),
    created_at: Number.isFinite(created) && created > 0 ? created : Date.now(),
    updated_at: Number.isFinite(updated) && updated > 0 ? updated : Date.now(),
  }
}

export function newRecord({ date, mood = 0, answers = {}, stats = {}, now = Date.now() } = {}) {
  return sanitizeRecord({
    date: date || todayKey(),
    mood,
    answers,
    stats,
    summary: '',
    created_at: now,
    updated_at: now,
  })
}

/* 日精进：模板汇总，不联网。空项不写（宁可短，不写「待办完成 0/0」这种废话） */
export function summarize(rec, { weekdayLabel = '', now = Date.now() } = {}) {
  const r = sanitizeRecord(rec)
  if (!r) return ''
  const lines = []
  const s = r.stats
  const bits = []
  if (s.todosTotal) bits.push(`待办完成 ${s.todosDone}/${s.todosTotal}`)
  if (s.habitsTotal) bits.push(`打卡 ${s.habitsDone}/${s.habitsTotal}`)
  if (s.listenToday) bits.push(`练耳听满 ${s.listenToday} 段`)
  /* 「今天上了 2 节课，待办完成 1/2」比「今天2 节课…」像个句子；没课就直接接后面那串 */
  const lead = s.courses ? `今天上了 ${s.courses} 节课` : '今天'
  const rest = bits.join('，')
  const d = new Date(`${r.date}T00:00:00`)
  const label = `${d.getMonth() + 1} 月 ${d.getDate()} 日` + (weekdayLabel ? ` · ${weekdayLabel}` : '')
  lines.push(label)
  lines.push(rest ? `${lead}${s.courses ? '，' : ''}${rest}。` : `${lead}没有排课、也没有待办和打卡。`)
  const mood = moodOf(r.mood)
  if (mood) lines.push(`状态：${mood.label} ${mood.emoji}`)
  if (r.answers.proud) lines.push(`最值得记的：${r.answers.proud}`)
  if (r.answers.keep) lines.push(`没做完的：${r.answers.keep}`)
  if (r.answers.focus) lines.push(`明天最重要的一件事：${r.answers.focus}`)
  return lines.join('\n')
}

/* ---------- 存取 ---------- */

function readJSON(key, fallback) {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
    if (!raw) return fallback
    const v = JSON.parse(raw)
    return v == null ? fallback : v
  } catch (e) {
    return fallback
  }
}

export function loadReviews() {
  const v = readJSON(REVIEW_KEY, null)
  const list = Array.isArray(v) ? v : v && Array.isArray(v.records) ? v.records : []
  return list.map(sanitizeRecord).filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : -1))
}

export function saveReviews(list) {
  const out = (Array.isArray(list) ? list : []).map(sanitizeRecord).filter(Boolean)
  out.sort((a, b) => (a.date < b.date ? 1 : -1))
  const payload = { version: 1, records: out }
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(REVIEW_KEY, JSON.stringify(payload))
  } catch (e) {
    /* 存不下就算了：复盘不是关键数据，不能让写失败把界面搞崩 */
  }
  return payload
}

/* 同一天只有一条：重做 / 补答都覆盖它（created_at 保留第一次的时间） */
export function upsertReview(list, rec) {
  const r = sanitizeRecord(rec)
  if (!r) return Array.isArray(list) ? list : []
  const out = (Array.isArray(list) ? list : []).slice()
  const i = out.findIndex((x) => x && x.date === r.date)
  if (i >= 0) {
    const old = sanitizeRecord(out[i])
    r.created_at = old ? old.created_at : r.created_at
    out[i] = r
  } else {
    out.push(r)
  }
  out.sort((a, b) => (a.date < b.date ? 1 : -1))
  return out
}

export function findReview(list, date) {
  const d = isDateKey(date) ? date : todayKey()
  return (Array.isArray(list) ? list : []).find((x) => x && x.date === d) || null
}

/* ---------- 设置 ---------- */

export function sanitizeSettings(s) {
  const o = s && typeof s === 'object' ? s : {}
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : DEFAULTS.enabled,
    at: isTimeStr2(o.at) ? hhmm(minOfTime(o.at)) : DEFAULTS.at,
  }
}

export function loadSettings() {
  return sanitizeSettings(readJSON(REVIEW_SET_KEY, null))
}

export function saveSettings(s) {
  const out = sanitizeSettings(s)
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(REVIEW_SET_KEY, JSON.stringify(out))
  } catch (e) {
    /* 同上：存不下不影响本次使用 */
  }
  return out
}

/* 给 notify.js 的一条通知项（每天一条，键按日期，重排时同一天只有一条）
   · at 由调用方给 Date（当天的 settings.at 那一刻）——applySchedule 直接把它塞进 schedule.at
   · 不放按钮：点通知就打开复盘浮层（onNotificationAction 按 extra.src === REVIEW_TAG 判） */
export function noticeItem({ date, at }) {
  const d = isDateKey(date) ? date : todayKey()
  return {
    key: `r_${d}`,
    at,
    title: '今天过得怎么样？',
    body: '花 2 分钟收个尾：今天怎么样、明天最重要的事',
  }
}

/* 当天的复盘提醒时刻（Date）；已过该时刻则返回 null（不补发，和练耳口径一致） */
export function noticeDate({ date, at, now = new Date() } = {}) {
  const d = isDateKey(date) ? date : todayKey()
  const t = sanitizeSettings({ at }).at
  const m = minOfTime(t)
  if (m < 0) return null
  const when = new Date(`${d}T${t}:00`)
  if (!(when instanceof Date) || Number.isNaN(when.getTime())) return null
  return when.getTime() <= now.getTime() ? null : when
}
