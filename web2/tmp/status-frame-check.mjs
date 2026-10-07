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
  t('A9. 勿扰时段转成当日分钟数（原生用 JSONObject.optInt 读，字符串会解析失败回落默认值）', snap.dndStart === 23 * 60 && snap.dndEnd === 7 * 60, snap.dndStart + '/' + snap.dndEnd)
  const noDnd = SF.buildFrameSnapshot({ today: [] })
  t('A10. 拿不到勿扰时段就整个省掉这个键（省掉≠0，0 是"00:00 起勿扰"这个有效值）', !('dndStart' in noDnd) && !('dndEnd' in noDnd), JSON.stringify(noDnd))
  const zeroDnd = SF.buildFrameSnapshot({ dndStart: '00:00', dndEnd: '00:00' })
  t('A11. 00:00 是有效时刻，保留成 0 不能丢', zeroDnd.dndStart === 0 && zeroDnd.dndEnd === 0, zeroDnd.dndStart + '/' + zeroDnd.dndEnd)
  const numDnd = SF.buildFrameSnapshot({ dndStart: 23 * 60, dndEnd: 7 * 60 })
  t('A12. 直接给分钟数也认（防止调用方两种形状都传）', numDnd.dndStart === 1380 && numDnd.dndEnd === 420, numDnd.dndStart + '/' + numDnd.dndEnd)
  const badDnd = SF.buildFrameSnapshot({ dndStart: '25:00', dndEnd: 'abc' })
  t('A13. 非法时刻当拿不到处理（省掉键，不能变成 0）', !('dndStart' in badDnd) && !('dndEnd' in badDnd))
  t('A9. 非法待办数归 0（不显示负号）', SF.buildFrameSnapshot({ todosDue: -3 }).todosDue === 0)
}

/* A10–A12：记号（今天「已去听过」）落库 + 过滤。
   P5 按钮收窄（2026-10-07）后 classDone 已随「上完了」按钮删除，
   保留 listenDone 一个（写入点改为 listenAutoMark 真放满遍数）。 */
{
  SF.markListenDone('lis1')
  SF.markListenDone('lis1') // 重复记只留一条
  const marks = SF.loadFrameMarks()
  t('A10. 「已去听过」的记号落库', marks.listenDone.includes('lis1'))
  t('A11. 「已去听过」去重（重复记不会留两条）', marks.listenDone.filter((x) => x === 'lis1').length === 1)
  const snap = SF.buildFrameSnapshot({
    today: [{ kind: 'c', id: 'c2', name: '数据结构', start: '14:00', end: '15:40' }],
    listen: [
      { id: 'lis1', name: '专业课名词解释' },
      { id: 'lis2', name: '另一段' },
    ],
    marks,
  })
  t('A12. 记过的练耳段从快照里撤下（今天不再提醒）', snap.listen.length === 1 && snap.listen[0].id === 'lis2', JSON.stringify(snap.listen))
  t('A13. 快照里不再有 classDone（按钮砍了，这个概念随之删掉）', !('classDone' in snap), JSON.stringify(Object.keys(snap)))
}

/* A14–A16：昨天的记号作废 + 设置默认值 */
{
  localStorage.setItem('web2.frame.marks', JSON.stringify({ date: '2020-01-01', classDone: ['old'], listenDone: ['oldlis'] }))
  const marks = SF.loadFrameMarks()
  t('A14. 隔天的记号自动作废', marks.date === dkey() && marks.listenDone.length === 0, JSON.stringify(marks))
  t('A15. 设置默认开（装了就有，不用先去设置里开）', SF.loadFrameSettings().enabled === true)
  t('A16. 设置归一化（非法值当开）', SF.saveFrameSettings({ enabled: 0 }).enabled === false && SF.loadFrameSettings().enabled === false)
  SF.saveFrameSettings({ enabled: true })
}

/* A17–A22：P5「甲」场景门 —— 只剩「点通知本体去哪儿」一处判断。
   策略只在网页侧算（LEDGER_FROM = 18:00），原生只读 tapLedger，所以这几条断言就是策略的全部。
   上课中即便已过 18:00 也必须回今日页（正上课不可能去结账）。 */
{
  t('A17. 场景门常量是 18:00（改口径只改这一处）', SF.LEDGER_FROM === 1080, String(SF.LEDGER_FROM))
  const classItem = { kind: 'c', id: 'c1', name: '结构力学', start: '14:00', end: '15:40' }
  /* 19:00 正上着的那节课：18:30–20:00（用它才能验「上课中不跳日精进」） */
  const eveningClass = { kind: 'c', id: 'c2', name: '晚课', start: '18:30', end: '20:00' }
  const mk = (nowMin, today = []) => SF.buildFrameSnapshot({ nowMin, ledgerFrom: SF.LEDGER_FROM, today })
  t('A18. 17:59 不在上课 → 点通知不开日精进', mk(17 * 60 + 59).tapLedger === false)
  t('A19. 18:00 整、不在上课 → 点通知开日精进', mk(18 * 60).tapLedger === true)
  t('A20. 拿不到当前时间就不给结论（宁可回今日页，也别在白天弹日精进）', SF.buildFrameSnapshot({ ledgerFrom: SF.LEDGER_FROM }).tapLedger === false && SF.buildFrameSnapshot({ nowMin: 20 * 60 }).tapLedger === false)
  t('A20b. 上课中即便已过 18:00 也回今日页（正上课不可能去结账）', mk(19 * 60, [eveningClass]).tapLedger === false)
  t('A20b2. 白天上课中同样回今日页（14:30 在上 14:00–15:40）', mk(14 * 60 + 30, [classItem]).tapLedger === false)
  t('A20c. 课后（20:00）→ 开日精进', mk(20 * 60).tapLedger === true)
  t('A20d. 快照里不再有 canLedger（「结账」按钮已砍，那个门随之删除）', !('canLedger' in mk(20 * 60)))
  const withT = SF.buildFrameSnapshot({
    today: [{ kind: 'c', id: 'c9', name: '结构力学', place: '4-317', teacher: '沈国辉', start: '14:00', end: '15:40' }],
  })
  t('A21. 今天的条目带上老师（通知正文「地点 · 老师 · 节次时间」要用）', withT.today[0].teacher === '沈国辉', JSON.stringify(withT.today[0]))
  const noT = SF.buildFrameSnapshot({ today: [{ kind: 'c', id: 'c9', name: '结构力学', start: '14:00', end: '15:40' }] })
  t('A22. 没写老师时给空串（原生拼正文时跳过，不会出现「· ·」）', noT.today[0].teacher === '')
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
  window.__frame = { pushes: [], enabled: [], running: false, queue: [], listeners: [], cbs: {} }
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      /* 录音桥：真机验过的坑要在这里守住 —— 按了通知栏「开始录音」必须真的开录（而不是只跳回今日页） */
      VoiceRecorder: {
        canDeviceVoiceRecord: async () => ({ value: true }),
        hasAudioRecordingPermission: async () => ({ value: true }),
        requestAudioRecordingPermission: async () => ({ value: true }),
        startRecording: async () => {
          window.__frame.recStarted = (window.__frame.recStarted || 0) + 1
          return { value: true }
        },
        stopRecording: async () => ({ value: { path: 'lectures/rec_frame.aac', mimeType: 'audio/aac', msDuration: 60000 } }),
      },
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
          window.__frame.cbs[ev] = cb
          return { remove: async () => {} }
        },
      },
    },
  }
  /* 模拟原生侧 notifyListeners('frameActions', {actions:[...]})：需要 cb 才做得到 */
  window.__frame.fire = (payload) => {
    const cb = window.__frame.cbs.frameActions
    if (cb) cb({ actions: [payload] })
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

/* B13–B17：动作领回来落地。P5 按钮收窄后只剩两类（startRec / openLedger），
   顺手把「已砍掉的 classDone 动作必须被无声忽略」钉住 —— 删除要删干净，不能留半截。 */
await page.evaluate(() => {
  window.__frame.queue.push({ type: 'startRec' })
  window.__frame.queue.push({ type: 'classDone', id: 'c_legacy' }) // 已砍的按钮：应被忽略
})
const pushesBefore = await page.evaluate(() => window.__frame.pushes.length)
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
await page.waitForTimeout(700)
const marks = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.frame.marks') || 'null'))
t('B13. 领到「开始录音」真的开了录（不是只跳回今日页）', (await page.evaluate(() => window.__frame.recStarted)) === 1, String(await page.evaluate(() => window.__frame.recStarted)))
t('B14. 已砍的「上完了」动作被无声忽略（不写 classDone 记号）', !(marks && Array.isArray(marks.classDone) && marks.classDone.includes('c_legacy')), JSON.stringify(marks))
t('B15. 动作取走即清（再回到前台不会重复触发）', (await page.evaluate(() => window.__frame.queue.length)) === 0)
const pushesAfter = await page.evaluate(() => window.__frame.pushes.length)
t('B16. 领完动作会补推一次快照', pushesAfter > pushesBefore, pushesBefore + ' → ' + pushesAfter)
t('B17. 落地后有回执文案', (await page.locator('[data-frame-toast]').innerText().catch(() => '')).includes('录音'), await page.locator('[data-frame-toast]').innerText().catch(() => '(无)'))
/* 这一轮把录音开起来了，后面 B21 要改设置，先按 UI 停掉，
   再整页重载回到干净起点（录音态留着会干扰后面的点击），并重新走回设置二级页。 */
await page.locator('[data-rec-banner]').click().catch(() => {})
await page.waitForTimeout(500)
await page.locator('[data-sub-page][data-sub="lectures"] button:has-text("停止并保存")').first().click().catch(() => {})
await page.waitForTimeout(600)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.locator('nav button', { hasText: '我的' }).click()
await page.waitForTimeout(400)
await page.locator('[data-settings-toggle]').click()
await page.waitForTimeout(400)

/* B21–B22：改勿扰时段必须当场重推快照（v1.41.9 真机反馈：watch 列表里缺 listenSettings，
   改完要等下一次数据变动或重启 App 才生效 —— 用户看到的就是「改了等于没改」，
   和 v1.41.3 修掉的那句话是同一个现象、不同的层）。
   顺带把清单 #5 的口径钉在单元层：起点设 00:00 必须真按 0 点算（不当成「没设」、不回落 23:00）。 */
const pushesBeforeDnd = await page.evaluate(() => window.__frame.pushes.length)
/* Stage 6：练耳卡片搬进「我的 → 碎片练耳」二级页 → 先返回索引再推入 listen */
await page.locator('[data-sub-back]').click()
await page.waitForTimeout(300)
await page.$eval('[data-me-entry="listen"]', (el) => el.click())
await page.waitForTimeout(400)
await page.locator('button', { hasText: '打开' }).first().click() // 碎片练耳卡片
await page.waitForTimeout(300)
await page.locator('[data-listen-settings-toggle]').click()
await page.waitForTimeout(300)
await page.locator('[data-listen-dnd-start]').fill('00:00')
await page.waitForTimeout(700)
const pushesDnd = await page.evaluate(() => window.__frame.pushes.slice())
t('B21. 改勿扰时段当场重推快照', pushesDnd.length > pushesBeforeDnd, pushesBeforeDnd + ' → ' + pushesDnd.length)
let snapDnd = {}
try {
  snapDnd = JSON.parse(pushesDnd[pushesDnd.length - 1])
} catch {
  /* 解析失败 → 下面断言带原文变红 */
}
t('B22. 快照里 dndStart=0（00:00 没被当成「没设」、没回落 23:00）', snapDnd.dndStart === 0, pushesDnd[pushesDnd.length - 1])

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

/* ===== C. 真机验收反馈的回归（v1.41.1）=====
   用户 m08994 在真机上遇到两件事：
     ① 点通知栏「开始录音」只跳回今日页，看不到任何反馈（录音卡在今日页最底部，
        失败原因又只写进「我的」页里那行 frameMsg）；
     ② 点「我去听了」按钮消失了但 App 没反应 —— 下拉通知栏**不会**触发 visibilitychange，
        网页一直没领走原生已经记下的动作。
   这一段就是守这两条：动作到达必须有可见回执、没有事件也必须能领走。 */

/* C1–C4：按「开始录音」（App 在跑 → 走 frameActions 监听那条） */
await page.evaluate(() => window.__frame.fire({ type: 'startRec' }))
await page.waitForTimeout(600)
t('C1. 按「开始录音」当场有可见回执（不再只是跳回今日页）', (await page.locator('[data-frame-toast]').count()) === 1, await page.locator('[data-frame-toast]').innerText().catch(() => '(无)'))
t('C2. 真的调了原生录音（不是只跳到今日页）', (await page.evaluate(() => window.__frame.recStarted)) === 1, String(await page.evaluate(() => window.__frame.recStarted)))
t('C3. 录音中页面顶部出现常驻「录音中」小条', (await page.locator('[data-rec-banner]').count()) === 1, await page.locator('[data-rec-banner]').innerText().catch(() => '(无)'))
await page.locator('[data-rec-banner]').click()
await page.waitForTimeout(500)
t('C4. 点小条跳到「我的」页的录音二级页（那里才**看得见**停止并保存）', (await page.evaluate(() => document.querySelectorAll('nav button')[2].textContent)).includes('我的') && (await page.locator('[data-sub-page][data-sub="lectures"]').count()) === 1 && (await page.locator('[data-sub-page][data-sub="lectures"] button:has-text("停止并保存")').first().isVisible()), await page.evaluate(() => document.querySelectorAll('nav button')[2].className))

/* C5–C6：已砍掉的两枚按钮（classDone / listenDone）—— 原生理论上不会再推，
   但旧版本 App 可能还留着；网页侧必须**无声忽略**，绝不能因此报错或写脏数据。 */
await page.evaluate(() => window.__frame.fire({ type: 'classDone', id: 'c_x' }))
await page.waitForTimeout(300)
t('C5. 已砍的「上完了」动作不写脏数据、不报错', (await page.evaluate(() => localStorage.getItem('web2.frame.marks'))) === null && errors.length === 0, String(await page.evaluate(() => localStorage.getItem('web2.frame.marks'))))
await page.evaluate(() => window.__frame.fire({ type: 'listenDone', id: 'lis_x' }))
await page.waitForTimeout(300)
t('C6. 已砍的「我去听了」动作同样不写脏数据、不报错', (await page.evaluate(() => localStorage.getItem('web2.frame.marks'))) === null && errors.length === 0, String(await page.evaluate(() => localStorage.getItem('web2.frame.marks'))))

/* C8：P5「甲」—— 晚上点通知本体（原生把 openLedger 记成待领动作）必须直接落到「日精进」浮层，
   省掉「进 App → 我的 → 日精进」两步。它不改数据，所以不落任何 mark。 */
await page.evaluate(() => {
  localStorage.removeItem('web2.frame.marks')
  window.__frame.fire({ type: 'openLedger' })
})
await page.waitForTimeout(600)
t('C8. 点通知本体（openLedger）直接开「日精进」浮层', (await page.locator('[data-sheet-review]').count()) === 1, await page.evaluate(() => document.body.innerText.slice(0, 80).replace(/\n/g, ' ')))
t('C9. openLedger 不改数据（不写任何记号）', (await page.evaluate(() => localStorage.getItem('web2.frame.marks'))) === null, String(await page.evaluate(() => localStorage.getItem('web2.frame.marks'))))
/* 关掉浮层（点遮罩），别影响 C7 的轮询断言 */
await page.locator('[data-sheet-mask]').last().click({ force: true }).catch(() => {})
await page.waitForTimeout(400)

/* C7：真机第二个 bug 的回归 —— 一个事件都不派，光靠前台兜底轮询也得领走。
   （用 openLedger 当「已被砍掉的旧动作类型」的替身没意义，就查「队列真的被取空了」——
   取走即清是消费的唯一证明，跟动作类型无关。） */
await page.evaluate(() => { window.__frame.queue.push({ type: 'openLedger' }) })
await page.waitForTimeout(7500)
t('C7. 派发任何事件也能领走原生动作（下拉通知栏不触发 visibilitychange）', (await page.evaluate(() => window.__frame.queue.length)) === 0, 'queue=' + (await page.evaluate(() => window.__frame.queue.length)))
t('C7b. 领走的 openLedger 真的开了「日精进」', (await page.locator('[data-sheet-review]').count()) === 1)

t('B20. 全程无报错', errors.length === 0, errors.join(' | '))

await browser.close()
console.log('')
console.log('结果：' + pass + ' 过 / ' + fail + ' 挂')
process.exit(fail ? 1 : 0)
