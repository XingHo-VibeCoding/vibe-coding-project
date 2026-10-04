/* 五期·每日复盘：结构 + 流程检查（playwright，走 dist 静态服务）
   覆盖：今日页入口卡 → 四题一页一题（含状态五档、未完成待办清单、跳过）→ 生成日精进并落盘
        → 关键句转明天待办（重复点不叠）→ 改一改带出旧答案 → 日精进历史
        → 「我的」页设置行（提醒时间 chip / 开关只在有桥时给）→ 每晚提醒排程（假通知桥）
   跑法：cd web2; $env:PORT='4177'; node serve.js  然后 node tmp/review-check.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let pass = 0, fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

const pad = (n) => String(n).padStart(2, '0')
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dk = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return keyOf(d) }
const T = dk(0)
const TM = dk(1)
const MON = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return keyOf(d) })()
const WD = ((new Date().getDay() + 6) % 7) + 1

const DOC = JSON.stringify({
  app: 'sched',
  schema_version: 1,
  exported_at: new Date().toISOString(),
  semester: { id: 'sem1', name: '测试学期', first_monday: MON, total_weeks: 16 },
  schedules: [{
    id: 'c1', type: 'course', semester_id: 'sem1', title: '环境工程概论', location: '紫金港北4-319',
    weekday: WD, start_time: '10:00', duration: 145, week_rule: 'every',
  }],
  todos: [
    { id: 'td1', title: '高数作业第三章', note: '', due_date: T, done: false, done_at: null, source: 'manual', created_at: new Date().toISOString() },
    { id: 'td2', title: '英语单词 50 个', note: '', due_date: T, done: true, done_at: new Date().toISOString(), source: 'manual', created_at: new Date().toISOString() },
  ],
})

/* 假 Capacitor：LocalNotifications（排程记录进 window.__notify） */
const FAKE_BRIDGE = `
  window.__notify = { channels: [], scheduled: [], cancelled: [], listeners: [] }
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      LocalNotifications: {
        createChannel: async (o) => { window.__notify.channels.push(o.id) },
        registerActionTypes: async (o) => { window.__notify.actionTypes = o.types.map((x) => x.id) },
        checkPermissions: async () => ({ display: 'granted' }),
        requestPermissions: async () => ({ display: 'granted' }),
        getPending: async () => ({ notifications: window.__notify.scheduled.map((n) => ({ id: n.id, extra: n.extra })) }),
        cancel: async (o) => {
          const ids = o.notifications.map((n) => n.id)
          window.__notify.cancelled.push(...ids)
          window.__notify.scheduled = window.__notify.scheduled.filter((n) => !ids.includes(n.id))
        },
        schedule: async (o) => { window.__notify.scheduled.push(...o.notifications); return { notifications: o.notifications.map((n) => ({ id: n.id })) } },
        addListener: async (ev, cb) => { window.__notify.listeners.push(cb); return { remove: () => {} } },
      },
    },
  }
`

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

async function open({ bridge = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url()) })
  await page.addInitScript((docStr) => {
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.data', docStr)
  }, DOC)
  if (bridge) await page.addInitScript(FAKE_BRIDGE)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  return { page, ctx, errors }
}

const goMe = async (page) => {
  await page.locator('nav button').filter({ hasText: '我的' }).click()
  await page.waitForTimeout(250)
  await page.locator('[data-settings-toggle]').click()
  await page.waitForTimeout(250)
}
const todoRows = (page) => page.evaluate(() => {
  const out = []
  const data = JSON.parse(localStorage.getItem('web2.data') || 'null')
  const ov = JSON.parse(localStorage.getItem('web2.todos') || 'null')
  if (data && Array.isArray(data.todos)) out.push(...data.todos.map((x) => ({ title: x.title, due: x.due_date || x.due })))
  if (ov && Array.isArray(ov.added)) out.push(...ov.added.map((x) => ({ title: x.title, due: x.due_date || x.due })))
  return out
})

/* ============ A. 今日页入口 → 四题 → 日精进 ============ */
const m = await open()
const p = m.page
t('A1. 今日页出现「今天收个尾 · 每日复盘」卡', (await p.locator('[data-today-review]').count()) === 1)
const card0 = await p.locator('[data-today-review]').innerText()
t('A2. 未复盘时给「开始复盘」', card0.includes('开始复盘') && !card0.includes('改一改'), card0.replace(/\n/g, ' ').slice(0, 60))
t('A3. 浮层默认不在 DOM', (await p.locator('[data-sheet-review]').count()) === 0)

await p.locator('[data-review-start]').click()
await p.waitForTimeout(280)
t('A4. 点开始 → 复盘浮层出现', (await p.locator('[data-sheet-review]').count()) === 1)
t('A5. 进度显示 1 / 4', (await p.locator('[data-review-step]').innerText()).trim() === '1 / 4')
t('A6. 第 1 题是「今天最值得记的一件事？」', (await p.locator('[data-review-q]').innerText()).includes('最值得记'))

await p.locator('[data-review-input]').fill('把复盘做出来了')
await p.locator('[data-review-next]').click()
await p.waitForTimeout(220)
t('A7. 第 2 题是状态五档（5 个按钮）', (await p.locator('[data-review-mood]').count()) === 5)
t('A8. 进度 2 / 4', (await p.locator('[data-review-step]').innerText()).trim() === '2 / 4')
await p.locator('[data-review-mood="4"]').click()
await p.locator('[data-review-next]').click()
await p.waitForTimeout(220)
const sheet3 = await p.locator('[data-sheet-review]').innerText()
t('A9. 第 3 题列出未完成的待办', (await p.locator('[data-review-q]').innerText()).includes('没做完') && sheet3.includes('高数作业第三章'))
t('A10. 已完成的不进清单', !sheet3.includes('英语单词 50 个'))
await p.locator('[data-review-keep]').first().click()
await p.locator('[data-review-next]').click()
await p.waitForTimeout(220)
t('A11. 第 4 题按钮变成「生成日精进」', (await p.locator('[data-review-next]').innerText()).includes('生成日精进'))
await p.locator('[data-review-input]').fill('把复盘卡片做出来')
await p.locator('[data-review-next]').click()
await p.waitForTimeout(320)
t('A12. 生成后进结果页（日精进）', (await p.locator('[data-review-summary]').count()) === 1)
const sum = await p.locator('[data-review-summary]').innerText()
t('A13. 日精进含当日数据', sum.includes('今天') && sum.includes('待办完成 1/2'), sum.replace(/\n/g, ' ').slice(0, 90))
t('A14. 日精进含今天的两句答案', sum.includes('把复盘做出来了') && sum.includes('把复盘卡片做出来'))
const rec0 = await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('web2.review') || 'null'); return v && v.records ? v.records[0] : null })
t('A15. web2.review 存了当天 1 篇', !!rec0 && rec0.date === T)
t('A16. 记录字段完整（mood/answers/stats）', !!rec0 && rec0.mood === 4 && rec0.answers.proud === '把复盘做出来了' && rec0.stats.todosTotal === 2 && rec0.stats.todosDone === 1, JSON.stringify(rec0 && rec0.stats))
await p.locator('[data-review-done]').click()
await p.waitForTimeout(260)
t('A17. 关掉后今日页直接显示今天的日精进', (await p.locator('[data-today-review-summary]').count()) === 1)
t('A18. 入口按钮改成「改一改」', (await p.locator('[data-review-start]').innerText()).trim() === '改一改')

/* ============ B. 关键句转明天待办 ============ */
await p.locator('[data-review-open-result]').click()
await p.waitForTimeout(240)
await p.locator('[data-review-todo]').click()
await p.waitForTimeout(320)
t('B1. 转待办给出回执', (await p.locator('[data-review-msg]').innerText()).includes('已加进明天待办'))
const rows1 = await todoRows(p)
t('B2. 那条进了明天待办', rows1.some((x) => x.title === '把复盘卡片做出来' && x.due === TM), JSON.stringify(rows1.map((x) => [x.title, x.due])))
await p.locator('[data-review-todo]').click()
await p.waitForTimeout(280)
t('B3. 重复点不叠第二条', (await p.locator('[data-review-msg]').innerText()).includes('已经有这条了'))
t('B4. 库里仍只有这一条同名', (await todoRows(p)).filter((x) => x.title === '把复盘卡片做出来').length === 1)

/* ============ C. 改一改带出旧答案 ============ */
await p.locator('[data-review-done]').click()
await p.waitForTimeout(200)
await p.locator('[data-review-start]').click()
await p.waitForTimeout(240)
t('C1. 改一改带出上次的答案', (await p.locator('[data-review-input]').inputValue()) === '把复盘做出来了')

/* ============ D. 日精进历史 ============ */
await p.locator('[data-sheet-mask]').click()
await p.waitForTimeout(240)
await p.locator('[data-review-open-history]').click()
await p.waitForTimeout(280)
t('D1. 历史里有 1 篇', (await p.locator('[data-review-history-item]').count()) === 1)
const hist = await p.locator('[data-review-history-item]').innerText()
t('D2. 历史条目带日期与日精进正文', hist.includes(T) && hist.includes('把复盘做出来了'), hist.replace(/\n/g, ' ').slice(0, 70))
t('D3. 历史页写明「只在本机」', (await p.locator('[data-sheet-review]').innerText()).includes('只在本机'))

/* ============ E. 我的页设置行（无桥 = 无开关，但时间 chip 可用） ============ */
await p.locator('[data-sheet-mask]').click()
await p.waitForTimeout(200)
await goMe(p)
t('E1. 我的页设置折叠里有「每日复盘」行', (await p.locator('[data-review-row]').count()) === 1)
t('E2. 提醒时间给三档 chip', (await p.locator('[data-review-at]').count()) === 3)
await p.locator('[data-review-at="22:00"]').click()
await p.waitForTimeout(260)
const set1 = await p.evaluate(() => JSON.parse(localStorage.getItem('web2.review.set') || 'null'))
t('E3. 点 22:00 → 落盘', !!set1 && set1.at === '22:00', JSON.stringify(set1))
t('E4. 历史入口显示篇数', (await p.locator('[data-review-history]').innerText()).includes('1 篇'))
t('E5. 浏览器（无桥）不给开关', (await p.locator('[data-review-toggle]').count()) === 0)

/* ============ F. 全部跳过也能生成 ============ */
const c = await open()
const p2 = c.page
await p2.locator('[data-review-start]').click()
await p2.waitForTimeout(250)
for (let i = 0; i < 4; i += 1) {
  await p2.locator('[data-review-skip]').click()
  await p2.waitForTimeout(160)
}
const sum2 = await p2.locator('[data-review-summary]').innerText()
t('F1. 全跳过也能生成日精进', sum2.includes('今天') && !sum2.includes('最值得记的'), sum2.replace(/\n/g, ' ').slice(0, 70))
const rec2 = await p2.evaluate(() => JSON.parse(localStorage.getItem('web2.review')).records[0])
t('F2. 跳过时 mood=0 / 答案为空 / 仍存下来', rec2.mood === 0 && rec2.answers.proud === '' && rec2.summary.length > 0)

/* ============ G. 每晚提醒排程（假通知桥） ============ */
const g = await open({ bridge: true })
const p3 = g.page
const rv1 = await p3.evaluate(() => window.__notify.scheduled.filter((n) => n.extra && n.extra.src === 'web2-review').map((n) => ({ key: n.extra.key, title: n.title, at: n.schedule.at })))
t('G1. 排了未来每晚复盘提醒（≥6 条）', rv1.length >= 6, '条数=' + rv1.length)
t('G2. 标题是「今天过得怎么样？」', rv1.length > 0 && rv1.every((n) => n.title === '今天过得怎么样？'))
t('G3. 默认时刻 23 点', rv1.length > 0 && rv1.every((n) => new Date(n.at).getHours() === 23), JSON.stringify(rv1.map((n) => new Date(n.at).getHours())))
t('G4. 键按日期（r_YYYY-MM-DD）', rv1.length > 0 && rv1.every((n) => /^r_\d{4}-\d{2}-\d{2}$/.test(n.key)), rv1[0] && rv1[0].key)
t('G5. 与课前提醒各用各的标记', rv1.length > 0 && !rv1.some((n) => n.key.startsWith('c_')), 'src 过滤已保证')
await goMe(p3)
t('G6. 有桥时出现复盘开关', (await p3.locator('[data-review-toggle]').count()) === 1)
await p3.locator('[data-review-at="21:00"]').click()
await p3.waitForTimeout(420)
const rv2 = await p3.evaluate(() => window.__notify.scheduled.filter((n) => n.extra && n.extra.src === 'web2-review').map((n) => new Date(n.schedule.at).getHours()))
t('G7. 改成 21:00 后按 21 点重排', rv2.length >= 6 && rv2.every((h) => h === 21), JSON.stringify(rv2))
await p3.locator('[data-review-toggle]').click()
await p3.waitForTimeout(420)
const rv3 = await p3.evaluate(() => window.__notify.scheduled.filter((n) => n.extra && n.extra.src === 'web2-review').length)
const set3 = await p3.evaluate(() => JSON.parse(localStorage.getItem('web2.review.set') || 'null'))
t('G8. 关开关 → 清空该批 + 落盘 enabled=false', rv3 === 0 && !!set3 && set3.enabled === false, '剩=' + rv3 + ' ' + JSON.stringify(set3))

/* ============ H. 无报错 ============ */
t('H1. 主场景无 JS 报错 / 无 4xx', m.errors.length === 0, m.errors.join(' | '))
t('H2. 跳过场景无报错', c.errors.length === 0, c.errors.join(' | '))
t('H3. 通知桥场景无报错', g.errors.length === 0, g.errors.join(' | '))

await browser.close()
console.log(`\n结果：${pass} 过 / ${fail} 挂`)
process.exit(fail ? 1 : 0)
