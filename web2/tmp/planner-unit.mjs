/* planner.js 纯函数单测（node 直接跑，不起浏览器）
   跑法：node tmp/planner-unit.mjs
   口径：反向排课 = 待办 × 课表，只建议不落库；预计用时按默认 30 分钟（用户 m24447 拍板）。 */
import {
  estimateMinutes, pendingTodos, urgencyOf, planTodos, planLine,
  DEFAULT_TODO_MIN, MIN_BLOCK_MIN,
} from '../src/data/planner.js'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

/* 固定基准：2026-10-16 周五。空课表 → 作息区间 07:00–23:00（勿扰 23:00–07:00 的补集）。 */
const DAY = '2026-10-16'
const at = (h, m = 0) => new Date(2026, 9, 16, h, m)
const todo = (id, title, due, done = false) => ({ id, title, due_date: due, done })
const course = (h, m, mins, title = '课') => ({ at: at(h, m), mins, title })

console.log('=== A 组：estimateMinutes（预计用时） ===')
t('A1 没有 mins 字段 → 默认 30 分钟', estimateMinutes({ title: 'x' }) === DEFAULT_TODO_MIN, String(estimateMinutes({ title: 'x' })))
t('A2 mins=45 → 45', estimateMinutes({ mins: 45 }) === 45)
t('A3 mins 非数字 → 回落默认', estimateMinutes({ mins: 'abc' }) === DEFAULT_TODO_MIN)
t('A4 mins 为 0 / 负数 → 回落默认', estimateMinutes({ mins: 0 }) === DEFAULT_TODO_MIN && estimateMinutes({ mins: -5 }) === DEFAULT_TODO_MIN)
t('A5 mins 小于下限 → 抬到 MIN_BLOCK_MIN', estimateMinutes({ mins: 3 }) === MIN_BLOCK_MIN, String(estimateMinutes({ mins: 3 })))
t('A6 传了 fallback 用 fallback', estimateMinutes({}, 60) === 60)
t('A7 fallback 非法 → 仍回落 DEFAULT', estimateMinutes({}, 'zzz') === DEFAULT_TODO_MIN)
t('A8 不抛（null / undefined）', estimateMinutes(null) === DEFAULT_TODO_MIN && estimateMinutes(undefined) === DEFAULT_TODO_MIN)

console.log('\n=== B 组：pendingTodos（筛 + 排） ===')
const rawTodos = [
  todo('t3', '晚交的', '2026-10-20'),
  todo('t1', '明天的', '2026-10-17'),
  todo('t2', '已完成的', '2026-10-16', true),
  { id: 't4', title: '   ' },
  todo('t5', '没截止日的', ''),
  todo('t6', '也明天', '2026-10-17'),
]
const pend = pendingTodos(rawTodos)
t('B1 已完成的被剔除', !pend.some((p) => p.id === 't2'))
t('B2 空标题被剔除', !pend.some((p) => p.id === 't4'))
t('B3 未完成共 4 条', pend.length === 4, String(pend.length))
t('B4 按截止日升序（最早的在最前）', pend[0].due_date === '2026-10-17' || pend[0].due_date === '2026-10-17', pend[0].due_date)
t('B5 没截止日的排最后', pend[pend.length - 1].id === 't5')
t('B6 同截止日按标题稳定排序（可重复、与 localeCompare 同序）', (() => {
  const a = pend.filter((p) => p.due_date === '2026-10-17').map((p) => p.title).join('|')
  const b = pendingTodos(rawTodos).filter((p) => p.due_date === '2026-10-17').map((p) => p.title).join('|')
  const want = ['也明天', '明天的'].sort((x, y) => x.localeCompare(y)).join('|')
  return a === b && a === want
})(), pend.filter((p) => p.due_date === '2026-10-17').map((p) => p.title).join('|'))
t('B7 输入非数组 → 空表不抛', pendingTodos(null).length === 0 && pendingTodos(undefined).length === 0)

console.log('\n=== C 组：urgencyOf（紧迫度） ===')
t('C1 早于今天 → overdue', urgencyOf('2026-10-15', DAY) === 'overdue')
t('C2 今天 → today', urgencyOf(DAY, DAY) === 'today')
t('C3 明天 → tomorrow', urgencyOf('2026-10-17', DAY) === 'tomorrow')
t('C4 更远 → later', urgencyOf('2026-10-20', DAY) === 'later')
t('C5 没有截止日 → none', urgencyOf('', DAY) === 'none' && urgencyOf(null, DAY) === 'none')

console.log('\n=== D 组：planTodos 基本排课 ===')
/* 空课表：07:00–23:00 全是空档（960 分钟） */
const p1 = planTodos({ todos: [todo('a', '写高数作业', '2026-10-16')], itemsOfDay: () => [], today: DAY, now: at(9, 0) })
t('D1 有 1 件待办 → 排进今天', p1.todayBlocks.length === 1, JSON.stringify(p1.todayBlocks))
t('D2 起始时刻 = 今天 09:00（已过时点不排）', p1.todayBlocks[0].start === 9 * 60, String(p1.todayBlocks[0].start))
t('D3 时长 = 默认 30 分钟', p1.todayBlocks[0].mins === 30)
t('D4 time 文案形如 09:00–09:30', p1.todayBlocks[0].time === '09:00–09:30', p1.todayBlocks[0].time)
t('D5 next = 今天第一块', p1.next && p1.next.todoId === 'a')
t('D6 totalMins 累加', p1.totalMins === 30)
t('D7 pendingCount / overdueCount', p1.pendingCount === 1 && p1.overdueCount === 0)

/* 两节课之间夹一个空档：08:00–09:00 课、10:00–11:00 课 → 空档 09:00–10:00（60 分钟） */
const itemsTwo = [course(8, 0, 60), course(10, 0, 60)]
const p2 = planTodos({ todos: [todo('a', '写作业', DAY)], itemsOfDay: () => itemsTwo, today: DAY, now: at(8, 30) })
t('D8 排进两节课之间的空档', p2.todayBlocks[0].start === 9 * 60 && p2.todayBlocks[0].end === 9 * 60 + 30, JSON.stringify(p2.todayBlocks[0]))
t('D9 不排在课里（不与 08:00 课重叠）', p2.todayBlocks[0].start >= 9 * 60)

/* 两件待办 → 依次往后排，不重叠 */
const p3 = planTodos({
  todos: [todo('a', '作业 A', DAY), todo('b', '作业 B', DAY)],
  itemsOfDay: () => [], today: DAY, now: at(9, 0),
})
t('D10 两件待办各占一块', p3.todayBlocks.length === 2)
t('D11 两块不重叠（后一块起点 ≥ 前一块终点）', p3.todayBlocks[1].start >= p3.todayBlocks[0].end, JSON.stringify(p3.todayBlocks.map((b) => [b.start, b.end])))
t('D12 整件排一次、不切碎', p3.todayBlocks.every((b) => b.end - b.start === b.mins))

console.log('\n=== E 组：截止日约束 ===')
/* 今天只有 09:00–09:30 一个空档（作息 07:00–23:00）：
   课 08:00–09:00 + 课 09:30–23:00 ⇒ 空档 07:00–08:00（已过）与 09:00–09:30（恰好 30 分钟） */
const tight = [course(8, 0, 60), course(9, 30, 810)]
const p4 = planTodos({
  todos: [todo('far', '下周才交的', '2026-10-20'), todo('soon', '明天要交的', '2026-10-17')],
  itemsOfDay: () => tight, today: DAY, now: at(9, 0), days: 1,
})
t('E1 days=1 时，今天只有 1 个 30 分钟空档 → 只排 1 件', p4.todayBlocks.length === 1, JSON.stringify(p4.todayBlocks.map((b) => b.title)))
t('E2 排上的是更早截止的那件（明天）', p4.todayBlocks[0].todoId === 'soon', p4.todayBlocks[0].todoId)
t('E3 排不下的进 unscheduled 并带 reason', p4.unscheduled.length === 1 && !!p4.unscheduled[0].reason, JSON.stringify(p4.unscheduled))

/* 过期件不受截止日约束：今天空档够，就排在今天 */
const p5 = planTodos({ todos: [todo('late', '早就该交的', '2026-10-01')], itemsOfDay: () => [], today: DAY, now: at(9, 0) })
t('E4 已过期的件照排（越早动越好）', p5.todayBlocks.length === 1 && p5.overdueCount === 1, JSON.stringify(p5.todayBlocks))
t('E5 过期件的 urgency = overdue', p5.todayBlocks[0].urgency === 'overdue')

/* 没截止日的件不设限 */
const p6 = planTodos({ todos: [todo('nd', '没写截止日', '')], itemsOfDay: () => [], today: DAY, now: at(9, 0) })
t('E6 没截止日的件也排', p6.todayBlocks.length === 1)
t('E7 urgency = none', p6.todayBlocks[0].urgency === 'none')

console.log('\n=== F 组：跨天排（今天满 → 明天） ===')
/* 今天只有一个 30 分钟空档，两件待办（都明天截止）→ 第二件排到明天 */
const p7 = planTodos({
  todos: [todo('a', '甲', '2026-10-17'), todo('b', '乙', '2026-10-17')],
  itemsOfDay: () => tight, today: DAY, now: at(9, 0), days: 3,
})
t('F1 今天排 1 件、共 2 天有安排', p7.todayBlocks.length === 1 && p7.days.length === 2, JSON.stringify(p7.days.map((d) => d.date + ':' + d.blocks.length)))
t('F2 第二天日期 = 明天', p7.days[1] && p7.days[1].date === '2026-10-17', p7.days[1] && p7.days[1].date)
t('F3 days 只含「有安排的日子」', p7.days.every((d) => d.blocks.length > 0))
t('F4 next 仍是今天第一块', p7.next.todoId === 'a')

console.log('\n=== G 组：边界与容错 ===')
const p8 = planTodos({ todos: [], itemsOfDay: () => [], today: DAY, now: at(9, 0) })
t('G1 没有待办 → 全空、不抛', p8.todayBlocks.length === 0 && p8.next === null && p8.pendingCount === 0)
t('G2 没有待办时 planLine 返回空串', planLine(p8) === '')
const p9 = planTodos({ todos: [todo('a', '甲', DAY)], today: DAY, now: at(9, 0) })
t('G3 不传 itemsOfDay（无课表）也能排', p9.todayBlocks.length === 1)
const p10 = planTodos({ todos: null, itemsOfDay: null, today: DAY, now: at(9, 0) })
t('G4 todos / itemsOfDay 为 null 不抛', p10.todayBlocks.length === 0)
const p11 = planTodos({ todos: [todo('a', '甲', DAY)], itemsOfDay: () => [], today: 'not-a-date', now: at(9, 0) })
t('G5 非法 today 回落今天（不抛）', /^\d{4}-\d{2}-\d{2}$/.test(p11.date))
/* 深夜：现在 22:30，作息到 23:00 只剩 30 分钟 → 刚好排得下 1 件 */
const p12 = planTodos({ todos: [todo('a', '甲', DAY), todo('b', '乙', DAY)], itemsOfDay: () => [], today: DAY, now: at(22, 30), days: 1 })
t('G6 深夜只剩 30 分钟 → 今天只排 1 件', p12.todayBlocks.length === 1, String(p12.todayBlocks.length))
t('G7 排下的那块落在 22:30–23:00', p12.todayBlocks[0].time === '22:30–23:00', p12.todayBlocks[0].time)
/* 今天已经 23:30（超出作息）→ 今天排不下，落到明天 */
const p13 = planTodos({ todos: [todo('a', '甲', DAY)], itemsOfDay: () => [], today: DAY, now: at(23, 30), days: 2 })
t('G8 过了作息区间 → 今天不排，落到明天', p13.todayBlocks.length === 0 && p13.days.length === 1 && p13.days[0].date === '2026-10-17', JSON.stringify(p13.days.map((d) => d.date)))
/* days=0 / 负数 → 至少 1 天 */
const p14 = planTodos({ todos: [todo('a', '甲', DAY)], itemsOfDay: () => [], today: DAY, now: at(9, 0), days: 0 })
t('G9 days=0 被抬到 1（不至于什么都不排）', p14.days.length === 1)

console.log('\n=== H 组：planLine 措辞（只陈述、不催不评判） ===')
const line1 = planLine(p1)
t('H1 排得下时给一句人话', typeof line1 === 'string' && line1.length > 0, line1)
const banned = ['加油', '努力', '该', '拖', '懒', '赶紧', '必须', '你怎么']
t('H2 不含催促 / 评判词', !banned.some((w) => line1.includes(w)), line1)
const p15 = planTodos({ todos: [todo('a', '甲', DAY), todo('b', '乙', DAY)], itemsOfDay: () => tight, today: DAY, now: at(9, 0), days: 1 })
const line2 = planLine(p15)
t('H3 排不下时说明还有几件', line2.includes('1'), line2)
t('H4 全部排下时也说得出来', planLine(p3).includes('2'), planLine(p3))

const passed = results.filter((r) => r[1]).length
console.log('\n=== 反向排课纯函数：' + passed + '/' + results.length + ' 通过 ===')
const failed = results.filter((r) => !r[1])
if (failed.length) {
  console.log('失败项：')
  for (const [n] of failed) console.log('  - ' + n)
  process.exit(1)
}
