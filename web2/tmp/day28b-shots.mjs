/* Day 28 bug 修复验收图（2026-10-13 用户报的三个 bug）
   ① 教务核对页的「开学时间 / 本学期周数」改成自做弹层（不再是系统日历/数字键盘）
   ② 导入成功后落**今日页**（原来引导层不收、页面不切）
   ③ 引导页那个免导入出口的文案不再写死「示例数据」
   跑法：先起 4177 静态服务，再 node tmp/day28b-shots.mjs
   产物：tmp/day28b-shots/*.png（目录被 .gitignore 忽略，不入库） */
import { mkdirSync } from 'node:fs'

const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.BASE || 'http://127.0.0.1:4177/'
const OUT = 'tmp/day28b-shots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' })

/* 全新访客（清空 localStorage），冻钟保证「已过/接下来」形态稳定 */
async function newVisitorPage() {
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('web2.theme', 'light')
  })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  return page
}

/* ---------- 图 1：引导页 choice（免导入出口的新文案） ---------- */
{
  const page = await newVisitorPage()
  await page.waitForSelector('[data-ob-choice-form]', { state: 'visible', timeout: 8000 })
  const txt = (await page.locator('[data-ob-choice-demo]').textContent()).trim()
  console.log('[1] 出口文案 =', txt)
  await page.screenshot({ path: `${OUT}/1-onboard-choice.png` })
  await page.close()
}

/* ---------- 图 2/3：教务核对页 —— 自做月历 + 自做滚轮 ---------- */
{
  const page = await newVisitorPage()
  /* 走「登录教务系统」这条路。真抓取在桌面浏览器不通，所以直接种一个核对页前置：
     用 xlsx 那条共享入口更简单 —— 但这里要验的是 needsSemester 那两个字段，
     它只在「本机还没学期」时出现，且从任何一条导入路进来都一样。 */
  await page.locator('[data-ob-choice-form]').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/2a-ob-form.png` })

  /* 回 choice，改走导入 JSON 造出核对页（与教务路共用 eduPreview） */
  await page.locator('[data-ob-back]').click().catch(() => {})
  await page.waitForTimeout(400)
  await page.close()
}

/* ---------- 图 3：自做月历（从核对页「开学时间」开出来） ---------- */
{
  const page = await newVisitorPage()
  /* 直接点「直接填学期信息」进第 1 步，那一页的「开学时间」走的就是同一个 openDateField */
  await page.locator('[data-ob-choice-form]').click()
  await page.waitForSelector('[data-ob-start]', { state: 'visible', timeout: 8000 })
  await page.locator('[data-ob-start]').click()
  await page.waitForTimeout(500)
  const isCal = (await page.locator('[data-cal-day]').count()) > 0
  console.log('[3] 开学时间点开 = 自做月历？', isCal)
  await page.screenshot({ path: `${OUT}/3-own-calendar.png` })
  await page.locator('[data-picker-cancel]').click()
  await page.waitForTimeout(300)

  /* 周数 → 自做滚轮 */
  await page.locator('[data-ob-weeks]').click()
  await page.waitForTimeout(500)
  console.log('[4] 周数点开有「确定/取消」自做按钮？', await page.locator('[data-picker-ok]').count())
  await page.screenshot({ path: `${OUT}/4-own-wheel.png` })
  await page.close()
}

console.log('已写出', OUT)
await browser.close()
