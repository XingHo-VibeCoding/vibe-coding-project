// Day 26 截图：打开真实 Chrome 窗口（headed，带地址栏），等页面就绪后停住等外部截屏。
// 用法：node tmp/day26-open-app.mjs [url] [holdSeconds] [navKey]
//   navKey: today(默认) | week | me   —— 用来证明「回滚之后」应用仍然可用（换个页面也是活的）
// 自己处理腾讯云免费域名的「风险提醒」中间页。
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL_ = process.argv[2] || 'https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/'
const HOLD = Number(process.argv[3] || 30) * 1000
const NAV = process.argv[4] || 'today'

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: ['--window-size=520,1020', '--window-position=40,10', '--no-first-run', '--no-default-browser-check',
         '--disable-features=Translate,TranslateUI', '--lang=zh-CN'],
})
const page = await browser.newPage({ viewport: { width: 430, height: 860 } })

// 线上首访会落到引导页。塞一份样例数据 + 引导标记，让截图看到真正的「今日」页，
// 而不是「欢迎使用」——三张图里第 1、3 张要证明的是「应用能跑」，不是「能装」。
if (process.env.SEED === '1') {
  await page.addInitScript(() => {
    const FIXED = new Date('2026-10-12T09:20:00').getTime()
    const RealDate = Date
    class FakeDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(FIXED); else super(...a) }
      static now() { return FIXED }
    }
    window.Date = FakeDate
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.theme', 'light')
    localStorage.setItem('web2.data', JSON.stringify({
      version: 1,
      schedules: [{
        id: 'sch_1', semester: '2026-2027 秋冬', type: 'course',
        entries: [
          { id: 'c1', type: 'course', name: '高等数学', weekday: 1, start: '08:00', end: '09:35', place: '紫金港东1-205', weeks: null, term: '秋冬' },
          { id: 'c2', type: 'course', name: '结构力学Ⅰ', weekday: 1, start: '10:00', end: '11:35', place: '紫金港北4-317', weeks: null, term: '秋冬' },
          { id: 'c3', type: 'course', name: '环境工程概论', weekday: 1, start: '14:00', end: '15:45', place: '紫金港西2-301', weeks: null, term: '秋冬' },
        ],
      }],
      semester: { name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 16 },
    }))
  })
}

await page.goto(URL_, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)

// 腾讯云免费托管域名的「风险提醒」中间页：找按钮点进去
let title = await page.title()
console.log('[1] title =', title)
if (!title.includes('大学生日程助手')) {
  for (const sel of ['text=确定访问', 'text=继续访问', 'button:has-text("确定")', 'text=我知道了']) {
    const n = await page.locator(sel).count()
    if (n > 0) {
      console.log('[2] clicking risk-page button:', sel)
      await page.locator(sel).first().click()
      await page.waitForTimeout(3500)
      break
    }
  }
}
title = await page.title()
console.log('[3] title now =', title)

if (NAV !== 'today') {
  const n = await page.locator(`[data-nav="${NAV}"]`).count()
  console.log('[4] nav target count =', n, 'for', NAV)
  if (n > 0) { await page.locator(`[data-nav="${NAV}"]`).first().click(); await page.waitForTimeout(1200) }
}

const anchors = await page.evaluate(() => ({
  hasToday: !!document.querySelector('[data-today-scroll]'),
  hasHero: !!document.querySelector('[data-hero-wrap]'),
  body: document.body.innerText.slice(0, 140).replace(/\n+/g, ' | '),
}))
console.log('[5] anchors =', JSON.stringify(anchors))
console.log('READY  — holding', HOLD / 1000, 's for external screen capture')
await page.waitForTimeout(HOLD)
await browser.close()
console.log('DONE')
