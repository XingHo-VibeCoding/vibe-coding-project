/* 反向排课（五条新功能线 01）—— 待办 × 课表：把「要交的事」放进「有空的时候」。
   口径（2026-10-15 立项）：
     - App 同时知道「你有 N 条待办」和「你周三下午空着」，这是全项目最明显一条没接上的线。
       本模块只做这一件事：**把待办和空档对上**，回答「我什么时候写高数作业」。
     - 纯逻辑：不碰 DOM / localStorage / 原生插件。node 单测直接喂假数据（同 periods.js 口径）。
     - **只建议，不落库**：不自动写课表、不发通知、不改任何数据 —— 落不落由用户自己点
       （同 eventParser.js 的纪律）。
     - 待办模型没有「预计用时」字段。**2026-10-15 用户 m24447 拍板：先按默认 30 分钟估**，
       不动 store.js / schema_version（零迁移）。将来真加了字段，这里读 todo.mins 即可，
       算法一个字不用改 —— 所以字段名先留在这里，不做写入。
     - 空档口径复用 listen.js 的 freeSlots()（相邻日程之间 ≥ slotMinMin 的间隙，
       作息区间取勿扰窗口的补集）。**不另算一套**，否则「练耳建议的空档」和
       「排课建议的空档」会各说各话。
     - 不评判：不写「你拖了 N 天」「该努力了」。只呈现「哪件先动、几点有空」。
*/

import { freeSlots, hhmm, todayKey, addDaysKey, compareDateKey } from './listen.js'

/* 一件待办的默认预估时长（分钟）。用户拍板的估值，不是测量值。 */
export const DEFAULT_TODO_MIN = 30
/* 太短的碎片不排（与 listen.js 的 slotMinMin 同量级，但这里更严：
   30 分钟的活放进 10 分钟的空档没意义，仍按「放得下整件」判） */
export const MIN_BLOCK_MIN = 10

/* 一件待办要占多久：优先用自带的 mins（将来加字段时零改动），否则默认 30 分钟。
   非数字 / ≤0 一律回落默认值，绝不返回 NaN 把下游算崩。 */
export function estimateMinutes(todo, fallback = DEFAULT_TODO_MIN) {
  const fb = Number.isFinite(Number(fallback)) && Number(fallback) > 0 ? Math.round(Number(fallback)) : DEFAULT_TODO_MIN
  const v = todo && Number(todo.mins)
  if (!Number.isFinite(v) || v <= 0) return fb
  return Math.max(MIN_BLOCK_MIN, Math.round(v))
}

/* 未完成 + 有截止日的待办，按截止日升序（同一天的按标题稳定排序，避免每次渲染顺序乱跳）。
   没有 due_date 的排最后：排不了期，但仍然可以「有空就做」。 */
export function pendingTodos(todos) {
  return (Array.isArray(todos) ? todos : [])
    .filter((t) => t && !t.done && String(t.title || '').trim())
    .map((t) => ({ id: String(t.id), title: String(t.title).trim(), due_date: String(t.due_date || ''), done: false }))
    .sort((a, b) => {
      const ad = a.due_date || '9999-12-31'
      const bd = b.due_date || '9999-12-31'
      const c = compareDateKey(ad, bd)
      return c !== 0 ? c : a.title.localeCompare(b.title)
    })
}

/* 紧迫度：过期 / 今天 / 明天 / 更远 / 无期。只用于分组与措辞，不参与排序。 */
export function urgencyOf(dueDate, today = todayKey()) {
  const d = String(dueDate || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'none'
  const c = compareDateKey(d, today)
  if (c < 0) return 'overdue'
  if (c === 0) return 'today'
  if (d === addDaysKey(today, 1)) return 'tomorrow'
  return 'later'
}

/* 从一个（可变）空档表里挖出 needMin 分钟；挖不动返回 null。
   槽表元素是 { start, end }（当天分钟数）。挖走的部分从槽里减掉，
   剩下的前半段若仍 ≥ MIN_BLOCK_MIN 会放回表头，保持「从早到晚」的顺序。 */
export function carveSlots(slots, needMin, notBefore) {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    const from = Math.max(s.start, Number(notBefore) || 0)
    if (s.end - from < needMin) continue
    const end = from + needMin
    const rest = []
    if (from - s.start >= MIN_BLOCK_MIN) rest.push({ start: s.start, end: from })
    if (s.end - end >= MIN_BLOCK_MIN) rest.push({ start: end, end: s.end })
    slots.splice(i, 1, ...rest)
    return { start: from, end }
  }
  return null
}

/* 主函数：把待办排进未来 days 天的空档。
   itemsOfDay(dayKey) 由调用方提供（App 里现算 notify.js 的 buildScheduleItems），
   纯函数不碰插件 / 存储，node 单测可喂假数据。

   返回：
     {
       date,                 // 基准日（今天）
       days: [{date, blocks:[]}],   // 有安排的每一天（没安排的日子不出现）
       todayBlocks: [],      // 今天排下的块（可能为空：今天没空档，但明天有）
       next,                 // 「今天该动哪件」= todayBlocks[0]，没有则 null
       unscheduled: [],      // days 天里放不下的（带 mins 与 reason）
       pendingCount,         // 未完成待办总数
       overdueCount,         // 其中已过期
       totalMins,            // 今天已排走的分钟数
     }
   同一件待办**整件排一次**，不切成两段 —— 切碎之后「今天该动哪件」就没法回答了。 */
export function planTodos({
  todos = [],
  itemsOfDay = null,
  settings = null,
  today = todayKey(),
  days = 7,
  now = new Date(),
  nowMin = null,
  durationOf = null,
  defaultMin = DEFAULT_TODO_MIN,
} = {}) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(today)) ? String(today) : todayKey()
  const horizon = Math.max(1, Math.round(Number(days) || 7))
  const pending = pendingTodos(todos)
  /* 「现在几点」优先用调用方传的 nowMin（界面上的活钟，测试可用 ?t= 固定住）；
     没传才退回 now 的时:分。**不退回「脚本启动那一刻」**：App 里那个 Date 是缓存的，
     过几小时还在原地，会让「已经过去的时点」判断错。
     ⚠ 必须先判 null/undefined 再 Number()：Number(null) === 0 是有限数，
       直接 isFinite 会让「没传」被当成「现在是 0 点」。 */
  const hasNowMin = nowMin !== null && nowMin !== undefined && nowMin !== ''
  const curMin = hasNowMin && Number.isFinite(Number(nowMin))
    ? Math.max(0, Math.min(24 * 60, Math.round(Number(nowMin))))
    : (now instanceof Date && !Number.isNaN(now.getTime()) ? now.getHours() * 60 + now.getMinutes() : 0)

  let queue = pending.slice()
  const outDays = []
  let todayBlocks = []

  for (let i = 0; i < horizon && queue.length; i++) {
    const dKey = addDaysKey(base, i)
    const items = typeof itemsOfDay === 'function' ? itemsOfDay(dKey) : []
    const slots = freeSlots(items, settings, { durationOf }).map((s) => ({ start: s.start, end: s.end }))
    /* 今天：已经过去的时点不再排（排了也没法执行）。明天起从 0 点算。 */
    const notBefore = dKey === base ? curMin : 0
    const usable = slots.filter((s) => s.end - Math.max(s.start, notBefore) >= MIN_BLOCK_MIN)
    if (!usable.length) continue

    const blocks = []
    for (const t of queue.slice()) {
      /* 截止日约束：**还没到期的件不往后拖** —— 排出来的日子不晚于 due_date，
         不能把「10 月 20 日要交」的活排到 10 月 21 日（那已经晚了）。
         已经到期（今天）或早就过期的件不设这个限：它已经到点了，**最早能做的那个空档
         就是最诚实的答案**（今天有空档排今天，没有就排到明天早上），排不上再进 unscheduled。
         这类件在界面上带「今天到期 / 已过期」标，用户看得到它本来就晚了。
         没有 due_date 的件也不受限（排不了期，但有空就能做）。 */
      const due = t.due_date
      if (/^\d{4}-\d{2}-\d{2}$/.test(due) && compareDateKey(due, base) > 0 && compareDateKey(dKey, due) > 0) continue
      const mins = estimateMinutes(t, defaultMin)
      const b = carveSlots(usable, mins, notBefore)
      if (!b) continue
      blocks.push({
        todoId: t.id,
        title: t.title,
        due_date: t.due_date,
        urgency: urgencyOf(t.due_date, base),
        mins,
        start: b.start,
        end: b.end,
        time: hhmm(b.start) + '–' + hhmm(b.end),
      })
      queue = queue.filter((x) => x !== t)
    }
    if (blocks.length) {
      outDays.push({ date: dKey, blocks })
      if (i === 0) todayBlocks = blocks
    }
  }

  /* 排不下的原因分开说：被截止日卡住的 ≠ 单纯没空档的。
     不写「你拖延了」——只陈述「哪天之前要交、没找到位置」。 */
  const unscheduled = queue.map((t) => {
    const due = t.due_date
    const dueLimited = /^\d{4}-\d{2}-\d{2}$/.test(due) && compareDateKey(due, base) > 0
    return {
      ...t,
      mins: estimateMinutes(t, defaultMin),
      urgency: urgencyOf(t.due_date, base),
      reason: dueLimited
        ? '要在 ' + due + ' 之前做，但那之前的空档都不够'
        : '未来 ' + horizon + ' 天的空档放不下',
    }
  })

  return {
    date: base,
    days: outDays,
    todayBlocks,
    next: todayBlocks[0] || null,
    /* 今天没排下时，最近的一件排在哪天（可能没有）——给「今天该动哪件」兜底一句实话 */
    nextDay: todayBlocks.length ? null : (outDays[0] || null),
    unscheduled,
    pendingCount: pending.length,
    overdueCount: pending.filter((t) => urgencyOf(t.due_date, base) === 'overdue').length,
    totalMins: todayBlocks.reduce((s, b) => s + b.mins, 0),
  }
}

/* "2026-10-17" → "10 月 17 日"（纯字符串，不碰 Date，避免时区偏移） */
function prettyDay(dKey) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(dKey || ''))
  return m ? Number(m[1]) + ' 月 ' + Number(m[2]) + ' 日' : String(dKey || '')
}

/* 给「今天该动哪件」配一句人话。**只陈述，不催促、不说教**（App 一路的调性）。
   三种情况都要给出实话，不能因为今天排不下就整段沉默：
     · 今天排得下 → 「今天排得下 N 件，还有 M 件待排」
     · 今天没空档、但后面排上了 → 「今天没空档了，最近排到 10 月 17 日 07:00」
     · 未来几天都排不下 → 「未来几天没有放得下的空档，N 件待办还没排上」 */
export function planLine(plan) {
  if (!plan || !plan.pendingCount) return ''
  if (plan.next) {
    const n = plan.todayBlocks.length
    const rest = plan.pendingCount - n
    return rest > 0 ? '今天排得下 ' + n + ' 件，还有 ' + rest + ' 件待排' : '今天排得下全部 ' + n + ' 件'
  }
  if (plan.nextDay && plan.nextDay.blocks && plan.nextDay.blocks.length) {
    const b = plan.nextDay.blocks[0]
    return '今天没空档了，最近排到 ' + prettyDay(plan.nextDay.date) + ' ' + b.time
  }
  return plan.unscheduled.length
    ? '未来几天没有放得下的空档，' + plan.unscheduled.length + ' 件待办还没排上'
    : ''
}
