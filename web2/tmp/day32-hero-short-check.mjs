/* 今日页「待办少」时上拉收缩到位检查（2026-10-16，用户报「大卡片只能收缩一半」）
   需求：内容短、滚到底时头卡也要完全收成一行状态条（改前只到 ~0.45 就停）。
   拍板：乙方案——折叠进度分母取 min(可收缩高度, 实际能滚的距离)。
   代价（用户已认）：不再是严格 1:1 跟手，内容少时轻轻一滑就收得快。

   两个场景：
     L（390x844，内容比屏幕长）——分母仍是可收缩高度，1:1 跟手不能坏（对照 hero-collapse-check 的 B2）；
     S（390x1200 高屏，内容短于屏幕）——这才是用户报的那种形态：可滚距离 < 可收缩高度。
        改前：滑到底只收到 ~0.4；改后：滑到底必须收成 52px 一行、状态条全露。
   跑法：先 npm run build，再 node tmp/day32-hero-short-check.mjs（本进程自带静态服务） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve('dist')
const PORT = Number(process.env.PORT || 4189)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = http.createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0])
    const file = path.join(ROOT, p === '/' ? 'index.html' : p)
    const buf = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    try { res.writeHead(200, { 'content-type': 'text/html' }); res.end(await readFile(path.join(ROOT, 'index.html'))) }
    catch { res.writeHead(404); res.end('404') }
  }
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
const BASE = 'http://127.0.0.1:' + PORT + '/'

let pass = 0, fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' << ' + extra))
  ok ? pass++ : fail++
}
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const FIXED = new Date('2026-10-12T14:30:00').getTime()
const CLOCK = 'const FIXED=' + FIXED + ';const R=Date;class F extends R{constructor(...a){a.length===0?super(FIXED):super(...a)}static now(){return FIXED}}window.Date=F;'
const FIXTURE = JSON.stringify({
  version: 1,
  schedules: [{ id: 'sch_1', semester: '2026-2027 秋冬', type: 'course', entries: [
    { id: 'c1', type: 'course', name: '线性代数', weekday: 1, start: '14:00', end: '15:40', place: '教二 110', weeks: null, term: '秋冬' },
  ] }],
  semester: { name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 18 },
})

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu'] })
const MINH = 52 /* 12 顶白 + 32 状态条 + 8 底白 */
const errors = []

async function open(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await ctx.route('**cdn.jsdelivr.net/**', (r) => r.abort())
  await page.addInitScript(CLOCK)
  await page.addInitScript((fx) => {
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.theme', 'light')
    localStorage.setItem('web2.data', fx)
    localStorage.setItem('web2.todos', '[]')
    localStorage.removeItem('web2.dayOverrides')
  }, FIXTURE)
  await page.goto(BASE, { waitUntil: 'load' })
  await page.waitForSelector('[data-page="today"]')
  await page.waitForTimeout(900)
  return { ctx, page }
}

const PROBE = () => {
  const main = document.querySelector('[data-page="today"]')
  const wrap = document.querySelector('[data-hero-wrap]')
  const bar = document.querySelector('[data-hero-bar]')
  const header = document.querySelector('header')
  return {
    scrollTop: Math.round(main.scrollTop),
    maxScroll: Math.round(main.scrollHeight - main.clientHeight),
    clientH: main.clientHeight,
    wrapH: Math.round(wrap.getBoundingClientRect().height),
    barOpacity: parseFloat(getComputedStyle(bar).opacity),
    headerH: Math.round(header.getBoundingClientRect().height),
  }
}
/* 页内等若干 rAF：onTodayScroll 是 rAF 去抖的，headless 不推进 rAF 会读出旧值 */
async function scrollTo(page, v) {
  await page.evaluate(async (n) => {
    const el = document.querySelector('[data-page="today"]')
    el.scrollTop = n
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r))
  }, v)
  await page.waitForTimeout(140)
}

/* ================= L：长内容（1:1 跟手不许坏） ================= */
{
  const { ctx, page } = await open(390, 844)
  const A = await page.evaluate(PROBE)
  const compressLen = A.wrapH - MINH
  console.log('L 初始 = ' + JSON.stringify(A) + ' 可收缩=' + compressLen)
  t('L0 前提：长内容（可滚距离 ≥ 可收缩高度）', A.maxScroll >= compressLen, 'maxScroll=' + A.maxScroll + ' 可收缩=' + compressLen)
  const mid = Math.round((A.maxScroll < compressLen ? A.maxScroll : compressLen) / 2)
  await scrollTo(page, mid)
  const M = await page.evaluate(PROBE)
  t('L1 长内容仍 1:1 跟手（收掉的高度 == scrollTop，±6）', Math.abs((A.wrapH - M.wrapH) - M.scrollTop) <= 6, '收掉=' + (A.wrapH - M.wrapH) + ' scrollTop=' + M.scrollTop)
  await scrollTo(page, A.maxScroll)
  const C = await page.evaluate(PROBE)
  t('L2 滑到底完全收起（52px，±4）', Math.abs(C.wrapH - MINH) <= 4, 'wrapH=' + C.wrapH)
  t('L3 滑到底状态条全露（>0.9）', C.barOpacity > 0.9, 'barOpacity=' + C.barOpacity)
  await scrollTo(page, 0)
  const E = await page.evaluate(PROBE)
  t('L4 回顶部复位（±3）', Math.abs(E.wrapH - A.wrapH) <= 3, A.wrapH + ' -> ' + E.wrapH)
  await ctx.close()
}

/* ================= S：短内容（用户报的那种） ================= */
{
  const { ctx, page } = await open(390, 1200)
  const A = await page.evaluate(PROBE)
  const compressLen = A.wrapH - MINH
  console.log('S 初始 = ' + JSON.stringify(A) + ' 可收缩=' + compressLen)
  t('S0 前提：短内容（可滚距离 < 可收缩高度）', A.maxScroll > 0 && A.maxScroll < compressLen, 'maxScroll=' + A.maxScroll + ' 可收缩=' + compressLen)
  await scrollTo(page, A.maxScroll)
  const C = await page.evaluate(PROBE)
  console.log('S 到底 = ' + JSON.stringify(C))
  t('S1 滑到底头卡完全收起（52px，±4）', Math.abs(C.wrapH - MINH) <= 4, 'wrapH=' + C.wrapH)
  t('S2 滑到底状态条全露（>0.9）', C.barOpacity > 0.9, 'barOpacity=' + C.barOpacity)
  t('S3 滑到底头卡被整块裁掉（高 ≤ 2）', C.headerH <= 2, 'headerH=' + C.headerH)
  t('S4 窗口高度不变', C.clientH === A.clientH, A.clientH + ' -> ' + C.clientH)
  await scrollTo(page, 0)
  const E = await page.evaluate(PROBE)
  t('S5 回顶部复位（±3）', Math.abs(E.wrapH - A.wrapH) <= 3, A.wrapH + ' -> ' + E.wrapH)
  await ctx.close()
}

t('Z1 全程无 pageerror / console.error', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
server.close()
console.log('')
console.log(pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
