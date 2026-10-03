/* 常驻通知栏状态框检查（Day 19，路线 3：原生前台服务）
   A 段：纯逻辑 —— buildFrameSnapshot 归一化 / 记号过滤与落库 / 设置默认值（不需要浏览器）
   B 段：网页 ↔ 原生的契约 —— 注入假 StatusFrame 桥，验「网页推了什么、按钮动作怎么落地」
        （真机才验得了通知栏真的长出来；这里验的是插件的输入输出）

   跑法：先起 dist 静态服务（默认 4177，可用 TW_URL 覆盖）再 node tmp/status-frame-check.mjs
   注意：playwright 会 spawn Chrome，沙箱下会被拦（EPERM），需要 danger-full-access。 */

let pass = 0
let fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}
function dkey(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

/* ===== A. 纯逻辑 ===== */
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
const SF = await import('../src/data/statusFrame.js')

/* A1–A3：快照归一化 */
{
  const snap = SF.buildFrameSnapshot({
    enabled: true,
    dndStart: '23:00',
    dndEnd: '07:00',
    todosDue: 3,
    today: [
      { kind: 'c', id: 'c2', name: '数据结构', place: '机房 401', start: '14:00', end: '15:40' },
      { kind: 'r', id: 'r1', name: '晨跑', place: '操场', start: '07:00', end: '07:30' },
      { kind: 'e', id: 'e1', name: '讲座', place: '报告厅', start: '10:00', end: '11:40' },
      { kind: 'c', id: 'bad', name: '', place: '', start: '09:00', end: '10:00' }, // 没名字 → 丢
      { kind: 'c', id: 'bad2', name: '无时间', place: '', start: '', end: '' }, // 没开始时间 → 丢
    ],
    tomorrowFirst: { name: '高等数学', start: '08:00' },
    listen: [
      { id: 'lis1', name: '专业课名词解释' },
      { id: 'lis2', name: '' }, // 没名字 → 丢
    ],
    marks: null,
  })
  t('A1. 快照带上 updatedAt / 开关 / 待办数', !!snap.updatedAt && snap.enabled === true && snap.todosDue === 3)
  t('A2. 今天的条目按开始时间排序且补全字段', snap.today.length === 3 && snap.today[0].name === '晨跑' && snap.today[2].name === '数据结构')
  t('A3. 时间转成当日分钟数', snap.today[2].start === 14 * 60 && snap.today[2].end === 15 * 60 + 40, snap.today[2].start + '/' + snap.today[2].end)
  t('A4. kind 原样保留（课程/循环/日程）', snap.today.map((x) => x.kind).join(',') === 'r,e,c', snap.today.map((x) => x.kind).join(','))
  t('A5. 缺名字或缺时间的条目被丢掉', !snap.today.some((x) => x.id === 'bad' || x.id === 'bad2'))
  t('A6. 练耳列表过滤掉空名字', snap.listen.length === 1 && snap.listen[0].id === 'lis1')
  t('A7. 明天第一节带上分钟数', snap.tomorrowFirst.name === '高等数学' && snap.tomorrowFirst.start === 480)
  t('A8. 没有明天安排时为 null', SF.buildFrameSnapshot({ today: [] }).tomorrowFirst === null)
  t('A9. 非法待办数归 0（不显示负号）', SF.buildFrameSnapshot({ todosDue: -3 }).todosDue === 0)
}

/* A10–A12：记号（「这节上完了」「我去听了」）落库 + 过滤 */
{
  SF.markListenDone('lis1')
  SF.markClassDone('c2')
  SF.markClassDone('c2') // 重复按下只记一条
  const marks = SF.loadFrameMarks()
  t('A10. 「我去听了」的记号落库', marks.listenDone.includes('lis1'))
  t('A11. 「这节上完了」去重（重复按不会记两条）', marks.classDone.filter((x) => x === 'c2').length === 1)
  const snap = SF.buildFrameSnapshot({
    today: [{ kind: 'c', id: 'c2', name: '数据结构', start: '14:00', end: '15:40' }],
    listen: [
      { id: 'lis1', name: '专业课名词解释' },
      { id: 'lis2', name: '另一段' },
    ],
    marks,
  })
  t('A12. 记过的练耳段从快照里撤下（今天不再提醒）', snap.listen.length === 1 && snap.listen[0].id === 'lis2', JSON.stringify(snap.listen))
  t('A13. 「上完了」的课号透传给原生（原生据此不显示「上完了」按钮）', snap.classDone.includes('c2'))
}

/* A14–A16：昨天的记号作废 + 设置默认值 */
{
  localStorage.setItem('web2.frame.marks', JSON.stringify({ date: '2020-01-01', classDone: ['old'], listenDone: ['oldlis'] }))
  const marks = SF.loadFrameMarks()
  t('A14. 隔天的记号自动作废', marks.date === dkey() && marks.classDone.length === 0 && marks.listenDone.length === 0)
  t('A15. 设置默认开（装了就有，不用先去设置里开）', SF.loadFrameSettings().enabled === true)
  t('A16. 设置归一化（非法值当开）', SF.saveFrameSettings({ enabled: 0 }).enabled === false && SF.loadFrameSettings().enabled === false)
  SF.saveFrameSettings({ enabled: true })
}

/* ===== B. 网页 ↔ 原生插件的契约（假桥） ===== */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url())
})

/* 假 StatusFrame 桥：按真插件语义建模（pushSnapshot 收 json、consumeActions 取走即清、
   addListener 能收到 frameActions）——这样网页侧的契约错了就会当场露馅。 */
await page.addInitScript((today) => {
  localStorage.setItem('web2.onboarded', '1')
  /* 给今天塞一条独立日程（示例数据有没有今天的课取决于跑测当天是周几，
     自带一条才能稳定断言「快照里真的装了今天的安排」） */
  if (!sessionStorage.getItem('frame-seed-done')) {
    sessionStorage.setItem('frame-seed-done', '1')
    localStorage.setItem(
      'web2.events',
      JSON.stringify([
        {
          id: 'evt_frame1',
          type: 'event',
          title: '状态框测试日程',
          note: '',
          location: '测试楼 101',
          weekday: null,
          start_time: '13:05',
          duration: 60,
          week_rule: null,
          date: today,
          color: '',
          semester_id: null,
          manual_edited: true,
        },
      ])
    )
  }
  window.__frame = { pushes: [], enabled: [], running: false, queue: [], listeners: [] }
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      StatusFrame: {
        pushSnapshot: async (o) => {
          window.__frame.pushes.push(o && o.json)
          return { ok: true, running: window.__frame.running }
        },
        setEnabled: async (o) => {
          window.__frame.enabled.push(!!(o && o.enabled))
          window.__frame.running = !!(o && o.enabled)
          return { ok: true }
        },
        isRunning: async () => ({ running: window.__frame.running, enabled: window.__frame.enabled.length ? window.__frame.enabled[window.__frame.enabled.length - 1] : true }),
        consumeActions: async () => {
          const out = window.__frame.queue.slice()
          window.__frame.queue = []
          return { actions: out }
        },
        addListener: async (ev, cb) => {
          window.__frame.listeners.push(ev)
          return { remove: async () => {} }
        },
      },
    },
  }
}, dkey())

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)

/* B1：开机就推了一次快照（网页不用等用户进设置页） */
const pushes0 = await page.evaluate(() => window.__frame.pushes.slice())
t('B1. 启动即推快照给原生', pushes0.length >= 1, 'pushes=' + pushes0.length)
let snap0 = {}
try {
  snap0 = JSON.parse(pushes0[pushes0.length - 1])
} catch {
  /* 解析失败 → 下面断言会红，并带上原文 */
}
t('B2. 快照是合法 JSON 且字段齐全', !!snap0.updatedAt && Array.isArray(snap0.today) && Array.isArray(snap0.listen) && 'todosDue' in snap0 && 'dndStart' in snap0, pushes0[pushes0.length - 1])
t('B3. 快照里装了今天的安排（种子日程）', snap0.today.some((x) => x.name === '状态框测试日程' && x.kind === 'e'), JSON.stringify(snap0.today))
t('B4. 种子日程的地点与时间正确', snap0.today.some((x) => x.place === '测试楼 101' && x.start === 13 * 60 + 5 && x.end === 14 * 60 + 5))
t('B5. 挂上了 frameActions 监听（App 在跑时按按钮走这条）', (await page.evaluate(() => window.__frame.listeners)).includes('frameActions'))

/* B6–B9：设置里的开关 */
await page.locator('nav button', { hasText: '我的' }).click()
await page.waitForTimeout(400)
await page.locator('[data-settings-toggle]').click()
await page.waitForTimeout(300)
t('B6. 设置里有「常驻状态框」这一行（App 内才出现）', (await page.locator('[data-frame-row]').count()) === 1)
t('B7. 默认是打开的', (await page.locator('[data-frame-toggle]').getAttribute('class')).includes('bg-primary-500'))
await page.locator('[data-frame-toggle]').click()
await page.waitForTimeout(500)
t('B8. 关掉会调 setEnabled(false)', JSON.stringify(await page.evaluate(() => window.__frame.enabled)) === '[false]', JSON.stringify(await page.evaluate(() => window.__frame.enabled)))
t('B9. 关掉会落库 web2.frame.enabled=false', (await page.evaluate(() => JSON.parse(localStorage.getItem('web2.frame')).enabled)) === false)
/* 关掉后推的那次快照必须带 enabled:false —— 原生据此撤掉常驻服务 */
t('B10. 关掉后推的快照带 enabled:false', JSON.parse((await page.evaluate(() => window.__frame.pushes.slice(-1)[0]))).enabled === false)
await page.locator('[data-frame-toggle]').click()
await page.waitForTimeout(500)
t('B11. 再打开会调 setEnabled(true) 并落库', JSON.stringify(await page.evaluate(() => window.__frame.enabled)) === '[false,true]' && (await page.evaluate(() => JSON.parse(localStorage.getItem('web2.frame')).enabled)) === true)
t('B12. 开关有回执文案（用户看得见发生什么）', (await page.locator('[data-frame-msg]').count()) === 1, await page.locator('[data-frame-msg]').innerText().catch(() => ''))

/* B13–B16：按钮动作领回来落地 */
await page.evaluate(() => { window.__frame.queue.push({ type: 'listenDone', id: 'lis_x' }) })
await page.evaluate(() => { window.__frame.queue.push({ type: 'classDone', id: 'c_x' }) })
const pushesBefore = await page.evaluate(() => window.__frame.pushes.length)
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
await page.waitForTimeout(700)
const marks = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.frame.marks') || '{}'))
t('B13. 「我去听了」的记号被领走并落库', Array.isArray(marks.listenDone) && marks.listenDone.includes('lis_x'), JSON.stringify(marks))
t('B14. 「上完了」的记号被领走并落库', Array.isArray(marks.classDone) && marks.classDone.includes('c_x'), JSON.stringify(marks))
t('B15. 动作取走即清（再回到前台不会重复触发）', (await page.evaluate(() => window.__frame.queue.length)) === 0)
const pushesAfter = await page.evaluate(() => window.__frame.pushes.length)
t('B16. 领完动作会补推一次快照', pushesAfter > pushesBefore, pushesBefore + ' → ' + pushesAfter)
t('B17. 落地后有回执文案', (await page.locator('[data-frame-msg]').innerText()).includes('记下'), await page.locator('[data-frame-msg]').innerText())

/* B18–B19：没有原生桥时整个失效（浏览器/网页版零变化） */
const plainCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const plainPage = await plainCtx.newPage()
const plainErrors = []
plainPage.on('pageerror', (e) => plainErrors.push(String(e)))
await plainPage.addInitScript(() => localStorage.setItem('web2.onboarded', '1'))
await plainPage.goto(BASE, { waitUntil: 'domcontentloaded' })
await plainPage.waitForTimeout(600)
await plainPage.locator('nav button', { hasText: '我的' }).click()
await plainPage.waitForTimeout(300)
await plainPage.locator('[data-settings-toggle]').click()
await plainPage.waitForTimeout(300)
t('B18. 没有原生桥时设置里不出现这一行（网页版零变化）', (await plainPage.locator('[data-frame-row]').count()) === 0)
t('B19. 没有原生桥时不报错（降级静默）', plainErrors.length === 0, plainErrors.join(' | '))

t('B20. 全程无报错', errors.length === 0, errors.join(' | '))

await browser.close()
console.log('')
console.log('结果：' + pass + ' 过 / ' + fail + ' 挂')
process.exit(fail ? 1 : 0)
