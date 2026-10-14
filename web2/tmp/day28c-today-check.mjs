/* day28c-today-check —— 2026-10-13 用户 m12586 三条修复的验收自检
   ① 「今天 / 第几周」跟随系统时间（跨天不再冻住，回前台/切前台自动重算）
   ② 「开学时间」如实显示用户实际点的那天，并说明「第 1 周从那周的周一起算」
   ③ 周课表页不再有录音钮（由 rec-entry-check 覆盖，这里只做一条交叉确认）

   ① 的测法：addInitScript 里换掉 window.Date 造一个「假今天」，页面加载完再改假时间 +
   派发 focus（App.vue 的 onFrameVisible 挂在 visibilitychange / focus / appStateChange / resume 上），
   然后看头卡那行「M 月 D 日 周X · 第 N 周」有没有跟着变。
   ② 的测法：引导页第 1 步点开学时间 → 自做月历选一个**非周一**的日子 → 看副行文案。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'

let pass = 0
let fail = 0
const t = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? '  → ' + extra : ''}`)
  ok ? pass++ : fail++
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

/* 假钟：默认 2026-10-13 10:30（周二），学期 first_monday = 2026-09-14（周一）
   ⇒ 2026-10-13 是第 5 周；把它推到 2026-10-20 应该是第 6 周。 */
const FAKE_FROM = '2026-10-13T10:30:00'
const FAKE_TO = '2026-10-20T10:30:00'
const doc = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: '2026-09-14', total_weeks: 18 },
  schedules: [{
    id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教三 302', teacher: '张明',
    weekday: 2, start_time: '08:00', duration: 100, week_rule: 'every',
  }],
  todos: [],
}

async function newPage(fakeIso, useTimeBackdoor = true, seedOnboarded = true) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message)))
  await page.addInitScript(([d, iso, seed]) => {
    const Real = Date
    window.__RealDate = Real
    window.__fakeNow = new Real(iso).getTime()
    class FakeDate extends Real {
      constructor(...args) { if (args.length === 0) super(window.__fakeNow); else super(...args) }
      static now() { return window.__fakeNow }
    }
    window.Date = FakeDate
    /* 只在首次导航播种：addInitScript 每次导航都会跑，reload 时不能又把数据/引导标记塞回来 */
    if (sessionStorage.getItem('__seeded')) return
    sessionStorage.setItem('__seeded', '1')
    if (seed) {
      localStorage.setItem('web2.data', JSON.stringify(d))
      localStorage.setItem('web2.onboarded', '1')
      localStorage.setItem('web2.theme', '"light"')
    }
  }, [doc, fakeIso, seedOnboarded])
  /* ?t= 时间后门会关掉那条 30 秒自走定时器（设计如此，便于断言）⇒ 验定时器时不能带它 */
  const url = useTimeBackdoor ? `${BASE}/?t=10:30` : `${BASE}/`
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  return { ctx, page, errs }
}

/* 头卡那行（App.vue 模板）：「10 月 13 日 周二 · 第 5 周」 */
const headLine = (page) => page.evaluate(() => {
  const m = document.body.innerText.match(/(\d+)\s*月\s*(\d+)\s*日\s*周[一二三四五六日]\s*·\s*第\s*(\d+)\s*周/)
  return m ? { raw: m[0], month: +m[1], day: +m[2], week: +m[3] } : null
})

/* ============ ① 跨天：头卡日期与周次跟着假钟走 ============ */
const A = await newPage(FAKE_FROM)
const before = await headLine(A.page)
t('A1 起始态头卡是 10 月 13 日 · 第 5 周', !!before && before.month === 10 && before.day === 13 && before.week === 5, JSON.stringify(before))

/* 把假钟推到下周同一天，再派发 focus（= 用户切回前台） */
await A.page.evaluate((iso) => {
  window.__fakeNow = new window.__RealDate(iso).getTime()
  window.dispatchEvent(new Event('focus'))
}, FAKE_TO)
await A.page.waitForTimeout(600)
const after = await headLine(A.page)
t('A2 切回前台后头卡变成 10 月 20 日 · 第 6 周（不再冻在旧日期）',
  !!after && after.month === 10 && after.day === 20 && after.week === 6, JSON.stringify(after))

/* 只改日期不改钟点：日精进/打卡那套也该跟着走 */
const habitText = await A.page.evaluate(() => document.body.innerText)
t('A3 日期链一整条都换了（页面里不再出现旧的「10 月 13 日」）', !/10 月 13 日/.test(habitText))

/* 30 秒定时器那条路：把假钟再推一天，等定时器自己发现（不等 focus）。
   注意这条路必须**不带** ?t=（后门会关掉定时器），所以另开一页。 */
const A2 = await newPage(FAKE_FROM, false)
const tickBefore = await headLine(A2.page)
t('A4a 不带时间后门时起始态仍是 10 月 13 日 · 第 5 周',
  !!tickBefore && tickBefore.month === 10 && tickBefore.day === 13 && tickBefore.week === 5, JSON.stringify(tickBefore))
await A2.page.evaluate((iso) => { window.__fakeNow = new window.__RealDate(iso).getTime() }, '2026-10-27T10:30:00')
await A2.page.waitForTimeout(31000)
const ticked = await headLine(A2.page)
t('A4b 不碰页面也会自己跨天（30 秒定时器顺带查日期 → 10 月 27 日 · 第 7 周）',
  !!ticked && ticked.month === 10 && ticked.day === 27 && ticked.week === 7, JSON.stringify(ticked))
t('A4c 无报错', A2.errs.length === 0, A2.errs.join(' | '))
await A2.ctx.close()
t('A5 无报错', A.errs.length === 0, A.errs.join(' | '))
await A.ctx.close()

/* ============ ①b 示例数据不重算周次（写死的 4，口径不变） ============ */
const B = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
const bp = await B.newPage()
await bp.addInitScript(() => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', '"light"')
})
await bp.goto(`${BASE}/?t=10:30`, { waitUntil: 'networkidle' })
await bp.waitForTimeout(600)
const mockWk = await bp.evaluate(() => {
  const m = document.body.innerText.match(/第\s*(\d+)\s*周/)
  return m ? +m[1] : null
})
t('B1 示例数据（source=mock）的周次仍是写死的 4，不参与重算', mockWk === 4, `week=${mockWk}`)
await B.close()

/* ============ ② 开学日期：如实显示用户点的那天 + 说明第 1 周从哪天算 ============ */
/* seedOnboarded=false ⇒ 不播 web2.data / web2.onboarded，落一个干净的新访客 */
const C = await newPage(FAKE_FROM, true, false)
t('C1 新访客落在引导层', (await C.page.locator('[data-ob-choice-form]').count()) === 1)
await C.page.$eval('[data-ob-choice-form]', (el) => el.click())
await C.page.waitForTimeout(400)
t('C2 进到第 1 步（有 data-ob-start）', (await C.page.locator('[data-ob-start]').count()) === 1)

/* 点开学时间 → 自做月历 → 选一个**非周一**的日子（2026-10-15 是周四） */
await C.page.$eval('[data-ob-start]', (el) => el.click())
await C.page.waitForSelector('[data-cal-day]', { timeout: 5000 })
const picked = await C.page.evaluate(() => {
  const btn = document.querySelector('[data-cal-day="2026-10-15"]')
  if (!btn) return null
  btn.click()
  return btn.getAttribute('data-cal-day')
})
t('C3 月历上点到 2026-10-15（周四，不是周一）', picked === '2026-10-15', String(picked))
await C.page.$eval('[data-picker-ok]', (el) => el.click()).catch(() => {})
await C.page.waitForTimeout(400)
const hint = await C.page.evaluate(() => document.querySelector('[data-ob-start]')?.innerText.replace(/\s+/g, ' ').trim() || '')
console.log('   开学时间那一行实测：' + hint)
t('C4 如实说出用户点的是 10 月 15 日（周四）', /10 月 15 日/.test(hint) && /周四/.test(hint), hint)
t('C5 同时说明第 1 周从 10 月 12 日（周一）起算', /10 月 12 日/.test(hint) && /周一起算|起算/.test(hint), hint)
t('C6 数据模型里落的仍是合法周一（右端显示 2026-10-12）', /2026-10-12/.test(hint), hint)
await C.ctx.close()

/* ============ ③ 交叉确认：课表页没有录音钮 ============ */
const D = await newPage(FAKE_FROM)
await D.page.$eval('[data-nav="week"]', (el) => el.click())
await D.page.waitForTimeout(500)
t('D1 周课表页没有 [data-week-rec-now]（③ 用户要求去掉）',
  (await D.page.locator('[data-week-rec-now]').count()) === 0)
await D.ctx.close()

await browser.close()
console.log(`\n=== 时间和周次跟随系统 + 开学日期如实显示：${pass} 项通过 / ${fail} 项失败 ===`)
process.exit(fail ? 1 : 0)
