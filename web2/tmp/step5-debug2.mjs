import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const BASE = 'http://127.0.0.1:4177/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 640 } })
const page = await ctx.newPage()
await page.addInitScript('localStorage.setItem("web2.onboarded","1");localStorage.removeItem("web2.data")')
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
console.log('--- 示例数据今天页 ---')
console.log(JSON.stringify(await page.evaluate(() => ({
  sem: (localStorage.getItem('web2.data') || '(none - 内置示例数据)').slice(0, 120),
  strip: (document.querySelector('[data-today-strip]') || {}).innerText,
  todayItems: document.querySelectorAll('[data-today-item]').length,
  todayText: (document.querySelector('[data-page="today"]') || {}).innerText?.slice(0, 300),
})), null, 2))
console.log('--- 打开待办浮层 ---')
await page.locator('button', { hasText: '添加待办' }).first().click()
await page.waitForTimeout(600)
console.log(JSON.stringify(await page.evaluate(() => {
  const sheet = document.querySelector('[data-sheet-todo]')
  return {
    hasSheet: !!sheet,
    innerText: sheet ? sheet.innerText : null,
    buttons: sheet ? [...sheet.querySelectorAll('button')].map((b) => JSON.stringify(b.innerText)) : [],
  }
}), null, 2))
await browser.close()
