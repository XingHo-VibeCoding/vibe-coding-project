import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const now = new Date(); const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
const WD = now.getDay() === 0 ? 7 : now.getDay()
const doc = JSON.stringify({ app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z', semester: { id: 'sem1', name: '2026 秋', first_monday: iso(mon), total_weeks: 16 }, schedules: [
  { id: 'c1', type: 'course', title: '结构力学', location: '紫金港东1-101', weekday: WD, start_time: '14:00', duration: 160, week_rule: 'every', semester_id: 'sem1' },
  { id: 'c2', type: 'course', title: '弹性力学', location: '紫金港东2-205', weekday: WD, start_time: '18:30', duration: 90, week_rule: 'every', semester_id: 'sem1' }
], todos: [] })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.route('**/*', (r) => (r.request().url().includes('cdn.jsdelivr.net') ? r.abort() : r.continue()))
const page = await ctx.newPage()
await page.addInitScript('localStorage.setItem("web2.data", ' + JSON.stringify(doc) + ')')
await page.addInitScript("localStorage.setItem('web2.onboarded','1')")
await page.addInitScript("localStorage.setItem('theme','\"light\"')")
await page.goto('http://127.0.0.1:4177/?t=14:10', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
const hero = await page.locator('[data-hero-wrap]').first()
const box = await hero.boundingBox()
await page.screenshot({ path: 'tmp/remain-text-shot.png', clip: { x: 0, y: 0, width: 390, height: Math.min(844, box.y + box.height + 150) } })
console.log('shot ok ' + Math.round(box.height))
await browser.close()
