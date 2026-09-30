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
   SenseVoice 对专业名词会错字，与其让 LLM 硬编错的「事实」，不如标记存疑。 */
function buildPrompt(transcript) {
  return [
    '你是一名助教，帮大学生把课堂录音的文字稿整理成复习纪要。文字稿来自语音识别，可能有错别字和同音字错误，请结合上下文理解，不要逐字照抄错字。',
    '只输出一个 JSON 对象，不要输出任何其他文字或代码块标记，结构如下：',
    '{"overview":"两三句话概括这堂课讲了什么","key_points":["要点1","要点2"],"terms":[{"term":"术语","note":"一句人话解释"}],"homework":["作业/截止事项，没有则空数组"],"questions":["内容里含糊、疑似识别错误或逻辑不通的地方，没有则空数组"]}',
    '要求：key_points 3~8 条、每条一句话；terms 只收真正的概念词；homework 只收明确提到的任务/截止；questions 收「疑似听错的词」和「上下文读不通的段落」。全部用简体中文。',
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
    let res
    try {
      res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: buildPrompt(transcript) }],
          response_format: { type: 'json_object' },
          thinking: { type: 'disabled' }, // 思考模式默认开且 effort=high（2026-09 文档）——纪要要快，显式关
          temperature: 0.3, // 仅非思考模式生效，与 disabled 配套
          max_tokens: 2000,
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
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
    if (!text) throw new Error('DeepSeek 返回了空内容。')
    return parseSummaryJson(text)
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
