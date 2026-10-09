/* 全 App 版式截图（改版评估用，产物进 tmp/，不入库）
   跑法：先起 dist 静态服务（默认 4177），再 node tmp/ui-snapshot.mjs
   会种标记跳过引导（示例态），然后把 5 个底部 tab 各拍一张整页长图。 */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)

/* 引导页：2026-10-09 起「先用示例数据逛逛」已删，改为种标记跳过引导；
   没有 web2.data 时源就是 mock，后面看到的仍是示例数据 */
await page.addInitScript(() => { try { localStorage.setItem('web2.onboarded', '1') } catch (e) {} })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)

const tabs = [['今日', 'today'], ['周课表', 'week'], ['日程', 'list'], ['打卡', 'habit'], ['我的', 'me']]
for (const [label, key] of tabs) {
  await page.locator('nav button', { hasText: label }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `tmp/ui-${key}.png`, fullPage: true })
  console.log(`已写出 tmp/ui-${key}.png`)
}

/* 「我的」页再拍一张：把所有折叠卡片都展开，看看藏了多少东西 */
const meButtons = page.locator('main[data-page="me"] button', { hasText: '打开' })
const n = await meButtons.count()
for (let i = 0; i < n; i++) { await meButtons.nth(i).click().catch(() => {}); await page.waitForTimeout(200) }
await page.waitForTimeout(400)
await page.screenshot({ path: 'tmp/ui-me-expanded.png', fullPage: true })
console.log(`已写出 tmp/ui-me-expanded.png（展开 ${n} 张卡片）`)
await browser.close()
