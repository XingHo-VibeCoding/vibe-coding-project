/* 把 tmp/ui-options.html 拍成一张对比图（改版决策用，产物进 tmp/，不入库） */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 880, height: 1050 }, deviceScaleFactor: 2 })
await page.goto('file:///D:/Document/Project/vibe-coding-project/web2/tmp/ui-options.html')
await page.waitForTimeout(400)
await page.screenshot({ path: 'tmp/ui-options.png', fullPage: true })
console.log('已写出 tmp/ui-options.png')
await browser.close()
