/* 打卡交互测试（playwright，走 dist 静态服务）
   2026-10-02 三期改版后口径：今日页只留「一按即打」的圆圈（＋连续天数），
   管理（添加 / 7 格 / 删除 / 导入接管）全部在独立的「打卡」页（第 4 个 tab）。
   覆盖：空态 / 添加 / 7 格 / 打卡与取消 / 刷新持久化 / 两段式删除 /
   web2.habits 落盘 / 导入整体接管与坏数据剔除 / streak 昨天回溯 / 桌面宽度冒烟 */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
let pass = 0, fail = 0
function t(name, ok) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name)
  ok ? pass++ : fail++
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
/* 报错收集：Chrome 的 console error 文案不带 URL，favicon.ico 404 是 dev server
   环境噪音（构建产物不受影响），改用 response 事件拿 URL 后排除 */
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url()) })

await page.addInitScript(() => localStorage.setItem('web2.onboarded', '1'))
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)

/* ===== 今日页（精简版） ===== */
const todaySection = page.locator('section').filter({ has: page.locator('h2', { hasText: '今日打卡' }) }).first()
t('1. 今日页空态引导去「打卡」页', (await todaySection.locator('p', { hasText: '还没有打卡习惯' }).count()) === 1)
t('2. 今日页有「管理 ›」入口', (await todaySection.locator('[data-today-habit-more]').count()) === 1)

/* ===== 切到打卡页 ===== */
await page.locator('nav button', { hasText: '打卡' }).click()
await page.waitForTimeout(500)
const card = page.locator('[data-page="habit"]') // 平移层第 3 页 = 打卡页（today/week/habit/me）
t('3. 打卡页有「打卡记录」标题', (await card.locator('h2', { hasText: '打卡记录' }).count()) === 1)
t('4. 打卡页初始空态', (await card.locator('p', { hasText: '还没有打卡习惯' }).count()) === 1)

/* 5-7. 添加两个习惯 */
await card.locator('button', { hasText: '＋ 添加' }).click()
t('5. 输入框出现', (await card.locator('input[type="text"]').count()) === 1)
t('6. 空名禁用确定按钮', await card.locator('button:has-text("确定")').isDisabled())
await card.locator('input[type="text"]').fill('背单词')
await card.locator('button:has-text("确定")').click()
await page.waitForTimeout(200)
await card.locator('button', { hasText: '＋ 添加' }).click()
await card.locator('input[type="text"]').fill('晨跑')
await card.locator('button:has-text("确定")').click()
await page.waitForTimeout(200)
t('7. 两个习惯按创建顺序展示', (await card.locator('[data-habit-row]').filter({ hasText: '背单词' }).count()) === 1 && (await card.locator('[data-habit-row]').filter({ hasText: '晨跑' }).count()) === 1)

const row1 = card.locator('[data-habit-row]').filter({ hasText: '背单词' })
t('8. 新习惯显示「未开始」', (await row1.locator('span', { hasText: '未开始' }).count()) === 1)
t('9. 本周 7 格齐（一~日）', (await row1.locator('[data-habit-cell]').count()) === 7)

/* 10-12. 打卡：圆圈变实心 + 今日格 done + 连续 1 天 */
await row1.locator('button[aria-label="今日打卡"]').click()
await page.waitForTimeout(200)
t('10. 打卡后圆圈变实心（可取消）', (await row1.locator('button[aria-label="取消今日打卡"]').count()) === 1)
t('11. 连续 1 天', (await row1.locator('span', { hasText: '连续 1 天' }).count()) === 1)
t('12. 今日格状态 done', (await row1.locator('[data-cell-state="done"]').count()) === 1)

/* 13. 取消打卡：回「未开始」、今日格回 today 态 */
await row1.locator('button[aria-label="取消今日打卡"]').click()
await page.waitForTimeout(200)
t('13. 取消后回「未开始」且今日格可再打', (await row1.locator('span', { hasText: '未开始' }).count()) === 1 && (await row1.locator('[data-cell-state="today"]').count()) === 1)
await row1.locator('button[aria-label="今日打卡"]').click() // 重新打上

/* 14. 今日页那份精简块同步亮起（同一份数据，两个入口） */
t('14. 今日页精简块同步显示已打卡', (await todaySection.locator('[data-today-habit]').filter({ hasText: '背单词' }).locator('button[aria-label="取消今日打卡"]').count()) === 1)

/* 15. 刷新持久化（reload 后默认落回今日页，查今日页即可） */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
const todaySection2 = page.locator('section').filter({ has: page.locator('h2', { hasText: '今日打卡' }) }).first()
t('15. 刷新后打卡状态保持', (await todaySection2.locator('[data-today-habit]').filter({ hasText: '背单词' }).locator('button[aria-label="取消今日打卡"]').count()) === 1)

/* ===== 回打卡页：两段式删除 ===== */
await page.locator('nav button', { hasText: '打卡' }).click()
await page.waitForTimeout(500)
const card2 = page.locator('[data-page="habit"]')
const row2 = card2.locator('[data-habit-row]').filter({ hasText: '晨跑' })
await row2.locator('button[aria-label="删除习惯"]').click()
await page.waitForTimeout(150)
t('16. 第一次点进入待确认态', (await row2.locator('button[aria-label="确认删除该习惯"]').count()) === 1)
await row2.locator('button[aria-label="确认删除该习惯"]').click()
await page.waitForTimeout(150)
t('17. 确认后习惯被删', (await card2.locator('[data-habit-row]').filter({ hasText: '晨跑' }).count()) === 0)

/* 18. 3 秒不确认自动复位 */
await card2.locator('[data-habit-row]').filter({ hasText: '背单词' }).locator('button[aria-label="删除习惯"]').click()
await page.waitForTimeout(3300)
t('18. 3 秒不确认自动复位为 ✕', (await card2.locator('button[aria-label="删除习惯"]').count()) === 1)

/* 19. web2.habits 落盘且含打卡记录 */
const raw = await page.evaluate(() => localStorage.getItem('web2.habits'))
const arr = JSON.parse(raw || '[]')
t('19. web2.habits 落盘且含打卡记录', Array.isArray(arr) && arr.length === 1 && arr[0].records && Object.keys(arr[0].records).length === 1)

/* 20-23. 导入种子接管：带 habits 的 JSON 走页面 UI 导入（importFromText 才触发
   seedHabitsFromDoc——直接改 localStorage 再 reload 走的是 loadDataset，不触发 seed） */
/* 打卡日期动态生成（教训：写死 '2026-09-26' 的夹具过了午夜就失效——
   streak 测的是「昨天+前天」，必须相对今天算） */
const dayKey = (offset) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
const importDoc = JSON.stringify({
  app: 'sched', // importFromText 校验主项目导出标识，缺了直接拒收
  schema_version: 1,
  semester: { name: '测试学期', first_monday: '2026-08-31', total_weeks: 18 },
  schedules: [],
  todos: [],
  habits: [
    { id: 'h_a', name: '导入的习惯甲', created_at: '2026-09-01T00:00:00Z', records: { [dayKey(-1)]: true, [dayKey(-2)]: true } },
    { id: 'h_b', name: '', records: {} }, // 坏数据应被剔除
  ],
})
await page.locator('input[type="file"]').first().setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(importDoc) })
await page.waitForTimeout(600)
/* 导入成功走 reloadDataset 统一刷新（含 habits），就地更新，无需切页/刷新 */
await page.waitForTimeout(300)
const card3 = page.locator('[data-page="habit"]')
t('20. 导入整体接管（旧习惯不在）', (await card3.locator('[data-habit-row]').filter({ hasText: '背单词' }).count()) === 0)
t('21. 导入的习惯出现', (await card3.locator('[data-habit-row]').filter({ hasText: '导入的习惯甲' }).count()) === 1)
t('22. 坏数据（空名）被剔除', (await card3.locator('[data-habit-row]').count()) === 1)

/* 23. streak：昨天+前天打了、今天没打 → 连续 2 天（不断链不施压） */
t('23. 今天没打时连续天数从昨天回溯 = 2', (await card3.locator('span', { hasText: '连续 2 天' }).count()) === 1)

/* 24. 桌面宽度冒烟 + 全程无报错 */
const p2 = await ctx.browser().newContext({ viewport: { width: 1280, height: 800 } }).then((c) => c.newPage())
await p2.addInitScript(() => localStorage.setItem('web2.onboarded', '1'))
await p2.goto(BASE, { waitUntil: 'domcontentloaded' })
await p2.waitForTimeout(500)
await p2.locator('nav button', { hasText: '打卡' }).click()
await p2.waitForTimeout(400)
t('24. 桌面 1280 正常渲染打卡页', (await p2.locator('[data-page="habit"]').locator('h2', { hasText: '打卡记录' }).count()) === 1)
await p2.close()

t('全程无页面报错', errors.length === 0)
if (errors.length) console.log('页面报错：\n' + errors.join('\n'))

await browser.close()
console.log(`\n结果：${pass} 过 / ${fail} 挂`)
process.exit(fail ? 1 : 0)
