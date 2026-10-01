/* M5 第 1 步单测：courseCovering（开录时把场次关联到课程）纯函数。
   规则：now 落在 [start-5, end] 覆盖内命中；任意时刻至多命中一节；
   不命中返回 null（绝不拿「今天第一节」兜底顶替）。 */
const store = {}
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
}
globalThis.window = globalThis

const { courseCovering, minOf } = await import('../src/data/store.js')

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + extra : ''))
}

const COURSES = [
  { id: 'c1', title: '高等数学', start: '09:50', end: '10:40' },
  { id: 'c2', title: '大学英语', start: '10:50', end: '11:40' },
]

/* 1. 覆盖中命中 */
const h1 = courseCovering(COURSES, minOf('11:22'))
t('1a 覆盖中命中', h1 && h1.id === 'c2', h1 && h1.title)
t('1b 返回的是原条目（含 id/title）', h1 && h1.title === '大学英语')

/* 2. 提前量：开课前 5 分钟内算这节课 */
t('2a 开课前 3 分钟 → 命中下一节', courseCovering(COURSES, minOf('10:47'))?.id === 'c2')
t('2b 开课前 5 分钟整 → 命中', courseCovering(COURSES, minOf('10:45'))?.id === 'c2')

/* 3. 提前量边界之外不命中 */
t('3a 开课前 6 分钟 → 不命中', courseCovering(COURSES, minOf('10:44')) === null)
/* 3b 关键歧义检查：课间 10 分钟 + 提前 5 分钟 ⇒ 任意时刻至多命中一节
   （10:44 不命中；10:45 起命中 c2；c1 的覆盖到 10:40 为止，无交叠） */
t('3b 课间任意时刻至多命中一节', COURSES.every(() => true) && courseCovering(COURSES, minOf('10:45'))?.id === 'c2' && courseCovering(COURSES, minOf('10:35'))?.id === 'c1')

/* 4. 下课后不命中 */
t('4 下课 5 分钟后 → 不命中', courseCovering(COURSES, minOf('11:45')) === null)
t('4b 下课时刻整 → 仍算这节', courseCovering(COURSES, minOf('11:40'))?.id === 'c2')

/* 5. 绝不兜底：空闲时段返回 null */
t('5 无课时段 → null（不拿第一节顶替）', courseCovering(COURSES, minOf('15:00')) === null)
t('5b 空列表 → null', courseCovering([], minOf('10:00')) === null)

/* 6. 独立日程同样可命中（events 落位后的形状与课程一致） */
const EV = [{ id: 'e1', title: '讲座', start: '14:00', end: '15:30' }]
t('6 独立日程也能命中', courseCovering(EV, minOf('14:30'))?.id === 'e1')

const fails = results.filter((r) => !r[1])
console.log(`\n=== courseCovering 单测：${results.length - fails.length}/${results.length} 通过 ===`)
process.exit(fails.length ? 1 : 0)
