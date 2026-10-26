/* 接下来 = 下一件要办的事（2026-10-23 用户 m02477）
   旧行为：列表只从今天的安排里筛，今天一过完就空 —— 明天有课也不显示。
   新口径：今天还有没过的就照旧；今天全过完（或今天没课）就往后找最近有安排的那一天，
   只显示那天的第一条。
   验八件事：
     A 今天全过完 → 明天那件出现（带「明天」标签）
     B 今天没课 → 明天那件出现（走另一条分支）
     C 明天也没课 → 跳到后天，标签写「后天」
     D 今天还有没过完的 → 不出现跨天那一行（今天列表照旧，不能抢位）
     E 明天放假（调休 off）→ 跳过明天，显示后天
     F 往后 45 天都没安排 → 空态文案，不编一条假的
     G 独立日程按日期落位（明天只有一条日程也能被找出来）
     H 全程无 pageerror
   跑法：先起 dist 静态服务（4177）再 node tmp/upcoming-check.mjs */
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
const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const TODAY_WD = now.getDay() === 0 ? 7 : now.getDay()
const wdOf = (offset) => ((TODAY_WD - 1 + offset) % 7) + 1
const keyOf = (offset) => {
  const d = new Date(now)
  d.setDate(now.getDate() + offset)
  return iso(d)
}

function doc(schedules) {
  return JSON.stringify({
    app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
    semester: { id: 'sem1', name: '测试学期', first_monday: iso(mon), total_weeks: 16 },
    schedules, todos: [],
  })
}
function course(id, title, wd, start, dur) {
  return { id, type: 'course', title, location: '教1-101', weekday: wd, start_time: start, duration: dur, week_rule: 'every', semester_id: 'sem1' }
}
function event(id, title, date, start, dur) {
  return { id, type: 'event', title, location: '紫金港东1-101', date, start_time: start, duration: dur }
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-gpu'],
})

async function open(tm, schedules, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.route('**/*', (r) => (r.request().url().includes('cdn.jsdelivr.net') ? r.abort() : r.continue()))
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(doc(schedules))})`)
  await page.addInitScript("localStorage.setItem('web2.onboarded', '1')")
  await page.addInitScript("localStorage.setItem('web2.theme', '\"light\"')")
  if (opts.overrides) {
    await page.addInitScript(`localStorage.setItem('web2.dayOverrides', ${JSON.stringify(JSON.stringify(opts.overrides))})`)
  }
  await page.goto(URL + '?t=' + tm, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  return { ctx, page, errs }
}

async function readNext(page) {
  return page.evaluate(() => {
    const lab = document.querySelector('[data-today-nextday]')
    const item = document.querySelector('[data-today-nextday-item]')
    const empty = document.querySelector('[data-today-empty]') || null
    const body = document.querySelector('main') ? document.querySelector('main').innerText : document.body.innerText
    return {
      hasLabel: !!lab,
      label: lab ? lab.innerText.replace(/\s+/g, ' ').trim() : '',
      item: item ? item.innerText.replace(/\s+/g, ' ').trim() : '',
      itemTime: item ? (item.querySelector('[data-row-time]') || {}).textContent || '' : '',
      empty: empty ? empty.innerText.trim() : '',
      body,
    }
  })
}

/* A. 今天全过完 → 明天那件 */
console.log('\n--- A 今天全过完了，明天有课 ---')
{
  const { ctx, page, errs } = await open('22:00', [
    course('c-today', '今天的课', TODAY_WD, '08:00', 60),
    course('c-tmr', '明天的高数', wdOf(1), '10:00', 90),
  ])
  const r = await readNext(page)
  t('A1 出现了「之后」那一行', r.hasLabel, r.label)
  t('A2 标签写「明天」', /明天/.test(r.label), r.label)
  t('A3 显示的是明天那门课', /明天的高数/.test(r.item), r.item)
  t('A4 时间是 10:00', /10:00/.test(r.item), r.item)
  t('A5 无 pageerror', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

/* B. 今天没课 → 明天那件（另一条模板分支） */
console.log('\n--- B 今天没课 ---')
{
  const { ctx, page } = await open('09:00', [course('c-tmr', '明天的高数', wdOf(1), '10:00', 90)])
  const r = await readNext(page)
  t('B1 今天没课时也显示下一件', /明天的高数/.test(r.item), r.item)
  t('B2 标签写「明天」', /明天/.test(r.label), r.label)
  t('B3 不再显示「今天没有课程安排」', !/今天没有课程安排/.test(r.body), '')
  await ctx.close()
}

/* C. 明天也没课 → 后天 */
console.log('\n--- C 明天也没安排 ---')
{
  const { ctx, page } = await open('22:00', [
    course('c-today', '今天的课', TODAY_WD, '08:00', 60),
    course('c-d2', '后天的大物', wdOf(2), '14:00', 90),
  ])
  const r = await readNext(page)
  t('C1 跳到后天那门课', /后天的大物/.test(r.item), r.item)
  t('C2 标签写「后天」', /后天/.test(r.label), r.label)
  await ctx.close()
}

/* D. 今天还有没过完的 → 不抢位 */
console.log('\n--- D 今天还有没过完的 ---')
{
  const { ctx, page } = await open('09:00', [
    course('c-later', '晚上的课', TODAY_WD, '20:00', 90),
    course('c-tmr', '明天的高数', wdOf(1), '10:00', 90),
  ])
  const r = await readNext(page)
  t('D1 不出现跨天那一行', !r.hasLabel, r.label)
  t('D2 今天那条照常在', /晚上的课/.test(r.body), '')
  await ctx.close()
}

/* E. 明天放假 → 跳过 */
console.log('\n--- E 明天放假（调休 off） ---')
{
  const { ctx, page } = await open('22:00', [
    course('c-today', '今天的课', TODAY_WD, '08:00', 60),
    course('c-tmr', '明天的高数', wdOf(1), '10:00', 90),
    course('c-d2', '后天的大物', wdOf(2), '14:00', 90),
  ], { overrides: [{ date: keyOf(1), kind: 'off', useWeekday: null, note: '校运会' }] })
  const r = await readNext(page)
  t('E1 跳过放假那天，显示后天', /后天的大物/.test(r.item), r.item)
  t('E2 放假那天的课没被当成「下一件」', !/明天的高数/.test(r.item), r.item)
  await ctx.close()
}

/* F. 什么都没有 → 空态，不编假的
   注意：课程默认「每周」重复，所以「45 天内没安排」在真实数据里几乎不会发生 ——
   要造这个状态得把课限制在当周（weeks:[1]）。两条一起验：
     F1 完全没数据 → 空态文案
     F2 只有本周这一节、已经上完 → 不出现跨天那一行（不拿下一周顶替） */
console.log('\n--- F 以后没有安排 ---')
{
  const { ctx, page } = await open('22:00', [])
  const r = await readNext(page)
  t('F1 一条安排都没有时给空态文案', /今天没有课程安排/.test(r.body), '')
  t('F2 也不编一条假的下一件', !r.hasLabel, r.label)
  await ctx.close()
}
{
  const onlyThisWeek = Object.assign(course('c-week1', '本周的课', TODAY_WD, '08:00', 60), { weeks: [1] })
  const { ctx, page } = await open('22:00', [onlyThisWeek])
  const r = await readNext(page)
  t('F3 只有本周这一节（已上完）→ 不出现跨天那一行', !r.hasLabel, r.label)
  await ctx.close()
}

/* G. 独立日程按日期落位 */
console.log('\n--- G 明天只有一条独立日程 ---')
{
  const { ctx, page } = await open('22:00', [
    course('c-today', '今天的课', TODAY_WD, '08:00', 60),
    event('e-tmr', '班会', keyOf(1), '15:00', 60),
  ])
  const r = await readNext(page)
  t('G1 独立日程也能被找出来', /班会/.test(r.item), r.item)
  t('G2 时间是 15:00', /15:00/.test(r.item), r.item)
  await ctx.close()
}

await browser.close()

const pass = results.filter((x) => x[1]).length
console.log('\n=== 接下来（下一件）：' + pass + '/' + results.length + ' 通过 ===')
process.exit(pass === results.length ? 0 : 1)
