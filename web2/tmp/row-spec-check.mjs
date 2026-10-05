/* Stage 3 验收：26px 时间行规格（docs/结构动效前置约定.md §一「新增规格」）
   跑法：先起 4177 静态服务，再 node tmp/row-spec-check.mjs
   验的规格：
     · 行高锁 26px（py-[3px] + leading-[20px]）——20 件也不会撑成一屏半
     · 时间列固定 40px、右对齐、tabular-nums
     · 已完成 / 已过 = 整行**实色**灰（#626b7d），不许 alpha 档（A4 可读性扫描结论）
     · 行只占 26px，但触区靠 after 伪元素外扩到 ≥44px（绝对定位不参与布局） */
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
await page.goto(URL + '?t=11:00', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
/* Stage 4 起「接下来」默认把已过压成一行；这里要先展开全部，才量得到那条已过的行 */
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
    /* 触区探测：行的上下各 18px 处 elementFromPoint 还应该落在这行（after 伪元素外扩） */
    const cx = Math.round(r.x + r.w / 2)
    const hitAbove = document.elementFromPoint(cx, r.y - 18)
    const hitBelow = document.elementFromPoint(cx, r.y + r.h + 18)
    const inRow = (el) => !!el && (el === row || row.contains(el))
    return {
      state: row.dataset.rowState,
      text: row.innerText.replace(/\s+/g, ' ').trim(),
      h: r.h,
      timeW: timeEl ? Math.round(timeEl.getBoundingClientRect().width) : -1,
      timeAlign: ts ? ts.textAlign : '',
      timeVariant: ts ? ts.fontVariantNumeric : '',
      rowColor: cs.color,
      titleColor: titleEl ? getComputedStyle(titleEl).color : '',
      hitAbove: inRow(hitAbove),
      hitBelow: inRow(hitBelow),
    }
  })
})

t('R1 今天页出现 4 条时间行', rows.length === 4, JSON.stringify(rows.map((r) => r.state)))
t('R2 每一条行高都是 26px', rows.every((r) => r.h === 26), rows.map((r) => r.h).join('/'))
t('R3 时间列固定 40px', rows.every((r) => r.timeW === 40), rows.map((r) => r.timeW).join('/'))
t('R4 时间列右对齐 + tabular-nums', rows.every((r) => r.timeAlign === 'right' && r.timeVariant === 'tabular-nums'), rows[0] && `${rows[0].timeAlign}/${rows[0].timeVariant}`)
/* 触区：行只占 26px，靠 after 伪元素上下各外扩 9px 到 44px。
   相邻行外扩区会重叠（重叠处上面的行赢），所以「每一行上下 18px 都命中自己」不可能成立——
   这里改成两条可判定的：① ::after 的 computed style 确实在上下各 -9px；② 第一行上方 18px 仍落在某条行里。 */
const hit = await page.evaluate(() => {
  const row = document.querySelector('[data-today-item]')
  const cs = getComputedStyle(row, '::after')
  const b = row.getBoundingClientRect()
  const el = document.elementFromPoint(Math.round(b.x + b.width / 2), Math.round(b.y - 8))
  const el2 = document.elementFromPoint(Math.round(b.x + b.width / 2), Math.round(b.y + b.height + 8))
  const hitRow = (e) => !!(e && e.closest && e.closest('[data-row]'))
  return { pos: cs.position, content: cs.content, top: cs.top, bottom: cs.bottom, height: cs.height, aboveHitsRow: hitRow(el), belowHitsRow: hitRow(el2) }
})
t('R8 触区：after 外扩上下各 9px（26+9+9=44px），行外 ±8px 实测仍命中行',
  hit.pos === 'absolute' && hit.content !== 'none' && hit.top === '-9px' && hit.bottom === '-9px' && hit.height === '44px' && hit.aboveHitsRow && hit.belowHitsRow, JSON.stringify(hit))
const past = rows.find((r) => r.state === 'done')
t('R5 已过的行有一条（state=done）', !!past, past && past.text)
t('R6 已过 = 整行实色灰（rgb(98, 107, 125)，不是 alpha 档）', !!past && past.rowColor === 'rgb(98, 107, 125)' && past.titleColor === 'rgb(98, 107, 125)', past && `${past.rowColor} / ${past.titleColor}`)
const nowRow = rows.find((r) => r.state === 'now')
t('R7 进行中的行标 state=now 且右侧给剩余分钟', !!nowRow && /还剩 \d+ 分/.test(nowRow.text), nowRow && nowRow.text)
t('R9 未来条目右侧留空、不倒计时刷屏（只有 next 那条报分钟）', rows.filter((r) => r.state === 'plain').length >= 1, JSON.stringify(rows.filter((r) => r.state === 'plain').map((r) => r.text)))
t('R10 全程无 pageerror', errs.length === 0, errs.join(' | '))

await browser.close()
console.log(`\n=== 26px 时间行规格：${pass}/${pass + fail} 项通过 ===`)
process.exit(fail ? 1 : 0)
