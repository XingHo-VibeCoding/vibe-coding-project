/* 方案 C · Step 1 截图（2026-10-03，产物进 tmp/）
   跑法：先起 dist 静态服务（默认 4177），再 node tmp/step1-shot.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
/* 引导页：2026-10-09 起「先用示例数据逛逛」已删，改为种标记跳过引导（无 web2.data ⇒ 示例态） */
await page.addInitScript(() => { try { localStorage.setItem('web2.onboarded', '1') } catch (e) {} })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)

const shot = async (name) => { await page.screenshot({ path: `tmp/${name}.png` }); console.log('已写出 tmp/' + name + '.png') }

await shot('step1-today')                                  // 今日页：3 个 tab
await page.locator('nav button', { hasText: '周课表' }).click(); await page.waitForTimeout(500)
await shot('step1-week')                                   // 课表子视图 + 分段控件
await page.locator('[data-week-sub-list]').click(); await page.waitForTimeout(500)
await shot('step1-list')                                   // 日程清单子视图
await page.locator('nav button', { hasText: '今日' }).click(); await page.waitForTimeout(500)
await page.locator('[data-today-habit-more]').first().click(); await page.waitForTimeout(600)
await shot('step1-habit-sheet')                            // 打卡浮层
await browser.close()
