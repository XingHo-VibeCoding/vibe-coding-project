/* 三期 Step 5 单测：.ics 导出包含循环日程（用户 2026-10-01 定「要进 ics」）。
   覆盖：逐周展开条数、单双周只展开一半、SUMMARY/LOCATION/DESCRIPTION 字段、
   UID 唯一、不带 routines 时行为与之前完全一致（向后兼容）。
   跑法：node tmp/ics-routine-check.mjs（web2 目录下） */
const store = {}
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
}
globalThis.window = globalThis

const { buildIcs } = await import('../src/data/ics.js')

let pass = 0, fail = 0
function t(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name) }
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  → ' + extra : '')) }
}

/* 2026-09-07 是周一，共 18 周 */
const SEM = { name: '2026-2027 秋冬', firstMonday: '2026-09-07', totalWeeks: 18, week: 1 }
const course = { id: 'c1', type: 'course', name: '高等数学', place: 'A101', weekday: 1, start: '08:00', end: '09:35', week_rule: 'every' }
const routine = { id: 'r1', type: 'routine', name: '健身', place: '体育馆', weekday: 3, start: '18:00', end: '19:30', week_rule: 'every' }
const routineOdd = { id: 'r2', type: 'routine', name: '自习', place: '', weekday: 5, start: '20:00', end: '21:00', week_rule: 'odd' }
const event = { id: 'e1', type: 'event', name: '班会', place: 'B203', date: '2026-09-09', start: '14:00', end: '15:00' }

const vevents = (text) => text.split('BEGIN:VEVENT').length - 1

/* ================= 组 1：循环日程进入导出 ================= */
let r = buildIcs({ semester: SEM, courses: [course], events: [], routines: [routine] })
t('1. 课程 + 循环日程都导出（各 18 周）', r.count === 36, 'count=' + r.count)
t('2. VEVENT 条数与 count 一致', vevents(r.text) === 36, 'vevents=' + vevents(r.text))
t('3. 循环日程的名字出现在 SUMMARY', r.text.includes('SUMMARY:健身'))
t('4. 循环日程的地点进 LOCATION', r.text.includes('LOCATION:2026-2027 秋冬 · 体育馆'))
t('5. DESCRIPTION 标明「循环日程」（日历里点开才看到，不占列表宽度）', r.text.includes('DESCRIPTION:循环日程'))
t('6. 循环日程也带课前 15 分钟提醒', (r.text.match(/TRIGGER:-PT15M/g) || []).length === 36)
t('7. 行尾是 CRLF（RFC 5545 要求）', r.text.includes('BEGIN:VCALENDAR\r\n'))
t('8. UID 全部唯一', (() => {
  const ids = r.text.split('\r\n').filter((l) => l.startsWith('UID:')).map((l) => l.slice(4))
  return ids.length === 36 && new Set(ids).size === 36
})())

/* ================= 组 2：单双周只展开一半 ================= */
r = buildIcs({ semester: SEM, courses: [], events: [], routines: [routineOdd] })
t('9. 单周循环日程 18 周里只展开 9 条', r.count === 9, 'count=' + r.count)
t('10. 单周的 DESCRIPTION 带上「单周」', r.text.includes('DESCRIPTION:循环日程单周'))

const rEven = buildIcs({ semester: SEM, courses: [], events: [], routines: [{ ...routineOdd, id: 'r3', week_rule: 'even' }] })
t('11. 双周同样 9 条', rEven.count === 9)
t('12. 双周的 DESCRIPTION 带上「双周」', rEven.text.includes('DESCRIPTION:循环日程双周'))

/* ================= 组 3：三类混排 ================= */
r = buildIcs({ semester: SEM, courses: [course], events: [event], routines: [routine, routineOdd] })
t('13. 课程 18 + 独立日程 1 + 循环日程 18 + 9 = 46', r.count === 46, 'count=' + r.count)
t('14. 独立日程仍是单次（UID 不带日期后缀）', r.text.includes('UID:e1@sched-web2'))

/* ================= 组 4：向后兼容 / 边界 ================= */
const before = buildIcs({ semester: SEM, courses: [course], events: [event] })
t('15. 不传 routines 时行为与之前一致（19 条）', before.count === 19, 'count=' + before.count)

r = buildIcs({ semester: SEM, courses: [], events: [], routines: [routine] })
t('16. 只有循环日程没有课程也能导出', r.count === 18 && r.text.includes('SUMMARY:健身'))

r = buildIcs({ semester: { ...SEM, firstMonday: '' }, courses: [course], events: [], routines: [routine] })
t('17. 没有学期起始日 → 换算不了日期，返回空文本（与课程同一口径）', r.count === 0 && r.text === '')

r = buildIcs({ semester: SEM, courses: [], events: [], routines: [{ ...routine, type: 'event' }] })
t('18. 传错类型（type 不是 routine）不进导出', r.count === 0)

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)
