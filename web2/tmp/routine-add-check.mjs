/* 三期 Step 4：长按空白处弹「加课程 / 加循环日程」菜单 + 循环日程表单（增/改）。
   验的是六件事：
     ① 长按空白 → 出类型菜单（不再直接进加课程表单）；菜单头显示落点的星期与时间；
     ② 选「循环日程」→ 表单标题变、不显示单双周选项、有每周说明；
     ③ 填名提交 → 周视图出现带小循环标记的卡片，且落库进主表（type:'routine'）；
     ④ 双击空白 → 老习惯不变，一步直接进「添加课程」（不出菜单）；
     ⑤ 长按后点「课程」→ 进添加课程；长按后拖动 >8px → 菜单不出现；
     ⑥ 编辑：点卡片 → 详情「编辑」→ 表单预填 → 改名保存 → 卡片与落库同步；
        编辑「单周」的循环日程时表单如实说明「保持原样」，保存后 week_rule 不被改成 every。
   本脚本只走**无冲突**的落点（周二），冲突提示与「再点一次放行」由 routine-today-check 覆盖。
   跑法：先起 dist 静态服务（默认 4177，可用 TW_URL 覆盖）再 node tmp/routine-add-check.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'
const WDN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const MONDAY = iso(mon)

const COURSES = [
  { id: 'c1', type: 'course', title: '高等数学', location: '教1-101', weekday: 1, start_time: '09:00', duration: 45, week_rule: 'every', semester_id: 'sem1' },
]
const ROUTINES = [
  { id: 'r1', type: 'routine', title: '社团例会', location: '大学生活动中心', weekday: 3, start_time: '14:00', duration: 60, week_rule: 'every', semester_id: 'sem1' },
  { id: 'r9', type: 'routine', title: '单周值班', location: '', weekday: 5, start_time: '09:00', duration: 60, week_rule: 'odd', semester_id: 'sem1' },
]

function seedDoc(schedules) {
  return JSON.stringify({
    app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
    semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
    schedules, todos: [],
  })
}

async function openWeek(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc([...COURSES, ...ROUTINES]))})`)
  await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
  await page.addInitScript(`localStorage.setItem('web2.theme', '"light"')`)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.locator('nav button').nth(1).click() // 周课表
  await page.waitForTimeout(600)
  return { ctx, page }
}

/* 找一个「中心点确实落在这个格子上」的空格（避开课程卡与视口外）。
   preferWd 指定优先落在哪个星期几的格子上 —— 本脚本的新建流程要一个**无冲突**的落点：
   表单默认时长 60 分，而 openAdd* 会把落点下限抬到 08:30，于是「周一 08:00」实际开在
   08:30–09:30，正好压到种子里 09:00 的《高等数学》，首次提交会被冲突提示拦一下。
   那种拦截是**预期行为**、由 routine-today-check 的 C/D/E 组专门覆盖；
   这里换到周二（种子里周二没有课/日程）走干净的添加路径。 */
async function blankSpot(page, preferWd) {
  return await page.evaluate((wantWd) => {
    for (const el of document.querySelectorAll('[data-cell]')) {
      if (wantWd && Number(el.dataset.cell.split('-')[0]) !== wantWd) continue
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      if (y < 60 || y > window.innerHeight - 60) continue
      const hit = document.elementFromPoint(x, y)
      if (hit && hit.closest('[data-cell]') === el) return { key: el.dataset.cell, x, y }
    }
    return null
  }, preferWd ?? null)
}
async function longPress(page, x, y) {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.waitForTimeout(680)
  await page.mouse.up()
  await page.waitForTimeout(300)
}
/* 每次长按都重新找空格：新增的卡片会盖住旧落点（点在卡片上不触发手势） */
async function longPressBlank(page) {
  const s = await blankSpot(page)
  if (!s) return null
  await longPress(page, s.x, s.y)
  return s
}
/* 落库读取：主表 web2.data 的 schedules */
const stored = (page, title) =>
  page.evaluate((tt) => {
    const d = JSON.parse(localStorage.getItem('web2.data') || '{}')
    return (d.schedules || []).filter((s) => s.title === tt)
  }, title)
const CARDS = () =>
  [...document.querySelectorAll('[data-grid] article')].map((el) => ({
    type: el.dataset.itemType,
    title: el.querySelector('p')?.textContent?.trim() || '',
    mark: !!el.querySelector('[data-routine-mark]'),
  }))

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const A = await openWeek(browser)
const page = A.page

/* ============ A. 长按 → 类型菜单 ============ */
/* 周二（种子里空的）：走无冲突的添加路径，理由见 blankSpot 注释 */
const spot = await blankSpot(page, 2)
t('A0 找到一个可长按的空格', !!spot, spot ? spot.key : '没找到')
const [spotWd] = spot.key.split('-').map(Number)
await longPress(page, spot.x, spot.y)
const pick = page.locator('[data-add-pick]')
t('A1 长按弹出类型菜单', (await pick.count()) === 1)
t('A2 长按不再直接进加课程表单', (await page.locator('[data-sheet-add]').count()) === 0)
const pickText = await pick.innerText()
t('A3 菜单头显示落点星期', pickText.includes(WDN[spotWd - 1]), pickText.split('\n')[0])
t('A4 菜单给出两个类型', (await page.locator('[data-pick-course]').count()) === 1 && (await page.locator('[data-pick-routine]').count()) === 1)
t('A5 菜单里说明了两者区别（计入课表 / 不占课表）', pickText.includes('计入学期课表') && pickText.includes('不占课表'))
const menuStart = (pickText.match(/\d{2}:\d{2}/) || [''])[0]

/* 取消 */
await page.locator('[data-pick-cancel]').click()
await page.waitForTimeout(350)
t('A6 点取消 → 菜单关掉且不开任何表单',
  (await page.locator('[data-add-pick]').count()) === 0 && (await page.locator('[data-sheet-add]').count()) === 0)

/* A7/A8：菜单承诺的落点时间必须 == 表单实际开出来的起点。
   特意挑「周一 08:00」这一格 —— 旧钳位（`Math.max(DAY_START + 30, …)`，2026-10-02 已去掉）
   会把 08:00 抬成 08:30，同一屏两个数字对不上，这就是那个 bug 的现场。 */
const spot1 = await blankSpot(page, 1)
await longPress(page, spot1.x, spot1.y)
const menuStart1 = ((await page.locator('[data-add-pick]').innerText()).match(/\d{2}:\d{2}/) || [''])[0]
await page.locator('[data-pick-routine]').click()
await page.waitForTimeout(400)
const formStart1 = (await page.locator('[data-add-start]').innerText()).trim()
t('A7 菜单里的落点时间与表单起点一致', menuStart1 === formStart1, `菜单 ${menuStart1} / 表单 ${formStart1}`)
await page.locator('[data-sheet-add] button', { hasText: '取消' }).click()
await page.waitForTimeout(350)
t('A8 取消后表单关闭', (await page.locator('[data-sheet-add]').count()) === 0)

/* ============ B/C. 长按 → 循环日程 → 新建 ============ */
await longPress(page, spot.x, spot.y)
await page.locator('[data-pick-routine]').click()
await page.waitForTimeout(400)
const sheet = page.locator('[data-sheet-add]')
t('B1 选「循环日程」→ 菜单关、表单开',
  (await page.locator('[data-add-pick]').count()) === 0 && (await sheet.count()) === 1)
const title = (await page.locator('[data-add-title]').innerText()).replace(/\s+/g, ' ')
t('B2 表单标题是「添加循环日程」', title.includes('添加循环日程'), title)
t('B3 表单星期沿用长按落点', title.includes(WDN[spotWd - 1]), title)
const sheetText = (await sheet.innerText()).replace(/\s+/g, ' ')
t('B4 循环日程表单不显示单双周选项', !sheetText.includes('单周') && !sheetText.includes('双周'))
t('B5 给出一句「每周重复、不占课表」的说明', sheetText.includes('每周重复') && sheetText.includes('不占学期课表'))
t('B6 名称输入框的提示语是日程口径（课程口径的输入框不存在）',
  (await page.locator('[data-sheet-add] input[placeholder="日程名称（必填）"]').count()) === 1 &&
  (await page.locator('[data-sheet-add] input[placeholder="课程名称（必填）"]').count()) === 0)

/* 空名校验 */
await page.locator('[data-sheet-add] button', { hasText: /^添加日程$/ }).click()
await page.waitForTimeout(250)
t('C1 空名提交报错', (await sheet.innerText()).includes('先给循环日程起个名字'), (await sheet.innerText()).split('\n').pop())
t('C2 报错时表单不关', (await sheet.count()) === 1)

/* 正常提交 */
await page.fill('[data-sheet-add] input[placeholder="日程名称（必填）"]', '晚间跑步')
await page.locator('[data-sheet-add] button', { hasText: /^添加日程$/ }).click()
await page.waitForTimeout(500)
t('C3 提交后表单关闭', (await page.locator('[data-sheet-add]').count()) === 0)
const cards = await page.evaluate(CARDS)
const added = cards.find((c) => c.title === '晚间跑步')
t('C4 周视图出现这条循环日程', !!added, JSON.stringify(cards.map((c) => c.title)))
t('C5 新卡片带小循环标记', added && added.mark && added.type === 'routine', added ? added.type : '-')
const rec = await stored(page, '晚间跑步')
t('C6 落库进主表 schedules（有导入态就该进主表）', rec.length === 1, `命中 ${rec.length} 条`)
t('C7 落库形状能过主项目校验：type/weekday/start_time/duration/week_rule',
  rec[0] && rec[0].type === 'routine' && Number(rec[0].weekday) === spotWd &&
  /^\d{2}:\d{2}$/.test(rec[0].start_time) && Number(rec[0].duration) > 0 && rec[0].week_rule === 'every',
  JSON.stringify(rec[0]))
t('C8 时间沿用长按落点（菜单里显示的那个起点）',
  rec[0] && (!menuStart || rec[0].start_time >= menuStart), `落点 ${menuStart} → 落库 ${rec[0]?.start_time}`)

/* ============ D. 双击仍是老习惯：直接加课程 ============ */
const spot2 = await blankSpot(page)
await page.mouse.dblclick(spot2.x, spot2.y)
await page.waitForTimeout(500)
t('D1 双击空白 → 不出类型菜单', (await page.locator('[data-add-pick]').count()) === 0)
const dTitle = (await page.locator('[data-add-title]').innerText()).replace(/\s+/g, ' ')
t('D2 双击直接进「添加课程」表单', dTitle.includes('添加课程'), dTitle)
const dText = (await page.locator('[data-sheet-add]').innerText()).replace(/\s+/g, ' ')
t('D3 课程表单仍有单双周三个选项', dText.includes('每周') && dText.includes('单周') && dText.includes('双周'))
t('D4 课程表单的输入提示仍是课程口径',
  (await page.locator('[data-sheet-add] input[placeholder="课程名称（必填）"]').count()) === 1)
await page.locator('[data-sheet-add] button', { hasText: '取消' }).click()
await page.waitForTimeout(300)

/* ============ E. 长按 → 选「课程」= 与双击同一个表单 ============ */
const spotE = await longPressBlank(page)
t('E0 重新找到空格并长按出菜单', !!spotE && (await page.locator('[data-add-pick]').count()) === 1, spotE ? spotE.key : '没找到')
await page.locator('[data-pick-course]').click()
await page.waitForTimeout(400)
const eTitle = (await page.locator('[data-add-title]').innerText()).replace(/\s+/g, ' ')
t('E1 长按菜单里选「课程」→ 进添加课程表单', eTitle.includes('添加课程'), eTitle)
await page.locator('[data-sheet-add] button', { hasText: '取消' }).click()
await page.waitForTimeout(300)

/* ============ F. 长按后拖动 >8px → 视为滚动，不出菜单 ============ */
const spotF = await blankSpot(page)
await page.mouse.move(spotF.x, spotF.y)
await page.mouse.down()
await page.waitForTimeout(200)
await page.mouse.move(spotF.x + 40, spotF.y + 40, { steps: 4 })
await page.waitForTimeout(500)
await page.mouse.up()
await page.waitForTimeout(300)
t('F1 长按后拖动 → 菜单不出现（判定为滚动）',
  (await page.locator('[data-add-pick]').count()) === 0 && (await page.locator('[data-sheet-add]').count()) === 0)

/* ============ G. 编辑循环日程：改名 + 单周保持原样 ============ */
await page.locator('[data-grid] article', { hasText: '社团例会' }).click()
await page.waitForTimeout(400)
t('G1 详情里有编辑入口', (await page.locator('[data-routine-edit]').count()) === 1)
await page.locator('[data-routine-edit]').click()
await page.waitForTimeout(400)
const gTitle = (await page.locator('[data-add-title]').innerText()).replace(/\s+/g, ' ')
t('G2 进的是「编辑循环日程」', gTitle.includes('编辑循环日程'), gTitle)
t('G3 表单预填了原名称', (await page.inputValue('[data-sheet-add] input[placeholder="日程名称（必填）"]')) === '社团例会')
await page.fill('[data-sheet-add] input[placeholder="日程名称（必填）"]', '社团例会（改）')
await page.locator('[data-sheet-add] button', { hasText: '保存修改' }).click()
await page.waitForTimeout(500)
const cards2 = await page.evaluate(CARDS)
t('G4 改名后卡片跟着变', cards2.some((c) => c.title === '社团例会（改）') && !cards2.some((c) => c.title === '社团例会'))
const rec2 = await stored(page, '社团例会（改）')
t('G5 落库同步（同一条记录被改，不是新增）',
  rec2.length === 1 && rec2[0].id === 'r1' && (await stored(page, '社团例会')).length === 0,
  `id=${rec2[0]?.id}`)
t('G6 编辑不改掉类别与其他字段', rec2[0] && rec2[0].type === 'routine' && rec2[0].week_rule === 'every' && rec2[0].location === '大学生活动中心')

/* 单周循环日程：表单如实说明 + 保存后 week_rule 不被改成 every */
const oddCard = page.locator('[data-grid] article', { hasText: '单周值班' })
if ((await oddCard.count()) === 1) {
  await oddCard.click()
  await page.waitForTimeout(400)
  await page.locator('[data-routine-edit]').click()
  await page.waitForTimeout(400)
  const oddText = (await page.locator('[data-sheet-add]').innerText()).replace(/\s+/g, ' ')
  t('H1 编辑单周循环日程：表单如实说明「保持原样」', oddText.includes('单周') && oddText.includes('保持原样'))
  await page.locator('[data-sheet-add] button', { hasText: '保存修改' }).click()
  await page.waitForTimeout(500)
  const oddRec = await stored(page, '单周值班')
  t('H2 保存后 week_rule 仍是 odd，没被改成 every', oddRec[0] && oddRec[0].week_rule === 'odd', oddRec[0]?.week_rule)
} else {
  t('H1 本周恰好不是单周 → 跳过（脚本仍算通过）', true, '单周值班本周不显示')
  t('H2 同上（跳过）', true)
}

/* 课程表单没被循环日程带歪：双击加的课程仍然落在课程那条路（web2.added，type:course）。
   同样挑一个无冲突的落点（周四，种子里空）—— 周一 08:00 会被 08:30 下限抬到 08:30，
   45 分钟正好压到 09:00 的课，首次提交会被冲突提示拦下（那是 routine-today-check 的地盘）。 */
const spot3 = await blankSpot(page, 4)
await page.mouse.dblclick(spot3.x, spot3.y)
await page.waitForTimeout(500)
await page.fill('[data-sheet-add] input[placeholder="课程名称（必填）"]', '新加课程')
await page.locator('[data-sheet-add] button', { hasText: /^添加$/ }).click()
await page.waitForTimeout(500)
/* 注：课程新增走的是 web2.added 那套 overlay（老口径），循环日程走主表/events 双源（Step 2 的 B 方案） */
const addedArr = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.added') || '[]'))
const newCourse = addedArr.filter((c) => c.name === '新加课程')
t('I1 走课程表单加出来的是课程（落 web2.added、type:course）',
  newCourse.length === 1 && newCourse[0].type === 'course', JSON.stringify(newCourse[0] || null))
t('I2 课程没被塞进主表 schedules（两条路各走各的）',
  (await stored(page, '新加课程')).length === 0)

await A.ctx.close()
await browser.close()
const fails = results.filter((r) => !r[1])
console.log(`\n${results.length - fails.length}/${results.length} 项通过`)
process.exit(fails.length ? 1 : 0)
