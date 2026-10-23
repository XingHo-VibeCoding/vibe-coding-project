/* 复习建议（施工单 S2）纯函数单测。不联网：fetch 由用例注入假实现。
   基准日与 exam-unit 一致：2026-10-16（周五）。 */
import {
  ADVICE_KEY, ADVICE_MAX_LEN, ADVICE_BANNED,
  adviceFacts, buildAdvicePrompt, sanitizeAdvice,
  loadAdvice, saveAdvice, clearAdvice, reviewAdvice,
} from '../src/data/reviewAdvice.js'

let pass = 0
let fail = 0
const fails = []
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('PASS ' + name) }
  else { fail += 1; fails.push(name); console.log('FAIL ' + name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra))) }
}

const TODAY = '2026-10-16'
const BLOCK = {
  date: TODAY,
  start: 1140,
  end: 1230,
  time: '19:00–20:30',
  mins: 90,
  exams: [
    { id: 'a', title: '结构力学Ⅰ', daysLeft: 3, text: '还有 3 天' },
    { id: 'b', title: '结构设计原理', daysLeft: 4, text: '还有 4 天' },
    { id: 'c', title: '工程水文学', daysLeft: 6, text: '还有 6 天' },
  ],
}

/* ---------- A 事实串：模型看到的全部输入 ---------- */
ok('A1 事实串带时间与长度', (() => {
  const s = adviceFacts(BLOCK)
  return s.includes('19:00–20:30') && s.includes('90 分钟')
})(), adviceFacts(BLOCK))
ok('A2 三门考试按顺序编号列出', (() => {
  const s = adviceFacts(BLOCK)
  return s.includes('1. 结构力学Ⅰ') && s.includes('2. 结构设计原理') && s.includes('3. 工程水文学')
})())
ok('A3 每门都带「还有 N 天」', (() => {
  const s = adviceFacts(BLOCK)
  return s.includes('结构力学Ⅰ —— 还有 3 天') && s.includes('工程水文学 —— 还有 6 天')
})())
ok('A4 空 block → 空串（不编事实）', adviceFacts(null) === '' && adviceFacts({ exams: [] }) === '')
ok('A5 天数缺失时说「日期未定」而不是「还有 NaN 天」', adviceFacts({ time: 'x', mins: 90, exams: [{ title: '甲' }] }).includes('日期未定'))

/* ---------- B 提示词：规矩必须写进去 ---------- */
const P = buildAdvicePrompt(BLOCK)
ok('B1 系统提示词禁止提章节页码', P.system.includes('章节') && P.system.includes('页码'))
ok('B2 系统提示词禁止评判人', P.system.includes('不许评价这个人'))
ok('B3 系统提示词要求天数照抄', P.system.includes('照抄'))
ok('B4 事实只放 user 消息里', P.user.includes('结构力学Ⅰ') && !P.system.includes('结构力学Ⅰ'))

/* ---------- C 收尾：认不出就丢 ---------- */
ok('C1 正常一句话原样留下', (() => {
  const r = sanitizeAdvice('先看结构力学Ⅰ（还有 3 天），前 50 分钟过例题，后 40 分钟看工程水文学', BLOCK)
  return r.ok && r.line.startsWith('先看结构力学Ⅰ')
})(), sanitizeAdvice('先看结构力学Ⅰ（还有 3 天），前 50 分钟过例题', BLOCK))
ok('C2 去掉引号与 emoji', (() => {
  const r = sanitizeAdvice('“先看结构力学Ⅰ 📚”', BLOCK)
  return r.ok && r.line === '先看结构力学Ⅰ'
})(), sanitizeAdvice('“先看结构力学Ⅰ 📚”', BLOCK))
ok('C3 多行只取第一行', (() => {
  const r = sanitizeAdvice('先看结构力学Ⅰ\n然后看工程水文学', BLOCK)
  return r.ok && r.line === '先看结构力学Ⅰ'
})())
ok('C4 去掉列表符号', (() => {
  const r = sanitizeAdvice('1. 先看结构力学Ⅰ', BLOCK)
  return r.ok && r.line === '先看结构力学Ⅰ'
})(), sanitizeAdvice('1. 先看结构力学Ⅰ', BLOCK))
ok('C5 只留第一句（句号后丢掉）', (() => {
  const r = sanitizeAdvice('先看结构力学Ⅰ。再看工程水文学', BLOCK)
  return r.ok && r.line === '先看结构力学Ⅰ'
})(), sanitizeAdvice('先看结构力学Ⅰ。再看工程水文学', BLOCK))
ok('C6 空内容 → 丢弃', !sanitizeAdvice('', BLOCK).ok && !sanitizeAdvice('   ', BLOCK).ok)
ok('C7 太长 → 丢弃', !sanitizeAdvice('先'.repeat(ADVICE_MAX_LEN + 1), BLOCK).ok)
ok('C8 催促词 → 丢弃', ADVICE_BANNED.slice(0, 4).every((w) => {
  const r = sanitizeAdvice('先看结构力学Ⅰ，' + w + '一下', BLOCK)
  return !r.ok
}), ADVICE_BANNED.slice(0, 4))
ok('C9 天数说错 → 丢弃（3 天说成 5 天）', (() => {
  const r = sanitizeAdvice('结构力学Ⅰ还有 5 天，先看它', BLOCK)
  return !r.ok && r.message.includes('天数')
})(), sanitizeAdvice('结构力学Ⅰ还有 5 天，先看它', BLOCK))
ok('C10 天数说对 → 留下', sanitizeAdvice('结构力学Ⅰ还有 3 天，先看它', BLOCK).ok)
ok('C11 「前 50 分钟」这种时段划分不算改天数', sanitizeAdvice('先看结构力学Ⅰ，前 50 分钟过例题，后 40 分钟看笔记', BLOCK).ok)
ok('C12 没有「还有 N 天」的说法时不做天数校验', sanitizeAdvice('今晚先把最近那门过一遍', BLOCK).ok)
ok('C13 block 为空时不炸', sanitizeAdvice('随便说点什么', null).ok === true)

/* ---------- D 缓存：一天一次 ---------- */
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
}
store.clear()
ok('D1 没缓存时 loadAdvice 返回 null', loadAdvice(TODAY) === null)
ok('D2 存了能读回来', (() => {
  saveAdvice(TODAY, '先看结构力学Ⅰ', 1000)
  const c = loadAdvice(TODAY)
  return c && c.line === '先看结构力学Ⅰ' && c.date === TODAY
})(), loadAdvice(TODAY))
ok('D3 换了一天就当没有（不拿昨天的建议糊弄今天）', loadAdvice('2026-10-17') === null)
ok('D4 坏数据不炸', (() => {
  store.set(ADVICE_KEY, '{oops')
  const r = loadAdvice(TODAY)
  store.clear()
  return r === null
})())
ok('D5 clearAdvice 清得掉', (() => {
  saveAdvice(TODAY, 'x', 1)
  clearAdvice()
  return loadAdvice(TODAY) === null
})())

/* ---------- E 主入口：失败一律静默，不抛 ---------- */
const fakeOk = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: '先看结构力学Ⅰ（还有 3 天），前 50 分钟过例题' } }] }),
})
const fakeBad = async () => ({ ok: false, status: 401, json: async () => ({}) })
const fakeThrow = async () => { throw new Error('boom') }
const fakeSlow = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '先看结构力学Ⅰ' } }] }) })

/* 没配 Key：先确认这条路径，再假装配好 */
store.clear()
globalThis.localStorage.setItem('web2.llm', JSON.stringify({ provider: '', key: '', model: '' }))
ok('E1 没配 Key → 静默失败（不抛）', await (async () => {
  const r = await reviewAdvice({ block: BLOCK, today: TODAY, fetchImpl: fakeOk })
  return r.ok === false && r.message.includes('Key')
})())
ok('E2 没有复习安排 → 直接说没有（不发请求）', await (async () => {
  let called = 0
  const spy = async () => { called += 1; return fakeOk() }
  const r = await reviewAdvice({ block: null, today: TODAY, fetchImpl: spy })
  return r.ok === false && called === 0
})())

globalThis.localStorage.setItem('web2.llm', JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' }))
ok('E3 配好了、请求成功 → 拿到一句话并存进缓存', await (async () => {
  store.delete(ADVICE_KEY)
  const r = await reviewAdvice({ block: BLOCK, today: TODAY, fetchImpl: fakeOk })
  return r.ok && r.line.startsWith('先看结构力学Ⅰ') && !!loadAdvice(TODAY)
})())
ok('E4 当天第二次 → 直接用缓存（不再请求）', await (async () => {
  let called = 0
  const spy = async () => { called += 1; return fakeOk() }
  const r = await reviewAdvice({ block: BLOCK, today: TODAY, fetchImpl: spy })
  return r.ok && r.cached === true && called === 0
})())
ok('E5 请求失败（401）→ 静默失败，不写缓存', await (async () => {
  store.delete(ADVICE_KEY)
  const r = await reviewAdvice({ block: BLOCK, today: TODAY, fetchImpl: fakeBad })
  return r.ok === false && r.message.includes('401') && loadAdvice(TODAY) === null
})())
ok('E6 网络抛错 → 静默失败（不把异常漏给界面）', await (async () => {
  store.delete(ADVICE_KEY)
  const r = await reviewAdvice({ block: BLOCK, today: TODAY, fetchImpl: fakeThrow })
  return r.ok === false && r.message === '网络请求失败'
})())
ok('E7 AI 说了催促的话 → 失败且不写缓存（界面回落规则句）', await (async () => {
  store.delete(ADVICE_KEY)
  const bad = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '赶紧看结构力学Ⅰ，不然来不及了' } }] }) })
  const r = await reviewAdvice({ block: BLOCK, today: TODAY, fetchImpl: bad })
  return r.ok === false && loadAdvice(TODAY) === null
})())
ok('E8 AI 回的 JSON 坏掉 → 静默失败', await (async () => {
  store.delete(ADVICE_KEY)
  const bad = async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })
  const r = await reviewAdvice({ block: BLOCK, today: TODAY, fetchImpl: bad })
  return r.ok === false && r.message.includes('JSON')
})())
ok('E9 请求体带上了 system + user 两条消息', await (async () => {
  store.delete(ADVICE_KEY)
  let body = null
  const spy = async (url, init) => { body = JSON.parse(init.body); return fakeOk() }
  await reviewAdvice({ block: BLOCK, today: TODAY, fetchImpl: spy })
  return body && body.messages.length === 2 && body.messages[0].role === 'system' && body.messages[1].content.includes('结构力学Ⅰ')
})())
ok('E10 请求带 Authorization 头（Key 从纪要配置来）', await (async () => {
  store.delete(ADVICE_KEY)
  let hd = null
  const spy = async (url, init) => { hd = init.headers; return fakeOk() }
  await reviewAdvice({ block: BLOCK, today: TODAY, fetchImpl: spy })
  return hd && hd.Authorization === 'Bearer sk-test'
})())
ok('E11 thinking 关掉（排一句话不需要思考模式）', await (async () => {
  store.delete(ADVICE_KEY)
  let body = null
  const spy = async (url, init) => { body = JSON.parse(init.body); return fakeOk() }
  await reviewAdvice({ block: BLOCK, today: TODAY, fetchImpl: spy })
  return body && body.thinking && body.thinking.type === 'disabled'
})())
ok('E12 模型名不在白名单 → 回落 deepseek-flash（不 400）', await (async () => {
  store.delete(ADVICE_KEY)
  globalThis.localStorage.setItem('web2.llm', JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: '瞎写的模型' }))
  let body = null
  const spy = async (url, init) => { body = JSON.parse(init.body); return fakeOk() }
  await reviewAdvice({ block: BLOCK, today: TODAY, fetchImpl: spy })
  globalThis.localStorage.setItem('web2.llm', JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' }))
  return body && body.model === 'deepseek-flash'
})())
ok('E13 缓存里是催促的话也照样返回（它已经存进去了；这里只验不重复请求）', await (async () => {
  store.clear()
  globalThis.localStorage.setItem('web2.llm', JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' }))
  saveAdvice(TODAY, '先看结构力学Ⅰ', 1)
  let called = 0
  const spy = async () => { called += 1; return fakeOk() }
  const r = await reviewAdvice({ block: BLOCK, today: TODAY, fetchImpl: spy })
  return r.ok && r.cached && called === 0
})())

console.log('\n=== 复习建议纯函数：' + pass + '/' + (pass + fail) + ' 通过 ===')
if (fail) console.log('失败项：' + fails.join(' / '))
process.exit(fail ? 1 : 0)
