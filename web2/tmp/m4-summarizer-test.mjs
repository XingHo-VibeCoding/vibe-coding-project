/* M4-1 单元测试：store summary 状态机 + summarizer 解析/错误分类
   node 直跑：global.window=global、localStorage stub、require 源码（金标准 shim 口径） */
global.window = global
const store = {
  getItem(k) { return this._d?.[k] ?? null },
  setItem(k, v) { (this._d ??= {})[k] = String(v) },
  removeItem(k) { delete this._d?.[k] },
  _d: {},
}
global.localStorage = store

const { loadLectures, addLecture, updateLecture, setLectureSummary } = await import('file:///D:/Document/Project/vibe-coding-project-web2/src/data/store.js')
const { parseSummaryJson, summarizeTranscript, loadLlmConfig, saveLlmConfig, summarizerAvailable } = await import('file:///D:/Document/Project/vibe-coding-project-web2/src/data/summarizer.js')

let pass = 0, fail = 0
const t = (name, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name); ok ? pass++ : fail++ }

/* ===== store：summary 状态机 ===== */
const lec = addLecture({ title: '高数第 5 讲' })
t('1. 新场次 summary 为 null', lec.summary === null && lec.status === 'recording')

// 推进到 transcribed（带文字稿）
const r1 = updateLecture(lec.id, { status: 'transcribing' })
const r2 = updateLecture(lec.id, { status: 'transcribed', transcript: '今天讲泰勒公式，先回顾拉格朗日中值定理……' })
t('2. recording→transcribing→transcribed 顺利推进', r1.ok && r2.ok && r2.lecture.status === 'transcribed')

// 没转写完不许写纪要
const lec2 = addLecture({ title: '英语口语' })
const rEarly = setLectureSummary(lec2.id, { overview: '测试' })
t('3. recording 状态写纪要被拒', !rEarly.ok && /转写/.test(rEarly.error))

// 正常写入：状态推到 summarized + 字段白名单
const rOk = setLectureSummary(lec.id, {
  overview: '本讲讲泰勒公式及其应用',
  key_points: ['泰勒公式定义', '麦克劳林展开是特例'],
  terms: [{ term: '泰勒公式', note: '用多项式逼近函数' }, { term: '', note: '空术语应剔除' }, '坏形状'],
  homework: ['习题 5.1 第 1-5 题', ''],
  questions: ['疑似把「拉格朗日」识别成「拉格朗之日」'],
  junk_field: '多余字段',
  created_at: '2026-09-27T15:00:00Z',
})
t('4. transcribed 写纪要成功且推进到 summarized', rOk.ok && rOk.lecture.status === 'summarized')
t('5. 纪要白名单整形：空术语/坏形状剔除、多余字段丢弃', rOk.lecture.summary.terms.length === 1 && rOk.lecture.summary.homework.length === 1 && !('junk_field' in rOk.lecture.summary))
t('6. created_at 保留', rOk.lecture.summary.created_at === '2026-09-27T15:00:00Z')

// summarized 不可逆
const rBack = updateLecture(lec.id, { status: 'transcribed' })
t('7. summarized 不可逆退站', !rBack.ok)

// summarized 可覆盖重写（重新生成纪要的合法路径）
const rAgain = setLectureSummary(lec.id, { overview: '重生成：泰勒公式与误差估计' })
t('8. summarized 状态可重写纪要', rAgain.ok && rAgain.lecture.summary.overview.startsWith('重生成'))

// 落盘往返：sanitizeLecture 重建后 summary 还在
t('9. 落盘往返后 summary 保持', loadLectures().find((x) => x.id === lec.id).summary.overview.startsWith('重生成'))

// 缺总览被拒
const rBad = setLectureSummary(lec.id, { key_points: ['只有要点'] })
t('10. 缺 overview 被拒', !rBad.ok && /总览/.test(rBad.error))

/* ===== summarizer：解析与错误分类（mock fetch） ===== */

// 代码块裹壳 + 正常 JSON
const wrapped = '```json\n{"overview":"总览A","key_points":["k1"],"terms":[],"homework":[],"questions":[]}\n```'
const p1 = parseSummaryJson(wrapped)
t('11. 剥 markdown 代码壳后解析成功', p1.overview === '总览A')

try { parseSummaryJson('这不是 JSON'); t('12. 非 JSON 报可读错误', false) } catch (e) { t('12. 非 JSON 报可读错误', /JSON/.test(e.message)) }
try { parseSummaryJson('{"key_points":[]}'); t('13. 缺 overview 报错', false) } catch (e) { t('13. 缺 overview 报错', /总览/.test(e.message)) }

// summarizeTranscript：文字稿太短
try { await summarizeTranscript('太短'); t('14. 文字稿<30字拒绝', false) } catch (e) { t('14. 文字稿<30字拒绝', /30 字/.test(e.message)) }

// 未配置 provider
try { await summarizeTranscript('一段足够长的文字稿，长度超过三十个字，用来测试 provider 未配置时的错误提示是否正常显示出来。'); t('15. 未配置报可读错误', false) } catch (e) { t('15. 未配置报可读错误', /还没选择纪要服务/.test(e.message)) }

// deepseek：有 key 但 fetch 401 → 错误分类
saveLlmConfig({ provider: 'deepseek', key: 'sk-test', model: '' })
t('16. 配置落盘往返', loadLlmConfig().provider === 'deepseek' && loadLlmConfig().key === 'sk-test')
t('17. deepseek 配齐后 available 为 null', summarizerAvailable() === null)

global.fetch = async () => ({ ok: false, status: 401 })
try { await summarizeTranscript('一段足够长的文字稿，长度超过三十个字，用来测试 401 错误分类。'); t('18. 401 → Key 无效提示', false) } catch (e) { t('18. 401 → Key 无效提示', /401/.test(e.message) && /Key/.test(e.message)) }

global.fetch = async () => ({ ok: false, status: 402 })
try { await summarizeTranscript('一段足够长的文字稿，长度超过三十个字，用来测试 402 余额不足的错误分类是否正确。'); t('19. 402 → 余额提示', false) } catch (e) { t('19. 402 → 余额提示', /余额/.test(e.message)) }

// 成功路径：返回合规 JSON
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"overview":"成功总览","key_points":["a"],"terms":[{"term":"x","note":"y"}],"homework":[],"questions":[]}' } }] }) })
const okSum = await summarizeTranscript('一段足够长的文字稿，长度超过三十个字，成功路径的返回应该原样透传给调用方落盘。', { onStage: (s) => { global.__stage = s } })
t('20. 成功路径返回原始对象', okSum.overview === '成功总览' && okSum.terms[0].term === 'x')
t('21. onStage 最终报 parse', global.__stage === 'parse')

// cloud 预留插槽：选了 cloud 明确报「未实现」
saveLlmConfig({ provider: 'cloud', key: '', model: '' })
try { await summarizeTranscript('一段足够长的文字稿，长度超过三十个字，cloud 插槽应该明确报未开通。'); t('22. cloud 插槽报未开通', false) } catch (e) { t('22. cloud 插槽报未开通', /还没开通/.test(e.message)) }

// ===== M4-2b：testConnection 连通性检测 + 模型白名单回落 =====
const { testConnection, DEEPSEEK_MODELS } = await import('file:///D:/Document/Project/vibe-coding-project-web2/src/data/summarizer.js')
t('23. DEEPSEEK_MODELS 为现役两档（flash/v4-pro）', DEEPSEEK_MODELS.length === 2 && DEEPSEEK_MODELS.some((m) => m.id === 'deepseek-flash') && DEEPSEEK_MODELS.some((m) => m.id === 'deepseek-v4-pro'))

saveLlmConfig({ provider: '', key: '', model: '' })
const tcNone = await testConnection()
t('24. 未选 provider → 明确提示', !tcNone.ok && /纪要服务/.test(tcNone.message))

saveLlmConfig({ provider: 'deepseek', key: '', model: '' })
const tcNoKey = await testConnection()
t('25. 没 Key → 明确提示', !tcNoKey.ok && /Key/.test(tcNoKey.message))

saveLlmConfig({ provider: 'deepseek', key: 'sk-x', model: 'deepseek-flash' })
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] }) })
const tcOk = await testConnection()
t('26. 连通成功且模型在列表 → modelOk', tcOk.ok && tcOk.modelOk === true && tcOk.models.length === 2)

saveLlmConfig({ provider: 'deepseek', key: 'sk-x', model: 'deepseek-chat' })
const tcBadModel = await testConnection()
t('27. 连通成功但模型不在列表（旧名 deepseek-chat 已下线）→ modelOk=false', tcBadModel.ok && tcBadModel.modelOk === false)

global.fetch = async () => ({ ok: false, status: 401 })
const tc401 = await testConnection()
t('28. 401 → Key 无效提示', !tcOk2Guard(tc401) && /401/.test(tc401.message))
function tcOk2Guard(r) { return r.ok }

global.fetch = async () => { throw new Error('net down') }
const tcNet = await testConnection()
t('29. 网络失败 → 可读提示', !tcNet.ok && /网络/.test(tcNet.message))

// 模型白名单回落：存了旧坏名 → summarize 请求体里用 deepseek-flash，且显式关思考模式
saveLlmConfig({ provider: 'deepseek', key: 'sk-x', model: 'deepseek-wrong' })
let sentModel = '', sentBody = null
global.fetch = async (url, opts) => {
  if (String(url).indexOf('/models') !== -1) return { ok: true, status: 200, json: async () => ({ data: [] }) }
  sentBody = JSON.parse(opts.body)
  sentModel = sentBody.model
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"overview":"回落总览","key_points":[],"terms":[],"homework":[],"questions":[]}' } }] }) }
}
const fb = await summarizeTranscript('一段足够长的文字稿，长度超过三十个字，用来验证坏模型名自动回落到 deepseek-flash。')
t('30. 坏模型名自动回落 deepseek-flash', sentModel === 'deepseek-flash' && fb.overview === '回落总览')
t('31. 请求显式关思考模式（thinking disabled）', sentBody && sentBody.thinking && sentBody.thinking.type === 'disabled')

console.log(`\n结果：${pass} 过 / ${fail} 挂`)
process.exit(fail ? 1 : 0)
