/* me-lectures-check：课堂录音页「默认最近 3 场 + 展开更多」必须成立。
   背景（2026-10-12，用户 m04810 拍板，取代原来的「按周分组折叠」）：
     按周分组仍然一次展开很长 —— 某一周录得多（期末、连堂），点开那一组照样铺十几场；
     想找的那场在上上周还要先猜它在哪个组里。改成一条倒序列表：默认只露最近 3 场，
     其余收在「展开全部（还有 N 场）」后面，一屏内永远看得完。
   本脚本守六件事：
     A. 默认只渲染最近 3 场（倒序），场次总数 5。
     B. 展开按钮显示剩余场数「还有 2 场」。
     C. 点展开 → 5 场全在；再点收起 → 回到 3 场。
     D. 展开/收起不影响状态类按钮（试听等）。
     E. 每场的原有内容（标题、元信息、试听按钮）都还在。
     F. 全程无 pageerror。
   跑法：先构建 + 起 dist 静态服务（默认 4177），再 node tmp/me-lectures-check.mjs */
import * as pw from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const { chromium } = pw
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE || 'http://127.0.0.1:4177/'

const FIXTURE = {
  version: 1,
  schedules: [{ id: 's1', name: '默认', first_monday: '2026-09-07', total_weeks: 18, entries: [] }],
  todos: [], routines: [], habits: [], listens: [], recs: [],
  semester: { first_monday: '2026-09-07', total_weeks: 18 },
}
/* 冻在 2026-10-12（周一）：本周一 = 10-12，上周一 = 10-05，再上周一 = 09-28 */
const LECTURES = [
  { id: 'l2', title: '周二那场', status: 'summarized', started_at: '2026-10-13T09:00:00.000Z', ended_at: '2026-10-13T09:45:00.000Z', duration_ms: 2700000, clip_count: 0, clips: [], created_at: '2026-10-13T09:00:00.000Z', updated_at: '2026-10-13T09:45:00.000Z' },
  { id: 'l1', title: '周一那场', status: 'summarized', started_at: '2026-10-12T10:00:00.000Z', ended_at: '2026-10-12T10:45:00.000Z', duration_ms: 2700000, clip_count: 1, clips: [{ index: 0, path: '/tmp/a.m4a', mime: 'audio/mp4', duration_ms: 2700000, recorded_at: '2026-10-12T10:00:00.000Z' }], created_at: '2026-10-12T10:00:00.000Z', updated_at: '2026-10-12T10:45:00.000Z' },
  { id: 'l3', title: '上周四那场', status: 'summarized', started_at: '2026-10-08T14:00:00.000Z', ended_at: '2026-10-08T14:45:00.000Z', duration_ms: 2700000, clip_count: 0, clips: [], created_at: '2026-10-08T14:00:00.000Z', updated_at: '2026-10-08T14:45:00.000Z' },
  { id: 'l4', title: '更早周四那场', status: 'summarized', started_at: '2026-10-01T10:00:00.000Z', ended_at: '2026-10-01T10:45:00.000Z', duration_ms: 2700000, clip_count: 0, clips: [], created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:45:00.000Z' },
  { id: 'l5', title: '更早周三那场', status: 'summarized', started_at: '2026-09-30T10:00:00.000Z', ended_at: '2026-09-30T10:45:00.000Z', duration_ms: 2700000, clip_count: 0, clips: [], created_at: '2026-09-30T10:00:00.000Z', updated_at: '2026-09-30T10:45:00.000Z' },
]
const clock = (iso) => `(() => { const F = ${new Date(iso).getTime()}; const D = Date; class CD extends D { constructor(...a) { if (a.length === 0) super(F); else super(...a) } static now() { return F } } window.Date = CD })()`

let pass = 0
let fail = 0
const ok = (name, cond, ev) => { if (cond) { pass++; console.log(`  [PASS] ${name}  ${ev}`) } else { fail++; console.log(`  [FAIL] ${name}  ${ev}`) } }

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.route('**cdn.jsdelivr.net/**', (r) => r.abort())
await ctx.addInitScript(clock('2026-10-12T14:30:00'))
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate(({ f, lecs }) => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', 'light')
  localStorage.setItem('web2.data', JSON.stringify(f))
  localStorage.setItem('web2.lectures', JSON.stringify(lecs))
  localStorage.removeItem('web2.dayOverrides')
}, { f: FIXTURE, lecs: LECTURES })
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('[data-page="today"]')
await page.waitForTimeout(1200)

const settle = () => page.evaluate(() => { for (const a of document.getAnimations()) { try { a.finish() } catch {} } })
const activeKey = () => page.evaluate(() => (document.querySelector('nav [data-nav][data-active="1"]') || {}).dataset?.nav || null)
async function clickTab(name) {
  for (let i = 0; i < 6; i++) {
    if ((await activeKey()) === name) return true
    await page.evaluate((n) => { const b = document.querySelector(`nav [data-nav="${n}"]`); if (b) b.click() }, name)
    await page.waitForTimeout(600)
    if ((await activeKey()) === name) return true
  }
  return false
}
async function clickSel(sel) {
  await page.evaluate((s) => { const b = document.querySelector(s); if (b) b.click() }, sel)
  await page.waitForTimeout(350)
  await settle()
}
/* 读出当前渲染的场次：id / 标题 / 元信息 / 是否有试听按钮 */
const readItems = () => page.evaluate(() => [...document.querySelectorAll('[data-lec-item]')].map((li) => ({
  id: li.getAttribute('data-lec-item'),
  title: li.querySelector('span.block.truncate')?.textContent?.trim() || null,
  meta: li.querySelector('span.block.text-\\[11px\\]')?.textContent?.replace(/\s+/g, ' ').trim() || null,
  hasPlay: [...li.querySelectorAll('button')].some((b) => /试听|暂停/.test(b.textContent)),
})))
const toggleText = () => page.evaluate(() => (document.querySelector('[data-lec-toggle]') || {}).textContent?.replace(/\s+/g, ' ').trim() || null)

/* ---------- 进课堂录音页 ---------- */
ok('A0 切到「我的」页', await clickTab('me'), 'active=' + await activeKey())
await clickSel('[data-me-lectures]')
await settle()
const pageTitle = await page.evaluate(() => (document.querySelector('[data-sub-title]') || {}).textContent?.trim())
ok('A1 进入课堂录音页', !!pageTitle, 'title=' + pageTitle)

/* ---------- A/B. 默认只露最近 3 场 + 展开按钮 ---------- */
const it1 = await readItems()
ok('A2 默认只渲染最近 3 场', it1.length === 3, 'n=' + it1.length + ' ids=' + JSON.stringify(it1.map((i) => i.id)))
ok('A3 顺序是倒序（最近的在前）', it1.map((i) => i.title).join(',') === '周二那场,周一那场,上周四那场', 'titles=' + it1.map((i) => i.title).join(','))
const tg1 = await toggleText()
ok('B1 展开按钮写明剩余场数（还有 2 场）', /展开全部/.test(tg1 || '') && /还有 2 场/.test(tg1 || ''), 'toggle=' + tg1)
ok('B2 展开按钮 aria-expanded=false', await page.evaluate(() => document.querySelector('[data-lec-toggle]')?.getAttribute('aria-expanded')) === 'false')

/* ---------- C. 展开 / 收起 ---------- */
await clickSel('[data-lec-toggle]')
const it2 = await readItems()
ok('C1 点展开 → 5 场全在', it2.length === 5, 'n=' + it2.length + ' ids=' + JSON.stringify(it2.map((i) => i.id)))
ok('C2 展开后按钮变「收起」', /收起/.test(await toggleText() || ''), 'toggle=' + await toggleText())
ok('C3 展开按钮 aria-expanded=true', await page.evaluate(() => document.querySelector('[data-lec-toggle]')?.getAttribute('aria-expanded')) === 'true')
await clickSel('[data-lec-toggle]')
const it3 = await readItems()
ok('C4 再点收起 → 回到最近 3 场', it3.length === 3 && it3.map((i) => i.title).join(',') === '周二那场,周一那场,上周四那场', 'n=' + it3.length + ' titles=' + it3.map((i) => i.title).join(','))

/* ---------- D/E. 场次原有内容还在（先展开到全部） ---------- */
await clickSel('[data-lec-toggle]')
const liDetail = await readItems()
ok('E1 每场都渲染标题 + 元信息行', liDetail.length === 5 && liDetail.every((d) => d.title && d.meta), JSON.stringify(liDetail.map((d) => d.title + ' / ' + d.meta)))
ok('E2 有音频片段的场次仍有试听按钮', liDetail.find((d) => d.title === '周一那场')?.hasPlay === true, 'hasPlay=' + liDetail.find((d) => d.title === '周一那场')?.hasPlay)
ok('D1 展开态下每场仍带长按删除的手势锚点（li 可点）', await page.evaluate(() => [...document.querySelectorAll('[data-lec-item]')].every((li) => li.getAttribute('class')?.includes('select-none'))))

/* ---------- F. 无报错 ---------- */
ok('F1 全程无 pageerror', errs.length === 0, errs.join(' | ') || '无')

await browser.close()
console.log(`\n== me-lectures-check: ${pass} 过 / ${fail} 挂 ==`)
process.exit(fail ? 1 : 0)
