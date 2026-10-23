/* S3 接线自检：打开「考试与复习」页 → 一天问一次 AI「今晚先看哪门」。
   用法：先 node tmp/_serve-dist.mjs 4177（服务 dist/，改源码要先 build），再 node tmp/advice-wire-check.mjs
   判据只看**可观察的副作用**（S4 才有界面）：
     · localStorage 的 web2.review.advice 有没有落今天的这一条；
     · 对 api.deepseek.com 的请求次数（证明「一天一次」与「有缓存不再请求」）；
     · 失败路径不崩、不落库、不弹任何东西。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const ADVICE_KEY = 'web2.review.advice'

let ok = 0, bad = 0
const fails = []
function t(name, cond, extra) {
  if (cond) { ok++; console.log('  PASS ' + name + (extra !== undefined ? '  → ' + extra : '')) }
  else { bad++; fails.push(name); console.log('  FAIL ' + name + '  → ' + extra) }
}
function keyOf(offsetDays) {
  const d = new Date()
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) + offsetDays * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return x.getUTCFullYear() + '-' + p(x.getUTCMonth() + 1) + '-' + p(x.getUTCDate())
}
const D0 = keyOf(0), D3 = keyOf(3), D30 = keyOf(30)
function firstMonday() {
  const d = new Date()
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - 30 * 86400000)
  const back = (x.getUTCDay() + 6) % 7
  const m = new Date(x.getTime() - back * 86400000)
  const p = (n) => String(n).padStart(2, '0')
  return m.getUTCFullYear() + '-' + p(m.getUTCMonth() + 1) + '-' + p(m.getUTCDate())
}
const COURSES = []
for (let wd = 1; wd <= 7; wd++) {
  COURSES.push({ id: 'm' + wd, type: 'course', title: '上午课', teacher: '', place: '', weekday: wd, start_time: '08:00', duration: 240, week_rule: 'every', weeks: [], term: '' })
  COURSES.push({ id: 'a' + wd, type: 'course', title: '下午课', teacher: '', place: '', weekday: wd, start_time: '14:00', duration: 240, week_rule: 'every', weeks: [], term: '' })
}
const DATA = { app: 'sched', semester: { name: 'S3 测试学期', first_monday: firstMonday(), total_weeks: 18, periods: [] }, schedules: COURSES, todos: [], events: [], routines: [] }
const EXAMS_SOON = [{ id: 'e3', title: '高等数学', date: D3, start: '09:00', end: '11:00', place: '东1-101', note: '', created_at: 1 }]
const EXAMS_FAR = [{ id: 'e30', title: '大学物理', date: D30, start: '', end: '', place: '', note: '', created_at: 2 }]
const LLM = { provider: 'deepseek', key: 'sk-test-fake', model: 'deepseek-flash' }
function seed(extra = {}) {
  return Object.assign({
    'web2.onboarded': '1',
    'web2.theme': 'light',
    'web2.data': DATA,
    'web2.exams': EXAMS_SOON,
    'web2.exam.set': { enabled: true, at: '20:00', leadDays: 14 },
    'web2.notify': { enabled: false, minutesBefore: 10 },
    'web2.habits': [],
    'web2.listen': { clips: [] },
  }, extra)
}

/* 打开一个页面：api.deepseek.com 由 reply() 决定（默认成功），其余外部请求一律 abort。 */
async function openPage(browser, kv, { reply = 'ok', seedKey = 'adv' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const hits = []
  await ctx.route('**/*', async (route) => {
    const u = route.request().url()
    if (u.startsWith('https://api.deepseek.com')) {
      hits.push(u)
      if (reply === 'ok') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ message: { content: '今晚先看高等数学，还有 3 天，把上次的错题过一遍。' } }] }),
        })
      }
      if (reply === 'e500') return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      if (reply === 'wrongdays') {
        /* 模型很爱把「还有 3 天」说成「还有 30 天」。说错就整句不要。 */
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ choices: [{ message: { content: '今晚先看高等数学吧，还有 30 天呢。' } }] }),
        })
      }
      return route.abort()
    }
    if (u.startsWith(URL) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue()
    return route.abort()
  })
  const p = await ctx.newPage()
  await p.addInitScript(({ kv, seedKey }) => {
    if (sessionStorage.getItem(seedKey)) return
    sessionStorage.setItem(seedKey, '1')
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
  }, { kv, seedKey })
  await p.goto(URL, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  return { p, hits, ctx }
}
async function openExams(p) {
  await p.evaluate(() => document.querySelector('[data-nav="me"]').click())
  await p.waitForTimeout(450)
  await p.evaluate(() => { const b = document.querySelector('[data-me-exams]'); if (b) b.click() })
  await p.waitForTimeout(900)
}
const adviceOf = (p) => p.evaluate((k) => {
  try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return 'bad' }
}, ADVICE_KEY)

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu'] })
try {
  console.log('\n--- A 有 Key + 有 14 天内的考试 ---')
  {
    const { p, hits, ctx } = await openPage(browser, seed({ 'web2.llm': LLM }), { seedKey: 'a' })
    const before = hits.length
    await openExams(p)
    const adv = await adviceOf(p)
    t('A1 开页面后请求了 AI 一次', hits.length === 1, hits.length + ' 次')
    t('A2 落库的是今天这条', adv && adv.date === D0, adv ? adv.date : 'null')
    t('A3 句子被收干净（不含列表符号/换行）', adv && adv.line && !/\n|^[-*·]/.test(adv.line), adv ? JSON.stringify(adv.line) : 'null')
    t('A4 句子里保留了真实天数（还有 3 天没被丢弃）', adv && /还有 3 天/.test(adv.line), adv ? adv.line : 'null')
    /* 退出二级页再进 —— 同一天不该再请求 */
    await p.evaluate(() => { const b = document.querySelector('[data-sub-back]'); if (b) b.click() })
    await p.waitForTimeout(400)
    await openExams(p)
    t('A5 同一天再进页面不重复请求（走当天缓存）', hits.length === 1, hits.length + ' 次')
    t('A6 缓存那句还在', ((await adviceOf(p)) || {}).line === (adv || {}).line)
    await ctx.close()
  }

  console.log('\n--- B 没配 Key ---')
  {
    const { p, hits, ctx } = await openPage(browser, seed(), { seedKey: 'b' })
    await openExams(p)
    t('B1 没 Key 就一次也不请求', hits.length === 0, hits.length + ' 次')
    t('B2 没 Key 不落库（不写假句子）', (await adviceOf(p)) === null)
    t('B3 页面照常打开（考试列出来、不报错）', /高等数学/.test(await p.evaluate(() => document.body.innerText)))
    await ctx.close()
  }

  console.log('\n--- C 接口 500 ---')
  {
    const { p, hits, ctx } = await openPage(browser, seed({ 'web2.llm': LLM }), { reply: 'e500', seedKey: 'c' })
    await openExams(p)
    t('C1 请求确实发出去了', hits.length === 1, hits.length + ' 次')
    t('C2 500 不落库', (await adviceOf(p)) === null)
    t('C3 失败静默：页面里没有任何「失败/错误」字样', !/加载失败|出错了|请求失败/.test(await p.evaluate(() => document.body.innerText)))
    await ctx.close()
  }

  console.log('\n--- D 断网（请求直接 abort）---')
  {
    const { p, hits, ctx } = await openPage(browser, seed({ 'web2.llm': LLM }), { reply: 'abort', seedKey: 'd' })
    await openExams(p)
    t('D1 断网不落库', (await adviceOf(p)) === null)
    t('D2 断网后考试与复习时间照常显示', /高等数学/.test(await p.evaluate(() => document.body.innerText)))
    await ctx.close()
  }

  console.log('\n--- E 今天没有复习安排（只有 30 天后的考试）---')
  {
    const { p, hits, ctx } = await openPage(browser, seed({ 'web2.llm': LLM, 'web2.exams': EXAMS_FAR }), { seedKey: 'e' })
    await openExams(p)
    t('E1 今天没安排就根本不请求（不浪费一次调用）', hits.length === 0, hits.length + ' 次')
    t('E2 也不落库', (await adviceOf(p)) === null)
    await ctx.close()
  }

  console.log('\n--- F 已经有今天的缓存（冷启动进来）---')

  {
    const cached = { date: D0, line: '今晚先看高等数学，把上次的错题过一遍。', at: Date.now() }
    const { p, hits, ctx } = await openPage(browser, seed({ 'web2.llm': LLM, 'web2.review.advice': cached }), { seedKey: 'f' })
    await openExams(p)
    t('F1 有当天缓存就不再请求', hits.length === 0, hits.length + ' 次')
    t('F2 缓存那句没被覆盖', ((await adviceOf(p)) || {}).line === cached.line)
    await ctx.close()
  }

  console.log('\n--- G 隔夜的旧建议必须作废 ---')
  {
    /* 昨天那句今天还挂着，用户会以为「今天就看这门」——必须重新问、并把旧句换掉。 */
    const stale = { date: keyOf(-1), line: '昨天那句：今晚先看大学物理。', at: Date.now() - 86400000 }
    const { p, hits, ctx } = await openPage(browser, seed({ 'web2.llm': LLM, 'web2.review.advice': stale }), { seedKey: 'g' })
    await openExams(p)
    const adv = await adviceOf(p)
    t('G1 昨天的缓存不算今天，会重新请求', hits.length === 1, hits.length + ' 次')
    t('G2 落库日期换成今天', !!adv && adv.date === D0, adv ? adv.date : 'null')
    t('G3 旧句被新句替掉（不是还挂着昨天那句）', !!adv && !/昨天那句/.test(adv.line), adv ? adv.line : 'null')
    await ctx.close()
  }

  console.log('\n--- H AI 说错天数 → 整句丢弃 ---')
  {
    const { p, ctx } = await openPage(browser, seed({ 'web2.llm': LLM }), { reply: 'wrongdays', seedKey: 'h' })
    await openExams(p)
    t('H1 天数说错就不落库', (await adviceOf(p)) === null)
    t('H2 界面上也不出现那句', !(await p.evaluate(() => !!document.querySelector('[data-exam-advice]'))))
    t('H3 复习时段照常在（建议没了不影响安排）', await p.evaluate(() => !!document.querySelector('[data-exam-today]')))
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log('\n' + (bad ? 'FAILED ' : 'ALL PASS ') + ok + ' PASS / ' + bad + ' FAIL' + (bad ? '\n' + fails.join(', ') : ''))
process.exit(bad ? 1 : 0)
