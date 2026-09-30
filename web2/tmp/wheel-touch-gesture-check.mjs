/* TimeWheel 触屏手感回归断言（2026-09-30 用户反馈「快滑太快、慢滑拖沓」后的固化测试）
   断言口径：
   - 跟手：拖动中内容位移 / 手指位移 = 1.00（旧版交给原生 mandatory 吸附，实测 0.90 且按 40px 跳格）
   - 可控：松手甩动有上限（FLING_MAX_STEPS），总格数 ≤ 拖动格数 + 上限
   - 循环：一直朝一个方向拖，永远到不了底

   测量注意（踩过的坑，别改回去）：
   - 触摸事件在渲染主线程排队，紧跟其后读 scrollTop 可能读到上一帧 → 读「拖动中」位置前要先 wait 80ms
   - 松手速度不能用「总位移/总耗时」（含前面的停顿会严重低估），要用**最后两帧之间的间隔**算
   跑法：先起 dev server（4177）再 node tmp/wheel-touch-gesture-check.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

// URL 可用环境变量 TW_URL 覆盖：线上发布后直接对着线上跑同一套断言
// （发布是在沙箱里重新构建的，产物文件名 hash 与本地 dist 不同，没法靠文件名/hash 比对，
//   行为断言才是「线上跑的确实是这份代码」的硬证据）
const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'
const ROW = 40
const SPAN = 60 * ROW
const MAX_FLING = 30 // 与 src/data/wheelPhysics.js 的 FLING_MAX_STEPS 对齐（第五轮 8 → 30）
/* 甩动动画最长 1.6s（FLING_T_MAX），取样前必须等它彻底跑完。
   旧值是 900ms —— 那是 T_MAX=0.5s 时代的余量；第五轮时长变成 ~1.2s 后，
   900ms 会在动画中途取样，量到的位移偏小 = 断言假绿。 */
const SETTLE_MS = 1800

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))

const rawTop = () => page.evaluate(() => document.querySelectorAll('.wheel')[1].scrollTop)
const val = async () => (await page.locator('.wheel').nth(1).locator('button.text-primary-600').first().innerText()).trim()
const delta = (a, b) => {
  let d = (((b - a) % SPAN) + SPAN) % SPAN
  if (d > SPAN / 2) d -= SPAN
  return d
}
/* 「视觉位移」：三份内容相位相同，位移恰好是整数份时渲染完全一样 = 用户看不见。
   非整份的位移才是用户真正看到的滚动。用于钉住「跨份边界松手空转一整圈」这个 bug。
   抖动阈值只能取 1px（不能用 ROW/2）：缓动的每帧位移可能只有十几 px，
   阈值开大就会把真实的可见滚动吃掉，断言变成永远 PASS 的假绿（D4 踩过）。 */
const visualDelta = (d) => {
  if (Math.abs(d) < 1) return 0
  const k = Math.round(d / SPAN)
  if (k !== 0 && Math.abs(d - k * SPAN) < ROW) return 0
  return d
}
const visualItems = (tops) => {
  let sum = 0
  for (let i = 1; i < tops.length; i++) sum += Math.abs(visualDelta(tops[i] - tops[i - 1]))
  return sum / ROW
}

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.locator('text=直接填学期信息，自己加课').click()
  await page.waitForTimeout(300)
  await page.locator('[data-ob-time]').click()
  await page.waitForTimeout(400)
  await page.locator('[data-ob-period-row="1"] button').first().click()
  await page.waitForTimeout(800)

  const cdp = await ctx.newCDPSession(page)
  const box = await page.locator('.wheel').nth(1).boundingBox()
  const cx = Math.round(box.x + box.width / 2)
  const cy = Math.round(box.y + box.height / 2)
  const send = (type, y) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: cx, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }],
    })
  const reset = async () => {
    await page.evaluate((t) => {
      document.querySelectorAll('.wheel')[1].scrollTop = t
    }, SPAN + SPAN / 2)
    await page.waitForTimeout(320)
  }
  /* 手搓一次滑动：间隔放在「移动之前」，最后一发移完立刻抬手 → 松手速度 = stepPx / 最后两帧间隔。
     sampleDuring=true 时逐帧记录位置（用于看顺滑度）。 */
  async function swipe(moves, stepPx, dt, sampleDuring = false) {
    await send('touchStart', cy)
    const marks = []
    const seq = []
    for (let i = 1; i <= moves; i++) {
      await page.waitForTimeout(dt)
      marks.push(Date.now())
      await send('touchMove', cy + i * stepPx)
      if (sampleDuring) {
        await page.waitForTimeout(80) // 等触摸事件落到主线程，避免读到上一帧
        seq.push(await rawTop())
      }
    }
    const gap = (marks[marks.length - 1] - marks[marks.length - 2]) / 1000
    return { seq, finger: moves * stepPx, v: Math.round(stepPx / Math.max(gap, 0.001)) }
  }

  console.log('=== A. 跟手（慢拖 12 步 × 10px）===')
  await reset()
  const a0 = await rawTop()
  const sA = await swipe(12, 10, 30, true)
  const liveTop = await rawTop()
  await send('touchEnd', cy + sA.finger)
  await page.waitForTimeout(600)

  const liveDelta = delta(a0, liveTop)
  const ratio = Math.abs(liveDelta) / sA.finger
  t('A1 拖动中跟手比 = 1.00（旧版实测 0.90）', Math.abs(ratio - 1) <= 0.05, ratio.toFixed(2))
  const steps = sA.seq.map((p, i) => delta(i === 0 ? a0 : sA.seq[i - 1], p))
  const moved = steps.filter((s) => Math.abs(s) >= 0.5).map((s) => Math.round(Math.abs(s)))
  // 首帧例外：CDP 合成的第一个 touchmove 会被平台 touch slop 吞掉（12 次只投递 11 次），
  // 于是第一次读到的位移是「两帧手指位移」= 20px。页面内埋点已核实：每个真投递的事件都是精确 10px。
  t('A2 逐帧位移贴近手指步长（无 40px 跳格；首帧因触摸事件被吞而累积两帧=20px）', moved.slice(1).every((x) => x >= 8 && x <= 12) && moved[0] <= 22, moved.join(' '))
  t('A3 僵硬帧（手指动内容不动）≤1', steps.filter((s) => Math.abs(s) < 0.5).length <= 1, String(steps.filter((s) => Math.abs(s) < 0.5).length) + '/' + steps.length)
  t('A4 拖动位移不放大（不超手指位移）', Math.abs(liveDelta) <= sA.finger + 2, `${Math.abs(Math.round(liveDelta))} ≤ ${sA.finger}`)

  console.log('\n=== B. 可控（固定手势：4 步 × 40px = 160px 手指位移 ≈ 4 格）===')
  const dragItems = 4
  const rows = []
  /* 「轻放」档是第五轮新增：验证速度低于 FLING_MIN_V=150 时不甩、只吸附。
     旧版拿「很慢」档(dt=60 ≈ 615px/s)当轻放，但那个速度按新灵敏度该甩 6 格了，
     语义不再成立 —— 真正的轻放要更慢的手势。 */
  for (const [name, dt] of [['轻放', 300], ['很慢', 60], ['慢', 30], ['中', 14], ['快', 8], ['很快', 4]]) {
    await reset()
    const b0 = await rawTop()
    const s = await swipe(4, 40, dt)
    await page.waitForTimeout(80) // 等触摸事件落到主线程再读，否则读到上一帧
    const mid = await rawTop() // touchend 前的拖动终点（此时还没做整数份归一化）
    await send('touchEnd', cy + 160)
    await page.waitForTimeout(SETTLE_MS)
    const end = await rawTop()
    /* 两个坑（都踩过）：
       ① visualItems() 返回的**已经是格数**（内部 sum/ROW），不能再除一次 ROW
          —— 第一版多除了一次，4 格被算成 0.1 格，B 段数字全部失真；
       ② 不能用 delta(b0, end)：delta 按 SPAN 取模，只能表达 ±半圈（±30 格）。
          第五轮一次快甩 = 4 格拖动 + 30 格甩动 = 34 格 > 30 格，取模会折返成 26 格，
          「很快」档反而小于「快」档 → 单调性断言假失败（不是产品 bug，是尺子坏了）。
       用三段采样 [起点, 松手前, 落定]：每段都远小于半圈，且 visualDelta 能识别
       「整数份瞬移」不计入视觉位移。 */
    const items = visualItems([b0, mid, end])
    rows.push({ name, v: s.v, items: Math.abs(items), extra: Math.abs(items) - dragItems })
    console.log(`   ${name} 松手速度 ${String(s.v).padStart(5)}px/s → 共 ${Math.abs(items).toFixed(1)} 格（其中甩动 ${(Math.abs(items) - dragItems).toFixed(1)} 格，落点 ${await val()}）`)
  }
  const maxItems = Math.max(...rows.map((r) => r.items))
  t(`B1 一次快甩总格数有上限（≤ ${dragItems + MAX_FLING} 格）`, maxItems <= dragItems + MAX_FLING + 0.5, maxItems.toFixed(1))
  const sorted = [...rows].sort((a, b) => a.v - b.v)
  /* 端到端做「严格全序单调」在这里不可靠：CDP 往返 + 定时器精度让 dt=8 与 dt=4
     两档的实际帧间隔几乎相同（实测 gap 都在 15ms 上下），按 s.v 排出来的顺序会被噪声打乱，
     于是格数出现小幅倒挂（不是产品 bug，是两个档位在测量上没拉开）。
     「速度 → 格数」的严格单调性由纯函数单测保证（tmp/wheel-physics-unit.mjs 的扫描断言），
     这里只验证端到端趋势：最快档明显比最慢档滑得远。 */
  const mono = sorted[sorted.length - 1].extra >= sorted[0].extra + 10
  t('B2 端到端趋势：最快档甩动格数 ≥ 最慢档 + 10', mono, sorted.map((r) => `${r.v}→${r.extra.toFixed(1)}`).join(' '))
  const slowest = sorted[0]
  t('B3 轻放档（低于 FLING_MIN_V=150）不产生甩动，只吸附到最近格', slowest.extra <= 0.5, `${slowest.v}px/s → 额外 ${slowest.extra.toFixed(1)} 格`)
  const vSpread = sorted[sorted.length - 1].v / sorted[0].v
  t('B4 速度档确实拉开了（最快/最慢 ≥2×，测量有效）', vSpread >= 2, `${vSpread.toFixed(1)}×`)
  const fastest = sorted[sorted.length - 1]
  t('B5 快甩档甩动 ≥18 格（第五轮用户诉求「惯性大一点、能到 30 个数」；旧版封顶 8 格）', fastest.extra >= 18, `${fastest.v}px/s → 甩动 ${fastest.extra.toFixed(1)} 格`)

  console.log('\n=== C. 循环（一直朝一个方向拖，永不到底）===')
  await reset()
  const startVal = await val()
  const seen = []
  for (let round = 0; round < 3; round++) {
    await send('touchStart', cy)
    for (let i = 1; i <= 12; i++) await send('touchMove', cy - i * 10) // 手指上移 120px = 往后 3 格
    await send('touchEnd', cy - 120)
    await page.waitForTimeout(SETTLE_MS)
    seen.push(await val())
  }
  t('C1 连续同向拖动 3 轮，值持续变化（未卡边界）', new Set(seen).size === 3, seen.join(' → '))
  t('C2 方向正确（上移手指 → 值递增）', Number(seen[0]) > Number(startVal), `${startVal} → ${seen[0]}`)
  const r = await page.evaluate(() => {
    const el = document.querySelectorAll('.wheel')[1]
    return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight }
  })
  t('C3 位置始终在可滚范围内（没被夹到 0 或到底）', r.top > 0 && r.top < r.max, `top=${Math.round(r.top)} max=${Math.round(r.max)}`)
  await send('touchStart', cy)
  for (let i = 1; i <= 12; i++) await send('touchMove', cy + i * 10)
  await send('touchEnd', cy + 120)
  await page.waitForTimeout(SETTLE_MS)
  t('C4 反方向也通（下移手指 → 值递减）', Number(await val()) < Number(seen[2]), `${seen[2]} → ${await val()}`)

  console.log('\n=== D. 跨份边界松手不空转（分钟从 58 拖到 2，跨过 59/0）===')
  /* 页面内 rAF 全程记录 scrollTop：跨份瞬移与动画首帧发生在 touchend 的同一个任务里，
     CDP 往返回合之间会漏掉，只在页面里采才拿得到真序列。 */
  const traceStart = () =>
    page.evaluate(() => {
      window.__recEl = document.querySelectorAll('.wheel')[1]
      window.__trace = []
      window.__rec = true
      if (!window.__tracing) {
        window.__tracing = true
        const loop = () => {
          if (window.__rec) window.__trace.push(window.__recEl.scrollTop)
          requestAnimationFrame(loop)
        }
        requestAnimationFrame(loop)
      }
    })
  const traceStop = () =>
    page.evaluate(() => {
      window.__rec = false
      return window.__trace
    })

  await page.evaluate((t) => {
    document.querySelectorAll('.wheel')[1].scrollTop = t
  }, SPAN + 58 * ROW)
  await page.waitForTimeout(SETTLE_MS)
  const dStartVal = await val()
  const dStartTop = await rawTop()
  await traceStart()
  /* 手指上移（值递增）4 格：58 → 59 → 00 → 01 → 02，必然跨过循环边界。
     手写在段内而不复用 swipe()：swipe 是「手指下移」方向，反了就到不了 59/0。
     末帧后等 80ms 再读位置（触摸事件在主线程排队，紧跟其后读会读到上一帧）。 */
  await send('touchStart', cy)
  for (let i = 1; i <= 4; i++) {
    await page.waitForTimeout(300)
    await send('touchMove', cy - i * 40)
  }
  await page.waitForTimeout(80)
  const dMid = await rawTop()
  await send('touchEnd', cy - 160)
  await page.waitForTimeout(SETTLE_MS)
  const traceD = await traceStop()
  const dEndVal = await val()
  const dEnd = await rawTop()

  const segBefore = Math.floor(dStartTop / SPAN)
  const segAfter = Math.floor(dMid / SPAN)
  const movedItems = Math.round(delta(dStartTop, dMid) / ROW)
  const dVisual = visualItems([...traceD, dEnd])
  t(
    'D1 拖动确实跨出了中间份（复现条件成立：起点在中间份，松手前已越界）',
    segBefore === 1 && segAfter === 2,
    `份 ${segBefore} → ${segAfter}，top ${Math.round(dStartTop)} → ${Math.round(dMid)}`
  )
  t('D2 跨边界落点值 = 起点 + 实际拖动格数', Number(dEndVal) === (58 + movedItems) % 60, `58 + ${movedItems} → ${dEndVal}`)
  t(
    'D3 整个手势视觉位移 ≈ 拖动格数（松手不额外空转；bug 版 ≈ 拖动格数 + 60 格 = 转一整圈）',
    dVisual <= movedItems + 1.5,
    `视觉 ${dVisual.toFixed(1)} 格 vs 拖动 ${movedItems} 格，采样 ${traceD.length} 帧`
  )
  console.log(`   拖动 top ${Math.round(dStartTop)} → ${Math.round(dMid)} → 落定 ${Math.round(dEnd)}（采样 ${traceD.length} 帧）`)

  /* D4：跨边界 + 快甩。快甩才会叠加惯性，也是最容易「跨份 + 甩动」叠在一起出错的一档。 */
  await page.evaluate((t) => {
    document.querySelectorAll('.wheel')[1].scrollTop = t
  }, SPAN + 58 * ROW)
  await page.waitForTimeout(SETTLE_MS)
  const d4StartTop = await rawTop()
  await traceStart()
  await send('touchStart', cy)
  for (let i = 1; i <= 4; i++) {
    await page.waitForTimeout(8)
    await send('touchMove', cy - i * 40)
  }
  await page.waitForTimeout(60)
  const d4Mid = await rawTop()
  await send('touchEnd', cy - 160)
  await page.waitForTimeout(SETTLE_MS)
  const traceD4 = await traceStop()
  const d4End = await rawTop()
  const d4Moved = Math.round(delta(d4StartTop, d4Mid) / ROW)
  const d4Visual = visualItems([...traceD4, d4End])
  t(
    `D4 跨边界快甩：视觉位移 ≤ 拖动格数 + 甩动封顶 ${MAX_FLING} 格（bug 版会多出 60 格整圈）`,
    d4Visual <= d4Moved + MAX_FLING + 1.5,
    `视觉 ${d4Visual.toFixed(1)} 格，拖动 ${d4Moved} 格，落点 ${await val()}`
  )

  console.log('\n=== E. 松手处速度连续（动画时长由松手速度反推）===')
  /* 「高速滑动不够丝滑」的量化口径：松手瞬间内容速度若突变，用户就会觉得窜/顿。
     时长公式 dist×3÷v 与「动画首帧速度 = 手指末速」是等价的（easeOutCubic 首帧增益恒为 3），
     而「时长」比「单帧速度」稳得多（headless 的 rAF 单帧只有十几 ms、噪声大，第一版就栽在这）。
     修前用固定时长（150 + 格数×26ms）：中速甩动实得 ~228ms，而速度反推要求 ~390ms → 差 70%。
     注意：touchend 里有一次「整数份瞬移」（视觉不可见），读 scrollTop 必须按份取模（delta），
     否则会读到 2400px 级的假跳变。 */
  await reset()
  await page.evaluate(() => {
    const el = document.querySelectorAll('.wheel')[1]
    window.__ts = []
    window.__tsMark = -1
    window.__recTs = true
    // 分界：拖动阶段与动画阶段的速度方向相同，必须只取 touchend 之后的帧。
    // 组件在 mount 时就注册了 touchend，这里后注册 → 回调在 finish() 之后跑，正好标记边界。
    el.addEventListener('touchend', () => { window.__tsMark = window.__ts.length }, { passive: true, once: true })
    if (!window.__tsLoop) {
      window.__tsLoop = true
      const loop = () => {
        if (window.__recTs) window.__ts.push([performance.now(), el.scrollTop])
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    }
  })
  await swipe(4, 40, 30) // 中速：第五轮 perStep=100 后位移 11 格，速度反推时长 ~1.15s
  await send('touchEnd', cy + 160)
  await page.waitForTimeout(SETTLE_MS)
  const tsE = await page.evaluate(() => {
    window.__recTs = false
    return { list: window.__ts, mark: window.__tsMark }
  })
  const from = tsE.mark > 1 ? tsE.mark : 1
  const dragPts = tsE.list.slice(0, from)
  /* 复刻组件的速度估算（velocityFromSamples：90ms 窗口、用最后两帧兜底）。
     拖动是 1:1 跟手，所以 top 的变化就等价于 clientY 的变化（方向相反取正）。 */
  const dragV = (() => {
    if (dragPts.length < 2) return 0
    const last = dragPts[dragPts.length - 1]
    let first = dragPts[dragPts.length - 2]
    for (let i = dragPts.length - 2; i >= 0; i--) {
      if (last[0] - dragPts[i][0] <= 90) first = dragPts[i]
      else break
    }
    const dt = last[0] - first[0]
    return dt > 0 ? (delta(first[1], last[1]) / dt) * 1000 : 0
  })()
  /* 复刻组件的「格数」与「时长」公式，参数必须与 wheelPhysics.js 同步
     （第五轮：perStep 320→100、T_MAX 0.5→1.6；不同步就会拿错误的期望值去比实测） */
  const eSteps = Math.min(MAX_FLING, Math.max(1, Math.round(Math.abs(dragV) / 100)))
  const eDist = eSteps * ROW
  const eExpectMs = Math.min(1.6, Math.max(0.18, (eDist * 3) / Math.abs(dragV || 1))) * 1000
  // 实测动画时长：从 touchend 那帧到「最后一个还在动的帧」
  let lastMoveT = tsE.list[from] ? tsE.list[from][0] : 0
  for (let i = from + 1; i < tsE.list.length; i++) {
    if (Math.abs(delta(tsE.list[i - 1][1], tsE.list[i][1])) >= 0.5) lastMoveT = tsE.list[i][0]
  }
  const eMeasMs = lastMoveT - (tsE.list[from - 1] ? tsE.list[from - 1][0] : lastMoveT)
  const eErr = eExpectMs ? Math.abs(eMeasMs - eExpectMs) / eExpectMs : 1
  console.log(
    `   拖动末速 ${Math.round(dragV)}px/s → 滑 ${eSteps} 格(${eDist}px) → 速度反推时长 ${Math.round(eExpectMs)}ms，实测 ${Math.round(eMeasMs)}ms`
  )
  t(
    'E1 动画时长 = 位移×3÷松手速度（±30%；固定时长版在中速档会短 40% 以上）',
    eErr <= 0.3,
    `实测 ${Math.round(eMeasMs)}ms vs 反推 ${Math.round(eExpectMs)}ms → 偏差 ${(eErr * 100).toFixed(0)}%`,
  )

  await ctx.close()
} catch (e) {
  console.log('ERROR:', e.message)
  results.push(['无异常跑完', false])
}

await browser.close()
const fails = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
