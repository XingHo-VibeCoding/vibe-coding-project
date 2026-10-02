/* M5 buildScheduleItems 纯函数单测（node 直跑，无需浏览器）
   跑法：node tmp/notify-unit-check.mjs
   覆盖：每周课展开 / 单双周 / 学期越界与未开学 / 无学期信息（示例数据）/
        独立日程 / 提前量 / 今天已过时刻过滤 / 排序 / 7 天窗口边界 */
import { buildScheduleItems } from '../src/data/notify.js'

let pass = 0, fail = 0
const t = (name, cond) => { if (cond) { pass++; console.log('PASS  ' + name) } else { fail++; console.log('FAIL  ' + name) } }

const S = { enabled: true, minutesBefore: 10 }

/* 基准 now：固定为某个周三 12:00（避免跨午夜/系统时间漂移）
   2026-09-30 是周三。 */
const NOW = new Date(2026, 8, 30, 12, 0, 0) // 周三 12:00
const dayOf = (offset) => new Date(2026, 8, 30 + offset, 12, 0)
const WED = ((NOW.getDay() + 6) % 7) + 1 // = 3

/* 1. 每周课：明天（周四）08:00 课 → 明天 07:50 排，title/body 正确 */
const cThu = { id: 'c1', type: 'course', weekday: WED + 1, name: '高等数学', place: '教三 302', start: '08:00', week_rule: 'every' }
let items = buildScheduleItems({ courses: [cThu], events: [], semester: null, settings: S, now: NOW })
t('1. 明天的课排在 07:50', items.length === 1 && items[0].at.getHours() === 7 && items[0].at.getMinutes() === 50)
t('2. title 是课名，body 带提前量与地点', items[0].title === '高等数学' && items[0].body === '10 分钟后开始 · 教三 302')
t('3. key 含日期（幂等重排的依据）', /c_c1_2026-10-01$/.test(items[0].key))

/* 4. 单双周：firstMonday = 明天所在周的上一周周一 → 明天是第 2 周（even） */
const thisMonday = new Date(2026, 8, 28) // 2026-09-28 周一（NOW 本周）
const lastMonday = new Date(2026, 8, 21)
const sem = { firstMonday: '2026-09-21', totalWeeks: 18 }
const cOdd = { ...cThu, id: 'odd', week_rule: 'odd' }
const cEven = { ...cThu, id: 'even', week_rule: 'even' }
items = buildScheduleItems({ courses: [cOdd, cEven], events: [], semester: sem, settings: S, now: NOW })
t('4. 偶数周：even 课排、odd 课不排', items.length === 1 && items[0].key.startsWith('c_even_'))

/* 5. 学期结束：firstMonday 提前 18 周 → 明天是第 19 周 > totalWeeks */
items = buildScheduleItems({ courses: [cEven], events: [], semester: { firstMonday: '2026-05-25', totalWeeks: 18 }, settings: S, now: NOW })
t('5. 超出学期周次不排', items.length === 0)

/* 6. 未开学：firstMonday 在 7 天窗口之后 */
items = buildScheduleItems({ courses: [cEven], events: [], semester: { firstMonday: '2026-10-12', totalWeeks: 18 }, settings: S, now: NOW })
t('6. 未开学（weekNo=0）不排', items.length === 0)

/* 7. 无学期信息（示例数据态）：every 排、odd/even 不排 */
items = buildScheduleItems({ courses: [cEven, { ...cThu, id: 'every', week_rule: 'every' }], events: [], semester: null, settings: S, now: NOW })
t('7. 无学期：every 排、单双周不排', items.length === 1 && items[0].key.startsWith('c_every_'))

/* 8. 独立日程：3 天后 08:00 */
const ev = { id: 'e1', type: 'event', name: '讲座', place: '报告厅', date: '2026-10-03', start: '08:00' }
items = buildScheduleItems({ courses: [], events: [ev], semester: null, settings: S, now: NOW })
t('8. 日程按具体日期排在 07:50', items.length === 1 && items[0].at.getDate() === 3 && items[0].at.getHours() === 7 && items[0].key.startsWith('e_e1_'))

/* 9. 今天已过的时刻不排（NOW 12:00，今天 08:00 课已过）。
   注意：8 天窗口里「每周三的课」出现两次（今天 + 10/7），今天的早课被滤、
   下周的同名课保留——这是正确行为，断言今天的不在、下周的在。 */
const cToday = { id: 't1', type: 'course', weekday: WED, name: '早课', place: '', start: '08:00', week_rule: 'every' }
const cTodayLate = { id: 't2', type: 'course', weekday: WED, name: '晚课', place: '', start: '19:00', week_rule: 'every' }
items = buildScheduleItems({ courses: [cToday, cTodayLate], events: [], semester: null, settings: S, now: NOW })
t('9. 今天 07:50 已过不排、今天 18:50 与下周场次保留', items.length === 3
  && !items.some((i) => i.title === '早课' && i.at.getDate() === 30)
  && items.some((i) => i.title === '晚课' && i.at.getDate() === 30)
  && items.some((i) => i.title === '早课' && i.at.getDate() === 7))

/* 10. 提前量 0：at = 开始时刻整 */
items = buildScheduleItems({ courses: [cThu], events: [], semester: null, settings: { enabled: true, minutesBefore: 0 }, now: NOW })
t('10. 提前 0 分钟 = 开始时刻', items[0].at.getHours() === 8 && items[0].at.getMinutes() === 0 && items[0].body === '现在开始 · 教三 302')

/* 11. 排序升序：三场（今天晚课 < 下周早课 < 下周晚课） */
items = buildScheduleItems({ courses: [cTodayLate, cThu], events: [], semester: null, settings: S, now: NOW })
const sortedOk = items.every((it, i) => i === 0 || items[i - 1].at <= it.at)
t('11. 按 at 升序，今天晚课最先', items.length === 3 && sortedOk && items[0].title === '晚课' && items[0].at.getDate() === 30)

/* 12. 窗口边界：周日课在默认 7 天窗口内出现一次（10/4），horizonDays=2 时（周三~周五）不出现 */
const cSun = { id: 'sun', type: 'course', weekday: 7, name: '周日课', place: '', start: '08:00', week_rule: 'every' }
items = buildScheduleItems({ courses: [cSun], events: [], semester: null, settings: S, now: NOW })
t('12a. 默认窗口：周日课排 10/4 一次', items.length === 1 && items[0].at.getDate() === 4)
items = buildScheduleItems({ courses: [cSun], events: [], semester: null, settings: S, now: NOW, horizonDays: 2 })
t('12b. horizonDays=2（周三~周五）不排周日课', items.length === 0)

/* 13. 提前量把时刻推到前一天 → 跳过（00:05 开课提前 10 分钟 = 前一天 23:55） */
const cMidnight = { id: 'm1', type: 'course', weekday: WED + 1, name: '深夜课', place: '', start: '00:05', week_rule: 'every' }
items = buildScheduleItems({ courses: [cMidnight], events: [], semester: null, settings: S, now: NOW })
t('13. 时刻跨到前一天的不排', items.length === 0)

/* ---------- 14~18. 循环日程也排课前提醒（2026-10-02 用户要） ----------
   口径同课程，但**不受学期起止约束**（跨学期常驻）。
   kind 前缀 'r' 必须与课程的 'c' 分开（id 空间独立，可能撞号）。 */
const rEvery = { id: 'r1', type: 'routine', weekday: WED + 1, name: '健身', place: '体育馆', start: '19:00', week_rule: 'every' }

/* 14. 无条件排：即使完全没有学期信息（循环日程不看学期） */
items = buildScheduleItems({ courses: [], events: [], routines: [rEvery], semester: null, settings: S, now: NOW })
t('14. 无学期信息时循环日程照样排', items.length === 1 && items[0].title === '健身' && items[0].body === '10 分钟后开始 · 体育馆', JSON.stringify(items.map((i) => i.key)))

/* 15. key 前缀是 r_（与课程的 c_ 分开，幂等重排与 cancel 才对得上） */
t('15. 循环日程 key 前缀为 r_（与课程 c_ 区分）', /^r_r1_2026-10-01$/.test(items[0].key), items[0].key)

/* 16. 与课程同一天的循环日程：两条都排、按时间升序（19:00 的健身在 08:00 的高数之后） */
items = buildScheduleItems({ courses: [cThu], events: [], routines: [rEvery], semester: null, settings: S, now: NOW })
t('16. 课程与循环日程同日共存且升序', items.length === 2 && items[0].title === '高等数学' && items[1].title === '健身')

/* 17. 学期之外（放假）循环日程仍排 —— 这正是与课程的关键差异。
   firstMonday 在很久以前（weekNo 远超 totalWeeks），课程会被挡、循环日程不会 */
const farTerm = { firstMonday: '2026-01-05', totalWeeks: 18 }
items = buildScheduleItems({ courses: [cThu], events: [], routines: [rEvery], semester: farTerm, settings: S, now: NOW })
t('17. 学期外：课程不排、循环日程照排（跨学期常驻）', items.length === 1 && items[0].title === '健身', JSON.stringify(items.map((i) => i.title)))

/* 18. 单双周规则对循环日程同样生效（无学期信息时无法判断 → 不排） */
const rOdd = { ...rEvery, id: 'r2', week_rule: 'odd' }
items = buildScheduleItems({ courses: [], events: [], routines: [rOdd], semester: null, settings: S, now: NOW })
t('18a. 无学期信息：单周循环日程不排', items.length === 0)
/* 有学期且当天是偶数周 → odd 不排、even 排 */
const evenWeek = { firstMonday: '2026-09-21', totalWeeks: 18 } // 10/1 是第 2 周（even）
items = buildScheduleItems({ courses: [], events: [], routines: [{ ...rEvery, id: 'rEven', week_rule: 'even' }], semester: evenWeek, settings: S, now: NOW })
t('18b. 偶数周：even 循环日程排', items.length === 1 && items[0].title === '健身')

/* 19. 幂等重排不打架：同一循环日程的 key 在不同 NS 下稳定（重排 cancel 的依据） */
const a = buildScheduleItems({ courses: [], events: [], routines: [rEvery], semester: null, settings: S, now: NOW })
const b = buildScheduleItems({ courses: [], events: [], routines: [rEvery], semester: null, settings: S, now: NOW })
t('19. 同一输入两次展开 key 完全一致', a.length === b.length && a.every((x, i) => x.key === b[i].key))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
