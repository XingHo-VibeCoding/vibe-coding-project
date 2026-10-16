/* 03 时间去哪了 —— 纯逻辑单测（node 直跑，不需要浏览器）
   用法：node tmp/timeline-unit.mjs
   钉死基准日 2026-10-16（周五），不依赖真实时钟。 */
import { usageAcross, timelineRow, usageCellText, formatShort, timelineLine, timelineView, dateLabel } from '../src/data/timeline.js'
import { upsertDay, sanitizeUsageMs } from '../src/data/daily.js'

let ok = 0, bad = 0
const fails = []
function t(name, cond, extra) {
  if (cond) { ok++; console.log('  PASS ' + name + (extra !== undefined ? '  → ' + extra : '')) }
  else { bad++; fails.push(name); console.log('  FAIL ' + name + '  → ' + extra) }
}
function eq(name, got, want) {
  t(name, JSON.stringify(got) === JSON.stringify(want), 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))
}

const DAY = '2026-10-16'
const day = (date, stats = {}, usage_ms = undefined) => {
  const o = { date, stats: Object.assign({ courses: 0, todosDone: 0, todosTotal: 0, habitsDone: 0, habitsTotal: 0, listenToday: 0 }, stats), updated_at: 1 }
  if (usage_ms !== undefined) o.usage_ms = usage_ms
  return o
}
/* 造一本 daily 存档（走真的 sanitizeBook 路径，不手搓内部形状） */
function bookOf(list) {
  let b = { version: 1, days: {} }
  for (const it of list) {
    const r = upsertDay(b, { date: it.date, stats: it.stats, usageMs: it.usageMs, now: 1 })
    b = r.book
  }
  return b
}

console.log('\n--- A 有效时长与缺数必须分开 ---')
eq('A1 sanitizeUsageMs(null) 是 null（没抓到 ≠ 0）', sanitizeUsageMs(null), null)
eq('A2 sanitizeUsageMs(undefined) 是 null', sanitizeUsageMs(undefined), null)
eq('A3 sanitizeUsageMs("") 是 null', sanitizeUsageMs(''), null)
eq('A4 sanitizeUsageMs(0) 是 0（真的一分钟没碰）', sanitizeUsageMs(0), 0)
eq('A5 负数当没抓到', sanitizeUsageMs(-5), null)
eq('A6 非数字当没抓到', sanitizeUsageMs('abc'), null)
t('A7 null 与 0 不相等（这是全条线的立命之本）', sanitizeUsageMs(null) !== sanitizeUsageMs(0))

console.log('\n--- B usageAcross 只拿有数的天做平均 ---')
{
  const days = [day('d1', {}, 3600000), day('d2', {}, 0), day('d3')]
  const u = usageAcross(days)
  eq('B1 kept 只数有数的天（null 不进分母）', u.kept, 2)
  eq('B2 missing 数没抓到的天', u.missing, 1)
  eq('B3 totalMs', u.totalMs, 3600000)
  eq('B4 日均 = 3.6e6 / 2（不是 / 3）', u.avgMs, 1800000)
  t('B5 has=true', u.has === true)
}
{
  const u = usageAcross([day('d1'), day('d2')])
  eq('B6 一天都没抓到 → kept=0', u.kept, 0)
  eq('B7 一天都没抓到 → avgMs=0', u.avgMs, 0)
  t('B8 一天都没抓到 → has=false（界面走「未开启」而不是画 0）', u.has === false)
}
{
  const u = usageAcross([])
  t('B9 空数组不炸', u.has === false && u.kept === 0)
  const u2 = usageAcross(null)
  t('B10 null 不炸', u2.has === false)
}

console.log('\n--- C timelineRow 只搬运事实 ---')
{
  const r = timelineRow(day(DAY, { courses: 3, todosDone: 2, todosTotal: 5, habitsDone: 1, habitsTotal: 2, listenToday: 4 }, 7200000))
  eq('C1 date', r.date, DAY)
  eq('C2 课程数', r.courses, 3)
  eq('C3 待办', [r.todosDone, r.todosTotal], [2, 5])
  eq('C4 打卡', [r.habitsDone, r.habitsTotal], [1, 2])
  eq('C5 练耳', r.listened, 4)
  eq('C6 手机时长原样', r.usageMs, 7200000)
  t('C7 line 复用 daily.js 的同一句小结（不另说一套）', r.line.includes('排 5 做完 2') && r.line.includes('3 节课'))
  eq('C8 非法输入返回 null', timelineRow(null), null)
}
{
  const r = timelineRow(day(DAY, {}, 0))
  eq('C9 totalMs=0 照实是 0（不是 null）', r.usageMs, 0)
  const r2 = timelineRow(day(DAY))
  eq('C10 老记录没这个字段 → null', r2.usageMs, null)
}

console.log('\n--- D usageCellText 不许把「没抓到」写成 0 ---')
eq('D1 null → 未开启', usageCellText(null), '未开启')
eq('D2 undefined → 未开启', usageCellText(undefined), '未开启')
eq('D3 0 → 没使用（不是未开启）', usageCellText(0), '没使用')
eq('D4 3600000 → 1 小时', usageCellText(3600000), '1 小时')
eq('D5 1800000 → 30 分钟', usageCellText(1800000), '30 分钟')
eq('D6 5400000 → 1 小时 30 分', usageCellText(5400000), '1 小时 30 分')
eq('D7 30000 → 不到 1 分钟', usageCellText(30000), '不到 1 分钟')
t('D8 「未开启」与「没使用」是不同的字', usageCellText(null) !== usageCellText(0))
eq('D9 formatShort(0)', formatShort(0), '不到 1 分钟')
eq('D10 formatShort(2h 整 → 不写 0 分)', formatShort(7200000), '2 小时')

console.log('\n--- E timelineLine 三种情况三句实话 ---')
{
  const L = timelineLine({ days: [] })
  t('E1 没有记录时说明还没攒起来', L.includes('还没有攒下记录'), L)
}
{
  const days = [timelineRow(day('2026-10-14')), timelineRow(day('2026-10-15'))]
  const L = timelineLine({ days, usage: usageAcross(days) })
  t('E2 一天都没抓到 → 指向权限，不催', L.includes('没抓到') && L.includes('使用情况访问'), L)
  t('E3 一天都没抓到 → 绝不说「平均 0 分钟」', !L.includes('0 分钟') && !L.includes('没使用'), L)
}
{
  const days = [timelineRow(day('2026-10-15', {}, 3600000)), timelineRow(day('2026-10-16', {}, 1800000))]
  const L = timelineLine({ days, usage: usageAcross(days) })
  t('E4 有数时说实话（天数 + 日均）', L.includes('2 天抓到') && L.includes('平均每天'), L)
  t('E5 没有缺的天时不提「没抓到」', !L.includes('另有'), L)
}
{
  const days = [timelineRow(day('2026-10-15', {}, 3600000)), timelineRow(day('2026-10-16'))]
  const L = timelineLine({ days, usage: usageAcross(days) })
  t('E6 有缺的天时如实说「另有 N 天没抓到」', L.includes('另有 1 天没抓到'), L)
}

console.log('\n--- F 措辞不催不评判（禁词表） ---')
{
  const banned = ['加油', '努力', '赶紧', '必须', '懒', '拖延', '超标', '少玩', '应该', '戒', '自制力', '堕落', '专注点']
  const texts = [
    timelineLine({ days: [] }),
    timelineLine({ days: [timelineRow(day('2026-10-16'))], usage: usageAcross([timelineRow(day('2026-10-16'))]) }),
    timelineLine({ days: [timelineRow(day('2026-10-16', {}, 3600000))], usage: usageAcross([timelineRow(day('2026-10-16', {}, 3600000))]) }),
    usageCellText(null), usageCellText(0), usageCellText(3600000), formatShort(60000),
  ]
  for (const s of texts) {
    const hit = banned.filter((w) => s.includes(w))
    t(`F 措辞「${s.slice(0, 22)}…」不含评判词`, hit.length === 0, hit.join(','))
  }
}

console.log('\n--- G dateLabel 纯字符串（不踩 UTC 差一天） ---')
eq('G1 2026-10-16 是周五', dateLabel('2026-10-16'), '10 月 16 日 周五')
eq('G2 2026-10-19 是周一', dateLabel('2026-10-19'), '10 月 19 日 周一')
eq('G3 今天加后缀', dateLabel('2026-10-16', '2026-10-16'), '10 月 16 日 周五 · 今天')
eq('G4 非今天不加', dateLabel('2026-10-15', '2026-10-16'), '10 月 15 日 周四')
eq('G5 非法输入原样返回', dateLabel('bad'), 'bad')
eq('G6 空值不炸', dateLabel(''), '')

console.log('\n--- H timelineView 整块 ---')
{
  const b = bookOf([
    { date: '2026-10-15', stats: { courses: 2, todosTotal: 3, todosDone: 1 }, usageMs: 3600000 },
    { date: '2026-10-16', stats: { courses: 1, todosTotal: 2, todosDone: 2 }, usageMs: null },
  ])
  const v = timelineView(b, { n: 7, today: DAY })
  eq('H1 只列记过的天（缺的不补空行）', v.days.length, 2)
  eq('H2 倒序（最近的在最前）', v.days.map((d) => d.date), ['2026-10-16', '2026-10-15'])
  eq('H3 今天的行带「· 今天」', v.days[0].label, '10 月 16 日 周五 · 今天')
  eq('H4 有数的那天 usageKnown=true', v.days[1].usageKnown, true)
  eq('H5 没抓到的那天 usageKnown=false', v.days[0].usageKnown, false)
  eq('H6 没抓到的那天文案是「未开启」', v.days[0].usageText, '未开启')
  eq('H7 有数的那天文案是时长', v.days[1].usageText, '1 小时')
  eq('H8 usage.kept 只数有数的天', v.usage.kept, 1)
  eq('H9 usage.missing 数没抓到的天', v.usage.missing, 1)
  t('H10 line 是实话（含「另有 1 天没抓到」）', v.line.includes('另有 1 天没抓到'), v.line)
}
{
  const v = timelineView({ version: 1, days: {} }, { n: 7, today: DAY })
  eq('H11 空存档 → days 空', v.days.length, 0)
  t('H12 空存档 → line 说还没攒起来', v.line.includes('还没有攒下记录'), v.line)
}
{
  /* usageMs 用「显式传才动」的规矩：不传时不能把已有的数字抹成 null */
  let b = bookOf([{ date: DAY, stats: {}, usageMs: 3600000 }])
  const r1 = upsertDay(b, { date: DAY, stats: {}, now: 2 })
  eq('H13 不传 usageMs → 保住原来的数', r1.day.usage_ms, 3600000)
  const r2 = upsertDay(b, { date: DAY, stats: {}, usageMs: null, now: 3 })
  eq('H14 显式传 null → 记成没抓到', r2.day.usage_ms, null)
  const r3 = upsertDay(b, { date: DAY, stats: {}, usageMs: 0, now: 4 })
  eq('H15 显式传 0 → 记成 0（与 null 不同）', r3.day.usage_ms, 0)
}

console.log(`\n=== 时间去哪了纯函数：${ok}/${ok + bad} 通过 ===`)
if (fails.length) console.log('失败项：' + fails.join(' / '))
process.exit(bad ? 1 : 0)
