// Day 19｜数据访问层（data access layer）—— 只负责「怎么连库、怎么读」
//
// 为什么有这个文件：Day 17 写 /api/list 时，「接待 HTTP 请求」和「从库里取数据」
// 混在 index.js 一个文件里。Day 19 把后者整块搬到这里，边界写死：
//   本层管：环境变量（钥匙）、REST 端点、查询串、超时、HTTP 错误码翻译
//   本层不管：参数合不合法（type 白名单、limit 范围）—— 那是接口层的活，
//             所以本文件不认识 allowedTypes，也不判断 limit 的取值区间
//   反过来，接口层 index.js 从今天起不再出现 URL、headers、process.env
//
// 以后加写接口（favorite / update / delete）时，这一层 import 来用就行，
// 不用再把「凭据 + 端点 + 超时 + 错误翻译」复制一遍。
//
// ── 搬运时原样保留的工程记录（Day 17 的转弯，别删）──────────────
// 最初计划：云函数用 pg 驱动内网直连数据库。控制台实测推翻了它：
// 共享集群实例连「内网地址」都不分配（外网直连则要求升级独享集群），
// 两条 TCP 直连路径都不存在。
// 现在的方案：改走 CloudBase 官方 REST API（PostgREST 规范）——
// 平台自带的 HTTP 通路，与数据库网络档位无关，云函数里 fetch 即可：
//   https://{envId}.api.tcloudbasegateway.com/v1/rdb/rest/{table}
//
// ── 「SQL 参数化」在这里怎么满足 ─────────────────────────────
// PostgREST 把 ?type=eq.course 这类查询参数翻译成参数化 SQL 再执行；
// 我们全程不拼任何 SQL 字符串，值里的特殊字符由 URLSearchParams 统一编码。
// 注入防护与 $1 占位符方案同级，契约要求不破。
//
// ── 鉴权 ────────────────────────────────────────────────────
// 服务端 API Key（service_role）从环境变量 CLOUDBASE_API_KEY 读，
// 绝不写进代码、绝不返回给前端 —— 它相当于管理员钥匙，泄漏=库门大开。
'use strict'

/* 两个环境变量：
   TCB_ENV_ID        环境 ID，形如 vibecoding-test-d5fqmhbb955e19dd
                     （云函数运行时通常自带 TCB_ENV，有的话可以不配）
   CLOUDBASE_API_KEY 服务端 API Key，在「环境管理 → HTTP 网关 → API Key 配置」创建 */
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

/* 带超时的单个 GET。PostgREST 出错时 HTTP 状态码 + 响应体就是线索，
   401/403 单独翻译成人话（Key 没配对/没启用），不然用户只会看到一串状态码。 */
async function restGet(url, apiKey, label) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  let res
  try {
    res = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + apiKey,
        Accept: 'application/json',
      },
      signal: ctrl.signal,
    })
  } catch (e) {
    const reason = e && e.name === 'AbortError' ? '超时(8s)' : (e && e.message ? e.message : String(e))
    throw new Error(label + ' 请求失败：' + reason)
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401 || res.status === 403) {
      throw new Error(label + ' 鉴权失败（HTTP ' + res.status + '）：检查 CLOUDBASE_API_KEY 是否填对、是否已启用')
    }
    if (res.status === 404) {
      throw new Error(label + ' 返回 404：表不存在或环境 ID 不对（检查 TCB_ENV_ID）')
    }
    throw new Error(label + ' 返回 HTTP ' + res.status + '：' + body.slice(0, 200))
  }
  return res.json()
}

/* schedules 的查询串。三个可选筛选：type / semester / limit，
   排序「周几(空排最后) → 开始时间 → id」，和前端周课表的呈现顺序一致。 */
function buildSchedulesParams(types, semesterId, limit) {
  const sp = new URLSearchParams()
  sp.set('select', '*')
  if (types.length) sp.set('type', 'in.(' + types.join(',') + ')')
  if (semesterId) sp.set('semester_id', 'eq.' + semesterId)
  sp.set('order', 'weekday.asc.nullslast,start_time.asc,id.asc')
  if (limit !== null) sp.set('limit', String(limit))
  return sp.toString()
}

/* ── 本层对外的唯一读入口 ──────────────────────────────────────
   参数约定（调用方 index.js 已经校验过，这里不再判）： 
     types      string[]，空数组 = 不筛 type
     semesterId string | null，null = 不筛学期
     limit      number | null，null = 不限制
   返回 { semesters, schedules, todos } —— 只把三张表的行交出去，
   行数与 { ok, data, counts } 的组装属于接口层的事。            */
async function fetchAll(options) {
  const opt = options || {}
  const types = Array.isArray(opt.types) ? opt.types : []
  const semesterId = opt.semesterId === undefined ? null : opt.semesterId
  const limit = opt.limit === undefined ? null : opt.limit

  const { envId, apiKey } = readConfig()
  const base = 'https://' + envId + '.api.tcloudbasegateway.com/v1/rdb/rest'

  const semQs = new URLSearchParams({ select: '*', order: 'first_monday.desc' }).toString()
  const todoQs = new URLSearchParams({ select: '*', order: 'due_date.asc,id.asc' }).toString()

  const [semesters, schedules, todos] = await Promise.all([
    restGet(base + '/semesters?' + semQs, apiKey, 'semesters'),
    restGet(base + '/schedules?' + buildSchedulesParams(types, semesterId, limit), apiKey, 'schedules'),
    restGet(base + '/todos?' + todoQs, apiKey, 'todos'),
  ])

  return { semesters, schedules, todos }
}

module.exports = { fetchAll, restGet }
