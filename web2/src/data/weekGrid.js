// 周课表网格：把「课程 / 日程 / 识别结果」映射成 CSS Grid 坐标的纯函数。
//
// 为什么单独抽出来：正式课表（按时间区间落格）和识别核对页的「预览表」（按第几节落格）
// 必须长得一模一样——两套各写一遍，改一边忘一边，视觉就会悄悄漂移（这正是旧时间轴
// 画法留下的教训）。这里只负责「列表 → 格子坐标」的换算，渲染与交互留在组件里。
//
// 坐标口径：行 = 节次（含午休/晚休分隔行），列 = 星期（1 = 周一）。
// 行号从 1 起，且分隔行也占一个行号，所以「节次下标 → 行号」必须查 rowIndexMap。

import { segmentView, timeToMin } from './periods.js'

export const GRID_AXIS_W = 46 // 左侧「第N节 / 08:00」栏宽

/* 分隔行文案：按「这一段什么时候开始」判断。
   不能只看空档长度：默认表晚休只有 35 分钟（18:25–19:00），按长度会掉进「课间」，
   但它其实是晚饭时间 —— 所以先用开始时间落在哪个时段来判断。 */
export function gapLabel(v) {
  const st = timeToMin(v.start) // 本段第一节的开始时间
  if (v.gapBefore >= 60) {
    if (st >= 11 * 60 && st < 15 * 60) return '午休'
    if (st >= 17 * 60) return '晚休'
    return `空档 ${v.gapBefore} 分钟`
  }
  if (v.gapBefore >= 25) return st >= 17 * 60 ? '晚休' : `大课间 ${v.gapBefore} 分钟`
  return `课间 ${v.gapBefore} 分钟`
}

/* 网格行：逐节次铺开，段与段之间插一条分隔行（午休 / 晚休 / 大课间）。
   分隔行是为了补回「网格里看不见的时间差」—— 一个课间和一次午休在网格里都是「一行」高，
   必须靠分隔条把上午/下午/晚上三块分开，否则会以为课都连着上。 */
export function buildGridRows(periods) {
  const ps = Array.isArray(periods) ? periods : []
  const segs = segmentView(ps)
  const rows = []
  for (let i = 0; i < ps.length; i++) {
    const s = segs.find((v) => v.from === i)
    if (s && s.gapBefore !== null) rows.push({ type: 'gap', label: gapLabel(s), gap: s.gapBefore })
    rows.push({ type: 'p', idx: i, p: ps[i] })
  }
  return rows
}

/* 节次下标 → 行号（1 起；表头不在网格内，分隔行各占一个行号） */
export function rowIndexMap(rows) {
  const m = new Map()
  ;(Array.isArray(rows) ? rows : []).forEach((r, i) => {
    if (r.type === 'p') m.set(r.idx, i + 1)
  })
  return m
}

/* 时间区间 → 节次下标区间。判据是「时间区间覆盖了哪些节次」，比「起止时间与节次边界
   精确相等」宽容得多：自己填的课基本都对得上；从图片识别导入的课（时刻是抄来的）
   也不会掉到格子外，而是被就近吸进覆盖到的节次里 —— 真实时间在课卡角标里保留。 */
export function courseRowRange(c, periods) {
  const ps = Array.isArray(periods) ? periods : []
  if (!ps.length) return [0, 0]
  const s = timeToMin(c.start)
  const e = timeToMin(c.end)
  let from = -1
  let to = -1
  for (let i = 0; i < ps.length; i++) {
    const a = timeToMin(ps[i].start)
    const b = timeToMin(ps[i].end)
    if (a < e && b > s) {
      if (from < 0) from = i
      to = i
    }
  }
  if (from < 0) {
    /* 完全落在节次表之外（比如 07:00 的早课）：吸附到时间上最近的节次 */
    let best = 0
    let bd = Infinity
    for (let i = 0; i < ps.length; i++) {
      const d = Math.min(Math.abs(timeToMin(ps[i].start) - s), Math.abs(timeToMin(ps[i].end) - e))
      if (d < bd) {
        bd = d
        best = i
      }
    }
    from = to = best
  }
  return [from, to]
}

/* 节次号（第几节，1 起）→ 节次下标区间。识别结果里存的正是「第几节」。
   节次号在当前表里找不到（用户删过节次）时按序号就近夹紧，不让这条课掉出网格。 */
export function secRowRange(startSec, endSec, periods) {
  const ps = Array.isArray(periods) ? periods : []
  if (!ps.length) return [0, 0]
  const idxOf = (n) => {
    const k = ps.findIndex((p) => Number(p.no) === Number(n))
    if (k >= 0) return k
    const num = Number(n)
    if (!Number.isFinite(num)) return 0
    let best = 0
    let bd = Infinity
    for (let i = 0; i < ps.length; i++) {
      const d = Math.abs(Number(ps[i].no) - num)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }
  const a = idxOf(startSec)
  const b = idxOf(endSec)
  return a <= b ? [a, b] : [b, a]
}

/* 落格项：同一格（同一天 + 同一节）有多条时横向平分 —— 否则会互相盖住。
   直接在传入的数组上写 level / count，返回同一个数组。 */
export function assignLevels(items) {
  const list = Array.isArray(items) ? items : []
  const byCell = new Map()
  for (const it of list) {
    const k = it.wd + '-' + it.from
    if (!byCell.has(k)) byCell.set(k, [])
    byCell.get(k).push(it)
  }
  for (const arr of byCell.values()) {
    arr.forEach((it, i) => {
      it.level = i
      it.count = arr.length
    })
  }
  return list
}

/* 落格项 → CSS Grid 内联样式（gridColumn / gridRow / 平分用的左右外边距） */
export function gridStyleOf(it, rowMap) {
  const r1 = rowMap.get(it.from) || 1
  const r2 = rowMap.get(it.to) || r1
  const w = 100 / it.count
  return {
    gridColumn: it.wd + 1,
    gridRow: `${r1} / ${r2 + 1}`,
    marginLeft: it.count > 1 ? `${it.level * w}%` : '',
    marginRight: it.count > 1 ? `${(it.count - 1 - it.level) * w}%` : '',
  }
}

/* 课程起止是否与节次边界精确对齐：不齐时格子里要角标标出真实时间（比如 13:40 这种） */
export function isAligned(c, periods) {
  const ps = Array.isArray(periods) ? periods : []
  return ps.some((p) => p.start === c.start) && ps.some((p) => p.end === c.end)
}

/* 正式课表用：课程/日程列表 → 落格项（按时间区间） */
export function courseItems(list, periods) {
  return assignLevels(
    (Array.isArray(list) ? list : []).map((c) => {
      const [from, to] = courseRowRange(c, periods)
      return { c, wd: Number(c.weekday), from, to, level: 0, count: 1 }
    })
  )
}

/* 预览表用：识别结果 → 落格项（按第几节） */
export function previewItems(items, periods) {
  return assignLevels(
    (Array.isArray(items) ? items : []).map((it) => {
      const [from, to] = secRowRange(it.startSec, it.endSec, periods)
      return { c: it, wd: Number(it.weekday), from, to, level: 0, count: 1 }
    })
  )
}

/* 同格重叠：同一格（同一天 + 同一个起始节次）落了 2 条以上。
   识别时同一门课常被认成两条，重叠摆出来比藏起来好——返回分组供顶部点名。 */
export function findCellOverlaps(items) {
  const byCell = new Map()
  for (const it of Array.isArray(items) ? items : []) {
    const k = it.wd + '-' + it.from
    if (!byCell.has(k)) byCell.set(k, [])
    byCell.get(k).push(it)
  }
  const out = []
  for (const [k, arr] of byCell) {
    if (arr.length < 2) continue
    const [wd, from] = k.split('-').map(Number)
    const to = Math.max(...arr.map((x) => x.to))
    out.push({ wd, from, to, items: arr })
  }
  return out
}
