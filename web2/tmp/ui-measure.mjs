/* 量一下「今日」页每块占多高、要滚几屏（改版评估用，只读测量，不入库）
   跑法：先起 dist 静态服务（默认 4177），再 node tmp/ui-measure.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
const demo = page.locator('button', { hasText: '先用示例数据逛逛' })
if (await demo.count()) { await demo.first().click(); await page.waitForTimeout(800) }

const VP = 844
const NAV = 64 // 底部 tab 大约高度（含安全区）

for (const [label, key] of [['今日', 'today'], ['周课表', 'week'], ['日程', 'list'], ['打卡', 'habit'], ['我的', 'me']]) {
  await page.locator('nav button', { hasText: label }).click()
  await page.waitForTimeout(400)
  const info = await page.evaluate((k) => {
    const main = document.querySelector(`main[data-page="${k}"]`)
    const r = main.getBoundingClientRect()
    // 只量「直接子块」的高度（区块级）
    const blocks = [...main.children].map((el) => ({
      h: Math.round(el.getBoundingClientRect().height),
      t: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26),
    })).filter((b) => b.h > 4)
    return { scroll: Math.round(main.scrollHeight), blocks }
  }, key)
  const usable = VP - NAV
  console.log(`\n=== ${label}（内容高 ${info.scroll}px，可视 ${usable}px → ${(info.scroll / usable).toFixed(1)} 屏）`)
  for (const b of info.blocks) console.log(`   ${String(b.h).padStart(4)}px  ${b.t}`)
}
await browser.close()
