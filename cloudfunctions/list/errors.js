'use strict'
/*
 * Day 23｜三类错误的统一口径（输入错 / 网络错 / 服务端错）
 *
 * 为什么需要这个文件：在这之前，函数里出错都是「抓到什么抛什么」——
 *   · fetch 抛的原始英文（`fetch failed` / `ECONNREFUSED` / `ETIMEDOUT`）会一路
 *     冒到 `message` 里，前端只能把英文原样弹给使用者；
 *   · 兜底写的是 `String(e)`，遇到非 Error 对象会变成 `[object Object]`；
 *   · 有的分支带 HTTP 状态码、有的不带（list 就一直没有 `status`），前端没法分类。
 * 结果就是「同一类问题，报出来的话长得不一样」。
 *
 * 这个文件把错误收成三个 kind，并负责把底层的英文翻成人话：
 *   input    输入错   —— 调用方自己填错了（表名/字段/取值范围/JSON 语法）。
 *                        这是唯一「使用者能自己改好」的一类，文案要告诉他改什么。
 *   network  网络错   —— 请求根本没到达对方（超时/DNS/拒连/连接被断）。
 *                        这类要明说「不是你填错了，是网络或对方没响应，可以重试」。
 *   server   服务端错 —— 请求到了，对方用错误码或非 JSON 回应（鉴权/表不存在/上游 5xx）。
 *                        这类要明说「这是服务端的问题，重试多半没用」。
 *
 * ⚠ 这份文件在两个云函数目录里各有一份（list/errors.js 与 write/errors.js），
 *   内容必须逐字一致。原因：CloudBase 按 `cloudfunctions/<函数名>/` 整目录打包部署，
 *   两个函数之间不能互相 require。别把它抽成公共目录 —— 那样部署时会缺文件。
 *   改这里就要同步改另一份，`.workbuddy/tmp/day23-errors-selftest.js` 会比对两份是否一致。
 */

const KIND = { INPUT: 'input', NETWORK: 'network', SERVER: 'server' }

/* kind → 给人看的三字标签。前端可以拿它做图标/配色，不用去猜 message 里的字。 */
const KIND_LABEL = {
  input: '输入有误',
  network: '网络不通',
  server: '服务端出错',
}

/* 三类错误的统一载体。带 kind（给程序分类用）与 status（给 HTTP 用）。 */
class AppError extends Error {
  constructor(kind, status, message, cause) {
    super(message)
    this.name = 'AppError'
    this.kind = kind
    this.status = status
    this.cause = cause || null
  }
}

/* ── 三个构造器：调用方按「这错是谁的锅」挑一个，不要再自己 new Error ── */

/** 输入错：调用方填错了。默认 400；「方法不对」这类给 405。 */
function input(message, status) {
  return new AppError(KIND.INPUT, Number(status) || 400, message)
}

/** 输入错里「要找的东西不在」这一种，按 HTTP 语义给 404。 */
function notFound(message) {
  return new AppError(KIND.INPUT, 404, message)
}

/* 底层网络异常的关键词 → 人话。
   为什么是「包含匹配」而不是精确相等：Node 的报错会带前缀
   （如 `TypeError: fetch failed`、`Error: connect ECONNREFUSED 1.2.3.4:443`），
   精确相等一个都匹配不上。顺序有意义：先匹配更具体的。 */
const NETWORK_HINTS = [
  ['abort', '请求超时了，对方一直没回'],
  ['timeout', '请求超时了，对方一直没回'],
  ['enotfound', '域名解析不了，地址可能写错了'],
  ['eai_again', '域名解析暂时失败，可以稍后重试'],
  ['econnrefused', '连接被拒绝，对方端口上没服务'],
  ['econnreset', '连接被对方断开了'],
  ['econnaborted', '连接被中断了'],
  ['ehostunreach', '网络到不了对方主机'],
  ['enetunreach', '本机网络不通'],
  ['certificate', '对方证书校验没过'],
  ['fetch failed', '连不上对方'],
  ['socket', '网络连接中断了'],
  ['network', '网络不通'],
]

/** 把底层网络异常的原文，翻成一句中文线索（不含 label）。 */
function networkReason(cause) {
  const raw = (cause && cause.message) ? String(cause.message) : String(cause || '')
  const low = raw.toLowerCase()
  for (const pair of NETWORK_HINTS) {
    if (low.indexOf(pair[0]) >= 0) return pair[1]
  }
  // 一个关键词都没匹配上：不把英文原文抛给使用者，只如实说「没弄明白」
  return '网络请求没成功（原因没能识别）'
}

/**
 * 网络错：请求没到达对方。
 * 文案口径 = 「不是你填错了 + 可以重试」，并保留 `请求失败` 这个老词
 * （既有自测脚本按这四个字断言，别改掉）。
 */
function network(label, cause) {
  const msg = label + ' 请求失败：' + networkReason(cause) + '。这类问题多半是临时的，可以稍后重试。'
  return new AppError(KIND.NETWORK, 502, msg, cause)
}

/** 服务端错：请求到了，对方回了个错误。status 按实际情况传（401/404/500…）。 */
function server(label, status, message, cause) {
  const code = Number(status) || 502
  // 这不是调用方能改的（除了 401 那种配置错），文案口径 = 「服务端的问题，重试多半没用」
  return new AppError(KIND.SERVER, code, message, cause)
}

/* 上游 HTTP 状态码 → 中文人话。label 是出问题的表名/环节，方便定位。
   401/403 与 404 的文案刻意保留原有措辞（`检查 CLOUDBASE_API_KEY` / `检查 TCB_ENV_ID`），
   既有自测脚本按这些词断言，也确实是使用者要照着做的那一步。 */
function fromUpstream(label, status, bodyText) {
  const body = String(bodyText || '').slice(0, 300)
  if (status === 401 || status === 403) {
    return server(label, status, label + ' 鉴权失败（HTTP ' + status + '）：检查 CLOUDBASE_API_KEY 是否填对、是否已启用')
  }
  if (status === 404) {
    return server(label, status, label + ' 返回 404：表不存在或环境 ID 不对（检查 TCB_ENV_ID）')
  }
  if (status === 408 || status === 504) {
    return server(label, status, label + ' 返回 HTTP ' + status + '：对方处理超时了，可以稍后重试')
  }
  if (status >= 500) {
    return server(label, status, label + ' 返回 HTTP ' + status + '：这是服务端（数据库/网关）的问题，不是你填错了。原文：' + body)
  }
  if (status >= 400) {
    return server(label, status, label + ' 返回 HTTP ' + status + '：请求被对方拒绝了（多半是字段类型或取值不符合库里的约束）。原文：' + body)
  }
  return server(label, status, label + ' 返回 HTTP ' + status + '：' + body)
}

/** 对方返回了不是 JSON 的东西（多半是网关/域名配错，把 HTML 错误页当成接口了）。 */
function fromNonJson(label, status, bodyText) {
  const body = String(bodyText || '').slice(0, 200)
  return server(label, status, label + ' 返回了非 JSON 内容（HTTP ' + status + '）：多半是地址指到了网关上，没走到函数。原文节选：' + body)
}

/** 函数自身的环境变量没配齐。只报变量名，绝不报值 —— 报错本身不能变成泄密口。 */
function missingEnv(names) {
  return server('运行环境', 500, '环境变量未配置：' + names.join(' / ') + '（在云函数的环境变量里补上，别写进代码）')
}

/**
 * 归一：任何 catch 到的东西 → { ok:false, kind, message, status }。
 * 已经是我们自己的 AppError 就原样放行；其它一律当服务端错兜底（绝不把英文原文/堆栈漏出去）。
 */
function toResponse(err) {
  if (err instanceof AppError) {
    return { ok: false, kind: err.kind, message: err.message, status: err.status }
  }
  // 非 Error 对象（{}、null、undefined、数字…）不能走 String()：会变成 "[object Object]"
  // ——那正是这次要修的老毛病。只有字符串/数字这类本身就是可读文本的原始值才直接用它。
  let message
  if (err && typeof err.message === 'string' && err.message) {
    message = err.message
  } else if (typeof err === 'string' && err) {
    message = err
  } else if (typeof err === 'number' || typeof err === 'boolean') {
    message = String(err)
  } else {
    message = '未知错误（没有拿到可读的原因）'
  }
  // 不是我们造的错误：可能是 fetch 的网络异常直接冒上来了，也可能是别的 TypeError。
  // 用 NETWORK_HINTS 再判一次；都不像就当服务端错，并把原文留在 message 末尾便于排错。
  const looksNetwork = NETWORK_HINTS.some(function (p) { return message.toLowerCase().indexOf(p[0]) >= 0 })
  if (looksNetwork) {
    return { ok: false, kind: KIND.NETWORK, message: '请求失败：' + networkReason(err) + '。这类问题多半是临时的，可以稍后重试。', status: 502 }
  }
  return { ok: false, kind: KIND.SERVER, message: '服务端出错：' + message, status: 500 }
}

module.exports = {
  KIND,
  KIND_LABEL,
  AppError,
  input,
  notFound,
  network,
  server,
  fromUpstream,
  fromNonJson,
  missingEnv,
  networkReason,
  toResponse,
}
