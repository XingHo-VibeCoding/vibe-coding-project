/* M5 第 2 步单测：nextCourseDate（纪要作业转待办的截止日）纯函数。
   规则：本周今天之后还排着这门课（且符合周次规则）→ 本周那次；
   否则下周同一槽位；学期周数外 / 无槽位 / 缺 firstMonday → null（调用方回落明天）。 */
const store = {}
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
}
globalThis.window = globalThis

const { nextCourseDate } = await import('../src/data/store.js')

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + extra : ''))
}

// 2026-10-05 是周一。semester.week=1、firstMonday=2026-10-05 时：
// weekday 1 → 10-05，2 → 10-06 … 7 → 10-11；下周 +7。
const SEM = { week: 1, firstMonday: '2026-10-05', totalWeeks: 16 }
// 高数：周一 + 周三两节；英语：只周四；体育：只周五（单周）；线代：只周二（双周）
const COURSES = [
  { name: '高等数学', weekday: 1, week_rule: 'every' },
  { name: '高等数学', weekday: 3, week_rule: 'every' },
  { name: '大学英语', weekday: 4, week_rule: 'every' },
  { name: '体育', weekday: 5, week_rule: 'odd' },
  { name: '线性代数', weekday: 2, week_rule: 'even' },
]

/* 1. 本周后面还有这节课 → 用本周的 */
t('1a 周一录高数 → 本周周三(10-07)', nextCourseDate(COURSES, SEM, 1, '高等数学') === '2026-10-07', nextCourseDate(COURSES, SEM, 1, '高等数学'))
t('1b 周二录高数 → 本周周三', nextCourseDate(COURSES, SEM, 2, '高等数学') === '2026-10-07')
t('1c 周三当天录高数（当天已上过）→ 下周一(10-12)', nextCourseDate(COURSES, SEM, 3, '高等数学') === '2026-10-12', nextCourseDate(COURSES, SEM, 3, '高等数学'))

/* 2. 本周没有后面的槽 → 下周 */
t('2a 周五录英语 → 下周四(10-15)', nextCourseDate(COURSES, SEM, 5, '大学英语') === '2026-10-15', nextCourseDate(COURSES, SEM, 5, '大学英语'))
t('2b 周日录英语 → 下周四', nextCourseDate(COURSES, SEM, 7, '大学英语') === '2026-10-15')

/* 3. 周次规则：本周不符合就顺延到下周符合的那次 */
// SEM.week=1（单周）：体育 odd 本周五 10-09 符合
t('3a 单周(1)录体育 → 本周五(10-09)', nextCourseDate(COURSES, SEM, 1, '体育') === '2026-10-09', nextCourseDate(COURSES, SEM, 1, '体育'))
// 线代 even：第 1 周周二不符合 → 下周第 2 周周二 10-13
t('3b 双周课在本周不符 → 下周周二(10-13)', nextCourseDate(COURSES, SEM, 1, '线性代数') === '2026-10-13', nextCourseDate(COURSES, SEM, 1, '线性代数'))
// 周三之后找线代：本周(1)不符、下周(2)周二已过？不——下周是整周比较（wk+1 的周二 10-13 仍 > 不比较），取下周周二
t('3c 周五找双周课 → 下周周二(10-13)', nextCourseDate(COURSES, SEM, 5, '线性代数') === '2026-10-13')

/* 4. 学期边界 */
t('4a 最后一周的课找不到下次 → null（回落明天）', nextCourseDate(COURSES, { week: 16, firstMonday: '2026-10-05', totalWeeks: 16 }, 7, '高等数学') === null)
t('4b 第一周周四找体育：本周五符合', nextCourseDate(COURSES, SEM, 4, '体育') === '2026-10-09')

/* 5. 兜底与畸形输入 */
t('5a 没这门课 → null', nextCourseDate(COURSES, SEM, 1, '不存在') === null)
t('5b 缺 firstMonday → null', nextCourseDate(COURSES, { week: 1, totalWeeks: 16 }, 1, '高等数学') === null)
t('5c semester 为 null → null', nextCourseDate(COURSES, null, 1, '高等数学') === null)
t('5d 空课表 → null', nextCourseDate([], SEM, 1, '高等数学') === null)

const fails = results.filter((r) => !r[1])
console.log(`\n=== nextCourseDate 单测：${results.length - fails.length}/${results.length} 通过 ===`)
process.exit(fails.length ? 1 : 0)
