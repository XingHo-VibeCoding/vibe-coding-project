/* fold-anim-check —— 「已过 N 件」点开的向下拉开动画（动效 1d，2026-10-27 用户 m00452）
   取代旧的 density-fade-check（D↔F 交叉淡入已随「全部」那一行一起删掉）。
   断言的是「真的一条高度动画，不是瞬移」：
     A 拉开过程中确实抓到 0 < 高度 < 终态 的中间帧，且高度单调变大；
     B 拉完清掉 inline 高度（不留死数字，将来行数变了也不会卡在旧高度）；
     C 收起时反向：中间帧存在、高度单调变小、结束后明细整块从 DOM 消失；
     D 箭头在两个状态下角度不同；E 全程无 pageerror。
   跑法：先起 dist 静态服务（默认 4177）
   产物：tmp/fold-anim-open.png / -closed.png */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const OUT = 'tmp'
mkdirSync(OUT, { recursive: true })
const TODAY_WD = ((new Date().getDay() + 6) % 7) + 1
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date()
monday.setDate(monday.getDate() - (TODAY_WD - 1))
const course = (id, title, start, duration, extra = {}) => ({
  id, type: 'course', semester_id: 'sem1', title, location: `教三 ${id}`, teacher: '张明',
  weekday: TODAY_WD, start_time: start, duration, week_rule: 'every', ...extra,
})
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e.message)))
await page.addInitScript(([d]) => {
  localStorage.setItem('web2.data', JSON.stringify(d))
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', '"light"')
}, [doc(FIVE)])
/* 冻结 11:30：早上两节已过、后面还有三节 —— 折叠行存在，明细两条，高度变化一眼能量出来。 */
await page.goto(`${BASE}/?t=11:30`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

const section = page.locator('[data-page="today"] section').first()
/* 用页面里的 requestAnimationFrame 连采（而不是按固定毫秒抓几个点）：
   机器一忙，固定采样点会全部落在动画开始前或结束之后，误判成「没有中间帧」。
   采样器先起跑再点击，动画从第几帧开始都能抓到。 */
const sampler = (ms) => page.evaluate((dur) => new Promise((resolve) => {
  const out = []
  const t0 = performance.now()
  const step = () => {
    const el = document.querySelector('[data-today-past-body]')
    out.push({ t: Math.round(performance.now() - t0), h: el ? el.getBoundingClientRect().height : 0 })
    if (performance.now() - t0 < dur) requestAnimationFrame(step)
    else resolve(out)
  }
  requestAnimationFrame(step)
}), ms)

if ((await page.locator('[data-today-past-fold]').count()) === 0) {
  console.log('SKIP | 今天没有已过条目（折叠行不出现），换个有课的日子再跑')
  await browser.close()
  process.exit(0)
}

/* ---------- 拉开 ---------- */
await section.screenshot({ path: `${OUT}/fold-anim-closed.png` })
/* 采样器**先起跑、不 await**：await 了它就会先把 600ms 采完再点，采到的全是点之前的 0。 */
const openSamplesP = sampler(600)
await page.locator('[data-today-past-fold]').click()
const opened = await openSamplesP
const finalH = Math.max(...opened.map((s) => s.h))
const midOpen = opened.filter((s) => s.h > 0.5 && s.h < finalH - 0.5)
t('A1 拉开过程中抓到中间帧（是真的在动，不是瞬移）', midOpen.length >= 2,
  midOpen.slice(0, 4).map((s) => `${s.t}ms=${s.h.toFixed(1)}px`).join(' ')
  || `终态 ${finalH.toFixed(1)}px，中间帧 0 个`)
const openHs = opened.map((s) => s.h)
const openMono = openHs.every((h, i) => i === 0 || h >= openHs[i - 1] - 0.5)
t('A2 拉开是单调长高的（没有先跳满再回落）', openMono, openHs.filter((h, i) => i === 0 || h !== openHs[i - 1]).map((h) => h.toFixed(1)).join(' → '))
await page.waitForTimeout(500) // 等 280ms 过渡真正走完再量终态，否则量到的是过渡中间帧
const pastRows = await page.locator('[data-today-past-row]').count()
t('A3 拉完后明细整块高度 > 0 且两条已过行都在', finalH > 10 && pastRows === 2,
  `终态 h=${finalH.toFixed(1)}px，明细 ${pastRows} 条`)
const inlineClear = await page.evaluate(() => {
  const el = document.querySelector('[data-today-past-body]')
  return el ? { h: el.style.height, of: el.style.overflow, tr: el.style.transition } : null
})
t('A4 拉完清掉 inline 高度/溢出/过渡（行数将来变了也不会卡在旧高度）',
  !!inlineClear && inlineClear.h === '' && inlineClear.of === '' && inlineClear.tr === '',
  JSON.stringify(inlineClear))
/* 括号里的 rotate 与 transform 都要认：Tailwind v4 的 rotate-180 写的是 rotate 属性 */
const caretOf = () => page.evaluate(() => {
  const el = document.querySelector('[data-today-past-caret]')
  if (!el) return null
  const cs = getComputedStyle(el)
  return { transform: cs.transform, rotate: cs.rotate }
})
const rotated = (c) => {
  if (!c) return false
  if (c.rotate && c.rotate !== 'none') return Math.abs(Math.abs(parseFloat(c.rotate)) - 180) < 1
  return c.transform !== 'none' && Number((c.transform.match(/matrix\(([^)]+)\)/) || [, ''])[1].split(',')[0]) < -0.5
}
const caretOpen = await caretOf()
t('D1 打开后箭头翻过来了', rotated(caretOpen), JSON.stringify(caretOpen))
await section.screenshot({ path: `${OUT}/fold-anim-open.png` })

/* ---------- 收起 ---------- */
const closeSamplesP = sampler(600)
await page.locator('[data-today-past-fold]').click()
const closed = await closeSamplesP
const startH = Math.max(...closed.map((s) => s.h))
const midClose = closed.filter((s) => s.h > 0.5 && s.h < startH - 0.5)
t('C1 收起过程中抓到中间帧', midClose.length >= 2,
  midClose.slice(0, 4).map((s) => `${s.t}ms=${s.h.toFixed(1)}px`).join(' ')
  || `起点 ${startH.toFixed(1)}px，中间帧 0 个`)
const closeHs = closed.map((s) => s.h)
t('C2 收起是单调变矮的', closeHs.every((h, i) => i === 0 || h <= closeHs[i - 1] + 0.5),
  closeHs.filter((h, i) => i === 0 || h !== closeHs[i - 1]).map((h) => h.toFixed(1)).join(' → '))
await page.waitForTimeout(300)
const after = await page.evaluate(() => ({
  body: !!document.querySelector('[data-today-past-body]'),
  past: document.querySelectorAll('[data-today-past-row]').length,
  items: document.querySelectorAll('[data-today-item]').length,
  caret: (() => {
    const el = document.querySelector('[data-today-past-caret]')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { transform: cs.transform, rotate: cs.rotate }
  })(),
}))
t('C3 收完明细整块从 DOM 消失（不是留个 0 高度空壳）', after.body === false && after.past === 0 && after.items === 3,
  `body=${after.body} past=${after.past} items=${after.items}`)
t('D2 收起后箭头转回来', !rotated(after.caret), JSON.stringify(after.caret))
t('E1 全程无 pageerror', errs.length === 0, errs.slice(0, 2).join(' | '))

await browser.close()
console.log(`\n=== 已过明细下拉动画：${pass} 项通过 / ${fail} 项失败 ===`)
process.exit(fail ? 1 : 0)
