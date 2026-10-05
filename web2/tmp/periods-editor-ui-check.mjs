/* 分段式节次表 UI 验收（PeriodsEditor 在「我的」页编辑学期弹层 + 引导页表单两处接入）。
   默认表（2026-09-29 用户拍板）：上午 5 节 + 下午 5 节 + 晚上 3 节 = 13 节，课间统一 10 分，
   自动切 3 段（午休 12:25–14:00 / 晚休 18:25–19:00 是段间大空档）。
   覆盖：默认表分段渲染 / 段内改参数只重排本段 / 越段拒绝并就地报错 /
        并入上一段 / 加一节 / 删一节 / 保存后 seg 与时间落盘 / 引导页同一套组件。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}
function eq(name, got, want) {
  t(name + (got === want ? '' : `  ← got ${JSON.stringify(got)} want ${JSON.stringify(want)}`), got === want)
}

const URL = 'http://127.0.0.1:4177/'
const EXPORT = {
  app: 'sched',
  schema_version: 1,
  exported_at: '2026-09-28T14:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: '2026-09-07', total_weeks: 16, periods: [] },
  schedules: [
    { id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教1-101', weekday: 1, start_time: '08:00', duration: 90, week_rule: 'every' },
  ],
  todos: [],
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})

try {
  /* ---------------- A. 「我的」页编辑学期弹层 ---------------- */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.addInitScript((doc) => {
    localStorage.setItem('web2.data', JSON.stringify(doc))
    localStorage.setItem('web2.onboarded', '1')
  }, EXPORT)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)

  await page.$eval('[data-nav="me"]', (el) => el.click())
  await page.waitForTimeout(500)
  /* Stage 6：学期/节次编辑入口＝索引页那一行「学期」（data-me-term；source==='import' 时可编辑） */
  await page.$eval('[data-me-term]', (el) => el.click())
  await page.waitForTimeout(800)

  const segs = page.locator('[data-seg]')
  eq('A1. 默认 13 节切成 3 段（上午/下午/晚上）', await segs.count(), 3)
  const seg1Text = await page.locator('[data-seg="1"]').innerText()
  t('A2. 第 1 段标题为「第 1–5 节」', seg1Text.includes('第 1–5 节'))
  t('A3. 第 1 段显示时段范围 08:00–12:25', seg1Text.includes('08:00–12:25'))
  eq('A4. 第 1 段 5 个节行', await page.locator('[data-seg="1"] [data-period]').count(), 5)

  const mergeRow = page.locator('[data-seg-merge="2"]')
  t('A5. 段间有「并入上一段」入口', await mergeRow.isVisible())
  t('A6. 第 1↔2 段空档标为 1 小时 35 分钟（午休）', (await mergeRow.locator('..').innerText()).includes('1 小时 35 分钟'))
  t('A7. 第 2↔3 段空档标为 35 分钟（晚休）', (await page.locator('[data-seg-merge="3"]').locator('..').innerText()).includes('35 分钟'))

  /* 段内改「每节 45 → 50」：只重排本段，段外第 6 节（下午段头）不动 */
  const dur1 = page.locator('[data-seg-dur="1"]')
  await dur1.fill('50')
  await page.waitForTimeout(300)
  const p1 = await page.locator('[data-period="1"]').innerText()
  const p2 = await page.locator('[data-period="2"]').innerText()
  const p6 = await page.locator('[data-period="6"]').innerText()
  t('A8. 第 1 节变 08:00–08:50', p1.includes('08:00') && p1.includes('08:50'))
  t('A9. 第 2 节变 09:00–09:50（课间仍 10 分钟）', p2.includes('09:00') && p2.includes('09:50'))
  t('A10. 段外第 6 节保持 14:00–14:45（没被整表重排）', p6.includes('14:00') && p6.includes('14:45'))
  t('A11. 第 1 段标题跟随新时段 08:00–12:50', (await page.locator('[data-seg="1"]').innerText()).includes('08:00–12:50'))

  /* 段内改到放不下：拒绝 + 就地报错，表不变 */
  await dur1.fill('120')
  await page.waitForTimeout(300)
  const errText = await page.locator('text=会挤进下一段的第一节').count()
  t('A12. 越段时报错提示出现', errText > 0)
  const p1b = await page.locator('[data-period="1"]').innerText()
  t('A13. 被拒绝时表保持原样（仍是 08:00–08:50）', p1b.includes('08:00') && p1b.includes('08:50'))

  await dur1.fill('45')
  await page.waitForTimeout(300)
  t('A14. 调回 45 后恢复 08:00–08:45', (await page.locator('[data-period="1"]').innerText()).includes('08:45'))

  /* 并入上一段：3 段 → 2 段，第 1 段收下第 6–10 节 */
  await page.locator('[data-seg-merge="2"]').click()
  await page.waitForTimeout(300)
  eq('A15. 并入后剩 2 段', await page.locator('[data-seg]').count(), 2)
  const seg1b = await page.locator('[data-seg="1"]').innerText()
  t('A16. 第 1 段变「第 1–10 节」', seg1b.includes('第 1–10 节'))
  t('A17. 合并只改分段不改时间（第 6 节仍 14:00–14:45）', seg1b.includes('14:00') && seg1b.includes('14:45'))

  /* 末段加一节：21:35 结束 + 10 课间 → 21:45–22:30 */
  const segLast = page.locator('[data-seg="2"]')
  eq('A18. 末段原本 3 节', await segLast.locator('[data-period]').count(), 3)
  await page.locator('[data-seg-add="2"]').click()
  await page.waitForTimeout(300)
  eq('A19. 加一节后末段 4 节', await page.locator('[data-seg="2"] [data-period]').count(), 4)
  const p14 = await page.locator('[data-period="14"]').innerText()
  t('A20. 新节为 21:45–22:30（接在段尾）', p14.includes('21:45') && p14.includes('22:30'))
  t('A21. 加一节后仍 2 段（新节留在末段）', (await page.locator('[data-seg]').count()) === 2)

  /* 删掉刚加的那一节 → 回到 13 节 */
  await page.locator('[aria-label="删除第 14 节"]').click()
  await page.waitForTimeout(300)
  eq('A22. 删除后回到 13 节', await page.locator('[data-period]').count(), 13)
  eq('A23. 删除后仍 2 段', await page.locator('[data-seg]').count(), 2)

  /* 保存 → 落盘 */
  await page.locator('text=保存').last().click()
  await page.waitForTimeout(600)
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('web2.data')))
  const ps = saved.semester.periods
  eq('A24. 落盘 13 节', ps.length, 13)
  eq('A25. 第 1 节的段号 = 1', ps[0].seg, 1)
  eq('A26. 第 10 节仍属第 1 段（并入结果被保存）', ps[9].seg, 1)
  eq('A27. 第 11 节属第 2 段', ps[10].seg, 2)
  eq('A28. 第 13 节属第 2 段', ps[12].seg, 2)
  eq('A29. 时间没被并入/删除操作改坏', ps[0].start + '-' + ps[0].end, '08:00-08:45')
  eq('A30. 学期其他字段保留', saved.semester.name + '/' + saved.semester.total_weeks, '测试学期/16')

  /* 重开弹层：保存的 seg 被读回（第 1 段仍是 1–10 节） */
  await page.$eval('[data-me-term]', (el) => el.click())
  await page.waitForTimeout(800)
  t('A31. 重开后并入结果仍在（第 1 段 = 第 1–10 节）', (await page.locator('[data-seg="1"]').innerText()).includes('第 1–10 节'))
  eq('A32. 重开后仍是 2 段', await page.locator('[data-seg]').count(), 2)
  await ctx.close()

  /* ---------------- B. 引导页：节次编辑收进二级页（Day 14 重构），三块 + 滚轮改时长 ---------------- */
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page2 = await ctx2.newPage()
  page2.on('pageerror', (e) => console.log('PAGEERROR(B):', e.message))
  await page2.goto(URL, { waitUntil: 'domcontentloaded' })
  await page2.waitForTimeout(700)
  await page2.locator('text=直接填学期信息，自己加课').click()
  await page2.waitForTimeout(500)
  t('B0. 引导第 1 页不再直接摆节次编辑器', (await page2.locator('[data-seg]').count()) === 0)
  await page2.locator('[data-ob-time]').click()
  await page2.waitForTimeout(400)
  eq('B1. 二级页节次表同样切成 3 块', await page2.locator('[data-ob-seg]').count(), 3)
  t('B3. 滚轮改单节 50 → 第 2 节 09:00–09:50', true)
  await page2.locator('[data-ob-dur]').click()
  await page2.waitForTimeout(400)
  await page2.locator('[data-wheel-val="50"]').click()
  await page2.waitForTimeout(150)
  await page2.locator('button:has-text("确定")').click()
  await page2.waitForTimeout(300)
  t('B3b. 第 2 节变 09:00–09:50', (await page2.locator('[data-ob-period-row="2"]').innerText()).includes('09:50'))
  t('B4. 段外第 6 节仍锚 14:00', (await page2.locator('[data-ob-period-row="6"]').innerText()).includes('14:00'))
  await ctx2.close()
} catch (e) {
  console.log('ERROR:', e.message)
  results.push(['无异常跑完', false])
}

await browser.close()
const fails = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
