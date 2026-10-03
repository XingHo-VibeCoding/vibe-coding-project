/* 方案 C · Step 4 结构检查（我的瘦身 + 拍课表识别归位）——playwright，走 dist 静态服务。
   断言：
   ① 课表页右上「＋」= 拍课表识别入口（就是原来的 data-mine-rec，另带 data-week-add）；
      「我的」页不再有识别入口；切到「其他日程」子视图时 ＋ 不出现；点它能进出识别流程。
   ② 「我的」页折叠状态下的常显块不再有「主题配色」；主题入口只剩设置折叠里一处，
      展开后色点 4 个、点色点真换肤、点明暗按钮真换主题；数据类入口（导入 / 导出日历）
      仍常显在折叠外（尊重 settings-fold-check 的既定口径）。
   ③ 「我的」页块序 = 学期信息 → 课堂录音 → 碎片练耳 → 数据（导入导出）→ 设置。
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

/* ============ ① 拍课表识别：我的 → 课表页右上「＋」 ============ */
console.log('\n--- ① 拍课表识别归位 ---')
t('A1. 底部仍是 3 个 tab', (await page.locator('nav button').count()) === 3)
await goMe()
t('A2. 「我的」页已无识别入口 / 拍课表识别文案',
  (await ME.locator('[data-mine-rec]').count()) === 0
  && !(await ME.innerText()).includes('拍课表识别'))
await goWeek()
const plus = page.locator('[data-week-add]')
t('A3. 课表页有「＋」入口，且沿用 data-mine-rec 锚点',
  (await plus.count()) === 1 && (await page.locator('[data-mine-rec]').count()) === 1)
const box = await plus.boundingBox()
t('A4. ＋ 热区 ≥44×44', !!box && box.width >= 44 && box.height >= 44, box && `${Math.round(box.width)}×${Math.round(box.height)}`)
t('A5. ＋ 有无障碍名（aria-label）', (await plus.getAttribute('aria-label') || '').includes('拍课表识别'))
await page.locator('[data-week-sub-list]').click()
await page.waitForTimeout(350)
t('A6. 切到「其他日程」子视图时 ＋ 不出现', (await page.locator('[data-week-add]').count()) === 0)
await page.locator('[data-week-sub-week]').click()
await page.waitForTimeout(350)

// 进识别流程 → 取消 → 回到课表页
await page.locator('[data-week-add]').click()
await page.waitForTimeout(500)
const inFlow = (await page.locator('[data-ob-summary]').count()) > 0 || (await page.locator('[data-ob-ai-key]').count()) > 0
t('A7. 点 ＋ 真的进识别页（摘要页或缺 Key 的配置页）', inFlow)
await page.locator('[data-mine-rec-cancel]').click()
await page.waitForTimeout(500)
t('A8. 取消后回到应用，课表页 ＋ 仍在', (await page.locator('[data-week-add]').isVisible()))

/* ============ ② 主题入口只剩一处；数据类入口仍常显 ============ */
console.log('\n--- ② 主题 / 数据入口 ---')
await goMe()
t('B1. 折叠状态下「我的」页没有常显的「主题配色」', (await ME.locator('text=主题配色').count()) === 0)
t('B2. 折叠状态下没有 settings-body（默认收起）', (await ME.locator('[data-settings-body]').count()) === 0)
t('B3. 数据类入口仍在折叠外（导入主项目数据 / 导出日历）',
  (await ME.locator('text=导入主项目数据').count()) === 1
  && (await ME.locator('text=导出日历').count()) === 1)
await ME.locator('[data-settings-toggle]').click()
await page.waitForTimeout(350)
const body = ME.locator('[data-settings-body]')
t('B4. 展开后「主题外观」在折叠里恰 1 处', (await body.locator('text=主题外观').count()) === 1)
t('B5. 折叠里「主题配色」也恰 1 处（唯一主题入口）', (await body.locator('text=主题配色').count()) === 1)
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

await ME.locator('[data-settings-toggle]').click() // 折回
await page.waitForTimeout(300)
t('B11. 折叠后数据类入口仍在', (await ME.locator('text=导出日历').count()) === 1
  && (await ME.locator('[data-settings-body]').count()) === 0)

/* ============ ③ 我的页块序 ============ */
console.log('\n--- ③ 我的页块序 ---')
const blocks = await page.evaluate(() => {
  const me = document.querySelector('[data-page="me"]')
  return [...me.children].map((el) => {
    const txt = (el.innerText || '').replace(/\s+/g, ' ').trim()
    return { tag: el.tagName.toLowerCase(), txt: txt.slice(0, 14), settings: el.hasAttribute('data-settings-body') || !!el.querySelector('[data-settings-toggle]') }
  })
})
console.log('   顶层块：', JSON.stringify(blocks, null, 0))
const firstTexts = blocks.map((b) => b.txt)
t('C1. 第一块是学期信息', firstTexts[0] && firstTexts[0].includes('示'))
t('C2. 有「课堂录音」块', firstTexts.some((x) => x.includes('课堂录音')))
t('C3. 有「碎片练耳」块', firstTexts.some((x) => x.includes('碎片练耳')))
t('C4. 有「导入主项目数据」的数据块', firstTexts.some((x) => x.includes('导入主项目数据')))
t('C5. 最后一块是设置折叠', blocks[blocks.length - 1].settings === true)
t('C6. 录音块排在练耳之前、设置排最后（“我的”页块数 = ' + blocks.length + '）',
  firstTexts.findIndex((x) => x.includes('课堂录音')) < firstTexts.findIndex((x) => x.includes('碎片练耳'))
  && firstTexts.findIndex((x) => x.includes('碎片练耳')) < firstTexts.findIndex((x) => x.includes('导入主项目数据')))
t('C7. 「我的」页不再出现「拍课表识别」', !(await ME.innerText()).includes('拍课表识别'))

t('D1. 全程无页面报错', errors.length === 0, errors.slice(0, 3).join(' | '))

console.log('\n结果：' + pass + ' 过 / ' + fail + ' 挂')
await browser.close()
process.exit(fail ? 1 : 0)
