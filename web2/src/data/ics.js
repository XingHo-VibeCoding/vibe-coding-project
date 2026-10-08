// web2 ICS 导出：移植主项目 ics.js 口径（TECH_DESIGN §4.1 / PRD F9）
// 规范要点：行尾必须 CRLF；时间用本地浮动时间（无时区后缀），导入方按本地时间解释；
// 每条日程带课前 15 分钟提醒（VALARM TRIGGER:-PT15M）。
// 入参用 web2 显示形状：courses {id,name,place,weekday,start,end,week_rule}、events {id,name,place,date,start,end}
// overrides（可选）：调休覆盖表（store.js 的 web2.dayOverrides）。不传 = 行为与加调休之前逐字一致。
import { minOf, matchWeek, effectiveWeekdayOf } from './store.js'

const REMIND_MINUTES = 15

function pad2(n) { return (n < 10 ? '0' : '') + n }

/* .ics 文本转义：反斜杠、分号、逗号、换行（RFC 5545 §3.3.11） */
function escText(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/* Date + 'HH:mm' → 'YYYYMMDDTHHMMSS'（本地浮动时间） */
function icsStamp(date) {
  return pad2(date.getFullYear()) + pad2(date.getMonth() + 1) + pad2(date.getDate()) +
    'T' + pad2(date.getHours()) + pad2(date.getMinutes()) + pad2(date.getSeconds())
}

/* 当前时刻的 UTC 时间戳（DTSTAMP 规范要求 Z 结尾） */
function icsStampNow() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function dateKey(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

/* 单个事件的 .ics 片段（durationMin 为分钟数，可能跨 0 点） */
function vevent(uid, date, startTime, durationMin, summary, location, description) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(startTime || ''))
  const hh = m ? Number(m[1]) : 0
  const mm = m ? Number(m[2]) : 0
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hh, mm, 0)
  const end = new Date(start.getTime() + Number(durationMin || 0) * 60000)
  const lines = [
    'BEGIN:VEVENT',
    'UID:' + escText(uid),
    'DTSTAMP:' + icsStampNow(),
    'DTSTART:' + icsStamp(start),
    'DTEND:' + icsStamp(end),
  ]
  if (summary) lines.push('SUMMARY:' + escText(summary))
  if (location) lines.push('LOCATION:' + escText(location))
  if (description) lines.push('DESCRIPTION:' + escText(description))
  lines.push(
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT' + REMIND_MINUTES + 'M',
    'DESCRIPTION:' + escText(summary || '日程提醒'),
    'END:VALARM',
    'END:VEVENT',
  )
  return lines
}

/* 生成 .ics 全文。返回 { text, count }：text 为空串表示没有可导出的日程
   routines 与 courses 同构（weekday + start/end + week_rule），同样逐周展开。

   调休（2026-10-08）：overrides 是 store.js 的 web2.dayOverrides。有它时改成**逐日展开**
   —— 原来的「逐周 × weekday 位移」表达不了补课日（周六上周三的课），而导出必须和 App 里
   看到的课表一致。没有任何覆盖时，逐日展开算出的日期与原实现**逐字一致**（UID 用日期做键，
   条数也不变），所以老数据导出结果完全不变。 */
export function buildIcs({ semester, courses, events, routines, overrides }) {
  const firstMonday = semester && semester.firstMonday
  const total = semester && Number(semester.totalWeeks) ? Number(semester.totalWeeks) : 0
  const semName = (semester && semester.name) || ''
  const ovList = Array.isArray(overrides) ? overrides : []

  const out = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//sched-local//大学生日程助手//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  if (semName) out.push('X-WR-CALNAME:' + escText(semName))

  let count = 0

  /* 逐日展开出「学期里每一天」：{ date, weekNo, eff }，eff = 这天算星期几（放假/只提示 = null）。 */
  function semesterDays() {
    const anchor = new Date(firstMonday + 'T00:00:00')
    if (isNaN(anchor)) return null
    const days = []
    for (let i = 0; i < total * 7; i++) {
      const d = new Date(anchor)
      d.setDate(d.getDate() + i)
      const natural = ((d.getDay() + 6) % 7) + 1 // 周一=1 … 周日=7
      days.push({
        d,
        weekNo: Math.floor(i / 7) + 1,
        eff: effectiveWeekdayOf(dateKey(d), ovList, natural),
      })
    }
    return days
  }

  // 课程 / 循环日程：同一套展开方式（按周次规则逐日落到具体日期）。
  const days = (firstMonday && total) ? semesterDays() : null
  if (days) {
    for (const c of Array.isArray(courses) ? courses : []) {
      if (!c || c.type !== 'course') continue
      const dur = minOf(c.end) - minOf(c.start)
      for (const { d, weekNo, eff } of days) {
        if (eff === null || Number(c.weekday) !== eff) continue
        if (!matchWeek(c, weekNo, semester.subTerms)) continue
        const loc = c.place ? (semName + ' 第' + weekNo + '周 · ' + c.place) : ''
        out.push(...vevent(c.id + '-' + dateKey(d) + '@sched-web2', d, c.start, dur, c.name, loc, ''))
        count++
      }
    }

    /* 循环日程：与课程同一套周次规则，不受学期起止之外的限制。
       SUMMARY 保持原样不加前缀 —— 日历列表里「健身」本来就不会和课名混；
       是不是循环日程写在 DESCRIPTION，点开才看到，不占列表宽度。 */
    for (const r of Array.isArray(routines) ? routines : []) {
      if (!r || r.type !== 'routine') continue
      const dur = minOf(r.end) - minOf(r.start)
      const rl = r.week_rule && r.week_rule !== 'every'
        ? (r.week_rule === 'odd' ? '单周' : '双周')
        : ''
      for (const { d, weekNo, eff } of days) {
        if (eff === null || Number(r.weekday) !== eff) continue
        if (!matchWeek(r, weekNo, semester.subTerms)) continue
        const loc = r.place ? (semName + ' · ' + r.place) : semName
        out.push(...vevent(r.id + '-' + dateKey(d) + '@sched-web2', d, r.start, dur, r.name, loc, '循环日程' + rl))
        count++
      }
    }
  }

  // 独立日程：单次事件（含用户在 web2 里手动加的）
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || e.type !== 'event' || !e.date) continue
    const d = new Date(e.date + 'T00:00:00')
    if (isNaN(d)) continue
    out.push(...vevent(e.id + '@sched-web2', d, e.start, minOf(e.end) - minOf(e.start), e.name, e.place || '', ''))
    count++
  }

  out.push('END:VCALENDAR')
  return { text: count ? out.join('\r\n') + '\r\n' : '', count }
}

/* Blob + <a download> 触发浏览器下载 */
export function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
