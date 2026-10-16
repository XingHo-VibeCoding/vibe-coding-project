/* 五条线 03（2026-10-16）：时间去哪了 —— 把每日快照里的几件事摆到同一条横轴上看。
   为什么单独一个模块：`daily.js` 只负责「每天记一条」，「怎么读成一张卡」是另一件事，
   混进去会让那个文件既管写入又管措辞；这里纯读、纯聚合，node 里能直接单测。

   四条纪律（与前几条线同一套）：
     1. 纯逻辑：不碰 DOM / localStorage / 原生插件，数据都从参数进来。
     2. **只呈现，不评判** —— 这条是本职要求：一旦写成「你手机玩太多了」，
        整个 App 的调性就从「如实呈现」变成「管教」。所以本文件里没有「超标」「应该」「少玩点」，
        也**不做任何排名、打分、红黄灯**。有单测按禁词表盯着（见 tmp/timeline-unit.mjs 的 F 组）。
     3. **不假装完整**：那天没抓到手机时长就照实说「未开启」，不画成 0。
        `null` 与 `0` 在整条链路上都是两件事（详见 daily.js 的 usage_ms 注释）。
     4. **缺的天不补空行**（与 daily.js/recentDays 同口径）：只画真记过的日子，
        不然用户会看到一排 0 以为自己那天什么都没干。

   本模块只输出「事实 + 措辞」，具体画成什么样由界面决定。 */
import { sanitizeDay, sanitizeUsageMs, recentDays, dayLine, todayKeyOf } from './daily.js'

export const WEEK_N = 7

/* 两种形状都能读：`daily.js` 的原始快照用 `usage_ms`，本模块的 `timelineRow()` 用 `usageMs`。
   ⚠ 两者只差一个下划线 —— 只认一个的话，`timelineView()` 把行喂回来时**全部会被当成「没抓到」**，
   界面就会在明明有数的日子上说「未开启」。这两种形状都收，是刻意的容错，不是含糊。 */
function usageOf(d) {
  if (!d || typeof d !== 'object') return null
  const raw = d.usageMs !== undefined ? d.usageMs : d.usage_ms
  return sanitizeUsageMs(raw)
}

/* 一周里「手机时长」这一类：有几个有效数字、加起来多少、日均多少。
   ⚠ 日均只拿**有数的天**去平均（`null` 的天不进分母）——
   把没抓到的天当 0 会把日均压低，那是最典型的数据说谎方式。 */
export function usageAcross(days) {
  const list = Array.isArray(days) ? days : []
  const known = list.map(usageOf).filter((n) => n !== null)
  const total = known.reduce((s, n) => s + n, 0)
  const kept = known.length
  return {
    kept,
    missing: list.length - kept,
    totalMs: total,
    avgMs: kept ? Math.round(total / kept) : 0,
    /* 一天都没抓到 → has=false，界面走「未开启」而不是画个 0 */
    has: kept > 0,
  }
}

/* 把一条快照压成卡上要的一行事实。**只挑事实，不算比值、不打分。** */
export function timelineRow(day) {
  const d = sanitizeDay(day)
  if (!d) return null
  const s = d.stats
  return {
    date: d.date,
    courses: s.courses,
    todosDone: s.todosDone,
    todosTotal: s.todosTotal,
    habitsDone: s.habitsDone,
    habitsTotal: s.habitsTotal,
    listened: s.listenToday,
    /* null = 那天没抓到（未开启），数字 = 真时长；两者在界面上长得不一样 */
    usageMs: d.usage_ms === null || d.usage_ms === undefined ? null : sanitizeUsageMs(d.usage_ms),
    /* 复用 daily.js 的同一句小结，避免「历史那页」和「这张卡」各说各话 */
    line: dayLine(d),
  }
}

/* 一行里「手机」那一格的话。**没有数据就说没有数据**，绝不写 0m。 */
export function usageCellText(ms) {
  if (ms === null || ms === undefined) return '未开启'
  const n = sanitizeUsageMs(ms)
  if (n === null) return '未开启'
  if (n === 0) return '没使用'
  return formatShort(n)
}

/* 自己算一份小时/分钟文案，不 import usageStats.js —— 那边的 formatMs 是给「使用时长」模块用的，
   这里要的粒度是「整数分钟为主」，两边别互相绑。（不到 1 分钟照实说不到 1 分钟。） */
export function formatShort(ms) {
  const n = Math.max(0, Number(ms) || 0)
  if (n < 60000) return '不到 1 分钟'
  const min = Math.round(n / 60000)
  const h = Math.floor(min / 60)
  const m = min % 60
  if (!h) return `${m} 分钟`
  if (!m) return `${h} 小时`
  return `${h} 小时 ${m} 分`
}

/* 卡上那句总述。**三种情况三句实话**，都不评判：
     · 一天都没抓到 → 说明没开权限，指路而不是催
     · 有数 → 说实话（含「有 N 天没抓到」，不把缺的天藏起来）
     · 没有任何一天的快照 → 说还没攒起来
   措辞硬规矩：不出现 加油/努力/赶紧/必须/懒/拖延/超标/少玩/应该 —— 见 F 组单测。 */
export function timelineLine({ days = [], usage = null, n = WEEK_N } = {}) {
  const list = Array.isArray(days) ? days : []
  if (!list.length) return '还没有攒下记录，用几天就会出现。'
  const u = usage || usageAcross(list)
  if (!u.has) return `最近 ${list.length} 天里手机数据没抓到，开了「使用情况访问」才会显示。`
  const bits = [`最近 ${list.length} 天里有 ${u.kept} 天抓到手机数据，平均每天 ${formatShort(u.avgMs)}`]
  if (u.missing > 0) bits.push(`另有 ${u.missing} 天没抓到`)
  return bits.join('，') + '。'
}

/* 日期 → 「10 月 16 日 周五」。纯字符串算，不 new Date（`new Date('2026-10-16')` 会按 UTC 解析，
   在东八区可能退回前一天 —— 这类差一天的错最容易被当成「App 记错了」）。 */
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
export function dateLabel(dateKey, todayKey = '') {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''))
  if (!m) return String(dateKey || '')
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const t = Date.UTC(y, mo - 1, d)
  const wd = WD[new Date(t).getUTCDay()]
  const base = `${mo} 月 ${d} 日 ${wd}`
  return dateKey === todayKey ? `${base} · 今天` : base
}

/* 一次性把卡要的东西都算好，界面不再自己拼。 */
export function timelineView(book, { n = WEEK_N, today = todayKeyOf() } = {}) {
  const days = recentDays(book, n).map(timelineRow).filter(Boolean)
  const usage = usageAcross(days)
  const rows = days.map((d) => Object.assign({}, d, {
    label: dateLabel(d.date, today),
    usageText: usageCellText(d.usageMs),
    /* 「有数」与「没抓到」在界面上必须长得不一样，这里预先算好，免得每个调用点各判一次 */
    usageKnown: d.usageMs !== null,
  }))
  return {
    n,
    today,
    days: rows,
    usage,
    line: timelineLine({ days, usage, n }),
  }
}
