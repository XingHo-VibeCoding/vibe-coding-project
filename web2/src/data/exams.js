/* 考试周模式（五条新功能线 04）—— 接下来的考试 × 复习时间安排 × 每晚一句轻提醒。
   口径（2026-10-15 立项，用户 m24447 明确要三件事）：
     「我想看到接下来的考试安排以及复习时间安排，最好催我复习」

   为什么不能自动抓：**教务导出的 xlsx 里没有考试列**（8 列表头只有课程代码/名称/教师/
   学期/上课时间/地点/选课时间/志愿），所以自动识别考试周做不到。只能人手加。
   两个入口：① 「我的 → 考试与复习」里手动加；② 录音纪要里提到考试的作业条目
   一颗「加入考试」按钮（复用 02 的 parseDueHint 把老师说的日期解析出来）。

   纪律（与前几条一致）：
     · 纯逻辑：不碰 DOM / localStorage（除自己那个键）/ 原生插件。node 单测直接喂假数据。
     · **只建议，不落库**：复习安排只是「建议哪段空档」，不自动写课表、不自动建待办。
     · 空档口径复用 listen.js 的 freeSlots()，与练耳、反向排课共用同一套 —— 不另算一套。
     · 不评判：写「期末还有 3 天」「今晚 19:00–20:30 复习」，
       绝不写「你怎么还不复习」「再不看就来不及了」。
     · 复习时段优先落在晚上（19:00 之后）；晚上实在没空档才退回白天 —— 白天有课是常态。
     · 一个新键 `web2.exams`，老数据没有它 ⇒ 空列表，行为与加这层之前一致（不动 store.js，
       不升 schema_version）。
*/

import { freeSlots, minOf, hhmm, isTimeStr, todayKey, addDaysKey, compareDateKey } from './listen.js'
import { carveSlots } from './planner.js'

export const EXAMS_KEY = 'web2.exams'
export const EXAM_SET_KEY = 'web2.exam.set'
/* 提醒批次标记与渠道：applySchedule 只清 extra.src === 自己 的那批，所以必须独立
   （同 LISTEN_TAG / REVIEW_TAG 的纪律 —— 共用一个标记会互相清掉）。 */
/* 教务同步进来的考试，id 以它开头（'ks_' = 考试）。**这里是唯一真源**：
   zdbkExam.js 的 EXAM_ID_PREFIX 直接引用本常量，所以界面上「这是同步来的」与
   数据层「这是同步来的」永远是同一个判断，不会各写一份然后走偏。 */
export const EXAM_SYNC_PREFIX = 'ks_'

export const EXAM_TAG = 'web2-exam'
export const EXAM_CHANNEL = 'exam-reminder'

/* 看多远：14 天内有考试才进「考试周」口径，也只排这 14 天的提醒。 */
export const EXAM_LEAD_DAYS = 14
/* 每天那一段复习时间多长（分钟）。2026-10-23 用户改口径：不再按考试切成 30 分钟小块，
   而是**一天划一整块**，看哪门交给 AI 建议（reviewAdvice.js）。
   90 分钟 = 坐下来能真正看进去一段的长度；比 30 分钟更接近「复习」这件事本身。 */
export const REVIEW_BLOCK_MIN = 90
/* 复习时段优先从几点开始找（晚上）。晚上排不下才退回白天。 */
export const REVIEW_EVENING_FROM = 19 * 60
/* 一场考试最多给几天的复习安排（只看考前 MAX_REVIEW_DAYS 天）。 */
export const MAX_REVIEW_DAYS = 7
/* 考试当天早上的那一条提醒时刻。 */
export const EXAM_DAY_AT = '07:30'

export const EXAM_DEFAULTS = {
  enabled: true, // 默认开：用户明确要「催我复习」
  at: '20:00', // 每晚一句，比复盘提醒（23:00）早，不挤在一起
  leadDays: EXAM_LEAD_DAYS,
}

/* 同时排的提醒条数上限（防呆：考试很多时别刷屏） */
export const MAX_NOTICES = 40

function isDateKey(s) {
  const d = String(s || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  /* 格式对 ≠ 日期真实存在：new Date('2026-02-30') 会自己滚到 03-02，
     所以回头核对解析出来的年月日与原串是否逐字一样（同 store.js 的 sameLocalDate）。 */
  const t = new Date(d + 'T00:00:00')
  if (Number.isNaN(t.getTime())) return false
  const y = t.getFullYear()
  const m = String(t.getMonth() + 1).padStart(2, '0')
  const dd = String(t.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}` === d
}

/* 清洗一条考试。认不出的一律返回 null（丢条目比留一条假考试安全）。 */
export function sanitizeExam(v) {
  if (!v || typeof v !== 'object') return null
  const title = String(v.title == null ? '' : v.title).trim()
  const date = String(v.date == null ? '' : v.date).trim()
  if (!title || !isDateKey(date)) return null
  /* 时间：没填就空串（不猜）；填了必须是合法 HH:mm，非法就丢掉这个时间而不是丢掉整条。 */
  const start = isTimeStr(v.start) ? String(v.start) : ''
  let end = isTimeStr(v.end) ? String(v.end) : ''
  /* 结束早于开始等于没填（考试不会跨零点）。 */
  if (start && end && minOf(end) <= minOf(start)) end = ''
  const id = String(v.id == null ? '' : v.id).trim() || `ex_${date}_${title.slice(0, 8)}`
  const at = Number(v.created_at)
  return {
    id,
    title,
    date,
    start,
    end,
    place: String(v.place == null ? '' : v.place).trim(),
    note: String(v.note == null ? '' : v.note).trim(),
    created_at: Number.isFinite(at) && at > 0 ? Math.round(at) : 0,
  }
}

export function sanitizeExamList(list) {
  const arr = Array.isArray(list) ? list : []
  const out = []
  const seen = new Set()
  for (const x of arr) {
    const e = sanitizeExam(x)
    if (!e) continue
    if (seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
  }
  /* 按日期 + 时间排序：这是「接下来的考试安排」唯一合理的顺序。 */
  out.sort((a, b) => {
    const c = compareDateKey(a.date, b.date)
    if (c !== 0) return c
    const am = a.start ? minOf(a.start) : 24 * 60
    const bm = b.start ? minOf(b.start) : 24 * 60
    if (am !== bm) return am - bm
    return a.title.localeCompare(b.title)
  })
  return out
}

export function newExam(input, now = Date.now()) {
  const e = sanitizeExam(Object.assign({}, input, { created_at: input && input.created_at ? input.created_at : now }))
  if (!e) return null
  const id = `${e.id}_${String(now).slice(-6)}${Math.random().toString(36).slice(2, 6)}`
  return Object.assign({}, e, { id })
}

export function loadExams() {
  try {
    if (typeof localStorage === 'undefined') return []
    return sanitizeExamList(JSON.parse(localStorage.getItem(EXAMS_KEY) || '[]'))
  } catch (e) {
    return []
  }
}

export function saveExams(list) {
  const clean = sanitizeExamList(list)
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(EXAMS_KEY, JSON.stringify(clean))
  } catch (e) {
    /* 存不下就算：考试表不是关键数据，写失败不能让界面崩（同 daily.js 口径） */
  }
  return clean
}

/* 距考试还有几天：正数 = 还有几天，0 = 今天，负数 = 已经考过。非法日期返回 null。 */
export function daysLeftOf(dateKey, today = todayKey()) {
  if (!isDateKey(dateKey) || !isDateKey(today)) return null
  const a = new Date(dateKey + 'T00:00:00')
  const b = new Date(today + 'T00:00:00')
  return Math.round((a.getTime() - b.getTime()) / 86400000)
}

/* 倒计时的人话。**只陈述，不催**。 */
export function countdownText(days) {
  if (days === null || days === undefined) return ''
  if (days === 0) return '今天'
  if (days === 1) return '明天'
  if (days < 0) return '已考过'
  return '还有 ' + days + ' 天'
}

/* 接下来的考试：从今天起（含今天）**全部**未来的考试，按日期升序。
   已经考过的默认不回来 —— 这个视图的标题就是「接下来的考试」。
   `soon` 标记「在 leadDays 天内」：只有它才进考试周口径（排复习、发提醒），
   远期考试照样列出来让人看得到，只是不催 —— 「还有 25 天」还不该开始复习。 */
export function upcomingExams(exams, { today = todayKey(), leadDays = EXAM_LEAD_DAYS, includePast = false } = {}) {
  const list = sanitizeExamList(exams)
  const win = Number(leadDays) >= 0 ? Number(leadDays) : EXAM_LEAD_DAYS
  const out = []
  for (const e of list) {
    const days = daysLeftOf(e.date, today)
    if (days === null) continue
    if (!includePast && days < 0) continue
    const soon = days >= 0 && days <= win
    out.push(Object.assign({}, e, { daysLeft: days, soon, text: countdownText(days) }))
  }
  return out
}

/* 考试当天的时间串：「09:00–11:00」/「09:00」/''（没填时间） */
export function examTimeText(exam) {
  if (!exam) return ''
  if (exam.start && exam.end) return exam.start + '–' + exam.end
  return exam.start || ''
}

/* 从「老师念考试的那句话」里削出一个能当标题的词（五条路线 04 的第二个入口）。
   原话通常长这样：「期末考试 11 月 20 日 09:30 东1-101」——
   日期与时刻下面的表单字段已经各有一个了，留在标题里既重复又长。
   削完剩不到 2 个字就退回原文：宁可长一点，也不能把科目名削没了。
   纯函数，node 可直接单测。 */
export function examTitleFrom(text, max = 40) {
  const raw = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  if (!raw) return ''
  const cut = raw
    .replace(/\d{1,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/g, ' ')
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*日/g, ' ')
    .replace(/\d{1,2}\s*[:：]\s*\d{2}(\s*[-–~至]\s*\d{1,2}\s*[:：]\s*\d{2})?/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s·、,，:：;；\-–]+|[\s·、,，:：;；\-–]+$/g, '')
    .trim()
  return (cut.length >= 2 ? cut : raw).slice(0, max)
}

/**
 * 考场那一格该写什么。
 *   · 有就写有；
 *   · 手填的没填 → 返回空串（**不催**：自己加的时候知道自己在干嘛）；
 *   · 教务同步来的却是空 → 写「考场待公布」。
 * 最后一条是 2026-10-23 真机实测逼出来的：6 场未来考试的 jsmc/zwxh 全为空，
 * 因为学校通常考前 2-3 周才排考场。若整项不显示，用户会以为我们漏拿了考场。
 */
export function examPlaceText(exam) {
  if (!exam) return ''
  const p = String(exam.place || '').trim()
  if (p) return p
  return String(exam.id || '').indexOf(EXAM_SYNC_PREFIX) === 0 ? '考场待公布' : ''
}

/* 一条考试的完整一行：地点 · 时间（缺的项自动略过，不拼出「· ·」） */
export function examMetaText(exam) {
  if (!exam) return ''
  const parts = []
  const t = examTimeText(exam)
  if (t) parts.push(t)
  const place = examPlaceText(exam)
  if (place) parts.push(place)
  if (exam.note) parts.push(exam.note)
  return parts.join(' · ')
}

/* 读取提醒设置（缺项回落默认值；enabled 只认显式 false）。 */
export function sanitizeExamSettings(v) {
  const s = v && typeof v === 'object' ? v : {}
  const at = isTimeStr(s.at) ? String(s.at) : EXAM_DEFAULTS.at
  const lead = Number(s.leadDays)
  return {
    enabled: s.enabled !== false,
    at,
    leadDays: Number.isFinite(lead) && lead >= 0 && lead <= 60 ? Math.round(lead) : EXAM_DEFAULTS.leadDays,
  }
}

export function loadExamSettings() {
  try {
    if (typeof localStorage === 'undefined') return Object.assign({}, EXAM_DEFAULTS)
    return sanitizeExamSettings(JSON.parse(localStorage.getItem(EXAM_SET_KEY) || 'null'))
  } catch (e) {
    return Object.assign({}, EXAM_DEFAULTS)
  }
}

export function saveExamSettings(patch) {
  const next = sanitizeExamSettings(Object.assign({}, loadExamSettings(), patch || {}))
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(EXAM_SET_KEY, JSON.stringify(next))
  } catch (e) {
    /* 同上 */
  }
  return next
}

/* ---------- 复习时间安排（2026-10-23 改口径：一天一整块，不再按考试切碎） ----------
   旧做法：**每场考试各自**去课表空档里挖 30 分钟，挖的时候互相看不见。
   实测三场考试 → 全都落在同一天同一个 19:00–19:30，7 处重叠（真机复现）。

   新做法：**一天只挖一块**（REVIEW_BLOCK_MIN = 90 分钟），所有考试共用这一块。
   一天之内只有一个人挖、只挖一次 ⇒ 重叠在结构上不可能发生，不需要冲突检测。
   到点先看哪一门交给 AI 建议（reviewAdvice.js），这一层只负责「把时间留出来」。

   纪律不变：
     · 优先晚上（19:00 之后），晚上排不下才退回白天 —— 白天有课是常态；
     · 考试当天及之后，那场考试不再排复习（那天在考场，不在书桌）；
     · 排不下就明说没空档，不硬塞、不编假安排。

   itemsOfDay(dayKey) 由调用方提供（App 里现算 notify.js 的 buildScheduleItems），
   纯函数不碰插件 / 存储，node 单测可喂假数据。 */

/* 每天一段的复习块。返回 [{ date, start, end, time, mins, exams:[{id,title,daysLeft,text}] }]，
   exams 是「这一天还算得上的考试」，按日期升序（最近的排最前 = 兜底句说的「先看」）。 */
export function reviewDaysFor({
  exams = [],
  today = todayKey(),
  days = MAX_REVIEW_DAYS,
  itemsOfDay = null,
  settings = null,
  nowMin = null,
  durationOf = null,
  blockMin = REVIEW_BLOCK_MIN,
} = {}) {
  if (typeof itemsOfDay !== 'function') return []
  const need = Number.isFinite(Number(blockMin)) && Number(blockMin) > 0
    ? Math.round(Number(blockMin)) : REVIEW_BLOCK_MIN
  /* days：正数照用；显式 0 或负数抬到 1 天（跑一次总得给出个安排）；
     不是数字（调用方没传）才回落 MAX_REVIEW_DAYS。
     ⚠ 不能写成 `Number(days) || MAX` —— 0 是有限数却被 `||` 当成「没传」。 */
  const rawDays = Number(days)
  const span = Number.isFinite(rawDays) ? Math.max(1, Math.round(rawDays)) : MAX_REVIEW_DAYS
  const list = (Array.isArray(exams) ? exams : [])
    .filter((e) => e && isDateKey(e.date))
    .slice()
    .sort((a, b) => compareDateKey(a.date, b.date))
  if (!list.length) return []
  const out = []
  for (let i = 0; i < span; i += 1) {
    const dKey = addDaysKey(today, i)
    /* 这一天「还算得上」的考试 = 考试日在这天之后的（考试当天不给那场排复习）。 */
    const eligible = list.filter((e) => compareDateKey(dKey, e.date) < 0)
    if (!eligible.length) continue
    const items = itemsOfDay(dKey)
    const base = Number.isFinite(Number(nowMin)) ? Math.max(0, Math.round(Number(nowMin))) : 0
    const notBefore = i === 0 ? base : 0
    /* 先看晚上，再退回白天。freeSlots 只认「这天还剩哪些空档」。 */
    let got = carveSlots(freeSlots(items, settings, { durationOf }), need, Math.max(notBefore, REVIEW_EVENING_FROM))
    if (!got) got = carveSlots(freeSlots(items, settings, { durationOf }), need, notBefore)
    if (!got) continue
    out.push({
      date: dKey,
      start: got.start,
      end: got.end,
      time: hhmm(got.start) + '–' + hhmm(got.end),
      mins: got.end - got.start,
      exams: eligible.map((e) => {
        const dl = Number.isFinite(Number(e.daysLeft)) ? Number(e.daysLeft) : daysLeftOf(e.date, today)
        return { id: String(e.id || ''), title: String(e.title || ''), daysLeft: dl, text: countdownText(dl) }
      }),
    })
  }
  return out
}

/* 单场考试的复习块（保留给「只想看这一场」的调用方与老单测）。
   内部走 reviewDaysFor，所以口径与界面上的「一天一整块」永远一致。 */
export function reviewPlanFor(exam, opts = {}) {
  if (!exam || !isDateKey(exam.date)) return []
  return reviewDaysFor(Object.assign({}, opts, { exams: [exam] })).map((d) => ({
    date: d.date,
    start: d.start,
    end: d.end,
    time: d.time,
    examId: exam.id,
    examTitle: exam.title,
  }))
}

/* 「考试周」视图：把接下来的考试与「每天那一段复习时间」拼在一起。
   返回 { exams:[{...exam, blocks, todayBlocks, blockCount, reviewMins}], reviewDays,
          todayReview, todayBlocks, next, nearest, line }。
   blocks 是**过渡字段**：这场考试参与的那几天（共享同一块时间），
   界面上的「建议复习 N 段」到 S4 改成页面顶部那段共用时间，此字段届时再撤。 */
export function planExams({
  exams = [],
  today = todayKey(),
  leadDays = EXAM_LEAD_DAYS,
  itemsOfDay = null,
  settings = null,
  nowMin = null,
  durationOf = null,
  days = MAX_REVIEW_DAYS,
  reviewMin = REVIEW_BLOCK_MIN,
} = {}) {
  const list = upcomingExams(exams, { today, leadDays })
  /* 只有「快到了」（soon）的考试才排复习 —— 还有 25 天就开始每天复习不合理，
     列出来让人看得到就够了（同 examNotices 的口径）。 */
  const soonList = list.filter((e) => e.soon)
  const reviewDays = soonList.length
    ? reviewDaysFor({ exams: soonList, today, days, itemsOfDay, settings, nowMin, durationOf, blockMin: reviewMin })
    : []
  /* 每场考试 → 它参与的那几天（同一块时间，谁也不会和谁撞）。 */
  const byExam = {}
  for (const d of reviewDays) {
    for (const x of d.exams) {
      if (!byExam[x.id]) byExam[x.id] = []
      byExam[x.id].push(d)
    }
  }
  const out = list.map((e) => {
    const mine = byExam[e.id] || []
    return Object.assign({}, e, {
      blocks: mine,
      todayBlocks: mine.filter((b) => b.date === today),
      blockCount: mine.length,
      reviewMins: mine.reduce((s, b) => s + Number(b.mins || 0), 0),
    })
  })
  const todayReview = reviewDays.find((d) => d.date === today) || null
  const first = todayReview && todayReview.exams.length ? todayReview.exams[0] : null
  /* 今天那一段（0 或 1 条）。examId / examTitle / examText 都指向「最近那一场」，方便一行显示；
     exams 数组仍是这段里**全部**考试（多场共用一块，谁也别以为今晚只复习一门）。 */
  const todayBlocks = todayReview
    ? [Object.assign({}, todayReview, {
      examId: first ? first.id : '',
      examTitle: first ? first.title : '',
      examText: first ? first.text : '',
    })]
    : []
  const next = out.find((e) => e.todayBlocks.length) || null
  /* 「最近一场」指的是**快到了**的第一场：远期考试排在列表里给人看，
     但不该占着今日页那条「还有 25 天」的口径（那时还没到复习的时候）。 */
  const soon = out.filter((e) => e.soon)
  return {
    today,
    exams: out,
    soonExams: soon,
    reviewDays,
    todayReview,
    todayBlocks,
    next,
    nearest: (soon.length ? soon : out)[0] || null,
    line: examPlanLine({ exams: out, todayBlocks, next }),
  }
}

/* 一句人话。**只陈述**，三种情况都给实话：
     · 今天有考试 → 「今天 09:00 高数」
     · 有复习块 → 「期末还有 3 天，今天建议复习 19:00–20:30（这段还有 2 场要准备）」
     · 有考试但今天排不下 → 「期末还有 3 天，今天没空档了」
   没有考试在窗口内 → 空串（调用方据此不显示卡片）。
   ⚠ 2026-10-23：一天只剩一整块之后，这块是**多场考试共用**的。只报最近那一场会让人
     以为今晚只复习那一门，所以这段里还有别的考试时明说还有几场（只报数，不评判）。 */
export function examPlanLine(plan) {
  if (!plan || !plan.exams || !plan.exams.length) return ''
  /* 「考试周」口径只对**快到了**的考试说话；只有远期考试时给一句不催的实情，
     不写成「还有 25 天，今天建议复习…」（那是在替用户制造焦虑）。 */
  const soon = plan.soonExams && plan.soonExams.length ? plan.soonExams : null
  if (!soon) {
    const far = plan.exams[0]
    return '最近一场：' + far.title + ' ' + far.text
  }
  const first = soon[0]
  const examToday = soon.find((e) => e.daysLeft === 0)
  if (examToday) {
    const t = examTimeText(examToday)
    return '今天 ' + (t ? t + ' ' : '') + examToday.title
  }
  const head = first.title + ' ' + first.text
  if (plan.todayBlocks && plan.todayBlocks.length) {
    const b = plan.todayBlocks[0]
    const rest = Array.isArray(b.exams) ? b.exams.length - 1 : 0
    return head + '，今天建议复习 ' + b.time + (rest > 0 ? '（这段还有 ' + rest + ' 场要准备）' : '')
  }
  return head + '，今天没空档了'
}

/* ---------- 每晚一句轻提醒 ----------
   与复盘提醒、练耳提醒**各用各的标记**（EXAM_TAG），applySchedule 只清自己那一批。
   不带按钮：点通知回 App（onNotificationAction 按 extra.src === EXAM_TAG 判）。
   返回 [{key, at:Date, title, body}]；没有考试在窗口内就返回 []（不发空提醒）。

   ⚠ 2026-10-23 改口径（用户 m00666「新口径合成一条」）：
     旧做法**每场考试各发一条**，三场考试 20:00 连响三次，正文还都是同一段时间。
     现在「一天一整块」了，所以提醒也**一天一条**：
       · 标题 = 最近那一场（还没考的第一场）+ 倒计时；
       · 正文 = 今天那一段 + 这段里还有几场要准备；
       · key 去掉考试 id（`ex_${today}`）—— 时间点固定，同一天不会因为改了考试而重复推。
     考试当天早上那条 `exd_` 保持**每场一条**：那天就是考那场，时间地点必须点名。 */
export function examNotices({
  exams = [],
  plan = null,
  settings = null,
  today = todayKey(),
  now = new Date(),
} = {}) {
  const cfg = sanitizeExamSettings(settings)
  /* upcomingExams 只过滤不排序（它的调用方各自要不同顺序），这里要「最近那一场」，先按日期排。 */
  const list = upcomingExams(exams, { today, leadDays: cfg.leadDays })
    .filter((e) => e.soon)
    .sort((a, b) => compareDateKey(a.date, b.date))
  if (!list.length) return []
  const atMin = minOf(cfg.at)
  if (atMin < 0) return []
  const out = []
  /* ① 考试当天早上：每场一条（时间地点比倒计时有用，两场就两条）。 */
  for (const e of list) {
    if (e.daysLeft !== 0) continue
    const when = new Date(`${e.date}T${EXAM_DAY_AT}:00`)
    if (Number.isNaN(when.getTime()) || when.getTime() <= now.getTime()) continue
    const t = examTimeText(e)
    out.push({
      key: `exd_${e.id}_${e.date}`,
      at: when,
      title: '今天有考试：' + e.title,
      body: [t, e.place].filter(Boolean).join(' · ') || '加油（这条只是提醒，别紧张）',
    })
    if (out.length >= MAX_NOTICES) return out
  }
  /* ② 每晚一条（合成）。「最近那一场」只认**还没考**的：今天刚考完还催今晚复习是错的。 */
  const next = list.find((e) => e.daysLeft > 0)
  if (!next) return out
  const at = new Date(`${today}T${cfg.at}:00`)
  if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return out
  const block = plan
    ? (plan.todayReview || (plan.todayBlocks && plan.todayBlocks[0]) || null)
    : null
  let tip = '今天没空档也没关系，明天再说'
  if (block) {
    const rest = Array.isArray(block.exams) ? block.exams.length - 1 : 0
    tip = '今天建议复习 ' + block.time + (rest > 0 ? ' · 还有 ' + rest + ' 场要准备' : '')
  }
  out.push({ key: `ex_${today}`, at, title: next.title + ' ' + next.text, body: tip })
  return out
}
