/* 五期·每日复盘：出图（playwright，走 dist 静态服务 4177）
   跑法：node tmp/review-shot.mjs → web2/tmp/review-*.png */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const pad = (n) => String(n).padStart(2, '0')
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const T = keyOf(new Date())
const MON = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return keyOf(d) })()
const WD = ((new Date().getDay() + 6) % 7) + 1

const DOC = JSON.stringify({
  app: 'sched', schema_version: 1, exported_at: new Date().toISOString(),
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: MON, total_weeks: 16 },
  schedules: [
    { id: 'c1', type: 'course', semester_id: 'sem1', title: '环境工程概论', location: '紫金港北4-319', weekday: WD, start_time: '10:00', duration: 145, week_rule: 'every' },
    { id: 'c2', type: 'course', semester_id: 'sem1', title: '结构力学', location: '安中大楼 A-201', weekday: WD, start_time: '14:00', duration: 95, week_rule: 'every' },
  ],
  todos: [
    { id: 'td1', title: '高数作业第三章', note: '', due_date: T, done: true, done_at: new Date().toISOString(), source: 'manual', created_at: new Date().toISOString() },
    { id: 'td2', title: '结构力学实验报告', note: '', due_date: T, done: false, done_at: null, source: 'manual', created_at: new Date().toISOString() },
  ],
})

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript((docStr) => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.data', docStr)
  localStorage.setItem('web2.habits', JSON.stringify([{ id: 'h1', name: '日精进', records: { [docStr ? new Date().toISOString().slice(0, 10) : '']: true } }]))
}, DOC)
await page.goto(BASE + '?t=21:40', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)

/* 1. 今日页入口卡（未复盘） */
await page.locator('[data-review-start]').scrollIntoViewIfNeeded()
await page.waitForTimeout(250)
await page.screenshot({ path: 'tmp/review-today-idle.png' })

/* 2. 浮层 · 第 1 题 */
await page.locator('[data-review-start]').click()
await page.waitForTimeout(350)
await page.locator('[data-review-input]').fill('把复盘这一期做出来了')
await page.waitForTimeout(150)
await page.screenshot({ path: 'tmp/review-ask.png' })

/* 3. 浮层 · 状态五档 */
await page.locator('[data-review-next]').click()
await page.waitForTimeout(250)
await page.locator('[data-review-mood="4"]').click()
await page.waitForTimeout(200)
await page.screenshot({ path: 'tmp/review-mood.png' })

/* 4. 浮层 · 第三题（未完成清单） */
await page.locator('[data-review-next]').click()
await page.waitForTimeout(250)
await page.locator('[data-review-keep]').first().click()
await page.waitForTimeout(150)
await page.screenshot({ path: 'tmp/review-keep.png' })

/* 5. 日精进结果页 */
await page.locator('[data-review-next]').click()
await page.waitForTimeout(250)
await page.locator('[data-review-input]').fill('把复盘的卡片贴到周报里')
await page.locator('[data-review-next]').click()
await page.waitForTimeout(400)
await page.screenshot({ path: 'tmp/review-result.png' })

/* 6. 历史（再造两天旧记录） */
await page.evaluate(([d1, d2]) => {
  const v = JSON.parse(localStorage.getItem('web2.review'))
  const mk = (date, mood, proud, focus, summary) => ({
    date, mood, answers: { proud, keep: '明天接着做', focus },
    stats: { courses: 3, todosDone: 2, todosTotal: 4, habitsDone: 1, habitsTotal: 2, listenToday: 1 },
    summary, created_at: Date.now(), updated_at: Date.now(),
  })
  v.records.push(
    mk(d1, 4, '把实验室的数据整理完了', '早上先跑一遍听力',
      '10 月 3 日 · 周六\n今天上了 3 节课，待办完成 2/4，打卡 1/2。\n状态：不错 😄\n最值得记的：把实验室的数据整理完了\n没做完的：明天接着做\n明天最重要的一件事：早上先跑一遍听力'),
    mk(d2, 2, '开了一天的会', '把课表截图识别做完',
      '10 月 2 日 · 周五\n今天上了 2 节课，待办完成 1/3。\n状态：一般 😐\n最值得记的：开了一天的会\n明天最重要的一件事：把课表截图识别做完'))
  localStorage.setItem('web2.review', JSON.stringify(v))
  location.reload()
}, [keyOf(new Date(Date.now() - 864e5)), keyOf(new Date(Date.now() - 2 * 864e5))])
await page.waitForTimeout(1200)
await page.locator('[data-review-open-history]').click()
await page.waitForTimeout(400)
await page.screenshot({ path: 'tmp/review-history.png' })

/* 7. 我的页 · 设置行（遮罩中心被浮层压住，点顶部空白处关） */
await page.mouse.click(195, 40)
await page.waitForTimeout(250)
await page.locator('nav button').filter({ hasText: '我的' }).click()
await page.waitForTimeout(300)
await page.locator('[data-settings-toggle]').click()
await page.waitForTimeout(300)
await page.locator('[data-review-row]').scrollIntoViewIfNeeded()
await page.waitForTimeout(250)
await page.screenshot({ path: 'tmp/review-me.png' })

await browser.close()
console.log('已写出 tmp/review-today-idle.png / review-ask.png / review-mood.png / review-keep.png / review-result.png / review-history.png / review-me.png')
