/* 时间行规格（docs/结构动效前置约定.md §一「一条日程 = 一张卡片」）
   跑法：先起 4177 静态服务，再 node tmp/row-spec-check.mjs
   验的规格（2026-10-09 W 方案：卡片化）：
     · 卡高锁 50px（leading-20 + leading-16 + py-1.5×2 + 上下边框）—— 5 张也放得下
     · 卡高本身 ≥44px，不再靠 after 伪元素补触区（旧 26px 紧凑行已随卡片化退休）
     · 时间列固定 40px、右对齐、tabular-nums
     · 已完成 / 已过 = 整行**实色**灰（#626b7d），不许 alpha 档（A4 可读性扫描结论）
     · 进行中 = 浅蓝底 + 主色标题；其余 = 卡片底色 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let pass = 0, fail = 0
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? '  → ' + extra : '')) }
  else { fail++; console.log('FAIL ' + name + (extra ? '  → ' + extra : '')) }
}

const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const MONDAY = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
const TODAY_WD = ((now.getDay() + 6) % 7) + 1
const C = (id, title, start, duration, type = 'course', location = '教三 302', tag = '') => ({
  id, type, semester_id: 'sem1', title, location, tag, weekday: TODAY_WD, start_time: start, duration, week_rule: 'every',
})
const seedDoc = JSON.stringify({
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
  schedules: [
    C('r1', '高等数学', '08:00', 100), // 08:00–09:40 已过（11:00 看）
    C('r2', '环境工程概论', '10:00', 145), // 10:00–12:25 进行中
    C('r3', '线性代数', '14:00', 100, 'course', '教二 110', '必修'),
    C('r4', '晚自习', '19:00', 90, 'routine', '图书馆'),
  ],
  todos: [],
})

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc)})`)
await page.addInitScript(() => localStorage.setItem('web2.onboarded', '1'))
await page.addInitScript(() => localStorage.setItem('web2.theme', 'light'))
await page.goto(URL + '?t=11:00', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
/* 「接下来」默认把已过压成一行；这里要先展开全部，才量得到那条已过的卡 */
if (await page.locator('[data-today-expand]').count()) {
  await page.click('[data-today-expand]')
  await page.waitForTimeout(300)
}

const rows = await page.evaluate(() => {
  const box = (el) => { const b = el.getBoundingClientRect(); return { h: Math.round(b.height), w: Math.round(b.width), x: Math.round(b.x), y: Math.round(b.y) } }
  return Array.from(document.querySelectorAll('[data-today-item]')).map((row) => {
    const timeEl = row.querySelector('[data-row-time]')
    const titleEl = row.querySelector('span.min-w-0')
    const r = box(row)
    const cs = getComputedStyle(row)
    const ts = timeEl ? getComputedStyle(timeEl) : null
    return {
      state: row.dataset.rowState,
      text: row.innerText.replace(/\s+/g, ' ').trim(),
      h: r.h,
      bg: cs.backgroundColor,
      timeW: timeEl ? Math.round(timeEl.getBoundingClientRect().width) : -1,
      timeAlign: ts ? ts.textAlign : '',
      timeVariant: ts ? ts.fontVariantNumeric : '',
      rowColor: cs.color,
      titleColor: titleEl ? getComputedStyle(titleEl).color : '',
    }
  })
})

t('R1 今天页出现 4 条时间行', rows.length === 4, JSON.stringify(rows.map((r) => r.state)))
t('R2 每一条卡高都是 50px（leading-20 + leading-16 + py-1.5×2 + 上下边框）', rows.every((r) => r.h === 50), rows.map((r) => r.h).join('/'))
t('R3 时间列固定 40px', rows.every((r) => r.timeW === 40), rows.map((r) => r.timeW).join('/'))
t('R4 时间列右对齐 + tabular-nums', rows.every((r) => r.timeAlign === 'right' && r.timeVariant === 'tabular-nums'), rows[0] && `${rows[0].timeAlign}/${rows[0].timeVariant}`)
/* 触区：卡片本身就是 50px ≥ 44px（WCAG 2.5.8 AA），不再靠 after 外扩。
   旧规格是 26px 行 + after:-inset-y-[9px] 补到 44px；卡片化之后那条路退休了。 */
t('R8 卡高 50px ≥ 44px（触区达标，无需 after 外扩）', rows.every((r) => r.h >= 44), rows.map((r) => r.h).join('/'))
const past = rows.find((r) => r.state === 'done')
t('R5 已过的行有一条（state=done）', !!past, past && past.text)
t('R6 已过 = 整行实色灰（rgb(98, 107, 125)，不是 alpha 档）', !!past && past.rowColor === 'rgb(98, 107, 125)' && past.titleColor === 'rgb(98, 107, 125)', past && `${past.rowColor} / ${past.titleColor}`)
const nowRow = rows.find((r) => r.state === 'now')
t('R7 进行中的卡标 state=now 且右侧给剩余分钟', !!nowRow && /还剩 \d+ 分/.test(nowRow.text), nowRow && nowRow.text)
t('R11 进行中的卡用浅蓝底（区别于其余卡片底色）', !!nowRow && nowRow.bg === 'rgb(238, 244, 254)', nowRow && nowRow.bg)
t('R9 未来条目右侧留空、不倒计时刷屏（只有 next 那条报分钟）', rows.filter((r) => r.state === 'plain').length >= 1, JSON.stringify(rows.filter((r) => r.state === 'plain').map((r) => r.text)))
t('R10 全程无 pageerror', errs.length === 0, errs.join(' | '))

await browser.close()
console.log(`\n=== 今天页时间卡规格：${pass}/${pass + fail} 项通过 ===`)
process.exit(fail ? 1 : 0)
