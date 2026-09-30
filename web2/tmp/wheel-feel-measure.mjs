/* TimeWheel 触屏手感量化 v3（2026-09-30 用户反馈「快滑太快、慢滑拖沓」）
   为什么不用 Input.synthesizeScrollGesture：实测在 touch 源下完全不驱动滚动（位移 0）。
   改用 Input.dispatchTouchEvent 手搓触摸流（已验证可驱动）。

   两个测量：
   A. 慢拖顺滑度：手指每走 10px 记录一次内容位置
      → 跟手比（内容位移/手指位移，理想 1.00）+ 僵硬帧数（手指动了内容没动的步数）+ 单步位移分布
   B. 速度扫描：固定手势几何、只改时间间隔 → 实测速度 vs 最终走过格数（看有没有上限）

   注意：循环滚轮会做「整数份平移」（content 重复，视觉无变化），
   所以位移一律按「份」取模取最短路径，否则会读到 2400px 级的假跳变。
   跑法：先起 dev server（4177）再 node tmp/wheel-feel-measure.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = 'http://127.0.0.1:4177/'
const ROW = 40
const SPAN = 60 * ROW // 分钟列一份 = 2400px

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))

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

const rawTop = () => page.evaluate(() => document.querySelectorAll('.wheel')[1].scrollTop)
const val = async () => (await page.locator('.wheel').nth(1).locator('button.text-primary-600').first().innerText()).trim()
/* 按「份」取模，取最短路径的有符号位移（循环滚轮专用） */
const delta = (a, b) => {
  let d = (((b - a) % SPAN) + SPAN) % SPAN
  if (d > SPAN / 2) d -= SPAN
  return d
}
async function reset() {
  await page.evaluate((t) => {
    document.querySelectorAll('.wheel')[1].scrollTop = t
  }, SPAN + SPAN / 2) // 中间份的正中，前后拖动都有半份余量，避免测量被平移干扰
  await page.waitForTimeout(320)
}
async function send(type, y) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: cx, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }],
  })
}

console.log('=== A. 慢拖顺滑度：手指每步 10px × 15 步（约 375px/s）===')
await reset()
const a0 = await rawTop()
await send('touchStart', cy)
const posSeq = []
let t0 = Date.now()
for (let i = 1; i <= 15; i++) {
  await send('touchMove', cy + i * 10)
  await page.waitForTimeout(30)
  posSeq.push(await rawTop()) // 手指还按着 → 读到的是「拖动中」的真实跟手位置
}
const elapsed = Date.now() - t0
const liveTop = await rawTop()
await send('touchEnd', cy + 150)
await page.waitForTimeout(600)
const finalTop = await rawTop()

const finger = 150
const liveDelta = delta(a0, liveTop)
console.log(`速度 ≈ ${Math.round(finger / (elapsed / 1000))}px/s`)
console.log(`起始 ${Math.round(a0)} → 拖动中 ${Math.round(liveTop)}（位移 ${Math.round(liveDelta)}px）→ 松手落定 ${Math.round(finalTop)}（位移 ${Math.round(delta(a0, finalTop))}px）`)
console.log(`跟手比（拖动中位移 / 手指位移）：${(Math.abs(liveDelta) / finger).toFixed(2)}   ← 理想 1.00`)
const steps = []
for (let i = 0; i < posSeq.length; i++) steps.push(delta(i === 0 ? a0 : posSeq[i - 1], posSeq[i]))
const zeroFrames = steps.filter((s) => Math.abs(s) < 0.5).length
const nonZero = steps.filter((s) => Math.abs(s) >= 0.5).map((s) => Math.round(Math.abs(s)))
console.log(`逐步位移(px)：${steps.map((s) => Math.round(s)).join(' ')}`)
console.log(`僵硬帧（手指动了内容没动）：${zeroFrames}/${steps.length}`)
console.log(`有动的帧单步位移：${nonZero.join(' ')}  （越接近 10 越顺滑；出现 40 说明还在按 40px 跳格）`)

console.log('\n=== B. 速度扫描：固定手势（手指共 160px），只改时间间隔 ===')
console.log('档位 │ 实测速度(px/s) │ 手指 │ 松手后总位移 │ 总格数 │ 落点')
const rows = []
for (const [name, dt] of [['很慢', 60], ['慢', 30], ['中', 15], ['快', 8], ['很快', 4], ['极快', 1]]) {
  await reset()
  const b0 = await rawTop()
  await send('touchStart', cy)
  const tt = Date.now()
  for (let i = 1; i <= 4; i++) {
    await send('touchMove', cy + i * 40)
    if (i < 4) await page.waitForTimeout(dt) // 最后一发到抬手之间不留间隔 = 松手速度
  }
  const el = Math.max(1, Date.now() - tt)
  await send('touchEnd', cy + 160)
  await page.waitForTimeout(900)
  const v = Math.round(160 / (el / 1000))
  const d = delta(b0, await rawTop())
  rows.push({ name, v, items: d / ROW })
  console.log(`${name.padEnd(4)} │ ${String(v).padStart(14)} │  160 │ ${String(Math.round(d)).padStart(12)} │ ${(d / ROW).toFixed(1).padStart(6)} │ ${await val()}`)
}

console.log('\n=== 汇总 ===')
const items = rows.map((r) => r.items)
console.log(`总格数范围：${Math.min(...items).toFixed(1)} ~ ${Math.max(...items).toFixed(1)} 格（7 格以内 = 有上限，可控）`)
console.log(`单调性：${items.map((x) => x.toFixed(1)).join(' → ')}`)
console.log(`注：手势本身含拖动约 3~4 格（160px 手指位移，松手后吸附到最近格），其余为松手甩动`)

await ctx.close()
await browser.close()
