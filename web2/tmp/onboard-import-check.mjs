/* 引导页导入修复验证（2026-09-28）：
   修复前 onOnboardFile 先 finishOnboarding 再校验，坏文件会让引导页关闭、
   落到默认示例数据，看起来像「导入了示例数据」（用户实测反馈）。
   修复后：校验通过才关引导页；失败留在引导页就地报红字。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

try {
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto('http://127.0.0.1:4177/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)

  // 前置：干净环境应出现引导页
  const ob = page.locator('text=先用示例数据逛逛')
  t('0. 干净环境出现引导页', await ob.isVisible())

  const onboarding = page.locator('text=先用示例数据逛逛')
  const obInput = page.locator('input[type="file"]').nth(1) // 引导层的 file input（DOM 顺序在主模板之后）

  // 1. 上传坏文件 → 引导页不关 + 就地红字报错
  await obInput.setInputFiles('D:/Document/Project/vibe-coding-project/web2/tmp/bad-import.txt')
  await page.waitForTimeout(500)
  t('1. 坏文件后引导页仍在（不被放行）', await onboarding.isVisible())
  const errMsg = page.locator('text=导入失败')
  t('2. 引导页就地显示「导入失败」', await errMsg.isVisible())
  const friendly = page.locator('text=这不是 JSON 文件')
  t('2b. JSON 语法错显示友好文案', await friendly.isVisible())
  const dataAfterBad = await page.evaluate(() => localStorage.getItem('web2.data'))
  t('3. 坏文件未落盘（无 web2.data）', dataAfterBad === null)
  const onboardAfterBad = await page.evaluate(() => localStorage.getItem('web2.onboarded'))
  t('4. 未误记 onboarded 标记', onboardAfterBad === null)

  // 2. 同一引导页里改传合法导出 → 引导页关闭 + 数据落盘
  await obInput.setInputFiles('D:/Document/Project/vibe-coding-project/web2/tmp/valid-export.json')
  await page.waitForTimeout(700)
  t('5. 合法文件后引导页关闭', !(await onboarding.isVisible().catch(() => false)))
  const dataOk = await page.evaluate(() => localStorage.getItem('web2.data'))
  t('6. web2.data 已落盘且含标识课程', !!dataOk && dataOk.includes('高等数学'))
  const onboardOk = await page.evaluate(() => localStorage.getItem('web2.onboarded'))
  t('7. onboarded 标记已记', onboardOk === '1')
  const okMsg = page.locator('text=导入成功：测试学期')
  t('8. 「我的」页显示导入成功提示', await okMsg.isVisible().catch(() => false))
} finally {
  await browser.close()
}

const fails = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
