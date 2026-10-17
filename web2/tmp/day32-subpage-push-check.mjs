/* 三级页推入/返回动效检查（2026-10-16，用户报「三级页没有划入动画」）
   做法：本进程内起一个 dist 静态服务（不依赖 python），点「我的 → 设置 → 外观与主题」，
   在过渡进行中按 0/70/140/210/320ms 采帧，读 [data-sub-page] 的 getBoundingClientRect().left 量位移。
   P = 往深一层（push），Q = 返回上一层（pop），R = 退出二级页（原有的整体进出不能坏）。
   跑法：node tmp/day32-subpage-push-check.mjs （需先 npm run build） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve('dist')
const PORT = Number(process.env.PORT || 4188)
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

const FIXED = new Date('2026-10-12T14:30:00').getTime()
const CLOCK = 'const FIXED=' + FIXED + ';const R=Date;class F extends R{constructor(...a){a.length===0?super(FIXED):super(...a)}static now(){return FIXED}}window.Date=F;'
const FIXTURE = JSON.stringify({
  version: 1,
  schedules: [{ id: 'sch_1', semester: '2026-2027 秋冬', type: 'course', entries: [
    { id: 'c1', type: 'course', name: '线性代数', weekday: 1, start: '14:00', end: '15:40', place: '教二 110', weeks: null, term: '秋冬' },
  ] }],
  semester: { name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 18 },
  todos: [],
})

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await ctx.route('**cdn.jsdelivr.net/**', (r) => r.abort())
await page.addInitScript(CLOCK)
await page.addInitScript((fx) => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', 'light')
  localStorage.setItem('web2.data', fx)
  localStorage.removeItem('web2.dayOverrides')
}, FIXTURE)
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForSelector('[data-page="today"]')
await page.waitForTimeout(600)

const SNAP = () => Array.from(document.querySelectorAll('[data-sub-page]')).map((el) => {
  const r = el.getBoundingClientRect()
  return { sub: el.getAttribute('data-sub'), left: Math.round(r.left), z: getComputedStyle(el).zIndex }
})

async function frames(action, shots) {
  const t0 = Date.now()
  await action()
  const out = []
  for (const ms of shots) {
    const wait = ms - (Date.now() - t0)
    if (wait > 0) await page.waitForTimeout(wait)
    out.push({ ms, nodes: await page.evaluate(SNAP) })
  }
  return out
}

await page.$eval('[data-nav="me"]', (el) => el.click())
await page.waitForTimeout(500)
await page.$eval('[data-me-entry="settings"]', (el) => el.click())
await page.waitForTimeout(500)
t('P0 已进到二级页「设置」', (await page.$eval('[data-sub-page]', (el) => el.getAttribute('data-sub'))) === 'settings')

/* ---------- P：设置 -> 外观与主题（三级页推进） ---------- */
const pf = await frames(() => page.$eval('[data-settings-index="appearance"]', (el) => el.click()), [0, 70, 140, 210, 320])
const pAt = (ms) => (pf.find((f) => f.ms === ms) || {}).nodes || []
console.log('P frames = ' + JSON.stringify(pf))
t('P1 推进瞬间同时存在两个页面节点', pAt(0).length === 2, JSON.stringify(pAt(0)))
const pNew0 = pAt(0).find((n) => n.sub === 'settings-appearance')
t('P2 新页从屏幕右缘进场（left >= 300）', !!pNew0 && pNew0.left >= 300, pNew0 && pNew0.left)
const pNewEnd = pAt(320).find((n) => n.sub === 'settings-appearance')
t('P3 新页 320ms 内归位（left = 0）', !!pNewEnd && pNewEnd.left === 0, pNewEnd && pNewEnd.left)
const pOld70 = pAt(70).find((n) => n.sub === 'settings')
t('P4 旧页向左退（70ms 时 -80 <= left < 0）', !!pOld70 && pOld70.left < 0 && pOld70.left >= -80, pOld70 && pOld70.left)
t('P5 推进结束后只剩一个页面节点', pAt(320).length === 1, JSON.stringify(pAt(320)))
t('P6 三级页标题是「外观与主题」', (await page.$eval('[data-sub-title]', (el) => el.textContent.trim())) === '外观与主题')

/* ---------- Q：返回上一层（pop） ---------- */
const qf = await frames(() => page.$eval('[data-sub-back]', (el) => el.click()), [0, 70, 140, 210, 320])
const qAt = (ms) => (qf.find((f) => f.ms === ms) || {}).nodes || []
console.log('Q frames = ' + JSON.stringify(qf))
t('Q1 返回瞬间同时存在两个页面节点', qAt(0).length === 2, JSON.stringify(qAt(0)))
const qLeave70 = qAt(70).find((n) => n.sub === 'settings-appearance')
t('Q2 当前页向右滑出（70ms 时 left > 0）', !!qLeave70 && qLeave70.left > 0, qLeave70 && qLeave70.left)
const qEnter70 = qAt(70).find((n) => n.sub === 'settings')
t('Q3 上一页从左侧归位（70ms 时 left < 0）', !!qEnter70 && qEnter70.left < 0, qEnter70 && qEnter70.left)
const qEnd = qAt(320)
t('Q4 返回结束只剩一个节点且归位', qEnd.length === 1 && qEnd[0].sub === 'settings' && qEnd[0].left === 0, JSON.stringify(qEnd))
t('Q5 标题回到「设置」', (await page.$eval('[data-sub-title]', (el) => el.textContent.trim())) === '设置')

/* ---------- R：退出二级页（整体进出，原有能力不能坏） ---------- */
const rf = await frames(() => page.$eval('[data-sub-back]', (el) => el.click()), [0, 70, 320])
const rAt = (ms) => (rf.find((f) => f.ms === ms) || {}).nodes || []
console.log('R frames = ' + JSON.stringify(rf))
t('R1 退出二级页时页面节点还在（动画中有 1 个）', rAt(0).length === 1, JSON.stringify(rAt(0)))
t('R2 从右滑出（70ms 时 left > 0）', (rAt(70)[0] || {}).left > 0, (rAt(70)[0] || {}).left)
t('R3 结束节点全部卸载', rAt(320).length === 0, JSON.stringify(rAt(320)))

t('Z1 全程无 pageerror / console.error', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()
server.close()
console.log('')
console.log(pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)
