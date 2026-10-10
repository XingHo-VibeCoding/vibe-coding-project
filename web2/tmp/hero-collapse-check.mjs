/* 今日页头部上拉收缩（乙：压成一行，折到底后钉住）检查——playwright，走 dist 静态服务。
   需求（m26207）：上拉时顶卡压缩成一行。
   拍板（m26282）：乙方案 + 「录音 / 复盘时锁住，停在展开态」。
   拍板（m01369，2026-10-10）：折到底后那一行不再跟着继续上滑走掉，钉在顶上。
   拍板（m02029，2026-10-12）：① 浮层铺页面底色（折到底钉住后内容会从状态条背后透上来叠字）；
                           ② 浮层底部留 8px，把状态条按钮的触区从 39px 补到 44px。
                           ⇒ 收起高度由 44px（12 顶白 + 32 条）变成 52px（+8 底白）。

   核心不变量（这条错了整个方案就塌）：
     **头部必须是绝对定位浮层，不在滚动窗口里** —— 若留在流内，收掉高度 s 会让窗口顶也上移 s，
     而 scrollTop 也是 s ⇒ 内容以 2× 速度飞走且 scrollTop 被反复夹回。所以 A1/B1/B4 是地基。

   断言：
   A1-A5 结构：头部不在滚动窗口里；窗口高 = 可用高度；内容留了一段 ≥200px 的等高 padding-top；
           折叠前状态条是透明的、头卡是不透明的；
   B1-B4 跟手：B1 内容位移 == scrollTop（1×，不是 2×）；B2 头部收掉的高度 == scrollTop（1:1，±3）；
           B3 头卡顶边不动（压缩不推内容）；B4 全程窗口高度恒定；
   C1-C3 折到底：C1 浮层高 ≈ 一行（52px = 12 顶白 + 32 状态条 + 8 底白）；C2 状态条露出来；
           C3 头卡被高度整块裁掉（高 ≈ 0）；
           ※ 2026-10-10 由「淡出」改「真收缩」：头卡不再调 opacity，改由 height 塌到 0 裁切；
             状态条仍用 opacity 从最后 10%（heroP>0.9）露出，所以 A4/C2/G3 口径不变；
   D1-D3 钉住：D1 再上拉状态条顶边不动（2026-10-10 用户 m01369 要求「不继续上升」，
            旧口径「整块走掉 wrapTop < -20」已废）；D2 窗口仍恒定；D3 浮层高仍是一行；
   E1    回顶部复位成展开态；
   F1-F2 别的 tab：F1 课表页头部整块裁掉（可见高 < 2px）；F2 切回今日页恢复；
   G0-G4 锁定：复盘浮层开着时上拉，头部不收缩、头卡仍完全展开；
   H1    折到底时状态条上的按钮命中（中心 + ::after 触区扩展方向至少一处）；
   Z1    全程无 pageerror / console.error。
   跑法：先构建 + 起 dist 静态服务（默认 4177，BASE 可覆盖）再 node tmp/hero-collapse-check.mjs

   夹具注意（踩过的坑）：
     · 必须 ctx.route 掐掉 cdn.jsdelivr.net —— 否则节假日 CDN 会改夹具（国庆/补课日会让今日页变成「今天没课」）；
     · 日期要避开法定节假日与补课日（10-05~10-07 国庆、10-08 补课）；
     · 钉时钟必须把时间戳拼进源码字符串 —— addInitScript 是序列化函数源码执行，闭包变量会丢；
     · 切页用程序化 el.click()：非当前页带 inert，真实鼠标事件会被吃掉。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let pass = 0, fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}
const r1 = (n) => Math.round(n * 10) / 10

/* 钉时钟：时间戳必须拼进源码（addInitScript 序列化函数源码，闭包会丢） */
const clockAt = (iso) => `
  const FIXED = ${new Date(iso).getTime()};
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(FIXED); else super(...a) }
    static now() { return FIXED }
  }
  window.Date = FakeDate;
`

/* 夹具：周一 14:30 正在上「线性代数」，5 门课；避开节假日与补课日 */
const FIXTURE = JSON.stringify({
  version: 1,
  schedules: [{
    id: 'sch_1', semester: '2026-2027 秋冬', type: 'course',
    entries: [
      { id: 'c1', type: 'course', name: '交通工程', weekday: 1, start: '08:00', end: '09:35', place: '教二 108', weeks: null, term: '秋冬' },
      { id: 'c2', type: 'course', name: '结构力学Ⅰ', weekday: 1, start: '10:00', end: '11:40', place: '教二 209', weeks: null, term: '秋冬' },
      { id: 'c3', type: 'course', name: '线性代数', weekday: 1, start: '14:00', end: '15:40', place: '教二 110', weeks: null, term: '秋冬' },
      { id: 'c4', type: 'course', name: '弹性力学', weekday: 1, start: '16:45', end: '18:25', place: '教四 402', weeks: null, term: '秋冬' },
      { id: 'c5', type: 'course', name: '工程信息化', weekday: 1, start: '19:00', end: '20:35', place: '教一 101', weeks: null, term: '秋冬' },
    ],
  }],
  semester: { name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 18 },
})

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

async function open({ iso = '2026-10-12T14:30:00', theme = 'light', width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  // 掐掉节假日 CDN，否则它会把夹具改成国庆/补课
  await ctx.route('**cdn.jsdelivr.net/**', (route) => route.abort())
  await page.addInitScript(clockAt(iso))
  await page.addInitScript(([theme, fx]) => {
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.theme', theme)
    localStorage.setItem('web2.data', fx)
    localStorage.removeItem('web2.dayOverrides')
  }, [theme, FIXTURE])
  await page.goto(BASE, { waitUntil: 'load' })
  await page.waitForSelector('[data-page="today"]')
  await page.waitForTimeout(900)
  return { page, ctx, errors }
}

/* 一次 evaluate 取全量几何，避免中间重排 */
const PROBE = () => {
  const main = document.querySelector('[data-page="today"]')
  const wrap = document.querySelector('[data-hero-wrap]')
  const bar = document.querySelector('[data-hero-bar]')
  const header = document.querySelector('header')
  const wr = wrap.getBoundingClientRect()
  const br = bar.getBoundingClientRect()
  const hr = header.getBoundingClientRect()
  const barCs = getComputedStyle(bar)
  const headerCs = getComputedStyle(header)
  const wrapCs = getComputedStyle(wrap)
  return {
    scrollTop: main.scrollTop,
    maxScroll: main.scrollHeight - main.clientHeight,
    clientH: main.clientHeight,
    padTop: parseFloat(getComputedStyle(main).paddingTop) || 0,
    wrapH: Math.round(wr.height),
    wrapTop: Math.round(wr.top),
    headerTop: Math.round(hr.top),
    headerH: Math.round(hr.height),
    headerOpacity: parseFloat(headerCs.opacity),
    barOpacity: parseFloat(barCs.opacity),
    barRect: { x: br.x, y: br.y, w: br.width, h: br.height },
    wrapClipH: (() => { const p = wrap.parentElement; return p ? Math.round(p.getBoundingClientRect().height) : -1 })(),
    wrapBg: wrapCs.backgroundColor,
    wrapOpaque: (() => {
      // 底色不透明 ⇒ alpha 为 1（判定用，不解析 rgb/rgba 的两种书写）
      const m = wrapCs.backgroundColor.match(/rgba?\(([^)]+)\)/)
      if (!m) return false
      const parts = m[1].split(',').map((s) => parseFloat(s))
      return parts.length < 4 || parts[3] >= 0.99
    })(),
  }
}

/* 滚到指定位置。
   ⚠ 必须在页内 await 若干 rAF：onTodayScroll 是 rAF 去抖的，而 headless Chrome 在
   没有合成帧的时候**不会自己推进 rAF** —— 只 set scrollTop + page.waitForTimeout()
   会得到「scrollTop 已经变了、但 heroScroll 没更新」的假失败（2026-10-10 实测：
   B2/C1/C2/C3/D3/G5/H1 全挂，根因全在这一处测试脚手架，不在 App）。 */
const scrollTo = async (page, v) => {
  await page.evaluate(async (n) => {
    const el = document.querySelector('[data-page="today"]')
    el.scrollTop = n
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r))
  }, v)
  await page.waitForTimeout(120)
}

/* ================= A. 结构地基 ================= */
const A0 = await open()
const p = A0.page
t('A1. 头部不在滚动窗口里（绝对定位浮层）',
  await p.locator('header').evaluate((el) => el.closest('[data-today-scroll]') === null))
const A = await p.evaluate(PROBE)
t('A2. 滚动窗口高 ≈ 可用高度（整屏减导航，±40）',
  A.clientH > 600 && A.clientH < 844, `clientH=${A.clientH}`)
t('A3. 内容留了 ≥200px 等高 padding-top（头部浮层占位）', A.padTop >= 200, `padTop=${r1(A.padTop)}`)
t('A4. 折叠前状态条是透明的', A.barOpacity < 0.02, `barOpacity=${A.barOpacity}`)
t('A5. 折叠前头卡是不透明的', A.headerOpacity > 0.99, `headerOpacity=${A.headerOpacity}`)
const openH = A.wrapH
t('A6. 展开态浮层高度 > 一行（确实有得收）', openH > 200, `wrapH=${openH}`)

/* ================= B. 跟手（1:1，不是 2×） ================= */
/* 收起高度：12 顶白 + 32 状态条 + 8 底白 = 52（2026-10-12 由 44 上调，底部那 8px 买触区） */
const MINH = 52
const half = Math.round((openH - MINH) / 2)
await scrollTo(p, half)
const B = await p.evaluate(PROBE)
t('B1. 内容位移 == scrollTop（1×，不是 2×）',
  Math.abs(B.scrollTop - half) <= 2, `scrollTop=${B.scrollTop} 期望=${half}`)
t('B2. 头部收掉的高度 == scrollTop（1:1，±3）',
  Math.abs((openH - B.wrapH) - B.scrollTop) <= 3, `收掉=${openH - B.wrapH} scrollTop=${B.scrollTop}`)
t('B3. 头卡顶边不动（压缩不推内容）', Math.abs(B.headerTop - A.headerTop) <= 1,
  `headerTop ${A.headerTop} → ${B.headerTop}`)
t('B4. 窗口高度全程恒定', B.clientH === A.clientH, `clientH ${A.clientH} → ${B.clientH}`)

/* ================= C. 折到底 ================= */
await scrollTo(p, openH - MINH)
const C = await p.evaluate(PROBE)
t('C1. 折到底浮层高 ≈ 一行（52px，±4）', Math.abs(C.wrapH - MINH) <= 4, `wrapH=${C.wrapH}`)
t('C2. 折到底状态条露出来（>0.9）', C.barOpacity > 0.9, `barOpacity=${C.barOpacity}`)
t('C3. 折到底头卡被整块裁掉（高 ≈ 0，±2）', C.headerH <= 2, `headerH=${C.headerH} headerOpacity=${C.headerOpacity}`)
/* 新增：浮层必须铺底色，否则钉住后下方内容从状态条背后透上来叠字（用户 m02029 拍板 A） */
t('C4. 折到底浮层有底色（不透明，挡住下方内容）', C.wrapOpaque, `bg=${C.wrapBg}`)

/* ================= D. 折到底后钉住（不再走掉） =================
   2026-10-10 用户 m01369：折到底后那一行不占空间，就别再跟着上滑走掉，钉在顶上。
   所以这里断言「再上拉，浮层顶边不动、高度不变」，与旧的「整块走掉」相反。 */
await scrollTo(p, A.maxScroll)
const D = await p.evaluate(PROBE)
t('D1. 再上拉状态条钉住不动（浮层顶边不位移）', Math.abs(D.wrapTop - C.wrapTop) <= 1, `wrapTop ${C.wrapTop} → ${D.wrapTop}`)
t('D2. 再上拉窗口仍恒定', D.clientH === A.clientH, `clientH ${A.clientH} → ${D.clientH}`)
t('D3. 再上拉浮层高仍是一行（±4）', Math.abs(D.wrapH - MINH) <= 4, `wrapH ${C.wrapH} → ${D.wrapH}`)

/* ================= E. 复位 ================= */
await scrollTo(p, 0)
const E = await p.evaluate(PROBE)
t('E1. 回顶部复位成展开态（浮层高回到 ±3）', Math.abs(E.wrapH - openH) <= 3, `${openH} → ${E.wrapH}`)

/* ================= F. 别的 tab 不残留 =================
   2026-10-12（用户 m03248）改成整页横向平移：头卡不再靠竖向塌缩裁掉，
   而是跟今日页一起用同一个 translateX 滑出屏幕。所以这里不再量「父级裁切盒高」，
   改量「浮层确实横移到视口外」。 */
await p.$eval('[data-nav="week"]', (el) => el.click())
await p.waitForTimeout(900)
const F = await p.evaluate(() => {
  const wrap = document.querySelector('[data-hero-wrap]')
  const r = wrap.getBoundingClientRect()
  const tr = getComputedStyle(wrap).transform
  const wrapW = Math.round(wrap.offsetWidth)
  return { left: Math.round(r.left), right: Math.round(r.right), wrapW, tr, vw: window.innerWidth }
})
t('F1. 课表页头部整块滑出屏幕（右边缘不侵入视口）', F.right <= 2, `left=${F.left} right=${F.right} vw=${F.vw} transform=${F.tr}`)
await p.$eval('[data-nav="today"]', (el) => el.click())
await p.waitForTimeout(900)
const F2 = await p.evaluate(PROBE)
t('F2. 切回今日页恢复成展开态（±3）', Math.abs(F2.wrapH - openH) <= 3, `${openH} → ${F2.wrapH}`)

/* ================= G. 锁定：复盘浮层开着时不收缩 ================= */
const g = await open({ iso: '2026-10-12T21:30:00' })
const gp = g.page
const G0 = await gp.evaluate(PROBE)
const reviewBtn = gp.locator('[data-review-start]').first()
t('G0. 21:30 进页面顶卡是「今天收个尾」（复盘入口在）', await reviewBtn.count() > 0)
if (await reviewBtn.count() > 0) {
  await reviewBtn.click()
  await gp.waitForTimeout(600)
  const opened = await gp.locator('[data-review-step], [data-review-q]').count()
  t('G1. 复盘浮层确实开了', opened > 0, `count=${opened}`)
  await scrollTo(gp, 400)
  const G2 = await gp.evaluate(PROBE)
  t('G2. 锁定态上拉：头部不收缩（浮层高不变，±3）', Math.abs(G2.wrapH - G0.wrapH) <= 3, `${G0.wrapH} → ${G2.wrapH}`)
  t('G3. 锁定态：状态条不出现（透明度 < 0.02）', G2.barOpacity < 0.02, `barOpacity=${G2.barOpacity}`)
  // 锁定只锁「头部不收缩」，**不锁滚动本身** —— 内容照常滚，头卡就浮在上面不动。
  t('G4. 锁定态：头卡仍完全展开（opacity > 0.99，不被滚动影响）', G2.headerOpacity > 0.99, `headerOpacity=${G2.headerOpacity}`)
  // BottomSheet 没有 Escape 处理，走遮罩点击（同一套 close 派发）
  await gp.evaluate(() => document.querySelector('[data-sheet-mask]').click())
  await gp.waitForTimeout(700)
  await scrollTo(gp, 300)
  const G5 = await gp.evaluate(PROBE)
  t('G5. 关掉浮层后恢复跟手（头部收掉了）', G0.wrapH - G5.wrapH > 100, `${G0.wrapH} → ${G5.wrapH}`)
}

/* ================= H. 折到底时按钮点得中 ================= */
await scrollTo(p, openH - MINH)
await p.waitForTimeout(300)
const H = await p.evaluate(() => {
  const bar = document.querySelector('[data-hero-bar]')
  const btn = bar.querySelector('[data-hero-bar-rec], [data-hero-bar-review]')
  if (!btn) return { ok: false, why: '状态条上没有按钮锚点' }
  const r = btn.getBoundingClientRect()
  const hitAt = (dx, dy) => {
    const x = r.x + (dx === null ? r.width / 2 : dx)
    const y = r.y + (dy === null ? r.height / 2 : dy)
    const el = document.elementFromPoint(x, y)
    return { hit: el === btn || btn.contains(el), tag: el ? el.tagName : 'null' }
  }
  const center = hitAt(null, null)
  // 2026-10-12：改量「真实可点高度」而不是只量按钮盒。按钮本体 34px + after:-inset-y-1.5
  // 上下各扩 6px = 46px 期望触区；浮层底部留白不够时下沿会被 overflow-hidden 裁掉，
  // 之前只处 39px 却因断言太弱照过 —— 现在直接数出可点像素跨度。
  let top = null, bottom = null
  for (let dy = -12; dy <= r.height + 12; dy++) {
    if (hitAt(null, dy).hit) { if (top === null) top = dy; bottom = dy }
  }
  const span = top === null ? 0 : bottom - top + 1
  return {
    ok: center.hit && span >= 44,
    h: Math.round(r.height), w: Math.round(r.width), span,
    center: center.tag, top, bottom,
  }
})
t('H1. 折到底时状态条按钮可点高度 ≥44px（WCAG 2.5.8）',
  H.ok, `可点跨度=${H.span}px 按钮盒=${H.h}px 中心=${H.center}`)

/* ================= Z. 报错 ================= */
t('Z1. 全程无 pageerror / console.error',
  A0.errors.length === 0 && g.errors.length === 0, JSON.stringify([...A0.errors, ...g.errors]))

await A0.ctx.close()
await g.ctx.close()
await browser.close()
console.log(`\n== hero-collapse-check: ${pass} 过 / ${fail} 挂 ==`)
process.exit(fail ? 1 : 0)
