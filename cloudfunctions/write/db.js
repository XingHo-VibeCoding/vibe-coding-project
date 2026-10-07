// Day 22｜写接口的数据访问层（data access layer）—— 只负责「怎么连库、怎么写」
//
// 与 list/db.js 同一条边界（Day 19 定下的）：本层管环境变量（钥匙）、REST 端点、
// 请求头、超时、HTTP 错误码翻译；本层不管「参数合不合法」——表名白名单、列白名单、
// 必填字段都在接口层 index.js 判。所以这里不认识 TABLES，也不校验 title 是不是空。
//
// 复用的工程结论（Day 17 撞出来的，别绕回去）：不连 TCP，走 CloudBase 官方
// REST API（PostgREST 规范）：https://{envId}.api.tcloudbasegateway.com/v1/rdb/rest/{table}
//   · 新增 = POST   /rest/{table}
//   · 修改 = PATCH  /rest/{table}?id=eq.{id}
//   · 删除 = DELETE /rest/{table}?id=eq.{id}
// 带上 Prefer: return=representation，PostgREST 才会把「动过的行」回给我们，
// 接口层才能把真实结果转给前端（而不是只说一句 ok）。
//
// 值一律走 JSON body / URLSearchParams，全程不拼 SQL 字符串 —— 注入防护与
// 参数化方案同级，契约（docs/api-contract.md）要求不破。
//
// Day 23 补：错误一律经 ./errors.js 收口。本层只管「这是网络错还是服务端错」，
// 翻成中文交给 errors.js —— 别在这里直接 new Error 往上抛英文原文。
'use strict'

const { network, fromUpstream, fromNonJson, missingEnv } = require('./errors')

/* 两个环境变量（与 list 一致，同一把钥匙）：
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

/* 带超时的单个写请求。写操作超时给得比读宽一点（10s）：
   读失败重试就好，写失败要人知道到底成没成。 */
async function restWrite(method, url, apiKey, label, body) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  let res
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: 'Bearer ' + apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        // 让 PostgREST 把被写入/删除的行回传
        Prefer: 'return=representation',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
  } catch (e) {
    // fetch 自己抛的（超时/DNS/拒连）统一当网络错 —— 不把英文原文漏给使用者
    throw network(label, e)
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    // 请求到了、对方回了错误码 → 服务端错（401/403/404 的中文文案在 errors.js 里统一）
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

/* ── 本层对外的三个写入口（调用方已校验过参数，这里只负责发请求）──
     insertRow(table, row)          新增一行，返回 [{ 新增的行 }]
     updateRow(table, id, patch)    按主键改一行，返回 [{ 改后的行 }]（没这行进 → []）
     deleteRow(table, id)           按主键删一行，返回 [{ 被删的行 }]（没这行进 → []）
   为什么用「返回数组、空数组代表没命中」：PostgREST 的语义就是这样，
   接口层据此把「没找到这条」翻成 404，就不用多发一次查询。 */
async function insertRow(table, row) {
  const { envId, apiKey } = readConfig()
  return restWrite('POST', baseUrl(envId) + '/' + table, apiKey, table, row)
}

async function updateRow(table, id, patch) {
  const { envId, apiKey } = readConfig()
  const url = baseUrl(envId) + '/' + table + '?id=eq.' + encodeURIComponent(id)
  return restWrite('PATCH', url, apiKey, table, patch)
}

async function deleteRow(table, id) {
  const { envId, apiKey } = readConfig()
  const url = baseUrl(envId) + '/' + table + '?id=eq.' + encodeURIComponent(id)
  return restWrite('DELETE', url, apiKey, table)
}

module.exports = { insertRow, updateRow, deleteRow, restWrite, readConfig }
