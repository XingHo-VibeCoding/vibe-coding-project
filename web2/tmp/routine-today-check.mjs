/* 三期 Step 5：今日页显示循环日程 + 冲突检测在界面上的落点。
   验的是四件事：
     A 今日页把循环日程排进来（带小循环标记、与课程区分、按时间排序、单双周按本周过滤）；
     B 头部状态行（进行中 / 今日安排已结束）把循环日程算进去；
     C 循环日程撞课程 → 保存时提示（目标自己是循环日程，不带「含循环日程」后缀）；
     D 课程撞循环日程 → 提示带「（含循环日程）」后缀；再点一次放行；
     E 独立日程撞循环日程 → 按「那一天」比对并提示。
   跑法：先起 dist 静态服务（默认 4177，可用 TW_URL 覆盖）再 node tmp/routine-today-check.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'

/* 今天是运行时的星期几：种子全排在「今天」，今日页才有东西可看 */
const now = new Date()
const TODAY_WD = ((now.getDay() + 6) % 7) + 1 // 周一=1
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const pad = (n) => String(n).padStart(2, '0')
const MONDAY = `${mon.getFullYear()}-${pad(mon.getMonth() + 1)}-${pad(mon.getDate())}`
const isoToday = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

/* 自定义节次表：节次短（30 分钟）、间隔小 —— 这样「循环日程默认 60 分钟」从第 1 节
   起就会盖到第 2 节的日程上，冲突场景能稳定造出来（默认节次表 45 分钟 + 10 分钟课间
   会让 08:00-09:00 和 09:00 刚好相接，撞不上）。 */
const PERIODS = [
  { no: 1, start: '08:00', end: '08:30' },
  { no: 2, start: '08:40', end: '09:10' },
  { no: 3, start: '09:20', end: '09:50' },
  { no: 4, start: '10:00', end: '10:30' },
  { no: 5, start: '14:00', end: '14:30' },
  { no: 6, start: '18:00', end: '18:30' },
  { no: 7, start: '20:00', end: '20:30' },
]

const SCHEDULES = [
  { id: 'c1', type: 'course', title: '高等数学', location: '教1-101', weekday: TODAY_WD, start_time: '09:20', duration: 30, week_rule: 'every', semester_id: 'sem1' },
  { id: 'r1', type: 'routine', title: '健身', location: '体育馆', weekday: TODAY_WD, start_time: '08:40', duration: 30, week_rule: 'every', semester_id: 'sem1' },
  { id: 'r2', type: 'routine', title: '单周自习', location: '', weekday: TODAY_WD, start_time: '18:00', duration: 60, week_rule: 'odd', semester_id: 'sem1' },
  { id: 'r3', type: 'routine', title: '双周锻炼', location: '', weekday: TODAY_WD, start_time: '20:00', duration: 30, week_rule: 'even', semester_id: 'sem1' },
  // 与今天无关的一天放一条，验证今日页只挑「今天」
  { id: 'r4', type: 'routine', title: '别天的瑜伽', location: '', weekday: (TODAY_WD % 7) + 1, start_time: '08:00', duration: 30, week_rule: 'every', semester_id: 'sem1' },
]
const SEED = JSON.stringify({
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16, periods: PERIODS },
  schedules: SCHEDULES, todos: [],
})

async function openPage(browser, { t: time, seed = SEED } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seed)})`)
  await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
  await page.addInitScript(`localStorage.setItem('web2.theme', '"light"')`)
  await page.goto(URL + (time ? '?t=' + time : ''), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  return page
}

/* 只读今日页的卡片容器：tab 切走后周视图可能仍在 DOM 里（文本出现不代表进了今日页） */
const TODAY_ITEMS = () =>
  [...document.querySelectorAll('[data-today-item]')].map((el) => ({
    type: el.dataset.itemType,
    start: el.querySelector('p')?.textContent?.trim() || '',
    text: el.innerText.replace(/\s+/g, ' ').trim(),
    mark: !!el.querySelector('[data-routine-mark]'),
    tag: el.querySelector('span.rounded-full')?.textContent?.trim() || '',
  }))

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})

/* ================= A. 今日页显示循环日程 ================= */
const p1 = await openPage(browser, { t: '07:00' })
const items = await p1.evaluate(TODAY_ITEMS)
t('A1 今日页共 3 条（课程 1 + 循环日程 2）', items.length === 3, JSON.stringify(items.map((x) => x.type + ':' + x.start)))
t('A2 两条是循环日程、一条是课程',
  items.filter((x) => x.type === 'routine').length === 2 && items.filter((x) => x.type === 'course').length === 1,
  JSON.stringify(items.map((x) => x.type)))
t('A3 循环日程卡片带小循环标记', items.filter((x) => x.type === 'routine').every((x) => x.mark))
t('A4 课程卡片不带循环标记', items.filter((x) => x.type === 'course').every((x) => !x.mark))
t('A5 按开始时间排序（08:40 / 09:20 / 18:00）',
  items.map((x) => x.start).join(',') === '08:40,09:20,18:00', items.map((x) => x.start).join(','))
t('A6 双周循环日程在单周不出现', !items.some((x) => x.start === '20:00'), JSON.stringify(items.map((x) => x.start)))
t('A7 别的星期的循环日程不进今日页', !items.some((x) => x.text.includes('别天的瑜伽')), JSON.stringify(items.map((x) => x.text.slice(0, 12))))
const rItem = items.find((x) => x.start === '08:40')
t('A8 循环日程卡片显示周次标签', rItem && rItem.tag === '每周', rItem && rItem.tag)
const headText = await p1.locator('text=/今天 \\d+ 项安排/').count()
t('A9 头部文案按「项安排」口径（含循环日程时不叫「节课」）', headText === 1)
await p1.context().close()

/* ================= B. 头部状态行算上循环日程 ================= */
const p2 = await openPage(browser, { t: '08:50' })
const h2 = (await p2.locator('body').innerText()).replace(/\s+/g, ' ')
t('B1 循环日程时段内 → 头部显示「进行中 · 健身」', h2.includes('进行中 · 健身'), h2.match(/进行中 · [^\s]{0,10}/)?.[0] || '')
await p2.context().close()

const p3 = await openPage(browser, { t: '22:00' })
const h3 = (await p3.locator('body').innerText()).replace(/\s+/g, ' ')
t('B2 全部结束后 → 「今日安排已结束」', h3.includes('今日安排已结束'))
await p3.context().close()

/* ================= C/D. 周视图手势造冲突 ================= */
const page = await openPage(browser, { t: '07:00' })
await page.locator('nav button', { hasText: '周课表' }).click()
await page.waitForTimeout(600)

const cellBox = async (key) => {
  const box = await page.locator(`[data-cell="${key}"]`).boundingBox()
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null
}
const longPress = async (pt) => {
  await page.mouse.move(pt.x, pt.y)
  await page.mouse.down()
  await page.waitForTimeout(680)
  await page.mouse.up()
  await page.waitForTimeout(350)
}
const SHEET = '[data-sheet-add]'
const sheetText = async () => (await page.locator(SHEET).innerText()).replace(/\s+/g, ' ')

/* C：长按第 1 节（08:00 空）→ 选循环日程 → 默认 08:00-09:00，会盖到健身 08:40-09:10 */
const c1 = await cellBox(`${TODAY_WD}-0`)
t('C1 找到今天第 1 节的空格', !!c1, JSON.stringify(c1))
await longPress(c1)
await page.locator('[data-pick-routine]').click()
await page.waitForTimeout(400)
t('C2 长按菜单进的是循环日程表单', (await sheetText()).includes('循环日程'))
await page.fill(`${SHEET} input[placeholder^="日程名称"]`, '晨跑')
await page.locator(`${SHEET} button`, { hasText: /^添加日程$/ }).click()
await page.waitForTimeout(400)
const c3 = await sheetText()
t('C3 与已有日程冲突 → 出提示', c3.includes('时间冲突'), c3.slice(-70))
t('C4 提示点名了撞上的那条', c3.includes('健身'), c3.slice(-70))
t('C5 目标是循环日程时，提示不带「含循环日程」后缀（说的就是它自己这类）', !c3.includes('含循环日程'), c3.slice(-70))
await page.locator(`${SHEET} button`, { hasText: '取消' }).click()
await page.waitForTimeout(350)
const c6 = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('web2.data') || '{}')
  return (d.schedules || []).filter((s) => s.title === '晨跑').length
})
t('C6 取消后没落库（提示归提示，不强塞）', c6 === 0)

/* D：双击第 1 节 → 加课程（默认 08:00-08:45，撞健身 08:40-09:10） */
await page.locator(SHEET).waitFor({ state: 'detached', timeout: 3000 }).catch(() => {})
await page.waitForTimeout(300)
const c1b = await cellBox(`${TODAY_WD}-0`)
await page.mouse.dblclick(c1b.x, c1b.y)
await page.waitForTimeout(450)
t('D1 双击仍走加课程（不出菜单）', (await sheetText()).includes('添加课程'))
await page.fill(`${SHEET} input[placeholder^="课程名称"]`, '体育')
await page.locator(`${SHEET} button`, { hasText: /^添加$/ }).click()
await page.waitForTimeout(400)
const d2 = await sheetText()
t('D2 课程撞循环日程 → 提示带「（含循环日程）」', d2.includes('时间冲突') && d2.includes('含循环日程'), d2.slice(-80))
await page.locator(`${SHEET} button`, { hasText: /^添加$/ }).click()
await page.waitForTimeout(500)
/* 手动加的课程走 web2.added 叠加层（不是主表 —— 主表只装导入进来的那份） */
const d3 = await page.evaluate(() => {
  const arr = JSON.parse(localStorage.getItem('web2.added') || '[]')
  return arr.filter((s) => s.name === '体育').map((s) => s.type)
})
t('D3 再点一次放行，课程落库', d3.length === 1 && d3[0] === 'course', JSON.stringify(d3))
await page.context().close()

/* ================= E. 独立日程的冲突检测 ================= */
const p5 = await openPage(browser, { t: '07:00' })
await p5.locator('button', { hasText: '添加日程' }).click()
await p5.waitForTimeout(400)
await p5.fill('[data-sheet-evt] input[placeholder^="日程名称"]', '班会')
await p5.locator('[data-sheet-evt] button', { hasText: /^\s*添加\s*$/ }).click()
await p5.waitForTimeout(400)
const eTxt = (await p5.locator('[data-sheet-evt]').innerText()).replace(/\s+/g, ' ')
t('E1 独立日程（默认 18:00）撞上 18:00 的循环日程 → 出提示', eTxt.includes('时间冲突'), eTxt.slice(-80))
t('E2 提示点名「单周自习」', eTxt.includes('单周自习'), eTxt.slice(-80))
await p5.locator('[data-sheet-evt] button', { hasText: /^\s*添加\s*$/ }).click()
await p5.waitForTimeout(500)
const e3 = await p5.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('web2.data') || '{}')
  return (d.schedules || []).filter((s) => s.title === '班会').map((s) => s.type)
})
t('E3 再点一次放行，独立日程落库', e3.length === 1 && e3[0] === 'event', JSON.stringify(e3))

/* ================= F. 详情仍认循环日程 ================= */
await p5.reload({ waitUntil: 'domcontentloaded' })
await p5.waitForTimeout(700)
await p5.locator('[data-today-item][data-item-type="routine"]').first().click()
await p5.waitForTimeout(450)
const det = (await p5.locator('body').innerText()).replace(/\s+/g, ' ')
t('F1 点循环日程卡片 → 详情认出它是循环日程', det.includes('循环日程'), det.match(/.{0,20}循环日程.{0,20}/)?.[0] || '')
t('F2 详情给了编辑与删除', det.includes('编辑') && det.includes('删除'))
await p5.context().close()

await browser.close()

const failed = results.filter((r) => !r[1]).length
console.log('\n结果：' + (results.length - failed) + ' 通过 / ' + failed + ' 失败')
process.exit(failed ? 1 : 0)
