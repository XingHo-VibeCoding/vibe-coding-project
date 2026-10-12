/* 手机使用时间（六期 P6，2026-10-12）——「今天的账」副栏的数据出口。
 *
 * 设计稿 `docs/今天的账与可回嘴-设计稿.md` §1.2/§1.7/§1.8：
 *   · 副栏**默认折叠**，一行 `手机 6h32m ▸`，只在需要对照时下钻
 *   · 无授权时**明说「手机数据不全」**，绝不假装完整（§1.7）
 *   · 只画**分布条**，不列清单打分（§1.8-1）；沟通类**单列**，不并进娱乐（§1.8-2）
 *   · 隐私：**只留分类汇总，不留 App 名**（§1.8-3）——包名在原生层就被消化掉
 *     （`scripts/native/UsageStatsPlugin.kt` 的 `categoryOf`），这里拿到的只有 `{key,ms}`。
 *
 * 分工与 secureStore.js 同一范式：
 *   · App（插件在）      → 走系统 `UsageStatsManager`（**特殊权限**，用户须手动开）
 *   · 浏览器（无插件）    → 如实返回 unsupported，界面显示「未开启」（不报错、不催）
 *   · 插件在但调用失败    → 如实上抛，绝不当成「今天没玩手机」
 *
 * 本文件不碰 localStorage（除了自己的 `web2.usage` 键）、不碰 DOM。
 * **刻意不进云同步白名单**（`web2/src/data/sync.js` 的 SYNC_KEYS 没有它）——设计稿 §1.8-3。 */

export const USAGE_KEY = 'web2.usage'
export const USAGE_KEEP = 120 // 与 daily.js 同口径：最多留最近 120 天

/* 四个分类固定顺序 + 固定文案。原生侧只回 key（comm/study/fun/other），
   中文名**只在这一处**定义，两边各自的表不会漂。 */
export const USAGE_CATS = [
  { key: 'comm', label: '沟通', tone: 'bg-primary-500' },
  { key: 'study', label: '学习', tone: 'bg-emerald-500' },
  { key: 'fun', label: '娱乐', tone: 'bg-amber-500' },
  { key: 'other', label: '其他', tone: 'bg-soft-2' },
]

const CAT_KEYS = USAGE_CATS.map((c) => c.key)
const NOT_APP = '这个能力要在 App 里用（当前环境没有系统使用情况接口）。'

function plugin() {
  const c = typeof window !== 'undefined' ? window.Capacitor : null
  const p = c && c.Plugins ? c.Plugins : null
  const u = p ? p.UsageStats : null
  return u && typeof u.available === 'function' && typeof u.today === 'function' ? u : null
}

/* 当前环境有没有这个桥（浏览器/桌面 false，App true）。**这只说明「能不能问」，
   不代表「用户给没给权限」**——那要看 usageGranted()。 */
export function usageAvailable() {
  return !!plugin()
}

/* 查特殊权限。返回 { ok, granted }；没插件时 ok:false, unsupported:true。 */
export async function usageGranted() {
  const p = plugin()
  if (!p) return { ok: false, unsupported: true, granted: false, error: NOT_APP }
  try {
    const r = await p.available()
    return { ok: true, granted: !!(r && r.granted) }
  } catch (e) {
    return { ok: false, granted: false, error: (e && (e.message || e.errorMessage)) || String(e) }
  }
}

/* 跳系统「使用情况访问权限」页（唯一能开这个权限的路径）。 */
export async function openUsageSettings() {
  const p = plugin()
  if (!p) return { ok: false, unsupported: true, error: NOT_APP }
  try {
    await p.openSettings()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e && (e.message || e.errorMessage)) || String(e) }
  }
}

/** 一个本地日的起止毫秒（用本机时区，不是 UTC —— 用户看到的「今天」是本地的今天）。 */
export function dayWindow(dateKey, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''))
  const base = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const start = base.getTime()
  return { start, end: start + 24 * 3600 * 1000 }
}

/* 读某一天（默认今天）的聚合。返回 { ok, granted, totalMs, byCategory, byHour } 或 { ok:false, error }。
   granted=false 时**不报错**：这是「用户没开权限」的正常状态，界面据此说「未开启」。 */
export async function fetchUsageDay(dateKey) {
  const p = plugin()
  if (!p) return { ok: false, unsupported: true, granted: false, error: NOT_APP }
  const { start, end } = dayWindow(dateKey)
  try {
    const r = await p.today({ start, end })
    if (!r || !r.granted) return { ok: true, granted: false, totalMs: 0, byCategory: [], byHour: [] }
    return {
      ok: true,
      granted: true,
      totalMs: Number(r.totalMs) || 0,
      byCategory: normalizeCats(r.byCategory),
      byHour: normalizeHours(r.byHour),
    }
  } catch (e) {
    return { ok: false, granted: false, error: (e && (e.message || e.errorMessage)) || String(e) }
  }
}

/* 把原生回的 byCategory 收敛成固定四类的数组（比例由调用方算）。
   原生理论上只回这四个 key，但**防一手**：陌生的 key 不丢，归进 other。 */
export function normalizeCats(v) {
  const acc = {}
  const list = Array.isArray(v) ? v : []
  for (const it of list) {
    if (!it) continue
    const k = CAT_KEYS.indexOf(it.key) >= 0 ? it.key : 'other'
    const ms = Number(it.ms)
    if (!Number.isFinite(ms) || ms <= 0) continue
    acc[k] = (acc[k] || 0) + ms
  }
  return USAGE_CATS.map((c) => ({ key: c.key, ms: Math.round(acc[c.key] || 0) }))
}

function normalizeHours(v) {
  const out = new Array(24).fill(0)
  const list = Array.isArray(v) ? v : []
  for (let i = 0; i < 24; i++) {
    const n = Number(list[i])
    out[i] = Number.isFinite(n) && n > 0 ? Math.round(n) : 0
  }
  return out
}

/* ---------- 本机存档（`web2.usage`，不进导出、不进云同步） ---------- */

export function sanitizeUsageDay(v) {
  if (!v || typeof v !== 'object') return null
  const date = String(v.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const totalMs = Math.max(0, Math.round(Number(v.totalMs) || 0))
  const t = Number(v.updated_at)
  return {
    date,
    granted: v.granted !== false,
    totalMs,
    byCategory: normalizeCats(v.byCategory),
    byHour: normalizeHours(v.byHour),
    updated_at: Number.isFinite(t) && t > 0 ? t : Date.now(),
  }
}

export function sanitizeUsageBook(v) {
  const days = {}
  const src = v && typeof v === 'object' && v.days && typeof v.days === 'object' ? v.days : {}
  for (const k of Object.keys(src)) {
    const d = sanitizeUsageDay(src[k])
    if (d) days[d.date] = d
  }
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

export function loadUsage() {
  return sanitizeUsageBook(readJSON(USAGE_KEY, null))
}

export function saveUsage(book) {
  const out = pruneUsage(sanitizeUsageBook(book), USAGE_KEEP)
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(USAGE_KEY, JSON.stringify(out))
  } catch (e) {
    /* 存不下就算：账不是关键数据，写失败不能让界面崩（与 daily.js 同口径） */
  }
  return out
}

export function pruneUsage(book, keep = USAGE_KEEP) {
  const list = Object.values(book.days).sort((a, b) => (a.date < b.date ? 1 : -1))
  if (list.length <= keep) return book
  const days = {}
  for (const d of list.slice(0, keep)) days[d.date] = d
  return { version: 1, days }
}

/* 同一天只有一条；数字没变就不算 changed（调用方据此决定要不要写盘）。 */
export function upsertUsageDay(book, { date, granted = true, totalMs = 0, byCategory = [], byHour = [], now = Date.now() } = {}) {
  const cur = sanitizeUsageBook(book)
  const day = sanitizeUsageDay({ date, granted, totalMs, byCategory, byHour, updated_at: now })
  if (!day) return { book: cur, day: null, changed: false }
  const prev = cur.days[day.date]
  const same =
    prev &&
    prev.granted === day.granted &&
    prev.totalMs === day.totalMs &&
    JSON.stringify(prev.byCategory) === JSON.stringify(day.byCategory) &&
    JSON.stringify(prev.byHour) === JSON.stringify(day.byHour)
  if (same) return { book: cur, day: prev, changed: false }
  const days = Object.assign({}, cur.days, { [day.date]: day })
  return { book: pruneUsage({ version: 1, days }, USAGE_KEEP), day, changed: true }
}

export function usageOfDay(book, date) {
  const b = sanitizeUsageBook(book)
  return b.days[date] || null
}

/* 最近 n 天里**真的记过数的那些天**（与 daily.js 的 recentDays 同口径：缺的日子不补空行）。 */
export function recentUsageDays(book, n = 8) {
  return Object.values(sanitizeUsageBook(book).days)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, Math.max(0, n))
}

/* ---------- 纯展示逻辑 ---------- */

/* 毫秒 → 「6h32m」/「48m」/「0m」。超过 10 小时带小数没必要，只到分钟。 */
export function formatMs(ms) {
  const t = Math.max(0, Math.round(Number(ms) || 0))
  const totalMin = Math.floor(t / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h <= 0) return `${m}m`
  return `${h}h${String(m).padStart(2, '0')}m`
}

/* 分布条：按四类固定顺序，附占比（pct 四舍五入，总和可能不是 100，UI 只用来画条）。
   全 0 时返回空数组 —— 让界面走「今天没数据」而不是画一条全灰的条。 */
export function catBreakdown(day) {
  const d = sanitizeUsageDay(day)
  if (!d || !d.totalMs) return []
  const total = d.byCategory.reduce((s, c) => s + c.ms, 0)
  if (!total) return []
  return USAGE_CATS.map((c) => {
    const ms = (d.byCategory.find((x) => x.key === c.key) || {}).ms || 0
    return { key: c.key, label: c.label, tone: c.tone, ms, pct: Math.round((ms / total) * 1000) / 10 }
  }).filter((c) => c.ms > 0)
}

/* 分时段分布（24 桶）压缩成 8 个「3 小时段」给界面画形状：
   [0-3, 3-6, 6-9, 9-12, 12-15, 15-18, 18-21, 21-24]。 */
export function hourSlots(day) {
  const d = sanitizeUsageDay(day)
  if (!d) return []
  const out = []
  for (let s = 0; s < 24; s += 3) {
    const ms = d.byHour.slice(s, s + 3).reduce((a, b) => a + b, 0)
    out.push({ from: s, to: s + 3, label: `${s}–${s + 3}`, ms })
  }
  return out
}

/* 8 天基线：攒够 n 天才允许说「比平时多/少」（§1.7 硬规则：攒够之前不许硬凑对比）。 */
export function usageBaseline(book, n = 8) {
  const days = recentUsageDays(book, n).filter((d) => d.granted)
  const kept = days.length
  const totalMs = days.reduce((s, d) => s + d.totalMs, 0)
  return {
    days,
    kept,
    need: n,
    enough: kept >= n,
    avgMs: kept ? Math.round(totalMs / kept) : 0,
  }
}

/* 一行折叠摘要所需的全部东西（界面只读这个，不再自己算）。 */
export function usageLine(day) {
  const d = sanitizeUsageDay(day)
  if (!d) return { has: false, text: '手机 · 未开启', granted: false }
  if (!d.granted) return { has: false, text: '手机 · 未开启', granted: false }
  return { has: d.totalMs > 0, text: `手机 ${formatMs(d.totalMs)}`, granted: true }
}
