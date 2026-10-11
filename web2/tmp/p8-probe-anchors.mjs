import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const URL = 'https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })
await ctx.addInitScript(() => {
  const R = Date, F = new R('2026-10-12T14:30:00').getTime()
  class D extends R { constructor(...a) { a.length ? super(...a) : super(F) } static now() { return F } }
  window.Date = D
  localStorage.setItem('web2.onboarded', '1'); localStorage.setItem('web2.theme', 'light')
  localStorage.setItem('web2.data', JSON.stringify({ term: { name: '2026 秋', start: '2026-08-31', weeks: 18, segs: 12 }, courses: [{ id: 'c1', name: '高等数学', teacher: '张', room: 'A101', day: 1, seg: 1, segs: 1, color: 0 }], todos: [], events: [], routines: [] }))
})
const page = await ctx.newPage()
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(2500)
const b = page.locator('button', { hasText: /确定访问/ })
if (await b.count()) { await b.first().click().catch(() => {}); await page.waitForTimeout(4500) }

const dump = async (label) => {
  const d = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('[data-tab]')].map(e => e.getAttribute('data-tab')),
    weekAdd: !!document.querySelector('[data-week-add]'),
    weekMenu: !!document.querySelector('[data-week-menu]'),
    menuCourse: [...document.querySelectorAll('[data-week-menu-course],[data-week-menu-event],[data-week-menu-scan],[data-week-menu-dayover]')].map(e => e.textContent.trim()),
    meEntry: [...document.querySelectorAll('[data-me-entry]')].map(e => e.getAttribute('data-me-entry')),
    settingsToggle: !!document.querySelector('[data-settings-toggle]'),
    settingsIndex: [...document.querySelectorAll('[data-settings-index]')].map(e => e.getAttribute('data-settings-index')),
    lecItem: [...document.querySelectorAll('[data-lec-item]')].map(e => e.getAttribute('data-lec-item')),
  }))
  console.log(`--- ${label} ---`); console.log(JSON.stringify(d))
}
await dump('首屏')

// 找 tab 按钮真实锚点
console.log('全部 button 文本:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('button')].map(e => e.textContent.trim()).filter(Boolean).slice(0, 25))))
await browser.close()
