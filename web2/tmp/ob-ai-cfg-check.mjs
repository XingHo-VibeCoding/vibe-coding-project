/* 引导页「先配好 AI」+ 步骤切换动画验证（2026-09-30 用户两条反馈）：
   ① 入口页三个选项选完「秒跳、没动画」→ 步骤级加 obpage 滑动（fwd 前进 / bak 返回）
   ② 第一次用的人没有 API Key，原来只在识别页甩一行红字让人「去我的页配」——
      而引导层是 fixed 全屏盖住整个应用，那句话根本走不到（死路）。
      现在三处检测点（第 1 步「下一步」/ 识别页识别按钮 / 我的页识别入口）缺 Key 一律落到
      「先配好 AI」页，就地配完回识别页；不想配也能手动加课。
   跑法：先起 dev server（4177）再 node tmp/ob-ai-cfg-check.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}
const URL = 'http://127.0.0.1:4177/'
const LLM_CFG = JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' })

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})

/* 缺 Key 时进到第 1 步（开学时间必填，否则「下一步」会被拦） */
async function gotoFormStep(page) {
  await page.locator('text=直接填学期信息，自己加课').click()
  await page.waitForTimeout(300)
  await page.locator('[data-ob-start]').click()
  await page.waitForTimeout(400)
  await page.locator('button[aria-label="上个月"]').click()
  await page.waitForTimeout(250)
  await page.locator('[data-cal-ok="1"]').first().click()
  await page.waitForTimeout(150)
  await page.locator('button:has-text("确定")').click()
  await page.waitForTimeout(250)
}
const stepNo = (page) => page.locator('[data-ob-step]').getAttribute('data-ob-step')

try {
  /* ============ ① 无 Key：第 1 步「下一步」直接落到配置页 ============ */
  let ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  let page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)

  // 步骤切换动画（入口页三个选项 → 第 1 步）
  const fwdToForm = page.waitForSelector('.obpage-fwd-enter-active', { timeout: 1200 }).then(() => true).catch(() => false)
  await gotoFormStep(page)
  t('A1. 入口页选项 → 第 1 步有滑动动画（obpage-fwd-enter-active）', await fwdToForm)
  t('A2. 落到第 1 步（data-ob-step=1）', (await stepNo(page)) === '1')

  await page.locator('[data-ob-goto-rec]').click()
  await page.waitForTimeout(400)
  t('A3. 无 Key 时点「下一步：识别课表」→ 落到配置页（不是识别页）', await page.locator('[data-ob-ai-key]').isVisible())
  t('A4. 配置页也算第 2 步（进度条高亮不错位）', (await stepNo(page)) === '2')
  t('A5. 识别页的选图按钮此时不在（没让用户白点一次）', (await page.locator('[data-ob-rec]').count()) === 0)

  /* ② 配置页要素 */
  t('B1. 有 Key 输入框', await page.locator('[data-ob-ai-key]').isVisible())
  t('B2. 有「测试连接」按钮', await page.locator('[data-ob-ai-test]').isVisible())
  t('B3. 有「保存，去识别课表」主按钮', await page.locator('[data-ob-ai-save]').isVisible())
  t('B4. 有「先不配，手动加课」退路', await page.locator('[data-ob-ai-manual]').isVisible())
  t('B5. 有「返回上一步」出口', await page.locator('[data-ob-ai-back]').isVisible())
  const aiText = (await page.locator('[data-ob-step]').innerText()).replace(/\s+/g, ' ')
  t('B6. 说明里写清为什么需要 Key（图片识别）', aiText.includes('识别课表要先配好 AI') && aiText.includes('图片识别'))
  t('B7. 说明里给了申请地址', aiText.includes('platform.deepseek.com'))

  /* ③ 空 Key 点保存 → 就地报错、留在配置页 */
  await page.locator('[data-ob-ai-save]').click()
  await page.waitForTimeout(300)
  t('C1. 空 Key 点保存 → 就地报错', await page.locator('[data-ob-ai-err]').isVisible())
  t('C2. 报错后仍留在配置页', await page.locator('[data-ob-ai-key]').isVisible())

  /* ④ 填 Key → 保存 → 回到识别页，且落盘（与「我的」页同源） */
  const fwdFinish = page.waitForSelector('.obpage-fwd-enter-active', { timeout: 1200 }).then(() => true).catch(() => false)
  await page.locator('[data-ob-ai-key]').fill('sk-ob-test-123')
  await page.waitForTimeout(200)
  t('D1. 边填边存：localStorage 里已有 provider/key', (await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('web2.llm') || '{}')
    return c.provider === 'deepseek' && c.key === 'sk-ob-test-123'
  })))
  t('D2. 没选过模型时自动落 deepseek-flash（这样课堂纪要也同时可用）', (await page.evaluate(() =>
    JSON.parse(localStorage.getItem('web2.llm') || '{}').model)) === 'deepseek-flash')
  await page.locator('[data-ob-ai-save]').click()
  await page.waitForTimeout(400)
  t('D3. 配好 → 滑到识别页（选图按钮在）', await page.locator('[data-ob-rec]').isVisible())
  /* 方向：本段是「入口 → 第 1 步 → 配置页 → 识别页」，一路往前走，所以是前进方向。
     反向方向由第 ⑩ 段单独验（识别页被拦进配置页 → 配好滑回识别页）。 */
  t('D4. 这条路径是前进方向（fwd）', await fwdFinish)

  /* ⑤ 识别页兜底：Key 被清掉后再点识别 → 又回配置页（不再只甩红字） */
  await page.evaluate(() => localStorage.setItem('web2.llm', JSON.stringify({ provider: 'deepseek', key: '', model: 'deepseek-flash' })))
  await page.locator('[data-ob-rec]').click()
  await page.waitForTimeout(400)
  t('E1. 识别页点识别、缺 Key → 回到配置页', await page.locator('[data-ob-ai-key]').isVisible())
  t('E2. 配置页输入框反映真实配置（是空的，不是上次填的值）', (await page.locator('[data-ob-ai-key]').inputValue()) === '')
  t('E3. 没有出现「去我的页配」那种在引导层里走不到的红字', (await page.locator('text=我的 → 设置 → 课堂纪要').count()) === 0)

  /* ⑥ 「先不配，手动加课」→ 第 3 步核对页 */
  await page.locator('[data-ob-ai-manual]').click()
  await page.waitForTimeout(400)
  t('F1. 先不配也能手动加课 → 进核对页', await page.locator('text=核对后导入').isVisible())
  t('F2. 核对页也算第 3 步', (await stepNo(page)) === '3')
  await ctx.close()

  /* ============ ⑦ 第 1 步 → 配置页 → 返回上一步 ============ */
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await gotoFormStep(page)
  await page.locator('[data-ob-goto-rec]').click()
  await page.waitForTimeout(400)
  const bakBack = page.waitForSelector('.obpage-bak-enter-active', { timeout: 1200 }).then(() => true).catch(() => false)
  await page.locator('[data-ob-ai-back]').click()
  t('G1. 配置页「返回上一步」有反向滑动', await bakBack)
  await page.waitForTimeout(350)
  t('G2. 回到第 1 步（开学时间入口在）', await page.locator('[data-ob-start]').isVisible())
  await ctx.close()

  /* ============ ⑧ 有 Key：不该看到配置页 ============ */
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.addInitScript(`localStorage.setItem('web2.llm', ${JSON.stringify(LLM_CFG)})`)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await gotoFormStep(page)
  await page.locator('[data-ob-goto-rec]').click()
  await page.waitForTimeout(400)
  t('H1. 已配 Key：第 1 步 → 直接到识别页', await page.locator('[data-ob-rec]').isVisible())
  t('H2. 不该出现配置页', (await page.locator('[data-ob-ai-key]').count()) === 0)
  await ctx.close()

  /* ============ ⑨ 我的页识别入口（无 Key）也走同一页 ============ */
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.locator('nav button', { hasText: '周课表' }).click()
  await page.waitForTimeout(400)
  /* Stage 8：课表页识别入口收进「＋」选单，进识别页要走 ＋ → 选单里的识别项。 */
  await page.locator('[data-week-add]').click()
  await page.waitForTimeout(300)
  await page.locator('[data-week-menu-scan]').click()
  await page.waitForTimeout(400)
  t('I1. 课表页识别入口、缺 Key → 落到配置页（不再只给红字）', await page.locator('[data-ob-ai-key]').isVisible())
  t('I2. mine 模式下配置页给「取消识别」出口', await page.locator('[data-mine-rec-cancel]').isVisible())
  await page.locator('[data-mine-rec-cancel]').click()
  await page.waitForTimeout(400)
  /* I3 语义不变：取消后整层关掉、回到课表页。改版后识别入口在选单里，先确认「＋」在，
     再点开选单确认识别入口可达。 */
  const backAddI3 = await page.locator('[data-week-add]').isVisible()
  if (!(await page.locator('[data-week-menu]').count())) {
    await page.locator('[data-week-add]').click()
    await page.waitForTimeout(300)
  }
  t('I3. 取消后整层关掉、回到课表页（＋ 在、选单里识别入口可达）', backAddI3 && (await page.locator('[data-mine-rec]').isVisible()))
  await ctx.close()

  /* ============ ⑩ 识别页被兜底拦进配置页 → 配好滑回识别页（反向动画） ============ */
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.addInitScript(`localStorage.setItem('web2.llm', ${JSON.stringify(LLM_CFG)})`)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await gotoFormStep(page)
  await page.locator('[data-ob-goto-rec]').click()
  await page.waitForTimeout(400)
  await page.evaluate(() => localStorage.setItem('web2.llm', JSON.stringify({ provider: 'deepseek', key: '', model: 'deepseek-flash' })))
  await page.locator('[data-ob-rec]').click() // 缺 Key → 被拦进配置页
  await page.waitForTimeout(400)
  t('J1. 被拦进配置页', await page.locator('[data-ob-ai-key]').isVisible())
  const bakBack2 = page.waitForSelector('.obpage-bak-enter-active', { timeout: 1200 }).then(() => true).catch(() => false)
  await page.locator('[data-ob-ai-key]').fill('sk-ob-test-456')
  await page.waitForTimeout(200)
  await page.locator('[data-ob-ai-save]').click()
  t('J2. 从识别页进来的：配好滑回识别页用反向动画（bak）', await bakBack2)
  await page.waitForTimeout(400)
  t('J3. 回到识别页且选图按钮可用', await page.locator('[data-ob-rec]').isVisible())
  await ctx.close()
} catch (e) {
  console.log('ERROR:', e.message)
  results.push(['无异常跑完', false])
}

await browser.close()
const fails = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
