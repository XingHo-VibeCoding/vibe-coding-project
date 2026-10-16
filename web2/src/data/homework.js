/* 录音纪要 → 待办（五条新功能线 02）—— 把纪要里那条作业的「截止时间」读成人话。
   口径（2026-10-15 立项，2026-10-16 用户拍板 A 方案）：
     - 现状是**自动转**：纪要一生成，homework 就自动进待办，截止日 = 这门课下次上课那天。
       用户拍板保留这个习惯（不改成全手动确认），但让日期更准：LLM 多输出一个 due_hint
       （老师说的原话，如「下周三前」「10 月 20 日」），这边解析成日期，**优先用它**；
       读不出来才回落「下次上课那天」。
     - 纯逻辑：不碰 DOM / localStorage / 原生插件，node 单测直接喂假数据。
     - **读不出来就老实说读不出来**：宁可回落「下次上课那天」，也不猜。
       猜错的代价是污染待办清单 —— 用户会照着一个错的日期去安排时间。
     - 兼容旧纪要：`homework` 以前是字符串数组（还没升级提示词时生成的），
       `hwList()` 统一读成 {text, due_hint}，旧数据不丢。
*/

import { todayKey, addDaysKey } from './listen.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/* 中文星期 → 1..7（周一=1，与课表 weekday 同一套坐标） */
const WD = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }
const REL = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2, 大后天: 3 }

function pad2(n) {
  return String(n).padStart(2, '0')
}
function mkKey(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`
}
/* 日期键 → 星期（1..7）。用本地零点构造，避免 UTC 偏一天。 */
function weekdayOf(key) {
  const d = new Date(key + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? 0 : ((d.getDay() + 6) % 7) + 1
}
/* 同一天也可能出现 2 月 30 日这类不存在的日期：构造后回读，对不上就当没读到 */
function validKey(key) {
  const d = new Date(key + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return false
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` === key
}

/* 老师原话里的截止时间 → 日期键。读不出来返回 { due:null, kind:'none' }。
   kind 标出可信度来源，调用方与界面据此决定要不要提示「按下次上课日估的」：
     exact   —— 说死了日期（2026-10-20 / 10月20日 / 明天）
     weekday —— 说了星期几（下周三 / 周五前）
     none    —— 说不清（「下次上课」「月底」「交作业前」），交给调用方回落 */
export function parseDueHint(hint, today = todayKey()) {
  const raw = String(hint == null ? '' : hint).trim()
  if (!raw) return { due: null, kind: 'none' }
  const base = DATE_RE.test(String(today)) ? String(today) : todayKey()
  const y = Number(base.slice(0, 4))

  /* 1. 完整年月日：2026-10-20 / 2026/10/20 / 2026年10月20日 */
  let m = raw.match(/(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?/)
  if (m) {
    const key = mkKey(Number(m[1]), Number(m[2]), Number(m[3]))
    if (validKey(key)) return { due: key, kind: 'exact' }
  }

  /* 2. 月日（年份按「还没过就是今年、过了就是明年」推）：10月20日 / 10 月 20 号 */
  m = raw.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/)
  if (m) {
    let key = mkKey(y, Number(m[1]), Number(m[2]))
    if (!validKey(key)) key = mkKey(y + 1, Number(m[1]), Number(m[2]))
    if (validKey(key) && key < base) key = mkKey(y + 1, Number(m[1]), Number(m[2]))
    if (validKey(key)) return { due: key, kind: 'exact' }
  }

  /* 3. 纯数字月日：10/20、10-20。
     必须排除「第 1-5 题」「10-20 页」这类量词/区间，否则作业题号会被读成日期。
     两道防线：① 后面不许再跟数字（否则「10-20」会退化成「10-2」）；
     ② 后面不许跟页/题/章等量词，允许中间有空格。 */
  m = raw.match(/(?:^|[^\d第])(\d{1,2})\s*[-/]\s*(\d{1,2})(?!\d)(?!\s*[页题章节行条个分点课讲周])/)
  if (m) {
    const mm = Number(m[1])
    const dd = Number(m[2])
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      let key = mkKey(y, mm, dd)
      if (!validKey(key)) key = mkKey(y + 1, mm, dd)
      if (validKey(key)) {
        if (key < base) key = mkKey(y + 1, mm, dd)
        return { due: key, kind: 'exact' }
      }
    }
  }

  /* 4. 相对日：今天 / 明天 / 后天 / 大后天（大后天要先于后天匹配） */
  if (raw.indexOf('大后天') !== -1) return { due: addDaysKey(base, 3), kind: 'exact' }
  for (const k of Object.keys(REL)) {
    if (raw.indexOf(k) !== -1) return { due: addDaysKey(base, REL[k]), kind: 'exact' }
  }

  /* 5. 星期几：本周五 / 周五 / 下周三 / 下下周周一。
     无「下」字 → 本周内还没到的那个；已经过了就顺延一周（老师不会让你交到过去）。 */
  m = raw.match(/(下{0,2}|本|这)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天])/)
  if (m) {
    const wd = WD[m[2]]
    const nowWd = weekdayOf(base)
    if (wd && nowWd) {
      const shift = m[1] === '下下' ? 2 : m[1] === '下' ? 1 : 0
      let delta = wd - nowWd + shift * 7
      if (shift === 0 && delta < 0) delta += 7
      return { due: addDaysKey(base, delta), kind: 'weekday' }
    }
  }

  /* 6. 只说「下周 / 下下周」没说星期几 → 按下周一算（最常见的默认理解） */
  m = raw.match(/(下{1,2})\s*周(?!\s*[一二三四五六日天])/)
  if (m) {
    const shift = m[1] === '下下' ? 2 : 1
    const delta = 7 - weekdayOf(base) + 1 + (shift - 1) * 7
    return { due: addDaysKey(base, delta), kind: 'weekday' }
  }

  return { due: null, kind: 'none' }
}

/* 纪要 homework → 统一形状 [{text, due_hint}]。
   旧纪要（字符串数组）读成 {text, due_hint:''}；空条目一律剔除，绝不产出空标题。 */
export function hwList(summary) {
  const arr = summary && Array.isArray(summary.homework) ? summary.homework : []
  return arr
    .map((h) => {
      if (h && typeof h === 'object') {
        const text = String(h.text == null ? '' : h.text).trim()
        return text ? { text, due_hint: String(h.due_hint == null ? '' : h.due_hint).trim() } : null
      }
      const text = String(h == null ? '' : h).trim()
      return text ? { text, due_hint: '' } : null
    })
    .filter(Boolean)
}

/* 截止日的来源说明，界面用它告诉用户这个日期是「老师说的」还是「估的」。
   不写「赶紧」这类词，只陈述来源。 */
export function dueSourceText(fromHint) {
  return fromHint ? '课堂提到' : '按下次上课日估的'
}
