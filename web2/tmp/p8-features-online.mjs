/* 线上验本批新功能（锚点已按源码实测校正）：
   ① ＋ 选单恰 4 项（data-week-menu-course/event/scan/dayover，无「其他日程」）
   ② 设置索引页 5 行（data-settings-index）
   ③ 录音历史默认 3 场 + 有「展开全部」开关（data-lec-item / data-lec-toggle）
   跑法：cd web2 && node tmp/p8-features-online.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const URL = 'https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/'
let pass = 0, fail = 0
const ok = (n, c, ev) => { c ? (pass++, console.log(`  PASS  ${n} | ${ev || ''}`)) : (fail++, console.log(`  FAIL  ${n} | ${ev || ''}`)) }

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })
await ctx.addInitScript(() => {
  const R = Date, F = new R('2026-10-12T14:30:00').getTime()
  class D extends R { constructor(...a) { a.length ? super(...a) : super(F) } static now() { return F } }
  window.Date = D
  localStorage.setItem('web2.onboarded', '1'); localStorage.setItem('web2.theme', 'light')
  localStorage.setItem('web2.data', JSON.stringify({
    term: { name: '2026 秋', start: '2026-08-31', weeks: 18, segs: 12 },
    courses: [{ id: 'c1', name: '高等数学', teacher: '张', room: 'A101', day: 1, seg: 1, segs: 1, color: 0 }],
    todos: [], events: [], routines: [],
  }))
  // 字段名必须对齐 store.js 的 sanitizeLecture：started_at（不是 startedAt）+ status 白名单，
  // 缺 status 或字段名错会被整条剔除（第一次假数据就是这么被清空的）。
  const mk = (id, date, title, at, ms) => ({ id, date, title, started_at: new Date(at).toISOString(), status: 'transcribed', clips: [], ms })
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

// ① 进周课表 → 点右上 ＋ → 数选单项
await page.locator('button', { hasText: /^周课表$/ }).first().click().catch(() => {})
await page.waitForTimeout(1300)
await page.locator('[data-week-add]').first().click().catch(() => {})
await page.waitForTimeout(900)
const menu = await page.evaluate(() => {
  const sel = '[data-week-menu-course],[data-week-menu-event],[data-week-menu-scan],[data-week-menu-dayover]'
  return { open: !!document.querySelector('[data-week-menu]'), items: [...document.querySelectorAll(sel)].map(e => e.textContent.trim()) }
})
ok('＋ 选单已展开', menu.open, `open=${menu.open}`)
ok('＋ 选单恰 4 项', menu.items.length === 4, JSON.stringify(menu.items))
ok('选单里没有「其他日程」', !menu.items.some(t => /其他日程/.test(t)), JSON.stringify(menu.items))

// ② 我的 → 设置 → 索引页 5 行
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(700)
// 底部 tab 没有 data-* 锚点，只能按精确按钮文本点（"我的" 与文案里其它「我的」区分开）
await page.locator('button', { hasText: /^我的$/ }).first().click({ timeout: 10000 }).catch(e => console.log('  INFO  切「我的」失败：' + e.message.split('\n')[0]))
await page.waitForTimeout(1500)
const meEntry = await page.evaluate(() => [...document.querySelectorAll('[data-me-entry]')].map(e => e.getAttribute('data-me-entry')))
console.log('  INFO  我的页入口 = ' + JSON.stringify(meEntry))
await page.locator('[data-me-entry="settings"]').first().click({ timeout: 10000 }).catch(e => console.log('  INFO  进设置失败：' + e.message.split('\n')[0]))
await page.waitForTimeout(1500)
const idx = await page.evaluate(() => [...document.querySelectorAll('[data-settings-index]')].map(e => e.getAttribute('data-settings-index')))
ok('设置索引页 5 行', idx.length === 5, JSON.stringify(idx))

// ③ 先进「我的 → 录音」二级页 → 录音历史默认 3 场
//    注意：`data-lec-item` 属 LecturesPanel（App.vue:4947 `v-if="meSub === 'lectures'"`），
//    入口是「我的」页的 data-me-entry="lectures"，**不在设置里的 recording 子页**（那里是录音/纪要的开关）。
//    当前人在设置索引页，先退一层回「我的」。
await page.locator('[data-sub-back]').first().click({ timeout: 8000 }).catch(() => {})
await page.waitForTimeout(1000)
await page.locator('[data-me-entry="lectures"]').first().click({ timeout: 10000 }).catch(e => console.log('  INFO  进录音页失败：' + e.message.split('\n')[0]))
await page.waitForTimeout(1500)
const lec = await page.evaluate(() => {
  const items = [...document.querySelectorAll('[data-lec-item]')].map(e => e.getAttribute('data-lec-item'))
  const t = document.querySelector('[data-lec-toggle]')
  return { items, toggle: t ? t.textContent.trim().replace(/\s+/g, ' ') : null }
})
ok('录音历史默认只露 3 场', lec.items.length === 3, JSON.stringify(lec.items))
ok('有「展开全部」开关', !!lec.toggle, `toggle=${lec.toggle}`)

await page.screenshot({ path: 'tmp/p8-features-online.png' })
console.log('截图：web2/tmp/p8-features-online.png')
console.log(`\n合计：${pass} 过 / ${fail} 挂`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
