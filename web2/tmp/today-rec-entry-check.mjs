/* M5 第 2 步 DOM 检查：今日页录音入口卡。
   断言：①今日页默认就有入口卡（开始录音按钮 + 新副文案）
        ②浏览器环境点「开始录音」→ 就地报错（不假录音、不跳页）
        ③报错态没有「停止并保存」按钮
        ④切「我的」页原录音区仍在（两条入口共存，互不影响）
        ⑤全程无页面错误。
   跑法：先起 dev server（4177）再 node tmp/today-rec-entry-check.mjs（支持 TW_URL 覆盖） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'

const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const MONDAY = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`

const seedDoc = JSON.stringify({
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
  schedules: [
    { id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教1-101', weekday: 1, start_time: '08:00', duration: 90, week_rule: 'every' },
    { id: 'c2', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教1-101', weekday: 3, start_time: '08:00', duration: 90, week_rule: 'every' },
  ],
  todos: [],
})

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc)})`)
await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)

/* A. 今日页入口卡 */
const card = page.locator('[data-today-rec]')
t('A1 今日页有录音入口卡', await card.isVisible())
const startBtn = page.locator('[data-today-rec-start]')
t('A2 入口卡有「开始录音」按钮', await startBtn.isVisible() && (await startBtn.textContent()).includes('开始录音'))
const cardText = await card.textContent()
t('A3 副文案提到自动停/自动转写/纪要/作业转待办', cardText.includes('自动停') && cardText.includes('自动转写') && cardText.includes('纪要') && cardText.includes('作业转待办'))
t('A4 未录音时没有「停止并保存」', !(await page.locator('[data-today-rec-stop]').isVisible().catch(() => false)))

/* B. 浏览器环境点开始：就地报错，不假录音 */
await startBtn.click()
await page.waitForTimeout(500)
const msg = await page.locator('[data-today-rec] p').last().textContent().catch(() => '')
t('B1 点击后就地出现提示（不假录音）', !!msg && msg.trim().length > 0, msg && msg.trim())
t('B2 报错后仍无停止按钮', !(await page.locator('[data-today-rec-stop]').isVisible().catch(() => false)))
t('B3 没有跳去别的 tab', await page.locator('[data-today-rec]').isVisible())

/* C. 「我的」页原录音区共存 */
await page.locator('nav button', { hasText: '我的' }).click() // 2026-10-02 加第 4 个 tab「打卡」后序号会变，按文案选
await page.waitForTimeout(500)
const mineText = await page.locator('main').nth(3).textContent() // today/week/habit/me
t('C1 「我的」页录音区仍在', mineText.includes('课堂录音') && mineText.includes('开始录音'))
t('C2 「我的」页场次说明未丢', mineText.includes('长按场次可删除'))

/* D. 无页面错误 */
t('D1 全程无 pageerror', pageErrors.length === 0, pageErrors.join(' | '))

await browser.close()
const fails = results.filter((r) => !r[1])
console.log(`\n=== 今日页录音入口：${results.length - fails.length}/${results.length} 项通过 ===`)
process.exit(fails.length ? 1 : 0)
