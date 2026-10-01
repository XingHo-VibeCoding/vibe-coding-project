/* 清除数据并重置 — 板块 A 验证（2026-10-01 重构）：
   此前 bug：doClearData 只删 data/lectures/habits/onboarded，漏了
   added（识别导入的课）/todos/events/courseOv → 用户点清除后课表原封不动。
   本脚本预置 8 个数据键 + 4 个设置键，走「我的 → 清除数据 → 二次确认」，
   reload 后断言：数据键全没了、设置键还在、页面回到引导页。
   服务：python -m http.server 4177 --directory dist（先 npm run build）。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, detail) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  <- ' + String(detail)))
}

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'

const DATA_KEYS = ['web2.data', 'web2.added', 'web2.todos', 'web2.events', 'web2.courseOv', 'web2.lectures', 'web2.habits', 'web2.onboarded']
const KEEP_KEYS = ['web2.theme', 'web2.accent', 'web2.llm', 'web2.notify']

/* 预置数据：8 个数据键给一点真实形状，4 个设置键给可识别的值。
   注意：addInitScript 在 location.reload() 后会再跑一遍把种子灌回去 →
   用 sessionStorage 挡（reload 保留 sessionStorage，新开页面才有播种） */
const SEED = `
if (!sessionStorage.getItem('seeded')) {
sessionStorage.setItem('seeded', '1')
localStorage.setItem('web2.data', JSON.stringify({ semester: { name: '测试学期 2026' }, schedules: [{ type: 'course', weekday: 1, name: '旧课-高数', start: '08:00', end: '08:45', week_rule: 'every' }] }));
localStorage.setItem('web2.added', JSON.stringify([{ id: 'a1', type: 'course', added: true, weekday: 3, name: '旧课-体育', start: '14:00', end: '14:45', week_rule: 'every' }]));
localStorage.setItem('web2.todos', JSON.stringify([{ id: 't1', title: '旧待办', done: false }]));
localStorage.setItem('web2.events', JSON.stringify([{ id: 'e1', type: 'event', title: '旧日程', note: '', location: '', weekday: null, start_time: '15:30', duration: 30, week_rule: null, date: '2026-10-01', color: '', semester_id: null, manual_edited: true }]));
localStorage.setItem('web2.courseOv', JSON.stringify({ '旧课-高数': '置顶' }));
localStorage.setItem('web2.lectures', JSON.stringify([{ id: 'l1', title: '旧录音' }]));
localStorage.setItem('web2.habits', JSON.stringify([{ id: 'h1', name: '旧打卡' }]));
localStorage.setItem('web2.onboarded', '1');
localStorage.setItem('web2.theme', 'dark');
localStorage.setItem('web2.accent', 'rose');
localStorage.setItem('web2.llm', JSON.stringify({ provider: 'deepseek', key: 'sk-keepme', model: 'deepseek-flash' }));
localStorage.setItem('web2.notify', JSON.stringify({ enabled: true }));
}
`

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage()
await page.addInitScript(SEED)
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

/* 进「我的」页（底部导航） */
await page.locator('nav >> text=我的').click()
await page.waitForTimeout(300)
t('A1. 我的页有清除入口', await page.locator('[data-clear-entry]').count() === 1)

/* 点开二次确认弹层，检查保留项文案 */
await page.locator('[data-clear-entry]').click()
await page.waitForTimeout(300)
t('A2. 弹出二次确认弹层', await page.locator('[data-clear-confirm]').count() === 1)
const tip = await page.locator('text=API Key、主题与通知设置会保留').count()
t('A3. 弹层文案说明保留项', tip === 1)

/* 取消：不应清任何键 */
await page.locator('text=取消').click()
await page.waitForTimeout(200)
const afterCancel = await page.evaluate(() => localStorage.getItem('web2.added'))
t('A4. 点取消不清数据（added 还在）', afterCancel !== null)

/* 再开弹层，确认清除（会 location.reload） */
await page.locator('[data-clear-entry]').click()
await page.waitForTimeout(300)
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
  page.locator('[data-clear-confirm]').click(),
])
await page.waitForTimeout(800)

/* 清除后：8 个数据键全没、4 个设置键还在 */
const ls = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])))
for (const k of DATA_KEYS) t(`A5. 数据键已清：${k}`, !(k in ls), ls[k])
for (const k of KEEP_KEYS) t(`A6. 设置键保留：${k}`, k in ls && ls[k], ls[k])
t('A7. localStorage 只剩 4 个设置键', Object.keys(ls).length === 4, JSON.stringify(Object.keys(ls)))

/* 回到引导页（onboarded 与 web2.data 都没了 → 引导层 z-40 重新出现，data-ob-step 是引导层根锚点） */
t('A8. 清除后回到引导页', await page.locator('[data-ob-step]').count() === 1)

await browser.close()

const fail = results.filter((r) => !r[1]).length
console.log(`\n=== ${results.length - fail}/${results.length} 通过 ===`)
process.exit(fail ? 1 : 0)
