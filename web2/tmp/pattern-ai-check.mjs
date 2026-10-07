/* P4 六期第三步：AI 判读（规则出事实，AI 只换说法）
   A 段：纯逻辑（Node 直接跑源码）—— sameFacts 数字闸门 / 没配 Key 不抛
   B 段：浏览器（page.route 假 DeepSeek）—— 没 Key / AI 合规 / AI 改数字 / AI 500 / 请求断 五种情形。
        断言的是「AI 出话时账卡里是那句、来源标 ai；拿不到就退回规则原句、界面不空白、零 pageerror」。

   跑法：先起 dist 静态服务（默认 4177，TW_URL 覆盖）再 node tmp/pattern-ai-check.mjs
   注意：playwright 会 spawn Chrome，沙箱下会被拦（EPERM），需要 danger-full-access。 */

let pass = 0
let fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

/* ===== A 段：纯逻辑 ===== */
class FakeStore {
  constructor() { this.m = new Map() }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
}
globalThis.localStorage = new FakeStore()
const S = await import('../src/data/summarizer.js')

const FACT = '周三断了 3 次（共 3 个周三）'
t('A1. sameFacts：只换说法、数字不动 → 通过', S.sameFacts(FACT, '你周三断过 3 次，一共 3 个周三') === true)
t('A2. sameFacts：改了数字 → 拦下', S.sameFacts(FACT, '你周三断过 6 次，一共 6 个周三') === false)
t('A3. sameFacts：多冒出一个数字 → 拦下', S.sameFacts(FACT, '你周三断过 3 次，一共 3 个周三，连续 4 周') === false)
t('A4. sameFacts：写成中文数字不误杀（三个）', S.sameFacts(FACT, '你最近三个周三都没动过事') === true)
t('A5. sameFacts：数字被整段丢掉 —— 拦不住，如实记下这条边界', S.sameFacts(FACT, '你最近几个周三都没动过事') === true)
t('A6. 没配 Key 时 phraseFact 不抛、直接返回 ok:false',
  await (async () => { try { const r = await S.phraseFact(FACT); return !!r && r.ok === false } catch { return false } })())
t('A7. 空事实直接拒绝', (await S.phraseFact('')).ok === false)

/* ===== B 段：界面 ===== */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })

const DAY = 86400000
const now0 = Date.now()
function dkey(off) {
  const d = new Date()
  d.setDate(d.getDate() + off)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
const todayKey = dkey(0)
/* 三个过去的周三各排了事、一件没做 → weekdayGaps 的 missed=3 ≥ NAME_AT(3) → 模式成立，
   于是账卡上会出现 data-pattern-note（事实句来自 reasons.js 的 gapLine）。 */
const seedDaily = {
  version: 1,
  days: {
    '2026-09-16': { date: '2026-09-16', stats: { todosTotal: 3, todosDone: 0, courses: 2 }, updated_at: now0 - 20 * DAY },
    '2026-09-23': { date: '2026-09-23', stats: { todosTotal: 2, todosDone: 0, courses: 2 }, updated_at: now0 - 13 * DAY },
    '2026-09-30': { date: '2026-09-30', stats: { todosTotal: 4, todosDone: 0, courses: 2 }, updated_at: now0 - 6 * DAY },
  },
}
/* 待办必须落 web2.todos（store.js 的待办通道）才顶用；今天 2 件全没做 → 账难看 → 账卡才出现 */
const seedTodos = {
  added: [
    { id: 't1', title: '把结构力学作业做掉', done: false, due_date: todayKey, created_at: now0 - DAY },
    { id: 't2', title: '交实验报告', done: false, due_date: todayKey, created_at: now0 - DAY },
  ],
  edited: {},
  deleted: [],
}
const seedReasons = { version: 1, items: [], patterns: [] }

async function openCard(page) {
  await page.goto(BASE + '?t=21:30', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  const btn = page.locator('[data-review-start]').first()
  if (await btn.count()) {
    await btn.click()
  } else {
    await page.$eval('[data-nav="me"]', (el) => el.click())
    await page.waitForTimeout(400)
    await page.$eval('[data-me-entry="settings"]', (el) => el.click())
    await page.waitForTimeout(400)
    await page.locator('[data-review-history]').click()
  }
  await page.waitForTimeout(1300) // 等 AI 那一次请求落地（成功/失败都要等）
}

async function newCase(key, handler) {
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.addInitScript(
    ([seeds, k]) => {
      localStorage.setItem('web2.reasons', JSON.stringify(seeds.r))
      localStorage.setItem('web2.daily', JSON.stringify(seeds.d))
      localStorage.setItem('web2.todos', JSON.stringify(seeds.t))
      localStorage.setItem('web2.onboarded', '1')
      if (k) localStorage.setItem('web2.llm', JSON.stringify({ provider: 'deepseek', key: k, model: 'deepseek-flash' }))
      else localStorage.removeItem('web2.llm')
    },
    [{ r: seedReasons, d: seedDaily, t: seedTodos }, key],
  )
  if (handler) await page.route('**/chat/completions*', handler)
  return { page, errs }
}
const okBody = (content) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }),
})
const lineText = async (page) => {
  try { return await page.locator('[data-pattern-line]').first().textContent() } catch { return '' }
}
const lineSrc = async (page) => {
  try { return await page.locator('[data-pattern-line]').first().getAttribute('data-pattern-src') } catch { return null }
}

/* 规则原句的「准」在哪：missed 必须正好 3（种了三个空周三）。
   「共 N 个周三」的 N 是**活的**——打开账卡会 snapshotToday() 把今天也记进 daily，
   今天若正好是周三，N 就变 4。所以只锁「断了 3 次」，N 允许任意数字，
   否则这个断言每逢周三就假红（2026-10-07 实测）。 */
const RULE_LINE = /周三断了 3 次（共 \d+ 个周三）。/

/* B1–B3：没配 Key —— 照旧摆规则原句 */
{
  const { page, errs } = await newCase('', null)
  await openCard(page)
  const txt = await lineText(page)
  t('B1. 没配 Key 也把规则原句摆到台面上（界面不空白）',
    (await page.locator('[data-pattern-note]').count()) === 1 && RULE_LINE.test(txt || ''), txt || '—')
  t('B2. 没配 Key → 来源 = rule', (await lineSrc(page)) === 'rule')
  t('B3. 零 pageerror', errs.length === 0, JSON.stringify(errs.slice(0, 2)))
  await page.locator('[data-pattern-note]').scrollIntoViewIfNeeded().catch(() => {})
  await page.screenshot({ path: 'tmp/pattern-ai-rule.png' }) // 取证：拿不到 AI 话时的样子
  await page.close()
}

/* B4–B8：AI 给合规句 —— 账卡里换成那句，并核对送出去的提示词 */
{
  let body = null
  const { page, errs } = await newCase('sk-test', async (route) => {
    try { body = JSON.parse(route.request().postData() || '{}') } catch { body = null }
    await route.fulfill(okBody('你最近 3 个周三，一次都没动过事'))
  })
  await openCard(page)
  const txt = await lineText(page)
  t('B4. AI 出话时账卡里出现那句', /一次都没动过事/.test(txt || ''), txt || '—')
  t('B5. 来源标成 ai', (await lineSrc(page)) === 'ai')
  t('B6. 送给 AI 的确实是那句规则事实（不是让它自己算）',
    !!body && JSON.stringify(body.messages).indexOf('周三断了 3 次') >= 0)
  t('B7. 提示词里明确禁止新增数字', !!body && /不许新增任何数字/.test(String(((body.messages || [])[0] || {}).content || '')))
  t('B8. 零 pageerror', errs.length === 0, JSON.stringify(errs.slice(0, 2)))
  await page.locator('[data-pattern-note]').scrollIntoViewIfNeeded().catch(() => {})
  await page.screenshot({ path: 'tmp/pattern-ai-ai.png' }) // 取证：AI 换过说法的样子
  await page.close()
}

/* B9–B10：AI 改了数字 —— 整句丢弃、退回原句 */
{
  const { page } = await newCase('sk-test', async (route) => { await route.fulfill(okBody('你最近 6 个周三都没动过事')) })
  await openCard(page)
  const txt = await lineText(page)
  t('B9. AI 改了数字 → 退回规则原句', RULE_LINE.test(txt || ''), txt || '—')
  t('B10. 退回时来源 = rule', (await lineSrc(page)) === 'rule')
  await page.close()
}

/* B11–B12：AI 报 500 */
{
  const { page, errs } = await newCase('sk-test', async (route) => { await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }) })
  await openCard(page)
  const txt = await lineText(page)
  t('B11. AI 报 500 → 退回规则原句', /周三断了 3 次/.test(txt || ''), txt || '—')
  t('B12. 零 pageerror', errs.length === 0, JSON.stringify(errs.slice(0, 2)))
  await page.close()
}

/* B13–B14：请求直接断掉（网络失败） */
{
  const { page, errs } = await newCase('sk-test', async (route) => { await route.abort() })
  await openCard(page)
  const txt = await lineText(page)
  t('B13. 请求直接失败 → 也退回规则原句、界面不空白', /周三断了 3 次/.test(txt || ''), txt || '—')
  t('B14. 零 pageerror', errs.length === 0, JSON.stringify(errs.slice(0, 2)))
  await page.close()
}

await browser.close()
console.log(`\nAI 判读检查：${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
