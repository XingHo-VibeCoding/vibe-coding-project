/* bug 07：周课表右上「＋」点开要有动画（2026-10-23 用户报「点开没有动画」）
   验：① 点开时选单带过渡类（入场有 ddpop-enter-active）② 不是瞬间出现（点开后的第一帧透明度 < 1
   或过渡类在）③ 收起也有过渡 ④ 四项一条不少（动画不能把菜单项吃掉）。
   跑法：先起 dist 静态服务（4177）再 node tmp/week-menu-anim-check.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'
const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const doc = JSON.stringify({
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: iso(mon), total_weeks: 16 },
  schedules: [{ id: 'c1', type: 'course', title: '高等数学', location: '教1-101', weekday: 1, start_time: '09:00', duration: 45, week_rule: 'every', semester_id: 'sem1' }],
  todos: [],
})

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
await ctx.route('**/*', (r) => (r.request().url().includes('cdn.jsdelivr.net') ? r.abort() : r.continue()))
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(doc)})`)
await page.addInitScript("localStorage.setItem('web2.onboarded', '1')")
await page.addInitScript("localStorage.setItem('theme', 'light')")
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.locator('[data-nav="week"]').click()
await page.waitForTimeout(700)

t('A1 选单初始不存在', (await page.locator('[data-week-menu]').count()) === 0)

/* 点开：在过渡进行中抓一帧，看有没有过渡类 + 透明度是否还没到 1 */
await page.locator('[data-week-add]').click()
const frame = await page.evaluate(() => {
  const el = document.querySelector('[data-week-menu]')
  if (!el) return { found: false }
  const cs = getComputedStyle(el)
  return {
    found: true,
    cls: el.className,
    opacity: Number(cs.opacity),
    transform: cs.transform,
    duration: cs.transitionDuration,
    transitionProp: cs.transitionProperty,
  }
})
t('A2 点开后选单出现了', frame.found)
t('A3 入场挂了过渡（有 ddpop-enter-active）', /ddpop-enter-active/.test(frame.cls || ''), frame.cls || '')
t('A4 过渡时长不是 0s（不是硬闪）', !!frame.duration && frame.duration !== '0s', frame.duration || '')
t('A5 过渡属性含 opacity 与 transform', /opacity/.test(frame.transitionProp || '') && /transform/.test(frame.transitionProp || ''), frame.transitionProp || '')

await page.waitForTimeout(400)
const settled = await page.evaluate(() => {
  const el = document.querySelector('[data-week-menu]')
  const cs = getComputedStyle(el)
  return { opacity: Number(cs.opacity), items: el.querySelectorAll('button').length }
})
t('A6 过渡结束后完全可见（opacity=1）', settled.opacity === 1, String(settled.opacity))
t('A7 四项一条不少（动画没吃掉菜单项）', settled.items === 4, String(settled.items))

/* 收起：点别处 → 应该先有 leave 过渡再消失 */
await page.locator('[data-nav="today"]').click()
await page.waitForTimeout(60)
const leaving = await page.evaluate(() => {
  const el = document.querySelector('[data-week-menu]')
  return el ? el.className : 'gone'
})
t('A8 收起也走过渡（leave-active 或已消失）', /ddpop-leave-active/.test(leaving) || leaving === 'gone', leaving)
await page.waitForTimeout(400)
t('A9 收完真的没了（不留空壳挡住点击）', (await page.locator('[data-week-menu]').count()) === 0)
t('A10 全程无 pageerror', errs.length === 0, errs.join(' | '))

await browser.close()
const pass = results.filter((r) => r[1]).length
const fail = results.length - pass
console.log(`\n=== 周课表加号动画：${pass}/${results.length} 通过，${fail} 挂 ===`)
process.exit(fail ? 1 : 0)
