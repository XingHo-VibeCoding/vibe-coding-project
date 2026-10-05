/* 美术收口自检（2026-10-05）：
   ① 二级页推入动效真的在跑 —— .push-*（0.28s cubic-bezier(.32,.72,.35,1)，translateX(100%)）
      推进去时 [data-sub-page] 从右侧滑到 0，返回时再滑出去
   ② alpha 档底已换成不透明实色 token —— 页面上不再出现 rgba(ink, 0.02…0.15) 这类底，
      且 soft / soft-2 两个 token 真的在用（浅色与深色各验一遍）
   纪律：切 tab / 点页内元素一律程序化 click（非当前页带 inert，真实鼠标事件会被吃） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const TODAY_WD = ((new Date().getDay() + 6) % 7) + 1
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const monday = new Date()
monday.setDate(monday.getDate() - (TODAY_WD - 1))
const today = iso(new Date())
const doc = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: iso(monday), total_weeks: 18 },
  schedules: [{
    id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教三 302', teacher: '张明',
    weekday: TODAY_WD, start_time: '08:00', duration: 100, week_rule: 'every',
  }],
  todos: [{ id: 't1', title: '高数作业：第三章习题 1-10', done: false, due_date: today }],
}

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
await page.addInitScript(([d]) => {
  localStorage.setItem('web2.data', JSON.stringify(d))
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', '"light"')
}, [doc])
await page.goto(`${BASE}/?t=15:00`, { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

const settle = async () => { await page.waitForTimeout(450) }

/* ---------------- A. 二级页推入动效 ---------------- */
await page.$eval('[data-nav="me"]', (el) => el.click())
await settle()

// A1/A2：推进去时逐帧采样 left，看它是不是真的从右侧滑进来
const enterSamples = await page.evaluate(async () => {
  const out = []
  const el = document.querySelector('[data-me-entry="todos"]')
  el.click()
  const dur = []
  for (let i = 0; i < 22; i += 1) {
    await new Promise((r) => setTimeout(r, 20))
    const sub = document.querySelector('[data-sub-page]')
    if (sub) {
      out.push(Math.round(sub.getBoundingClientRect().left))
      const cs = getComputedStyle(sub)
      if (cs.transitionDuration && !dur.includes(cs.transitionDuration)) dur.push(cs.transitionDuration)
    }
  }
  return { out, dur }
})
const moved = enterSamples.out.filter((x) => x > 8).length
t('A1 推进时二级页从右侧滑入（至少一帧 left > 8px）', moved > 0, `采样 left=${enterSamples.out.join(',')}`)
t('A2 推入用 0.28s（过渡时长里含 0.28s）', enterSamples.dur.some((d) => d.includes('0.28s')), `duration=${enterSamples.dur.join('/')}`)
await settle()
const settledLeft = await page.$eval('[data-sub-page]', (el) => Math.round(el.getBoundingClientRect().left))
t('A3 推完停在位（left = 0）', settledLeft === 0, `left=${settledLeft}`)

// A4：返回时也滑出去（离开动画期间元素还在，且 left 往正数跑）
const leaveSamples = await page.evaluate(async () => {
  const out = []
  document.querySelector('[data-sub-back]').click()
  for (let i = 0; i < 22; i += 1) {
    await new Promise((r) => setTimeout(r, 20))
    const sub = document.querySelector('[data-sub-page]')
    out.push(sub ? Math.round(sub.getBoundingClientRect().left) : null)
  }
  return out
})
t('A4 返回时从右滑出（离开瞬间 left > 8px）', leaveSamples.some((x) => x !== null && x > 8), `采样=${leaveSamples.slice(0, 8).join(',')}…`)
await settle()

/* ---------------- B. alpha 档底 → 实色 token ---------------- */
const scan = () => page.evaluate(() => {
  const vals = []
  const inkAlpha = []
  for (const el of document.querySelectorAll('*')) {
    const bg = getComputedStyle(el).backgroundColor
    vals.push(bg)
    if (/^rgba?\(28, 35, 51, 0\.(0[2-9]|1[0-5])\)$/.test(bg)) inkAlpha.push(bg)
  }
  const count = (needle) => vals.filter((v) => v === needle).length
  return { inkAlpha: inkAlpha.length, inkAlphaSample: inkAlpha[0] || '', soft: count('rgb(238, 240, 244)'), soft2: count('rgb(227, 230, 236)') }
})

// 今日页 + 我的页两屏都扫
const light1 = await scan()
await page.$eval('[data-nav="me"]', (el) => el.click())
await settle()
const light2 = await scan()
const lightInk = light1.inkAlpha + light2.inkAlpha
const lightSoft = light1.soft + light2.soft + light1.soft2 + light2.soft2
t('B1 浅色：页面上不再有 rgba(ink, 0.02…0.15) 这类 alpha 底', lightInk === 0, `命中 ${lightInk} 处 ${light1.inkAlphaSample}`)
t('B2 浅色：soft / soft-2 实色底真的在用', lightSoft > 0, `soft ${light1.soft + light2.soft} · soft-2 ${light1.soft2 + light2.soft2}`)

// 深色再验一遍
await page.$eval('header button', (el) => el.click())
await settle()
const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
const dark1 = await page.evaluate(() => {
  const vals = []
  const inkAlpha = []
  for (const el of document.querySelectorAll('*')) {
    const bg = getComputedStyle(el).backgroundColor
    vals.push(bg)
    if (/^rgba?\(232, 236, 245, 0\.(0[2-9]|1[0-5])\)$/.test(bg)) inkAlpha.push(bg)
  }
  const count = (n) => vals.filter((v) => v === n).length
  return { inkAlpha: inkAlpha.length, soft: count('rgb(32, 40, 57)'), soft2: count('rgb(42, 50, 68)') }
})
t('B3 深色模式确实切过去了', isDark, `dark=${isDark}`)
t('B4 深色：无 ink alpha 底，且深色 soft / soft-2 在用', dark1.inkAlpha === 0 && dark1.soft + dark1.soft2 > 0, `alpha ${dark1.inkAlpha} · soft ${dark1.soft} · soft-2 ${dark1.soft2}`)

/* ---------------- C. 动效不该把交互弄坏 ---------------- */
t('C1 全程无页面异常', errs.length === 0, errs.join(' | '))

console.log(`\n=== 美术收口自检：${pass} 项通过 / ${fail} 项失败 ===`)
await browser.close()
process.exit(fail ? 1 : 0)
