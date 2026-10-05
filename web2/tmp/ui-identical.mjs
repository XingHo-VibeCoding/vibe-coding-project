/* 纯重构的「外观没变」取证：同一套种子 / 同一套状态 / 同一个 viewport，
   只换 BASE（旧构建 / 新构建）和 OUT（输出目录），拍完直接逐像素比。

   用法（两个端口先各起一个静态服务）：
     $env:BASE='http://127.0.0.1:4177'; $env:OUT='tmp/ui-new'; node tmp/ui-identical.mjs
     $env:BASE='http://127.0.0.1:4179'; $env:OUT='tmp/ui-old'; node tmp/ui-identical.mjs
     python tmp/pixel-diff.py tmp/ui-old tmp/ui-new
   ?t= 与 viewport 必须两边完全一致（本脚本写死），否则比对没有意义。 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const OUT = process.env.OUT || 'tmp/ui-new'
fs.mkdirSync(OUT, { recursive: true })

const TODAY_WD = ((new Date().getDay() + 6) % 7) + 1
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date()
monday.setDate(monday.getDate() - (TODAY_WD - 1))
const today = iso(new Date())
const tomorrow = iso(new Date(Date.now() + 86400000))
const mk = (id, title, start, duration, wd, location = '教三 302') => ({
  id, type: 'course', semester_id: 'sem1', title, location, teacher: '张明',
  weekday: wd, start_time: start, duration, week_rule: 'every',
})
const doc = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: iso(monday), total_weeks: 18 },
  schedules: [
    mk('c1', '高等数学', '08:00', 100, TODAY_WD), mk('c2', '大学英语', '10:00', 145, TODAY_WD, '外语楼 205'),
    mk('c3', '线性代数', '14:00', 100, TODAY_WD, '教二 110'), mk('c4', '数据结构', '16:00', 100, TODAY_WD),
    mk('c5', '体育', '10:00', 100, 4), mk('c6', '晚自习', '19:00', 100, TODAY_WD, '图书馆'),
  ],
  todos: [
    { id: 't1', title: '高数作业：第三章习题 1-10', done: false, due_date: today },
    { id: 't2', title: '英语日语小组展示准备', done: true, due_date: today },
    { id: 't3', title: '数据结构实验报告提交', done: false, due_date: tomorrow },
  ],
}
const events = [{
  id: 'e1', type: 'event', title: '班会', note: '', location: '教三 302',
  weekday: null, start_time: '18:00', duration: 60, week_rule: null,
  date: today, color: '', semester_id: null, manual_edited: true,
}]
const lectures = [
  { id: 'lec_1', title: '高等数学 · 今日', started_at: `${today}T10:00:00.000Z`, duration: 1780, transcript: '这是一段转写文字稿。'.repeat(12), summary: '本节课讲了极限的定义与性质。' },
  { id: 'lec_2', title: '大学英语 · 今日', started_at: `${today}T08:00:00.000Z`, duration: 1520 },
]
const listen = [{ id: 'l1', name: '连放示例.wav', seconds: 42, played_count: 3 }]

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
await page.addInitScript(([d, ev, lec, li]) => {
  localStorage.setItem('web2.data', JSON.stringify(d))
  localStorage.setItem('web2.events', JSON.stringify(ev))
  localStorage.setItem('web2.lectures', JSON.stringify(lec))
  localStorage.setItem('web2.listen', JSON.stringify(li))
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', '"light"')
}, [doc, events, lectures, listen])

const click = (sel) => page.$eval(sel, (el) => el.click())
/* 等布局真正静止再拍：网格高度有 280ms 过渡，且展开/收起后会二次重校，
   单靠固定 waitForTimeout 会偶发拍到过渡中间帧（网格被截短半屏），那就是「假差异」。
   判据：网格高 + body 高 + scrollY 连续两次采样不变。 */
const settle = async (maxMs = 3000) => {
  let prev = null
  let stable = 0
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const sig = await page.evaluate(() => {
      const g = document.querySelector('[data-grid]')
      return [g ? Math.round(g.getBoundingClientRect().height) : 0, Math.round(document.body.scrollHeight), window.scrollY].join('|')
    })
    if (sig === prev) {
      if (++stable >= 2) break
    } else {
      stable = 0
      prev = sig
    }
    await page.waitForTimeout(120)
  }
}
const shot = async (name, note) => {
  await settle()
  const counts = await page.evaluate(() => {
    const g = document.querySelector('[data-grid]')
    const r = g?.getBoundingClientRect()
    return {
      sheetDetail: document.querySelectorAll('[data-sheet-detail]').length,
      sheetAdd: document.querySelectorAll('[data-sheet-add]').length,
      sheetTodo: document.querySelectorAll('[data-sheet-todo]').length,
      sheetEvt: document.querySelectorAll('[data-sheet-evt]').length,
      sheetReview: document.querySelectorAll('[data-sheet-review]').length,
      sheetSem: document.querySelectorAll('[data-sheet-sem]').length,
      onbStep: document.querySelector('[data-ob-step]')?.getAttribute('data-ob-step') || '-',
      addPick: document.querySelectorAll('[data-add-pick]').length,
      subPage: document.querySelectorAll('[data-sub-page]').length,
      weekMenu: document.querySelectorAll('[data-week-menu]').length,
      grid: document.querySelectorAll('[data-grid]').length,
      todayRec: document.querySelectorAll('[data-today-rec]').length,
      gridGeo: r ? `t${r.top.toFixed(1)}/h${r.height.toFixed(1)}/b${r.bottom.toFixed(1)}` : '-',
      navTop: Number(document.querySelector('nav')?.getBoundingClientRect().top.toFixed(1)),
      scrollY: window.scrollY,
    }
  })
  await page.screenshot({ path: path.join(OUT, name) })
  console.log(`${name}  ${note}  ${JSON.stringify(counts)}`)
}
const at = async (t) => {
  await page.goto(`${BASE}/?t=${t}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
}

/* 1–3 今日页三种时间形态 */
await at('08:30'); await shot('01-today-0830.png', '上课中')
await at('15:00'); await shot('02-today-1500.png', '下午空档')
await at('21:30'); await shot('03-today-2130.png', '晚上（复盘形态）')

/* 4–7 课表页：本体 / ＋选单 / 课程详情浮层 / 加课面板 */
await at('15:00')
await click('[data-nav="week"]'); await page.waitForTimeout(700)
await shot('04-week.png', '课表页')
await click('[data-week-add]'); await page.waitForTimeout(450)
await shot('05-week-menu.png', '＋ 选单')
await click('[data-week-menu-course]'); await page.waitForTimeout(600)
await shot('06-week-add-sheet.png', '添加课程面板')
await page.keyboard.press('Escape'); await page.waitForTimeout(400)
await click('[data-nav="week"]'); await page.waitForTimeout(500)
const card = '[data-grid] article'
if (await page.$(card)) {
  await page.$eval(card, (el) => el.click()); await page.waitForTimeout(600)
}
await shot('07-week-detail.png', '课程详情浮层')

/* 8–10 我的页索引 + 两个二级页 */
await at('15:00')
await click('[data-nav="me"]'); await page.waitForTimeout(600)
await shot('08-me-index.png', '我的页索引')
await click('[data-me-entry="todos"]'); await page.waitForTimeout(550)
await shot('09-me-todos.png', '待办清单二级页')
await click('[data-sub-back]'); await page.waitForTimeout(400)
await click('[data-me-entry="settings"]'); await page.waitForTimeout(550)
await shot('10-me-settings.png', '设置二级页')
await click('[data-sub-back]'); await page.waitForTimeout(400)

/* 10b 练耳二级页「展开」态：A2 收口时踩到「注释与声明挤同一行 → 生成器漏收 listenStageLabel →
   展开后整块空白」，而当时 16 张里恰好没有这个状态，像素证明没抓到。补上它。 */
await click('[data-me-entry="listen"]'); await page.waitForTimeout(600)
const listenBtn = page.locator('[data-sub-body] button', { hasText: '打开' }).first()
if (await listenBtn.count()) { await listenBtn.click().catch(() => {}); await page.waitForTimeout(700) }
await shot('10b-me-listen.png', '练耳二级页（展开）')
await click('[data-sub-back]'); await page.waitForTimeout(400)

/* 11 长按网格：类型菜单浮层（PressTypeSheet） */
await at('15:00')
await click('[data-nav="week"]'); await page.waitForTimeout(700)
const box = await page.$eval('[data-grid]', (el) => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width * 0.55, y: r.top + r.height * 0.12 }
}).catch(() => null)
if (box) {
  await page.mouse.move(box.x, box.y)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await page.mouse.up()
  await page.waitForTimeout(500)
}
await shot('11-press-type.png', '长按网格')

/* 12−16 其余浮层（A2 尾批要搬的那几个，必须也有像素覆盖） */
await at('15:00')
await page.locator('button', { hasText: '添加待办' }).first().click().catch(() => {})
await page.waitForTimeout(500)
await shot('12-todo-sheet.png', '待办面板')
await at('15:00')
await page.locator('button', { hasText: '添加日程' }).first().click().catch(() => {})
await page.waitForTimeout(500)
await shot('13-event-sheet.png', '独立日程面板')
await at('21:30')
await click('[data-review-start]'); await page.waitForTimeout(600)
await shot('14-review-sheet.png', '每日复盘浮层')
await at('15:00')
await click('[data-nav="me"]'); await page.waitForTimeout(600)
await click('[data-me-term]'); await page.waitForTimeout(600)
await shot('15-sem-sheet.png', '学期信息编辑弹层')
await ctx.close()

/* 16 引导页：必须在一个**没有 onboarded 标记**的上下文里才会出现 */
{
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
  const p2 = await ctx2.newPage()
  /* 引导页判据是 `!web2.onboarded && !web2.data`（App.vue:747）——
     所以这个上下文必须**什么都不种**（连示例数据都不能有），否则页面直接进今日页。 */
  await p2.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('web2.theme', '"light"')
  })
  await p2.goto(`${BASE}/?t=15:00`, { waitUntil: 'networkidle' })
  await p2.waitForTimeout(900)
  await p2.screenshot({ path: path.join(OUT, '16-onboarding.png') })
  const step = await p2.$eval('[data-ob-step]', (el) => el.getAttribute('data-ob-step')).catch(() => '(没出现)')
  console.log(`16-onboarding.png  引导页  ${JSON.stringify({ obStep: step })}`)
  await ctx2.close()
}

await browser.close()
console.log(`已写出 ${OUT}/ 共 16 张；pageerror=${errs.length}${errs.length ? ' ' + errs.join(' | ') : ''}`)
