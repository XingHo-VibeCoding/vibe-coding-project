/* P6 出图：账卡副栏（折叠 / 展开 / 无权限三态），给用户肉眼确认
   前置：cd web2; $env:PORT='4177'; node serve.js  产物：web2/tmp/p6-shots/ */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import { mkdirSync } from 'node:fs'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = `http://127.0.0.1:${process.env.PORT || 4177}/`
const OUT = 'tmp/p6-shots'
mkdirSync(OUT, { recursive: true })

const pad = (n) => String(n).padStart(2, '0')
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const MON = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return keyOf(d) })()
const WD = ((new Date().getDay() + 6) % 7) + 1

const DOC = JSON.stringify({
  app: 'sched', schema_version: 1, exported_at: new Date().toISOString(),
  semester: { id: 'sem1', name: '测试学期', first_monday: MON, total_weeks: 16 },
  schedules: [{ id: 'c1', type: 'course', semester_id: 'sem1', title: '环境工程概论', location: '紫金港北4-319', weekday: WD, start_time: '10:00', duration: 145, week_rule: 'every' }],
  todos: [
    { id: 't1', title: '高数作业第三章', note: '', due_date: keyOf(new Date()), done: true, done_at: new Date().toISOString(), source: 'manual', created_at: new Date().toISOString() },
    { id: 't2', title: '写实验报告', note: '', due_date: keyOf(new Date()), done: false, done_at: null, source: 'manual', created_at: new Date().toISOString() },
    { id: 't3', title: '预习周三的课', note: '', due_date: keyOf(new Date()), done: true, done_at: new Date().toISOString(), source: 'manual', created_at: new Date().toISOString() },
  ],
})

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

async function shoot(name, { mode, open }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 950 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  await page.addInitScript(([d, m]) => {
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.data', d)
    localStorage.setItem('web2.theme', 'light')
    for (const k of ['web2.review', 'web2.daily', 'web2.usage']) localStorage.removeItem(k)
    if (m === 'none') return
    const granted = m === 'granted'
    const cats = granted ? [
      { key: 'comm', ms: 2 * 3600 * 1000 }, { key: 'fun', ms: 90 * 60 * 1000 }, { key: 'study', ms: 40 * 60 * 1000 },
    ] : []
    const hours = new Array(24).fill(0)
    hours[9] = 30 * 60 * 1000; hours[13] = 25 * 60 * 1000; hours[20] = 2 * 3600 * 1000
    globalThis.window.Capacitor = { Plugins: { UsageStats: {
      async available() { return { granted } },
      async openSettings() { return { ok: true } },
      async today() {
        if (!granted) return { granted: false, totalMs: 0, byCategory: [], byHour: [] }
        return { granted: true, totalMs: cats.reduce((s, c) => s + c.ms, 0), byCategory: cats, byHour: hours }
      },
    } } }
  }, [DOC, mode])
  await page.goto(BASE + '?t=21:30', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  await page.locator('[data-review-start]:visible').first().click()
  await page.waitForTimeout(500)
  if (open) { await page.locator('[data-usage-toggle]').click(); await page.waitForTimeout(400) }
  await page.locator('[data-account-card]').screenshot({ path: `${OUT}/${name}.png` })
  await ctx.close()
  console.log('✓ ' + name)
}

await shoot('1-folded', { mode: 'granted', open: false })
await shoot('2-expanded', { mode: 'granted', open: true })
await shoot('3-no-permission', { mode: 'denied', open: true })
await shoot('4-browser', { mode: 'none', open: true })
await browser.close()
