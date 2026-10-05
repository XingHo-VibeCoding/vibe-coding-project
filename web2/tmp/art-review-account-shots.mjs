/* 六期「今天的账」取证：把三态截成图给用户看
   ①日精进第一题顶上的账卡 ②生成后的结果页（带「今天的账：排 N 做完 M」）③历史里的浅色「只有数字」行
   跑法：cd web2; $env:PORT='4177'; node serve.js  然后 node tmp/art-review-account-shots.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = 'tmp'
const pad = (n) => String(n).padStart(2, '0')
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dk = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return keyOf(d) }
const T = dk(0), Y = dk(-1)
const MON = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return keyOf(d) })()
const WD = ((new Date().getDay() + 6) % 7) + 1

const DOC = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: MON, total_weeks: 18 },
  courses: [
    { id: 'c1', title: '混凝土结构设计原理', location: '紫金港北4-317', teacher: '沈国辉', weekday: WD, start: '14:15', duration: 95, week_rule: 'every' },
  ],
  schedules: [
    { id: 'c1', type: 'course', semester_id: 'sem1', title: '混凝土结构设计原理', location: '紫金港北4-317', teacher: '沈国辉', weekday: WD, start_time: '14:15', duration: 95, week_rule: 'every' },
  ],
  todos: [
    { id: 't1', title: '把结构力学作业做掉', done: false, due_date: T },
    { id: 't2', title: '看工程结构网课', done: false, due_date: T },
    { id: 't3', title: '复习混凝土受拉那节', done: false, due_date: T },
    { id: 't4', title: '交实验报告', done: true, due_date: T },
  ],
  habits: [
    { id: 'h1', title: '背 20 个单词', records: { [T]: 1 } },
    { id: 'h2', title: '跑步', records: {} },
  ],
}
const BOOK = {
  version: 1, days: {
    [Y]: { date: Y, stats: { courses: 2, todosDone: 0, todosTotal: 3, habitsDone: 0, habitsTotal: 0, listenToday: 0 }, updated_at: Date.now() - 86400000 },
    [dk(-2)]: { date: dk(-2), stats: { courses: 3, todosDone: 2, todosTotal: 5, habitsDone: 1, habitsTotal: 2, listenToday: 0 }, updated_at: Date.now() - 172800000 },
  },
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript(([doc, book]) => {
  localStorage.setItem('web2.data', JSON.stringify(doc))
  localStorage.setItem('web2.daily', JSON.stringify(book))
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', '"lavender"')
  localStorage.setItem('web2.time', '"21:30"')
}, [DOC, BOOK])
await page.goto(`${BASE}?t=21:30`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

/* ① 第一题 + 账卡 */
await page.locator('[data-review-start]').first().click()
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/acct-1-ask.png` })
console.log('① ask  left=', await page.locator('[data-account-card]').count(), 'say=', await page.locator('[data-account-say]').textContent().catch(() => '—'))

/* ② 走完四题（全跳过）→ 结果页 */
for (let i = 0; i < 5; i++) {
  const nx = page.locator('[data-review-next]')
  if (!(await nx.count())) break
  await nx.click()
  await page.waitForTimeout(450)
}
const summary = await page.locator('[data-review-summary]').textContent().catch(() => '')
await page.screenshot({ path: `${OUT}/acct-2-result.png` })
console.log('② result  账行=', await page.locator('[data-account-line]').textContent().catch(() => '—'))

/* ③ 历史（含只有数字的浅色行） */
await page.locator('[data-review-done]').click().catch(() => {})
await page.waitForTimeout(600)
await page.locator('[data-review-open-history]').first().click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/acct-3-history.png` })
console.log('③ history 行数=', await page.locator('[data-review-history-item]').count())
console.log('summary 前 40 字=', summary.slice(0, 40).replace(/\n/g, ' / '))
await browser.close()
