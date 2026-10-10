// 今日页头部上拉收缩：三个状态出图（展开 / 压成一行 / 整块走掉）。用完即删。
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })

const clockAt = (iso) => `
  const FIXED = ${new Date(iso).getTime()};
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(FIXED); else super(...a) }
    static now() { return FIXED }
  }
  window.Date = FakeDate;
`
await page.addInitScript(clockAt('2026-10-12T14:30:00'))
await page.addInitScript(() => {
  // 只在没设过时写 light：否则后面 reload 成暗色会被这条 initScript 重新刷回浅色
  if (!localStorage.getItem('web2.theme')) localStorage.setItem('web2.theme', 'light')
  localStorage.setItem('web2.data', JSON.stringify({
    version: 1,
    schedules: [{
      id: 'sch_1', semester: '2026-2027 秋冬', type: 'course',
      entries: [
        { id: 'c1', type: 'course', name: '交通工程', weekday: 1, start: '08:00', end: '09:35', place: '紫金港东1-205', weeks: null, term: '秋冬' },
        { id: 'c2', type: 'course', name: '结构力学Ⅰ', weekday: 1, start: '10:00', end: '11:35', place: '紫金港北4-317', weeks: null, term: '秋冬' },
        { id: 'c3', type: 'course', name: '环境工程概论', weekday: 1, start: '14:00', end: '15:45', place: '紫金港西2-301', weeks: null, term: '秋冬' },
        { id: 'c4', type: 'course', name: '弹性力学', weekday: 1, start: '16:45', end: '18:25', place: '紫金港北4-102', weeks: null, term: '秋冬' },
        { id: 'c5', type: 'course', name: '工程信息化', weekday: 1, start: '19:00', end: '20:35', place: '紫金港东1-101', weeks: null, term: '秋冬' },
      ],
    }],
    semester: { name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 16 },
  }))
})

await page.goto(BASE, { waitUntil: 'load' })
await page.waitForSelector('[data-page="today"]')
await page.waitForTimeout(900)

const scrollTo = async (s) => { await page.evaluate((v) => { document.querySelector('[data-page="today"]').scrollTop = v }, s); await page.waitForTimeout(220) }
const geom = () => page.evaluate(() => {
  const main = document.querySelector('[data-page="today"]')
  const wrap = document.querySelector('[data-hero-wrap]')
  return { scrollTop: main.scrollTop, max: main.scrollHeight - main.clientHeight, wrapH: Math.round(wrap.getBoundingClientRect().height), wrapTop: Math.round(wrap.getBoundingClientRect().top) }
})

const full = await geom()
console.log('展开态：', JSON.stringify(full))
await page.screenshot({ path: 'tmp/hero-1-full.png' })

// 折到底：滚动 = openH − minH（minH 就是那一行状态条 + 12 顶距）
await scrollTo(full.wrapH - 44)
console.log('折到底：', JSON.stringify(await geom()))
await page.screenshot({ path: 'tmp/hero-2-bar.png' })

// 整块走掉
await scrollTo(full.max)
console.log('走掉：  ', JSON.stringify(await geom()))
await page.screenshot({ path: 'tmp/hero-3-gone.png' })

// 暗色版折到底
await page.evaluate(() => { localStorage.setItem('web2.theme', 'dark'); location.reload() })
await page.waitForSelector('[data-page="today"]')
await page.waitForTimeout(900)
const full2 = await geom()
await scrollTo(full2.wrapH - 44)
await page.screenshot({ path: 'tmp/hero-4-bar-dark.png' })

await browser.close()
