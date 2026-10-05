/* Stage 8 视觉取证：课表页去掉问候卡（网格拿回整屏）+ 右上 ＋ 选单 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const TODAY_WD = ((new Date().getDay() + 6) % 7) + 1
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date()
monday.setDate(monday.getDate() - (TODAY_WD - 1))
const today = iso(new Date())
const mk = (id, title, start, duration, wd, location = '教三 302') => ({
  id, type: 'course', semester_id: 'sem1', title, location, teacher: '张明',
  weekday: wd, start_time: start, duration, week_rule: 'every',
})
const doc = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: iso(monday), total_weeks: 18 },
  schedules: [
    mk('c1', '高等数学', '08:00', 100, 1), mk('c2', '大学英语', '10:00', 145, 1, '外语楼 205'),
    mk('c3', '线性代数', '14:00', 100, 2), mk('c4', '数据结构', '16:00', 100, 3),
    mk('c5', '体育', '10:00', 100, 4), mk('c6', '晚自习', '19:00', 100, TODAY_WD, '图书馆'),
  ],
  todos: [{ id: 't1', title: '高数作业：第三章习题 1-10', done: false, due_date: today }],
}
/* 形状必须跟 store.js 的 fullEvent 一致（start_time 而不是 start，带 type:'event'）：
   少字段的那版 seed 会让整页白屏——overlay 是 app 自己写的，正常情况下不会遇到。 */
const events = [{
  id: 'e1', type: 'event', title: '班会', note: '', location: '教三 302',
  weekday: null, start_time: '18:00', duration: 60, week_rule: null,
  date: today, color: '', semester_id: null, manual_edited: true,
}]

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript(([d, ev]) => {
  localStorage.setItem('web2.data', JSON.stringify(d))
  localStorage.setItem('web2.events', JSON.stringify(ev))
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', '"light"')
}, [doc, events])
await page.goto(`${BASE}/?t=15:00`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)

await page.$eval('[data-nav="week"]', (el) => el.click())
await page.waitForTimeout(700)
await page.screenshot({ path: 'tmp/stage8-week-full.png' })
const full = await page.evaluate(() => {
  const h = document.querySelector('header')
  const g = document.querySelector('[data-grid]')
  const main = document.querySelector('main[data-page="week"]')
  return {
    headerH: h ? Math.round(h.getBoundingClientRect().height) : null,
    gridTop: g ? Math.round(g.getBoundingClientRect().top) : null,
    gridH: g ? Math.round(g.getBoundingClientRect().height) : null,
    mainTop: main ? Math.round(main.getBoundingClientRect().top) : null,
    menu: document.querySelectorAll('[data-week-menu]').length,
    label: document.querySelector('[data-week-label]')?.innerText.replace(/\s+/g, ' ').trim(),
  }
})
console.log('FULL ' + JSON.stringify(full))

await page.$eval('[data-week-add]', (el) => el.click())
await page.waitForTimeout(400)
await page.screenshot({ path: 'tmp/stage8-week-menu.png' })
const menu = await page.evaluate(() => ({
  items: [...document.querySelectorAll('[data-week-menu] button')].map((b) => b.innerText.trim()),
  mineRec: document.querySelectorAll('[data-mine-rec]').length,
  expanded: document.querySelector('[data-week-add]')?.getAttribute('aria-expanded'),
}))
console.log('MENU ' + JSON.stringify(menu))

await page.$eval('[data-week-sub-list]', (el) => el.click())
await page.waitForTimeout(600)
await page.screenshot({ path: 'tmp/stage8-week-list.png' })
const list = await page.evaluate(() => ({
  listPage: document.querySelectorAll('[data-list-page]').length,
  weekBack: !!document.querySelector('[data-week-sub-week]'),
  menu: document.querySelectorAll('[data-week-menu]').length,
}))
console.log('LIST ' + JSON.stringify(list))

await page.$eval('[data-week-sub-week]', (el) => el.click())
await page.waitForTimeout(600)
const back = await page.evaluate(() => ({
  grid: document.querySelectorAll('[data-grid]').length,
  listPage: document.querySelectorAll('[data-list-page]').length,
}))
console.log('BACK ' + JSON.stringify(back))

/* 顺带看一眼今日页：头部要照常回来 */
await page.$eval('[data-nav="today"]', (el) => el.click())
await page.waitForTimeout(700)
await page.screenshot({ path: 'tmp/stage8-today-head.png' })
const todayInfo = await page.evaluate(() => ({
  headerH: Math.round(document.querySelector('header').getBoundingClientRect().height),
  greet: document.querySelector('header h1')?.innerText.trim(),
}))
console.log('TODAY ' + JSON.stringify(todayInfo))
await browser.close()
console.log('已写出 tmp/stage8-week-full.png / stage8-week-menu.png / stage8-week-list.png / stage8-today-head.png')
