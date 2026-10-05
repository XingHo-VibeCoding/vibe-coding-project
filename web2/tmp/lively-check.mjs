/* 「眼前一亮」1+2+3（v1.41.6）检查——playwright，走 dist 静态服务。
   1) 今日页课卡的「现在」活进度条 + 周课表「现在」游标（只在本周画、随 ?t= 落点变化）
   2) 学期的周进度带（只今日页出现、格子数 = totalWeeks、距期末天数算法一致）
   3) 主题随时间呼吸（默认关；打开后按真实小时选档并落盘；关掉不闪回）
   跑法：先起 dist 静态服务（默认 4177，TW_URL 可覆盖）再 node tmp/lively-check.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
let pass = 0
let fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}
const flat = (s) => String(s).replace(/\s+/g, ' ').trim()

const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const MONDAY = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const TODAY_WD = ((now.getDay() + 6) % 7) + 1

const course = (id, title, start, dur) => ({
  id, type: 'course', semester_id: 'sem1', title, location: '紫金港北4-319',
  weekday: TODAY_WD, start_time: start, duration: dur, week_rule: 'every',
})
const SEM16 = { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 }
function seedDoc(schedules, sem) {
  return JSON.stringify({
    app: 'sched', schema_version: 1, exported_at: '2026-10-04T02:00:00.000Z',
    semester: sem || SEM16, schedules, todos: [],
  })
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

async function open(opts = {}) {
  const { t: tParam, schedules = [], sem } = opts
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url()) })
  await page.addInitScript(`localStorage.setItem('web2.onboarded','1');localStorage.setItem('web2.data', ${JSON.stringify(seedDoc(schedules, sem))})`)
  await page.goto(BASE + (tParam ? '?t=' + tParam : ''), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  return { page, ctx, errors }
}
const tab = (page, name) => page.locator('nav button').filter({ hasText: name })

/* ============ A. 学期进度带（今日页） ============ */
const A = await open()
const pa = A.page
t('A1. 今日页出现学期进度带', (await pa.locator('[data-term-ribbon]').count()) === 1)
const ribbonTxt = flat(await pa.locator('[data-term-ribbon]').innerText())
t('A2. 文案 = 学期进度 · 第 N / 16 周', /学期进度 · 第 \d+ \/ 16 周/.test(ribbonTxt), ribbonTxt)
t('A3. 一周一格，共 16 格', (await pa.locator('[data-term-w]').count()) === 16)
const hs = await pa.evaluate(() => [...document.querySelectorAll('[data-term-w]')].map((e) => Math.round(e.getBoundingClientRect().height)))
t('A4. 已过亮的格子更高（当前周 10px / 其余 7px）',
  Math.max(...hs) === 10 && hs.filter((h) => h === 10).length === 1 && hs.filter((h) => h === 7).length === 15,
  JSON.stringify(hs))
const wantLeft = `距期末 ${Math.max(0, Math.ceil((new Date(MONDAY + 'T00:00:00').getTime() + 16 * 7 * 86400000 - new Date(TODAY + 'T00:00:00').getTime()) / 86400000))} 天`
t('A5. 距期末天数与学期起止算法一致', flat(await pa.locator('[data-term-left]').innerText()) === wantLeft,
  flat(await pa.locator('[data-term-left]').innerText()) + ' vs ' + wantLeft)
await tab(pa, '周课表').click()
await pa.waitForTimeout(400)
t('A6. 周课表页不出现进度带（那是紧凑头部）', (await pa.locator('[data-term-ribbon]').count()) === 0)
await tab(pa, '我的').click()
await pa.waitForTimeout(400)
t('A7. 我的页不出现进度带', (await pa.locator('[data-term-ribbon]').count()) === 0)
t('A8. 全程无报错', A.errors.length === 0, A.errors.join(' | '))
await A.ctx.close()

const A2s = await open({ sem: { id: 'sem1', name: '测试学期', first_monday: MONDAY } })
t('A9. 学期信息不全（缺 total_weeks）时回落示例数据：进度带照出，但「距期末」不猜（示例学期没有起止日）',
  (await A2s.page.locator('[data-term-ribbon]').count()) === 1
  && (await A2s.page.locator('[data-term-left]').count()) === 0
  && /第 4 \/ 18 周/.test(flat(await A2s.page.locator('[data-term-ribbon]').innerText())),
  flat(await A2s.page.locator('[data-term-ribbon]').innerText()))
await A2s.ctx.close()

/* ============ B. 今日页「现在」活进度条 ============ */
const CLS = [course('c1', '环境工程概论', '10:00', 145)] // 10:00–12:25
const B = await open({ t: '11:00', schedules: CLS })
const pb = B.page
t('B1. 课内出现实时进度条', (await pb.locator('[data-now-bar]').count()) === 1)
const ratio = await pb.evaluate(() => {
  const bar = document.querySelector('[data-now-bar]')
  return bar && bar.firstElementChild ? bar.firstElementChild.getBoundingClientRect().width / bar.getBoundingClientRect().width : -1
})
t('B2. 进度条宽度 ≈ 已过 41%', Math.abs(ratio - 0.41) < 0.04, String(ratio))
const todayTxt = flat(await pb.locator('[data-page="today"]').innerText())
/* Stage 2 起「现在」卡搬进共享 header（不在 [data-page="today"] 里），所以课上信息分两处读 */
const heroTxt = flat(await pb.locator('[data-today-now]').innerText())
t('B3. 「现在」卡给出课名（卡上「进行中 · 环境工程概论」）+ 列表行剩余分钟（「还剩 85 分」）',
  heroTxt.includes('进行中 · 环境工程概论') && heroTxt.includes('还剩 85 分钟') && todayTxt.includes('还剩 85 分'),
  JSON.stringify({ hero: heroTxt.slice(0, 120), today: todayTxt.slice(0, 160) }))
t('B4. 无报错', B.errors.length === 0, B.errors.join(' | '))
await B.ctx.close()
const B5 = await open({ t: '09:00', schedules: CLS })
t('B5. 上课前没有进度条', (await B5.page.locator('[data-now-bar]').count()) === 0)
await B5.ctx.close()
const B6 = await open({ t: '13:00', schedules: CLS })
t('B6. 下课后没有进度条', (await B6.page.locator('[data-now-bar]').count()) === 0)
await B6.ctx.close()

/* ============ C. 周课表「现在」游标 ============ */
const C = await open({ t: '11:00', schedules: CLS })
const pc = C.page
await tab(pc, '周课表').click()
await pc.waitForTimeout(500)
t('C1. 本周课表出现「现在」游标', (await pc.locator('[data-now-line]').count()) === 1)
const li = await pc.evaluate(() => {
  const l = document.querySelector('[data-now-line]')
  const g = document.querySelector('[data-grid]')
  if (!l || !g) return null
  return { top: parseFloat(getComputedStyle(l).top), gridH: g.getBoundingClientRect().height, chip: l.innerText.trim() }
})
t('C2. 游标 top 落在课表高度内', !!li && li.top >= 0 && li.top <= li.gridH, JSON.stringify(li))
t('C3. 右端时间胶囊 = 当前时刻', !!li && li.chip === '11:00', li ? li.chip : 'null')
await pc.locator('[data-week-next]').click()
await pc.waitForTimeout(400)
t('C4. 切到下一周后游标消失（只在「本周」有意义）', (await pc.locator('[data-now-line]').count()) === 0)
t('C5. 全程无报错', C.errors.length === 0, C.errors.join(' | '))
await C.ctx.close()
const C6 = await open({ t: '05:00', schedules: CLS })
const pc6 = C6.page
await tab(pc6, '周课表').click()
await pc6.waitForTimeout(500)
t('C6. 最早一节课之前不画游标', (await pc6.locator('[data-now-line]').count()) === 0)
await C6.ctx.close()

/* ============ D. 主题随时间呼吸 ============ */
const D = await open()
const pd = D.page
t('D1. 默认关（web2.theme.auto 没被写过）', (await pd.evaluate(() => localStorage.getItem('web2.theme.auto'))) === null)
await tab(pd, '我的').click()
await pd.waitForTimeout(400)
await pd.locator('[data-settings-toggle]').click()
await pd.waitForTimeout(400)
t('D2. 设置里有「跟着时间自动换」开关', (await pd.locator('[data-theme-auto]').count()) === 1)
const h = now.getHours()
const slot = h < 5 ? { a: 'lavender', dark: true, name: '夜里' }
  : h < 9 ? { a: 'mint', dark: false, name: '清晨' }
    : h < 17 ? { a: 'blue', dark: false, name: '白天' }
      : h < 21 ? { a: 'lavender', dark: false, name: '傍晚' }
        : { a: 'lavender', dark: true, name: '夜里' }
await pd.locator('[data-theme-auto]').click()
await pd.waitForTimeout(300)
const on = await pd.evaluate(() => ({
  acc: document.documentElement.dataset.accent,
  dark: document.documentElement.classList.contains('dark'),
  flag: localStorage.getItem('web2.theme.auto'),
  accSaved: localStorage.getItem('web2.accent'),
  thSaved: localStorage.getItem('web2.theme'),
}))
t('D3. 打开后写 web2.theme.auto=1', on.flag === '1', JSON.stringify(on))
t(`D4. 按真实小时（${h} 点）落到「${slot.name}」配色 ${slot.a}`, on.acc === slot.a, on.acc)
t('D5. 深浅与档位一致', on.dark === slot.dark, JSON.stringify({ got: on.dark, want: slot.dark }))
t('D6. 配色/深浅都落盘', !!on.accSaved && on.thSaved !== null, JSON.stringify({ accSaved: on.accSaved, thSaved: on.thSaved }))
const sub = (await pd.locator('[data-theme-auto]').locator('xpath=..').innerText())
t('D7. 副文案写明当前时段', flat(sub).includes('当前时段：' + slot.name), flat(sub))
await pd.locator('[data-theme-auto]').click()
await pd.waitForTimeout(300)
const off = await pd.evaluate(() => ({
  acc: document.documentElement.dataset.accent,
  flag: localStorage.getItem('web2.theme.auto'),
  sub: document.querySelector('[data-theme-auto]').parentElement.innerText,
}))
t('D8. 关掉写 0，且配色不被复原（不闪回）', off.flag === '0' && off.acc === slot.a, JSON.stringify({ flag: off.flag, acc: off.acc }))
t('D9. 关掉副文案回到默认说明', flat(off.sub).includes('清晨 / 白天 / 傍晚 / 夜里各一套'), flat(off.sub))
t('D10. 全程无报错', D.errors.length === 0, D.errors.join(' | '))
await D.ctx.close()

await browser.close()
console.log(`\n结果：${pass} 过 / ${fail} 挂`)
process.exit(fail ? 1 : 0)
