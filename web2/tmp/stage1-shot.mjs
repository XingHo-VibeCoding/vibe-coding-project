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

/* Stage 2：晚上该收尾时，顶卡主体直接变成「今天收个尾 + 开始复盘」（复盘不再常驻大卡） */
const p2 = await ctx.newPage()
await p2.goto(BASE + '?t=21:30', { waitUntil: 'domcontentloaded' })
await p2.waitForTimeout(900)
await p2.screenshot({ path: 'tmp/stage2-evening.png' })

/* 录音钮只在有安排正在进行时出现（用户 m12661）：08:30 正在上 08:00 那节 → 有钮 */
const p3 = await ctx.newPage()
await p3.goto(BASE + '?t=08:30', { waitUntil: 'domcontentloaded' })
await p3.waitForTimeout(900)
await p3.screenshot({ path: 'tmp/stage2-inclass.png' })
const inClass = await p3.locator('[data-today-rec-start]').count()
const offline = await page.locator('[data-today-rec-start]').count()
/* 课间空档：今天页不给录音钮（按需出现） */
const p4 = await ctx.newPage()
await p4.goto(BASE + '?t=12:30', { waitUntil: 'domcontentloaded' })
await p4.waitForTimeout(900)
await p4.screenshot({ path: 'tmp/stage2-noclass.png' })
const gap = await p4.locator('[data-today-rec-start]').count()
console.log(`录音钮：08:30 有课 = ${inClass} 个 / 12:30 空档 = ${gap} 个 / 现在 = ${offline} 个`)
await browser.close()
console.log('已写出 tmp/stage1-today-top.png / tmp/stage1-today-bottom.png / tmp/stage2-evening.png / tmp/stage2-inclass.png / tmp/stage2-noclass.png')
