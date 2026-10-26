/* bug 06：剩余时间不再一律按分钟报（2026-10-23 用户报「会出现几百分钟，看着很奇怪」）
   验四件事：
     ① 还剩 2 小时 30 分（不再写「还剩 150 分」）
     ② 不到一小时仍是「还剩 45 分」（不硬转小时）
     ③ 下一节倒计时同样换算（「1 小时 50 分后开始」）
     ④ 整点小时的写法是「2 小时」不是「2 小时 0 分」
   跑法：先起 dist 静态服务（4177）再 node tmp/duration-text-check.mjs */
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
const TODAY_WD = now.getDay() === 0 ? 7 : now.getDay() // 1=周一 … 7=周日

function doc(courses) {
  return JSON.stringify({
    app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
    semester: { id: 'sem1', name: '测试学期', first_monday: iso(mon), total_weeks: 16 },
    schedules: courses, todos: [],
  })
}
function course(id, title, start, dur) {
  return { id, type: 'course', title, location: '教1-101', weekday: TODAY_WD, start_time: start, duration: dur, week_rule: 'every', semester_id: 'sem1' }
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-gpu'],
})

async function open(t, courses) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.route('**/*', (r) => (r.request().url().includes('cdn.jsdelivr.net') ? r.abort() : r.continue()))
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(doc(courses))})`)
  await page.addInitScript("localStorage.setItem('web2.onboarded', '1')")
  await page.addInitScript("localStorage.setItem('web2.theme', '\"light\"')")
  await page.goto(URL + '?t=' + t, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  return { ctx, page, errs }
}

/* A. 进行中：14:00–16:40，?t=14:10 ⇒ 还剩 150 分 = 2 小时 30 分 */
console.log('\n--- A 还剩超过一小时 ---')
{
  const { ctx, page, errs } = await open('14:10', [course('c1', '结构力学', '14:00', 160)])
  const hero = await page.locator('[data-today-now]').first().innerText().catch(() => '')
  t('A1 顶卡副行写「2 小时 30 分」', /2 小时 30 分/.test(hero), hero.replace(/\n/g, ' / ').slice(0, 120))
  t('A2 不再出现「150 分钟」这种写法', !/150 分钟|150 分/.test(hero), '')
  const meta = await page.locator('[data-row-meta]').first().innerText().catch(() => '')
  t('A3 行尾状态同样换算', /2 小时 30 分/.test(meta), meta)
  t('A4 无 pageerror', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

/* B. 进行中：不到一小时 ⇒ 保持「45 分」 */
console.log('\n--- B 不到一小时 ---')
{
  const { ctx, page } = await open('10:00', [course('c2', '线性代数', '09:40', 65)])
  const hero = await page.locator('[data-today-now]').first().innerText().catch(() => '')
  t('B1 剩 45 分就写「45 分」（不硬转小时）', /还剩 45 分/.test(hero), hero.replace(/\n/g, ' / ').slice(0, 110))
  await ctx.close()
}

/* C. 下一节：现在 08:00，下一节 09:50 ⇒ 1 小时 50 分后开始 */
console.log('\n--- C 下一节倒计时 ---')
{
  const { ctx, page } = await open('08:00', [course('c3', '大学物理', '09:50', 45)])
  const hero = await page.locator('[data-today-now]').first().innerText().catch(() => '')
  t('C1 下一节说「1 小时 50 分后开始」', /1 小时 50 分后开始/.test(hero), hero.replace(/\n/g, ' / ').slice(0, 120))
  await ctx.close()
}

/* D. 整点：剩 120 分 ⇒ 「2 小时」，不能冒出「2 小时 0 分」 */
console.log('\n--- D 整点 ---')
{
  const { ctx, page } = await open('12:00', [course('c4', '工程制图', '12:00', 120)])
  const hero = await page.locator('[data-today-now]').first().innerText().catch(() => '')
  t('D1 整点写「2 小时」不写「2 小时 0 分」', /2 小时(?! 0 分)/.test(hero) && !/0 分/.test(hero), hero.replace(/\n/g, ' / ').slice(0, 120))
  await ctx.close()
}

await browser.close()
const pass = results.filter((r) => r[1]).length
const fail = results.length - pass
console.log(`\n=== 剩余时间口径：${pass}/${results.length} 通过，${fail} 挂 ===`)
process.exit(fail ? 1 : 0)
