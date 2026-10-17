/* 软键盘让位检查（2026-10-16，用户报「底部文本框被输入法挡住，所有输入地方都有」）
   背景：Android 15（targetSdk 35）强制边到边后键盘不再压缩窗口，本项目所有输入框
   都住在贴底浮层/整屏页里 ⇒ 被键盘整块盖住。修法见 web2/src/data/keyboard.js。

   浏览器里没法真的弹输入法，所以用「假 visualViewport」模拟：注入一个可控的
   window.visualViewport，__kbFake(px) 把可视区高度减 px 并 dispatch resize，
   与真实键盘弹起时网页收到的事件一模一样（本项目只有 keyboard.js 读它）。

   三组场景：
     C 组 今日页「＋ 添加日程」浮层（用户报的那个表单）——面板抬到键盘上方、底部备注框可见；
     A 组 今日页「添加待办」浮层——收键后必须落回 bottom:0，不能留在半空；
     B 组 我的 → 设置 → 数据与备份（二级页）——整屏页靠 padding-bottom 让位。
   跑法：先 npm run build，再 node tmp/day32-keyboard-check.mjs（自带静态服务） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve('dist')
const PORT = Number(process.env.PORT || 4191)
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

/* 假 visualViewport：真实键盘弹起时浏览器就是改 vv.height 再发 resize */
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

const KB = 300 // 模拟键盘占 300px（390x844 手机上约 36% 屏高，与真实输入法同量级）
const KEY_LINE = 844 - KB // 键盘上沿：所有输入框底边都必须在这条线上方
const SEL_EVT_PLACE = '[data-sheet-evt] input[placeholder="地点（选填）"]' // 单条表单最靠下的输入框（用户报的就是这种）
const errors = []

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu'] })

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  await ctx.route('**cdn.jsdelivr.net/**', (r) => r.abort())
  await page.addInitScript(FAKE_VV)
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

/* 量一次：--kb、指定面板的上下边、聚焦控件底边 */
async function snap(page, panelSel, fieldSel) {
  return page.evaluate(([ps, fs]) => {
    const el = document.querySelector(ps)
    const b = el.getBoundingClientRect()
    const f = document.querySelector(fs)
    const fb = f ? f.getBoundingClientRect() : null
    return {
      kb: document.documentElement.style.getPropertyValue('--kb'),
      top: b.top, bottom: b.bottom, h: b.height,
      fieldTop: fb ? fb.top : null, fieldBottom: fb ? fb.bottom : null,
      vh: window.innerHeight,
      paddingBottom: getComputedStyle(el).paddingBottom,
    }
  }, [panelSel, fieldSel])
}

async function fakeKb(page, px) {
  await page.evaluate((n) => window.__kbFake(n), px)
  await page.waitForTimeout(260) // 两帧 rAF + 320ms 滚动兜底之前够用
}

/* ---------- C 组：添加日程浮层（用户报的那个表单） ---------- */
{
  const { ctx, page } = await open()
  await page.locator('button', { hasText: '添加日程' }).first().click()
  await page.waitForSelector('[data-sheet-evt]', { state: 'visible' })
  await page.waitForTimeout(420)
  const before = await snap(page, '[data-sheet-evt]', SEL_EVT_PLACE)
  t('C1 没键盘时 --kb 不存在（不打扰正常布局）', before.kb === '', JSON.stringify(before.kb))
  t('C2 没键盘时面板贴底（bottom≈0）', Math.abs(before.bottom - 844) <= 1, before.bottom)

  await page.locator(SEL_EVT_PLACE).first().click()
  await fakeKb(page, KB)
  const after = await snap(page, '[data-sheet-evt]', SEL_EVT_PLACE)
  t('C3 聚焦输入框后 --kb = ' + KB + 'px', after.kb === KB + 'px', JSON.stringify(after.kb))
  t('C4 面板抬到键盘上沿（底边≈' + KEY_LINE + '，±2px）', Math.abs(after.bottom - KEY_LINE) <= 2, after.bottom)
  t('C5 面板整块在屏内（top≥0）', after.top >= 0, after.top)
  const ta = await page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect()
    return { bottom: r.bottom, top: r.top }
  }, SEL_EVT_PLACE)
  t('C6 底部备注框底边在键盘线上方', ta.bottom <= KEY_LINE + 1, JSON.stringify(ta))
  await page.screenshot({ path: 'tmp/day32-kb-shot-event.png' })

  await fakeKb(page, 0)
  const back = await snap(page, '[data-sheet-evt]', 'body')
  t('C7 收键后 --kb 被清掉', back.kb === '', JSON.stringify(back.kb))
  t('C8 收键后面板落回底部（bottom≈844）', Math.abs(back.bottom - 844) <= 1, back.bottom)
  await ctx.close()
}

/* ---------- A 组：添加待办浮层（收键必须回位） ---------- */
{
  const { ctx, page } = await open()
  await page.locator('button', { hasText: '添加待办' }).first().click()
  await page.waitForSelector('[data-sheet-todo]', { state: 'visible' })
  await page.waitForTimeout(420)
  await page.locator('[data-sheet-todo] input').first().click()
  await fakeKb(page, KB)
  const on = await snap(page, '[data-sheet-todo]', '[data-sheet-todo] input')
  t('A1 待办浮层同样让位（底边≈' + KEY_LINE + '）', Math.abs(on.bottom - KEY_LINE) <= 2, on.bottom)
  t('A2 待办浮层输入框可见', on.fieldBottom !== null && on.fieldBottom <= KEY_LINE + 1, JSON.stringify([on.fieldTop, on.fieldBottom]))
  await fakeKb(page, 0)
  const off = await snap(page, '[data-sheet-todo]', '[data-sheet-todo] input')
  t('A3 收键后回到贴底', Math.abs(off.bottom - 844) <= 1, off.bottom)
  await ctx.close()
}

/* ---------- B 组：二级页（我的 → 设置 → 数据与备份） ---------- */
{
  const { ctx, page } = await open()
  await page.locator('nav button', { hasText: '我的' }).first().click()
  await page.waitForTimeout(420)
  await page.locator('[data-me-entry="settings"]').first().click()
  await page.waitForSelector('[data-sub-page][data-sub="settings"]', { state: 'visible' })
  await page.waitForTimeout(420)
  await page.locator('[data-settings-index="data"]').first().click()
  await page.waitForSelector('[data-sync-pass]', { state: 'visible' })
  await page.waitForTimeout(420)
  const b0 = await snap(page, '[data-sub-page]', '[data-sync-pass]')
  t('B1 二级页没键盘时不加底距', b0.paddingBottom === '0px', b0.paddingBottom)
  await page.locator('[data-sync-pass]').first().click()
  await fakeKb(page, KB)
  const b1 = await snap(page, '[data-sub-page]', '[data-sync-pass]')
  t('B2 二级页 padding-bottom = ' + KB + 'px', b1.paddingBottom === KB + 'px', b1.paddingBottom)
  t('B3 聚焦的输入框被滚进键盘线上方', b1.fieldBottom <= KEY_LINE + 1, JSON.stringify([b1.fieldTop, b1.fieldBottom]))
  await page.screenshot({ path: 'tmp/day32-kb-shot-sub.png' })
  await fakeKb(page, 0)
  const b2 = await snap(page, '[data-sub-page]', '[data-sync-pass]')
  t('B4 收键后底距归零', b2.paddingBottom === '0px', b2.paddingBottom)
  await ctx.close()
}

t('Z1 全程无页面报错', errors.length === 0, errors.slice(0, 4).join(' | '))
console.log('')
console.log('结果：' + pass + ' PASS / ' + fail + ' FAIL')
await browser.close()
server.close()
process.exit(fail === 0 ? 0 : 1)
