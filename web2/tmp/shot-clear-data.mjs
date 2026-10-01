/* 截图：清除数据入口 + 二次确认弹层（板块 A 效果图） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = 'http://127.0.0.1:4177/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.split('\n')[0]))
await page.addInitScript("localStorage.setItem('web2.onboarded','1'); localStorage.setItem('web2.data', JSON.stringify({semester:{name:'2026 秋冬'},schedules:[{type:'course',weekday:1,name:'高等数学',start:'08:00',end:'08:45',week_rule:'every'}]}))")
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.locator('text=我的').last().click()
await page.waitForTimeout(400)
/* 滚到清除入口可见（playwright 自动滚动即可，手动 scrollIntoView 反而会把它带出视口） */
await page.locator('[data-clear-entry]').scrollIntoViewIfNeeded()
await page.waitForTimeout(200)
await page.screenshot({ path: 'tmp/shot-clear-entry.png' })
await page.locator('[data-clear-entry]').evaluate((el) => el.click())
await page.waitForTimeout(400)
await page.screenshot({ path: 'tmp/shot-clear-confirm.png' })
console.log('done')
await browser.close()
