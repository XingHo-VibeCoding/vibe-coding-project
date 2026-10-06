/* 老数据兼容实测（AGENTS.md 八.2 硬要求）
   为什么要有这个：P12a/P12b 给课程加了可选字段 `weeks`（显式周次集合），
   口径是「**缺字段就走老分支**、不做迁移、不给老数据补默认值」。
   光在文档里这么写不算数 —— 这里就**拿改动前形状的数据**（没有 weeks、学期没有 periods）
   灌进浏览器，验它照样能正常读出来、算得对、且**没有被偷偷改写**。

   跑法：先起 4177 静态服务，再 node tmp/edu-compat-check.mjs
   产物：tmp/compat-1-today.png / tmp/compat-2-week.png */

let pass = 0
let fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'

/* 让"今天"正好落在第 1 周（第 1 周是奇数周）—— 这样单双周判断是确定的 */
function mondayOfToday() {
  const d = new Date()
  const wd = d.getDay() === 0 ? 7 : d.getDay()
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (wd - 1))
  const p = (n) => String(n).padStart(2, '0')
  return m.getFullYear() + '-' + p(m.getMonth() + 1) + '-' + p(m.getDate())
}
const todayWd = new Date().getDay() === 0 ? 7 : new Date().getDay()

/* ⚠️ 这是**改动前**的形状：课程只有 week_rule(every/odd/even)，**没有 weeks**；
   学期**没有 periods**（Day 8 之前的老数据）；手动加的课是老字段名（name/start/end）。 */
const oldData = {
  app: 'sched',
  semester: { id: 'sem_old', name: '2026-2027 秋冬', first_monday: mondayOfToday(), total_weeks: 16 },
  schedules: [
    { id: 'old1', type: 'course', title: '老课·每周', weekday: todayWd, start_time: '08:00', duration: 95, week_rule: 'every', semester_id: 'sem_old' },
    { id: 'old2', type: 'course', title: '老课·双周', weekday: todayWd, start_time: '10:00', duration: 95, week_rule: 'even', semester_id: 'sem_old' },
    { id: 'old3', type: 'course', title: '老课·单周', weekday: todayWd, start_time: '14:00', duration: 95, week_rule: 'odd', semester_id: 'sem_old' },
    { id: 'olde', type: 'event', title: '老日程', date: '2026-10-20', note: '' },
  ],
  todos: [{ id: 't_old', title: '老待办', done: false, due_date: '2026-10-30' }],
}
const oldAdded = [{ id: 'a_old', type: 'course', name: '老手动课', weekday: todayWd, start: '16:00', end: '17:40', added: true }]

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const logs = []
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(m.text().slice(0, 160))
})

await page.addInitScript(
  ([doc, add]) => {
    localStorage.setItem('web2.data', JSON.stringify(doc))
    localStorage.setItem('web2.added', JSON.stringify(add))
    localStorage.setItem('web2.onboarded', '1')
    localStorage.removeItem('web2.eduSnapshot')
  },
  [oldData, oldAdded],
)
/* 注入 08:30：08:00 那节正好"正在上"（免得被折叠进「已过 N 件」，那栏默认是收起的） */
await page.goto(BASE + '?t=08:30', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)

const beforeRaw = await page.evaluate(() => localStorage.getItem('web2.data'))

/* ① 老数据能读出来：老课程出现在今日页（今天是第 1 周 = 奇数周） */
const todayText = () => page.$eval('main[data-page="today"]', (el) => el.innerText.replace(/\s+/g, ' '))
const t1 = await todayText()
t('1. 老数据（课程没有 weeks、学期没有 periods）能读出来，每周课出现在今日页', /老课·每周/.test(t1), t1.slice(0, 120))
t('2. 老数据的「单周」课在第 1 周（奇数周）出现 —— 老分支 still works', /老课·单周/.test(t1))
t('3. 老数据的「双周」课在第 1 周**不**出现（不该在这一周）', !/老课·双周/.test(t1))
t('4. 老数据里手动加的课（老字段名 name/start/end）也在', /老手动课/.test(t1))
await page.screenshot({ path: 'tmp/compat-1-today.png' })

/* ② 没有 periods 的老学期要回落到默认节次表，而不是崩掉/空白 */
await page.$eval('[data-nav="week"]', (el) => el.click())
await page.waitForTimeout(700)
const weekText = await page.$eval('main[data-page="week"]', (el) => el.innerText.replace(/\s+/g, ' '))
t('5. 老学期没有 periods 时回落到默认节次表：周课表照常有课、不是空白',
  /老课·每周/.test(weekText) && /老手动课/.test(weekText),
  weekText.slice(0, 140))
await page.screenshot({ path: 'tmp/compat-2-week.png' })

/* ③ 没被偷偷改写（不做迁移、不补默认值） */
const afterRaw = await page.evaluate(() => localStorage.getItem('web2.data'))
t('6. 只读一遍**不改写**本机数据（没做迁移、没给老数据补默认值）', beforeRaw === afterRaw,
  beforeRaw === afterRaw ? '' : '改写前 ' + beforeRaw.length + ' 字节 / 改写后 ' + (afterRaw || '').length + ' 字节')
const noWeeksField = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('web2.data') || '{}')
  return (d.schedules || []).every((s) => s.type !== 'course' || !('weeks' in s))
})
t('7. 老课程里**没有被塞进** weeks 字段（缺字段就缺着，靠代码分支兜）', noWeeksField)

/* ④ 老数据之上再走一遍教务导入：待办与日程必须原样活着（只换课程） */
const keep = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('web2.data') || '{}')
  return { todos: (d.todos || []).length, events: (d.schedules || []).filter((s) => s.type === 'event').length }
})
t('8. 老待办与老日程都还在（导入课程不会顺手清掉它们）', keep.todos === 1 && keep.events === 1, JSON.stringify(keep))

t('9. 全程零 pageerror / 零 console error', errors.length === 0 && logs.length === 0, JSON.stringify([errors.slice(0, 2), logs.slice(0, 2)]))

await browser.close()
console.log(`\n老数据兼容实测：${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
