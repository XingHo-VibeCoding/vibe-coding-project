/* routine 闸门金标准（2026-10-01 三期 Step 1）：验证主项目 js/store.js 能收下
   type:'routine'（固定循环日程）——既不整份拒收，又不把字段归一化歪，且闸门没开太大。
   跑法：node tmp/routine-gate-check.mjs（web2 目录下） */
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}
globalThis.window = globalThis

const { createRequire } = await import('node:module')
const require = createRequire(import.meta.url)
require('D:/Document/Project/vibe-coding-project/js/store.js')

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log('PASS  ' + name) }
  else { fail++; console.log('FAIL  ' + name) }
}

t('0. 主项目 Store 挂到 global', typeof Store === 'object' && typeof Store.importAll === 'function')

const base = {
  app: 'sched',
  schema_version: 1,
  exported_at: new Date().toISOString(),
  semester: { name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 18, periods: [] },
  todos: [],
  meta: {},
}
const mk = (schedules) => JSON.stringify({ ...base, schedules })

const course = { id: 'c1', type: 'course', title: '高等数学', weekday: 1, start_time: '08:00', duration: 45, week_rule: 'every', date: null, semester_id: 'sem_1' }
const event = { id: 'e1', type: 'event', title: '班会', start_time: '19:00', duration: 60, date: '2026-10-08' }
const routine = { id: 'r1', type: 'routine', title: '健身', weekday: 3, start_time: '18:00', duration: 90, week_rule: 'every' }

/* ---- 1. 三种类型混排能整份导入（修复前：routine 会让整份被拒）---- */
t('1. 课程 + 独立日程 + 循环日程混排可整份导入', Store.importAll(mk([course, event, routine])).ok === true)

const loaded = Store.load()
const got = (loaded.schedules || []).find((s) => s.id === 'r1')
t('2. routine 存进去了', !!got)
t('3. routine 的 type 原样保留', got && got.type === 'routine')
t('4. routine 的 weekday 归一化为数字', got && got.weekday === 3)
t('5. routine 的 week_rule 保留', got && got.week_rule === 'every')
t('6. routine 不落具体日期（没被当成 event）', got && got.date == null)
t('7. routine 的 title / start_time / duration 正确', got && got.title === '健身' && got.start_time === '18:00' && got.duration === 90)
const gotEvent = (loaded.schedules || []).find((s) => s.id === 'e1')
t('8. event 没被带歪（date 保留、weekday 不落值）', gotEvent && gotEvent.date === '2026-10-08' && gotEvent.weekday == null)

/* ---- 2. importAll 是保真写入：校验只做「放行/拒收」，不重新归一化字段 ----
   所以「缺 week_rule 时补 every」这件事必须由 web2 的 fullRoutine() 显式写死，
   不能指望主项目补（Step 2 的约束）。这里断言校验不强制 week_rule。 */
t('9. routine 缺 week_rule 也能过（校验不强制）', Store.importAll(mk([{ ...routine, id: 'r2', week_rule: undefined }])).ok === true)
const got2 = (Store.load().schedules || []).find((s) => s.id === 'r2')
t('10. importAll 不补默认值（原样读回）', got2 && got2.week_rule == null)

/* ---- 3. 单双周仍可用 ---- */
t('11. routine 可带 odd 单周', Store.importAll(mk([{ ...routine, id: 'r3', week_rule: 'odd' }])).ok === true)
const got3 = (Store.load().schedules || []).find((s) => s.id === 'r3')
t('12. 单周规则读回正确', got3 && got3.week_rule === 'odd')

/* ---- 4. 闸门没开太大：非法 routine 照样拒收，且不写入脏数据 ---- */
const rNoWd = Store.importAll(mk([{ ...routine, id: 'r4', weekday: undefined }]))
t('13. routine 缺星期被拒', rNoWd.ok === false && /星期/.test(rNoWd.error))
t('14. 被拒时不写入（表里没有 r4）', !(Store.load().schedules || []).some((s) => s.id === 'r4'))
const rBadType = Store.importAll(mk([{ ...routine, id: 'r5', type: 'habit' }]))
t('15. 未知 type（habit）仍被拒', rBadType.ok === false && /未知的日程类型/.test(rBadType.error))
const rNoName = Store.importAll(mk([{ ...routine, id: 'r6', title: '' }]))
t('16. routine 缺名称被拒', rNoName.ok === false)

console.log(`\n结果：${pass} 过，${fail} 挂`)
process.exit(fail ? 1 : 0)
