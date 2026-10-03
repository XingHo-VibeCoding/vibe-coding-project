/* 方案 C · Step 4 截图：课表页右上「＋」入口 + 「我的」页瘦身后 + 合并后的主题行。
   跑法：先起 dist 静态服务（4177）再 node tmp/step4-shot.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript(() => localStorage.setItem('web2.onboarded', '1'))
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)

// 课表页：右上角 ＋
await page.locator('nav button', { hasText: '周课表' }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: 'tmp/step4-week-plus.png' })

// 我的页：瘦身后（折叠态）
await page.locator('nav button', { hasText: '我的' }).click()
await page.waitForTimeout(500)
await page.screenshot({ path: 'tmp/step4-me.png', fullPage: true })

// 我的页：展开设置（合并后的主题外观 + 配色）
await page.locator('[data-page="me"] [data-settings-toggle]').click()
await page.waitForTimeout(500)
await page.locator('[data-theme-toggle]').scrollIntoViewIfNeeded()
await page.waitForTimeout(300)
await page.screenshot({ path: 'tmp/step4-me-settings.png' })

console.log('已写出 tmp/step4-week-plus.png / step4-me.png / step4-me-settings.png')
await browser.close()
