/* 美术收口取证：二级页「推入动效」的中间帧（静图看得到的那部分）。
   点「我的 → 待办清单」，在过渡进行中按时间点截几张，落在 tmp/art-push-<ms>ms.png。
   用法：BASE=http://127.0.0.1:4177 OUT=tmp node tmp/art-push-frames.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const OUT = process.env.OUT || 'tmp'
const TODAY_WD = ((new Date().getDay() + 6) % 7) + 1
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date()
monday.setDate(monday.getDate() - (TODAY_WD - 1))
const doc = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: iso(monday), total_weeks: 18 },
  schedules: [{
    id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教三 302', teacher: '张明',
    weekday: TODAY_WD, start_time: '08:00', duration: 100, week_rule: 'every',
  }],
  todos: [
    { id: 't1', title: '高数作业：第三章习题 1-10', done: false, due_date: iso(new Date()) },
    { id: 't2', title: '数据结构实验报告提交', done: false, due_date: iso(new Date(Date.now() + 86400000)) },
  ],
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
await page.addInitScript(([d]) => {
  localStorage.setItem('web2.data', JSON.stringify(d))
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', '"light"')
}, [doc])
await page.goto(`${BASE}/?t=15:00`, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await page.$eval('[data-nav="me"]', (el) => el.click())
await page.waitForTimeout(500)

// 点击后立刻按分段延时截图：0/70/140/210/280ms 共 5 帧
const shots = [0, 70, 140, 210, 280]
const t0 = Date.now()
await page.$eval('[data-me-entry="todos"]', (el) => el.click())
for (const ms of shots) {
  const wait = ms - (Date.now() - t0)
  if (wait > 0) await page.waitForTimeout(wait)
  const left = await page.$eval('[data-sub-page]', (el) => Math.round(el.getBoundingClientRect().left)).catch(() => null)
  await page.screenshot({ path: `${OUT}/art-push-${String(ms).padStart(3, '0')}ms.png` })
  console.log(`t=${ms}ms  left=${left}`)
}
await browser.close()
