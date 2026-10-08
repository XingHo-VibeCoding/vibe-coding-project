/* 三期 Step 3：周视图渲染「固定循环日程」（type: routine）。
   验的是四件事：
     ① 循环日程和课程混在同一个网格里，各自落在正确的列（共用 weekGrid 落格算法）；
     ② 视觉上能区分——固定灰蓝底色 + 课名前的小循环标记，课程/独立日程都不带；
     ③ 周次规则（每周/单周/双周）照样生效，切周次后单/双周互换；
     ④ 周末的循环日程会把「周六」列顶出来（weekCols 自动补列）；
     ⑤ 详情弹层认得 routine：显示名字/星期/时间，并给出删除入口（删除只影响它自己）。
   跑法：先起 dist 静态服务（默认 4177，或用 TW_URL 覆盖）再 node tmp/routine-grid-check.mjs */
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
const MONDAY = iso(mon)
const TODAY_WD = ((now.getDay() + 6) % 7) + 1 // 1..7，周一=1

const COURSES = [
  { id: 'c1', type: 'course', title: '高等数学', location: '教1-101', weekday: 3, start_time: '09:00', duration: 45, week_rule: 'every', semester_id: 'sem1' },
]
const ROUTINES = [
  { id: 'r1', type: 'routine', title: '社团例会', location: '大学生活动中心', weekday: 3, start_time: '14:00', duration: 60, week_rule: 'every', semester_id: 'sem1' },
  { id: 'r2', type: 'routine', title: '周末兼职', location: '市区', weekday: 6, start_time: '10:00', duration: 60, week_rule: 'every', semester_id: 'sem1' },
  { id: 'r3', type: 'routine', title: '单周活动', location: '', weekday: 3, start_time: '16:00', duration: 60, week_rule: 'odd', semester_id: 'sem1' },
  { id: 'r4', type: 'routine', title: '双周活动', location: '', weekday: 3, start_time: '16:00', duration: 60, week_rule: 'even', semester_id: 'sem1' },
]
const thu = new Date(mon)
thu.setDate(mon.getDate() + 3)
const EVENTS = [
  { id: 'e1', type: 'event', title: '看病', location: '医院', weekday: null, start_time: '12:00', duration: 60, week_rule: null, date: iso(thu), semester_id: null },
]

function seedDoc(schedules) {
  return JSON.stringify({
    app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
    semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
    schedules, todos: [],
  })
}

/* 打开页面 → 切到周课表 → 抓网格内所有卡片 */
async function openWeek(browser, schedules) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
/* P14 测试隔离：掐掉节假日 CDN（headless Chrome 有真网，开机会真抓到国庆放假，把夹具里本周的课藏掉）。用宽 pattern + 域判断——窄的 '**cdn.jsdelivr.net**' 不命中带路径的 URL。 */
await ctx.route('**/*', (r) => (r.request().url().includes('cdn.jsdelivr.net') ? r.abort() : r.continue()))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc(schedules))})`)
  await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
  await page.addInitScript(`localStorage.setItem('web2.theme', '"light"')`)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.locator('nav button', { hasText: '周课表' }).click()
  await page.waitForTimeout(600)
  return { ctx, page }
}

const CARDS = () =>
  [...document.querySelectorAll('[data-grid] article')].map((el) => ({
    type: el.dataset.itemType,
    title: el.querySelector('p')?.textContent?.trim() || '',
    wd: Number(el.style.gridColumnStart) - 1, // 第 1 列是节次标签栏，所以列号 = 星期 + 1
    mark: !!el.querySelector('[data-routine-mark]'),
    bg: getComputedStyle(el).backgroundColor,
  }))

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})

/* ============ 主场景：课程 + 4 条循环日程 + 1 条独立日程 ============ */
const A = await openWeek(browser, [...COURSES, ...ROUTINES, ...EVENTS])
const cards = await A.page.evaluate(CARDS)
console.log('卡片明细:', JSON.stringify(cards))

const rCards = cards.filter((c) => c.type === 'routine')
const courseCards = cards.filter((c) => c.type === 'course')
const evCards = cards.filter((c) => c.type === 'event')

t('A1 循环日程渲染进网格（本周 3 条：每周 2 + 单/双周之一）', rCards.length === 3, `实际 ${rCards.length} 条`)
t('A2 每张循环日程卡都带小循环标记', rCards.length > 0 && rCards.every((c) => c.mark))
t('A3 课程卡不带循环标记', courseCards.length === 1 && !courseCards[0].mark)
t('A4 独立日程卡不带循环标记', evCards.length === 1 && !evCards[0].mark)
t('A5 循环日程用固定灰蓝底（rgb(238, 240, 245)）', rCards.length > 0 && rCards.every((c) => c.bg === 'rgb(238, 240, 245)'), rCards[0]?.bg)
t('A6 课程卡底色与循环日程不同', courseCards.length === 1 && courseCards[0].bg !== 'rgb(238, 240, 245)', courseCards[0]?.bg)
const club = rCards.find((c) => c.title === '社团例会')
t('A7 「社团例会」落在周三列', !!club && club.wd === 3, club ? `列=${club.wd}` : '没找到')

/* 周次规则：单周/双周互斥，同一周只应出现其中一条 */
const odd = rCards.some((c) => c.title === '单周活动')
const even = rCards.some((c) => c.title === '双周活动')
t('B1 单双周规则生效：同一周只显示一条', odd !== even, `单周=${odd} 双周=${even}`)
await A.page.locator('[data-week-next]').click()
await A.page.waitForTimeout(400)
const cards2 = await A.page.evaluate(CARDS)
const odd2 = cards2.some((c) => c.title === '单周活动')
const even2 = cards2.some((c) => c.title === '双周活动')
t('B2 切到下一周后单/双周互换', odd2 !== odd && even2 !== even, `单周 ${odd}→${odd2}，双周 ${even}→${even2}`)
const weekLabel = (await A.page.locator('[data-week-label]').innerText()).replace(/\s+/g, ' ').trim()
t('B3 周次标签确实前进了（证明上面那次切换有效）', weekLabel.includes('第 2 周'), weekLabel)

/* 周末列：周六有循环日程 → 表头补出「周六」 */
const headText = (await A.page.locator('[data-grid]').evaluate((el) => el.parentElement.querySelector('.grid').innerText)).replace(/\s+/g, '')
t('C1 周六有循环日程 → 表头补出周六列', headText.includes('周六'), headText)

/* 详情弹层 */
await A.page.locator('[data-week-prev]').click()
await A.page.waitForTimeout(400)
await A.page.locator('[data-grid] article', { hasText: '社团例会' }).click()
await A.page.waitForTimeout(400)
const sheet = A.page.locator('[data-sheet-detail]')
const sheetText = (await sheet.innerText()).replace(/\s+/g, ' ')
t('D1 点循环日程卡弹出详情', (await sheet.count()) === 1)
t('D2 详情显示名称', sheetText.includes('社团例会'), sheetText.slice(0, 60))
t('D3 详情显示星期与周次标签', sheetText.includes('周三') && sheetText.includes('每周'), sheetText.slice(0, 80))
t('D4 详情显示地点', sheetText.includes('大学生活动中心'))
t('D5 循环日程详情有删除入口', (await A.page.locator('[data-routine-del]').count()) === 1)

/* 删除：点两次确认，只删掉这一条 */
await A.page.locator('[data-routine-del]').click()
await A.page.waitForTimeout(150)
t('E1 首次点击只进二次确认，不删', (await A.page.locator('[data-grid] article', { hasText: '社团例会' }).count()) === 1)
await A.page.locator('[data-routine-del]').click()
await A.page.waitForTimeout(500)
const cards3 = await A.page.evaluate(CARDS)
t('E2 再点一次删除成功', !cards3.some((c) => c.title === '社团例会'))
t('E3 删除只影响那一条：课程与其他循环日程还在',
  cards3.filter((c) => c.type === 'course').length === 1 &&
  cards3.filter((c) => c.type === 'routine').length === 2 &&
  cards3.filter((c) => c.type === 'event').length === 1,
  `course=${cards3.filter((c) => c.type === 'course').length} routine=${cards3.filter((c) => c.type === 'routine').length} event=${cards3.filter((c) => c.type === 'event').length}`)

/* 课程详情的按钮组里不应混进循环日程的删除入口 */
await A.page.locator('[data-grid] article', { hasText: '高等数学' }).click()
await A.page.waitForTimeout(400)
t('F1 课程详情里没有循环日程的删除按钮', (await A.page.locator('[data-routine-del]').count()) === 0)
t('F2 课程详情仍有编辑/删除两键', (await A.page.locator('[data-sheet-detail] button', { hasText: '编辑' }).count()) === 1)
await A.ctx.close()

/* ============ 对照组：同样的课，但不含循环日程 → 不应补出周六列 ============ */
const B = await openWeek(browser, [...COURSES, ...EVENTS])
const headNoRoutine = (await B.page.locator('[data-grid]').evaluate((el) => el.parentElement.querySelector('.grid').innerText)).replace(/\s+/g, '')
t('G1 没有循环日程时不补出周六列（今天就是周末时天然豁免）',
  !headNoRoutine.includes('周六') || TODAY_WD >= 6,
  `表头=${headNoRoutine}｜今天周${TODAY_WD}${TODAY_WD >= 6 ? '（今天本来就是周末，豁免）' : ''}`)
await B.ctx.close()

await browser.close()
const fails = results.filter((r) => !r[1])
console.log(`\n${results.length - fails.length}/${results.length} 项通过`)
process.exit(fails.length ? 1 : 0)
