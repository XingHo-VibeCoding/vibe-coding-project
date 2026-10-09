/* Android 返回键分级处理验证（v1.17）：
   backButton 优先级 = 关 picker → 关确认层 → 关表单/详情 → 回今日页 → 退出预备（2 秒内再按才 exitApp）。
   下拉组件响应 web2:dd-close 一并收起；浏览器无桥不注册（行为零变化）。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import { readFileSync } from 'node:fs'

/* 支持对线上跑：TW_URL=https://… node tmp/backbutton-check.mjs（默认本地 4177） */
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}

const fakeAppPlugin = /* js */ `
window.Capacitor = { Plugins: {
  App: {
    _cbs: [],
    addListener(name, cb) { if (name === 'backButton') this._cbs.push(cb); return { remove: function () {} } },
    _fire() { for (const cb of this._cbs.slice()) cb({ canGoBack: false }) },
    exitApp() { this._exited = (this._exited || 0) + 1 }
  }
}}`

const todayKey = (() => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` })()
const seed = 'localStorage.setItem("web2.onboarded","1");localStorage.setItem("web2.data",' + JSON.stringify(readFileSync('D:/Document/Project/vibe-coding-project/web2/tmp/valid-export.json', 'utf8')) + ');'
  /* 种一篇「今天」的日精进：今日页才出现那一行日精进摘要卡（改一改 / 日精进 1 篇 ›），
     才能验两种浮层的返回键（v1.41.9 真机反馈；Stage 2 后未复盘时今天页不放日精进卡） */
  + `localStorage.setItem("web2.review",JSON.stringify([{date:"${todayKey}",summary:"测试日精进"}]));`

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
await page.addInitScript(fakeAppPlugin)
await page.addInitScript(seed)

try {
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)

  const fire = () => page.evaluate(() => window.Capacitor.Plugins.App._fire())
  const exits = () => page.evaluate(() => window.Capacitor.Plugins.App._exited || 0)
  const activeTab = () => page.evaluate(() => {
    /* 用 data-active 认当前 tab（原先按 class 里的 text-primary-500 找，
       2026-10-04 A4 把主色文字换成 primary-600 后这条选择器就失效了） */
    const b = document.querySelector('nav button[data-active]')
    return b ? (b.innerText || '').trim() : ''
  })
  const masks = () => page.evaluate(() => document.querySelectorAll('div.fixed.inset-0.bg-black\\/40').length)

  // 1. 今日页、无弹层 → 退出预备提示，2 秒内再按才退出
  t('0. 引导页未出现（seed 生效）', !(await page.locator('[data-ob-step]').isVisible().catch(() => false)))
  await fire()
  t('1a. 今日页无弹层：显示「再按一次返回键退出」', await page.locator('text=再按一次返回键退出').isVisible())
  t('1b. 未立即退出', (await exits()) === 0)
  await fire()
  t('1c. 2 秒内再按 → 退出', (await exits()) === 1)
  await page.waitForTimeout(600) // 等 fade 离场动画
  t('1d. 退出时提示条清掉', !(await page.locator('text=再按一次返回键退出').isVisible().catch(() => false)))

  // 2. 在「我的」页 → 回今日，不退出
  //    （断言按文案，不按序号：tab 数会变，序号断言每加一页就腐一次）
  await page.locator('nav button', { hasText: '我的' }).click()
  await page.waitForTimeout(400)
  t('2a. 已切到「我的」页', (await activeTab()).includes('我的'))
  await fire()
  t('2b. 返回键回到今日页', (await activeTab()).includes('今日'))
  t('2c. 没有误退出', (await exits()) === 1)

  // 3. 确认层开着 → 只关确认层
  await page.locator('nav button', { hasText: '我的' }).click()
  await page.waitForTimeout(400)
  /* Stage 6：「清除数据」搬进了 data-sub="settings" 二级页 → 先推入二级页 */
  if ((await page.locator('[data-sub-page]').count()) === 0) {
    await page.$eval('[data-settings-toggle]', (el) => el.click())
    await page.waitForTimeout(400)
  }
  await page.locator('button', { hasText: '清除数据' }).first().click()
  await page.waitForTimeout(400)
  t('3a. 确认层已打开', await page.locator('text=确认清除全部数据').isVisible())
  await fire()
  await page.waitForTimeout(600) // 等离场动画
  t('3b. 返回键只关确认层', !(await page.locator('text=确认清除全部数据').isVisible().catch(() => false)))
  t('3c. 没有误退出', (await exits()) === 1)

  // 4. 表单里开着 picker → 返回键只关 picker，再按才关表单
  //    Stage 6：学期编辑入口在索引页，先退出设置二级页
  await page.locator('[data-sub-back]').click()
  await page.waitForTimeout(400)
  await page.$eval('[data-me-term]', (el) => el.click())
  await page.waitForTimeout(400)
  const masksBefore = await masks()
  t('4a. 学期编辑弹层已打开', masksBefore >= 1)
  await page.locator('button', { hasText: '2026-09-07' }).first().click() // seed 学期的 first_monday 字段
  await page.waitForTimeout(500)
  t('4b. 月历 picker 已打开（遮罩 +1）', (await masks()) === masksBefore + 1)
  await fire()
  await page.waitForTimeout(600)
  t('4c. 返回键只关 picker', (await masks()) === masksBefore)
  t('4d. 编辑弹层仍在', (await masks()) >= 1 && (await exits()) === 1)
  await fire()
  await page.waitForTimeout(600)
  t('4e. 再按返回键关掉编辑弹层', (await masks()) === 0)
  t('4f. 仍未退出', (await exits()) === 1)

  // 4g/4h. Stage 6：「我的」的二级页（原「就地展开块」）也吃返回键；收回后回索引、不退 app
  //        （closeTopmostLayer 从细到粗：练耳设置面板 → 二级页 → 课表子视图 → 回今日页）
  await page.$eval('[data-settings-toggle]', (el) => el.click())
  await page.waitForTimeout(400)
  t('4g-pre. 设置二级页已推入', (await page.locator('[data-sub-page][data-sub="settings"]').count()) === 1)
  await fire()
  await page.waitForTimeout(400)
  t('4g. 我的页里返回键先收回「设置」二级页（不退 app、不切页）',
    (await page.locator('[data-sub-page]').count()) === 0 && (await exits()) === 1 && (await activeTab()).includes('我的'))
  await page.$eval('[data-settings-toggle]', (el) => el.click())
  await page.waitForTimeout(400)
  t('4h. 重新推入设置二级页', (await page.locator('[data-sub-page]').count()) === 1)
  await page.locator('[data-sub-back]').click()
  await page.waitForTimeout(400)
  t('4i. 返回索引（为第 5 步切回今日页让路）', (await page.locator('[data-sub-page]').count()) === 0)

  // 5. 今日页：退出预备窗口过期后，重新走「提示 → 再按退出」
  await page.locator('nav button', { hasText: '今日' }).click()
  await page.waitForTimeout(2300) // 等 2 秒退出预备窗口过期
  await fire()
  t('5a. 窗口过期后按返回 → 重新显示退出预备提示', await page.locator('text=再按一次返回键退出').isVisible())
  t('5b. 未立即退出', (await exits()) === 1)
  await fire()
  t('5c. 2 秒内再按 → 退出计数 +1', (await exits()) === 2)

  // 5d–5g. 日精进浮层（v1.41.9 真机反馈）：问答 / 今天的日精进 / 日精进·全部 三种模式共用 reviewSheet，
  //        以前 closeTopmostLayer() 里没有这一层 → 按返回键浮层不关，直接落到「退到今日页/退出预备」。
  await page.locator('[data-review-start]').first().click()
  await page.waitForTimeout(400)
  t('5d. 复盘问答浮层已打开', await page.locator('[data-review-q]').isVisible())
  await fire()
  await page.waitForTimeout(600)
  t('5e. 返回键先关掉问答浮层（不退 app、不切页）',
    !(await page.locator('[data-review-q]').isVisible().catch(() => false)) &&
      !(await page.locator('text=再按一次返回键退出').isVisible().catch(() => false)) &&
      (await exits()) === 2 && (await activeTab()).includes('今日'))
  await page.locator('[data-review-open-history]').first().click()
  await page.waitForTimeout(400)
  t('5f. 日精进历史浮层已打开（真机踩到的那一层）', await page.locator('text=日精进 · 全部').isVisible())
  await fire()
  await page.waitForTimeout(600)
  t('5g. 返回键关掉历史浮层（不再什么都不做）',
    !(await page.locator('text=日精进 · 全部').isVisible().catch(() => false)) &&
      !(await page.locator('text=再按一次返回键退出').isVisible().catch(() => false)) &&
      (await exits()) === 2)
} catch (e) {
  console.log('ERROR:', e.message)
  results.push(['无异常跑完', false])
}

// 6. 浏览器无桥：页面正常加载、无异常（backButton 逻辑根本不注册）
const page2 = await ctx.newPage()
let p2err = 0
page2.on('pageerror', () => { p2err++ })
await page2.goto(BASE, { waitUntil: 'domcontentloaded' })
await page2.waitForTimeout(700)
t('6a. 无桥环境页面正常（无 pageerror）', p2err === 0)
const hasBridge = await page2.evaluate(() => !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App))
t('6b. 浏览器环境没有 App 桥（处理逻辑未注册）', !hasBridge)

await browser.close()

const fails = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
