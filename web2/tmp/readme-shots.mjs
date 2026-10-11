/* P11 截图墙：给 README 拍 10 张界面图（产物进 ../docs/shots/，入库）。
   跑法：先起 dist 静态服务并固定端口（web2/ 下 `PORT=4177 node serve.js`），
   再 `node tmp/readme-shots.mjs`。
   冻钟在 2026-10-14（周三、第 2 周、非假期）10:30 —— 这门课正好「正在上」，
   一屏能同时看到已过 / 正在上 / 接下来三态，以及当日待办。
   （曾冻 10-07，撞上国庆假期，今日页只显示「放假」，故改。） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const OUT = '../docs/shots'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const FROZEN = '2026-10-14T10:30:00'
const TODAY = '2026-10-14'

const DOC = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-12T02:00:00.000Z',
  semester: { id: 'sem1', name: '2026-2027 学秋冬学期', first_monday: '2026-10-05', total_weeks: 18 },
  schedules: [
    { id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教三 302', teacher: '张明', weekday: 3, start_time: '08:00', duration: 100, week_rule: 'every' },
    { id: 'c2', type: 'course', semester_id: 'sem1', title: '数据结构', location: '教二 110', teacher: '赵敏', weekday: 3, start_time: '10:00', duration: 100, week_rule: 'every' },
    { id: 'c3', type: 'course', semester_id: 'sem1', title: '大学英语', location: '外语楼 305', teacher: '王芳', weekday: 3, start_time: '14:00', duration: 100, week_rule: 'every' },
    { id: 'c4', type: 'course', semester_id: 'sem1', title: '线性代数', location: '教三 208', teacher: '李伟', weekday: 4, start_time: '10:00', duration: 100, week_rule: 'every' },
    { id: 'c5', type: 'course', semester_id: 'sem1', title: '大学物理', location: '物理楼 B-201', teacher: '陈静', weekday: 5, start_time: '08:00', duration: 100, week_rule: 'odd' },
  ],
  todos: [
    { id: 'td1', title: '高数作业第三章 1-10 题', note: '', due_date: TODAY, done: true, done_at: '2026-10-14T01:12:00.000Z', source: 'manual', created_at: '2026-10-12T03:00:00.000Z' },
    { id: 'td2', title: '数据结构实验报告', note: '', due_date: TODAY, done: false, done_at: null, source: 'manual', created_at: '2026-10-12T03:05:00.000Z' },
    { id: 'td3', title: '英语 unit 4 听力', note: '', due_date: '2026-10-15', done: false, done_at: null, source: 'manual', created_at: '2026-10-12T03:06:00.000Z' },
  ],
}

const HABITS = JSON.stringify([{ id: 'h1', name: '日精进', records: { [TODAY]: true } }])
const REVIEW = JSON.stringify({
  version: 1,
  records: [{
    date: TODAY, mood: 4,
    answers: { proud: '把数据结构实验的报告写完了', keep: '明天先把英语听力补上', focus: '早上先跑一遍听力' },
    stats: { courses: 3, todosDone: 1, todosTotal: 2, habitsDone: 1, habitsTotal: 1, listenToday: 1 },
    summary: '10 月 14 日 · 周三\n今天上了 3 节课，待办完成 1/2，打卡 1/1。\n状态：不错 😄\n最值得记的：把数据结构实验的报告写完了\n没做完的：明天先把英语听力补上\n明天最重要的一件事：早上先跑一遍听力',
    created_at: 1791000000000, updated_at: 1791000000000,
  }],
})
const LLM = JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' })
const AI_OUT = JSON.stringify({ title: '创新创业讲座', date: '2026-10-16', start: '15:00', duration: 90, place: '报告厅', notes: [] })

/* 录音历史：三周共 5 场（本周 2、上周 1、上上周 2），用来拍「按周分组、默认最近 3 场」 */
const LECTURES = JSON.stringify([
  { id: 'lc1', date: '2026-10-14', title: '数据结构', started_at: '2026-10-14T02:00:00.000Z', status: 'transcribed', clips: [], ms: 5400000 },
  { id: 'lc2', date: '2026-10-13', title: '高等数学', started_at: '2026-10-13T01:00:00.000Z', status: 'summarized', clips: [], ms: 4800000 },
  { id: 'lc3', date: '2026-10-07', title: '大学英语', started_at: '2026-10-07T06:00:00.000Z', status: 'transcribed', clips: [], ms: 5100000 },
  { id: 'lc4', date: '2026-10-01', title: '大学物理', started_at: '2026-10-01T01:00:00.000Z', status: 'transcribed', clips: [], ms: 5000000 },
  { id: 'lc5', date: '2026-09-29', title: '线性代数', started_at: '2026-09-29T02:00:00.000Z', status: 'transcribed', clips: [], ms: 4600000 },
])

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'light' })
const page = await ctx.newPage()

await page.addInitScript(([frozen, doc, habits, review, lectures, llm, out]) => {
  const R = Date, F = new R(frozen).getTime()
  class D extends R { constructor(...a) { a.length ? super(...a) : super(F) } static now() { return F } }
  window.Date = D
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', 'light')
  localStorage.setItem('web2.data', doc)
  localStorage.setItem('web2.habits', habits)
  localStorage.setItem('web2.review', review)
  localStorage.setItem('web2.lectures', lectures)
  localStorage.setItem('web2.llm', llm)
  window.fetch = (function (orig) {
    return function (url, init) {
      if (String(url).indexOf('api.deepseek.com') !== -1) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ choices: [{ message: { content: out } }] }) })
      }
      return orig.apply(this, arguments)
    }
  })(window.fetch)
}, [FROZEN, JSON.stringify(DOC), HABITS, REVIEW, LECTURES, LLM, AI_OUT])

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1100)
const settle = () => page.evaluate(() => document.getAnimations().forEach((a) => a.finish()))
const shot = async (name) => { await settle(); await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('  ->', name + '.png') }
const nav = async (key) => { await page.locator(`[data-nav="${key}"]`).first().click(); await page.waitForTimeout(800) }

/* ① 今日页：顶卡「正在上」+ 已过 / 接下来 + 今日待办 */
await shot('01-today')

/* ② 周课表 */
await nav('week')
await shot('02-week')

/* ③ 周课表右上 ＋ 选单（5 项） */
await page.locator('[data-week-add]').first().click()
await page.waitForTimeout(500)
await shot('03-week-menu')
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

/* ④ 我的页：一行学期 + 四个入口 */
await nav('me')
await shot('04-me')

/* ⑤ 设置索引页：5 行 + 每行摘要 */
await page.locator('[data-settings-toggle]').first().click()
await page.waitForTimeout(600)
await shot('05-settings')
await page.locator('[data-sub-back]').first().click().catch(() => {})
await page.waitForTimeout(400)
await page.locator('[data-nav="today"]').first().click()
await page.waitForTimeout(700)

/* ⑥ 日精进：今日入口卡 */
await page.locator('[data-review-start]').first().scrollIntoViewIfNeeded()
await page.waitForTimeout(300)
await shot('06-review-entry')

/* ⑦ 复盘浮层：第 1 题 */
await page.locator('[data-review-start]').first().click()
await page.waitForTimeout(450)
await page.locator('[data-review-input]').fill('把复盘的卡片贴进周报')
await page.waitForTimeout(200)
await shot('07-review-ask')
await page.locator('[data-sheet-mask]').first().click({ position: { x: 10, y: 10 } }).catch(() => {})
await page.waitForTimeout(500)

/* ⑧ 「添加日程」的 ✨ 智能填写：两条路 */
await page.locator('button', { hasText: '添加日程' }).first().click()
await page.waitForTimeout(600)
await page.locator('[data-event-smart]').click()
await page.waitForTimeout(400)
await shot('08-evt-smart')
await page.locator('[data-sheet-mask]').first().click({ position: { x: 10, y: 10 } }).catch(() => {})
await page.waitForTimeout(500)

/* ⑨ 我的 → 录音历史（按周分组，默认最近 3 场） */
await nav('me')
await page.locator('[data-me-entry="lectures"]').first().click()
await page.waitForTimeout(700)
await shot('09-lectures')
await page.locator('[data-sub-back]').first().click().catch(() => {})
await page.waitForTimeout(500)

/* ⑩ 我的 → 碎片练耳 */
await page.evaluate(() => {
  localStorage.setItem('web2.listen', JSON.stringify([
    { id: 'l1', name: '英语新闻听力 2026-10-01', file: 'news.mp3', seconds: 45, played_count: 3, last_played_at: null, review_stage: 2, next_due_date: '2026-10-13', repeat_times: null, archived: false, created_at: '2026-09-28T00:00:00.000Z' },
    { id: 'l2', name: 'VOA 慢速英语', file: 'voa.mp3', seconds: 58, played_count: 1, last_played_at: null, review_stage: 1, next_due_date: '2026-10-14', repeat_times: 3, archived: false, created_at: '2026-10-02T00:00:00.000Z' },
  ]))
  location.reload()
})
await page.waitForTimeout(1300)
await nav('me')
await page.locator('[data-me-entry="listen"]').first().click()
await page.waitForTimeout(700)
/* 练耳二级页默认是「收起」态，先点开才看得到音频列表 */
await page.locator('[data-sub-body] button', { hasText: '打开' }).first().click().catch(() => {})
await page.waitForTimeout(600)
await shot('10-listen')

await browser.close()
console.log('done -> ' + OUT)
