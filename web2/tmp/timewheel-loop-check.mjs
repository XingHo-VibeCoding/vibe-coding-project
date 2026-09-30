/* TimeWheel 循环滚轮验证（2026-09-30 用户反馈：0→59 之后应无缝衔接 0，不要到底）
   手法：引导页二级页点开第 1 节开始时间（08:00），对分钟/时列设 scrollTop + dispatch scroll，
   验证五倍列表渲染、初始中间份定位、过界循环取值、keepMiddle 归位。
   （列表份数 2026-09-30 第五轮由 3 → 5：甩动位移涨到 30 格/1200px，三份会被底部夹住）
   跑法：先起 dev server（4177）再 node tmp/timewheel-loop-check.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}
const URL = 'http://127.0.0.1:4177/'
const ROW = 40

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})

/* 工具：设某列 scrollTop 并触发 scroll（0=时列 1=分钟列） */
async function scrollCol(page, col, top) {
  await page.evaluate(([c, v]) => {
    const el = document.querySelectorAll('.wheel')[c]
    el.scrollTop = v
    el.dispatchEvent(new Event('scroll'))
  }, [col, top])
  await page.waitForTimeout(260) // snap 定时器 140ms + 余量
}
const colTop = (page, col) => page.evaluate((c) => document.querySelectorAll('.wheel')[c].scrollTop, col)
const colVal = async (page, col) => {
  const el = page.locator('.wheel').nth(col).locator('button.text-primary-600').first()
  return (await el.innerText()).trim()
}

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)

  await page.locator('text=直接填学期信息，自己加课').click()
  await page.waitForTimeout(300)
  await page.locator('[data-ob-time]').click()
  await page.waitForTimeout(400)
  await page.locator('[data-ob-period-row="1"] button').first().click() // 第 1 节开始时间 08:00
  await page.waitForTimeout(700) // picker slide 动画 + TimeWheel 双 rAF 定位

  const minBtns = await page.locator('.wheel').nth(1).locator('button').count()
  const hourBtns = await page.locator('.wheel').nth(0).locator('button').count()
  t('T1a 分钟列五倍列表（300 项）', minBtns === 300)
  t('T1b 时列五倍列表（120 项）', hourBtns === 120)

  const minTop0 = await colTop(page, 1)
  const hourTop0 = await colTop(page, 0)
  t('T2a 分钟初始定位中间份（08:00 → scrollTop=2400）', Math.abs(minTop0 - 2400) <= 2)
  t('T2b 时列初始定位中间份（08 时 → scrollTop=1280）', Math.abs(hourTop0 - 1280) <= 2)
  t('T2c 初始值 00 分', (await colVal(page, 1)) === '00')

  // T3 分钟列向上滚 2 格：00 → 59 → 58（循环，不到底）
  await scrollCol(page, 1, 2400 - 2 * ROW)
  t('T3 分钟上滚过 0 → 58', (await colVal(page, 1)) === '58')

  // T4 分钟列定位到第三份的 0（scrollTop=4800）：59 之后无缝是 00
  await scrollCol(page, 1, 2400) // 先回 00
  await scrollCol(page, 1, (60 + 60) * ROW) // 4800 = 第三份的 00
  t('T4a 59 之后无缝衔接 00', (await colVal(page, 1)) === '00')

  // T4b keepMiddle 归位：scrollTop 推到 6000（≥2.5 份）应被平移回 3600，值不变（30）
  await scrollCol(page, 1, 6000)
  const minTopAfter = await colTop(page, 1)
  t('T4b 越界后 keepMiddle 归位（6000 → 3600）', Math.abs(minTopAfter - 3600) <= 2)
  t('T4c 归位后值不变（30 分）', (await colVal(page, 1)) === '30')

  // T5 时列过 23 → 00
  await scrollCol(page, 0, (24 + 24) * ROW) // 1920 = 第三份的 00 时
  t('T5 时列 23 之后无缝衔接 00', (await colVal(page, 0)) === '00')

  // T6 点确定：picker 正常关闭（链路没坏）
  await page.locator('button:has-text("确定")').click()
  await page.waitForTimeout(400)
  t('T6 确定后 picker 关闭', (await page.locator('.wheel').count()) === 0)

  await ctx.close()
} catch (e) {
  console.log('ERROR:', e.message)
  results.push(['无异常跑完', false])
}

await browser.close()
const fails = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
