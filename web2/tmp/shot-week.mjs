/* 周课表网格截图（人工/视觉复核用）：node tmp/shot-week.mjs [有周末课=1] */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const withSat = process.argv[2] === '1'
const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const MONDAY = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`

const schedules = [
  { id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教1-101', weekday: 1, start_time: '08:00', duration: 100, week_rule: 'every' },
  { id: 'c2', type: 'course', semester_id: 'sem1', title: '大学英语', location: '外语楼203', weekday: 2, start_time: '09:50', duration: 45, week_rule: 'every' },
  { id: 'c3', type: 'course', semester_id: 'sem1', title: '线性代数', location: '教2-305', weekday: 3, start_time: '13:40', duration: 65, week_rule: 'every' },
  { id: 'c5', type: 'course', semester_id: 'sem1', title: '数据结构', location: '机房402', weekday: 4, start_time: '14:00', duration: 100, week_rule: 'every' },
  { id: 'c6', type: 'course', semester_id: 'sem1', title: '大学物理', location: '理学楼108', weekday: 5, start_time: '19:00', duration: 45, week_rule: 'every' },
]
if (withSat) schedules.push({ id: 'c4', type: 'course', semester_id: 'sem1', title: '体育', location: '操场', weekday: 6, start_time: '10:45', duration: 45, week_rule: 'every' })

const doc = JSON.stringify({
  app: 'sched', schema_version: 1, exported_at: '2026-09-30T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
  schedules, todos: [],
})

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(doc)})`)
await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
await page.goto('http://127.0.0.1:4177/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await page.locator('nav button', { hasText: '周课表' }).click()
await page.waitForTimeout(700)
const out = withSat ? 'tmp/week-grid-6col.png' : 'tmp/week-grid-5col.png'
await page.screenshot({ path: out })
console.log('saved', out)
await browser.close()
