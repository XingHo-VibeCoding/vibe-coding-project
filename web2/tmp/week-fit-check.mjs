/* 周课表两处体验修复的回归（2026-10-01 用户报）：
   ①「左右划不动没问题，但上下还能滑」→ 页面底部 pb-28 撑着 44px 空白 + 网格高度多算 16px
      （网格底边被底部导航压住 9px）。修法：网格高度扣掉实测底部导航高度；周课表页 pb-28→pb-16。
   ②「课名/地点要能显示多行，看到完整信息」→ 原来 truncate 只给一行。修法：line-clamp-2 / line-clamp-3。
   断言（全是几何/布局硬事实）：
     A 上下真的滑不动（文档高度 = 视口高度；强行 scrollTo 后 scrollTop 仍为 0）
     B 网格底边不与底部导航重叠（≥6px 间隙）
     C 长课名渲染成 ≥2 行，且文字没有溢出卡片（不切半行）
     D 长地点渲染成 ≥2 行
     E 单节次（一行高）的卡片也不溢出卡片框
   跑法：先起 dev server（4177）再 node tmp/week-fit-check.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

// TW_URL 可覆盖：TW_URL=https://college-schedule-assistant.app.workbuddy.host/ 即对线上产物做行为断言
const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'
const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const MONDAY = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`

const LONG_NAME = '习近平新时代中国特色社会主义思想概论'
const LONG_PLACE = '紫金港校区北4教学楼319教室 叶苗苗'
const COURSES = [
  // 连堂两节：空间充裕，名字与地点都应该多行显示
  { id: 'c1', type: 'course', semester_id: 'sem1', title: LONG_NAME, location: LONG_PLACE, weekday: 1, start_time: '10:00', duration: 100, week_rule: 'every' },
  // 单节次：行高只有 ~30px，名字仍要能换到第二行，且不许把文字切在卡片外
  { id: 'c2', type: 'course', semester_id: 'sem1', title: '大学物理实验（光学）', location: '紫金港北4-202', weekday: 3, start_time: '15:05', duration: 45, week_rule: 'every' },
  { id: 'c3', type: 'course', semester_id: 'sem1', title: '体育', location: '操场', weekday: 5, start_time: '15:05', duration: 45, week_rule: 'every' },
]
const seedDoc = JSON.stringify({
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
  schedules: COURSES, todos: [],
})

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc)})`)
await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await page.locator('nav button', { hasText: '周课表' }).click()
await page.waitForTimeout(700)

/* ---- A 上下滑不动 ---- */
const A = await page.evaluate(async () => {
  const sc = document.scrollingElement
  const before = sc.scrollTop
  window.scrollTo(0, 9999)
  await new Promise((r) => setTimeout(r, 250))
  return { maxScroll: sc.scrollHeight - sc.clientHeight, docH: sc.scrollHeight, viewH: window.innerHeight, before, after: sc.scrollTop }
})
console.log('A 明细:', JSON.stringify(A))
t('A1 文档高度 = 视口高度（没有多余可滚区域）', A.maxScroll <= 1, `可滚 ${A.maxScroll}px（文档 ${A.docH} / 视口 ${A.viewH}）`)
t('A2 强行上滑后 scrollTop 仍为 0', A.after === 0, `scrollTop=${A.after}`)

/* ---- B 网格底边 vs 底部导航 ---- */
const B = await page.evaluate(() => {
  const g = document.querySelector('[data-grid]').getBoundingClientRect()
  const n = document.querySelector('nav').getBoundingClientRect()
  return { gridBottom: +g.bottom.toFixed(1), navTop: +n.top.toFixed(1), gap: +(n.top - g.bottom).toFixed(1) }
})
console.log('B 明细:', JSON.stringify(B))
t('B1 网格底边在底部导航之上（≥6px 间隙）', B.gap >= 6, `间隙 ${B.gap}px`)
t('B2 网格填满剩余空间（间隙 ≤14px，不留大空档）', B.gap <= 14, `间隙 ${B.gap}px`)

/* ---- H 锁死 + 紧凑头部（2026-10-01 用户要求：头部多缩、课表锁死） ---- */
const H = await page.evaluate(() => {
  const h = document.querySelector('header').getBoundingClientRect()
  const h1 = document.querySelector('header h1')
  return {
    headerH: +h.height.toFixed(1),
    h1Size: getComputedStyle(h1).fontSize,
    locked: document.body.style.overflow === 'hidden',
    scrollable: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
  }
})
console.log('H 明细:', JSON.stringify(H))
t('H1 周课表页锁死文档滚动（body overflow hidden）', H.locked, `scrollable=${H.scrollable}px`)
t('H2 紧凑头部生效（header ≤115px，旧版 ~140px）', H.headerH <= 115, `${H.headerH}px`)
t('H3 问候语降为单行小字号（紧凑态）', parseFloat(H.h1Size) < 24, H.h1Size)

/* ---- C/D/E 卡片文字多行 ---- */
const cards = await page.evaluate((longName) => {
  const lineCount = (el) => {
    if (!el) return 0
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 1
    return Math.round(el.getBoundingClientRect().height / lh)
  }
  const out = {}
  for (const card of document.querySelectorAll('[data-grid] article')) {
    const ps = card.querySelectorAll('p')
    const name = ps[0]
    const place = ps[1]
    const rec = {
      name: name ? name.textContent.trim() : '',
      nameLines: lineCount(name),
      placeLines: place ? lineCount(place) : 0,
      nameOverflow: name ? name.scrollHeight - name.clientHeight : 0,
      cardOverflow: card.scrollHeight - card.clientHeight,
      cardH: +card.getBoundingClientRect().height.toFixed(1),
    }
    if (rec.name === longName) out.long = rec
    if (rec.name === '大学物理实验（光学）') out.single = rec
  }
  return out
}, LONG_NAME)
console.log('C/D/E 明细:', JSON.stringify(cards, null, 1))

t('C1 长课名渲染 ≥2 行', cards.long && cards.long.nameLines >= 2, `${cards.long?.nameLines} 行 / 卡片高 ${cards.long?.cardH}px`)
t('C2 长课名卡片内容不溢出（不切半行）', cards.long && cards.long.cardOverflow <= 1, `溢出 ${cards.long?.cardOverflow}px`)
t('D1 长地点渲染 ≥2 行', cards.long && cards.long.placeLines >= 2, `${cards.long?.placeLines} 行`)
t('E1 单节次卡片内容不溢出卡片框', cards.single && cards.single.cardOverflow <= 1, `溢出 ${cards.single?.cardOverflow}px（卡片高 ${cards.single?.cardH}px，名字 ${cards.single?.nameLines} 行）`)

/* ---- F 大屏自适应：行变高后，单节次卡片也应该能显示两行名字 ---- */
{
  const ctxT = await browser.newContext({ viewport: { width: 430, height: 1000 } })
  const pT = await ctxT.newPage()
  pT.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await pT.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc)})`)
  await pT.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
  await pT.goto(URL, { waitUntil: 'domcontentloaded' })
  await pT.waitForTimeout(700)
  await pT.locator('nav button', { hasText: '周课表' }).click()
  await pT.waitForTimeout(700)
  const tall = await pT.evaluate(() => {
    const lineCount = (el) => Math.round(el.getBoundingClientRect().height / (parseFloat(getComputedStyle(el).lineHeight) || 1))
    const card = [...document.querySelectorAll('[data-grid] article')].find((c) => c.querySelector('p')?.textContent.trim() === '大学物理实验（光学）')
    const sc = document.scrollingElement
    return {
      lines: lineCount(card.querySelector('p')),
      cardOverflow: card.scrollHeight - card.clientHeight,
      cardH: +card.getBoundingClientRect().height.toFixed(1),
      maxScroll: sc.scrollHeight - sc.clientHeight,
    }
  })
  console.log('F 明细:', JSON.stringify(tall))
  t('F1 大屏下网格仍一屏看完（无纵向滚动）', tall.maxScroll <= 1, `可滚 ${tall.maxScroll}px`)
  t('F2 大屏下单节次卡片名字也能两行（自适应生效）', tall.lines >= 2, `名字 ${tall.lines} 行 / 卡片 ${tall.cardH}px`)
  t('F3 大屏下单节次卡片不溢出', tall.cardOverflow <= 1, `溢出 ${tall.cardOverflow}px`)
  await ctxT.close()
}

/* ---- G 模拟 App 外壳：#app 被外壳加了 padding-top(--sat) 让出状态栏 ----
   2026-10-01 用户真机报「还是能小幅上下拖」：WEEK_CHROME 是浏览器（无让位）环境量的，
   APK 里内容被 sat 顶下去、总高正好多出 sat。修法：gridH 现量 #app padding-top 扣掉；
   外壳异步量到高度后广播 'wb-sat'，这里同步模拟同一个事件链。 */
{
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pA = await ctxA.newPage()
  pA.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await pA.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc)})`)
  await pA.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
  await pA.goto(URL, { waitUntil: 'domcontentloaded' })
  await pA.waitForTimeout(700)
  await pA.locator('nav button', { hasText: '周课表' }).click()
  await pA.waitForTimeout(700)
  const apk = await pA.evaluate(() => {
    const gridHBefore = document.querySelector('[data-grid]').getBoundingClientRect().height
    const app = document.getElementById('app')
    // 完整模拟外壳：真外壳是设 html 的 --sat 变量（shell.css 用它同时做 #app padding-top
    // 与主项目根容器的 min-height 收缩），缺一不可
    document.documentElement.style.setProperty('--sat', '28px')
    app.style.paddingTop = '28px'
    window.dispatchEvent(new Event('wb-sat')) // 模拟外壳量到后的广播
    return new Promise((r) => setTimeout(() => {
      const sc = document.scrollingElement
      window.scrollTo(0, 9999)
      setTimeout(() => r({
        satRead: getComputedStyle(app).paddingTop,
        gridHBefore: +gridHBefore.toFixed(1),
        gridHAfter: +document.querySelector('[data-grid]').getBoundingClientRect().height.toFixed(1),
        maxScroll: sc.scrollHeight - sc.clientHeight,
        after: sc.scrollTop,
      }), 250)
    }, 100))
  })
  console.log('G 明细:', JSON.stringify(apk))
  t('G1 外壳让位被感知（satPx 量到 28px）', apk.satRead === '28px', apk.satRead)
  t('G2 网格高度收窄了约一个状态栏（≥24px）', apk.gridHBefore - apk.gridHAfter >= 24, `${apk.gridHBefore} → ${apk.gridHAfter}`)
  t('G3 让位后仍一屏看完（不产生滚动）', apk.maxScroll <= 1, `可滚 ${apk.maxScroll}px`)
  t('G4 强行上滑后 scrollTop 仍为 0', apk.after === 0, `scrollTop=${apk.after}`)
  await ctxA.close()
}

await browser.close()
const fails = results.filter((r) => !r[1])
console.log(`\n=== 周课表一屏/多行：${results.length - fails.length}/${results.length} 通过 ===`)
process.exit(fails.length ? 1 : 0)