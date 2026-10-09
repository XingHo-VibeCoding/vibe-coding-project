const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1240, height: 1100 }, deviceScaleFactor: 2 })
await page.goto(pathToFileURL(resolve('tmp/today-cards-fix.html')).href, { waitUntil: 'load' })
await page.waitForTimeout(400)
const cols = await page.$$('.col')
const names = ['w', 'y']
for (let i = 0; i < cols.length && i < names.length; i++) {
  await cols[i].screenshot({ path: resolve('tmp/today-fix-' + names[i] + '.png') })
  console.log('已写出 tmp/today-fix-' + names[i] + '.png')
}
await browser.close()
