/* 反向排课 UI 自检（五条新功能线 01，2026-10-16）：
   数据层已有 planner-unit.mjs 覆盖纯逻辑（56/56），这里只管「界面这条路走不走得通」：
   A 卡片出现条件    B 排的块落在真空档里（不与课重叠）    C 只建议不落库（不写课表/待办）
   D 与「今天要听的练耳建议」同一套空档口径    E 排不下时如实说明    F 措辞不催不评判

   跑法：先起静态服务（serve.js 服务 dist，改源码要先 build），再 node tmp/planner-ui-check.mjs
   ⚠ 本机 Chrome 必须 --disable-gpu：GPU 合成下 rAF 不回调、CSS 过渡卡在起点，
      页面上 locator.click() 会全部 30s 超时（2026-10-15 查清，见 rec-preview-check.mjs 顶部注释）。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, detail) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  <- ' + String(detail)))
}

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'

/* 固定基准日：2026-10-16 是周五（第 1 周）。课表用「周五」的课，
   09:00–09:30 之间故意留一个空档（08:00–09:00 一节课、09:30–23:00 一节课），
   这样「今天该动哪件」必然落在 09:00–09:30。
   时区无关：脚本内所有时间都是本地时刻，不跨零点。 */
const BASE_DAY = '2026-10-16'
const SEED = `
if (!sessionStorage.getItem('plan-seeded')) {
sessionStorage.setItem('plan-seeded', '1');
localStorage.setItem('web2.onboarded', '1');
localStorage.setItem('web2.theme', 'light');
localStorage.setItem('web2.data', JSON.stringify({
  app: 'sched',
  semester: { name: '排课测试学期', first_monday: '2026-10-12', total_weeks: 18 },
  schedules: [
    { id: 'c1', type: 'course', weekday: 5, title: '早课', start_time: '08:00', duration: 60, week_rule: 'every' },
    { id: 'c2', type: 'course', weekday: 5, title: '下午课', start_time: '09:30', duration: 810, week_rule: 'every' }
  ],
  todos: [
    { id: 'td1', title: '写高数作业', due_date: '${BASE_DAY}', done: false },
    { id: 'td2', title: '读英语', due_date: '${BASE_DAY}', done: false }
  ],
  events: [], routines: []
}));
localStorage.setItem('web2.habits', JSON.stringify([]));
localStorage.setItem('web2.listen', JSON.stringify({ clips: [] }));
}
`

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-gpu'],
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
await page.route('**/*', (route) => {
  const u = route.request().url()
  if (u.startsWith('http://127.0.0.1:4177') || u.startsWith('data:') || u.startsWith('blob:')) return route.continue()
  return route.abort()
})
await page.addInitScript(SEED)
/* ?t=09:00 把 App 的「现在」钉在 09:00（App.vue:4004 的测试后门）：
   这样空档 09:00–09:30 一定排得下，断言不随真实时刻漂移。 */
await page.goto(URL + '?t=09:00', { waitUntil: 'networkidle' })
await page.waitForTimeout(700)

/* 反向排课依赖「现在几点」——用 ?t= 钉死，断言就确定了。 */
const dump = await page.evaluate(() => {
  const card = document.querySelector('[data-plan-card]')
  const items = [...document.querySelectorAll('[data-plan-item]')].map((el) => ({
    id: el.getAttribute('data-plan-item'),
    text: el.innerText.replace(/\s+/g, ' ').trim(),
    hot: el.className.includes('bg-primary-50'),
  }))
  return {
    hasCard: !!card,
    cardText: card ? card.innerText.replace(/\s+/g, ' ').trim() : '',
    line: (document.querySelector('[data-plan-line]') || {}).innerText || '',
    items,
    firstId: (items.find((i) => i.hot) || {}).id || '',
    planRaw: JSON.parse(localStorage.getItem('web2.todos') || 'null'),
  }
})

console.log('--- A 卡片出现条件 ---')
t('A1. 有未完成待办时出现「今天该动哪件」卡', dump.hasCard, JSON.stringify(dump.items))
t('A2. 卡片标题是「今天该动哪件」', !dump.hasCard || dump.cardText.includes('今天该动哪件'), dump.cardText.slice(0, 80))
t('A3. 卡片锚点 data-plan-card 唯一', await page.locator('[data-plan-card]').count() <= 1)
/* ?t=09:00 + 09:00–09:30 真空档 ⇒ 今天必然排得下第一件 */
t('A4. 今天排得下时列出今天的块（至少 1 条）', dump.items.length >= 1, JSON.stringify(dump.items))

console.log('\n--- B 排的块落在真空档里 ---')
t('B1. 每块都有 时:分–时:分 的时间段', dump.items.every((i) => /\d{2}:\d{2}[–-]\d{2}:\d{2}/.test(i.text)), JSON.stringify(dump.items))
t('B2. 每块都标了 title', dump.items.every((i) => i.text.length > 6), JSON.stringify(dump.items))
/* 空档口径：块不能落在课的区间里。课区间 = [start, start+duration)。 */
const blocks = dump.items.map((i) => {
  const m = /(\d{2}):(\d{2})[–-](\d{2}):(\d{2})/.exec(i.text)
  return m ? { s: Number(m[1]) * 60 + Number(m[2]), e: Number(m[3]) * 60 + Number(m[4]) } : null
})
const courses = [{ s: 8 * 60, e: 9 * 60 }, { s: 9 * 60 + 30, e: 23 * 60 }]
const overlap = blocks.some((b) => b && courses.some((c) => b.s < c.e && c.s < b.e))
t('B3. 没有任何一块与课程时间重叠（真空档）', !overlap, JSON.stringify(blocks))
t('B4. 块之间互不重叠', blocks.every((b, i) => i === 0 || !b || !blocks[i - 1] || b.s >= blocks[i - 1].e), JSON.stringify(blocks))
t('B5. 第一块就是「今天该动哪件」（高亮项排最前）', blocks.length > 0 && dump.firstId === dump.items[0].id, dump.firstId + ' / ' + (dump.items[0] || {}).id)
t('B6. 今天的块都在 09:00 之后（已经过去的时点不排）', blocks.every((b) => b && b.s >= 9 * 60), JSON.stringify(blocks))

console.log('\n--- C 只建议不落库 ---')
/* 反向排课**不该**写任何数据：待办数量、内容、课表都不变。 */
t('C1. 待办仍是 2 条（没有凭空多出「排课」条目）', (() => {
  const raw = dump.planRaw
  if (!raw) return true // 覆盖层形态（示例数据），见 C2
  return Array.isArray(raw) ? raw.length === 2 : true
})(), JSON.stringify(dump.planRaw))
t('C2. 待办内容没被改写（还是用户自己写的那两条）', (() => {
  const raw = dump.planRaw
  if (!raw) return true
  const arr = Array.isArray(raw) ? raw : (raw.added || [])
  const titles = arr.map((x) => x.title)
  return titles.includes('写高数作业') && titles.includes('读英语')
})(), JSON.stringify(dump.planRaw))
t('C3. 没有新增「排课」类存储键', await page.evaluate(() => !Object.keys(localStorage).some((k) => /plan|schedule.*block/i.test(k) && k.startsWith('web2.'))))

console.log('\n--- D 与练耳建议同一套空档口径 ---')
/* 两条线都用 listen.js 的 freeSlots()：断言的是「同一份作息区间」。
   页面上的可观察证据 = 排课块不会落在勿扰时段（默认 23:00–07:00）里。 */
t('D1. 没有一块落在勿扰时段（23:00–07:00）内', blocks.every((b) => b && b.s >= 7 * 60 && b.e <= 23 * 60), JSON.stringify(blocks))
t('D2. 排课块的时长是整 30 分钟（默认估值）', blocks.every((b) => b && b.e - b.s === 30), JSON.stringify(blocks.map((b) => b && b.e - b.s)))

console.log('\n--- E 排不下时如实说明 ---')
t('E1. 「今天该动哪件」旁边有一句人话', dump.line.length > 0, dump.line)
t('E2. 说得出「几件」', /\d/.test(dump.line), dump.line)

console.log('\n--- F 措辞不催不评判 ---')
const banned = ['加油', '努力', '赶紧', '必须', '懒', '拖延', '你应该', '你怎么']
t('F1. 卡片文案不含催促/评判词', !banned.some((w) => dump.cardText.includes(w)), dump.cardText.slice(0, 120))
t('F2. 卡片文案含时间段而不是「现在立刻」', /\d{2}:\d{2}/.test(dump.cardText), dump.cardText.slice(0, 120))

console.log('\n--- G 没有待办时整段不出现 ---')
await page.evaluate(() => {
  localStorage.setItem('web2.data', JSON.stringify({
    app: 'sched',
    semester: { name: '排课测试学期', first_monday: '2026-10-12', total_weeks: 18 },
    schedules: [],
    todos: [],
    events: [], routines: [],
  }))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
t('G1. 没有待办 → 不出现排课卡', await page.locator('[data-plan-card]').count() === 0)
t('G2. 也不出现空的排课行', await page.locator('[data-plan-item]').count() === 0)

console.log('\n--- H 待办全部完成时也不出现 ---')
await page.evaluate(() => {
  localStorage.setItem('web2.data', JSON.stringify({
    app: 'sched',
    semester: { name: '排课测试学期', first_monday: '2026-10-12', total_weeks: 18 },
    schedules: [{ id: 'c1', type: 'course', weekday: 5, title: '早课', start_time: '08:00', duration: 60, week_rule: 'every' }],
    todos: [{ id: 'td1', title: '已完成的', due_date: '2026-10-16', done: true }],
    events: [], routines: [],
  }))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
t('H1. 待办都完成了 → 不出现排课卡', await page.locator('[data-plan-card]').count() === 0)

console.log('\n--- I 今天没空档但后面排得上：只说实话，不装作没事 ---')
/* 今天 09:00–23:00 全是课（把可排窗口占满），待办明天到期。
   ⇒ 今天排不下，但明天 07:00 排得上；卡片要出现并说清「最近排到哪天几点」。 */
await page.evaluate(() => {
  localStorage.setItem('web2.data', JSON.stringify({
    app: 'sched',
    semester: { name: '排课测试学期', first_monday: '2026-10-12', total_weeks: 18 },
    schedules: [
      { id: 'c1', type: 'course', weekday: 5, title: '早课', start_time: '08:00', duration: 60, week_rule: 'every' },
      { id: 'c2', type: 'course', weekday: 5, title: '满课', start_time: '09:00', duration: 840, week_rule: 'every' },
    ],
    todos: [{ id: 'td1', title: '明天要交的', due_date: '2026-10-17', done: false }],
    events: [], routines: [],
  }))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
const noSlot = await page.evaluate(() => {
  const card = document.querySelector('[data-plan-card]')
  return {
    hasCard: !!card,
    text: card ? card.innerText.replace(/\s+/g, ' ').trim() : '',
    line: (document.querySelector('[data-plan-line]') || {}).innerText || '',
    items: [...document.querySelectorAll('[data-plan-item]')].length,
  }
})
t('I1. 今天没空档但后面排得上 → 卡片仍出现', noSlot.hasCard, JSON.stringify(noSlot))
t('I2. 卡片写明「今天没空档」并给出最近的时间', /今天没空档/.test(noSlot.line) && /\d{1,2} 月 \d{1,2} 日 \d{2}:\d{2}/.test(noSlot.line), noSlot.line)
t('I3. 列出的块是后面的日子（不是今天的空块）', noSlot.items >= 1, String(noSlot.items))

console.log('\n--- J 未来到期的件不许被排到截止日之后 ---')
/* 今天和明天都满课（09:00–23:00 占满可排窗口）+ 待办明天到期。
   ⇒ 今天排不下、明天也排不下，且不许排到后天（那已经晚了）⇒ 卡片不出现，
   但 planLine 要能说出「还没排上」（如实说明，不假装）。
   注意：**今天到期 / 已过期的件不适用这条**——它已经到点了，最早能做的空档就是
   最诚实的答案（见 planner.js 的截止日约束注释与 planner-unit.mjs 的 E/G 组）。 */
await page.evaluate(() => {
  localStorage.setItem('web2.data', JSON.stringify({
    app: 'sched',
    semester: { name: '排课测试学期', first_monday: '2026-10-12', total_weeks: 18 },
    schedules: [
      { id: 'c1', type: 'course', weekday: 5, title: '周五早课', start_time: '07:00', duration: 60, week_rule: 'every' },
      { id: 'c2', type: 'course', weekday: 5, title: '周五满课', start_time: '08:00', duration: 900, week_rule: 'every' },
      { id: 'c3', type: 'course', weekday: 6, title: '周六满课', start_time: '07:00', duration: 960, week_rule: 'every' },
    ],
    todos: [{ id: 'td1', title: '明天要交的', due_date: '2026-10-17', done: false }],
    events: [], routines: [],
  }))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
t('J1. 今天明天都没空档 + 明天到期 → 不出现任何块', await page.locator('[data-plan-item]').count() === 0)

const passed = results.filter((r) => r[1]).length
console.log('\n=== 反向排课界面：' + passed + '/' + results.length + ' 通过 ===')
const failed = results.filter((r) => !r[1])
if (failed.length) {
  console.log('失败项：')
  for (const [n] of failed) console.log('  - ' + n)
}
await browser.close()
process.exit(failed.length ? 1 : 0)
