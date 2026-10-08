/* 国家法定节假日（放假）自动抓取 —— 「调休」功能的第 4 步。
 *
 * 数据源：NateScarlet/holiday-cn（国务院口径的公告整理），走 jsDelivr CDN。
 *   为什么不走 raw.githubusercontent：实测浏览器跨域取不到（Failed to fetch），
 *   而 jsDelivr 带 CORS 头、能取到（另有一条 timor.tech 也能用，但字段没这个干净）。
 *   实测脚本：web2/tmp/holiday-cors-probe.mjs。
 *
 * 这份数据只说两件事：「哪天放假」和「哪天要上班」。
 *   ⚠ 它**不说补哪天的课** —— 国务院的调休只讲「这天要上班」，学校才讲「按周几的课表上」。
 *   所以这里只自动填 kind='off'（放假），补课日必须由用户在「特殊日期」里自己选周几。
 *   绝不猜「上班日 = 补周一」：猜错会把一整天的课排到错的日子，比不填更糟。
 *
 * 缓存：本机键 web2.holidayCache = { fetchedAt, byYear: { '2026': [...] } }。
 *   网络不通 / 数据源挂了 → 一律静默失败（不抛、不提示、绝不挡启动），用缓存或空表。
 */

const CACHE_KEY = 'web2.holidayCache'
const CDN = 'https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/'
const FETCH_TIMEOUT_MS = 8000

/* 日期是否真实存在（不能只判 NaN —— new Date('2026-02-30') 会自己滚到 03-02，见 store.js 的说明）。
   就近实现一份，避免这个纯数据模块反向依赖 store.js。 */
function realDate(s) {
  const str = String(s == null ? '' : s).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false
  const d = new Date(str + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return false
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) === str
}

/** 解析 holiday-cn 的 JSON：只取 isOffDay === true 的那些天（放假）。 */
export function parseHolidayCn(json) {
  const days = json && Array.isArray(json.days) ? json.days : []
  const out = []
  for (const d of days) {
    if (!d || d.isOffDay !== true) continue
    const date = String(d.date || '').trim()
    if (!realDate(date)) continue
    out.push({ date, name: String(d.name || '法定假日').trim() })
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return out
}

export function loadHolidayCache() {
  try {
    const j = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (!j || typeof j !== 'object' || !j.byYear || typeof j.byYear !== 'object') return { fetchedAt: 0, byYear: {} }
    return { fetchedAt: Number(j.fetchedAt) || 0, byYear: j.byYear }
  } catch {
    return { fetchedAt: 0, byYear: {} }
  }
}

function saveHolidayCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* 配额满等：抓取结果不落盘也不该影响使用 */
  }
}

/**
 * 合并：把国家放假日记进用户的覆盖表，**只补空缺、绝不覆盖已有条目**。
 * 已有条目可能是用户手标的（off/swap/info，甚至带自己写的说明）——那是用户的决定，不覆盖。
 * 返回 { list, added }，list 是合并后的完整表（已清洗、已排序）。
 */
export function mergeNationalOffs(current, offDays) {
  const base = Array.isArray(current) ? current.slice() : []
  const have = new Set(base.map((x) => x && x.date))
  const added = []
  for (const d of offDays) {
    if (have.has(d.date)) continue
    have.add(d.date)
    const item = { date: d.date, kind: 'off', useWeekday: null, note: d.name + '（法定假日）' }
    base.push(item)
    added.push(item)
  }
  return { list: base, added }
}

/** 抓一年的放假表。失败返回 null（调用方保持现状）。 */
export async function fetchHolidayYear(year) {
  const y = Math.floor(Number(year))
  if (!(y >= 2000 && y <= 2100)) return null
  const url = CDN + y + '.json'
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS) : null
  try {
    const res = await fetch(url, ctl ? { signal: ctl.signal } : undefined)
    if (!res.ok) return null
    const json = await res.json()
    return parseHolidayCn(json)
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 需要哪几年：学期覆盖到的年份（跨年学期要两年）+ 今年，最多 3 个。
 * 学期缺起始日就只算今年。往前留一年，因为“上周的假”也可能刚补上。
 */
export function yearsToFetch(semester, now = new Date()) {
  const set = new Set()
  const cur = now.getFullYear()
  set.add(cur)
  set.add(cur + 1)
  const fm = semester && semester.first_monday
  if (fm && /^\d{4}-\d{2}-\d{2}$/.test(String(fm))) {
    const y = Number(String(fm).slice(0, 4))
    const tw = Math.max(1, Math.floor(Number(semester.total_weeks)) || 16)
    const end = new Date(String(fm) + 'T00:00:00')
    if (!Number.isNaN(end.getTime())) {
      end.setDate(end.getDate() + tw * 7)
      set.add(end.getFullYear())
    }
    set.add(y)
    set.add(y - 1)
  }
  return Array.from(set).filter((y) => y >= 2000 && y <= 2100).sort()
}

/**
 * 抓 + 合并的一站式入口（供 App 打开时后台调用）。
 * 返回 { list, added, fetchedYears, ok }；ok=false 表示这次没抓到任何年份（网络问题），
 * 此时 list 原样返回，调用方不用区分「没抓到」和「本来就没有」。
 * 抓到的年份会写进缓存，下次没网也能直接用缓存里的。
 */
export async function syncHolidays({ semester, current, now = new Date() } = {}) {
  const years = yearsToFetch(semester, now)
  let list = Array.isArray(current) ? current : []
  let fetchedYears = 0
  let added = []
  const cache = loadHolidayCache()
  for (const y of years) {
    const offs = await fetchHolidayYear(y)
    if (!offs) continue
    fetchedYears += 1
    cache.byYear[String(y)] = offs
    const r = mergeNationalOffs(list, offs)
    list = r.list
    added = added.concat(r.added)
  }
  if (fetchedYears > 0) {
    cache.fetchedAt = now.getTime()
    saveHolidayCache(cache)
  }
  return { list, added, fetchedYears, ok: fetchedYears > 0 }
}
