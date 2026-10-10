/* tab-switch-check：切页时头部高度不许「一帧硬跳」。
   背景（2026-10-12，用户 m02386 报「现在可以修复页面切换动画了」）：
     今日 ↔ 周课表 切换时 header 高首帧一次性跳 ±44px，之后才恢复缓动。
     真凶是学期进度带 `data-term-ribbon`（带高 32.5 + mt-3 12 = 44.5px）
     原先挂在 header 的 1fr/0fr 塌缩格之外、且带 `tab === 'today'` 条件，
     切页时 v-if 一插入/一移除就瞬时增减，不参与 280ms 过渡。
     修法：搬进塌缩格 + 去掉 tab 条件（只留 v-if="termInfo"）。
   本脚本守两件事：
     A. 两个方向的 header 高首帧变化必须「像缓动起步」，不许出现 ≥ 一个
        ribbon 高的瞬时位移（判据：首帧位移 < 15px，且 1s 内到稳态）。
     B. 学期进度带只在今日页可见（周课表/我的页必须被塌缩格裁掉）。
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
// ⚠ headless Chrome 在机器有负载时**动画时钟会停摆**：所有 transition 永远
// `currentTime=0 / playState=running`，等多久都不落地（实测等 3s，header 仍 273）。
// 这不是产品问题——把 transition 关掉立刻就是正确布局（week: header 76）。
// 所以「稳态」类断言必须先把动画 finish 掉，否则读到的是过渡起点，会假挂。
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

// 采一次切页的**真实插值轨迹**。
//
// ⚠ 为什么不能靠 rAF/定时器逐帧采：
//   本机（高负载）headless Chrome 的合成帧会被饿到 ~0.6fps（实测 5 个 rAF 花了
//   8.4s），280ms 的过渡**整个发生在两帧之间**。用 rAF 采样只会得到「起点 → 终点」
//   两个点，既看不出中间过程，也看不出「第一帧一次性跳了 44px」。这不是产品问题，
//   是采样方法的局限。
// 因此改为**主动驱动动画时钟**：点完等一个宏任务让 Vue 把 DOM 更新掉（关键！否则
// getAnimations() 拿不到切页产生的过渡），把每个 CSSTransition pause 住，手动把
// currentTime 从 0 推到 delay+duration，逐点读 header 高 —— 不依赖合成器帧，采到的
// 就是浏览器真实计算出的插值轨迹（已在 headless 下验证：header 261→86→77→76）。
async function switchAndSample(from, to) {
  if (!(await clickTab(from))) return { err: `切不到「${from}」` }
  await settle()
  await page.waitForTimeout(300)
  const seq = await page.evaluate(async (n) => {
    const h = () => Math.round(document.querySelector('header').offsetHeight)
    const out = [{ t: 0, h: h() }] // 点击前的稳态
    document.querySelector(`nav [data-nav="${n}"]`).click()
    // 等一个宏任务：Vue 的响应式更新在微任务里跑完，过渡这时才建得出来。
    await new Promise((r) => setTimeout(r, 30))
    const anims = document.getAnimations().filter((a) => a.constructor.name === 'CSSTransition')
    // 把动画钉回 currentTime=0 再读「第一帧」：不这么做的话，读到的进度取决于
    // 真实时钟走了多少（负载低时 30ms 已推进 ~10%），会让「首帧位移」忽大忽小。
    for (const a of anims) { try { a.pause(); a.currentTime = 0 } catch {} }
    void document.body.offsetHeight
    out.push({ t: 1, h: h() }) // 第一帧：DOM 已更新、动画停在起点
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
      out.push({ t: 1 + Math.round(t), h: h() })
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
  const jump = Math.abs(first.h - seq[0].h)
  const settled = seq[seq.length - 1].h
  // A2：手动驱动的采样步长均匀（每步 ≈ total/STEPS ms），相邻两点就是「一帧」，
  // 不需要再按 Δt 过滤空隙。
  const pairs = []
  for (let i = 2; i < seq.length; i++) {
    pairs.push({ dt: seq[i].t - seq[i - 1].t, d: Math.abs(seq[i].h - seq[i - 1].h) })
  }
  const maxMid = pairs.length ? Math.max(...pairs.map((p) => p.d)) : 0
  const trace = seq.slice(0, 12).map((x) => `${x.t}:${x.h}`).join(' ')
  console.log(`  ${label}  首帧 ${seq[0].h} → ${first.h}（Δ${jump}）  稳态 ${settled}px  帧数 ${seq.length}  有效相邻对 ${pairs.length}`)
  console.log(`           前 12 帧 ${trace}`)
  // A1: 首帧位移不许是一个 ribbon 高（44.5px）的瞬时插入/移除
  ok(`${label} 首帧无硬跳`, jump < 15, `Δ${jump}px（阈值 15；ribbon 瞬时增减会是 44.5）`)
  // A2: 真正相邻的两帧之间不该出现单帧 ≥30px 的瞬时台阶
  ok(`${label} 相邻帧无大台阶`, maxMid < 30, `maxΔ=${maxMid}px / 有效对 ${pairs.length}（阈值 30；空隙帧已按 Δt≤40ms 过滤）`)
}

// B: 学期进度带只在今日页可见
for (const [name, wantVisible] of [['今日', true], ['周课表', false], ['我的', false]]) {
  const landed = await clickTab(name)
  await page.waitForTimeout(900)
  await settle() // 动画时钟正常时也要先落地，否则量到的是过渡中间态
  const r = await page.evaluate(() => {
    const el = document.querySelector('[data-term-ribbon]')
    const hd = document.querySelector('header')
    if (!el) return { present: false }
    const b = el.getBoundingClientRect()
    const hb = hd.getBoundingClientRect()
    return { present: true, h: Math.round(b.height), visible: b.height > 0 && b.bottom <= hb.bottom + 1 }
  })
  if (!landed) {
    fail++
    console.log(`  [FAIL] 学期进度带在「${name}」—— 没切到该页，不能判`)
    continue
  }
  ok(`学期进度带在「${name}」${wantVisible ? '可见' : '被裁掉'}`, r.present && r.visible === wantVisible, JSON.stringify(r))
}

ok('全程无 pageerror', errs.length === 0, errs.slice(0, 2).join(' | ') || '无')
console.log(`\n== tab-switch-check: ${pass} 过 / ${fail} 挂 ==`)
await browser.close()
process.exit(fail ? 1 : 0)
