/* today-dup-shot —— 拍「顶卡与接下来那张正在上的卡是否重复」的实况
   跑法：先起 4177 静态服务，再 node tmp/today-dup-shot.mjs
   产物（web2/tmp/，被 tmp/*.png 忽略）：
     today-dup-full.png   整屏（顶卡 + 接下来），上课中 14:30
     today-dup-hero.png   只裁顶卡
     today-dup-list.png   只裁「接下来」 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const OUT = process.env.OUT || 'tmp'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const TODAY_WD = ((new Date().getDay() + 6) % 7) + 1
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date()
monday.setDate(monday.getDate() - (TODAY_WD - 1))

const course = (id, title, start, duration, extra = {}) => ({
  id, type: 'course', semester_id: 'sem1', title, location: `教三 ${id}`, teacher: '张明',
  weekday: TODAY_WD, start_time: start, duration, week_rule: 'every', ...extra,
})
const DOC = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: iso(monday), total_weeks: 16 },
  schedules: [
    course('c1', '交通工程', '08:00', 95, { location: '紫金港东1-205' }),
    course('c2', '结构力学Ⅰ', '10:00', 95, { location: '紫金港北4-317' }),
    course('c3', '环境工程概论', '14:00', 105, { location: '紫金港西2-301' }),
    course('c4', '弹性力学', '16:45', 100, { location: '紫金港北4-102' }),
    { id: 'r1', type: 'routine', semester_id: 'sem1', title: '英语跟读打卡', location: '', weekday: TODAY_WD, start_time: '18:30', duration: 40, week_rule: 'every' },
  ],
  todos: [],
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript((d) => {
  localStorage.setItem('web2.data', JSON.stringify(d))
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', 'light')
}, DOC)
await page.goto(`${BASE}/?t=14:30`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)

await page.screenshot({ path: `${OUT}/today-dup-full.png` })
console.log('wrote', `${OUT}/today-dup-full.png`)

await page.locator('[data-today-now]').screenshot({ path: `${OUT}/today-dup-hero.png` })
console.log('wrote', `${OUT}/today-dup-hero.png`)

await page.locator('[data-page="today"] section').first().screenshot({ path: `${OUT}/today-dup-list.png` })
console.log('wrote', `${OUT}/today-dup-list.png`)

await ctx.close()
await browser.close()
