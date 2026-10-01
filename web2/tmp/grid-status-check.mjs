/* 周网格「进行中蓝框」只亮今天列（2026-10-01 用户报：上午 3-5 节整行冒蓝框）。
   根因：courseStatus 只比时间不比星期，周网格里其他列同一时刻的课也被判成 'now'。
   修法：新增 gridStatus(it)——非今天列（或非本周）一律返回 ''。
   验法：造每个工作日都有一门「正覆盖当前时刻」的课 + 今天一门已结束的课 + 别的列一门已结束的课，
   断言：蓝框全文只有 1 个且落在今天列；今天的结束课变暗、别的列的结束课不变暗。
   跑法：先起 dev server（4177）再 node tmp/grid-status-check.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

const URL = 'http://127.0.0.1:4199/'

const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const MONDAY = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
const TODAY_WD = ((now.getDay() + 6) % 7) + 1 // 1..7，周一=1
const OTHER_WD = TODAY_WD === 1 ? 2 : 1

const pad = (n) => String(n).padStart(2, '0')
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const startCover = new Date(now.getTime() - 30 * 60000) // 覆盖当前时刻：30 分钟前开始
const startEnded = new Date(now.getTime() - 90 * 60000) // 已结束：90 分钟前开始、50 分钟前结束
const endEnded = new Date(now.getTime() - 50 * 60000)

const COURSES = []
for (let wd = 1; wd <= 5; wd++) {
  COURSES.push({ id: `cov${wd}`, type: 'course', semester_id: 'sem1', title: `覆盖课${wd}`, location: '教1-101', weekday: wd, start_time: hm(startCover), duration: 60, week_rule: 'every' })
}
COURSES.push({ id: 'endedToday', type: 'course', semester_id: 'sem1', title: '今天已结束', location: '教1-102', weekday: TODAY_WD, start_time: hm(startEnded), duration: Math.round((endEnded - startEnded) / 60000), week_rule: 'every' })
COURSES.push({ id: 'endedOther', type: 'course', semester_id: 'sem1', title: '别天同时刻', location: '教1-103', weekday: OTHER_WD, start_time: hm(startEnded), duration: Math.round((endEnded - startEnded) / 60000), week_rule: 'every' })
// 今天已结束的课与覆盖课可能同格重叠，无所谓——断言按 class 统计，不按格

function seedDoc(schedules) {
  return JSON.stringify({
    app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
    semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
    schedules, todos: [],
  })
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc(COURSES))})`)
await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await page.locator('nav button').nth(1).click() // 周课表
await page.waitForTimeout(600)

/* 收集每张课卡：列号（gridColumnStart=wd+1）+ 是否蓝框 + 是否变暗 */
const cards = await page.evaluate(() =>
  [...document.querySelectorAll('[data-grid] article')].map((el) => ({
    title: el.querySelector('p')?.textContent || '',
    wd: Number(el.style.gridColumnStart) - 1, // gridColumnStart = 星期+1（第 1 列是节次标签栏）
    now: el.classList.contains('ring-2') && el.classList.contains('ring-primary-500'),
    dim: el.classList.contains('opacity-55'),
  }))
)
console.log('课卡明细:', JSON.stringify(cards, null, 0))

const nowCards = cards.filter((c) => c.now)
t('A1 全网格只有 1 张「进行中」蓝框卡', nowCards.length === 1, `实际 ${nowCards.length} 张`)
t('A2 蓝框卡落在今天列', nowCards.length === 1 && nowCards[0].wd === TODAY_WD, `蓝框卡列=${nowCards.map((c) => c.wd).join(',')}，今天=周${TODAY_WD}`)
t('A3 蓝框卡是今天的覆盖课', nowCards.length === 1 && nowCards[0].title === `覆盖课${TODAY_WD}`)

const dimToday = cards.filter((c) => c.title === '今天已结束')
const dimOther = cards.filter((c) => c.title === '别天同时刻')
t('B1 今天已结束的课变暗（past 口径保留）', dimToday.length === 1 && dimToday[0].dim)
t('B2 别的列同时刻已结束的课不变暗', dimOther.length === 1 && !dimOther[0].dim)

const otherCov = cards.filter((c) => c.title.startsWith('覆盖课') && c.wd !== TODAY_WD)
t('C1 其他列的覆盖课全部无蓝框', otherCov.length === 4 && otherCov.every((c) => !c.now), `共 ${otherCov.length} 张`)

await browser.close()
const fails = results.filter((r) => !r[1])
console.log(`\n${results.length - fails.length}/${results.length} 项通过`)
process.exit(fails.length ? 1 : 0)
