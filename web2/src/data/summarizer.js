/* ---------- 课堂纪要 LLM 调用层（M4）----------
   Provider 抽象：底层换模型/换服务商不动上层（今天 deepseek，明天云服务托管 cloud
   只需往 PROVIDERS 里补实现）。配置存 localStorage（web2.llm），key 只落设备本地，
   不进导出 JSON、不进仓库。

   契约：每个 provider 提供
     available()  → 配置齐了没（缺啥返回缺啥的说明字符串，齐了返回 null）
     summarize(transcript, signal) → Promise<summary 对象（未 sanitize 的原始形状）>

   入口 summarizeTranscript(transcript, opts)：
     - 内部选 provider → 调用 → 结果过 store 的 setLectureSummary 落盘（调用方做）
     - opts.signal 支持取消（切页/重开一场时掐断请求）
     - opts.onStage(stage) 报阶段：'call' | 'parse'，UI 显示「生成中」而非假进度 */

export const LLM_KEY = 'web2.llm'
export const SUMMARY_PROMPT_VERSION = 1 // 提示词版本：纪要结构大改时 +1，旧纪要可选择重生成

/* ---------- 配置读写 ---------- */

export function loadLlmConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(LLM_KEY) || '')
    if (!c || typeof c !== 'object') return { provider: '', key: '', model: '' }
    return { provider: String(c.provider || ''), key: String(c.key || ''), model: String(c.model || '') }
  } catch {
    return { provider: '', key: '', model: '' }
  }
}

export function saveLlmConfig(cfg) {
  localStorage.setItem(LLM_KEY, JSON.stringify({ provider: String(cfg.provider || ''), key: String(cfg.key || ''), model: String(cfg.model || '') }))
}

/* ---------- 提示词 ----------
   要求严格 JSON 输出；「不确定就放 questions」是为了对抗转写噪声——
   SenseVoice 对专业名词会错字，与其让 LLM 硬编错的「事实」，不如标记存疑。
   opts.concise：输出被长度上限截断后的第二次尝试。截断的根因是「长文字稿 →
   模型要点写发散 → JSON 还没写完就撞顶」，所以第二次要收紧条数与字数，
   让整份 JSON 在预算内收尾。 */
function buildPrompt(transcript, opts = {}) {
  return [
    '你是一名助教，帮大学生把课堂录音的文字稿整理成复习纪要。文字稿来自语音识别，可能有错别字和同音字错误，请结合上下文理解，不要逐字照抄错字。',
    '只输出一个 JSON 对象，不要输出任何其他文字或代码块标记，结构如下：',
    '{"overview":"两三句话概括这堂课讲了什么","key_points":["要点1","要点2"],"terms":[{"term":"术语","note":"一句人话解释"}],"homework":["作业/截止事项，没有则空数组"],"questions":["内容里含糊、疑似识别错误或逻辑不通的地方，没有则空数组"]}',
    /* homework 单独一段、且写明「不受精简影响」：它是唯一会被下游转成待办、
       漏了就再也补不回来的字段（其他字段漏一条只是纪要少一句）。原措辞
       「只收明确提到的」是防幻觉的取舍，但代价是把「老师顺口提的作业」也丢了；
       改成「宁可多列、拿不准照原话列」，保留原话即不编造，同时不漏。 */
    opts.concise
      ? '要求：务必精简，overview 不超过 60 字；key_points 3~5 条、每条不超过 20 字；terms 不超过 5 个；questions 只列必要的。但 homework 不受精简影响、必须保持完整：宁可压缩 overview 和 key_points，也不许省略任何一条作业。任何情况下都必须输出完整、可解析的 JSON。全部用简体中文。'
      : '要求：key_points 3~8 条、每条一句话；terms 只收真正的概念词；questions 收「疑似听错的词」和「上下文读不通的段落」。',
    'homework 要尽量收全，不许省略：老师提到的作业、习题、论文、实验报告、预习任务、提交要求、考试范围与时间，全部列出来；一条作业因为「不确定」被丢掉是最严重的错误——拿不准或听不清的，照原话列出来即可，不要自己判断它算不算。',
    '全部用简体中文。',
    '',
    '文字稿：',
    transcript,
  ].join('\n')
}

/* ---------- Provider：DeepSeek（OpenAI 兼容 chat/completions） ---------- */

/* 模型给选项不让手填：真机实测手填错名 → DeepSeek 返回 400（模型不存在）。
   2026-09 官方 lineup：deepseek-flash / deepseek-v4-pro（api-docs.deepseek.com）；
   上一代 deepseek-chat/deepseek-reasoner 已不在文档——「测试连接」成功后会用
   /models 返回的实际列表动态覆盖这份静态兜底。 */
export const DEEPSEEK_MODELS = [
  { id: 'deepseek-flash', label: 'deepseek-flash · V4.1-Flash（推荐，快）' },
  { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro · V4-Pro（更强，较贵）' },
]

/* 连通性检测：GET /models 只验证 Key、不消耗余额（比发一条真 chat 请求划算）。
   返回 { ok:true, models:[...], modelOk } 或 { ok:false, message }；modelOk=false 表示
   当前选的模型不在官方列表里（提示但不算失败——官方偶尔下线旧模型名）。 */
export async function testConnection() {
  const c = loadLlmConfig()
  if (c.provider !== 'deepseek') return { ok: false, message: '请先选择 DeepSeek 作为纪要服务。' }
  if (!c.key) return { ok: false, message: '请先填 API Key 再测试。' }
  let res
  try {
    res = await fetch('https://api.deepseek.com/models', { headers: { Authorization: 'Bearer ' + c.key } })
  } catch (e) {
    return { ok: false, message: '网络请求失败，请检查网络后重试。' }
  }
  if (res.status === 401) return { ok: false, message: 'Key 无效（401），请检查是否填对。' }
  if (!res.ok) return { ok: false, message: 'DeepSeek 服务返回 ' + res.status + '，稍后重试。' }
  let models = []
  try {
    const data = await res.json()
    models = (data && data.data || []).map((m) => m.id).filter(Boolean)
  } catch { /* 列表解析失败不算失败——Key 已验证通过 */ }
  return { ok: true, models, modelOk: !c.model || models.indexOf(c.model) !== -1 }
}

/* 输出上限（tokens）。原值 2000 太小——纪要是「长文字稿进 → 长 JSON 出」的任务，
   一节课的文字稿会产出更多要点，JSON 没收尾就撞顶被截断，于是报「不是有效 JSON」
   （假症状，真原因是截断）。官方文档：非思考模式不设 max_tokens 时默认 8K，
   这里显式对齐 8000。输出按实际生成量计费，抬高上限不增加花费，只在需要时才用。 */
const MAX_TOKENS = 8000

/* 单次 chat/completions 请求。返回 { content, finishReason }；
   网络/HTTP 层错误在此就地分类成可读消息。
   finish_reason 官方取值：stop / length / content_filter / tool_calls /
   insufficient_system_resource / aborted。length = 被 max_tokens 或上下文截断
   （官方原文：「消息内容可能会被部分截断」），必须单独识别，否则会误报成 JSON 格式问题。 */
async function requestOnce(c, model, transcript, concise, signal) {
  let res
  try {
    res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: buildPrompt(transcript, { concise }) }],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' }, // 思考模式默认开且 effort=high（2026-09 文档）——纪要要快，显式关
        temperature: 0.3, // 仅非思考模式生效，与 disabled 配套
        max_tokens: MAX_TOKENS,
      }),
      signal,
    })
  } catch (e) {
    if (e && e.name === 'AbortError') throw e
    throw new Error('网络请求失败，请检查网络后重试。')
  }
  if (res.status === 401) throw new Error('API Key 无效（401），请检查 Key 是否填对。')
  if (res.status === 402) throw new Error('DeepSeek 账户余额不足（402），请充值后重试。')
  if (res.status === 429) throw new Error('请求太频繁（429），稍等几秒再试。')
  if (res.status === 400) throw new Error('请求被拒（400）：通常是模型名无效，请在「课堂纪要」设置里重新选模型。')
  if (!res.ok) throw new Error('DeepSeek 服务返回 ' + res.status + '，稍后重试。')
  const data = await res.json()
  const choice = data && data.choices && data.choices[0]
  const content = choice && choice.message && choice.message.content
  // 先不在这里判空内容：被截断时 content 也可能为空，交由上层按 finish_reason 定性
  return { content: content ? String(content) : '', finishReason: (choice && choice.finish_reason) || '' }
}

const deepseekProvider = {
  available() {
    const c = loadLlmConfig()
    if (c.provider !== 'deepseek') return null // 未选中不校验
    if (!c.key) return '还没有填 DeepSeek API Key（我的 → 设置 → 课堂纪要）'
    return null
  },
  async summarize(transcript, signal) {
    const c = loadLlmConfig()
    // 白名单外（含旧版手填错的模型名）一律回落 deepseek-flash，避免 400「模型不存在」
    const model = DEEPSEEK_MODELS.some((m) => m.id === c.model) ? c.model : 'deepseek-flash'
    let lastError = null
    /* 两次机会。第一次正常提示词；若「输出被长度上限截断」或「JSON 解析失败」，
       第二次换精简提示词再试——长文字稿最容易栽在第一下（模型把要点写发散，
       JSON 还没收尾就撞上 max_tokens），收紧条数后基本都能写完整。 */
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await requestOnce(c, model, transcript, attempt === 1, signal)
      if (r.finishReason === 'length') {
        lastError = new Error('纪要输出超过长度上限被截断（文字稿太长，模型没写完）')
        if (attempt === 0) continue
        throw lastError
      }
      if (r.finishReason === 'content_filter') throw new Error('内容被服务端安全策略过滤，无法生成纪要。')
      if (r.finishReason === 'insufficient_system_resource') throw new Error('服务端推理资源不足，生成被中断，请稍后重试。')
      if (r.finishReason === 'aborted') throw new Error('生成过程被中断，请重试。')
      if (!r.content) throw new Error('DeepSeek 返回了空内容。')
      try {
        return parseSummaryJson(r.content)
      } catch (e) {
        lastError = e
        if (attempt === 0) continue // 罕见的坏 JSON：也给一次重试
        throw e
      }
    }
    throw lastError || new Error('纪要生成失败。')
  },
}

/* ---------- Provider：云服务托管（预留插槽，开通后补实现） ---------- */

const cloudProvider = {
  available() {
    return '云服务托管还没开通（预留插槽）'
  },
  async summarize() {
    throw new Error('云服务托管还没实现（预留插槽）。')
  },
}

const PROVIDERS = { deepseek: deepseekProvider, cloud: cloudProvider }

/* ---------- 解析与校验 ----------
   LLM 偶尔会裹 markdown 代码块，先剥壳再 JSON.parse；解析失败给出可读错误。 */
export function parseSummaryJson(text) {
  let t = String(text || '').trim()
  const m = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (m) t = m[1]
  let obj
  try {
    obj = JSON.parse(t)
  } catch {
    throw new Error('纪要返回的不是有效 JSON，重试一次通常可解。')
  }
  if (!obj || typeof obj !== 'object' || !String(obj.overview || '').trim()) {
    throw new Error('纪要内容不完整（缺总览），重试一次。')
  }
  return obj
}

/* ---------- 对外入口 ---------- */

export function summarizerAvailable() {
  const c = loadLlmConfig()
  const p = PROVIDERS[c.provider]
  return p ? p.available() : '还没选择纪要服务（我的 → 设置 → 课堂纪要）'
}

/* 生成纪要：转写文字 → LLM → 原始 summary 对象（落盘由调用方走 store.setLectureSummary）。
   文字稿太短没东西可总结：直接拒绝，不浪费一次调用。 */
export async function summarizeTranscript(transcript, opts = {}) {
  const t = String(transcript || '').trim()
  if (t.length < 30) throw new Error('文字稿太短（不足 30 字），没有可总结的内容。')
  const c = loadLlmConfig()
  const p = PROVIDERS[c.provider]
  if (!p) throw new Error('还没选择纪要服务（我的 → 设置 → 课堂纪要）。')
  const missing = p.available()
  if (missing) throw new Error(missing)
  if (opts.onStage) opts.onStage('call')
  const raw = await p.summarize(t, opts.signal)
  if (opts.onStage) opts.onStage('parse')
  return raw
}

/* ---------- P4 六期第三步：把「规则算出来的事实」交给 AI 换一句人话 ----------
   铁律：**规则负责算哪个数，AI 只负责说哪句**。所以这里有**两道闸**：
     ① 提示词明确禁止新增数字/日期/次数/推断（软约束，靠模型守规矩）；
     ② 拿回来的句子必须过 sameFacts() 的数字闸门，对不上就整句丢弃（硬约束，代码保证）。
   拿不到（没配 Key / 超时 / 报错 / 数字对不上）一律返回 { ok:false }，调用方退回规则原句，
   界面绝不留空白。 */
export const PHRASE_PROMPT_VERSION = 1

/* 抓出一段文本里的数字（阿拉伯数字）。
   为什么**不**把中文数字也换算成数字：中文里「一共」「一次都没动过」这类说法极常见，
   一换算就会冒出原句没有的数字，把合法的改写误判成「改了事实」。
   （第一版就是这么写的，A1/B4 当场红：『一共 3 个』里那个「一」被换成了 1。） */
function nums(s) {
  return (String(s == null ? '' : s).match(/\d+(?:\.\d+)?/g) || []).map((x) => String(Number(x)))
}

/** 「只换说法、不动事实」的机械判据：**AI 那句话里不许冒出原句没有的数字**。
    用子集（而不是相等）是因为 AI 很自然会把「断了 3 次（共 3 个周三）」说成
    「3 个周三都没动过事」——重复的数字只说一次、或干脆写成中文，都不算改事实。
    已知边界（如实记下）：AI 把数量写成中文且写错（原文 3 说成「五次」）这条闸门拦不住；
    那是提示词（不许新增/丢掉数字）该管的。真要更严就得引入中文数字词法，
    代价是误杀「一次都没动过」这类正常说法 —— 宁可漏拦，不可误杀。 */
export function sameFacts(a, b) {
  const orig = new Set(nums(a))
  if (!orig.size) return true // 原句本来就没数字（如「最近没什么事」）→ 无从比对
  for (const v of new Set(nums(b))) if (!orig.has(v)) return false
  return true
}

const PHRASE_TIMEOUT_MS = 8000
const PHRASE_MAX_TOKENS = 120

/* 系统提示词只放规矩，事实放在 user 消息里（免得模型把两者混着抄） */
function buildPhraseSystem() {
  return [
    '你只负责改写一句话，不负责判断事实。',
    '这句话里的事实已经由程序算好了，你要做的只是换一种说法。',
    '规则：',
    '1) 意思和事实必须完全一致，只能改语气和措辞；',
    '2) 不许新增任何数字、日期、次数、推断或建议，也不许把原有的数字丢掉；',
    '3) 不要引号、不要 emoji、不要任何前后缀，只输出这一句话；',
    '4) 不超过 40 个字。',
  ].join('\n')
}

/** 把一句「规则事实」交给 AI 换个说法。
    返回 { ok:true, line }（line 不带句号，调用方自己补）或 { ok:false, message }。 */
export async function phraseFact(fact, opts = {}) {
  const src = String(fact || '').trim()
  if (!src) return { ok: false, message: '没有要改写的事实' }
  const c = loadLlmConfig()
  if (c.provider !== 'deepseek' || !c.key) return { ok: false, message: '没配 DeepSeek Key' }
  const model = DEEPSEEK_MODELS.some((m) => m.id === c.model) ? c.model : 'deepseek-flash'
  const ms = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : PHRASE_TIMEOUT_MS
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null
  let res
  try {
    res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildPhraseSystem() },
          { role: 'user', content: '原句：' + src },
        ],
        thinking: { type: 'disabled' }, // 只是换个说法，不需要思考模式（快且省）
        temperature: 0.7, // 这活儿是「说话」不是「算数」，留点温度但别放飞
        max_tokens: PHRASE_MAX_TOKENS,
      }),
      signal: ctl ? ctl.signal : undefined,
    })
  } catch (e) {
    return { ok: false, message: e && e.name === 'AbortError' ? 'AI 超时' : '网络请求失败' }
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (!res.ok) return { ok: false, message: 'AI 返回 ' + res.status }
  let content = ''
  try {
    const data = await res.json()
    const choice = data && data.choices && data.choices[0]
    content = choice && choice.message && choice.message.content ? String(choice.message.content) : ''
  } catch {
    return { ok: false, message: 'AI 回的不是合法 JSON' }
  }
  /* 归一：去两头引号 → 只要第一行 → 去掉句末标点（模板自己补「。」） */
  let line = content
    .trim()
    .replace(/^["'“”「『]+|["'“”」』]+$/g, '')
    .trim()
  line = (line.split('\n').map((x) => x.trim()).filter(Boolean)[0] || '').replace(/[。.！!？?]+$/, '').trim()
  if (!line) return { ok: false, message: 'AI 回了空内容' }
  if (line.length > 60) return { ok: false, message: 'AI 说得太长' }
  if (!sameFacts(src, line)) return { ok: false, message: 'AI 改了数字，已丢弃' }
  return { ok: true, line }
}
