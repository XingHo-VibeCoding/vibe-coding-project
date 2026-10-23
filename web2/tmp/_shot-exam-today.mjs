/* 截图：今晚这一段 + AI 一句话（S4）。用法：node tmp/_serve-dist.mjs 4177 之后跑本脚本 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const URL = 'http://127.0.0.1:4177/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = 'tmp/exam-today-shot.png'
function keyOf(off) {
  const d = new Date()
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) + off * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return x.getUTCFullYear() + '-' + p(x.getUTCMonth() + 1) + '-' + p(x.getUTCDate())
}
function firstMonday() {
  const d = new Date()
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - 30 * 86400000)
  const back = (x.getUTCDay() + 6) % 7
  const m = new Date(x.getTime() - back * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return m.getUTCFullYear() + '-' + p(m.getUTCMonth() + 1) + '-' + p(m.getUTCDate())
}
const COURSES = []
for (let wd = 1; wd <= 7; wd++) {
  COURSES.push({ id: 'm' + wd, type: 'course', title: '结构力学', teacher: '', place: '', weekday: wd, start_time: '08:00', duration: 240, week_rule: 'every', weeks: [], term: '' })
  COURSES.push({ id: 'a' + wd, type: 'course', title: '弹性力学', teacher: '', place: '', weekday: wd, start_time: '14:00', duration: 240, week_rule: 'every', weeks: [], term: '' })
}
const EXAMS = [
  { id: 'ks_a_final', title: '结构力学Ⅰ', date: keyOf(3), start: '10:30', end: '12:30', place: '', note: '座位 38', created_at: 1 },
  { id: 'ks_b_final', title: '工程水文学', date: keyOf(5), start: '08:00', end: '10:00', place: '', note: '', created_at: 2 },
]
const kv = {
  'web2.onboarded': '1',
  'web2.theme': 'light',
  'web2.data': { app: 'sched', semester: { name: '2026 秋冬', first_monday: firstMonday(), total_weeks: 18, periods: [] }, schedules: COURSES, todos: [], events: [], routines: [] },
  'web2.exams': EXAMS,
  'web2.exam.set': { enabled: true, at: '20:00', leadDays: 14 },
  'web2.notify': { enabled: false, minutesBefore: 10 },
  'web2.habits': [],
  'web2.listen': { clips: [] },
  'web2.review.advice': { date: keyOf(0), line: '今晚先看结构力学Ⅰ，把弯矩图和剪力图的推导过一遍。', at: Date.now() },
}
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.route('**/*', (route) => {
  const u = route.request().url()
  if (u.startsWith(URL) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue()
  return route.abort()
})
const p = await ctx.newPage()
await p.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)) }, kv)
await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
await p.evaluate(() => document.querySelector('[data-nav="me"]').click())
await p.waitForTimeout(500)
await p.evaluate(() => { const b = document.querySelector('[data-me-exams]'); if (b) b.click() })
await p.waitForTimeout(900)
const box = await p.evaluate(() => {
  const el = document.querySelector('[data-exam-today]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: 0, y: Math.max(0, r.top - 90), width: 390, height: Math.min(844, r.height + 200) }
})
await p.screenshot({ path: OUT, clip: box || undefined })
console.log('saved ' + OUT + ' ' + JSON.stringify(box))
await browser.close()
