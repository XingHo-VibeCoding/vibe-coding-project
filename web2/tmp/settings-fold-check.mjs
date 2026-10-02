/* 「设置」折叠区测试（playwright，走 dist 静态服务）
   2026-10-02 减法：我的页此前把主题/纪要/通知/清理/重置/关于全部平铺，
   要滑约 3.5 屏；现收进一张可折叠卡片，默认收起。
   覆盖：默认收起 / 展开可见 / 折叠不影响非设置项 /
        缺 API Key 自动展开（内外两层都要开）/ 首屏高度真的变短 / 无页面报错
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

/* ===== A. 默认收起 ===== */
t('A1. 我的页有「设置」折叠头', (await ME.locator('[data-settings-toggle]').count()) === 1)
t('A2. 默认收起（无 settings-body）', (await ME.locator('[data-settings-body]').count()) === 0)
t('A3. aria-expanded = false', (await ME.locator('[data-settings-toggle]').getAttribute('aria-expanded')) === 'false')
/* 设置项确实不在 DOM 里（不是靠 CSS 藏：藏起来的东西仍然占测试与无障碍树）。
   注意折叠头副标题本身就写着「主题外观 · 课前提醒 · 课堂纪要 · 数据重置」，
   所以不能搜「主题外观」这四个字 —— 用只存在于正文的文案断言。 */
t('A4. 收起时设置项都不渲染（清除数据 / 关于版本号）',
  (await ME.locator('text=清除数据并重置').count()) === 0
  && (await ME.locator('[data-app-version]').count()) === 0)
/* 非设置项不受影响：学期卡 + 数据导出仍在首屏 */
t('A5. 数据类入口仍在（导入主项目数据 / 导出日历）',
  (await ME.locator('text=导入主项目数据').count()) === 1
  && (await ME.locator('text=导出日历').count()) === 1)

/* ===== B. 展开 ===== */
await ME.locator('[data-settings-toggle]').click()
await page.waitForTimeout(400)
t('B1. 展开后出现 settings-body', (await ME.locator('[data-settings-body]').count()) === 1)
t('B2. aria-expanded = true', (await ME.locator('[data-settings-toggle]').getAttribute('aria-expanded')) === 'true')
t('B3. 设置项齐了：主题外观 / 课前提醒 / 课堂纪要 / 清除数据 / 关于',
  (await ME.locator('[data-settings-body]').locator('text=主题外观').count()) === 1
  && (await ME.locator('[data-settings-body]').locator('text=课前提醒').count()) === 1
  && (await ME.locator('[data-settings-body]').locator('text=课堂纪要').count()) === 1
  && (await ME.locator('[data-settings-body]').locator('text=清除数据并重置').count()) === 1
  && (await ME.locator('[data-settings-body]').locator('text=关于').count()) === 1)
/* 版本号在「关于」行里，折叠不能把它弄丢 */
t('B4. 「关于」行的版本串仍在', (await ME.locator('[data-app-version]').count()) === 1)

/* ===== C. 折回去 ===== */
await ME.locator('[data-settings-toggle]').click()
await page.waitForTimeout(400)
t('C1. 再点折回（body 消失）', (await ME.locator('[data-settings-body]').count()) === 0)
t('C2. 折回后数据类入口仍在', (await ME.locator('text=导出日历').count()) === 1)

/* ===== D. 首屏高度真的变短（减法的可量化证据） =====
   折叠态下，文档高度应当明显小于展开态（差值 ≈ 设置区高度，至少 300px）。 */
const hCollapsed = await page.evaluate(() => document.documentElement.scrollHeight)
await ME.locator('[data-settings-toggle]').click()
await page.waitForTimeout(400)
const hExpanded = await page.evaluate(() => document.documentElement.scrollHeight)
t('D1. 展开后文档变长 ≥300px', hExpanded - hCollapsed >= 300, `收起=${hCollapsed} 展开=${hExpanded} 差=${hExpanded - hCollapsed}`)

/* ===== E. 缺 API Key → 自动展开内外两层（否则用户以为功能被删了） ===== */
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
const ME2 = p2.locator('[data-page="me"]')
t('E1. 前置：设置默认收起', (await ME2.locator('[data-settings-body]').count()) === 0)
const genBtn = ME2.locator('button', { hasText: '生成纪要' }).first()
if (await genBtn.count()) {
  await genBtn.click()
  await p2.waitForTimeout(600)
  t('E2. 缺配置点「生成纪要」→ 外层「设置」也自动展开',
    (await ME2.locator('[data-settings-body]').count()) === 1)
  /* 内层展开的证据：能看到「纪要服务」选择器 + provider 下拉。
     API Key 输入框还要再选一次 provider 才出现（llmCfg.provider === 'deepseek'），
     那是更下一步的事，不在这里断言。 */
  t('E3. 且内层「纪要服务」也展开（能看到 provider 选择器）',
    (await ME2.locator('text=纪要服务').count()) >= 1
    && (await ME2.locator('[data-dd="provider"]').count()) === 1)
} else {
  t('E2. 缺配置点「生成纪要」→ 外层「设置」也自动展开', false, '找不到「生成纪要」按钮')
  t('E3. 且内层「纪要服务」也展开（能看到 API Key 输入）', false, '依赖 E2')
}
t('E4. 无页面报错', errors2.length === 0, JSON.stringify(errors2))
await ctx2.close()

/* ===== F. 桌面宽度也正常 ===== */
await page.setViewportSize({ width: 1280, height: 900 })
await page.waitForTimeout(500)
t('F1. 桌面 1280 下折叠头正常渲染', (await ME.locator('[data-settings-toggle]').isVisible()))

t('G1. 全程无页面报错', errors.length === 0, JSON.stringify(errors))

await browser.close()
console.log(`\n结果：${pass} 过 / ${fail} 挂`)
process.exit(fail ? 1 : 0)
