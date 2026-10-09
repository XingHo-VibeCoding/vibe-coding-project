const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const src = resolve('tmp/today-cards-mock.html')

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1720, height: 1200 }, deviceScaleFactor: 2 })
await page.goto(pathToFileURL(src).href, { waitUntil: 'load' })
await page.waitForTimeout(400)

const cols = await page.$$('.col')
const names = ['0-now', '1-a', '2-b', '3-c', '4-d', '5-e', '6-combo']
for (let i = 0; i < cols.length; i++) {
  await cols[i].screenshot({ path: resolve(`tmp/today-card-${names[i]}.png`) })
  console.log('已写出 tmp/today-card-' + names[i] + '.png')
}
await browser.close()
