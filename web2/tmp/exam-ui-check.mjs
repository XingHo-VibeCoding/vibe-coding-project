/* 04 考试周模式 —— 界面自检
   用法：先起 4177 静态服务（serve.js 服务的是 dist/，改源码要先 build），再 node tmp/exam-ui-check.mjs

   夹具全部按「今天」相对算日期（写死某天跑就会假红）；
   课表种「周五满课」用来验证复习块只落在真空档里。
   ⚠ 本机 headless Chrome 必须带 --disable-gpu，否则 rAF 不产帧、点什么都超时。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

let ok = 0, bad = 0
const fails = []
function t(name, cond, extra) {
  if (cond) { ok++; console.log('  PASS ' + name + (extra !== undefined ? '  → ' + extra : '')) }
  else { bad++; fails.push(name); console.log('  FAIL ' + name + '  → ' + extra) }
}

/* 日期键按「今天」倒推/顺推，别写死 —— 用 UTC 加减天数再取 UTC 日期，避免本地时区扭到前一天。 */
function keyOf(offsetDays) {
  const d = new Date()
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) + offsetDays * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`
}
const D0 = keyOf(0)          // 今天
const D3 = keyOf(3)          // 3 天后（快到了 → 要排复习）
const D5 = keyOf(5)
const D30 = keyOf(30)        // 一个月后（远期 → 只看得到，不催）
const D_PAST = keyOf(-2)     // 已考过

/* 学期锚点：随便挑一个过去的周一，让 currentWeekNo 能算出来。 */
function firstMonday() {
  const d = new Date()
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - 30 * 86400000)
  const back = (x.getUTCDay() + 6) % 7
  const m = new Date(x.getTime() - back * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return `${m.getUTCFullYear()}-${p(m.getUTCMonth() + 1)}-${p(m.getUTCDate())}`
}
/* 每节课都种在 7 个星期几上（08:00–12:00 + 14:00–18:00），
   这样无论今天是周几，白天空档都只剩 12:00–14:00 与 18:00–23:00 ⇒
   优先晚上的复习块必然落在 19:00 之后。
   ⚠ 必须带 type:'course' —— buildScheduleItems 会跳过 `c.type !== 'course'`，
   漏掉这一项时课表「一节课都不算忙」，复习块会因为「晚上优先」而不是「避开课」落到 19:00，
   让 C5/D1 两条看起来通过（实际是假绿）。 */
const COURSES = []
for (let wd = 1; wd <= 7; wd++) {
  COURSES.push({ id: 'm' + wd, type: 'course', title: '上午课', teacher: '', place: '', weekday: wd, start_time: '08:00', duration: 240, week_rule: 'every', weeks: [], term: '' })
  COURSES.push({ id: 'a' + wd, type: 'course', title: '下午课', teacher: '', place: '', weekday: wd, start_time: '14:00', duration: 240, week_rule: 'every', weeks: [], term: '' })
}
const DATA = {
  app: 'sched',
  semester: { name: '考试测试学期', first_monday: firstMonday(), total_weeks: 18, periods: [] },
  schedules: COURSES,
  todos: [],
  events: [],
  routines: [],
}
const EXAMS = [
  { id: 'e3', title: '高等数学', date: D3, start: '09:00', end: '11:00', place: '东1-101', note: '', created_at: 1 },
  { id: 'e30', title: '大学物理', date: D30, start: '', end: '', place: '', note: '', created_at: 2 },
]

function seed(extra = {}) {
  return Object.assign({
    'web2.onboarded': '1',
    'web2.theme': 'light',
    'web2.data': DATA,
    'web2.exams': EXAMS,
    'web2.exam.set': { enabled: true, at: '20:00', leadDays: 14 },
    'web2.notify': { enabled: false, minutesBefore: 10 },
    'web2.habits': [],
    'web2.listen': { clips: [] },
  }, extra)
}

const ctxOpts = { viewport: { width: 390, height: 844 } }

async function openPage(browser, kv, { page = null, seedKey = 'ex-seeded' } = {}) {
  let p = page
  if (!p) {
    const ctx = await browser.newContext(ctxOpts)
    await ctx.route('**/*', (route) => {
      const u = route.request().url()
      if (u.startsWith(URL) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue()
      return route.abort()
    })
    p = await ctx.newPage()
    await p.addInitScript((kv) => {
      if (sessionStorage.getItem('ex-seeded')) return
      sessionStorage.setItem('ex-seeded', '1')
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
    }, kv)
  }
  await p.goto(URL, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  return p
}

/* 进「我的 → 考试与复习」二级页 */
async function openExams(p) {
  await p.evaluate(() => document.querySelector('[data-nav="me"]').click())
  await p.waitForTimeout(500)
  return p.evaluate(() => {
    const b = document.querySelector('[data-me-exams]')
    if (!b) return false
    b.click()
    return true
  })
}
const dumpExams = (p) => p.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-exam-item]')].map((el) => ({
    id: el.getAttribute('data-exam-item'),
    text: el.innerText.replace(/\s+/g, ' ').trim(),
    countdown: (el.querySelector('[data-exam-countdown]') || {}).textContent || '',
    when: (el.querySelector('[data-exam-when]') || {}).textContent || '',
    review: (el.querySelector('[data-exam-review]') || {}).innerText || '',
  }))
  return {
    rows,
    line: (document.querySelector('[data-exam-line]') || {}).innerText || '',
    body: document.body.innerText,
  }
})

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu'] })
try {
  /* ================= A 入口 ================= */
  console.log('\n--- A 入口 ---')
  {
    const p = await openPage(browser, seed())
    await p.evaluate(() => document.querySelector('[data-nav="me"]').click())
    await p.waitForTimeout(500)
    const entry = await p.evaluate(() => {
      const b = document.querySelector('[data-me-exams]')
      if (!b) return null
      return { text: b.innerText.replace(/\s+/g, ' ').trim(), sub: (b.querySelector('[data-me-exams-count]') || {}).textContent || '' }
    })
    t('A1 「我的」页有「考试与复习」入口', !!entry, entry ? entry.text : '缺')
    t('A2 入口副标题报了最近一场与倒计时', entry && /高等数学|还有/.test(entry.sub), entry ? entry.sub : '')
    const opened = await openExams(p)
    await p.waitForTimeout(400)
    t('A3 点进去进入二级页', opened && /考试与复习/.test(await p.evaluate(() => document.body.innerText)))
    await p.context().close()
  }

  /* ================= B 列表呈现 ================= */
  console.log('\n--- B 列表呈现 ---')
  const p = await openPage(browser, seed())
  await openExams(p)
  await p.waitForTimeout(400)
  const d = await dumpExams(p)
  t('B1 列表把两场考试都列出来', d.rows.length === 2, d.rows.map((r) => r.id).join(','))
  t('B2 3 天后那场倒计时是「还有 3 天」', /还有 3 天/.test(d.rows.find((r) => r.id === 'e3').countdown), d.rows.find((r) => r.id === 'e3').countdown)
  t('B3 远期那场倒计时也是天数（不是「已考过」）', /还有 30 天/.test(d.rows.find((r) => r.id === 'e30').countdown), d.rows.find((r) => r.id === 'e30').countdown)
  t('B4 时间与地点都显示出来', /09:00.*11:00/.test(d.rows.find((r) => r.id === 'e3').when) && /东1-101/.test(d.rows.find((r) => r.id === 'e3').when), d.rows.find((r) => r.id === 'e3').when)
  t('B5 只记日期不记时间的那场不显示时间（也不显示「· 」残渣）', d.rows.find((r) => r.id === 'e30').when.trim().length > 0 && !/·\s*$/.test(d.rows.find((r) => r.id === 'e30').when), d.rows.find((r) => r.id === 'e30').when)
  t('B6 按日期排序：近的在前', d.rows[0].id === 'e3' && d.rows[1].id === 'e30', d.rows.map((r) => r.id).join(','))
  t('B7 顶部那句话报了最近一场的倒计时', /还有 3 天/.test(d.line), d.line)

  /* ================= C 复习时间安排 ================= */
  console.log('\n--- C 复习时间安排 ---')
  const e3 = d.rows.find((r) => r.id === 'e3')
  t('C1 快到了的考试给了复习建议', /建议复习/.test(e3.review), e3.review.replace(/\n/g, ' | '))
  const times = [...e3.review.matchAll(/(\d{2}):(\d{2})[–-](\d{2}):(\d{2})/g)].map((m) => ({ s: +m[1] * 60 + +m[2], e: +m[3] * 60 + +m[4] }))
  t('C2 复习块不止一段（考前几天每天一段）', times.length >= 2, times.length)
  t('C3 每段都是 30 分钟', times.every((x) => x.e - x.s === 30), times.map((x) => x.e - x.s).join(','))
  t('C4 优先晚上：所有段都在 19:00 之后', times.every((x) => x.s >= 19 * 60), times.map((x) => x.s).join(','))
  t('C5 不与课表冲突（避开 08:00–12:00 与 14:00–18:00）', times.every((x) => x.e <= 12 * 60 || (x.s >= 12 * 60 && x.e <= 14 * 60) || x.s >= 18 * 60), JSON.stringify(times))
  t('C6 远期考试的条目根本没给复习建议（不给用户制造焦虑）', !/建议复习/.test(d.rows.find((r) => r.id === 'e30').review), d.rows.find((r) => r.id === 'e30').review)
  t('C7 页面明说复习只是建议、不动课表', /不会动你的课表和待办/.test(d.body))

  /* ================= D 排不下时如实说 ================= */
  console.log('\n--- D 排不下时如实说 ---')
  {
    const busy = JSON.parse(JSON.stringify(DATA))
    busy.schedules = []
    /* 把 18:00–23:00 也占掉（加一节 18:00 起 300 分钟 = 到 23:00），再把 12:00–14:00 占掉 ⇒ 全天无空档 */
    /* 每天都从 07:00 占满到 23:00（正好覆盖作息窗口）⇒ 白天晚上都没有空档。
       注意必须整段覆盖：profile 的空档口径是「相邻日程之间」，只要还剩 07:00–08:00 一小时，
       复习块就会落进去，D1 会假绿。 */
    for (let wd = 1; wd <= 7; wd++) {
      busy.schedules.push({ id: 'n' + wd, type: 'course', title: '满课', teacher: '', place: '', weekday: wd, start_time: '07:00', duration: 960, week_rule: 'every', weeks: [], term: '' })
    }
    const p2 = await openPage(browser, seed({ 'web2.data': busy }), { seedKey: 'ex-busy' })
    await openExams(p2)
    await p2.waitForTimeout(400)
    const d2 = await dumpExams(p2)
    const row = d2.rows.find((r) => r.id === 'e3')
    t('D1 排不下时不编假安排，明确说没找到空档', /没找到空档/.test(row.review), row.review.replace(/\n/g, ' | '))
    t('D2 排不下也不催（不出现「必须」「来不及」）', !/必须|来不及|加油/.test(row.review), row.review.replace(/\n/g, ' | '))
    await p2.context().close()
  }

  /* ================= E 添加 / 编辑 / 删除 ================= */
  console.log('\n--- E 添加 / 编辑 / 删除 ---')
  {
    const p3 = await openPage(browser, seed({ 'web2.exams': [] }), { seedKey: 'ex-add' })
    await openExams(p3)
    await p3.waitForTimeout(400)
    const dataBefore = await p3.evaluate(() => localStorage.getItem('web2.data'))
    const empty = await p3.evaluate(() => !!document.querySelector('[data-exam-empty]'))
    t('E1 没有考试时给空态说明', empty)
    await p3.evaluate(() => document.querySelector('[data-exam-add]').click())
    await p3.waitForTimeout(300)
    t('E2 点「添加考试」出现表单', await p3.evaluate(() => !!document.querySelector('[data-exam-form]')))
    await p3.evaluate(() => document.querySelector('[data-exam-submit]').click())
    await p3.waitForTimeout(300)
    const err = await p3.evaluate(() => (document.querySelector('[data-exam-err]') || {}).textContent || '')
    t('E3 名称为空时拒绝保存并说明原因', /必填/.test(err), err)
    await p3.fill('[data-exam-title]', '线性代数')
    await p3.evaluate(() => document.querySelector('[data-exam-submit]').click())
    await p3.waitForTimeout(700)
    const d3 = await dumpExams(p3)
    t('E4 填完保存后列表出现这场考试', d3.rows.length === 1 && /线性代数/.test(d3.rows[0].text), d3.rows.length)
    t('E5 表单保存后收起', await p3.evaluate(() => !document.querySelector('[data-exam-form]')))
    t('E6 新加的考试存在独立的 web2.exams 键里', await p3.evaluate(() => {
      const raw = localStorage.getItem('web2.exams') || ''
      return raw.indexOf('线性代数') >= 0
    }))
    await p3.evaluate(() => document.querySelector('[data-exam-edit]').click())
    await p3.waitForTimeout(300)
    t('E7 点「编辑」把原值带进表单', await p3.evaluate(() => (document.querySelector('[data-exam-title]') || {}).value === '线性代数'))
    await p3.evaluate(() => document.querySelector('[data-exam-del]').click())
    await p3.waitForTimeout(200)
    t('E8 删除要连点两次（第一次只改成确认文案）', await p3.evaluate(() => /再点一次/.test((document.querySelector('[data-exam-del]') || {}).innerText || '')))
    await p3.evaluate(() => document.querySelector('[data-exam-del]').click())
    await p3.waitForTimeout(600)
    t('E9 第二次点才真的删掉', (await dumpExams(p3)).rows.length === 0)
    /* A24g：只建议不落库 —— 全程动过 web2.exams，但课表/待办那份 web2.data 一个字节都不该变 */
    t('E10 全程没动过 web2.data（只建议不落库）',
      (await p3.evaluate(() => localStorage.getItem('web2.data'))) === dataBefore)
    await p3.context().close()
  }

  /* ================= F 考前提醒设置 ================= */
  console.log('\n--- F 考前提醒设置 ---')
  t('F1 有「每晚提醒我复习」开关', /每晚提醒我复习/.test(d.body))
  t('F2 显示提醒时刻', /20:00/.test(d.body), (d.body.match(/\d{2}:\d{2}/g) || []).slice(0, 3).join(','))
  t('F3 说明了只在 14 天内有考试时才发（不无脑每天骚扰）', /14 天内/.test(d.body))

  /* ================= G 措辞不评判 ================= */
  console.log('\n--- G 措辞不评判 ---')
  {
    const banned = ['加油', '努力', '赶紧', '必须', '来不及', '怎么办', '懒', '拖延', '你应该', '你怎么', '还不']
    const hit = banned.filter((w) => d.body.indexOf(w) >= 0)
    t('G1 整页没有催促或评判词', hit.length === 0, hit.join(','))
    t('G2 没有把自己摆成打分/排名的样子', !/第\s*\d+\s*名|评分|得分/.test(d.body))
  }

  /* ================= H 已考过的不再显示 ================= */
  console.log('\n--- H 已考过的不再显示 ---')
  {
    const p4 = await openPage(browser, seed({
      'web2.exams': EXAMS.concat([{ id: 'eold', title: '已考完的课', date: D_PAST, start: '', end: '', place: '', note: '', created_at: 0 }]),
    }), { seedKey: 'ex-past' })
    await openExams(p4)
    await p4.waitForTimeout(400)
    const d4 = await dumpExams(p4)
    t('H1 已考过的默认不出现在列表里', !d4.rows.some((r) => r.id === 'eold'), d4.rows.map((r) => r.id).join(','))
    t('H2 其它考试照常显示', d4.rows.length === 2, d4.rows.length)
    await p4.context().close()
  }

  /* ================= I 今日页那条 ================= */
  console.log('\n--- I 今日页 ---')
  {
    const p5 = await openPage(browser, seed(), { seedKey: 'ex-today' })
    await p5.waitForTimeout(500)
    const card = await p5.evaluate(() => {
      const el = document.querySelector('[data-exam-card]')
      if (!el) return null
      return {
        text: el.innerText.replace(/\s+/g, ' ').trim(),
        blocks: [...document.querySelectorAll('[data-exam-block]')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()),
        soon: [...document.querySelectorAll('[data-exam-soon]')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()),
      }
    })
    t('I1 今日页出现考试卡', !!card, card ? card.text.slice(0, 60) : '缺')
    t('I2 卡里能看到接下来的考试', card && card.soon.some((x) => /高等数学/.test(x)), card ? card.soon.join(' | ') : '')
    t('I3 卡里能看到今天建议复习的时段', card && card.blocks.some((x) => /\d{2}:\d{2}/.test(x)), card ? card.blocks.join(' | ') : '')
    await p5.context().close()
  }

  /* ================= J 没有考试时今日页不占地方 ================= */
  console.log('\n--- J 没有考试时 ---')
  {
    const p6 = await openPage(browser, seed({ 'web2.exams': [] }), { seedKey: 'ex-none' })
    await p6.waitForTimeout(500)
    t('J1 一场考试都没有时今日页不出现那张卡', await p6.evaluate(() => !document.querySelector('[data-exam-card]')))
    await p6.context().close()
  }
  /* ================= K 从纪要一键加考试 ================= */
  console.log('\n--- K 从纪要一键加考试 ---')
  {
    /* 老师课上念的考试时间经常落在纪要的 homework 数组里。
       「像考试」= 文本里出现考/试 且解析得出日期 —— 这条用「期末考试 11 月 20 日」命中。 */
    const lec = [{
      id: 'lec_ex', schedule_id: null, title: '高数三班 录音', status: 'summarized',
      started_at: '2026-10-14T09:00:00.000Z', ended_at: '2026-10-14T09:45:00.000Z', duration_ms: 2700000,
      clip_count: 1, clips: [], created_at: '2026-10-14T09:00:00.000Z', updated_at: '2026-10-14T09:50:00.000Z',
      transcript: '一份足够长的文字稿。',
      summary: {
        overview: '有两条作业，一条提到考试。', key_points: [], terms: [], questions: [],
        homework: [{ text: '期末考试 11 月 20 日 09:30 东1-101', due_hint: '11 月 20 日' }, { text: '写普通作业', due_hint: '' }],
        created_at: '2026-10-14T09:50:00.000Z',
      },
    }]
    const p7 = await openPage(browser, seed({ 'web2.lectures': lec, 'web2.todos': { added: [] } }), { seedKey: 'ex-hw' })
    await p7.evaluate(() => document.querySelector('[data-nav="me"]').click())
    await p7.waitForTimeout(400)
    await p7.evaluate(() => document.querySelector('[data-me-entry="lectures"]').click())
    await p7.waitForTimeout(400)
    const row = p7.locator('li', { hasText: '高数三班 录音' })
    await row.getByRole('button', { name: '查看纪要 ▼' }).click()
    await p7.waitForTimeout(300)
    const items = row.locator('[data-hw-item]')
    t('K1 提到考试的那条才有「加入考试」', (await items.nth(0).locator('[data-hw-exam]').count()) === 1 && (await items.nth(1).locator('[data-hw-exam]').count()) === 0)
    await items.nth(0).locator('[data-hw-exam]').click()
    await p7.waitForTimeout(600)
    t('K2 点完跳到「考试与复习」并打开表单', await p7.evaluate(() => !!document.querySelector('[data-exam-form]')))
    const pre = await p7.evaluate(() => ({
      title: (document.querySelector('[data-exam-title]') || {}).value || '',
      date: (document.querySelector('[data-exam-date]') || {}).innerText || '',
      start: (document.querySelector('[data-exam-start]') || {}).innerText || '',
    }))
    t('K3 标题带过来了', /期末考试/.test(pre.title), pre.title)
    t('K4 日期带过来了（11 月 20 日）', /11 月 20 日/.test(pre.date), pre.date)
    t('K5 时间也带过来了（09:30）', /09:30/.test(pre.start), pre.start)
    t('K6 表单只是预填、还没落库（要用户核对过才存）', await p7.evaluate(() => {
      const raw = localStorage.getItem('web2.exams') || ''
      return raw.indexOf('期末考试') === -1
    }))
    await p7.evaluate(() => document.querySelector('[data-exam-submit]').click())
    await p7.waitForTimeout(600)
    t('K7 用户点保存后才真的进 web2.exams', await p7.evaluate(() => (localStorage.getItem('web2.exams') || '').indexOf('期末考试') >= 0))
    await p7.context().close()
  }
} finally {
  await browser.close()
}

console.log(`\n=== 考试周模式界面：${ok}/${ok + bad} 通过 ===`)
if (fails.length) console.log('失败项：' + fails.join(' / '))
process.exit(bad ? 1 : 0)
