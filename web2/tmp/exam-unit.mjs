/* 考试周模式（五条路线 04）纯函数单测。
   只测数据层：清洗 / 倒计时 / 接下来的考试 / 复习排块 / 提醒文案。
   UI 那一层在 tmp/exam-ui-check.mjs。

   基准日：2026-10-16（周五），与 planner-unit / homework-unit 同一套。 */
import {
  sanitizeExam, sanitizeExamList, newExam, daysLeftOf, countdownText,
  upcomingExams, examTimeText, examMetaText, examPlaceText, EXAM_SYNC_PREFIX, sanitizeExamSettings,
  reviewPlanFor, reviewDaysFor, planExams, examPlanLine, examNotices, examTitleFrom,
  EXAM_DEFAULTS, REVIEW_BLOCK_MIN, REVIEW_EVENING_FROM,
} from '../src/data/exams.js'

let pass = 0
let fail = 0
const fails = []
function t(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS ' + name) }
  else { fail += 1; fails.push(name); console.log('FAIL ' + name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra))) }
}
function ok(name, cond, extra) { t(name, !!cond, extra) }
function eq(name, got, want) { t(name, JSON.stringify(got) === JSON.stringify(want), { got, want }) }

const DAY = '2026-10-16'
const at = (h, m = 0) => new Date(2026, 9, 16, h, m)
const exam = (id, title, date, start = '', end = '', place = '') => ({ id, title, date, start, end, place })

/* ---------- A 清洗：认不出的条目一律丢掉 ---------- */
eq('A1 正常一条原样留下来', sanitizeExam(exam('e1', '高等数学', '2026-10-20', '09:00', '11:00', '东1-101')), {
  id: 'e1', title: '高等数学', date: '2026-10-20', start: '09:00', end: '11:00', place: '东1-101', note: '', created_at: 0,
})
ok('A2 没标题 → null（宁可丢条目也不留假考试）', sanitizeExam({ date: '2026-10-20', title: '   ' }) === null)
ok('A3 没日期 → null', sanitizeExam({ title: '高数' }) === null)
ok('A4 日期格式对但日子不存在（2 月 30 日）→ null', sanitizeExam({ title: '高数', date: '2026-02-30' }) === null)
ok('A5 日期写反（2026-13-01）→ null', sanitizeExam({ title: '高数', date: '2026-13-01' }) === null)
ok('A6 时间非法只丢时间，不丢整条', (() => {
  const e = sanitizeExam({ id: 'x', title: '高数', date: '2026-10-20', start: '25:00' })
  return e && e.start === '' && e.title === '高数'
})())
ok('A7 结束早于开始 = 没填（考试不跨零点）', (() => {
  const e = sanitizeExam({ id: 'x', title: '高数', date: '2026-10-20', start: '11:00', end: '09:00' })
  return e && e.start === '11:00' && e.end === ''
})())
ok('A8 重复 id 只留一条', sanitizeExamList([exam('dup', 'A', '2026-10-20'), exam('dup', 'B', '2026-10-21')]).length === 1)
eq('A9 列表按日期 + 时刻排序', sanitizeExamList([
  exam('c', 'C', '2026-10-22'), exam('a', 'A', '2026-10-20', '14:00'), exam('b', 'B', '2026-10-20', '09:00'),
]).map((e) => e.id), ['b', 'a', 'c'])
ok('A10 没填时间的排在当天最后', (() => {
  const l = sanitizeExamList([exam('n', 'N', '2026-10-20'), exam('m', 'M', '2026-10-20', '09:00')])
  return l[0].id === 'm' && l[1].id === 'n'
})())
ok('A11 newExam 造出的 id 不重复', (() => {
  const a = newExam({ title: '高数', date: '2026-10-20' }, 1000)
  const b = newExam({ title: '高数', date: '2026-10-20' }, 1000)
  return a && b && a.id !== b.id
})())
ok('A12 非数组 / null 一律当空表，不抛', sanitizeExamList(null).length === 0 && sanitizeExamList(undefined).length === 0 && sanitizeExamList('x').length === 0)

/* ---------- B 倒计时的话 ---------- */
eq('B1 今天 → 0', daysLeftOf(DAY, DAY), 0)
eq('B2 明天 → 1', daysLeftOf('2026-10-17', DAY), 1)
eq('B3 昨天 → -1', daysLeftOf('2026-10-15', DAY), -1)
eq('B4 跨月（10-16 → 11-02）→ 17 天', daysLeftOf('2026-11-02', DAY), 17)
ok('B5 非法日期 → null', daysLeftOf('2026-02-30', DAY) === null && daysLeftOf('', DAY) === null)
eq('B6 倒计时文案', [0, 1, 3, -1].map(countdownText), ['今天', '明天', '还有 3 天', '已考过'])
ok('B7 倒计时文案不含催促词', ['今天', '明天', '还有 3 天', '已考过'].every((s) => !['加油', '赶紧', '必须', '来不及', '怎么办'].some((w) => s.includes(w))))

/* ---------- C 接下来的考试 ---------- */
const LIST = [
  exam('e1', '高等数学', '2026-10-20', '09:00', '11:00', '东1-101'),
  exam('e2', '大学英语', '2026-10-22', '14:00'),
  exam('e3', '线性代数', '2026-11-10', '09:00'),
  exam('e0', '已经考过的', '2026-10-14'),
]
eq('C1 默认剔除已考过、远期考试照样列出来（只是不催）', upcomingExams(LIST, { today: DAY }).map((e) => e.id), ['e1', 'e2', 'e3'])
ok('C2 每条带 daysLeft 与人话', (() => {
  const l = upcomingExams(LIST, { today: DAY })
  return l[0].daysLeft === 4 && l[0].text === '还有 4 天' && l[0].soon === true
})())
ok('C3 超出提前窗口的标 soon:false（不排复习、不发提醒，但看得到）', (() => {
  const l = upcomingExams(LIST, { today: DAY })
  const e3 = l.find((x) => x.id === 'e3')
  return e3 && e3.soon === false && e3.text === '还有 25 天'
})())
ok('C4 includePast 能把考过的也拿回来', upcomingExams(LIST, { today: DAY, includePast: true }).some((e) => e.id === 'e0'))
ok('C5 空表 / null → []', upcomingExams(null, { today: DAY }).length === 0)
eq('C6 时间串：有起有止', examTimeText(exam('x', 'A', '2026-10-20', '09:00', '11:00')), '09:00–11:00')
eq('C7 时间串：只有开始', examTimeText(exam('x', 'A', '2026-10-20', '09:00')), '09:00')
eq('C8 时间串：都没填 → 空串', examTimeText(exam('x', 'A', '2026-10-20')), '')
eq('C9 一行摘要自动略过缺项', examMetaText(exam('x', 'A', '2026-10-20', '09:00', '11:00', '东1-101')), '09:00–11:00 · 东1-101')
eq('C10 一行摘要全空 → 空串', examMetaText(exam('x', 'A', '2026-10-20')), '')

/* ---------- D 提醒设置 ---------- */
eq('D1 设置缺项回落默认', sanitizeExamSettings(null), EXAM_DEFAULTS)
ok('D2 enabled 只认显式 false', sanitizeExamSettings({ enabled: false }).enabled === false && sanitizeExamSettings({}).enabled === true)
ok('D3 非法时刻回落默认', sanitizeExamSettings({ at: '25:00' }).at === EXAM_DEFAULTS.at)
ok('D4 leadDays 越界回落默认', sanitizeExamSettings({ leadDays: 999 }).leadDays === EXAM_DEFAULTS.leadDays && sanitizeExamSettings({ leadDays: -1 }).leadDays === EXAM_DEFAULTS.leadDays)
ok('D5 leadDays 合法值留下来', sanitizeExamSettings({ leadDays: 30 }).leadDays === 30)

/* ---------- E 复习排块 ---------- */
/* 有课的日：08:00–12:00 与 14:00–18:00，晚上 19:00 之后空着。
   全天空着的日：itemsOfDay 返回 []。 */
const busyItems = (dKey) => [
  { at: new Date(`${dKey}T08:00:00`), start: '08:00', end: '12:00', title: '上午课', mins: 240 },
  { at: new Date(`${dKey}T14:00:00`), start: '14:00', end: '18:00', title: '下午课', mins: 240 },
]
const freeAll = () => []
const durationOf = (it) => Number(it.mins) || 0

/* E1：正常情况 —— 首选晚上 */
const p1 = reviewPlanFor(exam('e1', '高等数学', '2026-10-20'), {
  today: DAY, days: 3, itemsOfDay: busyItems, nowMin: 0, durationOf,
})
ok('E1 排出了 3 天的复习块（10-16/17/18）', p1.length === 3, p1.map((b) => b.date))
ok('E2 每块都在晚上（≥19:00）', p1.every((b) => b.start >= REVIEW_EVENING_FROM), p1.map((b) => b.time))
ok('E3 每块整 ' + REVIEW_BLOCK_MIN + ' 分钟', p1.every((b) => b.end - b.start === REVIEW_BLOCK_MIN), p1.map((b) => b.time))
ok('E4 每块不与课重叠（19:00–19:30）', p1.every((b) => b.start >= 19 * 60 && b.end <= 23 * 60))
ok('E5 每块带考试信息（下游渲染用）', p1.every((b) => b.examId === 'e1' && b.examTitle === '高等数学'))
ok('E6 不带 nowMin 也能跑（回落 0）', reviewPlanFor(exam('e1', '高数', '2026-10-20'), { today: DAY, days: 1, itemsOfDay: busyItems, durationOf }).length === 1)
/* E7：晚上被占满 → 退回白天。
   ⚠ 这条用例 2026-10-23 修过：原来把 08:00–23:00 全占满，只剩 07:00–08:00（60 分钟），
   在「一块 30 分钟」的年代靠这 60 分钟侥幸通过，**根本没走到「退回白天」那条分支**；
   一块改成 90 分钟后立刻红 —— 不是回归，是旧断言一直在自欺。
   现在把 12:00–14:00 留空（120 分钟），晚上仍然 19:00 之后全占，才真正验证「晚上排不下退白天」。 */
const eveningFull = (dKey) => [
  { at: new Date(`${dKey}T08:00:00`), start: '08:00', end: '12:00', title: '上午课', mins: 240 },
  { at: new Date(`${dKey}T14:00:00`), start: '14:00', end: '23:00', title: '下午到晚上', mins: 540 },
]
const p2 = reviewPlanFor(exam('e1', '高数', '2026-10-20'), { today: DAY, days: 1, itemsOfDay: eveningFull, nowMin: 0, durationOf })
ok('E7 晚上排不下 → 退回白天（不等同于无解）', p2.length === 1, p2.map((b) => b.time))
ok('E8 退回白天时落在 12:00–14:00 空档里、整 ' + REVIEW_BLOCK_MIN + ' 分钟', (() => {
  const b = p2[0]
  return b && b.start >= 12 * 60 && b.end <= 14 * 60 && b.end - b.start === REVIEW_BLOCK_MIN
})(), p2.map((b) => b.time))
ok('E8b 退回白天时确实不在晚上（真走了兜底分支）', p2.every((b) => b.start < REVIEW_EVENING_FROM), p2.map((b) => b.time))
/* E9：今天已经过了晚上 20:00 之后 → 今天的块必须落在这之后 */
const p3 = reviewPlanFor(exam('e1', '高数', '2026-10-20'), {
  today: DAY, days: 1, itemsOfDay: busyItems, nowMin: 20 * 60, durationOf,
})
ok('E9 今天过了的点不排（nowMin 之后）', p3.length === 1 && p3[0].start >= 20 * 60, p3.map((b) => b.time))
/* E10：全天占满（07:00–23:00）→ 今天排不下，后面几天接着排 */
const allBusy = (dKey) => [{ at: new Date(`${dKey}T07:00:00`), start: '07:00', end: '23:00', title: '满课', mins: 960 }]
const p4 = reviewPlanFor(exam('e1', '高数', '2026-10-20'), { today: DAY, days: 4, itemsOfDay: allBusy, nowMin: 0, durationOf })
ok('E10 天天满课 → 一块都排不出来（不硬塞）', p4.length === 0, p4)
/* E11：考试当天及之后不排复习 */
const p5 = reviewPlanFor(exam('e1', '高数', '2026-10-17'), { today: DAY, days: 7, itemsOfDay: freeAll, nowMin: 0, durationOf })
ok('E11 复习只排到考前一天（考试当天不排）', p5.length === 1 && p5[0].date === DAY, p5.map((b) => b.date))
/* E12：今天的考试 → 没有复习块 */
ok('E12 今天就是考试日 → 排不出复习块', reviewPlanFor(exam('e1', '高数', DAY), { today: DAY, days: 3, itemsOfDay: freeAll, durationOf }).length === 0)
/* E13：一天最多一块（不会同一天塞两块） */
ok('E13 同一天最多一块', (() => {
  const dates = p1.map((b) => b.date)
  return new Set(dates).size === dates.length
})())
/* E14：容错 —— itemsOfDay 返回 null / 不是函数 */
ok('E14 itemsOfDay 返回 null 不抛（当没课处理）', reviewPlanFor(exam('e1', '高数', '2026-10-20'), { today: DAY, days: 1, itemsOfDay: () => null, durationOf }).length === 1)
ok('E15 itemsOfDay 不是函数 → 返回空数组（调用方没准备好就什么都别排）', reviewPlanFor(exam('e1', '高数', '2026-10-20'), { today: DAY, days: 1, itemsOfDay: null }).length === 0)
ok('E16 没考试（null）→ 空数组', reviewPlanFor(null, { today: DAY, days: 1, itemsOfDay: freeAll }).length === 0)
ok('E17 days=0 时抬到 1 天', reviewPlanFor(exam('e1', '高数', '2026-10-20'), { today: DAY, days: 0, itemsOfDay: freeAll, durationOf }).length === 1)

/* ---------- F planExams：把考试与复习拼在一起 ---------- */
const P = planExams({
  exams: [exam('e1', '高等数学', '2026-10-20'), exam('e2', '大学英语', '2026-10-22')],
  today: DAY, itemsOfDay: busyItems, nowMin: 0, durationOf, days: 2,
})
ok('F1 两场考试都在（都在窗口内）', P.exams.length === 2)
ok('F2 每场都带复习块', P.exams.every((e) => e.blocks.length === 2), P.exams.map((e) => e.blocks.length))
ok('F3 reviewMins = 块数 × ' + REVIEW_BLOCK_MIN + '（一天一整块后按分钟累加）', P.exams[0].reviewMins === P.exams[0].blocks.length * REVIEW_BLOCK_MIN)
/* 2026-10-23 改口径：todayBlocks 从「今天所有考试的块平铺」变成「今天那一段（0 或 1 条）」。
   两场考试同一天 → 仍然只有一段，两门都在这一段的 exams 里 —— 这正是「不重叠」的结构保证。 */
ok('F4 今天只有一段（多场考试共用，不再平铺成多块）', P.todayBlocks.length === 1, P.todayBlocks.map((b) => b.time))
ok('F4b 这一段里两场考试都在', (() => {
  const ids = P.todayBlocks[0].exams.map((x) => x.id).sort()
  return ids.length === 2 && ids[0] === 'e1' && ids[1] === 'e2'
})(), P.todayBlocks[0] && P.todayBlocks[0].exams.map((x) => x.id))
ok('F5 todayBlocks 带 examText 方便一行显示', P.todayBlocks.every((b) => typeof b.examText === 'string' && b.examText.length > 0))
ok('F6 nearest = 最近一场（不要求今天有块）', P.nearest && P.nearest.id === 'e1')
ok('F7 没有考试时 exams 为空、line 为空串', (() => {
  const q = planExams({ exams: [], today: DAY, itemsOfDay: freeAll })
  return q.exams.length === 0 && q.line === ''
})())
ok('F8 next 只在今天有块时才有', (() => {
  const q = planExams({ exams: [exam('e1', '高数', '2026-10-20')], today: DAY, itemsOfDay: allBusy, nowMin: 0, durationOf, days: 3 })
  return q.next === null && q.todayBlocks.length === 0
})())

/* ---------- G 那句人话：只陈述，不催 ---------- */
const banned = ['加油', '努力', '赶紧', '必须', '来不及', '怎么办', '懒', '拖延', '你应该', '你怎么', '还不']
const lineA = examPlanLine(planExams({ exams: [exam('e1', '高等数学', '2026-10-20')], today: DAY, itemsOfDay: busyItems, nowMin: 0, durationOf, days: 2 }))
ok('G1 有复习块 → 说出建议时刻', /今天建议复习 \d{2}:\d{2}–\d{2}:\d{2}/.test(lineA), lineA)
ok('G2 那句话以考试 + 倒计时开头', lineA.startsWith('高等数学 还有 4 天'), lineA)
const lineB = examPlanLine(planExams({ exams: [exam('e1', '高等数学', '2026-10-20')], today: DAY, itemsOfDay: allBusy, nowMin: 0, durationOf, days: 2 }))
ok('G3 今天排不下 → 明说没空档（不沉默也不硬塞）', lineB === '高等数学 还有 4 天，今天没空档了', lineB)
const lineC = examPlanLine(planExams({ exams: [exam('e1', '高等数学', DAY, '09:00', '11:00')], today: DAY, itemsOfDay: freeAll }))
ok('G4 今天就是考试 → 直接说今天几点考什么', lineC === '今天 09:00–11:00 高等数学', lineC)
ok('G5 三句话都不含催促 / 评判词', [lineA, lineB, lineC].every((s) => !banned.some((w) => s.includes(w))), [lineA, lineB, lineC])
ok('G6 没有考试 → 空串（界面据此不显示卡片）', examPlanLine(null) === '' && examPlanLine({ exams: [] }) === '')

/* ---------- H 每晚提醒 ---------- */
const H = examNotices({
  exams: [exam('e1', '高等数学', '2026-10-20', '09:00', '11:00', '东1-101')],
  plan: P,
  settings: { enabled: true, at: '20:00' },
  today: DAY,
  now: at(12, 0),
})
ok('H1 每晚一条（不含考试当天那条）', H.length === 1, H.map((n) => n.key))
ok('H2 时刻 = 今天 20:00', (() => {
  const d = H[0].at
  return d.getHours() === 20 && d.getMinutes() === 0 && d.getDate() === 16
})())
ok('H3 标题带考试名与倒计时', H[0].title === '高等数学 还有 4 天', H[0].title)
ok('H4 正文给今天的复习建议时刻', /今天建议复习 \d{2}:\d{2}/.test(H[0].body), H[0].body)
ok('H5 提醒文案不含催促词', !banned.some((w) => (H[0].title + H[0].body).includes(w)), H[0].title + ' / ' + H[0].body)
ok('H6 已经过了提醒时刻 → 不发（不补发）', examNotices({
  exams: [exam('e1', '高等数学', '2026-10-20')], today: DAY, settings: { at: '20:00' }, now: at(21, 0),
}).length === 0)
ok('H7 没有考试在窗口内 → 不发空提醒', examNotices({ exams: [exam('e1', '高数', '2027-01-01')], today: DAY, now: at(12, 0) }).length === 0)
ok('H8 考试当天多一条早上 07:30 的（带时间地点）', (() => {
  const l = examNotices({
    exams: [exam('e1', '高等数学', DAY, '09:00', '11:00', '东1-101')],
    today: DAY, settings: { at: '20:00' }, now: at(6, 0),
  })
  const day = l.find((n) => n.key.startsWith('exd_'))
  return day && day.at.getHours() === 7 && day.at.getMinutes() === 30 && day.body.includes('09:00') && day.body.includes('东1-101')
})())
ok('H9 同一天多场考试只发最近那一场（不刷屏）', (() => {
  const l = examNotices({
    exams: [exam('a', '甲', '2026-10-20'), exam('b', '乙', '2026-10-20')],
    today: DAY, settings: { at: '20:00' }, now: at(12, 0),
  })
  return l.filter((n) => n.key.startsWith('ex_')).length === 1
})())
ok('H10 设置里时刻写错 → 回落默认时刻照样发（不因为一个笔误就静默不发提醒）', (() => {
  const l = examNotices({ exams: [exam('e1', '高数', '2026-10-20')], today: DAY, settings: { at: '99:99' }, now: at(12, 0) })
  return l.length === 1 && l[0].at.getHours() === 20
})())
ok('H11 没有复习块时正文给的是「明天再说」而不是沉默或硬塞', (() => {
  const l = examNotices({
    exams: [exam('e1', '高等数学', '2026-10-20')],
    plan: planExams({ exams: [exam('e1', '高等数学', '2026-10-20')], today: DAY, itemsOfDay: allBusy, nowMin: 0, durationOf, days: 3 }),
    today: DAY, settings: { at: '20:00' }, now: at(12, 0),
  })
  return l.length === 1 && l[0].body === '今天没空档也没关系，明天再说'
})())

/* ---------- H12~H16 每晚合成一条（2026-10-23 用户 m00666「新口径合成一条」） ----------
   旧做法每场考试各发一条：三场考试 20:00 连响三次，正文还都是同一段时间。
   一天只剩一整块之后，提醒也必须是一天一条。 */
console.log('\n--- H 合成一条 ---')
const threeExams = [
  exam('x1', '结构力学Ⅰ', '2026-10-19', '10:30', '12:30', ''),
  exam('x2', '结构设计原理', '2026-10-20', '10:30', '12:30', ''),
  exam('x3', '工程水文学', '2026-10-22', '08:00', '10:00', ''),
]
const threePlan = planExams({ exams: threeExams, today: DAY, itemsOfDay: freeAll, nowMin: 0, durationOf, days: 7 })
const Hn = examNotices({
  exams: threeExams, plan: threePlan, today: DAY, settings: { at: '20:00' }, now: at(12, 0),
})
ok('H12 三场考试 → 每晚只发一条（不再连响三次）', Hn.length === 1, Hn.map((n) => n.key))
ok('H13 标题是最近那一场 + 倒计时', Hn[0] && Hn[0].title === '结构力学Ⅰ 还有 3 天', Hn[0] && Hn[0].title)
ok('H14 正文给今天那一段，并说清这段还有几场', (() => {
  const b = Hn[0] && Hn[0].body
  return /今天建议复习 \d{2}:\d{2}–\d{2}:\d{2}/.test(b) && b.includes('还有 2 场要准备')
})(), Hn[0] && Hn[0].body)
ok('H15 key 不带考试 id（同一天稳定，改考试不会重复推）', Hn[0] && Hn[0].key === 'ex_' + DAY, Hn[0] && Hn[0].key)
ok('H16 今天刚考完、之后没有别的考试 → 晚上那条不发（早上那条已经发过）', (() => {
  const l = examNotices({
    exams: [exam('only', '高数', DAY, '09:00', '11:00')],
    today: DAY, settings: { at: '20:00' }, now: at(12, 0),
  })
  return l.filter((n) => n.key.startsWith('ex_')).length === 0 && l.filter((n) => n.key.startsWith('exd_')).length === 0
})())
ok('H17 今天考完但后面还有一场 → 晚上那条指向后面那场（不指向今天这场）', (() => {
  const l = examNotices({
    exams: [exam('a', '高数', DAY, '09:00', '11:00'), exam('b', '大物', '2026-10-19')],
    today: DAY, settings: { at: '20:00' }, now: at(12, 0),
  })
  const night = l.find((n) => n.key.startsWith('ex_'))
  return night && night.title.startsWith('大物')
})())

/* ================= I 从纪要那句话里削出标题 ================= */
console.log('\n--- I 标题削词 ---')
ok('I1 「期末考试 11 月 20 日 09:30 东1-101」→ 只留科目名与教室', (() => {
  const s = examTitleFrom('期末考试 11 月 20 日 09:30 东1-101')
  return s === '期末考试 东1-101'
})())
ok('I2 带年份的写法也削得掉', examTitleFrom('2026 年 11 月 20 日 期末考试') === '期末考试')
ok('I3 时间段（09:30-11:30）整段削掉，不留半个', examTitleFrom('高数期末 09:30-11:30') === '高数期末')
ok('I4 削完剩不到 2 个字就退回原文（不能把科目名削没了）', (() => {
  const s = examTitleFrom('11 月 20 日')
  return s.length > 0 && s.indexOf('11 月 20 日') >= 0
})())
ok('I5 没有日期时原样保留', examTitleFrom('大学物理期末考试') === '大学物理期末考试')
ok('I6 中文冒号与全角写法也认', examTitleFrom('英语期末 09：30 教三-201') === '英语期末 教三-201')
ok('I7 超长标题截到 40 字', examTitleFrom('考'.repeat(80)).length === 40)
ok('I8 空值不炸', examTitleFrom(null) === '' && examTitleFrom(undefined) === '' && examTitleFrom('') === '')
ok('I9 前后残留的标点被削掉', examTitleFrom('· 期末考试 · 11 月 20 日') === '期末考试')

/* ---------- J 考场文案（06 同步进来的考试考场为空时，必须明说「待公布」） ----------
   依据 2026-10-23 真机：6 场未来考试的 jsmc/zwxh 全空（学校考前 2-3 周才排）。
   整项不显示会让用户以为我们漏拿了考场。 */
eq('J1 有考场就写考场', examPlaceText({ id: 'ks_a_final', place: '东1-101' }), '东1-101')
eq('J2 同步来的、考场空 → 考场待公布', examPlaceText({ id: 'ks_a_final', place: '' }), '考场待公布')
eq('J3 手填的、考场空 → 空串（不催）', examPlaceText({ id: 'ex_1', place: '' }), '')
ok('J4 空值不炸', examPlaceText(null) === '' && examPlaceText(undefined) === '' && examPlaceText({}) === '')
ok('J5 一行摘要里出现「考场待公布」', examMetaText({ id: 'ks_a_final', title: 'A', date: '2027-01-06', start: '14:00', end: '16:00', place: '' }) === '14:00–16:00 · 考场待公布')
ok('J6 前缀与 zdbkExam 的 EXAM_ID_PREFIX 是同一个值', await (async () => {
  const z = await import('../src/data/zdbkExam.js')
  return z.EXAM_ID_PREFIX === EXAM_SYNC_PREFIX
})())

/* ---------- K 复习时间不再重叠（2026-10-23 用户报的真 bug 的回归测试） ----------
   旧实现：每场考试各自去同一份空档里挖 30 分钟，互相看不见 → 三场考试全落在
   同一天同一个 19:00–19:30，真机复现 7 处重叠。
   新实现：一天只挖一块。这里断言的就是「无论几场考试，块与块之间不重叠」。 */
console.log('\n--- K 复习不重叠（真机 bug 回归）---')
const KEX = [
  exam('k1', '结构力学Ⅰ', '2026-10-19'),
  exam('k2', '结构设计原理和方法Ⅰ', '2026-10-20'),
  exam('k3', '工程水文学', '2026-10-22'),
]
const KP = planExams({ exams: KEX, today: DAY, itemsOfDay: freeAll, nowMin: 0, durationOf, days: 7 })
ok('K1 三场考试 → 复习天数 = 去重后的日期数（一天一段）', (() => {
  const dates = KP.reviewDays.map((d) => d.date)
  return dates.length > 0 && new Set(dates).size === dates.length
})(), KP.reviewDays.map((d) => d.date))
ok('K2 相邻两段不重叠（这是旧实现塌掉的地方）', (() => {
  const s = KP.reviewDays.slice().sort((a, b) => a.start - b.start || a.date.localeCompare(b.date))
  for (let i = 1; i < s.length; i += 1) {
    if (s[i].date === s[i - 1].date) return false // 同一天还出现两段 = 又重叠了
  }
  return true
})(), KP.reviewDays.map((d) => d.date + ' ' + d.time))
ok('K3 每场考试都拿得到「自己参与的那几天」', KP.exams.every((e) => e.blocks.length > 0), KP.exams.map((e) => [e.id, e.blocks.length]))
ok('K4 同一段里不会出现重复的考试', KP.reviewDays.every((d) => {
  const ids = d.exams.map((x) => x.id)
  return new Set(ids).size === ids.length
}))
ok('K5 考试当天不给那场考试排复习（当天在考场，不在书桌）', (() => {
  const byId = {}
  KEX.forEach((e) => { byId[e.id] = e.date })
  return KP.reviewDays.every((d) => d.exams.every((x) => byId[x.id] > d.date))
})())
ok('K6 reviewDaysFor 空输入不炸', reviewDaysFor({}).length === 0 && reviewDaysFor({ exams: [], itemsOfDay: freeAll }).length === 0)
ok('K7 一天只挖一次：同一天的 start/end 在所有考试视角下一致', (() => {
  const seen = {}
  for (const e of KP.exams) {
    for (const b of e.blocks) {
      if (seen[b.date] === undefined) seen[b.date] = b.time
      else if (seen[b.date] !== b.time) return false
    }
  }
  return true
})())
ok('K8 块长就是 REVIEW_BLOCK_MIN（不被别的考试挤短）', KP.reviewDays.every((d) => d.mins === REVIEW_BLOCK_MIN), KP.reviewDays.map((d) => d.mins))

console.log('\n=== 考试周模式纯函数：' + pass + '/' + (pass + fail) + ' 通过 ===')
if (fail) console.log('失败项：' + fails.join(' / '))
process.exit(fail ? 1 : 0)
