import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = process.env.BASE || 'https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/'
let pass = 0, fail = 0
const ok = (n, c, ev = '') => { if (c) { pass++; console.log('[PASS]', n, ev ? '— ' + ev : '') } else { fail++; console.log('[FAIL]', n, ev ? '— ' + ev : '') } }

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light' })
const page = await ctx.newPage()
page.on('pageerror', e => console.log('[pageerror]', e.message))

await page.goto(URL, { waitUntil: 'domcontentloaded' })

// 过腾讯云风险提醒中间页（倒计时 2s 后才能点）
if ((await page.title()) === '风险提醒') {
  const btn = page.locator('text=确定访问')
  await btn.waitFor({ state: 'visible', timeout: 15000 })
  // 等倒计时走完（按钮文案里有 (2s)）
  await page.waitForTimeout(2600)
  await btn.click()
  await page.waitForTimeout(1500)
}
ok('O0 过风险页后标题是大学生日程助手', (await page.title()) === '大学生日程助手', 'title=' + (await page.title()))

// 全新访客：清掉本站数据后重新载入
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)

await page.locator('[data-ob-choice-demo]').waitFor({ state: 'visible', timeout: 10000 })
ok('O1 线上引导层出现「先随便看看」出口', true)
const txt = (await page.locator('[data-ob-choice-demo]').innerText()).trim()
ok('O2 文案是白话', txt.includes('先随便看看'), txt)

await page.locator('[data-ob-choice-demo]').click()
await page.waitForTimeout(800)
ok('O3 点完引导层关闭', (await page.locator('[data-ob-choice-demo]').count()) === 0)

const nav = await page.locator('[data-nav="me"]').boundingBox()
const hit = await page.evaluate(([x, y]) => {
  const el = document.elementFromPoint(x, y)
  const n = el && el.closest('[data-nav]')
  return { inNav: !!n, tag: el ? el.tagName : null }
}, [nav.x + nav.width / 2, nav.y + nav.height / 2])
ok('O4 关掉后底部导航真能点到（不再是死锁）', hit.inNav === true, JSON.stringify(hit))

await page.locator('[data-nav="me"]').click()
await page.waitForTimeout(700)
const meTxt = await page.locator('body').innerText()
ok('O5 真点进「我的」', meTxt.includes('我的数据') || meTxt.includes('录音历史'))

console.log(`\n=== 线上验收：${pass} 过 / ${fail} 挂 ===`)
await browser.close()
process.exit(fail ? 1 : 0)
