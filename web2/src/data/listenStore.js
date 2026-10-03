/* web2 碎片练耳「文件落盘」出口（四期 Day 18 Step 7：真机路径）
   —— 与 listen.js 的分工：
        listen.js   纯逻辑 + localStorage（不碰 DOM、不碰插件，node 可单测）
        listenStore.js  平台桥：把音频字节写进应用私有目录 / 解析成可播地址
   口径（TECH_DESIGN §3.5）：
     - 记录里的 `file` 只存**文件名**（如 abc.mp3），不是完整路径；
       真机上的实际路径 = `listen/<file>`，目录是 Capacitor 的 Directory.Data
       （= 应用私有目录 getFilesDir()，同课堂录音 recorder.js 的 LECTURE_DIR='DATA'）。
     - 文件名与路径分开存，好处：换设备/换壳（浏览器 ↔ App）时记录不用迁移，
       路径前缀由本文件按平台拼。
     - 浏览器没有 Filesystem 插件 → 这些函数如实返回「不是 App」，由调用方
       决定降级文案（当前：提示"刷新后要重新导入"，次数与排期仍保留）。
   本文件不依赖 listen.js 的纯逻辑，也不写 localStorage。 */

import { LISTEN_DIR, LISTEN_SUB_DIR, audioMimeOf } from './listen.js'

const NOT_APP = '这个能力要在 App 里用（当前环境没有本机文件能力）。'

/* 取 Filesystem 插件；拿不到返回 null（浏览器 / 桥未挂好） */
function fsPlugin() {
  const c = typeof window !== 'undefined' ? window.Capacitor : null
  const p = c && c.Plugins ? c.Plugins : null
  const fs = p ? p.Filesystem : null
  return fs && typeof fs.writeFile === 'function' ? { fs, cap: c } : null
}

/* 当前环境能不能落盘（App 外壳已挂 Filesystem 插件） */
export function listenFSAvailable() {
  return !!fsPlugin()
}

/* 记录里的 file（纯文件名）→ 本机相对路径 */
export function clipRelPath(fileName) {
  return LISTEN_SUB_DIR + '/' + String(fileName || '').replace(/^.*[\\/]/, '')
}

/* 浏览器侧：File → base64（去掉 dataURL 前缀）。
   真机 WebView 里同样可用（FileReader 是 Web 标准，与插件无关）。 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') return reject(new Error('当前环境不支持读取文件'))
    const fr = new FileReader()
    fr.onload = () => {
      const s = String(fr.result || '')
      const i = s.indexOf(',')
      resolve(i >= 0 ? s.slice(i + 1) : s)
    }
    fr.onerror = () => reject(fr.error || new Error('读取文件失败'))
    fr.readAsDataURL(file)
  })
}

/* 把音频字节写进应用私有目录：listen/<fileName>
   返回 { ok, path } / { ok:false, error }——错误如实报回，不静默吞掉。 */
export async function writeClipBytes(fileName, base64) {
  const hit = fsPlugin()
  if (!hit) return { ok: false, error: NOT_APP }
  const { fs } = hit
  const path = clipRelPath(fileName)
  if (!String(fileName || '').trim()) return { ok: false, error: '文件名为空，没法落盘。' }
  try {
    /* 子目录不存在时先建（已存在会抛，忽略即可）；mkdir 不是所有版本都有，做个能力判断 */
    if (typeof fs.mkdir === 'function') {
      try {
        await fs.mkdir({ directory: LISTEN_DIR, path: LISTEN_SUB_DIR, recursive: true })
      } catch { /* 目录已存在：正常情况 */ }
    }
    /* ⚠️ 这里**故意不传 encoding**（2026-10-03 真机实测踩坑）：
       插件定义 WriteFileOptions.encoding 写的是
         "The encoding to write the file in. If not provided, data is written as base64 encoded.
          Pass Encoding.UTF8 to write data as string"
       —— 即「不传 = 按 base64 解码后写二进制；传了 = 当字符串写」。
       Encoding 枚举只有 utf8/ascii/utf16，**根本没有 base64 这个值**；
       我曾传 encoding:'base64'，结果整段 base64 文本被原样写成文件
       （大小正好是原字节的 4/3，被导入后的回读核对当场抓出来）。
       所以：写二进制一律不传 encoding。 */
    await fs.writeFile({
      directory: LISTEN_DIR,
      path,
      data: String(base64 || ''),
      recursive: true,
    })
    return { ok: true, path }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/* 解析成 <audio> 能播的地址：file:///... → Capacitor.convertFileSrc → https://localhost/_capacitor_file_/...
   （同 recorder.js 的 resolvePlayableUri 链路，两个能力共用一套口径） */
export async function resolveListenUri(fileName) {
  const hit = fsPlugin()
  if (!hit) return { ok: false, error: NOT_APP }
  const { fs, cap } = hit
  if (typeof fs.getUri !== 'function') return { ok: false, error: '本机文件能力不完整（缺 getUri），换个版本的 App 再试。' }
  try {
    const r = await fs.getUri({ directory: LISTEN_DIR, path: clipRelPath(fileName) })
    const raw = r && r.uri ? String(r.uri) : ''
    if (!raw) return { ok: false, error: '拿不到音频地址。' }
    const src = cap && typeof cap.convertFileSrc === 'function' ? cap.convertFileSrc(raw) : raw
    return { ok: true, uri: src, raw }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/* ---- 真机播放：读盘 → Blob URL（2026-10-03 真机实测后的主路径）----
   为什么不用 file:// / convertFileSrc：真机上 <audio> 去加载 _capacitor_file_ 地址会报
   "Failed to load because no supported source was found."（MediaError）；而导入时读时长走的是
   URL.createObjectURL(File) 那条路，是通的 —— 所以播放也改成「读字节、自己造 Blob」，
   与能用的那条解码路径对齐，绕开 WebView 的本地文件 URL 方案。
   代价：整段读进内存。产品形态是 20s–1min 的短音频（单文件上限 20MB），这个代价可以接受。 */
export async function readClipBase64(fileName) {
  const hit = fsPlugin()
  if (!hit) return { ok: false, error: NOT_APP }
  const { fs } = hit
  if (typeof fs.readFile !== 'function') return { ok: false, error: '本机文件能力不完整（缺 readFile），换个版本的 App 再试。' }
  try {
    /* 同样**不传 encoding**：定义写 "The encoding to read the file in, if not provided,
       data is read as binary and returned as base64 encoded."（传了 = 当字符串读） */
    const r = await fs.readFile({ directory: LISTEN_DIR, path: clipRelPath(fileName) })
    const b64 = r && r.data ? String(r.data) : ''
    if (!b64) return { ok: false, error: '本机上的音频是 0 字节（当初没写进去），重新导入一次。' }
    return { ok: true, base64: b64 }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/* base64 → 带正确 MIME 的 Blob URL。调用方负责在换源/删除时 URL.revokeObjectURL */
export async function makeClipBlobUrl(fileName) {
  const r = await readClipBase64(fileName)
  if (!r || !r.ok) return r || { ok: false, error: '读不到音频。' }
  try {
    const bin = atob(r.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], { type: audioMimeOf(fileName) })
    return { ok: true, url: URL.createObjectURL(blob), bytes: bytes.length }
  } catch (e) {
    return { ok: false, error: '音频解码失败：' + (e && e.message ? e.message : String(e)) }
  }
}

/* 探测音频是否真在盘上、多大（导入落盘后核对写入是否完整；与 recorder.statClip 同口径） */
export async function statClipFile(fileName) {
  const hit = fsPlugin()
  if (!hit) return { ok: false, error: NOT_APP }
  const { fs } = hit
  if (typeof fs.stat !== 'function') return { ok: false, unsupported: true }
  try {
    const r = await fs.stat({ directory: LISTEN_DIR, path: clipRelPath(fileName) })
    return { ok: true, size: Number(r && r.size) || 0 }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/* 删除已落盘的音频（删除记录时调用）。文件可能已被系统清理，如实报 ok:false */
export async function removeClipFile(fileName) {
  const hit = fsPlugin()
  if (!hit) return { ok: false, error: NOT_APP }
  try {
    await hit.fs.deleteFile({ directory: LISTEN_DIR, path: clipRelPath(fileName) })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/* 插件错误码 → 中文（就近展示用；不认识的码原样带出，别编） */
function errText(err) {
  const code = String((err && (err.code || err.message)) || '')
  const MAP = {
    NOT_FOUND: '本机上找不到这个音频文件。',
    FILE_NOT_FOUND: '本机上找不到这个音频文件。',
    NOT_READABLE: '音频文件读不了（可能被系统清理了）。',
    PERMISSION_DENIED: '没有读写本机文件的权限。',
    MISSING_PERMISSION: '没有读写本机文件的权限。',
    FILE_EXISTS: '同名文件已存在。',
    'No space left on device': '设备存储空间不足。',
  }
  for (const k in MAP) if (code.indexOf(k) !== -1) return MAP[k]
  return '本机文件操作失败：' + (code || '未知错误')
}
