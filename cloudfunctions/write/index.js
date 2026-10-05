// Day 22｜写接口（create / update / delete）—— 接口层（HTTP layer）
//
// 本层管：HTTP 方法分发、口令校验、参数校验（表名白名单 / 列白名单 / 必填字段）、
//         响应组装与状态码
// 本层不管：怎么连库（URL / headers / 环境变量 / 超时 / PostgREST 错误翻译）→ db.js
//
// 三个路由都指向这一个函数（CloudBase HTTP 访问服务按「路径 → 函数」映射，
// 三条路由 = /api/create、/api/update、/api/delete，方法分别是 POST / PUT / DELETE）：
//   POST   /api/create  {"table":"todos","row":{…}}     新增一条
//   PUT    /api/update  {"table":"todos","id":"…","patch":{…}}  改一条
//   DELETE /api/delete  {"table":"todos","id":"…"}      删一条
// 分发**只看 HTTP 方法**：不依赖「路径透传」是否打开，网关怎么配都不会失手。
//
// 为什么把契约里的 POST /api/favorite 换掉了：契约是 Day 15 写的占位，
// 「收藏某条」在前端数据模型里根本不存在（App 没有收藏概念），照着实现等于
// 凭空造一个没人用的字段。真实需要的是「新增 / 改一条 / 删一条」，所以换成
// create / update / delete —— 这次改动同时同步了 docs/api-contract.md（三处同步规矩）。
//
// 鉴权（见契约「写接口鉴权」一节，如实标注了强度）：
//   环境变量 WRITE_TOKEN 是口令；请求带 X-Write-Token 头（或 ?token= 查询参数、
//   或 Authorization: Bearer <token>）必须与它相等，否则 401。
//   WRITE_TOKEN 没配 → 一律拒绝（fail-closed），绝不「没配就放行」。
//   这是测试环境的强度：口令会出现在示例页面的源码里，能防路人、防不了有心人；
//   升级路径是 CloudBase 匿名登录 + 表加 owner_uid（契约里写了）。
'use strict'

const db = require('./db')

/* 每张表允许写的列（照 db/schema.sql 抄的），以及新增时的必填列
   （NOT NULL 且没有默认值的那些：id / title / due_date 这类的）。
   created_at / updated_at 由本层统一盖时间戳，不在下面这两张名单里。 */
const TABLES = {
  todos: {
    cols: ['id', 'title', 'note', 'due_date', 'done', 'done_at', 'source'],
    need: ['id', 'title', 'due_date'],
  },
  schedules: {
    cols: ['id', 'semester_id', 'type', 'title', 'note', 'location', 'weekday',
      'start_time', 'duration', 'week_rule', 'date', 'color', 'manual_edited'],
    need: ['id', 'type', 'title', 'start_time', 'duration'],
  },
  semesters: {
    cols: ['id', 'name', 'first_monday', 'total_weeks', 'periods'],
    need: ['id', 'name', 'first_monday'],
  },
}

const ACTION_BY_METHOD = { POST: 'create', PUT: 'update', DELETE: 'delete' }

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function reply(status, payload) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  }
}

function fail(status, message) {
  return reply(status, { ok: false, message, status })
}

/* ── 从事件里取值：HTTP 服务、云函数直调、本地 `tcb fn run` 三种形状都认 ── */
function readMethod(event) {
  const m = (event && (event.httpMethod || (event.requestContext && event.requestContext.httpMethod))) || ''
  return String(m).toUpperCase()
}

function readHeaders(event) {
  const h = (event && event.headers) || {}
  const out = {}
  Object.keys(h).forEach(function (k) { out[String(k).toLowerCase()] = h[k] })
  return out
}

function readQuery(event) {
  const q = {}
  const a = (event && event.queryStringParameters) || {}
  const b = (event && event.query) || {}
  Object.keys(a).forEach(function (k) { q[k] = a[k] })
  Object.keys(b).forEach(function (k) { q[k] = b[k] })
  // 网关有时把查询串平铺在 event 上
  Object.keys(event || {}).forEach(function (k) {
    if (['table', 'id', 'token', 'action'].indexOf(k) >= 0 && q[k] === undefined) q[k] = event[k]
  })
  return q
}

function readBody(event) {
  const raw = event && event.body
  if (raw === undefined || raw === null || raw === '') return {}
  if (typeof raw === 'object') return raw
  let text = String(raw)
  if (event.isBase64Encoded) text = Buffer.from(text, 'base64').toString('utf8')
  try {
    const o = JSON.parse(text)
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('not object')
    return o
  } catch (e) {
    throw new HttpError(400, '请求体不是合法 JSON 对象')
  }
}

/* 口令：头优先，其次查询串 ?token=，再次 Authorization: Bearer。
   查询串形式是为了浏览器示例页能发「简单请求」（不带自定义头 → 不触发预检），
   契约里如实写了这个取舍。 */
function readToken(event, headers, query, body) {
  if (headers['x-write-token']) return String(headers['x-write-token'])
  if (query.token) return String(query.token)
  if (body && body.token) return String(body.token)
  const auth = headers.authorization || ''
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim()
  return ''
}

function checkToken(event, headers, query, body) {
  const expect = process.env.WRITE_TOKEN || ''
  if (!expect) {
    return fail(500, '写接口未配置口令（云函数环境变量 WRITE_TOKEN 为空），已拒绝所有写入')
  }
  const got = readToken(event, headers, query, body)
  if (!got) return fail(401, '缺少口令：请带 X-Write-Token 请求头（或 ?token= 查询参数）')
  if (got !== expect) return fail(401, '口令不正确')
  return null
}

/* ── 参数校验 ── */
function readTable(body, query) {
  const table = String((body && body.table) || query.table || '')
  if (!table) throw new HttpError(400, '缺少 table（可选：' + Object.keys(TABLES).join(' / ') + '）')
  if (!TABLES[table]) throw new HttpError(400, '未知 table：' + table + '（可选：' + Object.keys(TABLES).join(' / ') + '）')
  return table
}

/* 列白名单：不在名单里的键一律拒绝（而不是静默丢掉）——
   静默丢弃会让前端以为写成功了，实际字段没落库。 */
function pickColumns(table, src, label) {
  const spec = TABLES[table]
  const out = {}
  const bad = []
  Object.keys(src || {}).forEach(function (k) {
    if (k === 'created_at' || k === 'updated_at') return // 时间戳由本层盖
    if (spec.cols.indexOf(k) < 0) bad.push(k)
    else out[k] = src[k]
  })
  if (bad.length) throw new HttpError(400, label + ' 里有该表没有的列：' + bad.join(' / '))
  return out
}

function requireFields(table, row) {
  const missing = TABLES[table].need.filter(function (k) { return row[k] === undefined || row[k] === null || row[k] === '' })
  if (missing.length) throw new HttpError(400, table + ' 缺少必填列：' + missing.join(' / '))
}

function nowIso() {
  return new Date().toISOString()
}

/* ── 三个动作 ── */
async function doCreate(body, query) {
  const table = readTable(body, query)
  const src = body.row || body.data
  if (!src || typeof src !== 'object' || Array.isArray(src)) throw new HttpError(400, '缺少 row 对象')
  const row = pickColumns(table, src, 'row')
  requireFields(table, row)
  row.updated_at = nowIso()
  row.created_at = src.created_at || row.updated_at
  const rows = await db.insertRow(table, row)
  const saved = Array.isArray(rows) ? rows[0] : rows
  return reply(201, { ok: true, action: 'create', table, row: saved })
}

async function doUpdate(body, query) {
  const table = readTable(body, query)
  const id = String((body.id !== undefined ? body.id : query.id) || '')
  if (!id) throw new HttpError(400, '缺少 id')
  const src = body.patch || body.row
  if (!src || typeof src !== 'object' || Array.isArray(src)) throw new HttpError(400, '缺少 patch 对象')
  const patch = pickColumns(table, src, 'patch')
  patch.updated_at = nowIso()
  if (Object.keys(patch).length <= 1) throw new HttpError(400, 'patch 里没有可改的列')
  const rows = await db.updateRow(table, id, patch)
  if (!Array.isArray(rows) || !rows.length) return fail(404, '没有找到这条记录：' + table + ' / ' + id)
  return reply(200, { ok: true, action: 'update', table, id, row: rows[0] })
}

async function doDelete(body, query) {
  const table = readTable(body, query)
  const id = String((body.id !== undefined ? body.id : query.id) || '')
  if (!id) throw new HttpError(400, '缺少 id')
  const rows = await db.deleteRow(table, id)
  if (!Array.isArray(rows) || !rows.length) return fail(404, '没有找到这条记录：' + table + ' / ' + id)
  return reply(200, { ok: true, action: 'delete', table, id, row: rows[0] })
}

/* ── 入口 ── */
exports.main = async function (event) {
  let body = {}
  let bodyError = null
  const headers = readHeaders(event)
  const query = readQuery(event)
  try {
    body = readBody(event)
  } catch (e) {
    bodyError = e
  }

  // 口令校验先于请求体解析：未授权的一律 401，不给「body 格式」这类探测信息
  const denied = checkToken(event, headers, query, body)
  if (denied) return denied

  if (bodyError) return fail(bodyError.status || 400, bodyError.message)

  const method = readMethod(event)
  const action = ACTION_BY_METHOD[method] || String(body.action || query.action || '').toLowerCase()
  if (!action) {
    return fail(405, '不支持的方法：' + (method || '(空)') + '（写接口只接受 POST / PUT / DELETE）')
  }

  try {
    console.log('[write] ' + action + ' table=' + (body.table || query.table || '?') + ' id=' + (body.id || query.id || '-'))
    if (action === 'create') return await doCreate(body, query)
    if (action === 'update') return await doUpdate(body, query)
    if (action === 'delete') return await doDelete(body, query)
    return fail(400, '未知 action：' + action)
  } catch (e) {
    const status = e && e.status ? e.status : 500
    return fail(status, (e && e.message) ? e.message : String(e))
  }
}
