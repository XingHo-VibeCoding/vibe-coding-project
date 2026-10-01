/* 转写能力单一口径（M3）。App 平台走原生 Transcriber 插件（scripts/native/TranscriberPlugin.kt），
   浏览器环境明确拒绝——与 recorder.js 同一原则：不做假实现，避免假成功骗过测试。
   模型下载源：hf-mirror.com（HuggingFace 国内镜像，已实测无代理直连可达，2026-09-26）。
   转写 = 逐 clip 调原生识别（30s 分段在原生层），文字按 clip 顺序拼接，写回 lectures.transcript。 */

import { loadLectures, updateLecture } from './store.js'
import { LECTURE_SUB_DIR } from './recorder.js'

/* 主源 + 备源（都验证过 302→200 链路；App 侧 HttpURLConnection 会跟随重定向，
   若 Range 头在重定向后被丢，原生层按 200 全量响应自动放弃续传重下——不会产生坏文件） */
export const MODEL_SOURCES = {
  model: 'https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/model.int8.onnx',
  tokens: 'https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/tokens.txt',
}
export const MODEL_TOTAL_BYTES = 239233841 // 实测 Content-Length，用于下载进度分母兜底

function plugin() {
  const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Transcriber
  return p || null
}

export function transcriberAvailable() {
  return !!plugin()
}

/* 模型状态：{ available, ready, modelBytes, tokensBytes }；浏览器返回 { available:false } */
export async function modelState() {
  const p = plugin()
  if (!p) return { available: false, ready: false }
  try {
    const r = await p.isModelReady()
    return { available: true, ready: !!r.ready, modelBytes: Number(r.modelBytes) || 0, tokensBytes: Number(r.tokensBytes) || 0 }
  } catch (e) {
    return { available: true, ready: false, error: e && e.message ? e.message : String(e) }
  }
}

/* 事件订阅包装：原生层经 addListener 推 download / transcribe 进度 */
function listen(p, name, cb) {
  if (typeof p.addListener === 'function') {
    const h = p.addListener(name, cb)
    // Capacitor 插件返回 PluginListenerHandle（含 remove）；假插件可能返回 undefined，都不炸
    return h && typeof h.remove === 'function' ? h : { remove: function () {} }
  }
  return { remove: function () {} }
}

/* 确保模型就绪：已就绪直接返回 true；否则先下 tokens（309KB）再下 model（228MB）。
   onProgress({file, percent, loaded, total}) 下载期间被调。失败抛错（消息可直接显示）。 */
export async function ensureModel(onProgress) {
  const st = await modelState()
  if (!st.available) throw new Error('转写只能在 App 内使用（浏览器不支持）。')
  if (st.ready) return true
  const p = plugin()
  for (const which of ['tokens', 'model']) {
    await new Promise((resolve, reject) => {
      const h = listen(p, 'download', (ev) => {
        if (onProgress) onProgress({ file: which, percent: Number(ev.percent) || 0, loaded: Number(ev.loaded) || 0, total: Number(ev.total) || (which === 'model' ? MODEL_TOTAL_BYTES : 0) })
      })
      p.downloadModel({ url: MODEL_SOURCES[which], which })
        .then((r) => { h.remove(); resolve(r) })
        .catch((e) => { h.remove(); reject(new Error(e && e.message ? e.message : '模型下载失败')) })
    })
  }
  return true
}

/* M5 分段转写（边录边预转）：开录后 fire-and-forget 调 startLive，原生每 3 分钟把
   录音文件里已写完的完整 30s 段先识别掉；停录时 stopLive 领走前段文字。
   尽力而为：模型没就绪/没文件/已被占用都返回 started:false，不影响录音，
   最终转写兜底全量。 */
export async function startLiveTranscribe() {
  const p = plugin()
  if (!p || typeof p.startLive !== 'function') return { started: false, unsupported: true }
  try {
    const r = await p.startLive({ subDir: LECTURE_SUB_DIR })
    return { started: !!(r && r.started), reason: r && r.reason }
  } catch (e) {
    return { started: false, error: e && e.message ? e.message : String(e) }
  }
}

/* 停录时取走预转结果：{ active, text, segs }；没起过 live → { active:false } */
export async function stopLiveTranscribe() {
  const p = plugin()
  if (!p || typeof p.stopLive !== 'function') return { active: false, unsupported: true }
  try {
    const r = await p.stopLive({})
    return { active: !!(r && r.active), text: (r && r.text) || '', segs: Number(r && r.segs) || 0 }
  } catch (e) {
    return { active: false, error: e && e.message ? e.message : String(e) }
  }
}

/* 转写一整场：按 clip 顺序逐个识别，文字用换行拼接。
   onProgress({clipIndex, clipCount, percent, phase}) —— percent 为全场百分比；
   phase 来自原生层：'decode'/'resample' 是识别前的解码/重采样（percent 是该步内部
   百分比，不代表全场！直接上进度条会出现「先冲 90% 再跳回 50%」的假象，调用方必须区分），
   'asr' 才是真正的识别进度。
   opts.live：{text, segs} 分段预转的结果——第一个 clip 跳过前 segs 段、结果前拼 text
   （参数原样传给原生层，拼接与防重复都在原生做）。
   状态机：进 transcribing → 全部成功后 transcribed（文字稿落库）。
   失败保持 transcribing？不——失败回退到 recording（updateLecture 的状态机只拦「倒退」，
   recording < transcribing 允许，语义 = 这场还没转完，可重试）。 */
export async function transcribeLecture(lectureId, onProgress, opts = {}) {
  const list = loadLectures()
  const lec = list.find((x) => String(x.id) === String(lectureId))
  if (!lec) throw new Error('录音场次不存在。')
  const clips = (lec.clips || []).filter((c) => c && c.path)
  if (!clips.length) throw new Error('这场没有可转写的录音文件。')

  const u = updateLecture(lectureId, { status: 'transcribing' })
  if (!u.ok) throw new Error(u.error)

  const p = plugin()
  if (!p) throw new Error('转写只能在 App 内使用（浏览器不支持）。')
  const live = opts.live && opts.live.segs > 0 ? opts.live : null
  let liveApplied = false
  const texts = []
  try {
    for (let i = 0; i < clips.length; i++) {
      const params = { path: clips[i].path }
      // live 只对应「录音进行中的那一个文件」= 第一个 clip
      if (live && !liveApplied) {
        params.skipSegs = live.segs
        params.prefixText = live.text
        liveApplied = true
      }
      const r = await new Promise((resolve, reject) => {
        const h = listen(p, 'transcribe', (ev) => {
          if (onProgress) onProgress({ clipIndex: i, clipCount: clips.length, percent: Number(ev.percent) || 0, phase: ev.phase || 'asr' })
        })
        p.transcribe(params)
          .then((res) => { h.remove(); resolve(res) })
          .catch((e) => { h.remove(); reject(new Error(e && e.message ? e.message : '转写失败')) })
      })
      texts.push((r && r.text ? String(r.text) : '').trim())
    }
  } catch (e) {
    // 转写失败回退 recording（允许重试）；已有文字不丢（半场结果不落，下次重来）
    updateLecture(lectureId, { status: 'recording' })
    throw e
  }
  const transcript = texts.filter(Boolean).join('\n')
  const u2 = updateLecture(lectureId, { status: 'transcribed', transcript: transcript || null })
  if (!u2.ok) throw new Error(u2.error)
  return { transcript, clips: clips.length }
}

export async function cancelTranscribe() {
  const p = plugin()
  if (p && typeof p.cancel === 'function') await p.cancel()
}
