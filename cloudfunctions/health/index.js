// Day 15｜最小云函数：GET /api/health → { ok: true }
//
// 原理：公网有人打开 http 触发路径时，CloudBase 会把那次 HTTP 请求
// 包装成一个 event 对象交给这个函数；函数的返回值会被序列化成
// JSON 作为 HTTP 响应送回浏览器。今天不接数据库、不判断请求方法，
// 只做一件事：证明「我的代码跑在云上，公网能访问」。
exports.main = async function (event) {
  return { ok: true }
}
