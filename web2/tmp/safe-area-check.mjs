/* Stage 10 真机 S6 抓到的「状态栏让位」回归：
   外壳给 #app 加了 padding-top: var(--sat)（真机约 28px），但
   ① Teleport 到 body 的「我的」二级页、② fixed inset-0 的引导页 都逃出了 #app，
   真机上页头「‹ 返回」就压在系统时间上（浏览器里 --sat 取不到 → 0，所以看不出来）。
   这里手动把 --sat 设成 28px 模拟真机，断言这两类全屏页的头部不会落进状态栏。
   纪律：切 tab / 点页内元素一律程序化 click（非当前页带 inert，真实鼠标事件会被吃） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const SAT = 28
const TODAY_WD = ((new Date().getDay() + 6) % 7) + 1
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date()
monday.setDate(monday.getDate() - (TODAY_WD - 1))
const doc = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: iso(monday), total_weeks: 18 },
  schedules: [{
    id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教三 302', teacher: '张明',
    weekday: TODAY_WD, start_time: '08:00', duration: 100, week_rule: 'every',
  }],
  todos: [
    { id: 't1', title: '高数作业：第三章习题 1-10', done: false, due_date: iso(new Date()) },
    { id: 't2', title: '数据结构实验报告提交', done: false, due_date: iso(new Date()) },
  ],
}

let pass = 0
let fail = 0
const t = (name, ok, extra = '') => {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? '  → ' + extra : ''}`)
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const errs = []

/* ---------- 已引导：走「我的」二级页 ---------- */
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
page.on('pageerror', (e) => errs.push(e.message))
await page.addInitScript(([d]) => {
  localStorage.setItem('web2.data', JSON.stringify(d))
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', '"light"')
}, [doc])
const setSat = (px) => page.evaluate((v) => {
  if (v === null) document.documentElement.style.removeProperty('--sat')
  else document.documentElement.style.setProperty('--sat', v + 'px')
}, px)
const subPageTop = async (entry) => {
  await page.$eval('[data-nav="me"]', (el) => el.click())
  await page.waitForTimeout(250)
  await page.$eval(`[data-me-entry="${entry}"]`, (el) => el.click())
  await page.waitForTimeout(250)
  return page.evaluate(() => {
    const box = document.querySelector('[data-sub-page]')
    const head = box?.querySelector('header')
    const body = box?.querySelector('[data-sub-body]')
    return {
      headTop: head ? Math.round(head.getBoundingClientRect().top) : null,
      bodyBottom: body ? Math.round(body.getBoundingClientRect().bottom) : null,
      vh: window.innerHeight,
    }
  })
}
const back = async () => {
  await page.$eval('[data-sub-back]', (el) => el.click())
  await page.waitForTimeout(250)
}

await page.goto(`${BASE}/?t=15:00`, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)

/* A1：浏览器默认（没有 --sat）不该凭空多出空白 */
let m = await subPageTop('todos')
t('A1 无 --sat 时二级页头部贴顶（不留空白）', m.headTop !== null && m.headTop <= 2, `headTop=${m.headTop}`)
await back()

/* A2/A3：真机 --sat=28px 时，两个二级页的头部都要让开状态栏 */
await setSat(SAT)
m = await subPageTop('todos')
t('A2 --sat=28px 时待办二级页头部让开状态栏', m.headTop !== null && m.headTop >= SAT - 1, `headTop=${m.headTop}`)
t('A2b 二级页正文底部仍在视口内（没被顶出一屏）', m.bodyBottom !== null && m.bodyBottom <= m.vh + 1, `bodyBottom=${m.bodyBottom} / vh=${m.vh}`)
await back()
m = await subPageTop('settings')
t('A3 --sat=28px 时设置二级页头部让开状态栏', m.headTop !== null && m.headTop >= SAT - 1, `headTop=${m.headTop}`)
await back()

/* 顺带：四个入口在真机 --sat 下都点得进去 */
let ok4 = true
const tops = []
for (const k of ['lectures', 'listen', 'todos', 'settings']) {
  const r = await subPageTop(k)
  tops.push(`${k}:${r.headTop}`)
  if (r.headTop === null || r.headTop < SAT - 1) ok4 = false
  await back()
}
t('A4 四个二级页头部都让开状态栏', ok4, tops.join(' '))
await ctx.close()

/* ---------- 未引导：引导页也是 fixed inset-0，同样要让位 ---------- */
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } })
const p2 = await ctx2.newPage()
p2.on('pageerror', (e) => errs.push(e.message))
await p2.addInitScript(() => { localStorage.setItem('web2.theme', '"light"') })
await p2.goto(`${BASE}/?t=15:00`, { waitUntil: 'networkidle' })
await p2.waitForTimeout(400)
const ob0 = await p2.evaluate(() => {
  const box = document.querySelector('[data-ob-step]')
  const h1 = box?.querySelector('h1')
  const logo = box?.querySelector('div')
  return {
    hasOb: !!box,
    boxTop: box ? Math.round(box.getBoundingClientRect().top) : null,
    contentTop: h1 ? Math.round(h1.getBoundingClientRect().top) : (logo ? Math.round(logo.getBoundingClientRect().top) : null),
    vh: window.innerHeight,
  }
})
t('B1 引导页确实在（种子没带 web2.data）', ob0.hasOb, `hasOb=${ob0.hasOb}`)
t('B2 无 --sat 时引导页内容不出界', ob0.contentTop !== null && ob0.contentTop >= 0, `contentTop=${ob0.contentTop}`)
await p2.evaluate(() => document.documentElement.style.setProperty('--sat', '28px'))
await p2.waitForTimeout(150)
const ob1 = await p2.evaluate(() => {
  const box = document.querySelector('[data-ob-step]')
  const h1 = box?.querySelector('h1')
  return {
    headTop: box ? Math.round(box.getBoundingClientRect().top) : null,
    padTop: box ? Math.round(parseFloat(getComputedStyle(box).paddingTop) || 0) : null,
    contentTop: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
    scrollH: box ? box.scrollHeight : null,
    clientH: box ? box.clientHeight : null,
    vh: window.innerHeight,
  }
})
/* 引导页内容是垂直居中的（justify-center），所以量「盒子 top」永远是 0；
   真正的不变量是「预留出状态栏那条 padding-top」——内容被压在时间上是靠这个挡开的 */
t('B3 --sat=28px 时引导页预留状态栏空间（padding-top ≥ 28）', ob1.padTop !== null && ob1.padTop >= SAT - 1, `paddingTop=${ob1.padTop} boxTop=${ob1.headTop}`)
t('B4 --sat=28px 时引导页头图仍在视口内且没多出滚动', ob1.contentTop !== null && ob1.contentTop >= SAT - 1 && ob1.contentTop < ob1.vh, `contentTop=${ob1.contentTop} scrollH=${ob1.scrollH} clientH=${ob1.clientH}`)
await ctx2.close()

t('C1 全程无页面异常', errs.length === 0, errs.slice(0, 2).join(' | '))

await browser.close()
console.log(`\n=== 状态栏让位（二级页 / 引导页）：${pass} 通过 / ${fail} 失败 ===`)
process.exit(fail ? 1 : 0)
