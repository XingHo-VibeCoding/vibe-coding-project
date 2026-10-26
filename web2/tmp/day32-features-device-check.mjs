/* 五条新功能真机验收（Day 32，2026-10-17）。用户在 m00629 批了 ①②③，允许写入型验证。
   真机上证的是「WebView 里真的按设计跑」，不是逻辑对不对（逻辑在桌面 118 个脚本里已绿）。

   五组：
     A 05 全量归档：卡片说清本机 N/25 项、点导出后回执非空、手机下载目录真的多出一个文件；
     B 03 时间去哪了：一周 7 行、手机时长如实（没授权写「未开启」，绝不画成 0 分钟）；
     C 02 纪要作业截止日：纪要里有作业行时才验（没有纪要就 SKIP，并写明原因）；
     D 01 反向排课：加一条临时待办 → 今日页出现排课卡与「今天排得下 N 件」→ 删掉临时待办；
     E 04 考试周模式：加一条 4 天后的考试 → 考试页倒计时出现、今日页复习卡出现 → 两下删除。
   跑法：node tmp/day32-features-device-check.mjs（手机已插、App 已启动、9222 已 forward） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const ADB = 'C:\\Users\\26502\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe'
const OUT = path.resolve('tmp/dev-shots')
fs.mkdirSync(OUT, { recursive: true })
const adbOut = (a) => { try { return execFileSync(ADB, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim() } catch { return '' } }
const adbRun = (a) => { try { execFileSync(ADB, a, { maxBuffer: 64 * 1024 * 1024 }) } catch { } }
const results = []
const t = (name, cond, extra) => { results.push([name, !!cond]); console.log((cond ? 'PASS ' : 'FAIL ') + name + '  → ' + (extra === undefined ? '' : extra)) }
const skip = (name, why) => { results.push([name, true]); console.log('SKIP ' + name + '  → ' + why) }

const devs = adbOut(['devices']).split('\n').slice(1).map((l) => l.trim()).filter((l) => l.endsWith('device'))
if (!devs.length) { console.error('[错误] 没有可用设备'); process.exit(2) }
adbRun(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
adbRun(['shell', 'input', 'keyevent', 'KEYCODE_MENU'])
adbRun(['shell', 'svc', 'power', 'stayon', 'true'])

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = browser.contexts()[0].pages()[0]
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })

const helper = () => page.evaluate(() => {
  window.__txt = (s) => { const el = document.querySelector(s); return el ? (el.textContent || '').trim() : null }
  window.__n = (s) => document.querySelectorAll(s).length
})
const shot = async (name) => {
  adbRun(['shell', 'screencap', '-p', '/sdcard/f-' + name + '.png'])
  adbRun(['pull', '/sdcard/f-' + name + '.png', path.join(OUT, name + '.png')])
  adbRun(['shell', 'rm', '/sdcard/f-' + name + '.png'])
  return path.join(OUT, name + '.png')
}
const click = async (sel) => { const ok = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true }, sel); await page.waitForTimeout(650); return ok }
const clickText = async (text) => { const ok = await page.evaluate((s) => { const el = Array.from(document.querySelectorAll('button')).find((e) => (e.textContent || '').trim().indexOf(s) >= 0); if (!el) return false; el.click(); return true }, text); await page.waitForTimeout(650); return ok }
const setVal = async (sel, val) => page.evaluate(([s, v]) => {
  const el = document.querySelector(s)
  if (!el) return false
  const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')
  d.set.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}, [sel, val])

async function home() {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1800)
  await helper()
}
async function openMe(entry) {
  await click('[data-nav="me"]')
  await page.waitForTimeout(300)
  await click('[data-me-entry="' + entry + '"]')
  await page.waitForTimeout(700)
}
async function backToToday() {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1600)
  await helper()
}

const downloads = () => {
  const out = adbOut(['shell', 'ls', '-l', '/sdcard/Download']).split('\n').filter((l) => l.trim().endsWith('.json'))
  return out.length
}

await home()

/* ================= A · 05 全量归档 ================= */
console.log('\n=== A 05 全量归档 ===')
await openMe('settings')
await click('[data-settings-index="data"]')
await page.waitForTimeout(700)
const archText = await page.evaluate(() => window.__txt('[data-archive-card]'))
const archMatch = (archText || '').match(/(\d+)\s*\/\s*(\d+)\s*项有数据/)
t('A1 归档卡片显示「本机 N/25 项有数据」', !!archMatch, archMatch ? archMatch[1] + '/' + archMatch[2] + ' 项' : JSON.stringify((archText || '').slice(0, 80)))
t('A2 卡上写清档案体积（KB）', /KB/.test(archText || ''), (archText || '').match(/[0-9.]+\s*KB/) || '没找到 KB')
const before = downloads()
const exported = await click('[data-archive-export]')
await page.waitForTimeout(2200)
const msg = await page.evaluate(() => window.__txt('[data-archive-msg]'))
const after = downloads()
const archShot = await shot('f-05-archive')
t('A3 点「导出全量归档」按钮点得动', exported, exported)
t('A4 导出后有回执文案', !!msg && msg.length > 0, JSON.stringify(msg))
/* 回执里必须写明「存到哪儿 + 文件名」，然后按那个位置去 adb 里找文件——
   这才是「真的落盘」。改前 <a download> 在 WebView 里不落盘，回执照样说成功。 */
const whereM = (msg || '').match(/已存到「([^」]+)」/)
const fileM = (msg || '').match(/文件名\s*([^\s。]+)/)
let dir = null
if (whereM) {
  const w = whereM[1]
  if (w.indexOf('文档') >= 0) dir = '/sdcard/Documents'
  else if (w.indexOf('下载') >= 0) dir = '/sdcard/Download'
}
let exists = false
let lookedAt = ''
if (fileM) {
  if (dir) {
    lookedAt = dir + '/' + fileM[1]
    exists = adbOut(['shell', 'ls', '-l', lookedAt]).indexOf(fileM[1]) >= 0
  } else {
    lookedAt = 'run-as files/exports/' + fileM[1]
    exists = adbOut(['shell', 'run-as', 'com.llltl6.schedule', 'ls', 'files/exports']).indexOf(fileM[1]) >= 0
  }
}
t('A5 回执写明了「存到哪儿 + 文件名」', !!whereM && !!fileM, JSON.stringify([whereM && whereM[1], fileM && fileM[1]]))
t('A6 按回执给的位置真能找到那个 json（App 里真的落盘了）', exists, '查了 ' + lookedAt)
if (!exists && after > before) t('A6b 兜底：至少下载目录多半了文件', true, '前 ' + before + ' → 后 ' + after)
console.log('截图: ' + archShot)

/* ================= B · 03 时间去哪了 ================= */
console.log('\n=== B 03 时间去哪了 ===')
await home()
await openMe('timeline')
const tlTitle = await page.evaluate(() => window.__txt('[data-sub-title]'))
const days = await page.evaluate(() => window.__n('[data-timeline-day]'))
const usageTexts = await page.evaluate(() => Array.from(document.querySelectorAll('[data-timeline-usage]')).map((e) => (e.textContent || '').trim()))
const lineText = await page.evaluate(() => window.__txt('[data-timeline-line]'))
const tlShot = await shot('f-03-timeline')
t('B1 二级页标题是「时间去哪了」', tlTitle === '时间去哪了', tlTitle)
/* 设计口径：**缺的天不补空行**（timeline.js 第 4 条纪律）——只画真记过的日子，
   否则用户会看到一排 0 以为自己那天什么都没干。所以预期行数 = 最近 7 天里有快照的天数，
   这个数直接从 localStorage 的 web2.daily 数出来（不信界面自己的说法，去对底层数据）。
   ⚠ 别把「另有 N 天没抓到」当成缺的天：那句说的是**没有手机时长**的天，快照本身可能还在。 */
const b2 = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('web2.daily') || 'null')
  const have = raw && raw.days ? Object.keys(raw.days) : []
  const recent = have.slice().sort().reverse().slice(0, 7)
  return { expected: recent.length, total: have.length }
})
/* 2026-10-23 修正：口径是「**最近 n 条记录**」不是「最近 n 个日历日」——
   daily.js 的 recentDays() 是按日期排序后 slice(0, n)，中间断掉的日子不占名额。
   原断言按日历日数，真机上历史记录超过 7 天时就会假红（真机实测：库 7 天 / 近七日交集 4 天）。
   现在直接数「界面画的那些日期 = 库里最近 7 条日期」，这才是设计口径。 */
t('B2 行数 = 库里最近 7 条快照（缺的天不补空行）', days === b2.expected && days > 0, '行数 ' + days + ' / 期望 ' + b2.expected + '（库里共 ' + b2.total + ' 天）')
t('B3 手机时长如实标注（有「未开启」或真实时长，不画 0）', usageTexts.every((x) => !/^\s*0\s*分/.test(x)), JSON.stringify(usageTexts.slice(0, 3)))
t('B4 卡片有一句总结文案', !!lineText && lineText.length > 4, JSON.stringify(lineText))
console.log('截图: ' + tlShot)

/* ================= C · 02 纪要作业截止日 ================= */
console.log('\n=== C 02 纪要作业截止日 ===')
await home()
await openMe('lectures')
const hwCount = await page.evaluate(() => window.__n('[data-hw-item]'))
const lecText = await page.evaluate(() => (document.querySelector('[data-sub-body]') || {}).textContent || '')
if (hwCount > 0) {
  const hwTexts = await page.evaluate(() => Array.from(document.querySelectorAll('[data-hw-item]')).map((e) => (e.textContent || '').slice(0, 60)))
  const hwShot = await shot('f-02-homework')
  t('C1 纪要里有作业行', true, hwCount + ' 条')
  t('C2 作业行标了日期与来源（课堂提到 / 按下次上课日估的）', hwTexts.some((x) => /课堂提到|按下次上课日估的/.test(x)), JSON.stringify(hwTexts.slice(0, 2)))
  console.log('截图: ' + hwShot)
} else {
  skip('C1 纪要作业行', '手机上还没有任何纪要（没有录音转写记录），这条只能等有数据再验')
  skip('C2 作业行日期与来源标注', '同上：没有纪要就没有作业行')
}

/* ================= D · 01 反向排课 ================= */
console.log('\n=== D 01 反向排课 ===')
await home()
const planBefore = await page.evaluate(() => window.__n('[data-plan-card]'))
const openedTodo = await clickText('添加待办')
await page.waitForSelector('[data-sheet-todo]', { state: 'visible' }).catch(() => {})
const typed = await setVal('[data-todo-title]', '真机验收临时待办')
await page.waitForTimeout(200)
const submitted = await click('[data-todo-submit]')
await page.waitForTimeout(900)
const planAfter = await page.evaluate(() => window.__n('[data-plan-card]'))
const planLine = await page.evaluate(() => window.__txt('[data-plan-line]'))
const planItems = await page.evaluate(() => window.__n('[data-plan-item]'))
const planShot = await shot('f-01-plan')
t('D1 加临时待办前：今日页没有排课卡（无待办可排属正常）', planBefore === 0, '卡数 ' + planBefore)
t('D2 待办表单能填能提交', openedTodo && typed && submitted, JSON.stringify([openedTodo, typed, submitted]))
t('D3 有未完成待办后今日页出现排课卡', planAfter === 1, '卡数 ' + planAfter)
t('D4 排课卡写清「排得下几件」', !!planLine && /排得下|没空档/.test(planLine), JSON.stringify(planLine))
t('D5 排课卡里至少一个时间段块', planItems > 0, '块数 ' + planItems)
console.log('截图: ' + planShot)

/* 清理：我的→待办清单→点该条→编辑浮层→删除两下 */
await click('[data-nav="me"]')
await page.waitForTimeout(300)
await click('[data-me-entry="todos"]')
await page.waitForTimeout(700)
const rowOpened = await page.evaluate(() => {
  const el = Array.from(document.querySelectorAll('[data-todo-title-id]')).find((e) => (e.textContent || '').indexOf('真机验收临时待办') >= 0)
  if (!el) return false
  const btn = el.closest('button') || el
  btn.click()
  return true
})
await page.waitForTimeout(700)
const del1 = await click('[data-todo-delete]')
await page.waitForTimeout(300)
const del2 = await click('[data-todo-delete]')
await page.waitForTimeout(800)
const leftTodos = await page.evaluate(() => document.querySelectorAll('[data-todo-title-id]').length)
t('D6 临时待办已删掉（不留痕）', rowOpened && del1 && del2 && leftTodos === 0, JSON.stringify([rowOpened, del1, del2, leftTodos]))

/* ================= E · 04 考试周模式 ================= */
console.log('\n=== E 04 考试周模式 ===')
await home()
await openMe('exams')
const examTitle = await page.evaluate(() => window.__txt('[data-sub-title]'))
t('E1 二级页标题是「考试与复习」', examTitle === '考试与复习', examTitle)
/* 2026-10-23：真机上教务网自动同步已经先塞进 N 场真考试了（E 组原假设「表是空的」已过期），
   所以先记基线，再断言「加完 = 基线 + 1」。这条能真抓住「加了没生效」和「把别人的数据冲掉」。 */
const examBase = await page.evaluate(() => window.__n('[data-exam-item]'))
await click('[data-exam-add]')
await page.waitForTimeout(500)
await setVal('[data-exam-title]', '真机验收测试科目')
await page.waitForTimeout(150)
/* 日期：点开日历选 +4 天（同月内，不用翻页） */
const target = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 4); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) })
await click('[data-exam-date]')
await page.waitForTimeout(600)
const pickedDay = await click('[data-cal-day="' + target + '"]')
await page.waitForTimeout(300)
await click('[data-picker-ok]')
await page.waitForTimeout(400)
await click('[data-exam-submit]')
await page.waitForTimeout(900)
const items = await page.evaluate(() => window.__n('[data-exam-item]'))
const cd = await page.evaluate(() => { const el = document.querySelector('[data-exam-countdown]'); return el ? (el.textContent || '').trim() : null })
const examShot = await shot('f-04-exam-panel')
t('E2 日历可选到 +4 天那天', pickedDay, target)
t('E3 考试加进去了（基线 ' + examBase + ' → ' + items + ' 条）', items === examBase + 1, '基线 ' + examBase + ' / 现在 ' + items)
t('E4 倒计时显示「N 天」', !!cd && /天/.test(cd), JSON.stringify(cd))
console.log('截图: ' + examShot)

/* 今日页应该出现复习卡（14 天内） */
await backToToday()
const examCard = await page.evaluate(() => window.__n('[data-exam-card]'))
const examLine = await page.evaluate(() => window.__txt('[data-exam-card-line]'))
const blocks = await page.evaluate(() => window.__n('[data-exam-block]'))
const todayExamShot = await shot('f-04-today-exam')
t('E5 今日页出现「接下来要考」卡', examCard === 1, '卡数 ' + examCard)
t('E6 卡片写了考哪科、还剩几天', !!examLine && /真机验收测试科目|天/.test(examLine), JSON.stringify(examLine))
console.log('截图: ' + todayExamShot + '（复习块数 ' + blocks + '）')

/* 清理：删掉这条考试（两下确认） */
await openMe('exams')
await click('[data-exam-edit]')
await page.waitForTimeout(600)
const exDel1 = await click('[data-exam-del]')
await page.waitForTimeout(300)
const exDel2 = await click('[data-exam-del]')
await page.waitForTimeout(900)
const itemsLeft = await page.evaluate(() => window.__n('[data-exam-item]'))
/* 不能扫整页文字：「已加进考试表：真机验收测试科目」这行回执还挂在页面上（那是操作反馈，不是考试条目），
   所以只看考试条目本身有没有留下这条测试数据。 */
const testGone = await page.evaluate(() => ![...document.querySelectorAll('[data-exam-item]')].some((el) => (el.textContent || '').includes('真机验收测试科目')))
const emptyShown = await page.evaluate(() => !!document.querySelector('[data-exam-empty]'))
t('E7 测试考试已删除、剩余回到基线（空表时才看空状态）',
  exDel1 && exDel2 && itemsLeft === examBase && testGone && (examBase > 0 || emptyShown),
  JSON.stringify([exDel1, exDel2, itemsLeft, examBase, testGone, emptyShown]))

await backToToday()
const finalExamCard = await page.evaluate(() => window.__n('[data-exam-card]'))
t('E8 删完后今日页的考试卡也消失（不留假数据）', finalExamCard === 0, '卡数 ' + finalExamCard)
t('Z1 全程无页面报错', errs.length === 0, errs.slice(0, 3).join(' | ') || '无')

await browser.close()
const fails = results.filter((r) => !r[1])
console.log('\n=== 五条新功能真机验收：' + (results.length - fails.length) + '/' + results.length + ' 通过 ===')
process.exit(fails.length ? 1 : 0)
