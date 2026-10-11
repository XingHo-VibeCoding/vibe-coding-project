// Day 28｜云同步接口（整份上传 / 下载 / 清空）—— 接口层（HTTP layer）
//
// 本层管：HTTP 方法分发、同步串校验（→ owner_uid）、参数与体积校验、响应组装与状态码、
//         版本号冲突判定
// 本层不管：怎么连库（URL / headers / 环境变量 / 超时 / PostgREST 错误翻译）→ db.js
//
// 一个函数三个方法（网关按路径映射，三条路由都指向本函数）：
//   POST   /api/sync   {"pass":"…","doc":{…},"baseRev":3}   整份上传（首次即新建）
//   GET    /api/sync?pass=…                                 下载（云端没有 → found:false）
//   DELETE /api/sync?pass=…                                 清空云端这一份
//   另有 POST {"action":"delete"} 等价于 DELETE（浏览器「简单请求」发不出 DELETE 时用）
// 分发**只看 HTTP 方法**：不依赖「路径透传」是否打开，网关怎么配都不会失手。
//
// 为什么不走 /api/create|update|delete：那三个是「逐条 CRUD」，同步一份文档要发几百个
// 请求，中途断网就得到半份数据（半份比没有更坏）。整份 PUT 是原子的：要么旧版要么新版。
// 契约（docs/api-contract.md §6）里写的升级路径就是「整份同步」，这里按它实现。
//
// 鉴权（用户 2026-10-12 拍板：「同步串派 owner_uid」）：
//   用户在设置里自己定一个同步串，**只存本机**；请求带 pass（body / ?pass= / X-Sync-Pass），
//   服务端算 owner_uid = HMAC-SHA256(WRITE_TOKEN, "sched-sync-v1|" + pass) 当主键。
//   · 为什么不是「口令相等」而是「派生成身份」：同步不需要一次性口令，需要的是「两台设备
//     输入同一串就能看到同一份数据」——同一串必须算出同一个 uid，这就是 HMAC 的作用。
//   · 为什么拿 WRITE_TOKEN 当 HMAC 的钥匙（而不是裸 sha256）：uid 会落库，万一库被人看到，
//     裸 sha256 能对着短口令离线爆破，加了服务端才有的钥匙就爆不出来。
//     ⚠ 代价（如实写在这里）：换掉云函数环境变量 WRITE_TOKEN，同一串算出的 uid 就变了，
//     旧数据会取不回（本地数据不受影响，重新上传即可）。WRITE_TOKEN 属于「装上就不该动」的配置。
//   · 强度：串是唯一凭据，串弱了被人猜到就能读走这一份数据 —— 用户已知悉并接受。
//     6 字符下限只是挡住「123」这种，真安全靠用户自己起一个长串。
//
// 契约：响应体统一带 kind（input / network / server），取值与含义见 ./errors.js 顶部。
// 本层不直接 new Error，也不靠字符串强转兜底。
'use strict'

const crypto = require('crypto')
const db = require('./db')
const { input, server, toResponse } = require('./errors')

/* 同步文档的形状版本：doc 里自带 version，将来换形状时靠它分流。
   与 sync/index.js 的接口版本无关（接口版本靠路由名）。 */
const SYNC_DOC_VERSION = 1

/* 一份同步数据的字符上限。整份课表+待办实测在 30KB 量级，100 万字符够用两个数量级，
   只挡「误把录音 base64 塞进来」这种明显错误（录音是设备本地大件，本轮明确不同步）。

   2026-10-12 实测修正：**真正的天花板不在这个函数里，在 CloudBase 网关**。
   网关对 HTTP 访问服务的请求体有硬上限，实测 100,081 字节的 body 能进（HTTP 200），
   120,081 字节就被网关自己挡在函数之外（HTTP 413 EXCEED_MAX_PAYLOAD_SIZE，
   报文里没有我们的 ok/kind —— 说明请求根本没跑到 node 里）。
   所以上限按**网关**来定，留一点余量：doc 序列化后 ≤ 90,000 字符。
   比这个函数原来的 100 万更有意义：超了的话用户会拿到网关那句英文报文，
   而不是我们「录音请留在本机」的人话说明。 */
const MAX_DOC_CHARS = 90000

const MIN_PASS = 6
const MAX_PASS = 128

/* 三个方法各自认什么；不支持的方法报的文案从这里拼，避免三处各写一遍。 */
const ALLOWED = 'GET（下载）/ POST（上传）/ DELETE（清空）'

/* ── 响应体组装（与 write/index.js 同一形状）── */
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
    if (['pass', 'token', 'action', 'baseRev', 'force'].indexOf(k) >= 0 && q[k] === undefined) q[k] = event[k]
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

/* ── 同步串 → owner_uid ──
   pass 的取法：body.pass → ?pass= → X-Sync-Pass 头。
   查询串形式是给浏览器「简单请求」留的路（与 /api/list 的 ?token= 同一取舍，契约里写了）。
   注意：故意**不**在日志里打印 pass，也不打印完整 uid。 */
function readPass(headers, query, body) {
  if (body && body.pass) return String(body.pass)
  if (query.pass) return String(query.pass)
  if (headers['x-sync-pass']) return String(headers['x-sync-pass'])
  return ''
}

function ownerUid(pass) {
  const pepper = process.env.WRITE_TOKEN || ''
  if (!pepper) {
    throw server('同步接口', 500, '同步接口未配置同步钥匙（云函数环境变量 WRITE_TOKEN 为空），已拒绝所有同步请求。这是服务端配置问题，不是你的请求有错。')
  }
  return crypto.createHmac('sha256', pepper).update('sched-sync-v1|' + pass, 'utf8').digest('hex')
}

function checkPass(headers, query, body) {
  const pass = readPass(headers, query, body)
  if (!pass) {
    throw input('缺少同步串：请带 {"pass":"…"} 请求体，或 ?pass= 查询参数，或 X-Sync-Pass 请求头', 401)
  }
  if (pass.length < MIN_PASS) {
    throw input('同步串太短（至少 ' + MIN_PASS + ' 个字符）：短串容易被猜到，猜到就能读走这一份数据', 400)
  }
  if (pass.length > MAX_PASS) {
    throw input('同步串太长（最多 ' + MAX_PASS + ' 个字符）', 400)
  }
  return ownerUid(pass)
}

/* uid 只回前 8 位给前端显示（「同步身份：a1b2c3d4…」）。
   前端拿它区分「是不是同一份数据」，拿不到也拼不出别人的 uid。 */
function shortUid(uid) {
  return String(uid).slice(0, 8)
}

function toRev(v) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

function truthy(v) {
  return v === true || v === 'true' || v === '1' || v === 1
}

/* ── 三个动作 ── */
async function doUpload(uid, body) {
  const doc = body.doc
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw input('缺少 doc 对象：上传要用 {"pass":"…","doc":{…}} 的形状（doc 是一整份数据，不是数组）')
  }
  const text = JSON.stringify(doc)
  if (text.length > MAX_DOC_CHARS) {
    throw input('这一份数据太大（' + text.length + ' 个字符，上限 ' + MAX_DOC_CHARS + '）：同步只带课表和待办，录音音频这类大件请留在本机')
  }

  /* 版本冲突：baseRev 是「本机这份数据是基于云端哪一版改的」。
     没传 baseRev 时**按 0 算**（不是「随便覆盖」）—— 新设备第一次上传前应当先下载；
     如果云端早有数据，这里会如实报冲突，让用户选「用云端的 / 覆盖云端的」，
     绝不在用户不知情时把云端那份冲掉。force=true 是用户明确选「覆盖云端」后的路。 */
  const baseRev = toRev(body.baseRev)
  const force = truthy(body.force)
  const cur = await db.getDoc(uid)
  const curRev = cur ? toRev(cur.doc_rev) : 0

  if (!force && curRev > baseRev) {
    return reply(409, {
      ok: false,
      kind: 'input',
      status: 409,
      message: '云端那份比本机新（云端 rev ' + curRev + '，本机基于 rev ' + baseRev + '）：'
        + '先看看要哪一份 —— 想用云端的就下载，想用本机的就选「覆盖云端」。',
      cloudRev: curRev,
      cloudUpdatedAt: cur && cur.updated_at ? cur.updated_at : null,
    })
  }

  const rev = curRev + 1
  const row = await db.putDoc(uid, { ...doc, version: doc.version || SYNC_DOC_VERSION }, rev)
  const saved = Array.isArray(row) ? row[0] : row
  return reply(200, {
    ok: true,
    action: 'upload',
    uid: shortUid(uid),
    rev: saved && saved.doc_rev !== undefined ? toRev(saved.doc_rev) : rev,
    updated_at: saved ? saved.updated_at : null,
  })
}

async function doDownload(uid) {
  const cur = await db.getDoc(uid)
  if (!cur) {
    // 「云端还没有这一份」不是错误：新设备第一次打开就是这个状态，用 200 + found:false 表达
    return reply(200, { ok: true, action: 'download', uid: shortUid(uid), found: false, doc: null, rev: 0 })
  }
  return reply(200, {
    ok: true,
    action: 'download',
    uid: shortUid(uid),
    found: true,
    doc: cur.doc,
    rev: toRev(cur.doc_rev),
    updated_at: cur.updated_at || null,
  })
}

async function doDelete(uid) {
  const rows = await db.deleteDoc(uid)
  return reply(200, { ok: true, action: 'delete', uid: shortUid(uid), deleted: rows.length > 0 })
}

/* ── 请求日志 ──
   一行一次请求：时间 | 方法 路径 | 结果。
   **不打印同步串、不打印完整 uid**（日志可能被别的协作者看到；uid 是数据的主键，
   完整 uid 等于「知道去哪里取这份数据」的门牌号）。 */
function logRequest(method, path, uid, result) {
  const t = new Date().toISOString()
  console.log('[sync] ' + t + ' | ' + method + ' ' + path
    + ' | 身份=' + (uid ? shortUid(uid) + '…' : '-')
    + ' | ' + result)
}

exports.main = async function (event) {
  const method0 = readMethod(event) || 'GET'
  const path0 = String((event && (event.path || event.rawPath)) || '/api/sync')
  const headers = readHeaders(event)
  const query = readQuery(event)

  /* 先读 body 但先不报错：口令校验要排在请求体格式之前，
     未授权一律 401 —— 不给「body 格式对不对」这种探测信息（与 write/index.js 同口径）。 */
  let body = {}
  let bodyError = null
  try {
    body = readBody(event)
  } catch (e) {
    bodyError = e
  }

  let uid = ''
  try {
    uid = checkPass(headers, query, body)
    if (bodyError && method0 !== 'GET' && method0 !== 'DELETE') throw bodyError

    let res
    if (method0 === 'GET') {
      res = await doDownload(uid)
    } else if (method0 === 'DELETE') {
      res = await doDelete(uid)
    } else if (method0 === 'POST') {
      const action = String((body.action || query.action || '')).toLowerCase()
      res = action === 'delete' ? await doDelete(uid) : await doUpload(uid, body)
    } else {
      return fail(input('不支持的方法：' + method0 + '（本接口只用 ' + ALLOWED + '）', 405))
    }

    const code = res && res.statusCode ? res.statusCode : '?'
    logRequest(method0, path0, uid, (code < 400 ? 'OK ' : 'FAIL ') + code)
    return res
  } catch (e) {
    // 三类错误在这里统一成 { ok:false, kind, message, status } —— 不把堆栈/英文原文漏给前端
    const res = fail(e)
    const r = toResponse(e)
    logRequest(method0, path0, uid, 'FAIL [' + r.kind + ' ' + r.status + '] ' + r.message)
    return res
  }
}
