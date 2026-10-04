/* 周网格课卡配色：算浅色文字对比度，并给每个色板找一个「暗色下 >=4.8」的抬亮文字色。
   bg 与 App.vue 的 pal() 暗色分支一致：hexA(bar, 0.16) 叠在卡片 #161d2c 上（routine 是 0.22）。 */
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const ratio = (a, b) => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
const over = (fg, a, bg) => { const f = hex(fg), b = hex(bg); return toHex(f.map((v, i) => v * a + b[i] * (1 - a))) }
const lighten = (c, t) => { const [r, g, b] = hex(c); return toHex([r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t]) }

const CARD_DARK = '#161d2c'
const PALETTES = [
  { bg: '#eef4fe', bar: '#2f6feb', text: '#1f57cc' },
  { bg: '#f1eefe', bar: '#7c5ce0', text: '#5b3fc0' },
  { bg: '#e9f9ef', bar: '#22a95e', text: '#157a43' },
  { bg: '#fff4e8', bar: '#ef9436', text: '#c2620a' },
  { bg: '#fdeef4', bar: '#e8659f', text: '#c03d7d' },
  { bg: '#e8f6f8', bar: '#2ba3b5', text: '#17798a' },
]
const ROUTINE = { bg: '#eef0f5', bar: '#5b6b8c', text: '#44506b' }

console.log('== 浅色（文字 on 卡片底）==')
for (const p of PALETTES) {
  const r = ratio(p.text, p.bg)
  let fix = ''
  if (r < 4.8) {
    for (let t = 0.05; t <= 0.6; t += 0.05) { // 往黑里压
      const c = toHex(hex(p.text).map((v) => v * (1 - t)))
      if (ratio(c, p.bg) >= 4.8) { fix = ` -> 建议 text: '${c}'（${ratio(c, p.bg).toFixed(2)}）`; break }
    }
  }
  console.log(`  bar ${p.bar}  text ${p.text} on ${p.bg} = ${r.toFixed(2)}${r < 4.8 ? '  FAIL' : '  OK'}${fix}`)
}
console.log(`  轮转 routine text ${ROUTINE.text} on ${ROUTINE.bg} = ${ratio(ROUTINE.text, ROUTINE.bg).toFixed(2)}`)

console.log('\n== 暗色（文字 on bar@0.16 叠卡片）==')
const out = []
for (const p of PALETTES) {
  const bgDark = over(p.bar, 0.16, CARD_DARK)
  let textDark = p.bar
  if (ratio(p.bar, bgDark) < 4.8) {
    for (let t = 0.05; t <= 0.9; t += 0.05) {
      const c = lighten(p.bar, t)
      if (ratio(c, bgDark) >= 4.8) { textDark = c; break }
    }
  }
  console.log(`  bar ${p.bar}  底 ${bgDark}  原 text ${p.bar} = ${ratio(p.bar, bgDark).toFixed(2)} -> textDark ${textDark} = ${ratio(textDark, bgDark).toFixed(2)}`)
  out.push({ ...p, textDark })
}
const bgRoutineDark = over(ROUTINE.bar, 0.22, CARD_DARK)
console.log(`  轮转 底 ${bgRoutineDark}  现用 #a9b6d4 = ${ratio('#a9b6d4', bgRoutineDark).toFixed(2)}`)

console.log('\n== 可直接贴进 App.vue 的 PALETTES ==')
for (const p of out) console.log(`  { bg: '${p.bg}', bar: '${p.bar}', text: '${p.text}', textDark: '${p.textDark}' },`)
