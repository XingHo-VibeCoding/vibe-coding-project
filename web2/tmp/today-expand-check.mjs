/* today-expand-check —— Stage 4：D↔F 两种密度
   ① 默认（D）：已过压成一行「已过 N 件 · 首–末」，接下来最多 3 行，其余进「展开全部」；
   ② 点「已过 N 件」→ 就地展开那些行（条数/顺序/灰字都对），再点收起；
   ③ 点「展开全部」→ 就地换成 26px 全天表（一条不少、行高不变、折叠行消失），再点收起回 D。
   全篇只读 DOM 与几何，不做视觉判断（视觉在 tmp/stage4-*.png）。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const TODAY_WD = ((new Date().getDay() + 6) % 7) + 1
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date()
monday.setDate(monday.getDate() - (TODAY_WD - 1))

const course = (id, title, start, duration, extra = {}) => ({
  id, type: 'course', semester_id: 'sem1', title, location: `教三 ${id}`, teacher: '张明',
  weekday: TODAY_WD, start_time: start, duration, week_rule: 'every', ...extra,
})
/* 5 件：07:00–07:40 已过 / 08:00–09:40 已过 / 10:00–12:25 进行中 / 14:00 未来 / 19:00 未来 */
const FIVE = [
  course('c1', '晨读', '07:00', 40),
  course('c2', '高等数学', '08:00', 100),
  course('c3', '大学英语', '10:00', 145),
  course('c4', '线性代数', '14:00', 100),
  course('c5', '晚自习', '19:00', 90, { type: 'routine' }),
]
const doc = (schedules) => ({
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: iso(monday), total_weeks: 18 },
  schedules, todos: [],
})

let pass = 0
let fail = 0
const t = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? '  → ' + extra : ''}`)
  ok ? pass++ : fail++
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

async function open(t2, schedules) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message)))
  await page.addInitScript(([d]) => {
    localStorage.setItem('web2.data', JSON.stringify(d))
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.theme', '"light"')
  }, [doc(schedules)])
  await page.goto(`${BASE}/?t=${t2}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  return { ctx, page, errs }
}

/* 读「接下来」里的行（含折叠行与展开行） */
const SNAP = () => {
  const sec = [...document.querySelectorAll('[data-page="today"] section')].find((s) =>
    /^接下来/.test(s.innerText.trim()),
  )
  const rows = [...sec.querySelectorAll('[data-row], [data-today-past-fold], [data-today-expand]')].map((el) => ({
    fold: el.hasAttribute('data-today-past-fold'),
    expand: el.hasAttribute('data-today-expand'),
    past: el.hasAttribute('data-today-past-row'),
    time: el.querySelector('[data-row-time]')?.textContent?.trim() || '',
    text: el.innerText.replace(/\s+/g, ' ').trim(),
    h: Math.round(el.getBoundingClientRect().height),
  }))
  return { rows, items: sec.querySelectorAll('[data-today-item]').length, past: sec.querySelectorAll('[data-today-past-row]').length }
}

/* ================= A. 5 件（2 已过）：默认 D ================= */
const A = await open('11:30', FIVE)
let s = await A.page.evaluate(SNAP)
const fold = s.rows.find((r) => r.fold)
const expand = s.rows.find((r) => r.expand)
t('A1 默认出现「已过 N 件」一行', !!fold && /已过/.test(fold.text) && /2 件/.test(fold.text), fold && fold.text)
t('A2 已过那行带时间跨度（07:00–09:40）', !!fold && fold.text.includes('07:00–09:40'), fold && fold.text)
t('A3 默认不渲染已过的明细（只渲染接下来 3 条）', s.past === 0 && s.items === 3, `past=${s.past} items=${s.items}`)
t('A4 默认有「展开全部 · 共 5 件」', !!expand && /展开全部/.test(expand.text) && /5 件/.test(expand.text), expand && expand.text)
t('A5 折叠行与展开行也都是 26px（换密度不改行高）', !!fold && !!expand && fold.h === 26 && expand.h === 26, `${fold && fold.h}/${expand && expand.h}`)
t('A6 默认可见行里没有已过条目', !s.rows.some((r) => !r.fold && !r.expand && r.past), JSON.stringify(s.rows.map((r) => r.time)))

/* ================= B. 点「已过 2 件」→ 就地展开 ================= */
await A.page.click('[data-today-past-fold]')
await A.page.waitForTimeout(300)
s = await A.page.evaluate(SNAP)
const times = s.rows.filter((r) => !r.fold && !r.expand).map((r) => r.time)
t('B1 已过明细就地展开（2 条），折叠行仍在并变成「收起」', s.past === 2 && s.items === 5 && /收起/.test(s.rows.find((r) => r.fold).text), JSON.stringify(times))
t('B2 展开后顺序仍是时间序（07:00 08:00 10:00 14:00 19:00）', times.join(',') === '07:00,08:00,10:00,14:00,19:00', times.join(','))
const pastColors = await A.page.evaluate(() =>
  [...document.querySelectorAll('[data-today-past-row]')].map((el) => getComputedStyle(el).color),
)
t('B3 已过明细是整行实色灰（rgb(98, 107, 125)）', pastColors.length === 2 && pastColors.every((c) => c === 'rgb(98, 107, 125)'), pastColors.join(' / '))
await A.page.click('[data-today-past-fold]')
await A.page.waitForTimeout(250)
s = await A.page.evaluate(SNAP)
t('B4 再点一下收起回 D 形态', s.past === 0 && s.items === 3, `past=${s.past} items=${s.items}`)

/* ================= C. 点「展开全部」→ F 全天表 ================= */
await A.page.click('[data-today-expand]')
await A.page.waitForTimeout(300)
s = await A.page.evaluate(SNAP)
const allTimes = s.rows.filter((r) => !r.fold && !r.expand).map((r) => r.time)
t('C1 展开后一条不少（5 条全在）', s.items === 5 && s.past === 2, `items=${s.items} past=${s.past}`)
t('C2 展开后没有「已过 N 件」折叠行了', !s.rows.some((r) => r.fold), JSON.stringify(s.rows.map((r) => r.text)))
t('C3 展开后按钮变「收起 / 只看接下来」', /收起/.test(s.rows.find((r) => r.expand).text) && /只看接下来/.test(s.rows.find((r) => r.expand).text), s.rows.find((r) => r.expand).text)
t('C4 全天表也是时间序，且每行仍是 26px', allTimes.join(',') === '07:00,08:00,10:00,14:00,19:00' && s.rows.every((r) => r.h === 26), `${allTimes.join(',')} h=${s.rows.map((r) => r.h).join('/')}`)
await A.page.click('[data-today-expand]')
await A.page.waitForTimeout(250)
s = await A.page.evaluate(SNAP)
t('C5 收起回 D 形态（已过一行 + 接下来 3 条）', s.items === 3 && s.past === 0 && !!s.rows.find((r) => r.fold), JSON.stringify(s.rows.map((r) => r.text)))
t('C6 全程无 pageerror', A.errs.length === 0, A.errs.join(' | '))
await A.ctx.close()

/* ================= D. 3 件且无已过：不该出现折叠行与展开行 ================= */
const D = await open('07:30', FIVE.slice(1, 4))
s = await D.page.evaluate(SNAP)
t('D1 没有已过条目时不出现「已过 N 件」', !s.rows.some((r) => r.fold), JSON.stringify(s.rows.map((r) => r.text)))
t('D2 没有多余内容时不出现「展开全部」（3 条刚好放得下）', !s.rows.some((r) => r.expand) && s.items === 3, `items=${s.items}`)
t('D3 该页面无报错', D.errs.length === 0, D.errs.join(' | '))
await D.ctx.close()

/* ================= E. 6 件（不折叠也放不下）：默认 3 条 + 展开行 ================= */
const E = await open('11:30', [...FIVE, course('c6', '体育', '16:00', 45)])
s = await E.page.evaluate(SNAP)
t('E1 未来条目多于 3 条时，默认只留 3 条', s.items === 3, `items=${s.items}`)
t('E2 展开行报出总条数 6', /6 件/.test(s.rows.find((r) => r.expand).text), s.rows.find((r) => r.expand).text)
await E.page.click('[data-today-expand]')
await E.page.waitForTimeout(300)
s = await E.page.evaluate(SNAP)
t('E3 展开后 6 条全在', s.items === 6 && s.past === 2, `items=${s.items} past=${s.past}`)
t('E4 无报错', E.errs.length === 0, E.errs.join(' | '))
await E.ctx.close()

await browser.close()
console.log(`\n=== 今天页 D↔F 密度切换：${pass} 项通过 / ${fail} 项失败 ===`)
process.exit(fail ? 1 : 0)
