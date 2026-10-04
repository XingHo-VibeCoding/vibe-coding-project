/* A4 复诊（临时）：① 揪出界面上真实存在的 "NaN" 文案 ② 校验扫描器的对比度算法
   跑法：node tmp/a4-probe2.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'

/* Node 侧独立实现一遍，用来对照页面内那份 */
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
console.log('白 vs #2f6feb =', ratio({ r: 255, g: 255, b: 255 }, { r: 47, g: 111, b: 235 }).toFixed(3))
console.log('白 vs #2563eb =', ratio({ r: 255, g: 255, b: 255 }, { r: 37, g: 99, b: 235 }).toFixed(3))

const today = new Date()
const p2 = (n) => String(n).padStart(2, '0')
const TODAY = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`
const WD = [7, 1, 2, 3, 4, 5, 6][today.getDay()]
const iso = (h, m) => `${TODAY}T${p2(h)}:${p2(m)}:00.000Z`
const DOC = {
  app: 'sched', schema_version: 1, exported_at: new Date().toISOString(),
  semester: { id: 'sem1', name: '2026 秋冬学期（A4 扫描）', first_monday: '2026-08-31', total_weeks: 18, periods: [] },
  schedules: [
    { id: 'c' + WD, type: 'course', semester_id: 'sem1', title: '体育（篮球）', location: '东区体育馆', weekday: WD, start_time: '16:00', duration: 45, week_rule: 'every' },
    { id: 'r1', type: 'routine', semester_id: 'sem1', title: '每日背单词 50 个', location: '图书馆四层', weekday: null, start_time: '21:30', duration: 30, week_rule: 'every' },
  ],
  todos: [{ id: 't1', title: '交课程论文', done: false, due_date: TODAY }],
  lectures: [{ id: 'lec1', schedule_id: 'c1', title: '线性代数 · 第 4 周', status: 'transcribed', started_at: iso(10, 0), ended_at: iso(11, 30), duration_ms: 5400000, clip_count: 1, clips: [{ index: 0, path: null, mime: 'audio/aac', duration_ms: 5400000, recorded_at: iso(10, 0) }], created_at: iso(10, 0), updated_at: iso(11, 35), transcript: '……', summary: null }],
  habits: [{ id: 'h1', name: '每天背 50 个单词', created_at: iso(8, 0), records: {}, backfilled: {} }],
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 })
await ctx.addInitScript((doc) => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.data', doc)
  localStorage.setItem('web2.theme.auto', '0')
}, JSON.stringify(DOC))
const page = await ctx.newPage()
await page.goto(BASE + '?t=10:30', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)

const nan = await page.evaluate(() => {
  const out = []
  const walk = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && /NaN/.test(n.nodeValue)) {
        const path = []
        let p = el
        while (p && p !== document.body) { path.unshift(p.tagName.toLowerCase() + [...(p.attributes || [])].filter((a) => a.name.startsWith('data-')).map((a) => '[' + a.name + ']').join('')); p = p.parentElement }
        out.push({ text: n.nodeValue.trim().slice(0, 60), path: path.join(' > '), html: el.outerHTML.slice(0, 240) })
      }
      for (const c of el.children) walk(c)
    }
  }
  walk(document.body)
  return out
})
console.log('\n=== 含 NaN 的文本节点 ' + nan.length + ' 处')
for (const n of nan) console.log('  ' + n.path + '\n    文本: ' + n.text + '\n    HTML: ' + n.html.replace(/\s+/g, ' '))

/* 对比度复诊：拿 开始录音 主按钮，看页面内与 Node 侧两个结果是否一致 */
const pageRatio = await page.evaluate(() => {
  const el = document.querySelector('[data-today-rec-start]') || document.querySelector('button.bg-primary-500')
  if (!el) return null
  const cs = getComputedStyle(el)
  const m = String(cs.color).match(/rgba?\(([^)]+)\)/)
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number)
  const bgm = String(getComputedStyle(el).backgroundColor).match(/rgba?\(([^)]+)\)/)
  const b = bgm ? bgm[1].split(/[,\s/]+/).filter(Boolean).map(Number) : null
  const lum2 = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
  const r2 = (a, b) => { const l1 = lum2(a), l2 = lum2(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
  return { color: cs.color, backgroundColor: cs.backgroundColor, backgroundImage: cs.backgroundImage.slice(0, 40), pageSide: r2({ r: p[0], g: p[1], b: p[2] }, { r: b[0], g: b[1], b: b[2] }) }
})
console.log('\n=== 主按钮对比度复诊:', JSON.stringify(pageRatio))
await browser.close()
