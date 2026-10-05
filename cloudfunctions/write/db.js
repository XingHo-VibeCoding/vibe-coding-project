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
'use strict'

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
    throw new Error('环境变量未配置：' + missing.join(' / '))
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
    const reason = e && e.name === 'AbortError' ? '超时(10s)' : (e && e.message ? e.message : String(e))
    throw new Error(label + ' 请求失败：' + reason)
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(label + ' 鉴权失败（HTTP ' + res.status + '）：检查 CLOUDBASE_API_KEY 是否填对、是否已启用')
    }
    if (res.status === 404) {
      throw new Error(label + ' 返回 404：表不存在或环境 ID 不对（检查 TCB_ENV_ID）')
    }
    // PostgREST 的参数错误（缺列、类型不符）都是 400，原文对排错最有用
    throw new Error(label + ' 返回 HTTP ' + res.status + '：' + text.slice(0, 300))
  }
  if (!text) return []
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(label + ' 返回了非 JSON：' + text.slice(0, 200))
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
