// Day 28｜云同步的数据访问层（data access layer）—— 只负责「怎么连库、怎么读写这一份文档」
//
// 与 list/db.js、write/db.js 同一条边界：本层管环境变量（钥匙）、REST 端点、请求头、
// 超时、HTTP 错误码翻译；本层不管「同步串合不合法、doc 有多大」——那些在 index.js 判。
// 所以这里不认识 MAX_DOC_CHARS，也不校验 pass 的长度。
//
// 复用的工程结论（Day 17 撞出来的，别绕回去）：不连 TCP，走 CloudBase 官方
// REST API（PostgREST 规范）：https://{envId}.api.tcloudbasegateway.com/v1/rdb/rest/{table}
//   · 读一份   = GET    /rest/sync_docs?owner_uid=eq.{uid}&limit=1
//   · 写一份   = POST   /rest/sync_docs   （带 Prefer: resolution=merge-duplicates → upsert）
//   · 删一份   = DELETE /rest/sync_docs?owner_uid=eq.{uid}
//
// 为什么写用 upsert 而不是「先查再决定 insert / update」：两次请求之间有可能失败，
// 中间态（查到了但没写成）会让调用方以为成功了。merge-duplicates 让服务端一次搞定，
// 主键冲突就覆盖、没有就插入 —— 语义正好是「把这一份存成现在这样」。
//
// 值一律走 JSON body / URLSearchParams，全程不拼 SQL 字符串 —— 注入防护与参数化方案同级。
//
// 错误一律经 ./errors.js 收口。本层只管「这是网络错还是服务端错」，翻成中文交给
// errors.js —— 别在这里直接 new Error 往上抛英文原文。
'use strict'

const { network, fromUpstream, fromNonJson, missingEnv } = require('./errors')

/* 两个环境变量（与 list / write 一致，同一把钥匙）：
   TCB_ENV_ID        环境 ID（云函数运行时自带 TCB_ENV，有的话可以不配）
   CLOUDBASE_API_KEY 服务端 API Key（service_role），绝不写进代码、绝不返回前端 */
function readConfig() {
  const envId = process.env.TCB_ENV_ID || process.env.TCB_ENV || ''
  const apiKey = process.env.CLOUDBASE_API_KEY || ''
  const missing = []
  if (!envId) missing.push('TCB_ENV_ID')
  if (!apiKey) missing.push('CLOUDBASE_API_KEY')
  if (missing.length) {
    // 只报变量名，不报值 —— 报错信息本身不能变成泄密口
    throw missingEnv(missing)
  }
  return { envId, apiKey }
}

/* 带超时的单个请求。同步一份是「整份读写」，比 list 的单表查询重，给到 10s
   （与 write 一致）：同步失败要人知道到底成没成，不能悄悄超时。 */
async function restSync(method, url, apiKey, label, body, prefer) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  const headers = {
    Authorization: 'Bearer ' + apiKey,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    // 让 PostgREST 把被写入/删除的行回传，调用方才能把真实 rev 转给前端
    Prefer: prefer || 'return=representation',
  }
  let res
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (e) {
    // fetch 自己抛的（超时/DNS/拒连）统一当网络错 —— 不把英文原文漏给使用者
    throw network(label, e)
  } finally {
    clearTimeout(timer)
  }
  /* 先 text() 再 JSON.parse：body 只能读一次，直接 res.json() 失败时就没法把
     原文交给 fromNonJson 了（list/db.js 记过这条）。 */
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw fromUpstream(label, res.status, text)
  }
  if (!text) return []
  try {
    return JSON.parse(text)
  } catch (e) {
    throw fromNonJson(label, res.status, text)
  }
}

function baseUrl(envId) {
  return 'https://' + envId + '.api.tcloudbasegateway.com/v1/rdb/rest'
}

/* ── 本层对外的三个入口 ──
     getDoc(uid)              读这一份，没有 → null
     putDoc(uid, doc, rev)    整份写入（upsert），返回 [{ doc_rev, updated_at }]
     deleteDoc(uid)           删这一份，返回 [{ 被删的行 }]（没有 → []）
   为什么 getDoc 返回对象而不是数组：调用方只关心「有没有、是哪一版」，
   把「取第一行」的判断收在本层，index.js 里就不用到处写 rows[0]。 */
async function getDoc(uid) {
  const { envId, apiKey } = readConfig()
  const url = baseUrl(envId) + '/sync_docs?owner_uid=eq.' + encodeURIComponent(uid) + '&limit=1'
  const rows = await restSync('GET', url, apiKey, 'sync_docs')
  return Array.isArray(rows) && rows.length ? rows[0] : null
}

async function putDoc(uid, doc, rev) {
  const { envId, apiKey } = readConfig()
  const row = {
    owner_uid: uid,
    doc,
    doc_rev: rev,
    updated_at: new Date().toISOString(),
  }
  return restSync('POST', baseUrl(envId) + '/sync_docs', apiKey, 'sync_docs', row,
    'return=representation,resolution=merge-duplicates')
}

async function deleteDoc(uid) {
  const { envId, apiKey } = readConfig()
  const url = baseUrl(envId) + '/sync_docs?owner_uid=eq.' + encodeURIComponent(uid)
  return restSync('DELETE', url, apiKey, 'sync_docs')
}

module.exports = { getDoc, putDoc, deleteDoc, restSync, readConfig }
