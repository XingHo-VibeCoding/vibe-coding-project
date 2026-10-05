/* Stage 8 自检：课表页「去掉重复问候卡 + ＋ 选单」。
   ① 课表页顶部只剩周次切换 + 右上 ＋；问候卡收起、网格拿回整屏（旧分段控件下线）
   ② ＋ 打开选单：手动加课 / 加日程 / 拍课表识别 / 其他日程（识别项的旧锚点 data-mine-rec 跟着搬进来）
   ③ 选单的收起时机：选中任一项 / 点别处 / 按返回键（返回键只收选单，不切页、不误退出）
   ④ 四个入口各自真的干活；其他日程子视图能来回
   纪律：切 tab / 点页内元素一律程序化 click（非当前页带 inert，真实鼠标事件会被吃） */
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
  schedules: [mk('c1', '高等数学', '08:00', 100, 1), mk('c2', '大学英语', '10:00', 145, TODAY_WD, '外语楼 205')],
  todos: [{ id: 't1', title: '高数作业：第三章习题 1-10', done: false, due_date: today }],
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
const count = (sel) => page.locator(sel).count()
const openMenu = async () => {
  await page.$eval('[data-week-add]', (el) => el.click())
  await page.waitForTimeout(320)
}
const menuItems = () => page.evaluate(() => [...document.querySelectorAll('[data-week-menu] button')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()))

await page.$eval('[data-nav="week"]', (el) => el.click())
await page.waitForTimeout(700)

/* ---- A 课表页顶部结构 ---- */
t('A1 顶部是周次切换（前/后/标签各 1）',
  (await count('[data-week-prev]')) === 1 && (await count('[data-week-next]')) === 1 && (await count('[data-week-label]')) === 1)
t('A2 旧分段控件下线（[data-week-sub] 与视图按钮都清掉）',
  (await count('[data-week-sub]')) === 0 && (await count('[data-week-sub-week]')) === 0)
t('A3 ＋ 恰 1 个，默认不开选单', (await count('[data-week-add]')) === 1 && (await count('[data-week-menu]')) === 0)
const H = await page.evaluate(() => {
  const hdr = document.querySelector('header')
  const wrap = hdr && hdr.parentElement
  const main = document.querySelector('main[data-page="week"]')
  const g = document.querySelector('[data-grid]').getBoundingClientRect()
  const n = document.querySelector('nav').getBoundingClientRect()
  /* 问候语「可见」= 真的能被点到：header 被 0fr + overflow:hidden 裁掉后，
     h1 自己的 getBoundingClientRect() 仍是布局原值（height>0、top 在视口里），
     所以只能问「这个点上的元素是不是还在 header 里」（elementFromPoint 命中测试）。 */
  let greetVisible = false
  const h1 = document.querySelector('header h1')
  if (h1) {
    const r = h1.getBoundingClientRect()
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    if (r.width > 0 && r.height > 0 && cy >= 0 && cy < window.innerHeight) {
      const hit = document.elementFromPoint(cx, cy)
      greetVisible = !!(hit && hdr.contains(hit))
    }
  }
  return {
    wrapH: +wrap.getBoundingClientRect().height.toFixed(1),
    headerNaturalH: +hdr.getBoundingClientRect().height.toFixed(1),
    mainTop: +main.getBoundingClientRect().top.toFixed(1),
    gap: +(n.top - g.bottom).toFixed(1),
    greetVisible,
  }
})
t('A4 问候卡收起、且课表页从顶端开始', H.wrapH <= 2 && H.mainTop <= 2, `可见高 ${H.wrapH}px（自然高 ${H.headerNaturalH}px）/ mainTop ${H.mainTop}px`)
t('A5 课表页看不到今日页那句问候语（命中测试）', H.greetVisible === false, `greetVisible=${H.greetVisible}`)
t('A6 网格拿回整屏（与底部导航间隙 ≤14px）', H.gap <= 14, `间隙 ${H.gap}px`)

/* ---- B ＋ 选单 ---- */
await openMenu()
t('B1 点 ＋ 弹出选单，四项文案与顺序正确',
  JSON.stringify(await menuItems()) === JSON.stringify(['手动加课', '加日程', '拍课表识别', '其他日程']),
  JSON.stringify(await menuItems()))
t('B2 aria-expanded 跟着变',
  (await page.locator('[data-week-add]').getAttribute('aria-expanded')) === 'true')
t('B3 识别入口的旧锚点 data-mine-rec 搬进选单且可见',
  (await count('[data-mine-rec]')) === 1 && (await page.locator('[data-mine-rec]').isVisible()))
/* 点别处收起 */
await page.mouse.click(200, 700)
await page.waitForTimeout(250)
t('B4 点选单以外的地方收起', (await count('[data-week-menu]')) === 0)
/* ＋ 是开关 */
await openMenu()
await openMenu()
t('B5 ＋ 连点两次收起（开关语义）', (await count('[data-week-menu]')) === 0)
/* 返回键：只收选单 */
await openMenu()
const exitsBefore = await exits()
await fire()
await page.waitForTimeout(250)
const afterBack = await page.evaluate(() => ({
  menu: document.querySelectorAll('[data-week-menu]').length,
  weekActive: document.querySelector('[data-nav="week"]')?.getAttribute('data-active'),
  grid: document.querySelectorAll('[data-grid]').length,
}))
t('B6 返回键先收选单：不切页、不误退出',
  afterBack.menu === 0 && afterBack.weekActive === '1' && afterBack.grid === 1 && (await exits()) === exitsBefore,
  JSON.stringify(afterBack))

/* ---- C 四个入口各自干活 ---- */
await openMenu()
await page.$eval('[data-week-menu-course]', (el) => el.click())
await page.waitForTimeout(400)
t('C1 手动加课 → 打开加课表单', await page.locator('[data-sheet-add]').isVisible())
await fire()
await page.waitForTimeout(350)
t('C2 关掉表单后选单与表单都不残留',
  (await count('[data-sheet-add]')) === 0 && (await count('[data-week-menu]')) === 0 && (await count('[data-week-add]')) === 1)

await openMenu()
await page.$eval('[data-week-menu-event]', (el) => el.click())
await page.waitForTimeout(400)
t('C3 加日程 → 打开日程表单', await page.locator('[data-sheet-evt]').isVisible())
await fire()
await page.waitForTimeout(350)
t('C4 关掉日程表单', (await count('[data-sheet-evt]')) === 0)

await openMenu()
await page.$eval('[data-week-menu-scan]', (el) => el.click())
await page.waitForTimeout(500)
t('C5 拍课表识别 → 进识别页（有取消出口）', await page.locator('[data-mine-rec-cancel]').isVisible())
await page.$eval('[data-mine-rec-cancel]', (el) => el.click())
await page.waitForTimeout(500)
t('C6 取消后回课表页，＋ 仍在', await page.locator('[data-week-add]').isVisible())

await openMenu()
await page.$eval('[data-week-sub-list]', (el) => el.click())
await page.waitForTimeout(600)
t('C7 其他日程 → 切到清单视图（网格让位、返回按钮出现）',
  (await count('[data-list-page]')) === 1 && (await count('[data-grid]')) === 0 && (await count('[data-week-sub-week]')) === 1)
await openMenu()
t('C8 清单视图里 ＋ 仍在，但选单不再列「其他日程」',
  (await count('[data-week-menu]')) === 1 &&
  JSON.stringify(await menuItems()) === JSON.stringify(['手动加课', '加日程', '拍课表识别']),
  JSON.stringify(await menuItems()))
await page.$eval('[data-week-sub-week]', (el) => el.click())
await page.waitForTimeout(600)
t('C9 返回周课表：网格回来、清单让位',
  (await count('[data-grid]')) === 1 && (await count('[data-list-page]')) === 0)

t('D1 全程无页面异常', errs.length === 0, errs.join(' | ').slice(0, 200))

await browser.close()
console.log(`\n=== 课表页 ＋ 选单：${pass} 项通过 / ${fail} 项失败 ===`)
process.exit(fail ? 1 : 0)
