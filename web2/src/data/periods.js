// 分段式节次表：纯函数（无 DOM、无 localStorage），供 PeriodsEditor 组件与单测使用。
//
// 为什么分段：一天里的「课间」不是一个数——小课间 10 分钟、大课间 30 分钟、午休 2 小时、
// 晚休 40 分钟混在一起，用一个「课间」参数整表重排会把午休一起改掉（用户实测反馈）。
// 规则：相邻两节间隔 > SEG_GAP（15 分钟）视为段边界；段内改「时长/课间」只重排本段，
// 只替换段内「普通课间」（众数），大空档原样保留。
//
// 段号存法：periods 元素上可带 seg（1 起的整数）。全部元素都带合法 seg 时以它为准（可手动
// 并入上一段 / 在指定位置分段）；只要有元素缺失或非法，就全部忽略、按上面的间隔规则派生。
// 这样主项目导出的 periods（不带 seg）能直接用，也不会给导出 JSON 强加新字段。

export const SEG_GAP = 15 // 分钟：相邻两节间隔超过它 → 视作跨段（大课间/午休/晚休）
const DAY_END = 1439 // 23:59

function toMin(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t == null ? '' : t))
  if (!m) return -1
  return Number(m[1]) * 60 + Number(m[2])
}
/* 'HH:mm' → 分钟；解析不了给 -1（供 UI 做轻量校验） */
export const timeToMin = toMin
function fmtMin(min) {
  const pad = (n) => String(n).padStart(2, '0')
  return pad(Math.floor(min / 60)) + ':' + pad(min % 60)
}
function clone(list) {
  return (Array.isArray(list) ? list : []).map((p) => ({ ...p }))
}
function isValidSeg(v) {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1
}
/* 众数（出现最多的值），平票取小；空数组给 fallback */
function mode(arr, fallback) {
  if (!arr.length) return fallback
  const cnt = new Map()
  for (const v of arr) cnt.set(v, (cnt.get(v) || 0) + 1)
  let best = null
  let bestN = -1
  for (const [v, n] of cnt) {
    if (n > bestN || (n === bestN && v < best)) {
      best = v
      bestN = n
    }
  }
  return best
}
/* no 重编号 1..n（按数组顺序，数组顺序即时间顺序） */
function renumber(list) {
  return list.map((p, i) => ({ ...p, no: i + 1 }))
}
/* 段号压缩：连续的相同段号合一，只按「出现更大的段号」切段 → 空段消失、从 1 起连续。
   逆序/重复的脏段号会被拉到当前段（不产生回跳的碎段）。 */
function compactSegs(list) {
  if (!list.length) return list
  let cur = 1
  let max = Number(list[0].seg)
  list[0].seg = 1
  for (let i = 1; i < list.length; i++) {
    const v = Number(list[i].seg)
    if (v > max) {
      cur++
      max = v
    }
    list[i].seg = cur
  }
  return list
}

/* ---------- 分段 ---------- */

/* 每节的段号（与 periods 等长，1 起） */
export function segNosOf(periods) {
  const list = Array.isArray(periods) ? periods : []
  if (!list.length) return []
  const explicit = list.every((p) => isValidSeg(p && p.seg))
  const out = [1]
  if (explicit) {
    let cur = 1
    let max = Number(list[0].seg)
    for (let i = 1; i < list.length; i++) {
      const v = Number(list[i].seg)
      if (v > max) {
        cur++
        max = v
      }
      out.push(cur)
    }
    return out
  }
  for (let i = 1; i < list.length; i++) {
    const pe = toMin(list[i - 1] && list[i - 1].end)
    const st = toMin(list[i] && list[i].start)
    const gap = pe >= 0 && st >= 0 ? st - pe : 0
    out.push(gap > SEG_GAP ? out[i - 1] + 1 : out[i - 1])
  }
  return out
}

/* 段视图：[{ seg, from, to, nos, start, end, gapBefore }]
   gapBefore = 与上一段之间的空档分钟（首段 null）——UI 用它显示「午休 11:50–14:00」 */
export function segmentView(periods) {
  const list = Array.isArray(periods) ? periods : []
  const nos = segNosOf(list)
  const out = []
  for (let i = 0; i < list.length; i++) {
    const s = nos[i]
    const last = out[out.length - 1]
    if (last && last.seg === s) {
      last.to = i
      last.nos.push(Number(list[i].no))
      last.end = String(list[i].end)
    } else {
      out.push({
        seg: s,
        from: i,
        to: i,
        nos: [Number(list[i].no)],
        start: String(list[i].start),
        end: String(list[i].end),
        gapBefore: null,
      })
    }
  }
  for (let k = 1; k < out.length; k++) {
    const pe = toMin(list[out[k - 1].to].end)
    const st = toMin(list[out[k].from].start)
    out[k].gapBefore = pe >= 0 && st >= 0 ? st - pe : null
  }
  return out
}

/* 段级辅助默认值：段内时长取众数、段内普通课间取众数（平票取小）；推不出回落 45/10 */
export function inferSegAssist(periods, seg) {
  const list = Array.isArray(periods) ? periods : []
  const g = segmentView(list).find((v) => v.seg === seg)
  if (!g) return { dur: 45, gap: 10 }
  const durs = []
  const gaps = []
  for (let i = g.from; i <= g.to; i++) {
    const s = toMin(list[i].start)
    const e = toMin(list[i].end)
    if (s >= 0 && e > s) durs.push(e - s)
  }
  for (let i = g.from; i < g.to; i++) {
    const e = toMin(list[i].end)
    const s2 = toMin(list[i + 1].start)
    if (e >= 0 && s2 >= e) gaps.push(s2 - e)
  }
  return { dur: mode(durs, 45), gap: mode(gaps, 10) }
}

/* ---------- 段内编辑 ---------- */

/* 段内整表重排：段首开始时间不动，段内每节 start→start+dur，
   段内「普通课间」（等于原众数的位置）替换为新 gap，其它空档（大课间）原样保留。
   不越段（末节结束晚于下一段第一节开始 → overlap）、不跨午夜 → midnight。 */
export function reperiodSegment(periods, seg, opts) {
  const list = clone(periods)
  const g = segmentView(list).find((v) => v.seg === seg)
  if (!g) return { ok: false, reason: 'input' }
  const d = Math.round(Number(opts && opts.dur))
  const gp = Math.round(Number(opts && opts.gap))
  if (!(d > 0) || !(gp >= 0)) return { ok: false, reason: 'input' }
  const base = inferSegAssist(list, seg).gap
  const oldGaps = []
  for (let i = g.from; i < g.to; i++) {
    const e = toMin(list[i].end)
    const s2 = toMin(list[i + 1].start)
    oldGaps.push(e >= 0 && s2 >= 0 ? s2 - e : null)
  }
  let t = toMin(list[g.from].start)
  if (t < 0) return { ok: false, reason: 'input' }
  for (let i = g.from; i <= g.to; i++) {
    if (t + d > DAY_END) return { ok: false, reason: 'midnight' }
    list[i] = { ...list[i], start: fmtMin(t), end: fmtMin(t + d) }
    if (i < g.to) {
      let gap = oldGaps[i - g.from]
      if (gap === null || gap < 0 || gap === base) gap = gp
      t = t + d + gap
    }
  }
  if (g.to < list.length - 1 && toMin(list[g.to].end) > toMin(list[g.to + 1].start)) {
    return { ok: false, reason: 'overlap' }
  }
  return { ok: true, periods: list }
}

/* 段内改某节「开始时间」：该节 end = start + dur，段内其后各节整体平移 delta，
   段外不动。越段 → overlap，跨午夜 → midnight。prevStart 需在覆盖输入框前记下再传。 */
export function shiftWithinSegment(periods, seg, idx, newStart, dur, prevStart) {
  const list = clone(periods)
  const g = segmentView(list).find((v) => v.seg === seg)
  if (!g || !(idx >= g.from && idx <= g.to)) return { ok: false, reason: 'input' }
  const s = toMin(newStart)
  const d = Math.round(Number(dur))
  if (s < 0 || !(d > 0)) return { ok: false, reason: 'input' }
  const raw = prevStart === undefined || prevStart === null || prevStart === '' ? list[idx].start : prevStart
  const old = toMin(raw)
  const delta = old >= 0 ? s - old : 0
  list[idx] = { ...list[idx], start: fmtMin(s), end: fmtMin(s + d) }
  for (let i = idx + 1; i <= g.to; i++) {
    const st = toMin(list[i].start) + delta
    const en = toMin(list[i].end) + delta
    if (st < 0 || en < 0) return { ok: false, reason: 'midnight' }
    list[i] = { ...list[i], start: fmtMin(st), end: fmtMin(en) }
  }
  for (let i = idx; i <= g.to; i++) {
    if (toMin(list[i].end) > DAY_END) return { ok: false, reason: 'midnight' }
  }
  if (g.to < list.length - 1 && toMin(list[g.to].end) > toMin(list[g.to + 1].start)) {
    return { ok: false, reason: 'overlap' }
  }
  return { ok: true, periods: list }
}

/* 段尾加一节：时间 = 段内末节结束 + 当前课间（界面上段级的 gap）；
   越段 / 跨午夜则拒绝（段边界不可被挤掉，先让用户把本段排紧或手工改下一段）。 */
export function addPeriodToSegment(periods, seg, opts) {
  const list = clone(periods)
  const g = segmentView(list).find((v) => v.seg === seg)
  if (!g) return { ok: false, reason: 'input' }
  const d = Math.round(Number(opts && opts.dur))
  const gp = Math.round(Number(opts && opts.gap))
  if (!(d > 0) || !(gp >= 0)) return { ok: false, reason: 'input' }
  const lastEnd = toMin(list[g.to].end)
  if (lastEnd < 0) return { ok: false, reason: 'input' }
  const st = lastEnd + gp
  if (st + d > DAY_END) return { ok: false, reason: 'midnight' }
  if (g.to < list.length - 1 && st + d > toMin(list[g.to + 1].start)) return { ok: false, reason: 'overlap' }
  const item = { no: 0, start: fmtMin(st), end: fmtMin(st + d) }
  if (isValidSeg(list[g.to].seg)) item.seg = Number(list[g.to].seg)
  list.splice(g.to + 1, 0, item)
  return { ok: true, periods: renumber(list) }
}

/* 删一节：no 重编号 1..n；原表带 seg 则段号同步压紧，不带则保持不带（回落派生） */
export function removePeriodAt(periods, idx) {
  const list = clone(periods)
  if (!(idx >= 0 && idx < list.length)) return list
  const had = list.length > 0 && list.every((p) => isValidSeg(p && p.seg))
  const segs = segNosOf(list)
  const out = []
  for (let i = 0; i < list.length; i++) {
    if (i === idx) continue
    const p = { ...list[i] }
    if (had) p.seg = segs[i]
    else delete p.seg
    out.push(p)
  }
  if (had) compactSegs(out)
  return renumber(out)
}

/* 把 seg 段并入上一段（只改分段，不动任何时间） */
export function mergeSegmentUp(periods, seg) {
  const list = clone(periods)
  const view = segmentView(list)
  if (!(seg >= 2 && view.some((v) => v.seg === seg))) return renumber(list)
  const segs = segNosOf(list)
  /* 段号 ≥ seg 的整体 -1：seg 段并入上一段，其后各段顺势前移 */
  const out = list.map((p, i) => ({ ...p, seg: segs[i] >= seg ? segs[i] - 1 : segs[i] }))
  return renumber(out)
}

/* 在第 idx 节与第 idx+1 节之间手动分段（idx 之后各段段号 +1） */
export function splitSegmentAt(periods, idx) {
  const list = clone(periods)
  if (!(idx >= 0 && idx < list.length - 1)) return renumber(list)
  const segs = segNosOf(list)
  return renumber(list.map((p, i) => ({ ...p, seg: i > idx ? segs[i] + 1 : segs[i] })))
}

/* 全表按「全局 单节时长 / 课间」重排（引导二级页用）：
   每段以本段第一节的当前 start 为锚（用户改过的段首不丢），段内按新 dur/gap 重排、节数不变。
   先把原分段固化成显式 seg 再重排——否则 dur 变大后段间空档被挤到 < SEG_GAP，
   派生分段会把两段并掉、后面的段锚直接消失（单测 11a 抓出）。
   任何一段越段（overlap）/跨午夜（midnight）→ 整体拒绝，不给半成品。 */
export function reperiodAll(periods, opts) {
  const segs = segNosOf(periods)
  let list = clone(periods).map((p, i) => ({ ...p, seg: segs[i] }))
  for (const seg of [...new Set(segs)]) {
    const r = reperiodSegment(list, seg, opts)
    if (!r.ok) return r
    list = r.periods
  }
  return { ok: true, periods: normalizeSegs(list) }
}

/* 保存前清洗：全部元素有合法 seg → 压紧段号后保留；否则清掉 seg（回落派生）。
   不会给本来没有 seg 的表强加 seg（保持与主项目一致的最小字段形状）。 */
export function normalizeSegs(periods) {
  const list = clone(periods)
  if (!list.length) return list
  if (!list.every((p) => isValidSeg(p && p.seg))) {
    for (const p of list) delete p.seg
    return renumber(list)
  }
  const segs = segNosOf(list)
  return renumber(list.map((p, i) => ({ ...p, seg: segs[i] })))
}

/* 手工改过某节时间后，让显式段号跟时间对齐：出现大空档（> SEG_GAP）的位置自动裂开。
   只增不减——已有的段边界不会被自动合并（合并是用户的显式动作，得由「并入上一段」来做）。
   表本身不带 seg 时什么都不做。 */
export function resyncSegs(periods) {
  const list = clone(periods)
  if (!list.length) return list
  if (!list.every((p) => isValidSeg(p && p.seg))) return renumber(list)
  const nos = segNosOf(list)
  let cur = 1
  const out = []
  for (let i = 0; i < list.length; i++) {
    if (i > 0) {
      const pe = toMin(list[i - 1].end)
      const st = toMin(list[i].start)
      const gap = pe >= 0 && st >= 0 ? st - pe : 0
      if (gap > SEG_GAP || nos[i] > nos[i - 1]) cur++
    }
    out.push({ ...list[i], seg: cur })
  }
  return renumber(out)
}
