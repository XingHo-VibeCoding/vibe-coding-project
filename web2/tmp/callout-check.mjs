/* 六期第二步：可回嘴 + 找模式的验收（2026-10-06）
   跑法：cd web2; $env:PORT='4177'; node serve.js  然后  node tmp/callout-check.mjs
   前置：改完 src 必须 npx vite build（测试走 dist）。

   覆盖四块：
     A 段 纯规则（reasons.js 直接 import）：30 天过期、第 3 次降级、证据不足不命名
     B 段 界面：账难看才追问 / 已有旧理由优先甩回来 / 降级与静音 / 写了才存
     C 段 找模式：只陈述不给结论、够 3 次才允许命名、一个月最多提一次
     D 段 边界：今天全做完就不问、坏数据不白屏、全程无 pageerror

   写这个脚本踩到的四个坑（后来者直接抄结论，别再试一遍）：
     1. 必须 localStorage.setItem('web2.onboarded','1') 跳过开屏引导层
        （[data-ob-step="0"] 是 fixed inset-0 z-40，不跳过则所有点击被遮罩接管）。
     2. 待办键是 web2.todos（形状 {added,edited,deleted}），不是 web2.main。
     3. addInitScript 每次 reload 都会重跑 → 想在 reload 后保留「攒到第 N 次」这种
        状态，要么把种子写成目标状态，要么加 sessionStorage 门闩只种一次。
     4. 想顶掉内置示例数据必须给 web2.data 写**主项目导出文档**
        （app:'sched' + semester.first_monday/total_weeks），
        写成 {semester:{name},schedules:[]} 会解析失败回落 buildMock()。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = `http://127.0.0.1:${process.env.PORT || 4177}/`
const OUT = 'tmp'
const RKEY = 'web2.reasons'
const DKEY = 'web2.daily'

let pass = 0
let fail = 0
const t = (name, ok, extra = '') => {
  if (ok) {
    pass++
    console.log(`  ok  ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${extra ? ' | ' + extra : ''}`)
  }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errs.push('console: ' + m.text())
})

/* ---------- A 段：纯规则（不起页面，直接测模块） ---------- */
console.log('\nA 段：规则（reasons.js 直接调用）')
const R = await import('../src/data/reasons.js')

const DAY = 86400000
const now0 = Date.parse('2026-10-06T21:00:00')
/* 真实今天（?t= 只冻钟点、冻不了日期 —— 页面里的「今天」永远是真实今天）。
   待办种子必须用今天到期，否则今日页不会把它算进「今天要交」。 */
const todayKey = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()
const dayKey = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* A1 空库不甩嘴 */
t('A1. 空记忆里挑不出可回嘴的东西', R.pickCallout(R.emptyBook(), { today: dayKey(now0) }) === null)

/* A2 记下一个理由 */
let book = R.emptyBook()
const up1 = R.upsertReason(book, { text: '太累了', date: '2026-10-05', now: now0 - DAY })
book = up1.book
t('A2. 记下一条理由（count 从 0 起，不是「说过 1 次」）', up1.changed && up1.item.count === 0 && up1.item.asked_dates.length === 1, JSON.stringify(up1.item))

/* A3 幂等：同一天再说一次同一个理由，不写盘 */
const up2 = R.upsertReason(book, { text: '太累了', date: '2026-10-05', now: now0 })
t('A3. 同一天重复记同一条 → changed=false（幂等）', up2.changed === false)
/* A4 换一天说同一条 → 记进 asked_dates，但还没被甩过，所以 count 仍是 0 */
const up3 = R.upsertReason(book, { text: '太累了', date: '2026-10-04', now: now0 - 2 * DAY })
book = up3.book
t('A4. 换一天又说一次 → 记进 asked_dates 且 changed=true', up3.changed && up3.item.asked_dates.length === 2, JSON.stringify(up3.item.asked_dates))

/* A5 说过不止一次 → 可被甩回去 */
const pick = R.pickCallout(book, { today: dayKey(now0) })
t('A5. 说过两次的理由能被挑出来甩回去', !!pick && pick.text === '太累了')

/* A6 只说过一次的不甩（重复的借口才是借口） */
let b1 = R.upsertReason(R.emptyBook(), { text: '临时有事', date: '2026-10-05', now: now0 - DAY }).book
t('A6. 只说过一次 → 不甩回去（不当第一次就回嘴的人）', R.pickCallout(b1, { today: dayKey(now0) }) === null)

/* A7 30 天过期：§2.2「三个月前的借口甩出来不是厉害，是刻薄」 */
let bOld = R.upsertReason(R.emptyBook(), { text: '那阵子在忙别的', date: '2026-08-20', now: now0 - 47 * DAY }).book
bOld = R.upsertReason(bOld, { text: '那阵子在忙别的', date: '2026-08-21', now: now0 - 46 * DAY }).book
t('A7. 超过 30 天的理由不再引用', R.pickCallout(bOld, { today: dayKey(now0) }) === null)
/* A7b 但 29 天内的还算数（边界不能一刀切错） */
let b29 = R.upsertReason(R.emptyBook(), { text: '刚考完试', date: '2026-09-07', now: now0 - 29 * DAY }).book
b29 = R.upsertReason(b29, { text: '刚考完试', date: '2026-09-08', now: now0 - 28 * DAY }).book
t('A7b. 29 天内的理由仍算数（边界另一侧）', !!R.pickCallout(b29, { today: dayKey(now0) }))

/* A8 降级：提第 1、2 次照提，第 3 次它自己先软（§2.2） */
const t1 = R.markSaid(book, '太累了', { now: now0 })
const t2 = R.markSaid(t1.book, '太累了', { now: now0 })
const t3 = R.markSaid(t2.book, '太累了', { now: now0 })
t('A8. 第 3 次提起时它自己先软下来（giveUp=true）', t1.giveUp === false && t2.giveUp === false && t3.giveUp === true, `c=${t1.item.count}/${t2.item.count}/${t3.item.count}`)
t('A8b. 软下来之后不再甩这条', R.pickCallout(t3.book, { today: dayKey(now0) }) === null)

/* A9 手动静音：不用等三次 */
const m = R.muteReason(book, '太累了')
t('A9.「以后别提了」立刻闭嘴', m.changed && R.pickCallout(m.book, { today: dayKey(now0) }) === null)

/* A10 找模式：证据不足只算事实，不许命名 */
const fewDays = [
  { date: '2026-09-30', planned: 3, done: 0 }, // 周三
  { date: '2026-10-01', planned: 2, done: 2 }, // 周四
]
const gFew = R.weekdayGaps(fewDays)
const wedFew = gFew.find((g) => g.weekday === 3)
t('A10. 只断过 1 次 → enough=false（够格才允许命名）', !!wedFew && wedFew.missed === 1 && wedFew.enough === false, JSON.stringify(wedFew))

/* A11 够 3 次才够格 */
const manyDays = [
  { date: '2026-09-16', planned: 3, done: 0 }, // 周三
  { date: '2026-09-23', planned: 2, done: 0 }, // 周三
  { date: '2026-09-30', planned: 4, done: 0 }, // 周三
  { date: '2026-09-17', planned: 2, done: 2 }, // 周四（对照）
]
const gMany = R.weekdayGaps(manyDays)
const wedMany = gMany.find((g) => g.weekday === 3)
t('A11. 断满 3 个周三 → enough=true 且按次数排序在前面', !!wedMany && wedMany.missed === 3 && wedMany.enough === true && gMany[0].weekday === 3, JSON.stringify(wedMany))

/* A12 没排事的日子不算「断」（没排事谈不上断） */
const idle = R.weekdayGaps([{ date: '2026-09-30', planned: 0, done: 0 }])
t('A12. 那天没排事 → 不进统计', idle.length === 0)

/* A13 陈述句里不下判断（不带「你」这种指责口吻，也不出现打分词） */
const line = R.gapLine(wedMany)
t('A13. 陈述句是事实口径（周三断了 3 次），不含评判词', /周三断了 3 次/.test(line) && !/懒|失败|效率|分/.test(line), line)

/* A14 一个月最多主动提一次 */
let pb = R.emptyBook()
t('A14. 没提过 → 可以提', R.canTellPattern(pb, 'weekday-gap-3', { today: dayKey(now0) }) === true)
pb = R.markPatternTold(pb, 'weekday-gap-3', { key: '3', count: 3, now: now0 }).book
t('A14b. 提过一次后 → 冷却期内不再提', R.canTellPattern(pb, 'weekday-gap-3', { today: dayKey(now0 + 5 * DAY) }) === false)
t('A14c. 过了 30 天冷却 → 也仍然受上限约束（上限 1 次）',
  R.canTellPattern(pb, 'weekday-gap-3', { today: dayKey(now0 + 40 * DAY) }) === false)

/* A15 存下来的书能过一遍净化（脏数据不炸） */
const dirty = R.sanitizeBook({ items: [null, { text: '' }, { text: 'ok', count: 'x' }], patterns: 'nope' })
t('A15. 脏数据净化：空条目丢掉、坏字段回默认', dirty.items.length === 1 && dirty.items[0].count === 0 && dirty.patterns.length === 0, JSON.stringify(dirty))

/* ---------- B/C/D 段：界面 ---------- */
/* 今天 2 件待办只做 0 件 → 账难看；再塞一条昨天说过的理由进去 */
const seedDaily = {
  version: 1,
  days: {
    '2026-09-16': { date: '2026-09-16', stats: { todosTotal: 3, todosDone: 0, courses: 2 }, updated_at: now0 - 20 * DAY },
    '2026-09-23': { date: '2026-09-23', stats: { todosTotal: 2, todosDone: 0, courses: 2 }, updated_at: now0 - 13 * DAY },
    '2026-09-30': { date: '2026-09-30', stats: { todosTotal: 4, todosDone: 0, courses: 2 }, updated_at: now0 - 6 * DAY },
    '2026-10-05': { date: '2026-10-05', stats: { todosTotal: 3, todosDone: 0, courses: 1 }, updated_at: now0 - DAY },
  },
}
const seedReasons = {
  version: 1,
  items: [
    { text: '太累了', norm: '太累了', reason: '', count: 0, first_at: now0 - 2 * DAY, last_at: now0 - DAY, last_said_at: 0, asked_dates: ['2026-10-04', '2026-10-05'], muted: false },
  ],
  patterns: [],
}
/* 待办种子必须落 web2.todos（store.js 的待办通道），不是 web2.main：
   web2.main 是另一条通道，写成它待办列表仍是空的（B 段 ask=0 就是这么来的）。
   形状照 day12b-filter-check.mjs:76 的既有写法 = { added, edited, deleted }，
   added 里放今天到期、未完成的条目（账不好看才该追问）。 */
const seedTodos = {
  added: [
    { id: 't1', title: '把结构力学作业做掉', done: false, due_date: todayKey, created_at: now0 - DAY },
    { id: 't2', title: '交实验报告', done: false, due_date: todayKey, created_at: now0 - DAY },
  ],
  edited: {},
  deleted: [],
}

await page.addInitScript(
  ([rk, dk, reasons, daily, todos]) => {
    localStorage.setItem('web2.reasons', JSON.stringify(reasons))
    localStorage.setItem('web2.daily', JSON.stringify(daily))
    localStorage.setItem('web2.todos', JSON.stringify(todos))
    /* 跳过开屏引导层：它是 fixed inset-0 z-40，挡着下面所有点击
       （别的脚本里也这么干，属于测试前置，不是产品行为） */
    localStorage.setItem('web2.onboarded', '1')
  },
  [RKEY, DKEY, seedReasons, seedDaily, seedTodos],
)

console.log('\nB 段：界面（账难看才追问 / 甩回来 / 降级）')
/* 冻到 21:30：heroMode 变 'review' 需要 nowTime >= REVIEW_FROM(18:00) 且课都上完
   （App.vue:3165-3174），今日页那颗「今天收个尾」的入口才会出现。
   ?t= 只吃钟点、冻不了日期 —— 所以日期全靠种子里的 todayKey。 */
await page.goto(BASE + '?t=21:30', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)

/* 打开日精进：优先点今日页的复盘入口；那天若是空档/正在上课就没有这颗钮，
   退回「我的 → 设置 → 日精进历史」那条路（history 分支下账卡不显示，B 段会如实报红）。 */
const openReview = async () => {
  const btn = page.locator('[data-review-start]').first()
  if (await btn.count()) {
    await btn.click()
  } else {
    await page.$eval('[data-nav="me"]', (el) => el.click())
    await page.waitForTimeout(400)
    await page.locator('[data-me-entry="settings"]').click()
    await page.waitForTimeout(400)
    await page.locator('[data-review-history]').click()
  }
  await page.waitForTimeout(700)
}
await openReview()

const hasAsk = await page.locator('[data-reason-ask]').count()
const hasCallout = await page.locator('[data-reason-callout]').count()
t('B1. 账难看时（还有 2 件没动）出现追问入口', hasAsk === 1 || hasCallout === 1, `ask=${hasAsk} callout=${hasCallout}`)
t('B2. 已有旧理由 → 优先把它甩回来，而不是再问一遍', hasCallout === 1, `callout=${hasCallout}`)
const saidTxt = await page.locator('[data-reason-said]').textContent().catch(() => '')
t('B3. 屏幕上出现你说过的那句话', /太累了/.test(saidTxt || ''), saidTxt)

/* 点「算它成立」→ 提一次；刷新后 count 应 +1 */
await page.locator('[data-reason-accept]').click()
await page.waitForTimeout(500)
const afterSaid = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), RKEY)
const item1 = (afterSaid.items || []).find((x) => x.norm === '太累了')
t('B4. 认了这条 → 记一次「甩回去了」(count 1)', !!item1 && item1.count === 1, JSON.stringify(item1))

/* 连提两次到第 3 次 → 它自己先软。
   注意：addInitScript 会在每次 reload 时把 web2.reasons 重新种回 count 0，
   所以不能靠「reload 两遍」来攒次数（那样永远停在 1）；改成把种子里这条的
   count 直接设成 2，再点一次就是第 3 次。 */
const seedSaid = (n) => page.addInitScript(([r]) => {
  localStorage.setItem('web2.reasons', JSON.stringify(r))
}, [{
  version: 1,
  items: [{
    text: '太累了', norm: '太累了', reason: '', count: n,
    first_at: Date.now() - 2 * DAY, last_at: Date.now() - DAY,
    last_said_at: 0, asked_dates: ['2026-10-04', '2026-10-05'], muted: false,
  }],
  patterns: [],
}])
await seedSaid(2)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await openReview()
{
  const c = page.locator('[data-reason-accept]')
  if (await c.count()) {
    await c.click()
    await page.waitForTimeout(400)
  }
}
const after3 = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), RKEY)
const item3 = (after3.items || []).find((x) => x.norm === '太累了')
t('B5. 提到第 3 次 → muted 落盘（降级不是嘴上说说）', !!item3 && item3.count >= 3 && item3.muted === true, JSON.stringify(item3))

/* 降级后不该再甩这条。
   同样受 addInitScript 重种影响：reload 会把上面那条 count 2 又写回去，
   所以要显式种一条「已经软下来」的记录（count 3 + muted）再验证界面。 */
await page.addInitScript(() => {
  localStorage.setItem('web2.reasons', JSON.stringify({
    version: 1,
    items: [{
      text: '太累了', norm: '太累了', reason: '', count: 3,
      first_at: Date.now() - 2 * 86400000, last_at: Date.now() - 86400000,
      last_said_at: Date.now(), asked_dates: ['2026-10-04', '2026-10-05'], muted: true,
    }],
    patterns: [],
  }))
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await openReview()
t('B6. 软下来之后不再出现回嘴', (await page.locator('[data-reason-callout]').count()) === 0)
t('B7. 但追问入口还在（不是把整块藏了）', (await page.locator('[data-reason-ask]').count()) === 1)

/* 快捷理由 → 落盘 */
await page.locator('[data-reason-quick="tired"]').click()
await page.waitForTimeout(500)
const afterQuick = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), RKEY)
t('B8. 快捷理由「太累了」落盘', (afterQuick.items || []).some((x) => x.text === '太累了'))

/* 手写一句 → 落盘 + 记下「今天问过了」。
   注意：点完快捷理由后 noteReason() 会把「今天问过了」置真，追问块按设计整块收起
   （同一句不该问两遍），所以这里要重新开一次浮层并清掉今天的 reason_asked 才能看到输入框。 */
await page.addInitScript(() => {
  const raw = localStorage.getItem('web2.daily')
  if (raw) {
    const b = JSON.parse(raw)
    Object.keys(b.days || {}).forEach((k) => { b.days[k].reason_asked = false })
    localStorage.setItem('web2.daily', JSON.stringify(b))
  }
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await openReview()
if (!(await page.locator('[data-reason-ask]').count())) {
  t('B9a. 清掉「今天问过了」后追问入口回来', false, 'ask 块没出现')
} else {
  t('B9a. 清掉「今天问过了」后追问入口回来', true)
}
await page.locator('[data-reason-input]').fill('那节课临时调到别的时间了')
await page.locator('[data-reason-save]').click()
await page.waitForTimeout(500)
const afterWrite = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), RKEY)
const wrote = (afterWrite.items || []).find((x) => x.text === '那节课临时调到别的时间了')
t('B9. 自己写的一句也存下来', !!wrote)
const dailyAfter = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), DKEY)
const todayKey2 = Object.keys(dailyAfter.days || {}).sort().pop()
t('B10. 记下「今天问过了」，免得同一天再问一遍', dailyAfter.days[todayKey2] && dailyAfter.days[todayKey2].reason_asked === true, JSON.stringify(dailyAfter.days[todayKey2]))

/* 静默快照不能把「问过了」抹掉 */
await page.waitForTimeout(66000)
const dailyLater = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), DKEY)
t('B11. 一分钟后静默快照不会抹掉「问过了」', dailyLater.days[todayKey2] && dailyLater.days[todayKey2].reason_asked === true)

/* ---------- C 段：找模式 ---------- */
console.log('\nC 段：找模式（同一张脸的第二件事）')
t('C1. 断满 3 次的星期几会被摆出来（只陈述）',
  (await page.locator('[data-pattern-line]').count()) === 1,
  await page.locator('[data-pattern-line]').textContent().catch(() => '(无)'))
const pline = await page.locator('[data-pattern-line]').textContent().catch(() => '')
t('C2. 陈述的是事实（几个星期几断了几次），不是结论', /断了 \d+ 次/.test(pline || ''), pline)
t('C3. 陈述里不出现「你……认输/懒/失败」这类判断', !/认输|懒|失败|不自律/.test(pline || ''), pline)
await page.locator('[data-pattern-ok]').click().catch(() => {})
await page.waitForTimeout(500)
const pbAfter = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), RKEY)
t('C4. 点过「知道了」→ 落盘（一个月最多一次）', (pbAfter.patterns || []).some((p) => p.told_count >= 1), JSON.stringify(pbAfter.patterns))
/* 说过的模式不再重复摆出来。
   同样受 addInitScript 重种影响：reload 会把 patterns 清回空，所以要显式种一条
   「今天已经告诉过它」的 pattern（told_count 1 + last_told_at 现在），再验证界面。 */
await page.addInitScript(() => {
  const raw = localStorage.getItem('web2.reasons')
  const b = raw ? JSON.parse(raw) : { version: 1, items: [], patterns: [] }
  b.patterns = [{ id: 'weekday-gap-3', key: '3', count: 3, last_at: Date.now(), told_count: 1, last_told_at: Date.now() }]
  localStorage.setItem('web2.reasons', JSON.stringify(b))
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await openReview()
t('C5. 说过的模式不再重复摆出来', (await page.locator('[data-pattern-note]').count()) === 0)

/* ---------- D 段：边界 ---------- */
console.log('\nD 段：边界与不炸')
/* 待办全做完 → 不该再追问/回嘴（做完了还回嘴就是刻薄） */
/* 全做完 → 不该再追问/回嘴。
   造「今天全做完」要两件事一起做：
   ① 用 web2.data 顶掉内置 mock 数据集（只写 web2.todos 时 mock 还在，账里照旧 6 条，
      这就是前面几轮反复假红的原因）；
   ② 种进 web2.todos 的两条直接写成 done:true。
   不要再靠「点掉待办」去凑：那要先把上一段留着的复盘浮层关掉，浮层盖住今日页时
   点勾选钮会被遮罩接管，怎么点都不生效。 */
await page.addInitScript(() => {
  if (sessionStorage.getItem('d1seeded')) return
  sessionStorage.setItem('d1seeded', '1')
  localStorage.removeItem('web2.reasons')
  const d = new Date()
  const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  /* 注意：web2.data 存的必须是**主项目导出文档**（loadDataset → buildFromExport 要求
     app:'sched' + semester.first_monday/total_weeks，见 store.js:212-217）。
     写成 {semester:{name},schedules:[]} 会让 buildFromExport 抛错 → 回落 buildMock()，
     于是内置示例数据照样在，账里永远是 6 条 —— 前面几轮 D1 假红就是这个原因。 */
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const fm = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
  localStorage.setItem('web2.data', JSON.stringify({
    app: 'sched',
    semester: { id: 'sem-test', name: '测试学期 2026', first_monday: fm, total_weeks: 16 },
    schedules: [],
  }))
  localStorage.setItem('web2.todos', JSON.stringify({
    added: [
      { id: 'd1a', title: '一件事', done: true, due_date: k, created_at: Date.now() },
      { id: 'd1b', title: '两件事', done: true, due_date: k, created_at: Date.now() },
    ],
    edited: {},
    deleted: [],
  }))
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
/* 先关掉可能开着的浮层（上一段留着的），再在今日页把未完成待办逐条勾掉。
   勾选钮没有专用锚点，用 aria-label（App 会写「标记为完成」/「标记为未完成」）。 */
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(300)
for (let round = 0; round < 3; round++) {
  const todo = page.locator('[data-page="today"] button[aria-label="标记为完成"]')
  const n = await todo.count()
  if (!n) break
  for (let i = 0; i < n; i++) {
    await todo.nth(i).click({ force: true }).catch(() => {})
    await page.waitForTimeout(200)
  }
}
await page.waitForTimeout(500)
await openReview()
t('D1. 今天全做完了 → 既不追问也不回嘴',
  (await page.locator('[data-reason-ask]').count()) === 0 && (await page.locator('[data-reason-callout]').count()) === 0,
  `rest=${await page.locator('[data-account-lead]').textContent().catch(() => '(无账卡)')}`)

/* 坏数据不能让页面白掉 */
await page.evaluate((k) => localStorage.setItem(k, '{ not json'), RKEY)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
const stillAlive = await page.locator('[data-page="today"]').count()
t('D2. 记忆文件坏掉 → 页面照常起来（不白屏）', stillAlive >= 1)

t('D3. 全程无 pageerror / console.error', errs.length === 0, errs.slice(0, 3).join(' | '))

await page.screenshot({ path: `${OUT}/callout-final.png` })
await browser.close()

console.log(`\n可回嘴 + 找模式检查：${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
