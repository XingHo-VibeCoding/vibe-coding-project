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
     · 不评判：写「期末还有 3 天」「今天建议复习 20:00–20:30」，
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
export const EXAM_TAG = 'web2-exam'
export const EXAM_CHANNEL = 'exam-reminder'

/* 看多远：14 天内有考试才进「考试周」口径，也只排这 14 天的提醒。 */
export const EXAM_LEAD_DAYS = 14
/* 一次复习建议多长时间（分钟）。与 01 的默认待办时长分开：
   复习是「坐下来看一门课」，30 分钟起步比 30 分钟一件活更合理。 */
export const REVIEW_BLOCK_MIN = 30
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

/* 一条考试的完整一行：地点 · 时间（缺的项自动略过，不拼出「· ·」） */
export function examMetaText(exam) {
  if (!exam) return ''
  const parts = []
  const t = examTimeText(exam)
  if (t) parts.push(t)
  if (exam.place) parts.push(exam.place)
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

/* ---------- 复习时间安排 ----------
   一场考试排未来 days 天的复习块：每天最多一块（一天塞两块等于排了也不会做），
   优先晚上 19:00 之后，晚上没有 ≥ REVIEW_BLOCK_MIN 的空档才退回白天。
   整块从空档里挖走，同一天不会与已排下的块重叠（carveSlots 保证）。

   itemsOfDay(dayKey) 由调用方提供（App 里现算 notify.js 的 buildScheduleItems），
   纯函数不碰插件 / 存储，node 单测可喂假数据。 */
export function reviewPlanFor(exam, {
  today = todayKey(),
  days = MAX_REVIEW_DAYS,
  itemsOfDay = null,
  settings = null,
  nowMin = null,
  durationOf = null,
  reviewMin = REVIEW_BLOCK_MIN,
} = {}) {
  if (!exam || typeof itemsOfDay !== 'function') return []
  const need = Number.isFinite(Number(reviewMin)) && Number(reviewMin) > 0 ? Math.round(Number(reviewMin)) : REVIEW_BLOCK_MIN
  /* days：正数照用；显式 0 或负数抬到 1 天（跑一次总得给出个安排）；
     不是数字（调用方没传）才回落 MAX_REVIEW_DAYS。
     ⚠ 不能写成 `Number(days) || MAX` —— 0 是有限数却被 `||` 当成「没传」。 */
  const rawDays = Number(days)
  const span = Number.isFinite(rawDays) ? Math.max(1, Math.round(rawDays)) : MAX_REVIEW_DAYS
  const blocks = []
  for (let i = 0; i < span; i += 1) {
    const dKey = addDaysKey(today, i)
    /* 考试当天及之后不再排复习（那天在考场，不在书桌）。
       注意：考试当天**不反对**，但「复习安排」只到考前一天 —— 当天另有提醒。 */
    if (compareDateKey(dKey, exam.date) >= 0) break
    const items = itemsOfDay(dKey)
    /* 先看晚上，再退回白天。freeSlots 只认「这天还剩哪些空档」。 */
    const base = Number.isFinite(Number(nowMin)) ? Math.max(0, Math.round(Number(nowMin))) : 0
    const notBefore = i === 0 ? base : 0
    let slots = freeSlots(items, settings, { durationOf })
    let got = carveSlots(slots, need, Math.max(notBefore, REVIEW_EVENING_FROM))
    if (!got) {
      slots = freeSlots(items, settings, { durationOf })
      got = carveSlots(slots, need, notBefore)
    }
    if (!got) continue
    blocks.push({
      date: dKey,
      start: got.start,
      end: got.end,
      time: hhmm(got.start) + '–' + hhmm(got.end),
      examId: exam.id,
      examTitle: exam.title,
    })
  }
  return blocks
}

/* 「考试周」视图：把接下来的考试与它们的复习块拼在一起。
   返回 { exams:[{...exam, blocks, todayBlocks:[], blockCount, reviewMins}], todayBlocks, next, line }。 */
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
  const out = []
  for (const e of list) {
    /* 只有「快到了」（soon）的考试才排复习 —— 还有 25 天就开始每天复习不合理，
       列出来让人看得到就够了（同 examNotices 的口径）。 */
    const blocks = e.soon
      ? reviewPlanFor(e, { today, days, itemsOfDay, settings, nowMin, durationOf, reviewMin })
      : []
    const todayBlocks = blocks.filter((b) => b.date === today)
    out.push(Object.assign({}, e, {
      blocks,
      todayBlocks,
      blockCount: blocks.length,
      reviewMins: blocks.length * reviewMin,
    }))
  }
  const todayBlocks = []
  for (const e of out) for (const b of e.todayBlocks) todayBlocks.push(Object.assign({}, b, { examText: e.text }))
  todayBlocks.sort((a, b) => a.start - b.start)
  const next = out.find((e) => e.todayBlocks.length) || null
  /* 「最近一场」指的是**快到了**的第一场：远期考试排在列表里给人看，
     但不该占着今日页那条「还有 25 天」的口径（那时还没到复习的时候）。 */
  const soon = out.filter((e) => e.soon)
  return {
    today,
    exams: out,
    soonExams: soon,
    todayBlocks,
    next,
    nearest: (soon.length ? soon : out)[0] || null,
    line: examPlanLine({ exams: out, todayBlocks, next }),
  }
}

/* 一句人话。**只陈述**，三种情况都给实话：
     · 今天有考试 → 「今天 09:00 高数」
     · 有复习块 → 「期末还有 3 天，今天建议复习 20:00–20:30」
     · 有考试但今天排不下 → 「期末还有 3 天，今天没空档了」
   没有考试在窗口内 → 空串（调用方据此不显示卡片）。 */
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
    return head + '，今天建议复习 ' + b.time
  }
  return head + '，今天没空档了'
}

/* ---------- 每晚一句轻提醒 ----------
   与复盘提醒、练耳提醒**各用各的标记**（EXAM_TAG），applySchedule 只清自己那一批。
   不带按钮：点通知回 App（onNotificationAction 按 extra.src === EXAM_TAG 判）。
   返回 [{key, at:Date, title, body}]；没有考试在窗口内就返回 []（不发空提醒）。 */
export function examNotices({
  exams = [],
  plan = null,
  settings = null,
  today = todayKey(),
  now = new Date(),
} = {}) {
  const cfg = sanitizeExamSettings(settings)
  const list = upcomingExams(exams, { today, leadDays: cfg.leadDays }).filter((e) => e.soon)
  if (!list.length) return []
  const atMin = minOf(cfg.at)
  if (atMin < 0) return []
  const byDate = {}
  for (const e of list) {
    if (!byDate[e.date]) byDate[e.date] = []
    byDate[e.date].push(e)
  }
  const out = []
  for (const e of list) {
    /* 考试当天早上单独一条：时间地点比倒计时更有用。 */
    if (e.daysLeft === 0) {
      const when = new Date(`${e.date}T${EXAM_DAY_AT}:00`)
      if (!Number.isNaN(when.getTime()) && when.getTime() > now.getTime()) {
        const t = examTimeText(e)
        out.push({
          key: `exd_${e.id}_${e.date}`,
          at: when,
          title: '今天有考试：' + e.title,
          body: [t, e.place].filter(Boolean).join(' · ') || '加油（这条只是提醒，别紧张）',
        })
      }
    }
    /* 每晚一条：最近那一场 + 今天的复习建议（今天没排下就说明天再排）。 */
    const when = new Date(`${e.date}T${cfg.at}:00`)
    const at = new Date(new Date(`${today}T${cfg.at}:00`).getTime())
    if (Number.isNaN(at.getTime())) continue
    if (e.daysLeft === 0 && when.getTime() <= now.getTime()) continue
    /* 每晚只发最近那一场，不按考试数刷屏。 */
    if (byDate[e.date][0].id !== e.id) continue
    if (at.getTime() <= now.getTime()) continue
    const block = plan && plan.exams
      ? (plan.exams.find((x) => x.id === e.id) || {}).todayBlocks
      : null
    const tip = block && block.length ? '今天建议复习 ' + block[0].time : '今天没空档也没关系，明天再说'
    out.push({
      key: `ex_${e.id}_${today}`,
      at,
      title: e.title + ' ' + e.text,
      body: tip,
    })
    if (out.length >= MAX_NOTICES) break
  }
  return out
}
