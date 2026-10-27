/* today-fold-check —— 「接下来」折叠态（2026-10-27 用户 m00452 定稿，取代旧的 today-expand-check）
   口径变了：D↔F 双密度取消，「全部」那一行删掉，折叠态固定「已过一行 + 接下来最多 3 条」。
   本脚本只认现在这套：
     A 默认：只有一行「已过 N 件 ▾」（没有时段、没有「展开/收起」字样），没有「全部」按钮，
       接下来最多 3 条，第 4 条以后一个入口都没有；
     B 点开：就地拉出已过明细（条数 / 时间序 / 整行灰字），箭头翻转，再点收起；
     C 今天没有已过条目时不出现这一行；
     D 今天全过完时接「之后」那一行，文案是短的（「之后 明天 10/28」），不折行；
     E 添加日程与添加待办两个按钮同高同字号（同一轮用户要求「大小和文字大小统一」）。
   全篇只读 DOM 与几何，不做视觉判断（截图在 tmp/day35-*.png）。 */
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

const SNAP = () => {
  const sec = [...document.querySelectorAll('[data-page="today"] section')].find((s) =>
    /^接下来/.test(s.innerText.trim()),
  )
  const fold = sec.querySelector('[data-today-past-fold]')
  const caret = sec.querySelector('[data-today-past-caret]')
  const nextday = sec.querySelector('[data-today-nextday]')
  const rows = [...sec.querySelectorAll('[data-row]')].map((el) => ({
    past: el.hasAttribute('data-today-past-row'),
    time: el.querySelector('[data-row-time]')?.textContent?.trim() || '',
    h: Math.round(el.getBoundingClientRect().height),
  }))
  return {
    rows,
    items: sec.querySelectorAll('[data-today-item]').length,
    past: sec.querySelectorAll('[data-today-past-row]').length,
    hasExpand: !!sec.querySelector('[data-today-expand]'),
    foldText: fold ? fold.innerText.replace(/\s+/g, ' ').trim() : null,
    foldH: fold ? Math.round(fold.getBoundingClientRect().height) : 0,
    caret: caret ? getComputedStyle(caret).transform : null,
    caretRotate: caret ? getComputedStyle(caret).rotate : null,
    nextdayText: nextday ? nextday.innerText.replace(/\s+/g, ' ').trim() : null,
  }
}
/* 转了没有？（Tailwind v4 的 rotate-180 落在 CSS 的 rotate 属性上，v3 才是 transform: matrix，
   所以两个都要认，否则 v4 下这条断言会假红） */
const rotated = (m, r) => {
  if (r && r !== 'none') return Math.abs(Math.abs(parseFloat(r)) - 180) < 1
  if (!m || m === 'none') return false
  const a = Number((m.match(/matrix\(([^)]+)\)/) || [, ''])[1].split(',')[0])
  return a < -0.5 // matrix(a,b,c,d,…) 的 a ≈ -1
}

/* ================= A. 5 件（2 已过）→ 折叠态 ================= */
const A = await open('11:30', FIVE)
let s = await A.page.evaluate(SNAP)
t('A1 有一行「已过 2 件」', s.foldText !== null && /^已过 2 件/.test(s.foldText), s.foldText)
t('A2 那一行只剩件数和箭头（没有时段、没有「展开/收起」字样）',
  !!s.foldText && !s.foldText.includes('·') && !/展开|收起|全部/.test(s.foldText), s.foldText)
t('A3 「全部」那一行已删（页面上没有 data-today-expand）', s.hasExpand === false, `hasExpand=${s.hasExpand}`)
t('A4 折叠态只渲染接下来 3 条（已过明细整块不挂载）', s.items === 3 && s.past === 0, `items=${s.items} past=${s.past}`)
t('A5 那一行是 26px 控制行（不是卡片）', s.foldH === 26, `h=${s.foldH}`)
t('A6 那一行带一枚箭头（收起时不旋转）', s.caret !== null && !rotated(s.caret, s.caretRotate), `transform=${s.caret} rotate=${s.caretRotate}`)

/* 用户同一轮要求「添加日程按钮大小和文字大小跟下面添加待办统一」 */
const btn = await A.page.evaluate(() => {
  const pick = (txt) =>
    [...document.querySelectorAll('[data-page="today"] button')].find((b) => b.innerText.replace(/\s+/g, '').includes(txt)) || null
  const info = (el) => {
    if (!el) return null
    const cs = getComputedStyle(el)
    return { h: Math.round(el.getBoundingClientRect().height), fs: cs.fontSize, py: cs.paddingTop }
  }
  return { add: info(pick('添加日程')), todo: info(pick('添加待办')) }
})
t(
  'A7 添加日程与添加待办两个按钮同高、同字号、同内边距',
  !!btn.add && !!btn.todo && btn.add.h === btn.todo.h && btn.add.fs === btn.todo.fs && btn.add.py === btn.todo.py,
  `日程 ${JSON.stringify(btn.add)} / 待办 ${JSON.stringify(btn.todo)}`,
)

/* ================= B. 点开 → 就地拉出已过明细 ================= */
await A.page.click('[data-today-past-fold]')
await A.page.waitForTimeout(450)
s = await A.page.evaluate(SNAP)
t('B1 已过明细就地拉出来（2 条），接下来 3 条没动', s.past === 2 && s.items === 5, `items=${s.items} past=${s.past}`)
const times = s.rows.map((r) => r.time)
t('B2 拉出来后仍是时间序（07:00 08:00 10:00 14:00 19:00）',
  times.join(',') === '07:00,08:00,10:00,14:00,19:00', times.join(','))
const pastColors = await A.page.evaluate(() =>
  [...document.querySelectorAll('[data-today-past-row]')].map((el) => getComputedStyle(el).color),
)
t('B3 已过明细是整行实色灰（rgb(98, 107, 125)）',
  pastColors.length === 2 && pastColors.every((c) => c === 'rgb(98, 107, 125)'), pastColors.join(' / '))
t('B4 点开后那一行文字不变（箭头翻转表示状态，不用改字）', /^已过 2 件/.test(s.foldText || ''), s.foldText)
t('B5 点开后箭头翻过来（rotate 180°）', rotated(s.caret, s.caretRotate), `transform=${s.caret} rotate=${s.caretRotate}`)
await A.page.click('[data-today-past-fold]')
await A.page.waitForTimeout(400)
s = await A.page.evaluate(SNAP)
t('B6 再点一下收回去（明细消失、箭头转回来）',
  s.past === 0 && s.items === 3 && !rotated(s.caret, s.caretRotate), `past=${s.past} items=${s.items} rotate=${s.caretRotate}`)
t('B7 全程无 pageerror', A.errs.length === 0, A.errs.join(' | '))
await A.ctx.close()

/* ================= C. 3 件且无已过：这一行不该出现 ================= */
const C = await open('07:30', FIVE.slice(1, 4))
s = await C.page.evaluate(SNAP)
t('C1 今天没有已过条目时不出现「已过 N 件」', s.foldText === null && s.items === 3, `items=${s.items}`)
t('C2 无报错', C.errs.length === 0, C.errs.join(' | '))
await C.ctx.close()

/* ================= D. 6 件：多出来的没有入口 ================= */
const D = await open('11:30', [...FIVE, course('c6', '体育', '16:00', 45)])
s = await D.page.evaluate(SNAP)
t('D1 未来条目多于 3 条时仍然只留 3 条（没有「全部」可以点开）',
  s.items === 3 && s.hasExpand === false, `items=${s.items} hasExpand=${s.hasExpand}`)
t('D2 已过那一行照样在、写着件数', /^已过 2 件/.test(s.foldText || ''), s.foldText)
t('D3 无报错', D.errs.length === 0, D.errs.join(' | '))
await D.ctx.close()

/* ================= E. 今天全过完 → 「之后」那一行用的短文案 ================= */
const tomorrowWd = TODAY_WD === 7 ? 1 : TODAY_WD + 1
const E = await open('23:00', [...FIVE, course('c7', '明天的课', '09:00', 100, { weekday: tomorrowWd })])
s = await E.page.evaluate(SNAP)
t('E1 今天过完时接上「之后」那一行', s.nextdayText !== null, String(s.nextdayText))
t('E2 文案是短的「之后 明天 10/28」这种（不再写「明天 · 10 月 28 日 周二」）',
  !!s.nextdayText && /^之后 (明天|后天) \d{1,2}\/\d{1,2}$/.test(s.nextdayText) && !s.nextdayText.includes('月'),
  String(s.nextdayText))
t('E3 那一行只有一段文字（原来的 40px 时间列已去掉）',
  await E.page.evaluate(() => {
    const el = document.querySelector('[data-today-nextday]')
    return !!el && el.children.length <= 2
  }),
)
t('E4 无报错', E.errs.length === 0, E.errs.join(' | '))
await E.ctx.close()

await browser.close()
console.log(`\n=== 「接下来」折叠态：${pass} 项通过 / ${fail} 项失败 ===`)
process.exit(fail ? 1 : 0)
