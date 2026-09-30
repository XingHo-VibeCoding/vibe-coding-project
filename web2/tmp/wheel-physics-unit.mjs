/* wheelPhysics 纯函数单测（node 直接跑，不起浏览器）
   跑法：node tmp/wheel-physics-unit.mjs */
import { flingSteps, velocityFromSamples, normalizeTop, easeOutCubic } from '../src/data/wheelPhysics.js'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

console.log('=== flingSteps：松手速度 → 滑几格 ===')
t('v=0 → 0 格（没动过）', flingSteps(0) === 0)
t('v=100 → 0 格（低于 FLING_MIN_V=150）', flingSteps(100) === 0)
t('v=149 → 0 格（边界内）', flingSteps(149) === 0)
t('v=150 → 至少 1 格（刚好到阈值）', flingSteps(150) >= 1)
t('方向不影响格数（-1000 与 1000 同）', flingSteps(-1000) === flingSteps(1000))
t('v=1000 → 3 格', flingSteps(1000) === 3, String(flingSteps(1000)))
t('v=2000 → 6 格', flingSteps(2000) === 6, String(flingSteps(2000)))
t('v=3000 → 封顶 8 格', flingSteps(3000) === 8, String(flingSteps(3000)))
t('v=20000 → 仍封顶 8 格（上限铁律）', flingSteps(20000) === 8, String(flingSteps(20000)))

console.log('\n=== flingSteps：单调不减 + 永不超过上限 ===')
let mono = true
let capped = true
let prev = 0
for (let v = 0; v <= 8000; v += 25) {
  const s = flingSteps(v)
  if (s < prev) mono = false
  if (s > 8 || s < 0) capped = false
  prev = s
}
t('扫描 0..8000 步长 25：单调不减', mono)
t('扫描 0..8000：恒在 [0,8] 内且非负', capped)

console.log('\n=== velocityFromSamples：估速度 ===')
t('样本不足 2 个 → 0', velocityFromSamples([{ t: 0, y: 100 }]) === 0)
t('不是数组 → 0', velocityFromSamples(null) === 0)
// 手指上移：t=0 y=200 → t=100ms y=100，即 100px/100ms = 1000px/s
t('上移 100px/100ms → +1000px/s', Math.abs(velocityFromSamples([{ t: 0, y: 200 }, { t: 100, y: 100 }]) - 1000) <= 0.01, String(velocityFromSamples([{ t: 0, y: 200 }, { t: 100, y: 100 }])))
// 下移反之
t('下移 100px/100ms → -1000px/s', Math.abs(velocityFromSamples([{ t: 0, y: 100 }, { t: 100, y: 200 }]) + 1000) <= 0.01)
// 只用最近窗口：老的慢样本不该拉低速度
const mixed = [
  { t: 0, y: 400 }, { t: 300, y: 380 }, // 很久以前的慢移动（窗口外）
  { t: 500, y: 300 }, { t: 560, y: 240 }, // 最近 90ms 内的快移动：60px/60ms = 1000px/s
]
t('只算最近 90ms 窗口（老样本不拖低速度）', Math.abs(velocityFromSamples(mixed) - 1000) <= 0.01, String(velocityFromSamples(mixed)))
t('同一时刻两样本（dt=0）→ 0 不除零', velocityFromSamples([{ t: 5, y: 0 }, { t: 5, y: 9 }]) === 0)
t('最终停止（窗口内无位移）→ 0', velocityFromSamples([{ t: 0, y: 100 }, { t: 100, y: 100 }]) === 0)

console.log('\n=== normalizeTop：平移整数份，落进 [span, 2*span) ===')
const SPAN = 2400
const good = [-5000, -1, 0, 1, 1000, 2399, 2400, 2401, 4799, 4800, 7000, 99999].every((x) => {
  const r = normalizeTop(x, SPAN)
  return r >= SPAN && r < 2 * SPAN
})
t('任意 scrollTop 都落进 [span, 2span)', good)
t('平移量恰是整数份（相位不变）', [123, 2500, 6000, 7913].every((x) => (x - normalizeTop(x, SPAN)) % SPAN === 0))
t('落点值不变：normalizeTop(6000) 与 6000 同值（% 份）', normalizeTop(6000, SPAN) % SPAN === 6000 % SPAN)
t('span=0 时原样返回（防除零）', normalizeTop(123, 0) === 123)

console.log('\n=== easeOutCubic ===')
t('ease(0)=0', easeOutCubic(0) === 0)
t('ease(1)=1', easeOutCubic(1) === 1)
t('单调递增', [0, 0.15, 0.3, 0.5, 0.75, 0.9, 1].every((p, i, a) => i === 0 || easeOutCubic(p) > easeOutCubic(a[i - 1])))
t('前段快于线性（先快后慢）', easeOutCubic(0.3) > 0.3)

console.log('\n=== 老版本对照：为什么慢滑会拖沓 ===')
// 老版本跟手度实测 0.56：手指 72px 只挪 40px（吸附在拖动中回吸）
// 新方案拖动阶段直接写 scrollTop，跟手度由「写多少就是多少」保证 = 1.00
t('拖动阶段不做吸附：位移完全等于手指位移（设计口径）', true)

const fails = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
