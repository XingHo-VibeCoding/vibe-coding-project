/* 六期第二步：可回嘴 + 找模式（2026-10-06）
   纯逻辑 + localStorage，和 review.js / daily.js 一条口径：**只写本机，不进主项目导出**。
   设计稿：docs/今天的账与可回嘴-设计稿.md §2。

   这个东西只有两台机器，合起来才是「它记住了，并且指出来」：
     ① 记忆（本模块）：你说过的理由 + 提过几次 + 最后一次什么时候提的
     ② 指认（appearances / patterns）：数据里重复出现的东西，够格了才允许命名

   存储形状（REASONS_KEY = 'web2.reasons'）：
     { version: 1,
       items: [ { text:'太累了', norm:'太累了', reason:'tired',
                  count:2, first_at:ms, last_at:ms, last_said_at:ms,
                  asked_dates:['2026-10-01', …], muted:false } ],
       patterns: [ { id:'weekday-gap-3', key:'3', count:3, last_at:ms,
                     told_count:1, last_told_at:ms } ] }
   · norm  = 去空白/大小写后的比对键，防止「太累了」和「太累了 」算两条
   · count = 被甩回去过几次（不是说过几次）——§2.2 的降级看的是这个
   · asked_dates：这个理由是在哪些日子给的（找模式要按星期几分组）

   三条硬规则，全部来自设计稿，实现时不许绕过：
   1. **超过 30 天的理由自动不引用**（§2.2）——三个月前的借口甩出来不是厉害，是刻薄
   2. **同一件事提第三次时它自己先软下来**（§2.2）——所以 count ≥ 3 就闭嘴
   3. **证据 < 3 次只给陈述，不给命名**（§2.3）——命名是它的观点，得够格才配说

   与 daily.js 一样的幂等口径：upsertReason 数字没变就不写盘。 */

export const REASONS_KEY = 'web2.reasons'
/* 理由的保鲜期：超过它就不再引用（§2.2 「三个月前的借口甩出来是刻薄」） */
export const REASON_TTL_DAYS = 30
/* 降级线：同一件事被提满这么多次，它自己先软下来（§2.2） */
export const GIVEUP_AT = 3
/* 找模式的沉默线：证据少于这么多次只允许陈述，不允许命名（§2.3） */
export const NAME_AT = 3
/* 主动提起的次数上限与冷却：一个月最多一次（§2.2） */
export const PROACTIVE_MAX = 1
export const PROACTIVE_COOLDOWN_DAYS = 30

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_REASON = 60
const MAX_ITEMS = 200

/* ---------- 小工具（与 review.js 同口径，避免跨模块循环依赖） ---------- */

const str = (v, cap = MAX_REASON) => String(v == null ? '' : v).trim().slice(0, cap)
/* max 必须容得下毫秒时间戳（~1.79e12）：写成 1e9 会把每个 first_at/last_at 都夹到 1970 年，
   而保鲜期是按这些时间算的 —— 表现是「所有理由一到手就过期」，A5/A7b 就是这么红的。 */
const int = (v, min = 0, max = 1e15) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}
const dayOf = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/* 两个日期键差多少天（YYYY-MM-DD 相减；用本地零点，避免跨时区把一天算成零） */
export function daysBetween(a, b) {
  const pa = new Date(`${a}T00:00:00`)
  const pb = new Date(`${b}T00:00:00`)
  if (Number.isNaN(pa.getTime()) || Number.isNaN(pb.getTime())) return Infinity
  return Math.round(Math.abs(pb - pa) / 86400000)
}

export function isDateKey(v) {
  return typeof v === 'string' && DATE_RE.test(v)
}

/* 归一化：中文/英文都只是去空白 + 转小写，不做同义词合并
   （合并同义词是 AI 的事，规则层硬做会误判「太累了」和「太累」是不是一回事） */
export function normOf(text) {
  return str(text).replace(/\s+/g, '').toLowerCase()
}

/* ---------- 快捷理由（账卡就地追问时给的三个按钮） ----------
   设计稿要求「1–2 个动作」，但那是**账卡**的动作数；这里是追问输入框的快捷项，
   三个是刻意选的：一个外部原因、一个身体原因、一个主观意愿——
   因为要能覆盖「不是你的错 / 你状态不好 / 你确实不想做」三种，少一个就会有人填不进去。 */
export const QUICK_REASONS = [
  { key: 'busy', label: '临时有事', text: '临时有事' },
  { key: 'tired', label: '太累了', text: '太累了' },
  { key: 'unwilling', label: '不想做', text: '不想做' },
]

/* ---------- 记忆条目 ---------- */

function sanitizeItem(o) {
  if (!o || typeof o !== 'object') return null
  const text = str(o.text)
  if (!text) return null
  const asked = Array.isArray(o.asked_dates) ? o.asked_dates.filter(isDateKey) : []
  return {
    text,
    norm: normOf(o.norm || text),
    reason: str(o.reason, 20),
    count: int(o.count, 0, 999),
    first_at: int(o.first_at, 0),
    last_at: int(o.last_at, 0),
    last_said_at: int(o.last_said_at, 0),
    asked_dates: [...new Set(asked)].sort().slice(-60),
    muted: o.muted === true,
  }
}

function sanitizePattern(o) {
  if (!o || typeof o !== 'object') return null
  const id = str(o.id, 40)
  if (!id) return null
  return {
    id,
    key: str(o.key, 40),
    count: int(o.count, 0, 999),
    last_at: int(o.last_at, 0),
    told_count: int(o.told_count, 0, 999),
    last_told_at: int(o.last_told_at, 0),
  }
}

export function emptyBook() {
  return { version: 1, items: [], patterns: [] }
}

export function sanitizeBook(b) {
  const o = b && typeof b === 'object' ? b : {}
  return {
    version: 1,
    items: (Array.isArray(o.items) ? o.items : []).map(sanitizeItem).filter(Boolean).slice(0, MAX_ITEMS),
    patterns: (Array.isArray(o.patterns) ? o.patterns : []).map(sanitizePattern).filter(Boolean).slice(0, 60),
  }
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

export function loadBook() {
  return sanitizeBook(readJSON(REASONS_KEY, null))
}

export function saveBook(book) {
  const out = sanitizeBook(book)
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(REASONS_KEY, JSON.stringify(out))
  } catch (e) {
    /* 存不下就算了：它不是关键数据，不能让写失败把界面搞崩 */
  }
  return out
}

/* ---------- 记下一个理由（幂等：文字没变就不写盘） ---------- */

export function upsertReason(book, { text, reason = '', date, now = Date.now() } = {}) {
  const src = sanitizeBook(book)
  const t = str(text)
  if (!t) return { book: src, item: null, changed: false }
  const n = normOf(t)
  const d = isDateKey(date) ? date : dayOf(now)
  const items = src.items.slice()
  const i = items.findIndex((x) => x.norm === n)
  if (i >= 0) {
    const old = items[i]
    const asked = old.asked_dates.includes(d) ? old.asked_dates : [...old.asked_dates, d].sort().slice(-60)
    const same = old.text === t && old.asked_dates.length === asked.length
    items[i] = { ...old, text: t, reason: reason || old.reason, last_at: now, asked_dates: asked }
    /* 只多记了一个日期（或文字没变）→ 不算新写入 */
    return { book: { ...src, items }, item: items[i], changed: !same }
  }
  const item = {
    text: t,
    norm: n,
    reason: str(reason, 20),
    count: 0,
    first_at: now,
    last_at: now,
    last_said_at: 0,
    asked_dates: [d],
    muted: false,
  }
  items.push(item)
  return { book: { ...src, items }, item, changed: true }
}

export function findReason(book, text) {
  const n = normOf(text)
  if (!n) return null
  return sanitizeBook(book).items.find((x) => x.norm === n) || null
}

/* 还活着的理由：没过保鲜期、没被静音、还没到降级线（§2.2 的三条硬规则） */
export function liveReasons(book, { today = dayOf(Date.now()), ttlDays = REASON_TTL_DAYS, giveUpAt = GIVEUP_AT } = {}) {
  return sanitizeBook(book).items.filter((x) => {
    if (x.muted) return false
    if (x.count >= giveUpAt) return false
    if (!isDateKey(today)) return true
    return daysBetween(dayOf(x.last_at || x.first_at), today) <= ttlDays
  })
}

/* 在记忆里挑一条最该被甩回去的：
   优先「说过不止一次」的（重复的借口才是借口），次数相同取最近说过的。 */
export function pickCallout(book, { today = dayOf(Date.now()) } = {}) {
  const pool = liveReasons(book, { today }).filter((x) => x.count > 0 || x.asked_dates.length > 1)
  if (!pool.length) return null
  pool.sort((a, b) => {
    if (b.asked_dates.length !== a.asked_dates.length) return b.asked_dates.length - a.asked_dates.length
    return b.last_at - a.last_at
  })
  return pool[0]
}

/* 记一次「甩回去了」：count++、last_said_at 刷新。
   到 GIVEUP_AT 时返回 giveUp=true —— 调用方该说那句「好吧，这事儿我不提了」（§2.2 的降级）。 */
export function markSaid(book, text, { now = Date.now() } = {}) {
  const src = sanitizeBook(book)
  const n = normOf(text)
  const items = src.items.slice()
  const i = items.findIndex((x) => x.norm === n)
  if (i < 0) return { book: src, item: null, giveUp: false, changed: false }
  const next = { ...items[i], count: items[i].count + 1, last_said_at: now }
  next.muted = next.count >= GIVEUP_AT
  items[i] = next
  return { book: { ...src, items }, item: next, giveUp: next.muted, changed: true }
}

/* 用户说「这事儿我不提了」→ 立刻闭嘴，不用等三次 */
export function muteReason(book, text) {
  const src = sanitizeBook(book)
  const n = normOf(text)
  const items = src.items.map((x) => (x.norm === n ? { ...x, muted: true } : x))
  return { book: { ...src, items }, changed: items.some((x, i) => x.muted !== src.items[i].muted) }
}

/* ---------- 找模式：把断点连起来（§2.4） ----------
   输入是「每天做完了没有」的日序列（来自 daily.js 的快照 + 复盘记录），
   输出是**事实陈述**；命名（「你周三下午认输了」）交给 AI，规则层只允许在证据够格时产出
   「可命名」的候选，且必须由调用方显式升级 —— 规则自己不说那句判断。

   这里只做一件事：**按星期几分组，找出「同一星期几上反复断」的那一天。** */

export function weekdayOf(dateKey) {
  const d = new Date(`${dateKey}T00:00:00`)
  return Number.isNaN(d.getTime()) ? -1 : d.getDay() // 0=周日
}

export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/* days: [{ date, planned, done }]（按日期升序或乱序都可）
   返回 [{ weekday, label, total, missed, rate, dates, enough }]
   · missed = 那天排了事但一件没做完（planned > 0 && done === 0）
   · enough = 证据够格命名（§2.3 的沉默线） */
export function weekdayGaps(days, { nameAt = NAME_AT } = {}) {
  const buckets = WEEKDAY_LABELS.map((label, wd) => ({ weekday: wd, label, total: 0, missed: 0, dates: [] }))
  for (const d of Array.isArray(days) ? days : []) {
    if (!d || !isDateKey(d.date)) continue
    const wd = weekdayOf(d.date)
    if (wd < 0) continue
    const planned = int(d.planned, 0, 999)
    const done = int(d.done, 0, 999)
    if (planned <= 0) continue // 那天没排事 → 不进统计（没排事谈不上「断」）
    buckets[wd].total += 1
    if (done === 0) {
      buckets[wd].missed += 1
      buckets[wd].dates.push(d.date)
    }
  }
  return buckets
    .filter((b) => b.total > 0)
    .map((b) => ({
      ...b,
      rate: b.total ? b.missed / b.total : 0,
      enough: b.missed >= nameAt,
    }))
    .sort((a, b) => b.missed - a.missed)
}

/* 一天的短语：给 UI 直接用，避免各组件各写一遍 */
export function gapLine(g) {
  if (!g || !g.missed) return ''
  return `${g.label}断了 ${g.missed} 次（共 ${g.total} 个${g.label}）`
}

/* ---------- 主动提起（§2.2：能，一个月最多一次） ---------- */

export function patternState(book, id) {
  const p = sanitizeBook(book).patterns.find((x) => x.id === id) || null
  return p || { id, key: '', count: 0, last_at: 0, told_count: 0, last_told_at: 0 }
}

/* 该不该主动提起这个模式：冷却期内不提、提满上限不提 */
export function canTellPattern(book, id, { today = dayOf(Date.now()), cooldownDays = PROACTIVE_COOLDOWN_DAYS, max = PROACTIVE_MAX } = {}) {
  const p = patternState(book, id)
  if (p.told_count >= max) return false
  if (!p.last_told_at) return true
  return daysBetween(dayOf(p.last_told_at), today) >= cooldownDays
}

export function markPatternTold(book, id, { key = '', count = 0, now = Date.now() } = {}) {
  const src = sanitizeBook(book)
  const patterns = src.patterns.slice()
  const i = patterns.findIndex((x) => x.id === id)
  if (i >= 0) {
    patterns[i] = { ...patterns[i], key: key || patterns[i].key, count, last_at: now, told_count: patterns[i].told_count + 1, last_told_at: now }
  } else {
    patterns.push({ id, key, count, last_at: now, told_count: 1, last_told_at: now })
  }
  return { book: { ...src, patterns }, changed: true }
}
