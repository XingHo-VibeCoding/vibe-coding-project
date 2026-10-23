import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const URL = 'http://127.0.0.1:4177/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
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
const EXAMS = [
  { id: 'ks_(2026-2027-1)-031E0011-01_final', title: '结构力学Ⅰ', date: keyOf(3), start: '10:30', end: '12:30', place: '', note: '座位 38', created_at: 1 },
  { id: 'ks_(2026-2027-1)-031E0012-02_final', title: '结构设计原理和方法Ⅰ', date: keyOf(4), start: '10:30', end: '12:30', place: '', note: '', created_at: 2 },
  { id: 'ex_manual', title: '自己加的考试（没填考场）', date: keyOf(6), start: '09:00', end: '', place: '', note: '', created_at: 3 },
]
const kv = {
  'web2.onboarded': '1',
  'web2.theme': 'light',
  'web2.data': { app: 'sched', semester: { name: '2026 秋冬', first_monday: firstMonday(), total_weeks: 18, periods: [] }, schedules: [], todos: [], events: [], routines: [] },
  'web2.exams': EXAMS,
  'web2.exam.set': { enabled: false, at: '20:00', leadDays: 14 },
  'web2.notify': { enabled: false, minutesBefore: 10 },
  'web2.habits': [],
  'web2.listen': { clips: [] },
}
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()
await p.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)) }, kv)
await p.goto(URL, { waitUntil: 'networkidle' })
await p.waitForTimeout(700)
await p.evaluate(() => document.querySelector('[data-nav="me"]').click())
await p.waitForTimeout(500)
await p.evaluate(() => document.querySelector('[data-me-exams]').click())
await p.waitForTimeout(700)
const shot = await p.locator('[data-exam-list]').screenshot({ path: 'web2/tmp/exam-pending-shot.png' })
await browser.close()
console.log('shot ok', shot.length)
