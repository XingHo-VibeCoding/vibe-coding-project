/* 三期 Step 2 单测：web2 数据层的固定循环日程（routine）读写。
   覆盖：双源分支（导入态写主表 / 示例态写 web2.events overlay）、字段形状、
   overlay 里 event 与 routine 互不串、改删双源、以及金标准「导出文本能过主项目 importAll」。
   跑法：node tmp/routine-unit.mjs（web2 目录下） */
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
const reset = () => Object.keys(store).forEach((k) => delete store[k])

const docText = (schedules = []) => JSON.stringify({
  app: 'sched',
  schema_version: 1,
  exported_at: new Date().toISOString(),
  semester: { name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 18, periods: [] },
  schedules,
  todos: [],
  meta: {},
})
const COURSE = { id: 'c1', type: 'course', title: '高等数学', location: 'A101', weekday: 1, start_time: '08:00', duration: 45, week_rule: 'every', date: null }

/* ================= 组 1：示例态（无导入）→ 写 overlay ================= */
reset()
const r1 = S.addRoutine({ title: '健身', weekday: 3, start_time: '18:00', duration: 90 })
t('1. 无导入态时写进 web2.events overlay', !!store['web2.events'] && JSON.parse(store['web2.events']).length === 1)
t('2. id 前缀 rout_', String(r1.id).startsWith('rout_'))
t('3. type = routine', r1.type === 'routine')
t('4. weekday 存成数字', r1.weekday === 3)
t('5. week_rule 缺省写死 every（不靠主项目补）', r1.week_rule === 'every')
t('6. date 为 null（没当成 event）', r1.date === null)
t('7. semester_id 空串（跨学期常驻）', r1.semester_id === '')
t('8. title / start_time / duration 正确', r1.title === '健身' && r1.start_time === '18:00' && r1.duration === 90)

/* ================= 组 2：读回（loadDataset） ================= */
const ds1 = S.loadDataset()
t('9. loadDataset 多返回一路 routines', Array.isArray(ds1.routines) && ds1.routines.length === 1)
const d0 = ds1.routines[0]
t('10. 显示形状：type/name/start/end 正确（end 由 duration 算）', d0 && d0.type === 'routine' && d0.name === '健身' && d0.start === '18:00' && d0.end === '19:30')
t('11. weekday 保留', d0 && d0.weekday === 3)
t('12. tag 由 week_rule 派生', d0 && d0.tag === '每周')

/* ================= 组 3：overlay 里 event 与 routine 互不串 ================= */
S.addEvent({ title: '班会', date: '2026-10-08', start_time: '19:00', duration: 60 })
const ds2 = S.loadDataset()
t('13. routines 仍只含循环日程', ds2.routines.length === 1 && ds2.routines[0].name === '健身')
t('14. events 只含独立日程（routine 没混进去）', ds2.events.some((e) => e.name === '班会') && !ds2.events.some((e) => e.name === '健身'))
t('15. 两者同存一个键 web2.events', JSON.parse(store['web2.events']).length === 2)

/* ================= 组 4：导入态 → 写主表 ================= */
reset()
S.importFromText(docText([COURSE]))
const r2 = S.addRoutine({ title: '晨跑', weekday: 1, start_time: '06:30', duration: 30 })
const inMain = JSON.parse(store['web2.data']).schedules
t('16. 导入态下写进主表 data.schedules', inMain.length === 2 && inMain.some((s) => s.type === 'routine' && s.title === '晨跑'))
t('17. 导入态下不写 overlay', !store['web2.events'])
const ds3 = S.loadDataset()
t('18. 从导入数据读回 routine', ds3.routines.length === 1 && ds3.routines[0].name === '晨跑')
t('19. 课程仍在（没被 routine 挤掉）', ds3.courses.some((c) => c.name === '高等数学'))

/* ================= 组 5：金标准——导出文本能过主项目 importAll ================= */
const { createRequire } = await import('node:module')
const require = createRequire(import.meta.url)
require('D:/Document/Project/vibe-coding-project/js/store.js')
const imp = Store.importAll(S.exportImportedText())
t('20. 含 routine 的导出文本能过主项目 importAll', imp.ok === true, imp.error)
t('21. 主项目里 routine 落进 schedules 且字段完整', (Store.load().schedules || []).some((s) => s.type === 'routine' && s.title === '晨跑' && s.weekday === 1 && s.week_rule === 'every'))

/* ================= 组 6：改 / 删（导入态） ================= */
S.updateRoutine(r2.id, { start: '07:00', end: '07:45', name: '晨跑（改）' })
const ds4 = S.loadDataset()
t('22. 改：读回是新值', ds4.routines[0].name === '晨跑（改）' && ds4.routines[0].start === '07:00' && ds4.routines[0].end === '07:45')
const rawUpd = JSON.parse(store['web2.data']).schedules.find((s) => s.type === 'routine')
t('23. 改：写回主表原始字段（duration 由起止重算）', rawUpd.title === '晨跑（改）' && rawUpd.start_time === '07:00' && rawUpd.duration === 45)
t('24. 改：不误伤课程', JSON.parse(store['web2.data']).schedules.some((s) => s.type === 'course' && s.title === '高等数学'))
t('25. 删：导入态下生效', S.removeRoutine(r2.id) === true && S.loadDataset().routines.length === 0)

/* ================= 组 7：改 / 删（示例态）+ 老数据兼容 ================= */
reset()
const r3 = S.addRoutine({ title: '晨跑', weekday: 1, start_time: '06:30', duration: 30 })
t('26. 示例态改生效', S.updateRoutine(r3.id, { name: '晨跑2' }) === true && S.loadDataset().routines[0].name === '晨跑2')
t('27. 示例态删生效', S.removeRoutine(r3.id) === true && S.loadDataset().routines.length === 0)
t('28. 删不存在的 id 返回 false', S.removeRoutine('nope') === false)

/* 老 overlay 条目没有 type 字段 → 应视为独立日程，不能被当成 routine */
store['web2.events'] = JSON.stringify([{ id: 'evt_old', title: '老日程', date: '2026-10-09', start_time: '10:00', duration: 60 }])
const ds5 = S.loadDataset()
t('29. 无 type 的老条目算 event、不算 routine', ds5.routines.length === 0 && ds5.events.some((e) => e.name === '老日程'))

console.log(`\n结果：${pass} 过，${fail} 挂`)
process.exit(fail ? 1 : 0)
