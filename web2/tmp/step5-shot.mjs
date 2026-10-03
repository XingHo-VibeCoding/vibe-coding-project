/* Step 5 截图：小屏（390×640）下长浮层滚到底 + picker 叠浮层
   跑法：先起 dist 静态服务（4177）再 node tmp/step5-shot.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import { readFileSync } from 'node:fs'

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const OUT = 'D:/Document/Project/vibe-coding-project/web2/tmp/'
const seed = 'localStorage.setItem("web2.onboarded","1");localStorage.setItem("web2.data",' +
  JSON.stringify(readFileSync('D:/Document/Project/vibe-coding-project/web2/tmp/valid-export.json', 'utf8')) + ');'

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 640 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript(seed)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)

/* 1) 编辑学期浮层：滚到底，底部按钮够得着（这是本步修的核心问题） */
await page.locator('nav button', { hasText: '我的' }).click()
await page.waitForTimeout(450)
await page.locator('button[aria-label="编辑学期信息"]').click()
await page.waitForTimeout(500)
await page.screenshot({ path: OUT + 'step5-sem-top.png' })
await page.evaluate(() => { const p = document.querySelector('[data-sheet-sem]'); p.scrollTop = p.scrollHeight })
await page.waitForTimeout(500)
await page.screenshot({ path: OUT + 'step5-sem-bottom.png' })
await page.locator('[data-sheet-mask]').click({ position: { x: 10, y: 10 } })
await page.waitForTimeout(500)

/* 2) 待办浮层里再叠一层 picker：两级遮罩各管各的、底下页面不动 */
await page.locator('nav button', { hasText: '今日' }).click()
await page.waitForTimeout(500)
await page.locator('button', { hasText: '添加待办' }).first().click()
await page.waitForTimeout(500)
await page.locator('[data-sheet-todo] button').first().click()
await page.waitForTimeout(600)
await page.screenshot({ path: OUT + 'step5-todo-picker.png' })

await browser.close()
console.log('已写出 step5-sem-top.png / step5-sem-bottom.png / step5-todo-picker.png')
