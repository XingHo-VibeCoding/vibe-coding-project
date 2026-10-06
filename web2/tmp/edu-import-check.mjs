/* P12a 教务课表导入检查
   A 段：纯逻辑（Node 直接跑源码，不需要浏览器/不需要真实文件）
        · 周次解析：区间 / 单双周 / 多段合并 / 认不出来必须回 null（不猜）
        · 节次解析与「节次表里没有那一节」的处理
        · 分号多时段与地点按下标配对
        · matchWeek：有 weeks 只认 weeks；**没有 weeks 完全走老口径**（老数据不受影响）
        · weekTagOf 的标签口径
        · replaceCoursesFromEdu 的失败分支（没导入过主项目数据时不许动任何东西）
        · 快照写入 / 恢复 / 恢复后快照消失
   B 段：真文件（可选）—— 传 EDU_XLSX=<路径> 时把真实导出解析一遍，断言条数与关键字段
        默认跳过（真实文件在用户的 Downloads 里，不进仓库、也不该是测试的硬依赖）

   跑法：先起 dist 静态服务（默认 4177）再 node tmp/edu-import-check.mjs
        带真文件：$env:EDU_XLSX='C:\path\to\课表.xlsx'; node tmp/edu-import-check.mjs
   注意：本文件不读网络、不写用户的浏览器数据。 */

let pass = 0
let fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

/* ===== 共用：假 localStorage（store.js 读它） ===== */
class FakeStore {
  constructor() {
    this.m = new Map()
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null
  }
  setItem(k, v) {
    this.m.set(k, String(v))
  }
  removeItem(k) {
    this.m.delete(k)
  }
}
globalThis.localStorage = new FakeStore()

const E = await import('../src/data/eduImport.js')
const S = await import('../src/data/store.js')

/* ===== A1–A6 周次解析 ===== */
t('A1. `{单周}` → 1,3,5,…,15（16 周制）',
  JSON.stringify(E.parseWeeks('周三第9,10节{单周}').weeks) === JSON.stringify([1, 3, 5, 7, 9, 11, 13, 15]),
  JSON.stringify(E.parseWeeks('周三第9,10节{单周}').weeks))
t('A2. `{双周}` → 2,4,…,16',
  JSON.stringify(E.parseWeeks('{双周}').weeks) === JSON.stringify([2, 4, 6, 8, 10, 12, 14, 16]),
  JSON.stringify(E.parseWeeks('{双周}').weeks))
t('A3. `{1-8周}` → 1..8',
  JSON.stringify(E.parseWeeks('周二第1,2节{1-8周}').weeks) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8]),
  JSON.stringify(E.parseWeeks('{1-8周}').weeks))
t('A4. `{1-8,10-16周}` → 两段合并、升序去重',
  JSON.stringify(E.parseWeeks('{1-8,10-16周}').weeks) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16]),
  JSON.stringify(E.parseWeeks('{1-8,10-16周}').weeks))
t('A5. 没有周次信息 → null（按每周处理，不是猜一个集合）', E.parseWeeks('周二第6,7,8节').weeks === null)
/* A6 拆成两条（2026-10-06 修正）：原来把「花括号里的 1-2,5」也当成"应当认不出"，那是**判错了**。
   花括号 `{...}` 本身就是「这是周次」的标记，里面写 `1-2,5` 只可能是周次，所以要认；
   真正认不出的是**不带花括号**且与节次同形的写法（`第1-2,5周` vs `第3,4节`），那种才不猜。 */
t('A6. 花括号里的列举写法要认：`{1-2,5周}` → [1,2,5]',
  JSON.stringify(E.parseWeeks('{1-2,5周}').weeks) === '[1,2,5]', JSON.stringify(E.parseWeeks('{1-2,5周}').weeks))
t('A6b. 完全认不出的内容 → null（宁可不说，也不猜错）', E.parseWeeks('{说不清}').weeks === null)
t('A6c. 不带花括号、与节次同形的写法 → 不猜（null）',
  E.parseWeeks('第1-2,5周').weeks === null && E.parseWeeks('第1-2,5周').note === '第1-2,5周',
  JSON.stringify(E.parseWeeks('第1-2,5周')))

/* ===== A7–A10 节次 / 时段 / 地点 ===== */
t('A7. `第6,7,8节` → [6,7,8]', JSON.stringify(E.parseSections('周二第6,7,8节')) === '[6,7,8]', JSON.stringify(E.parseSections('周二第6,7,8节')))
t('A8. `第9,10节` → [9,10]（中文逗号也要认）', JSON.stringify(E.parseSections('第9、10节')) === '[9,10]', JSON.stringify(E.parseSections('第9、10节')))
{
  const slots = E.parseTimeSlots('周二第6,7,8节;周三第9,10节{单周}')
  t('A9. 分号切成两个时段、各带自己的周次',
    slots.length === 2 && slots[0].weekday === 2 && slots[1].weekday === 3 && JSON.stringify(slots[1].weeks) === JSON.stringify([1, 3, 5, 7, 9, 11, 13, 15]),
    JSON.stringify(slots.map((s) => [s.weekday, s.secs, s.weeks])))
}
{
  const places = E.parsePlaceSlots('紫金港北3-205;紫金港西4-120')
  t('A10. 地点按下标配对（第一个时段配第一个地点）', places.length === 2 && places[1] === '紫金港西4-120', JSON.stringify(places))
}

/* ===== A11 节次表里没有那一节 → 不静默丢，进 missing ===== */
{
  const periods = [{ no: 1, start: '08:00', end: '08:45' }]
  const r = E.periodRange(periods, [1, 9])
  t('A11. 节次表缺第 9 节时：能给的时间照给，缺的进 missing（调用方据此报出来）',
    r.start === '08:00' && r.missing.indexOf(9) !== -1, JSON.stringify(r))
  const bad = E.periodRange(periods, [9])
  t('A12. 只缺节号时返回空时间（那门课不能瞎排）', !bad.start && !bad.end, JSON.stringify(bad))
}

/* ===== A13–A16 matchWeek：新老两路 ===== */
t('A13. 有 weeks → 只认 weeks：第 5 周算有课',
  S.matchWeek({ weeks: [1, 3, 5, 7], week_rule: 'every' }, 5) === true)
t('A14. 有 weeks → 第 6 周不算（哪怕 week_rule 写着 every）',
  S.matchWeek({ weeks: [1, 3, 5, 7], week_rule: 'every' }, 6) === false)
t('A15. 没有 weeks → 老口径原样：every 恒真 / odd 只奇 / even 只偶',
  S.matchWeek({}, 7) === true && S.matchWeek({ week_rule: 'odd' }, 6) === false && S.matchWeek({ week_rule: 'even' }, 6) === true
  && S.matchWeek({ week_rule: 'odd' }, 7) === true)
t('A16. weeks 为空数组 = 没有周次信息 → 回落 week_rule（与 null 同义，不能当成"哪周都没课"）',
  S.matchWeek({ weeks: [], week_rule: 'even' }, 6) === true && S.matchWeek({ weeks: null }, 3) === true)

/* ===== A17–A19 weekTagOf ===== */
t('A17. 连续区间 → `1-8 周`', S.weekTagOf({ weeks: [1, 2, 3, 4, 5, 6, 7, 8] }) === '1-8 周', S.weekTagOf({ weeks: [1, 2, 3, 4, 5, 6, 7, 8] }))
t('A18. 全奇数 → `单周`', S.weekTagOf({ weeks: [1, 3, 5, 7, 9, 11, 13, 15] }) === '单周', S.weekTagOf({ weeks: [1, 3, 5, 7, 9, 11, 13, 15] }))
t('A19. 没有 weeks → 老标签（每周 / 单周 / 双周）',
  S.weekTagOf({ week_rule: 'every' }) === '每周' && S.weekTagOf({ week_rule: 'odd' }) === '单周' && S.weekTagOf({ week_rule: 'even' }) === '双周')

/* ===== A20 没导入过主项目数据时：不许动任何键 ===== */
{
  const r = S.replaceCoursesFromEdu([{ weekday: 1, name: 'x', start: '08:00', end: '09:40' }])
  t('A20. 没有 web2.data 时拒绝导入并给明确原因（且什么都没写）',
    r.ok === false && /先/.test(r.error || '') && localStorage.getItem(S.EDU_SNAPSHOT_KEY) === null, JSON.stringify(r))
  t('A20b. 传空课程也拒绝（不把课表清空）', S.replaceCoursesFromEdu([]).ok === false)
}

/* ===== A21–A25 真替换：只换课程，待办/日程/学期原地不动，旧课表进快照 ===== */
{
  const doc = {
    app: 'sched',
    semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 16 },
    schedules: [
      { id: 'old1', type: 'course', title: '旧课A', weekday: 1, start_time: '08:00', duration: 95, week_rule: 'every', semester_id: 'sem1' },
      { id: 'old2', type: 'course', title: '旧课B', weekday: 2, start_time: '10:00', duration: 95, week_rule: 'odd', semester_id: 'sem1' },
      { id: 'ev1', type: 'event', title: '班会', date: '2026-10-08', start_time: '19:00', duration: 60 },
      { id: 'rt1', type: 'routine', title: '晨跑', weekday: 3, start_time: '07:00', duration: 30, week_rule: 'every' },
    ],
    todos: [{ id: 't1', title: '交报告', done: false, due_date: '2026-10-10' }],
  }
  localStorage.setItem(S.DATA_KEY, JSON.stringify(doc))
  localStorage.setItem(S.ADDED_KEY, JSON.stringify([
    { id: 'a1', type: 'course', name: '手动加的课', weekday: 5, start: '14:00', end: '15:40', added: true },
    { id: 'a2', type: 'event', name: '手动加的日程', date: '2026-10-09', added: true },
  ]))
  const r = S.replaceCoursesFromEdu([
    { id: 'edu_X_3_1400', weekday: 3, name: '新课程', place: '紫金港北4-319', teacher: '张老师', code: 'X1', term: '秋冬', start: '14:00', end: '15:40', weeks: [1, 3, 5], week_rule: 'every' },
  ])
  t('A21. 替换成功并报出换了多少门', r.ok === true && r.replaced === 2, JSON.stringify(r))
  const after = JSON.parse(localStorage.getItem(S.DATA_KEY))
  const courses = after.schedules.filter((x) => x.type === 'course')
  t('A22. 课程换成教务那套（旧的没了、新的在，且写了 weeks）',
    courses.length === 1 && courses[0].title === '新课程' && JSON.stringify(courses[0].weeks) === '[1,3,5]' && courses[0].location === '紫金港北4-319',
    JSON.stringify(courses))
  t('A23. 日期/星期/时长换算对了（14:00 起 100 分钟；semester_id 保留）',
    courses[0].duration === 100 && courses[0].weekday === 3 && courses[0].semester_id === 'sem1', JSON.stringify(courses[0]))
  t('A24. 待办 / 日程 / 循环日程 / 学期一个没动',
    after.todos.length === 1 && after.todos[0].title === '交报告'
    && after.schedules.some((x) => x.id === 'ev1') && after.schedules.some((x) => x.id === 'rt1')
    && after.semester.name === '2026-2027 秋冬', JSON.stringify(after.schedules.map((x) => [x.type, x.id])))
  const added = JSON.parse(localStorage.getItem(S.ADDED_KEY))
  t('A25. 手动加的**课程**清掉了、手动加的**日程**留着',
    !added.some((x) => x.type === 'course') && added.some((x) => x.type === 'event'), JSON.stringify(added))
  t('A26. 快照存下来了、能报出旧课表有几门课',
    S.hasEduSnapshot() === true && S.eduSnapshotInfo() && S.eduSnapshotInfo().courses === 2, JSON.stringify(S.eduSnapshotInfo()))
  /* 恢复 */
  const back = S.restoreEduSnapshot()
  const restored = JSON.parse(localStorage.getItem(S.DATA_KEY))
  t('A27. 恢复上一套课表 → 旧的两门课回来了',
    back.ok === true && restored.schedules.filter((x) => x.type === 'course').length === 2
    && restored.schedules.some((x) => x.title === '旧课A'), JSON.stringify(restored.schedules.filter((x) => x.type === 'course').map((x) => x.title)))
  const addedBack = JSON.parse(localStorage.getItem(S.ADDED_KEY))
  t('A28. 恢复时手动加的课也一起回来', addedBack.some((x) => x.name === '手动加的课'), JSON.stringify(addedBack.map((x) => x.name)))
  t('A29. 恢复后快照用掉就没了（不能反复回滚到同一个状态）', S.hasEduSnapshot() === false && S.restoreEduSnapshot().ok === false)
}

/* ===== B 段：真实文件（可选） ===== */
const xlsxPath = process.env.EDU_XLSX
if (!xlsxPath) {
  console.log('SKIP | B 段：没有给 EDU_XLSX（真实导出文件在用户目录里，不进仓库），跳过真文件断言')
} else {
  const { readFileSync } = await import('node:fs')
  const periods = [
    { no: 1, start: '08:00', end: '08:45' }, { no: 2, start: '08:55', end: '09:40' },
    { no: 3, start: '09:50', end: '10:35' }, { no: 4, start: '10:45', end: '11:30' },
    { no: 5, start: '11:40', end: '12:25' }, { no: 6, start: '14:00', end: '14:45' },
    { no: 7, start: '14:55', end: '15:40' }, { no: 8, start: '15:50', end: '16:35' },
    { no: 9, start: '16:45', end: '17:30' }, { no: 10, start: '17:40', end: '18:25' },
    { no: 11, start: '19:00', end: '19:45' }, { no: 12, start: '19:55', end: '20:40' },
    { no: 13, start: '20:50', end: '21:35' },
  ]
  const r = await E.parseEduXlsx(new Uint8Array(readFileSync(xlsxPath)), { periods, totalWeeks: 16 })
  t('B1. 真文件能解析（ok=true）', r.ok === true, r.error || '')
  t('B2. 表头认得全（课程名称 + 上课时间 + 上课地点）', !!r.header.length && r.courses.length > 0, JSON.stringify(r.header))
  t('B3. 一门课的两个时段被拆成两条、且地点按下标配对',
    r.courses.some((c) => c.weekday === 2) && r.courses.some((c) => c.weekday === 3),
    JSON.stringify(r.courses.map((c) => [c.name, c.weekday])))
  t('B4. 单周课拿到了显式周次集合而不是「每周」',
    r.courses.some((c) => Array.isArray(c.weeks) && c.weeks.length > 2 && c.weeks.every((w) => w % 2 === 1)),
    JSON.stringify(r.courses.filter((c) => c.weeks).map((c) => [c.name, c.weeks])))
  t('B5. 第 9,10 节按用户节次表换算出钟点（16:45 起）',
    r.courses.some((c) => c.secs.indexOf(9) !== -1 && c.start === '16:45'),
    JSON.stringify(r.courses.filter((c) => c.secs.indexOf(9) !== -1).map((c) => [c.name, c.start, c.end])))
  t('B6. 没有上课时间的课进 noTime（不静默丢），理由说人话',
    Array.isArray(r.noTime) && r.noTime.length > 0 && r.noTime.every((n) => !/认不出（\d+）/.test(n.reason || '')),
    JSON.stringify(r.noTime.map((n) => [n.name, n.reason])))
  t('B7. 重复行被去掉（dupRows > 0 或至少没有同名同星期同时间的两条）',
    (() => {
      const keys = r.courses.map((c) => [c.weekday, c.start, c.end, c.name].join('|'))
      return keys.length === new Set(keys).size
    })(), 'dupRows=' + r.dupRows)
  t('B8. 没进库的课也有交代：notes 非空', Array.isArray(r.notes) && r.notes.length > 0, JSON.stringify(r.notes))
}

console.log(`\n教务课表导入检查：${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
