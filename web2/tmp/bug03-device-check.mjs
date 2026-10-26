/* 真机：bug 03「录音中今日页卡片也能收缩」（2026-10-23）
 * 前置：adb 在线 + adb forward tcp:9222 ...
 * 跑法：cd web2 && node tmp/bug03-device-check.mjs
 *
 * 做法：先在今日页找到「开始录音」并点它（真录音，真的会写文件），
 * 再上拉滚动，量状态条 data-hero-bar 有没有露出来、停止钮在不在、点得中点不中。
 * 收尾无论成败都会停掉录音并把页面 refresh 回真实时间，不留脏数据。
 */
import { execFileSync } from 'node:child_process'
const PW = 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const { chromium } = await import(PW)
const ADB = 'C:\\Users\\26502\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe'
const adb = (a) => { try { return execFileSync(ADB, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim() } catch { return '' } }

let pass = 0, fail = 0
function ok(id, what, cond, ev) {
  if (cond) pass++; else fail++
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + id + ' ' + what + (ev === undefined ? '' : '  → ' + ev))
}

const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
let p = null
for (const c of b.contexts()) for (const pg of c.pages()) p = pg
console.log('=== 真机 bug03 录音中也能收缩 ===')

const T = process.env.BUG03_T || '10:30'
const appUrl = p.url().split('?')[0]
await p.goto(appUrl + '?t=' + T, { waitUntil: 'domcontentloaded' }).catch(() => {})
await p.waitForTimeout(3000)
await p.evaluate(() => { const n = document.querySelector('[data-nav="today"]'); if (n) n.click() })
await p.waitForTimeout(800)

/* 1) 找到开始录音的入口（今日页顶卡那颗；没有就说明这个时刻没有正在上的课） */
const start = await p.evaluate(() => {
  const el = document.querySelector('[data-today-rec-start]')
  if (!el) return { ok: false }
  el.click()
  return { ok: true }
})
ok('B1 今日页有开始录音的入口（那一刻正在上课）', '找到 [data-today-rec-start] 并点了', start.ok)
if (!start.ok) { console.log('  跳过后续：这个时钟点没有正在上的课'); await b.close(); process.exit(fail ? 1 : 0) }
await p.waitForTimeout(2500)

const recOn = await p.evaluate(() => !!document.querySelector('[data-today-rec-stop]') || !!document.querySelector('[data-rec-banner]'))
ok('B2 录音真的开了（出现停止钮或常驻小条）', '停止钮或小条出现了', recOn)

/* 2) 上拉，看卡片能不能收 */
/* 顶卡的外层是 data-hero-wrap（不是 data-hero，那个属性不存在） */
const before = await p.evaluate(() => {
  const h = document.querySelector('[data-hero-wrap]')
  const bar = document.querySelector('[data-hero-bar]')
  return { heroH: h ? Math.round(h.getBoundingClientRect().height) : -1, barVisible: bar ? bar.getBoundingClientRect().height > 0 : false }
})
await p.evaluate(() => {
  const sc = document.querySelector('[data-today-scroll]')
  if (sc) sc.scrollTop = sc.scrollHeight
})
await p.waitForTimeout(1200)
const after = await p.evaluate(() => {
  const h = document.querySelector('[data-hero-wrap]')
  const bar = document.querySelector('[data-hero-bar]')
  const el = bar || null
  return {
    heroH: h ? Math.round(h.getBoundingClientRect().height) : -1,
    barVisible: el ? el.getBoundingClientRect().height > 0 : false,
    hasStop: !!document.querySelector('[data-hero-bar-rec-stop]'),
  }
})
console.log('  事实: 上拉前 ' + JSON.stringify(before) + ' / 上拉后 ' + JSON.stringify(after))
ok('B3 录音中上拉，顶卡真的收掉了（高度变小）', after.heroH < before.heroH, before.heroH + ' → ' + after.heroH)
ok('B4 收起后状态条露出来', '状态条可见', after.barVisible)
ok('B5 收起后的状态条上有「停止并保存」', '找到了 data-hero-bar-rec-stop', after.hasStop)

/* 3) 点它能不能真的停 */
let stopped = false
if (after.hasStop) {
  const box = await p.evaluate(() => {
    const el = document.querySelector('[data-hero-bar-rec-stop]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }
  })
  if (box) {
    await p.mouse.click(box.x, box.y)
    await p.waitForTimeout(2500)
    stopped = await p.evaluate(() => !document.querySelector('[data-today-rec-stop]') && !document.querySelector('[data-hero-bar-rec-stop]'))
  }
}
ok('B6 点那颗「停止并保存」真的把录音停了', '录音已结束', stopped)

/* 收尾：无论如何别把录音留着 */
await p.evaluate(() => {
  const els = [document.querySelector('[data-today-rec-stop]'), document.querySelector('[data-hero-bar-rec-stop]')].filter(Boolean)
  els.forEach((e) => e.click())
}).catch(() => {})
await p.waitForTimeout(1500)
const errs = await p.evaluate(() => 0).catch(() => 0)
await p.goto(appUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
await b.close()
console.log('\n=== 汇总：' + pass + ' PASS / ' + fail + ' FAIL ===')
process.exit(fail ? 1 : 0)
