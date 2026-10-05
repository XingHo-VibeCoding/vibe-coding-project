/* Stage 3 视觉取证：今天页 26px 时间行（有课 / 空档 / 晚上） + 「接下来」一行到底有多挤 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const TODAY_WD = ((new Date().getDay() + 6) % 7) + 1
const monday = new Date()
monday.setDate(monday.getDate() - (TODAY_WD - 1))
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const schedules = [
  { id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教三 302', teacher: '张明', weekday: TODAY_WD, start_time: '08:00', duration: 100, week_rule: 'every' },
  { id: 'c2', type: 'course', semester_id: 'sem1', title: '大学英语', location: '外语楼 205', teacher: '李芳', weekday: TODAY_WD, start_time: '10:00', duration: 145, week_rule: 'every' },
  { id: 'c3', type: 'course', semester_id: 'sem1', title: '线性代数', location: '教二 110', teacher: '赵敏', weekday: TODAY_WD, start_time: '14:00', duration: 100, week_rule: 'every' },
  { id: 'r1', type: 'routine', semester_id: 'sem1', title: '晚自习', location: '图书馆', weekday: TODAY_WD, start_time: '19:00', duration: 90, week_rule: 'every' },
  { id: 'r2', type: 'routine', semester_id: 'sem1', title: '健身', location: '体育馆', weekday: TODAY_WD, start_time: '07:00', duration: 40, week_rule: 'every' },
]
const doc = {
  app: 'sched', schema_version: 1, exported_at: new Date().toISOString(),
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: iso(monday), total_weeks: 18 },
  schedules,
  todos: [
    { id: 't1', title: '高数作业：第三章习题 1-10', due: iso(new Date()), done: false },
    { id: 't2', title: '数据结构实验报告提交', due: iso(new Date(Date.now() + 864e5)), done: false },
  ],
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

async function shot(name, t, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.addInitScript(([d, seed]) => {
    /* 主键是 web2.data（整包 doc）；web2.schedules 等老键一并写，保证哪条读取路径都拿得到 */
    localStorage.setItem('web2.data', JSON.stringify(d))
    localStorage.setItem('web2.doc', JSON.stringify(d))
    localStorage.setItem('web2.schedules', JSON.stringify(d.schedules))
    localStorage.setItem('web2.semester', JSON.stringify(d.semester))
    localStorage.setItem('web2.todos', JSON.stringify(d.todos))
    localStorage.setItem('web2.onboarded', '1')
    Object.entries(seed).forEach(([k, v]) => localStorage.setItem(k, v))
  }, [doc, extra.seed || {}])
  await page.goto(`${BASE}/?t=${t}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(extra.wait || 900)
  if (extra.scroll) await page.evaluate((y) => document.scrollingElement.scrollTop = y, extra.scroll)
  await page.waitForTimeout(300)
  await page.screenshot({ path: `tmp/${name}.png` })
  if (extra.rows) {
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-row]')].map((el) => ({ h: Math.round(el.getBoundingClientRect().height), text: el.innerText.replace(/\s+/g, ' ').trim() })))
    console.log(name, JSON.stringify(rows))
  }
  await ctx.close()
}

await shot('stage3-rows-class', '11:00', { rows: true })      // 上课中：进行中 + 已过
await shot('stage3-rows-gap', '13:00', { rows: true })        // 空档：接下来三件
await shot('stage3-rows-night', '21:30', { rows: true })      // 晚上：全过完，收个尾

await browser.close()
console.log('已写出 tmp/stage3-rows-{class,gap,night}.png')
