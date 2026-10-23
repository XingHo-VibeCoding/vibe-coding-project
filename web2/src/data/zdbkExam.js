/* 06 教务网考试（浙大正方 zdbk「学生考试查询」）
 *
 * 定位：**纯逻辑 + 网络**，不碰 DOM。产出的考试对象与 exams.js 的 sanitizeExam 同形，
 *       所以考试周模式（04）那一整套（倒计时 / 排复习 / 提醒）直接吃，一行不用改。
 *
 * 调研依据（用公开实现记录的**接口事实**，代码自己写）：
 *   · Xecades/zju-ical-py 的 zjuam/ugrs.py：EXAM_URL 与 getExams() 的请求体字段
 *   · 2026-10-19 真机（用户浏览器 Console）实测：一次返回 65 条跨学期记录
 *
 * 三条自律（与 eduLogin.js 同口径）：
 *   ① 不自动重试（学校会锁号）；
 *   ② **不做定时轮询**：只在 App 冷启动时试一次、24 小时最多一次，而且只在用户勾过
 *      「记住密码」时才自动跑 —— 那是他做过的选择，不是我们替他做的。
 *      （2026-10-23 改口径：原先写「只手动触发」，用户明确要求「不要按钮，直接自动导入」，
 *       于是改成「一次冷启动一次机会 + 24 小时节流」，不是偷偷改。）
 *   ③ 凭据不出手机：复用 eduLogin 的同一条 CAS 会话，不新增第二套账号密码。
 *
 * 三个必须记住的实测事实（写死在这，别在别处再猜一遍）：
 *   ① 一条记录可**同时**有期中和期末 → 是两场考试，各自成条；
 *   ② 没有 kssj 的行 = 这门课没有考试 → 必须过滤，不能当成「没填时间的考试」；
 *   ③ 考场（jsmc/zwxh）通常在考前 2–3 周才排 → 现在 6 场全是空字符串，
 *      界面必须显示「考场待公布」，且**同步必须可重复执行**（按 xkkh 认，不按标题）。
 */

import { eduRequest, eduFormBody, loginEduSession, loadEduAccountAsync, eduHttpAvailable } from './eduLogin.js'
import { loadExams, saveExams, EXAM_SYNC_PREFIX } from './exams.js'
import { todayKey } from './listen.js'

/* 考试查询地址（浏览器地址栏里那一串）：gnmkdm=N509070 是「学生考试查询」的功能模块代码。
   ⚠️ 抄错成课表的 N358105 会得到一个「错误提示」HTML 页，看起来像登录失败，其实只是模块码不对。 */
export const EXAM_QUERY_URL = 'https://zdbk.zju.edu.cn/jwglxt/xskscx/kscx_cxXsgrksIndex.html'
export const EXAM_GNMKDM = 'N509070'
/* 同步来的考试 id 一律带这个前缀，用来把「教务同步的」和「手填的」分开 */
/* 同步记录的 id 前缀。**别在这儿另写 'ks_'**：真源在 exams.js 的 EXAM_SYNC_PREFIX，
   界面判断「考场待公布」用的就是它，两处必须同一个值。 */
export const EXAM_ID_PREFIX = EXAM_SYNC_PREFIX
export const EXAM_MAX_COUNT = 5000

const EXAM_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'X-Requested-With': 'XMLHttpRequest',
}

export function examQueryUrlOf(username) {
  const su = encodeURIComponent(String(username || '').trim())
  return EXAM_QUERY_URL + '?doType=query&gnmkdm=' + EXAM_GNMKDM + '&su=' + su
}

/* ---------------- 时间解析 ---------------- */

const pad2 = (s) => String(Number(s)).padStart(2, '0')

/**
 * 解析 kssj / qzkssj。两种真实格式：
 *   「2025年01月04日(10:30-12:30)」→ 日期 + 钟点都拿得到
 *   「冬考试第2天(10:30-12:30)」  → **只有钟点，没有日期**（要校历才算得出）
 * 返回 { date, start, end }；date 为空串表示「这场考试的日期得看校历，我算不出来」。
 * 完全不是考试时间（空串 / 无关文本）返回 null。
 */
export function parseExamTime(text) {
  const s = String(text == null ? '' : text).trim()
  if (!s) return null
  /* 日 与 钟点 之间可能什么都没有，也可能夹着括号 / 空格 / 备注 —— 用「非数字」兜住 */
  const full = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^0-9]{0,8}(\d{1,2}):(\d{2})\s*[-~至]\s*(\d{1,2}):(\d{2})/)
  if (full) {
    return {
      date: full[1] + '-' + pad2(full[2]) + '-' + pad2(full[3]),
      start: pad2(full[4]) + ':' + full[5],
      end: pad2(full[6]) + ':' + full[7],
    }
  }
  const clock = s.match(/(\d{1,2}):(\d{2})\s*[-~至]\s*(\d{1,2}):(\d{2})/)
  if (clock) return { date: '', start: pad2(clock[1]) + ':' + clock[2], end: pad2(clock[3]) + ':' + clock[4] }
  const dayOnly = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (dayOnly) return { date: dayOnly[1] + '-' + pad2(dayOnly[2]) + '-' + pad2(dayOnly[3]), start: '', end: '' }
  return null
}

/* ---------------- 记录 → 考试 ---------------- */

const EXAM_PARTS = [
  { kind: 'final', label: '', raw: 'kssj', place: 'jsmc', seat: 'zwxh' },
  { kind: 'mid', label: '（期中）', raw: 'qzkssj', place: 'qzjsmc', seat: 'qzzwxh' },
]

/**
 * 把 items[] 变成考试数组。**只留「今天及以后」的**（考过的不入档，免得越同步越长）。
 * 返回 { exams, undated, total }：
 *   undated 是「有时间没日期」的那些（真实存在，见 parseExamTime 的说明），
 *   界面可以据此说「另有 N 场考试日期待校历公布」，而不是装作没这回事。
 */
export function rowsToExams(items, { today = todayKey() } = {}) {
  const list = Array.isArray(items) ? items : []
  const t0 = String(today || '')
  const exams = []
  const undated = []
  const seen = Object.create(null)
  for (const it of list) {
    if (!it || typeof it !== 'object') continue
    const kcmc = String(it.kcmc || '').trim()
    if (!kcmc) continue
    const xkkh = String(it.xkkh || '').trim().replace(/\s+/g, '')
    const key = xkkh || kcmc
    for (const p of EXAM_PARTS) {
      const raw = String(it[p.raw] == null ? '' : it[p.raw]).trim()
      const t = parseExamTime(raw)
      if (!t) continue                        /* 没有这场考试 */
      const title = kcmc + p.label
      if (!t.date) {                          /* 「冬考试第 N 天」：日期靠校历，不猜 */
        undated.push({ title, raw, id: EXAM_ID_PREFIX + key + '_' + p.kind })
        continue
      }
      if (t0 && t.date < t0) continue          /* 已经考过 */
      const id = EXAM_ID_PREFIX + key + '_' + p.kind
      if (seen[id]) continue
      seen[id] = 1
      const seat = String(it[p.seat] == null ? '' : it[p.seat]).trim()
      exams.push({
        id,
        title,
        date: t.date,
        start: t.start,
        end: t.end,
        place: String(it[p.place] == null ? '' : it[p.place]).trim(),
        note: seat ? '座位 ' + seat : '',
        created_at: 0,
      })
    }
  }
  exams.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start) || a.title.localeCompare(b.title))
  return { exams, undated, total: list.length }
}

/* ---------------- 与手填考试合并 ---------------- */

export function isSyncedId(id) {
  return String(id == null ? '' : id).indexOf(EXAM_ID_PREFIX) === 0
}

const normTitle = (s) => String(s == null ? '' : s).replace(/[（(]\s*(期中|期末)\s*[)）]/g, '').replace(/\s+/g, '')

/* 同一天 + 标题互相包含 = 说的是同一场考试 */
function sameExamAs(a, b) {
  if (!a || !b || !a.date || a.date !== b.date) return false
  const x = normTitle(a.title)
  const y = normTitle(b.title)
  if (!x || !y) return false
  return x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0
}

/**
 * 合并：**手填优先**。
 *   · 上一次同步进来的记录整批撤掉（否则重复同步会累积出几十条重复考试）；
 *   · 手填的若与某条同步记录「同一天且标题对得上」，就丢掉那条同步记录 —— 手填的更可信
 *     （用户可能知道考场、改了时间，而教务那边还没排）；
 * 返回 { list, dropped }。
 */
export function mergeExams(current, incoming) {
  const cur = Array.isArray(current) ? current : []
  const keep = cur.filter((e) => !isSyncedId(e && e.id))
  const out = keep.slice()
  const dropped = []
  for (const e of Array.isArray(incoming) ? incoming : []) {
    if (!e || !e.id) continue
    if (keep.some((m) => sameExamAs(m, e))) { dropped.push(e); continue }
    out.push(e)
  }
  return { list: out, dropped }
}

/* ---------------- 网络 ---------------- */

/**
 * 拉考试。复用 eduLogin 的同一条 CAS 会话（loginEduSession），所以只要账号密码，
 * 不需要用户再登一次，也不会多存一份凭据。
 * 返回 { ok:true, items, total } 或 { ok:false, error, stage }。
 */
export async function fetchEduExams({ username, password, onStage } = {}) {
  const say = (s) => {
    if (typeof onStage === 'function') onStage(s)
  }
  const u = String(username || '').trim()
  const sess = await loginEduSession({ username: u, password, onStage })
  if (!sess.ok) return sess
  try {
    say('exam')
    const r = await eduRequest({
      method: 'POST',
      url: examQueryUrlOf(u),
      headers: EXAM_HEADERS,
      body: eduFormBody({
        _search: 'false',
        nd: String(Date.now()),
        'queryModel.showCount': String(EXAM_MAX_COUNT),
        'queryModel.currentPage': '1',
        'queryModel.sortName': 'xkkh',
        'queryModel.sortOrder': 'asc',
        time: '0',
      }),
    })
    let json = null
    try {
      json = JSON.parse(r.text)
    } catch {
      const looksLogin = /统一身份认证|login_ssologin|j_username|cas\/login/i.test(r.text || '')
      return {
        ok: false,
        error: looksLogin ? '考试没拿到：会话没建立（被弹回登录页），登录这一步没真正成功。' : '考试接口返回的不是 JSON，接口可能已改版。',
        stage: 'exam',
      }
    }
    const items = json && Array.isArray(json.items) ? json.items : null
    if (!items) return { ok: false, error: '考试返回里没有 items 字段，接口可能已改版。', stage: 'exam' }
    const total = Number(json.totalResult)
    return { ok: true, items, total: Number.isFinite(total) ? total : items.length }
  } catch (e) {
    return { ok: false, error: '请求失败：' + ((e && e.message) || '未知原因'), stage: 'error' }
  }
}

/**
 * 拉 + 解析 + 合并 + 落库。**可反复执行**：第二次同步只更新，不累积。
 * 返回 { ok:true, exams, added, dropped, undated, total }。
 */
export async function syncEduExams({ username, password, onStage, today = todayKey() } = {}) {
  const f = await fetchEduExams({ username, password, onStage })
  if (!f.ok) return f
  const parsed = rowsToExams(f.items, { today })
  const merged = mergeExams(loadExams(), parsed.exams)
  const exams = saveExams(merged.list)
  return {
    ok: true,
    exams,
    added: parsed.exams.length - merged.dropped.length,
    dropped: merged.dropped.length,
    undated: parsed.undated,
    total: f.total,
  }
}

/* ---------------- 自动导入（零按钮） ----------------
   用户 2026-10-23 的原话：「不要加按钮了，直接自动导入不好吗，一直加按钮会让软件变得臃肿」。
   所以这里**没有任何界面入口**：App 冷启动后静默试一次，成功就悄悄写进考试表，
   失败就什么都不说（不弹窗、不提示、不催），第二天再说。

   两条硬约束（写死在判断函数里，不是口号）：
     · 没有密码就不跑 —— 没配过课表直连的人，不该被我们在后台拿去登录；
     · 24 小时内最多一次 —— 学校会因反复登录锁号，节流是为了保护账号，不是为了省流量。 */

export const EXAM_SYNC_KEY = 'web2.examSyncAt'
export const EXAM_SYNC_GAP_MS = 24 * 60 * 60 * 1000

export function loadExamSyncAt() {
  try {
    if (typeof localStorage === 'undefined') return 0
    const n = Number(localStorage.getItem(EXAM_SYNC_KEY))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch (e) {
    return 0
  }
}

export function saveExamSyncAt(ts) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(EXAM_SYNC_KEY, String(Number(ts) || 0))
  } catch (e) {
    /* 记不下就记不下：最多多试一次，不能让界面崩（同 daily.js 口径） */
  }
}

/**
 * 该不该自动同步 —— **纯函数**，单测直接钉它，不用碰网络和浏览器。
 * 返回 { run, reason }，reason 取值：
 *   no-native   不是 App 内（浏览器跨域，跑不了）
 *   no-password 密钥库里没有密码（用户没勾过记住密码）
 *   too-soon    距上次尝试不到 24 小时
 *   due         该跑了
 */
export function autoSyncDecision({ hasPassword, native, lastAt, now } = {}) {
  if (!native) return { run: false, reason: 'no-native' }
  if (!hasPassword) return { run: false, reason: 'no-password' }
  const last = Number(lastAt) || 0
  const t = Number(now) || 0
  if (last > 0 && t - last < EXAM_SYNC_GAP_MS) return { run: false, reason: 'too-soon' }
  return { run: true, reason: 'due' }
}

/**
 * 冷启动时调它一次。**永远不抛**、**永远不打扰**。
 * 返回 { ok, skipped, reason, added?, undated? }，调用方可以完全不管返回值。
 */
export async function autoSyncExams({ now = Date.now() } = {}) {
  const native = eduHttpAvailable()
  if (!native) return { ok: false, skipped: true, reason: 'no-native' }
  let acc = null
  try {
    acc = await loadEduAccountAsync()
  } catch (e) {
    acc = null
  }
  const hasPassword = !!(acc && acc.username && acc.password)
  const d = autoSyncDecision({ hasPassword, native, lastAt: loadExamSyncAt(), now })
  if (!d.run) return { ok: false, skipped: true, reason: d.reason }
  /* ⚠ 先记「尝试时间」再发请求：失败也占掉这 24 小时。
     反过来写（成功才记）会让「密码错了」变成每次冷启动都去撞一次锁号上限。 */
  saveExamSyncAt(now)
  try {
    const r = await syncEduExams({ username: acc.username, password: acc.password })
    return Object.assign({ skipped: false }, r)
  } catch (e) {
    return { ok: false, skipped: false, error: (e && e.message) || '未知原因' }
  }
}

