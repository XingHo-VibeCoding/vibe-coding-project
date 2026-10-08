/* 调休 / 特殊日期检查
   A 段：纯逻辑（清洗、唯一入口、放假/补课/只提示三种语义、老数据逐字一致）
   B 段：数据层联动（ics 导出、课前提醒排程、下次上课日）
   C 段：浏览器端到端（今天页、周课表、学期设置里的特殊日期）
   D 段：老数据兼容（没有 web2.dayOverrides 这个键时行为与加调休之前逐字一致）

   背景（用户 2026-10-08 拍板）：
   · 「放假」= 这天课全空；「补课」= 这天按被换过来的星期上课（周六上周三的课）；
   · 「只提示」= 校运会 / 考试周 / 寒暑假，界面给条提示但**不动课程**；
   · 抓不到学校层的补课安排就**不猜**（绝不默认「补周一」）；
   · 独立日程（班会在哪天就是哪天）不受调休影响，调休只换课表；
   · 浙大的具体日期只作测试夹具，**不写进产品代码**（用户要求：以后要分享给别的学校）。

   跑法：node tmp/dayover-check.mjs（C 段要先起 4177 静态服务）
   产物：tmp/dayover-{off,swap,info}.png */

let pass = 0
let fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}
/* 本地日期键（YYYY-MM-DD）。**别用 toISOString()** —— 那是 UTC，东八区清晨会把日期退回
   前一天（10-08 07:45 本地 → 10-07T23:45Z），断言会整体错位一格。 */
function localKey(d) {
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
const fmt = localKey

class FakeStore {
  constructor() {
    this.m = new Map()
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null
  }
  setItem(k, v) {
    this.m.set(k, String(v))
  }
  removeItem(k) {
    this.m.delete(k)
  }
}
globalThis.localStorage = new FakeStore()

const S = await import('../src/data/store.js')
const I = await import('../src/data/ics.js')
const N = await import('../src/data/notify.js')

/* ============ A 段：纯逻辑 ============ */

/* A1 清洗：认不出的条目一律丢掉，不留半成品 */
const dirty = [
  { date: '2026-10-06', kind: 'off' },
  { date: '2026/10/07', kind: 'off' }, // 日期格式不对
  { date: '2026-10-08', kind: 'holiday' }, // kind 不认
  { date: '2026-10-09', kind: 'swap' }, // 补课但没说算周几
  { date: '2026-10-10', kind: 'swap', useWeekday: 9 }, // 周几超范围
  { date: '2026-10-11', kind: 'swap', useWeekday: 3, note: '  周六补周三  ' },
  { date: '2026-10-06', kind: 'off', note: '重复的日期只留第一条' },
  { date: '', kind: 'off' },
  null,
]
const clean = S.normalizeDayOverrides(dirty)
t('A1. 清洗只留 2 条：坏日期 / 坏 kind / 补课没说周几 / 周几超范围 / 空条目 全丢掉',
  clean.length === 2 && clean[0].date === '2026-10-06' && clean[1].date === '2026-10-11',
  JSON.stringify(clean))
t('A1b. 重复日期只留第一条（先到先得）',
  clean[0].kind === 'off' && clean[0].note === '',
  JSON.stringify(clean[0]))
t('A1c. note 去掉首尾空白；结果按日期升序',
  clean[1].note === '周六补周三' && clean[0].date < clean[1].date,
  JSON.stringify(clean[1]))

/* A2 唯一入口：effectiveWeekdayOf */
const OV = S.normalizeDayOverrides([
  { date: '2026-10-01', kind: 'off', note: '国庆' },
  { date: '2026-10-10', kind: 'swap', useWeekday: 3, note: '周六补周三' },
  { date: '2026-10-24', kind: 'info', note: '秋季校运会' },
])
t('A2. 放假 → effectiveWeekdayOf 返回 null（这天没有课）',
  S.effectiveWeekdayOf('2026-10-01', OV, 4) === null)
t('A3. 补课 → 返回被换过来的星期（10-10 周六真实是 6，补周三 → 3）',
  S.effectiveWeekdayOf('2026-10-10', OV, 6) === 3)
t('A4. 只提示（校运会）→ **课照上**（返回真实星期，不是 null），isDayOff 为假，界面还能拿到说明',
  S.effectiveWeekdayOf('2026-10-24', OV, 6) === 6
  && S.isDayOff('2026-10-24', OV) === false
  && S.dayOverrideOf('2026-10-24', OV).note === '秋季校运会',
  String(S.effectiveWeekdayOf('2026-10-24', OV, 6)))
t('A5. 没覆盖的日期 → 原样返回真实星期',
  S.effectiveWeekdayOf('2026-10-14', OV, 3) === 3 && S.isDayOff('2026-10-14', OV) === false)
t('A5b. dayOverrideOf 没命中 → null（不是抛错、不是空对象）',
  S.dayOverrideOf('2026-01-01', OV) === null && S.dayOverrideOf('', OV) === null)

/* A6 老数据逐字一致：没有这个键 / 传 null / 传空数组 / 传坏东西 */
t('A6. **老数据（没这个键、null、[]、坏值）→ 一律「无覆盖」，行为与加调休之前逐字一致**',
  S.effectiveWeekdayOf('2026-10-10', null, 6) === 6
  && S.effectiveWeekdayOf('2026-10-10', [], 6) === 6
  && S.effectiveWeekdayOf('2026-10-10', undefined, 6) === 6
  && S.effectiveWeekdayOf('2026-10-10', 'not-an-array', 6) === 6
  && S.isDayOff('2026-10-10', null) === false)
t('A6b. 老数据（localStorage 里压根没有 web2.dayOverrides）→ loadDayOverrides() 给空数组',
  (() => {
    localStorage.removeItem(S.DAY_OVERRIDES_KEY)
    return JSON.stringify(S.loadDayOverrides()) === '[]'
  })())
t('A6c. 坏 JSON 不抛错，当空表处理',
  (() => {
    localStorage.setItem(S.DAY_OVERRIDES_KEY, '{不是 JSON')
    const r = S.loadDayOverrides()
    localStorage.removeItem(S.DAY_OVERRIDES_KEY)
    return Array.isArray(r) && r.length === 0
  })())

/* A7 落盘往返 */
S.saveDayOverrides([{ date: '2026-10-01', kind: 'off' }, { date: '2026-10-10', kind: 'swap', useWeekday: 3 }])
t('A7. 落盘与读回一致（写盘前先清洗，读回还是那 2 条）',
  JSON.stringify(S.loadDayOverrides()) === JSON.stringify([
    { date: '2026-10-01', kind: 'off', useWeekday: null, note: '' },
    { date: '2026-10-10', kind: 'swap', useWeekday: 3, note: '' },
  ]),
  JSON.stringify(S.loadDayOverrides()))
localStorage.removeItem(S.DAY_OVERRIDES_KEY)

/* ============ B 段：数据层联动 ============ */

const SEM = { name: '2026-2027 秋冬', firstMonday: '2026-09-07', totalWeeks: 16, week: 5 }
/* 浙大 2026-2027 秋冬的实际口径（只作夹具，不进产品代码）：
   10-01~07 放假；10-10 周六补 10-07 的课（周三）；10-17 周六补 10-02 的课（周五）；
   11-09 冬学期开始（此处不测）。 */
const REAL = S.normalizeDayOverrides([
  { date: '2026-10-01', kind: 'off', note: '国庆' },
  { date: '2026-10-10', kind: 'swap', useWeekday: 3, note: '周六补周三' },
])
const COURSES = [
  { id: 'c1', type: 'course', name: '高数', weekday: 1, start: '08:00', end: '09:40', week_rule: 'every' },
  { id: 'c2', type: 'course', name: '英语', weekday: 4, start: '08:00', end: '09:40', week_rule: 'every' },
]

/* B1 ics 导出：放假那天没有课时，补课那天有 */
{
  const evs = [{ id: 'e1', type: 'event', name: '班会', date: '2026-10-01', start: '19:00', end: '20:00' }]
  const withOv = I.buildIcs({ semester: SEM, courses: COURSES, events: evs, routines: [], overrides: REAL })
  const noOv = I.buildIcs({ semester: SEM, courses: COURSES, events: evs, routines: [] })
  /* 数「那一天开始的事件条数」。只数 DTSTART:，不要用 indexOf('20261007') ——
     DTSTAMP 就是当前时刻，跑在 10-07 那天会假命中。 */
  const countOn = (text, dateKey) => (text.match(new RegExp('DTSTART:' + dateKey.replace(/-/g, ''), 'g')) || []).length
  /* 10-01 是周四（英语的上课日）——放假后课没了，但独立日程照留 ⇒ 2 条变 1 条 */
  t('B1. 导出 .ics：10-01（周四）放假 → 课时消失、独立日程「班会」照留（2 条 → 1 条）',
    countOn(withOv.text, '2026-10-01') === 1 && countOn(noOv.text, '2026-10-01') === 2 && withOv.text.indexOf('班会') >= 0,
    '有调休=' + countOn(withOv.text, '2026-10-01') + ' 无调休=' + countOn(noOv.text, '2026-10-01'))
  /* 10-10 周六补周三 —— 课表里没有周三的课，所以补课日也不该凭空冒出课来 */
  t('B1b. 补课日不会凭空造课（课表里没排周三的课 → 补课日也就没有课）',
    countOn(withOv.text, '2026-10-10') === 0 && countOn(noOv.text, '2026-10-10') === 0,
    '补课日条数=' + countOn(withOv.text, '2026-10-10'))
}
/* B1c 有周三的课时，补课日要把课挪到周六那一列 */
{
  const with3 = [...COURSES, { id: 'c3', type: 'course', name: '结构力学', weekday: 3, start: '10:00', end: '11:35', week_rule: 'every' }]
  const withOv = I.buildIcs({ semester: SEM, courses: with3, events: [], routines: [], overrides: REAL })
  const noOv = I.buildIcs({ semester: SEM, courses: with3, events: [], routines: [] })
  const countOn = (text, dateKey) => (text.match(new RegExp('DTSTART:' + dateKey.replace(/-/g, ''), 'g')) || []).length
  t('B1c. **补课日（10-10 周六）出现周三的课**；不加调休时 10-10 什么都没有',
    countOn(withOv.text, '2026-10-10') === 1 && countOn(noOv.text, '2026-10-10') === 0,
    '有调休=' + countOn(withOv.text, '2026-10-10') + ' 无调休=' + countOn(noOv.text, '2026-10-10'))
  t('B1d. 10-07（周三）本身没被覆盖 → 照旧有课（放假要显式标在表里，不靠猜）',
    countOn(withOv.text, '2026-10-07') === 1 && countOn(noOv.text, '2026-10-07') === 1,
    '有调休=' + countOn(withOv.text, '2026-10-07'))
}

/* B2 课前提醒排程 */
{
  const now = new Date('2026-09-30T20:00:00')
  const withOv = N.buildScheduleItems({ courses: COURSES, events: [], routines: [], semester: SEM, settings: { minutesBefore: 15 }, now, horizonDays: 12, overrides: REAL })
  const noOv = N.buildScheduleItems({ courses: COURSES, events: [], routines: [], semester: SEM, settings: { minutesBefore: 15 }, now, horizonDays: 12 })
  const datesOf = (list, name) => list.filter((x) => x.title === name).map((x) => localKey(x.at))
  /* 10-01 放假 → 英语那天的提醒不该排出来 */
  t('B2. 提醒：10-01 放假的英语课不排（不加调休时会排）',
    datesOf(withOv, '英语').indexOf('2026-10-01') < 0 && datesOf(noOv, '英语').indexOf('2026-10-01') >= 0,
    JSON.stringify(datesOf(withOv, '英语')))
  /* 10-08 也是周四、在窗口内、没被覆盖，正常排 */
  t('B2b. 同一门课别的正常周四照排（放假只影响那一天）',
    datesOf(withOv, '英语').indexOf('2026-10-08') >= 0,
    JSON.stringify(datesOf(withOv, '英语')))
}
/* B2c 独立日程不受调休影响 */
{
  const now = new Date('2026-09-30T20:00:00')
  const evs = [{ id: 'e1', type: 'event', name: '班会', date: '2026-10-01', start: '19:00', end: '20:00' }]
  const withOv = N.buildScheduleItems({ courses: [], events: evs, routines: [], semester: SEM, settings: { minutesBefore: 15 }, now, horizonDays: 12, overrides: REAL })
  t('B2c. 放假那天，用户自己加的独立日程照旧排提醒（调休只换课表，不动用户排的事）',
    withOv.some((x) => x.title === '班会'),
    JSON.stringify(withOv.map((x) => x.title)))
}

/* B3 下次上课日：放假那天不算「上过课」
   学期锚点 2026-09-07 → 第 5 周 = 10-05~10-11，周四 = 10-08。
   wdNow=3（周三问）：本周四 10-08 是候选；把它标成放假 → 应跳到第 6 周 10-15。 */
{
  const OV3 = S.normalizeDayOverrides([{ date: '2026-10-08', kind: 'off', note: '测试：第 5 周周四放假' }])
  const withOv = S.nextCourseDate(COURSES, { ...SEM, week: 5 }, 3, '英语', OV3)
  const noOv = S.nextCourseDate(COURSES, { ...SEM, week: 5 }, 3, '英语')
  t('B3. 「下次上课」跳过放假那天（第 5 周周四 10-08 放假 → 下次 10-15）',
    withOv === '2026-10-15' && noOv === '2026-10-08',
    '有调休=' + withOv + ' 无调休=' + noOv)
  t('B3b. 不传调休表 → 与改动前逐字一致（就取本周那个周四 10-08）',
    S.nextCourseDate(COURSES, { ...SEM, week: 5 }, 3, '英语') === '2026-10-08',
    String(S.nextCourseDate(COURSES, { ...SEM, week: 5 }, 3, '英语')))
}

/* ============ D 段：国家法定节假日抓取（纯逻辑） ============ */
const H = await import('../src/data/holidays.js')

/* D1 parseHolidayCn：只认「放假」，带上班日一律不要 */
{
  const json = {
    year: 2026,
    days: [
      { name: '国庆节', date: '2026-10-01', isOffDay: true },
      { name: '国庆节', date: '2026-10-08', isOffDay: false }, // 调休上班日 → 不是放假
      { name: '元旦', date: '2026/01/01', isOffDay: true }, // 日期格式不对
      { name: '坏的', date: '2026-02-30', isOffDay: true },
      null,
      { name: '', date: '2026-05-01', isOffDay: true }, // 没名字 → 兜底
    ],
  }
  const out = H.parseHolidayCn(json)
  t('D1. 只收 isOffDay=true 的天，「调休上班日」不算放假、坏日期丢掉',
    out.length === 2 && out[0].date === '2026-05-01' && out[1].date === '2026-10-01'
      && out.some((x) => x.name === '法定假日'),
    JSON.stringify(out))
  t('D1b. 结果按日期升序', out[0].date < out[1].date)
  t('D1c. 空 JSON / 没有 days 字段 → 空数组，不抛',
    H.parseHolidayCn(null).length === 0 && H.parseHolidayCn({}).length === 0)
}

/* D2 mergeNationalOffs：只补空缺，绝不覆盖用户自己标的条目 */
{
  const mine = S.normalizeDayOverrides([
    { date: '2026-10-01', kind: 'swap', useWeekday: 3, note: '我自己标的：补周三' },
    { date: '2026-10-05', kind: 'info', note: '校运会' },
  ])
  const r = H.mergeNationalOffs(mine, [
    { date: '2026-10-01', name: '国庆节' }, // 已有 → 动都不动
    { date: '2026-10-05', name: '国庆节' }, // 已有（info）→ 也不动
    { date: '2026-10-02', name: '国庆节' }, // 空缺 → 补
    { date: '2026-10-03', name: '国庆节' }, // 空缺 → 补
  ])
  const byDate = Object.fromEntries(r.list.map((x) => [x.date, x]))
  t('D2. **抓回来的放假只补空缺，不覆盖用户自己标的条目**（已有的 swap/info 原样保留）',
    byDate['2026-10-01'].kind === 'swap' && byDate['2026-10-01'].useWeekday === 3
      && byDate['2026-10-05'].kind === 'info',
    JSON.stringify(byDate['2026-10-01']))
  t('D2b. 空缺的补成 off，说明里带上节日名（看得出是自动填的）',
    r.added.length === 2 && byDate['2026-10-03'].kind === 'off'
      && /国庆节/.test(byDate['2026-10-03'].note),
    JSON.stringify(r.added))
  t('D2c. 再跑一次不会重复添加（幂等）',
    H.mergeNationalOffs(r.list, [{ date: '2026-10-02', name: '国庆节' }]).added.length === 0)
}

/* D3 yearsToFetch：跨年学期要抓两年 */
{
  const cross = H.yearsToFetch({ first_monday: '2026-09-07', total_weeks: 20 }, new Date('2026-10-08T00:00:00'))
  t('D3. 跨年学期（9 月开始、20 周）→ 覆盖 2026 与 2027 两年',
    cross.indexOf(2026) >= 0 && cross.indexOf(2027) >= 0,
    JSON.stringify(cross))
  const only = H.yearsToFetch(null, new Date('2026-10-08T00:00:00'))
  t('D3b. 学期信息缺失 → 至少算上今年，且不抛',
    only.length >= 1 && only.indexOf(2026) >= 0, JSON.stringify(only))
}

/* D4 缓存兜底：坏 JSON / 键不存在 → 都当空，不抛 */
{
  globalThis.localStorage.removeItem('web2.holidayCache')
  t('D4. 没有缓存键 → 空缓存（不是 null、不是抛错）',
    H.loadHolidayCache().fetchedAt === 0 && Object.keys(H.loadHolidayCache().byYear).length === 0)
  globalThis.localStorage.setItem('web2.holidayCache', '{这不是 JSON')
  t('D4b. 缓存是坏 JSON → 也当空，不抛（绝不因为缓存坏了打不开 App）',
    H.loadHolidayCache().fetchedAt === 0)
  globalThis.localStorage.removeItem('web2.holidayCache')
}

/* ============ C 段：浏览器 ============ */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'

/* 让「今天」落在第 3 周（把学期锚点设成今天所在周一的前 2 周），并**在今天的真实星期上
   排一门课**——否则「放假」那两条断言会因为今天本来就没课而假过。 */
const todayD = new Date()
const NATURAL_WD = ((todayD.getDay() + 6) % 7) + 1
const mondayOfToday = new Date(todayD.getFullYear(), todayD.getMonth(), todayD.getDate() - (NATURAL_WD - 1))
const FIRST_MONDAY = fmt(new Date(mondayOfToday.getFullYear(), mondayOfToday.getMonth(), mondayOfToday.getDate() - 14))
const TODAY = fmt(todayD)
const WD_NAME = '今天这门课'
const SWAP_NAME = { 1: '周一课', 2: '周二课', 3: '周三课', 4: '周四课', 5: '周五课', 6: '周六课', 7: '周日课' }
const ALL_NAMES = '周一课|周二课|周三课|周四课|周五课|周六课|周日课|' + WD_NAME

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

async function open({ overrides, label, shot }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  /* **把外网截断**：App 打开时会后台抓国家法定节假日（holidays.js），headless Chrome 是有真网的，
     于是夹具里「本来该是空的」特殊日期表会被真数据填满（实测灌进 33 条）—— 那不是产品错了，
     是测试没隔离环境。这里只放行本地静态服务，其余一律 abort，夹具完全确定。
     （抓取逻辑本身在 D 段用 mock 数据单独测。）
     注意：不能用 '**cdn.jsdelivr.net**' 这种窄 pattern —— 实测它不命中带路径的 URL。 */
  await ctx.route('**/*', (route) => {
    const u = route.request().url()
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue()
    return route.abort()
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const doc = {
    app: 'sched',
    semester: { id: 's', name: '2026-2027 秋冬', first_monday: FIRST_MONDAY, total_weeks: 16 },
    schedules: [
      /* 一周七天各一门课：这样「今天补到哪一天」都有一门对得上的课，断言不会因为
         碰巧今天没课而假过（调用方只管用名字去找）。 */
      ...[1, 2, 3, 4, 5, 6, 7].map((wd, i) => ({
        id: 'c' + wd, type: 'course', title: wd === NATURAL_WD ? WD_NAME : SWAP_NAME[wd],
        weekday: wd, start_time: '08:00', duration: 95, week_rule: 'every', semester_id: 's',
      })),
    ],
    todos: [],
  }
  await page.addInitScript(
    ([d, ov]) => {
      localStorage.setItem('web2.data', JSON.stringify(d))
      localStorage.setItem('web2.onboarded', '1')
      if (ov) localStorage.setItem('web2.dayOverrides', JSON.stringify(ov))
      else localStorage.removeItem('web2.dayOverrides')
    },
    [doc, overrides || null],
  )
  /* ?t=07:00 把钟点冻在早上 7 点：fixture 的课都在 08:00 之后，于是「今天那门课」永远
     是「接下来」而不是「已过」——否则下午跑这套断言时课会被收进「已过 N 件」折叠行里，
     断言会因为看不见标题而假失败（这是测试的前提问题，不是代码问题）。 */
  await page.goto(BASE + '?t=07:00', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  const todayText = () => page.$eval('main[data-page="today"]', (el) => el.innerText.replace(/\s+/g, ' '))
  const out = { page, errors, todayText, label }
  if (shot) {
    await page.screenshot({ path: 'tmp/dayover-' + shot + '.png', fullPage: false })
  }
  return out
}

/* --- C1 放假：今天课上全空 --- */
{
  const r = await open({
    label: '放假',
    overrides: [{ date: TODAY, kind: 'off', note: '国庆放假（测试）' }],
    shot: 'off',
  })
  const txt = await r.todayText()
  t('C1. 今天放假 → 今日页看不见任何课（真实星期那门课也不出现）',
    !new RegExp(ALL_NAMES).test(txt),
    txt.slice(0, 200))
  t('C1b. 放假说明出现在界面上（不是静默清空）', /放假（测试）|国庆放假/.test(txt), txt.slice(0, 240))
  t('C1c. 零 pageerror', r.errors.length === 0, JSON.stringify(r.errors))
  await r.page.context().close()
}

/* --- C2 补课：今天按别的星期上课 --- */
{
  const swapTo = (NATURAL_WD % 7) + 1 // 保证跟真实星期不同，能区分
  const want = SWAP_NAME[swapTo]
  const r = await open({
    label: '补课',
    overrides: [{ date: TODAY, kind: 'swap', useWeekday: swapTo, note: '补周' + '一二三四五六日'[swapTo - 1] }],
    shot: 'swap',
  })
  const txt = await r.todayText()
  t('C2. 今天补课（真实周 ' + NATURAL_WD + ' → 按周 ' + swapTo + ' 上课）→ 出现「' + want + '」，且今日原来的课不见了',
    txt.indexOf(want) >= 0 && txt.indexOf(WD_NAME) < 0,
    txt.slice(0, 200))
  /* 周课表列头要挂上「补课」小标 */
  await r.page.$eval('[data-nav="week"]', (el) => el.click())
  await r.page.waitForTimeout(500)
  const mark = await r.page.$eval('main[data-page="week"]', (el) => {
    const m = el.querySelector('[data-day-mark="swap"]')
    return m ? m.innerText.trim() : ''
  })
  t('C2b. 周课表列头出现「补课」小标（用户一眼看出这天为什么有课）',
    mark === '补课', mark)
  await r.page.screenshot({ path: 'tmp/dayover-swap-week.png', fullPage: false })
  t('C2c. 零 pageerror', r.errors.length === 0, JSON.stringify(r.errors))
  await r.page.context().close()
}

/* --- C3 只提示（校运会）：课照上，列头给提示 --- */
{
  const r = await open({
    label: '只提示',
    overrides: [{ date: TODAY, kind: 'info', note: '秋季校运会' }],
    shot: 'info',
  })
  const txt = await r.todayText()
  t('C3. 「只提示」不藏课 → 今天照旧看得见那门课（这正是它跟「放假」的区别）',
    txt.indexOf(WD_NAME) >= 0,
    txt.slice(0, 200))
  t('C3b. 提示文字也露出来了（只提示，不改课表）', /校运会/.test(txt), txt.slice(0, 240))
  await r.page.$eval('[data-nav="week"]', (el) => el.click())
  await r.page.waitForTimeout(500)
  const mark = await r.page.$eval('main[data-page="week"]', (el) => {
    const m = el.querySelector('[data-day-mark="info"]')
    return m ? m.innerText.trim() : ''
  })
  t('C3c. 周课表列头出现「提示」小标', mark === '提示', mark)
  t('C3d. 零 pageerror', r.errors.length === 0, JSON.stringify(r.errors))
  await r.page.context().close()
}

/* --- C4 老数据：没有 web2.dayOverrides 这个键 → 行为与加调休之前完全一样 --- */
{
  const r = await open({ label: '老数据', overrides: null })
  const txt = await r.todayText()
  t('C4. **老数据（没有 web2.dayOverrides）→ 今天照旧显示真实星期那天的课，行为零变化**',
    txt.indexOf(WD_NAME) >= 0,
    '真实周=' + NATURAL_WD + ' | ' + txt.slice(0, 160))
  t('C4b. 零 pageerror', r.errors.length === 0, JSON.stringify(r.errors))
  await r.page.context().close()
}

/* --- C5 特殊日期界面：在设置页真的加一条「放假」，今日页当场就变（改完立即生效） --- */
{
  const r = await open({ label: '设置页手动加', overrides: null })
  const page = r.page
  /* 非当前页带 inert → 真实鼠标事件会被吃掉，切页一律程序化 click */
  await page.$eval('[data-nav="me"]', (el) => el.click())
  await page.waitForTimeout(400)
  await page.$eval('[data-settings-toggle]', (el) => el.click())
  await page.waitForTimeout(500)
  t('C5. 「我的 → 设置」里能找到「特殊日期」这一栏',
    await page.locator('[data-dayover-section]').count() === 1)
  t('C5b. 默认空态：给一句「还没有特殊日期」的说明，不留空白',
    await page.locator('[data-dayover-empty]').count() === 1)

  await page.$eval('[data-dayover-add]', (el) => el.click())
  await page.waitForTimeout(400)
  /* 新增默认落在今天，且默认 kind=off（放假）——这样「加了就该看见变化」 */
  t('C5c. 点「＋ 添加」→ 多出一行，日期默认是今天',
    await page.locator('[data-dayover-row="' + TODAY + '"]').count() === 1,
    String(await page.locator('[data-dayover-row]').count()))

  await page.$eval('[data-sub-back]', (el) => el.click())
  await page.waitForTimeout(400)
  const txt = await r.todayText()
  t('C5d. **加完不用点保存，回今日页当场就变**（今天那门课不见了 + 挂出「放假」标）',
    txt.indexOf(WD_NAME) < 0 && /放假/.test(txt),
    txt.slice(0, 220))
  await page.screenshot({ path: 'tmp/dayover-settings.png', fullPage: false })
  t('C5e. 零 pageerror', r.errors.length === 0, JSON.stringify(r.errors))
  await page.context().close()
}

/* --- C6 改成「补课」并选周几 → 课按那天上（界面这条路也必须通） --- */
{
  const swapTo = (NATURAL_WD % 7) + 1
  const r = await open({
    label: '设置页改补课',
    overrides: [{ date: TODAY, kind: 'off', note: '先设成放假' }],
  })
  const page = r.page
  await page.$eval('[data-nav="me"]', (el) => el.click())
  await page.waitForTimeout(400)
  await page.$eval('[data-settings-toggle]', (el) => el.click())
  await page.waitForTimeout(500)
  await page.$eval('[data-dayover-kind="' + TODAY + ':swap"]', (el) => el.click())
  await page.waitForTimeout(300)
  t('C6. 点「补课」→ 出现「按 一 二 … 的课表上」那一排星期按钮',
    await page.locator('[data-dayover-wd]').count() === 7,
    String(await page.locator('[data-dayover-wd]').count()))
  t('C6b. 还没选周几时，默认就是这一天的真实星期（不会空着让人猜）',
    await page.locator('[data-dayover-wd="' + TODAY + ':' + NATURAL_WD + '"]').count() === 1)
  /* 这一栏所有控件（日期 / 三种 kind / 七个星期钮 / 说明 / 删除）都在选中「补课」时才齐，截图留档 */
  await page.locator('[data-dayover-section]').screenshot({ path: 'tmp/dayover-settings.png' })
  await page.$eval('[data-dayover-wd="' + TODAY + ':' + swapTo + '"]', (el) => el.click())
  await page.waitForTimeout(300)
  await page.$eval('[data-sub-back]', (el) => el.click())
  await page.waitForTimeout(400)
  const txt = await r.todayText()
  t('C6c. **选完周几，今日页按那天的课表上**（原课不见、换成被补那天的课）',
    txt.indexOf(WD_NAME) < 0 && txt.indexOf(SWAP_NAME[swapTo]) >= 0,
    '补到周' + swapTo + ' | ' + txt.slice(0, 200))
  t('C6d. 零 pageerror', r.errors.length === 0, JSON.stringify(r.errors))
  await page.context().close()
}

/* --- C7 删除那条覆盖 → 课回来（可逆，别让人不敢用） --- */
{
  const r = await open({
    label: '设置页删除',
    overrides: [{ date: TODAY, kind: 'off', note: '待删除' }],
  })
  const page = r.page
  await page.$eval('[data-nav="me"]', (el) => el.click())
  await page.waitForTimeout(400)
  await page.$eval('[data-settings-toggle]', (el) => el.click())
  await page.waitForTimeout(500)
  await page.$eval('[data-dayover-del="' + TODAY + '"]', (el) => el.click())
  await page.waitForTimeout(300)
  t('C7. 点「删除」→ 那一行消失、回到空态',
    await page.locator('[data-dayover-row]').count() === 0
      && await page.locator('[data-dayover-empty]').count() === 1)
  await page.$eval('[data-sub-back]', (el) => el.click())
  await page.waitForTimeout(400)
  const txt = await r.todayText()
  t('C7b. **删掉之后课就回来了**（可逆）', txt.indexOf(WD_NAME) >= 0, txt.slice(0, 200))
  t('C7c. 零 pageerror', r.errors.length === 0, JSON.stringify(r.errors))
  await page.context().close()
}

await browser.close()
console.log(`\n调休检查：${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
