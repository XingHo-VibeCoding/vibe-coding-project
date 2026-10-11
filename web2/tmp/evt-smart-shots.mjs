/* 出验收图：「添加日程」里的 ✨ 智能填写（Day 28 追加，用户 m06155）。
   四张：① 表单里有这颗小按钮 ② 点开两条路 ③ 粘贴文字面板 ④ 识别回填后的表单 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const OUT = 'tmp/evt-smart-shots'
const LLM_CFG = JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' })
const TODAY = new Date()
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const tomorrow = iso(new Date(TODAY.getTime() + 86400000))
const AI_OUT = JSON.stringify({ title: '创新创业讲座', date: tomorrow, start: '15:00', duration: 90, place: '报告厅', notes: [] })

const doc = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: '2026-08-31', total_weeks: 18 },
  schedules: [{ id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教三 302', teacher: '张明', weekday: 1, start_time: '08:00', duration: 100, week_rule: 'every' }],
  todos: [],
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'light' })
const page = await ctx.newPage()
await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(JSON.stringify(doc))})`)
await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
await page.addInitScript(`localStorage.setItem('web2.theme', '"light"')`)
await page.addInitScript(`localStorage.setItem('web2.llm', ${JSON.stringify(LLM_CFG)})`)
await page.addInitScript(`window.fetch = (function (orig) {
  return function (url, init) {
    if (String(url).indexOf('api.deepseek.com') !== -1) {
      return Promise.resolve({ ok: true, status: 200, json: function () {
        return Promise.resolve({ choices: [{ message: { content: ${JSON.stringify(AI_OUT)} } }] });
      } });
    }
    return orig.apply(this, arguments);
  };
})(window.fetch);`)
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
const settle = () => page.evaluate(() => document.getAnimations().forEach((a) => a.finish()))

await page.locator('button', { hasText: '添加日程' }).first().click()
await page.waitForTimeout(600)
await settle()
await page.screenshot({ path: `${OUT}/1-entry.png` })

await page.locator('[data-event-smart]').click()
await page.waitForTimeout(350)
await settle()
await page.screenshot({ path: `${OUT}/2-two-ways.png` })

await page.locator('[data-event-smart-text]').click()
await page.waitForTimeout(350)
await page.fill('[data-event-smart-input]', '明天下午三点在报告厅有个创新创业讲座，大概一个半小时')
await settle()
await page.screenshot({ path: `${OUT}/3-paste-text.png` })

await page.locator('[data-event-smart-run]').click()
await page.waitForTimeout(1200)
await settle()
await page.screenshot({ path: `${OUT}/4-filled.png` })

console.log('wrote 4 shots to ' + OUT)
await browser.close()
