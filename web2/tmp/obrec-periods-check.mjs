/* 实证：识别结果的「节次 → 时间」到底有没有用用户在引导页设置的节次表。
   手法：把「每节时长」从默认 45 改成 50 → 节次表第 2 节结束时间应由 09:40 变 09:50。
   若确认页预览仍显示 08:00–09:40（默认表），说明链路真的忽略了用户设置（bug）；
   若显示 08:00–09:50，说明链路正常，用户的感受来自流程设计（节次表被预填默认值、且是「选填」）。
   再验证导入后周视图里的时间是否同样跟随。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}

const URL = 'http://127.0.0.1:4177/'
const IMG = 'D:/Document/Project/vibe-coding-project-web2/tmp/rec-sample.jpg'
const LLM_CFG = JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' })

/* 一门课，落在第 1–2 节：时间完全由本地节次表换算 */
const AI_COURSES = {
  courses: [
    { title: '高等数学', weekday: 1, startSec: 1, endSec: 2, weekRule: 'every', location: '教1-101', teacher: '张老师' },
  ],
  notes: [],
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.addInitScript(`localStorage.setItem('web2.llm', ${JSON.stringify(LLM_CFG)})`)
  await page.addInitScript(`window.fetch = (function (orig) {
    return function (url, init) {
      if (String(url).indexOf('api.deepseek.com') !== -1) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: ${JSON.stringify(JSON.stringify(AI_COURSES))} } }] }) } });
      }
      return orig.apply(this, arguments);
    };
  })(window.fetch);`)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)

  await page.locator('text=直接填学期信息，自己加课').click()
  await page.waitForTimeout(400)

  // 0. 第 1 页三项入口（Day 14 重构后节次编辑在二级页）
  t('0a. 第 1 页三项入口齐', (await page.locator('[data-ob-start]').isVisible()) && (await page.locator('[data-ob-weeks]').isVisible()) && (await page.locator('[data-ob-time]').isVisible()))
  t('0b. 摘要行显示默认 13 节三块', (await page.locator('[data-ob-time]').innerText()).includes('共 13 节'))

  // 1. 二级页把「单节时长」45 → 50（数字滚轮），三块自动重排
  await page.locator('[data-ob-time]').click()
  await page.waitForTimeout(300)
  const row2Before = await page.locator('[data-ob-period-row="2"]').innerText()
  t('1a0. 默认第 2 节为 08:55–09:40', row2Before.includes('08:55') && row2Before.includes('09:40'))
  await page.locator('[data-ob-dur]').click()
  await page.waitForTimeout(400)
  await page.locator('[data-wheel-val="50"]').click()
  await page.waitForTimeout(150)
  await page.locator('button:has-text("确定")').click()
  await page.waitForTimeout(300)
  const row2After = await page.locator('[data-ob-period-row="2"]').innerText()
  console.log('   改后第2节：', row2After.replace(/\s+/g, ' ').trim())
  t('1a. 改时长后第 2 节变 09:00–09:50', row2After.includes('09:00') && row2After.includes('09:50'))
  await page.locator('[data-ob-time-back]').click()
  await page.waitForTimeout(250)
  await page.locator('[data-ob-start]').click()
  await page.waitForTimeout(400)
  await page.locator('[data-cal-day]:not([data-cal-day=""])').nth(9).click()
  await page.waitForTimeout(150)
  await page.locator('button:has-text("确定")').click()
  await page.waitForTimeout(250)
  await page.locator('[data-ob-goto-rec]').click()
  await page.waitForTimeout(400)

  // 2. 第 1 步 → 第 2 步识别页：页内摘要应先回显用户刚改的表，再识别
  const sum = (await page.locator('[data-ob-summary]').innerText()).replace(/\s+/g, ' ')
  console.log('   识别页摘要：', sum)
  t('1b. 识别页摘要用用户节次表（第 1 段 08:00–12:50）', sum.includes('08:00–12:50'))

  // 3. 识别 → 确认页预览用的是不是刚改的表
  await page.locator('input[accept="image/*"]').setInputFiles(IMG)
  await page.waitForTimeout(1000)
  t('2a. 进入确认页', await page.locator('text=核对后导入').isVisible())
  const previewHasNew = await page.locator('text=上课时间 08:00–09:50').isVisible().catch(() => false)
  const previewHasOld = await page.locator('text=上课时间 08:00–09:40').isVisible().catch(() => false)
  console.log('   确认页预览：新表命中=', previewHasNew, ' 旧(默认)表命中=', previewHasOld)
  t('2b. 确认页预览用用户设置的节次表（08:00–09:50）', previewHasNew)
  t('2c. 确认页预览没有回落到默认表（08:00–09:40）', !previewHasOld)

  // 3. 导入 → 周视图/数据里的课程时间是否同样跟随
  await page.locator('text=开始使用').first().click()
  await page.waitForTimeout(800)
  const added = await page.evaluate(() => localStorage.getItem('web2.added') || '')
  console.log('   web2.added:', added.slice(0, 260))
  t('3a. 课程落盘', added.includes('高等数学'))
  t('3b. 落盘课程 start=08:00', added.includes('"08:00"'))
  t('3c. 落盘课程 end=09:50（用户节次表）', added.includes('"09:50"'))
  const sem = await page.evaluate(() => localStorage.getItem('web2.data') || '')
  t('3d. 学期节次表已存用户设置（含 09:50）', sem.includes('"09:50"'))
  // 周视图时间轴只显示整点刻度 + 节次徽标（课程按时间定位），时间跟随体现为学期的 periods
  const nav = await page.locator('text=周课表').first().isVisible()
  t('3e. 已落在周视图', nav)
  const card = await page.locator('article', { hasText: '高等数学' }).count()
  t('3f. 周视图渲染出课程卡', card > 0)
  await ctx.close()
} catch (e) {
  console.log('ERROR:', e.message)
  results.push(['无异常跑完', false])
}

await browser.close()
const fails = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
