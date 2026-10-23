/* 复习时间重叠的复现 / 回归脚本（2026-10-23 改口径后）。
   旧模型（bug）：每场考试各自去同一份空档里挖 30 分钟，互相看不见 →
     结构力学Ⅰ / 结构设计原理 / 工程水文学 的块全落在 10-16 19:00–19:30，真机重叠 7 处。
   新模型：**一天只挖一块**，所有考试共用这一段 → 块与块之间不可能重叠。
   注意旧判据（同一 date+start 出现两次就算撞车）现在不再适用：
   per-exam blocks 现在指向**同一天那一段**，同一时刻出现三次是「共用」，不是「撞在一起」。
   界面只显示一段（plan.reviewDays / plan.todayReview）。 */
import { planExams } from '../src/data/exams.js'

const today = '2026-10-16'
const exams = [
  { id: 'a', title: '结构力学Ⅰ', date: '2026-10-19', start: '10:30', end: '12:30', place: '' },
  { id: 'b', title: '结构设计原理', date: '2026-10-20', start: '10:30', end: '12:30', place: '' },
  { id: 'c', title: '工程水文学', date: '2026-10-22', start: '08:00', end: '10:00', place: '' },
]
const itemsOfDay = () => []
const plan = planExams({ exams, today, itemsOfDay, settings: null })

console.log('每天那一段（界面显示的就是这些）：')
for (const d of plan.reviewDays) {
  console.log(' ', d.date, d.time, '→ 这段里有：', d.exams.map((x) => x.title).join('、'))
}

/* 判据一：reviewDays 里同一天只能出现一次 */
const dates = plan.reviewDays.map((d) => d.date)
const dupDate = dates.length - new Set(dates).size

/* 判据二：任意两段的时间区间不重叠（按 date+start+end 判，不按「考试视角」判） */
const blocks = plan.reviewDays.slice().sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start))
let overlap = 0
for (let i = 1; i < blocks.length; i += 1) {
  const p = blocks[i - 1]
  const c = blocks[i]
  if (p.date === c.date && c.start < p.end) overlap += 1
}

/* 判据三：每场考试的 blocks 都指向 reviewDays 里真实存在的那一段（不是各自另算一份） */
const real = new Set(plan.reviewDays.map((d) => d.date + ' ' + d.time))
const stray = plan.exams.reduce((n, e) => n + e.blocks.filter((b) => !real.has(b.date + ' ' + b.time)).length, 0)

console.log('\n同一天出现两段 =', dupDate, '｜时间区间重叠 =', overlap, '｜各自另算的块 =', stray)
console.log(dupDate === 0 && overlap === 0 && stray === 0 ? 'PASS 复习时间不重叠' : 'FAIL 仍有重叠')
process.exit(dupDate === 0 && overlap === 0 && stray === 0 ? 0 : 1)
