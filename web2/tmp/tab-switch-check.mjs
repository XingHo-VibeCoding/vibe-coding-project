/* tab-switch-check：切页必须是「整页横向平移」，不许再有卡片收缩动画。
   背景（2026-10-12，用户 m03248）：
     「今日 ↔ 周课表 切换非常割裂：从今日切周课表时上面的卡片先是消失、
       然后页面才切换；周课表上的卡片和首页的卡片已经不是同一个东西。
       干脆删掉这两页之间切换时卡片收缩的动画，直接把整个页面平移过去。」
   旧做法：header 是三页共享的浮层，切页靠外层 grid-rows 1fr→0fr 竖向塌缩，
          平移层还要等 110ms 才动 ⇒ 用户看到「卡片先没了、页面才切」。
   新做法：header 只属于今日页，和今日页用同一组参数（280ms / cubic-bezier(0.32,0.72,0.35,1)
          / 同一个 swipeDx）一起横向平移；两处 grid 塌缩与 110ms 错峰全部删除。
   本脚本守三件事：
     A. 两个方向的切页都是「横向滑」，且①首帧不硬跳 ②相邻帧无大台阶
        ③切页全程头卡高度恒定（证明卡片确实不再竖向塌缩）。
     B. 头卡随今日页走：周课表 / 我的页上它必须已在视口外（我的页不再显示问候卡，m03289）。
     C. 学期进度带只在今日页可见。
   跑法：先起 dist 静态服务（默认 4177），再 node tmp/tab-switch-check.mjs */
import * as pw from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const { chromium } = pw
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE || 'http://127.0.0.1:4177/'

const FIXTURE = {
  version: 1,
  schedules: [{ id: 's1', name: '默认', first_monday: '2026-09-07', total_weeks: 18, entries: [
    { id: 'c1', title: '交通工程', day: 1, start: '08:00', end: '09:35', location: '教一 101', teacher: '王', kind: '必修' },
    { id: 'c2', title: '线性代数', day: 1, start: '14:00', end: '15:40', location: '教二 110', teacher: '赵敏', kind: '必修' }] }],
  todos: [], routines: [], habits: [], listens: [], recs: [],
  semester: { first_monday: '2026-09-07', total_weeks: 18 },
}
const clock = (iso) => `(() => { const F = ${new Date(iso).getTime()}; const D = Date; class CD extends D { constructor(...a) { if (a.length === 0) super(F); else super(...a) } static now() { return F } } window.Date = CD })()`

let pass = 0
let fail = 0
const ok = (name, cond, ev) => { if (cond) { pass++; console.log(`  [PASS] ${name}  ${ev}`) } else { fail++; console.log(`  [FAIL] ${name}  ${ev}`) } }

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.route('**cdn.jsdelivr.net/**', (r) => r.abort())
await ctx.addInitScript(clock('2026-10-12T14:30:00'))
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate((f) => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', 'light')
  localStorage.setItem('web2.data', JSON.stringify(f))
  localStorage.removeItem('web2.dayOverrides')
}, FIXTURE)
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('[data-page="today"]')
await page.waitForTimeout(1200)

// tab 名 → nav 的 data-nav 键
const KEY = { '今日': 'today', '周课表': 'week', '我的': 'me' }
const activeKey = () => page.evaluate(() => (document.querySelector('nav [data-nav][data-active="1"]') || {}).dataset?.nav || null)

// 把正在跑的 CSS 过渡直接推到终态，再读布局。
// ⚠ headless Chrome 在机器有负载时合成帧会被饿到 ~0.6fps：280ms 的过渡整个发生在
// 两帧之间，rAF/定时器只会采到「起点 → 终点」。所以「稳态」类断言必须先把动画
// finish 掉，否则读到的是过渡起点，会假挂。
const settle = () => page.evaluate(() => { for (const a of document.getAnimations()) { try { a.finish() } catch {} } })

// 点某个 tab，并**确认真的切过去了**再继续。
async function clickTab(name) {
  const want = KEY[name]
  for (let i = 0; i < 6; i++) {
    if ((await activeKey()) === want) return true
    await page.evaluate((n) => { const b = document.querySelector(`nav [data-nav="${n}"]`); if (b) b.click() }, want)
    await page.waitForTimeout(600)
    if ((await activeKey()) === want) return true
  }
  return false
}

/* 采一次切页的**真实插值轨迹**。
   ⚠ 为什么不能靠 rAF/定时器逐帧采：本机 headless 合成帧会被饿到 ~0.6fps，
     280ms 的过渡整个发生在两帧之间，只能采到起点与终点，看不出过程。
   因此改为**主动驱动动画时钟**：点完等一个宏任务让 Vue 把 DOM 更新掉（关键！否则
   getAnimations() 拿不到切页产生的过渡），把每个 CSSTransition pause 住，手动把
   currentTime 从 0 推到 delay+duration，逐点读「浮层左边缘 + 头卡高」——
   不依赖合成器帧，采到的就是浏览器真实计算出的插值轨迹。
   每点同时记头卡高：新做法下它必须全程恒定（不再竖向塌缩）。 */
async function switchAndSample(from, to) {
  if (!(await clickTab(from))) return { err: `切不到「${from}」` }
  await settle()
  await page.waitForTimeout(300)
  const seq = await page.evaluate(async (n) => {
    const wrap = document.querySelector('[data-hero-wrap]')
    const hd = document.querySelector('header')
    const read = () => ({ left: Math.round(wrap.getBoundingClientRect().left), hh: Math.round(hd.offsetHeight) })
    const out = [{ t: 0, ...read() }] // 点击前的稳态
    document.querySelector(`nav [data-nav="${n}"]`).click()
    // 等一个宏任务：Vue 的响应式更新在微任务里跑完，过渡这时才建得出来。
    await new Promise((r) => setTimeout(r, 30))
    const anims = document.getAnimations().filter((a) => a.constructor.name === 'CSSTransition')
    // 把动画钉回 currentTime=0 再读「第一帧」：不这么做的话，读到的进度取决于
    // 真实时钟走了多少（负载低时 30ms 已推进 ~10%），会让「首帧位移」忽大忽小。
    for (const a of anims) { try { a.pause(); a.currentTime = 0 } catch {} }
    void document.body.offsetHeight
    out.push({ t: 1, ...read() }) // 第一帧：DOM 已更新、动画停在起点
    if (!anims.length) return out
    let total = 0
    for (const a of anims) {
      const tm = a.effect?.getTiming?.() || {}
      total = Math.max(total, (tm.delay || 0) + (tm.duration || 0))
    }
    if (!(total > 0)) total = 300
    for (const a of anims) { try { a.pause() } catch {} }
    const STEPS = Math.max(24, Math.round(total / 7))
    for (let i = 1; i <= STEPS; i++) {
      const t = (i / STEPS) * total
      for (const a of anims) { try { a.currentTime = t } catch {} }
      void document.body.offsetHeight // 逼样式重算，否则读到的还是上一帧布局
      out.push({ t: 1 + Math.round(t), ...read() })
    }
    return out
  }, KEY[to])
  const landed = await activeKey()
  if (landed !== KEY[to]) return { err: `点了「${to}」但没切过去（当前 ${landed}）`, seq }
  return { seq }
}

console.log('== tab-switch-check ==')
for (const [label, from, to] of [['今日 → 周课表', '今日', '周课表'], ['周课表 → 今日', '周课表', '今日']]) {
  const r = await switchAndSample(from, to)
  const seq = r.seq
  if (r.err || !seq || seq.length < 5) {
    fail++
    console.log(`  [FAIL] ${label} 没采到有效过程：${r.err || (seq ? seq.length + ' 点' : '无数据')} —— 不能判通过`)
    continue
  }
  // 采样是手动驱动动画时钟得来的，步长均匀且与真实帧率无关：
  // 相邻两次采样的间隔就是 total/STEPS ms（≈7ms），无需再按 Δt 过滤空隙。
  const first = seq[1]
  const jump = Math.abs(first.left - seq[0].left)
  const settledLeft = seq[seq.length - 1].left
  const heights = seq.map((x) => x.hh)
  const hMin = Math.min(...heights)
  const hMax = Math.max(...heights)
  // 相邻两点就是「一帧」；横向一帧走的像素 = 屏宽 / 帧数
  const pairs = []
  for (let i = 2; i < seq.length; i++) pairs.push(Math.abs(seq[i].left - seq[i - 1].left))
  const maxMid = pairs.length ? Math.max(...pairs) : 0
  const trace = seq.slice(0, 10).map((x) => `${x.t}:${x.left}`).join(' ')
  console.log(`  ${label}  首帧 left ${seq[0].left} → ${first.left}（Δ${jump}px）  稳态 left ${settledLeft}  头卡高 ${hMin}~${hMax}  帧数 ${seq.length}`)
  console.log(`           前 10 帧 ${trace}`)
  // A1: 首帧不许出现整个屏宽的瞬时位移（那是「硬跳」而不是过渡）
  ok(`${label} 首帧无硬跳`, jump < 20, `Δ${jump}px（阈值 20）`)
  // A2: 相邻两帧之间不该出现单帧 ≥ 1/4 屏宽（97.5px）的台阶
  ok(`${label} 相邻帧无大台阶`, maxMid < 98, `maxΔ=${maxMid}px / 有效对 ${pairs.length}`)
  // A3: 新做法的核心 —— 切页全程头卡高度恒定，允许 ±2px 的取整抖动。
  //     旧做法（卡片竖向塌缩）这里会是 279 → 0，所以这条能真抓住「又改回塌缩」。
  ok(`${label} 头卡不再竖向塌缩（全程高度恒定）`, hMax - hMin <= 2, `头卡高 ${hMin}~${hMax}（极差 ${hMax - hMin}px）`)
  // A4: 该滑出时必须真的滑出视口（不是只挪一点点）
  const wantOff = to === '周课表'
  if (wantOff) ok(`${label} 尾帧浮层已滑出视口`, settledLeft <= -380, `left=${settledLeft}`)
}

/* ================= B. 头卡归今日页：周课表 / 我的页上它必须在视口外 ================= */
for (const name of ['周课表', '我的']) {
  const landed = await clickTab(name)
  await page.waitForTimeout(800)
  await settle()
  const r = await page.evaluate(() => {
    const wrap = document.querySelector('[data-hero-wrap]')
    const b = wrap.getBoundingClientRect()
    return { left: Math.round(b.left), right: Math.round(b.right), vw: window.innerWidth }
  })
  if (!landed) {
    fail++
    console.log(`  [FAIL] 头卡在「${name}」页 —— 没切到该页，不能判`)
    continue
  }
  ok(`头卡在「${name}」页已滑出视口`, r.right <= 2, JSON.stringify(r))
}

/* ================= C. 学期进度带只在今日页可见 ================= */
for (const [name, wantVisible] of [['今日', true], ['周课表', false], ['我的', false]]) {
  const landed = await clickTab(name)
  await page.waitForTimeout(800)
  await settle() // 动画时钟正常时也要先落地，否则量到的是过渡中间态
  const r = await page.evaluate(() => {
    const el = document.querySelector('[data-term-ribbon]')
    if (!el) return { present: false }
    const b = el.getBoundingClientRect()
    const vw = window.innerWidth
    // 可见 = 有高度、且横向落在视口里（新做法下它跟着今日页横移，不再靠竖向裁切）
    const inView = b.height > 0 && b.right > 1 && b.left < vw - 1
    return { present: true, h: Math.round(b.height), left: Math.round(b.left), inView }
  })
  if (!landed) {
    fail++
    console.log(`  [FAIL] 学期进度带在「${name}」—— 没切到该页，不能判`)
    continue
  }
  ok(`学期进度带在「${name}」${wantVisible ? '可见' : '不可见'}`, r.present && r.inView === wantVisible, JSON.stringify(r))
}

ok('全程无 pageerror', errs.length === 0, errs.slice(0, 2).join(' | ') || '无')
console.log(`\n== tab-switch-check: ${pass} 过 / ${fail} 挂 ==`)
await browser.close()
process.exit(fail ? 1 : 0)
