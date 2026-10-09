/* today-card-shot —— 今日页「接下来」卡片化（2026-10-09 W 方案）视觉取证
   跑法：先起 4177 静态服务，再 node tmp/today-card-shot.mjs
   产物（web2/tmp/，均被 .gitignore 的 tmp/*.png 忽略）：
     today-card-1-now.png     上课中（14:30，进行中的卡浅蓝底）
     today-card-2-day.png     展开全部：全天 5 张卡
     today-card-3-past.png    点开「已过」明细
     today-card-4-night.png   晚上没课（只有循环日程）
     today-card-5-dark.png    暗色主题下的同一屏 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const OUT = process.env.OUT || 'tmp'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const TODAY_WD = ((new Date().getDay() + 6) % 7) + 1
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date()
monday.setDate(monday.getDate() - (TODAY_WD - 1))
const DAY = iso(new Date())

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

async function open(t, theme) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.addInitScript(([d, th]) => {
    localStorage.setItem('web2.data', JSON.stringify(d))
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.theme', th)
  }, [DOC, theme])
  await page.goto(`${BASE}/?t=${t}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  return { ctx, page }
}

async function shoot(page, name) {
  const sec = page.locator('[data-page="today"] section').first()
  await sec.screenshot({ path: `${OUT}/${name}.png` })
  console.log('wrote', `${OUT}/${name}.png`)
}

/* 1. 上课中：进行中那张卡 */
let s = await open('14:30', 'light')
await shoot(s.page, 'today-card-1-now')

/* 2. 展开全部（全天 5 张卡） */
await s.page.click('[data-today-expand]')
await s.page.waitForTimeout(400)
await shoot(s.page, 'today-card-2-day')

/* 3. 已过明细展开（切回 D 再点「已过」） */
await s.page.click('[data-today-expand]')
await s.page.waitForTimeout(350)
await s.page.click('[data-today-past-fold]')
await s.page.waitForTimeout(350)
await shoot(s.page, 'today-card-3-past')
await s.ctx.close()

/* 4. 晚上：没课，只有循环日程 */
s = await open('22:10', 'light')
await shoot(s.page, 'today-card-4-night')
await s.ctx.close()

/* 5. 暗色主题：同一屏（上课中） */
s = await open('14:30', 'dark')
await shoot(s.page, 'today-card-5-dark')
await s.ctx.close()

await browser.close()
