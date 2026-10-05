/* 「其他日程」子视图测试（playwright，走 dist 静态服务）
   2026-10-03 方案 C Step 1：原「日程」tab 并入课表页，成为「周课表 / 其他日程」分段里的第二个子视图。
   2026-10-03 大减法：课程与循环日程两组从清单删除（它们在同一个页面签的周课表网格里已经画过一遍），
   清单只留「课表放不下的两类」——独立日程与待办；被省略的固定安排用一行「去周课表」提示兜住。
   覆盖：入口与骨架 / 只剩两组 / 提示行往返 / 排序 / 待办勾选与持久化 / 详情与编辑复用 / 空态 / 无页面报错
   跑法：先起 dist 静态服务（默认 4177，可用 TW_URL 覆盖）再 node tmp/list-page-check.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
let pass = 0, fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

/* 注入 2 条独立日程 + 2 条循环日程（示例数据只有课程 + 待办，event 组才有内容；
   循环日程用来验证「它已不在清单里，但仍计进提示行的固定安排数」） */
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

const LP = page.locator('[data-list-page]')
/* 入口：底 nav 只剩 3 个 tab，原「日程」页变成课表页里的第二个分段 */
async function openOther(p) {
  await p.locator('nav button', { hasText: '周课表' }).click()
  await p.waitForTimeout(450)
  /* Stage 8：[data-week-sub-list] 收进 ＋ 选单，先点 ＋ 开选单（已开则不重复点，否则会关掉） */
  if ((await p.locator('[data-week-menu]').count()) === 0) {
    await p.$eval('[data-week-add]', (el) => el.click())
    await p.waitForTimeout(300)
  }
  await p.locator('[data-week-sub-list]').click()
  await p.waitForTimeout(500)
}
const groupKeys = () => LP.locator('[data-list-group]').evaluateAll((els) => els.map((e) => e.dataset.listGroup))
const groupItems = (key) => LP.locator(`[data-list-group="${key}"] [data-list-item]`).allInnerTexts()

/* ===== A. 入口与骨架 ===== */
t('A1. 底部导航只剩 3 个 tab', (await page.locator('nav button').count()) === 3)
t('A2. 不再有独立的「日程」tab', (await page.locator('nav button', { hasText: '日程' }).count()) === 0)
await openOther(page)
t('A3. 课表页分段可切到「其他日程」，标题正确',
  (await LP.locator('h2', { hasText: '其他日程' }).count()) === 1)
t('A4. 没有筛选 chips（减法：分组标题已带数量）', (await LP.locator('[data-list-filter]').count()) === 0)
t('A5. 只剩 event / todo 两组（课程与循环日程已不在此重复）',
  JSON.stringify(await groupKeys()) === JSON.stringify(['event', 'todo']),
  JSON.stringify(await groupKeys()))
t('A6. 右上角总数 = 6（2 条独立日程 + 4 条待办，不再含课程）',
  (await page.locator('[data-list-page] > div').first().innerText()).includes('6'))

/* ===== B. 提示行：被省略的固定安排仍可达 ===== */
const hint = LP.locator('[data-list-week-hint]')
t('B1. 有「还有 18 项固定安排在周课表里」的提示行（16 门课 + 2 条循环）',
  (await hint.count()) === 1 && (await hint.innerText()).includes('18 项固定安排'),
  await hint.count() ? await hint.innerText() : '提示行不存在')
await hint.click()
await page.waitForTimeout(500)
t('B2. 点提示行 → 切回周课表（清单消失、周次条回来）',
  (await page.locator('[data-week-label]').count()) === 1 && (await page.locator('[data-list-page]').count()) === 0)
await page.$eval('[data-week-add]', (el) => el.click())
await page.waitForTimeout(300)
await page.locator('[data-week-sub-list]').click()
await page.waitForTimeout(500)

/* ===== C. 分组与排序 ===== */
const evs = await groupItems('event')
t('C1. 独立日程按日期升序（四级 10-11 在报告 10-20 前）',
  evs.length === 2 && evs[0].includes('四级') && evs[1].includes('课程设计'), JSON.stringify(evs))
t('C2. 独立日程 meta 带绝对日期', evs[0].includes('10月11日'), evs[0])
t('C3. 清单里一条课程/循环日程都没有',
  (await LP.locator('[data-item-type="course"]').count()) === 0
  && (await LP.locator('[data-item-type="routine"]').count()) === 0)

/* ===== D. 待办交互 ===== */
const todoScope = LP.locator('[data-list-group="todo"]')
const todoTitles = await todoScope.locator('[data-list-item]').allInnerTexts()
t('D1. 共 4 条待办，未完成在前、已完成沉底',
  todoTitles.length === 4 && todoTitles[0].includes('高数作业') && todoTitles[3].includes('已完成'),
  JSON.stringify(todoTitles))
t('D2. 示例待办相对文案不漏「截止 —」', !todoTitles.some((x) => x.includes('—')), JSON.stringify(todoTitles))
/* 勾选第一条 → 变完成 + 沉底 */
await todoScope.locator('[data-list-item]').first().locator('button').first().click()
await page.waitForTimeout(350)
const after = await todoScope.locator('[data-list-item]').allInnerTexts()
t('D3. 勾选后变已完成并沉到未完成之后',
  after[0].includes('数据结构') && after.some((x) => x.includes('高数作业') && x.includes('已完成')),
  JSON.stringify(after))
/* 持久化：刷新后仍是完成态（示例态走 TODOS_KEY 覆盖层）。
   刷新后停在哪个 tab 不保证，统一走 openOther 重新进清单。 */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await openOther(page)
t('D4. 刷新后勾选仍在（高数作业带已完成且沉底）',
  (await LP.locator('[data-list-group="todo"] [data-list-item]').allInnerTexts())
    .some((x) => x.includes('高数作业') && x.includes('已完成')))

/* ===== E. 详情 / 编辑复用 ===== */
await LP.locator('[data-list-group="event"] [data-list-item]').first().locator('button').last().click()
await page.waitForTimeout(600)
t('E1. 点独立日程 → 详情弹层出现', (await page.locator('[data-sheet-detail]').count()) === 1)
t('E2. 详情里就是那条日程（英语四级考试）',
  (await page.locator('[data-sheet-detail]').innerText()).includes('英语四级考试'))
await page.mouse.click(195, 60) // 点遮罩关闭
await page.waitForTimeout(500)
t('E3. 点遮罩关闭详情', (await page.locator('[data-sheet-detail]').count()) === 0)
await LP.locator('[data-list-group="todo"] [data-list-item]').first().locator('button').last().click()
await page.waitForTimeout(600)
t('E4. 点待办条目 → 打开待办编辑表单（不是日程详情）',
  (await page.locator('[data-sheet-todo]').count()) === 1
  && (await page.locator('[data-sheet-todo]').innerText()).includes('编辑待办'))
await page.mouse.click(195, 60)
await page.waitForTimeout(450)

/* ===== F. 空态（全新 context：browser context 的 localStorage 是隔离的，
   共用 ctx 的话第一个页面注入的 web2.events 会漏过来，空态永远不出现） ===== */
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } })
const p2 = await ctx2.newPage()
await p2.addInitScript(() => { localStorage.setItem('web2.onboarded', '1') })
await p2.goto(BASE, { waitUntil: 'domcontentloaded' })
await p2.waitForTimeout(600)
await openOther(p2)
const LP2 = p2.locator('[data-list-page]')
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
