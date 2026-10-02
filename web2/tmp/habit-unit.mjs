/* 三期打卡单测：宽限期（本周内可补）+ 补卡留痕（backfilled）+ 统计与兼容。
   跑法：node tmp/habit-unit.mjs（web2 目录下）
   说明：宽限期纯函数（weekMondayKeyOf / graceKeysOf / isGraceKey）用**固定日期**断言，
   期望值都可由「周一为一周之始」推出来；写盘类用例（toggleHabitRecord）内部取系统
   当天，所以用 todayKeyOf() 现场算出期望，**今天恰是周一时跳过补卡写入那几项**——
   本周没有可补的过去日期，那是日期的性质，不是代码坏了。 */
const store = {}
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
}
globalThis.window = globalThis

const S = await import('../src/data/store.js')

let pass = 0, fail = 0
function t(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name) }
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  → ' + extra : '')) }
}
function skip(name, why) { console.log('SKIP  ' + name + '  → ' + why) }
const reset = () => Object.keys(store).forEach((k) => delete store[k])
const WD = ['日', '一', '二', '三', '四', '五', '六']
const wdOf = (key) => WD[new Date(key + 'T00:00:00').getDay()]

/* ================= 组 1：宽限期纯函数（固定日期） ================= */
t('1. 本周一（跨月）：2026-10-02(五) → 2026-09-28(一)', S.weekMondayKeyOf('2026-10-02') === '2026-09-28', S.weekMondayKeyOf('2026-10-02'))
t('2. 周一当天返回自己：2026-10-05 → 2026-10-05', S.weekMondayKeyOf('2026-10-05') === '2026-10-05', S.weekMondayKeyOf('2026-10-05'))
t('3. 周日仍归本周：2026-10-04(日) → 2026-09-28', S.weekMondayKeyOf('2026-10-04') === '2026-09-28', S.weekMondayKeyOf('2026-10-04'))

const probe = ['2024-02-29', '2026-01-01', '2026-03-01', '2026-06-30', '2026-09-07', '2026-10-04', '2026-12-31', '2027-01-03']
let okMon = true, okRange = true
for (const d of probe) {
  const mon = S.weekMondayKeyOf(d)
  if (wdOf(mon) !== '一') { okMon = false; console.log('   ↳ 非周一: ' + d + ' → ' + mon) }
  const diff = (new Date(d + 'T00:00:00') - new Date(mon + 'T00:00:00')) / 86400000
  if (diff < 0 || diff > 6) { okRange = false; console.log('   ↳ 越界: ' + d + ' → ' + mon) }
}
t('4. 8 个日期（含闰日/跨年/月末）换算结果全是周一', okMon)
t('5. 且不晚于输入、相差 0–6 天', okRange)

const g102 = S.graceKeysOf('2026-10-02')
t('6. 10-02 的可补集合 = 本周一~昨天（4 天）',
  g102.join(',') === '2026-09-28,2026-09-29,2026-09-30,2026-10-01', g102.join(','))
t('7. 今天恰是周一时该集合为空（没有可补的过去日期）', S.graceKeysOf('2026-10-05').length === 0)
const g104 = S.graceKeysOf('2026-10-04')
t('8. 周日看：可补 6 天且末位是周六', g104.length === 6 && g104[5] === '2026-10-03', g104.length + '/' + g104[5])

t('9. 昨天在宽限期内', S.isGraceKey('2026-10-01', '2026-10-02') === true)
t('10. 上周日在宽限期外', S.isGraceKey('2026-09-27', '2026-10-02') === false)
t('11. 今天不算「补卡」', S.isGraceKey('2026-10-02', '2026-10-02') === false)
t('12. 未来日期不算', S.isGraceKey('2026-10-03', '2026-10-02') === false)

/* ================= 组 2：写盘与留痕（跟随系统当天） ================= */
reset()
const T = S.todayKeyOf()
const GRACE = S.graceKeysOf(T)
const YEST = GRACE.length ? GRACE[GRACE.length - 1] : null

const h1 = S.addHabit('背单词')
t('13. 新建习惯带空的 backfilled 字典', h1.backfilled && typeof h1.backfilled === 'object' && Object.keys(h1.backfilled).length === 0)

S.toggleHabitRecord(h1.id, T)
let cur = S.loadHabits()[0]
t('14. 打今天的卡 → records 有该日期', cur.records[T] === true)
t('15. 且没被记成补卡（backfilled 为空）', Object.keys(cur.backfilled).length === 0)
t('16. isBackfilled(今天) 为假', S.isBackfilled(cur, T) === false)

if (YEST) {
  S.toggleHabitRecord(h1.id, YEST)
  cur = S.loadHabits()[0]
  t('17. 补昨天的卡 → 写进 records', cur.records[YEST] === true)
  t('18. 同时记一笔 backfilled（补卡留痕）', cur.backfilled[YEST] === true)
  t('19. isBackfilled(昨天) 为真', S.isBackfilled(cur, YEST) === true)
  t('20. 留痕确实落盘到 web2.habits', JSON.parse(store['web2.habits'])[0].backfilled[YEST] === true)
  t('21. 累计天数把补的卡也算进去 = 2', S.totalDoneOf(cur) === 2)
  t('22. 连续天数把补的卡也算 = 2', S.streakOf(cur, T) === 2)

  S.toggleHabitRecord(h1.id, YEST) // 取消补卡
  cur = S.loadHabits()[0]
  t('23. 取消补卡 → records 与 backfilled 同时清掉', !cur.records[YEST] && !cur.backfilled[YEST])
  S.toggleHabitRecord(h1.id, YEST) // 还原，供后续用例
} else {
  skip('17–23 补卡写入与留痕', '系统今天是周一，本周尚无过去日期')
}

/* 越界守卫 */
const BEFORE = (() => { const d = new Date(T + 'T00:00:00'); d.setDate(d.getDate() - 8); return S.todayKeyOf(d) })()
const NEXT = (() => { const d = new Date(T + 'T00:00:00'); d.setDate(d.getDate() + 1); return S.todayKeyOf(d) })()
const before2 = JSON.stringify(S.loadHabits())
t('24. 越界（8 天前）→ 返回 null', S.toggleHabitRecord(h1.id, BEFORE) === null)
t('25. 越界（明天）→ 返回 null', S.toggleHabitRecord(h1.id, NEXT) === null)
t('26. 越界调用没碰落盘数据', JSON.stringify(S.loadHabits()) === before2)
t('27. 不存在的 id → null', S.toggleHabitRecord('hab_nope', T) === null)

/* ================= 组 3：连续天数回溯 ================= */
reset()
const back = (n) => { const d = new Date(T + 'T00:00:00'); d.setDate(d.getDate() - n); return S.todayKeyOf(d) }
store['web2.habits'] = JSON.stringify([{
  id: 'hab_x', name: '晨跑', created_at: '2026-01-01T00:00:00.000Z',
  records: { [back(1)]: true, [back(2)]: true, [back(3)]: true }, backfilled: {},
}])
const hx = S.loadHabits()[0]
t('28. 今天没打但昨天起连 3 天 → 连续天数 3', S.streakOf(hx, T) === 3)
t('29. 断链即归零（再往前那天没记录）', S.streakOf(hx, back(4)) === 0)

/* ================= 组 4：整形与兼容 ================= */
reset()
store['web2.habits'] = JSON.stringify([
  { id: 'hab_old', name: '老数据', created_at: '2026-01-01T00:00:00.000Z', records: { '2026-09-01': true } },
  { id: 'hab_bad', name: '坏键', records: { '2026-9-1': true, abc: true, '2026-09-02': true } },
  { id: 'hab_orphan', name: '孤儿留痕', records: {}, backfilled: { '2026-09-03': true } },
  { id: '', name: '   ', records: {} },
])
const shaped = S.loadHabits()
t('30. 老数据（无 backfilled 字段）能读，补成空字典', shaped[0].backfilled && Object.keys(shaped[0].backfilled).length === 0)
t('31. 非零填充/非日期的键被剔除', Object.keys(shaped[1].records).join(',') === '2026-09-02', Object.keys(shaped[1].records).join(','))
t('32. backfilled 有而 records 没有的键被清掉（一致性地板）', Object.keys(shaped[2].backfilled).length === 0)
t('33. 空名习惯被剔除（4 条进 3 条出）', shaped.length === 3, shaped.length)

/* 导出 / 导入闭环 */
reset()
const doc = JSON.stringify({
  app: 'sched', schema_version: 1, exported_at: '2026-10-02T00:00:00.000Z',
  semester: { name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 18, periods: [] },
  schedules: [], todos: [], meta: {},
})
S.importFromText(doc)
const hNew = S.addHabit('导入前建的')
S.toggleHabitRecord(hNew.id, T)
const out = JSON.parse(S.exportImportedText())
t('34. 导出文本带 habits 数组', Array.isArray(out.habits) && out.habits.length === 1)
t('35. 导出条目含 backfilled 字段', out.habits[0].backfilled && typeof out.habits[0].backfilled === 'object')

S.importFromText(JSON.stringify({
  ...JSON.parse(doc),
  habits: [{
    id: 'hab_imp', name: '导入的习惯',
    /* 不变式：backfilled ⊆ records（补卡时两个字典写同一个 key）——
       这里 09-20 是当天打的、09-19 是补的，所以 records 两个都有 */
    records: { '2026-09-20': true, '2026-09-19': true },
    backfilled: { '2026-09-19': true },
    created_at: '2026-01-01T00:00:00.000Z',
  }],
}))
const after = S.loadHabits()
t('36. 导入整体接管（旧习惯不在）', after.length === 1 && after[0].name === '导入的习惯', JSON.stringify(after.map((x) => x.name)))
t('37. 导入进来的补卡留痕被保留', S.isBackfilled(after[0], '2026-09-19') === true)
t('38. 真打的卡不被误标成补卡', S.isBackfilled(after[0], '2026-09-20') === false)

console.log('\n' + (fail === 0 ? '=== ALL PASS ===' : '=== FAIL ===') + `  ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
