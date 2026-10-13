// Day 27 验收图：外行试用记录（修复前死锁 → 修复后出路）。
// 产出 tmp/day27-shots/。
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177/'
const OUT = 'tmp/day27-shots'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await page.addInitScript(() => { try { localStorage.clear() } catch {} })

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/1-onboarding-choice.png` })
console.log('[shot] 1-onboarding-choice.png（引导层：三个入口 + 底部新增「先随便看看」出口）')

// 把底部导航区域放大截一张：证明引导层盖住导航（死锁本体）
const nav = await page.locator('[data-nav="me"]').boundingBox()
if (nav) {
  await page.screenshot({ path: `${OUT}/2-nav-covered.png`, clip: { x: 0, y: Math.max(0, nav.y - 70), width: 390, height: 130 } })
  console.log('[shot] 2-nav-covered.png（底部导航被引导层盖住/点不到）')
}

await page.locator('[data-ob-choice-demo]').click()
await page.waitForTimeout(1000)
await page.screenshot({ path: `${OUT}/3-after-demo-today.png` })
console.log('[shot] 3-after-demo-today.png（点「先随便看看」后落到今日页）')

await page.locator('[data-nav="me"]').click()
await page.waitForTimeout(900)
await page.screenshot({ path: `${OUT}/4-after-demo-me.png` })
console.log('[shot] 4-after-demo-me.png（关掉引导层后能进「我的」页）')

await browser.close()
