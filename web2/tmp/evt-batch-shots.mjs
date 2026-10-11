/* 出验收图：P15 后半「一次多条」（2026-10-12，用户 m07172）。
   三张：① 选单变成三条路 ② 一次多条面板（一段话里好几件事）
         ③ 认出多条后的核对列表（可勾选 / 可就地改，再点「添加所选 N 条」）
   口径：识别结果**不落库**，要用户核对勾选后自己点添加。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const OUT = 'tmp/evt-batch-shots'
const LLM_CFG = JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' })
const TODAY = new Date()
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const tomorrow = iso(new Date(TODAY.getTime() + 86400000))
const day3 = iso(new Date(TODAY.getTime() + 2 * 86400000))

/* 造的批量返回：三条能认全 + 一条日期没写清（好让图里能看到「拿不准」落在它自己身上） */
const AI_OUT = JSON.stringify({
  events: [
    { title: '班会', date: tomorrow, start: '15:00', duration: 60, place: '教二 110', notes: [] },
    { title: '高数期中考试', date: day3, start: '10:00', duration: 90, place: '教三 302', notes: [] },
    { title: '项目答辩', date: '', start: '18:00', duration: 60, place: '报告厅', notes: ['日期没写清，请自己选一下'] },
  ],
})

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
await page.locator('[data-event-smart]').click()
await page.waitForTimeout(350)
await settle()
await page.screenshot({ path: `${OUT}/1-three-ways.png` })

await page.locator('[data-event-smart-multi]').click()
await page.waitForTimeout(350)
await page.fill('[data-event-smart-input-multi]', '周三下午三点开班会，教二 110，一小时；后天上午十点高数期中考试，教三 302，一个半小时；周一 18:00 项目答辩，报告厅')
await settle()
await page.screenshot({ path: `${OUT}/2-multi-panel.png` })

await page.locator('[data-event-smart-run-multi]').click()
await page.waitForTimeout(1200)
await settle()
await page.screenshot({ path: `${OUT}/3-batch-list.png` })

console.log('wrote 3 shots to ' + OUT)
await browser.close()
