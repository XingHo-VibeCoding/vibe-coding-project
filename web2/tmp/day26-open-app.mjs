// Day 26 截图：打开真实 Chrome 窗口（headed，带地址栏），等页面就绪后停住等外部截屏
// 跑法：node tmp/day26-open-app.mjs  （脚本自己处理腾讯云风险提醒中间页）
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL_ = process.argv[2] || 'https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/'
const HOLD = Number(process.argv[3] || 30) * 1000

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: ['--window-size=460,960', '--window-position=60,20', '--no-first-run', '--no-default-browser-check'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 860 } })
await page.goto(URL_, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)

// 腾讯云免费托管域名的「风险提醒」中间页：找按钮点进去
let title = await page.title()
console.log('[1] title =', title)
if (!title.includes('大学生日程助手')) {
  for (const sel of ['text=确定访问', 'text=继续访问', 'button:has-text("确定")', 'text=我知道了']) {
    const n = await page.locator(sel).count()
    if (n > 0) {
      console.log('[2] clicking risk-page button:', sel)
      await page.locator(sel).first().click()
      await page.waitForTimeout(3000)
      break
    }
  }
}
title = await page.title()
console.log('[3] title now =', title)
const anchors = await page.evaluate(() => ({
  hasToday: !!document.querySelector('[data-today-scroll]'),
  hasHero: !!document.querySelector('[data-hero-wrap]'),
  body: document.body.innerText.slice(0, 120).replace(/\n+/g, ' | '),
}))
console.log('[4] anchors =', JSON.stringify(anchors))
console.log('READY  — holding', HOLD / 1000, 's for external screen capture')
await page.waitForTimeout(HOLD)
await browser.close()
console.log('DONE')
