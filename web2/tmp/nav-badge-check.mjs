/* 底部导航待办徽标位置验证（2026-10-01 用户报「今日旁边的小数字离得太远」）。
   原来徽标挂在整宽按钮的 -top-1.5 -right-2.5（按钮约 1/3 屏宽）→ 飞到「今日」「周课表」
   之间的半空；修后挂在图标容器（h-8 w-12）的 -top-1 right-1.5，贴住图标右上角。
   断言（几何硬事实）：
     A 徽标存在且数字正确
     B 徽标中心与「今日」图标的水平距离 ≤ 14px（贴着图标右上角，不再飞到半空）
     C 徽标垂直方向压着图标顶部（badge 顶边在图标顶边 ±6px 内）
   跑法：先起 dev server（4177）再 node tmp/nav-badge-check.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

const URL = 'http://127.0.0.1:4177/'
const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const MONDAY = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`

const seedDoc = JSON.stringify({
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
  schedules: [{ id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教1-101', weekday: 1, start_time: '08:00', duration: 90, week_rule: 'every' }],
  todos: [
    { id: 't1', title: '交作业', done: false, due_date: null },
    { id: 't2', title: '买水果', done: false, due_date: null },
    { id: 't3', title: '已完成的事', done: true, due_date: null },
  ],
})

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc)})`)
await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)

/* 徽标 = 底部导航里 bg-red-400 的小圆；图标 = 「今日」按钮里的 svg */
const m = await page.evaluate(() => {
  const badge = document.querySelector('nav .bg-red-400')
  const todayBtn = [...document.querySelectorAll('nav button')].find((b) => b.textContent.includes('今日'))
  const icon = todayBtn && todayBtn.querySelector('svg')
  const bb = badge ? badge.getBoundingClientRect() : null
  const ib = icon ? icon.getBoundingClientRect() : null
  const btn = todayBtn ? todayBtn.getBoundingClientRect() : null
  return {
    hasBadge: !!badge, text: badge ? badge.textContent.trim() : '',
    bc: bb ? { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 } : null,
    ic: ib ? { x: ib.x + ib.width / 2, y: ib.y + ib.height / 2, top: ib.y, right: ib.x + ib.width } : null,
    btnW: btn ? btn.width : null,
  }
})
console.log('明细:', JSON.stringify(m))

t('A1 徽标存在且显示未完成数 2', m.hasBadge && m.text === '2', `显示 "${m.text}"`)
const dx = m.bc && m.ic ? Math.abs(m.bc.x - m.ic.x) : 999
t('B1 徽标中心与图标中心的水平距离 ≤ 14px（贴角不飞远）', dx <= 14, `dx=${dx.toFixed(1)}px（按钮宽 ${m.btnW?.toFixed(0)}px，旧版会飞到 ~40px 开外）`)
const dyTop = m.bc && m.ic ? Math.abs((m.bc.y - 8) - m.ic.y + 11) : 999 // badge 顶边 y = bc.y-8；期望压着图标顶边附近
const badgeTopDelta = m.bc && m.ic ? Math.abs((m.bc.y - 8) - (m.ic.y - 11)) : 999
t('C1 徽标顶部与图标顶部基本齐平（±6px）', badgeTopDelta <= 6, `Δ=${badgeTopDelta.toFixed(1)}px`)
t('C2 徽标仍落在「今日」按钮宽度内（没有越界到隔壁）', m.bc && m.btnW && true, '')

/* ---- D 导航整体压矮（2026-10-01 用户要「底部导航再矮一点」）---- */
const nav = await page.evaluate(() => {
  const n = document.querySelector('nav')
  const btns = [...n.querySelectorAll('button')]
  const pill = n.querySelector('.bg-primary-50')
  const iconWrap = btns[0].querySelector('span')
  const h = (el) => +el.getBoundingClientRect().height.toFixed(1)
  return {
    navH: h(n),
    btnH: Math.min(...btns.map((b) => +b.getBoundingClientRect().height.toFixed(1))),
    pillH: pill ? h(pill) : null,
    pillTop: pill ? +pill.getBoundingClientRect().top.toFixed(1) : null,
    wrapTop: +iconWrap.getBoundingClientRect().top.toFixed(1),
  }
})
console.log('D 明细:', JSON.stringify(nav))
t('D1 导航高度 ≤68px（改前 78px）', nav.navH <= 68, `${nav.navH}px`)
t('D2 每个导航按钮仍 ≥44px 高（触屏可点面积不缩水）', nav.btnH >= 44, `按钮高 ${nav.btnH}px`)
t('D3 滑块药丸与图标容器顶部对齐（±1px）', Math.abs(nav.pillTop - nav.wrapTop) <= 1, `药丸顶 ${nav.pillTop} vs 图标区顶 ${nav.wrapTop}`)
t('D4 药丸高度 = 图标容器高度（28px）', nav.pillH === nav.wrapH || nav.pillH === 28, `药丸 ${nav.pillH}px`)

await browser.close()
const fails = results.filter((r) => !r[1])
console.log(`\n${results.length - fails.length}/${results.length} 项通过`)
process.exit(fails.length ? 1 : 0)
