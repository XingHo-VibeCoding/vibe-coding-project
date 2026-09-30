/* web2 录音能力出口（二期 M2）——单一口径：只有 App 平台能录音。
   App 走 Capacitor 原生插件 capacitor-voice-recorder（Android MediaRecorder，后台/原生线程），
   浏览器/桌面没有该插件：一律返回「需在 App 内使用」，不做 MediaRecorder 兜底——
   WebView 里的网页录音一锁屏/切后台就断，正是课堂录音最不能接受的场景。
   （平台判定看 window.Capacitor.Plugins.VoiceRecorder 是否存在，便于测试注入假插件。） */

export const LECTURE_SUB_DIR = 'lectures' // 录音文件落盘子目录（应用私有目录下）
export const LECTURE_DIR = 'DATA' // 对应 Capacitor Filesystem 的 Directory.Data（= getFilesDir()）

function cap() {
  return typeof window !== 'undefined' ? window.Capacitor : null
}
function plugins() {
  const c = cap()
  return c && c.Plugins ? c.Plugins : null
}

/* 录音能力是否可用（App 平台 true；浏览器 false） */
export function recorderAvailable() {
  const p = plugins()
  return !!(p && p.VoiceRecorder)
}

/* 音频文件路径 → WebView 可播放 URL（App 平台需要转换，浏览器环境原样返回）
   注意：Capacitor 的 convertFileSrc 只认「/ 开头的绝对路径」和「file:// URI」两种输入，
   其余原样返回——而录音插件 stopRecording 返回的是「相对路径」（subDirectory/文件名），
   所以必须先经 Filesystem.getUri 转成 file:// URI，见 resolvePlayableUri。 */
export function fileUri(path) {
  const c = cap()
  if (path && c && typeof c.convertFileSrc === 'function') return c.convertFileSrc(String(path))
  return path ? String(path) : ''
}

/* 录音文件相对路径 → 可直接喂给 <audio> 的 URL（App 平台）。
   链路（插件 README 官方做法）：Filesystem.getUri({directory:'DATA', path})
     → file:///data/user/0/<appId>/files/<path>
     → Capacitor.convertFileSrc(uri)
     → https://localhost/_capacitor_file_/data/user/0/...
   浏览器环境（无插件）退回原样，由调用方给出「需在 App 内使用」的提示。 */
export async function resolvePlayableUri(relPath) {
  if (!relPath) return ''
  const p = plugins()
  const fs = p && p.Filesystem
  if (fs && typeof fs.getUri === 'function') {
    try {
      const r = await fs.getUri({ directory: LECTURE_DIR, path: String(relPath) })
      const uri = r && r.uri
      if (uri) return fileUri(uri)
    } catch {
      /* 拿不到权威路径就退回原样转换，由播放环节报错 */
    }
  }
  return fileUri(relPath)
}

/* 探测录音文件是否真在盘上（试听失败时用来区分「文件丢了」和「文件在但放不出」） */
export async function statClip(relPath) {
  const p = plugins()
  const fs = p && p.Filesystem
  if (!fs || typeof fs.stat !== 'function') return { ok: false, unsupported: true }
  try {
    const r = await fs.stat({ directory: LECTURE_DIR, path: String(relPath) })
    return { ok: true, size: Number(r && r.size) || 0 }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/* 删除已落盘的录音文件（删除场次时调用）。
   文件可能已被系统清理（deleteFile 抛 not found），这里如实报回 ok:false，
   由调用方决定提示措辞——不许在这里静默吞掉。 */
export async function deleteClipFile(relPath) {
  const p = plugins()
  const fs = p && p.Filesystem
  if (!fs || typeof fs.deleteFile !== 'function') return { ok: false, error: NOT_APP }
  try {
    await fs.deleteFile({ directory: LECTURE_DIR, path: String(relPath) })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/* 插件错误码 → 中文提示（就近展示用） */
function errText(err) {
  const code = String((err && (err.code || err.message)) || '')
  const MAP = {
    MISSING_PERMISSION: '没有麦克风权限：请在系统设置里允许本应用使用麦克风。',
    DEVICE_CANNOT_VOICE_RECORD: '这台设备不支持录音。',
    ALREADY_RECORDING: '已经有一场录音在进行中。',
    MICROPHONE_BEING_USED: '麦克风被其他应用占用了，关掉它再试。',
    FAILED_TO_RECORD: '录音启动失败，请重试。',
    RECORDING_HAS_NOT_STARTED: '当前没有正在进行的录音。',
    EMPTY_RECORDING: '录音时间太短，没有留下内容。',
    FAILED_TO_FETCH_RECORDING: '读取录音文件失败。',
    COULD_NOT_QUERY_PERMISSION_STATUS: '查询麦克风权限失败。',
  }
  for (const k in MAP) if (code.indexOf(k) !== -1) return MAP[k]
  return '录音出错：' + (code || '未知错误')
}

const NOT_APP = '课堂录音需在 App 内使用（当前环境没有录音能力）。'

/* 权限准备：能录 → 有权限直接用，没有就先申请；返回 { ok, error } */
export async function ensureMicPermission() {
  if (!recorderAvailable()) return { ok: false, error: NOT_APP }
  const vr = plugins().VoiceRecorder
  try {
    const can = await vr.canDeviceVoiceRecord()
    if (!can || can.value !== true) return { ok: false, error: '这台设备不支持录音。' }
    const has = await vr.hasAudioRecordingPermission()
    if (has && has.value === true) return { ok: true }
    const req = await vr.requestAudioRecordingPermission()
    if (req && req.value === true) return { ok: true }
    return { ok: false, error: '麦克风权限被拒绝：请在系统设置里允许本应用使用麦克风。' }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/* 开始录音：文件直接落应用私有目录（DATA = getFilesDir()，
   免存储权限、不进相册、随 App 卸载清理），stop 时拿到文件路径而非 base64。 */
export async function startRecording() {
  if (!recorderAvailable()) return { ok: false, error: NOT_APP }
  try {
    await plugins().VoiceRecorder.startRecording({ directory: LECTURE_DIR, subDirectory: LECTURE_SUB_DIR })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/* 停止录音：返回 { ok, clip: { path, mime, duration_ms } } */
export async function stopRecording() {
  if (!recorderAvailable()) return { ok: false, error: NOT_APP }
  try {
    const r = await plugins().VoiceRecorder.stopRecording()
    const v = (r && r.value) || {}
    return {
      ok: true,
      clip: {
        path: v.path != null ? String(v.path) : null,
        mime: v.mimeType ? String(v.mimeType) : '',
        duration_ms: Math.max(0, Math.floor(Number(v.msDuration) || 0)),
      },
    }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/* ---------------- 录音保活（二期 M2.5）：Android 前台服务 ----------------
   为什么需要：targetSdk 35 下进程一退到后台就碰不到麦克风，锁屏几分钟录音就断。
   原生侧 RecorderService 是个 foregroundServiceType="microphone" 的前台服务，
   起录音时拉起、停录时撤下（顺带得到通知栏一条常驻通知）。

   出口约定（重要）：
   - 没有原生桥（浏览器 / 概念版网页）时返回 { ok:false, unsupported:true }，绝不抛出
   - 失败也只当「保活没生效」，不能影响录音本身——调用方对结果只做提示
   - stop 必须能在任何收尾路径上无条件调用（录音失败的 finally 里也要调） */
function recSvc() {
  const p = plugins()
  return (p && p.RecorderService) || null
}

/* 当前环境是否支持保活（App 平台 true；浏览器 false） */
export function keepAliveAvailable() {
  return !!recSvc()
}

/* 拉起保活服务；title 显示在常驻通知上（通常是场次标题） */
export async function startKeepAlive(title) {
  const b = recSvc()
  if (!b || typeof b.start !== 'function') return { ok: false, unsupported: true }
  try {
    await b.start({ title: String(title || '课堂录音') })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/* 撤下保活服务（原生侧 stop 永远成功，这里也一律不抛） */
export async function stopKeepAlive() {
  const b = recSvc()
  if (!b || typeof b.stop !== 'function') return { ok: false, unsupported: true }
  try {
    await b.stop({})
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/* 服务是否还在跑——App 启动时对账用：
   内存里没有进行中的录音、但服务还挂着（上次录音后异常退出）→ 撤掉，防幽灵通知 */
export async function keepAliveRunning() {
  const b = recSvc()
  if (!b || typeof b.isRunning !== 'function') return false
  try {
    const r = await b.isRunning({})
    return !!(r && r.running)
  } catch {
    return false
  }
}
