// 复现「课程时间设置页分了 4 个时间段」的根因（2026-09-30 用户反馈）
// 用法：node tmp/seg4-repro-check.mjs（在 web2 目录下）
import { segmentView, shiftWithinSegment, reperiodAll, addPeriodToSegment } from '../src/data/periods.js'

// 默认 13 节（store.js defaultPeriods 口径：上午5+下午5+晚上3，每节45、课间10）
const DEF = [
  { no: 1, start: '08:00', end: '08:45' },
  { no: 2, start: '08:55', end: '09:40' },
  { no: 3, start: '09:50', end: '10:35' },
  { no: 4, start: '10:45', end: '11:30' },
  { no: 5, start: '11:40', end: '12:25' },
  { no: 6, start: '14:00', end: '14:45' },
  { no: 7, start: '14:55', end: '15:40' },
  { no: 8, start: '15:50', end: '16:35' },
  { no: 9, start: '16:45', end: '17:30' },
  { no: 10, start: '17:40', end: '18:25' },
  { no: 11, start: '19:00', end: '19:45' },
  { no: 12, start: '19:55', end: '20:40' },
  { no: 13, start: '20:50', end: '21:35' },
]
// 修复后 goObForm 的初始化口径：同一张表 + 显式 seg（1×5 / 2×5 / 3×3）
const DEF_SEG = DEF.map((p, i) => ({ ...p, seg: i < 5 ? 1 : i < 10 ? 2 : 3 }))

let pass = 0, fail = 0
function t(name, got, want) {
  const ok = got === want
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got} want=${want}`)
  ok ? pass++ : fail++
}
const segLens = (periods) => segmentView(periods).map((g) => g.nos.length).join('+')

console.log('--- A. 默认表（无 seg，派生分段） ---')
t('A1 初始段数', segmentView(DEF).length, 3)
t('A2 初始分段', segLens(DEF), '5+5+3')

console.log('--- B. 不碰时长/课间，直接把第3节开始 09:50 → 10:20（用户最常见操作） ---')
const b = shiftWithinSegment(DEF.map((p) => ({ ...p })), 1, 2, '10:20', 45, '09:50')
console.log('   shift ok?', b.ok, b.ok ? `第3节=${b.periods[2].start}-${b.periods[2].end} 第5节=${b.periods[4].start}-${b.periods[4].end}` : b.reason)
if (b.ok) {
  t('B1 段数（复现用户看到的 4 段）', segmentView(b.periods).length, 4)
  t('B2 分段形状', segLens(b.periods), '2+3+5+3')
}

console.log('--- C. 同一张表但带显式 seg（修复口径），同样改第3节 ---')
const c = shiftWithinSegment(DEF_SEG.map((p) => ({ ...p })), 1, 2, '10:20', 45, '09:50')
console.log('   shift ok?', c.ok, c.ok ? '' : c.reason)
if (c.ok) {
  t('C1 段数（固定 3 块）', segmentView(c.periods).length, 3)
  t('C2 分段形状', segLens(c.periods), '5+5+3')
}

console.log('--- D. 带 seg 后改时长（reperiodAll 不应破坏 3 段） ---')
const d = reperiodAll(DEF_SEG.map((p) => ({ ...p })), { dur: 50, gap: 10 })
t('D1 reperiodAll ok', d.ok, true)
if (d.ok) t('D2 段数', segmentView(d.periods).length, 3)

console.log('--- E. 带 seg 后段尾加一节（应进对应段，不加段） ---')
const e = addPeriodToSegment(DEF_SEG.map((p) => ({ ...p })), 3, { dur: 45, gap: 10 })
t('E1 addPeriod ok', e.ok, true)
if (e.ok) {
  t('E2 段数', segmentView(e.periods).length, 3)
  t('E3 分段形状', segLens(e.periods), '5+5+4')
}

console.log(`\n== ${pass} pass / ${fail} fail ==`)
process.exit(fail ? 1 : 0)
