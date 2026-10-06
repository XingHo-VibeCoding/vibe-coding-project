/* 教务导出文件解析（P12a）—— **纯函数，不碰 DOM / 网络 / localStorage**，Node 可直接单测。
 *
 * 为什么单独一个文件：解析是这条线里最容易出错、也最值得单测的一层；
 * 落库与预览 UI 都依赖它的输出，所以它只做「文本/字节 → 结构化」这一件事。
 *
 * 目标格式：**方正 zfsoft 教务**导出的课表 xlsx（2026-10-06 用浙大真实文件对过）。表头 8 列：
 *   课程代码 | 课程名称 | 教师姓名 | 学期 | 上课时间 | 上课地点 | 选课时间 | 选课志愿
 * 其中两列是「复合」的，这是本文件的主要复杂度：
 *   上课时间  `周二第6,7,8节;周三第9,10节{单周}`
 *   上课地点  `紫金港北3-205;紫金港西4-120`
 *   ⇒ 分号分隔的**多个时段**，与地点**按下标一一对应**（长度不等时以时间为准，地点缺的填空）。
 * 周次花括号：`{单周}` / `{双周}` / `{1-8周}` / `{1-16周}` / `{1-8,10-16周}`。
 *
 * ⚠️ 关于「学期」列（秋 / 冬 / 秋冬 / 短）：那是**小学期归属**，不是周次——
 * 一个大学期分两个小学期，跨两学期的课标「秋冬」。本文件照实存进 `term`，**不据此推算周次**
 * （文件里没有「冬学期从第几周开始」这个信息，猜就是造假）。 */
import { hhmm, minOf } from './listen.js'

/* ---------------- 文本工具 ---------------- */

export function stripTags(s) {
  return String(s == null ? '' : s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
}
export function unescapeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&') // 必须最后替换，否则 &amp;lt; 会二次解码
}
/* 表格单元格清洗：去标签、解实体、压空白、去首尾 */
export function cleanCell(s) {
  return unescapeEntities(stripTags(s)).replace(/[\s\u00a0]+/g, ' ').trim()
}

/* 课程名里夹的说明性方括号（`[双语]` / `【实践】`）去掉，免得同名课被当成两门 */
export function normCourseName(s) {
  return cleanCell(s).replace(/[\[【][^\]】]{0,8}[\]】]/g, '').replace(/\s+/g, '').trim()
}

/* ---------------- 星期 / 节次 ---------------- */

const WEEKDAY_CHARS = ['一', '二', '三', '四', '五', '六', '日', '天']
/** '一'..'日' → 1..7；认不出返回 0 */
export function weekdayOfChar(ch) {
  const i = WEEKDAY_CHARS.indexOf(String(ch || '').trim())
  if (i < 0) return 0
  return i === 7 ? 7 : i + 1 // 「天」也当周日
}

/** 「第6节」「第6,7,8节」→ [6,7,8]（去重升序）；认不出返回 [] */
export function parseSections(s) {
  const t = String(s == null ? '' : s)
  const out = []
  const re = /第\s*([\d,，、\s]+?)\s*节/g
  let m
  while ((m = re.exec(t))) {
    for (const piece of m[1].split(/[,，、\s]+/)) {
      const n = Number(piece)
      if (Number.isFinite(n) && n >= 1 && n <= 20 && out.indexOf(n) === -1) out.push(n)
    }
  }
  return out.sort((a, b) => a - b)
}

/* ---------------- 周次 ---------------- */

/** 中文/数字区间 → 周次数组。`1-8` → [1..8]；`3` → [3] */
function expandRange(part) {
  const t = String(part || '').trim()
  const m = t.match(/^(\d+)\s*[-~－—]\s*(\d+)$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (!(a >= 1 && b >= a && b <= 60)) return []
    const arr = []
    for (let i = a; i <= b; i++) arr.push(i)
    return arr
  }
  const n = Number(t)
  return Number.isFinite(n) && n >= 1 && n <= 60 ? [n] : []
}
function uniqSorted(list) {
  return [...new Set(list)].sort((a, b) => a - b)
}

/**
 * 解析「周次」花括号与常见中文写法。返回 { weeks, note }：
 *   weeks 为 null 表示**没有周次信息**（调用方按「每周」处理，并在预览里如实标注）
 *   weeks 为数组时是显式周次集合（可能很大，如 1..16）
 * 认得的写法：`{1-8周}` `{1-8,10-16周}` `{单周}` `{双周}` `1-16周` `单周` `双周`。
 * 只认「不重复数字」的写法；「第1-2,5周」这类与节次同形的写法**故意不支持**——
 * 无法与「第3,4节」可靠区分时宁可返回 null，也不猜（猜错等于悄悄改课表）。
 */
export function parseWeeks(raw, totalWeeks = 16) {
  const t = String(raw == null ? '' : raw).trim()
  if (!t) return { weeks: null, note: '' }
  const braced = t.match(/\{([^}]*)\}/)
  const body = (braced ? braced[1] : t).replace(/\s+/g, '')
  if (!body) return { weeks: null, note: '' }
  if (/^单周?$/.test(body)) {
    const w = []
    for (let i = 1; i <= totalWeeks; i += 2) w.push(i)
    return { weeks: w, note: '单周' }
  }
  if (/^双周?$/.test(body)) {
    const w = []
    for (let i = 2; i <= totalWeeks; i += 2) w.push(i)
    return { weeks: w, note: '双周' }
  }
  /* `1-8周` / `1-8,10-16周` / `1-8`（花括号里的裸区间） */
  const m = body.match(/^([\d,，、\-~－—]+)周?$/)
  if (m) {
    const parts = m[1].split(/[,，、]+/).filter(Boolean)
    const all = []
    for (const p of parts) all.push(...expandRange(p))
    const w = uniqSorted(all)
    if (w.length) return { weeks: w, note: '' }
  }
  return { weeks: null, note: t }
}

/* ---------------- 一天里的多个时段 ---------------- */

/**
 * 解析「上课时间」整格 → [{ weekday, secs }]。
 * 形如 `周二第6,7,8节;周三第9,10节{单周}`；每段可各带自己的周次花括号。
 */
export function parseTimeSlots(cell) {
  const raw = String(cell == null ? '' : cell)
  const out = []
  for (const seg of raw.split(/[;；]/)) {
    const s = seg.trim()
    if (!s) continue
    const m = s.match(/周\s*([一二三四五六日天])\s*([\s\S]*)$/)
    if (!m) continue
    const weekday = weekdayOfChar(m[1])
    if (!weekday) continue
    const rest = m[2]
    const secs = parseSections(rest)
    const wk = parseWeeks(s)
    out.push({ weekday, secs, weeks: wk.weeks, weekNote: wk.note, raw: s })
  }
  return out
}

/** 解析「上课地点」整格 → 与时间片段**同下标**的数组 */
export function parsePlaceSlots(cell) {
  return String(cell == null ? '' : cell)
    .split(/[;；]/)
    .map((x) => cleanCell(x))
}

/* ---------------- 节次 → 钟点 ---------------- */

/**
 * 节次 → { start, end }（'HH:mm'）。用的是**用户自己的节次表**（periods），
 * 表里没有的节号返回 null —— 调用方据此把那门课列进「需要注意」，而不是悄悄丢掉。
 */
export function periodRange(periods, secs) {
  const list = Array.isArray(periods) ? periods : []
  const byNo = new Map()
  for (const p of list) {
    const no = Number(p && p.no)
    if (Number.isFinite(no)) byNo.set(no, p)
  }
  const missing = []
  let startMin = null
  let endMin = null
  for (const n of secs) {
    const p = byNo.get(n)
    if (!p) {
      missing.push(n)
      continue
    }
    const s = minOf(p.start)
    const e = minOf(p.end)
    if (s >= 0 && (startMin === null || s < startMin)) startMin = s
    if (e >= 0 && (endMin === null || e > endMin)) endMin = e
  }
  if (startMin === null || endMin === null || endMin <= startMin) return { start: '', end: '', missing }
  return { start: hhmm(startMin), end: hhmm(endMin), missing }
}

/* ---------------- 方正 xlsx 解析 ---------------- */

function unzipEntries(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (o) => dv.getUint16(o, true)
  const u32 = (o) => dv.getUint32(o, true)
  /* 从中央目录读（末尾 22 字节 EOCD 起步，最多回退 64KB 找签名） */
  let eocd = -1
  const stop = Math.max(0, bytes.length - 65558)
  for (let i = bytes.length - 22; i >= stop; i--) {
    if (u32(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是 zip/xlsx 文件（找不到中央目录）。')
  const count = u16(eocd + 10)
  let p = u32(eocd + 16)
  const out = new Map()
  for (let i = 0; i < count; i++) {
    if (u32(p) !== 0x02014b50) break
    const method = u16(p + 10)
    const csize = u32(p + 20)
    const nameLen = u16(p + 28)
    const extraLen = u16(p + 30)
    const commentLen = u16(p + 32)
    const localOff = u32(p + 42)
    const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen))
    const mtd = u16(localOff + 8)
    const nameLen2 = u16(localOff + 26)
    const extraLen2 = u16(localOff + 28)
    const dataOff = localOff + 30 + nameLen2 + extraLen2
    const data = bytes.subarray(dataOff, dataOff + csize)
    out.set(name, { method: method || mtd, data })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function readEntry(entries, name) {
  const e = entries.get(name)
  if (!e) return ''
  if (e.method === 0) return new TextDecoder('utf-8').decode(e.data)
  if (typeof DecompressionStream === 'undefined') throw new Error('这个环境不支持解压（DecompressionStream 缺失），无法读 xlsx。')
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([e.data]).stream().pipeThrough(ds)
  return await new Response(stream).text()
}

/** 列号 'A'→0, 'AB'→27 */
function colIndex(ref) {
  const m = String(ref || '').match(/^([A-Z]+)/)
  if (!m) return -1
  let n = 0
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/* 极简 sheet 解析：只取 <c> 的 r / t / <v> / <is><t>，够读课表用。
 *
 * ⚠️ 属性部分必须写成 `((?:[^>"']|"[^"]*"|'[^']*')*?)` 而不是朴素的 `([^>]*)`：
 * `[^>]*` 会贪婪吃掉自闭合单元格结尾的 `/`，于是 `<c r="E3" s="8"/>` 走不进 `\/>` 分支，
 * 整个单元格被静默跳过、它后面的列**整体前移**。2026-10-06 用浙大真实文件踩到：
 * 「测量实习 / 专题设计训练Ⅱ / 创造性设计」三行本来就没写上课时间，
 * 因为 E、F 两个空单元格被吞掉，G 列（选课时间）的 sharedStrings 下标 31/73/77
 * 挪到了下标 4，于是报出来的原因是「上课时间认不出（31）」——**假症状，真原因是没写**。
 * 这个正则两个分支都保留：自闭合（inner 为空）与带内容。 */
function parseSheetXml(xml) {
  const rows = []
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g
  let rm
  while ((rm = rowRe.exec(xml))) {
    const cells = []
    const cellRe = /<c\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/>|>([\s\S]*?)<\/c>)/g
    let cm
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1] || ''
      const inner = cm[3] || ''
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1] || ''
      const t = (attrs.match(/t="([^"]+)"/) || [])[1] || ''
      let val = ''
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)
      const isT = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)
      if (t === 's' && v) val = String(v[1])
      else if (t === 'inlineStr' && isT) val = isT[1]
      else if (isT) val = isT[1]
      else if (v) val = String(v[1])
      /* 自闭合的空单元格也要 push：它占着列位，丢了就会让后面的列前移 */
      cells.push({ col: colIndex(ref), shared: t === 's', val })
    }
    rows.push(cells)
  }
  return rows
}

function parseSharedStrings(xml) {
  const out = []
  const siRe = /<si>([\s\S]*?)<\/si>/g
  let m
  while ((m = siRe.exec(xml))) {
    let text = ''
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g
    let tm
    while ((tm = tRe.exec(m[1]))) text += tm[1]
    out.push(unescapeEntities(text))
  }
  return out
}

/** xlsx（zip）字节 → 二维数组（每格已 cleanCell） */
export async function readXlsxTable(bytes) {
  const entries = unzipEntries(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  const shared = parseSharedStrings(await readEntry(entries, 'xl/sharedStrings.xml'))
  /* 第一张 sheet 的路径可能不是 sheet1.xml，从 workbook 关系里取更稳 */
  let sheetPath = 'xl/worksheets/sheet1.xml'
  const wb = await readEntry(entries, 'xl/workbook.xml')
  const rels = await readEntry(entries, 'xl/_rels/workbook.xml.rels')
  const first = wb.match(/<sheet[^>]*r:id="([^"]+)"/)
  if (first) {
    const r = rels.match(new RegExp('<Relationship[^>]*Id="' + first[1] + '"[^>]*Target="([^"]+)"'))
    if (r) sheetPath = 'xl/' + String(r[1]).replace(/^\/?xl\//, '').replace(/^\//, '')
  }
  const rows = parseSheetXml(await readEntry(entries, sheetPath))
  return rows.map((cells) => {
    const arr = []
    for (const c of cells) {
      if (c.col < 0) continue
      const raw = c.shared ? shared[Number(c.val)] || '' : c.val
      arr[c.col] = cleanCell(raw)
    }
    for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = ''
    return arr
  })
}

/* ---------------- 表头 → 列位置 ---------------- */

const HEADER_ALIASES = {
  code: ['课程代码', '课程号', '课号'],
  name: ['课程名称', '课程名', '教学班名称'],
  teacher: ['教师姓名', '教师', '任课教师', '授课教师'],
  term: ['学期', '开课学期'],
  time: ['上课时间', '上课时间地点', '时间'],
  place: ['上课地点', '地点', '教室'],
}

export function mapHeaders(headerRow) {
  const map = {}
  const cells = (headerRow || []).map((c) => cleanCell(c))
  for (const [key, alts] of Object.entries(HEADER_ALIASES)) {
    const i = cells.findIndex((c) => alts.some((a) => c === a || (c && c.indexOf(a) === 0)))
    if (i >= 0) map[key] = i
  }
  return map
}

/* ---------------- 主入口 ---------------- */

/**
 * 解析方正教务导出（xlsx 字节）。
 * @param {ArrayBuffer|Uint8Array} bytes
 * @param {{ periods?: Array, totalWeeks?: number, semesterName?: string }} opts
 * @returns {{ ok: boolean, semester: object|null, courses: Array, skipped: Array, notes: string[], error?: string, header: string[] }}
 *   courses[i] = {
 *     id, type:'course', weekday, name, place, teacher, code, term,
 *     start, end, week_rule, weeks, secs, source:'edu'
 *   }
 */
export async function parseEduXlsx(bytes, opts = {}) {
  const periods = Array.isArray(opts.periods) ? opts.periods : []
  const totalWeeks = Number(opts.totalWeeks) > 0 ? Number(opts.totalWeeks) : 16
  let table
  try {
    table = await readXlsxTable(bytes)
  } catch (e) {
    return { ok: false, courses: [], skipped: [], notes: [], semester: null, header: [], error: '读不了这个文件：' + ((e && e.message) || '不是有效的 xlsx。') }
  }
  /* 表头行：取前 8 行里「认出的列最多」的那一行 */
  let headIdx = -1
  let map = null
  for (let i = 0; i < Math.min(table.length, 8); i++) {
    const m = mapHeaders(table[i])
    const need = m.name !== undefined && m.time !== undefined ? Object.keys(m).length + 1 : Object.keys(m).length
    if (!map || need > Object.keys(map).length) {
      map = m
      headIdx = i
    }
  }
  if (!map || map.name === undefined) {
    return { ok: false, courses: [], skipped: [], notes: [], semester: null, header: (table[0] || []), error: '没找到课表表头（至少要有一列「课程名称」）。' }
  }
  const notes = []
  /* 标题行（表头上一行）常写「2026-2027学年秋冬学期XXX的课表」，摘学期名用 */
  let title = ''
  for (let i = Math.max(0, headIdx - 2); i < headIdx; i++) {
    const t = (table[i] || []).find((c) => c && c.length > 6)
    if (t && /课表/.test(t)) {
      title = t
      break
    }
  }
  const semMatch = title.match(/^(\d{4}-\d{4}\s*学年\s*[^的]{0,8}学期)/)
  const semester = {
    name: opts.semesterName || (semMatch ? semMatch[1] : '') || '教务导入的学期',
    title,
  }
  if (title && /的课表/.test(title)) notes.push('文件标题里带了姓名（' + title.replace(/^.*学期/, '').trim() + '），已忽略、不入库。')

  const courses = []
  const skipped = []
  const noTime = []
  const missingSecs = new Set()
  for (let i = headIdx + 1; i < table.length; i++) {
    const row = table[i] || []
    const get = (k) => (map[k] === undefined ? '' : cleanCell(row[map[k]]))
    const rawName = get('name')
    const name = normCourseName(rawName)
    if (!name) continue // 空行/尾行
    const code = get('code')
    const teacher = get('teacher')
    const term = get('term')
    const timeCell = get('time')
    const placeCell = get('place')
    const slots = parseTimeSlots(timeCell)
    const places = parsePlaceSlots(placeCell)
    if (!slots.length) {
      noTime.push({ name, code, teacher, term, reason: timeCell ? '上课时间认不出（' + timeCell + '）' : '文件里没写上课时间' })
      continue
    }
    slots.forEach((slot, si) => {
      const place = String(places[si] || '').trim()
      const r = periodRange(periods, slot.secs)
      for (const n of r.missing) missingSecs.add(n)
      const weeks = slot.weeks
      if (!r.start || !r.end) {
        skipped.push({ name, weekday: slot.weekday, secs: slot.secs, reason: '节次表里没有第 ' + slot.secs.join('、') + ' 节' })
        return
      }
      courses.push({
        id: 'edu_' + (code || 'x') + '_' + slot.weekday + '_' + r.start.replace(':', ''),
        type: 'course',
        source: 'edu',
        weekday: slot.weekday,
        name,
        place,
        teacher,
        code,
        term,
        start: r.start,
        end: r.end,
        secs: slot.secs,
        weeks, // null = 每周
        week_rule: weeks ? (weeks.length && weeks.every((w) => w % 2 === 1) ? 'odd' : weeks.every((w) => w % 2 === 0) ? 'even' : 'every') : 'every',
        week_note: slot.weekNote || (weeks ? weeks.join(',') : ''),
      })
    })
  }
  const terms = [...new Set(courses.map((c) => c.term).filter(Boolean))]
  const termsNonIdle = terms.filter((t) => t !== '秋冬')
  if (termsNonIdle.length) {
    notes.push('课程带小学期归属：' + terms.join(' / ') + '。文件里没有「小学期从第几周开始」，所以周次按整学期排 —— 要按小学期分界得你告诉我分界周次。')
  }
  if (noTime.length) notes.push(noTime.length + ' 门课文件里没有可用上课时间，已跳过（不是静默丢掉，下面列出来了）。')
  if (missingSecs.size) notes.push('节次表里缺第 ' + [...missingSecs].sort((a, b) => a - b).join('、') + ' 节，相关课没进预览。')

  /* 文件本身可能带重复行（2026-10-06 用户的真实导出里，「结构设计原理和方法Ⅰ 周二第6,7,8节」
     就出现了两次，两行逐字相同）——按「星期+起止+课名+周次」去重，否则会导进两遍。
     只去掉**完全相同**的行：同名课在不同星期/不同节次是正常的，不能合。 */
  const seen = new Set()
  const uniq = []
  let dupRows = 0
  for (const c of courses) {
    const key = [c.weekday, c.start, c.end, c.name, (c.weeks || []).join('/')].join('|')
    if (seen.has(key)) {
      dupRows++
      continue
    }
    seen.add(key)
    uniq.push(c)
  }
  if (dupRows) notes.push('文件里有 ' + dupRows + ' 条与前面完全重复的上课记录，已去掉（老师在不同星期/节次重复排同一门课不算重复，那种会保留）。')

  return { ok: true, semester, courses: uniq, skipped, notes, header: table[headIdx] || [], noTime, dupRows }
}
