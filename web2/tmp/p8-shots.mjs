/* 公网地址验收截图：今日页 / 周课表 ＋ 选单 / 录音历史默认 3 场。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const URL = 'https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'light' })
await ctx.addInitScript(() => {
  const R = Date, F = new R('2026-10-12T14:30:00').getTime()
  class D extends R { constructor(...a) { a.length ? super(...a) : super(F) } static now() { return F } }
  window.Date = D
  localStorage.setItem('web2.onboarded', '1'); localStorage.setItem('web2.theme', 'light')
  localStorage.setItem('web2.data', JSON.stringify({
    term: { name: '2026 秋季学期', start: '2026-08-31', weeks: 18, segs: 12 },
    courses: [
      { id: 'c1', name: '高等数学', teacher: '张明', room: '教二 110', day: 1, seg: 1, segs: 2, color: 0 },
      { id: 'c2', name: '线性代数', teacher: '赵敏', room: '教二 110', day: 1, seg: 7, segs: 2, color: 1 },
      { id: 'c3', name: '大学英语', teacher: '王芳', room: '外语楼 305', day: 3, seg: 3, segs: 2, color: 2 },
    ],
    todos: [{ id: 't1', text: '高数作业：第三章习题 1-10', due: '2026-10-12' }],
    events: [], routines: [],
  }))
  const mk = (id, date, title, at, ms) => ({ id, date, title, started_at: new R(at).toISOString(), status: 'transcribed', clips: [], ms })
  localStorage.setItem('web2.lectures', JSON.stringify([
    mk('l1', '2026-10-12', '高等数学', 1791600000000, 5400000),
    mk('l2', '2026-10-12', '线性代数', 1791606000000, 4800000),
    mk('l3', '2026-10-07', '大学英语', 1791200000000, 5100000),
    mk('l4', '2026-09-30', '高等数学', 1790600000000, 5000000),
    mk('l5', '2026-09-28', '线性代数', 1790400000000, 4600000),
  ]))
})
const page = await ctx.newPage()
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(2500)
const b = page.locator('button', { hasText: /确定访问/ })
if (await b.count()) { await b.first().click().catch(() => {}); await page.waitForTimeout(4500) }
await page.waitForTimeout(800)

await page.screenshot({ path: 'tmp/p8-1-today.png' })
console.log('① 今日页 -> tmp/p8-1-today.png')

await page.locator('button', { hasText: /^周课表$/ }).first().click().catch(() => {})
await page.waitForTimeout(1400)
await page.locator('[data-week-add]').first().click().catch(() => {})
await page.waitForTimeout(900)
await page.screenshot({ path: 'tmp/p8-2-weekmenu.png' })
console.log('② 周课表 ＋ 选单 -> tmp/p8-2-weekmenu.png')

await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(700)
await page.locator('button', { hasText: /^我的$/ }).first().click().catch(() => {})
await page.waitForTimeout(1400)
await page.locator('[data-me-entry="lectures"]').first().click().catch(() => {})
await page.waitForTimeout(1500)
await page.screenshot({ path: 'tmp/p8-3-lectures.png' })
console.log('③ 录音历史（最近 3 场）-> tmp/p8-3-lectures.png')

await browser.close()
