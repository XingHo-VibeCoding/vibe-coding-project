/* M5 第 1/3 步单测：courseCovering（开录时把场次关联到课程）纯函数。

   规则（两条都只看课自己的起止时间，不看课间长度）：
   ① 覆盖 = m ∈ [start-5, end]；多节同时覆盖时取 end 最晚的那节（课间 <5 分钟才可能重叠）。
   ② 命中的课剩余不足 COVER_TAIL_MIN 分钟 → 返回 null（不认），避免刚开录就被按
      「前一节下课+2 分钟」掐断。
   不命中一律返回 null（绝不拿「今天第一节」兜底顶替）。

   课间长度是用户可改的（默认 10 分钟，也可能是 3 分钟甚至 90 分钟午休），
   所以第 7/9 组专门覆盖「同一时刻、不同作息」的对照。 */
const store = {}
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
}
globalThis.window = globalThis

const { courseCovering, minOf, COVER_TAIL_MIN } = await import('../src/data/store.js')

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
t('3b 课间 10 分时两节各管各的', courseCovering(COURSES, minOf('10:45'))?.id === 'c2' && courseCovering(COURSES, minOf('10:35'))?.id === 'c1')

/* 4. 下课后不命中；下课那一分钟也不再认成本节（会触发「刚开录就掐停」） */
t('4 下课 5 分钟后 → 不命中', courseCovering(COURSES, minOf('11:45')) === null)
t('4b 下课时刻整 → 不认（剩余 0 分钟）', courseCovering(COURSES, minOf('11:40')) === null)

/* 5. 绝不兜底：空闲时段返回 null */
t('5 无课时段 → null（不拿第一节顶替）', courseCovering(COURSES, minOf('15:00')) === null)
t('5b 空列表 → null', courseCovering([], minOf('10:00')) === null)
t('5c 入参 undefined → null（不抛）', courseCovering(undefined, minOf('10:00')) === null)

/* 6. 独立日程同样可命中（events 落位后的形状与课程一致） */
const EV = [{ id: 'e1', title: '讲座', start: '14:00', end: '15:30' }]
t('6 独立日程也能命中', courseCovering(EV, minOf('14:30'))?.id === 'e1')

/* ---------- 7. 课间长度不写死：同一时刻、不同作息的对照 ----------
   固定场景：前一节 08:00–08:45，学生 08:45 到教室为「下一节」开录。
   下一节开始时间随课间变化，看判定怎么走。 */
const fmt = (x) => String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0')
function twoPeriods(gapMin) {
  const e1 = minOf('08:45')
  const s2 = e1 + gapMin
  return [
    { id: 'p1', title: '前一节', start: '08:00', end: fmt(e1) },
    { id: 'p2', title: '后一节', start: fmt(s2), end: fmt(s2 + 45) },
  ]
}
const AT = minOf('08:45')
t('7a 课间 10 分：08:45 落在空窗 → 不认（不误挂前一节）', courseCovering(twoPeriods(10), AT) === null)
t('7b 课间 15 分：同样不认', courseCovering(twoPeriods(15), AT) === null)
t('7c 课间 6 分：仍不认（后一节提前窗 08:46 还没到）', courseCovering(twoPeriods(6), AT) === null)
t('7d 课间 5 分：后一节提前窗已盖到 08:45 → 认后一节', courseCovering(twoPeriods(5), AT)?.id === 'p2')
t('7e 课间 3 分：认后一节', courseCovering(twoPeriods(3), AT)?.id === 'p2')
t('7f 课间 2 分：认后一节', courseCovering(twoPeriods(2), AT)?.id === 'p2')
t('7g 课间 0 分（两节紧挨）：仍认后一节，不误挂前一节', courseCovering(twoPeriods(0), AT)?.id === 'p2')
t('7h 课间 95 分（午休式）：不认', courseCovering(twoPeriods(95), AT) === null)

/* ---------- 8. 「快下课不认」的边界 ---------- */
const tail = [{ id: 'x', title: '某课', start: '08:00', end: '08:45' }]
t('8a 剩余 10 分 → 认', courseCovering(tail, minOf('08:35'))?.id === 'x')
t('8b 剩余 3 分 → 仍认（阈值边界，含）', courseCovering(tail, minOf('08:42'))?.id === 'x')
t('8c 剩余 2 分 → 不认', courseCovering(tail, minOf('08:43')) === null)
t('8d 剩余 1 分 → 不认', courseCovering(tail, minOf('08:44')) === null)
t('8e 阈值常量为 3 分钟', COVER_TAIL_MIN === 3, String(COVER_TAIL_MIN))

/* ---------- 9. 午休 / 晚休大空窗（默认作息的第 5→6、10→11 节） ---------- */
const rest = [
  { id: 'n5', title: '第5节', start: '11:40', end: '12:25' },
  { id: 'n6', title: '第6节', start: '14:00', end: '14:45' },
  { id: 'n10', title: '第10节', start: '17:40', end: '18:25' },
  { id: 'n11', title: '第11节', start: '19:00', end: '19:45' },
]
t('9a 午休前最后一刻 12:25 开录 → 不认', courseCovering(rest, minOf('12:25')) === null)
t('9b 12:20（剩 5 分）→ 仍认第 5 节', courseCovering(rest, minOf('12:20'))?.id === 'n5')
t('9c 午休中 13:00 → 不认（90 分钟空窗不硬塞课）', courseCovering(rest, minOf('13:00')) === null)
t('9d 13:54（提前 6 分）→ 不认', courseCovering(rest, minOf('13:54')) === null)
t('9e 13:55（提前 5 分）→ 认第 6 节', courseCovering(rest, minOf('13:55'))?.id === 'n6')
t('9f 晚休前最后一刻 18:25 开录 → 不认', courseCovering(rest, minOf('18:25')) === null)
t('9g 晚休空窗 18:50 → 不认', courseCovering(rest, minOf('18:50')) === null)
t('9h 18:55（提前 5 分）→ 认第 11 节', courseCovering(rest, minOf('18:55'))?.id === 'n11')

/* ---------- 10. 真实默认作息（13 节，与 store.js defaultPeriods 一致）全天扫描 ---------- */
const DEFAULT13 = [
  { id: 'd1', title: '第1节', start: '08:00', end: '08:45' },
  { id: 'd2', title: '第2节', start: '08:55', end: '09:40' },
  { id: 'd3', title: '第3节', start: '09:50', end: '10:35' },
  { id: 'd4', title: '第4节', start: '10:45', end: '11:30' },
  { id: 'd5', title: '第5节', start: '11:40', end: '12:25' },
  { id: 'd6', title: '第6节', start: '14:00', end: '14:45' },
  { id: 'd7', title: '第7节', start: '14:55', end: '15:40' },
  { id: 'd8', title: '第8节', start: '15:50', end: '16:35' },
  { id: 'd9', title: '第9节', start: '16:45', end: '17:30' },
  { id: 'd10', title: '第10节', start: '17:40', end: '18:25' },
  { id: 'd11', title: '第11节', start: '19:00', end: '19:45' },
  { id: 'd12', title: '第12节', start: '19:55', end: '20:40' },
  { id: 'd13', title: '第13节', start: '20:50', end: '21:35' },
]
let badMin = null
for (let m = 0; m < 1440; m++) {
  const hit = courseCovering(DEFAULT13, m)
  if (hit && minOf(hit.end) - m < COVER_TAIL_MIN) { badMin = m; break }
}
t('10a 全天 1440 分钟扫描：认出的课剩余都 ≥ 阈值', badMin === null, badMin === null ? '' : `违反于 ${badMin}`)

const selfHit = DEFAULT13.filter((c) => courseCovering(DEFAULT13, minOf(c.end))?.id === c.id)
t('10b 13 节课的下课那一分钟都不再被认成本节', selfHit.length === 0, selfHit.map((c) => c.title).join(','))

const earlyOk = DEFAULT13.filter((c) => courseCovering(DEFAULT13, minOf(c.start) - 5)?.id !== c.id)
t('10c 每节课开课前 5 分钟都能认出它', earlyOk.length === 0, earlyOk.map((c) => c.title).join(','))

const earlyBad = DEFAULT13.filter((c) => courseCovering(DEFAULT13, minOf(c.start) - 6) !== null)
t('10d 每节课开课前 6 分钟都认不出（提前量就是 5 分钟）', earlyBad.length === 0, earlyBad.map((c) => c.title).join(','))

const fails = results.filter((r) => !r[1])
console.log(`\n=== courseCovering 单测：${results.length - fails.length}/${results.length} 通过 ===`)
process.exit(fails.length ? 1 : 0)
