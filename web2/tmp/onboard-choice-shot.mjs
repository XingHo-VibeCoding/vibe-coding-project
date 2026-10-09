/* 截图：第一次使用页三个入口 + 引导页里选 xlsx 后的核对页（含「先确认学期起止」两个输入）
   跑法：先起 dist 静态服务（默认 4177），再 node tmp/onboard-choice-shot.mjs
   产物进 tmp/（tmp/*.png 被 .gitignore 忽略，不入库） */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const { makeEduXlsx } = await import('./onboard-choice-xlsx.mjs')

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)

const shot = async (name) => { await page.screenshot({ path: `tmp/${name}.png` }); console.log('已写出 tmp/' + name + '.png') }

await shot('ob-choice-1')                        // 干净环境：三个入口
await page.locator('[data-ob-choice-edu]').click()
await page.waitForTimeout(600)
await shot('ob-choice-2-edulogin')               // 中间那颗：登录浮层
await page.locator('[data-edu-login-close]').click()
await page.waitForTimeout(500)

const xlsx = await makeEduXlsx()
await page.locator('[data-ob-file]').setInputFiles({
  name: '课表.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: Buffer.from(xlsx),
})
await page.waitForTimeout(1000)
await shot('ob-choice-3-preview')                // 核对页：课表 + 先确认学期起止
await page.locator('[data-edu-confirm]').click()
await page.waitForTimeout(300)
await shot('ob-choice-4-confirm2')               // 第一次点后：再点一次
await page.locator('[data-edu-confirm]').click()
await page.waitForTimeout(1000)
await shot('ob-choice-5-after')                  // 确认后：自动落到课表页
await browser.close()
