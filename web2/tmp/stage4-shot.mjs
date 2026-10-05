/* Stage 4 视觉取证：D 形态 → 已过就地展开 → 展开全部（F 全天表）→ 收起 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const TODAY_WD = ((new Date().getDay() + 6) % 7) + 1
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date()
monday.setDate(monday.getDate() - (TODAY_WD - 1))

const mk = (id, title, start, duration, extra = {}) => ({
  id, type: 'course', semester_id: 'sem1', title, location: `教三 ${id}`, teacher: '张明',
  weekday: TODAY_WD, start_time: start, duration, week_rule: 'every', ...extra,
})
const schedules = [
  mk('c1', '晨读', '07:00', 40),
  mk('c2', '高等数学', '08:00', 100),
  mk('c3', '大学英语', '10:00', 145),
  mk('c4', '线性代数', '14:00', 100),
  mk('c5', '数据结构', '16:00', 95),
  mk('c6', '晚自习', '19:00', 90, { type: 'routine' }),
]
const doc = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: iso(monday), total_weeks: 18 },
  schedules,
  todos: [
    { id: 't1', title: '高数作业：第三章习题 1-10', due: iso(new Date()), done: false },
    { id: 't2', title: '数据结构实验报告提交', due: iso(new Date(Date.now() + 864e5)), done: false },
  ],
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript(([d]) => {
  localStorage.setItem('web2.data', JSON.stringify(d))
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', '"light"')
}, [doc])
await page.goto(`${BASE}/?t=11:30`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)

const rows = () =>
  page.evaluate(() => ({
    h: [...document.querySelectorAll('[data-row]')].map((el) => Math.round(el.getBoundingClientRect().height)),
    visible: document.querySelectorAll('[data-today-item]').length,
    fold: !!document.querySelector('[data-today-past-fold]'),
    expand: !!document.querySelector('[data-today-expand]'),
  }))

await page.screenshot({ path: 'tmp/stage4-d-default.png' })
console.log('D 默认 ', JSON.stringify(await rows()))

await page.click('[data-today-past-fold]')
await page.waitForTimeout(350)
await page.screenshot({ path: 'tmp/stage4-past-open.png' })
console.log('已过展开', JSON.stringify(await rows()))

await page.click('[data-today-past-fold]')
await page.waitForTimeout(250)
await page.click('[data-today-expand]')
await page.waitForTimeout(350)
await page.screenshot({ path: 'tmp/stage4-f-all.png' })
console.log('F 全天表', JSON.stringify(await rows()))

await browser.close()
console.log('已写出 tmp/stage4-{d-default,past-open,f-all}.png')
