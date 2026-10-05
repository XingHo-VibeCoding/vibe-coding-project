/* Stage 5 视觉取证：课表页「正在上的那节课」上那颗录音钮（以及别的课没有） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const TODAY_WD = ((new Date().getDay() + 6) % 7) + 1
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date()
monday.setDate(monday.getDate() - (TODAY_WD - 1))
const mk = (id, title, start, duration, weekday = TODAY_WD) => ({
  id, type: 'course', semester_id: 'sem1', title, location: '教三 302', teacher: '张明',
  weekday, start_time: start, duration, week_rule: 'every',
})
const doc = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: iso(monday), total_weeks: 18 },
  schedules: [mk('c1', '高等数学', '08:00', 100), mk('c2', '大学英语', '10:00', 145), mk('c3', '线性代数', '14:00', 100, (TODAY_WD % 7) + 1)],
  todos: [],
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript(([d]) => {
  localStorage.setItem('web2.data', JSON.stringify(d))
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', '"light"')
}, [doc])
await page.goto(`${BASE}/?t=10:30`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.$eval('[data-nav="week"]', (el) => el.click())
await page.waitForTimeout(600)
/* 把网格滚到「正在进行」那一行 */
await page.evaluate(() => {
  const btn = document.querySelector('[data-week-rec-now]')
  if (btn) btn.scrollIntoView({ block: 'center' })
})
await page.waitForTimeout(400)
await page.screenshot({ path: 'tmp/stage5-week-rec.png' })
const info = await page.evaluate(() => ({
  buttons: document.querySelectorAll('[data-week-rec-now]').length,
  label: document.querySelector('[data-week-rec-now]')?.innerText.trim(),
  aria: document.querySelector('[data-week-rec-now]')?.getAttribute('aria-label'),
  card: document.querySelector('[data-week-rec-now]')?.closest('article')?.innerText.replace(/\s+/g, ' ').trim(),
}))
console.log(JSON.stringify(info))
await browser.close()
console.log('已写出 tmp/stage5-week-rec.png')
