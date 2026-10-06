// web2 数据层：示例数据（mock）或主项目导出 JSON（app:'sched'），单一出口。
// 字段口径完全对齐主项目 store.js / Rules.js：
//   课程: type 'course' + weekday(1-7) + start_time(HH:mm) + duration(分钟) + week_rule(every/odd/even)
//   独立日程: type 'event' + date(YYYY-MM-DD)
//   待办: title + due_date(YYYY-MM-DD) + done
//   学期: name + first_monday + total_weeks，当前周次 = floor(距 first_monday 天数/7)+1
import { semester as mockSemester, weekCourses as mockWeekCourses, todos as mockTodos } from './mock.js'

export const DATA_KEY = 'web2.data'
/* 用户在 web2 里手动加的课程（叠加在 mock / 导入数据之上，不影响主项目） */
export const ADDED_KEY = 'web2.added'

function loadAdded() {
  try {
    const arr = JSON.parse(localStorage.getItem(ADDED_KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/* 加一门课：补 id 和 added 标记后落盘 */
export function addCourse(c) {
  const arr = loadAdded()
  arr.push({ ...c, id: 'a' + Date.now(), type: 'course', added: true })
  localStorage.setItem(ADDED_KEY, JSON.stringify(arr))
}

/* 重复判定 key（同星期+同起止时间+同课名+同周规则视为同一门课） */
function dupKeyOf(c) {
  return `${c.weekday}|${c.start}|${c.end}|${c.name}|${c.week_rule || 'every'}`
}

/* 数一下 web2.added 里有几门重复（只读不删）：「清理重复课程」按钮只在有重复时显示
   （2026-10-01 用户拍板：没有这种 bug 就不摆这个按钮） */
export function countAddedDups() {
  const seen = new Set()
  let dups = 0
  for (const c of loadAdded()) {
    if (c.type !== 'course') continue
    const k = dupKeyOf(c)
    if (seen.has(k)) dups++
    else seen.add(k)
  }
  return dups
}

/* 清理 web2.added 里重复的课程（同星期+同时间+同名+同周规则视为重复，保留第一条） */
export function dedupAdded() {
  const arr = loadAdded()
  const seen = new Set()
  const next = []
  for (const c of arr) {
    if (c.type !== 'course') {
      next.push(c)
      continue
    }
    const key = dupKeyOf(c)
    if (seen.has(key)) continue
    seen.add(key)
    next.push(c)
  }
  const removed = arr.length - next.length
  if (removed) localStorage.setItem(ADDED_KEY, JSON.stringify(next))
  return removed
}

/* 删一门手动加的课（只能删自己加的，mock / 导入数据不受影响） */
export function removeCourse(id) {
  localStorage.setItem(ADDED_KEY, JSON.stringify(loadAdded().filter((c) => c.id !== id)))
}

/* 编辑一门手动加的课：合并字段，保留原 id */
export function updateCourse(id, patch) {
  const arr = loadAdded()
  const i = arr.findIndex((x) => x.id === id)
  if (i === -1) return
  arr[i] = { ...arr[i], ...patch }
  localStorage.setItem(ADDED_KEY, JSON.stringify(arr))
}

function pad(n) {
  return String(n).padStart(2, '0')
}
function dateStr(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}
/* "HH:mm" → 当天第几分钟。
   也接受 "YYYY-MM-DDTHH:mm"（完整日期时间）——只取时间部分；
   ?t= 后门开着时页面里的「今天」仍然是真实今天，所以带日期不会把日期也一起冻结。
   注：刻意不走 new Date()，避免时区/夏令时把测试结果弄成 NaN。 */
export function minOf(t) {
  const s = String(t).slice(-5)            // "2026-10-06T09:00" → "09:00"；"09:00" → 原样
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

/* 开录时把场次关联到课程（M5 交互优化）：现在这个分钟数落在哪节课的覆盖时间内
   （含开课前 5 分钟的提前量——学生常在打铃前进教室开录），就关联哪节。
   入参是「今天的课程/日程」列表（todayCourses 的形状：含 start/end/title/id），
   返回命中的那条或 null——绝不拿「今天第一节」之类兜底顶替，宁可不关联。

   两条规则都只用「这两节课自己的开始/结束时间」，不看课间长度——课间由用户在
   节次表里自定义（可能是 3 分钟，也可能是 90 分钟的午休），任何「按固定课间推算」
   的写法都会在非默认作息下失效。

   规则一（多命中取后一节）：课间 < 5 分钟时，后一节的提前窗会吃到前一节的尾巴，
   同一分钟同时命中两节。取结束最晚的那条 = 更晚开始的那条，也就是「马上要上的课」。
   紧挨着的课（课间 0 分钟）同样落在这一支，不会被误挂到前一节。

   规则二（快下课的不认）：命中的课剩余不足 COVER_TAIL_MIN 分钟，就认为「不是在录
   这节课」而返回 null。典型场景是前一节 08:45 下课、学生 08:45 进教室为下一节开录：
   照认的话自动停会按前一节排（08:47），刚开录就被掐断。返回 null 的语义是
   「认不出」——不挂课名、不排自动停，交回手动停；比错挂一节课安全。 */
export const COVER_TAIL_MIN = 3
export function courseCovering(courses, minutes) {
  const m = Number(minutes) || 0
  let best = null
  let bestEnd = -1
  for (const c of courses || []) {
    const s = minOf(c.start)
    const e = minOf(c.end)
    if (m >= s - 5 && m <= e && e > bestEnd) {
      best = c
      bestEnd = e
    }
  }
  if (!best) return null
  if (bestEnd - m < COVER_TAIL_MIN) return null
  return best
}

/* M5 作业转待办用：算「这门课下次上课」的日期（YYYY-MM-DD）。
   courses：整周课表；semester：{ week, firstMonday, totalWeeks }；wdNow：今天 weekday（1–7，周一=1）。
   本周今天之后还排着这节课（且本周符合周次规则）→ 用本周的；否则下周同一槽位；
   学期周数之外 / 找不到槽位 / 缺 firstMonday → null（调用方回落「明天」）。 */
export function nextCourseDate(courses, semester, wdNow, courseName) {
  if (!semester || !semester.firstMonday) return null
  const slots = courses.filter((c) => c.name === courseName)
  const wk = Number(semester.week) || 1
  const thisWeek = slots.filter((c) => c.weekday > wdNow && matchWeek(c, wk, semester.subTerms)).sort((a, b) => a.weekday - b.weekday)[0]
  const nextWeek = slots.filter((c) => matchWeek(c, wk + 1, semester.subTerms)).sort((a, b) => a.weekday - b.weekday)[0]
  const pick = thisWeek || nextWeek
  if (!pick) return null
  const targetWk = thisWeek ? wk : wk + 1
  if (targetWk > semester.totalWeeks) return null
  const d = new Date(semester.firstMonday + 'T00:00:00')
  d.setDate(d.getDate() + (targetWk - 1) * 7 + (pick.weekday - 1))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fmtMin(min) {
  return pad(Math.floor(min / 60)) + ':' + pad(min % 60)
}

/* P12a：课程的周次标签。
   没有 weeks（老数据/mock/手动加课）→ 老口径「每周 / 单周 / 双周」；
   有 weeks（教务导入）→ 说人话：连续区间写 `1-8 周`，否则列前几个；单/双周仍优先这么叫。 */
export function weekTagOf(c) {
  const w = c && Array.isArray(c.weeks) && c.weeks.length ? c.weeks.slice().sort((a, b) => a - b) : null
  if (!w) return { every: '每周', odd: '单周', even: '双周' }[c && c.week_rule] || ''
  const isOdd = w.every((x) => x % 2 === 1)
  const isEven = w.every((x) => x % 2 === 0)
  if (isOdd && w.length > 2) return '单周'
  if (isEven && w.length > 2) return '双周'
  const contiguous = w.every((x, i) => i === 0 || x === w[i - 1] + 1)
  if (contiguous) return w.length === 1 ? `第 ${w[0]} 周` : `${w[0]}-${w[w.length - 1]} 周`
  return w.length <= 4 ? w.join('、') + ' 周' : `${w.length} 个指定周`
}

/* 周次规则（移植自主项目 Rules.matchWeek）
 *
 * P12a 扩展（2026-10-06）：教务导出的课表带**任意周次集合**（`{单周}` → [1,3,5,…,15]、
 * `{1-8周}` → [1..8]、`{1-8,10-16周}` → 两段合并），原来的 every/odd/even 三档表达不了。
 * 所以课程多了一个可选字段 `weeks: number[]`：
 *   · 有 weeks（非空数组）→ 只认它，weekNo 在里面才算有课；
 *   · 没有 weeks → **完全走原来的 every/odd/even 分支**，老数据（主项目导出 JSON、
 *     mock、手动加的课）行为一模一样，不受影响。
 * 注意 weeks 为 null 表示「没有周次信息」，按「每周」处理 —— 这与「有 weeks 但不在里面」
 * 是两回事，不能混（前者是每周都有，后者是这周没课）。 */
/* ---------- P13 小学期（一个大学期分成两半） ----------
   用户 2026-10-06 拍板：**秋/冬各 8 周对半分**、做成学期设置里可编辑、短学期（暑假）先不管。
   为什么要这个：课程上的「学期」文本分三档 —— 秋（只在前半段上）/ 冬（只在后半段）/ 秋冬（整学期）。
   不做这一层的话，只上前半段的课会在整 16 周里都显示出来（用户当场发现的问题）。
   存在 `semester.subTerms`，跟节次表 `periods` 同一处（都是校历参数，且跟着主项目 JSON 导出走）。 */

/** 默认小学期表：按总周数对半分（16 周 → 秋 1-8 / 冬 9-16）。老数据没有这个字段就走它。 */
export function defaultSubTerms(totalWeeks) {
  const n = Math.max(1, Math.floor(Number(totalWeeks) || 16))
  const half = Math.ceil(n / 2)
  return [
    { name: '秋', from: 1, to: half },
    { name: '冬', from: half + 1, to: n },
  ]
}

/** 取小学期表：学期里存了就清洗着用（名字非空、from≤to、都 ≥1），否则按总周数对半分兜底。
    两种拼写都认：主项目原文是 snake（sub_terms / total_weeks），界面层是 camel（subTerms / totalWeeks）。 */
export function subTermsOf(semester) {
  const raw = semester && (semester.subTerms || semester.sub_terms)
  if (Array.isArray(raw)) {
    const clean = []
    for (const x of raw) {
      if (!x) continue
      const name = String(x.name == null ? '' : x.name).trim()
      if (!name) continue
      const from = Math.max(1, Math.floor(Number(x.from) || 1))
      const to = Math.max(from, Math.floor(Number(x.to) || from))
      clean.push({ name, from, to })
    }
    if (clean.length) return clean
  }
  const tw = semester && (semester.totalWeeks != null ? semester.totalWeeks : semester.total_weeks)
  return defaultSubTerms(tw)
}

/* P12a/P13：这门课在第 weekNo 周上不上。
   weekNo：第几周；subTerms：小学期表（不传 = 不做小学期判断，行为与 P13 之前完全一致）。
   判断顺序：先看小学期（课程写了「秋/冬」就只在该小学期出现的周里出现；
   写「秋冬」时两个小学期名都命中 → 并集 = 整学期），再看 weeks，最后回落 every/odd/even。 */
export function matchWeek(c, weekNo, subTerms) {
  if (!(weekNo > 0)) return false
  if (c && c.term && Array.isArray(subTerms) && subTerms.length) {
    const hit = subTerms.filter((s) => String(c.term).indexOf(s.name) >= 0)
    /* 命中了小学期名、但这一周不在它的范围内 → 这周不上。
       （没命中任何小学期名，比如「短学期」或认不出的写法 → 不做限制，照旧） */
    if (hit.length && !hit.some((s) => weekNo >= s.from && weekNo <= s.to)) return false
  }
  if (c && Array.isArray(c.weeks) && c.weeks.length) return c.weeks.indexOf(weekNo) !== -1
  const r = c.week_rule || 'every'
  if (r === 'every') return true
  if (r === 'odd') return weekNo % 2 === 1
  if (r === 'even') return weekNo % 2 === 0
  return false
}

/* 当前周次（移植自主项目 Rules.currentWeekNo） */
export function currentWeekNo(firstMonday, today = new Date()) {
  const start = new Date(firstMonday + 'T00:00:00')
  const target = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const diffDays = Math.round((target - start) / 86400000)
  if (diffDays < 0) return 0 // 还没开学
  return Math.floor(diffDays / 7) + 1
}

/* 待办截止显示：今天 / 明天 / M.D
   没有截止日期时返回空串 —— 上层（周清单 listDateLabel）会退化成「无截止日期」，
   不能让它算出 Invalid Date 后拼出 `NaN.NaN`。 */
function dueLabel(ds) {
  if (!ds) return ''
  const d = new Date(ds + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return ''
  const today0 = new Date()
  const diff = Math.round((d - new Date(today0.getFullYear(), today0.getMonth(), today0.getDate())) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff < 0) return '已过期'
  return (d.getMonth() + 1) + '.' + d.getDate()
}

/* ---------- 示例数据 ---------- */
function buildMock() {
  return {
    source: 'mock',
    semester: {
      name: mockSemester.name,
      totalWeeks: mockSemester.totalWeeks,
      firstMonday: null,
      week: mockSemester.week,
    },
    courses: applyCourseOverlay([...mockWeekCourses.map((c) => ({
      ...c,
      type: 'course',
      week_rule: 'every',
      place: [c.location, c.teacher].filter(Boolean).join(' · '),
    })), ...loadAdded()]),
    events: allEvents([]),
    routines: allRoutines([]),
    todos: applyTodoOverlay(mockTodos),
  }
}

/* ---------- 主项目导出 JSON → web2 结构 ---------- */
function buildFromExport(data) {
  if (!data || data.app !== 'sched') throw new Error('不是主项目导出的文件（缺少 app:"sched" 标识）。')
  const sem = data.semester
  if (!sem || !sem.first_monday || !(Number(sem.total_weeks) >= 1)) {
    throw new Error('文件里缺少学期信息（first_monday / total_weeks）。')
  }
  const schedules = Array.isArray(data.schedules) ? data.schedules : []

  const courses = schedules
    .filter((s) => s && s.type === 'course' && (!s.semester_id || s.semester_id === sem.id))
    .map((s) => ({
      id: s.id,
      type: 'course',
      weekday: Number(s.weekday),
      name: s.title,
      place: String(s.location || '').trim(),
      /* P12a：带 weeks 的课（教务导入）标签写实际周次，否则还是每周/单周/双周 */
      tag: weekTagOf(s),
      start: s.start_time,
      end: fmtMin(minOf(s.start_time) + Number(s.duration)),
      week_rule: s.week_rule,
      /* P12a：把周次集合透传到界面层，matchWeek 认它 */
      weeks: Array.isArray(s.weeks) && s.weeks.length ? s.weeks.slice() : null,
      term: s.term || '',
      teacher: s.teacher || '',
    }))

  const events = schedules
    .filter((s) => s && s.type === 'event')
    .map((s) => ({
      id: s.id,
      type: 'event',
      weekday: null,
      name: s.title,
      place: String(s.location || '').trim(),
      tag: '日程',
      date: s.date,
      start: s.start_time,
      end: fmtMin(minOf(s.start_time) + Number(s.duration)),
    }))

  /* 固定循环日程：不做学期过滤（跨学期常驻，semester_id 可空） */
  const routines = schedules
    .filter((s) => s && s.type === 'routine')
    .map(rvDisplay)

  const todos = (Array.isArray(data.todos) ? data.todos : []).map((t) => ({
    id: t.id,
    title: t.title,
    done: !!t.done,
    due: dueLabel(t.due_date),
    due_date: t.due_date,
  }))

  return {
    source: 'import',
    semester: {
      name: sem.name,
      totalWeeks: Number(sem.total_weeks),
      firstMonday: sem.first_monday,
      week: currentWeekNo(sem.first_monday),
      periods: Array.isArray(sem.periods) ? sem.periods : [],
      /* P13：小学期（秋/冬，各占一半周数）。跟 periods 放同一处 —— 都是"校历参数"，
         且跟着主项目 JSON 导出走；老数据没有这个字段时按总周数对半分兜底。 */
      subTerms: subTermsOf(sem),
    },
    courses: [...courses, ...loadAdded()],
    events: allEvents(events),
    routines: allRoutines(routines),
    todos,
  }
}

/* ---------- 对外 API ---------- */
export function loadDataset() {
  try {
    const raw = localStorage.getItem(DATA_KEY)
    if (raw) return buildFromExport(JSON.parse(raw))
  } catch (e) {
    console.warn('已存数据解析失败，回落示例数据：', e)
  }
  return buildMock()
}

/* 解析导入文本；成功则落盘并返回数据集，失败抛错（消息可直接显示）。
   落盘存「原始导出文本」——loadDataset 会再走一次 buildFromExport，存转换后结构会二次解析失败 */
export function importFromText(text) {
  const doc = JSON.parse(text) // JSON 语法错也会抛，统一 catch
  const data = buildFromExport(doc)
  localStorage.setItem(DATA_KEY, String(text))
  seedLecturesFromDoc(doc)
  seedHabitsFromDoc(doc)
  return data
}

export function clearImport() {
  localStorage.removeItem(DATA_KEY)
  return buildMock()
}

/* ---------- P12a 教务课表导入：只换「课程」这一段 + 旧课表快照 ----------
   用户拍板（2026-10-06）：「不要追加，我只希望有一套课表」+「A + 要快照」。
   所以口径是：
     · `web2.data.schedules` 里 `type === 'course'` 的条目**整体替换**成教务解析出来的；
     · `web2.data` 其余（todos / events / routines / semester）**原样不动**；
     · `web2.added` 里的**课程条目清掉**（否则旧的手动加课会浮在新课表上），
       但 `web2.added` 里非课程的东西保留；
     · 替换前把「当前这套课表」存进快照，用户能从设置里退回去。
   为什么不能整份换掉 `web2.data`：它里面同时装着待办和日程，整换＝用户的待办全没。 */
export const EDU_SNAPSHOT_KEY = 'web2.eduSnapshot'

/**
 * 把教务解析出来的课换成唯一那套课表。
 * @param {Array} courses parseEduXlsx 的输出（含 weekday/name/place/teacher/code/term/start/end/weeks/week_rule）
 * @returns {{ ok: boolean, error?: string, replaced: number, removedAdded: number, keptTodos: number }}
 */
export function replaceCoursesFromEdu(courses) {
  const list = Array.isArray(courses) ? courses : []
  if (!list.length) return { ok: false, error: '没有可导入的课程。', replaced: 0, removedAdded: 0, keptTodos: 0 }
  const raw = localStorage.getItem(DATA_KEY)
  if (!raw) {
    /* 还没导入过主项目数据（示例态）：没有 web2.data 可改，直接告诉调用方先导入 */
    return { ok: false, error: '还没导入主项目数据，先「导入主项目数据」再换课表。', replaced: 0, removedAdded: 0, keptTodos: 0 }
  }
  let doc
  try {
    doc = JSON.parse(raw)
  } catch {
    return { ok: false, error: '本机存的课表数据坏了，读不出来。', replaced: 0, removedAdded: 0, keptTodos: 0 }
  }
  if (!doc || doc.app !== 'sched' || !Array.isArray(doc.schedules)) {
    return { ok: false, error: '本机存的不是主项目导出格式，无法替换课表。', replaced: 0, removedAdded: 0, keptTodos: 0 }
  }
  /* 1) 存快照（只存这一份 JSON 原文 + added 的课程部分，够还原就行） */
  try {
    const addedCourses = loadAdded().filter((c) => c && c.type === 'course')
    localStorage.setItem(
      EDU_SNAPSHOT_KEY,
      JSON.stringify({ at: new Date().toISOString(), data: raw, added: addedCourses }),
    )
  } catch {
    /* 快照存不下（配额）不该挡住导入本身，但要让用户知道 */
  }
  /* 2) 换掉课程段。semester_id 保留原来的（教务课属于当前学期） */
  const semId = doc.semester && doc.semester.id ? doc.semester.id : undefined
  const kept = doc.schedules.filter((s) => !(s && s.type === 'course'))
  const replaced = doc.schedules.length - kept.length
  for (const c of list) {
    kept.push({
      id: c.id,
      type: 'course',
      title: c.name,
      location: c.place || '',
      teacher: c.teacher || '',
      code: c.code || '',
      term: c.term || '',
      weekday: Number(c.weekday),
      start_time: c.start,
      duration: Math.max(1, minOf(c.end) - minOf(c.start)),
      week_rule: c.week_rule || 'every',
      /* weeks 是 P12a 新增字段；老的主项目/App 读不懂会忽略它，不会报错 */
      weeks: Array.isArray(c.weeks) && c.weeks.length ? c.weeks.slice() : null,
      ...(semId ? { semester_id: semId } : {}),
    })
  }
  doc.schedules = kept
  doc.updated_at = new Date().toISOString()
  localStorage.setItem(DATA_KEY, JSON.stringify(doc))
  /* 3) 清掉手动加的课（只清课程，别的保留） */
  const all = loadAdded()
  const remain = all.filter((c) => !(c && c.type === 'course'))
  const removedAdded = all.length - remain.length
  if (removedAdded) localStorage.setItem(ADDED_KEY, JSON.stringify(remain))
  return { ok: true, replaced, removedAdded, keptTodos: Array.isArray(doc.todos) ? doc.todos.length : 0 }
}

/** 有没有可恢复的旧课表快照 */
export function hasEduSnapshot() {
  try {
    const s = JSON.parse(localStorage.getItem(EDU_SNAPSHOT_KEY) || '')
    return !!(s && s.data)
  } catch {
    return false
  }
}

/** 快照的时间与课程数（设置页那行文案用；读不出来返回 null） */
export function eduSnapshotInfo() {
  try {
    const s = JSON.parse(localStorage.getItem(EDU_SNAPSHOT_KEY) || '')
    if (!s || !s.data) return null
    const doc = JSON.parse(s.data)
    const n = (Array.isArray(doc.schedules) ? doc.schedules : []).filter((x) => x && x.type === 'course').length
    return { at: s.at || '', courses: n, added: Array.isArray(s.added) ? s.added.length : 0 }
  } catch {
    return null
  }
}

/** 恢复上一套课表：把快照里的 web2.data 原文与 added 课程写回去 */
export function restoreEduSnapshot() {
  let s
  try {
    s = JSON.parse(localStorage.getItem(EDU_SNAPSHOT_KEY) || '')
  } catch {
    s = null
  }
  if (!s || !s.data) return { ok: false, error: '没有可恢复的上一套课表。' }
  localStorage.setItem(DATA_KEY, String(s.data))
  const now = loadAdded().filter((c) => !(c && c.type === 'course'))
  const back = Array.isArray(s.added) ? s.added : []
  localStorage.setItem(ADDED_KEY, JSON.stringify([...now, ...back]))
  localStorage.removeItem(EDU_SNAPSHOT_KEY)
  return { ok: true, restored: back.length }
}

/* ---------- 待办增删改（增删改按源分支：导入态改原始导出文本，示例态用覆盖层） ---------- */
export const TODOS_KEY = 'web2.todos'
/* 覆盖层结构：{ added: 主项目形状的待办数组, edited: {id: {title?,done?,due_date?}}, deleted: [id] } */
function loadTodoOverlay() {
  try {
    const ov = JSON.parse(localStorage.getItem(TODOS_KEY) || '')
    return {
      added: Array.isArray(ov.added) ? ov.added : [],
      edited: ov.edited && typeof ov.edited === 'object' ? ov.edited : {},
      deleted: Array.isArray(ov.deleted) ? ov.deleted : [],
    }
  } catch {
    return { added: [], edited: {}, deleted: [] }
  }
}
function saveTodoOverlay(ov) {
  localStorage.setItem(TODOS_KEY, JSON.stringify(ov))
}

/* 生成一条符合主项目 normalizeTodo 形状的待办（保证回写文件能过 importAll） */
function fullTodo(title, due_date) {
  return {
    id: 'todo_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: String(title).trim(),
    note: '',
    due_date: String(due_date),
    done: false,
    done_at: null,
    source: 'manual',
    created_at: new Date().toISOString(),
  }
}

/* 改写导入文本里的待办数组；id 用 String 比较以兼容 mock 的数字 id */
function mutateImportedTodos(fn) {
  const raw = localStorage.getItem(DATA_KEY)
  if (!raw) return false
  try {
    const data = JSON.parse(raw)
    if (!data || data.app !== 'sched' || !Array.isArray(data.todos)) return false
    fn(data.todos)
    localStorage.setItem(DATA_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

/* 新增待办（title / due_date(YYYY-MM-DD) 必填，口径同主项目 validateTodo） */
export function addTodo(input) {
  const full = fullTodo(input.title, input.due_date)
  if (localStorage.getItem(DATA_KEY)) {
    mutateImportedTodos((arr) => arr.push(full))
  } else {
    const ov = loadTodoOverlay()
    ov.added.push(full)
    saveTodoOverlay(ov)
  }
  return full
}

/* 修改待办：patch = { title?, done?, due_date? }（mock 待办没有 due_date 时补一个） */
export function patchTodo(id, patch) {
  const clean = {}
  if (patch.title !== undefined) clean.title = String(patch.title).trim()
  if (patch.due_date !== undefined) clean.due_date = String(patch.due_date)
  if (patch.done !== undefined) {
    clean.done = !!patch.done
    clean.done_at = clean.done ? new Date().toISOString() : null
  }
  if (localStorage.getItem(DATA_KEY)) {
    mutateImportedTodos((arr) => {
      const t = arr.find((x) => x && String(x.id) === String(id))
      if (t) Object.assign(t, clean)
    })
  } else {
    const ov = loadTodoOverlay()
    ov.edited[id] = { ...(ov.edited[id] || {}), ...clean }
    saveTodoOverlay(ov)
  }
}

/* 删除待办 */
export function removeTodoById(id) {
  if (localStorage.getItem(DATA_KEY)) {
    mutateImportedTodos((arr) => {
      const i = arr.findIndex((x) => x && String(x.id) === String(id))
      if (i !== -1) arr.splice(i, 1)
    })
  } else {
    const ov = loadTodoOverlay()
    ov.deleted.push(String(id))
    saveTodoOverlay(ov)
  }
}

/* 示例待办 + 用户覆盖层 → 今日视图用的轻量形状 {id,title,done,due,due_date?} */
function applyTodoOverlay(base) {
  const ov = loadTodoOverlay()
  const del = new Set(ov.deleted.map(String))
  const arr = base
    .filter((t) => !del.has(String(t.id)))
    .map((t) => {
      const p = ov.edited[t.id]
      if (!p) return { ...t }
      const out = { ...t, title: p.title !== undefined ? p.title : t.title, done: p.done !== undefined ? p.done : t.done }
      if (p.due_date !== undefined) {
        out.due_date = p.due_date // 原始值也要带回，编辑表单才能回填（只更新 due 显示会让日期栏永远为空）
        out.due = dueLabel(p.due_date)
      }
      return out
    })
  for (const t of ov.added) {
    if (del.has(String(t.id))) continue // 新增的也可能被删
    const p = ov.edited[t.id] || {} // 新增的也可能再被编辑，patch 要合并进去
    const m = { ...t, ...p }
    arr.push({ id: m.id, title: m.title, done: m.done, due: dueLabel(m.due_date), due_date: m.due_date })
  }
  return arr
}

/* ---------- 非自加课程的编辑/删除（双源分支，口径同待办） ----------
   导入态：直接改落盘的原始导出文本 schedules（编辑/删除会随回写文件带回主项目）
   示例态：mock 课程用覆盖层（ADDED_KEY 里的自加课本来就能直接改，不走这里） */
export const COURSE_OV_KEY = 'web2.courseOv'

function loadCourseOverlay() {
  try {
    const ov = JSON.parse(localStorage.getItem(COURSE_OV_KEY) || '')
    return {
      edited: ov.edited && typeof ov.edited === 'object' ? ov.edited : {},
      deleted: Array.isArray(ov.deleted) ? ov.deleted : [],
    }
  } catch {
    return { edited: {}, deleted: [] }
  }
}
function saveCourseOverlay(ov) {
  localStorage.setItem(COURSE_OV_KEY, JSON.stringify(ov))
}

/* 示例课表 + 用户覆盖层（edited 存显示形状补丁，deleted 按 String(id) 记） */
function applyCourseOverlay(courses) {
  const ov = loadCourseOverlay()
  const del = new Set(ov.deleted.map(String))
  return courses
    .filter((c) => !del.has(String(c.id)))
    .map((c) => (ov.edited[c.id] ? { ...c, ...ov.edited[c.id] } : c))
}

/* 修改非自加课程（导入态）。patch 为显示形状 {weekday?,name?,place?,start?,end?,week_rule?}，
   翻译回原始字段 title/start_time/duration/location/weekday/week_rule；其余字段原样保留 */
export function updateImportedCourse(id, patch) {
  const raw = localStorage.getItem(DATA_KEY)
  if (!raw) return false
  try {
    const data = JSON.parse(raw)
    if (!data || data.app !== 'sched' || !Array.isArray(data.schedules)) return false
    const s = data.schedules.find((x) => x && String(x.id) === String(id))
    if (!s) return false
    if (patch.weekday !== undefined) s.weekday = Number(patch.weekday)
    if (patch.name !== undefined) s.title = String(patch.name).trim()
    if (patch.place !== undefined) s.location = String(patch.place).trim()
    if (patch.start !== undefined) s.start_time = String(patch.start)
    if (patch.end !== undefined) s.duration = Math.max(5, minOf(String(patch.end)) - minOf(s.start_time))
    if (patch.week_rule !== undefined) s.week_rule = String(patch.week_rule)
    s.manual_edited = true
    s.updated_at = new Date().toISOString()
    localStorage.setItem(DATA_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

/* 删除非自加课程（导入态） */
export function removeImportedCourse(id) {
  const raw = localStorage.getItem(DATA_KEY)
  if (!raw) return false
  try {
    const data = JSON.parse(raw)
    if (!data || data.app !== 'sched' || !Array.isArray(data.schedules)) return false
    const i = data.schedules.findIndex((x) => x && String(x.id) === String(id))
    if (i === -1) return false
    data.schedules.splice(i, 1)
    localStorage.setItem(DATA_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

/* 修改/删除非自加课程（示例态，mock 课程覆盖层） */
export function patchMockCourse(id, patch) {
  const ov = loadCourseOverlay()
  ov.edited[id] = { ...(ov.edited[id] || {}), ...patch }
  saveCourseOverlay(ov)
}
export function removeMockCourse(id) {
  const ov = loadCourseOverlay()
  ov.deleted.push(String(id))
  saveCourseOverlay(ov)
}

/* ---------- 冲突检测（移植主项目 Rules.findConflicts，PRD F4：提示但不强制阻止） ----------
   显示形状入参：target/list 元素 = { id?, type, weekday, start, end, week_rule?, date?, weekNo? }
   三类一起参与：课程 / 循环日程（按「星期 + 周次规则」展开）、独立日程（只有具体那一天）。
   独立日程的判断需要「周次」而不是「星期几」—— 调用方要把它换算好写进元素：
   weekday = 由 date 算出的 1–7，weekNo = 相对 firstMonday 的学期第 N 周（换算不了就 null）。 */
export function weekRulesIntersect(a, b) {
  if (!a || a === 'every' || !b || b === 'every') return true
  return a === b
}
/* 周次规则 × 具体某周：这周轮不轮得上（单周/双周/每周） */
export function weekMatches(rule, weekNo) {
  if (!rule || rule === 'every') return true
  const w = Number(weekNo)
  if (!(w >= 1)) return true
  if (rule === 'odd') return w % 2 === 1
  if (rule === 'even') return w % 2 === 0
  return true
}
/* 两条日程的周次是否可能落在同一周：一次性的只占「那一周」，周期型按 week_rule 展开。
   换算不出周次（缺 firstMonday）时返回 false —— 宁可漏报，不猜着报。 */
function weeksOverlap(a, b) {
  const aOnce = !!a.date
  const bOnce = !!b.date
  if (aOnce && bOnce) {
    if (a.weekNo == null || b.weekNo == null) return false
    return Number(a.weekNo) === Number(b.weekNo)
  }
  if (aOnce) return a.weekNo == null ? false : weekMatches(b.week_rule, a.weekNo)
  if (bOnce) return b.weekNo == null ? false : weekMatches(a.week_rule, b.weekNo)
  return weekRulesIntersect(a.week_rule, b.week_rule)
}
export function findConflicts(target, list) {
  const out = []
  if (!target || !Array.isArray(list)) return out
  const tS = minOf(target.start)
  const tE = minOf(target.end)
  if (tS < 0) return out
  for (const o of list) {
    if (!o) continue
    if (target.id != null && String(o.id) === String(target.id)) continue // 编辑自己不算
    if (Number(o.weekday) !== Number(target.weekday)) continue // 不同天
    if (!weeksOverlap(target, o)) continue // 单双周错开 / 不在一周
    const oS = minOf(o.start)
    const oE = minOf(o.end)
    if (tS < oE && oS < tE) out.push(o) // 区间重叠
  }
  return out
}
/* 把「某一天」换算成冲突检测要的 { weekday, weekNo }。缺学期锚点 / 日期非法 → null */
export function dayScope(dateStr, semester) {
  const fm = semester && semester.firstMonday
  if (!fm || !dateStr) return null
  const a = new Date(fm + 'T00:00:00')
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(a) || isNaN(d)) return null
  const diff = Math.round((d - a) / 86400000)
  return { weekday: ((d.getDay() + 6) % 7) + 1, weekNo: diff < 0 ? null : Math.floor(diff / 7) + 1 }
}

/* ---------- 独立日程（event）添加：双源分支，口径同待办 ---------- */
export const EVENTS_KEY = 'web2.events'
function loadEventOverlay() {
  try {
    const arr = JSON.parse(localStorage.getItem(EVENTS_KEY) || '')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
/* 生成一条符合主项目 normalizeSchedule 形状的 event（保证回写文件能过 importAll） */
function fullEvent(input) {
  const now = new Date().toISOString()
  return {
    id: 'evt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: 'event',
    title: String(input.title).trim(),
    note: '',
    location: String(input.location || '').trim(),
    weekday: null,
    start_time: String(input.start_time),
    duration: Number(input.duration),
    week_rule: null,
    date: String(input.date),
    color: '',
    semester_id: null,
    manual_edited: true,
    created_at: now,
    updated_at: now,
  }
}
/* 主项目 event 原始形状 → web2 显示形状 */
function evDisplay(e) {
  return {
    id: e.id,
    type: 'event',
    name: e.title,
    place: String(e.location || '').trim(),
    tag: '日程',
    date: e.date,
    start: e.start_time,
    end: fmtMin(minOf(e.start_time) + Number(e.duration)),
  }
}
/* overlay（web2.events）里混存独立日程与循环日程，靠 type 分流；无 type 的老条目视为 event */
function overlayOf(type) {
  return loadEventOverlay().filter((x) => x && (x.type || 'event') === type)
}
function allEvents(rawEvents) {
  return [...(rawEvents || []), ...overlayOf('event').map(evDisplay)]
}
function allRoutines(rawRoutines) {
  return [...(rawRoutines || []), ...overlayOf('routine').map(rvDisplay)]
}

/* 新增独立日程（title / date / start_time / duration 必填，口径同主项目 validateSchedule） */
export function addEvent(input) {
  const full = fullEvent(input)
  if (localStorage.getItem(DATA_KEY)) {
    const raw = localStorage.getItem(DATA_KEY)
    const data = JSON.parse(raw)
    if (!data || data.app !== 'sched' || !Array.isArray(data.schedules)) {
      throw new Error('导入数据异常，无法添加日程。')
    }
    data.schedules.push(full)
    localStorage.setItem(DATA_KEY, JSON.stringify(data))
  } else {
    const arr = loadEventOverlay()
    arr.push(full)
    localStorage.setItem(EVENTS_KEY, JSON.stringify(arr))
  }
  return full
}

/* ---------- 固定循环日程（routine）：双源分支，口径同独立日程 ----------
   与课程同形（weekday + start_time + duration + week_rule），但不占学期课表；
   本机叠加复用 web2.events（靠 type 分流，不另开键）。 */

/* 生成一条符合主项目 normalizeSchedule 形状的 routine。
   ⚠️ importAll 是保真写入、不重新归一化 → week_rule 的缺省值必须在这里写死，
   不能指望主项目补（主项目只在 UI 新增/编辑时归一化）。 */
function fullRoutine(input) {
  const now = new Date().toISOString()
  return {
    id: 'rout_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    type: 'routine',
    title: String(input.title).trim(),
    note: '',
    location: String(input.location || '').trim(),
    weekday: Number(input.weekday),
    start_time: String(input.start_time),
    duration: Number(input.duration),
    week_rule: input.week_rule || 'every',
    date: null,
    color: '',
    semester_id: String(input.semester_id || ''),
    manual_edited: true,
    created_at: now,
    updated_at: now,
  }
}
/* 主项目 routine 原始形状 → web2 显示形状（与课程显示形状同构，便于共用周视图排格） */
function rvDisplay(r) {
  const wr = r.week_rule || 'every'
  return {
    id: r.id,
    type: 'routine',
    weekday: Number(r.weekday),
    name: r.title,
    place: String(r.location || '').trim(),
    tag: { every: '每周', odd: '单周', even: '双周' }[wr] || '每周',
    start: r.start_time,
    end: fmtMin(minOf(r.start_time) + Number(r.duration)),
    week_rule: wr,
  }
}

/* 循环日程的双源读写：有导入态就动 data.schedules，否则动 web2.events overlay */
function routineStore(fn) {
  const raw = localStorage.getItem(DATA_KEY)
  if (raw) {
    try {
      const data = JSON.parse(raw)
      if (!data || data.app !== 'sched' || !Array.isArray(data.schedules)) return false
      if (!fn(data.schedules)) return false
      localStorage.setItem(DATA_KEY, JSON.stringify(data))
      return true
    } catch {
      return false
    }
  }
  const arr = loadEventOverlay()
  if (!fn(arr)) return false
  localStorage.setItem(EVENTS_KEY, JSON.stringify(arr))
  return true
}

/* 新增循环日程（title / weekday / start_time / duration 必填，口径同主项目 validateSchedule） */
export function addRoutine(input) {
  const full = fullRoutine(input)
  if (localStorage.getItem(DATA_KEY)) {
    const raw = localStorage.getItem(DATA_KEY)
    const data = JSON.parse(raw)
    if (!data || data.app !== 'sched' || !Array.isArray(data.schedules)) {
      throw new Error('导入数据异常，无法添加循环日程。')
    }
    data.schedules.push(full)
    localStorage.setItem(DATA_KEY, JSON.stringify(data))
  } else {
    const arr = loadEventOverlay()
    arr.push(full)
    localStorage.setItem(EVENTS_KEY, JSON.stringify(arr))
  }
  return full
}

/* 修改循环日程。patch 为显示形状 {weekday?,name?,place?,start?,end?,week_rule?}，
   翻译回原始字段 title/start_time/duration/location/weekday/week_rule */
export function updateRoutine(id, patch) {
  return routineStore((list) => {
    const r = list.find((x) => x && String(x.id) === String(id) && x.type === 'routine')
    if (!r) return false
    if (patch.weekday !== undefined) r.weekday = Number(patch.weekday)
    if (patch.name !== undefined) r.title = String(patch.name).trim()
    if (patch.place !== undefined) r.location = String(patch.place).trim()
    if (patch.start !== undefined) r.start_time = String(patch.start)
    if (patch.end !== undefined) r.duration = Math.max(5, minOf(String(patch.end)) - minOf(r.start_time))
    if (patch.week_rule !== undefined) r.week_rule = String(patch.week_rule)
    r.manual_edited = true
    r.updated_at = new Date().toISOString()
    return true
  })
}

/* 删除循环日程 */
export function removeRoutine(id) {
  return routineStore((list) => {
    const i = list.findIndex((x) => x && String(x.id) === String(id) && x.type === 'routine')
    if (i === -1) return false
    list.splice(i, 1)
    return true
  })
}

/* ---------- 待办勾选回写主项目格式 ----------
   DATA_KEY 里存的是主项目原始导出文本，勾选待办 = 在原文上改 done 再存回。
   好处：导出文件永远是「主项目原格式 + 最新勾选状态」，导回主项目即可闭环。 */

/* 同步一条待办的完成状态进落盘的导出文本；返回是否成功（id 不存在/无导入态 = false）
   （现由 patchTodo 承担，此函数已删——导出统一走 exportImportedText） */

/* 取当前导入的原始文本（主项目格式，含最新勾选状态）；无导入态返回 null。
   导出时把 lectures 合并进去（见下方 lectures 一节）——主项目 importAll 只读
   已知字段，多余字段会被安全忽略，schema_version 不变不触发版本拒收。 */
export function exportImportedText() {
  const raw = localStorage.getItem(DATA_KEY)
  if (!raw) return null
  let doc
  try {
    doc = JSON.parse(raw)
  } catch {
    return null
  }
  doc.lectures = loadLectures()
  doc.habits = loadHabits()
  return JSON.stringify(doc, null, 2)
}

/* ---------- 课堂录音场次（二期 M2 新增）----------
   口径：主项目「大学生日程助手-设计方案.md」lectures 表——课堂录音场次，
   状态机 recording（录音中）→ transcribing（转写中）→ summarized（已总结）。
   存储：独立键 web2.lectures 作为单一活源（录音是设备本地的生命记录，
   不挂进课程备份的「改写回写文本」链）；导出时由 exportImportedText 合并进
   JSON 的 lectures 字段随文件走，主项目 importAll 读到会安全忽略（已实证）。
   schema_version 不升：新增独立字段不影响旧数据读写（口径同主项目 §9.3）。 */
export const LECTURES_KEY = 'web2.lectures'
/* 状态机只许前进：recording（录音中/已录完待转写）→ transcribing（转写进行中）
   → transcribed（文字稿就绪，M4 的 LLM 总结从这态起步）→ summarized（已总结）。
   transcribed 是 M3 新增的中间态：转写完成 ≠ 已总结，混用会丢「待总结」信息。 */
const LECTURE_STATUS = ['recording', 'transcribing', 'transcribed', 'summarized']

/* 单条场次整形：字段白名单 + 类型收敛，坏数据直接剔除，绝不抛错 */
function sanitizeLecture(l) {
  if (!l || typeof l !== 'object') return null
  const status = LECTURE_STATUS.indexOf(l.status) !== -1 ? l.status : null
  if (!status) return null
  /* 标题兜底（v1.41.9 真机反馈，v1.41.10 收紧）：老版本往模板串里拼过 undefined，
     落盘不是裸 "undefined" 而是拼好的复合串（真机实测渲染成「undefined · 10月1日」），
     所以只比相等兜不住——空串、或**以** undefined/null/nan 开头（后接分隔符或结尾）都当没名字。 */
  const rawTitle = String(l.title == null ? '' : l.title).trim()
  const title = rawTitle === '' || /^(?:undefined|null|nan)\b/i.test(rawTitle) ? '未命名录音' : rawTitle
  const out = {
    id: String(l.id || ''),
    schedule_id: l.schedule_id == null ? null : String(l.schedule_id),
    title,
    status,
    started_at: String(l.started_at || ''),
    ended_at: l.ended_at == null ? null : String(l.ended_at),
    duration_ms: Number(l.duration_ms) >= 0 ? Math.floor(Number(l.duration_ms)) : 0,
    clip_count: Number(l.clip_count) >= 0 ? Math.floor(Number(l.clip_count)) : 0,
    clips: Array.isArray(l.clips)
      ? l.clips
          .map((c) => ({
            index: Number(c && c.index) >= 0 ? Math.floor(Number(c.index)) : 0,
            path: c && c.path != null ? String(c.path) : null, // App 平台：文件路径
            mime: c && c.mime ? String(c.mime) : '',
            duration_ms: c && Number(c.duration_ms) >= 0 ? Math.floor(Number(c.duration_ms)) : 0,
            recorded_at: c && c.recorded_at ? String(c.recorded_at) : '',
          }))
          .sort((a, b) => a.index - b.index)
      : [],
    created_at: String(l.created_at || ''),
    updated_at: String(l.updated_at || ''),
    transcript: l.transcript == null ? null : String(l.transcript), // M3：本地转写文字稿
    summary: l.summary == null ? null : sanitizeSummary(l.summary), // M4：LLM 课堂纪要
  }
  if (!out.id || !out.started_at) return null
  return out
}

/* 课堂纪要整形（M4）：LLM 返回的 JSON 过白名单，坏字段剔除，绝不抛错。
   口径：overview 一句话总览；key_points 要点；terms 概念术语；homework 作业/待办；
   questions 存疑点（转写可能有错，LLM 不确定的放这，不硬编）。 */
function sanitizeSummary(s) {
  if (!s || typeof s !== 'object') return null
  const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [])
  const terms = Array.isArray(s.terms)
    ? s.terms
        .map((t) => (t && typeof t === 'object' ? { term: String(t.term || '').trim(), note: String(t.note || '').trim() } : null))
        .filter((t) => t && t.term)
    : []
  return {
    overview: String(s.overview || '').trim(),
    key_points: arr(s.key_points),
    terms,
    homework: arr(s.homework),
    questions: arr(s.questions),
    created_at: String(s.created_at || ''),
  }
}

/* 写入课堂纪要（M4）：只有 transcribed / summarized 状态可写（没转写完没有原料）；
   写入后状态推进到 summarized（不可逆站，见 updateLecture 状态机注释）。
   返回 { ok:true, lecture } 或 { ok:false, error }。 */
export function setLectureSummary(id, summary) {
  const list = loadLectures()
  const lec = list.find((x) => String(x.id) === String(id))
  if (!lec) return { ok: false, error: '录音场次不存在。' }
  if (lec.status !== 'transcribed' && lec.status !== 'summarized') {
    return { ok: false, error: '要先完成转写才能生成纪要。' }
  }
  const clean = sanitizeSummary(summary)
  if (!clean || !clean.overview) return { ok: false, error: '纪要内容无效（缺总览）。' }
  lec.summary = clean
  lec.status = 'summarized'
  lec.updated_at = new Date().toISOString()
  saveLectures(list)
  return { ok: true, lecture: lec }
}

export function loadLectures() {
  try {
    const arr = JSON.parse(localStorage.getItem(LECTURES_KEY) || '')
    if (!Array.isArray(arr)) return []
    return arr.map(sanitizeLecture).filter(Boolean)
  } catch {
    return []
  }
}

function saveLectures(list) {
  localStorage.setItem(LECTURES_KEY, JSON.stringify(list))
}

/* 导入种子：文件里带 lectures 数组才整体接管（显式迁移，语义同 schedules/todos
   的整体替换）；文件不带（旧备份/主项目当前版本导出）绝不动本地记录——
   导入旧备份不该删掉手机上已有的录音场次。 */
function seedLecturesFromDoc(doc) {
  if (doc && Array.isArray(doc.lectures)) {
    saveLectures(doc.lectures.map(sanitizeLecture).filter(Boolean))
  }
}

function newLectureId() {
  return 'lec_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/* 新开一场录音：status 固定 recording，started_at 即此刻 */
export function addLecture(input = {}) {
  const now = new Date().toISOString()
  const lec = sanitizeLecture({
    id: newLectureId(),
    schedule_id: input.schedule_id != null ? input.schedule_id : null,
    title: input.title,
    status: 'recording',
    started_at: now,
    ended_at: null,
    duration_ms: 0,
    clip_count: 0,
    clips: [],
    created_at: now,
    updated_at: now,
  })
  const list = loadLectures()
  list.push(lec)
  saveLectures(list)
  return lec
}

/* 更新场次：返回 { ok:true, lecture } 或 { ok:false, error }。
   状态机只许沿 recording → transcribing → transcribed → summarized 前进，不许倒退。 */
export function updateLecture(id, patch) {
  const list = loadLectures()
  const lec = list.find((x) => String(x.id) === String(id))
  if (!lec) return { ok: false, error: '录音场次不存在。' }
  const clean = {}
  if (patch.title !== undefined) {
    clean.title = String(patch.title).trim()
    if (!clean.title) return { ok: false, error: '标题不能为空。' }
  }
  if (patch.schedule_id !== undefined) clean.schedule_id = patch.schedule_id == null ? null : String(patch.schedule_id)
  if (patch.status !== undefined) {
    const from = LECTURE_STATUS.indexOf(lec.status)
    const to = LECTURE_STATUS.indexOf(patch.status)
    if (to === -1) return { ok: false, error: '未知的录音状态。' }
    // 唯一允许的回退：transcribing → recording（转写失败回「待转写」可重试，
    // 语义成立因为 recording 覆盖「录音中/已录完」两态，ended_at 决定显示）。
    // transcribed / summarized 不可逆——总结成果不许被悄悄作废。
    const rollbackOk = lec.status === 'transcribing' && patch.status === 'recording'
    if (to < from && !rollbackOk) return { ok: false, error: '录音状态不许倒退（' + lec.status + ' → ' + patch.status + '）。' }
    clean.status = patch.status
  }
  if (patch.ended_at !== undefined) clean.ended_at = patch.ended_at == null ? null : String(patch.ended_at)
  if (patch.transcript !== undefined) clean.transcript = patch.transcript == null ? null : String(patch.transcript)
  if (patch.duration_ms !== undefined) clean.duration_ms = Math.max(0, Math.floor(Number(patch.duration_ms) || 0))
  if (patch.clips !== undefined) {
    if (!Array.isArray(patch.clips)) return { ok: false, error: 'clips 必须是数组。' }
    const clips = patch.clips
      .map((c) => ({ index: Math.floor(Number(c && c.index) || 0), path: c && c.path != null ? String(c.path) : null, mime: c && c.mime ? String(c.mime) : '', duration_ms: Math.floor(Number(c && c.duration_ms) || 0), recorded_at: c && c.recorded_at ? String(c.recorded_at) : '' }))
      .sort((a, b) => a.index - b.index)
    clean.clips = clips
    clean.clip_count = clips.length
  }
  Object.assign(lec, clean, { updated_at: new Date().toISOString() })
  saveLectures(list)
  return { ok: true, lecture: lec }
}

export function removeLecture(id) {
  const list = loadLectures()
  const i = list.findIndex((x) => String(x.id) === String(id))
  if (i === -1) return false
  list.splice(i, 1)
  saveLectures(list)
  return true
}

/* ---------- 每日打卡习惯（五期第 3 期）----------
   口径：习惯 = { id, name, created_at, records: {"YYYY-MM-DD": true}, backfilled: {"YYYY-MM-DD": true} }。
   records 按日期稀疏记录（只存打过的卡），天然支持连续天数/周热力统计；
   值恒为 true——「没打卡」= 键不存在，不做 false 存量（取消 = 删键）。
   backfilled 单独记「事后补的卡」：只有宽限期口径（本周内、今天之前）允许，
   且不覆盖 records——两者分开存而不是把 records 的值改成枚举，是为了让
   老数据（records 值恒 true、无 backfilled）零迁移继续可用；
   导出多一个字段，主项目 importAll 读到未知字段安全忽略。
   存储：独立键 web2.habits 作为单一活源（同 lectures 理由：打卡是设备本地
   的生命记录）；导出时合并进 JSON 的 habits 字段随文件走。
   schema_version 不升（口径同 lectures）。 */
export const HABITS_KEY = 'web2.habits'

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/* 只留「YYYY-MM-DD」形且值为真的键（records 与 backfilled 共用） */
function pickDateKeys(src) {
  const out = {}
  if (src && typeof src === 'object') {
    for (const k of Object.keys(src)) if (DATE_KEY_RE.test(k) && src[k]) out[k] = true
  }
  return out
}

/* 单条习惯整形：name 必须非空，records/backfilled 只收合法日期键，坏数据剔除 */
function sanitizeHabit(h) {
  if (!h || typeof h !== 'object') return null
  const name = String(h.name || '').trim()
  if (!name) return null
  const records = pickDateKeys(h.records)
  const backfilled = pickDateKeys(h.backfilled)
  /* 一致性地板：backfilled 里的键必须在 records 里也在（records 才是唯一真实来源） */
  for (const k of Object.keys(backfilled)) if (!records[k]) delete backfilled[k]
  return {
    id: String(h.id || ''),
    name,
    records,
    backfilled,
    created_at: String(h.created_at || ''),
  }
}

export function loadHabits() {
  try {
    const arr = JSON.parse(localStorage.getItem(HABITS_KEY) || '')
    if (!Array.isArray(arr)) return []
    return arr.map(sanitizeHabit).filter(Boolean)
  } catch {
    return []
  }
}

function saveHabits(list) {
  localStorage.setItem(HABITS_KEY, JSON.stringify(list))
}

/* 导入种子：文件带 habits 数组才整体接管（显式迁移）；不带绝不动本地——
   导入旧备份不该删掉已有的打卡记录（语义同 seedLecturesFromDoc） */
function seedHabitsFromDoc(doc) {
  if (doc && Array.isArray(doc.habits)) {
    saveHabits(doc.habits.map(sanitizeHabit).filter(Boolean))
  }
}

function newHabitId() {
  return 'hab_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function addHabit(name) {
  const now = new Date().toISOString()
  const habit = sanitizeHabit({ id: newHabitId(), name, records: {}, created_at: now })
  const list = loadHabits()
  list.push(habit)
  saveHabits(list)
  return habit
}

export function removeHabit(id) {
  const list = loadHabits()
  const i = list.findIndex((x) => x.id === id)
  if (i === -1) return false
  list.splice(i, 1)
  saveHabits(list)
  return true
}

/* 打卡/取消：overviewDateKey 形如 2026-09-27（默认今天）。已打卡则删键取消，否则置 true。
   ——比今天早的日期走「补卡」：写 records 之外再记一笔 backfilled（界面据此画空心勾）。
   越界守卫：只允许「今天」或「宽限期内的过去日期」（见 isGraceKey），其余返回 null 不写盘——
   界面本来也只渲染可点的格子，这道守卫是防调用方写脏数据。 */
export function toggleHabitRecord(id, dateKey) {
  const today = todayKeyOf()
  const key = dateKey || today
  if (key !== today && !isGraceKey(key, today)) return null
  const list = loadHabits()
  const h = list.find((x) => x.id === id)
  if (!h) return null
  let done
  if (h.records[key]) {
    delete h.records[key]
    delete h.backfilled[key]
    done = false
  } else {
    h.records[key] = true
    if (key !== today) h.backfilled[key] = true
    done = true
  }
  saveHabits(list)
  return done
}

/* 本地日期键（不用 toISOString：那是 UTC，晚上 8 点后会把「今天」算成明天） */
export function todayKeyOf(now) {
  const d = now || new Date()
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/* ---------- 宽限期（三期「宽限期漏卡」）----------
   口径（用户拍板）：只能补**本周内**（周一起始）且**今天之前**的卡；上周及更早锁定。
   跨周/跨月的日期一律先转成 Date 再用日期算术，避免手写字符串拼接踩月末。 */
function dateOfKey(key) {
  return new Date(key + 'T00:00:00')
}

/* 某个日期键所在周的周一（isoKey 同周制：周一=本周第 1 天） */
export function weekMondayKeyOf(dateKey) {
  const d = dateOfKey(dateKey)
  const wd = (d.getDay() + 6) % 7 // 周一=0…周日=6
  d.setDate(d.getDate() - wd)
  return todayKeyOf(d)
}

/* 宽限期内可补的日期键数组：本周一 → 昨天（含），今天的卡走正常打卡不算补。
   今天就是周一时返回空数组（本周还没有可补的过去日期）。 */
export function graceKeysOf(todayKey) {
  const today = todayKey || todayKeyOf()
  const keys = []
  const cursor = dateOfKey(weekMondayKeyOf(today))
  const end = dateOfKey(today)
  while (cursor < end) {
    keys.push(todayKeyOf(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return keys
}

/* 某日期是否落在宽限期内（不含今天——今天是正常打卡，不是补卡） */
export function isGraceKey(dateKey, todayKey) {
  return graceKeysOf(todayKey).includes(dateKey)
}

/* 该习惯是否「这天是事后补的」 */
export function isBackfilled(habit, dateKey) {
  return !!(habit && habit.backfilled && habit.backfilled[dateKey])
}

/* 累计打卡天数（补的卡也算——它是真打过的，只是补记） */
export function totalDoneOf(habit) {
  return habit && habit.records ? Object.keys(habit.records).length : 0
}

/* 连续打卡天数（含今天或昨天起算：今天还没打时，从昨天往回数不断链） */
export function streakOf(habit, todayKey) {
  const today = todayKey || todayKeyOf()
  let cursor = new Date(today + 'T00:00:00')
  const day = (d) => todayKeyOf(d)
  if (!habit.records[day(cursor)]) {
    cursor.setDate(cursor.getDate() - 1)
    if (!habit.records[day(cursor)]) return 0
  }
  let n = 0
  while (habit.records[day(cursor)]) {
    n++
    cursor.setDate(cursor.getDate() - 1)
  }
  return n
}

/* ---------- 节次时间轴 ----------
   semester.periods 为空（真实导出常见）则回落默认节次表（13 节），口径见 defaultPeriods
   defaultPeriods()：[{ no, start, end }, ...] */

function defaultPeriods() {
  /* 默认作息（用户拍板）：上午 5 节 + 下午 5 节 + 晚上 3 节，每节 45 分、小课间统一 10 分；
     午休（12:25–14:00）和晚休（18:25–19:00）是段间大空档，各校差异大，交给自己在节次表里改。
     相邻间隔 > 15 分钟自动分段，所以默认正好 3 段。 */
  return [
    { no: 1, start: '08:00', end: '08:45' },
    { no: 2, start: '08:55', end: '09:40' },
    { no: 3, start: '09:50', end: '10:35' },
    { no: 4, start: '10:45', end: '11:30' },
    { no: 5, start: '11:40', end: '12:25' },
    { no: 6, start: '14:00', end: '14:45' },
    { no: 7, start: '14:55', end: '15:40' },
    { no: 8, start: '15:50', end: '16:35' },
    { no: 9, start: '16:45', end: '17:30' },
    { no: 10, start: '17:40', end: '18:25' },
    { no: 11, start: '19:00', end: '19:45' },
    { no: 12, start: '19:55', end: '20:40' },
    { no: 13, start: '20:50', end: '21:35' },
  ]
}

export function periodsOf(ds) {
  const p = ds && ds.semester && ds.semester.periods
  if (Array.isArray(p) && p.length) return p
  return defaultPeriods()
}

/* ---------- 学期信息校验（纯函数）----------
   引导页「下一步：识别课表」要能在不建数据的前提下拦住信息不全的人，
   所以把规则抽成纯函数；错误文案与 createManualSemester / updateImportedSemester 共用，
   避免同一套规则在两处漂移。返回 '' 表示通过。 */
export function semesterInputError({ name, first_monday, total_weeks }) {
  const bad = []
  if (!String(name || '').trim()) bad.push('学期名')
  const fm = String(first_monday || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fm)) bad.push('第一周周一日期')
  else if (new Date(fm + 'T00:00:00').getDay() !== 1) bad.push('第一周周一（选的那天不是周一）')
  const tw = Number(total_weeks)
  if (!(tw >= 1 && tw <= 30)) bad.push('总周数（1–30）')
  return bad.length ? '请检查：' + bad.join('、') : ''
}

/* ---------- 手动创建学期（差距⑦增补：引导页「直接填学期信息」） ----------
   生成一份主项目格式的空学期存入 DATA_KEY（同导入态），
   之后加课程/待办走导入态既有链路，回写文件也能被主项目 importAll 原样吃进。 */
export function createManualSemester({ name, first_monday, total_weeks, periods }) {
  const badErr = semesterInputError({ name, first_monday, total_weeks })
  if (badErr) return { ok: false, error: badErr }
  const n = String(name || '').trim()
  const fm = String(first_monday || '').trim()
  const tw = Number(total_weeks)

  /* periods 可选：传了必须合法（口径同 updateImportedSemester / 主项目 validatePeriods）；空数组 = 不设置节次 */
  let ps = []
  if (Array.isArray(periods)) {
    if (periods.length > 15) return { ok: false, error: '节次数最多 15 节。' }
    const seen = {}
    for (const p of periods) {
      const no = Number(p && p.no)
      if (!(no >= 1 && no <= 15) || seen[no]) return { ok: false, error: '节次序号必须是 1–15 且不重复。' }
      seen[no] = true
      if (!/^\d{2}:\d{2}$/.test(String(p.start)) || !/^\d{2}:\d{2}$/.test(String(p.end)))
        return { ok: false, error: '第 ' + no + ' 节的时间格式应为 HH:mm。' }
      if (minOf(p.start) >= minOf(p.end)) return { ok: false, error: '第 ' + no + ' 节的结束时间必须晚于开始时间。' }
    }
    ps = periods.map((p) => {
      const o = { no: Number(p.no), start: String(p.start), end: String(p.end) }
      const sg = Number(p && p.seg)
      /* 分段标记：纯编辑辅助（哪个时段算一段），主项目 normalizePeriods 会忽略它；
         丢了只是回落「按间隔自动分段」，不算数据损失 */
      if (Number.isInteger(sg) && sg >= 1) o.seg = sg
      return o
    })
  }

  const now = new Date().toISOString()
  const doc = {
    app: 'sched',
    schema_version: 1,
    exported_at: now,
    semester: { id: 'sem_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: n, first_monday: fm, total_weeks: tw, periods: ps, created_at: now },
    schedules: [],
    todos: [],
  }
  localStorage.setItem(DATA_KEY, JSON.stringify(doc))
  return { ok: true, data: buildFromExport(doc) }
}

/* ---------- 学期信息/节次表编辑（差距②增补） ----------
   仅导入态/手动创建态可用（DATA_KEY 存在）；mock 是代码数据，改不了。
   校验口径同主项目 validateSemester / validatePeriods。 */
export function updateImportedSemester({ name, first_monday, total_weeks, periods, subTerms }) {
  const raw = localStorage.getItem(DATA_KEY)
  if (!raw) return { ok: false, error: '当前是示例数据，学期信息不能编辑。' }
  let doc
  try {
    doc = JSON.parse(raw)
  } catch {
    return { ok: false, error: '已存数据解析失败。' }
  }

  const badErr = semesterInputError({ name, first_monday, total_weeks })
  if (badErr) return { ok: false, error: badErr }
  const n = String(name || '').trim()
  const fm = String(first_monday || '').trim()
  const tw = Number(total_weeks)

  if (periods !== undefined && periods !== null) {
    if (!Array.isArray(periods)) return { ok: false, error: '节次表格式不正确。' }
    if (periods.length > 15) return { ok: false, error: '节次数最多 15 节。' }
    const seen = {}
    for (const p of periods) {
      const no = Number(p && p.no)
      if (!(no >= 1 && no <= 15) || seen[no]) return { ok: false, error: '节次序号必须是 1–15 且不重复。' }
      seen[no] = true
      if (!/^\d{2}:\d{2}$/.test(String(p.start)) || !/^\d{2}:\d{2}$/.test(String(p.end)))
        return { ok: false, error: '第 ' + no + ' 节的时间格式应为 HH:mm。' }
      if (minOf(p.start) >= minOf(p.end)) return { ok: false, error: '第 ' + no + ' 节的结束时间必须晚于开始时间。' }
    }
    doc.semester.periods = periods.map((p) => {
      const o = { no: Number(p.no), start: String(p.start), end: String(p.end) }
      const sg = Number(p && p.seg) // 分段标记，口径同 createManualSemester
      if (Number.isInteger(sg) && sg >= 1) o.seg = sg
      return o
    })
  }

  /* P13：小学期表（秋/冬）。存成 `sub_terms`（跟主项目 JSON 的 snake 风格一致，
     读取侧 subTermsOf() 两种拼写都认）。给两行以内的表，名字非空、from ≤ to、范围落在学期内。 */
  if (subTerms !== undefined && subTerms !== null) {
    if (!Array.isArray(subTerms)) return { ok: false, error: '小学期格式不正确。' }
    if (subTerms.length > 3) return { ok: false, error: '小学期最多 3 段（大学期两半 + 短学期）。' }
    const clean = []
    for (const x of subTerms) {
      const nm = String((x && x.name) || '').trim()
      if (!nm) return { ok: false, error: '小学期名字不能空（如「秋」「冬」）。' }
      if (nm.length > 4) return { ok: false, error: '小学期名字太长（最多 4 个字）。' }
      const from = Math.floor(Number(x && x.from))
      const to = Math.floor(Number(x && x.to))
      if (!(from >= 1) || !(to >= from)) return { ok: false, error: '「' + nm + '」的周次要满足 起始 ≥ 1 且 结束 ≥ 起始。' }
      if (to > tw) return { ok: false, error: '「' + nm + '」的周次超出了学期总周数（' + tw + '）。' }
      clean.push({ name: nm, from, to })
    }
    const seenName = {}
    for (const x of clean) {
      if (seenName[x.name]) return { ok: false, error: '小学期名字重复了（' + x.name + '）。' }
      seenName[x.name] = true
    }
    doc.semester.sub_terms = clean
  }

  doc.semester.name = n
  doc.semester.first_monday = fm
  doc.semester.total_weeks = tw
  localStorage.setItem(DATA_KEY, JSON.stringify(doc))
  return { ok: true, data: buildFromExport(doc) }
}

/* 节次重排（改时长/课间、段内平移、加删一节）已改为分段式：纯函数在 data/periods.js。
   旧口径（整张表共用一个课间参数）会把午休一起改掉，已弃用。 */
