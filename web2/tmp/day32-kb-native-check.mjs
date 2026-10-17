/* 软键盘让位 · 第二步（原生兜底）检查（Day 32，2026-10-17）
   背景：网页侧 keyboard.js 用 --kb 让位（第一步，见 day32-keyboard-check.mjs）。
   第二步在壳里做了两件事：Manifest 补 windowSoftInputMode=adjustResize（主路径，
   窗口真的变矮 → WebView 跟着缩 → 网页量得到），以及 KeyboardInsetsPlugin 把 IME
   高度经 shell.js 转成 window 事件 'wb-kb-native' 推给网页（兜底）。
   兜底必须是「二选一」：窗口已经缩了的时候再写 --kb 就是双重让位，浮层会被顶高两次。

   三组场景（浏览器里模拟不了原生，只能模拟它发出的那三样东西）：
     N 组 只有原生报高度、窗口没缩 → 用原生值让位（这就是兜底生效的样子）；
     W 组 窗口被压矮（innerHeight 变小）+ 原生也报高度 → 网页必须**放弃**原生值，--kb 为空；
     V 组 网页自己量到了（假 visualViewport）+ 原生同时报高度 → 只算一次，不能 300+300；
     R 组 都收掉之后 --kb 清空、浮层落回底部。
   跑法：先 npm run build，再 node tmp/day32-kb-native-check.mjs（自带静态服务） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve('dist')
const PORT = Number(process.env.PORT || 4192)
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
const FIXTURE = JSON.stringify({
  version: 1,
  schedules: [{ id: 'sch_1', semester: '2026-2027 秋冬', type: 'course', entries: [
    { id: 'c1', type: 'course', name: '线性代数', weekday: 1, start: '14:00', end: '15:40', place: '教二 110', weeks: null, term: '秋冬' },
  ] }],
  semester: { name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 18 },
})

/* 假 visualViewport（只有 V 组用）：和真实键盘一样「改 vv.height 再发 resize」 */
const FAKE_VV = [
  '(function(){',
  '  var fake = new EventTarget();',
  '  fake.height = window.innerHeight;',
  '  fake.width = window.innerWidth;',
  '  fake.offsetTop = 0;',
  '  fake.scale = 1;',
  '  try { Object.defineProperty(window, "visualViewport", { get: function(){ return fake }, configurable: true }) }',
  '  catch (e) { Object.defineProperty(Object.getPrototypeOf(window), "visualViewport", { get: function(){ return fake }, configurable: true }) }',
  '  window.__kbFake = function (px) { fake.height = window.innerHeight - px; fake.dispatchEvent(new Event("resize")) }',
  '})();',
].join('\n')

const KB = 300
const KEY_LINE = 844 - KB
const SEL_EVT_PLACE = '[data-sheet-evt] input[placeholder="地点（选填）"]'
const errors = []

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu'] })

async function open(withFakeVV) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await ctx.route('**cdn.jsdelivr.net/**', (r) => r.abort())
  if (withFakeVV) await page.addInitScript(FAKE_VV)
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

/* 原生侧等价物：shell.js 在收到 kbChanged 时干的就是这一行 */
async function nativeKb(page, px) {
  await page.evaluate((n) => {
    window.dispatchEvent(new CustomEvent('wb-kb-native', { detail: { height: n } }))
  }, px)
  await page.waitForTimeout(260)
}

/* 模拟 adjustResize：窗口真的变矮（只改 JS 读数，DOM 布局由 --kb 不存在来体现） */
async function fakeWindowHeight(page, h) {
  await page.evaluate((n) => {
    Object.defineProperty(window, 'innerHeight', { get: () => n, configurable: true })
  }, h)
}

async function snap(page, panelSel, fieldSel) {
  return page.evaluate(([ps, fs]) => {
    const el = document.querySelector(ps)
    const b = el.getBoundingClientRect()
    const f = document.querySelector(fs)
    const fb = f ? f.getBoundingClientRect() : null
    return {
      kb: document.documentElement.style.getPropertyValue('--kb'),
      bottom: b.bottom, top: b.top,
      fieldBottom: fb ? fb.bottom : null,
      vh: window.innerHeight,
    }
  }, [panelSel, fieldSel])
}

async function openSheet(page) {
  await page.locator('button', { hasText: '添加日程' }).first().click()
  await page.waitForSelector('[data-sheet-evt]', { state: 'visible' })
  await page.waitForTimeout(420)
  await page.locator(SEL_EVT_PLACE).first().click()
  await page.waitForTimeout(120)
}

/* ---------- N 组：窗口没缩，只靠原生报高度（兜底生效） ---------- */
{
  const { ctx, page } = await open(false)
  await openSheet(page)
  const n0 = await snap(page, '[data-sheet-evt]', SEL_EVT_PLACE)
  t('N1 没有原生高度时 --kb 为空', n0.kb === '', JSON.stringify(n0.kb))
  await nativeKb(page, KB)
  const n1 = await snap(page, '[data-sheet-evt]', SEL_EVT_PLACE)
  t('N2 原生报 300 → --kb = 300px（兜底真的生效）', n1.kb === KB + 'px', JSON.stringify(n1.kb))
  t('N3 浮层抬到键盘上沿（底边≈' + KEY_LINE + '）', Math.abs(n1.bottom - KEY_LINE) <= 2, n1.bottom)
  t('N4 输入框在键盘线上方', n1.fieldBottom !== null && n1.fieldBottom <= KEY_LINE + 1, JSON.stringify(n1.fieldBottom))
  await nativeKb(page, 0)
  const n2 = await snap(page, '[data-sheet-evt]', SEL_EVT_PLACE)
  t('N5 原生报 0 → --kb 清空', n2.kb === '', JSON.stringify(n2.kb))
  await ctx.close()
}

/* ---------- W 组：窗口被压矮 + 原生也报高度 —— 网页必须放弃原生值 ---------- */
{
  const { ctx, page } = await open(false)
  await openSheet(page)
  await fakeWindowHeight(page, KEY_LINE) // 844 → 544，相当于 adjustResize 把窗口压矮 300
  await nativeKb(page, KB)
  const w1 = await snap(page, '[data-sheet-evt]', SEL_EVT_PLACE)
  t('W1 窗口已缩时不用原生值（--kb 为空，避免双重让位）', w1.kb === '', JSON.stringify(w1.kb))
  t('W2 浮层没有被第二次顶高（底边仍是 844，布局由窗口缩放负责）', Math.abs(w1.bottom - 844) <= 1, w1.bottom)
  await ctx.close()
}

/* ---------- V 组：网页自己量到了 + 原生同时报 —— 只能算一次 ---------- */
{
  const { ctx, page } = await open(true)
  await openSheet(page)
  await page.evaluate((n) => window.__kbFake(n), KB)
  await page.waitForTimeout(200)
  const v1 = await snap(page, '[data-sheet-evt]', SEL_EVT_PLACE)
  t('V1 假 visualViewport 报 300 → --kb = 300px', v1.kb === KB + 'px', JSON.stringify(v1.kb))
  await nativeKb(page, KB)
  const v2 = await snap(page, '[data-sheet-evt]', SEL_EVT_PLACE)
  t('V2 原生也报 300 时不叠加（仍是 300px，不是 600px）', v2.kb === KB + 'px', JSON.stringify(v2.kb))
  t('V3 浮层底边仍在键盘上沿', Math.abs(v2.bottom - KEY_LINE) <= 2, v2.bottom)
  await nativeKb(page, 0)
  await page.evaluate(() => window.__kbFake(0))
  await page.waitForTimeout(220)
  const v3 = await snap(page, '[data-sheet-evt]', SEL_EVT_PLACE)
  t('V4 都收掉后 --kb 清空、浮层回底', v3.kb === '' && Math.abs(v3.bottom - 844) <= 1, JSON.stringify([v3.kb, v3.bottom]))
  await ctx.close()
}

t('Z1 全程无页面报错', errors.length === 0, errors.slice(0, 4).join(' | '))
console.log('')
console.log('结果：' + pass + ' PASS / ' + fail + ' FAIL')
await browser.close()
server.close()
process.exit(fail === 0 ? 0 : 1)
