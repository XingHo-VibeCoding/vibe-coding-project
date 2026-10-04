/* 「眼前一亮」1+2+3（v1.41.6）截图——playwright，走 dist 静态服务。
   产出 web2/tmp/lively-today.png（学期进度带 + 进行中活进度条）
        web2/tmp/lively-week.png（周课表「现在」游标）
        web2/tmp/lively-theme.png（我的页 · 设置 · 跟着时间自动换 打开态）
   跑法：先起 dist 静态服务（默认 4177）再 node tmp/lively-shot.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const MONDAY = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
const TODAY_WD = ((now.getDay() + 6) % 7) + 1
const COURSE = [{
  id: 'c1', type: 'course', semester_id: 'sem1', title: '环境工程概论', location: '紫金港北4-319',
  weekday: TODAY_WD, start_time: '10:00', duration: 145, week_rule: 'every',
}]
const DOC = JSON.stringify({
  app: 'sched', schema_version: 1, exported_at: '2026-10-04T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
  schedules: COURSE, todos: [],
})

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

async function page(tParam) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const p = await ctx.newPage()
  await p.addInitScript(`localStorage.setItem('web2.onboarded','1');localStorage.setItem('web2.data', ${JSON.stringify(DOC)})`)
  await p.goto(BASE + (tParam ? '?t=' + tParam : ''), { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(900)
  return { p, ctx }
}
const tab = (p, name) => p.locator('nav button').filter({ hasText: name })

/* 1) 今日页：学期进度带 + 进行中活进度条（假装 11:00，课 10:00–12:25） */
const a = await page('11:00')
await a.p.screenshot({ path: 'tmp/lively-today.png' })
await a.ctx.close()

/* 2) 周课表：「现在」游标 */
const b = await page('11:00')
await tab(b.p, '周课表').click()
await b.p.waitForTimeout(600)
await b.p.screenshot({ path: 'tmp/lively-week.png' })
await b.ctx.close()

/* 3) 我的页 · 设置：跟着时间自动换（打开态） */
const c = await page()
await tab(c.p, '我的').click()
await c.p.waitForTimeout(400)
await c.p.locator('[data-settings-toggle]').click()
await c.p.waitForTimeout(400)
await c.p.locator('[data-theme-auto]').scrollIntoViewIfNeeded()
await c.p.waitForTimeout(300)
await c.p.locator('[data-theme-auto]').click()
await c.p.waitForTimeout(600)
await c.p.screenshot({ path: 'tmp/lively-theme.png' })
await c.ctx.close()

await browser.close()
console.log('已写出 tmp/lively-today.png / tmp/lively-week.png / tmp/lively-theme.png')
