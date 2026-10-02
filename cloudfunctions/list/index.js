// Day 17｜GET /api/list —— 读三张表，返回 { ok, data }
//
// ── 今天的转弯（真实工程记录，别删）──────────────────────────
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

/* 云函数代码加载即校验运行环境：fetch 需要 Node.js 18+。
   加载期就报错，日志里能看到清楚原因，好过运行时 undefined。 */
if (typeof fetch !== 'function') {
  throw new Error('本函数需要 Node.js 18+（内置 fetch）。请在控制台把运行环境改为 Nodejs18.15 或更高后重新部署。')
}

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
    throw new Error('limit 需要是 1~500 之间的整数')
  }
  return n
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

exports.main = async function (event) {
  try {
    /* 先做零成本的输入校验，再碰网络：参数不合法就不该发起请求 */
    const query = readQuery(event)
    const types = toList(query.type)
    const allowedTypes = ['course', 'event', 'routine']
    for (const t of types) {
      if (!allowedTypes.includes(t)) {
        throw new Error('type 只能是 course / event / routine 之一，收到：' + t)
      }
    }
    const limit = readLimit(query.limit)
    const semesterId = query.semester ? String(query.semester) : null

    const { envId, apiKey } = readConfig()
    const base = 'https://' + envId + '.api.tcloudbasegateway.com/v1/rdb/rest'

    const semQs = new URLSearchParams({ select: '*', order: 'first_monday.desc' }).toString()
    const todoQs = new URLSearchParams({ select: '*', order: 'due_date.asc,id.asc' }).toString()

    const [semesters, schedules, todos] = await Promise.all([
      restGet(base + '/semesters?' + semQs, apiKey, 'semesters'),
      restGet(base + '/schedules?' + buildSchedulesParams(types, semesterId, limit), apiKey, 'schedules'),
      restGet(base + '/todos?' + todoQs, apiKey, 'todos'),
    ])

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
    // 失败统一兜成 { ok:false, message }，不把堆栈抛给前端
    return { ok: false, message: err && err.message ? err.message : '读取失败' }
  }
}
