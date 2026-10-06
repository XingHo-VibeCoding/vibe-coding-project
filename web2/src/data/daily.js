/* 六期：每日快照（2026-10-05）——「今天的账」要每天有数。
   为什么不能靠复盘记录：`web2/src/data/review.js` 只在用户**当天真的做了一次复盘**时才落一条，
   某天没打开 App 复盘，那天就永远空着，8 天基线也攒不起来。
   所以这里每天**静默**记一条当天数字（App 打开时 + 之后每分钟看一次日期/数字有没有变），
   复盘浮层只负责「把它念出来」，不打扰用户。

   与练耳（listen.js）、复盘（review.js）同一口径：
     · 纯逻辑 + 本机 localStorage（键 `web2.daily`），**不进主项目导出**
     · stats 直接复用 review.js 的 `sanitizeStats`，保证「账」与「日精进」永远同一口径

   记录形状：
     { date:'YYYY-MM-DD', stats:{courses,todosDone,todosTotal,habitsDone,habitsTotal,listenToday}, updated_at:ms } */
import { isDateKey, sanitizeStats } from './review.js'

export const DAILY_KEY = 'web2.daily'
export const DAILY_KEEP = 120 // 最多留最近 120 天（够用且不会把 localStorage 撑爆）

export function todayKeyOf(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function sanitizeDay(v) {
  if (!v || typeof v !== 'object' || !isDateKey(v.date)) return null
  const t = Number(v.updated_at)
  return {
    date: v.date,
    stats: sanitizeStats(v.stats),
    /* 六期第二步：今天有没有就地问过「没做完的原因」（问过就不再问，一天只打扰一次） */
    reason_asked: v.reason_asked === true,
    updated_at: Number.isFinite(t) && t > 0 ? t : Date.now(),
  }
}

export function sanitizeBook(v) {
  const days = {}
  const src = v && typeof v === 'object' && v.days && typeof v.days === 'object' ? v.days : {}
  for (const k of Object.keys(src)) {
    const d = sanitizeDay(src[k])
    if (d) days[d.date] = d
  }
  const book = { version: 1, days }
  return pruneDays(book, DAILY_KEEP)
}

/* 只留最近 keep 天（按日期倒序取） */
export function pruneDays(book, keep = DAILY_KEEP) {
  const list = Object.values(book.days).sort((a, b) => (a.date < b.date ? 1 : -1))
  if (list.length <= keep) return book
  const days = {}
  for (const d of list.slice(0, keep)) days[d.date] = d
  return { version: 1, days }
}

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

export function loadDaily() {
  return sanitizeBook(readJSON(DAILY_KEY, null))
}

export function saveDaily(book) {
  const out = sanitizeBook(book)
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(DAILY_KEY, JSON.stringify(out))
  } catch (e) {
    /* 存不下就算：账不是关键数据，写失败不能让界面崩 */
  }
  return out
}

/* 同一天只有一条：数字没变就不算 changed（调用方据此决定要不要写盘，避免每分钟都写一遍） */
export function upsertDay(book, { date, stats, now = Date.now(), reasonAsked = null } = {}) {
  const cur = sanitizeBook(book)
  const key = date || todayKeyOf()
  const prev = cur.days[key]
  /* reasonAsked 只在**显式传了**的时候才动它 —— 每分钟一次的静默快照不能把「问过了」抹掉 */
  const asked = reasonAsked === null ? !!(prev && prev.reason_asked) : reasonAsked === true
  const day = sanitizeDay({ date: key, stats, reason_asked: asked, updated_at: now })
  if (!day) return { book: cur, day: null, changed: false }
  const same =
    prev && JSON.stringify(prev.stats) === JSON.stringify(day.stats) && prev.reason_asked === day.reason_asked
  if (same) return { book: cur, day: prev, changed: false }
  const days = Object.assign({}, cur.days, { [day.date]: day })
  return { book: pruneDays({ version: 1, days }, DAILY_KEEP), day, changed: true }
}

export function dayOf(book, date) {
  const b = sanitizeBook(book)
  const d = isDateKey(date) ? date : todayKeyOf()
  return b.days[d] || null
}

/* 最近 n 天（含今天，按日期倒序；缺的日子不会补空行——基线只认「记过的天」） */
export function recentDays(book, n = 8) {
  return Object.values(sanitizeBook(book).days)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, Math.max(0, n))
}

/* 基线：攒够 n 天才说「比平时多/少」（设计稿 §1.5 口径）。
   `enough=false` 时 UI 只说「基线建立中 x / n 天」，不给结论。 */
export function baselineOf(book, n = 8) {
  const days = recentDays(book, n)
  const planned = days.reduce((s, d) => s + d.stats.todosTotal, 0)
  const done = days.reduce((s, d) => s + d.stats.todosDone, 0)
  const kept = days.length
  return {
    days,
    kept,
    need: n,
    enough: kept >= n,
    avgPlanned: kept ? Math.round((planned / kept) * 10) / 10 : 0,
    avgDone: kept ? Math.round((done / kept) * 10) / 10 : 0,
  }
}

/* 历史列表用的一行小结：『排 6 做完 3 · 2 节课』；没排事只说课/打卡（宁可短，不写废话） */
export function dayLine(day) {
  const d = sanitizeDay(day)
  if (!d) return ''
  const s = d.stats
  const bits = []
  if (s.todosTotal) bits.push(`排 ${s.todosTotal} 做完 ${s.todosDone}`)
  if (s.courses) bits.push(`${s.courses} 节课`)
  if (s.habitsTotal) bits.push(`打卡 ${s.habitsDone}/${s.habitsTotal}`)
  return bits.join(' · ')
}
