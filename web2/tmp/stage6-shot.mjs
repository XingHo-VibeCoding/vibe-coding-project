/* Stage 6 视觉取证：我的页索引 + 四个二级页（推进/返回都走同一套） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const TODAY_WD = ((new Date().getDay() + 6) % 7) + 1
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date()
monday.setDate(monday.getDate() - (TODAY_WD - 1))
const today = iso(new Date())
const tomorrow = iso(new Date(Date.now() + 86400000))
const mk = (id, title, start, duration, location = '教三 302') => ({
  id, type: 'course', semester_id: 'sem1', title, location, teacher: '张明',
  weekday: TODAY_WD, start_time: start, duration, week_rule: 'every',
})
const doc = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: iso(monday), total_weeks: 18 },
  schedules: [mk('c1', '高等数学', '08:00', 100), mk('c2', '大学英语', '10:00', 145, '外语楼 205'), mk('c3', '线性代数', '14:00', 100, '教二 110')],
  todos: [
    { id: 't1', title: '高数作业：第三章习题 1-10', done: false, due_date: today },
    { id: 't2', title: '英语日语小组展示准备', done: true, due_date: today },
    { id: 't3', title: '数据结构实验报告提交', done: false, due_date: tomorrow },
  ],
}
const lectures = [
  { id: 'lec_1', title: '高等数学 · 10月5日', started_at: '2026-10-05T10:00:00.000Z', duration: 1780, transcript: '这是一段转写文字稿。'.repeat(12), summary: '本节课讲了极限的定义与性质。' },
  { id: 'lec_2', title: '大学英语 · 10月5日', started_at: '2026-10-05T08:00:00.000Z', duration: 1520 },
]
const listen = [{ id: 'l1', name: '连放示例.wav', seconds: 42, played_count: 3 }]

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript(([d, lec, li]) => {
  localStorage.setItem('web2.data', JSON.stringify(d))
  localStorage.setItem('web2.lectures', JSON.stringify(lec))
  localStorage.setItem('web2.listen', JSON.stringify(li))
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', '"light"')
}, [doc, lectures, listen])
await page.goto(`${BASE}/?t=15:00`, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.$eval('[data-nav="me"]', (el) => el.click())
await page.waitForTimeout(600)
await page.screenshot({ path: 'tmp/stage6-me-index.png' })
const idx = await page.evaluate(() => ({
  terms: document.querySelectorAll('[data-me-term]').length,
  entries: [...document.querySelectorAll('[data-me-entry]')].map((el) => el.getAttribute('data-me-entry')),
  text: document.querySelector('main[data-page="me"]').innerText.replace(/\s+/g, ' ').trim(),
  settingsBody: document.querySelectorAll('[data-settings-body]').length,
}))
console.log('INDEX ' + JSON.stringify(idx))

for (const k of ['lectures', 'listen', 'todos', 'settings']) {
  await page.$eval(`[data-me-entry="${k}"]`, (el) => el.click())
  await page.waitForTimeout(500)
  const info = await page.evaluate(() => {
    const p = document.querySelector('[data-sub-page]')
    return {
      sub: p?.getAttribute('data-sub'),
      title: document.querySelector('[data-sub-title]')?.innerText.trim(),
      backText: document.querySelector('[data-sub-back]')?.innerText.trim(),
      bodyTop: document.querySelector('[data-sub-body]')?.innerText.replace(/\s+/g, ' ').trim().slice(0, 70),
      settingsBody: document.querySelectorAll('[data-settings-body]').length,
    }
  })
  console.log(`${k} ` + JSON.stringify(info))
  await page.screenshot({ path: `tmp/stage6-sub-${k}.png` })
  await page.$eval('[data-sub-back]', (el) => el.click())
  await page.waitForTimeout(350)
}
const after = await page.evaluate(() => ({
  subPages: document.querySelectorAll('[data-sub-page]').length,
  indexVisible: !!document.querySelector('[data-me-entry="settings"]'),
}))
console.log('AFTER BACK ' + JSON.stringify(after))
await browser.close()
console.log('已写出 tmp/stage6-me-index.png + tmp/stage6-sub-{lectures,listen,todos,settings}.png')
