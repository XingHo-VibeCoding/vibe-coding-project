/* 诊断 v1.27 两个反馈（2026-09-30）
   Q1「高速滑动不够丝滑」：量两件事
      A. 拖动阶段：每次 touchmove 的内容位移（跟手比、均匀度）
      B. 松手瞬间：内容速度是否连续 —— 拖动末速 vs 动画首帧速度
         （速度突变 = 顿挫感的来源；固定时长 + easeOutCubic 会让快甩时首速反而低于手指速度）
   Q2「点 8:45 没反应」：
      C. 引导页节次行里哪些元素真的可点（开始时间 vs 结束时间）
      D. 时间滚轮面板内，纵向各高度的 elementFromPoint 命中（查 mask 渐隐区是否吃掉点击）

   跑法：先起 dev server（4177）再 node tmp/diag-v127.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'
const ROW = 40
const SPAN = 60 * ROW

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
await page.waitForTimeout(500)

/* ================= C. 引导页节次行：哪些元素可点 ================= */
console.log('=== C. 引导页第 1 节那一行的结构 ===')
const row = page.locator('[data-ob-period-row="1"]')
console.log('行内文本：', (await row.innerText()).replace(/\n/g, ' ｜ '))
const kids = await row.evaluate((el) =>
  Array.from(el.children).map((n) => ({ tag: n.tagName, text: (n.innerText || '').trim() }))
)
console.log('直接子元素：', JSON.stringify(kids))

async function tapTextInRow(text) {
  const box = await row.evaluate((el, t) => {
    const n = Array.from(el.querySelectorAll('*')).find((x) => x.children.length === 0 && x.textContent.trim() === t)
    if (!n) return null
    const r = n.getBoundingClientRect()
    return { tag: n.tagName, x: r.x + r.width / 2, y: r.y + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) }
  }, text)
  if (!box) return { text, found: false }
  await page.touchscreen.tap(box.x, box.y)
  await page.waitForTimeout(450)
  const opened = (await page.locator('.wheel').count()) > 0
  if (opened) {
    await page.locator('text=取消').click()
    await page.waitForTimeout(350)
  }
  return { text, found: true, tag: box.tag, size: `${box.w}x${box.h}`, pickerOpened: opened }
}
console.log('点开始时间 08:00 →', JSON.stringify(await tapTextInRow('08:00')))
console.log('点结束时间 08:45 →', JSON.stringify(await tapTextInRow('08:45')))

/* ================= D + A + B：打开时间滚轮 ================= */
await row.locator('button').first().click()
await page.waitForTimeout(600)
const wheels = await page.locator('.wheel').count()
console.log('\n=== D. 时间滚轮面板 ===')
console.log('打开的面板里 .wheel 列数：', wheels)
if (!wheels) {
  console.log('面板没打开，后续诊断跳过')
  await ctx.close()
  await browser.close()
  process.exit(1)
}

const hitMap = await page.evaluate(() => {
  const col = document.querySelectorAll('.wheel')[1]
  const cr = col.getBoundingClientRect()
  const out = []
  for (let y = cr.top + 6; y < cr.bottom - 4; y += 8) {
    const e = document.elementFromPoint(cr.left + cr.width / 2, y)
    out.push({
      y: Math.round(y - cr.top),
      tag: e ? e.tagName : 'null',
      text: e ? (e.textContent || '').trim().slice(0, 4) : '',
    })
  }
  return { colH: Math.round(cr.height), rows: out }
})
console.log(`列高 ${hitMap.colH}px；纵向每 8px 取样 elementFromPoint：`)
let lastSig = ''
for (const r of hitMap.rows) {
  const sig = `${r.tag}:${r.text}`
  if (sig !== lastSig) {
    console.log(`  y=${String(r.y).padStart(3)} → ${r.tag === 'BUTTON' ? '按钮' : r.tag} ${r.text}${r.tag === 'BUTTON' ? ' ✓可点' : ' ✗点不到按钮'}`)
    lastSig = sig
  }
}

/* ================= A. 拖动阶段：跟手与均匀度 ================= */
const cdp = await ctx.newCDPSession(page)
const box = await page.locator('.wheel').nth(1).boundingBox()
const cx = Math.round(box.x + box.width / 2)
const cy = Math.round(box.y + box.height / 2)

await page.evaluate(() => {
  const col = document.querySelectorAll('.wheel')[1]
  window.__drag = []
  window.__after = []
  col.addEventListener('touchmove', () => window.__drag.push({ t: performance.now(), top: col.scrollTop }), { passive: true })
  col.addEventListener('touchend', () => {
    const t0 = performance.now()
    const step = () => {
      window.__after.push({ t: performance.now() - t0, top: col.scrollTop })
      if (performance.now() - t0 < 800) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, { passive: true })
})

const send = (type, y) =>
  cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: cx, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }],
  })
const rawTop = () => page.evaluate(() => document.querySelectorAll('.wheel')[1].scrollTop)
const delta = (a, b) => {
  let d = (((b - a) % SPAN) + SPAN) % SPAN
  if (d > SPAN / 2) d -= SPAN
  return d
}
const reset = async () => {
  await page.evaluate((t) => { document.querySelectorAll('.wheel')[1].scrollTop = t }, SPAN + SPAN / 2)
  await page.waitForTimeout(350)
  await page.evaluate(() => { window.__drag = []; window.__after = [] })
}

console.log('\n=== A. 高速拖动：每次 touchmove 的内容位移（手指每步 40px）===')
{
  await reset()
  const a0 = await rawTop()
  await send('touchStart', cy)
  const t0 = Date.now()
  for (let i = 1; i <= 6; i++) {
    await send('touchMove', cy - i * 40) // 手指上移 = 内容前进
    if (i < 6) await page.waitForTimeout(16)
  }
  const elapsed = Math.max(1, Date.now() - t0)
  const drag = await page.evaluate(() => window.__drag)
  const liveTop = await rawTop()
  const segs = []
  for (let i = 0; i < drag.length; i++) segs.push(Math.round(delta(i === 0 ? a0 : drag[i - 1].top, drag[i].top)))
  console.log(`手势 240px / ${elapsed}ms ≈ ${Math.round(240 / (elapsed / 1000))}px/s`)
  console.log(`touchmove 次数 ${drag.length}（CDP 派发 6 次；少于 6 = 事件被合并，真机同理）`)
  console.log(`每次位移(px)：${segs.join(' ')}   ← 都是 40 = 1:1 跟手；出现 0 或 80 = 不均匀`)
  console.log(`跟手比：${(Math.abs(delta(a0, liveTop)) / 240).toFixed(2)}`)

  /* B. 松手瞬间速度连续性：复刻组件内部的速度估算（同窗口、同公式），
     再用「前 3 帧」估动画首速（单帧受 rAF 抖动影响太大） */
  const V_WINDOW = 90
  const dragV = (() => {
    if (drag.length < 2) return 0
    const last = drag[drag.length - 1]
    let first = drag[drag.length - 2]
    for (let i = drag.length - 2; i >= 0; i--) {
      if (last.t - drag[i].t <= V_WINDOW) first = drag[i]
      else break
    }
    const dt = last.t - first.t
    return dt > 0 ? ((last.top - first.top) / dt) * 1000 : 0 // 正 = 内容前进
  })()
  const steps = Math.sign(dragV) * Math.min(8, Math.max(1, Math.round(Math.abs(dragV) / 320)))
  const dist = steps * ROW
  // flingDuration 返回「秒」，这里统一成 ms；clamp 与组件内常量一致（0.18s / 0.5s）
  const expectT = Math.min(0.5, Math.max(0.18, (Math.abs(dist) * 3) / Math.abs(dragV || 1))) * 1000
  console.log(
    `\n组件按此速度会算出：v=${Math.round(dragV)}px/s → 滑 ${steps} 格（${dist}px）→ 时长 ${Math.round(expectT)}ms → 理论首速 ${Math.round((Math.abs(dist) * 3) / (expectT / 1000))}px/s`
  )
  await send('touchEnd', cy - 240)
  await page.waitForTimeout(900)
  const after = await page.evaluate(() => window.__after)
  const speeds = []
  for (let i = 1; i < after.length; i++) {
    const dt = after[i].t - after[i - 1].t
    if (dt > 0) speeds.push({ t: Math.round(after[i].t), v: Math.round(((after[i].top - after[i - 1].top) / dt) * 1000) })
  }
  console.log('\n=== B. 松手瞬间：内容速度（正 = 向前）===')
  console.log(`拖动末速（手指速度 = 内容速度，拖动是 1:1）：${Math.round(dragV)}px/s`)
  console.log(`动画逐帧速度：${speeds.slice(0, 12).map((s) => s.v).join(' ')} …`)
  const head3 = after.findIndex((x, i) => i > 0 && x.t > 60) // 取前 60ms 内
  const idx = head3 < 0 ? after.length - 1 : head3
  const headV = idx > 0 ? Math.round(((after[idx].top - after[0].top) / (after[idx].t - after[0].t)) * 1000) : 0
  const firstV = speeds.length ? speeds[0].v : 0
  console.log(`动画首个采样速度（${firstV}px/s）／前 ${Math.round(after[idx].t)}ms 平均（${headV}px/s）`)
  console.log(`  vs 拖动末速 ${Math.round(dragV)}px/s → 首采样比 ${((firstV / (dragV || 1)) * 100).toFixed(0)}%`)
  console.log(`  ← 100% 附近 = 速度连续（丝滑）；修前此值为 149%（1967 vs 1320，松手窜一下）`)
  const total = Math.round(delta(a0, await rawTop()))
  console.log(`总位移 ${total}px = ${(total / ROW).toFixed(1)} 格（拖动 ${Math.abs(delta(a0, liveTop))}px + 甩动 ${Math.abs(dist)}px）`)
}

await ctx.close()
await browser.close()
