import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const URL = 'http://127.0.0.1:4177/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
/* 走引导流程：课程时间设置 → 点第一节开始时间 → 弹 TimeWheel */
await page.locator('text=直接填学期信息，自己加课').click()
await page.waitForTimeout(400)
await page.locator('[data-ob-time]').click()
await page.waitForTimeout(400)
await page.locator('[data-ob-period-row="1"] button').first().click()
await page.waitForTimeout(700)
await page.screenshot({ path: 'tmp/shot-timewheel.png' })
console.log('done')
await browser.close()
