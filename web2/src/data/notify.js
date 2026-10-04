/* web2 通知能力出口（二期 M5）——课前提醒 + 完成通知
   能力口径同 recorder.js：只有 App 平台能用。LocalNotifications 是官方 npm 插件
   （App 工程 @capacitor/local-notifications@7，cap sync 自动注册进 WebView，
   window.Capacitor.Plugins.LocalNotifications 直接可用），浏览器没有该插件
   → 所有出口安全降级（返回 unsupported），绝不抛。

   结构：
   - buildScheduleItems：纯函数——展开未来 7 天「每节课 / 每个独立日程」的课前提醒
     时间点（课程按 weekday + week_rule + 学期周次，日程按具体日期）。
     不碰插件、不碰 localStorage，node 单测友好。
   - applySchedule：幂等重排——先 cancel 本应用排过的（extra.src 标记）再排新的。
   - notifyDone：转写/纪要完成通知（App 在前台 document.hidden=false 时不发，避免打扰）。
   - testNotify：设置区「发一条测试通知」（带「开始录音」按钮，5 秒后弹出，真机验收用）。
   - ensureNotifyEnv：建两个通知渠道（课前提醒=高优先级会响会弹横幅；完成通知=默认级）
     + 注册 action 按钮 + 请求通知权限。

   插件行为已核对（@capacitor/local-notifications 7.x 源码）：
   - Android 12+ 无精确闹钟权限时自动降级 setAndAllowWhileIdle（可能差几分钟，可接受）
   - 重启后由插件自带 RestoreReceiver 自动恢复排程
   - 点通知本体 / action 按钮都会打开 App 并 fire localNotificationActionPerformed 事件

   设置存 web2.notify（本机，不进导出——通知能力是设备相关的，口径同 web2.llm）。 */

import { currentWeekNo, minOf } from './store.js'

export const NOTIFY_KEY = 'web2.notify'
const NOTIFY_DEFAULTS = { enabled: true, minutesBefore: 10 }
const SCHEDULE_TAG = 'web2-m5' // 课前提醒排程的 extra.src 标记（重排时识别自己的）
export const LISTEN_TAG = 'web2-listen' // 练耳复习提醒自己的标记——**必须与课前提醒分开**：重排只清自己这一批
export const LISTEN_CHANNEL = 'listen-reminder' // 练耳复习提醒的独立渠道
const HORIZON_DAYS = 7 // 只排未来 7 天，App 启动/变动时重排即可覆盖
const MAX_SCHEDULE = 64 // 单次排程上限（7 天 × 每天最多 8 节 ≈ 56，64 是保险线）

/* ---------- 设置（本机） ---------- */

export function loadNotifySettings() {
  let s = {}
  try {
    s = JSON.parse(localStorage.getItem(NOTIFY_KEY) || '{}') || {}
  } catch {
    s = {}
  }
  const mb = Number(s.minutesBefore)
  return {
    enabled: s.enabled !== false, // 缺省 = 开（设置里随时可关）
    minutesBefore: mb >= 0 && mb <= 59 ? Math.floor(mb) : NOTIFY_DEFAULTS.minutesBefore,
  }
}

export function saveNotifySettings(patch) {
  const next = { ...loadNotifySettings(), ...patch }
  localStorage.setItem(NOTIFY_KEY, JSON.stringify(next))
  return next
}

/* ---------- 插件探测 ---------- */

function plugin() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null
  const p = cap && cap.Plugins ? cap.Plugins : null
  return (p && p.LocalNotifications) || null
}

export function notifyAvailable() {
  return !!plugin()
}

/* ---------- 精确提醒（Android 12+ 的 SCHEDULE_EXACT_ALARM） ----------
   Android 12 起，没拿到这个特殊权限的应用只能用「非精确闹钟」：系统给一个最多 1 小时的
   浮动窗口（2026-10-03 真机实测 `dumpsys alarm` 里每条都是 window=+1h0m0s0ms），
   到点可能晚很久。这两个方法只有 Android 原生端提供（浏览器/老系统没有 → supported:false，
   整块提示不出现），所以要「探测能力」而不是写死平台。 */
export async function exactAlarmState() {
  const p = plugin()
  if (!p || typeof p.checkExactNotificationSetting !== 'function') return { supported: false, allowed: null }
  try {
    const st = await p.checkExactNotificationSetting()
    return { supported: true, allowed: !!(st && st.exact_alarm === 'granted') }
  } catch {
    return { supported: false, allowed: null }
  }
}

/* 跳到系统那页开关。注意：用户改完这个开关，系统会重启本应用，且已排的精确闹钟会被清掉
   （插件文档），所以调用方拿到 ok 之后必须重排一次提醒。 */
export async function askExactAlarm() {
  const p = plugin()
  if (!p || typeof p.changeExactNotificationSetting !== 'function') return { ok: false, unsupported: true }
  try {
    const st = await p.changeExactNotificationSetting()
    return { ok: !!(st && st.exact_alarm === 'granted'), exact: st ? st.exact_alarm : null }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

/* ---------- 环境准备（渠道 / action / 权限），幂等 ---------- */

let envReady = false
export async function ensureNotifyEnv() {
  const p = plugin()
  if (!p) return { available: false }
  let granted = null
  try {
    // importance：4 = HIGH（响 + 弹横幅），3 = DEFAULT（响、不弹横幅）；渠道已存在时是 no-op
    await p.createChannel({ id: 'class-reminder', name: '课前提醒', importance: 4 })
    await p.createChannel({ id: 'task-done', name: '完成通知', importance: 3 })
    // 练耳复习提醒：与课前提醒同级（要响、要弹横幅），安静时段由练耳自己的勿扰时段兜
    await p.createChannel({ id: LISTEN_CHANNEL, name: '练耳复习提醒', importance: 4 })
    await p.registerActionTypes({
      types: [{ id: 'class-reminder', actions: [{ id: 'START_REC', title: '开始录音' }] }],
    })
  } catch {
    /* 渠道/action 注册失败不拦住排程（老系统没有渠道概念也能收） */
  }
  try {
    const st = await p.checkPermissions()
    if (st && st.display === 'granted') granted = true
    else {
      const r = await p.requestPermissions()
      granted = !!(r && r.display === 'granted')
    }
  } catch {
    granted = null // 老系统无权限概念，当作未知，不拦
  }
  envReady = true
  return { available: true, granted }
}

export function isEnvReady() {
  return envReady
}

/* ---------- 排程展开（纯函数） ---------- */

function pad(n) {
  return String(n).padStart(2, '0')
}
function dateKeyOf(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

/* 通知 id 用 key 的 FNV-1a 哈希压成 32 位 int（schedule 的 id 必须是数字）。
   同一 key 永远同一 id：重排时 cancel/schedule 自然对得上。 */
function hashId(key) {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 2000000000
}

/* 展开 future horizonDays 天（含今天）里每个需要提醒的时刻。
   - 课程：weekday 对得上 + 周次在学期内 + week_rule 匹配（无学期信息时 odd/even 无法判断，跳过）
   - 循环日程：weekday 对得上 + week_rule 匹配。**不做学期边界过滤**——循环日程的
     定义就是「跨学期常驻」（口径同 todayCourses / ics.js 的 routine 展开），
     放假期间也在。无学期信息时 odd/even 同样无法判断，跳过。
   - 独立日程：date 精确匹配
   - 已过去的时刻不排；提前量把时刻推到当天 0 点前的整条跳过（罕见，避免排到昨天） */
export function buildScheduleItems({ courses = [], events = [], routines = [], semester = null, settings, now = new Date(), horizonDays = HORIZON_DAYS }) {
  const lead = Math.max(0, Math.floor(Number(settings.minutesBefore) || 0))
  const leadLabel = lead > 0 ? lead + ' 分钟后开始' : '现在开始'
  const out = []
  const hasTerm = !!(semester && semester.firstMonday && Number(semester.totalWeeks) >= 1)

  for (let d = 0; d <= horizonDays; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d)
    const dKey = dateKeyOf(day)
    const weekday = ((day.getDay() + 6) % 7) + 1 // 周一=1 … 周日=7
    // 当天在学期里的周次（无 firstMonday 时为 null）
    const weekNo = hasTerm ? currentWeekNo(semester.firstMonday, day) : null

    for (const c of courses) {
      if (!c || c.type !== 'course') continue
      if (Number(c.weekday) !== weekday) continue
      if (weekNo === null) {
        if ((c.week_rule || 'every') !== 'every') continue // 无法判断单双周 → 不排
      } else {
        if (weekNo < 1 || weekNo > Number(semester.totalWeeks)) continue // 放假/未开学
        if (!matchWeekRule(c.week_rule, weekNo)) continue
      }
      const item = makeItem('c', c.id, dKey, day, c.start, lead, leadLabel, c.name, c.place, c.end)
      if (item) out.push(item)
    }

    /* 循环日程：与课程同一套周次规则，但不受学期起止约束（跨学期常驻）。
       kind 用 'r' 前缀，与课程的 'c' 区分——两套 id 空间各自独立（课程的 uuid
       与 routine 的 uuid 可能撞号），key 必须能分开。 */
    for (const r of routines) {
      if (!r || r.type !== 'routine') continue
      if (Number(r.weekday) !== weekday) continue
      if (weekNo === null) {
        if ((r.week_rule || 'every') !== 'every') continue // 无法判断单双周 → 不排
      } else if (!matchWeekRule(r.week_rule, weekNo)) {
        continue
      }
      const item = makeItem('r', r.id, dKey, day, r.start, lead, leadLabel, r.name, r.place, r.end)
      if (item) out.push(item)
    }

    for (const e of events) {
      if (!e || e.type !== 'event') continue
      if (String(e.date) !== dKey) continue
      const item = makeItem('e', e.id, dKey, day, e.start, lead, leadLabel, e.name, e.place, e.end)
      if (item) out.push(item)
    }
  }
  out.sort((a, b) => a.at - b.at)
  return out.filter((it) => it.at > now)
}

function matchWeekRule(rule, weekNo) {
  const r = rule || 'every'
  if (r === 'every') return true
  if (r === 'odd') return weekNo % 2 === 1
  if (r === 'even') return weekNo % 2 === 0
  return false
}

/* 生成一条提醒（时刻 = 当天 start - lead 分钟；跨到前一天或时刻无效则返回 null）。
   顺带带上 start / end（当天 HH:mm）：空闲槽要用真实起止算，
   不能拿被提前量挪过的 at 当起点——练耳 L2/L4 靠它算空档。 */
function makeItem(kind, id, dKey, day, start, lead, leadLabel, name, place, end) {
  if (!start || !/^\d{1,2}:\d{2}/.test(String(start))) return null
  const total = minOf(String(start)) - lead
  if (total < 0) return null
  const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(total / 60), total % 60, 0, 0)
  const key = kind + '_' + String(id) + '_' + dKey
  const body = leadLabel + (place ? ' · ' + place : '')
  return { key, at, title: String(name || '日程'), body, start: String(start), end: end ? String(end) : '' }
}

/* ---------- 排程（幂等重排） ---------- */

/* opts 让不同功能各排各的（缺省 = 课前提醒那一套，旧调用一个字不用改）：
   - src：extra.src 标记。**重排只清自己这个标记的**——否则练耳一重排会把课前提醒全删掉。
   - channelId / actionTypeId：渠道与按钮类型；`actionTypeId: null` = 通知不带按钮
     （练耳就是这种：点通知只回 App，**不自动播放**）。
   - enabled：开关。缺省沿用课前提醒的设置。 */
export async function applySchedule(items, opts = {}) {
  const p = plugin()
  if (!p || typeof p.schedule !== 'function') return { ok: false, unsupported: true }
  const src = opts.src || SCHEDULE_TAG
  const channelId = opts.channelId || 'class-reminder'
  const actionTypeId = opts.actionTypeId === undefined ? 'class-reminder' : opts.actionTypeId
  const enabled = opts.enabled === undefined ? loadNotifySettings().enabled : !!opts.enabled
  // 先清掉自己排过的（不管开关状态——关掉开关 = 清空）
  try {
    const pending = await p.getPending()
    const mine = (pending.notifications || []).filter((n) => n.extra && n.extra.src === src)
    if (mine.length) await p.cancel({ notifications: mine.map((n) => ({ id: n.id })) })
  } catch {
    /* 取不到 pending 就只管排新的，不失败 */
  }
  if (!enabled) return { ok: true, scheduled: 0, cancelled: true }
  const notifications = items
    .slice(0, MAX_SCHEDULE)
    .map((it) => {
      const n = {
        id: hashId(it.key),
        title: it.title,
        body: it.body,
        schedule: { at: it.at, allowWhileIdle: true }, // 无精确闹钟权限时插件自动降级
        channelId,
        extra: { src, key: it.key },
      }
      if (actionTypeId) n.actionTypeId = actionTypeId // 不带按钮时整个字段都不写
      return n
    })
  if (!notifications.length) return { ok: true, scheduled: 0 }
  try {
    await p.schedule({ notifications })
    return { ok: true, scheduled: notifications.length }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

/* ---------- 完成通知（转写/纪要） ---------- */

/* App 在前台时不发（document.hidden=false）——用户正看着呢，就地提示已足够 */
export async function notifyDone(title, body) {
  const p = plugin()
  if (!p || typeof p.schedule !== 'function') return { ok: false, unsupported: true }
  if (typeof document !== 'undefined' && !document.hidden) return { ok: false, skipped: true }
  try {
    await p.schedule({
      notifications: [{ id: Date.now() % 2000000000, title, body, channelId: 'task-done' }],
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

/* ---------- 测试通知（设置区按钮）：5 秒后弹出，带「开始录音」按钮 ---------- */

export async function testNotify() {
  const p = plugin()
  if (!p || typeof p.schedule !== 'function') return { ok: false, unsupported: true }
  try {
    await p.schedule({
      notifications: [
        {
          id: hashId('test-' + Date.now()),
          title: '测试提醒',
          body: '这是一条课前提醒的样子。点「开始录音」可直接开录。',
          schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true },
          channelId: 'class-reminder',
          actionTypeId: 'class-reminder',
          extra: { src: SCHEDULE_TAG, test: true },
        },
      ],
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

/* ---------- action / 点击事件（通知 → 回 App → 自动开录） ---------- */

/* 返回解绑函数。actionId：'START_REC' = 按了「开始录音」按钮；'tap' = 点了通知本体。 */
export function onNotificationAction(cb) {
  const p = plugin()
  if (!p || typeof p.addListener !== 'function') return () => {}
  let remove = () => {}
  try {
    const r = p.addListener('localNotificationActionPerformed', (ev) => {
      const actionId = String((ev && ev.actionId) || 'tap')
      const extra = (ev && ev.notification && ev.notification.extra) || {}
      cb({ actionId, extra })
    })
    if (r && typeof r.then === 'function') r.then((h) => { remove = () => { try { h.remove() } catch { /* 已解绑 */ } } })
    else if (r && typeof r.remove === 'function') remove = () => r.remove()
  } catch {
    /* 监听失败不拦其它功能 */
  }
  return () => remove()
}

function errMsg(e) {
  return (e && (e.message || String(e))) || '未知错误'
}
