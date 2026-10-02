/* 三期「宽限期补卡」专项测试（playwright，走 dist 静态服务）
   口径（用户拍板 2026-10-02）：宽限期 = 本周内（周一起始）且今天之前；
   补的卡与当天打的卡在界面上区分（空心勾 vs 实心勾），数据层记 backfilled。
   跑法：先起 dist 静态服务（默认 4177，可用 TW_URL 覆盖）再 node tmp/habit-page-check.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
let pass = 0, fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok ? '' : '  → ' + (extra ?? '')))
  ok ? pass++ : fail++
}

/* 与页面同一套日期算术（本地时区，YYYY-MM-DD 字典序即时间序） */
const p2d = (n) => String(n).padStart(2, '0')
const keyOf = (d) => d.getFullYear() + '-' + p2d(d.getMonth() + 1) + '-' + p2d(d.getDate())
const TODAY = keyOf(new Date())
const MONDAY = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return keyOf(d) })()
const GRACE = [] // 本周一 → 昨天
{ const c = new Date(MONDAY + 'T00:00:00'); const end = new Date(TODAY + 'T00:00:00'); while (c < end) { GRACE.push(keyOf(c)); c.setDate(c.getDate() + 1) } }
const IS_MONDAY = GRACE.length === 0

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url()) })

/* 预置：一个习惯，「本周一」打了卡（当天打，非补），今天未打 */
await page.addInitScript(([mon]) => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.habits', JSON.stringify([
    { id: 'hab_t', name: '宽限测试', created_at: '2026-01-01T00:00:00.000Z', records: { [mon]: true }, backfilled: {} },
  ]))
}, [MONDAY])
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)

/* 入口 A：今日页「管理 ›」直达打卡页 */
await page.locator('[data-today-habit-more]').click()
await page.waitForTimeout(500)
const card = page.locator('main').nth(2)
t('1. 「管理 ›」跳到打卡页', (await card.locator('h2', { hasText: '打卡记录' }).count()) === 1)

const row = card.locator('[data-habit-row]').filter({ hasText: '宽限测试' })
const states = () => row.locator('[data-habit-cell]').evaluateAll((els) => els.map((e) => e.dataset.cellState))
const stateMap = async () => Object.fromEntries((await states()).map((s, i) => {
  const key = row.locator('[data-habit-cell]').nth(i)
  return [key, s] // 占位，真实映射在下方 evaluate 里做
}))

/* 用日期精确取格子：data-habit-cell="<id>@<dateKey>" */
const cellOf = (key) => row.locator(`[data-habit-cell="hab_t@${key}"]`)
const stateOf = async (key) => (await cellOf(key).getAttribute('data-cell-state'))

/* 2. 本周形态 */
t('2. 今天那格存在', (await cellOf(TODAY).count()) === 1)
t('3. 今天未打 → today 态（不是 locked——首跑截图抓过这个误标）', (await stateOf(TODAY)) === 'today', await stateOf(TODAY))
t('4. 本周一打了卡且非补 → done', (await stateOf(MONDAY)) === 'done', await stateOf(MONDAY))

/* 5. 宽限期内未打的历史格 = open；数量与口径一致 */
const openKeys = []
for (const k of GRACE) if ((await stateOf(k)) === 'open') openKeys.push(k)
const expectOpen = GRACE.filter((k) => k !== MONDAY)
t('5. 宽限期内未打的历史格全部 open', openKeys.length === expectOpen.length, `open=${openKeys.length} 期望=${expectOpen.length}`)

/* 6. 未来两格 future */
if (!IS_MONDAY) {
  /* 今天周一时「明天」在本周内是 future；其余天同理——直接取本周最后一天（周日）判断 */
  const SUN = (() => { const d = new Date(MONDAY + 'T00:00:00'); d.setDate(d.getDate() + 6); return keyOf(d) })()
  t('6. 本周日（未来）→ future', (await stateOf(SUN)) === 'future', await stateOf(SUN))
}

/* 7. 补卡：点第一个 open 格 → 变 back，落盘 backfilled */
if (openKeys.length) {
  const k = openKeys[0]
  await cellOf(k).click()
  await page.waitForTimeout(300)
  t('7. 点击后该格变 back（空心勾视觉态）', (await stateOf(k)) === 'back', await stateOf(k))
  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('web2.habits')))[0]
  t('8. 落盘 records 有该日期', stored.records[k] === true)
  t('9. 落盘 backfilled 有该日期（留痕）', stored.backfilled && stored.backfilled[k] === true)
  t('10. 累计天数把补的卡算进去（共 2 天）', (await row.locator('span', { hasText: '共 2 天' }).count()) === 1)
  /* streak 不在这里断言：补的是本周初的格子、今天没打，中间断链显示「未开始」是正确行为
     （连续 = 从今天/昨天往回的连续段）；「补卡参与连续」已由 habit-unit.mjs 用连续日期覆盖 */

  /* 11. 取消补卡：两个字典同时清掉 */
  await cellOf(k).click()
  await page.waitForTimeout(300)
  const stored2 = JSON.parse(await page.evaluate(() => localStorage.getItem('web2.habits')))[0]
  t('11. 再点取消 → records 与 backfilled 同时清掉', !stored2.records[k] && !(stored2.backfilled || {})[k])
  t('12. 取消后格子回 open', (await stateOf(k)) === 'open', await stateOf(k))
} else {
  console.log('SKIP | 7–12 补卡交互（今天恰是周一，本周没有可补的过去日期）')
}

/* 13-15. 周切换：往回翻全锁定，不能往前翻过头 */
await page.locator('[data-habit-prev]').click()
await page.waitForTimeout(500)
const prevStates = await states()
t('13. 上一周 14 格（无未来）全部锁定/已有记录，无 open', !prevStates.includes('open'), JSON.stringify(prevStates))
t('14. 上一周无 today 格（今天不在上周）', !prevStates.includes('today'))
t('15. 周标签切到上周（· 已锁定）', (await card.locator('p', { hasText: '上周 · 已锁定' }).count()) === 1)

/* 16. 锁定格点击无副作用 */
const lockedCell = row.locator('[data-cell-state="locked"]').first()
const before = JSON.stringify(await page.evaluate(() => localStorage.getItem('web2.habits')))
await lockedCell.click()
await page.waitForTimeout(300)
t('16. 点锁定的历史格不写盘', JSON.stringify(await page.evaluate(() => localStorage.getItem('web2.habits'))) === before)

/* 17. 翻回本周；到本周后「下一周」按钮禁用（不允许看未来） */
await page.locator('[data-habit-next]').click()
await page.waitForTimeout(500)
t('17. 翻回本周后「下一周」按钮禁用', await page.locator('[data-habit-next]').isDisabled())

/* 18. 连点 53 次上一周：最多回到 52 周前，prev 按钮禁用（边界不越界） */
for (let i = 0; i < 53; i++) { await page.locator('[data-habit-prev]').click({ force: true }).catch(() => {}) }
t('18. 回看下界 52 周（到底后 prev 禁用）', await page.locator('[data-habit-prev]').isDisabled())

t('全程无页面报错', errors.length === 0)
if (errors.length) console.log('页面报错：\n' + errors.join('\n'))

await browser.close()
console.log(`\n结果：${pass} 过 / ${fail} 挂`)
process.exit(fail ? 1 : 0)
