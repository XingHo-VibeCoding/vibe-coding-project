/* M2 第 3 步 / 第 4 步：recorder.js 单元测试（假 Capacitor 插件注入）
   跑法：node tmp/m2-recorder-unit.mjs
   第 4 步新增：resolvePlayableUri（相对路径 → Filesystem.getUri → convertFileSrc）与 statClip 探测。 */
globalThis.window = globalThis
let pass = 0, fail = 0
const t = (name, cond) => { if (cond) { pass++; console.log('PASS  ' + name) } else { fail++; console.log('FAIL  ' + name) } }

const R = await import('../src/data/recorder.js')

/* ---- 场景 1：浏览器环境（无 Capacitor） ---- */
t('1.1 无插件时 recorderAvailable() = false', R.recorderAvailable() === false)
t('1.2 无插件时 startRecording 拒绝且提示需在 App 内使用', (await R.startRecording()).ok === false && (await R.startRecording()).error.indexOf('App 内使用') !== -1)
t('1.3 无插件时 fileUri 原样返回路径', R.fileUri('/data/x.mp3') === '/data/x.mp3')
t('1.4 无插件时 resolvePlayableUri 原样返回（由界面提示需在 App 内使用）', (await R.resolvePlayableUri('lectures/x.aac')) === 'lectures/x.aac')
t('1.5 无插件时 statClip 报不支持而非抛错', (await R.statClip('lectures/x.aac')).unsupported === true)

/* ---- 场景 2：App 环境（注入假插件，convertFileSrc 复刻 native-bridge 真实分支） ---- */
let calls = []
let statReply = { size: 20480 }
let statThrows = false
const fakeConvert = (p) => {
  if (typeof p === 'string') {
    if (p.startsWith('/')) return 'https://localhost/_capacitor_file_' + p
    if (p.startsWith('file://')) return 'https://localhost' + p.replace('file://', '/_capacitor_file_')
  }
  return p
}
window.Capacitor = {
  isNativePlatform: () => true,
  convertFileSrc: fakeConvert,
  Plugins: {
    VoiceRecorder: {
      canDeviceVoiceRecord: async () => ({ value: true }),
      hasAudioRecordingPermission: async () => ({ value: true }),
      requestAudioRecordingPermission: async () => ({ value: true }),
      startRecording: async (opts) => { calls.push(['start', opts]); return { value: true } },
      /* 真实插件返回的是「相对路径」：subDirectory/文件名，不带 file:// 也不以 / 开头 */
      stopRecording: async () => { calls.push(['stop']); return { value: { path: 'lectures/rec_1.aac', mimeType: 'audio/aac', msDuration: 123456 } } },
    },
    Filesystem: {
      getUri: async ({ directory, path }) => {
        calls.push(['getUri', directory, path])
        return { uri: `file:///data/user/0/app/files/${path}` }
      },
      stat: async ({ path }) => {
        if (statThrows) throw { code: 'NOT_FOUND' }
        return { size: statReply.size }
      },
    },
  },
}
t('2.1 有插件时 recorderAvailable() = true', R.recorderAvailable() === true)
t('2.2 fileUri 走 convertFileSrc', R.fileUri('/data/x.mp3').indexOf('_capacitor_file_') !== -1)

const perm = await R.ensureMicPermission()
t('2.3 已有权限时 ensureMicPermission 通过且不重复申请', perm.ok === true)

const st = await R.startRecording()
t('2.4 开始录音成功', st.ok === true)
t('2.5 开始录音传了私有目录 DATA + lectures 子目录', JSON.stringify(calls[0][1]) === JSON.stringify({ directory: 'DATA', subDirectory: 'lectures' }))

const sp = await R.stopRecording()
t('2.6 停止录音返回相对路径而非 base64', sp.ok === true && sp.clip.path === 'lectures/rec_1.aac')
t('2.7 时长与格式解析正确', sp.clip.duration_ms === 123456 && sp.clip.mime === 'audio/aac')

/* ---- 场景 3：试听 URL 解析（第 4 步修复的核心） ---- */
const playUrl = await R.resolvePlayableUri('lectures/rec_1.aac')
t('3.1 相对路径经 Filesystem.getUri 拿到权威 file:// URI', calls.some((c) => c[0] === 'getUri' && c[1] === 'DATA' && c[2] === 'lectures/rec_1.aac'))
t('3.2 最终得到 WebView 可播 URL（_capacitor_file_ + 绝对路径）',
  playUrl === 'https://localhost/_capacitor_file_/data/user/0/app/files/lectures/rec_1.aac')
t('3.3 空路径返回空串（不误触插件）', (await R.resolvePlayableUri('')) === '')

const savedFs = window.Capacitor.Plugins.Filesystem
delete window.Capacitor.Plugins.Filesystem
const degraded = await R.resolvePlayableUri('lectures/rec_1.aac')
t('3.4 Filesystem 缺失时降级不抛错（返回原样路径）', degraded === 'lectures/rec_1.aac')
t('3.5 Filesystem 缺失时 statClip 报不支持', (await R.statClip('lectures/rec_1.aac')).unsupported === true)
window.Capacitor.Plugins.Filesystem = savedFs

const okStat = await R.statClip('lectures/rec_1.aac')
t('3.6 statClip 正常返回文件大小', okStat.ok === true && okStat.size === 20480)
statThrows = true
const badStat = await R.statClip('lectures/gone.aac')
t('3.7 文件不存在时 statClip 返回 ok=false 且带原因', badStat.ok === false && badStat.error.indexOf('NOT_FOUND') !== -1)
statThrows = false

/* ---- 场景 4：权限被拒 / 错误码映射 ---- */
window.Capacitor.Plugins.VoiceRecorder.hasAudioRecordingPermission = async () => ({ value: false })
window.Capacitor.Plugins.VoiceRecorder.requestAudioRecordingPermission = async () => ({ value: false })
const denied = await R.ensureMicPermission()
t('4.1 权限被拒时给出中文指引', denied.ok === false && denied.error.indexOf('系统设置') !== -1)

window.Capacitor.Plugins.VoiceRecorder.requestAudioRecordingPermission = async () => ({ value: true })
window.Capacitor.Plugins.VoiceRecorder.startRecording = async () => { throw { code: 'MICROPHONE_BEING_USED' } }
const busy = await R.startRecording()
t('4.2 麦克风被占用错误码映射成中文', busy.ok === false && busy.error.indexOf('占用了') !== -1)

window.Capacitor.Plugins.VoiceRecorder.stopRecording = async () => { throw { code: 'EMPTY_RECORDING' } }
const empty = await R.stopRecording()
t('4.3 录音太短错误码映射成中文', empty.ok === false && empty.error.indexOf('太短') !== -1)

window.Capacitor.Plugins.VoiceRecorder.canDeviceVoiceRecord = async () => ({ value: false })
t('4.4 设备不支持时提前拦下', (await R.ensureMicPermission()).ok === false)

/* ---- 场景 5：未知错误兜底 ---- */
window.Capacitor.Plugins.VoiceRecorder.canDeviceVoiceRecord = async () => ({ value: true })
window.Capacitor.Plugins.VoiceRecorder.startRecording = async () => { throw { code: 'SOMETHING_NEW' } }
const unknown = await R.startRecording()
t('5.1 未知错误码兜底含原始码，不吞信息', unknown.ok === false && unknown.error.indexOf('SOMETHING_NEW') !== -1)

console.log('\n结果：' + pass + ' 过，' + fail + ' 挂')
process.exit(fail ? 1 : 0)
