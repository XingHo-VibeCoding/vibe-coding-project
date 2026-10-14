/* rec-entry-check —— 录音入口归位
   约定（用户 m12102/m12129/m12586）：不加右下角悬浮键、不加自动录音开关；
   录音入口只有两处——今天页顶卡那颗钮（随「正在上课」出现）、
   「我的 → 课堂录音」二级页里那条常驻入口（管理态，永远在）。
   2026-10-13 用户 m12586「周课表里的录音按钮可以去掉」⇒ 课表页那颗钮已删，
   本脚本相应改为**断言它不再出现**（防以后被不知不觉加回来）。
   锚点：今天页 data-today-rec-start / data-today-rec-stop；课表页 data-week-rec-now（应为 0）。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const TODAY_WD = ((new Date().getDay() + 6) % 7) + 1
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date()
monday.setDate(monday.getDate() - (TODAY_WD - 1))

const mk = (id, title, start, duration, weekday = TODAY_WD) => ({
  id, type: 'course', semester_id: 'sem1', title, location: '教三 302', teacher: '张明',
  weekday, start_time: start, duration, week_rule: 'every',
})
/* 今天 08:00–09:40 + 10:00–12:25（用来造「课上」与「空档」两种时刻），明天一节（别的列不该有钮） */
const SCHEDULES = [
  mk('c1', '高等数学', '08:00', 100),
  mk('c2', '大学英语', '10:00', 145),
  mk('c3', '线性代数', '14:00', 100, (TODAY_WD % 7) + 1),
]
const doc = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: iso(monday), total_weeks: 18 },
  schedules: SCHEDULES, todos: [],
}

let pass = 0
let fail = 0
const t = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? '  → ' + extra : ''}`)
  ok ? pass++ : fail++
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

async function open(t2, tab = 'today') {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message)))
  await page.addInitScript(([d]) => {
    localStorage.setItem('web2.data', JSON.stringify(d))
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.theme', '"light"')
  }, [doc])
  await page.goto(`${BASE}/?t=${t2}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  if (tab === 'week') {
    /* 切 tab 用程序化 click：非当前页带 inert，真实鼠标事件会被 inert 吃掉 */
    await page.$eval('[data-nav="week"]', (el) => el.click())
    await page.waitForTimeout(500)
  }
  return { ctx, page, errs }
}

/* Stage 6：录音区搬进「我的」二级页。切「我的」tab（程序化 click，非当前页带 inert）
   再推 lectures 二级页，之后录音区内容在 [data-sub-body] 里读。 */
async function openMeLectures(page) {
  await page.$eval('[data-nav="me"]', (el) => el.click())
  await page.waitForTimeout(400)
  await page.$eval('[data-me-entry="lectures"]', (el) => el.click())
  await page.waitForTimeout(400)
}

/* ================= A. 课上（10:30）：顶卡有钮；课表页那颗已删 ================= */
const A = await open('10:30')
t('A1 今天页顶卡给「录音」钮', (await A.page.locator('[data-today-rec-start]').count()) === 1)
t('A2 今天页没有常驻录音大卡', !/课堂录音/.test(await A.page.locator('[data-page="today"]').innerText()))
t('A3 全应用没有右下角悬浮录音键（不加 FAB）',
  (await A.page.evaluate(() =>
    [...document.querySelectorAll('button')].filter((b) => /fixed/.test(b.className) && /录音/.test(b.getAttribute('aria-label') || '')).length,
  )) === 0)
t('A4 没有自动录音开关（用户 m12129：录音暂时不加自动开关）',
  !/自动录音|自动开始录音|进入教室.*录/.test(await A.page.evaluate(() => document.body.innerText)))
t('A5 课表页不再有录音钮（2026-10-13 用户 m12586 要求去掉）',
  (await A.page.locator('[data-week-rec-now]').count()) === 0,
  String(await A.page.locator('[data-week-rec-now]').count()))
t('A7 「我的」索引页有「录音历史」入口', (await A.page.locator('[data-page="me"] [data-me-entry="lectures"]').count()) === 1)
await openMeLectures(A.page)
t('A7b 推进 lectures 二级页后有「开始录音」按钮', (await A.page.locator('[data-sub-body] button:has-text("开始录音")').count()) === 1)
t('A8 无报错', A.errs.length === 0, A.errs.join(' | '))
await A.ctx.close()

/* ================= B. 课表页那颗钮删掉后：点课程卡仍只走「详情」，没有残留的录音入口 ================= */
const B = await open('10:30', 'week')
t('B1 课上时刻课表页仍不给录音钮（删干净了，没留半颗）',
  (await B.page.locator('[data-week-rec-now]').count()) === 0)
const bRec = await B.page.evaluate(() => ({
  stop: !!document.querySelector('[data-today-rec-stop]'),
  start: !!document.querySelector('[data-today-rec-start]'),
}))
t('B2 课表页本身不进入录音态（录音入口不在这页）', !bRec.stop, JSON.stringify(bRec))
t('B3 无报错', B.errs.length === 0, B.errs.join(' | '))
await B.ctx.close()

/* ================= C. 空档（13:00）：顶卡钮收起来，课表页也没有，「我的」页那条还在 ================= */
const C = await open('13:00', 'week')
t('C1 空档时今天页不给录音钮', (await C.page.locator('[data-today-rec-start]').count()) === 0)
t('C2 空档时课表页也不给录音钮', (await C.page.locator('[data-week-rec-now]').count()) === 0)
await openMeLectures(C.page)
t('C3 空档时「我的」索引有录音历史入口，推进去仍有「开始录音」',
  (await C.page.locator('[data-page="me"] [data-me-entry="lectures"]').count()) === 1
    && (await C.page.locator('[data-sub-body] button:has-text("开始录音")').count()) === 1)
t('C4 无报错', C.errs.length === 0, C.errs.join(' | '))
await C.ctx.close()

/* ================= D. 别的星期那一列也不带钮 ================= */
const D = await open('10:30', 'week')
t('D1 课表页任何一列都没有录音钮（含今天与明天）',
  (await D.page.locator('[data-week-rec-now]').count()) === 0)
await D.ctx.close()

await browser.close()
console.log(`\n=== 录音入口归位：${pass} 项通过 / ${fail} 项失败 ===`)
process.exit(fail ? 1 : 0)
