// Day 19｜GET /api/list —— 接口层：收请求、校验、回响应
//
// 这一天做的事：把「查数据库」整块搬到 ./db.js（数据访问层）。
// 本文件现在只管接口的事：event 三种形状归一、参数校验、type 白名单、
// 组装 { ok, data, counts }、失败兜底。
// URL / headers / process.env 一律不在这里 —— 那些都在 ./db.js。
// 接口形状与 Day 17 上线时完全一致（自测 31 项钉住行为不变）。
//
// Day 23 补：错误经 ./errors.js 分类（input / network / server），
// 响应体补上 kind 与 status —— 以前只有 { ok:false, message }，
// 前端拿不到状态码，没法区分「你填错了」和「服务端炸了」。
'use strict'

/* 云函数代码加载即校验运行环境：fetch 需要 Node.js 18+。
   加载期就报错，日志里能看到清楚原因，好过运行时 undefined。
   （这里只做检查不调用 fetch；真正取数在 ./db.js） */
if (typeof fetch !== 'function') {
  throw new Error('本函数需要 Node.js 18+（内置 fetch）。请在控制台把运行环境改为 Nodejs18.15 或更高后重新部署。')
}

const db = require('./db')
const { input, toResponse } = require('./errors')

/* ── 请求日志（Day 23 余力加练）──
   一行一次请求：时间 | 方法 路径 | 结果。
   为什么要它：出问题时第一句总是「刚才那次到底发生了什么」——
   云函数日志里如果只有 console.log 的业务信息，就只能靠猜。
   为什么不用 JSON.stringify 整条打印：日志是给人扫的，一行一条最好读。
   注意：只记路径与查询串长度/键名，**不打印完整查询串** —— 万一有人把口令写进 URL，
   打印出来等于把口令抄进日志。 */
function logRequest(method, path, query, result) {
  const keys = Object.keys(query || {}).filter(function (k) { return k !== 'token' })
  const t = new Date().toISOString()
  console.log('[list] ' + t + ' | ' + method + ' ' + path
    + ' | 参数=' + (keys.length ? keys.join(',') : '无')
    + ' | ' + result)
}

/* CloudBase 把 HTTP 请求包装成 event 交给函数。兼容三种形状：
   - HTTP 触发：{ path, httpMethod, queryStringParameters, ... }
   - 网关变体：query 放在 event.query 里
   - 控制台「测试」按钮：直接平铺，如 { "type": "course" }
   前两种都没有时把 event 本身当查询参数 —— 消费方只取 type/semester/limit
   三个键，event 里的 path、headers 等字段不会被误读。 */
function readQuery(event) {
  if (!event || typeof event !== 'object') return {}
  if (event.queryStringParameters && typeof event.queryStringParameters === 'object') {
    return event.queryStringParameters
  }
  if (event.query && typeof event.query === 'object') return event.query
  return event
}

/* 「逗号分隔」写法归一成数组：
   ?type=course → ['course']；?type=course,event → ['course','event'] */
function toList(v) {
  if (v === undefined || v === null || v === '') return []
  const raw = Array.isArray(v) ? v : String(v).split(',')
  return raw.map((s) => String(s).trim()).filter(Boolean)
}

/* limit 收口：不传=不限制（返回全部）；传了必须是 1~500 的整数。
   不设默认截断 —— 默认截断会让人误以为「库里就这么多」，比明说不限制更坑。 */
function readLimit(v) {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || Math.floor(n) !== n || n < 1 || n > 500) {
    throw input('limit 需要是 1~500 之间的整数，收到：' + String(v))
  }
  return n
}

exports.main = async function (event) {
  const method = (event && (event.httpMethod || event.method)) || 'GET'
  const path = (event && (event.path || event.rawPath)) || '/api/list'
  const query = readQuery(event)
  try {
    /* 先做零成本的输入校验，再碰网络：参数不合法就不该发起请求 */
    const types = toList(query.type)
    const allowedTypes = ['course', 'event', 'routine']
    for (const t of types) {
      if (!allowedTypes.includes(t)) {
        throw input('type 只能是 course / event / routine 之一，收到：' + t)
      }
    }
    const limit = readLimit(query.limit)
    const semesterId = query.semester ? String(query.semester) : null

    /* 校验通过后才交给数据访问层；三张表的读法（端点/查询串/超时/鉴权）在 ./db.js */
    const { semesters, schedules, todos } = await db.fetchAll({ types, semesterId, limit })

    logRequest(method, path, query, 'OK 学期' + semesters.length + ' 日程' + schedules.length + ' 待办' + todos.length)

    return {
      ok: true,
      data: {
        semesters: semesters,
        schedules: schedules,
        todos: todos,
        // counts 是对账凭据：和数据库控制台的行数一比就知道有没有取漏
        counts: {
          semesters: semesters.length,
          schedules: schedules.length,
          todos: todos.length,
        },
      },
    }
  } catch (err) {
    // 失败统一兜成 { ok:false, kind, message, status }，不把堆栈抛给前端
    const r = toResponse(err)
    logRequest(method, path, query, 'FAIL [' + r.kind + ' ' + r.status + '] ' + r.message)
    return r
  }
}
