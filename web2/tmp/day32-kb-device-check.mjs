/* 真机验软键盘（Day 32）。不是替身：直接连手机的 WebView（adb forward + CDP），
   用 adb input tap 发**真实触摸**（这点关键——JS 里 element.focus() 不会弹出系统键盘），
   再读页面几何 + 抓屏，判断底部输入框到底有没有被键盘盖住。

   判据（任意一条成立就说明让位成功）：
     A 路径 adjustResize：innerHeight 变小（窗口真的缩了），输入框底边 ≤ innerHeight；
     B 路径 原生兜底：innerHeight 没变，但 --kb > 0，浮层底边 == innerHeight - kb；
   两条都不成立 = 这台设备上仍然被挡。

   已知真机坑：page.screenshot() 在 WebView CDP 上会挂死 → 一律 adb screencap；
   playwright 的 actionability 检查在真机 CDP 上失效 → 导航用 page.evaluate 原生 click。
   跑法：node tmp/day32-kb-device-check.mjs（手机已插、App 已启动、9200 端口已 forward） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const ADB = 'C:\\Users\\26502\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe'
const OUT = path.resolve('tmp/dev-shots')
fs.mkdirSync(OUT, { recursive: true })
const adbOut = (args) => { try { return execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim() } catch { return '' } }
const adbRun = (args) => { try { execFileSync(ADB, args, { maxBuffer: 64 * 1024 * 1024 }) } catch { } }

const results = []
const t = (name, cond, extra) => {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + '  → ' + (extra === undefined ? '' : extra))
}

const devices = adbOut(['devices']).split('\n').slice(1).map((l) => l.trim()).filter((l) => l.endsWith('device'))
if (!devices.length) { console.error('[错误] 没有可用设备，先 adb devices 看看 / 解锁屏幕'); process.exit(2) }
adbRun(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
adbRun(['shell', 'input', 'keyevent', 'KEYCODE_MENU'])
adbRun(['shell', 'svc', 'power', 'stayon', 'true'])

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const ctx = browser.contexts()[0]
const page = ctx.pages()[0]
await page.waitForTimeout(600)

const shot = async (name) => {
  adbRun(['shell', 'screencap', '-p', '/sdcard/kb-' + name + '.png'])
  adbRun(['pull', '/sdcard/kb-' + name + '.png', path.join(OUT, name + '.png')])
  adbRun(['shell', 'rm', '/sdcard/kb-' + name + '.png'])
  return path.join(OUT, name + '.png')
}

const state = () => page.evaluate(() => {
  const q = (s) => document.querySelector(s)
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } }
  const cs = getComputedStyle(document.documentElement)
  return {
    ih: window.innerHeight, iw: window.innerWidth, dpr: window.devicePixelRatio,
    kb: cs.getPropertyValue('--kb').trim(),
    sat: cs.getPropertyValue('--sat').trim(),
    vvH: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    active: document.activeElement ? (document.activeElement.tagName + '|' + (document.activeElement.getAttribute('placeholder') || '')) : null,
    evtPanel: box(q('[data-sheet-evt]')),
    evtPlace: box(q('[data-sheet-evt] input[placeholder="地点（选填）"]')),
    todoPanel: box(q('[data-sheet-todo]')),
    todoInput: box(q('[data-sheet-todo] input')),
  }
})

/* 真实触摸：先用 CDP 拿到元素在 CSS px 里的中心，再按 dpr 换成设备像素点下去 */
async function tapEl(sel) {
  const c = await page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, dpr: window.devicePixelRatio }
  }, sel)
  if (!c) return null
  adbRun(['shell', 'input', 'tap', String(Math.round(c.x * c.dpr)), String(Math.round(c.y * c.dpr))])
  await page.waitForTimeout(1100)
  return c
}

const clickText = async (text) => {
  const ok = await page.evaluate((s) => {
    const els = Array.from(document.querySelectorAll('button'))
    const el = els.find((e) => (e.textContent || '').trim().indexOf(s) >= 0)
    if (!el) return false
    el.click()
    return true
  }, text)
  await page.waitForTimeout(700)
  return ok
}

const imeShown = () => /mInputShown=true/.test(adbOut(['shell', 'dumpsys', 'input_method']))

const toJson = (s) => JSON.stringify(s)

/* ===== 场景 1：添加日程 → 地点（用户原话就报的这个） ===== */
const s0 = await state()
console.log('起始状态: ' + toJson({ ih: s0.ih, iw: s0.iw, dpr: s0.dpr, kb: s0.kb, sat: s0.sat }))
t('D0 设备上 App 已在前台、页面可读', s0.iw > 300 && s0.ih > 500, toJson([s0.iw, s0.ih]))

const opened = await clickText('添加日程')
t('D1 点开「添加日程」浮层', opened && !!(await state()).evtPanel, opened)
const s1 = await state()
const beforeShot = await shot('kb-0-sheet')
t('D2 键盘没弹时浮层贴在屏幕底部', s1.evtPanel && Math.abs(s1.evtPanel.bottom - s1.ih) <= 2, toJson(s1.evtPanel && s1.evtPanel.bottom) + ' vs innerHeight ' + s1.ih)

await tapEl('[data-sheet-evt] input[placeholder="地点（选填）"]')
const s2 = await state()
const shown = imeShown()
const eventShot = await shot('kb-1-event')
console.log('聚焦后: ' + toJson({ ih: s2.ih, kb: s2.kb, vvH: s2.vvH, active: s2.active, panel: s2.evtPanel, place: s2.evtPlace, ime: shown }))
t('D3 真实点击后输入框获得焦点', /INPUT/.test(s2.active || ''), s2.active)
t('D4 系统键盘确实弹出来了（dumpsys mInputShown=true）', shown, shown)
const resized = s2.ih < s1.ih - 80
const fallback = parseFloat(s2.kb || '0') > 80
t('D5 让位生效：窗口缩了(A) 或 写了 --kb(B)', resized || fallback, 'resized=' + resized + ' (innerHeight ' + s1.ih + '→' + s2.ih + ') / kb=' + (s2.kb || '0px'))
const visBottom = resized ? s2.ih : s2.ih - parseFloat(s2.kb || '0')
t('D6 浮层底边停在键盘上方（不再被盖）', s2.evtPanel && s2.evtPanel.bottom <= visBottom + 3, 'panel.bottom=' + (s2.evtPanel && s2.evtPanel.bottom) + ' ≤ ' + visBottom)
t('D7 「地点」输入框完整可见（这就是被挡的那一格）', s2.evtPlace && s2.evtPlace.bottom <= visBottom + 3 && s2.evtPlace.top >= 0, toJson(s2.evtPlace) + ' vs ' + visBottom)
console.log('截图: ' + beforeShot + ' / ' + eventShot)

/* 收键盘：系统返回键第一下只收键盘 */
adbRun(['shell', 'input', 'keyevent', '4'])
await page.waitForTimeout(900)
const s3 = await state()
await shot('kb-2-after-back')
console.log('收键后: ' + toJson({ ih: s3.ih, kb: s3.kb, panel: s3.evtPanel, active: s3.active }))
t('D8 收键盘后窗口复原（innerHeight 回到 ' + s1.ih + '）', Math.abs(s3.ih - s1.ih) <= 3, String(s3.ih))
t('D9 收键盘后 --kb 归零', !s3.kb || parseFloat(s3.kb) === 0, '"' + s3.kb + '"')
t('D10 收键盘后浮层落回底部、不留空白', s3.evtPanel && Math.abs(s3.evtPanel.bottom - s3.ih) <= 3, toJson(s3.evtPanel && s3.evtPanel.bottom) + ' vs ' + s3.ih)

/* 关掉浮层，换第二个场景 */
await page.evaluate(() => { const b = Array.from(document.querySelectorAll('[data-sheet-evt] button')).find((e) => (e.textContent || '').indexOf('取消') >= 0); if (b) b.click() })
await page.waitForTimeout(600)

/* ===== 场景 2：添加待办 ===== */
const opened2 = await clickText('添加待办')
t('D11 点开「添加待办」浮层', opened2 && !!(await state()).todoPanel, opened2)
const t1 = await state()
await tapEl('[data-sheet-todo] input')
const t2 = await state()
const t2shot = await shot('kb-3-todo')
console.log('待办聚焦后: ' + toJson({ ih: t2.ih, kb: t2.kb, panel: t2.todoPanel, input: t2.todoInput, active: t2.active }))
t('D12 待办浮层同样让位', (t2.ih < t1.ih - 80) || parseFloat(t2.kb || '0') > 80, 'innerHeight ' + t1.ih + '→' + t2.ih + ' / kb=' + (t2.kb || '0px'))
const vis2 = t2.ih < t1.ih - 80 ? t2.ih : t2.ih - parseFloat(t2.kb || '0')
t('D13 待办输入框完整可见', t2.todoInput && t2.todoInput.bottom <= vis2 + 3, toJson(t2.todoInput) + ' vs ' + vis2)
console.log('截图: ' + t2shot)

adbRun(['shell', 'input', 'keyevent', '4'])
await page.waitForTimeout(700)
await page.evaluate(() => { const b = Array.from(document.querySelectorAll('[data-sheet-todo] button')).find((e) => (e.textContent || '').indexOf('取消') >= 0); if (b) b.click() })
await page.waitForTimeout(400)

const s4 = await state()
t('D14 两个场景收工后回到首页、无残留浮层', !s4.evtPanel && !s4.todoPanel, toJson([!!s4.evtPanel, !!s4.todoPanel]))

const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
t('D15 全程无页面报错（监听从此刻起）', errs.length === 0, errs.slice(0, 2).join(' | ') || '无')

await browser.close()
const fails = results.filter((r) => !r[1])
console.log('\n=== 真机软键盘：' + (results.length - fails.length) + '/' + results.length + ' 通过 ===')
process.exit(fails.length ? 1 : 0)
