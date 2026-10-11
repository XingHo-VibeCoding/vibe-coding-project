/* me-nest-check：「我的」→ 二级页 → 设置索引 → 设置子页 的嵌套导航必须成立。
   背景（2026-10-12，用户 m03781 / m03868 / m03887）：
     用户说「设置的二级界面堆放了超级多的按钮，完全是乱放的」，拍板把设置改成索引页
     （首页只列入口 + 当前值摘要，具体项在子页里），并选了「分批」先做这一批。
   旧地基：App.vue 的 `meSub` 是**单值 ref**（null | lectures | listen | todos | settings），
           一次只能推入一层；返回键链也只有「有二级页就关掉」这一步。
   新地基：`meSubStack = ref([])`，`openMeSub(k)` 压栈、`closeMeSub()` 弹一层；
           `resetMeSub(k)` 铺成单层（给「从别的页面直接深链进某个二级页」用）。
   本脚本守四件事：
     A. 索引页结构：设置首页只有 5 行入口（data-settings-index），没有旧的平铺项
        （data-clear-entry / data-theme-toggle / data-dayover-section 都不该在首页出现）。
     B. 一级 → 二级 → 返回：我的页点「设置」进索引，点「外观与主题」进子页，两次返回能回到我的页。
     C. 返回链不能跳级：在子页按一次返回应回到「设置索引」而不是直接退出二级页。
     D. 深链：缺 LLM 配置时 startSummary 直接铺 ['settings','settings-recording']，
        一次返回应回到设置索引（证明是两层而不是一层）。
   跑法：先构建 + 起 dist 静态服务（默认 4177），再 node tmp/me-nest-check.mjs */
import * as pw from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const { chromium } = pw
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE || 'http://127.0.0.1:4177/'

const FIXTURE = {
  version: 1,
  schedules: [{ id: 's1', name: '默认', first_monday: '2026-09-07', total_weeks: 18, entries: [
    { id: 'c1', title: '线性代数', day: 1, start: '14:00', end: '15:40', location: '教二 110', teacher: '赵敏', kind: '必修' }] }],
  todos: [], routines: [], habits: [], listens: [], recs: [],
  semester: { first_monday: '2026-09-07', total_weeks: 18 },
}
const clock = (iso) => `(() => { const F = ${new Date(iso).getTime()}; const D = Date; class CD extends D { constructor(...a) { if (a.length === 0) super(F); else super(...a) } static now() { return F } } window.Date = CD })()`

let pass = 0
let fail = 0
const ok = (name, cond, ev) => { if (cond) { pass++; console.log(`  [PASS] ${name}  ${ev}`) } else { fail++; console.log(`  [FAIL] ${name}  ${ev}`) } }

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.route('**cdn.jsdelivr.net/**', (r) => r.abort())
await ctx.addInitScript(clock('2026-10-12T14:30:00'))
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
await page.goto(BASE, { waitUntil: 'load' })
await page.evaluate((f) => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', 'light')
  localStorage.setItem('web2.data', JSON.stringify(f))
  localStorage.removeItem('web2.dayOverrides')
}, FIXTURE)
await page.reload({ waitUntil: 'load' })
await page.waitForSelector('[data-page="today"]')
await page.waitForTimeout(1200)

// 稳态断言前先把过渡推到终态（headless 有负载时合成帧会被饿到 ~0.6fps，读到的是过渡起点）
const settle = () => page.evaluate(() => { for (const a of document.getAnimations()) { try { a.finish() } catch {} } })
const activeKey = () => page.evaluate(() => (document.querySelector('nav [data-nav][data-active="1"]') || {}).dataset?.nav || null)
const subKey = () => page.evaluate(() => { const el = document.querySelector('[data-sub-page]'); return el ? el.getAttribute('data-sub') : null })
const subTitle = () => page.evaluate(() => { const el = document.querySelector('[data-sub-title]'); return el ? el.textContent.trim() : null })

async function clickTab(name) {
  for (let i = 0; i < 6; i++) {
    if ((await activeKey()) === name) return true
    await page.evaluate((n) => { const b = document.querySelector(`nav [data-nav="${n}"]`); if (b) b.click() }, name)
    await page.waitForTimeout(600)
    if ((await activeKey()) === name) return true
  }
  return false
}
async function clickSel(sel) {
  await page.evaluate((s) => { const b = document.querySelector(s); if (b) b.click() }, sel)
  await page.waitForTimeout(350)
  await settle()
}
const back = () => clickSel('[data-sub-back]')

/* ---------- A. 索引页结构 ---------- */
ok('A0 切到「我的」页', await clickTab('me'), 'active=' + await activeKey())
await clickSel('[data-settings-toggle]')
const idx = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-settings-index]')].map((b) => b.getAttribute('data-settings-index'))
  const sums = [...document.querySelectorAll('[data-settings-sum]')].map((b) => b.getAttribute('data-settings-sum') + '=' + b.textContent.trim())
  return {
    rows,
    sums,
    title: (document.querySelector('[data-sub-title]') || {}).textContent,
    hasOldClear: !!document.querySelector('[data-sub-body] [data-clear-entry]'),
    hasOldTheme: !!document.querySelector('[data-sub-body] [data-theme-toggle]'),
    hasOldDayover: !!document.querySelector('[data-sub-body] [data-dayover-section]'),
  }
})
ok('A1 设置首页标题是「设置」', idx.title && idx.title.trim() === '设置', 'title=' + idx.title)
ok('A2 首页恰好 5 行入口', idx.rows.length === 5, 'rows=' + JSON.stringify(idx.rows))
ok('A3 5 行顺序 = 外观/提醒/录音/数据/系统', idx.rows.join(',') === 'appearance,remind,recording,data,system', 'rows=' + idx.rows.join(','))
ok('A4 每行都带当前值摘要', idx.sums.length === 5, 'sums=' + JSON.stringify(idx.sums))
ok('A5 首页不再平铺危险动作（清除数据）', !idx.hasOldClear, 'hasOldClear=' + idx.hasOldClear)
ok('A6 首页不再平铺外观项', !idx.hasOldTheme, 'hasOldTheme=' + idx.hasOldTheme)
ok('A7 首页不再平铺特殊日期编辑', !idx.hasOldDayover, 'hasOldDayover=' + idx.hasOldDayover)

/* ---------- B. 进子页 + 两级返回 ---------- */
await clickSel('[data-settings-index="appearance"]')
const sub = await page.evaluate(() => ({
  key: (document.querySelector('[data-sub-page]') || {}).getAttribute?.('data-sub'),
  title: (document.querySelector('[data-sub-title]') || {}).textContent?.trim(),
  hasThemeToggle: !!document.querySelector('[data-sub-body] [data-theme-toggle]'),
  hasAuto: !!document.querySelector('[data-sub-body] [data-theme-auto]'),
}))
ok('B1 点「外观与主题」进子页', sub.key === 'settings-appearance', 'data-sub=' + sub.key)
ok('B2 子页标题跟着换', sub.title === '外观与主题', 'title=' + sub.title)
ok('B3 外观子页里有深浅切换', sub.hasThemeToggle, 'themeToggle=' + sub.hasThemeToggle)
ok('B4 外观子页里有自动换开关', sub.hasAuto, 'auto=' + sub.hasAuto)

/* ---------- C. 返回链不跳级 ---------- */
await back()
const c1 = await subKey()
const c1Title = await subTitle()
ok('C1 子页返回一次 → 回设置索引（不是直接退出）', c1 === 'settings', 'data-sub=' + c1 + ' title=' + c1Title)
await back()
const c2 = await subKey()
ok('C2 索引返回一次 → 退出二级页，回我的页', c2 === null && (await activeKey()) === 'me', 'data-sub=' + c2 + ' active=' + await activeKey())

/* ---------- D. 逐页可达 + 返回不跳级 ---------- */
const PAGES = [
  ['remind', 'settings-remind', '提醒'],
  ['recording', 'settings-recording', '课堂录音与纪要'],
  ['data', 'settings-data', '数据与导入导出'],
  ['system', 'settings-system', '系统与关于'],
]
for (const [idxKey, wantSub, wantTitle] of PAGES) {
  await clickSel('[data-settings-toggle]')
  await clickSel(`[data-settings-index="${idxKey}"]`)
  const got = await subKey()
  const gotTitle = await subTitle()
  ok(`D ${idxKey} 可进且标题正确`, got === wantSub && gotTitle === wantTitle, `data-sub=${got} title=${gotTitle}`)
  await back()
  const afterBack = await subKey()
  ok(`D ${idxKey} 返回回索引`, afterBack === 'settings', 'data-sub=' + afterBack)
  await back()
}

/* ---------- E. 删除的入口确实没了 ---------- */
await clickSel('[data-settings-toggle]')
await clickSel('[data-settings-index="data"]')
const dataPanel = await page.evaluate(() => ({
  hasRestoreExample: document.body.textContent.includes('恢复示例数据'),
  hasImportJson: !!document.querySelector('[data-sub-body] input[accept*="json"]'),
  hasEduFile: !!document.querySelector('[data-sub-body] [data-edu-file]'),
  hasEduLogin: !!document.querySelector('[data-sub-body] [data-edu-login-open]'),
}))
ok('E1 数据页保留 JSON 导入', dataPanel.hasImportJson, 'json=' + dataPanel.hasImportJson)
ok('E2 数据页保留教务 .xlsx 导入', dataPanel.hasEduFile, 'xlsx=' + dataPanel.hasEduFile)
ok('E3 数据页保留教务登录抓取', dataPanel.hasEduLogin, 'login=' + dataPanel.hasEduLogin)
ok('E4 「恢复示例数据」入口已删除（m03868 拍板）', !dataPanel.hasRestoreExample, 'found=' + dataPanel.hasRestoreExample)

/* ---------- F. 全程无报错 ---------- */
ok('F1 全程无 pageerror', errs.length === 0, errs.join(' | ') || '无')

await browser.close()
console.log(`\n== me-nest-check: ${pass} 过 / ${fail} 挂 ==`)
process.exit(fail ? 1 : 0)
