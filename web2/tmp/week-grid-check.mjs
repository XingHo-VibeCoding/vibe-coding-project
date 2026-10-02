/* 周课表「节次网格」验证（2026-09-30 第五轮用户反馈）。
   用户三条诉求：①纵轴平行线与课程对不齐（「人眼不是尺」）②左侧两栏数字交错、新人看不懂
   ③课表太大要上下左右滑，不符合直觉。改法：把「时间轴」换成「节次网格」——
   行 = 节次、列 = 星期、课程 = 格子。
   本脚本验的是几何硬事实（不是「看着差不多」）：
     A 结构：行数 = 节次 + 分段行；左侧栏每一行是「第N节」+ 时间
     B 一屏看完：无横向滚动、网格底边落在视口内
     C 对齐：课卡 bbox 与格子 bbox 逐边比对 ≤3px —— 这是「不再歪」的硬证据
     D 新人可读：分段行有文案（午休/晚休）
     E 落格与吸附：时间与节次不齐的课也进格子，并在角标标真实时间；齐的不啰嗦
     F 今天列高亮
     G 周末有课自动补列 / 没有就只 5 列
     H 旧交互没破：点课卡弹详情、长按空格子出添加表单且默认时间 = 该节次开始时间
   跑法：先起 dev server（4177）再 node tmp/week-grid-check.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

const URL = 'http://127.0.0.1:4177/'

/* 本周一（动态算，避免跨周跑测试时 week 对不上） */
const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const MONDAY = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
const TODAY_WD = ((now.getDay() + 6) % 7) + 1 // 1..7

/* 三门课各有用途：
   c1 高等数学 周一 08:00–09:40 —— 跨 2 节连堂，且与默认节次边界精确对齐（不该有角标）
   c2 大学英语 周二 09:50–10:35 —— 单节，对齐
   c3 线性代数 周三 13:40–14:45 —— 起点 13:40 不在节次表里（识别导入的课常见），
      应被吸进「第 6 节」并在角标显示真实时间 13:40 */
const COURSES = [
  { id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教1-101', weekday: 1, start_time: '08:00', duration: 100, week_rule: 'every' },
  { id: 'c2', type: 'course', semester_id: 'sem1', title: '大学英语', location: '外语楼203', weekday: 2, start_time: '09:50', duration: 45, week_rule: 'every' },
  { id: 'c3', type: 'course', semester_id: 'sem1', title: '线性代数', location: '教2-305', weekday: 3, start_time: '13:40', duration: 65, week_rule: 'every' },
]
const SAT_COURSE = { id: 'c4', type: 'course', semester_id: 'sem1', title: '体育', location: '操场', weekday: 6, start_time: '10:45', duration: 45, week_rule: 'every' }

function seedDoc(schedules) {
  return JSON.stringify({
    app: 'sched',
    schema_version: 1,
    exported_at: '2026-09-30T02:00:00.000Z',
    semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
    schedules,
    todos: [],
  })
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})

async function openWeek(schedules) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc(schedules))})`)
  await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.locator('nav button', { hasText: '周课表' }).click()
  await page.waitForTimeout(600)
  return { ctx, page }
}

const box = async (page, sel) => await page.locator(sel).first().boundingBox()
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol

try {
  /* ============ 主体：周一~周五 + 一个周六（验证自动补列） ============ */
  const { ctx, page } = await openWeek([...COURSES, SAT_COURSE])

  /* ---- A 结构 ---- */
  t('A1. 网格存在（data-grid）', (await page.locator('[data-grid]').count()) === 1)
  const cells = await page.locator('[data-cell]').count()
  const cols = await page.locator('[data-grid] [data-cell]').evaluateAll((els) =>
    [...new Set(els.map((e) => e.dataset.cell.split('-')[0]))].length
  )
  t('A2. 列数 = 6（周一~周五 + 周六有课自动补）', cols === 6, String(cols))
  t('A3. 行数 = 13 节（每列 13 个格子）', cells / cols === 13, `${cells}/${cols} = ${cells / cols}`)
  const axis1 = await page.locator('[data-axis="1"]').innerText()
  const axis13 = await page.locator('[data-axis="13"]').innerText()
  t('A4. 第 1 行标签 =「第1节」+「08:00」', axis1.replace(/\s+/g, '') === '第1节08:00', JSON.stringify(axis1))
  t('A5. 第 13 行标签 =「第13节」+「20:50」', axis13.replace(/\s+/g, '') === '第13节20:50', JSON.stringify(axis13))

  /* ---- B 一屏看完 ---- */
  const g = await box(page, '[data-grid]')
  const sec = await box(page, '[data-grid]').then(() => page.locator('[data-grid]').evaluate((el) => {
    const s = el.closest('section')
    return { sw: s.scrollWidth, cw: s.clientWidth }
  }))
  t('B1. 网格区无横向滚动（scrollWidth ≤ clientWidth）', sec.sw <= sec.cw + 1, `${sec.sw} vs ${sec.cw}`)
  const docW = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  t('B2. 整页无横向滚动', docW.sw <= docW.cw + 1, `${docW.sw} vs ${docW.cw}`)
  t('B3. 网格底边落在视口内（一屏看完）', g.y + g.height <= 844 - 4, `底边 ${Math.round(g.y + g.height)} / 视口 844`)

  /* ---- C 对齐（核心：课卡与格子逐边比对） ---- */
  const card1 = await box(page, '[data-grid] article:has-text("高等数学")')
  const c1a = await box(page, '[data-cell="1-0"]') // 周一第 1 节
  const c1b = await box(page, '[data-cell="1-1"]') // 周一第 2 节
  t('C1. 连堂课左边界 = 格子左边界（≤3px）', near(card1.x, c1a.x))
  t('C2. 连堂课右边界 = 格子右边界（≤3px）', near(card1.x + card1.width, c1a.x + c1a.width))
  t('C3. 连堂课顶边 = 第 1 节格顶边（≤3px）', near(card1.y, c1a.y), `${card1.y.toFixed(1)} vs ${c1a.y.toFixed(1)}`)
  t('C4. 连堂课底边 = 第 2 节格底边（≤3px）', near(card1.y + card1.height, c1b.y + c1b.height), `${(card1.y + card1.height).toFixed(1)} vs ${(c1b.y + c1b.height).toFixed(1)}`)
  const card2 = await box(page, '[data-grid] article:has-text("大学英语")')
  const c2 = await box(page, '[data-cell="2-2"]') // 周二第 3 节
  t('C5. 单节课四边都贴合格子（≤3px）',
    near(card2.x, c2.x) && near(card2.x + card2.width, c2.x + c2.width) && near(card2.y, c2.y) && near(card2.y + card2.height, c2.y + c2.height),
    `卡(${card2.x.toFixed(0)},${card2.y.toFixed(0)},${card2.width.toFixed(0)}×${card2.height.toFixed(0)}) 格(${c2.x.toFixed(0)},${c2.y.toFixed(0)},${c2.width.toFixed(0)}×${c2.height.toFixed(0)})`)

  /* ---- D 新人可读 ---- */
  const gaps = await page.locator('[data-gap]').allInnerTexts()
  t('D1. 有 2 条分段行（上午|下午 午休 + 下午|晚上 晚休）', gaps.length === 2, JSON.stringify(gaps))
  t('D2. 分段行写明午休', gaps.some((x) => x.includes('午休')), JSON.stringify(gaps))
  t('D3. 分段行写明晚休', gaps.some((x) => x.includes('晚休')), JSON.stringify(gaps))
  t('D4. 左侧栏不再只有光秃秃的数字（每行含「第N节」）',
    (await page.locator('[data-axis]').evaluateAll((els) => els.every((e) => /第\d+节/.test(e.innerText)))))

  /* ---- E 落格与吸附 ---- */
  const card3 = await box(page, '[data-grid] article:has-text("线性代数")')
  const c3 = await box(page, '[data-cell="3-5"]') // 周三第 6 节（14:00–14:45）
  t('E1. 起点不齐的课（13:40）被吸进第 6 节那一行', near(card3.y, c3.y) && near(card3.y + card3.height, c3.y + c3.height),
    `卡 ${card3.y.toFixed(0)}–${(card3.y + card3.height).toFixed(0)} / 格 ${c3.y.toFixed(0)}–${(c3.y + c3.height).toFixed(0)}`)
  const txt3 = await page.locator('[data-grid] article:has-text("线性代数")').innerText()
  t('E2. 不齐的课角标标出真实时间（13:40）', txt3.includes('13:40'), JSON.stringify(txt3.replace(/\s+/g, ' ')))
  const txt1 = await page.locator('[data-grid] article:has-text("高等数学")').innerText()
  t('E3. 与节次对齐的课不标时间（不啰嗦）', !txt1.includes('08:00'), JSON.stringify(txt1.replace(/\s+/g, ' ')))

  /* ---- F 今天列高亮 ---- */
  const todayCells = await page.locator('[data-today="1"]').count()
  t('F1. 今天那一列整列有高亮标记', todayCells === 13, String(todayCells))
  t('F2. 高亮列就是今天（周' + TODAY_WD + '）', await page.locator(`[data-cell="${TODAY_WD}-0"][data-today="1"]`).count() === 1)

  /* ---- H 旧交互没破 ---- */
  /* 注意：三页并排常驻（今日/周/我的都在 DOM 里），所以断言必须限定到对应容器，
     否则「线性代数」会同时匹配到今日页的时间线卡片和周视图的网格卡（strict 冲突）。 */
  await page.locator('[data-grid] article:has-text("高等数学")').first().click()
  await page.waitForTimeout(400)
  const sheet = page.locator('[data-sheet-detail]')
  const sheetText = (await sheet.count()) ? await sheet.innerText() : ''
  t('H1. 点课卡仍弹详情（弹层内是这门课的名称与地点）', sheetText.includes('高等数学') && sheetText.includes('教1-101'), JSON.stringify(sheetText.replace(/\s+/g, ' ').slice(0, 80)))
  await page.keyboard.press('Escape').catch(() => {})
  if (await sheet.count()) { await sheet.locator('button').first().click(); await page.waitForTimeout(350) }
  t('H1b. 详情关得掉', (await page.locator('[data-sheet-detail]').count()) === 0)

  /* 长按空格子 → 类型菜单 → 选「课程」→ 添加表单，默认开始时间 = 该节次开始时间
     （2026-10-01 三期 Step 4 起：长按先弹「加课程 / 加循环日程」两选一菜单，
      双击才是直接进加课程的老习惯 —— 断言随之更新，不是功能坏了） */
  const cell = await box(page, '[data-cell="4-2"]') // 周四第 3 节（09:50）
  await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(750)
  await page.mouse.up()
  await page.waitForTimeout(400)
  const pick = page.locator('[data-add-pick]')
  const pickText = (await pick.count()) ? await pick.innerText() : ''
  t('H2. 长按空格子唤出类型菜单（落点是周四）', pickText.includes('周四') && pickText.includes('循环日程'), JSON.stringify(pickText.replace(/\s+/g, ' ').slice(0, 60)))
  await page.locator('[data-pick-course]').click()
  await page.waitForTimeout(400)
  const add = page.locator('[data-sheet-add]')
  const addText = (await add.count()) ? await add.innerText() : ''
  t('H3. 菜单里选「课程」→ 唤出添加课程表单（落在周四）', addText.includes('添加课程') && addText.includes('周四'), JSON.stringify(addText.replace(/\s+/g, ' ').slice(0, 60)))
  t('H4. 添加表单默认带上该节次的开始时间 09:50', addText.includes('09:50'))

  await ctx.close()

  /* ============ 无周末课：只 5 列 ============ */
  const { ctx: ctx2, page: page2 } = await openWeek(COURSES)
  const cols2 = await page2.locator('[data-grid] [data-cell]').evaluateAll((els) =>
    [...new Set(els.map((e) => e.dataset.cell.split('-')[0]))].length
  )
  const g2 = await box(page2, '[data-grid]')
  if (TODAY_WD > 5) {
    t('G0. 今天就是周末 → 列数含今天（跳过 5 列断言）', cols2 >= TODAY_WD, String(cols2))
  } else {
    t('G1. 无周末课时只显示周一~周五 5 列', cols2 === 5, String(cols2))
  }
  t('G2. 5 列时无横向滚动', (await page2.evaluate(() => {
    const s = document.querySelector('[data-grid]').closest('section')
    return s.scrollWidth <= s.clientWidth + 1
  })))
  const cell2 = await box(page2, '[data-cell="1-0"]')
  t('G3. 5 列时每列更宽（≥60px，课名容得下）', cell2.width >= 60, `${cell2.width.toFixed(1)}px`)
  await ctx2.close()
} catch (e) {
  console.log('ERROR:', e.message)
  results.push(['无异常跑完', false])
}

const fail = results.filter((r) => !r[1])
console.log(`\n=== 周课表网格：${results.length - fail.length}/${results.length} 通过 ===`)
if (fail.length) console.log('失败：' + fail.map((r) => r[0]).join(' / '))
await browser.close()
process.exit(fail.length ? 1 : 0)
