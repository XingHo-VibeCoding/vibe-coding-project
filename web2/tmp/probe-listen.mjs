/* 一次性探针：练耳二级页为什么空白。
   只干三件事：推二级页 → 打印 [data-sub-body] 的 HTML 长度与首段文字 → 打印所有 console 消息与 pageerror。
   Vue 的渲染期错误不会进 pageerror，只能靠 console.error 抓。 */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const today = new Date().toISOString().slice(0, 10)
const CLIP = { id: 'clip-1', name: '种子音频', file: 'seed.m4a', seconds: 45, played_count: 2, review_stage: 1, next_due_date: today, repeat_times: null, archived: false, created_at: new Date().toISOString() }

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } })
const page = await ctx.newPage()
page.on('console', (m) => console.log('[console.' + m.type() + '] ' + m.text().slice(0, 300)))
page.on('pageerror', (e) => console.log('[pageerror] ' + String(e).slice(0, 300)))
await page.addInitScript((clip) => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.listen', JSON.stringify([clip]))
}, CLIP)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.evaluate(() => document.querySelector('[data-me-entry="listen"]')?.click())
await page.waitForTimeout(600)
const collapsed = await page.evaluate(() => document.querySelector('[data-sub-body]')?.innerText.replace(/\s+/g, ' ').slice(0, 120))
console.log('收起态 =', collapsed)
await page.evaluate(() => {
  const body = document.querySelector('[data-sub-body]')
  const b = body && [...body.querySelectorAll('button')].find((x) => x.textContent.trim() === '打开')
  if (b) b.click()
})
await page.waitForTimeout(600)
console.log('--- 点过「打开」之后 ---')
const info = await page.evaluate(() => {
  const body = document.querySelector('[data-sub-body]')
  return {
    subPage: document.querySelector('[data-sub-page]')?.getAttribute('data-sub') ?? null,
    bodyLen: body ? body.innerHTML.length : -1,
    bodyText: body ? body.innerText.replace(/\s+/g, ' ').slice(0, 120) : '(没有 data-sub-body)',
    panels: [...document.querySelectorAll('[data-sub-body] > *')].map((el) => el.tagName + '.' + (el.className || '').slice(0, 40)),
  }
})
console.log('子页 =', info.subPage, '| body HTML 长度 =', info.bodyLen)
console.log('正文 =', info.bodyText)
console.log('子节点 =', JSON.stringify(info.panels, null, 1))
await browser.close()
