/* 真机验软键盘·第二批（Day 32）。第一批（day32-kb-device-check.mjs）已证：
   这台设备 adjustResize 没生效（innerHeight 794 不变），是**原生兜底路径**在干活（--kb=305px），
   添加日程浮层让位成功、地点框和「添加」按钮都完整可见（截图 kb-1-event.png）。
   这一批补查：
     S 组 二级页（我的→设置→数据）：整屏页用 padding-bottom 让位，同步串输入框要滚进可见区；
     C 组 焦点在「名称」和「地点」之间来回切：--kb 不能叠加成两倍；
     T 组 键盘弹着时「添加」按钮必须还在可见区内（能点才算真的能提交）；
     B 组 点空白处收键盘（走 focusout，不是返回键）：--kb 归零、底部不留空白条。
   第二批第一版 5 条假 FAIL 的原因是探针自己：同步串输入框在滚动区里、初始 y=946 超出屏幕，
   直接按坐标点等于点到屏幕外 → 先 scrollIntoView 再点；退出二级页也没用返回键而用了底部导航。
   跑法：node tmp/day32-kb-device-check2.mjs（手机已插、App 已启动、9222 已 forward） */
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
const t = (name, cond, extra) => { results.push([name, !!cond]); console.log((cond ? 'PASS ' : 'FAIL ') + name + '  → ' + (extra === undefined ? '' : extra)) }

const devices = adbOut(['devices']).split('\n').slice(1).map((l) => l.trim()).filter((l) => l.endsWith('device'))
if (!devices.length) { console.error('[错误] 没有可用设备'); process.exit(2) }
adbRun(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
adbRun(['shell', 'input', 'keyevent', 'KEYCODE_MENU'])
adbRun(['shell', 'svc', 'power', 'stayon', 'true'])

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = browser.contexts()[0].pages()[0]
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
await page.waitForTimeout(400)
await page.evaluate(() => {
  window.__box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } }
  window.__kb = () => getComputedStyle(document.documentElement).getPropertyValue('--kb').trim()
  window.__ih = () => window.innerHeight
})

const shot = async (name) => {
  adbRun(['shell', 'screencap', '-p', '/sdcard/kb-' + name + '.png'])
  adbRun(['pull', '/sdcard/kb-' + name + '.png', path.join(OUT, name + '.png')])
  adbRun(['shell', 'rm', '/sdcard/kb-' + name + '.png'])
  return path.join(OUT, name + '.png')
}
const kbVal = () => page.evaluate(() => window.__kb())
const tapEl = async (sel) => {
  const c = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, dpr: window.devicePixelRatio } }, sel)
  if (!c) return null
  adbRun(['shell', 'input', 'tap', String(Math.round(c.x * c.dpr)), String(Math.round(c.y * c.dpr))])
  await page.waitForTimeout(1100)
  return c
}
const tapXY = async (x, y) => { const d = await page.evaluate(() => window.devicePixelRatio); adbRun(['shell', 'input', 'tap', String(Math.round(x * d)), String(Math.round(y * d))]); await page.waitForTimeout(900) }
const clickSel = async (sel) => { const ok = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true }, sel); await page.waitForTimeout(700); return ok }
const clickText = async (text) => { const ok = await page.evaluate((s) => { const el = Array.from(document.querySelectorAll('button')).find((e) => (e.textContent || '').trim().indexOf(s) >= 0); if (!el) return false; el.click(); return true }, text); await page.waitForTimeout(700); return ok }
const hideKb = async () => { adbRun(['shell', 'input', 'keyevent', '4']); await page.waitForTimeout(800) }

/* ===== S 组：二级页 ===== */
await clickSel('[data-nav="me"]')
await page.waitForTimeout(300)
await clickSel('[data-me-entry="settings"]')
const dataEntry = await clickSel('[data-settings-index="data"]')
const hasPass = await page.evaluate(() => !!document.querySelector('[data-sync-pass]'))
t('S1 进到「我的 → 设置 → 数据」', dataEntry && hasPass, JSON.stringify([dataEntry, hasPass]))
const subBase = await page.evaluate(() => { const el = document.querySelector('[data-sub-page]'); const cs = el ? getComputedStyle(el) : null; return { sub: !!el, pb: cs ? cs.paddingBottom : null, kb: window.__kb() } })
t('S2 无键盘时二级页 padding-bottom = 0（原观感不被动）', subBase.sub && (subBase.pb === '0px' || subBase.pb === ''), JSON.stringify(subBase))

/* 同步串输入框在滚动区里，先滚进视野再按坐标点（否则点的是屏幕外） */
await page.evaluate(() => { const el = document.querySelector('[data-sync-pass]'); if (el) el.scrollIntoView({ block: 'center' }) })
await page.waitForTimeout(500)
const posBefore = await page.evaluate(() => window.__box(document.querySelector('[data-sync-pass]')))
await tapEl('[data-sync-pass]')
const sSync = await page.evaluate(() => { const el = document.querySelector('[data-sync-pass]'); const sub = document.querySelector('[data-sub-page]'); const cs = sub ? getComputedStyle(sub) : null; return { kb: window.__kb(), pb: cs ? cs.paddingBottom : null, field: window.__box(el), ih: window.__ih(), active: document.activeElement && (document.activeElement.getAttribute('placeholder') || document.activeElement.tagName) } })
const syncShot = await shot('kb-7-subpage')
console.log('二级页聚焦: ' + JSON.stringify({ posBefore, ...sSync }))
const syncKb = parseFloat(sSync.kb || '0')
t('S3 同步串输入框聚焦（真实触摸）', /至少 6 个字符/.test(sSync.active || ''), sSync.active)
t('S4 二级页 padding-bottom 跟着 --kb 让位', syncKb > 80 && Math.abs(parseFloat(sSync.pb || '0') - syncKb) <= 1, sSync.pb + ' vs kb=' + sSync.kb)
t('S5 同步串输入框滚进键盘上方可见', !!sSync.field && sSync.field.bottom <= sSync.ih - syncKb + 3, JSON.stringify(sSync.field) + ' ≤ ' + (sSync.ih - syncKb))
console.log('截图: ' + syncShot)
await hideKb()
/* 回今日页用 reload 而不是连点返回：设置是嵌套二级页，返回键逐级退到底要三次，
   reload 对单页应用等价于「回到首页」，省掉对层级结构的假设（第一版就栽在这）。 */
await page.reload({ waitUntil: 'load' })
await page.waitForTimeout(1600)
await page.evaluate(() => {
  window.__box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) } }
  window.__kb = () => getComputedStyle(document.documentElement).getPropertyValue('--kb').trim()
  window.__ih = () => window.innerHeight
})
t('S6 回到今日页（二级页已关）', await page.evaluate(() => !document.querySelector('[data-sub-page]')), '')

/* ===== C 组：焦点切换不叠加 ===== */
const openedSheet = await clickText('添加日程')
await page.waitForTimeout(500)
t('C0 点开「添加日程」', openedSheet, openedSheet)
await tapEl('[data-sheet-evt] input[placeholder="地点（选填）"]')
const c1 = await kbVal()
await tapEl('[data-sheet-evt] input[placeholder*="日程名称"]')
const c2 = await kbVal()
const cShot = await shot('kb-8-switch')
console.log('切换焦点: ' + JSON.stringify({ c1, c2 }))
t('C1 地点框聚焦后 --kb 写入', parseFloat(c1 || '0') > 80, '"' + c1 + '"')
t('C2 切到名称框后 --kb 不叠加（不是两倍）', parseFloat(c2 || '0') > 0 && parseFloat(c2 || '0') < parseFloat(c1 || '0') * 1.6, c1 + ' → ' + c2)

/* ===== T 组：键盘弹着时「添加」按钮可见 ===== */
await tapEl('[data-sheet-evt] input[placeholder="地点（选填）"]')
const btn = await page.evaluate(() => { const el = Array.from(document.querySelectorAll('[data-sheet-evt] button')).find((e) => /^\s*添加\s*$/.test((e.textContent || '').trim())); return { found: !!el, rect: window.__box(el), ih: window.__ih(), kb: window.__kb() } })
const visBottom = btn.ih - parseFloat(btn.kb || '0')
t('T1 「添加」按钮找到了', btn.found, JSON.stringify(btn.rect))
t('T2 键盘弹着时「添加」按钮完整在可见区内（能点才算能提交）', !!btn.rect && btn.rect.bottom <= visBottom + 3 && btn.rect.top >= 0, JSON.stringify(btn.rect) + ' ≤ ' + visBottom)
console.log('截图: ' + cShot)

/* ===== B 组：点空白收键盘 ===== */
const tp = await page.evaluate(() => { const r = document.querySelector('[data-sheet-evt]').getBoundingClientRect(); return { x: r.left + 12, y: r.top + 10 } })
await tapXY(tp.x, tp.y)
await page.waitForTimeout(1000)
const afterBlank = await page.evaluate(() => ({ kb: window.__kb(), panel: window.__box(document.querySelector('[data-sheet-evt]')), ih: window.__ih() }))
const blankShot = await shot('kb-9-blank-tap')
console.log('点空白后: ' + JSON.stringify(afterBlank))
t('B1 点空白收键盘后 --kb 归零', !afterBlank.kb || parseFloat(afterBlank.kb) === 0, '"' + afterBlank.kb + '"')
t('B2 浮层落回底部、底部无空白条', !!afterBlank.panel && Math.abs(afterBlank.panel.bottom - afterBlank.ih) <= 3, JSON.stringify(afterBlank.panel && afterBlank.panel.bottom) + ' vs ' + afterBlank.ih)
console.log('截图: ' + blankShot)

await page.evaluate(() => { const b = Array.from(document.querySelectorAll('[data-sheet-evt] button')).find((e) => (e.textContent || '').indexOf('取消') >= 0); if (b) b.click() })
await page.waitForTimeout(400)
const fin = await page.evaluate(() => ({ sheet: !!document.querySelector('[data-sheet-evt]'), kb: window.__kb(), ih: window.__ih() }))
t('Z1 收工后无残留浮层、--kb 空、窗口正常', !fin.sheet && (!fin.kb || parseFloat(fin.kb) === 0) && fin.ih > 500, JSON.stringify(fin))
t('Z2 全程无页面报错', errs.length === 0, errs.slice(0, 2).join(' | ') || '无')

await browser.close()
const fails = results.filter((r) => !r[1])
console.log('\n=== 真机软键盘·第二批：' + (results.length - fails.length) + '/' + results.length + ' 通过 ===')
process.exit(fails.length ? 1 : 0)
