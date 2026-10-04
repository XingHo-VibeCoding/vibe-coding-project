/* A4 诊断件：算 token 候选值——把 ink-dim 调深多少、alpha 修饰符影响多大，都要有数字再拍板。 */
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const lum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05) }
const over = (fg, bg, a) => fg.map((v, i) => v * a + bg[i] * (1 - a))
const r2 = (x) => Math.round(x * 100) / 100

const CANVAS = hex('#f5f7fa')
const CARD = hex('#ffffff')
const CHIP = hex('#f4f4f5')   // bg-ink/5
const TINT = hex('#eef0f5')   // 浅色课卡底
const DARKBG = hex('#161d2c')
const DARKCHIP = hex('#1e2534')

console.log('== 浅色：候选 ink-dim 在全量 / 90 / 80 / 70 / 60 透明度下（需 4.5）==')
for (const h of ['#6b7486', '#666f81', '#626b7d', '#5e6779', '#5a6375', '#555e70']) {
  const c = hex(h)
  const row = [1, 0.9, 0.8, 0.7, 0.6].map((a) => r2(ratio(over(c, CARD, a), CARD)))
  console.log(`  ${h}  on #fff: ${row.join(' / ')}   on #f5f7fa(全量): ${r2(ratio(c, CANVAS))}  on #f4f4f5(全量): ${r2(ratio(c, CHIP))}`)
}
console.log('== 暗色：现在 ink-dim #94a0b8 与候选（需 4.5）==')
for (const h of ['#94a0b8', '#a3aec4', '#aab5cb']) {
  const c = hex(h)
  const row = [1, 0.8, 0.7].map((a) => r2(ratio(over(c, DARKBG, a), DARKBG)))
  console.log(`  ${h}  on #161d2c: ${row.join(' / ')}`)
}
console.log('== 暗色：primary-500 vs primary-600（暗色下 600 被覆盖成 #9dbdfa）==')
console.log('  #2f6feb(primary-500) on #161d2c:', r2(ratio(hex('#2f6feb'), DARKBG)), ' on #1e2534:', r2(ratio(hex('#2f6feb'), DARKCHIP)))
console.log('  #9dbdfa(dark primary-600) on #161d2c:', r2(ratio(hex('#9dbdfa'), DARKBG)))
console.log('  #1f57cc(light primary-600) on #fff:', r2(ratio(hex('#1f57cc'), CARD)))
console.log('== 浅色：amber / red 一档之差 ==')
for (const h of ['#f59e0b', '#d97706', '#b45309']) console.log(`  text-amber ${h} on #fff:`, r2(ratio(hex(h), CARD)))
for (const h of ['#f87171', '#ef4444', '#dc2626']) console.log(`  text-red   ${h} on #fff:`, r2(ratio(hex(h), CARD)))
console.log('== 周网格课卡（10px 课名 / 9px 地点 / 8px 时间）==')
console.log('  浅色底 tint #eef0f5：ink-dim 全量', r2(ratio(hex('#6b7486'), TINT)), '/ 80%', r2(ratio(over(hex('#6b7486'), TINT, 0.8), TINT)))
console.log('  暗色底 #262749：primary-500', r2(ratio(hex('#2f6feb'), hex('#262749'))), '；#6f8fe8', r2(ratio(hex('#6f8fe8'), hex('#262749'))))
