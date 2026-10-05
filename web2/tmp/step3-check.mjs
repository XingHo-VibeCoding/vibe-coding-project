/* 今天页「今天要听 · 练耳」（方案 C Step 3）结构检查——playwright，走 dist 静态服务。
   断言：到期音频在首页就地排两行（超过 2 段给「还有 N 段」展开）、未到期的不来、
   点播放真的接到 onListenPlay（浏览器模式没有真文件 → 应给「原始文件不在本机」提示，
   按钮不进入播放态）、没有到期音频时整段不出现、段序仍在「今天要坚持」与录音卡之间。
   跑法：先起 dist 静态服务（默认 4177，TW_URL 可覆盖）再 node tmp/step3-check.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
let pass = 0, fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

const day = (offset) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}
const clip = (name, dueOffset, played) => ({
  id: 'clip-' + name, name, file: name + '.m4a', seconds: 42,
  played_count: played, review_stage: dueOffset < 0 ? 1 : 0,
  next_due_date: day(dueOffset), repeat_times: null, archived: false,
  created_at: new Date().toISOString(),
})
const DUE = [clip('英语听力 Unit 3', 0, 0), clip('日语 N3 听力', -1, 2), clip('专业课名词解释', -2, 5)]
const FUTURE = clip('高数公式速记', 3, 0)

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

async function open(clips) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url()) })
  await page.addInitScript((list) => {
    localStorage.setItem('web2.onboarded', '1')
    if (list) localStorage.setItem('web2.listen', JSON.stringify(list))
  }, clips)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  return { page, ctx, errors }
}

const SECTION_ORDER = () => {
  const main = document.querySelector('[data-page="today"]')
  return [...main.children].map((el) => {
    if (el.hasAttribute('data-today-strip')) return 'strip'
    if (el.hasAttribute('data-today-rec')) return 'rec'
    if (el.hasAttribute('data-today-listen')) return '今天要听'
    const h2 = el.querySelector('h2')
    return h2 ? h2.innerText.replace(/\s+/g, ' ').trim().split(' ')[0] : el.tagName.toLowerCase()
  })
}

/* ============ A. 3 段到期 + 1 段未来 ============ */
const a = await open([...DUE, FUTURE])
const p = a.page
t('A1. 今天页出现「今天要听 · 练耳」段', (await p.locator('[data-today-listen]').count()) === 1)
t('A2. 段标题含「今天要听」与「练耳」',
  (await p.locator('[data-today-listen] h2').innerText()).replace(/\s+/g, ' ').includes('今天要听 · 练耳'),
  (await p.locator('[data-today-listen] h2').innerText()).replace(/\s+/g, ' '))
t('A3. 默认只排 2 行（不是把 3 段全铺开）', (await p.locator('[data-today-listen-item]').count()) === 2)
t('A4. 超过 2 段时给「还有 1 段 ›」按钮',
  (await p.locator('[data-today-listen-more]').innerText()).trim() === '还有 1 段 ›',
  (await p.locator('[data-today-listen-more]').innerText()).trim())
t('A5. 每行都有就地播放按钮（h-11 = 44px 热区）',
  (await p.locator('[data-today-listen-play]').count()) === 2
  && (await p.locator('[data-today-listen-play]').first().evaluate((el) => el.getBoundingClientRect().height)) >= 44)
t('A6. 未到期的音频不出现在今天页（高数公式速记排在未来）',
  !(await p.locator('[data-today-listen]').innerText()).includes('高数公式速记'))
t('A7. 段序 = 接下来 → 今天要交 → 今天要坚持 → 今天要听（Stage 2 后窄条/录音/复盘在顶卡内，不再占正文）',
  JSON.stringify(await p.evaluate(SECTION_ORDER)) === JSON.stringify(['接下来', '今天要交', '今天要坚持', '今天要听']),
  JSON.stringify(await p.evaluate(SECTION_ORDER)))

await p.locator('[data-today-listen-more]').click()
await p.waitForTimeout(200)
t('A8. 点「还有 1 段 ›」就地展开到 3 行', (await p.locator('[data-today-listen-item]').count()) === 3)
t('A9. 展开后按钮变「收起」',
  (await p.locator('[data-today-listen-more]').innerText()).trim() === '收起',
  (await p.locator('[data-today-listen-more]').innerText()).trim())

/* 浏览器模式没有真音频文件：点播放应走到 onListenPlay 的兜底提示，而不是静默无反应。
   提示气泡挂在「我的」页那张练耳卡里（listenMsg），而那张卡默认是收起的——先用程序化
   点击把卡展开（卡片在 inert 的「我的」页里，真实鼠标事件会被 inert 吃掉）。 */
await p.evaluate(() => {
  const b = [...document.querySelectorAll('[data-page="me"] button')].find((x) => x.textContent.trim() === '打开')
  if (b) b.click()
})
await p.waitForTimeout(200)
await p.locator('[data-today-listen-play]').first().click()
await p.waitForTimeout(400)
const msg = ((await p.locator('[data-page="me"]').innerText()) + ' ' + (await p.locator('[data-page="today"]').innerText())).replace(/\s+/g, ' ')
t('A10. 点播放真的接到播放逻辑（无真文件时给出「原始文件不在本机」提示）',
  msg.includes('原始文件不在本机') || msg.includes('播放失败') || msg.includes('播不了'), msg.slice(0, 160))
t('A11. 播不起来时按钮不会假装在播（仍是「播放」）',
  (await p.locator('[data-today-listen-play]').first().innerText()).trim() === '播放')
t('A12. 全程无页面报错 / 4xx', a.errors.length === 0, JSON.stringify(a.errors))
await a.ctx.close()

/* ============ B. 没有到期音频 → 整段不出现 ============ */
const b = await open([FUTURE])
t('B1. 没有到期音频时「今天要听」整段不出现', (await b.page.locator('[data-today-listen]').count()) === 0)
t('B2. 段序回到 Step 2 的样子（不会留一个空壳段）',
  JSON.stringify(await b.page.evaluate(SECTION_ORDER)) === JSON.stringify(['接下来', '今天要交', '今天要坚持']),
  JSON.stringify(await b.page.evaluate(SECTION_ORDER)))
t('B3. 全程无页面报错 / 4xx', b.errors.length === 0, JSON.stringify(b.errors))
await b.ctx.close()

await browser.close()
console.log(`\n今天要听（练耳）检查：${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
