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
//
// Day 23 补：错误一律经 ./errors.js 分类（input / network / server），
// 响应体带上 kind 字段；本层不再直接 new Error，也不再靠字符串强转兜底。
'use strict'

const db = require('./db')
const { input, notFound, server, toResponse } = require('./errors')

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

/* 响应体统一带 kind：前端拿 kind 分类（要不要提示「重试」、要不要高亮某个输入框），
   不用去猜 message 里的字。kind 的取值与含义见 ./errors.js 顶部。 */
function reply(status, payload) {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  }
}

function fail(err) {
  const r = toResponse(err)
  return reply(r.status, r)
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
    throw input('请求体不是合法 JSON 对象：请检查格式（常见原因是多了尾逗号、用了单引号、或少了引号）')
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
    return fail(server('写接口', 500, '写接口未配置口令（云函数环境变量 WRITE_TOKEN 为空），已拒绝所有写入。这是服务端配置问题，不是你的请求有错。'))
  }
  const got = readToken(event, headers, query, body)
  // 口令错/缺口令：调用方能自己改 → kind=input；但 HTTP 语义要用 401（未授权）
  if (!got) return fail(input('缺少口令：请带 X-Write-Token 请求头（或 ?token= 查询参数）', 401))
  if (got !== expect) return fail(input('口令不正确：请核对 X-Write-Token 的值是否与云函数环境变量 WRITE_TOKEN 一致', 401))
  return null
}

/* ── 参数校验 ── */
function readTable(body, query) {
  const table = String((body && body.table) || query.table || '')
  if (!table) throw input('缺少 table（可选：' + Object.keys(TABLES).join(' / ') + '）')
  if (!TABLES[table]) throw input('未知 table：「' + table + '」（可选：' + Object.keys(TABLES).join(' / ') + '）')
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
  if (bad.length) {
    throw input('「' + label + '」里有该表没有的列：' + bad.join(' / ')
      + '。' + table + ' 允许的列：' + spec.cols.join(' / '))
  }
  return out
}

function requireFields(table, row) {
  const missing = TABLES[table].need.filter(function (k) { return row[k] === undefined || row[k] === null || row[k] === '' })
  if (missing.length) throw input(table + ' 缺少必填列：' + missing.join(' / ') + '（这几列不能为空）')
}

function nowIso() {
  return new Date().toISOString()
}

/* ── 三个动作 ── */
async function doCreate(body, query) {
  const table = readTable(body, query)
  const src = body.row || body.data
  if (!src || typeof src !== 'object' || Array.isArray(src)) throw input('缺少 row 对象：新增时要用 {"table":"…","row":{…}} 的形状')
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
  if (!id) throw input('缺少 id：改一条要指明改哪一条')
  const src = body.patch || body.row
  if (!src || typeof src !== 'object' || Array.isArray(src)) throw input('缺少 patch 对象：改一条要用 {"table":"…","id":"…","patch":{…}} 的形状')
  const patch = pickColumns(table, src, 'patch')
  patch.updated_at = nowIso()
  if (Object.keys(patch).length <= 1) throw input('patch 里没有可改的列（只带了时间戳，等于什么都没改）')
  const rows = await db.updateRow(table, id, patch)
  if (!Array.isArray(rows) || !rows.length) return fail(notFound('没有找到这条记录：' + table + ' / ' + id + '（id 写对了吗？可以先用 GET /api/list 确认它存在）'))
  return reply(200, { ok: true, action: 'update', table, id, row: rows[0] })
}

async function doDelete(body, query) {
  const table = readTable(body, query)
  const id = String((body.id !== undefined ? body.id : query.id) || '')
  if (!id) throw input('缺少 id：删一条要指明删哪一条')
  const rows = await db.deleteRow(table, id)
  if (!Array.isArray(rows) || !rows.length) return fail(notFound('没有找到这条记录：' + table + ' / ' + id + '（可能已经被删过了）'))
  return reply(200, { ok: true, action: 'delete', table, id, row: rows[0] })
}

/* ── 请求日志（Day 23 余力加练）──
   一行一次请求：时间 | 方法 路径 | 动作 表 id | 结果。
   只记表名与 id，**不记请求体** —— 请求体里可能有整行数据，也可能有人把口令塞进 body。
   对应地，成功的行由调用处打印，失败的行在入口 catch 里统一打印。 */
function logRequest(method, path, action, table, id, result) {
  const t = new Date().toISOString()
  console.log('[write] ' + t + ' | ' + method + ' ' + path
    + ' | 动作=' + (action || '-') + ' 表=' + (table || '-') + ' id=' + (id || '-')
    + ' | ' + result)
}

/* ── 入口 ── */
exports.main = async function (event) {
  let body = {}
  let bodyError = null
  const headers = readHeaders(event)
  const query = readQuery(event)
  const method0 = (event && (event.httpMethod || event.method)) || ''
  const path0 = (event && (event.path || event.rawPath)) || '/api/write'
  try {
    body = readBody(event)
  } catch (e) {
    bodyError = e
  }

  // 口令校验先于请求体解析：未授权的一律 401，不给「body 格式」这类探测信息
  const denied = checkToken(event, headers, query, body)
  if (denied) {
    logRequest(method0, path0, '', body.table, body.id, 'DENY 口令未通过')
    return denied
  }

  if (bodyError) {
    logRequest(method0, path0, '', body.table, body.id, 'FAIL 请求体不是合法 JSON')
    return fail(bodyError)
  }

  const method = readMethod(event)
  const action = ACTION_BY_METHOD[method] || String(body.action || query.action || '').toLowerCase()
  if (!action) {
    logRequest(method0, path0, '', body.table, body.id, 'FAIL 方法不支持 ' + method)
    return fail(input('不支持的方法：' + (method || '(空)') + '（写接口只接受 POST / PUT / DELETE）', 405))
  }

  const table = body.table || query.table || '?'
  const id = body.id || query.id || '-'
  try {
    let res
    if (action === 'create') res = await doCreate(body, query)
    else if (action === 'update') res = await doUpdate(body, query)
    else if (action === 'delete') res = await doDelete(body, query)
    else return fail(input('未知 action：「' + action + '」（只认 create / update / delete）'))
    const code = res && res.statusCode ? res.statusCode : '?'
    logRequest(method0, path0, action, table, id, (code < 400 ? 'OK ' : 'FAIL ') + code)
    return res
  } catch (e) {
    // 三类错误在这里统一成 { ok:false, kind, message, status } —— 不把堆栈/英文原文漏给前端
    const res = fail(e)
    const r = toResponse(e)
    logRequest(method0, path0, action, table, id, 'FAIL [' + r.kind + ' ' + r.status + '] ' + r.message)
    return res
  }
}
