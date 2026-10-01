/* 诊断：周课表页的纵向空间账（2026-10-01 用户报「左右划不动没问题，但上下还能滑」）。
   量清楚：视口高 / 文档高 / 能滑多少 / 头部与周次条各占多少 / 网格实际能分到多少。
   跑法：先起 dev server（4177）再 node tmp/diag-week-space.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = 'http://127.0.0.1:4177/'
const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const MONDAY = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`

const names = ['环境工程概论', '工程信息与通信导论', '习近平新时代中国特色社会主义思想概论', '结构力学', '交通工程']
const schedules = []
names.forEach((n, i) => {
  schedules.push({ id: `c${i}`, type: 'course', semester_id: 'sem1', title: n, location: `紫金港北4-${319 + i} 叶苗苗`, weekday: (i % 5) + 1, start_time: '10:00', duration: 100, week_rule: 'every' })
})
const seedDoc = JSON.stringify({
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
  schedules, todos: [],
})

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc)})`)
await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await page.locator('nav button').nth(1).click()
await page.waitForTimeout(600)

const m = await page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), h: +b.height.toFixed(1) }
  }
  const nav = document.querySelector('nav')
  const navB = nav ? nav.getBoundingClientRect() : null
  const sc = document.scrollingElement
  return {
    viewportH: window.innerHeight,
    docH: sc.scrollHeight,
    clientH: sc.clientHeight,
    scrollTopBefore: sc.scrollTop,
    header: r('header'),
    weekbar: r('section.flex.items-center.justify-between'),
    gridSection: r('section.overflow-hidden'),
    gridBody: r('[data-grid]'),
    nav: navB ? { top: +navB.top.toFixed(1), h: +navB.height.toFixed(1) } : null,
    tabLabel: [...document.querySelectorAll('nav button')].find((b) => b.className.includes('text-primary-500'))?.textContent.trim(),
  }
})
console.log('空间账:', JSON.stringify(m, null, 1))

/* 往下滑到底，看能滑出多少「空白」 */
const after = await page.evaluate(async () => {
  const sc = document.scrollingElement
  window.scrollTo(0, sc.scrollHeight)
  await new Promise((r) => setTimeout(r, 200))
  const grid = document.querySelector('[data-grid]').getBoundingClientRect()
  return { scrollTop: sc.scrollTop, maxScroll: sc.scrollHeight - sc.clientHeight, gridBottomAfter: +grid.bottom.toFixed(1) }
})
console.log('滑到底:', JSON.stringify(after))

await browser.close()
