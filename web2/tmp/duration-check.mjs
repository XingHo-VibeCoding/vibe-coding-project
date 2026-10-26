/* bug 05：日程/课程时长不再只有 40/45/60/90 四档（2026-10-23 用户报「更长时间搞不了」）
   验七件事：
     ① 四颗快捷档还在（没被删掉，老习惯不变）
     ② 时长那一行默认显示「持续时长 + 当前值」（60 → 1 小时）
     ③ 点它开的是**自做数字滚轮**（不是原生 input / number 控件）
     ④ 选 240 → 回到表单显示「4 小时」（不是「240 分」）
     ⑤ 提交后真正落库 240（不是被压回 90）
     ⑥ 单条日程表单同样能选长时长（180 → 3 小时）
     ⑦ 批量识别列表里那一条也能改成长时长
   跑法：先起 dist 静态服务（默认 4177，TW_URL 可覆盖）再 node tmp/duration-check.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'
const WDN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const MONDAY = iso(mon)

const COURSES = [
  { id: 'c1', type: 'course', title: '高等数学', location: '教1-101', weekday: 1, start_time: '09:00', duration: 45, week_rule: 'every', semester_id: 'sem1' },
]

function seedDoc(schedules) {
  return JSON.stringify({
    app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
    semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
    schedules, todos: [],
  })
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-gpu'],
})

async function openApp() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.route('**/*', (r) => (r.request().url().includes('cdn.jsdelivr.net') ? r.abort() : r.continue()))
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc(COURSES))})`)
  await page.addInitScript("localStorage.setItem('web2.onboarded', '1')")
  await page.addInitScript("localStorage.setItem('web2.theme', '\"light\"')")
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  return { ctx, page, errs }
}

async function blankSpot(page, preferWd) {
  return await page.evaluate((wantWd) => {
    for (const el of document.querySelectorAll('[data-cell]')) {
      if (wantWd && Number(el.dataset.cell.split('-')[0]) !== wantWd) continue
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      if (y < 60 || y > window.innerHeight - 60) continue
      const hit = document.elementFromPoint(x, y)
      if (hit && hit.closest('[data-cell]') === el) return { key: el.dataset.cell, x, y }
    }
    return null
  }, preferWd ?? null)
}
async function longPress(page, x, y) {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForTimeout(680)
  await page.mouse.up()
  await page.waitForTimeout(300)
}
/* 数字滚轮：点某一格再确定（同 periods-editor-ui-check 的走法） */
async function pickWheel(page, val) {
  await page.waitForSelector('[data-picker-mask]', { state: 'visible', timeout: 3000 })
  await page.locator(`[data-wheel-val="${val}"]`).first().click()
  await page.waitForTimeout(200)
  await page.locator('[data-picker-ok]').click()
  await page.waitForTimeout(350)
}
const stored = (page, title) => page.evaluate((tt) => {
  const raw = localStorage.getItem('web2.data')
  if (!raw) return []
  const d = JSON.parse(raw)
  return (d.schedules || []).filter((s) => s.title === tt)
}, title)

/* ================= A. 课程表单（周课表长按 → 课程） ================= */
console.log('\n--- A 课程表单 ---')
{
  const { ctx, page, errs } = await openApp()
  await page.locator('nav button', { hasText: '周课表' }).click()
  await page.waitForTimeout(600)
  const spot = await blankSpot(page, 2)
  t('A0 找到可长按的空格', !!spot, spot ? spot.key : '没找到')
  await longPress(page, spot.x, spot.y)
  await page.locator('[data-pick-course]').click()
  await page.waitForTimeout(450)

  const chips = await page.$$eval('[data-sheet-add] [data-add-dur]', (bs) => bs.map((b) => b.innerText.trim()))
  t('A1 四颗快捷档还在（老习惯不变）', chips.join('|') === '40分|45分|60分|90分', chips.join('|'))

  /* 课程表单默认 45 分（openAdd 的 dur=45），不是 60 —— 第一版按 60 写，假红 */
  const durText0 = await page.$eval('[data-add-dur-text]', (el) => el.innerText.trim()).catch(() => '')
  t('A2 默认值写全了时长（45 → 45 分钟）', durText0 === '45 分钟', durText0)

  const nativeInputs = await page.$$eval('[data-sheet-add] input[type="number"], [data-sheet-add] select', (xs) => xs.length)
  t('A3 没有原生数字输入框/下拉（全程自做控件）', nativeInputs === 0, 'native=' + nativeInputs)

  await page.locator('[data-add-dur-custom]').click()
  await page.waitForSelector('[data-picker-mask]', { state: 'visible', timeout: 3000 })
  const pickerTitle = await page.locator('[data-picker-mask] ~ div p').first().innerText().catch(() => '')
  t('A4 点开的是自做滚轮（标题「持续多久」）', /持续多久/.test(pickerTitle), pickerTitle)

  await pickWheel(page, 240)
  const durText1 = await page.$eval('[data-add-dur-text]', (el) => el.innerText.trim()).catch(() => '')
  t('A5 选 240 分钟 → 显示「4 小时」（不是 240 分钟）', durText1 === '4 小时', durText1)

  await page.fill('[data-sheet-add] input[placeholder="课程名称（必填）"]', '晚间自习')
  await page.locator('[data-sheet-add] button', { hasText: /^添加$/ }).click()
  await page.waitForTimeout(700)
  /* 自加课程落在 web2.added（不是 web2.data），且存的是 start/end 不是 duration —— 
     第一版去 web2.data 找、还找 duration 字段，两条都错，所以是假红。 */
  const added = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.added') || '[]'))
  const rec = added.filter((c) => c.name === '晚间自习')
  const mins = (t) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5))
  const dur = rec.length ? mins(rec[0].end) - mins(rec[0].start) : 0
  t('A6 落库时长就是 240（没被压回 90）', rec.length === 1 && dur === 240, rec.length ? rec[0].start + '-' + rec[0].end + ' = ' + dur + ' 分' : '没落库')
  t('A7 全程无 pageerror', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

/* ================= B. 单条日程表单 ================= */
console.log('\n--- B 单条日程表单 ---')
{
  const { ctx, page, errs } = await openApp()
  await page.locator('button', { hasText: '添加日程' }).first().click()
  await page.waitForTimeout(500)
  const chips = await page.$$eval('[data-sheet-evt] button', (bs) => bs.map((b) => b.innerText.trim()))
  t('B1 四颗快捷档还在', chips.includes('40分') && chips.includes('90分'), chips.slice(0, 8).join('|'))

  await page.locator('[data-evt-dur-custom]').click()
  await pickWheel(page, 180)
  const durText = await page.$eval('[data-evt-dur-text]', (el) => el.innerText.trim()).catch(() => '')
  t('B2 选 180 分钟 → 显示「3 小时」', durText === '3 小时', durText)

  await page.fill('[data-sheet-evt] input[placeholder^="日程名称"]', '项目答辩')
  const dateBtn = page.locator('[data-sheet-evt] button', { hasText: /^\d{4}-\d{2}-\d{2}$/ })
  if ((await dateBtn.count()) === 0) {
    await page.locator('[data-sheet-evt] button', { hasText: '日期' }).first().click()
    await page.waitForTimeout(400)
    await page.locator('[data-picker-ok]').click()
    await page.waitForTimeout(300)
  }
  /* 这个按钮按文本 + 锚定正则定位不可靠（matches 恒 0，但 innerText 里明明有「添加」），
     所以给它加了稳定的 data-evt-submit。按文本找按钮是这次踩的坑，别再回去。 */
  await page.locator('[data-evt-submit]').first().click()
  await page.waitForTimeout(700)
  /* 没导入过数据时，独立日程落在 web2.events overlay（store.js addEvent 的 else 分支），
     不是 web2.data.events —— 第一版读 web2.data 所以永远「没落库」。 */
  /* 有导入态时 addEvent 走 store.js:939 的 if 分支 —— 直接 push 进 web2.data.schedules
     （fullEvent 形状，字段叫 title 与 duration），不写 web2.events overlay。
     第一版读 d.events 所以永远「没落库」。 */
  const hit = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('web2.data') || '{}')
    return (d.schedules || []).filter((e) => e.type === 'event' && e.title === '项目答辩')
  })
  /* 日程的落库形状是 fullEvent（store.js:892）：直接存 duration 数字，不像课程存 start/end。 */
  const dur = hit.length ? Number(hit[0].duration) : 0
  t('B3 日程落库就是 180（不是 90）', hit.length === 1 && dur === 180, hit.length ? hit[0].start_time + ' + ' + dur + ' 分' : '没落库')
  t('B4 全程无 pageerror', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

/* ================= C. 批量核对列表也能改长时长 ================= */
console.log('\n--- C 批量识别列表 ---')
{
  const { ctx, page, errs } = await openApp()
  /* 批量识别要一次假的模型调用：把 fetch 里打 api.deepseek.com 的那条换掉。
     Key 也要种进去，否则 summarize 那层会先判「没配 Key」直接返回，根本发不出请求。 */
  await page.addInitScript(`localStorage.setItem('web2.llm', ${JSON.stringify(JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' }))})`)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  const batchOut = JSON.stringify({ events: [{ title: '项目答辩', date: '', start: '18:00', duration: 60, place: '', notes: ['日期没写清'] }] })
  await page.evaluate((out) => {
    window.__aiBatch = out
    const orig = window.fetch
    window.fetch = function (url, init) {
      if (String(url).indexOf('api.deepseek.com') !== -1) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ choices: [{ message: { content: window.__aiBatch } }] }) })
      }
      return orig.apply(this, arguments)
    }
  }, batchOut)
  await page.locator('button', { hasText: '添加日程' }).first().click()
  await page.waitForTimeout(500)
  await page.locator('[data-event-smart]').click()
  await page.waitForTimeout(200)
  await page.locator('[data-event-smart-multi]').click()
  await page.waitForTimeout(250)
  await page.fill('[data-event-smart-input-multi]', '下周一 18:00 项目答辩')
  await page.locator('[data-event-smart-run-multi]').click()
  await page.waitForTimeout(1200)
  t('C1 认出 1 条并列出', (await page.locator('[data-event-batch-item]').count()) === 1, String(await page.locator('[data-event-batch-item]').count()))

  await page.locator('[data-batch-dur-custom]').first().click()
  await pickWheel(page, 300)
  const txt = await page.locator('[data-batch-dur-custom]').first().innerText().catch(() => '')
  t('C2 批量里也能选 300 分钟（显示 5 小时）', /5 小时/.test(txt), txt)
  const errsNow = errs.slice()
  t('C3 全程无 pageerror', errsNow.length === 0, errsNow.join(' | '))
  await ctx.close()
}

/* ================= D. 总结 ================= */
await browser.close()
const pass = results.filter((r) => r[1]).length
const fail = results.length - pass
console.log(`\n=== 时长自定义：${pass}/${results.length} 通过，${fail} 挂 ===`)
process.exit(fail ? 1 : 0)
