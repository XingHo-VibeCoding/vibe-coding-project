/* NumberWheel 触屏手感回归（2026-09-30 Day 15 收尾遗留项）
   背景：本组件原本把滚动交给浏览器（原生滚动 + scroll-snap-type:y mandatory），
   与 TimeWheel 改造前同病（慢滑跟手比只有 0.56~0.80 = 拖沓、原生惯性无上限 = 太快）。
   本轮改成与 TimeWheel 同款自接管，差别只在「非循环 → 首尾夹紧」。断言口径：

   - 跟手：拖动中内容位移 / 手指位移 = 1.00
   - 逐帧：每步位移贴合手指步长（无跳格、无僵硬帧）
   - 可控：松手甩动格数随速度单调不减，且封顶 FLING_MAX_STEPS
   - 边界：到最小值/最大值后继续朝外拖不越界（含快甩，最易漏）
   - 点选、值同步、样式（touch-action:none / 无 snap）

   测量注意（继承 tmp/wheel-touch-gesture-check.mjs，别改回去）：
   - 触摸事件在渲染主线程排队，紧跟其后读 scrollTop 会读到上一帧 → 读前先 wait 80ms
   - 松手速度用**最后两帧间隔**算，不能用「总位移/总耗时」（含停顿会严重低估）
   - CDP 合成的**第一个 touchmove 会被平台 touch slop 吞掉**（发 12 次只投递 11 次）
   跑法：先起 dev server（4177）再 node tmp/numberwheel-touch-check.mjs
   URL 可用 NW_URL 覆盖（对 dist 产物 / 线上跑同一套断言） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

const URL = process.env.NW_URL || 'http://127.0.0.1:4177/'
const ROW = 40
const MAX_FLING = 8 // 与 wheelPhysics.FLING_MAX_STEPS 对齐
const WEEKS_MIN = 1
const WEEKS_MAX = 30
const COUNT = WEEKS_MAX - WEEKS_MIN + 1 // 30
const MAX_TOP = (COUNT - 1) * ROW // 1160
const MID_WEEKS = 18 // 默认值，上下都有空间
const topOf = (w) => (w - WEEKS_MIN) * ROW

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))

const rawTop = () => page.evaluate(() => document.querySelector('.wheel').scrollTop)
const hlVal = async () => {
  const s = await page.locator('.wheel button.text-primary-600').first().innerText()
  return parseInt(String(s).replace(/[^\d]/g, ''), 10)
}
const scrollTo = async (top) => {
  await page.evaluate((v) => {
    document.querySelector('.wheel').scrollTop = v
  }, top)
  await page.waitForTimeout(340) // 让 onScroll 兜底 snap 跑完
}

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.locator('text=直接填学期信息，自己加课').click()
  await page.waitForTimeout(350)
  const before = await page.locator('.wheel').count()
  await page.locator('[data-ob-weeks]').click()
  await page.waitForTimeout(900)
  const after = await page.locator('.wheel').count()
  t('A0 number picker 打开后页面上只有一个滚轮（定位不歧义）', after === 1, `打开前 ${before} 个 → 打开后 ${after} 个`)

  /* ---- 样式：自接管的两个标志 ---- */
  const style = await page.evaluate(() => {
    const el = document.querySelector('.wheel')
    const cs = getComputedStyle(el)
    return { touchAction: cs.touchAction, snap: cs.scrollSnapType }
  })
  t('G1 .wheel 已是 touch-action:none（浏览器不再原生滚动这一列）', style.touchAction === 'none', style.touchAction)
  t('G2 .wheel 自身 scroll-snap-type 为 none（原生那套已删）', String(style.snap).startsWith('none'), style.snap)

  const cdp = await ctx.newCDPSession(page)
  const box = await page.locator('.wheel').first().boundingBox()
  const cx = Math.round(box.x + box.width / 2)
  const cy = Math.round(box.y + box.height / 2)
  const send = (type, y) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: cx, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }],
    })
  /* 手搓一次滑动：间隔在「移动之前」，最后一发移完立刻抬手 → 松手速度 = stepPx / 最后两帧间隔。
     stepPx>0 表示手指下移（内容往「更小的值」走）。 */
  async function swipe(moves, stepPx, dt, sampleDuring = false) {
    await send('touchStart', cy)
    const marks = []
    const seq = []
    for (let i = 1; i <= moves; i++) {
      await page.waitForTimeout(dt)
      marks.push(Date.now())
      await send('touchMove', cy + i * stepPx)
      if (sampleDuring) {
        await page.waitForTimeout(80)
        seq.push(await rawTop())
      }
    }
    const gap = (marks[marks.length - 1] - marks[marks.length - 2]) / 1000
    return { seq, finger: moves * stepPx, v: Math.round(stepPx / Math.max(gap, 0.001)) }
  }

  console.log('\n=== A. 跟手（慢拖 12 步 × 10px）===')
  await scrollTo(topOf(MID_WEEKS))
  const a0 = await rawTop()
  const sA = await swipe(12, 10, 30, true)
  const liveTop = await rawTop()
  await send('touchEnd', cy + sA.finger)
  await page.waitForTimeout(600)
  const ratio = Math.abs(liveTop - a0) / sA.finger
  t('A1 拖动中跟手比 = 1.00（原生 + mandatory 版实测只有 ~0.8）', Math.abs(ratio - 1) <= 0.05, ratio.toFixed(2))
  const steps = sA.seq.map((p, i) => Math.round(p - (i === 0 ? a0 : sA.seq[i - 1])))
  const moved = steps.filter((s) => Math.abs(s) >= 0.5).map((x) => Math.abs(x))
  t(
    'A2 逐帧位移贴合手指步长（无 40px 跳格；首帧因 touchmove 被吞而累积两帧）',
    moved.slice(1).every((x) => x >= 8 && x <= 12) && (moved[0] || 0) <= 22,
    moved.join(' ')
  )
  t('A3 僵硬帧（手指动内容不动）≤1', steps.filter((s) => Math.abs(s) < 0.5).length <= 1, `${steps.filter((s) => Math.abs(s) < 0.5).length}/${steps.length}`)

  console.log('\n=== B. 可控（固定手势：4 步 × 40px = 160px ≈ 4 格）===')
  const rows = []
  for (const [name, dt] of [['很慢', 60], ['慢', 30], ['中', 14], ['快', 8], ['很快', 4]]) {
    await scrollTo(topOf(MID_WEEKS))
    const b0 = await rawTop()
    const s = await swipe(4, 40, dt)
    await send('touchEnd', cy + 160)
    await page.waitForTimeout(900)
    const items = Math.abs((await rawTop()) - b0) / ROW
    rows.push({ name, v: s.v, items })
    console.log(`   ${name}：手指末速 ${s.v}px/s → 总位移 ${items.toFixed(1)} 格（拖动 4 格）`)
  }
  const speeds = rows.map((r) => r.v)
  t('B1 速度档确实拉开了（最快/最慢 ≥2×，说明测量有效）', speeds[speeds.length - 1] >= speeds[0] * 2, `${speeds[speeds.length - 1]}/${speeds[0]} = ${(speeds[speeds.length - 1] / speeds[0]).toFixed(1)}×`)
  t('B2 按实测速度排序后，甩动格数单调不减', (() => {
    const s = [...rows].sort((a, b) => a.v - b.v)
    return s.every((r, i) => i === 0 || r.items >= s[i - 1].items - 0.5)
  })(), rows.map((r) => `${r.name} ${r.items.toFixed(1)}`).join(' / '))
  t('B3 慢拖档松手额外甩动很小（≤ 拖动 4 格 + 2 格）', rows[0].items <= 4 + 2, `${rows[0].items.toFixed(1)} 格（末速 ${rows[0].v}px/s）`)
  t(`B4 快甩有上限（≤ 拖动格数 + ${MAX_FLING} 格）`, rows[rows.length - 1].items <= 4 + MAX_FLING + 1.5, `${rows[rows.length - 1].items.toFixed(1)} 格`)

  console.log('\n=== C. 首尾夹紧（非循环：越界必须被挡住）===')
  await scrollTo(0) // 值 = 1（最小）
  const cStart = await rawTop()
  const sC = await swipe(3, 40, 30) // 手指下移，本该让内容走到 -3 格
  const cMid = await rawTop()
  await send('touchEnd', cy + 120)
  await page.waitForTimeout(700)
  t('C1 最小值处继续朝外拖：位置不越界（停在 0）', cMid === 0 && (await rawTop()) === 0, `拖动中 ${cMid} → 落定 ${await rawTop()}（起点 ${cStart}）`)
  t('C2 最小值处高亮仍是第 1 周', (await hlVal()) === WEEKS_MIN, String(await hlVal()))

  await scrollTo(MAX_TOP) // 值 = 30（最大）
  const dStart = await rawTop()
  const sD = await swipe(3, -40, 30) // 手指上移，本该让内容走到 +3 格
  const dMid = await rawTop()
  await send('touchEnd', cy - 120)
  await page.waitForTimeout(700)
  t('C3 最大值处继续朝外拖：位置不越界（停在 max）', dMid === MAX_TOP && (await rawTop()) === MAX_TOP, `拖动中 ${dMid} → 落定 ${await rawTop()}（起点 ${dStart}）`)
  t('C4 最大值处高亮仍是第 30 周', (await hlVal()) === WEEKS_MAX, String(await hlVal()))

  await scrollTo(MAX_TOP)
  const sE = await swipe(3, -40, 6) // 边界 + 快甩：steps 会把 target 推到界外，必须夹住
  await send('touchEnd', cy - 120)
  await page.waitForTimeout(900)
  t('C5 最大值处快甩：仍被夹在 max（这条最易漏，steps 会把目标推到界外）', (await rawTop()) === MAX_TOP && (await hlVal()) === WEEKS_MAX, `top=${await rawTop()} 值=${await hlVal()}（末速 ${sE.v}px/s）`)

  console.log('\n=== D. 点选与值同步 ===')
  await page.locator('.wheel [data-wheel-val="20"]').click()
  await page.waitForTimeout(500)
  t('D1 点第 20 周：跳到准确位置（top = 19×40）', (await rawTop()) === topOf(20), `top=${await rawTop()} 期望 ${topOf(20)}`)
  t('D2 点选后高亮同步为 20 周', (await hlVal()) === 20, String(await hlVal()))

  await scrollTo(topOf(25))
  await swipe(3, 40, 30)
  await send('touchEnd', cy + 120)
  await page.waitForTimeout(700)
  const dTop = await rawTop()
  t('D3 拖动后高亮值 = scrollTop 对应值（emit 同步）', (await hlVal()) === Math.round(dTop / ROW) + WEEKS_MIN, `top=${dTop} 高亮=${await hlVal()}`)

  await ctx.close()
} catch (e) {
  console.log('EXCEPTION:', e.message)
  results.push(['异常中断', false])
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r[1])
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log('  FAIL ' + f[0])
  process.exit(1)
}
