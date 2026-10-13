// Day 27 自测（卡住降级）：像个外行一样，从零打开公网链接，一步步照屏幕文字走，
// 记录第一个「找不到 / 看不懂」的地方。产出截图到 tmp/day27-selftest/。
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'

const URL_ = 'https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/'
const OUT = 'tmp/day27-selftest'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await page.addInitScript(() => { try { localStorage.clear() } catch {} })

const log = []
const say = (s) => { log.push(s); console.log(s) }

const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); say(`[shot] ${name}.png`) }

const info = () => page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
  const onboard = document.querySelector('.fixed.inset-0.z-40')
  return {
    title: document.title,
    onboardVisible: !!onboard && vis(onboard),
    onboardZ: onboard ? getComputedStyle(onboard).zIndex : null,
    // 底部导航是否真的能点到
    navMeHit: (() => {
      const el = document.querySelector('[data-nav="me"]')
      if (!el) return 'no-nav'
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return { box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, hitTag: hit && hit.tagName, hitInNav: !!(hit && hit.closest('[data-nav]')), hitInOnboard: !!(hit && hit.closest('.fixed.inset-0.z-40')) }
    })(),
    visibleButtons: [...document.querySelectorAll('button')].filter(vis).map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean),
    bodyHead: document.body.innerText.replace(/\n{2,}/g, '\n').split('\n').slice(0, 14).join(' | '),
  }
})

say('=== 步骤 0：打开链接（全新访客，localStorage 清空）===')
await page.goto(URL_, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
if (!(await page.title()).includes('大学生日程助手')) {
  for (const sel of ['text=确定访问', 'button:has-text("确定")']) {
    if (await page.locator(sel).count()) { await page.locator(sel).first().click(); await page.waitForTimeout(3000); break }
  }
}
say('过完腾讯云风险页后 title = ' + (await page.title()))
let s = await info()
say('还在引导层 = ' + s.onboardVisible + '（z-index ' + s.onboardZ + '）')
say('屏幕上半部分文字 = ' + s.bodyHead)
say('屏幕上所有可见按钮 = ' + JSON.stringify(s.visibleButtons))
say('底部「我的」按钮命中情况 = ' + JSON.stringify(s.navMeHit))
await shot('01-first-screen')

say('')
say('=== 步骤 1：外行第一反应——想先点底部「我的」看看有没有示例数据 ===')
try {
  await page.locator('[data-nav="me"]').click({ timeout: 3000 })
  say('点「我的」= 成功')
} catch (e) {
  say('点「我的」= 失败（' + String(e.message).split('\n')[0] + '）')
}
say('点完以后还在引导层 = ' + (await info()).onboardVisible)
await shot('02-after-click-me')

say('')
say('=== 步骤 2：按屏幕上唯一的三个入口里最不需要真实信息的那条走 ===')
const choices = await page.evaluate(() => [...document.querySelectorAll('[data-ob-choice-form],[data-ob-choice-edu],[data-ob-choice-import]')].map((e) => ({ attr: e.getAttributeNames().filter((n) => n.startsWith('data-ob')).join(','), text: (e.innerText || '').replace(/\s+/g, ' ').trim() })))
say('引导层三个入口 = ' + JSON.stringify(choices))
await page.locator('[data-ob-choice-form]').click()
await page.waitForTimeout(1200)
s = await info()
say('点「直接填学期信息，自己加课」后：还在引导层 = ' + s.onboardVisible)
say('这一步的可见按钮 = ' + JSON.stringify(s.visibleButtons))
say('这一步屏幕文字 = ' + s.bodyHead)
await shot('03-step1')

say('')
say('=== 步骤 3：这一步要填的字段长什么样 ===')
const fields = await page.evaluate(() => [...document.querySelectorAll('input,select,textarea')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => ({ tag: e.tagName, type: e.type || '', placeholder: e.placeholder || '', value: e.value || '' })))
say('可填字段 = ' + JSON.stringify(fields))
const rows = await page.evaluate(() => [...document.querySelectorAll('div,button')].filter((e) => e.getBoundingClientRect().height > 0 && /开学时间|本学期周数|课程时间设置/.test(e.innerText || '') && e.children.length <= 3).map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 6))
say('三个设置行 = ' + JSON.stringify(rows))

fs.writeFileSync(`${OUT}/selftest.log`, log.join('\n'), 'utf8')
say('')
say('=== 记录写到 ' + OUT + '/selftest.log ===')
await browser.close()
