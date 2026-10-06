/* P2 练耳记号可见可撤销（施工单 docs/下一轮施工单.md 的 P2）
   A 段：纯逻辑（Node 直接跑源码，不需要浏览器）
        「我去听了」记号 → 快照里被抑制；撤销 → 重新出现（= 今天不再抑制提醒）
   B 段：浏览器 UI（390×844）
        今日页「今天要听」：被标记的那行仍列出来 + 打标 + 「撤销」；撤销后标记消失
        碎片练耳二级页：顶部那行**在收起态也看得见**（这是 P2 的关键，放进收起区块等于看不见）

   跑法：先起 dist 静态服务（默认 4177，TW_URL 覆盖）再 node tmp/listen-mark-check.mjs
   注意：playwright 会 spawn Chrome，沙箱下会被拦（EPERM），需要 danger-full-access。 */

let pass = 0
let fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}
function dkey(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/* ===== A. 纯逻辑 ===== */
class FakeStore {
  constructor() { this.m = new Map() }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
}
globalThis.localStorage = new FakeStore()
const SF = await import('../src/data/statusFrame.js')

const clip = { id: 'c1', name: '10 Bill Gates' }
t('A1. 没有记号时这段在快照里（到点会提醒它）',
  (() => { const s = SF.buildFrameSnapshot({ listen: [clip], marks: SF.loadFrameMarks() }); return s.listen.length === 1 && s.listen[0].id === 'c1' })())

SF.markListenDone('c1')
t('A2. 记上「我去听了」后它从快照里消失（今天不再提醒）',
  SF.buildFrameSnapshot({ listen: [clip], marks: SF.loadFrameMarks() }).listen.length === 0)
t('A3. 记号落在 web2.frame.marks 上，并带今天的日期（隔天自动作废）',
  SF.loadFrameMarks().date === dkey(0) && SF.loadFrameMarks().listenDone.join(',') === 'c1',
  JSON.stringify(SF.loadFrameMarks()))

t('A4. 撤销不存在的 id：不抛，也不动别的记号',
  (() => {
    SF.markListenDone('c2')
    let ok = false
    try { SF.unmarkListenDone('nope'); ok = SF.loadFrameMarks().listenDone.join(',') === 'c1,c2' } catch { ok = false }
    SF.unmarkListenDone('c1')
    SF.unmarkListenDone('c2')
    return ok
  })())

SF.markListenDone('c1')
SF.unmarkListenDone('c1')
t('A5. 撤销后记号真的没了', SF.loadFrameMarks().listenDone.length === 0, JSON.stringify(SF.loadFrameMarks()))
t('A6. 撤销后这段重新回到快照里（= 不再抑制提醒）',
  (() => { const s = SF.buildFrameSnapshot({ listen: [clip], marks: SF.loadFrameMarks() }); return s.listen.length === 1 && s.listen[0].id === 'c1' })(),
  JSON.stringify(SF.buildFrameSnapshot({ listen: [clip], marks: SF.loadFrameMarks() }).listen))

/* ===== B. 浏览器 UI ===== */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
import { mkdirSync } from 'node:fs'
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const OUT = 'tmp'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
/* 数据：两段今天到期的音频（next_due_date = 昨天 → 到期），其中 c1 已被通知栏记成「今天已去听过」 */
await page.addInitScript(({ yesterday, today }) => {
  localStorage.setItem('web2.onboarded', '1')
  const mk = (id, name, seconds) => ({
    id, name, file: name + '.mp3', seconds, played_count: 0, last_played_at: null,
    review_stage: 0, next_due_date: yesterday, repeat_times: null, archived: false,
    created_at: yesterday + 'T09:00:00.000Z',
  })
  localStorage.setItem('web2.listen', JSON.stringify([mk('c1', '10 Bill Gates', 17), mk('c2', '11 Good news', 27)]))
  localStorage.setItem('web2.frame.marks', JSON.stringify({ date: today, classDone: [], listenDone: ['c1'] }))
}, { yesterday: dkey(-1), today: dkey(0) })
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)

const marksOf = () => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('web2.frame.marks') || 'null') } catch { return null }
})
const clickNav = (k) => page.$eval(`[data-nav="${k}"]`, (el) => el.click())

/* --- B 段 1：今日页「今天要听」 --- */
const listC1 = page.locator('[data-today-listen-item="c1"]')
const listC2 = page.locator('[data-today-listen-item="c2"]')
t('B1. 今日页列了这两段（数据面成立）', (await listC1.count()) === 1 && (await listC2.count()) === 1,
  `c1=${await listC1.count()} c2=${await listC2.count()}`)
t('B2. 被标记的那段**仍然列出来**，只是打了标（不假装没发生过）',
  (await listC1.locator('[data-today-listen-mark]').count()) === 1
  && (await listC1.locator('[data-today-listen-mark]').innerText()).indexOf('今天已去听过') >= 0)
t('B3. 只有被标记的那行有「撤销」', (await listC1.locator('[data-today-listen-unmark]').count()) === 1
  && (await listC2.locator('[data-today-listen-unmark]').count()) === 0)
await page.locator('[data-today-listen]').scrollIntoViewIfNeeded()
await page.screenshot({ path: `${OUT}/listen-mark-today-marked.png` })

await listC1.locator('[data-today-listen-unmark]').click()
await page.waitForTimeout(400)
t('B4. 撤销后今日页的小标与「撤销」都消失',
  (await page.locator('[data-today-listen-mark]').count()) === 0
  && (await page.locator('[data-today-listen-unmark]').count()) === 0)
const afterUndo = await marksOf()
t('B5. 撤销写回了 web2.frame.marks（日子还是今天、listenDone 里没有 c1）',
  !!afterUndo && afterUndo.date === dkey(0) && Array.isArray(afterUndo.listenDone) && afterUndo.listenDone.indexOf('c1') === -1,
  JSON.stringify(afterUndo))
await page.screenshot({ path: `${OUT}/listen-mark-today-undone.png` })

/* --- B 段 2：碎片练耳二级页（收起态也要看得见） --- */
await page.evaluate(({ today }) => {
  localStorage.setItem('web2.frame.marks', JSON.stringify({ date: today, classDone: [], listenDone: ['c1'] }))
}, { today: dkey(0) })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await clickNav('me')
await page.waitForTimeout(300)
await page.$eval('[data-me-entry="listen"]', (el) => el.click())
await page.waitForTimeout(400)

t('B6. 确实进了「碎片练耳」二级页', (await page.locator('[data-sub-title]').innerText()).indexOf('碎片练耳') >= 0,
  await page.locator('[data-sub-title]').innerText())
t('B7. 卡片是收起态（导入入口 [data-listen-import] 不存在）', (await page.locator('[data-listen-import]').count()) === 0)
t('B8. 收起态下顶部那行也看得见（P2 的关键：不能塞进收起区块）', (await page.locator('[data-listen-marks]').count()) === 1)
t('B9. 那行列出被标记的音频名，并带自己的「撤销」',
  (await page.locator('[data-listen-marks]').innerText()).indexOf('10 Bill Gates') >= 0
  && (await page.locator('[data-listen-unmark="c1"]').count()) === 1)
await page.screenshot({ path: `${OUT}/listen-mark-panel-marked.png` })

await page.locator('[data-listen-unmark="c1"]').click()
await page.waitForTimeout(400)
t('B10. 在二级页撤销后整行消失', (await page.locator('[data-listen-marks]').count()) === 0)
const afterPanelUndo = await marksOf()
t('B11. 二级页撤销同样写回 localStorage（listenDone 空）',
  !!afterPanelUndo && afterPanelUndo.listenDone.length === 0, JSON.stringify(afterPanelUndo))
await page.screenshot({ path: `${OUT}/listen-mark-panel-undone.png` })

/* --- B 段 3：回今日页，确认两处口径一致 --- */
await page.$eval('[data-sub-back]', (el) => el.click())
await page.waitForTimeout(300)
await clickNav('today')
await page.waitForTimeout(300)
t('B12. 回今日页：那边的小标也跟着没了（同一个记号源）',
  (await page.locator('[data-today-listen-mark]').count()) === 0)
t('B13. 全程无 pageerror', errors.length === 0, JSON.stringify(errors.slice(0, 2)))

await browser.close()
console.log(`\n练耳记号可见可撤销检查：${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
