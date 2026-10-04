/* 方案 C · Step 5「二级页收尾」验证：
   1) 每个底部浮层都能滚到底（小屏 390×640 下长表单不再够不着底部按钮）
   2) 浮层遮罩统一锚点 data-sheet-mask（picker 用 data-picker-mask）
   3) 背景滚动锁：浮层开着时锁住底下页面，关掉恢复；周课表子视图照旧锁
   4) 返回键一路往回收：练耳设置面板 → 设置折叠 → 课表子视图 → 回今日页
   5) 改版留下的僵尸注释已清（静态断言）
   跑法：先起 dist 静态服务（4177）再 node tmp/step5-check.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import { readFileSync } from 'node:fs'

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const APP = 'D:/Document/Project/vibe-coding-project/web2/src/App.vue'
const SHEET = 'D:/Document/Project/vibe-coding-project/web2/src/components/BottomSheet.vue'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}
/* 日期敏感项：示例数据 web2/src/data/mock.js 的 weekCourses 无周日，
   周日跑时今天页一条安排都没有，点「今天页第一条安排」的断言无从谈起。 */
function skip(name, why) {
  results.push([name, true, why])
  console.log('SKIP ' + name + ' ← ' + why)
}

/* 假 App 桥：只为拿到 backButton 回调（与 backbutton-check.mjs 同款） */
const fakeAppPlugin = `
window.Capacitor = { Plugins: {
  App: {
    _cbs: [],
    addListener(name, cb) { if (name === 'backButton') this._cbs.push(cb); return { remove: function () {} } },
    _fire() { for (const cb of this._cbs.slice()) cb({ canGoBack: false }) },
    exitApp() { this._exited = (this._exited || 0) + 1 }
  }
}}`

const seed = 'localStorage.setItem("web2.onboarded","1");localStorage.setItem("web2.data",' +
  JSON.stringify(readFileSync('D:/Document/Project/vibe-coding-project/web2/tmp/valid-export.json', 'utf8')) + ');'

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
/* 小屏（iPhone SE 尺寸）——长表单最容易够不着底部的场景 */
const ctx = await browser.newContext({ viewport: { width: 390, height: 640 } })
const page = await ctx.newPage()
await page.addInitScript(fakeAppPlugin)
await page.addInitScript(seed)

const fire = () => page.evaluate(() => window.Capacitor.Plugins.App._fire())
const exits = () => page.evaluate(() => window.Capacitor.Plugins.App._exited || 0)
const overflow = () => page.evaluate(() => document.body.style.overflow)
const activeTab = () => page.evaluate(() => {
  /* 用 data-active 认当前 tab（原先按 class 里的 text-primary-500 找，主色文字换成 primary-600 后会失效） */
  const b = document.querySelector('nav button[data-active]')
  return b ? (b.innerText || '').trim() : ''
})
const box = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), sh: el.scrollHeight, ch: el.clientHeight }
}, sel)

try {
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)

  /* ---------- A. 长浮层在小屏能滚到底（编辑学期：内容比 86vh 高） ---------- */
  await page.locator('nav button', { hasText: '我的' }).click()
  await page.waitForTimeout(450)
  await page.locator('button[aria-label="编辑学期信息"]').click()
  await page.waitForTimeout(450)
  const sem = await box('[data-sheet-sem]')
  t('A1. 编辑学期浮层已打开（data-sheet-sem）', !!sem)
  t(`A2. 面板高度被 86vh 卡住（实测 ${sem && sem.h}px，上限 ${Math.round(640 * 0.86) + 1}px）`, sem && sem.h <= Math.round(640 * 0.86) + 1)
  t(`A3. 内容确实比可视区高、可以滚（scrollHeight ${sem && sem.sh} > clientHeight ${sem && sem.ch}）`, sem && sem.sh > sem.ch + 1)
  /* 滚到底后，面板底部那几个按钮必须真的落在可视区内（就是这次要修的「够不着」） */
  const reach = await page.evaluate(() => {
    const panel = document.querySelector('[data-sheet-sem]')
    panel.scrollTop = panel.scrollHeight
    const btns = [...panel.querySelectorAll('button')]
    const save = btns.find((b) => (b.innerText || '').trim() === '保存')
    if (!save) return { ok: false, why: '没找到保存按钮' }
    const r = save.getBoundingClientRect()
    const pr = panel.getBoundingClientRect()
    return { ok: r.bottom <= pr.bottom + 1 && r.top >= pr.top - 1, saveBottom: Math.round(r.bottom), panelBottom: Math.round(pr.bottom) }
  })
  t(`A4. 滚到底后「保存」按钮完整落在可视区内（${reach.saveBottom} ≤ ${reach.panelBottom}）`, reach.ok)

  /* ---------- B. 背景滚动锁 ---------- */
  t('B1. 浮层开着 → body 滚动被锁', (await overflow()) === 'hidden')
  await page.locator('[data-sheet-mask]').click({ position: { x: 10, y: 10 } })
  await page.waitForTimeout(500)
  t('B2. 点遮罩关掉浮层 → 滚动恢复', (await overflow()) === '')
  t('B3. 浮层真的关了', (await page.locator('[data-sheet-sem]').count()) === 0)

  /* ---------- C. 遮罩锚点统一：底部浮层各 1 个 data-sheet-mask ---------- */
  /* 2026-10-03 Step 6：外壳收进 components/BottomSheet.vue，App.vue 里不再有字面量，
     改为「N 处都走 <BottomSheet>」+「锚点写在组件里」两条静态断言。
     2026-10-04 五期复盘加了第 8 个（data-sheet-review），计数由 7 改 8。 */
  t('C1. 静态：8 个浮层都走 BottomSheet，data-sheet-mask 在组件里',
    (readFileSync(APP, 'utf8').match(/<BottomSheet/g) || []).length === 8 &&
      readFileSync(SHEET, 'utf8').includes('data-sheet-mask'))
  /* 打卡浮层（今日页「管理 ›」）—— 种子数据带 1 个习惯 */
  await page.locator('nav button', { hasText: '今日' }).click()
  await page.waitForTimeout(450)
  await page.locator('[data-today-habit-more]').first().click()
  await page.waitForTimeout(450)
  t('C2. 打卡浮层：1 个 data-sheet-mask + 保留 data-habit-sheet-mask',
    (await page.locator('[data-sheet-mask]').count()) === 1 && (await page.locator('[data-habit-sheet-mask]').count()) === 1)
  t('C3. 打卡浮层开着时滚动被锁', (await overflow()) === 'hidden')
  await page.locator('[data-habit-sheet-close]').click()
  await page.waitForTimeout(500)
  t('C4. 关掉打卡浮层 → 滚动恢复', (await overflow()) === '')

  /* ---------- D. 返回键分级：练耳设置面板 → 设置折叠 → 课表子视图 → 回今日页 ---------- */
  await page.locator('nav button', { hasText: '我的' }).click()
  await page.waitForTimeout(450)
  /* 练耳卡先展开，才看得到「练耳设置」开关 */
  await page.locator('[data-page="me"] button', { hasText: '打开' }).first().click()
  await page.waitForTimeout(400)
  await page.locator('[data-listen-settings-toggle]').click()
  await page.waitForTimeout(400)
  t('D1. 练耳设置面板已展开', (await page.locator('[data-listen-settings]').count()) === 1)
  await fire()
  await page.waitForTimeout(400)
  t('D2. 返回键只收起练耳设置面板（未退出、未切页）',
    (await page.locator('[data-listen-settings]').count()) === 0 && (await exits()) === 0 && (await activeTab()).includes('我的'))
  /* 设置折叠 */
  await page.locator('[data-settings-toggle]').click()
  await page.waitForTimeout(400)
  t('D3. 设置折叠已展开', (await page.locator('[data-settings-body]').count()) === 1)
  await fire()
  await page.waitForTimeout(400)
  t('D4. 返回键收起设置折叠',
    (await page.locator('[data-settings-body]').count()) === 0 && (await exits()) === 0 && (await activeTab()).includes('我的'))
  /* 课表「其他日程」子视图 */
  await page.locator('nav button', { hasText: '周课表' }).click()
  await page.waitForTimeout(450)
  await page.locator('[data-week-sub-list]').click()
  await page.waitForTimeout(500)
  t('D5. 已切到「其他日程」子视图（此视图可上下滚，不该锁滚动）',
    (await page.locator('[data-list-page]').count()) === 1 && (await overflow()) === '')
  await fire()
  await page.waitForTimeout(500)
  t('D6. 返回键回到「周课表」子视图（不直接跳今日页）',
    (await page.locator('[data-grid]').count()) === 1 && (await page.locator('[data-list-page]').count()) === 0 && (await overflow()) === 'hidden')
  await fire()
  await page.waitForTimeout(500)
  t('D7. 再按返回 → 回今日页', (await activeTab()).includes('今日') && (await exits()) === 0)

  /* ---------- C 续：课程详情 / 待办 / picker 三类浮层（换回内置示例数据——种子数据今天没课）
     注意：种子是 addInitScript，每次导航都会重放，所以这里必须另开一个 context/page，
     不能在同一个 page 上「删 key + reload」（reload 会把种子又灌回去）。 ---------- */
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 640 } })
  const page2 = await ctx2.newPage()
  await page2.addInitScript(fakeAppPlugin)
  await page2.addInitScript('localStorage.setItem("web2.onboarded","1")')
  await page2.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page2.waitForTimeout(900)
  const overflow2 = () => page2.evaluate(() => document.body.style.overflow)
  if ((await page2.locator('[data-today-item]').count()) === 0) {
    skip('C5. 课程详情浮层自带 data-sheet-mask（点今天页第一条安排）', '今天页没有安排（示例数据无周日课）')
  } else {
    t('C5. 课程详情浮层自带 data-sheet-mask（点今天页第一条安排）', await (async () => {
      await page2.locator('[data-today-item]').first().click()
      await page2.waitForTimeout(500)
      const ok = (await page2.locator('[data-sheet-mask]').count()) === 1 && (await page2.locator('[data-sheet-detail]').count()) === 1
      await page2.locator('[data-sheet-mask]').click({ position: { x: 10, y: 10 } })
      await page2.waitForTimeout(500)
      return ok
    })())
  }
  /* 待办编辑浮层（今天页「＋ 添加待办」） */
  await page2.locator('button', { hasText: '添加待办' }).first().click()
  await page2.waitForTimeout(450)
  t('C6. 待办浮层自带 data-sheet-mask', (await page2.locator('[data-sheet-mask]').count()) === 1 && (await page2.locator('[data-sheet-todo]').count()) === 1)
  /* 待办浮层里开日期 picker → 遮罩是 data-picker-mask，不是 sheet mask */
  await page2.locator('[data-sheet-todo] button').first().click()
  await page2.waitForTimeout(450)
  t('C7. picker 遮罩用 data-picker-mask（且不被误算成 sheet 遮罩）',
    (await page2.locator('[data-picker-mask]').count()) === 1 && (await page2.locator('[data-sheet-mask]').count()) === 1)
  t('C8. picker 开着时滚动仍锁住', (await overflow2()) === 'hidden')
  await page2.evaluate(() => window.Capacitor.Plugins.App._fire())
  await page2.waitForTimeout(400)
  t('C9. 返回键先收 picker、待办浮层还在（且滚动仍锁）',
    (await page2.locator('[data-picker-mask]').count()) === 0 && (await page2.locator('[data-sheet-todo]').count()) === 1 && (await overflow2()) === 'hidden')
  await ctx2.close()

  /* ---------- E. 僵尸注释已清（描述已删页面的注释不该留在源码里） ---------- */
  const src = readFileSync(APP, 'utf8')
  t('E1. 没有「日程清单页」僵尸注释', !src.includes('日程清单页'))
  t('E2. 没有「打卡页（三期「每日打卡」）」僵尸注释', !src.includes('打卡页（三期「每日打卡」'))
  t('E3. 平移层注释已改「三页并排各占 1/3」', src.includes('三页并排各占 1/3') && !src.includes('四页并排各占 1/4'))
  t('E4. 「不用 disabled」的设计理由被保留（搬到打卡浮层注释）', src.includes('改由 onHabitCell 静默忽略'))
  t('E5. 打卡宽限期补卡的逻辑注释仍在（那是活功能，不是僵尸）', src.includes('打卡页（三期：宽限期补卡）'))
} catch (e) {
  console.log('ERROR:', e.message)
  results.push(['无异常跑完', false])
}

await browser.close()

const fails = results.filter(([, ok]) => !ok)
const skips = results.filter(([, , why]) => why)
console.log(`\n结果：${results.length - fails.length - skips.length} 过 / ${fails.length} 挂${skips.length ? ` / ${skips.length} 跳过（日期敏感）` : ''}`)
process.exit(fails.length ? 1 : 0)
