/* 「设置」入口 → 设置二级页（Stage 6，playwright，走 dist 静态服务）
   2026-10-02 减法：我的页此前把主题/纪要/通知/清理/重置/关于全部平铺，要滑约 3.5 屏；
   2026-10-05 Stage 6：折叠进一步换成「索引页 → 全屏二级页」——索引页只剩 1 行学期 + 4 个入口，
   设置正文整块搬进 data-sub="settings" 的二级页（Teleport 到 body）。
   覆盖：索引页默认无正文 / 推入二级页可见设置项 / 返回索引 / 索引不再被设置正文撑长 /
         缺 API Key 自动打开设置二级页并展开「纪要服务」/ 桌面宽度正常 / 无页面报错
   跑法：先起 dist 静态服务（默认 4177，可用 TW_URL 覆盖）再 node tmp/settings-fold-check.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
let pass = 0, fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.addInitScript(() => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.removeItem('web2.llm') // 确保「未配置 API Key」这一支
})
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await page.locator('nav button', { hasText: '我的' }).click()
await page.waitForTimeout(500)
const ME = page.locator('[data-page="me"]')

/* ===== A. 索引页默认态（不推二级页） ===== */
t('A1. 我的页有「设置」入口（data-me-entry=settings）',
  (await ME.locator('[data-me-entry="settings"]').count()) === 1
  && (await ME.locator('[data-settings-toggle]').count()) === 1)
t('A2. 默认没有二级页（设置不在当前屏）', (await page.locator('[data-sub-page]').count()) === 0)
t('A3. 默认设置正文不渲染（data-settings-body 不在 DOM）', (await page.locator('[data-settings-body]').count()) === 0)
/* 设置项确实不在 DOM 里（不是靠 CSS 藏：藏起来的东西仍然占测试与无障碍树）。 */
t('A4. 设置项都不渲染（清除数据 / 关于版本号）',
  (await ME.locator('text=清除数据并重置').count()) === 0
  && (await page.locator('[data-app-version]').count()) === 0)
/* 索引页本体：学期行 + 4 个入口，功能块全部搬进各自的二级页 */
t('A5. 索引页 1 行学期 + 4 个入口都在',
  (await ME.locator('[data-me-term]').count()) === 1
  && (await ME.locator('[data-me-entry]').count()) === 4)

/* ===== B. 推入设置二级页 ===== */
await page.$eval('[data-me-entry="settings"]', (el) => el.click())
await page.waitForTimeout(300)
const SUB = page.locator('[data-sub-page]')
t('B1. 出现设置二级页（data-sub=settings）',
  (await SUB.count()) === 1 && (await SUB.getAttribute('data-sub')) === 'settings')
t('B2. 页头：标题「设置」+ 返回按钮',
  (await SUB.locator('[data-sub-title]').innerText()).trim() === '设置'
  && (await SUB.locator('[data-sub-back]').count()) === 1)
const body = page.locator('[data-settings-body]')
t('B3. 设置项齐了：主题外观 / 课前提醒 / 课堂纪要 / 清除数据 / 关于',
  (await body.locator('text=主题外观').count()) === 1
  && (await body.locator('text=课前提醒').count()) === 1
  && (await body.locator('text=课堂纪要').count()) === 1
  && (await body.locator('text=清除数据并重置').count()) === 1
  && (await body.locator('text=关于').count()) === 1)
/* 版本号在「关于」行里，二级页不能把它弄丢 */
t('B4. 「关于」行的版本串仍在', (await page.locator('[data-app-version]').count()) === 1)

/* ===== C. 返回索引 ===== */
await page.locator('[data-sub-back]').click()
await page.waitForTimeout(350)
t('C1. 返回后二级页消失', (await page.locator('[data-sub-page]').count()) === 0)
t('C2. 回索引页，4 个入口仍在', (await ME.locator('[data-me-entry]').count()) === 4)

/* ===== D. 索引页不再被设置正文撑长（减法的可量化证据） =====
   折叠没了，改成二级页：设置正文整块在 data-sub-body 里滚动，索引页高度与它无关。 */
const hIndex = await page.evaluate(() => document.documentElement.scrollHeight)
await page.$eval('[data-me-entry="settings"]', (el) => el.click())
await page.waitForTimeout(350)
const hSub = await page.evaluate(() => document.querySelector('[data-sub-body]').scrollHeight)
t('D1. 设置正文远比索引页长（内容搬进二级页，索引不再被撑长）', hSub > hIndex, `索引=${hIndex} 设置正文=${hSub}`)
await page.locator('[data-sub-back]').click()
await page.waitForTimeout(300)

/* ===== E. 缺 API Key → 自动打开设置二级页 + 展开内层「纪要服务」 ===== */
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } })
const p2 = await ctx2.newPage()
const errors2 = []
p2.on('pageerror', (e) => errors2.push(String(e)))
await p2.addInitScript(() => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.removeItem('web2.llm')
  /* 一场已转写完的录音，带够长的文字稿 → 点「生成纪要」会走「缺配置」分支 */
  localStorage.setItem('web2.lectures', JSON.stringify([{
    id: 'lec_sf', schedule_id: null, title: '高数课', status: 'transcribed',
    started_at: '2026-10-01T01:00:00.000Z', ended_at: '2026-10-01T02:00:00.000Z',
    duration_ms: 3600000, clip_count: 1,
    clips: [{ index: 0, path: 'lectures/a.aac', mime: 'audio/aac', duration_ms: 3600000, recorded_at: '2026-10-01T02:00:00.000Z' }],
    created_at: '2026-10-01T01:00:00.000Z', updated_at: '2026-10-01T02:00:00.000Z',
    transcript: '这一节我们讲极限的定义，重点是ε-δ语言的理解与常见误区的辨析，课后请完成第三章习题一到十题，下次课检查作业情况。',
    summary: null,
  }]))
})
await p2.goto(BASE, { waitUntil: 'domcontentloaded' })
await p2.waitForTimeout(700)
await p2.locator('nav button', { hasText: '我的' }).click()
await p2.waitForTimeout(500)
t('E1. 前置：索引页无二级页；推入课堂录音二级页', (await p2.locator('[data-sub-page]').count()) === 0)
await p2.$eval('[data-me-entry="lectures"]', (el) => el.click())
await p2.waitForTimeout(400)
t('E1b. 课堂录音二级页已打开', (await p2.locator('[data-sub-page][data-sub="lectures"]').count()) === 1)
const genBtn = p2.locator('[data-sub-body] button', { hasText: '生成纪要' }).first()
if (await genBtn.count()) {
  await genBtn.click()
  await p2.waitForTimeout(600)
  /* 缺配置：外层从录音二级页切到设置二级页，用户才看得到刚展开的配置 */
  t('E2. 缺配置点「生成纪要」→ 自动打开「设置」二级页',
    (await p2.locator('[data-sub-page][data-sub="settings"]').count()) === 1)
  /* 内层展开的证据：能看到「纪要服务」选择器 + provider 下拉。
     API Key 输入框还要再选一次 provider 才出现（llmCfg.provider === 'deepseek'），
     那是更下一步的事，不在这里断言。 */
  t('E3. 且内层「纪要服务」也展开（能看到 provider 选择器）',
    (await p2.locator('text=纪要服务').count()) >= 1
    && (await p2.locator('[data-dd="provider"]').count()) === 1)
} else {
  t('E2. 缺配置点「生成纪要」→ 自动打开「设置」二级页', false, '找不到「生成纪要」按钮')
  t('E3. 且内层「纪要服务」也展开（能看到 provider 选择器）', false, '依赖 E2')
}
t('E4. 无页面报错', errors2.length === 0, JSON.stringify(errors2))
await ctx2.close()

/* ===== F. 桌面宽度也正常 ===== */
await page.setViewportSize({ width: 1280, height: 900 })
await page.waitForTimeout(500)
t('F1. 桌面 1280 下「设置」入口正常渲染', await ME.locator('[data-me-entry="settings"]').isVisible())
await page.$eval('[data-me-entry="settings"]', (el) => el.click())
await page.waitForTimeout(400)
t('F2. 桌面下设置二级页正常渲染', await page.locator('[data-sub-page][data-sub="settings"]').isVisible())
await page.locator('[data-sub-back]').click()

t('G1. 全程无页面报错', errors.length === 0, JSON.stringify(errors))

await browser.close()
console.log(`\n结果：${pass} 过 / ${fail} 挂`)
process.exit(fail ? 1 : 0)
