/* 三期 Step 5 单测：冲突检测收口后的 findConflicts。
   覆盖：课程 ↔ 循环日程 双向、单双周错开、编辑自己不算、不同天不算、
   独立日程按「那一天 + 那一周」比对（缺学期锚点不猜）、dayScope 换算。
   跑法：node tmp/routine-conflict-unit.mjs（web2 目录下） */
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

const SEM = { name: '2026-2027 秋冬', firstMonday: '2026-09-07', totalWeeks: 18 }

/* 显示形状的三个样本（跟 web2 里实际喂给 findConflicts 的形状一致） */
const course = (o = {}) => ({ id: 'c1', type: 'course', name: '高等数学', weekday: 3, start: '08:00', end: '09:35', week_rule: 'every', ...o })
const routine = (o = {}) => ({ id: 'r1', type: 'routine', name: '健身', weekday: 3, start: '08:30', end: '10:00', week_rule: 'every', ...o })
/* 独立日程要带算好的 weekday / weekNo（App.vue 的 conflictPool 就是这么给的） */
function eventOn(dateStr, o = {}) {
  const sc = S.dayScope(dateStr, SEM)
  return { id: 'e1', type: 'event', name: '班会', date: dateStr, weekday: sc ? sc.weekday : null, weekNo: sc ? sc.weekNo : null, start: '08:30', end: '10:00', ...o }
}

/* ================= 组 1：课程 ↔ 循环日程 双向 ================= */
let r = S.findConflicts(course(), [routine()])
t('1. 课程新增时能查出重叠的循环日程', r.length === 1 && r[0].name === '健身', JSON.stringify(r))

r = S.findConflicts(routine(), [course()])
t('2. 循环日程新增时能查出重叠的课程（反向）', r.length === 1 && r[0].name === '高等数学')

r = S.findConflicts(course(), [routine({ start: '10:00', end: '11:00' })])
t('3. 时间不重叠不算冲突', r.length === 0)

r = S.findConflicts(course(), [routine({ weekday: 4 })])
t('4. 不同天不算冲突', r.length === 0)

r = S.findConflicts(course(), [routine({ id: 'c1' })])
t('5. 编辑自己不算冲突（同 id）', r.length === 0)

r = S.findConflicts(course({ weekday: 3 }), [routine({ weekday: 3 }), routine({ id: 'r2', weekday: 3, start: '09:00', end: '09:30', name: '自习' })])
t('6. 多条同时重叠全部返回', r.length === 2, JSON.stringify(r.map((x) => x.name)))

/* ================= 组 2：单双周错开 ================= */
r = S.findConflicts(course({ week_rule: 'odd' }), [routine({ week_rule: 'even' })])
t('7. 单周课 vs 双周循环日程 → 错开不算冲突', r.length === 0)

r = S.findConflicts(course({ week_rule: 'odd' }), [routine({ week_rule: 'every' })])
t('8. 单周课 vs 每周循环日程 → 仍算冲突（单周确实撞）', r.length === 1)

r = S.findConflicts(course({ week_rule: 'odd' }), [routine({ week_rule: 'odd' })])
t('9. 同为单周 → 冲突', r.length === 1)

/* ================= 组 3：独立日程按「那一天 + 那一周」比对 ================= */
/* 2026-09-09 是第 1 学期的周三（第 1 周）；2026-09-16 是第 2 周的周三 */
r = S.findConflicts(eventOn('2026-09-09'), [course()])
t('10. 独立日程 vs 当天每周课 → 冲突', r.length === 1, JSON.stringify(r.map((x) => x.name)))

r = S.findConflicts(eventOn('2026-09-09'), [course({ week_rule: 'odd' })])
t('11. 独立日程落在单周，前者的课是单周 → 冲突', r.length === 1)

r = S.findConflicts(eventOn('2026-09-16'), [course({ week_rule: 'odd' })])
t('12. 同样单周课，但日期落在第 2 周（双周）→ 不冲突', r.length === 0)

r = S.findConflicts(eventOn('2026-09-16'), [course({ week_rule: 'even' })])
t('13. 双周课在第 2 周 → 冲突', r.length === 1)

r = S.findConflicts(eventOn('2026-09-09'), [{ ...eventOn('2026-09-16'), id: 'e2' }])
t('14. 两条独立日程不同天 → 不冲突', r.length === 0)

r = S.findConflicts(eventOn('2026-09-09'), [{ ...eventOn('2026-09-09'), id: 'e2' }])
t('15. 两条独立日程同天同时段 → 冲突', r.length === 1)

r = S.findConflicts(eventOn('2026-09-09', { weekNo: null }), [course()])
t('16. 换算不出周次（缺学期锚点）→ 不猜、不报', r.length === 0)

/* 周期型目标 vs 列表里的独立日程：日期对不上星期几的含义，不参与（负向断言） */
r = S.findConflicts(course(), [eventOn('2026-09-09')])
t('17. 周期型目标不把独立日程当周期冲突（date 类只在反向成立）', r.length === 1 && r[0].type === 'event', JSON.stringify(r.map((x) => x.type)))

/* ================= 组 4：dayScope 换算 ================= */
const s1 = S.dayScope('2026-09-09', SEM)
t('18. dayScope：周三 → weekday 3', s1 && s1.weekday === 3, JSON.stringify(s1))
t('19. dayScope：开学第 1 周的周三 → weekNo 1', s1 && s1.weekNo === 1)
const s2 = S.dayScope('2026-09-16', SEM)
t('20. dayScope：第 2 周 → weekNo 2', s2 && s2.weekNo === 2)
const s3 = S.dayScope('2026-09-02', SEM)
t('21. dayScope：学期开始之前 → weekNo 为 null（不硬编负周）', s3 && s3.weekNo === null, JSON.stringify(s3))
t('22. dayScope：缺学期锚点 → null', S.dayScope('2026-09-09', null) === null)
t('23. dayScope：日期非法 → null', S.dayScope('', SEM) === null)

/* ================= 组 5：weekMatches 单周/双周口径 ================= */
t('24. weekMatches every 任何周都成立', S.weekMatches('every', 1) && S.weekMatches('every', 2))
t('25. weekMatches odd 只认奇数周', S.weekMatches('odd', 3) === true && S.weekMatches('odd', 4) === false)
t('26. weekMatches even 只认偶数周', S.weekMatches('even', 4) === true && S.weekMatches('even', 5) === false)
t('27. weekMatches 缺规则视为 every', S.weekMatches(undefined, 2) === true)

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)
