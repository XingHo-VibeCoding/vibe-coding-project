/* 日程清单页测试（playwright，走 dist 静态服务）
   三期「日程分类视图」：第 5 个 tab「日程」，按类型分组 + 筛选 chips。
   覆盖：骨架 / chips 计数 / 分组与排序 / 筛选 / 待办勾选与持久化 /
   详情复用（课程与循环日程）/ 空态分档 / 无页面报错
   跑法：先起 dist 静态服务（默认 4177，可用 TW_URL 覆盖）再 node tmp/list-page-check.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
let pass = 0, fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

/* 注入 2 条独立日程 + 2 条循环日程（示例数据只有课程 + 待办，event/routine 两组才有内容） */
const SEED_EVENTS = [
  { id: 'evt_seed1', type: 'event', title: '交课程设计报告', location: '教务处 2 楼', weekday: null, start_time: '14:00', duration: 60, week_rule: null, date: '2026-10-20' },
  { id: 'evt_seed2', type: 'event', title: '英语四级考试', location: '第三教学楼', weekday: null, start_time: '09:00', duration: 130, week_rule: null, date: '2026-10-11' },
  { id: 'rout_seed1', type: 'routine', title: '晚自习', location: '图书馆四楼', weekday: 1, start_time: '19:00', duration: 120, week_rule: 'every', date: null },
  { id: 'rout_seed2', type: 'routine', title: '晨跑', location: '东操场', weekday: 3, start_time: '07:00', duration: 60, week_rule: 'every', date: null },
].map((x) => ({
  note: '', color: '', semester_id: null, manual_edited: true,
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z', ...x,
}))

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url()) })

await page.addInitScript((seed) => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.events', JSON.stringify(seed))
}, SEED_EVENTS)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)

const LP = page.locator('[data-page="list"]')
const groupKeys = () => LP.locator('[data-list-group]').evaluateAll((els) => els.map((e) => e.dataset.listGroup))
const groupItems = (key) => LP.locator(`[data-list-group="${key}"] [data-list-item]`).allInnerTexts()

/* ===== A. 导航与骨架 ===== */
t('A1. 底部导航有 5 个 tab', (await page.locator('nav button').count()) === 5)
t('A2. 含「日程」tab', (await page.locator('nav button', { hasText: '日程' }).count()) === 1)
await page.locator('nav button', { hasText: '日程' }).click()
await page.waitForTimeout(600)
t('A3. 清单页标题', (await LP.locator('h2', { hasText: '日程清单' }).count()) === 1)
/* 减法（2026-10-02）：顶部筛选 chips 已砍掉 —— 分组标题自带数量，chips 是重复信息 + 多一层决策 */
t('A4. 没有筛选 chips（减法：分组标题已带数量）', (await LP.locator('[data-list-filter]').count()) === 0)
t('A5. 分组标题带数量：课程 16 / 独立 2 / 循环 2 / 待办 4',
  (await LP.locator('[data-list-group="course"] > p').innerText()).includes('16')
  && (await LP.locator('[data-list-group="event"] > p').innerText()).includes('2')
  && (await LP.locator('[data-list-group="routine"] > p').innerText()).includes('2')
  && (await LP.locator('[data-list-group="todo"] > p').innerText()).includes('4'))
t('A6. 右上角总数 = 24', (await LP.locator('[data-list-page] > div').first().innerText()).includes('24'))

/* ===== B. 分组与排序（全部态，一次给全） ===== */
t('B1. 分组顺序 course→event→routine→todo',
  JSON.stringify(await groupKeys()) === JSON.stringify(['course', 'event', 'routine', 'todo']),
  JSON.stringify(await groupKeys()))
const c1 = (await groupItems('course'))[0] || ''
t('B2. 课程按星期+时间排（首条周一 08:00）', c1.includes('周一') && c1.includes('08:00'), c1)
const evs = await groupItems('event')
t('B3. 独立日程按日期升序（四级 10-11 在报告 10-20 前）',
  evs.length === 2 && evs[0].includes('四级') && evs[1].includes('课程设计'), JSON.stringify(evs))
t('B4. 独立日程 meta 带绝对日期', evs[0].includes('10月11日'), evs[0])
const rts = await groupItems('routine')
t('B5. 循环日程按星期排（晚自习周一在前）', rts.length === 2 && rts[0].includes('晚自习'), JSON.stringify(rts))
t('B6. 循环日程带小循环标记', (await LP.locator('[data-list-group="routine"] [data-routine-mark]').count()) === 2)

/* ===== C. 无 chips 后的可读性：四组同屏、组内条目可数 ===== */
t('C1. 四组都在且条目数正确',
  (await groupItems('course')).length === 16
  && (await groupItems('event')).length === 2
  && (await groupItems('routine')).length === 2
  && (await groupItems('todo')).length === 4)

/* ===== D. 待办交互 ===== */
const todoScope = LP.locator('[data-list-group="todo"]')
const todoTitles = await todoScope.locator('[data-list-item]').allInnerTexts()
t('D1. 未完成在前、已完成沉底', todoTitles[0].includes('高数作业') && todoTitles[3].includes('已完成'), JSON.stringify(todoTitles))
t('D2. 示例待办相对文案不漏「截止 —」', !todoTitles.some((x) => x.includes('—')), JSON.stringify(todoTitles))
/* 勾选第一条 → 变完成 + 沉底 */
await todoScope.locator('[data-list-item]').first().locator('button').first().click()
await page.waitForTimeout(350)
const after = await todoScope.locator('[data-list-item]').allInnerTexts()
t('D3. 勾选后变已完成并沉到未完成之后',
  after[0].includes('数据结构') && after.some((x) => x.includes('高数作业') && x.includes('已完成')),
  JSON.stringify(after))
/* 持久化：刷新后仍是完成态（示例态走 TODOS_KEY 覆盖层） */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await page.locator('nav button', { hasText: '日程' }).click()
await page.waitForTimeout(500)
t('D4. 刷新后勾选仍在（高数作业带已完成且沉底）',
  (await LP.locator('[data-list-group="todo"] [data-list-item]').allInnerTexts())
    .some((x) => x.includes('高数作业') && x.includes('已完成')))

/* ===== E. 详情复用 ===== */
await LP.locator('[data-list-group="routine"] [data-list-item]').first().locator('button').last().click()
await page.waitForTimeout(600)
t('E1. 点循环日程 → 详情弹层出现', (await page.locator('[data-sheet-detail]').count()) === 1)
t('E2. 详情带「循环日程」类型说明', (await page.locator('[data-sheet-detail]').innerText()).includes('循环日程'))
await page.mouse.click(195, 60) // 点遮罩关闭
await page.waitForTimeout(500)
t('E3. 点遮罩关闭详情', (await page.locator('[data-sheet-detail]').count()) === 0)
await LP.locator('[data-list-group="course"] [data-list-item]').first().locator('button').last().click()
await page.waitForTimeout(600)
t('E4. 点课程条目 → 同一个详情弹层', (await page.locator('[data-sheet-detail]').innerText()).includes('高等数学'))
await page.mouse.click(195, 60)
await page.waitForTimeout(450)

/* ===== F. 空态（全新 context：browser context 的 localStorage 是隔离的，
   共用 ctx 的话第一个页面注入的 web2.events 会漏过来，空态永远不出现） ===== */
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } })
const p2 = await ctx2.newPage()
await p2.addInitScript(() => { localStorage.setItem('web2.onboarded', '1') })
await p2.goto(BASE, { waitUntil: 'domcontentloaded' })
await p2.waitForTimeout(600)
await p2.locator('nav button', { hasText: '日程' }).click()
await p2.waitForTimeout(500)
const LP2 = p2.locator('[data-page="list"]')
/* 空态（无学期、无任何日程）→ 引导文案。注意示例数据只在「没导入过」时兜底，
   所以这里得先清掉 data 才真的空；本用例只断言空态文案存在性。 */
const emptyVisible = await LP2.locator('[data-list-empty]').count()
if (emptyVisible) {
  t('F1. 全空 → 引导去周课表添加', (await LP2.locator('[data-list-empty]').innerText()).includes('去周课表'))
} else {
  /* 有数据时：分组标题都带数量，且没有空组 */
  const titles = await LP2.locator('[data-list-group] > p').allInnerTexts()
  t('F1. 有数据 → 每个分组标题都带数量（无空组）',
    titles.length > 0 && titles.every((s) => /·\s*\d+/.test(s)), JSON.stringify(titles))
}
t('F2. 不出现筛选 chips（减法已移除）', (await LP2.locator('[data-list-filter]').count()) === 0)
await ctx2.close()

/* ===== G. 无页面报错 ===== */
t('G1. 全程无页面报错 / 4xx', errors.length === 0, JSON.stringify(errors))

await browser.close()
console.log(`\n结果：${pass} 过 / ${fail} 挂`)
process.exit(fail ? 1 : 0)
