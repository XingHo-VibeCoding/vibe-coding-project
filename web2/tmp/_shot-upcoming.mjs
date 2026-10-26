import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
/* 拍「接下来 = 下一件要办的事」跨天那一行：今天的两节课都上完了（?t=22:00），
   明天有课 ⇒ 今日页「接下来」下面出现分隔行「之后 明天 · 10 月 24 日 周六」+ 明天那条。 */
const now = new Date(); const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
const WD = now.getDay() === 0 ? 7 : now.getDay()
const WD2 = WD === 7 ? 1 : WD + 1
const doc = JSON.stringify({ app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z', semester: { id: 'sem1', name: '2026 秋', first_monday: iso(mon), total_weeks: 16 }, schedules: [
  { id: 'c1', type: 'course', title: '结构力学', location: '紫金港东1-101', weekday: WD, start_time: '08:00', duration: 95, week_rule: 'every', semester_id: 'sem1' },
  { id: 'c2', type: 'course', title: '线性代数', location: '紫金港东2-205', weekday: WD, start_time: '14:00', duration: 95, week_rule: 'every', semester_id: 'sem1' },
  { id: 'c3', type: 'course', title: '高等数学', location: '教1-101', weekday: WD2, start_time: '10:00', duration: 95, week_rule: 'every', semester_id: 'sem1' }
], todos: [] })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.route('**/*', (r) => (r.request().url().includes('cdn.jsdelivr.net') ? r.abort() : r.continue()))
const page = await ctx.newPage()
await page.addInitScript('localStorage.setItem("web2.data", ' + JSON.stringify(doc) + ')')
await page.addInitScript("localStorage.setItem('web2.onboarded','1')")
await page.addInitScript("localStorage.setItem('theme','\"light\"')")
await page.goto('http://127.0.0.1:4177/?t=22:00', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
const row = page.locator('[data-today-nextday]').first()
const label = await row.innerText().catch(() => '(没有出现)')
const box = await page.locator('[data-today-list], [data-today-scroll]').first().boundingBox().catch(() => null)
console.log('label = ' + label.replace(/\s+/g, ' '))
await page.screenshot({ path: 'tmp/upcoming-shot.png', clip: { x: 0, y: 0, width: 390, height: 844 } })
console.log('shot ok')
await browser.close()
