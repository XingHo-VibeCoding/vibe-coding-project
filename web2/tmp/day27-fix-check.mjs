// Day 27 修复验证：全新访客能不能靠自己走到主界面。
// A 修复前应有出路：点「先随便看看」→ 引导层关闭 → 今日页可交互
// B 底部导航在引导层打开时仍被盖住（证明修复的必要性没变）
// C 关掉后刷新不再弹引导层
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177/'
const OUT = 'tmp/day27-selftest'
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
// 只在第一次加载时清空（addInitScript 每次导航都会跑，会把 reload 后的 onboarded 标记也清掉 → 假失败）
await page.addInitScript(() => {
  try {
    if (!sessionStorage.getItem('__cleared')) { sessionStorage.setItem('__cleared', '1'); localStorage.clear() }
  } catch {}
})

let pass = 0, fail = 0
const ok = (name, cond, ev) => { if (cond) { pass++; console.log(`[PASS] ${name}${ev ? ' — ' + ev : ''}`) } else { fail++; console.log(`[FAIL] ${name}${ev ? ' — ' + ev : ''}`) } }

const onboardOpen = () => page.evaluate(() => !!document.querySelector('.fixed.inset-0.z-40'))
const navHit = () => page.evaluate(() => {
  const el = document.querySelector('[data-nav="me"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return { inNav: !!(hit && hit.closest('[data-nav]')), inOnboard: !!(hit && hit.closest('.fixed.inset-0.z-40')) }
})

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

ok('A0 全新访客落在引导层', await onboardOpen())
const hasDemo = await page.locator('[data-ob-choice-demo]').count()
ok('A1 引导层出现「先随便看看」出口', hasDemo === 1)
ok('A2 按钮文案是白话', (await page.locator('[data-ob-choice-demo]').innerText()).includes('先随便看看'), await page.locator('[data-ob-choice-demo]').innerText())
const n = await navHit()
ok('B1 修前死锁确实存在（底部导航被盖）', n && !n.inNav && n.inOnboard, JSON.stringify(n))
await page.screenshot({ path: `${OUT}/fix-01-choice.png` })

await page.locator('[data-ob-choice-demo]').click()
await page.waitForTimeout(900)
ok('A3 点完引导层关闭', !(await onboardOpen()))
const title = await page.locator('h1, [data-today-date], header').first().innerText().catch(() => '')
const hasToday = await page.locator('[data-today-scroll]').count()
ok('A4 落到今日页（可交互）', hasToday > 0, 'today-scroll=' + hasToday)
const navNow = await navHit()
ok('A5 关掉后底部导航可点', navNow && navNow.inNav, JSON.stringify(navNow))
// 真点一次底部导航确认不是只有 elementFromPoint 好看
await page.locator('[data-nav="me"]').click({ timeout: 4000 }).then(() => ok('A6 真能点进「我的」', true)).catch((e) => ok('A6 真能点进「我的」', false, String(e.message).split('\n')[0]))
await page.waitForTimeout(700)
await page.screenshot({ path: `${OUT}/fix-02-after-demo.png` })

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
ok('C1 刷新后不再弹引导层', !(await onboardOpen()))
const onboardedFlag = await page.evaluate(() => localStorage.getItem('web2.onboarded'))
ok('C2 已记 onboarded 标记', !!onboardedFlag, 'web2.onboarded=' + onboardedFlag)
const wroteData = await page.evaluate(() => localStorage.getItem('web2.data'))
ok('C3 没写假数据（示例态不进 web2.data）', wroteData === null, 'web2.data=' + wroteData)

console.log(`\n=== 结果：${pass} 过 / ${fail} 挂 ===`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
