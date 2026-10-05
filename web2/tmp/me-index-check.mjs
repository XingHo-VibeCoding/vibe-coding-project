/* Stage 6 自检：「我的」页从功能堆砌改成索引页 —— 一屏只有「1 行学期 + 4 个入口」，
   功能各自进全屏二级页（返回按钮 / 系统返回键都能回索引）。
   ① 索引页只该有 4 个入口，不该再看到录音/练耳/设置的内容
   ② 四个入口各自能推进去、标题对得上、里面有原来那块东西
   ③ 返回键一路往回收：二级页 → 索引 → （再按）今日页，且不许误退出
   ④ 待办清单是「全部待办」：勾选就地生效，已完成收在后面
   纪律：切 tab / 点页内元素一律程序化 click（非当前页带 inert，真实鼠标事件会被吃） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const TODAY_WD = ((new Date().getDay() + 6) % 7) + 1
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date()
monday.setDate(monday.getDate() - (TODAY_WD - 1))
const today = iso(new Date())
const tomorrow = iso(new Date(Date.now() + 86400000))
const doc = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: iso(monday), total_weeks: 18 },
  schedules: [{
    id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教三 302', teacher: '张明',
    weekday: TODAY_WD, start_time: '08:00', duration: 100, week_rule: 'every',
  }],
  todos: [
    { id: 't1', title: '高数作业：第三章习题 1-10', done: false, due_date: today },
    { id: 't2', title: '英语日语小组展示准备', done: true, due_date: today },
    { id: 't3', title: '数据结构实验报告提交', done: false, due_date: tomorrow },
  ],
}

const fakeAppPlugin = /* js */ `
window.Capacitor = { Plugins: {
  App: {
    _cbs: [],
    addListener(name, cb) { if (name === 'backButton') this._cbs.push(cb); return { remove: function () {} } },
    _fire() { for (const cb of this._cbs.slice()) cb({ canGoBack: false }) },
    exitApp() { this._exited = (this._exited || 0) + 1 }
  }
}}`

let pass = 0
let fail = 0
const t = (name, ok, extra = '') => {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? '  → ' + extra : ''}`)
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
await page.addInitScript(fakeAppPlugin)
await page.addInitScript(([d]) => {
  localStorage.setItem('web2.data', JSON.stringify(d))
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', '"light"')
}, [doc])
await page.goto(`${BASE}/?t=15:00`, { waitUntil: 'networkidle' })
await page.waitForTimeout(700)

const fire = () => page.evaluate(() => window.Capacitor.Plugins.App._fire())
const exits = () => page.evaluate(() => window.Capacitor.Plugins.App._exited || 0)
const subCount = () => page.locator('[data-sub-page]').count()
const ME = page.locator('main[data-page="me"]')
const open = (k) => page.$eval(`[data-me-entry="${k}"]`, (el) => el.click())
const back = () => page.$eval('[data-sub-back]', (el) => el.click())

/* 1. 索引页：1 行学期 + 4 个入口，且看不到各功能的内容 */
await page.$eval('[data-nav="me"]', (el) => el.click())
await page.waitForTimeout(500)
t('A1. 「我的」页只有 1 行学期', (await ME.locator('[data-me-term]').count()) === 1)
t('A2. 只有 4 个入口', (await ME.locator('[data-me-entry]').count()) === 4, String(await ME.locator('[data-me-entry]').count()))
const order = await page.evaluate(() => [...document.querySelectorAll('[data-me-entry]')].map((el) => el.getAttribute('data-me-entry')))
t('A3. 入口顺序＝录音历史 / 碎片练耳 / 待办清单 / 设置', JSON.stringify(order) === JSON.stringify(['lectures', 'listen', 'todos', 'settings']), order.join(','))
t('A4. 索引页上没有设置本体（设置自己的页里才有）', (await ME.locator('[data-settings-body]').count()) === 0)
t('A5. 索引页上没有练耳设置面板', (await ME.locator('[data-listen-settings]').count()) === 0)
t('A6. 索引页上没有「开始录音」按钮（录音在自己的页里）', (await ME.getByText('开始录音', { exact: true }).count()) === 0)
const meText = (await ME.innerText()).replace(/\s+/g, ' ')
t('A7. 待办入口如实报数（未完成 2 / 共 3 件）', meText.includes('未完成 2 / 共 3 件'), meText.slice(0, 90))

/* 2. 四个入口各推一层：标题对得上、里面有原来那块东西 */
await open('lectures')
await page.waitForTimeout(350)
t('B1. 点「录音历史」推进二级页', (await subCount()) === 1 && (await page.locator('[data-sub-page]').getAttribute('data-sub')) === 'lectures')
t('B2. 标题＝课堂录音', (await page.locator('[data-sub-title]').innerText()).trim() === '课堂录音')
t('B3. 页里有原录音块（开始录音 + 自动停说明）', (await page.getByText('开始录音', { exact: true }).count()) === 1 && (await page.locator('[data-sub-body]').innerText()).includes('下课后 2 分钟自动停'))
await back()
await page.waitForTimeout(300)
t('B4. 返回按钮回到索引', (await subCount()) === 0)

await open('listen')
await page.waitForTimeout(350)
t('B5. 点「碎片练耳」推进二级页', (await page.locator('[data-sub-page]').getAttribute('data-sub')) === 'listen')
await page.locator('[data-sub-body] button', { hasText: '打开' }).first().click() // 练耳块默认收起，先展开
await page.waitForTimeout(300)
t('B6. 页里有原练耳块（导入按钮）', (await page.locator('[data-sub-body] [data-listen-import]').count()) === 1)
await back()
await page.waitForTimeout(300)

/* 3. 待办清单：全部待办、勾选就地生效、已完成收在后面 */
await open('todos')
await page.waitForTimeout(350)
t('C1. 待办清单二级页', (await page.locator('[data-sub-page]').getAttribute('data-sub')) === 'todos')
t('C2. 三件待办都在（含已完成那件）', (await page.locator('[data-todo-all-check]').count()) === 3, String(await page.locator('[data-todo-all-check]').count()))
const todoBody = (await page.locator('[data-sub-body]').innerText()).replace(/\s+/g, ' ')
t('C3. 计数行＝未完成 2 · 已完成 1', todoBody.includes('未完成 2 件 · 已完成 1 件'), todoBody.slice(0, 40))
const tops = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-todo-all-check]')]
  return rows.map((el) => ({ id: el.getAttribute('data-todo-all-check'), top: Math.round(el.closest('div').getBoundingClientRect().top) }))
})
t('C4. 已完成那件排在未完成后头', tops[2].id === 't2' && tops[2].top > tops[0].top && tops[2].top > tops[1].top, JSON.stringify(tops))
await page.$eval('[data-todo-all-check="t1"]', (el) => el.click())
await page.waitForTimeout(350)
const after = (await page.locator('[data-sub-body]').innerText()).replace(/\s+/g, ' ')
t('C5. 勾掉一件后计数与排序都跟着变（未完成 1 · 已完成 2）', after.includes('未完成 1 件 · 已完成 2 件'), after.slice(0, 40))
await page.$eval('[data-todo-all-check="t1"]', (el) => el.click()) // 复原
await page.waitForTimeout(300)
await back()
await page.waitForTimeout(300)

/* 4. 设置页：内容对得上，且「外观/提醒」在「数据」前面（order-1 / order-2） */
await open('settings')
await page.waitForTimeout(400)
t('D1. 设置二级页', (await page.locator('[data-sub-page]').getAttribute('data-sub')) === 'settings')
t('D2. 设置页里有设置本体（原 data-settings-body 锚点仍在）', (await page.locator('[data-sub-body] [data-settings-body]').count()) === 1)
const setBody = (await page.locator('[data-sub-body]').innerText()).replace(/\s+/g, ' ')
t('D3. 主题外观与数据都在这一页', setBody.includes('主题外观') && setBody.includes('导入主项目数据'))
const vOrder = await page.evaluate(() => {
  const secs = [...document.querySelectorAll('[data-sub-body] > section')]
  const g = (cls) => secs.filter((s) => s.className.includes(cls))[0]
  return { a: Math.round(g('order-1')?.getBoundingClientRect().top || 0), b: Math.round(g('order-2')?.getBoundingClientRect().top || 0) }
})
t('D4. 视觉顺序：设置在上、数据在下', vOrder.a > 0 && vOrder.b > vOrder.a, JSON.stringify(vOrder))

/* 5. 返回键（App 原生那条路）：先回索引，再按才回今日页，全程不误退出 */
await fire()
await page.waitForTimeout(350)
const tabNow = await page.evaluate(() => (document.querySelector('nav button[data-active]')?.innerText || '').trim())
t('E1. 返回键先把二级页收回索引（仍在我的页）', (await subCount()) === 0 && tabNow.includes('我的') && (await exits()) === 0)
await fire()
await page.waitForTimeout(350)
const tabNow2 = await page.evaluate(() => (document.querySelector('nav button[data-active]')?.innerText || '').trim())
t('E2. 再按返回键 → 回今日页（不退出）', tabNow2.includes('今日') && (await exits()) === 0)
t('F1. 全程没有页面异常', errs.length === 0, errs.slice(0, 2).join(' | '))

console.log(`\n=== 我的页索引：${pass} 项通过 / ${fail} 项失败 ===`)
await browser.close()
process.exit(fail ? 1 : 0)
