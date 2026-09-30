<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { loadDataset, importFromText, clearImport, matchWeek, minOf, addCourse, removeCourse, updateCourse, updateImportedCourse, removeImportedCourse, patchMockCourse, removeMockCourse, findConflicts, exportImportedText, addTodo, patchTodo, removeTodoById, addEvent, periodsOf, createManualSemester, updateImportedSemester, LECTURES_KEY, loadLectures, addLecture, updateLecture, removeLecture, setLectureSummary, HABITS_KEY, loadHabits, addHabit, removeHabit, toggleHabitRecord, streakOf, todayKeyOf } from './data/store.js'
import { normalizeSegs, segmentView, reperiodAll, shiftWithinSegment, addPeriodToSegment, removePeriodAt } from './data/periods.js'
import { recorderAvailable, ensureMicPermission, startRecording as recStart, stopRecording as recStop, resolvePlayableUri, statClip, deleteClipFile, startKeepAlive, stopKeepAlive, keepAliveRunning } from './data/recorder.js'
import { transcriberAvailable, modelState, ensureModel, transcribeLecture } from './data/transcriber.js'
import { loadLlmConfig, saveLlmConfig, summarizeTranscript, summarizerAvailable, testConnection, DEEPSEEK_MODELS } from './data/summarizer.js'
import { compressImageForRecognize, recognizeScheduleImage, recognizerAvailable } from './data/recognizer.js'
import { buildIcs, downloadText } from './data/ics.js'
import { notifyAvailable, loadNotifySettings, saveNotifySettings, ensureNotifyEnv, buildScheduleItems, applySchedule, notifyDone, testNotify, onNotificationAction } from './data/notify.js'
import MonthCalendar from './components/MonthCalendar.vue'
import NumberWheel from './components/NumberWheel.vue'
import TimeWheel from './components/TimeWheel.vue'
import DropdownSelect from './components/DropdownSelect.vue'
import PeriodsEditor from './components/PeriodsEditor.vue'

const tab = ref('today')

/* ---------------- 底部导航切换（Day 11 二轮：滑块 + 平移 + 可打断） ----------------
   滑块与内容层都是 CSS transition：快速连点时 transform 直接改道新目标，从当前位置
   平滑续走——动画天然可打断，不需要锁定和「切换中」提示；bounce 用 WAAPI 重触发，
   新动画自动覆盖旧动画，同样可打断。全部前端临时状态，不接数据库。 */
const TAB_KEYS = ['today', 'week', 'me']
const tabIndex = computed(() => TAB_KEYS.indexOf(tab.value))
/* 时序编排（用户反馈：header 收缩与内容平移同时发生=斜向甩感）：
   进入今日 → header 先展开腾位（0ms），平移延迟 140ms 再滑回；
   离开今日 → 平移先行（0ms），header 延迟 150ms 等滑走大半再收缩。
   每段运动单方向，折线代替斜线。 */
const enterToday = ref(false)
function switchTab(key) {
  if (key === tab.value) return // 幂等：重复点当前 tab
  enterToday.value = key === 'today'
  tab.value = key
  window.scrollTo({ top: 0 }) // 平移后立即回顶，避免落在长页的空白处
  const svg = document.querySelectorAll('nav button svg')[TAB_KEYS.indexOf(key)]
  svg && svg.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.28)', offset: 0.4 }, { transform: 'scale(1)' }],
    { duration: 300, easing: 'ease' }
  )
}

/* ---------------- 页高自适应 ----------------
   三页并排常驻后，平移层高度会被最高的周课表撑起，今日/我的下面拖出一大段
   可滚动空白。解法：items-start 让各页保持自然高度，JS 量当前页高度赋给平移层，
   height 过渡与滑动同步；ResizeObserver 兜住数据增删引起的高度变化。 */
const stripRef = ref(null)
const stripH = ref(0)
function measureStrip() {
  const el = stripRef.value
  if (!el) return
  const page = el.children[tabIndex.value]
  if (page) stripH.value = page.offsetHeight
}
watch(tabIndex, () => nextTick(measureStrip))
onMounted(() => {
  measureStrip()
  const ro = new ResizeObserver(() => measureStrip())
  if (stripRef.value) for (const page of stripRef.value.children) ro.observe(page)
  refreshLectures() // 录音场次列表（二期 M2）
  // 转写中途被杀（重启/冻结后杀进程）的场次回退「待转写」——
  // 状态机不允许 transcribing 重进，不回退就永远没有转写按钮（真机实证）
  let stuckTr = false
  for (const lec of lectures.value) {
    if (lec.status === 'transcribing') {
      updateLecture(lec.id, { status: 'recording' })
      stuckTr = true
    }
  }
  if (stuckTr) refreshLectures()
  trSupported.value = transcriberAvailable() // 重算：App 手工桥此时必已挂好
  reconcileKeepAlive() // M2.5：清掉上次异常退出残留的保活通知
  initNotify() // M5：通知渠道/权限 + 首次排程 + action 监听（异步，不阻塞首屏）
  initBackButton() // Android 返回键分级处理（App 内生效；浏览器无桥不注册）
})

/* ---------------- Android 返回键分级处理（@capacitor/app，官方插件自动注册进桥） ----------------
   从上到下找第一件「有的事」做，都没有才退出：picker → 确认层 → 表单/详情 → 回今日页 → exitApp。
   引导页不拦（必经流程）；浏览器无桥，行为零变化。 */
const APP_PLUGIN =
  (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) || null
const backHint = ref('') // 「再按一次返回键退出」提示条（v1.17）
function closeTopmostLayer() {
  if (picker.value) { picker.value = null; return true }
  if (confirmClear.value) { confirmClear.value = false; return true }
  if (delLecId.value) { delLecId.value = null; return true }
  if (semForm.value) { semForm.value = null; return true }
  if (onboarding.value && recFromMine.value) { mineRecCancel(); return true } // mine 识别流程当弹层对待；纯引导页不拦（v1.16 口径）
  if (onboarding.value && !recFromMine.value && onboardStep.value === 'periods') { backObForm(); return true } // 课程时间设置二级页：返回先回上一级，不直接退（2026-09-30 用户反馈）
  if (detail.value) { detail.value = null; return true }
  if (addForm.value) { addForm.value = null; return true }
  if (todoForm.value) { todoForm.value = null; return true }
  if (evtForm.value) { evtForm.value = null; return true }
  return false
}
let lastBackTs = 0 // 上次「退出预备」按返回的时间戳（2 秒内再按才真退）
let backHintTimer = null
function initBackButton() {
  if (!APP_PLUGIN || !APP_PLUGIN.addListener) return
  APP_PLUGIN.addListener('backButton', () => {
    window.dispatchEvent(new Event('web2:dd-close')) // 开着的下拉先收起（组件自己监听）
    if (closeTopmostLayer()) return
    if (tab.value !== 'today') { switchTab('today'); return }
    const now = Date.now()
    if (now - lastBackTs < 2000) { backHint.value = ''; APP_PLUGIN.exitApp(); return }
    lastBackTs = now
    backHint.value = '再按一次返回键退出'
    clearTimeout(backHintTimer)
    backHintTimer = setTimeout(() => { backHint.value = '' }, 2000)
  })
}

/* ---------------- 共享 picker 弹层（日期月历 / 时间滚轮 / 数字滚轮） ---------------- */
const picker = ref(null) // { type:'date'|'time'|'number', value, restrictMonday, min, max, step, unit, title, onDone }
const pickerRef = ref(null)
function openDateField(opt) {
  picker.value = { type: 'date', value: opt.value || '', restrictMonday: !!opt.restrictMonday, onDone: opt.onDone }
}
function openTimeField(opt) {
  picker.value = { type: 'time', value: opt.value || '', onDone: opt.onDone }
}
function openNumberField(opt) {
  picker.value = {
    type: 'number', value: Number(opt.value) || opt.min || 0,
    min: opt.min, max: opt.max, step: opt.step || 1, unit: opt.unit || '',
    title: opt.title || '选择数值', onDone: opt.onDone,
  }
}
function pickerConfirm() {
  const p = picker.value
  if (!p) return
  let v
  if (p.type === 'date') v = p.value
  else if (p.type === 'number') v = pickerRef.value ? Number(pickerRef.value.value) : p.value
  else v = pickerRef.value ? pickerRef.value.display : p.value
  picker.value = null
  p.onDone(v)
}

/* ---------------- 数据集（示例 or 主项目导入） ---------------- */
const initial = loadDataset()
const source = ref(initial.source)
const semester = ref(initial.semester)
const weekAll = ref(initial.courses)   // 整周课程（type: course）
const events = ref(initial.events)     // 独立日程（type: event，有日期）
const importMsg = ref('')

function reloadDataset() {
  const d = loadDataset()
  source.value = d.source
  semester.value = d.semester
  weekAll.value = d.courses
  events.value = d.events
  todos.value = d.todos.map((t) => ({ ...t }))
  /* 导入/恢复示例会整体接管（或保留）lectures/habits 落盘，界面 ref 必须跟着重取——
     之前只在页面初始化时刷新，导入带录音场次/打卡记录的文件后列表不更新（测试抓出） */
  refreshLectures()
  reloadHabits()
}

function onImportFile(e, opts) {
  const file = e.target.files && e.target.files[0]
  e.target.value = '' // 允许重复选同一文件
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const d = importFromText(String(reader.result))
      importMsg.value = ''
      reloadDataset()
      importMsg.value = `导入成功：${d.semester.name} · ${d.courses.length} 门课 · ${d.todos.length} 条待办`
      if (opts && opts.onSuccess) opts.onSuccess() // 校验通过才收尾（引导页场景：此刻才关引导层）
    } catch (err) {
      // JSON 语法错（选了图片/文本等非 JSON 文件）换成产品文案；其余透传原始消息（如「缺少学期信息」）
      const friendly = err instanceof SyntaxError ? '这不是 JSON 文件，请选主项目「导出/备份」生成的文件' : null
      const msg = '导入失败：' + (friendly || (err && err.message) || '文件内容不对。')
      if (opts && opts.fromOnboard) obImportMsg.value = msg // 引导页场景：留在引导页就地报错，不放行
      else importMsg.value = msg
    }
  }
  reader.readAsText(file)
}

function onClearImport() {
  clearImport()
  importMsg.value = ''
  reloadDataset()
}

/* ---------------- 课前提醒 + 完成通知（二期 M5，App 平台专属） ----------------
   排程口径：App 启动 / 课表变动 / 设置变动时幂等重排未来 7 天。
   课程按 weekday + week_rule + 学期周次展开，独立日程按具体日期；提前量默认 10 分钟。
   通知点按/action 回来 → 定位到「我的」页；action「开始录音」直接开录（复用 startRec）。
   完成通知只在 App 切到后台时发（前台有就地提示，不再打扰）。 */
const notifySettings = ref(loadNotifySettings())
const notifyPerm = ref(null) // true=已授予 false=被拒 null=未知
const notifyOk = notifyAvailable() // 模块求值时探测（官方插件的桥由 cap sync 注册，时机可靠）
const notifyTesting = ref(false)
const notifyMsg = ref('')
const notifyMsgBad = ref(false)

function goMeTab() {
  if (tab.value !== 'me') switchTab('me')
}

async function applyNotifySchedule() {
  if (!notifyOk) return
  const items = buildScheduleItems({
    courses: weekAll.value,
    events: events.value,
    semester: semester.value,
    settings: notifySettings.value,
  })
  await applySchedule(items)
}

function toggleNotify() {
  if (!notifyOk) return
  notifySettings.value = saveNotifySettings({ enabled: !notifySettings.value.enabled })
}

function setNotifyLead(m) {
  if (!notifyOk || notifySettings.value.minutesBefore === m) return
  notifySettings.value = saveNotifySettings({ minutesBefore: m })
}

async function onTestNotify() {
  if (!notifyOk || notifyTesting.value) return
  notifyTesting.value = true
  const r = await testNotify()
  notifyTesting.value = false
  notifyMsg.value = r.ok
    ? '已发出，几秒后看通知栏，点「开始录音」试试直接开录。'
    : r.unsupported
      ? '当前环境不支持通知（仅 App 内可用）。'
      : '发送失败：' + (r.error || '未知错误')
  notifyMsgBad.value = !r.ok
}

/* 课表 / 设置变动 → 重排（saveNotifySettings 返回新对象，引用变化即触发） */
watch([weekAll, events, semester], () => { applyNotifySchedule() })
watch(notifySettings, () => { applyNotifySchedule() })

async function initNotify() {
  if (!notifyOk) return
  const env = await ensureNotifyEnv()
  notifyPerm.value = env.granted === undefined ? null : !!env.granted
  onNotificationAction(({ actionId }) => {
    goMeTab()
    if (actionId === 'START_REC') startRec() // 幂等：已在录音则 startRec 直接 return
  })
  await applyNotifySchedule()
}

/* ---------------- 初始设定引导页（差距⑦） ----------------
   首次打开（没有导入数据、也没做过选择）出现，二选一：
   先用示例逛逛 / 导入主项目数据。选过一次就记 web2.onboarded，不再打扰；
   老用户已有数据但没标记的也不弹（尊重现状）。 */
const ONBOARD_KEY = 'web2.onboarded'
const onboarding = ref(!localStorage.getItem(ONBOARD_KEY) && !localStorage.getItem('web2.data'))
/* 引导流程三步（用户反馈：节次表被跳过 + 识别要单独一页）：
   1 form 学期信息 + 节次表 → 2 rec 识别课表（页内回显「本次换算用的节次表」）→ 3 recConfirm 核对导入。
   choice 是第 0 步（三选一入口）。 */
const onboardStep = ref('choice') // choice | form | rec | recConfirm
const OB_STEP_LABELS = ['学期与节次', '识别课表', '核对导入']
const onboardStepNo = computed(() => ({ choice: 0, form: 1, periods: 1, rec: 2, recConfirm: 3 }[onboardStep.value] || 0))
function finishOnboarding() {
  localStorage.setItem(ONBOARD_KEY, '1')
  onboarding.value = false
}

/* ---------------- 清除数据并重置（对齐主项目 Store.resetAll + confirmResetModal 口径） ----------------
   只删数据键 web2.data、录音场次 web2.lectures、打卡记录 web2.habits
   与引导标记 web2.onboarded
   （「回到初始设定」= 引导页重新出现）；主题/强调色是个性化设置，保留。
   二次确认走自建弹窗，不用原生 confirm。 */
const confirmClear = ref(false)
function doClearData() {
  localStorage.removeItem('web2.data')
  localStorage.removeItem(LECTURES_KEY)
  localStorage.removeItem(HABITS_KEY)
  localStorage.removeItem(ONBOARD_KEY)
  location.reload()
}

/* ---------------- 每日打卡（五期第 3 期 MVP，入口「我的」页） ----------------
   数据口径见 data/store.js habits 一节：records 稀疏日期键，取消 = 删键。
   本周 7 格按「周一起始」（口径同主项目日历周一列）；连续天数用 streakOf
   （今天没打时从昨天回溯，不断链不施压）。 */
const habits = ref([])
const habitInput = ref(false) // 添加行展开中
const habitName = ref('')
const habitToday = todayKeyOf()

function reloadHabits() {
  habits.value = loadHabits().slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
}
reloadHabits()

function addHabitConfirm() {
  const name = habitName.value.trim()
  if (!name) return
  addHabit(name)
  habitName.value = ''
  habitInput.value = false
  reloadHabits()
}

function removeHabitConfirm(id) {
  removeHabit(id)
  reloadHabits()
}

/* 两段式删除：第一次点进入待确认态，第二次点才真删；3 秒不点自动复位 */
const habitDelId = ref(null)
let habitDelTimer = null
function onHabitDelete(id) {
  if (habitDelId.value === id) {
    clearTimeout(habitDelTimer)
    habitDelId.value = null
    removeHabitConfirm(id)
    return
  }
  habitDelId.value = id
  clearTimeout(habitDelTimer)
  habitDelTimer = setTimeout(() => {
    habitDelId.value = null
  }, 3000)
}

function toggleHabit(id) {
  toggleHabitRecord(id, habitToday)
  reloadHabits()
}

/* 本周 7 天的日期键（周一起始）+ 中文单字表头 */
const habitWeek = computed(() => {
  const now = new Date()
  const wd = (now.getDay() + 6) % 7 // 周一=0…周日=6
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - wd)
  const names = ['一', '二', '三', '四', '五', '六', '日']
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i)
    return { key: todayKeyOf(d), name: names[i], isToday: todayKeyOf(d) === habitToday }
  })
})

/* ---------------- 课堂录音（二期 M2，入口 C 第一步：「我的」页独立入口） ----------------
   能力口径见 data/recorder.js：只有 App 平台能录（原生插件），浏览器环境给出就地提示。
   场次数据走 web2.lectures（data/store.js），录音文件落 App 私有目录，
   lectures.clips[].path 存插件返回的相对路径，试听时经 resolvePlayableUri
   （Filesystem.getUri → convertFileSrc）转成 WebView 可播 URL。
   状态机口径：停录后仍留在 recording（ended_at 有值 = 已录完待转写），
   M3 接入转写后再把它推进到 transcribing / summarized。 */
const lectures = ref([])
const recActiveId = ref(null) // 进行中场次的 id（内存态：App 重启即失效，未结束的场次显示「录音中断」）
const recElapsed = ref(0) // 录音中已录秒数
const recMsg = ref('')
const recMsgBad = ref(false)
const playingId = ref(null)
let recTicker = null
let audioEl = null
const recSupported = recorderAvailable()

function refreshLectures() {
  lectures.value = loadLectures().slice().sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))
}
function setRecMsg(text, bad = false) {
  recMsg.value = text
  recMsgBad.value = !!bad
}
function fmtDur(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0')
}
function fmtLecDate(iso) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '时间未知'
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function lecStatusLabel(l) {
  if (l.status === 'summarized') return '已总结'
  if (l.status === 'transcribed') return '已转写 · 待总结'
  if (l.status === 'transcribing') return '转写中'
  if (!l.ended_at) return recActiveId.value === l.id ? '录音中' : '录音中断'
  return '已录完 · 待转写'
}
function defaultLecTitle(d = new Date()) {
  return `课堂录音 ${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function tickRec() {
  const l = lectures.value.find((x) => x.id === recActiveId.value)
  if (!l) return
  recElapsed.value = Math.max(0, Math.floor((Date.now() - Date.parse(l.started_at)) / 1000))
}
async function startRec() {
  if (recActiveId.value) return
  setRecMsg('')
  const perm = await ensureMicPermission()
  if (!perm.ok) return setRecMsg(perm.error, true)
  const r = await recStart()
  if (!r.ok) return setRecMsg(r.error, true)
  const lec = addLecture({ title: defaultLecTitle() })
  recActiveId.value = lec.id
  recElapsed.value = 0
  playingId.value = null
  refreshLectures()
  clearInterval(recTicker)
  recTicker = setInterval(tickRec, 1000)
  /* M2.5 保活：拉起前台服务，锁屏/切后台不断录（通知栏一条常驻通知）。
     保活失败不影响录音——只把提示换成「先别锁屏」，照常录。 */
  const ka = await startKeepAlive(lec.title)
  if (!ka.ok && !ka.unsupported) {
    setRecMsg('录音已开始，但后台保活没起来（' + ka.error + '）——这场请先别锁屏。', true)
  } else {
    setRecMsg('录音中：锁屏、切到后台都会继续录。')
  }
}
async function stopRec() {
  const id = recActiveId.value
  if (!id) return
  let r
  try {
    r = await recStop()
  } finally {
    /* 保活必须无条件撤下（含录音失败路径）：否则通知会一直挂着，下次还得靠启动对账清 */
    await stopKeepAlive()
    clearInterval(recTicker)
    recTicker = null
    recActiveId.value = null
  }
  if (!r.ok) {
    refreshLectures()
    return setRecMsg(r.error + '（这一场已标记为录音中断）', true)
  }
  const now = new Date().toISOString()
  const res = updateLecture(id, {
    ended_at: now,
    duration_ms: r.clip.duration_ms,
    clips: [{ index: 0, path: r.clip.path, mime: r.clip.mime, duration_ms: r.clip.duration_ms, recorded_at: now }],
  })
  refreshLectures()
  if (!res.ok) return setRecMsg(res.error, true)
  if (!r.clip.path) return setRecMsg('录音已停止，但文件没有落盘（异常），这一场只留下记录。', true)
  setRecMsg(`已保存：${fmtDur(r.clip.duration_ms)} 的课堂录音。`)
}
/* M2.5 启动对账：recActiveId 是内存态，App 重启后必然为 null。
   若这时原生侧保活服务还在跑（上次录音后 App 被系统杀掉/异常退出），撤掉它，
   免得用户看到一条「正在录音」的幽灵通知却没在录。 */
async function reconcileKeepAlive() {
  if (recActiveId.value) return
  if (await keepAliveRunning()) await stopKeepAlive()
}
async function playLec(l) {
  const clip = (l.clips && l.clips[0]) || null
  if (!clip || !clip.path) return setRecMsg('这一场没有可试听的录音文件。', true)
  if (playingId.value === l.id) {
    if (audioEl) audioEl.pause()
    playingId.value = null
    return
  }
  setRecMsg('')
  playingId.value = l.id
  try {
    // 插件给的是相对路径（lectures/xxx.aac），必须经 Filesystem 取权威 file:// URI 再转 WebView URL
    const url = await resolvePlayableUri(clip.path)
    if (!audioEl) audioEl = new Audio()
    audioEl.onended = () => { playingId.value = null }
    audioEl.onerror = () => { onPlayFail(clip) }
    audioEl.src = url
    const p = audioEl.play()
    if (p && typeof p.catch === 'function') p.catch(() => {}) // 播放失败统一走 onerror，这里吞掉未处理的拒绝
  } catch (e) {
    playingId.value = null
    setRecMsg('试听失败：' + (e && e.message ? e.message : '未知错误'), true)
  }
}
/* 播放失败的就地反馈：用文件探测区分「文件丢了 / 文件是空的 / 文件在但放不出」，
   避免只报一句「打不开」——下次真机再出问题能直接看出卡在哪一环 */
async function onPlayFail(clip) {
  playingId.value = null
  const code = audioEl && audioEl.error ? audioEl.error.code : 0
  const st = await statClip(clip.path)
  if (st.ok && st.size > 0) return setRecMsg(`试听失败：文件在（${Math.round(st.size / 1024)} KB）但无法播放（错误码 ${code}）。`, true)
  if (st.ok) return setRecMsg('试听失败：录音文件是空的。', true)
  if (st.unsupported) return setRecMsg('试听失败：文件打不开。', true)
  setRecMsg('试听失败：找不到录音文件（可能已被系统清理）。', true)
}

/* ---------------- 删除场次：长按 500ms 弹自建确认层（不用原生 confirm） ----------------
   顺序：先删盘上的录音文件再删记录——记录先没了，文件路径就无从查起。
   正在转写/生成纪要的场次不许删：后台任务会往一条已不存在的记录里写。 */
const delLecId = ref(null)
const pressActiveId = ref(null) // 长按中的行：压暗反馈
let pressTimer = null
let pressPos = null
const delLec = computed(() => lectures.value.find((x) => x.id === delLecId.value) || null)

function startLecPress(l, e) {
  if (e && e.target && e.target.closest && e.target.closest('button')) return // 行内按钮有自己的事做
  if (recActiveId.value === l.id) return
  pressActiveId.value = l.id
  pressPos = { x: e.clientX, y: e.clientY }
  clearTimeout(pressTimer)
  pressTimer = setTimeout(() => {
    pressTimer = null
    pressActiveId.value = null
    delLecId.value = l.id
  }, 500)
}
function moveLecPress(e) {
  // 手指滑动 = 想滚页面不是想删：位移超 8px 就取消长按
  if (!pressTimer || !pressPos) return
  if (Math.abs(e.clientX - pressPos.x) > 8 || Math.abs(e.clientY - pressPos.y) > 8) {
    clearTimeout(pressTimer)
    pressTimer = null
    pressActiveId.value = null
  }
}
function cancelLecPress() {
  clearTimeout(pressTimer)
  pressTimer = null
  pressActiveId.value = null
}
async function doDeleteLecture() {
  const id = delLecId.value
  delLecId.value = null
  cancelLecPress()
  if (!id) return
  if (trBusyId.value === id || sumBusyId.value === id) {
    return setRecMsg('这一场正在转写/生成纪要，等它结束或先取消再删。', true)
  }
  const l = lectures.value.find((x) => x.id === id)
  if (playingId.value === id) {
    if (audioEl) audioEl.pause()
    playingId.value = null
  }
  let fileNote = ''
  if (l && Array.isArray(l.clips)) {
    let fail = 0
    for (const c of l.clips) {
      if (!c || !c.path) continue
      const r = await deleteClipFile(c.path)
      if (!r.ok) fail++
    }
    if (fail) fileNote = `（有 ${fail} 个录音文件没删掉，可能已被系统清理）`
  }
  removeLecture(id)
  if (trOpenId.value === id) trOpenId.value = null
  if (sumOpenId.value === id) sumOpenId.value = null
  refreshLectures()
  setRecMsg(`已删除「${l ? l.title : '场次'}」${fileNote}`)
}

/* ---------------- 转写（二期 M3）：场次上的「转写」按钮 → 模型下载 → 逐 clip 识别 ----------------
   首次点「转写」会先下载模型（228MB，只需一次，hf-mirror 直连）；之后每次直接识别。
   进度条由 trBusyId/trPhase/trPercent 驱动；转写跑在原生线程，界面不卡。 */
/* trSupported 不能只在模块求值时判定：App 外壳的手工桥（Transcriber 挂进
   window.Capacitor.Plugins）若晚于本模块求值完成，这里会拿到 false 并永远锁死。
   所以先取一次初值，onMounted 再重算（此时壳的桥必已挂好）。 */
const trSupported = ref(transcriberAvailable())
const trBusyId = ref(null) // 正在下载模型/转写的场次 id
const trPhase = ref('') // 'download' | 'asr'
const trPercent = ref(0)
const trLabel = ref('')
const trOpenId = ref(null) // 展开文字稿的场次 id

function fmtSize(n) {
  const mb = Number(n) / 1048576
  return mb >= 1 ? mb.toFixed(1) + 'MB' : Math.max(0, Math.round(Number(n) / 1024)) + 'KB'
}
async function startTr(l) {
  if (trBusyId.value) return
  if (!trSupported.value) return setRecMsg('转写只能在 App 内使用（浏览器不支持）。', true)
  trBusyId.value = l.id
  setRecMsg('')
  try {
    trPhase.value = 'download'
    trPercent.value = 0
    const ms = await modelState()
    if (!ms.ready) {
      trLabel.value = '准备下载模型…'
      await ensureModel((p) => {
        if (p.file === 'tokens') {
          trLabel.value = '下载词表…'
        } else {
          trPercent.value = p.percent
          trLabel.value = `下载模型 ${p.percent}%（${fmtSize(p.loaded)}${p.total ? ' / ' + fmtSize(p.total) : ''}）· 只需一次`
        }
      })
    }
    trPhase.value = 'asr'
    trPercent.value = 0
    trLabel.value = '准备识别…'
    if ((Number(l.duration_ms) || 0) > 15 * 60 * 1000) {
      setRecMsg('长录音转写约需 10–20 分钟：屏幕会保持常亮，请留在本页看进度条走完。')
    }
    await transcribeLecture(l.id, (p) => {
      // 解码/重采样是识别前的预处理，其 percent 只反映该步内部进度——
      // 直接上进度条会出现「先冲 90% 再跳回识别 50%」的假象（真机实测）。
      // 这两步只改文字提示，进度条保持 0；'asr' 才驱动百分比。
      if (p.phase === 'decode') {
        // 1 小时音频的解码要跑几分钟，百分比必须露出来（真机教训：只显示文字=看起来像卡死）
        trLabel.value = p.percent > 0 ? `解码音频 ${p.percent}%（不耗模型，快了）` : '解码音频…'
        return
      }
      if (p.phase === 'resample') {
        trLabel.value = `重采样音频 ${p.percent}%`
        return
      }
      trPercent.value = p.percent
      trLabel.value = p.clipCount > 1 ? `识别 ${p.clipIndex + 1}/${p.clipCount} 段 · ${p.percent}%` : `识别中 ${p.percent}%`
    })
    setRecMsg('转写完成，文字稿已保存。')
    notifyDone('转写完成', l.title) // App 切在后台时发完成通知（前台自动跳过）
    trOpenId.value = l.id
  } catch (e) {
    setRecMsg('转写失败：' + (e && e.message ? e.message : '未知错误') + '（可稍后重试）', true)
  } finally {
    trBusyId.value = null
    trPhase.value = ''
    trLabel.value = ''
    trPercent.value = 0
    refreshLectures()
  }
}

/* ---------------- 课堂纪要（M4-2）：转写完成的场次 → LLM 总结 → 纪要卡 ----------------
   与转写不同，纪要在浏览器里也能用（fetch 直连 LLM API，无原生依赖）。
   取消用 AbortController；生成中不允许并发第二场（sumBusyId 单值锁）。 */
const llmCfg = ref(loadLlmConfig()) // {provider,key,model}；key 只在本机
const llmInputOpen = ref(false) // 设置区展开
const PROVIDER_OPTIONS = [
  { id: '', label: '未选择' },
  { id: 'deepseek', label: 'DeepSeek（自己的 API Key）' },
  { id: 'cloud', label: '云服务托管（暂未开通）' },
]
const llmReady = computed(() => summarizerAvailable() === null)
const sumBusyId = ref(null)
const sumStage = ref('') // 'call' | 'parse'
const sumOpenId = ref(null) // 展开纪要卡的场次 id
let sumCtrl = null

function saveLlm() {
  saveLlmConfig({ provider: llmCfg.value.provider, key: llmCfg.value.key.trim(), model: llmCfg.value.model.trim() })
  llmCfg.value = loadLlmConfig()
}
function onLlmProvider() {
  saveLlm()
  llmCfg.value = loadLlmConfig() // 重算 llmReady 提示
}
function onLlmKey() {
  saveLlm()
  llmCfg.value = loadLlmConfig()
}
/* 连通性检测：填完 Key 点一下就知道通不通（不消耗余额，GET /models 只验证 Key）。
   成功后用官方返回的模型列表动态刷新下拉——静态兜底列表可能过时（deepseek-chat 就这么消失的）。 */
const llmTest = ref({ busy: false, ok: null, msg: '' })
const llmModels = ref(DEEPSEEK_MODELS)
async function testLlm() {
  if (llmTest.value.busy) return
  llmTest.value = { busy: true, ok: null, msg: '' }
  const r = await testConnection()
  if (r.ok && Array.isArray(r.models) && r.models.length) {
    llmModels.value = r.models.map((id) => ({ id, label: id }))
    if (!r.models.includes(llmCfg.value.model)) {
      llmCfg.value.model = 'deepseek-flash' // 存的旧名已下线 → 自动切到现役推荐
      saveLlm()
    }
  }
  if (r.ok && r.modelOk === false) {
    llmTest.value = { busy: false, ok: true, msg: '连接正常；但所选模型不在官方列表（' + (r.models.join('、') || '未知') + '），生成会失败，已建议重选。' }
  } else if (r.ok) {
    llmTest.value = { busy: false, ok: true, msg: '连接正常' + (r.models && r.models.length ? '，可用模型：' + r.models.join('、') : '') }
  } else {
    llmTest.value = { busy: false, ok: false, msg: r.message || '连接失败。' }
  }
}
function cancelSummary() {
  if (sumCtrl) sumCtrl.abort()
}
async function startSummary(l) {
  if (sumBusyId.value) return
  const miss = summarizerAvailable()
  if (miss) {
    setRecMsg(miss, true)
    llmInputOpen.value = true // 缺配置：顺手把设置区展开，少一次找路
    return
  }
  if (!l.transcript || String(l.transcript).trim().length < 30) {
    setRecMsg('文字稿太短，没有可总结的内容。', true)
    return
  }
  sumBusyId.value = l.id
  sumStage.value = 'call'
  setRecMsg('')
  try {
    sumCtrl = new AbortController()
    const raw = await summarizeTranscript(l.transcript, { signal: sumCtrl.signal, onStage: (s) => { sumStage.value = s } })
    setLectureSummary(l.id, raw) // 白名单整形 + 推进 summarized（store 内校验）
    sumOpenId.value = l.id
    setRecMsg('纪要已生成。')
    notifyDone('纪要已生成', l.title) // 同上：仅后台时发
  } catch (e) {
    if (e && e.name === 'AbortError') setRecMsg('已取消纪要生成。', true)
    else setRecMsg('纪要生成失败：' + (e && e.message ? e.message : '未知错误'), true)
  } finally {
    sumBusyId.value = null
    sumStage.value = ''
    refreshLectures()
  }
}

const onboardFile = ref(null)
function onboardImport() {
  onboardFile.value && onboardFile.value.click() // 引导层留在原地，选了文件才关
}
const obImportMsg = ref('') // 引导页导入失败的就地提示（对齐主项目口径：错误留在初始设定页）
function onOnboardFile(e) {
  obImportMsg.value = ''
  onImportFile(e, { fromOnboard: true, onSuccess: finishOnboarding }) // 校验通过才 finishOnboarding；失败留在引导页
}
/* ---------------- 学期信息/节次表编辑（「我的」页，仅真实数据态） ----------------
   节次表用共用组件 PeriodsEditor（分段式，引导页同一套）；分段/重排/校验的纯函数在
   data/periods.js。这里只管学期名 / 第一周周一 / 总周数与落盘。 */
const semForm = ref(null) // { name, first_monday, total_weeks, periods: [{no,start,end,seg?}] }
const semErr = ref('')
const DEFAULT_PERIODS = periodsOf({ semester: { periods: [] } }) // 默认节次表（上午5+下午5+晚上3，共13节）；引导页预填与全删回落共用

function openSemEdit() {
  const s = semester.value
  const ps = periodsOf({ semester: s })
  semForm.value = {
    name: s.name,
    first_monday: s.firstMonday || '',
    total_weeks: s.totalWeeks,
    periods: ps.map((p) => ({ ...p })),
  }
  semErr.value = ''
}
function saveSemEdit() {
  /* 保存前清洗段号：非法/残缺的 seg 会被清掉（回落按间隔自动分段），合法的压紧连续 */
  const r = updateImportedSemester({ ...semForm.value, periods: normalizeSegs(semForm.value.periods) })
  if (!r.ok) {
    semErr.value = r.error
    return
  }
  source.value = r.data.source
  semester.value = r.data.semester
  weekAll.value = r.data.courses
  events.value = r.data.events
  todos.value = r.data.todos.map((t) => ({ ...t }))
  semForm.value = null
}
/* 手动填学期：生成主项目格式空学期（同导入态），之后长按/双击周网格加课
   Day 14 重构后第 1 页只有三项（开学时间 / 周数 / 课程时间设置），学期名自动生成 */
function defaultTermName() {
  const now = new Date()
  const m = now.getMonth() + 1
  const y = now.getFullYear()
  const sy = m === 1 ? y - 1 : y
  return (m >= 9 || m <= 1) ? `${sy}-${sy + 1} 秋冬` : `${sy}-${sy + 1} 春夏`
}
function fmtDateYMD(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
const obForm = ref({ name: defaultTermName(), first_monday: '', total_weeks: 18, periods: [] })
const obErr = ref('')
/* Day 14 用户测试反馈：原第 1 页（学期名下拉 + 内嵌月历 + 周数输入 + 全量节次编辑器）
   文字、按钮、功能太多，第一次来的人「看起来很复杂，不会用」。
   重构为三项 + 二级页：开学时间（弹层月历随便选，内部归一到所在周周一）、
   本学期周数（数字滚轮）、课程时间设置（二级页：单节时长/课间滚轮 + 上午/下午/晚上三块）。
   学期名自动生成，「我的」页 ✎ 随时可改。 */
function goObForm() {
  obErr.value = ''
  obRecErr.value = ''
  recPreview.value = null // 重新走一遍 = 干净开始（识别结果不跨轮残留）
  /* 2026-09-30 用户反馈「分了 4 个时间段」：根因是派生分段（相邻间隔 >15 分钟自动裂开），
     手动把某节改晚后上午被拆成两段。初始就固化显式 seg（上午5/下午5/晚上3），
     segmentView 走显式分支 → 固定三块，改时间/时长/加节都不裂（tmp/seg4-repro-check.mjs 实证） */
  obForm.value = {
    name: defaultTermName(),
    first_monday: '',
    total_weeks: 18,
    periods: DEFAULT_PERIODS.map((p, i) => ({ ...p, seg: i < 5 ? 1 : i < 10 ? 2 : 3 })),
  }
  obGlobal.value = { dur: 45, gap: 10 } // 二级页两个滚轮跟着回到默认
  obPageDir.value = 'obpage-fwd' // 从入口页进来，方向归位
  onboardStep.value = 'form'
}
/* 课程时间设置二级页的进/出：记录方向（决定滑动动画方向），「完成」按钮与返回键都走 backObForm */
const obPageDir = ref('obpage-fwd')
function goObPeriods() {
  obPageDir.value = 'obpage-fwd'
  onboardStep.value = 'periods'
}
function backObForm() {
  obPageDir.value = 'obpage-bak'
  onboardStep.value = 'form'
}
/* 开学时间：弹层月历任意日期可点；内部归一到所选日期所在周的周一（「第几周」口径不变，
   导出到主项目的 first_monday 永远是合法周一） */
function obPickStart() {
  openDateField({
    value: obForm.value.first_monday,
    onDone: (v) => {
      if (!v) return
      const d = new Date(v + 'T00:00:00')
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // 回到所在周周一
      obForm.value.first_monday = fmtDateYMD(d)
      obErr.value = ''
    },
  })
}
const obStartHint = computed(() => {
  const v = obForm.value.first_monday
  if (!v) return { t: '开学那天随便选，第 1 周从那周的周一起算', bad: false }
  const d = new Date(v + 'T00:00:00')
  return { t: `✓ ${d.getMonth() + 1} 月 ${d.getDate()} 日（周一）开学`, bad: false }
})
function obPickWeeks() {
  openNumberField({
    value: obForm.value.total_weeks, min: 1, max: 30, step: 1, unit: '周', title: '本学期周数',
    onDone: (v) => (obForm.value.total_weeks = v),
  })
}
/* 课程时间设置的摘要行：13 节 · 上午 5 · 下午 5 · 晚上 3（段数 ≤3 时用上/下/晚命名） */
const SEG_NAMES = ['上午', '下午', '晚上']
function segName(i) {
  return SEG_NAMES[i] || `时段 ${i + 1}`
}
const obTimeSummary = computed(() => {
  const sv = segmentView(obForm.value.periods)
  if (!sv.length) return '未设置'
  return `共 ${obForm.value.periods.length} 节 · ` + sv.map((g, i) => `${segName(i)} ${g.nos.length}`).join(' · ')
})
/* 二级页：改全局「单节时长 / 课间」→ 每段锚定段首整表重排 */
function obPickDur() {
  openNumberField({
    value: obGlobal.value.dur, min: 10, max: 180, step: 5, unit: '分钟', title: '单节课程时长',
    onDone: (v) => {
      obGlobal.value.dur = v
      obReperiod({ dur: v, gap: obGlobal.value.gap })
    },
  })
}
function obPickGap() {
  openNumberField({
    value: obGlobal.value.gap, min: 0, max: 120, step: 5, unit: '分钟', title: '课间休息时长',
    onDone: (v) => {
      obGlobal.value.gap = v
      obReperiod({ dur: obGlobal.value.dur, gap: v })
    },
  })
}
const obGlobal = ref({ dur: 45, gap: 10 }) // 二级页两个滚轮的当前值（随表初始化）
function obReperiod(opts) {
  const r = reperiodAll(obForm.value.periods, opts)
  if (!r.ok) {
    obErr.value = r.reason === 'midnight' ? '按这个时长排会超出一天，改小一点' : '按这个时长排会挤进下一时段，改小一点'
    return
  }
  obErr.value = ''
  obForm.value.periods = r.periods
}
/* 二级页三块渲染：段视图 + 段名 */
const obSegGroups = computed(() =>
  segmentView(obForm.value.periods).map((g, i) => ({ ...g, name: segName(i) }))
)
/* 点改某节开始时间：本段后面整体顺移（shiftWithinSegment 按 index 操作） */
function obPickPeriodStart(idx) {
  const p = obForm.value.periods[idx]
  const dur = Math.max(1, minOf(p.end) - minOf(p.start))
  openTimeField({
    value: p.start,
    onDone: (v) => {
      if (v === p.start) return
      const r = shiftWithinSegment(obForm.value.periods, obSegGroups.value.find((g) => idx >= g.from && idx <= g.to)?.seg, idx, v, dur, p.start)
      if (!r.ok) {
        obErr.value = r.reason === 'midnight' ? '这样改会超出一天' : '这样改会挤进下一时段'
        return
      }
      obErr.value = ''
      obForm.value.periods = r.periods
    },
  })
}
/* 段尾加一节（复用分段纯函数，越段拒绝） */
function obAddPeriod(seg) {
  const r = addPeriodToSegment(obForm.value.periods, seg, obGlobal.value)
  if (!r.ok) {
    obErr.value = r.reason === 'midnight' ? '加不下了，会超出一天' : '加不下了，会挤进下一时段'
    return
  }
  obErr.value = ''
  obForm.value.periods = r.periods
}
/* 删一节：no 自动重编号（removePeriodAt 按 index） */
function obRemovePeriod(idx) {
  obForm.value.periods = removePeriodAt(obForm.value.periods, idx)
}
function obSubmit() {
  const r = createManualSemester({ ...obForm.value, periods: obForm.value.periods })
  if (!r.ok) {
    obErr.value = r.error
    return
  }
  source.value = r.data.source
  semester.value = r.data.semester
  weekAll.value = r.data.courses
  events.value = r.data.events
  todos.value = r.data.todos.map((t) => ({ ...t }))
  importMsg.value = `已创建学期「${r.data.semester.name}」：在周视图长按或双击空白处添加课程`
  tab.value = 'week'
  finishOnboarding()
}

/* ---------------- 课表图片识别（引导页第 2 步「识别课表」+ 第 3 步「核对导入」） ----------------
   设计方案口径：图片 → 多模态识别 → 确认页纠错 → 入库。
   规则优先：AI 只给「星期数字 + 节次数字 + 单双周」，节次→时间用本地节次表换算
   （用户反馈：课表图上的时间是学校自己的作息，可能是期末考时间，一律不采信）。
   第 2 步页内回显「本次换算用的节次表」，就是为了让「先设节次、再识别」这件事看得见。 */
const obRecFile = ref(null)
const obRecBusy = ref(false)
const obRecErr = ref('')
const recPreview = ref(null) // { items:[{title,weekday,startSec,endSec,weekRule,location,teacher,selected}], notes, warnings }
const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const WEEK_RULE_LABELS = { every: '每周', odd: '单周', even: '双周' }
const recSelectedCount = computed(() =>
  recPreview.value ? recPreview.value.items.filter((i) => i.selected).length : 0
)
/* 换算用的节次表：用户设了就用自己的，全删了回落默认（口径同 periodsOf，识别预览与入库共用一份） */
const obPeriods = computed(() => periodsOf({ semester: { periods: obForm.value.periods } }))
const obSegView = computed(() => segmentView(obPeriods.value))
/* 「我的」页识别入口（第三步）：复用识别页/核对页，但换算表换成当前学期的节次表，
   导入走 addCourse 增量 + 冲突提示（不动学期信息）。 */
const recFromMine = ref(false)
const mineRecErr = ref('')
const minePeriods = computed(() => periodsOf({ semester: { periods: (semester.value && semester.value.periods) || [] } }))
const recPeriods = computed(() => (recFromMine.value ? minePeriods.value : obPeriods.value))
const recSegView = computed(() => segmentView(recPeriods.value))
function mineRecStart() {
  mineRecErr.value = ''
  const missing = recognizerAvailable() // 与课堂纪要共用 Key，缺 Key 时给出去哪配的提示
  if (missing) {
    mineRecErr.value = missing
    return
  }
  recPreview.value = null
  obRecErr.value = ''
  recFromMine.value = true
  onboarding.value = true // 借用引导层渲染识别页/核对页（onboardStep 直落第 2 步）
  onboardStep.value = 'rec'
}
function mineRecCancel() {
  recFromMine.value = false
  onboarding.value = false
  recPreview.value = null
}
/* 第 1 步 → 第 2 步：只校验开学时间（学期名自动生成、周数来自滚轮，其余字段不会非法） */
function goObRec() {
  obErr.value = ''
  if (!obForm.value.first_monday) {
    obErr.value = '先选好开学时间，识别出来的课要靠它算日期'
    return
  }
  obRecErr.value = ''
  onboardStep.value = 'rec'
}
function recBackForm() {
  obRecErr.value = ''
  onboardStep.value = 'form'
}
/* 识别页的手动输入入口（用户要求）：不识别也能进核对页手动补课，
   与识别结果共用同一套核对/入库链路——空课名在导入时会被跳过，逼着填上 */
function obManualAdd() {
  if (!recPreview.value) recPreview.value = { items: [], notes: [], warnings: [] }
  recPreview.value.items.push({
    title: '', weekday: 1, startSec: 1, endSec: 2, weekRule: 'every', location: '', teacher: '', selected: true,
  })
  obRecErr.value = ''
  onboardStep.value = 'recConfirm'
}
function obRecClick() {
  obRecErr.value = ''
  const missing = recognizerAvailable() // 与课堂纪要共用 Key，缺 Key 时给出去哪配的提示
  if (missing) {
    obRecErr.value = missing
    return
  }
  if (obRecFile.value) obRecFile.value.click()
}
async function onObRecFile(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = '' // 允许重复选同一张
  if (!file) return
  obRecErr.value = ''
  obRecBusy.value = true
  try {
    const { dataUrls } = await compressImageForRecognize(file) // 长图自动切块
    const r = await recognizeScheduleImage(dataUrls)
    if (!r.courses.length) {
      const hint = r.notes && r.notes.length ? 'AI 说：' + r.notes.join('；') + '。' : ''
      obRecErr.value = '这张图里没认出课程。' + hint + '建议直接截教务系统课表网页的原图，不要先把图缩小。'
      return
    }
    recPreview.value = {
      items: r.courses.map((c) => ({ ...c, selected: true })),
      notes: r.notes,
      warnings: r.warnings,
    }
    onboardStep.value = 'recConfirm' // 识别成功落到第 3 步核对（返回第 2 步时结果仍在）
  } catch (err) {
    obRecErr.value = err && err.message ? err.message : '识别失败，换张图再试。'
  } finally {
    obRecBusy.value = false
  }
}
/* 节次范围的可选项：跟换算用的节次表走（引导第 1 步可增删节次；mine 模式用当前学期表；全删则回落默认 13 节） */
function recSecOptions() {
  return recPeriods.value.map((p) => p.no)
}
/* 节次 → 时间预览；超出节次表时返回空串（确认页标红提示，导入时跳过）。
   用 recPeriods（含默认回落），保证「预览显示的时间」和「入库写下的时间」同源 */
function recTimeRange(it) {
  const ps = recPeriods.value
  const a = ps.find((p) => p.no === Number(it.startSec))
  const b = ps.find((p) => p.no === Number(it.endSec))
  if (!a || !b) return ''
  return a.start + '–' + b.end
}
function recRemove(i) {
  if (recPreview.value) recPreview.value.items.splice(i, 1)
}
function recBack() {
  onboardStep.value = 'rec' // 回第 2 步；识别结果保留（可继续核对或重新选图）
}
/* 导入：mine 模式 = 增量（学期信息不动，addCourse 逐条入库 + 冲突提示）；
   引导模式 = 先建学期再逐条入库（与 obSubmit 同一入口） */
function recImport() {
  if (!recPreview.value) return
  const items = recPreview.value.items.filter((x) => x.selected)
  if (!items.length) {
    obRecErr.value = '至少留一门课再导入。'
    return
  }
  const ps = recPeriods.value // 与确认页预览同一份换算表（含「全删节次→默认 13 节」的回落）
  if (recFromMine.value) {
    let ok = 0
    let skipped = 0
    const conflictNames = []
    for (const it of items) {
      const a = ps.find((p) => p.no === Number(it.startSec))
      const b = ps.find((p) => p.no === Number(it.endSec))
      if (!a || !b || !String(it.title || '').trim()) {
        skipped++
        continue
      }
      const course = {
        weekday: it.weekday,
        name: String(it.title).trim(),
        place: [it.location, it.teacher].filter(Boolean).join(' · '),
        tag: WEEK_RULE_LABELS[it.weekRule],
        start: a.start,
        end: b.end,
        week_rule: it.weekRule,
      }
      const conf = findConflicts({ type: 'course', weekday: course.weekday, start: course.start, end: course.end, week_rule: course.week_rule }, weekAll.value)
      if (conf.length) conflictNames.push(...conf.map((c) => c.name))
      addCourse(course)
      ok++
    }
    reloadDataset()
    mineRecCancel()
    importMsg.value = `导入成功：新增 ${ok} 门课`
      + (skipped ? `，${skipped} 门因课程名没填或节次超出被跳过` : '')
      + (conflictNames.length ? `；与现有课表时间冲突：${[...new Set(conflictNames)].join('、')}（没动现有课，冲突的课可在周视图调整）` : '')
    return
  }
  const r = createManualSemester({ ...obForm.value, periods: obForm.value.periods })
  if (!r.ok) {
    onboardStep.value = 'form' // 学期信息不合法：回表单，就地报错
    obErr.value = r.error
    return
  }
  source.value = r.data.source
  semester.value = r.data.semester
  weekAll.value = r.data.courses
  events.value = r.data.events
  todos.value = r.data.todos.map((t) => ({ ...t }))
  let ok = 0
  let skipped = 0
  for (const it of items) {
    const a = ps.find((p) => p.no === Number(it.startSec))
    const b = ps.find((p) => p.no === Number(it.endSec))
    if (!a || !b || !String(it.title || '').trim()) {
      skipped++
      continue
    }
    addCourse({
      weekday: it.weekday,
      name: String(it.title).trim(),
      place: [it.location, it.teacher].filter(Boolean).join(' · '),
      tag: WEEK_RULE_LABELS[it.weekRule],
      start: a.start,
      end: b.end,
      week_rule: it.weekRule,
    })
    ok++
  }
  reloadDataset()
  finishOnboarding()
  tab.value = 'week'
  importMsg.value = skipped
    ? `课表识别已导入 ${ok} 门课，${skipped} 门因课程名没填或节次超出被跳过（可在周视图手动补）`
    : `课表识别已导入 ${ok} 门课：双击或长按课表空白处还能继续加课`
}

/* ---------------- 主题（浅色 / 深色） ---------------- */
const THEME_KEY = 'web2.theme'
const theme = ref(localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light')
const isDark = computed(() => theme.value === 'dark')

function applyTheme() {
  // 同步两个暗色类：.dark 是本站 token，.kun-dark-mode 是 KunUI 组件的暗色开关
  document.documentElement.classList.toggle('dark', isDark.value)
  document.documentElement.classList.toggle('kun-dark-mode', isDark.value)
}
applyTheme() // 首帧就应用，避免闪白

function toggleTheme() {
  theme.value = isDark.value ? 'light' : 'dark'
  localStorage.setItem(THEME_KEY, theme.value)
  applyTheme()
}

/* ---------------- 配色皮肤（蓝白 / 薰衣草紫 / 樱花粉 / 薄荷绿） ---------------- */
const ACCENTS = [
  { key: 'blue', name: '蓝白', color: '#2f6feb' },
  { key: 'lavender', name: '薰衣草紫', color: '#7c5ce0' },
  { key: 'pink', name: '樱花粉', color: '#ec6ba8' },
  { key: 'mint', name: '薄荷绿', color: '#2fb58a' },
]
const ACCENT_KEY = 'web2.accent'
const savedAccent = localStorage.getItem(ACCENT_KEY)
const accent = ref(ACCENTS.some((a) => a.key === savedAccent) ? savedAccent : 'blue')

function applyAccent() {
  document.documentElement.dataset.accent = accent.value
}
function setAccent(key) {
  accent.value = key
  localStorage.setItem(ACCENT_KEY, key)
  applyAccent()
}
applyAccent() // 首帧就应用

const todos = ref(initial.todos.map((t) => ({ ...t })))
const doneCount = computed(() => todos.value.filter((t) => t.done).length)

function toggleTodo(id) {
  const t = todos.value.find((t) => t.id === id)
  if (!t) return
  t.done = !t.done
  /* 两种源都落盘：导入态改写回写文本，示例态写覆盖层（刷新不丢） */
  patchTodo(id, { done: t.done })
}

/* ---------------- 待办状态筛选（Day 12，frontend-guidelines 首次跨项目调用） ----------------
   只是「这一屏显示谁」的视图参数：不写存储、不碰覆盖层数据；
   白名单外回落 'all'——清空恢复 = 点「全部」。
   层级规则对应：无新增浮层；空态三档文案对应「空态也是内容」。 */
const TODO_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'open', label: '未完成' },
  { key: 'done', label: '已完成' },
]
const todoFilter = ref('all')
const shownTodos = computed(() => {
  if (todoFilter.value === 'open') return todos.value.filter((t) => !t.done)
  if (todoFilter.value === 'done') return todos.value.filter((t) => t.done)
  return todos.value
})
function setTodoFilter(k) {
  todoFilter.value = k === 'open' || k === 'done' ? k : 'all'
}

/* ---------------- 待办增删改表单 ---------------- */
const todoForm = ref(null) // { id, title, due_date }；id 为 null = 新增
const todoErr = ref('')

function openTodoAdd() {
  const d = new Date()
  todoForm.value = { id: null, title: '', due_date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  todoErr.value = ''
  confirmDelTodo.value = false
}

function openTodoEdit(t) {
  todoForm.value = { id: t.id, title: t.title, due_date: t.due_date || null }
  todoErr.value = ''
  confirmDelTodo.value = false
}

function submitTodo() {
  const f = todoForm.value
  if (!f.title.trim()) { todoErr.value = '请填写内容'; return }
  if (!f.due_date) { todoErr.value = '请选择截止日期'; return }
  if (f.id) {
    patchTodo(f.id, { title: f.title, due_date: f.due_date })
  } else {
    addTodo({ title: f.title, due_date: f.due_date })
  }
  todoForm.value = null
  reloadDataset()
}

function deleteTodoNow() {
  removeTodoById(todoForm.value.id)
  todoForm.value = null
  reloadDataset()
}

/* 待办删除二次确认：第一次点变「再点一次确认」，3 秒不点自动复位 */
const confirmDelTodo = ref(false)
let confirmDelTodoTimer = null
function onDeleteTodo() {
  if (!confirmDelTodo.value) {
    confirmDelTodo.value = true
    clearTimeout(confirmDelTodoTimer)
    confirmDelTodoTimer = setTimeout(() => { confirmDelTodo.value = false }, 3000)
    return
  }
  clearTimeout(confirmDelTodoTimer)
  confirmDelTodo.value = false
  deleteTodoNow()
}

/* ---------------- 独立日程（event）添加表单 ---------------- */
const evtForm = ref(null) // { title, date, start, duration, place }
const evtErr = ref('')

function openEventAdd() {
  evtForm.value = { title: '', date: todayStr, start: '18:00', duration: 60, place: '' }
  evtErr.value = ''
}

function submitEvent() {
  const f = evtForm.value
  if (!f.title.trim()) { evtErr.value = '请填写日程名称'; return }
  if (!f.date) { evtErr.value = '请选择日期'; return }
  if (!f.start) { evtErr.value = '请选择开始时间'; return }
  addEvent({ title: f.title, date: f.date, start_time: f.start, duration: f.duration, location: f.place })
  evtForm.value = null
  reloadDataset()
}

/* 导出回写主项目：下载「原格式 + 最新勾选」的 JSON，到主项目导入即完成同步 */
function onExportBack() {
  const text = exportImportedText()
  if (!text) return
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date()
  const ds = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  a.href = url
  a.download = `主项目回写-${(semester.value && semester.value.name) || '课表数据'}-${ds}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  importMsg.value = '已导出主项目格式 JSON：到主项目「导出/备份」里导入即可同步勾选状态'
}

/* 导出日历 .ics：课程按周次逐周展开 + 独立日程单次，课前 15 分钟提醒 */
function onExportIcs() {
  const { text, count } = buildIcs({ semester: semester.value, courses: weekAll.value, events: events.value })
  if (!text) {
    importMsg.value = '没有可导出的日程：示例数据没有学期起始日，课程换算不了日期；导入真实课表后再试'
    return
  }
  const name = ((semester.value && semester.value.name) || '课表') + '.ics'
  downloadText(name, text, 'text/calendar')
  importMsg.value = '已导出 ' + count + ' 条日程到 ' + name + '：手机日历里打开即可导入'
}

/* ---------------- 周基准（数据层需要用到的时间常量先立起来） ---------------- */
const today = new Date()
const todayIdx = (today.getDay() + 6) % 7 // 周一=0
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

/* 今天要上的课：本周课程里筛今天 + 周次规则命中 + 独立日程落位，按开始时间排 */
const todayCourses = computed(() => {
  const wd = todayIdx + 1
  const list = weekAll.value
    .filter((c) => c.weekday === wd && matchWeek(c, semester.value.week))
    .map((c) => ({ ...c }))
  for (const ev of events.value) {
    if (ev.date === todayStr) list.push({ ...ev, weekday: wd })
  }
  return list.sort((a, b) => minOf(a.start) - minOf(b.start))
})

/* ---------------- 问候：可爱系（时段轴 + 状态轴，状态优先） ---------------- */
/* 时间后门：?t=09:35 可假装时间（演示/测试用），不带参数走真实时间 */
const tParam = new URLSearchParams(location.search).get('t')
const nowTime = ref(tParam ? minOf(tParam) : new Date().getHours() * 60 + new Date().getMinutes())

/* 时段轴：可爱系语气表，想改语气只动这里 */
const GREET_CUTE = [
  { from: 5, text: '早上好呀～乖乖起床啦 (◍•ᴗ•◍)' },
  { from: 8, text: '上午好呀～上课的样子最可爱了' },
  { from: 11, text: '中午好～吃饱饱才有力气喵' },
  { from: 14, text: '下午好呀～再坚持一下下' },
  { from: 18, text: '晚上好呀～今天辛苦啦，摸摸头' },
  { from: 23, text: '这么晚还不睡呀？快去睡觉喵 (´-ω-`)' },
]
const greetingText = computed(() => {
  const h = nowTime.value / 60
  const hit = GREET_CUTE.find((g) => h >= g.from && h < g.from + (g.from === 23 ? 6 : 3))
  return hit ? hit.text : '你好呀～'
})

/* 状态轴：优先级 soon > done > free > 待办清零；命中才显示气泡 */
const state = computed(() => {
  if (todayCourses.value.length) {
    const nextStart = todayCourses.value
      .map((c) => minOf(c.start))
      .filter((s) => s > nowTime.value)
      .sort((a, b) => a - b)[0]
    if (nextStart !== undefined && nextStart - nowTime.value <= 30) {
      const c = todayCourses.value.find((c) => minOf(c.start) === nextStart)
      return { key: 'soon', text: `下一节《${c.name}》${c.start} 开始，还有 ${nextStart - nowTime.value} 分钟，冲鸭～` }
    }
    const lastEnd = Math.max(...todayCourses.value.map((c) => minOf(c.end)))
    if (nowTime.value > lastEnd) return { key: 'done', text: '今天的课全上完啦，去玩吧～' }
  } else {
    return { key: 'free', text: '今天没课耶！像小猫一样晒太阳吧 ฅ^•ﻌ•^ฅ' }
  }
  if (todos.value.length && doneCount.value === todos.value.length) {
    return { key: 'allTodo', text: '待办清空啦，你真的好棒！(๑•̀ㅂ•́)و' }
  }
  return null
})

const currentCourse = computed(() => {
  const c = todayCourses.value.find((c) => {
    return nowTime.value >= minOf(c.start) && nowTime.value <= minOf(c.end)
  })
  return c || todayCourses.value[0]
})

const dateText = `${today.getMonth() + 1} 月 ${today.getDate()} 日`
const weekDay = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.getDay()]

/* ---------------- 周视图 ---------------- */
const DAY_START = 8 * 60     // 08:00
const DAY_END = 22 * 60      // 22:00
const PX_PER_MIN = 0.85      // 每分钟高度
const COL_W = 72             // 一天的列宽
const AXIS_W = 38            // 左侧时间轴宽

const weekOffset = ref(0)
const weekNo = computed(() => semester.value.week + weekOffset.value)

/* 显示中这一周的周一（随周次切换移动） */
const monday = computed(() => {
  const m = new Date(today)
  m.setDate(today.getDate() - todayIdx + weekOffset.value * 7)
  return m
})

const weekDays = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.value)
    d.setDate(monday.value.getDate() + i)
    return {
      wd: i + 1,
      label: ['一', '二', '三', '四', '五', '六', '日'][i],
      date: d.getDate(),
      isToday: weekOffset.value === 0 && i === todayIdx,
    }
  })
)

/* 周视图可见条目：课程按周次规则过滤 + 独立日程按日期落位 */
const weekVisible = computed(() => {
  const list = weekAll.value
    .filter((c) => matchWeek(c, weekNo.value))
    .map((c) => ({ ...c }))
  for (const ev of events.value) {
    if (!ev.date) continue
    const diff = Math.round((new Date(ev.date + 'T00:00:00') - monday.value) / 86400000)
    if (diff >= 0 && diff <= 6) list.push({ ...ev, weekday: diff + 1 })
  }
  return list
})

function y(min) {
  return (min - DAY_START) * PX_PER_MIN
}

function courseBox(c) {
  return {
    top: y(minOf(c.start)) + 2,
    height: Math.max((minOf(c.end) - minOf(c.start)) * PX_PER_MIN - 5, 26),
  }
}

/* 课程配色：按课程名哈希取色，同一门课永远同色。
   深色模式下改为「同色系半透明底 + 原色文字」，避免大块高亮糊在暗底上 */
const PALETTES = [
  { bg: '#eef4fe', bar: '#2f6feb', text: '#1f57cc' },
  { bg: '#f1eefe', bar: '#7c5ce0', text: '#5b3fc0' },
  { bg: '#e9f9ef', bar: '#22a95e', text: '#157a43' },
  { bg: '#fff4e8', bar: '#ef9436', text: '#c2620a' },
  { bg: '#fdeef4', bar: '#e8659f', text: '#c03d7d' },
  { bg: '#e8f6f8', bar: '#2ba3b5', text: '#17798a' },
]
function hashName(name) {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 997
  return h
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
function pal(c) {
  const p = PALETTES[hashName(c.name) % PALETTES.length]
  if (!isDark.value) return p
  return { bg: hexA(p.bar, 0.16), bar: p.bar, text: p.bar }
}

const hours = computed(() => {
  const arr = []
  for (let h = DAY_START / 60; h < DAY_END / 60; h++) arr.push(h)
  return arr
})

/* 节次时间轴：periods 为空回落默认节次表（口径同主项目） */
const periods = computed(() => periodsOf({ semester: semester.value }))
/* 课程落在哪些节：起止都与节次边界精确对齐才显示「第X–Y节」，否则 null */
function periodSpan(c) {
  if (!c || c.type !== 'course') return null
  const s = periods.value.findIndex((p) => p.start === c.start)
  const e = periods.value.findIndex((p) => p.end === c.end)
  if (s < 0 || e < 0 || s > e) return null
  return s === e ? `第${periods.value[s].no}节` : `第${periods.value[s].no}-${periods.value[e].no}节`
}

/* 当天「现在」红线 */
const nowTop = computed(() => {
  if (nowTime.value < DAY_START || nowTime.value > DAY_END) return null
  return y(nowTime.value)
})

/* ---------------- 打磨：课程状态 / 详情弹层 / 待办徽标 ---------------- */
/* 今日课程三态：past 已结束（淡化）/ now 进行中（高亮+进度）/ future 未开始 */
function courseStatus(c) {
  const s = minOf(c.start)
  const e = minOf(c.end)
  if (nowTime.value > e) return 'past'
  if (nowTime.value >= s) return 'now'
  return 'future'
}
function nowPct(c) {
  const s = minOf(c.start)
  const e = minOf(c.end)
  if (nowTime.value <= s) return 0
  if (nowTime.value >= e) return 100
  return Math.round(((nowTime.value - s) / (e - s)) * 100)
}

const undoneCount = computed(() => todos.value.filter((t) => !t.done).length)

/* 详情弹层：点任意课卡弹出，点遮罩/×关闭 */
const detail = ref(null)
function openDetail(c) {
  detail.value = c
  confirmDel.value = false // 重开弹层时复位删除确认
}
const WDN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

/* ---------------- 添加课程（周视图长按 / 双击空白处） ---------------- */
const addForm = ref(null)
const addErr = ref('')
/* 冲突警告：第一次保存只提示；用户改任意字段后自动复位重新检测 */
const addWarn = ref('')
const addConfirmed = ref(false)
watch(addForm, () => { addConfirmed.value = false; addWarn.value = '' }, { deep: true })
const DURATIONS = [40, 45, 60, 90]
function fmtTime(m) {
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
}
/* 从网格位置打开表单：分钟吸附到 5 分钟，整段钳在 08:00–22:00 内 */
function openAdd(wd, min) {
  min = Math.max(DAY_START + 30, Math.min(DAY_END - 45, Math.round(min / 5) * 5))
  addForm.value = { weekday: wd, start: fmtTime(min), duration: 45, name: '', place: '', week_rule: 'every', editingId: null }
  addErr.value = ''
  addWarn.value = ''
  addConfirmed.value = false
}
/* 编辑课程：详情弹层进来，预填原值（自加课/导入课/mock 课都走这张表单，origin 记来源） */
function editCourseFromDetail() {
  if (!detail.value || detail.value.type !== 'course') return
  const c = detail.value
  detail.value = null
  addForm.value = {
    weekday: c.weekday || 1,
    start: c.start,
    duration: minOf(c.end) - minOf(c.start),
    name: c.name,
    place: c.place || '',
    week_rule: c.week_rule || 'every',
    editingId: c.id,
    origin: c.added ? 'added' : source.value,
  }
  addErr.value = ''
  addWarn.value = ''
  addConfirmed.value = false
}
function stepStart(d) {
  const f = addForm.value
  if (!f) return
  const m = Math.max(DAY_START, Math.min(DAY_END - f.duration, minOf(f.start) + d))
  f.start = fmtTime(m)
}
function submitAdd() {
  const f = addForm.value
  if (!f || !f.name.trim()) {
    addErr.value = '先给课程起个名字～'
    return
  }
  const endMin = minOf(f.start) + f.duration
  if (endMin > DAY_END) {
    addErr.value = '结束时间会超出 22:00，调短时长吧'
    return
  }
  const payload = {
    weekday: f.weekday,
    name: f.name.trim(),
    place: f.place.trim(),
    tag: { every: '每周', odd: '单周', even: '双周' }[f.week_rule],
    start: f.start,
    end: fmtTime(endMin),
    week_rule: f.week_rule,
  }
  /* 冲突检测（PRD F4 口径：提示但不强制阻止）——第一次点保存只警告，再点一次放行 */
  if (!addConfirmed.value) {
    const conflicts = findConflicts({ id: f.editingId, type: 'course', weekday: f.weekday, start: f.start, end: fmtTime(endMin), week_rule: f.week_rule }, weekAll.value)
    if (conflicts.length) {
      addConfirmed.value = true
      addWarn.value = '与「' + [...new Set(conflicts.map((c) => c.name))].join('」「') + '」时间冲突，再点一次「保存」可忽略'
      return
    }
  }
  if (f.editingId) {
    if (f.origin === 'added') updateCourse(f.editingId, payload)
    else if (f.origin === 'import') updateImportedCourse(f.editingId, payload)
    else patchMockCourse(f.editingId, payload)
  } else {
    addCourse(payload)
  }
  addForm.value = null
  reloadDataset()
}
function removeCourseFromDetail() {
  if (!detail.value || detail.value.type !== 'course') return
  const c = detail.value
  if (c.added) removeCourse(c.id)
  else if (source.value === 'import') removeImportedCourse(c.id)
  else removeMockCourse(c.id)
  detail.value = null
  reloadDataset()
}

/* 课程删除二次确认：第一次点变「再点一次确认」，3 秒不点自动复位 */
const confirmDel = ref(false)
let confirmDelTimer = null
function onDelCourse() {
  if (!confirmDel.value) {
    confirmDel.value = true
    clearTimeout(confirmDelTimer)
    confirmDelTimer = setTimeout(() => { confirmDel.value = false }, 3000)
    return
  }
  clearTimeout(confirmDelTimer)
  confirmDel.value = false
  removeCourseFromDetail()
}

/* 手势：触屏长按 550ms / 鼠标双击；点在课卡上不触发，拖动超 8px（滚动）取消 */
let lpTimer = null
let lpFrom = null
function fireAdd(p) {
  const wd = Math.min(7, Math.max(1, Math.floor((p.x - p.rect.left) / COL_W) + 1))
  const min = DAY_START + (p.y - p.rect.top) / PX_PER_MIN
  openAdd(wd, min)
}
function gridDown(e) {
  if (e.target.closest('article')) return
  lpFrom = { x: e.clientX, y: e.clientY, rect: e.currentTarget.getBoundingClientRect() }
  clearTimeout(lpTimer)
  lpTimer = setTimeout(() => {
    lpTimer = null
    fireAdd(lpFrom)
  }, 550)
}
function gridMove(e) {
  if (lpTimer && lpFrom && (Math.abs(e.clientX - lpFrom.x) > 8 || Math.abs(e.clientY - lpFrom.y) > 8)) {
    clearTimeout(lpTimer)
    lpTimer = null
  }
}
function gridUp() {
  clearTimeout(lpTimer)
  lpTimer = null
}
function gridDbl(e) {
  if (e.target.closest('article')) return
  fireAdd({ x: e.clientX, y: e.clientY, rect: e.currentTarget.getBoundingClientRect() })
}
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-md flex-col overflow-x-clip">
    <!-- 顶栏：淡雅氛围卡——四角全圆+四周留白，浏览器里不再有「上尖下圆」的裁切感 -->
    <header class="relative mx-4 mt-3 overflow-hidden rounded-[20px] bg-gradient-to-br from-primary-50 to-primary-100 px-5 pb-5 pt-5 shadow-sm">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <p class="text-[13px] font-medium text-primary-600">
            {{ dateText }} {{ weekDay }} · 第 {{ semester.week }} 周
          </p>
          <h1 class="mt-1 text-2xl font-bold tracking-tight text-ink">{{ greetingText }}</h1>
          <!-- 状态气泡：状态轴命中才出现（仅今日页）。收缩容器防瞬间消失：离开今日随 header 一起收起 -->
          <div
            class="grid transition-[grid-template-rows] duration-[280ms]"
            :class="tab === 'today' && state ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
            style="transition-timing-function: cubic-bezier(0.3, 0.75, 0.3, 1)"
            :style="{ transitionDelay: tab === 'today' ? '110ms' : '0ms' }"
          >
            <div class="min-h-0 overflow-hidden">
              <p
                v-if="state"
                class="mt-2.5 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-card px-3 py-1.5 text-xs font-medium text-primary-600 shadow-sm transition-all duration-[280ms]"
                :class="tab === 'today' ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'"
                style="transition-timing-function: cubic-bezier(0.34, 1.45, 0.64, 1)"
              >
                {{ state.text }}
              </p>
            </div>
          </div>
        </div>
        <!-- 主题切换：太阳 / 月亮 -->
        <button
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-card text-ink-dim shadow-sm transition active:scale-90"
          :title="isDark ? '切到浅色' : '切到深色'"
          @click="toggleTheme"
        >
          <svg v-if="isDark" viewBox="0 0 16 16" class="h-4.5 w-4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="8" cy="8" r="3.2" />
            <path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2L3.1 3.1" />
          </svg>
          <svg v-else viewBox="0 0 16 16" class="h-4.5 w-4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M13.5 9.5A6 6 0 116.5 2.5a5 5 0 007 7z" />
          </svg>
        </button>
      </div>
      <!-- 今日概要：白色小卡（仅今日页，替代原独立 Hero）。
           向上收缩动效：外层 grid-rows 0fr↔1fr 做高度塌缩（无过冲曲线，防布局闪烁），
           卡片本体叠加 -translate-y 上飘+淡出用过冲曲线（Q 弹感来源，transform 过冲不撑布局） -->
      <div
        class="grid transition-[grid-template-rows] duration-[280ms]"
        :class="tab === 'today' ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
        style="transition-timing-function: cubic-bezier(0.3, 0.75, 0.3, 1)"
        :style="{ transitionDelay: tab === 'today' ? '110ms' : '0ms' }"
      >
        <div class="min-h-0 overflow-hidden">
          <div
            class="mt-4 rounded-2xl border border-line bg-card px-4 py-3 shadow-sm transition-all duration-[280ms]"
            :class="tab === 'today' ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'"
            style="transition-timing-function: cubic-bezier(0.34, 1.45, 0.64, 1)"
            :style="{ transitionDelay: tab === 'today' ? '110ms' : '0ms' }"
          >
            <div class="flex items-center justify-between">
              <div class="min-w-0">
                <p class="text-xs text-ink-dim">今天 {{ todayCourses.length }} 节课</p>
                <p class="mt-0.5 truncate text-sm font-semibold text-ink">
                  {{ currentCourse ? '进行中 · ' + currentCourse.name : '当前没有课' }}
                </p>
              </div>
              <div class="shrink-0 text-right">
                <p class="text-xs text-ink-dim">待办</p>
                <p class="mt-0.5 text-sm font-semibold text-ink">{{ doneCount }}/{{ todos.length }}</p>
              </div>
            </div>
            <div class="mt-2.5">
              <div class="h-1.5 overflow-hidden rounded-full bg-primary-100">
                <div
                  class="h-full rounded-full bg-primary-500 transition-all duration-500"
                  :style="{ width: todos.length ? (doneCount / todos.length) * 100 + '%' : '0%' }"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- 内容平移层（Day 11 二轮）：三页并排各占 1/3，translateX 跟随 tab，连点改道可打断 -->
    <div
      ref="stripRef"
      class="flex w-[300%] shrink-0 items-start overflow-y-clip duration-[280ms]"
      style="transition-property: transform, height; transition-timing-function: cubic-bezier(0.32, 0.72, 0.35, 1)"
      :style="{ transform: `translateX(-${(tabIndex * 100) / 3}%)`, transitionDelay: enterToday ? '0ms' : '110ms', height: stripH ? stripH + 'px' : 'auto' }"
    >
    <!-- ===== 今日 ===== -->
    <main class="w-1/3 space-y-4 px-4 pt-4 pb-28" :inert="tab !== 'today'">
      <!-- 今日课程：时间线卡片 -->
      <section>
        <h2 class="mb-2 px-1 text-sm font-semibold text-ink">今日课程</h2>
        <div v-if="todayCourses.length" class="space-y-2.5">
          <article
            v-for="c in todayCourses"
            :key="c.id"
            class="flex cursor-pointer items-center gap-3.5 rounded-2xl border bg-card p-3.5 shadow-sm transition active:scale-[0.98]"
            :class="
              courseStatus(c) === 'now'
                ? 'border-primary-300 ring-1 ring-primary-200'
                : courseStatus(c) === 'past'
                  ? 'border-line opacity-55'
                  : 'border-line'
            "
            @click="openDetail(c)"
          >
            <div class="w-11 text-center">
              <p class="text-sm font-bold" :class="courseStatus(c) === 'now' ? 'text-primary-600' : 'text-primary-500'">{{ c.start }}</p>
              <p class="text-[11px] text-ink-dim">{{ c.end }}</p>
            </div>
            <div class="h-9 w-1 rounded-full" :class="courseStatus(c) === 'now' ? 'bg-primary-500' : 'bg-primary-200'"></div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-[15px] font-medium">{{ c.name }}</p>
              <p class="mt-0.5 text-xs text-ink-dim">{{ c.place || '—' }}</p>
              <!-- 进行中：呼吸圆点 + 实时进度 -->
              <p v-if="courseStatus(c) === 'now'" class="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-primary-600">
                <span class="relative flex h-1.5 w-1.5">
                  <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75"></span>
                  <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary-500"></span>
                </span>
                进行中 · 已过 {{ nowPct(c) }}%
              </p>
            </div>
            <span v-if="c.tag" class="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-[11px] text-primary-600">
              {{ c.tag }}
            </span>
          </article>
        </div>
        <p v-else class="rounded-2xl border border-dashed border-line bg-card/60 p-6 text-center text-sm text-ink-dim">
          今天没有课程安排～
        </p>
        <button
          class="mt-2 flex w-full items-center justify-center rounded-2xl border border-dashed border-line bg-card/60 py-2.5 text-xs font-medium text-ink-dim transition active:bg-ink/5"
          @click="openEventAdd"
        >
          ＋ 添加日程（班会、聚餐这类）
        </button>
      </section>

      <!-- 待办：轻量勾选 -->
      <section>
        <h2 class="mb-2 px-1 text-sm font-semibold text-ink">待办</h2>
        <!-- 状态筛选 chips：热区 min-h-11(44px)、选中态走字重+主色、aria-pressed 供读屏；
             一条待办都没有且不在筛选态时不出现（无感易用） -->
        <div
          v-if="todos.length || todoFilter !== 'all'"
          class="mb-2 flex flex-wrap gap-2 px-1"
          role="group"
          aria-label="待办状态筛选"
        >
          <button
            v-for="f in TODO_FILTERS"
            :key="f.key"
            type="button"
            class="flex min-h-11 items-center rounded-full border px-4 text-[13px] transition active:scale-95"
            :class="todoFilter === f.key
              ? 'border-primary-500 bg-primary-500/10 font-semibold text-primary-600'
              : 'border-line bg-card text-ink-dim'"
            :aria-pressed="todoFilter === f.key"
            @click="setTodoFilter(f.key)"
          >
            {{ f.label }}
          </button>
        </div>
        <div v-if="shownTodos.length" class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
          <div
            v-for="t in shownTodos"
            :key="t.id"
            class="flex items-center gap-3 p-3.5"
          >
            <!-- 打勾只认这个圆圈（不能把整行包成 label：button 是 label 的隐式关联控件，点行内任意处都会触发打勾） -->
            <button
              type="button"
              class="-m-1.5 flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full border-2 p-1.5 transition active:scale-90"
              :class="t.done ? 'border-primary-500 bg-primary-500' : 'border-ink-dim/40'"
              :aria-label="t.done ? '标记为未完成' : '标记为完成'"
              @click="toggleTodo(t.id)"
            >
              <svg v-if="t.done" viewBox="0 0 16 16" class="h-3 w-3 text-white" fill="none">
                <path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <span
              class="min-w-0 flex-1 cursor-pointer truncate text-sm"
              :class="t.done ? 'text-ink-dim line-through' : ''"
              @click.stop="openTodoEdit(t)"
            >
              {{ t.title }}
            </span>
            <span class="shrink-0 text-[11px]" :class="t.done ? 'text-ink-dim/60' : 'text-primary-500'">
              {{ t.due }}
            </span>
          </div>
        </div>
        <!-- 空态三档：筛选中明确「是筛选导致空，不是数据丢了」 -->
        <p
          v-else-if="todoFilter !== 'all'"
          class="rounded-2xl border border-dashed border-line bg-card/60 p-6 text-center text-sm text-ink-dim"
        >
          没有{{ todoFilter === 'open' ? '未完成' : '已完成' }}的待办
        </p>
        <p v-else class="rounded-2xl border border-dashed border-line bg-card/60 p-6 text-center text-sm text-ink-dim">
          没有待办，轻松自在～
        </p>
        <button
          class="mt-2 flex w-full items-center justify-center rounded-2xl border border-dashed border-line bg-card/60 py-3 text-sm font-medium text-ink-dim transition active:bg-ink/5"
          @click="openTodoAdd"
        >
          ＋ 添加待办
        </button>
      </section>

      <!-- 每日打卡（五期第 3 期 MVP）：高频每日动作跟「今天的课/待办」同住今日页；
           打卡圆圈直接给足热区 h-11；删除走两段式确认（点 × 变「确认」，3 秒不点自动复位） -->
      <section>
        <div class="mb-2 flex items-center justify-between px-1">
          <h2 class="text-sm font-semibold text-ink">每日打卡</h2>
          <button
            class="rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-ink-dim transition active:scale-95"
            @click="habitInput = !habitInput; habitName = ''"
          >
            {{ habitInput ? '收起' : '＋ 添加' }}
          </button>
        </div>

        <!-- 添加行：行内输入，回车即提交 -->
        <div v-if="habitInput" class="mb-2 flex gap-2 rounded-2xl border border-line bg-card p-3 shadow-sm">
          <input
            v-model="habitName"
            type="text"
            maxlength="20"
            placeholder="习惯名，如：背单词"
            enterkeyhint="done"
            class="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-dim/50 focus:border-primary-400"
          />
          <button
            class="shrink-0 rounded-xl bg-primary-500 px-4 text-sm font-medium text-white transition active:scale-95 disabled:opacity-40"
            :disabled="!habitName.trim()"
            @click="addHabitConfirm"
          >
            确定
          </button>
        </div>

        <!-- 习惯列表：名称 + 本周 7 格 + 连续天数 + 打卡圆圈 -->
        <div v-if="habits.length" class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
          <div v-for="h in habits" :key="h.id" class="flex items-center gap-3 p-3.5">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm" :class="h.records[habitToday] ? 'text-ink-dim' : 'text-ink'">{{ h.name }}</p>
              <div class="mt-1.5 flex items-center gap-1">
                <span
                  v-for="d in habitWeek"
                  :key="d.key"
                  class="flex h-4 w-4 items-center justify-center rounded-full text-[9px]"
                  :class="[
                    h.records[d.key] ? 'bg-primary-500 text-white' : 'bg-ink/[0.06] text-ink-dim/60',
                    d.isToday && !h.records[d.key] ? 'ring-1 ring-primary-400' : '',
                  ]"
                >
                  <svg v-if="h.records[d.key]" viewBox="0 0 10 10" class="h-2 w-2" fill="none"><path d="M2 5.2l2 2 4-4.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                  <template v-else>{{ d.name }}</template>
                </span>
              </div>
            </div>
            <span class="shrink-0 text-[11px] text-ink-dim/70">{{ streakOf(h, habitToday) > 0 ? '连续 ' + streakOf(h, habitToday) + ' 天' : '未开始' }}</span>
            <!-- 打卡主操作：h-11 = 44px 热区；已打卡实心勾（可点取消） -->
            <button
              type="button"
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-90"
              :class="h.records[habitToday] ? 'bg-primary-500 text-white' : 'border-2 border-ink-dim/30 text-ink-dim/40'"
              :aria-label="h.records[habitToday] ? '取消今日打卡' : '今日打卡'"
              @click="toggleHabit(h.id)"
            >
              <svg viewBox="0 0 16 16" class="h-4.5 w-4.5" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
            <!-- 删除：两段式确认 -->
            <button
              type="button"
              class="h-8 w-8 shrink-0 text-xs transition active:scale-90"
              :class="habitDelId === h.id ? 'font-bold text-red-500' : 'text-ink-dim/40'"
              :aria-label="habitDelId === h.id ? '确认删除该习惯' : '删除习惯'"
              @click="onHabitDelete(h.id)"
            >
              {{ habitDelId === h.id ? '确认' : '✕' }}
            </button>
          </div>
        </div>
        <p v-else class="rounded-2xl border border-dashed border-line bg-card/60 p-5 text-center text-sm text-ink-dim">
          还没有打卡习惯，点「＋ 添加」建一个
        </p>
      </section>
    </main>

    <!-- ===== 周课表 ===== -->
    <main class="w-1/3 px-4 pt-4 pb-28" :inert="tab !== 'week'">
      <!-- 周次切换 -->
      <section class="flex items-center justify-between rounded-2xl border border-line bg-card px-2 py-2 shadow-sm">
        <button
          class="flex h-9 w-9 items-center justify-center rounded-xl text-ink-dim transition active:bg-ink/10"
          @click="weekOffset--"
        >
          <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5" /></svg>
        </button>
        <p class="text-sm font-semibold">
          第 {{ weekNo }} 周
          <span class="ml-1 text-xs font-normal text-ink-dim">/ 共 {{ semester.totalWeeks }} 周</span>
        </p>
        <button
          class="flex h-9 w-9 items-center justify-center rounded-xl text-ink-dim transition active:bg-ink/10"
          @click="weekOffset++"
        >
          <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>
      </section>

      <!-- 周网格：横向滚动，7 列 + 时间轴 -->
      <section class="mt-3 overflow-x-auto">
        <div :style="{ width: AXIS_W + 7 * COL_W + 'px' }">
          <!-- 表头：星期 + 日期 -->
          <div class="flex">
            <div :style="{ width: AXIS_W + 'px' }" class="shrink-0"></div>
            <div
              v-for="d in weekDays"
              :key="d.wd"
              :style="{ width: COL_W + 'px' }"
              class="shrink-0 pb-2 text-center"
            >
              <p class="text-[11px]" :class="d.isToday ? 'font-semibold text-primary-600' : 'text-ink-dim'">周{{ d.label }}</p>
              <p
                class="mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold"
                :class="d.isToday ? 'bg-primary-500 text-white shadow-md shadow-primary-500/30' : 'text-ink'"
              >
                {{ d.date }}
              </p>
            </div>
          </div>

          <!-- 网格主体 -->
          <div class="flex">
            <!-- 时间轴：右侧小时刻度 + 左侧节次徽标 -->
            <div :style="{ width: AXIS_W + 'px', height: (DAY_END - DAY_START) * PX_PER_MIN + 'px' }" class="relative shrink-0">
              <span
                v-for="h in hours"
                :key="h"
                class="absolute right-1.5 -translate-y-1/2 text-[10px] text-ink-dim/70"
                :style="{ top: y(h * 60) + 'px' }"
              >
                {{ String(h).padStart(2, '0') }}
              </span>
              <span
                v-for="p in periods"
                :key="'p' + p.no"
                class="absolute left-0.5 flex h-3.5 w-3.5 -translate-y-1/2 items-center justify-center rounded-[4px] bg-primary-500/10 text-[8px] font-semibold text-primary-600/90"
                :style="{ top: y(minOf(p.start)) + 'px' }"
              >
                {{ p.no }}
              </span>
            </div>

            <!-- 七列 -->
            <div
              data-grid
              :style="{ width: 7 * COL_W + 'px', height: (DAY_END - DAY_START) * PX_PER_MIN + 'px' }"
              class="relative select-none"
              @pointerdown="gridDown"
              @pointermove="gridMove"
              @pointerup="gridUp"
              @pointercancel="gridUp"
              @dblclick="gridDbl"
            >
              <!-- 小时虚线 -->
              <div
                v-for="h in hours"
                :key="h"
                class="absolute inset-x-0 border-t border-dashed border-line"
                :style="{ top: y(h * 60) + 'px' }"
              ></div>

              <!-- 节次起始线：节与节的边界，比小时线略实 -->
              <div
                v-for="p in periods"
                :key="'pl' + p.no"
                class="pointer-events-none absolute inset-x-0 border-t border-dotted border-ink/[0.09]"
                :style="{ top: y(minOf(p.start)) + 'px' }"
              ></div>

              <!-- 当天列底色 -->
              <div
                v-for="d in weekDays"
                v-show="d.isToday"
                :key="'bg' + d.wd"
                class="absolute inset-y-0 rounded-2xl bg-primary-500/10"
                :style="{ left: (d.wd - 1) * COL_W + 2 + 'px', width: COL_W - 4 + 'px' }"
              ></div>

              <!-- 课程卡 -->
              <article
                v-for="c in weekVisible"
                :key="c.id"
                class="absolute cursor-pointer overflow-hidden rounded-xl px-1.5 py-1 shadow-sm ring-1 ring-line transition active:scale-[0.97]"
                @click="openDetail(c)"
                :style="{
                  left: (c.weekday - 1) * COL_W + 4 + 'px',
                  width: COL_W - 8 + 'px',
                  top: courseBox(c).top + 'px',
                  height: courseBox(c).height + 'px',
                  background: pal(c).bg,
                }"
              >
                <div class="flex h-full flex-col">
                  <p class="truncate text-[11px] leading-tight font-semibold" :style="{ color: pal(c).text }">
                    {{ c.name }}
                  </p>
                  <p class="mt-0.5 truncate text-[10px] leading-tight text-ink-dim">{{ c.place }}</p>
                  <p class="mt-auto truncate text-[9px] leading-tight text-ink-dim/70">
                    {{ periodSpan(c) || (c.start + '–' + c.end) }}
                  </p>
                </div>
                <!-- 左侧色条 -->
                <div
                  class="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-full"
                  :style="{ background: pal(c).bar }"
                ></div>
              </article>

              <!-- 现在红线 -->
              <div
                v-if="nowTop !== null"
                class="pointer-events-none absolute z-10"
                :style="{ left: todayIdx * COL_W + 'px', width: COL_W + 'px', top: nowTop + 'px' }"
              >
                <div class="relative h-[2px] rounded-full bg-red-400/90">
                  <span class="absolute -top-[3px] left-0 h-2 w-2 rounded-full bg-red-400"></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <p class="mt-3 px-1 text-center text-[11px] text-ink-dim/70">← 左右滑动查看周六周日 →</p>
    </main>

    <!-- ===== 我的 ===== -->
    <main class="w-1/3 space-y-4 px-4 pt-4 pb-28" :inert="tab !== 'me'">
      <section class="flex items-center gap-4 rounded-3xl border border-line bg-card p-5 shadow-sm">
        <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 text-xl font-bold text-white shadow-md shadow-primary-500/25">
          示
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-lg font-semibold">{{ semester.name }}</p>
          <p class="mt-0.5 text-xs text-ink-dim">
            第 {{ semester.week }} 周 / 共 {{ semester.totalWeeks }} 周 ·
            {{ source === 'import' ? '主项目数据' : '示例数据' }}
          </p>
        </div>
        <button
          v-if="source === 'import'"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink/5 text-ink-dim transition active:scale-90"
          aria-label="编辑学期信息"
          @click="openSemEdit"
        >
          <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11.3 2.2l2.5 2.5L5 13.5l-3 .5.5-3z" /></svg>
        </button>
      </section>
      <p v-if="source !== 'import'" class="-mt-2 px-1 text-[11px] text-ink-dim/70">示例数据不能编辑学期信息：导入真实课表或用引导页创建学期后可改</p>

      <!-- 拍课表识别（第三步）：复用识别页/核对页，用当前学期节次表换算，导入走增量 -->
      <section class="rounded-2xl border border-line bg-card p-4 shadow-sm">
        <div class="flex items-center gap-3.5">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="4" width="13" height="9.5" rx="1.5" /><path d="M5 4l1-2h4l1 2" /><circle cx="8" cy="8.75" r="2.5" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">拍课表识别</span>
            <span class="block text-[11px] text-ink-dim/70">截图课表自动加课；时间按当前学期的节次表换算，先核对再入库</span>
          </span>
          <button
            data-mine-rec
            class="shrink-0 rounded-full bg-primary-500 px-4 py-2 text-xs font-medium text-white transition active:scale-95"
            @click="mineRecStart"
          >
            开始识别
          </button>
        </div>
        <p v-if="mineRecErr" data-mine-rec-err class="mt-2 text-xs text-red-500">{{ mineRecErr }}</p>
      </section>

      <!-- 课堂录音（二期 M2）：App 平台可用；浏览器环境点按给就地提示，不做假录音 -->
      <section class="rounded-2xl border border-line bg-card p-4 shadow-sm">
        <div class="flex items-center gap-3.5">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="1.5" width="4" height="8" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 009 0M8 12v2.5M5.5 14.5h5" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">课堂录音</span>
            <span class="block text-[11px] text-ink-dim/70">录下整节课，课后转写总结；长按场次可删除</span>
          </span>
          <button
            v-if="!recActiveId"
            class="shrink-0 rounded-full bg-primary-500 px-4 py-2 text-xs font-medium text-white transition active:scale-95"
            :class="recSupported ? '' : 'opacity-60'"
            @click="startRec"
          >
            开始录音
          </button>
          <button
            v-else
            class="shrink-0 rounded-full bg-red-400 px-4 py-2 text-xs font-medium text-white transition active:scale-95"
            @click="stopRec"
          >
            停止并保存
          </button>
        </div>

        <!-- 录音中：红点 + 实时计时 -->
        <div v-if="recActiveId" class="mt-3 flex items-center gap-2 rounded-xl bg-red-400/10 px-3 py-2.5">
          <span class="h-2 w-2 animate-pulse rounded-full bg-red-400"></span>
          <span class="text-sm font-semibold tabular-nums">{{ fmtDur(recElapsed * 1000) }}</span>
          <span class="ml-auto text-[11px] text-ink-dim/70">录音中 · 锁屏也会继续录</span>
        </div>

        <p v-if="recMsg" class="mt-2.5 text-[11px]" :class="recMsgBad ? 'text-red-400' : 'text-primary-500'">{{ recMsg }}</p>

        <!-- 场次列表：倒序，试听按钮在播放/暂停间切换 -->
        <ul v-if="lectures.length" class="mt-3 divide-y divide-line border-t border-line">
          <li
            v-for="l in lectures"
            :key="l.id"
            class="py-2.5 transition-opacity select-none"
            :class="pressActiveId === l.id ? 'opacity-50' : ''"
            @contextmenu.prevent
            @pointerdown="startLecPress(l, $event)"
            @pointermove="moveLecPress"
            @pointerup="cancelLecPress"
            @pointerleave="cancelLecPress"
            @pointercancel="cancelLecPress"
          >
            <div class="flex items-center gap-3">
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13px] font-medium">{{ l.title }}</span>
                <span class="block text-[11px] text-ink-dim/70">
                  {{ fmtLecDate(l.started_at) }} · {{ fmtDur(l.duration_ms) }} · {{ lecStatusLabel(l) }}
                </span>
              </span>
              <button
                v-if="l.clips && l.clips.length"
                class="shrink-0 rounded-full bg-ink/5 px-3 py-1.5 text-[11px] font-medium transition active:scale-95"
                @click="playLec(l)"
              >
                {{ playingId === l.id ? '暂停' : '试听' }}
              </button>
              <button
                v-if="trSupported && l.status === 'recording' && l.ended_at && l.clips && l.clips.length"
                class="shrink-0 rounded-full bg-primary-500 px-3 py-1.5 text-[11px] font-medium text-white transition active:scale-95"
                :class="trBusyId && trBusyId !== l.id ? 'is-dim' : ''"
                @click="startTr(l)"
              >
                转写
              </button>
            </div>
            <!-- 转写进行中：进度条 + 阶段说明（下载模型 / 识别） -->
            <div v-if="trBusyId === l.id" class="mt-2">
              <div class="h-1.5 overflow-hidden rounded-full bg-ink/10">
                <div class="h-full rounded-full bg-primary-500 transition-[width] duration-300" :style="{ width: trPercent + '%' }"></div>
              </div>
              <p class="mt-1 text-[11px] text-ink-dim/70">{{ trLabel }}</p>
            </div>
            <!-- 文字稿 + 纪要：转写完成后解锁（纪要在浏览器里也能生成，与转写的 App 限制无关） -->
            <template v-if="(l.status === 'transcribed' || l.status === 'summarized') && l.transcript">
              <div class="mt-1.5 flex items-center gap-3">
                <button class="text-[11px] text-primary-500" @click="trOpenId = trOpenId === l.id ? null : l.id">
                  {{ trOpenId === l.id ? '收起文字稿 ▲' : '查看文字稿 ▼' }}
                </button>
                <button
                  class="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium transition active:scale-95"
                  :class="[
                    l.summary ? 'bg-ink/5' : 'bg-primary-500 text-white',
                    sumBusyId && sumBusyId !== l.id ? 'is-dim' : '',
                  ]"
                  @click="startSummary(l)"
                >
                  {{ l.summary ? '重新生成纪要' : '生成纪要' }}
                </button>
              </div>
              <p
                v-if="trOpenId === l.id"
                class="mt-1.5 whitespace-pre-wrap rounded-xl bg-ink/[0.04] p-3 text-[12px] leading-relaxed"
              >{{ l.transcript }}</p>
              <!-- 生成中：转圈 + 阶段说明 + 取消（LLM 调用是真网络请求，必须可掐断） -->
              <div v-if="sumBusyId === l.id" class="mt-2 flex items-center gap-2 text-[11px] text-ink-dim/80">
                <span class="h-3 w-3 animate-spin rounded-full border-2 border-primary-400 border-t-transparent"></span>
                <span class="flex-1">{{ sumStage === 'call' ? '正在调用 AI 生成纪要…' : '正在解析纪要…' }}</span>
                <button class="shrink-0 text-red-400" @click="cancelSummary">取消</button>
              </div>
              <!-- 纪要卡：总览 / 要点 / 概念 / 作业 / 存疑（空块不渲染） -->
              <div v-if="l.summary && sumOpenId === l.id" class="mt-2 rounded-xl border border-primary-400/30 bg-primary-50 p-3">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-bold text-primary-500">课堂纪要</span>
                  <button class="text-[11px] text-ink-dim/60" @click="sumOpenId = null">收起 ▲</button>
                </div>
                <p class="mt-1.5 text-[12px] leading-relaxed text-ink">{{ l.summary.overview }}</p>
                <ul v-if="l.summary.key_points && l.summary.key_points.length" class="mt-2 space-y-1">
                  <li v-for="(k, i) in l.summary.key_points" :key="'k' + i" class="flex gap-1.5 text-[12px] leading-relaxed">
                    <span class="shrink-0 text-primary-500">•</span><span>{{ k }}</span>
                  </li>
                </ul>
                <div v-if="l.summary.terms && l.summary.terms.length" class="mt-2.5">
                  <p class="text-[11px] font-semibold text-ink-dim/80">概念术语</p>
                  <div class="mt-1 flex flex-wrap gap-1.5">
                    <span v-for="(t, i) in l.summary.terms" :key="'t' + i" class="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px]" :title="t.note">{{ t.term }}</span>
                  </div>
                </div>
                <div v-if="l.summary.homework && l.summary.homework.length" class="mt-2.5">
                  <p class="text-[11px] font-semibold text-ink-dim/80">作业 / 截止</p>
                  <ul class="mt-1 space-y-0.5">
                    <li v-for="(h, i) in l.summary.homework" :key="'h' + i" class="text-[12px] leading-relaxed">□ {{ h }}</li>
                  </ul>
                </div>
                <div v-if="l.summary.questions && l.summary.questions.length" class="mt-2.5">
                  <p class="text-[11px] font-semibold text-amber-500">存疑点（可能识别有误）</p>
                  <ul class="mt-1 space-y-0.5">
                    <li v-for="(q, i) in l.summary.questions" :key="'q' + i" class="text-[12px] leading-relaxed">? {{ q }}</li>
                  </ul>
                </div>
              </div>
              <button v-else-if="l.summary" class="mt-1.5 text-[11px] text-primary-500" @click="sumOpenId = l.id">
                查看纪要 ▼
              </button>
            </template>
          </li>
        </ul>
      </section>

      <section class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
        <!-- 配色皮肤：色点即点即换 -->
        <div class="flex items-center gap-3.5 p-4">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1l2 4 4.5.6-3.2 3.1.8 4.5L8 11l-4.1 2.2.8-4.5L1.5 5.6 6 5z" /></svg>
          </span>
          <span class="flex-1 text-sm font-medium">主题配色</span>
          <div class="flex items-center gap-2.5">
            <button
              v-for="a in ACCENTS"
              :key="a.key"
              class="h-6 w-6 rounded-full transition active:scale-90"
              :class="accent === a.key ? 'ring-2 ring-primary-400 ring-offset-2 ring-offset-card' : ''"
              :style="{ background: a.color }"
              :title="a.name"
              @click="setAccent(a.key)"
            ></button>
          </div>
        </div>

        <!-- 导入主项目数据 -->
        <label class="flex cursor-pointer items-center gap-3.5 p-4 active:bg-ink/5">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V2M4.5 5.5L8 2l3.5 3.5M3 11v2.5A.5.5 0 003.5 14h9a.5.5 0 00.5-.5V11" /></svg>
          </span>
          <span class="flex-1 text-sm font-medium">导入主项目数据</span>
          <span class="text-xs" :class="source === 'import' ? 'text-primary-500' : 'text-ink-dim/70'">
            {{ source === 'import' ? '已导入 ✓' : '选择导出的 JSON' }}
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 text-ink-dim/50" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
          <input type="file" accept=".json,application/json" class="hidden" @change="onImportFile" />
        </label>

        <!-- 恢复示例数据（仅导入态出现） -->
        <button
          v-if="source === 'import'"
          class="flex w-full items-center gap-3.5 p-4 text-left active:bg-ink/5"
          @click="onClearImport"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 109.8-3.4M2.5 2.5v3h3" /></svg>
          </span>
          <span class="flex-1 text-sm font-medium">恢复示例数据</span>
        </button>

        <!-- 导出回写主项目（仅导入态出现）：勾选过的待办随文件带走 -->
        <button
          v-if="source === 'import'"
          class="flex w-full items-center gap-3.5 p-4 text-left active:bg-ink/5"
          @click="onExportBack"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v9M4.5 7.5L8 11l3.5-3.5M3 13h10" /></svg>
          </span>
          <span class="flex-1">
            <span class="block text-sm font-medium">导出回写主项目</span>
            <span class="block text-[11px] text-ink-dim/70">勾选过的待办会同步进导出文件</span>
          </span>
        </button>

        <!-- 导出日历 .ics：把课表装进系统日历 -->
        <button
          class="flex w-full items-center gap-3.5 p-4 text-left active:bg-ink/5"
          @click="onExportIcs"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /></svg>
          </span>
          <span class="flex-1">
            <span class="block text-sm font-medium">导出日历（.ics）</span>
            <span class="block text-[11px] text-ink-dim/70">整学期课表装进手机系统日历，带课前提醒</span>
          </span>
        </button>

        <!-- 主题外观（明暗） -->
        <div
          class="flex cursor-pointer items-center gap-3.5 p-4 active:bg-ink/5"
          @click="toggleTheme"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 9.5A6 6 0 116.5 2.5a5 5 0 007 7z" /></svg>
          </span>
          <span class="flex-1 text-sm font-medium">主题外观</span>
          <span class="text-xs text-ink-dim/70">{{ isDark ? '当前：深色' : '当前：浅色' }}</span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 text-ink-dim/50" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </div>

        <!-- 课堂纪要（M4）：LLM 配置。key 只存本机 localStorage，不进导出、不经手上传 -->
        <div class="p-4">
          <button
            type="button"
            class="flex w-full items-center gap-3.5 text-left active:bg-ink/5"
            @click="llmInputOpen = !llmInputOpen"
          >
            <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
              <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5l1.8 3.7 4 .6-2.9 2.8.7 4L8 10.7l-3.6 1.9.7-4L2.2 5.8l4-.6z" /><path d="M8 13.5v1.5" /></svg>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">课堂纪要</span>
              <span class="block text-[11px] text-ink-dim/70">{{ llmReady ? 'AI 服务已配置，可在录音场次一键生成' : '转写完成后用 AI 把文字稿总结成复习纪要' }}</span>
            </span>
            <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-ink-dim/50 transition-transform" :class="llmInputOpen ? 'rotate-90' : ''" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
          </button>

          <div v-if="llmInputOpen" class="mt-3 space-y-2.5">
            <div>
              <span class="mb-1 block text-[11px] text-ink-dim/80">纪要服务</span>
              <DropdownSelect
                v-model="llmCfg.provider"
                data-dd="provider"
                :options="PROVIDER_OPTIONS"
                placeholder="未选择"
                @update:model-value="onLlmProvider"
              />
            </div>
            <label v-if="llmCfg.provider === 'deepseek'" class="block">
              <span class="mb-1 block text-[11px] text-ink-dim/80">DeepSeek API Key（只存在本机，不会上传）</span>
              <input
                v-model="llmCfg.key"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="sk-…"
                enterkeyhint="done"
                class="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-dim/40 focus:border-primary-400"
                @input="onLlmKey"
              />
            </label>
            <div v-if="llmCfg.provider === 'deepseek'">
              <span class="mb-1 block text-[11px] text-ink-dim/80">模型（二选一，不用手填）</span>
              <DropdownSelect
                v-model="llmCfg.model"
                data-dd="model"
                :options="llmModels"
                @update:model-value="onLlmKey"
              />
            </div>
            <!-- 测试连接：填完就能验，不用等一次真生成来撞错 -->
            <button
              type="button"
              class="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-card py-2.5 text-sm font-medium text-ink transition active:scale-[0.98]"
              :class="llmTest.busy ? 'opacity-60' : ''"
              @click="testLlm"
            >
              <span v-if="llmTest.busy" class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-400 border-t-transparent"></span>
              {{ llmTest.busy ? '正在测试…' : '测试连接' }}
            </button>
            <p
              v-if="llmTest.msg"
              class="text-[11px] leading-relaxed"
              :class="llmTest.ok ? 'text-primary-500' : 'text-red-400'"
            >{{ llmTest.msg }}</p>
            <p class="text-[11px] leading-relaxed text-ink-dim/60">
              Key 在 platform.deepseek.com 申请；一次纪要通常几分钱以内。配置存在本机，换设备后需重填。
            </p>
          </div>
        </div>

        <!-- 清除数据并重置（危险项，对齐主项目：二次确认后回到初始设定，无法恢复） -->
        <button
          class="flex w-full items-center gap-3.5 p-4 text-left active:bg-ink/5"
          @click="confirmClear = true"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-red-400/10">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-red-400" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6.5 2.5h3M4 4.5l.6 9a1 1 0 001 .9h4.8a1 1 0 001-.9l.6-9M6.8 7.5v4M9.2 7.5v4" /></svg>
          </span>
          <span class="flex-1">
            <span class="block text-sm font-medium text-red-400">清除数据并重置</span>
            <span class="block text-[11px] text-ink-dim/70">想从头开始（换学期 / 重测）用它，无法恢复</span>
          </span>
        </button>

        <!-- 后台录音说明（仅 App 平台：网页版没有前台服务，属于 M2.5 原生能力） -->
        <div v-if="recSupported" class="flex items-start gap-3.5 p-4">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2a3.5 3.5 0 00-3.5 3.5c0 3-1.5 4-1.5 4h10s-1.5-1-1.5-4A3.5 3.5 0 008 2z" /><path d="M6.5 12.5a1.6 1.6 0 003 0" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">后台录音</span>
            <span class="block text-[11px] leading-relaxed text-ink-dim/70">
              录音时锁屏、切到别的应用都会继续录，通知栏会有一条「正在录音」。看不到这条通知的话，去系统设置里打开本应用的通知权限——通知被拦掉时，后台更容易被系统清理。
            </span>
          </span>
        </div>

        <!-- 课前提醒（M5）：开关 + 提前量 + 测试按钮（通知能力仅 App 生效，浏览器置灰） -->
        <div class="flex items-center gap-3.5 p-4" :class="notifyOk ? '' : 'opacity-50'">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="9" r="4.8" /><path d="M5.2 2.2 3.4 3.8M10.8 2.2l1.8 1.6M8 6.8V9l1.6 1.2" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">课前提醒</span>
            <span class="block text-[11px] leading-relaxed text-ink-dim/70">
              {{ notifyOk
                ? '上课前高优先级提醒（会响、会弹横幅），点通知或「开始录音」直接开录。'
                : '通知能力仅 App 内生效，浏览器上不可用。' }}
            </span>
          </span>
          <button
            v-if="notifyOk"
            class="relative h-6 w-11 shrink-0 rounded-full transition"
            :class="notifySettings.enabled ? 'bg-primary-500' : 'bg-ink/15'"
            aria-label="课前提醒开关"
            @click="toggleNotify"
          >
            <span
              class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
              :class="notifySettings.enabled ? 'left-[22px]' : 'left-0.5'"
            ></span>
          </button>
        </div>
        <div v-if="notifyOk && notifySettings.enabled" class="border-t border-line px-4 py-3.5">
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-ink-dim/80">提前</span>
            <button
              v-for="m in [5, 10, 15]"
              :key="m"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium transition active:scale-95"
              :class="notifySettings.minutesBefore === m ? 'bg-primary-500 text-white' : 'bg-ink/5 text-ink'"
              @click="setNotifyLead(m)"
            >{{ m }} 分钟</button>
            <button
              class="ml-auto rounded-full bg-ink/5 px-3 py-1.5 text-[11px] font-medium transition active:scale-95"
              :class="notifyTesting ? 'opacity-60' : ''"
              @click="onTestNotify"
            >{{ notifyTesting ? '发送中…' : '发测试通知' }}</button>
          </div>
          <p v-if="notifyPerm === false" class="mt-2 text-[11px] text-red-400">通知权限被拒绝了：请在系统设置里允许本应用发通知，否则提醒收不到。</p>
          <p v-if="notifyMsg" class="mt-2 text-[11px]" :class="notifyMsgBad ? 'text-red-400' : 'text-primary-500'">{{ notifyMsg }}</p>
        </div>

        <!-- 关于 -->
        <div class="flex items-center gap-3.5 p-4">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8a3 3 0 100-6 3 3 0 000 6zM2 14c0-2.5 2.5-4 6-4s6 1.5 6 4" /></svg>
          </span>
          <span class="flex-1 text-sm font-medium">关于</span>
          <span class="text-xs text-ink-dim/70">v1.23</span>
        </div>
      </section>

      <!-- 导入结果反馈 -->
      <p
        v-if="importMsg"
        data-import-msg
        class="px-1 text-center text-xs"
        :class="importMsg.startsWith('导入成功') || importMsg.startsWith('已导出') ? 'text-primary-500' : 'text-red-400'"
      >
        {{ importMsg }}
      </p>
    </main>
    </div><!-- /内容平移层 -->

    <!-- 退出预备提示条（v1.17：2 秒内再按返回键才退出） -->
    <Transition name="fade">
      <div
        v-if="backHint"
        class="fixed bottom-20 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-xs font-medium text-white shadow-lg"
      >{{ backHint }}</div>
    </Transition>

    <!-- 底部导航：app 感的核心 -->
    <nav
      class="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card/85 backdrop-blur-lg"
      style="padding-bottom: env(safe-area-inset-bottom)"
    >
      <div class="relative mx-auto grid max-w-md grid-cols-3 px-6 py-2">
        <!-- 滑块：一个药丸在三个槽位间连续滑动，连点时 transition 自动改道（可打断） -->
        <div class="pointer-events-none absolute inset-0 overflow-hidden">
          <div class="absolute inset-y-0 left-6 right-6">
            <div
              class="flex h-full w-1/3 justify-center transition-transform duration-300"
              style="transition-timing-function: cubic-bezier(0.32, 0.72, 0.35, 1)"
              :style="{ transform: `translateX(${tabIndex * 100}%)` }"
            >
              <!-- 药丸顶=容器py-2(8px)+按钮pt-1.5(6px)=14px，与图标 wrapper 逐像素重叠 -->
              <span class="mt-3.5 h-8 w-12 rounded-full bg-primary-50"></span>
            </div>
          </div>
        </div>
        <button
          v-for="t in [
            { key: 'today', label: '今日', icon: 'M8 3a5 5 0 100 10A5 5 0 008 3zM8 1v2M8 13v2M1 8h2M13 8h2' },
            { key: 'week', label: '周课表', icon: 'M2 4h12v11H2zM2 7h12M5.5 2v3M10.5 2v3' },
            { key: 'me', label: '我的', icon: 'M8 8a3 3 0 100-6 3 3 0 000 6zM2 14c0-2.5 2.5-4 6-4s6 1.5 6 4' },
          ]"
          :key="t.key"
          class="relative flex flex-col items-center pt-1.5 pb-1.5 transition-transform duration-150 active:scale-90"
          :class="tab === t.key ? 'text-primary-500' : 'text-ink-dim/70'"
          @click="switchTab(t.key)"
        >
          <span
            v-if="t.key === 'today' && undoneCount"
            class="absolute -top-1.5 -right-2.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-400 px-1 text-[10px] font-bold text-white"
          >{{ undoneCount }}</span>
          <!-- 图标 wrapper：h-8 w-12 与滑块药丸同尺寸同位置，图标在药丸内绝对居中 -->
          <span class="relative flex h-8 w-12 items-center justify-center">
            <svg viewBox="0 0 16 16" class="h-5.5 w-5.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path :d="t.icon" />
            </svg>
          </span>
          <span class="mt-0.5 text-[10px] font-medium">{{ t.label }}</span>
        </button>
      </div>
    </nav>

    <!-- 课程详情弹层：点课卡弹出 -->
    <Transition name="fade">
      <div v-if="detail" class="fixed inset-0 z-20 bg-black/40" @click="detail = null"></div>
    </Transition>
    <Transition name="slide">
      <div
        v-if="detail"
        class="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
      >
        <!-- 顶部小把手（暗示可下滑关闭） -->
        <div class="mx-auto mb-4 h-1 w-9 rounded-full bg-ink/15"></div>
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate text-lg font-bold">{{ detail.name }}</p>
            <p class="mt-1 text-xs text-ink-dim">
              {{ detail.type === 'event' ? detail.date : WDN[(detail.weekday || 1) - 1] }}
              <span v-if="detail.tag" class="ml-1.5 rounded-full bg-primary-50 px-2 py-0.5 text-primary-600">{{ detail.tag }}</span>
            </p>
          </div>
          <button
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink/5 text-ink-dim transition active:scale-90"
            @click="detail = null"
          >
            <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
          </button>
        </div>
        <div class="mt-4 space-y-2.5">
          <div class="flex items-center gap-3 rounded-xl bg-primary-50/60 px-3.5 py-3">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 shrink-0 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></svg>
            <div class="min-w-0">
              <p class="text-sm font-medium">{{ detail.start }} – {{ detail.end }}</p>
              <p class="text-[11px] text-ink-dim">
                共 {{ minOf(detail.end) - minOf(detail.start) }} 分钟
                <span v-if="periodSpan(detail)" class="ml-1 rounded-full bg-primary-500/10 px-1.5 py-0.5 text-primary-600">{{ periodSpan(detail) }}</span>
              </p>
            </div>
          </div>
          <div class="flex items-center gap-3 rounded-xl bg-ink/[0.04] px-3.5 py-3">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 shrink-0 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5L8 2l6 4.5V14a.5.5 0 01-.5.5h-11A.5.5 0 012 14z" /><path d="M6 14.5V9h4v5.5" /></svg>
            <div class="min-w-0">
              <p class="text-sm font-medium">{{ detail.place || '未填写地点' }}</p>
              <p class="text-[11px] text-ink-dim">地点</p>
            </div>
          </div>
        </div>
        <!-- 所有课程都可编辑/删除：自加课改覆盖层，导入课改原始导出文本（随回写带回主项目），mock 课改示例覆盖层 -->
        <div v-if="detail.type === 'course'" class="mt-4 grid grid-cols-2 gap-2.5">
          <button
            class="rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
            @click="editCourseFromDetail"
          >
            编辑
          </button>
          <button
            class="rounded-xl border py-2.5 text-sm font-medium transition active:scale-[0.98]"
            :class="confirmDel ? 'border-red-400 bg-red-400/10 text-red-500' : 'border-red-200 text-red-400'"
            @click="onDelCourse"
          >
            {{ confirmDel ? '再点一次确认' : '删除' }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- 添加课程面板：长按/双击周网格空白处唤起 -->
    <Transition name="fade">
      <div v-if="addForm" class="fixed inset-0 z-20 bg-black/40" @click="addForm = null"></div>
    </Transition>
    <Transition name="slide">
      <div
        v-if="addForm"
        class="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
      >
        <div class="mx-auto mb-3 h-1 w-9 rounded-full bg-ink/15"></div>
        <p class="text-base font-bold">{{ addForm.editingId ? '编辑课程' : '添加课程' }} · {{ WDN[addForm.weekday - 1] }}</p>
        <div class="mt-4 space-y-3">
          <input
            v-model="addForm.name"
            placeholder="课程名称（必填）"
            class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
          />
          <!-- 时间：点哪填哪，左右微调 -->
          <div class="flex items-center gap-2.5">
            <div class="flex flex-1 items-center justify-between rounded-xl border border-line bg-canvas px-2 py-1.5">
              <button class="flex h-8 w-8 items-center justify-center rounded-lg text-ink-dim active:bg-ink/10" @click="stepStart(-5)">
                <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5" /></svg>
              </button>
              <span class="text-sm font-semibold tabular-nums">{{ addForm.start }}</span>
              <button class="flex h-8 w-8 items-center justify-center rounded-lg text-ink-dim active:bg-ink/10" @click="stepStart(5)">
                <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
              </button>
            </div>
            <button
              v-for="d in DURATIONS"
              :key="d"
              class="rounded-full px-2.5 py-1.5 text-xs font-medium transition active:scale-95"
              :class="addForm.duration === d ? 'bg-primary-500 text-white' : 'bg-ink/5 text-ink-dim'"
              @click="addForm.duration = d"
            >
              {{ d }}分
            </button>
          </div>
          <input
            v-model="addForm.place"
            placeholder="地点（选填）"
            class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
          />
          <!-- 周次规则 -->
          <div class="flex gap-2">
            <button
              v-for="r in [{ k: 'every', n: '每周' }, { k: 'odd', n: '单周' }, { k: 'even', n: '双周' }]"
              :key="r.k"
              class="flex-1 rounded-xl border py-2 text-xs font-medium transition active:scale-[0.97]"
              :class="addForm.week_rule === r.k ? 'border-primary-400 bg-primary-50 text-primary-600' : 'border-line text-ink-dim'"
              @click="addForm.week_rule = r.k"
            >
              {{ r.n }}
            </button>
          </div>
        </div>
        <p v-if="addWarn" class="mt-2.5 rounded-xl border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-500">{{ addWarn }}</p>
        <p v-if="addErr" class="mt-2.5 text-xs text-red-400">{{ addErr }}</p>
        <div class="mt-4 flex gap-2.5">
          <button
            class="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
            @click="addForm = null"
          >
            取消
          </button>
          <button
            class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
            @click="submitAdd"
          >
            {{ addForm.editingId ? '保存修改' : '添加' }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- 待办增删改面板：点待办文字编辑，＋添加待办新增 -->
    <Transition name="fade">
      <div v-if="todoForm" class="fixed inset-0 z-20 bg-black/40" @click="todoForm = null"></div>
    </Transition>
    <Transition name="slide">
      <div
        v-if="todoForm"
        class="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
      >
        <div class="mx-auto mb-3 h-1 w-9 rounded-full bg-ink/15"></div>
        <p class="text-base font-bold">{{ todoForm.id ? '编辑待办' : '添加待办' }}</p>
        <div class="mt-4 space-y-3">
          <input
            v-model="todoForm.title"
            placeholder="要做什么？（必填）"
            class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
          />
          <button
            type="button"
            class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-left text-sm tabular-nums transition active:scale-[0.99]"
            :class="todoForm.due_date ? 'text-ink' : 'text-ink-dim/50'"
            @click="openDateField({ value: todoForm.due_date, onDone: (v) => (todoForm.due_date = v) })"
          >
            {{ todoForm.due_date || '哪天前做完？（可选）' }}
          </button>
        </div>
        <p v-if="todoErr" class="mt-2.5 text-xs text-red-400">{{ todoErr }}</p>
        <div class="mt-4 flex gap-2.5">
          <button
            v-if="todoForm.id"
            class="rounded-xl border py-2.5 px-4 text-sm font-medium transition active:scale-[0.98]"
            :class="confirmDelTodo ? 'border-red-400 bg-red-400/10 text-red-500' : 'border-red-200 text-red-400'"
            @click="onDeleteTodo"
          >
            {{ confirmDelTodo ? '再点一次确认' : '删除' }}
          </button>
          <button
            class="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
            @click="todoForm = null"
          >
            取消
          </button>
          <button
            class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
            @click="submitTodo"
          >
            {{ todoForm.id ? '保存修改' : '添加' }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- 独立日程添加面板：今日视图「＋ 添加日程」唤起 -->
    <Transition name="fade">
      <div v-if="evtForm" class="fixed inset-0 z-20 bg-black/40" @click="evtForm = null"></div>
    </Transition>
    <Transition name="slide">
      <div
        v-if="evtForm"
        class="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
      >
        <div class="mx-auto mb-3 h-1 w-9 rounded-full bg-ink/15"></div>
        <p class="text-base font-bold">添加日程</p>
        <div class="mt-4 space-y-3">
          <input
            v-model="evtForm.title"
            placeholder="日程名称，如：班会（必填）"
            class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
          />
          <div class="flex gap-2.5">
            <button
              type="button"
              class="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2.5 text-left text-sm tabular-nums transition active:scale-[0.99]"
              :class="evtForm.date ? 'text-ink' : 'text-ink-dim/50'"
              @click="openDateField({ value: evtForm.date, onDone: (v) => (evtForm.date = v) })"
            >
              {{ evtForm.date || '日期' }}
            </button>
            <button
              type="button"
              class="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2.5 text-left text-sm tabular-nums transition active:scale-[0.99]"
              :class="evtForm.start ? 'text-ink' : 'text-ink-dim/50'"
              @click="openTimeField({ value: evtForm.start, onDone: (v) => (evtForm.start = v) })"
            >
              {{ evtForm.start || '几点开始' }}
            </button>
          </div>
          <div class="flex items-center gap-2.5">
            <button
              v-for="d in DURATIONS"
              :key="d"
              class="flex-1 rounded-full py-1.5 text-xs font-medium transition active:scale-95"
              :class="evtForm.duration === d ? 'bg-primary-500 text-white' : 'bg-ink/5 text-ink-dim'"
              @click="evtForm.duration = d"
            >
              {{ d }}分
            </button>
          </div>
          <input
            v-model="evtForm.place"
            placeholder="地点（选填）"
            class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
          />
        </div>
        <p v-if="evtErr" class="mt-2.5 text-xs text-red-400">{{ evtErr }}</p>
        <div class="mt-4 flex gap-2.5">
          <button
            class="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
            @click="evtForm = null"
          >
            取消
          </button>
          <button
            class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
            @click="submitEvent"
          >
            添加
          </button>
        </div>
      </div>
    </Transition>

    <!-- 学期信息/节次表编辑弹层 -->
    <Transition name="fade">
      <div v-if="semForm" class="fixed inset-0 z-20 bg-black/40" @click="semForm = null"></div>
    </Transition>
    <Transition name="slide">
      <div
        v-if="semForm"
        class="fixed inset-x-0 bottom-0 z-30 mx-auto max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
      >
        <div class="mx-auto mb-3 h-1 w-9 rounded-full bg-ink/15"></div>
        <p class="text-base font-bold">编辑学期</p>

        <div class="mt-4 space-y-3">
          <input
            v-model="semForm.name"
            placeholder="学期名称"
            class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
          />
          <label class="block">
            <span class="mb-1 block text-xs text-ink-dim">第一周的周一（决定「第几周」怎么算）</span>
            <button
              type="button"
              class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-left text-sm tabular-nums transition active:scale-[0.99]"
              :class="semForm.first_monday ? 'text-ink' : 'text-ink-dim/50'"
              @click="openDateField({ value: semForm.first_monday, restrictMonday: true, onDone: (v) => (semForm.first_monday = v) })"
            >
              {{ semForm.first_monday || '选一个周一' }}
            </button>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs text-ink-dim">总周数（1–30）</span>
            <input
              v-model.number="semForm.total_weeks"
              type="number"
              min="1"
              max="30"
              step="1"
              class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm tabular-nums outline-none focus:border-primary-400"
            />
          </label>
        </div>

        <!-- 节次表（分段式：段内改参数只重排本段，午休/大课间原样保留） -->
        <p class="mt-5 text-sm font-semibold">节次时间表</p>
        <p class="mt-1 text-[11px] text-ink-dim">改「每节 / 课间」只重排本段（午休、大课间不动）；改某节开始时间本段后面整体顺移；全部删掉 = 不设置节次（周视图回落默认节次表）</p>
        <div class="mt-2">
          <PeriodsEditor
            v-model="semForm.periods"
            :open-time="openTimeField"
            :fallback="DEFAULT_PERIODS"
            @error="(m) => (semErr = m)"
          />
        </div>

        <p v-if="semErr" class="mt-3 text-xs text-red-400">{{ semErr }}</p>
        <div class="mt-4 flex gap-2.5">
          <button
            class="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
            @click="semForm = null"
          >
            取消
          </button>
          <button
            class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
            @click="saveSemEdit"
          >
            保存
          </button>
        </div>
      </div>
    </Transition>

    <!-- 共享 picker 弹层：日期月历 / 时间滚轮（叠在表单 sheet 之上） -->
    <Transition name="fade">
      <div v-if="picker" class="fixed inset-0 z-40 bg-black/40" @click="picker = null"></div>
    </Transition>
    <Transition name="slide">
      <div
        v-if="picker"
        class="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
      >
        <div class="mx-auto mb-3 h-1 w-9 rounded-full bg-ink/15"></div>
        <div class="mb-3 flex items-center justify-between">
          <button class="rounded-lg px-2 py-1 text-sm text-ink-dim transition active:bg-ink/10" @click="picker = null">取消</button>
          <p class="text-sm font-bold text-ink">{{ picker.title || (picker.type === 'date' ? '选择日期' : picker.type === 'number' ? '选择数值' : '选择时间') }}</p>
          <button class="rounded-lg px-2 py-1 text-sm font-semibold text-primary-600 transition active:bg-primary-50" @click="pickerConfirm">确定</button>
        </div>
        <MonthCalendar
          v-if="picker.type === 'date'"
          v-model="picker.value"
          :restrict-monday="picker.restrictMonday"
        />
        <NumberWheel v-else-if="picker.type === 'number'" ref="pickerRef" :model-value="picker.value" :min="picker.min" :max="picker.max" :step="picker.step" :unit="picker.unit" />
        <TimeWheel v-else ref="pickerRef" :model-value="picker.value" />
      </div>
    </Transition>

    <!-- 清除数据二次确认（对齐主项目 confirmResetModal：自建弹窗，不用原生 confirm） -->
    <Transition name="fade">
      <div v-if="confirmClear" class="fixed inset-0 z-40 bg-black/40" @click="confirmClear = false"></div>
    </Transition>
    <Transition name="slide">
      <div
        v-if="confirmClear"
        class="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
      >
        <div class="mx-auto mb-4 h-1 w-9 rounded-full bg-ink/15"></div>
        <h2 class="text-lg font-bold">确认清除全部数据</h2>
        <p class="mt-2 text-xs text-ink-dim">将清空学期、课程、日程与待办并回到初始设定，无法恢复。</p>
        <div class="mt-5 grid grid-cols-2 gap-2.5">
          <button
            class="rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
            @click="confirmClear = false"
          >
            取消
          </button>
          <button
            class="rounded-xl border border-red-400 bg-red-400/10 py-2.5 text-sm font-medium text-red-500 transition active:scale-[0.98]"
            @click="doClearData"
          >
            确认清除
          </button>
        </div>
      </div>
    </Transition>

    <!-- 删除录音场次二次确认（长按触发；不用原生 confirm，样式对齐清除数据弹层） -->
    <Transition name="fade">
      <div v-if="delLec" class="fixed inset-0 z-40 bg-black/40" @click="delLecId = null"></div>
    </Transition>
    <Transition name="slide">
      <div
        v-if="delLec"
        class="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
      >
        <div class="mx-auto mb-4 h-1 w-9 rounded-full bg-ink/15"></div>
        <h2 class="text-lg font-bold">删除这场录音？</h2>
        <p class="mt-2 text-xs text-ink-dim">「{{ delLec.title }}」及其录音文件、文字稿和纪要将一并删除，无法恢复。</p>
        <div class="mt-5 grid grid-cols-2 gap-2.5">
          <button
            class="rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
            @click="delLecId = null"
          >
            取消
          </button>
          <button
            class="rounded-xl border border-red-400 bg-red-400/10 py-2.5 text-sm font-medium text-red-500 transition active:scale-[0.98]"
            @click="doDeleteLecture"
          >
            删除
          </button>
        </div>
      </div>
    </Transition>

    <!-- 初始设定引导页：首次打开出现，选一次就记住 -->
    <Transition name="fade">
      <div v-if="onboarding" class="fixed inset-0 z-40 overflow-y-auto bg-canvas" :data-ob-step="onboardStepNo">
        <div class="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-10">
          <div v-if="!recFromMine" class="mb-7 text-center">
            <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-primary-400 to-primary-600 text-2xl font-bold text-white shadow-lg shadow-primary-500/25">
              日
            </div>
            <h1 class="text-xl font-bold">欢迎来到日程助手</h1>
            <p class="mt-1.5 text-sm text-ink-dim">把课表和 deadline 收进同一张时间轴</p>
          </div>

          <!-- 三步指示（第 1 步学期与节次 / 第 2 步识别课表 / 第 3 步核对导入）；mine 入口不走三步流程，不显示 -->
          <div v-if="onboardStep !== 'choice' && !recFromMine" class="mb-4 flex items-center justify-center gap-1.5">
            <template v-for="(lb, i) in OB_STEP_LABELS" :key="lb">
              <div
                :data-step-item="i + 1"
                :aria-current="onboardStepNo === i + 1 ? 'step' : undefined"
                class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition"
                :class="onboardStepNo === i + 1
                  ? 'bg-primary-500/10 font-semibold text-primary-600'
                  : 'text-ink-dim/70'"
              >
                <span
                  class="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold"
                  :class="onboardStepNo >= i + 1 ? 'bg-primary-500 text-white' : 'bg-ink/10 text-ink-dim'"
                >{{ i + 1 }}</span>
                {{ lb }}
              </div>
              <span v-if="i < OB_STEP_LABELS.length - 1" class="h-px w-2.5 bg-line"></span>
            </template>
          </div>

          <template v-if="onboardStep === 'choice'">
            <button
              class="w-full rounded-2xl border border-line bg-card p-4 text-left shadow-sm transition active:scale-[0.98]"
              @click="finishOnboarding"
            >
              <p class="text-sm font-semibold">先用示例数据逛逛</p>
              <p class="mt-1 text-xs text-ink-dim">一套假数据体验全部功能，随时可在「我的」页换成真实课表</p>
            </button>
            <button
              class="mt-3 w-full rounded-2xl border border-primary-200 bg-primary-50/60 p-4 text-left shadow-sm transition active:scale-[0.98]"
              @click="onboardImport"
            >
              <p class="text-sm font-semibold text-primary-600">导入主项目数据</p>
              <p class="mt-1 text-xs text-ink-dim">在主项目「导出/备份」生成 JSON 文件，在这里选中它</p>
            </button>
          <button
            class="mt-3 w-full rounded-2xl border border-line bg-card p-4 text-left shadow-sm transition active:scale-[0.98]"
            @click="goObForm"
          >
            <p class="text-sm font-semibold">直接填学期信息，自己加课</p>
            <p class="mt-1 text-xs text-ink-dim">三步走：先填学期与节次表 → 再拍课表截图识别（也可以跳过）→ 核对后入库</p>
          </button>
          <p v-if="obImportMsg" class="mt-2 px-1 text-xs text-red-500">{{ obImportMsg }}</p>
          </template>

          <!-- 第 2 步：识别课表（用户反馈：先在第 1 步设好节次，这一页只负责选图识别） -->
          <template v-else-if="onboardStep === 'rec'">
            <div class="rounded-2xl border border-line bg-card p-4 shadow-sm">
              <p class="text-sm font-semibold">拍课表识别</p>
              <p class="mt-1 text-xs text-ink-dim">截图里能看清「星期 × 第几节 × 课程名」就够。图上写的时间是学校自己的作息（课表截图上常是期末考时间），识别只取第几节，时间按下面这张表换算。</p>

              <!-- 本次换算用的节次表：让「节次先设好」这件事在识别前可见、可改。
                   mine 入口 = 当前学期的节次表（recPeriods 已切源）；引导页 = 第 1 步里那张 -->
              <div class="mt-3 rounded-xl bg-ink/[0.04] px-3 py-2.5" data-ob-summary>
                <p class="text-xs font-semibold">本次换算用的节次表</p>
                <p class="mt-0.5 text-[11px] text-ink-dim">{{ recFromMine ? '识别结果只给第几节，上课时间按你当前学期的这张表算' : '识别结果只给第几节，上课时间按这张表算' }}</p>
                <template v-if="recFromMine || obForm.periods.length">
                  <p class="mt-1.5 text-[11px] tabular-nums text-ink-dim">共 {{ recPeriods.length }} 节 · 分 {{ recSegView.length }} 段</p>
                  <p class="mt-0.5 text-[11px] leading-relaxed tabular-nums text-ink-dim">
                    <span v-for="(g, i) in recSegView" :key="g.seg" class="inline-block"><template v-if="i">&nbsp;·&nbsp;</template>第 {{ g.nos[0] }}<template v-if="g.nos.length > 1">–{{ g.nos[g.nos.length - 1] }}</template> 节 {{ g.start }}–{{ g.end }}</span>
                  </p>
                </template>
                <p v-else class="mt-1.5 text-[11px] leading-relaxed text-ink-dim">你没设置节次表，按默认 13 节换算（上午 5 节 · 下午 5 节 · 晚上 3 节；每节 45 分钟、课间 10 分钟，午休/晚休时段可在上一步改）</p>
                <button
                  v-if="!recFromMine"
                  type="button"
                  data-ob-edit-periods
                  class="mt-2 rounded-lg border border-line bg-card px-2.5 py-1 text-[11px] font-medium text-ink-dim transition active:scale-95"
                  @click="recBackForm"
                >
                  ← 改节次表 / 学期信息
                </button>
                <p v-else class="mt-2 text-[11px] text-ink-dim">节次表不对？点「取消识别」后在学期卡片的 ✎ 编辑里改</p>
              </div>

              <button
                type="button"
                data-ob-rec
                class="mt-3 w-full rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
                :class="obRecBusy ? 'opacity-60' : ''"
                :disabled="obRecBusy"
                @click="obRecClick"
              >
                {{ obRecBusy ? '识别中…（大约十几秒，别退出去）' : '选课表截图 / 拍照识别' }}
              </button>
              <p class="mt-1.5 px-1 text-[11px] text-ink-dim">用已配置的 DeepSeek Key（与课堂纪要共用）；识别结果会先给你逐条核对，改完才入库</p>
              <p v-if="obRecErr" class="mt-2 px-1 text-xs text-red-500" data-ob-rec-err>{{ obRecErr }}</p>

              <!-- 手动输入入口：不想识别 / 识别不全时，直接手动补课进核对页 -->
              <button
                type="button"
                data-ob-manual
                class="mt-2.5 w-full rounded-xl border border-dashed border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                @click="obManualAdd"
              >
                ＋ 不识别了，手动加一门课
              </button>

              <!-- 已识别过一次：可以直接回到核对，也可以重新选图 -->
              <div v-if="recPreview" data-ob-rec-done class="mt-3 rounded-xl border border-line bg-canvas px-3 py-2.5">
                <p class="text-xs">已有识别结果（{{ recPreview.items.length }} 门课），可以直接核对，也可以重新选图识别</p>
                <button
                  type="button"
                  data-ob-rec-continue
                  class="mt-2 w-full rounded-lg bg-primary-500 py-2 text-xs font-semibold text-white transition active:scale-[0.98]"
                  @click="onboardStep = 'recConfirm'"
                >
                  继续核对这 {{ recPreview.items.length }} 门课
                </button>
              </div>

              <button
                v-if="!recFromMine"
                type="button"
                class="mt-3 w-full rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                @click="recBackForm"
              >
                返回上一步
              </button>
              <button
                v-else
                type="button"
                data-mine-rec-cancel
                class="mt-3 w-full rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                @click="mineRecCancel"
              >
                取消识别
              </button>
            </div>
          </template>

          <!-- 第 3 步：课表识别确认页 —— 逐条核对/修改后与手填学期一起入库 -->
          <template v-else-if="onboardStep === 'recConfirm'">
            <div class="rounded-2xl border border-line bg-card p-4 shadow-sm">
              <p class="text-sm font-semibold">共 {{ recPreview.items.length }} 门课，核对后导入</p>
              <p class="mt-1 text-xs text-ink-dim">卡片里的课程名、星期、节次、周次、地点都能直接改；不要的课点垃圾桶删掉</p>

              <div v-if="recPreview.warnings.length" class="mt-2.5 rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600">
                <span v-for="(w, i) in recPreview.warnings" :key="i" class="block">{{ w }}</span>
              </div>

              <div class="mt-3 space-y-2">
                <div v-for="(it, i) in recPreview.items" :key="i" data-rec-item class="rounded-xl border border-line bg-canvas p-3">
                  <div class="flex items-start gap-2.5">
                    <button
                      type="button"
                      class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition"
                      :class="it.selected ? 'border-primary-500 bg-primary-500 text-white' : 'border-line text-transparent'"
                      :aria-label="it.selected ? '取消选择这门课' : '选择这门课'"
                      @click="it.selected = !it.selected"
                    >
                      <svg viewBox="0 0 16 16" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
                    </button>
                    <div class="min-w-0 flex-1">
                      <input
                        v-model="it.title"
                        maxlength="30"
                        placeholder="课程名"
                        class="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-primary-400"
                      />
                      <div class="mt-2 grid grid-cols-2 gap-2">
                        <label class="flex items-center gap-1.5 text-[11px] text-ink-dim">
                          星期
                          <select v-model.number="it.weekday" class="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                            <option v-for="(w, wi) in WEEKDAY_LABELS" :key="wi" :value="wi + 1">{{ w }}</option>
                          </select>
                        </label>
                        <label class="flex items-center gap-1.5 text-[11px] text-ink-dim">
                          周次
                          <select v-model="it.weekRule" class="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                            <option value="every">每周</option>
                            <option value="odd">单周</option>
                            <option value="even">双周</option>
                          </select>
                        </label>
                        <label class="flex items-center gap-1.5 text-[11px] text-ink-dim">
                          从第
                          <select v-model.number="it.startSec" class="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                            <option v-for="n in recSecOptions()" :key="n" :value="n">{{ n }} 节</option>
                          </select>
                        </label>
                        <label class="flex items-center gap-1.5 text-[11px] text-ink-dim">
                          到第
                          <select v-model.number="it.endSec" class="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                            <option v-for="n in recSecOptions()" :key="n" :value="n">{{ n }} 节</option>
                          </select>
                        </label>
                      </div>
                      <p class="mt-1.5 text-[11px]" :class="recTimeRange(it) ? 'text-ink-dim' : 'text-red-400'">
                        {{ recTimeRange(it) ? '上课时间 ' + recTimeRange(it) : '节次超出当前节次表，导入时会跳过这门课' }}
                      </p>
                      <div class="mt-2 grid grid-cols-2 gap-2">
                        <input v-model="it.location" maxlength="30" placeholder="地点（可留空）" class="min-w-0 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary-400" />
                        <input v-model="it.teacher" maxlength="20" placeholder="教师（可留空）" class="min-w-0 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary-400" />
                      </div>
                    </div>
                    <button
                      type="button"
                      class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-red-300 transition active:scale-90"
                      aria-label="删除这条识别结果"
                      @click="recRemove(i)"
                    >
                      <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5h10M6.5 5V3.5h3V5M5 5l.6 8h4.8L11 5" /></svg>
                    </button>
                  </div>
                </div>
              </div>

              <p v-if="recPreview.notes.length" class="mt-2.5 text-[11px] text-ink-dim">图片里看不清的地方：{{ recPreview.notes.join('；') }}</p>
              <p v-if="obRecErr" class="mt-2.5 text-xs text-red-400">{{ obRecErr }}</p>

              <div class="mt-4 flex gap-2.5">
                <button
                  data-rec-back-rec
                  class="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                  @click="recBack"
                >
                  返回识别页
                </button>
                <button
                  data-rec-import
                  class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
                  @click="recImport"
                >
                  {{ recFromMine ? '导入选中的 ' + recSelectedCount + ' 门课' : '导入选中的 ' + recSelectedCount + ' 门课，开始使用' }}
                </button>
              </div>
            </div>
          </template>

          <!-- 第 1 步：开学时间 / 本学期周数 / 课程时间设置（Day 14 用户测试反馈：
               原页文字、按钮、功能太多；重构为三项，节次编辑收进二级页） -->
          <template v-else-if="onboardStep === 'form' || onboardStep === 'periods'">
            <div class="relative overflow-hidden rounded-2xl border border-line bg-card p-4 shadow-sm">
              <Transition :name="obPageDir">
              <div v-if="onboardStep === 'form'" key="ob-form">
                <!-- ① 开学时间：弹层月历任意日期可点，内部归一到所在周周一 -->
                <button
                  type="button"
                  data-ob-start
                  class="mt-1 flex w-full items-center justify-between rounded-xl border border-line bg-canvas px-3.5 py-3 text-left transition active:scale-[0.99]"
                  @click="obPickStart"
                >
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold">开学时间</span>
                    <span class="mt-0.5 block truncate text-[11px]" :class="obStartHint.bad ? 'text-red-400' : 'text-ink-dim'">{{ obStartHint.t }}</span>
                  </span>
                  <span class="shrink-0 text-xs font-medium" :class="obForm.first_monday ? 'text-primary-600' : 'text-ink-dim'">{{ obForm.first_monday || '选日期' }}</span>
                </button>

                <!-- ② 本学期周数：数字滚轮 -->
                <button
                  type="button"
                  data-ob-weeks
                  class="mt-2.5 flex w-full items-center justify-between rounded-xl border border-line bg-canvas px-3.5 py-3 text-left transition active:scale-[0.99]"
                  @click="obPickWeeks"
                >
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold">本学期周数</span>
                    <span class="mt-0.5 block text-[11px] text-ink-dim">假期不算，只算要上课的周</span>
                  </span>
                  <span class="shrink-0 text-sm font-semibold tabular-nums text-primary-600">{{ obForm.total_weeks }} 周</span>
                </button>

                <!-- ③ 课程时间设置：二级页 -->
                <button
                  type="button"
                  data-ob-time
                  class="mt-2.5 flex w-full items-center justify-between rounded-xl border border-line bg-canvas px-3.5 py-3 text-left transition active:scale-[0.99]"
                  @click="goObPeriods"
                >
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold">课程时间设置</span>
                    <span class="mt-0.5 block truncate text-[11px] text-ink-dim">{{ obTimeSummary }}，点进去可调</span>
                  </span>
                  <svg viewBox="0 0 16 16" class="h-4 w-4 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
                </button>

                <p v-if="obErr" class="mt-2.5 text-xs text-red-400" data-ob-err>{{ obErr }}</p>
                <div class="mt-4 flex gap-2.5">
                  <button
                    class="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                    @click="onboardStep = 'choice'"
                  >
                    返回
                  </button>
                  <button
                    data-ob-goto-rec
                    class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
                    @click="goObRec"
                  >
                    下一步：识别课表
                  </button>
                </div>
                <button
                  data-ob-skip-rec
                  class="mt-2.5 w-full rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                  @click="obSubmit"
                >
                  先跳过识别，自己加课
                </button>
              </div>

              <!-- ③ 的二级页：单节时长 / 课间（滚轮） + 上午/下午/晚上三块 -->
              <div v-else key="ob-periods">
                <div class="flex items-center justify-between">
                  <p class="text-sm font-semibold">课程时间设置</p>
                  <button type="button" data-ob-time-back class="rounded-lg px-2 py-1 text-xs font-medium text-primary-600 transition active:bg-primary-50" @click="backObForm">完成</button>
                </div>
                <p class="mt-1 text-[11px] text-ink-dim">改时长或课间，三块时间自动重排；开学时间在上一页</p>

                <div class="mt-3 grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    data-ob-dur
                    class="rounded-xl border border-line bg-canvas px-3 py-2.5 text-left transition active:scale-[0.99]"
                    @click="obPickDur"
                  >
                    <span class="block text-[11px] text-ink-dim">单节课程时长</span>
                    <span class="mt-0.5 block text-sm font-semibold tabular-nums text-primary-600">{{ obGlobal.dur }} 分钟</span>
                  </button>
                  <button
                    type="button"
                    data-ob-gap
                    class="rounded-xl border border-line bg-canvas px-3 py-2.5 text-left transition active:scale-[0.99]"
                    @click="obPickGap"
                  >
                    <span class="block text-[11px] text-ink-dim">课间休息时长</span>
                    <span class="mt-0.5 block text-sm font-semibold tabular-nums text-primary-600">{{ obGlobal.gap }} 分钟</span>
                  </button>
                </div>

                <div v-for="g in obSegGroups" :key="g.seg" class="mt-3 rounded-xl border border-line bg-canvas p-2.5" :data-ob-seg="g.seg">
                  <div class="flex items-center justify-between px-0.5">
                    <p class="text-xs font-semibold">{{ g.name }} · 第 {{ g.nos[0] }}–{{ g.nos[g.nos.length - 1] }} 节</p>
                    <p class="text-[11px] tabular-nums text-ink-dim">{{ g.start }}–{{ g.end }}</p>
                  </div>
                  <div class="mt-1.5 space-y-1">
                    <div v-for="i in g.nos.length" :key="g.from + i - 1" class="flex items-center gap-2 rounded-lg bg-card px-2 py-1.5" :data-ob-period-row="obForm.periods[g.from + i - 1].no">
                      <span class="w-8 shrink-0 text-[11px] font-semibold text-ink-dim">第{{ obForm.periods[g.from + i - 1].no }}节</span>
                      <button
                        type="button"
                        class="min-w-0 flex-1 rounded-md border border-line bg-card px-2 py-1 text-center text-xs tabular-nums transition active:scale-[0.98]"
                        @click="obPickPeriodStart(g.from + i - 1)"
                      >
                        {{ obForm.periods[g.from + i - 1].start }}
                      </button>
                      <span class="shrink-0 text-[11px] text-ink-dim">–</span>
                      <span class="min-w-0 flex-1 text-center text-xs tabular-nums">{{ obForm.periods[g.from + i - 1].end }}</span>
                      <button
                        type="button"
                        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-red-300 transition active:scale-90"
                        :aria-label="'删除第 ' + obForm.periods[g.from + i - 1].no + ' 节'"
                        @click="obRemovePeriod(g.from + i - 1)"
                      >
                        <svg viewBox="0 0 16 16" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5h10M6.5 5V3.5h3V5M5 5l.6 8h4.8L11 5" /></svg>
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="mt-2 w-full rounded-lg border border-dashed border-line py-1.5 text-[11px] font-medium text-ink-dim transition active:scale-[0.98]"
                    :data-ob-seg-add="g.seg"
                    @click="obAddPeriod(g.seg)"
                  >
                    ＋ 加一节
                  </button>
                </div>

                <p v-if="obErr" class="mt-2.5 text-xs text-red-400" data-ob-err>{{ obErr }}</p>
              </div>
              </Transition>
            </div>
          </template>

                    <p class="mt-6 text-center text-[11px] text-ink-dim/70">这个选择只记一次，之后随时可以在「我的」页切换示例或导入</p>
          <input ref="onboardFile" type="file" accept=".json,application/json" class="hidden" @change="onOnboardFile" />
          <input ref="obRecFile" type="file" accept="image/*" class="hidden" @change="onObRecFile" />
        </div>
      </div>
    </Transition>
  </div>
</template>
