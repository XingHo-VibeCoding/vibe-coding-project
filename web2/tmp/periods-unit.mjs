/* 分段式节次表：纯函数单元测试（src/data/periods.js）
   口径：相邻两节间隔 > 15 分钟视为「段」边界（大课间/午休/晚休）；
   段内改「时长/课间」只重排本段、只替换段内普通课间，大空档不动；
   段边界可手动并入上一段 / 在指定位置分段（显式存 seg 字段，缺失则按规则派生）。 */

const {
  SEG_GAP, segNosOf, segmentView, inferSegAssist,
  reperiodSegment, shiftWithinSegment, reperiodAll,
  addPeriodToSegment, removePeriodAt, mergeSegmentUp, splitSegmentAt, normalizeSegs, resyncSegs,
} = await import('../src/data/periods.js')

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}
function eq(name, got, want) {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  t(name + (a === b ? '' : `  ← got ${a} want ${b}`), a === b)
}

/* 样本 10 节表（不对应 store 默认，仅作纯函数夹具）：段应切成 {1,2}{3,4}{5,6}{7,8}{9,10} */
const DEF = [
  { no: 1, start: '08:00', end: '08:45' },
  { no: 2, start: '08:55', end: '09:40' },
  { no: 3, start: '10:10', end: '10:55' },
  { no: 4, start: '11:05', end: '11:50' },
  { no: 5, start: '14:00', end: '14:45' },
  { no: 6, start: '14:55', end: '15:40' },
  { no: 7, start: '16:10', end: '16:55' },
  { no: 8, start: '17:05', end: '17:50' },
  { no: 9, start: '18:30', end: '19:15' },
  { no: 10, start: '19:25', end: '20:10' },
]
const clone = (l) => l.map((p) => ({ ...p }))

/* ---------- 1. 阈值 + 派生分段 ---------- */
t('1a. 阈值 = 15 分钟', SEG_GAP === 15)
eq('1b. 默认 10 节派生 5 段', segNosOf(DEF), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5])

/* store.js 现行默认表（用户拍板：上午 5 + 下午 5 + 晚上 3，课间统一 10 分）应切成 3 段 */
const NEWDEF = [
  ['08:00', '08:45'], ['08:55', '09:40'], ['09:50', '10:35'], ['10:45', '11:30'], ['11:40', '12:25'],
  ['14:00', '14:45'], ['14:55', '15:40'], ['15:50', '16:35'], ['16:45', '17:30'], ['17:40', '18:25'],
  ['19:00', '19:45'], ['19:55', '20:40'], ['20:50', '21:35'],
].map(([start, end], i) => ({ no: i + 1, start, end }))
eq('1b2. 新默认 13 节切 3 段（上午/下午/晚上）', segNosOf(NEWDEF), [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3])
t('1c. 空表 → 空数组', segNosOf([]).length === 0)

/* ---------- 2. 显式 seg 优先 + 规范化 ---------- */
const EXPL = clone(DEF).map((p, i) => ({ ...p, seg: i < 4 ? 1 : 2 }))
eq('2a. 显式 seg 被采用（上午 4 节同段）', segNosOf(EXPL), [1, 1, 1, 1, 2, 2, 2, 2, 2, 2])
const HOLES = clone(DEF).map((p, i) => ({ ...p, seg: i < 4 ? 3 : 7 }))
eq('2b. 段号不连续/不从 1 起 → 重编号连续', segNosOf(HOLES), [1, 1, 1, 1, 2, 2, 2, 2, 2, 2])
const PART = clone(DEF).map((p, i) => (i === 0 ? { ...p, seg: 9 } : p))
eq('2c. 只有部分带 seg → 全部忽略，按规则派生', segNosOf(PART), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
const DUP = clone(DEF).map((p, i) => ({ ...p, seg: i === 0 ? 2 : i === 1 ? 1 : 2 }))
eq('2d. 段号逆序会被按出现顺序拉正（相邻递减视为同段延续）', segNosOf(DUP), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1])

/* ---------- 3. 段视图 ---------- */
const view = segmentView(DEF)
t('3a. 段数 5', view.length === 5)
eq('3b. 首段 {seg,from,to,nos,start,end,gapBefore}', view[0],
  { seg: 1, from: 0, to: 1, nos: [1, 2], start: '08:00', end: '09:40', gapBefore: null })
t('3c. 首段 gapBefore = null', view[0].gapBefore === null)
t('3d. 第 2 段 gapBefore = 30（大课间）', view[1].gapBefore === 30)
t('3e. 第 3 段 gapBefore = 130（午休）', view[2].gapBefore === 130)

/* ---------- 4. 段辅助默认值（段内时长/课间取众数，平票取小） ---------- */
eq('4a. 首段 dur=45 gap=10', inferSegAssist(DEF, 1), { dur: 45, gap: 10 })
eq('4b. 第 5 段（晚） dur=45 gap=10', inferSegAssist(DEF, 5), { dur: 45, gap: 10 })
eq('4c. 单节段无课间 → gap 回落 10', inferSegAssist([{ no: 1, start: '08:00', end: '09:30' }], 1), { dur: 90, gap: 10 })
const MIX = [
  { no: 1, start: '08:00', end: '08:45', seg: 1 },
  { no: 2, start: '08:55', end: '09:40', seg: 1 },
  { no: 3, start: '10:00', end: '10:45', seg: 1 },
]
eq('4d. 段内 gap [10,20] 众数取小(10)，dur 45', inferSegAssist(MIX, 1), { dur: 45, gap: 10 })

/* ---------- 5. 段内重排 ---------- */
{
  const r = reperiodSegment(DEF, 1, { dur: 50, gap: 5 })
  t('5a. 重排 ok', r.ok === true)
  eq('5b. 首段变 08:00–08:50 / 08:55–09:45', r.periods.slice(0, 2).map((p) => p.start + '-' + p.end), ['08:00-08:50', '08:55-09:45'])
  eq('5c. 其余段原样不动', r.periods.slice(2), DEF.slice(2))
  t('5d. 不修改入参', DEF[0].end === '08:45')
}
{
  // 段内大空档保留：只替换「等于原众数课间」的位置
  const r = reperiodSegment(MIX, 1, { dur: 45, gap: 10 })
  eq('5e. 段内 20 分钟空档保留（1→2 用新 gap，2→3 原样）', r.periods.map((p) => p.start + '-' + p.end),
    ['08:00-08:45', '08:55-09:40', '10:00-10:45'])
}
{
  const r = reperiodSegment(MIX, 1, { dur: 30, gap: 5 })
  eq('5f. 改小后 2→3 的 20 分钟空档仍保留', r.periods.map((p) => p.start + '-' + p.end),
    ['08:00-08:30', '08:35-09:05', '09:25-09:55'])
}
{
  const r = reperiodSegment(DEF, 2, { dur: 60, gap: 10 }) // 第 3–4 节 10:10–12:10，午休 14:00 前放得下
  t('5g. 60 分钟时段内重排 ok', r.ok === true)
  eq('5h. 第 3 段变 10:10–11:10 / 11:20–12:20', r.periods.slice(2, 4).map((p) => p.start + '-' + p.end), ['10:10-11:10', '11:20-12:20'])
}
{
  const r = reperiodSegment(DEF, 1, { dur: 120, gap: 10 }) // 08:00 + 120 + 10 + 120 → 越过第 3 节 10:10
  t('5i. 排过段边界 → ok=false', r.ok === false)
  t('5j. 原因是 overlap', r.reason === 'overlap')
}
{
  const r = reperiodSegment(DEF, 5, { dur: 300, gap: 60 }) // 18:30 起 → 跨午夜
  t('5k. 跨午夜 → reason midnight', r.ok === false && r.reason === 'midnight')
}

/* ---------- 6. 段内平移（改某节开始时间） ---------- */
{
  const r = shiftWithinSegment(DEF, 1, 0, '08:10', 45, '08:00')
  t('6a. 平移 ok', r.ok === true)
  eq('6b. 段内第 2 节顺移 10 分钟', r.periods.slice(0, 2).map((p) => p.start + '-' + p.end), ['08:10-08:55', '09:05-09:50'])
  eq('6c. 段外（第 3 节起）不动', r.periods.slice(2), DEF.slice(2))
}
{
  const r = shiftWithinSegment(DEF, 1, 1, '12:00', 45, '08:55') // 第 2 节推到 12:00 越午休
  t('6d. 平移越段边界 → overlap', r.ok === false && r.reason === 'overlap')
}
{
  const r = shiftWithinSegment(DEF, 1, 0, '23:00', 45, '08:00')
  t('6e. 平移跨午夜 → midnight', r.ok === false && r.reason === 'midnight')
}

/* ---------- 7. 加一节 / 删一节 ---------- */
{
  // 段内 3 节（末节 10:45 结束），段尾加一节：10:45 + 10 课间 = 10:55–11:40
  const r = addPeriodToSegment(MIX, 1, { dur: 45, gap: 10 })
  t('7a. 加一节 ok', r.ok === true)
  eq('7b. 新节接在段尾 10:55–11:40，全局重编号', r.periods.map((p) => p.no + ':' + p.start + '-' + p.end),
    ['1:08:00-08:45', '2:08:55-09:40', '3:10:00-10:45', '4:10:55-11:40'])
  t('7c. 加一节后 4 节', r.periods.length === 4)
  t('7d. 新增节留在第 1 段', segNosOf(r.periods).join(',') === '1,1,1,1')
  t('7e. 不修改入参', MIX.length === 3)
}
{
  const r = addPeriodToSegment(DEF, 5, { dur: 45, gap: 10 }) // 末段 20:10 结束 → 20:20–21:05
  t('7f. 末段加一节 ok', r.ok === true)
  eq('7g. 新节在末尾 20:20–21:05', r.periods[10].start + '-' + r.periods[10].end, '20:20-21:05')
}
{
  const r = addPeriodToSegment(DEF, 5, { dur: 600, gap: 10 })
  t('7h. 加一节会跨午夜 → 拒绝', r.ok === false && r.reason === 'midnight')
}
{
  const r = addPeriodToSegment(DEF, 1, { dur: 45, gap: 10 }) // 段尾 09:40 + 10 = 09:50，10:35 结束已越过第 3 节 10:10
  t('7i. 加一节会挤进下一段 → 拒绝', r.ok === false && r.reason === 'overlap')
}
{
  const r = removePeriodAt(DEF, 1) // 删第 2 节
  eq('7j. 删后重编号连续 1..9', r.map((p) => p.no), [1, 2, 3, 4, 5, 6, 7, 8, 9])
  eq('7k. 删的是 08:55–09:40 那节', r[1].start + '-' + r[1].end, '10:10-10:55')
  t('7l. 剩余 9 节', r.length === 9)
}
{
  const r = removePeriodAt(DEF, 0)
  eq('7m. 删首节后段号重编（第 1 段仍在最前）', segNosOf(r).slice(0, 3).join(','), '1,2,2')
}
{
  const r = removePeriodAt(MIX, 1) // 显式 seg 的表：删中间一节后段号仍连续
  eq('7n. 显式段号删除后压紧', r.map((p) => p.no + '/' + p.seg), ['1/1', '2/1'])
  t('7o. 显式段号不被清掉', r.every((p) => p.seg === 1))
}

/* ---------- 8. 并入上一段 / 在此分段 ---------- */
{
  const r = mergeSegmentUp(DEF, 2) // 第 3–4 节并入第 1 段
  eq('8a. 合并后段结构 {1,2,3,4}{5,6}{7,8}{9,10}', segNosOf(r), [1, 1, 1, 1, 2, 2, 3, 3, 4, 4])
  t('8b. 时间没被改动', JSON.stringify(r.map((p) => p.start + p.end)) === JSON.stringify(DEF.map((p) => p.start + p.end)))
  t('8c. 首段仍从 1 起编号', segmentView(r)[0].seg === 1)
}
{
  const r = mergeSegmentUp(EXPL, 2)
  eq('8d. 显式分段也能合并', segNosOf(r), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
}
{
  const r = splitSegmentAt(EXPL, 1) // 上午 4 节 → 在 2 和 3 之间切开
  eq('8e. 分段后 {1,2}{3,4}{5..10}', segNosOf(r), [1, 1, 2, 2, 3, 3, 3, 3, 3, 3])
}
t('8f. 末节之后分段无效（返回原表）', segNosOf(splitSegmentAt(DEF, 9)).join(',') === segNosOf(DEF).join(','))

/* ---------- 9. 归一化（保存前清洗） ---------- */
{
  const r = normalizeSegs([{ no: 1, start: '08:00', end: '08:45', seg: 0 }, { no: 2, start: '08:55', end: '09:40', seg: 'x' }])
  t('9a. 非法 seg 被清掉 → 回落派生', !('seg' in r[0]) && !('seg' in r[1]))
  const r2 = normalizeSegs(EXPL)
  eq('9b. 合法 seg 保留并连续化', r2.map((p) => p.seg), [1, 1, 1, 1, 2, 2, 2, 2, 2, 2])
  const r3 = normalizeSegs(clone(DEF))
  t('9c. 无 seg 的表不被强加 seg（保持与主项目一致的字段形状）', !('seg' in r3[0]))
}
{
  // 单段表：派生结果全 1 段，合并/分段应稳定
  const one = [{ no: 1, start: '08:00', end: '08:45', seg: 1 }, { no: 2, start: '08:55', end: '09:40', seg: 1 }]
  t('9d. 只有一段时并入上一段无效', segNosOf(mergeSegmentUp(one, 1)).join(',') === '1,1')
}

/* ---------- 10. 手工改时间后的段号同步（resyncSegs） ---------- */
{
  // 显式同段，但时间上第 2→3 节已有 30 分钟大空档 → 同步时裂开
  const T = [
    { no: 1, start: '08:00', end: '08:45', seg: 1 },
    { no: 2, start: '08:55', end: '09:40', seg: 1 },
    { no: 3, start: '10:10', end: '10:55', seg: 1 },
    { no: 4, start: '11:05', end: '11:50', seg: 1 },
  ]
  eq('10a. 段内出现大空档 → 同步时裂开', segNosOf(resyncSegs(T)), [1, 1, 2, 2])
  const C = [
    { no: 1, start: '08:00', end: '08:45', seg: 1 },
    { no: 2, start: '08:55', end: '09:40', seg: 2 },
  ]
  eq('10b. 时间连续但用户分了段 → 不会自动合并', segNosOf(resyncSegs(C)), [1, 2])
  t('10c. 无 seg 的表同步后仍不带 seg', !('seg' in resyncSegs(clone(DEF))[0]))
}

/* ---------- 11. reperiodAll：引导二级页的「全局 单节时长/课间」重排 ----------
   语义：每段以本段第一节的当前 start 为锚，段内按新 dur/gap 重排，节数不变；
   任何一段越段（overlap）或跨午夜（midnight）→ 整体拒绝。 */
{
  const r = reperiodAll(NEWDEF, { dur: 50, gap: 10 })
  t('11a. dur 50 全表重排 ok', r.ok === true)
  eq('11b. 第 1 段锚 08:00：5 节 08:00–12:50', r.periods.slice(0, 5).map((p) => p.start + '-' + p.end),
    ['08:00-08:50', '09:00-09:50', '10:00-10:50', '11:00-11:50', '12:00-12:50'])
  eq('11c. 第 2 段锚 14:00 不动段首', r.periods[5].start, '14:00')
  eq('11d. 第 3 段锚 19:00，末节 21:00–21:50', r.periods[12].start + '-' + r.periods[12].end, '21:00-21:50')
  t('11e. 节数不变（13）', r.periods.length === 13)
  t('11f. no 编号不变', r.periods.every((p, i) => p.no === i + 1))
}
{
  const r = reperiodAll(NEWDEF, { dur: 55, gap: 5 })
  eq('11g. dur55/gap5 第 1 段末节 12:55（08:00 起 5×55 + 4×5 课间）', r.periods[4].end, '12:55')
  eq('11h. 段间空档不参与（第 2 段仍锚 14:00）', r.periods[5].start, '14:00')
  t('11h2. 下午段末节 18:55 不会挤进晚上段', r.periods[9].end, '18:55')
}
{
  const one = [{ no: 1, start: '08:00', end: '08:45' }, { no: 2, start: '20:00', end: '20:45' }]
  const r = reperiodAll(one, { dur: 300, gap: 10 })
  t('11i. 第 2 段 300 分钟会跨午夜 → 整体拒绝', r.ok === false && r.reason === 'midnight')
}
{
  const r = reperiodAll(NEWDEF, { dur: 90, gap: 10 })
  t('11j. 第 1 段 5×90 会挤进下午段 → overlap 拒绝', r.ok === false && r.reason === 'overlap')
  eq('11k. 拒绝时不给半成品', r.periods, undefined)
}

await import('node:process')
const fails = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
