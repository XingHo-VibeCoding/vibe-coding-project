/* data/saveFile.js —— 把生成的文本（归档 JSON / 日历 ics / 回写 JSON）真正存到手机里。

   为什么需要它：这三处导出原来都走 `ics.js` 的 downloadText()，也就是网页那套
   `<a download>` 触发下载。桌面浏览器里能用，但 **Capacitor 的 WebView 没有下载器**——
   点下去页面以为下过了、还弹出「已导出」的文案，文件其实哪儿都没去（2026-10-17 真机实测：
   点「导出全量归档」后 /sdcard/Download 前后都是同一个文件，一个都没多）。

   做法：App 里改用现成的 @capacitor/filesystem 桥（录音、练耳早就在用，桥是通的），
   按「用户能不能找到」从好到坏依次尝试：
     1) DOCUMENTS        → 手机的「文档」目录，文件管理器里直接看得到；
     2) EXTERNAL_STORAGE → 手机「下载」目录（Android 11+ 可能因分区存储拒绝）；
     3) DATA             → App 私有目录 exports/（一定能写，但用户找起来麻烦）；
   三个都失败才退回浏览器下载。返回 { where, path } 交给界面写进回执，
   用户就知道该去哪儿找文件——比一句「已导出」有用得多。

   浏览器里没有 Capacitor.Filesystem，直接走 <a download>，行为与改前一致。 */

/* 取 Filesystem 插件；拿不到返回 null（浏览器 / 桥还没挂好） */
function filesystem() {
  const cap = typeof window !== 'undefined' ? window.Capacitor : null
  const plugins = cap && cap.Plugins
  const fs = plugins && plugins.Filesystem
  return fs && typeof fs.writeFile === 'function' ? fs : null
}

/* 浏览器兜底：Blob + <a download>（桌面能用；WebView 里点了也不会落盘，所以只在没有桥时用） */
function browserDownload(filename, text, mime) {
  const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const TARGETS = [
  { directory: 'DOCUMENTS', label: '文档' },
  { directory: 'EXTERNAL_STORAGE', path: 'Download/', label: '下载' },
  { directory: 'DATA', path: 'exports/', label: 'App 内部（exports）' },
]

/* 存一份文本文件。返回 { where, path, uri }：
     where = '文档' | '下载' | 'App 内部（exports）' | 'browser'
   调用方把这个 where 拼进回执，别再说「已导出」了事。 */
export async function saveTextFile(filename, text, mime) {
  const fs = filesystem()
  if (!fs) {
    browserDownload(filename, text, mime)
    return { where: 'browser', path: filename, uri: null }
  }
  for (const t of TARGETS) {
    const rel = (t.path || '') + filename
    try {
      await fs.writeFile({ path: rel, data: text, directory: t.directory, encoding: 'utf8', recursive: true })
      let uri = null
      try { const r = await fs.getUri({ path: rel, directory: t.directory }); uri = (r && r.uri) || null } catch (e) { /* 取不到 URI 不影响文件已写成 */ }
      return { where: t.label, path: rel, uri }
    } catch (e) {
      /* 这个目录写不进去（分区存储 / 权限 / 目录不存在）→ 试下一个 */
    }
  }
  browserDownload(filename, text, mime)
  return { where: 'browser', path: filename, uri: null }
}
