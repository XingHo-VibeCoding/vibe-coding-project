/* 渲染 today-dup-options.html → 一张总图 + 三张按列裁图 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = 'tmp'
const path = (await import('node:path')).default
const url = 'file:///' + path.resolve('tmp/today-dup-options.html').replace(/\\/g, '/')

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 1460, height: 1100 }, deviceScaleFactor: 2 })
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/today-dup-options.png`, fullPage: true })
console.log('wrote', `${OUT}/today-dup-options.png`)

const cols = await page.locator('.col').all()
const names = ['now', 'a', 'b', 'c']
for (let i = 0; i < cols.length; i++) {
  await cols[i].screenshot({ path: `${OUT}/today-dup-opt-${names[i]}.png` })
  console.log('wrote', `${OUT}/today-dup-opt-${names[i]}.png`)
}
await browser.close()
