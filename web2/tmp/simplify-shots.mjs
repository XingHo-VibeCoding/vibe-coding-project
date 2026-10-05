/* 页面臃肿体检 + 现状截图。
   跑法：先起 dist 静态服务（cd web2; $env:PORT='4177'; node serve.js）再 node tmp/simplify-shots.mjs
   产出：tmp/simplify-now-{today,me,week}.png + 控制台打印每个板块实测高度 */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript(() => localStorage.setItem('web2.onboarded', '1'))
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)

// ---- 今日页：板块体检 ----
const today = await page.evaluate(() => {
  const main = document.querySelector('[data-page="today"]')
  const kids = [...main.children]
  const rows = kids.map((el) => {
    const r = el.getBoundingClientRect()
    const h2 = el.querySelector('h2')
    const label = (h2 ? h2.innerText : el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 28)
    return { label: label || '(无标题)', h: Math.round(r.height), data: el.getAttribute('data-today-habit') != null ? 'data-today-habit' : (el.dataset && Object.keys(el.dataset)[0]) || '' }
  })
  // 卡片级：每个 .rounded-2xl 或带 data-* 的一级子块
  return rows
})
console.log('=== 今日页板块（自上而下） ===')
today.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${String(r.h).padStart(4)}px  ${r.label}${r.data ? '   [' + r.data + ']' : ''}`))
console.log('今日页板块合计：' + today.reduce((s, r) => s + r.h, 0) + 'px，共 ' + today.length + ' 块')
await page.screenshot({ path: 'tmp/simplify-now-today.png', fullPage: true })

// ---- 我的页 ----
await page.locator('nav button', { hasText: '我的' }).click()
await page.waitForTimeout(600)
const me = await page.evaluate(() => {
  const main = document.querySelector('[data-page="me"]')
  return [...main.children].map((el) => {
    const r = el.getBoundingClientRect()
    const t = (el.querySelector('h2, .font-semibold') || el).innerText.replace(/\s+/g, ' ').trim().slice(0, 28)
    return { label: t || '(无标题)', h: Math.round(r.height) }
  })
})
console.log('=== 我的页板块（自上而下） ===')
me.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}. ${String(r.h).padStart(4)}px  ${r.label}`))
console.log('我的页板块合计：' + me.reduce((s, r) => s + r.h, 0) + 'px，共 ' + me.length + ' 块')
await page.screenshot({ path: 'tmp/simplify-now-me.png', fullPage: true })

// ---- 周课表 ----
await page.locator('nav button', { hasText: '周课表' }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: 'tmp/simplify-now-week.png', fullPage: true })

console.log('已写出 tmp/simplify-now-today.png / simplify-now-me.png / simplify-now-week.png')
await browser.close()
