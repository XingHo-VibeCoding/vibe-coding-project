/* 修复效果截图（2026-09-30）：form 三项页 / 课程时间设置三块 / 循环时间滚轮 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = 'http://127.0.0.1:4177/'
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.locator('text=直接填学期信息，自己加课').click()
await page.waitForTimeout(500)
await page.screenshot({ path: 'tmp/shot-d15-form.png' })
await page.locator('[data-ob-time]').click()
await page.waitForTimeout(600)
await page.screenshot({ path: 'tmp/shot-d15-periods.png' })
await page.locator('[data-ob-period-row="1"] button').first().click()
await page.waitForTimeout(800)
await page.screenshot({ path: 'tmp/shot-d15-wheel.png' })
await browser.close()
console.log('done: shot-d15-form.png / shot-d15-periods.png / shot-d15-wheel.png')
