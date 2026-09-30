/* 课程时间设置二级页验证（2026-09-30 用户三条反馈）：
   ① 进/出二级页有方向性滑动动画（obpage-fwd / obpage-bak）
   ② 「完成」返回 form 页（返回键走同一函数，App 内由原生 backButton 触发，此处验证共享路径）
   ③ 固定上午/下午/晚上三块：手动把第 3 节 09:50 改到 10:20（间隔 40 > 15）块数仍是 3（修复前会裂成 4）
   跑法：先起 dev server（4177）再 node tmp/ob-timepage-check.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}
const URL = 'http://127.0.0.1:4177/'

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)

  await page.locator('text=直接填学期信息，自己加课').click()
  await page.waitForTimeout(300)

  // ① 进入二级页时抓到前进动画类（enter-active 在元素插入起挂 0.2s）
  const fwdAnim = page.waitForSelector('.obpage-fwd-enter-active', { timeout: 1200 }).then(() => true).catch(() => false)
  await page.locator('[data-ob-time]').click()
  t('1a. 进二级页有滑动动画（obpage-fwd-enter-active）', await fwdAnim)
  await page.waitForTimeout(400)

  // ② 默认固定三块
  const segCount0 = await page.locator('[data-ob-seg]').count()
  t('2a. 默认 3 个时间段块', segCount0 === 3)
  const names = await page.locator('[data-ob-seg] p.text-xs.font-semibold').allInnerTexts()
  t('2b. 块名为 上午/下午/晚上', names[0]?.includes('上午') && names[1]?.includes('下午') && names[2]?.includes('晚上'))
  t('2c. 摘要行 共 13 节', (await page.locator('[data-ob-seg]').count()) === 3)

  // ③ 手动把第 3 节 09:50 → 10:20（制造 40 分钟大间隔），块数不能裂
  await page.locator('[data-ob-period-row="3"] button').first().click()
  await page.waitForTimeout(700) // picker + TimeWheel 定位
  await page.locator('.wheel').nth(0).locator('button:text-is("10")').first().click() // 时 = 10
  await page.waitForTimeout(200)
  await page.locator('.wheel').nth(1).locator('button:text-is("20")').first().click() // 分 = 20
  await page.waitForTimeout(200)
  await page.locator('button:has-text("确定")').click()
  await page.waitForTimeout(400)
  const row3 = (await page.locator('[data-ob-period-row="3"]').innerText()).replace(/\s+/g, ' ')
  console.log('   改后第3节：', row3.trim())
  t('3a. 第 3 节改为 10:20', row3.includes('10:20'))
  const segCount1 = await page.locator('[data-ob-seg]').count()
  t('3b. 改出大间隔后仍是 3 块（修复点：不再裂成 4）', segCount1 === 3)
  const names2 = await page.locator('[data-ob-seg] p.text-xs.font-semibold').allInnerTexts()
  t('3c. 块名仍是 上午/下午/晚上', names2[0]?.includes('上午') && names2[1]?.includes('下午') && names2[2]?.includes('晚上'))

  // ④ 「完成」返回：抓退出动画类 + 回到 form 页
  const bakAnim = page.waitForSelector('.obpage-bak-enter-active', { timeout: 1200 }).then(() => true).catch(() => false)
  await page.locator('[data-ob-time-back]').click()
  t('4a. 返回有滑动动画（obpage-bak-enter-active）', await bakAnim)
  await page.waitForTimeout(400)
  t('4b. 回到第 1 页（开学时间入口可见）', await page.locator('[data-ob-start]').isVisible())
  const summary = (await page.locator('[data-ob-time]').innerText()).replace(/\s+/g, ' ')
  console.log('   摘要行：', summary.trim())
  t('4c. 摘要行显示 上午 5 · 下午 5 · 晚上 3', summary.includes('上午 5') && summary.includes('下午 5') && summary.includes('晚上 3'))

  await ctx.close()
} catch (e) {
  console.log('ERROR:', e.message)
  results.push(['无异常跑完', false])
}

await browser.close()
const fails = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
