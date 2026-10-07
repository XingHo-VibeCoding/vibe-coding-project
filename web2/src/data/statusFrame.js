/* 常驻通知栏状态框（Day 19，路线 3：原生前台服务 specialUse）。
 *
 * 分工：
 *  - 网页只管「数据」：把今天剩余安排压成一份**快照 JSON**推给原生（pushFrame）。
 *  - 原生管「呈现与计时」：自己每 30s 重画（剩余分钟数由原生按快照里的 start/end 现算），
 *    网页被冻结/进程被回收都不影响。所以这里**不**需要每分钟推一次。
 *  - 用户在通知栏按的那一枚按钮（开始录音）由原生记成「待领动作」，
 *    网页起来后用 consumeFrameActions() 领走并落地成 App 内的真实动作。
 *    2026-10-07 用户拍板收窄：状态框是**状态显示牌，不是操作台**，
 *    「上完了 / 我去听了 / 结账」三枚已砍（App 内都有入口）。
 *
 * 与 recorder.js / notify.js 同样的降级约定：没有原生插件时一律
 * 返回 {ok:false,unsupported:true}，绝不抛 —— 网页版/浏览器里静默失效。 */

import { todayKey, minOf } from './listen.js'

const FRAME_KEY = 'web2.frame'
const MARKS_KEY = 'web2.frame.marks'

/* 状态框总开关。默认 true：装了 App 就有，不需要用户先去设置里开。
   真机第一次跑时若用户不想要，在「我的 → 设置 → 常驻状态框」里关掉即可。 */
export const FRAME_DEFAULTS = { enabled: true }

export function sanitizeFrameSettings(s) {
  const o = s && typeof s === 'object' ? s : {}
  return { enabled: o.enabled === undefined ? true : !!o.enabled }
}
export function loadFrameSettings() {
  try {
    const raw = localStorage.getItem(FRAME_KEY)
    return sanitizeFrameSettings(raw ? JSON.parse(raw) : null)
  } catch {
    return sanitizeFrameSettings(null)
  }
}
export function saveFrameSettings(s) {
  const clean = sanitizeFrameSettings(s)
  try {
    localStorage.setItem(FRAME_KEY, JSON.stringify(clean))
  } catch {
    /* 隐私模式忽略 */
  }
  return clean
}

/* 「今天已经处理过的」记号：以今天为界 —— 日期一变自动作废，不需要清理。
   按钮收窄后（2026-10-07）只剩 listenDone 一个：它由 App 内「放满设定遍数」自动写
   （listenAutoMark），不再由通知栏按钮写。classDone 已随「上完了」按钮一起删掉。 */
export function sanitizeMarks(m) {
  const o = m && typeof m === 'object' ? m : {}
  const day = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : todayKey()
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : [])
  return { date: day, listenDone: arr(o.listenDone) }
}
export function loadFrameMarks() {
  let m
  try {
    const raw = localStorage.getItem(MARKS_KEY)
    m = sanitizeMarks(raw ? JSON.parse(raw) : null)
  } catch {
    m = sanitizeMarks(null)
  }
  if (m.date !== todayKey()) m = sanitizeMarks(null) // 新的一天，昨天的记号作废
  return m
}
function saveFrameMarks(m) {
  const clean = sanitizeMarks(m)
  try {
    localStorage.setItem(MARKS_KEY, JSON.stringify(clean))
  } catch {
    /* 忽略 */
  }
  return clean
}
export function markListenDone(id) {
  const m = loadFrameMarks()
  if (id && m.listenDone.indexOf(id) === -1) m.listenDone.push(id)
  return saveFrameMarks(m)
}
/* P2：撤销今天给这段音频打的「我去听了」记号（记号要看得见、也要撤得回）。
   撤销后它重新进入状态框快照（statusFrame.js:114 那层过滤），也就是「今天再提醒我一次」。
   只动提醒口径：已听次数与复习档位在 listen.js 那边，跟这个记号无关。 */
export function unmarkListenDone(id) {
  const m = loadFrameMarks()
  m.listenDone = m.listenDone.filter((x) => x !== id)
  return saveFrameMarks(m)
}

/* ── 快照 ──────────────────────────────────────────────────────────────
   纯函数（可单测）：把 App 侧的数据压成原生要的那几个字段。
   今天的时间一律转成「当日分钟数」（06:30 → 390），原生自己跟当前时间比。
   kind: c=课程 / r=循环日程 / e=一次性日程；id 用于按钮回传。 */
/* 勿扰时段：'HH:MM' → 当日分钟数（原生用 JSONObject.optInt 读这两个字段，
   字符串会让 Integer.valueOf('07:00') 抛异常、optInt 悄悄回落到它自己的默认值 23:00/07:00，
   于是用户在「练耳设置」里改的勿扰时段根本传不过去）。拿不到就**省掉这个键**——
   省掉 ≠ 0：0 是"00:00 起勿扰"这个有效值，别把它误当无效。 */
function dndMin(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1440) return Math.round(v)
  const m = minOf(v)
  return m >= 0 ? m : null
}

/* P5「甲」场景门：删到只剩「点通知本体去哪儿」一处判断，但**策略只写在这一处**，
   原生只照着画。
   - tapLedger：上网课中点通知 = 回今日页；不在上课且已过 18:00 点通知 = 直接开日精进。
   从 nowMin 推出来，测试跑一次就能锁住。
   （原先还有 canLedger：18:00 前不放「结账」按钮。按钮已砍，这个门随之删除。） */
export const LEDGER_FROM = 18 * 60

/* 场景门要吃两个数：当前时刻与门槛。二者都可能以「分钟数」直接给（网页侧 nowTime 就是数字），
   也可能以 'HH:mm' 给。listen.js 的 minOf 只认字符串（传 1080 会当非法回 -1 —— 真踩过：
   于是那扇门永远 false、按钮白天晚上都不出现），所以这里先认数字再回落字符串。
   拿不到一律 -1，调用方以此为准「不给结论」。 */
function minAny(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1440) return Math.round(v)
  return minOf(v)
}

export function buildFrameSnapshot(input) {
  const s = input && typeof input === 'object' ? input : {}
  const marks = sanitizeMarks(s.marks || null)
  const day = (list) =>
    (Array.isArray(list) ? list : [])
      .map((x) => ({
        kind: x.kind === 'r' || x.kind === 'e' ? x.kind : 'c',
        id: String(x.id == null ? '' : x.id),
        name: String(x.name == null ? '' : x.name),
        place: String(x.place == null ? '' : x.place),
        teacher: String(x.teacher == null ? '' : x.teacher),
        start: minOf(x.start),
        end: minOf(x.end),
      }))
      .filter((x) => x.name && x.start > 0)
      .sort((a, b) => a.start - b.start)
  const listen = (Array.isArray(s.listen) ? s.listen : [])
    .map((x) => ({ id: String(x.id == null ? '' : x.id), name: String(x.name == null ? '' : x.name) }))
    .filter((x) => x.id && x.name && marks.listenDone.indexOf(x.id) === -1)
  const tf = s.tomorrowFirst
  const dndStart = dndMin(s.dndStart)
  const dndEnd = dndMin(s.dndEnd)
  const nowMin = minAny(s.nowMin)
  const ledgerFrom = minAny(s.ledgerFrom)
  /* 上课中？用同一份 today 列表与 nowMin 判断（原生 frameText 也是这么挑 cur 的）：
     上课中点通知本体回今日页；不在上课且已过 18:00 才直接开「日精进」。 */
  const inClass = day(s.today).some((x) => nowMin >= x.start && nowMin < x.end)
  const afterLedger = nowMin >= 0 && ledgerFrom >= 0 && nowMin >= ledgerFrom
  const snap = {
    enabled: s.enabled === undefined ? true : !!s.enabled,
    updatedAt: Date.now(),
    dndStart,
    dndEnd,
    todosDue: Math.max(0, Number(s.todosDue) || 0),
    listen,
    today: day(s.today),
    tomorrowFirst: tf && tf.name ? { name: String(tf.name), start: minOf(tf.start) } : null,
    recTitle: typeof s.recTitle === 'string' ? s.recTitle : '',
    /* 点通知本体去哪儿（原生 tapIntent 照着画）。nowMin 拿不到时不给结论（false）：
       宁可回今日页，也不要在白天莫名其妙弹出「日精进」。 */
    tapLedger: afterLedger && !inClass,
  }
  /* 拿不到就整个删掉这个键，让原生用它的默认值（别留 undefined —— 序列化后是 null，原生一样读不到） */
  if (snap.dndStart === null) delete snap.dndStart
  if (snap.dndEnd === null) delete snap.dndEnd
  return snap
}

/* ── 原生桥 ──────────────────────────────────────────────────────────── */
function plugins() {
  const c = typeof window !== 'undefined' ? window.Capacitor : null
  return c && c.Plugins ? c.Plugins : null
}
function frameSvc() {
  const p = plugins()
  return p ? p.StatusFrame : null
}
const NO = { ok: false, unsupported: true }

/** 有没有状态框能力（真机才有；网页版恒 false，用来决定设置里那行要不要出现） */
export function frameAvailable() {
  return !!frameSvc()
}

/** 推快照。失败一律静默降级，不打扰主流程。 */
export async function pushFrame(snap) {
  const svc = frameSvc()
  if (!svc || !svc.pushSnapshot) return NO
  try {
    const r = await svc.pushSnapshot({ json: JSON.stringify(snap || {}) })
    return { ok: true, running: !!(r && r.running) }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}

export async function setFrameEnabled(enabled) {
  const svc = frameSvc()
  if (!svc || !svc.setEnabled) return NO
  try {
    await svc.setEnabled({ enabled: !!enabled })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}

export async function frameRunning() {
  const svc = frameSvc()
  if (!svc || !svc.isRunning) return NO
  try {
    const r = await svc.isRunning()
    return { ok: true, running: !!(r && r.running), enabled: !!(r && r.enabled) }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}

/** 领走原生记下的按钮动作（取走即清，重复调用不会重复触发）。 */
export async function consumeFrameActions() {
  const svc = frameSvc()
  if (!svc || !svc.consumeActions) return { ok: true, actions: [] }
  try {
    const r = await svc.consumeActions()
    /* 「看起来成功、其实动作被吞」是这里最危险的失败：v1.41.1 真机上原生用了
       JSArray.from(JSONArray)（恒返回 null，put 进去会把 key 整个删掉），于是
       consumeActions 只回一个 {}——动作已被原生取走并清空，网页却什么都没收到。 */
    if (!r || !Array.isArray(r.actions)) return { ok: false, actions: [], error: '原生没回传 actions' }
    return { ok: true, actions: r.actions }
  } catch (e) {
    return { ok: false, actions: [], error: String((e && e.message) || e) }
  }
}

/** 监听原生推来的动作（用户按按钮时若 App 已在跑就会走这条，不用等下次冷启动）。 */
export function onFrameActions(cb) {
  const svc = frameSvc()
  if (!svc || !svc.addListener) return () => {}
  let handle = null
  try {
    handle = svc.addListener('frameActions', (data) => {
      const list = (data && data.actions) || []
      if (Array.isArray(list) && list.length) cb(list)
    })
  } catch {
    return () => {}
  }
  return () => {
    try {
      if (handle && handle.remove) handle.remove()
    } catch {
      /* 忽略 */
    }
  }
}
