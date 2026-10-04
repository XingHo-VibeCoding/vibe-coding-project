/* web2 碎片练耳出口（四期 Day 18）——数据层 + 纯逻辑，单一出口。
   口径（TECH_DESIGN §3.5 / §4.2、PRD 五节四期）：
     - 练耳数据是「设备本机的生命记录」：独立键 web2.listen / web2.listen.set，
       **不进 JSON 导出**（同 web2.lectures / web2.habits）。
     - **通知只提醒、不自动播放**；每一项进度推进（已听次数 / 复习档位 / 下次复习日）
       都必须由使用者点「已听」**手动确认**推动——没有确认就绝不推进。
     - 跨天复习（艾宾浩斯）按 next_due_date 判定，**以日期为准、不按次数**。
     - 三种「重复」分开：会话内重复 repeatTimes（一次坐下连放几遍）；
       跨天复习 reviewIntervals（隔几天再听）；空闲槽承载（那天哪个空档够放）。
   本文件不碰 DOM、不碰插件 —— 纯逻辑，node 单测友好（照 periods.js 的口径）。
   所有可调默认值集中在 DEFAULTS 一处，校准只改这里。 */

export const LISTEN_KEY = 'web2.listen'
export const LISTEN_SET_KEY = 'web2.listen.set'
export const LISTEN_SUB_DIR = 'listen' // 音频文件落盘子目录（应用私有目录下）
export const LISTEN_DIR = 'DATA' // 对应 Capacitor Filesystem 的 Directory.Data

/* ------------------------------------------------------------------
   集中默认值（土法版实测后校准只改这一处）
   ------------------------------------------------------------------ */
export const DEFAULTS = {
  repeatTimes: 3,                    // 会话内重复遍数（3–5）
  reviewIntervals: [1, 2, 4, 7, 15, 30], // 艾宾浩斯跨天复习间隔（天）
  dndStart: '23:00',                 // 勿扰开始（支持跨零点）
  dndEnd: '07:00',                   // 勿扰结束
  shortGapMaxMin: 10,                // 短槽上限：≤ 此值 = 短槽（1 段）
  slotMinMin: 5,                     // 小于此值太碎，不排
  repeatTimesMin: 3,
  repeatTimesMax: 5,
  defaultClipSeconds: 30,            // 时长未知时的估算值（只用于估算，不写进数据）
}

/* 设置项的钳位区间（与 §3.5 的"可配 3–5"一致） */
export function clampRepeatTimes(n) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return DEFAULTS.repeatTimes
  return Math.min(DEFAULTS.repeatTimesMax, Math.max(DEFAULTS.repeatTimesMin, v))
}

/* ------------------------------------------------------------------
   设置界面的输入解析（纯函数，好单测）——界面上手输的东西一律先过这里，
   非法输入绝不写进设置（宁可保留原值）
   ------------------------------------------------------------------ */

/* 复习间隔输入框：'1,2,4,7,15,30' → [1,2,4,7,15,30]。
   宽容解析：逗号/中文逗号/空白都算分隔；丢掉非数字、≤0、>365、重复项；
   一个都没解析出来 → 用 fallback（调用方传当前值，等于"没改"）。
   最多 12 档，防手抖贴一大串。 */
export function parseIntervals(text, fallback) {
  const fb = Array.isArray(fallback) && fallback.length
    ? [...new Set(fallback.map(Number).filter((n) => Number.isFinite(n) && n > 0))]
    : DEFAULTS.reviewIntervals.slice()
  const out = []
  for (const part of String(text == null ? '' : text).split(/[,，、\s]+/)) {
    if (!part) continue
    const n = Math.round(Number(part))
    if (Number.isFinite(n) && n >= 1 && n <= 365 && !out.includes(n)) out.push(n)
    if (out.length >= 12) break
  }
  return out.length ? out : (fb.length ? fb : DEFAULTS.reviewIntervals.slice())
}

/* 数组 → 输入框里的文本（用半角逗号，能原样再被 parseIntervals 吃回去） */
export function formatIntervals(list) {
  const arr = Array.isArray(list) ? list.map(Number).filter((n) => Number.isFinite(n) && n > 0) : []
  return arr.join(',')
}

/* 数字输入框：取整并钳到 [min, max]；解析不出来 → fallback（= 原值，等于"没改"） */
export function intInRange(text, fallback, min, max) {
  const n = Math.round(Number(text))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/* 一段音频实际要连放几遍（会话内重复）：
   本条 repeat_times 优先；null / 非法 → 跟随全局设置；全局也没有 → 1（宁可少放，不凭空多放）。
   注意 clampRepeatTimes 会把非法值兜成默认 3，所以这里先自己判合法再交给它。 */
export function repeatTimesOf(clip, settings) {
  const own = Number(clip && clip.repeat_times)
  if (Number.isFinite(own) && own > 0) return clampRepeatTimes(own)
  const g = Number(settings && settings.repeatTimes)
  if (Number.isFinite(g) && g > 0) return clampRepeatTimes(g)
  return 1
}

/* 会话内重复的轮次推进（纯函数，好单测）：
   round 从 1 开始；返回 0 表示「这一遍就是最后一遍，该停了」，否则返回下一轮。
   播放层拿到 0 就停，拿到 n 就再放一遍第 n 遍。 */
export function nextPlayRound(round, total) {
  const r = Math.max(0, Math.round(Number(round) || 0))
  const t = Math.max(1, Math.round(Number(total) || 1))
  return r >= t ? 0 : r + 1
}

/* ------------------------------------------------------------------
   小工具（纯函数，全部可单测）
   ------------------------------------------------------------------ */
export function isDateStr(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
}
export function isTimeStr(s) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(s || ''))
  if (!m) return false
  return Number(m[1]) <= 23 && Number(m[2]) <= 59
}
/* 'HH:mm' → 分钟数；非法返回 -1 */
export function minOf(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''))
  if (!m) return -1
  const h = Number(m[1]); const mi = Number(m[2])
  if (h > 23 || mi > 59) return -1
  return h * 60 + mi
}
/* 分钟数 → 'HH:mm'（跨天归零） */
export function hhmm(min) {
  const m = ((Math.round(Number(min)) % 1440) + 1440) % 1440
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
}
/* 本地日期键 YYYY-MM-DD（不走 toISOString，避免时区把日期推错一天） */
export function dateKeyOf(d) {
  const x = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(x.getTime())) return ''
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')
}
export function todayKey(now = new Date()) {
  return dateKeyOf(now)
}
/* 日期键 + n 天 → 日期键 */
export function addDaysKey(baseKey, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(baseKey || ''))
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  d.setDate(d.getDate() + Math.round(Number(n) || 0))
  return dateKeyOf(d)
}
/* 日期键比较：a<b 返回负、相等 0、a>b 正；非法一律当"无穷大"（排最后） */
export function compareDateKey(a, b) {
  const ok = isDateStr(a); const ok2 = isDateStr(b)
  if (!ok && !ok2) return 0
  if (!ok) return 1
  if (!ok2) return -1
  return a < b ? -1 : a > b ? 1 : 0
}
/* 秒 → 'M:SS'（列表显示用） */
export function fmtSeconds(sec) {
  const s = Math.round(Number(sec))
  if (!Number.isFinite(s) || s <= 0) return '—'
  const m = Math.floor(s / 60)
  return m + ':' + String(s % 60).padStart(2, '0')
}

/* 扩展名 → MIME。落盘读回来的字节是「裸数据」，Blob 要带类型才让 <audio> 认
   （不带类型时 Android WebView 会直接判成「不支持的源」）。
   认不出的扩展名回落到 audio/mpeg：比空类型强，HTTP/媒体栈至少不会当场拒绝。 */
const AUDIO_MIME = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
  amr: 'audio/amr',
  '3gp': 'audio/3gpp',
}
export function audioMimeOf(fileName) {
  const ext = String(fileName || '').split('.').pop().toLowerCase()
  return AUDIO_MIME[ext] || 'audio/mpeg'
}

/* ------------------------------------------------------------------
   数据形状 / 校验（§3.5 字段表）
   ------------------------------------------------------------------ */
export function newClipId() {
  return 'lis_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/* 归一一条音频记录；返回 null = 非法（缺 name 或 file） */
export function sanitizeClip(c) {
  if (!c || typeof c !== 'object') return null
  const name = String(c.name || '').trim()
  const file = String(c.file || '').trim()
  if (!name || !file) return null
  const createdAt = String(c.created_at || '')
  return {
    id: String(c.id || newClipId()),
    name,
    file,
    seconds: Number.isFinite(Number(c.seconds)) && Number(c.seconds) > 0 ? Math.round(Number(c.seconds)) : null,
    played_count: Number.isFinite(Number(c.played_count)) ? Math.max(0, Math.round(Number(c.played_count))) : 0,
    last_played_at: c.last_played_at ? String(c.last_played_at) : null,
    /* review_stage：0 = 刚导入还没学；1..N = 已完成的复习档位数 */
    review_stage: Number.isFinite(Number(c.review_stage)) ? Math.max(0, Math.round(Number(c.review_stage))) : 0,
    next_due_date: isDateStr(c.next_due_date) ? String(c.next_due_date) : null,
    /* null = 跟随全局 repeatTimes */
    repeat_times: c.repeat_times === null || c.repeat_times === undefined
      ? null
      : clampRepeatTimes(c.repeat_times),
    archived: !!c.archived,
    created_at: createdAt || new Date().toISOString(),
  }
}

export function newClip({ name, file, seconds = null, repeat_times = null, created_at = new Date().toISOString() } = {}) {
  /* 新导入的音频当天就算「首次学习」：next_due_date 设为导入当天 → 当天即出现在待复习里。
     点一次「已听」后 stage 0→1、按 reviewIntervals[0] 顺延，才进入跨天复习。 */
  const created = String(created_at)
  const base = created.slice(0, 10)
  return sanitizeClip({
    id: newClipId(),
    name,
    file,
    seconds,
    played_count: 0,
    last_played_at: null,
    review_stage: 0,
    next_due_date: isDateStr(base) ? base : todayKey(),
    repeat_times,
    archived: false,
    created_at: created || new Date().toISOString(),
  })
}

/* 从文件名推显示名：去掉扩展名、去掉路径前缀（导入时的默认名，用户可改） */
export function clipNameFromFile(fileName) {
  const base = String(fileName || '').split(/[\\/]/).pop() || ''
  return base.replace(/\.[^.]+$/, '').trim()
}

/* 导入建记录（Step 4）：file 存**文件名**，路径前缀（listen/）在第 5 步播放解析时再拼。
   已存在的同名 file 直接返回原记录，不重复导入（幂等）。返回 { clip, added }。 */
export function newClipFromImport({ fileName, seconds = null, createdAt = new Date().toISOString() } = {}, existing = []) {
  const name = clipNameFromFile(fileName)
  const file = String(fileName || '').split(/[\\/]/).pop()
  const dup = (Array.isArray(existing) ? existing : []).find((c) => c && c.file === file)
  if (dup) return { clip: dup, added: false }
  return { clip: newClip({ name, file, seconds, created_at: createdAt }), added: true }
}

/* 读音频时长（秒）。浏览器/WebView 用 <audio> 的 loadedmetadata 探；失败或 3 秒超时返回 null
   （null 是合法值：§3.5 允许"读不到时长"，界面显示「—」，估算时回落到 defaultClipSeconds）。 */
export function clipDuration(file) {
  return new Promise((resolve) => {
    const A = typeof Audio !== 'undefined' ? Audio : (typeof window !== 'undefined' ? window.Audio : null)
    if (!A || !file) return resolve(null)
    let url = null
    let timer = null
    let audio = null
    const done = (val) => {
      if (timer) clearTimeout(timer)
      if (audio) { try { audio.src = '' } catch { /* 忽略 */ } }
      if (url) { try { URL.revokeObjectURL(url) } catch { /* 忽略 */ } }
      resolve(val)
    }
    try {
      url = URL.createObjectURL(file)
      audio = new A()
      audio.preload = 'metadata'
      audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null)
      audio.onerror = () => done(null)
      timer = setTimeout(() => done(null), 3000)
      audio.src = url
    } catch {
      done(null)
    }
  })
}

/* 归一设置；缺字段一律补 DEFAULTS（老数据升级方案：不删字段、只补默认值） */export function sanitizeSettings(s) {
  const o = s && typeof s === 'object' ? s : {}
  const iv = Array.isArray(o.reviewIntervals)
    ? o.reviewIntervals.map(Number).filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.round(n))
    : []
  return {
    /* 到点提醒默认**开**（2026-10-03 用户真机反馈"手机通知栏没通知"——
       功能就是提醒，默认关着等于坏了；不想被打扰的人自己关掉即可）。 */
    enabled: o.enabled === undefined ? true : !!o.enabled,
    repeatTimes: clampRepeatTimes(o.repeatTimes === undefined ? DEFAULTS.repeatTimes : o.repeatTimes),
    reviewIntervals: iv.length ? iv : DEFAULTS.reviewIntervals.slice(),
    dndStart: isTimeStr(o.dndStart) ? String(o.dndStart) : DEFAULTS.dndStart,
    dndEnd: isTimeStr(o.dndEnd) ? String(o.dndEnd) : DEFAULTS.dndEnd,
    shortGapMaxMin: Number.isFinite(Number(o.shortGapMaxMin)) && Number(o.shortGapMaxMin) > 0
      ? Math.round(Number(o.shortGapMaxMin)) : DEFAULTS.shortGapMaxMin,
    slotMinMin: Number.isFinite(Number(o.slotMinMin)) && Number(o.slotMinMin) > 0
      ? Math.round(Number(o.slotMinMin)) : DEFAULTS.slotMinMin,
  }
}

/* ------------------------------------------------------------------
   localStorage 读写（唯一出口；测试可传 fake storage）
   ------------------------------------------------------------------ */
function storage(st) {
  if (st) return st
  /* node 单测环境没有 localStorage，用 typeof 保护，免得模块加载/调用直接抛 */
  if (typeof localStorage === 'undefined') return null
  return localStorage
}

export function loadClips(st) {
  const s = storage(st)
  if (!s) return []
  let raw = []
  try {
    raw = JSON.parse(s.getItem(LISTEN_KEY) || '[]')
  } catch {
    return [] // 解析失败返回空表，不抛（同 store.js 的容错口径）
  }
  if (!Array.isArray(raw)) return []
  return raw.map(sanitizeClip).filter(Boolean)
}

export function saveClips(list, st) {
  const s = storage(st)
  const clean = (Array.isArray(list) ? list : []).map(sanitizeClip).filter(Boolean)
  if (s) s.setItem(LISTEN_KEY, JSON.stringify(clean))
  return clean
}

export function loadSettings(st) {
  const s = storage(st)
  if (!s) return sanitizeSettings(null)
  try {
    return sanitizeSettings(JSON.parse(s.getItem(LISTEN_SET_KEY) || 'null'))
  } catch {
    return sanitizeSettings(null)
  }
}

export function saveSettings(patch, st) {
  const next = sanitizeSettings({ ...loadSettings(st), ...(patch || {}) })
  const s = storage(st)
  if (s) s.setItem(LISTEN_SET_KEY, JSON.stringify(next))
  return next
}

/* ------------------------------------------------------------------
   艾宾浩斯复习调度（以日期判定）
   ------------------------------------------------------------------ */
/* 某一档复习完成日 → 下一档该复习的日期；档位用满返回 null（= 已学完）。
   下标口径：stage = **已完成的档位数**，所以完成第 1 档后要用 intervals[0]（第 1 个间隔），
   即 list[stage - 1]；stage 为 0（还没学）时不该调用此函数。 */
export function nextDueDate(clipStage, intervals, fromDateKey) {
  const list = Array.isArray(intervals) && intervals.length ? intervals : DEFAULTS.reviewIntervals
  const stage = Math.max(0, Math.round(Number(clipStage) || 0))
  if (stage < 1 || stage > list.length) return null
  return addDaysKey(fromDateKey, list[stage - 1])
}

/* 点「已听」：唯一入口推进 played_count / review_stage / next_due_date。
   played_count = 已听次数（每次确认 +1）；
   review_stage = 已完成的复习档位数（3 月 1 日确认后 → 1，表示第 1 档已过）。 */
export function reviewAdvance(clip, { fromDateKey, intervals } = {}) {
  const c = sanitizeClip(clip)
  if (!c) return null
  const stage = c.review_stage + 1
  const base = isDateStr(fromDateKey) ? fromDateKey : todayKey()
  return {
    ...c,
    played_count: c.played_count + 1,
    last_played_at: new Date().toISOString(),
    review_stage: stage,
    next_due_date: nextDueDate(stage, intervals, base),
  }
}

/* 还没到复习日就听了（提前听/已学完）→ 只记「听了一次」，不动复习排期。
   免得提前听几次就把艾宾浩斯的档位一路推到底，节奏被打乱。
   2026-10-03 用户决策：去掉手工「已听」按钮，改为放满设定遍数自动记账，故与 reviewAdvance 并列。 */
export function countPlayed(clip) {
  const c = sanitizeClip(clip)
  if (!c) return null
  return {
    ...c,
    played_count: c.played_count + 1,
    last_played_at: new Date().toISOString(),
  }
}

/* 今天该复习的几段：next_due_date ≤ 今天、未归档。按到期日 → 名称排序（越拖越靠前） */
export function dueClips(clips, today = todayKey()) {
  const t = isDateStr(today) ? today : todayKey()
  return (Array.isArray(clips) ? clips : [])
    .filter((c) => c && !c.archived && isDateStr(c.next_due_date) && compareDateKey(c.next_due_date, t) <= 0)
    .sort((a, b) => compareDateKey(a.next_due_date, b.next_due_date) || String(a.name).localeCompare(String(b.name)))
}

/* ------------------------------------------------------------------
   空闲槽（与日程取交集：给 items 直接喂 notify.js 的 buildScheduleItems 输出）
   ------------------------------------------------------------------ */
/* items: [{ at: Date, title }]，startMin/endMin 是"当天分钟数"；不带 mins 的项忽略 */
function itemMinutes(it) {
  const at = it && it.at instanceof Date ? it.at : new Date(it && it.at)
  if (Number.isNaN(at.getTime())) return null
  const mins = Number(it && it.mins)
  if (!Number.isFinite(mins) || mins <= 0) return null
  return { start: at.getHours() * 60 + at.getMinutes(), mins, title: String(it.title || '日程') }
}

/* 排程项 + 时长 → 归一成 [{start, mins, title}]（按开始时间排序）。
   notify.js 的 buildScheduleItems() 输出的是 { key, at, title, body }，**不带时长**——
   所以调用方要传 durationOf(item) 把时长补上（内部只有 at 时无法反推 end）。 */
export function toBusy(items, durationOf) {
  return (Array.isArray(items) ? items : [])
    .map((it) => {
      const mins = typeof durationOf === 'function' ? Number(durationOf(it)) : Number(it && it.mins)
      return itemMinutes({ ...(it || {}), mins })
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)
}

/* 可听作息区间 = 勿扰窗口的补集（2026-10-04 用户决策：不再硬编码 08:00–22:00）。
   默认勿扰 23:00–07:00 是「跨零点」的作息边界 → 可听区间 07:00–23:00，
   早 07:00–08:00 与晚 22:00–23:00 的碎片时间终于能排上练耳提醒。
   同日勿扰（午休 13:00–14:00、或验收里的 07:00–09:00）只表示「这一小段别吵」，
   不是作息边界 → 仍用 08:00–22:00，落进勿扰的空档交给 buildListenNotices 顺延兜住。 */
export function awakeWindow(settings) {
  const cfg = sanitizeSettings(settings)
  const a = minOf(cfg.dndStart)
  const b = minOf(cfg.dndEnd)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= b) return { dayFrom: 8 * 60, dayTo: 22 * 60 }
  return { dayFrom: b, dayTo: a }
}

/* 相邻日程之间 ≥ slotMinMin 的空档。不传 dayFrom/dayTo 时用 awakeWindow() 推出来的作息区间。 */
export function freeSlots(items, settings, { dayFrom, dayTo, durationOf } = {}) {
  const cfg = sanitizeSettings(settings)
  const win = awakeWindow(cfg)
  const from = Number.isFinite(Number(dayFrom)) ? Number(dayFrom) : win.dayFrom
  const to = Number.isFinite(Number(dayTo)) ? Number(dayTo) : win.dayTo
  const busy = toBusy(items, durationOf)

  const slots = []
  let cursor = from
  for (const b of busy) {
    const gap = b.start - cursor
    if (gap >= cfg.slotMinMin) slots.push({ start: cursor, end: b.start, mins: gap })
    cursor = Math.max(cursor, b.start + b.mins)
  }
  if (to - cursor >= cfg.slotMinMin) slots.push({ start: cursor, end: to, mins: to - cursor })
  return slots
}

/* 空闲槽 → "可放 N 段"（N = ⌊槽长 ÷ 段长⌋；未知时长用 defaultClipSeconds 估算） */
export function slotPlan(slots, clipSeconds, settings) {
  const cfg = sanitizeSettings(settings)
  const sec = Number.isFinite(Number(clipSeconds)) && Number(clipSeconds) > 0
    ? Math.round(Number(clipSeconds)) : DEFAULTS.defaultClipSeconds
  return (Array.isArray(slots) ? slots : []).map((s) => {
    const n = Math.max(0, Math.floor(Number(s.mins) / (sec / 60)))
    return {
      start: hhmm(s.start),
      end: hhmm(s.end),
      mins: Number(s.mins),
      kind: Number(s.mins) <= cfg.shortGapMaxMin ? 'short' : 'long',
      count: n,
    }
  })
}

/* 建议时段 = 空闲槽 ∩ 今天到期的音频（长槽可多段）。items 走 notify.js 的排程项形态，
   durationOf 把时长补上（见 toBusy 的说明）。 */
export function buildListenItems({ items = [], clips = [], settings, today = todayKey(), now = new Date(), durationOf } = {}) {
  const cfg = sanitizeSettings(settings)
  const due = dueClips(clips, today)
  const sec = due.length
    ? due.reduce((m, c) => Math.min(m, Number.isFinite(Number(c.seconds)) && Number(c.seconds) > 0 ? Number(c.seconds) : DEFAULTS.defaultClipSeconds), Infinity)
    : DEFAULTS.defaultClipSeconds
  const slots = freeSlots(items, cfg, { durationOf }).filter((s) => {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(s.end / 60), s.end % 60, 0, 0)
    return end.getTime() > now.getTime() // 已过去的时点不排
  })
  const plan = slotPlan(slots, sec, cfg)
  /* 段数按"可用槽位"从前往后分配，不多给 */
  let budget = due.length
  const suggestions = []
  for (const p of plan) {
    if (budget <= 0) break
    const take = Math.min(p.count, budget)
    if (take <= 0) continue
    suggestions.push({ ...p, take })
    budget -= take
  }
  return { due, suggestions, remaining: budget }
}

/* ------------------------------------------------------------------
   复习提醒排程（四期 L3/L4）：未来 N 天，每天最多一条合并通知
   ------------------------------------------------------------------ */
/* 勿扰时段（当天分钟数）。**支持跨零点**：start > end 表示跨到第二天早上。 */
export function dndOf(settings) {
  const cfg = sanitizeSettings(settings)
  const s = minOf(cfg.dndStart)
  const e = minOf(cfg.dndEnd)
  return { start: s < 0 ? 23 * 60 : s, end: e < 0 ? 7 * 60 : e }
}

/* 某个时刻（当天分钟数）是否落在勿扰时段内。起止相同 = 不设勿扰。 */
export function inDndMin(min, settings) {
  const d = dndOf(settings)
  const m = Number(min)
  if (!Number.isFinite(m) || d.start === d.end) return false
  if (d.start < d.end) return m >= d.start && m < d.end
  return m >= d.start || m < d.end // 跨零点
}

/* 未来 horizonDays 天，每天一条「今天有 N 段待复习」的合并提醒。
   - 时刻取当天第一个"放得下至少 1 段"的空档起点；整天排满 → 当天不排（打扰也没用）。
   - 落在勿扰时段：若当天勿扰结束时刻更晚 → 顺延到结束；跨零点（结束早于开始）→ 跳过当天。
   - 今天已经过去的时刻不排。
   itemsOfDay(dayKey) 由调用方提供（App 里现算 notify.js 的 buildScheduleItems），
   纯函数不碰插件/存储，node 单测可喂假数据。 */
export function buildListenNotices({ clips = [], settings, now = new Date(), horizonDays = 7, itemsOfDay = null, durationOf } = {}) {
  const cfg = sanitizeSettings(settings)
  const out = []
  const today = todayKey(now)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const days = Math.max(0, Math.round(Number(horizonDays) || 0))
  const secOf = (c) => (Number.isFinite(Number(c.seconds)) && Number(c.seconds) > 0 ? Number(c.seconds) : DEFAULTS.defaultClipSeconds)

  for (let i = 0; i < days; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    const dKey = addDaysKey(today, i)
    const due = dueClips(clips, dKey)
    if (!due.length) continue

    const sec = due.reduce((m, c) => Math.min(m, secOf(c)), Infinity)
    const slots = freeSlots(typeof itemsOfDay === 'function' ? itemsOfDay(dKey) : [], cfg, { durationOf })
    let at = null
    for (const s of slots) {
      if (dKey === today && Number(s.start) <= nowMin) continue // 今天已经过去的空档不再提醒
      if (Math.floor(Number(s.mins) / (sec / 60)) >= 1) { at = s.start; break } // 第一个放得下的空档
    }
    if (at === null) continue

    if (inDndMin(at, cfg)) {
      const d = dndOf(cfg)
      if (d.end > at) at = d.end // 同一天里更晚 → 顺延到勿扰结束
      else continue // 跨零点：顺延会跑到第二天早上，当天放弃
    }
    if (dKey === today && at <= nowMin) continue // 已经过去的时刻不排

    const totalMin = Math.max(1, Math.round(due.reduce((s, c) => s + secOf(c), 0) / 60))
    out.push({
      key: 'l_' + dKey,
      at: new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(at / 60), at % 60, 0, 0),
      title: '碎片练耳',
      body: `今天有 ${due.length} 段待复习（约 ${totalMin} 分钟）· 挑空档去听`,
      count: due.length,
    })
  }
  return out
}
