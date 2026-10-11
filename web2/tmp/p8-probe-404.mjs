import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const URL = 'https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
const bad = []
page.on('response', r => { if (r.status() >= 400) bad.push({ status: r.status(), url: r.url() }) })
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(2500)
const btn = page.locator('button', { hasText: /确定访问/ })
if (await btn.count()) { await btn.first().click().catch(() => {}); await page.waitForTimeout(4500) }
console.log('--- 4xx/5xx 响应 ---')
console.log(JSON.stringify(bad, null, 1))
console.log('--- #app 首屏文本 ---')
console.log((await page.evaluate(() => document.querySelector('#app').innerText)).slice(0, 400))
await browser.close()
