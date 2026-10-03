/* 方案 C · Step 1 结构自检（2026-10-03）
   断言：底部只剩 3 个 tab；课表页有「周课表/日程清单」分段且能切换；「今日」页打卡入口开浮层。
   跑法：先起 dist 静态服务（默认 4177），再 node tmp/step1-check.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')) }
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
const demo = page.locator('button', { hasText: '先用示例数据逛逛' })
if (await demo.count()) { await demo.first().click(); await page.waitForTimeout(800) }

console.log('\n[A] 底部导航')
const labels = await page.locator('nav button').allInnerTexts()
/* 「今日」上挂着未完成徽标，innerText 会是「3\n今日」，比较前把开头的数字剥掉 */
const names = labels.map(t => t.trim().replace(/^\d+\s*/, ''))
ok('只有 3 个 tab', labels.length === 3, '实际 ' + labels.length + '：' + JSON.stringify(names))
ok('依次是 今日/周课表/我的', JSON.stringify(names) === JSON.stringify(['今日', '周课表', '我的']), JSON.stringify(names))
ok('旧的「日程」「打卡」tab 已消失', !names.some(t => /日程|打卡/.test(t)))
ok('「今日」上的未完成徽标还在', /\d/.test(labels[0]))

console.log('\n[B] 课表页：周课表 / 日程清单 分段')
await page.locator('nav button', { hasText: '周课表' }).click()
await page.waitForTimeout(500)
ok('分段控件存在', await page.locator('[data-week-sub]').count() === 1)
ok('默认停在「周课表」', await page.locator('[data-week-grid], [data-week-label]').count() > 0)
const listVisibleBefore = await page.locator('[data-list-page]').isVisible().catch(() => false)
ok('默认不显示日程清单', !listVisibleBefore)
await page.locator('[data-week-sub-list]').click()
await page.waitForTimeout(400)
ok('切到「日程清单」后清单出现', await page.locator('[data-list-page]').isVisible())
ok('切到清单后周次切换收起', !(await page.locator('[data-week-label]').isVisible().catch(() => false)))
const canScroll = await page.evaluate(() => getComputedStyle(document.body).overflow !== 'hidden')
ok('清单页能上下滚动（body 未锁）', canScroll)
await page.locator('[data-week-sub-week]').click()
await page.waitForTimeout(400)
ok('切回「周课表」恢复网格', await page.locator('[data-week-label]').isVisible())
ok('切回后重新锁滚动', await page.evaluate(() => getComputedStyle(document.body).overflow === 'hidden'))

console.log('\n[C] 今日页打卡入口 → 浮层')
await page.locator('nav button', { hasText: '今日' }).click()
await page.waitForTimeout(500)
ok('浮层初始不显示', await page.locator('[data-habit-sheet]').count() === 0)
await page.locator('[data-today-habit-more]').first().click()
await page.waitForTimeout(500)
ok('点「管理 ›」打开打卡浮层', await page.locator('[data-habit-sheet]').isVisible())
ok('浮层里有打卡记录区', await page.locator('[data-habit-sheet] [data-habit-week], [data-habit-sheet] section').count() > 1)
await page.locator('[data-habit-sheet-mask]').click({ position: { x: 10, y: 10 } })
await page.waitForTimeout(400)
ok('点遮罩关闭浮层', await page.locator('[data-habit-sheet]').count() === 0)
await page.locator('[data-today-habit-more]').first().click()
await page.waitForTimeout(400)
await page.locator('[data-habit-sheet-close]').click()
await page.waitForTimeout(400)
ok('点「关闭」关闭浮层', await page.locator('[data-habit-sheet]').count() === 0)

console.log('\n[D] 页面平移')
const stripW = await page.evaluate(() => {
  const el = document.querySelector('main[data-page="today"]').parentElement
  return { strip: getComputedStyle(el).width, page: getComputedStyle(document.querySelector('main[data-page="today"]')).width, body: document.body.clientWidth }
})
ok('平移层宽度 = 3 屏（约 3× 视口）', Math.abs(parseFloat(stripW.strip) - stripW.body * 3) < 3, JSON.stringify(stripW))

await browser.close()
console.log(`\nStep 1 自检：${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
