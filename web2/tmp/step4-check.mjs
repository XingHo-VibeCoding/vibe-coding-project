/* 方案 C · Step 4 结构检查（我的瘦身 + 拍课表识别归位）——playwright，走 dist 静态服务。
   2026-10-05 Stage 6：「我的」页从功能堆砌改成索引页（1 行学期 + 4 个入口），
   设置内容搬进 data-sub="settings" 的全屏二级页。本脚本随之把「折叠」断言换成「二级页」断言。
   断言：
   ① 课表页右上「＋」= 选单开关（data-week-add）；点开选单里有「拍课表识别」一项，
      它沿用旧锚点 data-mine-rec，点它才进识别流程。「我的」页不再有识别入口；
      ＋ 在周课表 / 其他日程两个子视图里都在（它是这一行的固定成员，不属于任一侧）。
   ② 「我的」索引页不再常显任何设置正文；推入设置二级页后主题入口恰一处（色点 4 个、
      点色点真换肤、点明暗按钮真换主题）；数据类入口在设置二级页里、且在设置正文之外。
   ③ 「我的」索引页块序 = 学期行 → 4 个入口（录音 → 练耳 → 待办 → 设置），不再出现功能正文。
   跑法：先起 dist 静态服务（默认 4177，TW_URL 可覆盖）再 node tmp/step4-check.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
let pass = 0, fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url()) })
await page.addInitScript(() => localStorage.setItem('web2.onboarded', '1'))
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)

const ME = page.locator('[data-page="me"]')
const goWeek = async () => { await page.locator('nav button', { hasText: '周课表' }).click(); await page.waitForTimeout(450) }
const goMe = async () => { await page.locator('nav button', { hasText: '我的' }).click(); await page.waitForTimeout(450) }
const openSub = async (k) => { await page.$eval(`[data-me-entry="${k}"]`, (el) => el.click()); await page.waitForTimeout(400) }
const backSub = async () => { await page.locator('[data-sub-back]').click(); await page.waitForTimeout(400) }

/* ============ ① 拍课表识别：我的 → 课表页右上「＋」 ============ */
console.log('\n--- ① 拍课表识别归位 ---')
t('A1. 底部仍是 3 个 tab', (await page.locator('nav button').count()) === 3)
await goMe()
t('A2. 「我的」页已无识别入口 / 拍课表识别文案',
  (await ME.locator('[data-mine-rec]').count()) === 0
  && !(await ME.innerText()).includes('拍课表识别'))
await goWeek()
const plus = page.locator('[data-week-add]')
/* Stage 8：＋ 不再是识别入口本体，只是选单开关；识别项搬进 [data-week-menu]。
   已开则不再点（否则会关掉）。 */
const openWeekMenu = async () => {
  if ((await page.locator('[data-week-menu]').count()) === 0) {
    await page.$eval('[data-week-add]', (el) => el.click())
    await page.waitForTimeout(300)
  }
}
await openWeekMenu()
const scanItem = page.locator('[data-week-menu] [data-mine-rec]')
t('A3. 课表页 ＋ 恰 1 个；点开后选单里「拍课表识别」（data-mine-rec）恰 1 个且可见',
  (await plus.count()) === 1 && (await scanItem.count()) === 1 && (await scanItem.isVisible()))
const box = await plus.boundingBox()
t('A4. ＋ 热区 ≥44×44', !!box && box.width >= 44 && box.height >= 44, box && `${Math.round(box.width)}×${Math.round(box.height)}`)
t('A5. ＋ 有无障碍名（aria-label）', (await plus.getAttribute('aria-label') || '').includes('拍课表识别'))
await openWeekMenu()
await page.locator('[data-week-sub-list]').click()
await page.waitForTimeout(350)
t('A6. 切到「其他日程」子视图时 ＋ 仍在（它是这行的固定成员，两视图共用同一颗）',
  (await page.locator('[data-week-add]').count()) === 1)
await page.locator('[data-week-sub-week]').click()
await page.waitForTimeout(350)

// 进识别流程 → 取消 → 回到周课表视图
await openWeekMenu()
await page.locator('[data-week-menu-scan]').click()
await page.waitForTimeout(500)
const inFlow = (await page.locator('[data-ob-summary]').count()) > 0 || (await page.locator('[data-ob-ai-key]').count()) > 0
t('A7. 点 ＋ 真的进识别页（摘要页或缺 Key 的配置页）', inFlow)
await page.locator('[data-mine-rec-cancel]').click()
await page.waitForTimeout(500)
t('A8. 取消后回到应用，课表页 ＋ 仍在', (await page.locator('[data-week-add]').isVisible()))

/* ============ ② 主题入口只剩一处；设置内容搬进二级页 ============ */
console.log('\n--- ② 主题 / 数据入口 ---')
await goMe()
t('B1. 索引页没有常显的「主题配色」', (await ME.locator('text=主题配色').count()) === 0)
t('B2. 索引页没有设置正文（data-settings-body 不在 DOM）', (await page.locator('[data-settings-body]').count()) === 0)
await openSub('settings')
const SUB = page.locator('[data-sub-page][data-sub="settings"]')
t('B3. 数据类入口在设置二级页里、且在设置正文之外（导入主项目数据 / 导出日历）',
  (await SUB.locator('text=导入主项目数据').count()) === 1
  && (await SUB.locator('text=导出日历').count()) === 1
  && (await page.locator('[data-settings-body]').locator('text=导出日历').count()) === 0)
const body = page.locator('[data-settings-body]')
t('B4. 设置正文里「主题外观」恰 1 处', (await body.locator('text=主题外观').count()) === 1)
t('B5. 设置正文里「主题配色」也恰 1 处（唯一主题入口）', (await body.locator('text=主题配色').count()) === 1)
const dots = body.locator('button[style*="background"]')
t('B6. 配色色点 4 个', (await dots.count()) === 4, await dots.count())
t('B7. 明暗切换按钮在（切深色/切浅色）', (await body.locator('[data-theme-toggle]').count()) === 1)

// 真换肤：点第 2 个色点 → dataset.accent 变
const before = await page.evaluate(() => document.documentElement.dataset.accent)
await dots.nth(1).click()
await page.waitForTimeout(250)
const afterAccent = await page.evaluate(() => ({ ds: document.documentElement.dataset.accent, ls: localStorage.getItem('web2.accent') }))
t('B8. 点第 2 个色点真的换肤并落盘', afterAccent.ds !== before && afterAccent.ds === afterAccent.ls, JSON.stringify(afterAccent))

// 真换主题：点明暗按钮 → html.dark 变 + 文案变
const darkBefore = await page.evaluate(() => document.documentElement.classList.contains('dark'))
const labelBefore = (await body.locator('[data-theme-toggle]').innerText()).trim()
await body.locator('[data-theme-toggle]').click()
await page.waitForTimeout(250)
const themeAfter = await page.evaluate(() => ({ dark: document.documentElement.classList.contains('dark'), ls: localStorage.getItem('web2.theme') }))
const labelAfter = (await body.locator('[data-theme-toggle]').innerText()).trim()
t('B9. 点明暗按钮真的切主题并落盘', themeAfter.dark !== darkBefore && themeAfter.ls, JSON.stringify(themeAfter))
t('B10. 按钮文案跟着变（切深色 ↔ 切浅色）', labelAfter !== labelBefore, `${labelBefore} → ${labelAfter}`)
await body.locator('[data-theme-toggle]').click() // 切回来，后面的断言用原主题
await page.waitForTimeout(200)

await backSub() // 返回索引
t('B11. 返回索引后二级页消失、4 个入口仍在',
  (await page.locator('[data-sub-page]').count()) === 0
  && (await ME.locator('[data-me-entry]').count()) === 4)

/* ============ ③ 我的索引页块序 ============ */
console.log('\n--- ③ 我的索引页块序 ---')
const blocks = await page.evaluate(() => {
  const me = document.querySelector('[data-page="me"]')
  return [...me.children].map((el) => {
    const txt = (el.innerText || '').replace(/\s+/g, ' ').trim()
    return { tag: el.tagName.toLowerCase(), txt: txt.slice(0, 14) }
  })
})
console.log('   顶层块：', JSON.stringify(blocks, null, 0))
const entryKeys = await page.$$eval('[data-page="me"] [data-me-entry]', (els) => els.map((e) => e.getAttribute('data-me-entry')))
t('C1. 第一块是学期索引行（含 data-me-term）',
  (await page.evaluate(() => {
    const me = document.querySelector('[data-page="me"]')
    return !!me.children[0] && !!me.children[0].querySelector('[data-me-term]')
  })))
t('C2. 4 个入口齐全且顺序固定：录音 → 练耳 → 待办 → 设置',
  JSON.stringify(entryKeys) === JSON.stringify(['lectures', 'listen', 'todos', 'settings']), entryKeys.join(','))
t('C3. 设置入口排在最后', entryKeys[entryKeys.length - 1] === 'settings')
t('C4. 索引页不再出现功能正文（课堂录音 / 导入主项目数据 / 清除数据）',
  !(await ME.innerText()).includes('课堂录音')
  && !(await ME.innerText()).includes('导入主项目数据')
  && !(await ME.innerText()).includes('清除数据并重置')
  && (await ME.locator('[data-settings-body]').count()) === 0)
t('C5. 「我的」页不再出现「拍课表识别」', !(await ME.innerText()).includes('拍课表识别'))

t('D1. 全程无页面报错', errors.length === 0, errors.slice(0, 3).join(' | '))

console.log('\n结果：' + pass + ' 过 / ' + fail + ' 挂')
await browser.close()
process.exit(fail ? 1 : 0)
