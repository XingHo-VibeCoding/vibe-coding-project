/* 教务核对页那两个字段的验收图（2026-10-13 用户报的 bug ①）
   验的是：开学时间 / 本学期周数点开后是**项目自己的月历 / 数字滚轮**，
   不是原生 <input type="date"> / <input type="number">。
   走引导页「导入数据」那条 xlsx 路（与登录教务路共用同一个核对页 eduPreview）。
   跑法：先起 4177 静态服务，再 node tmp/day28b-edu-shots.mjs */
import { mkdirSync } from 'node:fs'

const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const { makeEduXlsx } = await import('./onboard-choice-xlsx.mjs')
const BASE = process.env.BASE || 'http://127.0.0.1:4177/'
const OUT = 'tmp/day28b-shots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' })

const page = await ctx.newPage()
await page.addInitScript(() => {
  localStorage.clear()
  localStorage.setItem('web2.theme', 'light')
})
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)

/* 引导页 → 导入数据 → 选教务 xlsx → 核对页 */
await page.locator('[data-ob-choice-import]').click()
await page.waitForTimeout(300)
const xlsx = await makeEduXlsx()
await page.locator('[data-ob-file]').setInputFiles({
  name: '课表.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: Buffer.from(xlsx),
})
await page.waitForSelector('[data-edu-needsem]', { state: 'visible', timeout: 15000 })
console.log('[a] 核对页出现，needsSemester = true')
await page.screenshot({ path: `${OUT}/6-edu-preview-needsem.png` })

/* 开学时间：必须是自做月历 */
const hasNativeDate = await page.locator('[data-edu-needsem] input[type="date"]').count()
const anyInput = await page.locator('[data-edu-needsem] input').count()
console.log('[b] 原生 date 输入框 =', hasNativeDate, '| 该区块任何原生 input =', anyInput)
await page.locator('[data-edu-start]').click()
await page.waitForTimeout(500)
const calDays = await page.locator('[data-cal-day]').count()
console.log('[c] 点「开学时间」后自做月历格数 =', calDays)
await page.screenshot({ path: `${OUT}/7-edu-own-calendar.png` })
await page.locator('[data-picker-cancel]').click()
await page.waitForTimeout(300)

/* 周数：必须是自做滚轮 */
const hasNativeNumber = await page.locator('[data-edu-needsem] input[type="number"]').count()
console.log('[d] 原生 number 输入框 =', hasNativeNumber)
await page.locator('[data-edu-weeks]').click()
await page.waitForTimeout(500)
console.log('[e] 点「本学期周数」后自做确定按钮 =', await page.locator('[data-picker-ok]').count())
await page.screenshot({ path: `${OUT}/8-edu-own-wheel.png` })

console.log('已写出', OUT)
await browser.close()
