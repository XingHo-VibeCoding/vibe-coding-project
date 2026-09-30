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

const URL = 'http://127.0.0.1:4177/'
const ROW = 40
const SPAN = 60 * ROW
const MAX_FLING = 8 // 与 src/data/wheelPhysics.js 的 FLING_MAX_STEPS 对齐

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
  for (const [name, dt] of [['很慢', 60], ['慢', 30], ['中', 14], ['快', 8], ['很快', 4]]) {
    await reset()
    const b0 = await rawTop()
    const s = await swipe(4, 40, dt)
    await send('touchEnd', cy + 160)
    await page.waitForTimeout(900)
    const items = delta(b0, await rawTop()) / ROW
    rows.push({ name, v: s.v, items: Math.abs(items), extra: Math.abs(items) - dragItems })
    console.log(`   ${name} 松手速度 ${String(s.v).padStart(5)}px/s → 共 ${Math.abs(items).toFixed(1)} 格（其中甩动 ${(Math.abs(items) - dragItems).toFixed(1)} 格，落点 ${await val()}）`)
  }
  const maxItems = Math.max(...rows.map((r) => r.items))
  t(`B1 一次快甩总格数有上限（≤ ${dragItems + MAX_FLING} 格）`, maxItems <= dragItems + MAX_FLING + 0.5, maxItems.toFixed(1))
  const sorted = [...rows].sort((a, b) => a.v - b.v)
  const mono = sorted.every((r, i) => i === 0 || r.extra >= sorted[i - 1].extra - 0.5)
  t('B2 按实测速度排序后，甩动格数单调不减', mono, sorted.map((r) => `${r.v}→${r.extra.toFixed(1)}`).join(' '))
  const slowest = sorted[0]
  t('B3 最慢档松手几乎不额外甩动（≤2 格）', slowest.extra <= 2.5, `${slowest.v}px/s → 额外 ${slowest.extra.toFixed(1)} 格`)
  const vSpread = sorted[sorted.length - 1].v / sorted[0].v
  t('B4 速度档确实拉开了（最快/最慢 ≥2×，测量有效）', vSpread >= 2, `${vSpread.toFixed(1)}×`)

  console.log('\n=== C. 循环（一直朝一个方向拖，永不到底）===')
  await reset()
  const startVal = await val()
  const seen = []
  for (let round = 0; round < 3; round++) {
    await send('touchStart', cy)
    for (let i = 1; i <= 12; i++) await send('touchMove', cy - i * 10) // 手指上移 120px = 往后 3 格
    await send('touchEnd', cy - 120)
    await page.waitForTimeout(700)
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
  await page.waitForTimeout(700)
  t('C4 反方向也通（下移手指 → 值递减）', Number(await val()) < Number(seen[2]), `${seen[2]} → ${await val()}`)

  await ctx.close()
} catch (e) {
  console.log('ERROR:', e.message)
  results.push(['无异常跑完', false])
}

await browser.close()
const fails = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
