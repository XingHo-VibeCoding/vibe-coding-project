/* Stage 1 今日页三段壳视觉取证：默认态 + 窗口滚到底（证明头尾不动）
   跑法：先起 dist 静态服务（默认 4177）再 node tmp/stage1-shot.mjs → tmp/stage1-today-{top,bottom}.png */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript(() => { localStorage.setItem('web2.onboarded', '1') })
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.screenshot({ path: 'tmp/stage1-today-top.png' })
await page.evaluate(() => { document.querySelector('[data-today-scroll]').scrollTop = 99999 })
await page.waitForTimeout(400)
await page.screenshot({ path: 'tmp/stage1-today-bottom.png' })
await browser.close()
console.log('已写出 tmp/stage1-today-top.png / tmp/stage1-today-bottom.png')
