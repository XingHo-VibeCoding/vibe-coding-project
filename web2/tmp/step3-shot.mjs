/* 今天页「今天要听」截图（方案 C Step 3）：注入 3 段到期 + 1 段未来的假数据，
   截今天页顶部与「今天要听」段。跑法：先起 dist 静态服务（4177）再 node tmp/step3-shot.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const day = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toISOString().slice(0, 10) }
const clip = (name, o, played) => ({
  id: 'clip-' + name, name, file: name + '.m4a', seconds: 42, played_count: played,
  review_stage: 0, next_due_date: day(o), repeat_times: null, archived: false, created_at: new Date().toISOString(),
})
const SEED = [clip('英语听力 Unit 3', 0, 0), clip('日语 N3 听力', -1, 2), clip('专业课名词解释', -2, 5), clip('高数公式速记', 3, 0)]

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript((list) => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.listen', JSON.stringify(list))
}, SEED)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.screenshot({ path: 'tmp/step3-today-top.png' })
await page.locator('[data-today-listen]').scrollIntoViewIfNeeded()
await page.waitForTimeout(300)
await page.screenshot({ path: 'tmp/step3-today-listen.png' })
await page.locator('[data-today-listen-more]').click()
await page.waitForTimeout(300)
await page.screenshot({ path: 'tmp/step3-today-listen-all.png' })
console.log('已写出 tmp/step3-today-top.png / step3-today-listen.png / step3-today-listen-all.png')
await browser.close()
