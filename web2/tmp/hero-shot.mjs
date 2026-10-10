/* 今日页头部上拉收缩：状态出图（展开 / 压成一行 / 折到底再上拉的暗色版）。
   ⚠ 2026-10-10：折到底后头部钉住、不再「整块走掉」（用户 m01369），故走掉档已删。
   ⚠ scrollTo 必须在 page.evaluate 内 await 6 帧：onTodayScroll 是 rAF 去抖的，
     而 headless Chrome 无合成帧时不推进 rAF，否则量到的是没更新的几何。
   用法：先 vite build + 起 dist 静态服务（默认 4177），再 node tmp/hero-shot.mjs */
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

const scrollTo = async (v) => {
  await page.evaluate(async (n) => {
    document.querySelector('[data-page="today"]').scrollTop = n
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r))
  }, v)
  await page.waitForTimeout(350)
}
const geom = () => page.evaluate(() => {
  const main = document.querySelector('[data-page="today"]')
  const wrap = document.querySelector('[data-hero-wrap]')
  const header = document.querySelector('header')
  const bar = document.querySelector('[data-hero-bar]')
  return {
    scrollTop: main.scrollTop, maxScroll: main.scrollHeight - main.clientHeight,
    wrapH: Math.round(wrap.getBoundingClientRect().height), wrapTop: Math.round(wrap.getBoundingClientRect().top),
    headerH: Math.round(header.getBoundingClientRect().height),
    headerOp: getComputedStyle(header).opacity,
    barOp: parseFloat(getComputedStyle(bar).opacity).toFixed(2),
  }
})

const full = await geom()
console.log('展开态：  ', JSON.stringify(full))
await page.screenshot({ path: 'tmp/hero-1-full.png' })

// 折到底：滚动 = openH − minH（minH = 12 顶白 + 32 状态条 + 8 底白 = 52，2026-10-12）
const MINH = 52
const collapsed = full.wrapH - MINH
await scrollTo(collapsed)
console.log('折到底：  ', JSON.stringify(await geom()))
await page.screenshot({ path: 'tmp/hero-2-bar.png' })

// 再往上拉：状态条钉住不动（不写新图，只打印几何验证「不走了」）
await scrollTo(full.maxScroll)
console.log('再往上拉：', JSON.stringify(await geom()), '← wrapTop / wrapH 应与「折到底」一致')

// 暗色版折到底
await page.evaluate(() => { localStorage.setItem('web2.theme', 'dark'); location.reload() })
await page.waitForSelector('[data-page="today"]')
await page.waitForTimeout(900)
const full2 = await geom()
await scrollTo(full2.wrapH - MINH)
await page.screenshot({ path: 'tmp/hero-3-bar-dark.png' })

await browser.close()
