/* 今日页三段壳 Stage 1 诊断：切 tab 前后窗口几何怎么变（找出 D1 掉位置的原因） */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } })
const page = await ctx.newPage()
await page.addInitScript(() => { localStorage.setItem('web2.onboarded', '1') })
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)

const PROBE = (tag) => {
  const sc = document.querySelector('[data-page="today"]')
  const hero = document.querySelector('header')
  const nav = document.querySelector('nav')
  const strip = sc.parentElement
  return {
    tag,
    pageTop: +sc.getBoundingClientRect().top.toFixed(1),
    inlineH: sc.style.height,
    clientH: sc.clientHeight,
    scrollH: sc.scrollHeight,
    maxScroll: sc.scrollHeight - sc.clientHeight,
    scrollTop: sc.scrollTop,
    heroH: +hero.getBoundingClientRect().height.toFixed(1),
    navH: +nav.getBoundingClientRect().height.toFixed(1),
    stripH: getComputedStyle(strip).height,
    winH: window.innerHeight,
  }
}
console.log('A 初始     ', await page.evaluate(PROBE, 'A'))
await page.evaluate(() => { document.querySelector('[data-today-scroll]').scrollTop = 99999 })
await page.waitForTimeout(200)
console.log('C 滚到底   ', await page.evaluate(PROBE, 'C'))
await page.locator('nav button').filter({ hasText: '周课表' }).click()
await page.waitForTimeout(500)
console.log('W 在周课表 ', await page.evaluate(PROBE, 'W'))
await page.locator('nav button').filter({ hasText: '今日' }).click()
await page.waitForTimeout(120)
console.log('T+120ms    ', await page.evaluate(PROBE, 'T120'))
await page.waitForTimeout(500)
console.log('D 回到今日 ', await page.evaluate(PROBE, 'D'))
await page.waitForTimeout(900)
console.log('D+1s       ', await page.evaluate(PROBE, 'D2'))
await browser.close()
