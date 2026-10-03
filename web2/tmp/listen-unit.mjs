/* 碎片练耳数据层单测（四期 Day 18 Step 2）——纯逻辑，无 DOM、无插件。
   跑法：cd web2 && node tmp/listen-unit.mjs
   覆盖：日期工具 / 记录校验 / 首次导入即到期 / 艾宾浩斯到期筛选与档位推进 /
         空闲槽阈值边界 / 建议时段分配 / 导入建记录 / localStorage 读写与默认值补全 /
         会话内重复（repeatTimes）/ 复习提醒排程（L3/L4 勿扰 + 每天一条合并通知）。
   注意：本文件曾被 PowerShell 5.1 的 Get-Content/Set-Content 以 GBK 往返写坏过一次
   （中文丢字节、newline 被吞），2026-10-03 按损坏前的断言语义重建。**以后不要用
   PowerShell 的 Set-Content 改本仓库的 UTF-8 文件**，用编辑器/Node 显式 utf8 写。 */

import {
  DEFAULTS, LISTEN_KEY, LISTEN_SET_KEY,
  isDateStr, isTimeStr, minOf, hhmm, dateKeyOf, todayKey, addDaysKey, compareDateKey, fmtSeconds,
  sanitizeClip, newClip, newClipId, clampRepeatTimes, clipNameFromFile, newClipFromImport, clipDuration,
  repeatTimesOf, nextPlayRound,
  sanitizeSettings, loadClips, saveClips, loadSettings, saveSettings,
  nextDueDate, reviewAdvance, dueClips,
  freeSlots, slotPlan, buildListenItems, toBusy,
  dndOf, inDndMin, buildListenNotices,
} from '../src/data/listen.js'

let pass = 0
let fail = 0
const failures = []
function ok(label, cond, extra) {
  if (cond) { pass++; return }
  fail++
  failures.push(label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''))
}
function eq(label, got, want) {
  ok(label + `（得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}）`, JSON.stringify(got) === JSON.stringify(want), got)
}

/* 假 storage：node 里没有 localStorage，用手写的最简实现验读写 */
function fakeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  }
}

/* ---------------- 1. 日期/时间工具 ---------------- */
ok('isDateStr 正确', isDateStr('2026-10-03') && !isDateStr('2026/10/03') && !isDateStr('2026-1-1'))
ok('isTimeStr 正确', isTimeStr('08:00') && !isTimeStr('8:00') && !isTimeStr('24:00'))
eq('minOf 08:30', minOf('08:30'), 510)
eq('minOf 非法取 -1', minOf('25:00'), -1)
eq('hhmm 归零', hhmm(1440 + 90), '01:30')
eq('addDaysKey 跨月', addDaysKey('2026-10-31', 1), '2026-11-01')
eq('addDaysKey 跨年', addDaysKey('2026-12-31', 1), '2027-01-01')
eq('addDaysKey 非法输入', addDaysKey('bad', 1), null)
ok('compareDateKey 排序', compareDateKey('2026-10-01', '2026-10-03') < 0 && compareDateKey('2026-10-03', '2026-10-03') === 0)
ok('compareDateKey 非法排最后', compareDateKey(null, '2026-10-03') > 0)
eq('fmtSeconds', fmtSeconds(35), '0:35')
eq('fmtSeconds 未知', fmtSeconds(null), '—')
ok('dateKeyOf 无时区偏移', dateKeyOf(new Date(2026, 9, 3)) === '2026-10-03')

/* ---------------- 2. 记录校验 ---------------- */
eq('clampRepeatTimes 下钳 3', clampRepeatTimes(1), 3)
eq('clampRepeatTimes 上钳 5', clampRepeatTimes(9), 5)
ok('sanitizeClip 缺 name/file 返回 null', sanitizeClip({ name: 'a' }) === null && sanitizeClip({ file: 'f' }) === null)
const c1 = sanitizeClip({
  id: 'lis_1', name: '  新闻听力  ', file: 'listen/a.mp3', seconds: '45',
  played_count: '2', review_stage: '1', next_due_date: '2026-10-05', repeat_times: 8, created_at: '2026-10-01T08:00:00.000Z',
})
eq('sanitizeClip 去空格', c1.name, '新闻听力')
eq('sanitizeClip 秒数字符串转数字', c1.seconds, 45)
eq('sanitizeClip repeat_times 超界钳到 5', c1.repeat_times, 5)
eq('sanitizeClip 缺字段补默认', sanitizeClip({ name: 'x', file: 'y' }).played_count, 0)
ok('sanitizeClip 非法 next_due_date → null', sanitizeClip({ name: 'x', file: 'y', next_due_date: '10/05' }).next_due_date === null)
ok('newClipId 前缀 lis_', newClipId().startsWith('lis_'))

/* ---------------- 3. 首次导入即到期 ---------------- */
const fresh = newClip({ name: '新导入', file: 'listen/new.mp3', created_at: '2026-10-03T09:00:00.000Z' })
eq('新导入 next_due_date = 导入当天', fresh.next_due_date, '2026-10-03')
eq('新导入 review_stage = 0', fresh.review_stage, 0)
eq('新导入 played_count = 0', fresh.played_count, 0)
ok('新导入当天就在待复习里', dueClips([fresh], '2026-10-03').length === 1)

/* ---------------- 4. 艾宾浩斯：到期筛选 ---------------- */
const iv = [1, 2, 4]
const mk = (id, due, extra = {}) => sanitizeClip({ id, name: id, file: 'f', next_due_date: due, ...extra })
const clips = [
  mk('a', '2026-10-03'), // 今天到期
  mk('b', '2026-10-01'), // 拖过期了（排最前）
  mk('c', '2026-10-10'), // 还没到期
  mk('d', '2026-10-02', { archived: true }), // 已归档 → 排除
  mk('e', null), // 不在计划里 → 排除
]
const due = dueClips(clips, '2026-10-03')
eq('到期条数', due.length, 2)
eq('到期排序（过期最前）', due.map((x) => x.id), ['b', 'a'])

/* ---------------- 5. 艾宾浩斯：档位推进 ---------------- */
const base = '2026-10-03'
eq('档位 1 → intervals[0]=1 天', nextDueDate(1, iv, base), '2026-10-04')
eq('档位 2 → intervals[1]=2 天', nextDueDate(2, iv, base), '2026-10-05')
eq('档位 3 → intervals[2]=4 天', nextDueDate(3, iv, base), '2026-10-07')
eq('档位用满返回 null', nextDueDate(4, iv, base), null)
eq('档位 0（还没学）不该排', nextDueDate(0, iv, base), null)

let cur = mk('x', base, { review_stage: 0 })
cur = reviewAdvance(cur, { fromDateKey: base, intervals: iv })
eq('推进 played_count', cur.played_count, 1)
eq('推进 stage', cur.review_stage, 1)
eq('推进 next_due_date', cur.next_due_date, '2026-10-04')
cur = reviewAdvance(cur, { fromDateKey: '2026-10-04', intervals: iv })
eq('第二次推进 next_due_date', cur.next_due_date, '2026-10-06') // 10-04 + 2 天
cur = reviewAdvance(cur, { fromDateKey: '2026-10-06', intervals: iv })
eq('第三次推进 next_due_date', cur.next_due_date, '2026-10-10') // 10-06 + 4 天
cur = reviewAdvance(cur, { fromDateKey: '2026-10-10', intervals: iv })
eq('第三次之后（三档全过）next_due_date', cur.next_due_date, null)
eq('四次推进 played_count', cur.played_count, 4)
const doneStage = reviewAdvance(cur, { fromDateKey: '2026-10-20', intervals: iv })
eq('已学完再点不复活（stage 超出）→ null', doneStage.next_due_date, null)

/* ---------------- 6. 空闲槽与阈值边界 ---------------- */
const day = (h, m = 0) => new Date(2026, 9, 3, h, m)
const items = [
  { at: day(9), title: '高数' }, // 09:00–09:50
  { at: day(10), title: '英语' }, // 10:00–10:50
]
const durOfU = () => 50
const slots = freeSlots(items, DEFAULTS, { dayFrom: 8 * 60, dayTo: 12 * 60, durationOf: durOfU })
eq('空档数', slots.length, 3)
eq('空档 1 08:00–09:00', [slots[0].start, slots[0].end, slots[0].mins], [480, 540, 60])
eq('空档 2 09:50–10:00（10 分钟，正好算短槽）', [slots[1].start, slots[1].end, slots[1].mins], [590, 600, 10])
eq('空档 3 10:50–12:00', [slots[2].mins], [70])

const tiny = freeSlots(
  [{ at: day(9), title: 'A' }, { at: day(9, 4), title: 'B' }], // 间隔 4 分钟 < slotMinMin
  DEFAULTS, { dayFrom: 8 * 60, dayTo: 10 * 60, durationOf: () => 1 },
)
ok('小于 slotMinMin 的碎空档不排', !tiny.some((s) => s.mins === 4))

const plan = slotPlan(slots, 30, DEFAULTS) // 30 秒一段
eq('短槽（10 分钟）kind', plan[1].kind, 'short')
eq('长槽（60 分钟）kind', plan[0].kind, 'long')
eq('长槽 60 分钟 ÷ 0.5 分钟 = 120 段', plan[0].count, 120)
eq('短槽 hhmm 格式', plan[1].start + '-' + plan[1].end, '09:50-10:00')

/* ---------------- 7. 建议时段分配 ---------------- */
const many = [mk('m1', '2026-10-03'), mk('m2', '2026-10-03'), mk('m3', '2026-10-03')]
const built = buildListenItems({
  items, clips: many, settings: DEFAULTS, today: '2026-10-03',
  now: new Date(2026, 9, 3, 7, 0), durationOf: () => 50, // 早上 7 点看今天，槽都还没过
})
eq('待复习段数', built.due.length, 3)
eq('建议时段数（3 段够放则不铺满所有槽）', built.suggestions.length, 1)
eq('建议时段 take', built.suggestions[0].take, 3)
eq('剩余未安排', built.remaining, 0)

const late = buildListenItems({
  items, clips: many, settings: DEFAULTS, today: '2026-10-03',
  now: new Date(2026, 9, 3, 11, 0), durationOf: () => 50, // 11 点才看，只剩 10:50–12:00
})
eq('已过去的槽不排（只剩最后一段）', late.suggestions.length, 1)
eq('剩下的槽 take 不超过待复习数', late.suggestions[0].take, 3)
eq('过了的槽没进建议', late.suggestions[0].start, '10:50')

const none = buildListenItems({ items, clips: [], settings: DEFAULTS, today: '2026-10-03', now: new Date(2026, 9, 3, 7, 0), durationOf: () => 50 })
eq('没有到期的段就不给建议', none.suggestions.length, 0)

/* ---------------- 8. 导入建记录（Step 4） ---------------- */
eq('clipNameFromFile 去扩展名', clipNameFromFile('C:\\Users\\a\\听力材料.mp3'), '听力材料')
eq('clipNameFromFile 无扩展名', clipNameFromFile('/x/y/news'), 'news')
eq('clipNameFromFile 空输入', clipNameFromFile(''), '')
const imp1 = newClipFromImport({ fileName: 'listen/new.mp3', seconds: 42, createdAt: '2026-10-03T09:00:00.000Z' }, [])
eq('导入建记录 added', imp1.added, true)
eq('导入记录 file 只存文件名', imp1.clip.file, 'new.mp3')
eq('导入记录 name', imp1.clip.name, 'new')
eq('导入记录 seconds', imp1.clip.seconds, 42)
eq('导入记录当天到期', imp1.clip.next_due_date, '2026-10-03')
const imp2 = newClipFromImport({ fileName: 'new.mp3' }, [imp1.clip])
eq('同名重复导入不新增', [imp2.added, imp2.clip.id === imp1.clip.id], [false, true])
ok('clipDuration 在 node 里安全返回 null', (await clipDuration(null)) === null)

/* ---------------- 9. 读写与默认值补全 ---------------- */
const st = fakeStorage()
eq('无数据时 loadClips 返回空表', loadClips(st), [])
const saved = saveClips([fresh, { bad: true }], st) // 非法那条要被过滤
eq('saveClips 过滤非法记录', saved.length, 1)
eq('落盘后可读回', loadClips(st).length, 1)
ok('脏 JSON 不抛异常', (() => { st.setItem(LISTEN_KEY, '{oops'); return loadClips(st).length === 0 })())

const set0 = loadSettings(st)
eq('无设置时用默认 repeatTimes', set0.repeatTimes, DEFAULTS.repeatTimes)
eq('无设置时用默认复习间隔', set0.reviewIntervals, DEFAULTS.reviewIntervals)
const set1 = saveSettings({ repeatTimes: 99, dndStart: 'bad', reviewIntervals: [] }, st)
eq('越界 repeatTimes 被钳到 5', set1.repeatTimes, 5)
eq('非法 dndStart 回落默认', set1.dndStart, DEFAULTS.dndStart)
eq('空复习间隔回落默认', set1.reviewIntervals, DEFAULTS.reviewIntervals)
const set2 = loadSettings(st)
eq('设置落盘可读回', set2.repeatTimes, 5)
const merged = saveSettings({ dndEnd: '06:30' }, st)
eq('增量 patch 不丢其它字段', [merged.dndEnd, merged.repeatTimes, merged.reviewIntervals.length], ['06:30', 5, 6])
ok('设置键名正确', st._map.has(LISTEN_SET_KEY) && st._map.has(LISTEN_KEY))

/* ---------------- 会话内重复（repeatTimes）：连放几遍 + 轮次推进 ---------------- */
eq('本条没写 repeat_times → 跟全局', repeatTimesOf({ repeat_times: null }, { repeatTimes: 5 }), 5)
eq('本条写了 repeat_times → 本条优先', repeatTimesOf({ repeat_times: 4 }, { repeatTimes: 5 }), 4)
eq('本条非法（0）→ 跟全局', repeatTimesOf({ repeat_times: 0 }, { repeatTimes: 5 }), 5)
eq('本条非法（字符串）→ 跟全局', repeatTimesOf({ repeat_times: 'x' }, { repeatTimes: 3 }), 3)
eq('本条超界 → 钳到 5', repeatTimesOf({ repeat_times: 99 }, { repeatTimes: 3 }), 5)
eq('本条低于下限 → 钳到 3', repeatTimesOf({ repeat_times: 1 }, { repeatTimes: 5 }), 3)
eq('全局也没有 → 只放 1 遍（宁可少放）', repeatTimesOf({ repeat_times: null }, {}), 1)
eq('clip 为空 → 跟全局', repeatTimesOf(null, { repeatTimes: 4 }), 4)
eq('clip 与设置都空 → 1', repeatTimesOf(null, null), 1)

eq('第 1/3 遍 → 下一遍是 2', nextPlayRound(1, 3), 2)
eq('第 2/3 遍 → 下一遍是 3', nextPlayRound(2, 3), 3)
eq('第 3/3 遍 → 0（放完该停）', nextPlayRound(3, 3), 0)
eq('只放 1 遍时第 1 遍就收工', nextPlayRound(1, 1), 0)
eq('轮次越界也返回 0（不无限连放）', nextPlayRound(9, 3), 0)
eq('轮次 0（没在播）→ 1', nextPlayRound(0, 3), 1)
eq('total 非法时按 1 遍收工', nextPlayRound(1, 0), 0)

/* ---------------- 复习提醒排程（L3/L4）：勿扰时段 + 每天一条合并通知 ---------------- */
const SET_U = sanitizeSettings(null) // 默认设置：repeatTimes 3 / 勿扰 23:00–07:00 / shortGapMaxMin 10 / slotMinMin 5
eq('默认勿扰时段 23:00–07:00', [dndOf(SET_U).start, dndOf(SET_U).end], [23 * 60, 7 * 60])
eq('勿扰字段非法 → 回落默认', [dndOf({ dndStart: 'xx', dndEnd: '' }).start, dndOf({ dndStart: 'xx', dndEnd: '' }).end], [23 * 60, 7 * 60])
ok('23:30 在勿扰内（跨零点）', inDndMin(23 * 60 + 30, SET_U))
ok('06:59 在勿扰内（跨零点）', inDndMin(6 * 60 + 59, SET_U))
ok('07:00 不在勿扰内（右开区间）', !inDndMin(7 * 60, SET_U))
ok('14:00 不在勿扰内', !inDndMin(14 * 60, SET_U))
const SET_D = sanitizeSettings({ dndStart: '13:00', dndEnd: '14:00' })
ok('非跨零点：13:30 在勿扰内', inDndMin(13 * 60 + 30, SET_D))
ok('非跨零点：14:00 不在', !inDndMin(14 * 60, SET_D))
ok('起止相同 = 不设勿扰', !inDndMin(23 * 60 + 30, sanitizeSettings({ dndStart: '23:00', dndEnd: '23:00' })))

/* 造一条某天的日程项（buildListenNotices 只经 freeSlots→toBusy 用它算空档，
   所以要有 at（算起点）与 durationOf 可读的 start/end） */
function dayItems(dKey, ranges) {
  const [y, m, d] = String(dKey).split('-').map(Number)
  return ranges.map(([s, e]) => ({
    at: new Date(y, m - 1, d, Math.floor(minOf(s) / 60), minOf(s) % 60),
    start: s, end: e, title: '课',
  }))
}
const durOf = (it) => minOf(String(it.end)) - minOf(String(it.start))
const clipDue = (dueDate, seconds = 60) => ({ id: 'lis_1', name: 'A', file: 'a.wav', seconds, played_count: 0, review_stage: 0, next_due_date: dueDate, archived: false })
const NOW_EARLY = new Date(2026, 9, 3, 6, 0) // 2026-10-03 06:00（在 08:00 空档之前）
const D0 = '2026-10-03'
const NOITEMS = () => []

eq('没有音频 → 不排通知', buildListenNotices({ clips: [], settings: SET_U, now: NOW_EARLY, itemsOfDay: NOITEMS, durationOf: durOf }).length, 0)
eq('已归档 → 不排', buildListenNotices({ clips: [{ ...clipDue(D0), archived: true }], settings: SET_U, now: NOW_EARLY, itemsOfDay: NOITEMS, durationOf: durOf }).length, 0)
eq('没有 next_due_date（没学过）→ 不排', buildListenNotices({ clips: [{ ...clipDue(D0), next_due_date: null }], settings: SET_U, now: NOW_EARLY, itemsOfDay: NOITEMS, durationOf: durOf }).length, 0)
eq('到期日在未来 → 今天不排', buildListenNotices({ clips: [clipDue('2026-10-20')], settings: SET_U, now: NOW_EARLY, itemsOfDay: NOITEMS, durationOf: durOf }).length, 0)

/* 注意：buildListenNotices 默认 horizonDays=7，一段没标过「已听」就天天到期，
   所以默认会排出 7 条（每天一条合并）。下面要验「某一天」的结果时一律显式传 horizonDays: 1。 */
const one = buildListenNotices({ clips: [clipDue(D0)], settings: SET_U, now: NOW_EARLY, itemsOfDay: NOITEMS, durationOf: durOf, horizonDays: 1 })
eq('一段今天到期 + 整天有空 → 排 1 条', one.length, 1)
eq('  键名按日期', one[0].key, 'l_' + D0)
eq('  时刻 = 第一个空档起点 08:00', [one[0].at.getHours(), one[0].at.getMinutes()], [8, 0])
eq('  文案含段数与时长', one[0].body, '今天有 1 段待复习（约 1 分钟）· 挑空档去听')
eq('  count 字段', one[0].count, 1)
eq('  标题', one[0].title, '碎片练耳')

const merge3 = buildListenNotices({
  clips: [clipDue(D0, 60), { ...clipDue(D0, 120), id: 'lis_2', name: 'B' }, { ...clipDue(D0, 180), id: 'lis_3', name: 'C' }],
  settings: SET_U, now: NOW_EARLY, itemsOfDay: NOITEMS, durationOf: durOf, horizonDays: 1,
})
eq('三段到期 → 合并成一条', merge3.length, 1)
eq('  段数=3', merge3[0].count, 3)
eq('  时长相加（60+120+180=6 分钟）', merge3[0].body, '今天有 3 段待复习（约 6 分钟）· 挑空档去听')

/* 今天已过去的空档不排：06:00 起算时不跳；15:00 起算时 08:00 已过 → 当天不排 */
eq('今天空档已过 → 当天不排', buildListenNotices({ clips: [clipDue(D0)], settings: SET_U, now: new Date(2026, 9, 3, 15, 0), itemsOfDay: NOITEMS, durationOf: durOf, horizonDays: 1 }).length, 0)
/* 但明天照样排（日期判定，不按次数） */
const fromNoon = buildListenNotices({ clips: [clipDue(D0)], settings: SET_U, now: new Date(2026, 9, 3, 15, 0), itemsOfDay: NOITEMS, durationOf: durOf, horizonDays: 2 })
eq('今天跳过、明天照排', fromNoon.map((n) => n.key), ['l_2026-10-04'])

/* 整天排满（08:00–22:00 都被课占）→ 当天不排 */
eq('整天排满 → 当天不排', buildListenNotices({
  clips: [clipDue(D0)], settings: SET_U, now: NOW_EARLY,
  itemsOfDay: () => dayItems(D0, [['08:00', '22:00']]), durationOf: durOf,
}).length, 0)

/* 空档太小（10 分钟课之间只剩 4 分钟 < slotMinMin 5）→ 不排 */
eq('空档小于 5 分钟 → 不排', buildListenNotices({
  clips: [clipDue(D0)], settings: SET_U, now: NOW_EARLY,
  itemsOfDay: () => dayItems(D0, [['08:00', '11:56'], ['12:00', '22:00']]), durationOf: durOf,
}).length, 0)

/* 放不下的空档要跳过：第一个空档只 5 分钟，放不下 20 分钟的音频 → 取后面那个大空档 */
const find2nd = buildListenNotices({
  clips: [clipDue(D0, 1200)], settings: SET_U, now: NOW_EARLY,
  itemsOfDay: () => dayItems(D0, [['08:05', '08:12']]), durationOf: durOf, horizonDays: 1,
})
eq('跳过放不下的空档，取第一个放得下的', [find2nd.length, find2nd[0].at.getHours(), find2nd[0].at.getMinutes()], [1, 8, 12])

/* 勿扰：同一天里更晚就顺延到勿扰结束 */
const dndShift = buildListenNotices({
  clips: [clipDue(D0)], settings: sanitizeSettings({ dndStart: '06:00', dndEnd: '09:00' }), now: NOW_EARLY,
  itemsOfDay: NOITEMS, durationOf: durOf, horizonDays: 1,
})
eq('落在勿扰 → 顺延到勿扰结束 09:00', [dndShift.length, dndShift[0].at.getHours(), dndShift[0].at.getMinutes()], [1, 9, 0])

/* 勿扰跨零点且顺延会跑到第二天早上 → 当天放弃（空档落在 20:00 之后，正处勿扰里） */
eq('跨零点勿扰 → 当天放弃', buildListenNotices({
  clips: [clipDue(D0)], settings: sanitizeSettings({ dndStart: '20:00', dndEnd: '07:00' }), now: NOW_EARLY,
  itemsOfDay: () => dayItems(D0, [['08:00', '20:30']]), durationOf: durOf,
}).length, 0)

/* 多天：一段一直到期，三天各排一条（键各不同） */
const multi = buildListenNotices({ clips: [clipDue(D0)], settings: SET_U, now: NOW_EARLY, itemsOfDay: NOITEMS, durationOf: durOf, horizonDays: 3 })
eq('三天各一条', multi.map((n) => n.key), ['l_2026-10-03', 'l_2026-10-04', 'l_2026-10-05'])
eq('horizonDays 0 → 空', buildListenNotices({ clips: [clipDue(D0)], settings: SET_U, now: NOW_EARLY, itemsOfDay: NOITEMS, durationOf: durOf, horizonDays: 0 }).length, 0)

/* ---------------- 汇总 ---------------- */
console.log(`\n碎片练耳单测：${pass} 项通过 / ${fail} 项失败`)
if (fail) {
  console.log('\n失败项：')
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('全部通过 ✓')
