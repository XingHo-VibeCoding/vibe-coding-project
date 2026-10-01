/* 头部状态行三分支（2026-10-01 用户报：课 12:25 结束、17:27 还显示「进行中」）。
   根因 1：currentCourse 找不到进行中的课就兜底第一节课 → 有课全天都「进行中」。
   根因 2：nowTime 是 mount 时算死的 ref → 页面开着状态永不更新（顺带修，30s 自走、?t= 时冻结）。
   验法（?t= 时间后门，冻结时刻逐场景断言）：
     A 进行中（t=11:00，课 10:00–12:25）→「进行中 · 环境工程概论」
     B 课全结束（t=17:27，截图复现场景）→「今日课程已结束」，且不出现「进行中」
     C 未开始（t=09:00）→「下一节 · 环境工程概论 10:00」
     D 两门课、第一门结束第二门未开始（t=13:00）→「下一节 · 第二门 14:30」
     E 今天没课 →「今天没有课」
   跑法：先起 dev server（4177）再 node tmp/header-status-check.mjs（支持 TW_URL 覆盖） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'

const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const MONDAY = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
const TODAY_WD = ((now.getDay() + 6) % 7) + 1

const course = (id, title, start, dur) => ({
  id, type: 'course', semester_id: 'sem1', title, location: '紫金港北4-319',
  weekday: TODAY_WD, start_time: start, duration: dur, week_rule: 'every',
})

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

async function headerTextAt(tParam, schedules) {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc(schedules))})`)
  await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
  await page.goto(`${URL}${tParam ? '?t=' + tParam : ''}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  const txt = await page.locator('header').innerText()
  await page.close()
  return txt.replace(/\s+/g, ' ')
}

const ONE = [course('c1', '环境工程概论', '10:00', 145)] // 10:00–12:25，对齐截图
const TWO = [course('c1', '环境工程概论', '10:00', 145), course('c2', '第二门课', '14:30', 90)]

let txt = await headerTextAt('11:00', ONE)
t('A1 课中进行中 → 「进行中 · 环境工程概论」', txt.includes('进行中 · 环境工程概论'), txt.match(/今天 \d+ 节课.{0,40}/)?.[0] || '')

txt = await headerTextAt('17:27', ONE)
t('B1 课后 17:27 不再报进行中', !txt.includes('进行中'), '仍含「进行中」即复现 bug')
t('B2 显示「今日课程已结束」', txt.includes('今日课程已结束'))

txt = await headerTextAt('09:00', ONE)
t('C1 课前显示下一节', txt.includes('下一节 · 环境工程概论 10:00'))

txt = await headerTextAt('13:00', TWO)
t('D1 第一门结束第二门未开始 → 指向第二门', txt.includes('下一节 · 第二门课 14:30'))

txt = await headerTextAt('11:00', [])
t('E1 没课显示「今天没有课」', txt.includes('今天没有课'))

await browser.close()
const fails = results.filter((r) => !r[1])
console.log(`\n${results.length - fails.length}/${results.length} 项通过`)
process.exit(fails.length ? 1 : 0)
