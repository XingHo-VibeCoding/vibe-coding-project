<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { loadDataset, importFromText, clearImport, matchWeek, minOf, addCourse, dedupAdded, countAddedDups, removeCourse, updateCourse, updateImportedCourse, removeImportedCourse, patchMockCourse, removeMockCourse, findConflicts, dayScope, exportImportedText, addTodo, patchTodo, removeTodoById, addEvent, addRoutine, updateRoutine, removeRoutine, periodsOf, createManualSemester, updateImportedSemester, LECTURES_KEY, loadLectures, addLecture, updateLecture, removeLecture, setLectureSummary, courseCovering, nextCourseDate, HABITS_KEY, loadHabits, addHabit, removeHabit, toggleHabitRecord, streakOf, todayKeyOf, isGraceKey, graceKeysOf, isBackfilled, totalDoneOf, weekMondayKeyOf, ADDED_KEY, TODOS_KEY, EVENTS_KEY, COURSE_OV_KEY } from './data/store.js'
import { normalizeSegs, segmentView, reperiodAll, shiftWithinSegment, addPeriodToSegment, removePeriodAt } from './data/periods.js'
import { GRID_AXIS_W, buildGridRows, rowIndexMap, courseItems, previewItems, gridStyleOf, isAligned, findCellOverlaps, secRowRange, clampCoursesToSegments } from './data/weekGrid.js'
import { recorderAvailable, ensureMicPermission, startRecording as recStart, stopRecording as recStop, resolvePlayableUri, statClip, deleteClipFile, startKeepAlive, stopKeepAlive, keepAliveRunning, scheduleAutoStop, consumeAutoStop } from './data/recorder.js'
import { transcriberAvailable, modelState, ensureModel, transcribeLecture, startLiveTranscribe, stopLiveTranscribe } from './data/transcriber.js'
import { loadLlmConfig, saveLlmConfig, summarizeTranscript, summarizerAvailable, testConnection, DEEPSEEK_MODELS } from './data/summarizer.js'
import { compressImageForRecognize, recognizeScheduleImage, recognizerAvailable } from './data/recognizer.js'
import { buildIcs, downloadText } from './data/ics.js'
import { notifyAvailable, loadNotifySettings, saveNotifySettings, ensureNotifyEnv, buildScheduleItems, applySchedule, notifyDone, testNotify, onNotificationAction } from './data/notify.js'
import MonthCalendar from './components/MonthCalendar.vue'
import NumberWheel from './components/NumberWheel.vue'
import TimeWheel from './components/TimeWheel.vue'
import DropdownSelect from './components/DropdownSelect.vue'
import PeriodsEditor from './components/PeriodsEditor.vue'

/* 版本串不再手写：由 vite.config.js 从 package.json 的 version 注入（单一来源）。
   改版本号只改 web2/package.json 一处，App 打包脚本读的是同一个文件。 */
const APP_VERSION = __APP_VERSION__

const tab = ref('today')

/* ---------------- 底部导航切换（Day 11 二轮：滑块 + 平移 + 可打断） ----------------
   滑块与内容层都是 CSS transition：快速连点时 transform 直接改道新目标，从当前位置
   平滑续走——动画天然可打断，不需要锁定和「切换中」提示；bounce 用 WAAPI 重触发，
   新动画自动覆盖旧动画，同样可打断。全部前端临时状态，不接数据库。 */
const TAB_KEYS = ['today', 'week', 'list', 'habit', 'me']
const tabIndex = computed(() => TAB_KEYS.indexOf(tab.value))
/* 时序编排（用户反馈：header 收缩与内容平移同时发生=斜向甩感）：
   进/出今日时 header 的收缩展开用各自的 transition-delay（模板里 per-element
   `tab==='today' ? '110ms' : '0ms'`）与平移错开，每段运动单方向，折线代替斜线。
   平移层自己的延迟见 stripDelay——只保留「离开今日」一档。 */
/* 平移层过渡延迟：110ms 是「跨今日边界」的折线编排（header 收缩/展开与平移错开，
   避免斜向甩感）。但原来写成「目的地不是今日就延迟」，导致周课表↔我的（两边都
   不是今日、根本没有 header 动画）平层白等 110ms——2026-10-01 用户报「切换会顿
   一下」。收敛为只在离开今日时保留（header 收缩要让平移先行），其余 0ms。 */
const stripDelay = ref('0ms')
function switchTab(key) {
  if (key === tab.value) return // 幂等：重复点当前 tab
  stripDelay.value = tab.value === 'today' && key !== 'today' ? '110ms' : '0ms'
  tab.value = key
  // 瞬时复位：默认的 scrollTo 是平滑滚动，切页动画期间会被浏览器节流/取消，
  // 留下「切到某页但页面停在旧滚动位置」的中间态（App 启动时 initNotify → goMeTab
  // 就会撞上：我的页在视口外，用户看到的是空白）。瞬时版不受节流影响。
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  // 周课表锁死文档滚动（页面一屏看完，锁掉任何残余晃动）；切走即恢复。
  document.body.style.overflow = key === 'week' ? 'hidden' : ''
  // 头部收缩动画（280ms）会改变网格顶的位置，动画结束后重校网格高度
  setTimeout(measureGridTop, 320)
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

/* ---------------- 左右滑动手势切 tab（2026-10-01 用户要求「丝滑切换」） ----------------
   手指拖着平移层实时走（swipeDx 并进 translateX，拖动期间关掉 transform 过渡），
   松手按「位移过 18% 屏宽 或 末速 > 0.55px/ms」决定切换到相邻 tab，否则回弹。
   轴向锁定：先动满 12px 才判定横/竖，竖向让位给原生滚动（今日/我的列表），
   横向 preventDefault 接管；边界页直接 clamp 拖不动。TimeWheel 滚轮是纵向
   （touch-action:none 自理），与此手势互不干扰。 */
const swipeDx = ref(0)
const swiping = ref(false)
let sw = null
function onStripTouchStart(e) {
  if (e.touches.length !== 1) { sw = null; return }
  const t = e.touches[0]
  sw = { x0: t.clientX, y0: t.clientY, axis: null, lastX: t.clientX, lastT: performance.now(), vx: 0 }
}
function onStripTouchMove(e) {
  if (!sw) return
  const t = e.touches[0]
  const dx = t.clientX - sw.x0
  const dy = t.clientY - sw.y0
  if (!sw.axis) {
    const adx = Math.abs(dx)
    const ady = Math.abs(dy)
    if (adx < 12 && ady < 12) return
    sw.axis = adx > ady * 1.25 ? 'h' : ady > adx * 1.25 ? 'v' : null
    if (sw.axis === 'h') swiping.value = true
  }
  if (sw.axis !== 'h') return
  e.preventDefault() // 已判定横向：拦掉原生滚动与后续 click（防拖完误点卡片）
  const now = performance.now()
  const dt = now - sw.lastT
  if (dt > 0) {
    sw.vx = (t.clientX - sw.lastX) / dt
    sw.lastX = t.clientX
    sw.lastT = now
  }
  const min = tabIndex.value >= TAB_KEYS.length - 1 ? 0 : -window.innerWidth
  const max = tabIndex.value <= 0 ? 0 : window.innerWidth
  swipeDx.value = Math.max(min, Math.min(max, dx))
}
function onStripTouchEnd() {
  if (!sw) return
  const wasH = sw.axis === 'h'
  const vx = sw.vx
  const dx = swipeDx.value
  sw = null
  if (!wasH) return
  swiping.value = false
  swipeDx.value = 0
  const dir = dx < 0 ? 1 : dx > 0 ? -1 : 0
  const far = Math.abs(dx) > window.innerWidth * 0.18
  const fling = Math.abs(vx) > 0.55 && dir !== 0
  if (far || fling) {
    const next = Math.min(TAB_KEYS.length - 1, Math.max(0, tabIndex.value + dir))
    if (next !== tabIndex.value) switchTab(TAB_KEYS[next])
  }
}
function onStripTouchCancel() {
  sw = null
  swiping.value = false
  swipeDx.value = 0
}
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
  window.addEventListener('resize', onWinResize) // 周课表高度按视口重算（一屏看完的保证）
  measureNavH() // 底部导航实测高度（含系统手势条安全区），网格高度要用它
  measureSat() // 外壳状态栏让位（App 内 >0，浏览器 0）
  measureGridTop() // 网格顶文档坐标实测（高度公式输入）
  window.addEventListener('wb-sat', onWinResize) // 外壳异步量到 --sat 后广播，重算周课表高度
  // 左右滑动切 tab 手势（绑在平移层上；touchmove 必须 passive:false 才能 preventDefault）
  if (stripRef.value) {
    stripRef.value.addEventListener('touchstart', onStripTouchStart, { passive: true })
    stripRef.value.addEventListener('touchmove', onStripTouchMove, { passive: false })
    stripRef.value.addEventListener('touchend', onStripTouchEnd)
    stripRef.value.addEventListener('touchcancel', onStripTouchCancel)
  }
  // 周课表页锁死文档滚动：页面内容一屏看完，任何残余溢出/WebView 拖拽都表现为「晃动」
  // （v1.32.2 真机仍有轻微晃动）。锁的是 body overflow，切回今日/我的自动恢复滚动。
  document.body.style.overflow = tab.value === 'week' ? 'hidden' : ''
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onWinResize)
  window.removeEventListener('wb-sat', onWinResize)
  if (stripRef.value) {
    stripRef.value.removeEventListener('touchstart', onStripTouchStart)
    stripRef.value.removeEventListener('touchmove', onStripTouchMove)
    stripRef.value.removeEventListener('touchend', onStripTouchEnd)
    stripRef.value.removeEventListener('touchcancel', onStripTouchCancel)
  }
  document.body.style.overflow = ''
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
  if (addPick.value) { addPick.value = null; return true } // 长按出的类型菜单（加课程/加循环日程）
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
const routines = ref(initial.routines || []) // 固定循环日程（type: routine，按周重复、跨学期常驻）
const importMsg = ref('')

function reloadDataset() {
  const d = loadDataset()
  source.value = d.source
  semester.value = d.semester
  weekAll.value = d.courses
  events.value = d.events
  routines.value = d.routines || []
  todos.value = d.todos.map((t) => ({ ...t }))
  /* 导入/恢复示例会整体接管（或保留）lectures/habits 落盘，界面 ref 必须跟着重取——
     之前只在页面初始化时刷新，导入带录音场次/打卡记录的文件后列表不更新（测试抓出） */
  refreshLectures()
  reloadHabits()
  addedDupCount.value = countAddedDups()
}

/* 清理重复课程：只处理 web2.added 里的重复（多次导入同一课表会叠加在这里）。
   按钮「有重复才显示」（2026-10-01 用户拍板）——没有这种脏数据就不摆这个入口。
   注意初始值要**当场算**：页面启动走的是 loadDataset()（initial），不经过 reloadDataset()，
   写成 ref(0) 会让入口在下次导入前永远藏着（dedup-button-check D2 抓出）。 */
const addedDupCount = ref(countAddedDups())
function dedupCourses() {
  const removed = dedupAdded()
  reloadDataset()
  importMsg.value = removed > 0 ? `已清理 ${removed} 门重复课程` : '没有重复课程'
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
  /* 「我的」页的低频项（课前提醒开关、纪要配置、清除数据…）都收在「设置」折叠区里，
     凡是从别处「跳过来让用户看某个设置」的路径，都得顺手把折叠展开，
     否则用户跳到我的页也是一脸茫然（2026-10-02 减法后新增）。 */
  settingsOpen.value = true
}

async function applyNotifySchedule() {
  if (!notifyOk) return
  const items = buildScheduleItems({
    courses: weekAll.value,
    events: events.value,
    /* 循环日程也排课前提醒（2026-10-02 用户要）：它和课程一样「今天几点到几点」，
       已经在今日页参与三态与开录关联，提醒口径不该有例外。 */
    routines: routines.value,
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
watch([weekAll, events, routines, semester], () => { applyNotifySchedule() })
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
const onboardStep = ref('choice') // choice | form | periods | aiCfg | rec | recConfirm
const OB_STEP_LABELS = ['学期与节次', '识别课表', '核对导入']
/* aiCfg = 第 2 步内部的「先配好 AI」引导页（没配 Key 时落这里），进度条上仍算第 2 步 */
const onboardStepNo = computed(() => ({ choice: 0, form: 1, periods: 1, aiCfg: 2, rec: 2, recConfirm: 3 }[onboardStep.value] || 0))
function finishOnboarding() {
  localStorage.setItem(ONBOARD_KEY, '1')
  onboarding.value = false
}

/* ---------------- 清除数据并重置 ----------------
   清 8 个数据键：web2.data（导入数据）、web2.added（手动加 + 识别导入的课）、
   web2.todos（待办覆盖）、web2.events（日程）、web2.courseOv（课卡覆盖标记）、
   web2.lectures（录音场次）、web2.habits（打卡）、web2.onboarded（引导标记，
   删它才会回到引导页）。此前漏删 added/todos/events/courseOv，导致「清了课表还在」。
   保留 4 个本机个性化设置（2026-10-01 用户拍板）：web2.theme（主题）、web2.accent
   （强调色）、web2.llm（API Key）、web2.notify（通知设置）。
   二次确认走自建弹窗，不用原生 confirm。 */
const confirmClear = ref(false)
function doClearData() {
  localStorage.removeItem('web2.data')
  localStorage.removeItem(ADDED_KEY)
  localStorage.removeItem(TODOS_KEY)
  localStorage.removeItem(EVENTS_KEY)
  localStorage.removeItem(COURSE_OV_KEY)
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

/* 今日页打卡区「全部打完就收成一行」用（2026-10-02 减法）：
   完成后列表本身没有信息量，收起来让位给真正还没做的事；
   收起态仍提供「取消」和「管理 ›」两个出口，不会把人堵死。 */
const habitsAllDoneToday = computed(
  () => habits.value.length > 0 && habits.value.every((h) => !!h.records[habitToday])
)
function undoAllHabitsToday() {
  for (const h of habits.value) if (h.records[habitToday]) toggleHabitRecord(h.id, habitToday)
  reloadHabits()
}

/* ---------------- 打卡页（三期：宽限期补卡） ----------------
   与今日页那份的分工：今日页只留「今天打了没」这个高频动作（大圆圈一按），
   管理（添加 / 删除 / 翻历史周 / 补卡）全部收在这一页，同一个动作不到处各写一遍。
   宽限期口径见 data/store.js：只能补**本周内、今天之前**的日期，上周及更早锁定。
   页面加载时把可补日期算成常量集合（habitToday 本身在本次会话里不变，
   口径与今日页一致：跨午夜不热更新，刷新即最新）。 */
const habitGrace = new Set(graceKeysOf(habitToday))
const habitWeekBase = ref(0) // 0=本周，-1=上周…最多往回看 52 周；不允许看未来
const habitViewDays = computed(() => {
  const base = new Date(habitToday + 'T00:00:00')
  const wd = (base.getDay() + 6) % 7
  base.setDate(base.getDate() - wd + habitWeekBase.value * 7)
  const names = ['一', '二', '三', '四', '五', '六', '日']
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
    const key = todayKeyOf(d)
    return {
      key,
      name: names[i],
      day: d.getDate(),
      isToday: key === habitToday,
      isFuture: key > habitToday, // YYYY-MM-DD 的字典序即时间序
      canBackfill: habitGrace.has(key),
    }
  })
})
const habitWeekLabel = computed(() => {
  const days = habitViewDays.value
  const f = (k) => { const p = k.split('-'); return Number(p[1]) + '月' + Number(p[2]) + '日' }
  return f(days[0].key) + ' – ' + f(days[6].key)
})
function shiftHabitWeek(n) {
  habitWeekBase.value = Math.min(0, Math.max(-52, habitWeekBase.value + n))
}
const habitTodayDone = computed(() => habits.value.filter((h) => h.records[habitToday]).length)
/* 格子上的一次点击：今天 = 正常打卡；宽限期内 = 补卡（写留痕）；其余不响应 */
function onHabitCell(id, key) {
  if (key !== habitToday && !habitGrace.has(key)) return
  toggleHabitRecord(id, key)
  reloadHabits()
}
/* 格子的视觉态：done 当天打的 / back 事后补的 / today 今天（可打可取消）/
   open 宽限期内可补 / future 还没到 / locked 已过期锁定。
   补卡与当天打卡必须一眼可分——这是「区分显示」的落点。
   注意 isToday 分支必须在 canBackfill 之前：宽限期集合不含今天，
   不单独分支的话「今天」会掉进 locked，看着像锁死其实能点（首跑截图抓到）。 */
function habitCellState(h, d) {
  if (h.records[d.key]) return isBackfilled(h, d.key) ? 'back' : 'done'
  if (d.isToday) return 'today'
  if (d.isFuture) return 'future'
  return d.canBackfill ? 'open' : 'locked'
}
const HABIT_CELL_CLS = {
  done: 'bg-primary-500 text-white',
  back: 'border border-primary-400 bg-primary-50 text-primary-500',
  today: 'border-2 border-primary-400 text-primary-500',
  open: 'border border-dashed border-primary-300 text-primary-500/70',
  future: 'bg-ink/[0.04] text-ink-dim/30',
  locked: 'bg-ink/[0.06] text-ink-dim/45',
}
const habitTodayText = (() => {
  const d = new Date(habitToday + 'T00:00:00')
  return d.getMonth() + 1 + '月' + d.getDate() + '日 周' + ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
})()

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
/* 今日的条目是「课程 + 独立日程」两套并存的列表，字段名不同：
   课程（weekAll ← store 归一化）用 name/place，日程（events ← fullEvent）用 title/location。
   要显示名字的地方统一走这里，别直接读某一个字段——读错了不会报错，只会显示成 undefined。 */
function entryName(c) {
  return String((c && (c.name || c.title)) || '').trim()
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
  /* M5 课程关联：开录时若正落在某节课的覆盖时间内（含提前 5 分钟），
     场次自动挂到这节课——标题显示课名，事后找纪要靠课名不靠时间戳 */
  const d = new Date()
  const course = courseCovering(todayCourses.value, nowTime.value)
  const lec = addLecture({
    schedule_id: course ? course.id : null,
    title: course ? `${entryName(course)} · ${d.getMonth() + 1}月${d.getDate()}日` : defaultLecTitle(d),
  })
  recActiveId.value = lec.id
  recElapsed.value = 0
  playingId.value = null
  refreshLectures()
  clearInterval(recTicker)
  recTicker = setInterval(tickRec, 1000)
  /* M2.5 保活：拉起前台服务，锁屏/切后台不断录（通知栏一条常驻通知）。
     保活失败不影响录音——只把提示换成「先别锁屏」，照常录。 */
  const ka = await startKeepAlive(lec.title)
  /* M5 到点自动停：关联了课就按「下课时间 + 2 分钟宽限」排原生定时（锁屏照停）。
     没关联课（独立日程/自由录）不排——不知道该几点停，宁可不猜；
     排程失败只降级成手动停，不影响录音。 */
  let auto = false
  if (course) {
    const end = new Date()
    end.setHours(Math.floor(minOf(course.end) / 60), minOf(course.end) % 60, 0, 0)
    const delayMs = end.getTime() + AUTO_STOP_GRACE_MIN * 60000 - Date.now()
    if (delayMs > 0) {
      const s = await scheduleAutoStop(delayMs)
      auto = !!s.ok
    }
  }
  if (!ka.ok && !ka.unsupported) {
    setRecMsg('录音已开始，但后台保活没起来（' + ka.error + '）——这场请先别锁屏。', true)
  } else {
    /* 没排上自动停的情况要说清楚（自由录音、或开录时刻没对上任何一节课的覆盖窗口：
       早于开课前 5 分钟、或落在某节快下课的尾巴上）——否则用户会以为自动停坏了。 */
    setRecMsg(course && auto
      ? '录音中：锁屏、切到后台都会继续录，下课后 2 分钟自动停。'
      : '录音中：锁屏、切到后台都会继续录；这场没排自动停，记得自己停。')
  }
  /* M5 分段转写：开录即让原生边录边预转（每 3 分钟吃掉已写完的 30s 段），
     课后只等尾巴。尽力而为：模型没下好/没文件都自动放弃，最终转写兜底全量。 */
  if (trSupported.value) startLiveTranscribe()
}
/* M5 自动停的拖堂宽限：下课铃后老师再讲 2 分钟很正常，到点 = 下课时间 + 2 分钟 */
const AUTO_STOP_GRACE_MIN = 2

/* 落盘收尾：写场次记录 → 刷新 → 全自动链路（转写→纪要→作业转待办）。
   stopRec 和「锁屏回来发现原生已替我们停录」共用这一条出口。 */
async function finalizeRecording(id, r) {
  const now = new Date().toISOString()
  const res = updateLecture(id, {
    ended_at: now,
    duration_ms: r.clip.duration_ms,
    clips: [{ index: 0, path: r.clip.path, mime: r.clip.mime, duration_ms: r.clip.duration_ms, recorded_at: now }],
  })
  refreshLectures()
  if (!res.ok) return setRecMsg(res.error, true)
  if (!r.clip.path) return setRecMsg('录音已停止，但文件没有落盘（异常），这一场只留下记录。', true)
  if (r.auto) setRecMsg('已到下课时间，录音自动停了，正在自动转写。')
  else setRecMsg('录音已保存。')
  /* M5 分段转写：停录时取走原生预转好的前段文字，最终转写只算尾巴（live 尽力而为） */
  let live = null
  if (trSupported.value) {
    try {
      const s = await stopLiveTranscribe()
      if (s && s.active && s.segs > 0) live = { text: s.text, segs: s.segs }
    } catch { /* 没有 live 或领失败，全量转写兜底 */ }
  }
  /* M5 全自动链路：停录即自动转写 → 转写完自动生成纪要 → 完成发通知。
     每一环失败都会就地提示并停在可手动重试的状态（手动按钮保留）。 */
  runAutoPipeline(id, live)
}
async function stopRec() {
  const id = recActiveId.value
  if (!id) return
  let r
  try {
    r = await recStop()
  } finally {
    /* 保活必须无条件撤下（含录音失败路径）：否则通知会一直挂着，下次还得靠启动对账清；
       原生服务销毁时顺带撤销还没到点的自动停排程 */
    await stopKeepAlive()
    clearInterval(recTicker)
    recTicker = null
    recActiveId.value = null
  }
  if (!r.ok) {
    /* 到点自动停发生在本 App 内（用户停在前台没动）时走这里：JS 的 stop 会报
       「没有进行中的录音」，其实原生已经把文件停好落盘了——捞回来按成功收尾 */
    const salvage = await consumeAutoStop()
    if (salvage.ok && salvage.path) {
      return finalizeRecording(id, { ok: true, auto: true, clip: { path: salvage.path, mime: 'audio/aac', duration_ms: salvage.msDuration } })
    }
    refreshLectures()
    return setRecMsg(r.error + '（这一场已标记为录音中断）', true)
  }
  finalizeRecording(id, r)
}
/* M5 原生自动停的恢复口：强停多半发生在锁屏后，WebView 冻结，JS 当时啥也做不了；
   解锁回来 visibilitychange 一响，先问原生有没有替我们停过录，停过就把场次补齐并进管线 */
async function onVisibleCheckAutoStop() {
  if (document.visibilityState !== 'visible' || !recActiveId.value) return
  const salvage = await consumeAutoStop()
  if (!salvage.ok || !salvage.path) return
  const id = recActiveId.value
  await stopKeepAlive() // 原生已自撤，这里兜个底（永远成功）
  clearInterval(recTicker)
  recTicker = null
  recActiveId.value = null
  finalizeRecording(id, { ok: true, auto: true, clip: { path: salvage.path, mime: 'audio/aac', duration_ms: salvage.msDuration } })
}
document.addEventListener('visibilitychange', onVisibleCheckAutoStop)
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisibleCheckAutoStop))
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
async function startTr(l, opts = {}) {
  const auto = !!opts.auto
  if (trBusyId.value) return false
  if (!trSupported.value) {
    if (!auto) setRecMsg('转写只能在 App 内使用（浏览器不支持）。', true)
    return false
  }
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
      /* M5：转写在原生线程跑，不需要人守着看进度条了——切去干别的，回来接着跑 */
      setRecMsg('长录音转写约需 10–20 分钟：可以先切去干别的，完成后会通知你。')
    }
    await transcribeLecture(l.id, (p) => {
      // 解码/重采样是识别前的预处理，其 percent 只反映该步内部进度——
      // 直接上进度条会出现「先冲 90% 再跳回识别 50%」的假象（真机实测）。
      // 这两步只改文字提示，进度条保持 0；'asr' 才驱动百分比。
      if (p.phase === 'decode') {
        // 1 小时音频的解码要跑几分钟，百分比必须露出来（真机教训：只显示文字=看起来像卡死）
        trLabel.value = p.percent > 0 ? `解码音频 ${p.percent}%（不耗模型，快了）` : '解码音频…'
        return
      }      if (p.phase === 'resample') {
        trLabel.value = `重采样音频 ${p.percent}%`
        return
      }
      trPercent.value = p.percent
      trLabel.value = p.clipCount > 1 ? `识别 ${p.clipIndex + 1}/${p.clipCount} 段 · ${p.percent}%` : `识别中 ${p.percent}%`
    }, { live: opts.live || null })
    setRecMsg('转写完成，文字稿已保存。')
    notifyDone('转写完成', l.title) // App 切在后台时发完成通知（前台自动跳过）
    if (!auto) trOpenId.value = l.id
    return true
  } catch (e) {
    setRecMsg('转写失败：' + (e && e.message ? e.message : '未知错误') + '（可稍后重试）', true)
    return false
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
const llmInputOpen = ref(false) // 课堂纪要的「纪要服务」子区展开（在设置折叠区内部）
/* 「设置」折叠区（2026-10-02 减法）：默认收起。低频设置不该和高频动作抢首屏；
   但「课堂纪要」缺配置时会自动展开它（见 startSummary 缺配置分支），
   否则用户会以为功能被删了。 */
const settingsOpen = ref(false)
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
async function startSummary(l, opts = {}) {
  const auto = !!opts.auto
  if (sumBusyId.value) return false
  const miss = summarizerAvailable()
  if (miss) {
    setRecMsg(auto ? `${miss}（转写已完成，配好后手动点「生成纪要」即可）` : miss, true)
    llmInputOpen.value = true // 缺配置：顺手把纪要子区展开，少一次找路
    settingsOpen.value = true // 外面那层「设置」折叠也要打开，否则展开了也看不见
    return false
  }
  if (!l.transcript || String(l.transcript).trim().length < 30) {
    setRecMsg('文字稿太短，没有可总结的内容。', true)
    return false
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
    /* 手动生成纪要也接手转待办（原来只有自动链路会转）：自动链路中途断环、
       用户手动补跑转写/纪要时，作业不该就此停在纪要里。homeworkToTodos 按
       标题去重，所以与自动链路并存也不会叠出重复待办；有作业转成时它会
       覆盖上面的提示文案。 */
    refreshLectures()
    const lAfter = lectures.value.find((x) => x.id === l.id)
    if (lAfter) homeworkToTodos(lAfter)
    return true
  } catch (e) {
    if (e && e.name === 'AbortError') setRecMsg('已取消纪要生成。', true)
    else setRecMsg('纪要生成失败：' + (e && e.message ? e.message : '未知错误'), true)
    return false
  } finally {
    sumBusyId.value = null
    sumStage.value = ''
    refreshLectures()
  }
}

/* ---------------- M5 全自动链路：停录 → 转写 → 纪要，一路自动到底 ----------------
   stopRec 成功保存后触发（fire-and-forget，不阻塞停录返回）。每一环失败就地
   提示并停在可手动重试的状态：转写失败留在「已录完待转写」，转写成功但纪要
   失败/缺 Key 留在「已转写待总结」——手动按钮都在原位，自动只是省点击。
   浏览器环境（trSupported=false）到此为止，保持旧行为。 */
async function runAutoPipeline(id, live = null) {
  const l = lectures.value.find((x) => x.id === id)
  if (!l) return
  if (!trSupported.value) return
  const trOk = await startTr(l, { auto: true, live })
  if (!trOk) return
  const l2 = lectures.value.find((x) => x.id === id) // 转写期间 refreshLectures 重建过数组，重取最新
  if (!l2) return
  const sumOk = await startSummary(l2, { auto: true })
  if (!sumOk) return
  const l3 = lectures.value.find((x) => x.id === id) // 纪要写入后又 refresh 过，重取
  if (l3) homeworkToTodos(l3) // M5 第 2 步：纪要里的作业自动转待办（只有自动链路触发，手动总结不自动转）
}

/* M5 第 2 步：纪要 homework → 待办。
   截止日取「这门课下次上课那天」（nextCourseDate 纯函数在 store.js，按课名找下次槽位换算；
   没关联课 / 学期外找不到 → 明天）。标题带课名前缀方便在待办列表里认领；
   按标题去重——同一场重试总结不会叠出重复待办。 */
function tomorrowStr() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return fmtDateYMD(d)
}
function homeworkToTodos(l) {
  const hw = l.summary && Array.isArray(l.summary.homework) ? l.summary.homework : []
  const items = hw.map((h) => String(h).trim()).filter(Boolean)
  if (!items.length) return
  const course = l.schedule_id ? weekAll.value.find((c) => c.id === l.schedule_id) : null
  const due = (course && nextCourseDate(weekAll.value, semester.value, todayIdx + 1, course.name)) || tomorrowStr()
  const prefix = course ? `${course.name}：` : ''
  const existing = new Set(todos.value.map((t) => t.title))
  let added = 0
  for (const h of items) {
    const title = prefix + h
    if (existing.has(title)) continue
    existing.add(title)
    addTodo({ title, due_date: due })
    added++
  }
  if (added) {
    reloadDataset()
    setRecMsg(`纪要已生成，${added} 条作业已转成待办（截止 ${due}）。`)
    notifyDone('作业已转待办', `${added} 条 · 截止 ${due}`) // 仅后台时发
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
  obStepDir.value = 'obpage-fwd' // 步骤级滑动：入口 → 第 1 步算前进
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

/* ---------------- 引导页「先配好 AI」子页（第 2 步内部，没配 Key 时进） ----------------
   2026-09-30 用户反馈：第一次用的人没有 API Key，而引导层是 fixed inset-0 盖住整个应用的，
   原来那行红字让人「去我的页配」根本走不到 —— 死路。改成在引导流程内就地配：
   检测点有三处（第 1 步「下一步：识别课表」、识别页点识别按钮、我的页识别入口），
   缺 Key 一律滑到这一页；配好回识别页，不想配也能手动加课。
   Key 与「课堂纪要」同一份（web2.llm）：provider 固定 deepseek（识别只有它有视觉），
   模型沿用已选值、没选过就落 deepseek-flash，这样配完纪要那边也同时可用。 */
const obStepDir = ref('obpage-fwd') // 步骤级滑动方向：fwd=前进 / bak=返回（与二级页的 obPageDir 分开）
const obAiFrom = ref('rec') // 从哪进来的：'form'=第1步直接进来（配好算前进）/'rec'=识别页兜底拦截（配好算返回）
const obAiErr = ref('')
function gotoAiCfg(from) {
  obAiFrom.value = from
  obAiErr.value = ''
  llmCfg.value = loadLlmConfig() // 输入框按本机实际配置显示（与「我的」页那份同源）
  llmTest.value = { busy: false, ok: null, msg: '' } // 每次进来清掉上次的测试结果
  obStepDir.value = 'obpage-fwd'
  onboardStep.value = 'aiCfg'
}
function onObAiKey() {
  saveLlmConfig({ provider: 'deepseek', key: llmCfg.value.key.trim(), model: llmCfg.value.model.trim() || 'deepseek-flash' })
  llmCfg.value = loadLlmConfig()
  obAiErr.value = ''
}
async function obAiTest() {
  onObAiKey() // 先落盘再测：testConnection 读的是本机配置
  await testLlm()
}
function obAiDone() {
  if (!llmCfg.value.key.trim()) {
    obAiErr.value = '还没填 Key。不想配就点下面的「先不配」，手动加课一样能建课表。'
    return
  }
  onObAiKey()
  obAiErr.value = ''
  obStepDir.value = obAiFrom.value === 'form' ? 'obpage-fwd' : 'obpage-bak'
  onboardStep.value = 'rec'
}
function obAiBack() {
  obStepDir.value = 'obpage-bak'
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
/* 点改某节结束时间：只动这一节（与「我的」页 PeriodsEditor 同口径，改的不是开始时间所以不顺移整段）。
   段结构不重算——引导页没有「并入上一段」入口，自动裂段会合不回去，这里保持用户看到的段不动。 */
function obPickPeriodEnd(idx) {
  const p = obForm.value.periods[idx]
  openTimeField({
    value: p.end,
    onDone: (v) => {
      if (v === p.end) return
      if (minOf(v) <= minOf(p.start)) {
        obErr.value = `第 ${p.no} 节的结束时间要晚于开始时间`
        return
      }
      obErr.value = ''
      obForm.value.periods = obForm.value.periods.map((x, i) => (i === idx ? { ...x, end: v } : { ...x }))
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
const minePeriods = computed(() => periodsOf({ semester: { periods: (semester.value && semester.value.periods) || [] } }))
const recPeriods = computed(() => (recFromMine.value ? minePeriods.value : obPeriods.value))
const recSegView = computed(() => segmentView(recPeriods.value))
function mineRecStart() {
  recPreview.value = null
  obRecErr.value = ''
  recFromMine.value = true
  onboarding.value = true // 借用引导层渲染识别页/核对页（onboardStep 直落第 2 步）
  /* 缺 Key：落在「先配好 AI」页（引导层里就能填，不必先绕去我的页）；配好回识别页，取消整层关掉 */
  if (recognizerAvailable()) {
    gotoAiCfg('rec')
    return
  }
  obStepDir.value = 'obpage-fwd'
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
  obStepDir.value = 'obpage-fwd'
  /* 第一次用的人没有 Key：不停在识别页，直接滑到「先配好 AI」页（这两步在进度条上都算第 2 步） */
  if (recognizerAvailable()) {
    gotoAiCfg('form')
    return
  }
  onboardStep.value = 'rec'
}
function recBackForm() {
  obRecErr.value = ''
  obStepDir.value = 'obpage-bak'
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
  obStepDir.value = 'obpage-fwd'
  onboardStep.value = 'recConfirm'
}
function obRecClick() {
  obRecErr.value = ''
  /* 兜底：缺 Key 不再只甩一行红字，直接引导到配置页（能就地配完再回来识别） */
  if (recognizerAvailable()) {
    gotoAiCfg('rec')
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
    /* prompt v3：把当前节次表喂给 AI，让它按段排课、不跨午休（详见 recognizer.js） */
    const r = await recognizeScheduleImage(dataUrls, { periods: recPeriods.value })
    if (!r.courses.length) {
      const hint = r.notes && r.notes.length ? 'AI 说：' + r.notes.join('；') + '。' : ''
      obRecErr.value = '这张图里没认出课程。' + hint + '建议直接截教务系统课表网页的原图，不要先把图缩小。'
      return
    }
    /* AI 犯错代码兜底：跨段（横跨午休/晚休）的课按开始节次所在段钳回段内（详见 weekGrid.js） */
    const clamped = clampCoursesToSegments(r.courses, recPeriods.value)
    recPreview.value = {
      items: clamped.items.map((c) => ({ ...c, selected: true })),
      notes: r.notes,
      warnings: [...r.warnings, ...clamped.fixes],
    }
    obStepDir.value = 'obpage-fwd'
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

/* ---------------- 核对页的整周预览网格 ----------------
   与正式课表共用 data/weekGrid.js 的落格算法，所以「预览里看到的样子」
   就是导入后课表的样子。用户选定的布局：网格在上、逐条卡片在下。 */
const recGrid = computed(() => {
  const items = previewItems(recPreview.value ? recPreview.value.items : [], recPeriods.value)
  const groups = findCellOverlaps(items)
  const hot = new Set()
  for (const g of groups) for (const x of g.items) hot.add(x)
  return { items, groups, hot }
})
/* 列：默认周一~周五；识别结果里有周末课就补到那天（与正式课表同一个规矩） */
const recCols = computed(() => {
  let last = 5
  for (const it of recGrid.value.items) {
    if (it.wd >= 6 && it.wd <= 7) last = Math.max(last, it.wd)
  }
  return Array.from({ length: last }, (_, i) => i + 1)
})
const recRows = computed(() => buildGridRows(recPeriods.value))
const recRowIdx = computed(() => rowIndexMap(recRows.value))
const recColsStyle = computed(() => ({
  gridTemplateColumns: `${GRID_AXIS_W}px repeat(${recCols.value.length}, minmax(0, 1fr))`,
}))
/* 行高固定：预览表要的是「一眼看排布」，不必挤进一屏（整页本来就能滚） */
const recGridStyle = computed(() => ({
  ...recColsStyle.value,
  gridTemplateRows: recRows.value.map((r) => (r.type === 'gap' ? '18px' : '26px')).join(' '),
}))
/* 同一格落了两门课 → 顶部点名（识别时同一门课常被认成两条，重叠摆出来比藏起来好） */
const recOverlapNote = computed(() => {
  const gs = recGrid.value.groups
  if (!gs.length) return ''
  const ps = recPeriods.value
  const parts = gs.slice(0, 2).map((g) => {
    const a = ps[g.from] ? ps[g.from].no : '?'
    const b = ps[g.to] ? ps[g.to].no : a
    return `${WDN[g.wd - 1]}第 ${a}${b === a ? '' : '-' + b} 节有 ${g.items.length} 门课重叠`
  })
  return parts.join('；') + (gs.length > 2 ? `，共 ${gs.length} 处` : '') + '，确认下是不是重复识别'
})
/* 识别结果里存的是 title，配色函数认的是 name —— 这里转一手 */
function palOf(title) {
  return pal({ name: String(title || '未命名') })
}
/* 这条是否与别人重叠（下方卡片也标一下，跟网格呼应） */
function recItemHot(it) {
  if (!it) return false
  const g = recGrid.value.items.find((x) => x.c === it)
  return !!g && recGrid.value.hot.has(g)
}
/* 按下格子时的高亮（抬手才弹层）：没这个反馈，新人看不出空格子能点 */
const recPressCell = ref('')
function recCellDown(wd, idx) {
  recPressCell.value = wd + '-' + idx
}
function recCellUp() {
  recPressCell.value = ''
}

/* 点格子：空格=加课、已有课=改课，同一个底部弹层两态。
   「位置与节次」默认折叠 —— 默认只问课名与地点，星期节次已由点中的格子定好了。 */
const recCell = ref(null)
const recCellErr = ref('')
function openRecAdd(wd, idx) {
  recCell.value = { index: null, weekday: wd, startIdx: idx, endIdx: idx, title: '', location: '', more: false }
  recCellErr.value = ''
}
function openRecEdit(it) {
  const i = recPreview.value ? recPreview.value.items.indexOf(it.c) : -1
  if (i < 0) return
  const [from, to] = secRowRange(it.c.startSec, it.c.endSec, recPeriods.value)
  recCell.value = {
    index: i,
    weekday: Number(it.c.weekday),
    startIdx: from,
    endIdx: to,
    title: it.c.title || '',
    location: it.c.location || '',
    more: false,
  }
  recCellErr.value = ''
}
const recCellWhere = computed(() => {
  const f = recCell.value
  if (!f) return ''
  const ps = recPeriods.value
  const a = ps[Math.min(f.startIdx, f.endIdx)]
  const b = ps[Math.max(f.startIdx, f.endIdx)]
  if (!a || !b) return `${WDN[f.weekday - 1]} · 节次超出当前节次表`
  return `${WDN[f.weekday - 1]} · ${a.no === b.no ? `第 ${a.no} 节` : `第 ${a.no}-${b.no} 节`}`
})
const recCellWhen = computed(() => {
  const f = recCell.value
  if (!f) return ''
  const ps = recPeriods.value
  const a = ps[Math.min(f.startIdx, f.endIdx)]
  const b = ps[Math.max(f.startIdx, f.endIdx)]
  if (!a || !b) return ''
  return `${a.start}–${b.end}`
})
function submitRecCell() {
  const f = recCell.value
  if (!f || !recPreview.value) return
  const title = String(f.title || '').trim()
  if (!title) {
    recCellErr.value = '先填个课程名'
    return
  }
  const ps = recPeriods.value
  const a = ps[Math.min(f.startIdx, f.endIdx)]
  const b = ps[Math.max(f.startIdx, f.endIdx)]
  if (!a || !b) {
    recCellErr.value = '节次超出当前节次表，换个节次再存'
    return
  }
  const patch = {
    weekday: Number(f.weekday),
    startSec: a.no,
    endSec: b.no,
    title,
    location: String(f.location || '').trim(),
  }
  if (f.index === null) {
    recPreview.value.items.push({ ...patch, weekRule: 'every', teacher: '', selected: true })
  } else {
    Object.assign(recPreview.value.items[f.index], patch)
  }
  recCell.value = null
  recCellErr.value = ''
}
function delRecCell() {
  const f = recCell.value
  if (!f || f.index === null) return
  recRemove(f.index)
  recCell.value = null
}
function recBack() {
  recCell.value = null // 离页顺手关掉格子弹层，别让它悬在下一次进页时冒出来
  obStepDir.value = 'obpage-bak'
  onboardStep.value = 'rec' // 回第 2 步；识别结果保留（可继续核对或重新选图）
}
/* 导入：mine 模式 = 增量（学期信息不动，addCourse 逐条入库 + 冲突提示）；
   引导模式 = 先建学期再逐条入库（与 obSubmit 同一入口） */
function recImport() {
  recCell.value = null
  if (!recPreview.value) return
  const items = recPreview.value.items.filter((x) => x.selected)
  if (!items.length) {
    obRecErr.value = '至少留一门课再导入。'
    return
  }
  const ps = recPeriods.value // 与确认页预览同一份换算表（含「全删节次→默认 13 节」的回落）
  if (recFromMine.value) {
    let ok = 0
    let dup = 0
    let badName = 0
    let badSec = 0
    const conflictNames = []
    const seen = new Set()
    const exists = (c) => weekAll.value.some((x) => x.type === 'course' && x.weekday === c.weekday && x.start === c.start && x.end === c.end && x.name === c.name && x.week_rule === c.week_rule)
    for (const it of items) {
      const a = ps.find((p) => p.no === Number(it.startSec))
      const b = ps.find((p) => p.no === Number(it.endSec))
      /* 同 recImport 引导页分支：两类跳过原因分开计数，文案才可行动 */
      if (!a || !b) {
        badSec++
        continue
      }
      if (!String(it.title || '').trim()) {
        badName++
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
      const key = `${course.weekday}|${course.start}|${course.end}|${course.name}|${course.week_rule}`
      if (seen.has(key) || exists(course)) {
        dup++
        continue
      }
      seen.add(key)
      const conf = findConflicts({ type: 'course', weekday: course.weekday, start: course.start, end: course.end, week_rule: course.week_rule }, conflictPool.value)
      if (conf.length) conflictNames.push(...conf.map((c) => c.name))
      addCourse(course)
      ok++
    }
    reloadDataset()
    mineRecCancel()
    importMsg.value = `导入成功：新增 ${ok} 门课`
      + (dup ? `，${dup} 门重复已跳过` : '')
      + (badName ? `，${badName} 门因课程名没填被跳过` : '')
      + (badSec ? `，${badSec} 门因节次超出当前节次表被跳过（去学期卡片改节次表后重新识别）` : '')
      + (conflictNames.length ? `；与现有课表时间冲突：${[...new Set(conflictNames)].join('、')}（没动现有课，冲突的课可在周视图调整）` : '')
    return
  }
  const r = createManualSemester({ ...obForm.value, periods: obForm.value.periods })
  if (!r.ok) {
    obStepDir.value = 'obpage-bak'
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
  let dup = 0
  let badName = 0
  let badSec = 0
  const seen = new Set()
  const exists = (c) => weekAll.value.some((x) => x.type === 'course' && x.weekday === c.weekday && x.start === c.start && x.end === c.end && x.name === c.name && x.week_rule === c.week_rule)
  for (const it of items) {
    const a = ps.find((p) => p.no === Number(it.startSec))
    const b = ps.find((p) => p.no === Number(it.endSec))
    /* 两类跳过原因分开计数：文案要能告诉用户「下一步改哪里」——
       课名没填 → 在周视图手动补；节次超出 → 去改学期节次表再加回来。
       混成一句「因课程名没填或节次超出」等于没说。 */
    if (!a || !b) {
      badSec++
      continue
    }
    if (!String(it.title || '').trim()) {
      badName++
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
    const key = `${course.weekday}|${course.start}|${course.end}|${course.name}|${course.week_rule}`
    if (seen.has(key) || exists(course)) {
      dup++
      continue
    }
    seen.add(key)
    addCourse(course)
    ok++
  }
  reloadDataset()
  finishOnboarding()
  tab.value = 'week'
  importMsg.value = `课表识别已导入 ${ok} 门课`
    + (dup ? `，${dup} 门重复已跳过` : '')
    + (badName ? `，${badName} 门因课程名没填被跳过（可在周视图手动补）` : '')
    + (badSec ? `，${badSec} 门因节次超出当前节次表被跳过（去学期卡片改节次表后重新识别）` : '')
    + (ok && !dup && !badName && !badSec ? '：双击或长按课表空白处还能继续加课' : '')
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
const evtWarn = ref('')
const evtConfirmed = ref(false)
watch(evtForm, () => { evtConfirmed.value = false; evtWarn.value = '' }, { deep: true })

function openEventAdd() {
  evtForm.value = { title: '', date: todayStr, start: '18:00', duration: 60, place: '' }
  evtErr.value = ''
  evtWarn.value = ''
  evtConfirmed.value = false
}

function submitEvent() {
  const f = evtForm.value
  if (!f.title.trim()) { evtErr.value = '请填写日程名称'; return }
  if (!f.date) { evtErr.value = '请选择日期'; return }
  if (!f.start) { evtErr.value = '请选择开始时间'; return }
  /* 冲突检测：独立日程是「那一天」的事，先把日期换算成星期与周次再比对
     （口径同课程/循环日程：第一次点保存只提示，再点一次放行） */
  if (!evtConfirmed.value) {
    const sc = dayScope(f.date, semester.value)
    const conflicts = findConflicts(
      {
        type: 'event',
        date: f.date,
        weekday: sc ? sc.weekday : null,
        weekNo: sc ? sc.weekNo : null,
        start: f.start,
        end: fmtTime(minOf(f.start) + f.duration),
      },
      conflictPool.value,
    )
    if (conflicts.length) {
      evtConfirmed.value = true
      const names = [...new Set(conflicts.map((c) => c.name))].join('」「')
      const mix = conflicts.some((c) => c.type === 'routine') ? '（含循环日程）' : ''
      evtWarn.value = '这一天与「' + names + '」' + mix + '时间冲突，再点一次「添加」可忽略'
      return
    }
  }
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

/* 导出日历 .ics：课程 + 循环日程（都按周次逐周展开）+ 独立日程单次，课前 15 分钟提醒 */
function onExportIcs() {
  const { text, count } = buildIcs({ semester: semester.value, courses: weekAll.value, events: events.value, routines: routines.value })
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

/* 今天要上的课：本周课程 + 循环日程（同按周次规则命中）+ 独立日程落位，按开始时间排。
   循环日程进这一页是有意的（用户 2026-10-01 定）：它和课程一样「今天几点到几点」，
   所以要一起参与状态三态、进度条，以及开录时的课程关联。 */
const todayCourses = computed(() => {
  const wd = todayIdx + 1
  const list = weekAll.value
    .filter((c) => c.weekday === wd && matchWeek(c, semester.value.week))
    .map((c) => ({ ...c }))
  for (const r of routines.value) {
    if (r.weekday === wd && matchWeek(r, semester.value.week)) list.push({ ...r })
  }
  for (const ev of events.value) {
    if (ev.date === todayStr) list.push({ ...ev, weekday: wd })
  }
  return list.sort((a, b) => minOf(a.start) - minOf(b.start))
})

/* 今日循环日程条数：只用来决定文案口径（「N 节课」还是「N 项安排」） */
const todayRoutineCount = computed(() => todayCourses.value.filter((c) => c.type === 'routine').length)

/* 冲突检测的统一候选池：课程 + 循环日程 + 独立日程。
   独立日程没有星期几的概念，这里先把 date 换算成 { weekday, weekNo } 再交给 findConflicts
   —— 换算不了（缺学期起始日）就留 null，检测那边会跳过、不猜。 */
const conflictPool = computed(() => {
  const list = [...weekAll.value, ...routines.value]
  for (const ev of events.value) {
    const sc = dayScope(ev.date, semester.value)
    list.push({ ...ev, weekday: sc ? sc.weekday : null, weekNo: sc ? sc.weekNo : null })
  }
  return list
})

/* ---------------- 问候：可爱系（时段轴 + 状态轴，状态优先） ---------------- */
/* 时间后门：?t=09:35 可假装时间（演示/测试用），不带参数走真实时间 */
const tParam = new URLSearchParams(location.search).get('t')
const nowTime = ref(tParam ? minOf(tParam) : new Date().getHours() * 60 + new Date().getMinutes())

/* 真实时间每 30 秒自走：不然页面开着不动，课表三态/头部状态/问候语全停在打开那一刻。
   ?t= 时间后门（测试用）时不走表，保持冻结便于断言。 */
if (!tParam) {
  setInterval(() => {
    const d = new Date()
    nowTime.value = d.getHours() * 60 + d.getMinutes()
  }, 30_000)
}

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

/* 头部状态行的「进行中」判定：只在真覆盖当前时刻才算。
   旧版找不到就兜底第一节课 → 全天都显示「进行中」（真机 17:27，课 12:25 早已结束还在报）。 */
const currentCourse = computed(() =>
  todayCourses.value.find((c) => nowTime.value >= minOf(c.start) && nowTime.value <= minOf(c.end)) || null
)

/* 头部状态行文案：进行中 > 下一节 > 全部结束 > 没课（与问候气泡的 soon/done/free 口径一致） */
const headerCourseText = computed(() => {
  if (currentCourse.value) return '进行中 · ' + currentCourse.value.name
  if (!todayCourses.value.length) return '今天没有课'
  const next = todayCourses.value
    .filter((c) => minOf(c.start) > nowTime.value)
    .sort((a, b) => minOf(a.start) - minOf(b.start))[0]
  if (next) return `下一节 · ${next.name} ${next.start}`
  return '今日安排已结束'
})

const dateText = `${today.getMonth() + 1} 月 ${today.getDate()} 日`
const weekDay = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.getDay()]

/* ---------------- 周视图：节次网格 ---------------- */
/* 范式：行 = 节次（等高）、列 = 星期、课程 = 格子 —— 不再需要上下左右滑动。
   旧的时间轴画法（y()/courseBox()/PX_PER_MIN/COL_W/AXIS_W）已废弃：纵轴按真实分钟
   线性映射，整点线固定 51px 一条、节次线却是 46.75px 一条，两套刻度间距本来就不等
   （0.85px/分钟算出的 45 分钟 = 38.25px 还要做半像素模糊）—— 人眼看着必然歪。
   这不是精度问题，是画法选错了。 */
const DAY_START = 8 * 60 // 08:00（仍是添加课程表单的合法时间下界）
const DAY_END = 22 * 60  // 22:00（上界）
/* GRID_AXIS_W（左侧栏宽）来自 data/weekGrid.js —— 识别核对页的预览表共用同一份列宽，
   两处各写一个数迟早会画出两种网格 */

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

/* 周视图可见条目：课程按周次规则过滤 + 独立日程按日期落位 + 循环日程按周次规则过滤。
   循环日程**不做学期过滤**（「每周三健身」跨学期常驻），且与课程显示形状同构，
   所以直接混进同一个列表、由同一套落格算法排格（见下方 gridCourses）。 */
const weekVisible = computed(() => {
  const list = weekAll.value
    .filter((c) => matchWeek(c, weekNo.value))
    .map((c) => ({ ...c }))
  for (const ev of events.value) {
    if (!ev.date) continue
    const diff = Math.round((new Date(ev.date + 'T00:00:00') - monday.value) / 86400000)
    if (diff >= 0 && diff <= 6) list.push({ ...ev, weekday: diff + 1 })
  }
  for (const r of routines.value) {
    if (matchWeek(r, weekNo.value)) list.push({ ...r })
  }
  return list
})

/* ---- 网格坐标：节次行 / 星期列 / 课程落格 ---- */

/* 本周显示的列：默认周一至周五；周末有课（或今天就是周末）才补到那一天。
   每列宽一点课名才不至于截断 —— 周六日真有了课再自动补上，比固定挤 7 列好读。 */
const weekCols = computed(() => {
  let last = 5
  for (const c of weekVisible.value) {
    const wd = Number(c.weekday)
    if (wd >= 6 && wd <= 7) last = Math.max(last, wd)
  }
  if (weekOffset.value === 0 && todayIdx >= 5) last = Math.max(last, todayIdx + 1)
  return weekDays.value.filter((d) => d.wd <= last)
})

/* 网格行 / 落格坐标全部来自 data/weekGrid.js —— 识别核对页的预览表与正式课表共用同一套
   算法，两处各写一遍迟早会漂移（旧时间轴画法的教训）。这里只留组件要的 computed。 */
const gridRows = computed(() => buildGridRows(periods.value))
const gridRowOfIdx = computed(() => rowIndexMap(gridRows.value))

/* 落格后的课程卡：落格算法在 data/weekGrid.js（与核对页预览表同一套） */
const gridCourses = computed(() => courseItems(weekVisible.value, periods.value))

/* 网格高度：一屏塞下、永不纵向滚动。行高交给 CSS 的 1fr 均分，这里只算容器总高。
   2026-10-01 下午起改为「实测网格顶的文档坐标」反推：gridH = 视口 − gridTop − 导航 − 8px 间隙。
   为什么不再用常数 WEEK_CHROME=274：真机差异太多——外壳状态栏让位、系统字体缩放把
   头部/周次条撑高，常数在谁家都不准（v1.32.1/v1.32.2 连续两版「小幅上下拖」都栽在
   常数与真机对不上）。实测一步到位：不管上方占了多少，网格永远正好填满剩余空间，
   夹到 [300, 620]：小屏不至于把行挤成一条线，大屏也不至于拉得空荡。
   兜底：gridTop 还没量到（首帧）时用 WEEK_CHROME + satPx 估算。 */
const WEEK_CHROME = 274
const winH = ref(typeof window !== 'undefined' ? window.innerHeight : 800)
const navH = ref(78)
/* 外壳（App 包壳）为了让出系统状态栏，给 #app 加了 padding-top: var(--sat)（真机约 28px）。
   外壳量到原生高度是异步的，可能晚于本组件 mount，写完 --sat 会广播 'wb-sat' 事件。 */
const satPx = ref(0)
const gridTop = ref(0) // [data-grid] 顶边的文档坐标（含外壳让位、头部实际高度），measureGridTop 实测
const gridH = computed(() => {
  const top = gridTop.value > 0 ? gridTop.value : WEEK_CHROME + satPx.value
  return Math.max(300, Math.min(620, winH.value - top - navH.value - 8))
})
function measureNavH() {
  const nav = document.querySelector('nav')
  if (nav) navH.value = nav.offsetHeight
}
function measureSat() {
  const app = document.getElementById('app')
  if (!app) return
  satPx.value = parseFloat(getComputedStyle(app).paddingTop) || 0
}
function measureGridTop() {
  const g = document.querySelector('[data-grid]')
  if (!g) return
  gridTop.value = g.getBoundingClientRect().top + (window.scrollY || 0)
}
function onWinResize() {
  winH.value = window.innerHeight
  measureNavH()
  measureSat()
  measureGridTop()
}

/* 表头与主体共用同一份列定义（两处分开写就会对不上，这是网格的基本要求） */
const gridColsStyle = computed(() => ({
  gridTemplateColumns: `${GRID_AXIS_W}px repeat(${weekCols.value.length}, minmax(0, 1fr))`,
}))
const gridBodyStyle = computed(() => ({
  ...gridColsStyle.value,
  gridTemplateRows: `repeat(${gridRows.value.length}, minmax(0, 1fr))`,
  height: gridH.value + 'px',
  /* 头部收缩动画（280ms）结束后 gridTop 才重校，高度跳变用同曲线过渡兜平滑 */
  transition: 'height 280ms cubic-bezier(0.3, 0.75, 0.3, 1)',
}))

/* 卡片文字放几行：网格行高是 1fr 均分的，单节次的小格在小屏上只有 ~30px，
   连堂卡片则空间充足。按「这张卡实际有多少像素」分档，而不是一刀切：
     loose 名字 2 行 + 地点多行（连堂/大屏）
     mid   名字 2 行 + 地点 1 行
     tight 名字 1 行 + 地点 1 行（小格硬塞多行会切半行，比省略号更难看）
   行高常量取自实际样式：名字 10px×1.15≈11.5、地点 9px×leading-tight(1.25)≈11.25
   （2026-10-01 实测校正：原来按 9.6 算地点行高 + 漏扣卡片 inset，mid 档在小格上溢出 3px）。
   可用高 = 行高×节数 − 8（卡片 inset 上下共 4 + padding 上下共 4）。 */
function cardFit(it) {
  const rowH = gridH.value / Math.max(1, gridRows.value.length)
  const h = rowH * (it.to - it.from + 1) - 8
  if (h >= 11.5 * 2 + 11.25 * 2) return 'loose' // 名2 + 地点多行
  if (h >= 11.5 * 2 + 11.25) return 'mid' // 名2 + 地1
  if (h >= 11.5 * 2) return 'mid2' // 名2 + 地点让位（装不下地1，保课名两行完整度）
  return 'tight' // 名1 + 地1
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
/* 循环日程用固定的石板灰蓝，不走名字哈希 —— 课程那六色是「区分不同课程」的，
   循环日程要的是「一眼看出这类不是课」。配左上角的小循环标记双重区分
   （2026-10-01 用户拍板：卡片带小图标/前缀标记）。 */
const ROUTINE_PAL = { bg: '#eef0f5', bar: '#5b6b8c', text: '#44506b' }
function isRoutine(c) {
  return !!c && c.type === 'routine'
}
function pal(c) {
  if (isRoutine(c)) {
    if (!isDark.value) return ROUTINE_PAL
    return { bg: hexA(ROUTINE_PAL.bar, 0.22), bar: ROUTINE_PAL.bar, text: '#a9b6d4' }
  }
  const p = PALETTES[hashName(c.name) % PALETTES.length]
  if (!isDark.value) return p
  return { bg: hexA(p.bar, 0.16), bar: p.bar, text: p.bar }
}

/* 节次时间轴：periods 为空回落默认节次表（口径同主项目） */
const periods = computed(() => periodsOf({ semester: semester.value }))
/* 课程落在哪些节：起止都与节次边界精确对齐才显示「第X–Y节」，否则 null。
   循环日程同样按周重复、同样落在节次上，所以一并算（独立日程有具体日期、不套节次表）。 */
function periodSpan(c) {
  if (!c || c.type === 'event') return null
  const s = periods.value.findIndex((p) => p.start === c.start)
  const e = periods.value.findIndex((p) => p.end === c.end)
  if (s < 0 || e < 0 || s > e) return null
  return s === e ? `第${periods.value[s].no}节` : `第${periods.value[s].no}-${periods.value[e].no}节`
}

/* ---------------- 打磨：课程状态 / 详情弹层 / 待办徽标 ---------------- */
/* 今日课程三态：past 已结束（淡化）/ now 进行中（高亮+进度）/ future 未开始 */
function courseStatus(c) {
  const s = minOf(c.start)
  const e = minOf(c.end)
  if (nowTime.value > e) return 'past'
  if (nowTime.value >= s) return 'now'
  return 'future'
}
/* 周课表的「进行中/已结束」样式只对今天这一列生效：
   courseStatus 只比时间不比星期，直接用到周网格会让其他列同一时刻的课也亮蓝框
   （2026-10-01 用户报：上午第 3-5 节整行冒蓝框，根因就是它）。 */
function gridStatus(it) {
  if (weekOffset.value !== 0 || it.wd !== todayIdx + 1) return ''
  return courseStatus(it.c)
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

/* ---------------- 日程清单页（三期「日程分类视图」，2026-10-02） ----------------
   存在理由见模板顶部注释：独立日程此前没有集中入口。
   数据全部来自已就绪的 ref（weekAll / events / routines / todos），不新增任何存储。
   减法（2026-10-02）：筛选 chips / listFilter / listCounts 整组移除。
   分组标题自带数量（「待办 · 3」），chips 提供的计数是重复信息；
   而 chips 的代价是每次进页都要先做一次「我该选哪个」的判断——这正是不无感。 */

const listTotalCount = computed(
  () => weekAll.value.length + events.value.length + routines.value.length + todos.value.length
)

/* 绝对日期：清单是总览，不跟今日页用「今天 / 明天」那种相对文案 */
function listDateLabel(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? Number(m[2]) + '月' + Number(m[3]) + '日' : ''
}

/* 分组：课程 / 独立日程 / 循环日程 / 待办。
   排序口径——课程与循环按「星期 → 起始时间」（它们本来就按周重复），
   独立日程按「日期 → 起始时间」，待办按「未完成优先 → 截止日期」。
   空组不输出（没有内容的组连标题都不出现）。 */
const listGroups = computed(() => {
  const byWeek = (a, b) => (a.weekday - b.weekday) || (minOf(a.start) - minOf(b.start))
  const out = []
  const courses = [...weekAll.value].sort(byWeek)
  if (courses.length) out.push({ key: 'course', title: '课程', items: courses })
  const evs = [...events.value].sort(
    (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (minOf(a.start) - minOf(b.start))
  )
  if (evs.length) out.push({ key: 'event', title: '独立日程', items: evs })
  const rts = [...routines.value].sort(byWeek)
  if (rts.length) out.push({ key: 'routine', title: '循环日程', items: rts })
  const tds = [...todos.value].sort(
    (a, b) => ((a.done ? 1 : 0) - (b.done ? 1 : 0))
      || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))
  )
  if (tds.length) out.push({ key: 'todo', title: '待办', items: tds })
  return out
})

/* 左侧色条：三类日程各走自己的调色板（循环日程是固定灰蓝），待办用中性灰 */
function listBarColor(it, kind) {
  if (kind === 'todo') return it.done ? '#cbd1dc' : '#8b97ad'
  return pal(it).bar
}

/* 次要行：星期或日期 + 时间区间 + 地点 + 周次规则（独立日程不重复打「日程」二字） */
function listMeta(it, kind) {
  if (kind === 'todo') {
    /* 导入态有待办绝对日期（due_date）；示例态只有相对文案（due = 今天/明天/周五）。
       两者取其一，都没有才说「无截止日期」——不要漏成「截止 —」。 */
    const when = listDateLabel(it.due_date) || it.due || ''
    if (it.done) return '已完成' + (when ? ' · 截止 ' + when : '')
    if (!when) return '无截止日期'
    const overdue = (it.due_date && it.due_date < todayKeyOf()) || it.due === '已过期'
    return (overdue ? '已过期 · ' : '截止 ') + when
  }
  const parts = []
  parts.push(it.weekday ? WDN[it.weekday - 1] : listDateLabel(it.date))
  if (it.start) parts.push(it.start + '–' + (it.end || ''))
  if (it.place) parts.push(it.place)
  if (it.tag && kind !== 'event') parts.push(it.tag)
  return parts.filter(Boolean).join(' · ')
}

/* 点条目：三类日程走同一个详情弹层（那里能编辑/删除），待办开编辑表单 */
function onListItem(it, kind) {
  if (kind === 'todo') openTodoEdit(it)
  else openDetail(it)
}

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
/* 从网格位置打开表单：分钟吸附到 5 分钟，整段钳在 08:00–22:00 内
   kind 决定这张表单是「课程」还是「循环日程」——同一个面板两态，字段几乎一样，
   差别只在：循环日程固定每周（不显示单双周）、不占学期课表、落库走 routine 分支 */
/* 落点 → 表单起点：吸附到 5 分钟，再夹进合法区间 —— 不早于 DAY_START、且加上**该表单自己的
   默认时长**后不晚于 DAY_END。
   两处口径要一致：① 不能再出现「菜单说 08:00、表单开 08:30」这种事
   （旧写法 `Math.max(DAY_START + 30, …)` 会把第 1 节 08:00 抬成 08:30，用户挑的明明是空格，
   却因为叠加默认时长压到 09:00 的课上，首次提交白吃一条冲突提示）；DAY_START 的注释本来就写着
   「仍是添加课程表单的合法时间下界」，所以下界就是 DAY_START。
   ② 上界必须按各自默认时长算：课程 45 分沿用课程口径没问题，但循环日程默认 60 分，
   仍用 45 会让落点靠后时超 22:00。 */
function clampStart(min, dur) {
  return Math.max(DAY_START, Math.min(DAY_END - dur, Math.round(min / 5) * 5))
}
/* 添加课程：默认 45 分钟 */
function openAdd(wd, min) {
  const dur = 45
  addForm.value = { kind: 'course', weekday: wd, start: fmtTime(clampStart(min, dur)), duration: dur, name: '', place: '', week_rule: 'every', editingId: null }
  addErr.value = ''
  addWarn.value = ''
  addConfirmed.value = false
}
/* 循环日程表单：默认 60 分钟（运动/自习这类通常一小时），周次固定每周 */
function openAddRoutine(wd, min) {
  const dur = 60
  addForm.value = { kind: 'routine', weekday: wd, start: fmtTime(clampStart(min, dur)), duration: dur, name: '', place: '', week_rule: 'every', editingId: null }
  addErr.value = ''
  addWarn.value = ''
  addConfirmed.value = false
}
/* 长按空白处的两选一菜单（2026-10-01 用户拍板：长按弹菜单、双击仍直接进加课程）。
   菜单只记落点，选完再开对应表单，避免「长按直接定死类型」改掉老习惯。 */
const addPick = ref(null) // { wd, start }
function pickKind(kind) {
  const p = addPick.value
  addPick.value = null
  if (!p) return
  const min = minOf(p.start)
  if (kind === 'routine') openAddRoutine(p.wd, min)
  else openAdd(p.wd, min)
}
/* 编辑课程：详情弹层进来，预填原值（自加课/导入课/mock 课都走这张表单，origin 记来源） */
function editCourseFromDetail() {
  if (!detail.value || detail.value.type !== 'course') return
  const c = detail.value
  detail.value = null
  addForm.value = {
    kind: 'course',
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
/* 编辑循环日程：与课程同一个表单，走 kind:'routine' 分支。
   表单不显示单双周选项，但这里要把原值带上 —— 导入进来的 odd/even 循环日程
   （主项目那边可以有）编辑一次不该被静默改成「每周」。 */
function editRoutineFromDetail() {
  if (!detail.value || detail.value.type !== 'routine') return
  const c = detail.value
  detail.value = null
  addForm.value = {
    kind: 'routine',
    weekday: c.weekday || 1,
    start: c.start,
    duration: minOf(c.end) - minOf(c.start),
    name: c.name,
    place: c.place || '',
    week_rule: c.week_rule || 'every',
    editingId: c.id,
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
  if (!f) return
  const isRoutine = f.kind === 'routine'
  if (!f.name.trim()) {
    addErr.value = isRoutine ? '先给循环日程起个名字～' : '先给课程起个名字～'
    return
  }
  const endMin = minOf(f.start) + f.duration
  if (endMin > DAY_END) {
    addErr.value = '结束时间会超出 22:00，调短时长吧'
    return
  }
  const end = fmtTime(endMin)
  /* 冲突检测（PRD F4 口径：提示但不强制阻止）——第一次点保存只警告，再点一次放行。
     课程 ↔ 循环日程双向互检；候选池同时含独立日程（换算出那天的星期与周次后比）。
     不分课程/循环日程两条路各写一遍：口径一样，写两处迟早漂移。 */
  if (!addConfirmed.value) {
    const conflicts = findConflicts(
      { id: f.editingId, type: isRoutine ? 'routine' : 'course', weekday: f.weekday, start: f.start, end, week_rule: f.week_rule },
      conflictPool.value,
    )
    if (conflicts.length) {
      addConfirmed.value = true
      const names = [...new Set(conflicts.map((c) => c.name))].join('」「')
      /* 后缀只在「目标是课程、撞上的是循环日程」时加 —— 目标自己就是循环日程时不必解释 */
      const mix = !isRoutine && conflicts.some((c) => c.type === 'routine') ? '（含循环日程）' : ''
      addWarn.value = '与「' + names + '」' + mix + '时间冲突，再点一次「保存」可忽略'
      return
    }
  }
  /* 循环日程：不进课表，落库走 routine 双源分支 */
  if (isRoutine) {
    if (f.editingId) {
      updateRoutine(f.editingId, {
        weekday: f.weekday,
        name: f.name.trim(),
        place: f.place.trim(),
        start: f.start,
        end,
        week_rule: f.week_rule,
      })
    } else {
      addRoutine({
        title: f.name.trim(),
        weekday: f.weekday,
        start_time: f.start,
        duration: f.duration,
        location: f.place.trim(),
        week_rule: f.week_rule,
      })
    }
    addForm.value = null
    reloadDataset()
    return
  }
  const payload = {
    weekday: f.weekday,
    name: f.name.trim(),
    place: f.place.trim(),
    tag: { every: '每周', odd: '单周', even: '双周' }[f.week_rule],
    start: f.start,
    end,
    week_rule: f.week_rule,
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

/* 循环日程删除：与课程共用二次确认（同一时刻详情弹层里只会有一种类型） */
function removeRoutineFromDetail() {
  if (!detail.value || detail.value.type !== 'routine') return
  removeRoutine(detail.value.id)
  detail.value = null
  reloadDataset()
}
function onDelRoutine() {
  if (!confirmDel.value) {
    confirmDel.value = true
    clearTimeout(confirmDelTimer)
    confirmDelTimer = setTimeout(() => { confirmDel.value = false }, 3000)
    return
  }
  clearTimeout(confirmDelTimer)
  confirmDel.value = false
  removeRoutineFromDetail()
}

/* 手势：触屏长按 550ms → 类型菜单；鼠标双击 → 直接加课程（老习惯保留）。
   点在课卡上不触发，拖动超 8px（滚动）取消。
   网格化后不再做「像素 → 时间」换算 —— 那套换算正是旧画法对不齐的根源。
   改成直接问「手指落在哪个格子上」：位置由 DOM 说了算，永远不会错一格。 */
let lpTimer = null
let lpFrom = null
/* 落点 → { wd, start }：位置由 DOM 说了算，永远不会错一格 */
function cellAt(p) {
  const el = document.elementFromPoint(p.x, p.y)
  const cell = el && el.closest ? el.closest('[data-cell]') : null
  if (!cell) return null
  const [wd, idx] = cell.dataset.cell.split('-').map(Number)
  const per = periods.value[idx]
  if (!per) return null
  return { wd, start: per.start }
}
/* 长按：弹「加课程 / 加循环日程」菜单 */
function firePick(p) {
  const at = cellAt(p)
  if (!at) return
  addPick.value = { wd: at.wd, start: at.start }
}
function gridDown(e) {
  if (e.target.closest('article')) return
  lpFrom = { x: e.clientX, y: e.clientY }
  clearTimeout(lpTimer)
  lpTimer = setTimeout(() => {
    lpTimer = null
    firePick(lpFrom)
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
/* 双击：不进菜单，直接开「添加课程」表单 */
function gridDbl(e) {
  if (e.target.closest('article')) return
  const at = cellAt({ x: e.clientX, y: e.clientY })
  if (at) openAdd(at.wd, minOf(at.start))
}
</script>

<template>
  <!-- min-height 要减掉外壳的状态栏让位 --sat（App 内 ~28px，浏览器无此变量取 0）：
       不减的话根仍是 100vh，加上 #app 的 padding-top 后总高多出正好一个状态栏
       —— 2026-10-01 真机「小幅上下拖」的第二层根因（第一层在 gridH 公式） -->
  <div class="mx-auto flex min-h-[calc(100vh-var(--sat,0px))] max-w-md flex-col overflow-x-clip">
    <!-- 顶栏：淡雅氛围卡——四角全圆+四周留白，浏览器里不再有「上尖下圆」的裁切感 -->
    <!-- 头部问候卡：今日页完整版（大问候语 + 状态气泡 + 今日概要）；周课表/我的页紧凑版
         （2026-10-01 用户要求「上方卡片收缩时多缩一点，给课表多腾空间」——原来只有
         气泡和概要会收，问候语和 padding 常驻不动，头部占 ~140px；紧凑版收掉 ~50px） -->
    <header
      class="relative mx-4 mt-3 overflow-hidden rounded-[20px] bg-gradient-to-br from-primary-50 to-primary-100 shadow-sm transition-all duration-[280ms]"
      :class="tab === 'today' ? 'px-5 pb-5 pt-5' : 'px-5 pb-3 pt-3.5'"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 flex-1">
          <p class="text-[13px] font-medium text-primary-600">
            {{ dateText }} {{ weekDay }} · 第 {{ semester.week }} 周
          </p>
          <h1
            class="font-bold tracking-tight text-ink transition-all duration-[280ms]"
            :class="tab === 'today' ? 'mt-1 text-2xl' : 'mt-0.5 truncate text-lg'"
          >{{ greetingText }}</h1>
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
                <p class="text-xs text-ink-dim">今天 {{ todayCourses.length }} {{ todayRoutineCount ? '项安排' : '节课' }}</p>
                <p class="mt-0.5 truncate text-sm font-semibold text-ink">
                  {{ headerCourseText }}
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

    <!-- 内容平移层（Day 11 二轮）：四页并排各占 1/4，translateX 跟随 tab，连点改道可打断。
         2026-10-01 加左右滑动手势：swipeDx 并进 translateX 跟手，swiping 时关 transform
         过渡（拖动零延迟），松手恢复过渡播放回弹/切换动画；touch-pan-y 把横向手势让给 JS。
         除数用 TAB_KEYS.length 而不是写死——2026-10-02 加第四页「打卡」时，
         原来写死的 /3 让平移只走四分之三，页面错位（截图实证）。 -->
    <div
      ref="stripRef"
      class="flex w-[500%] shrink-0 items-start overflow-y-clip touch-pan-y duration-[280ms]"
      style="transition-property: transform, height; transition-timing-function: cubic-bezier(0.32, 0.72, 0.35, 1)"
      :style="{
        transform: `translateX(calc(-${(tabIndex * 100) / TAB_KEYS.length}% + ${swipeDx}px))`,
        transitionDelay: stripDelay,
        transitionProperty: swiping ? 'height' : 'transform, height',
        height: stripH ? stripH + 'px' : 'auto',
      }"
    >
    <!-- ===== 今日 ===== -->
    <main data-page="today" class="w-1/5 space-y-4 px-4 pt-4 pb-28" :inert="tab !== 'today'">
      <!-- 课堂录音入口（M5 第 2 步）：今日页直达，不用每次绕「我的」；
           录音中整卡变红显示计时，停录后自动转写→纪要→作业转待办一路到底 -->
      <section
        class="rounded-2xl border bg-card p-3.5 shadow-sm"
        :class="recActiveId ? 'border-red-300' : 'border-line'"
        data-today-rec
      >
        <div class="flex items-center gap-3.5">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" :class="recActiveId ? 'bg-red-400/10' : 'bg-primary-50'">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5" :class="recActiveId ? 'text-red-400' : 'text-primary-500'" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="1.5" width="4" height="8" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 009 0M8 12v2.5M5.5 14.5h5" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <template v-if="!recActiveId">
              <span class="block text-sm font-medium">课堂录音</span>
              <span class="block text-[11px] text-ink-dim/70">下课 2 分钟自动停；停录后自动转写、纪要、作业转待办</span>
            </template>
            <template v-else>
              <span class="flex items-center gap-2">
                <span class="h-2 w-2 animate-pulse rounded-full bg-red-400"></span>
                <span class="text-sm font-semibold tabular-nums">{{ fmtDur(recElapsed * 1000) }}</span>
              </span>
              <span class="block text-[11px] text-ink-dim/70">录音中 · 锁屏也会继续录</span>
            </template>
          </span>
          <button
            v-if="!recActiveId"
            data-today-rec-start
            class="shrink-0 rounded-full bg-primary-500 px-4 py-2 text-xs font-medium text-white transition active:scale-95"
            :class="recSupported ? '' : 'opacity-60'"
            @click="startRec"
          >
            开始录音
          </button>
          <button
            v-else
            data-today-rec-stop
            class="shrink-0 rounded-full bg-red-400 px-4 py-2 text-xs font-medium text-white transition active:scale-95"
            @click="stopRec"
          >
            停止并保存
          </button>
        </div>
        <p v-if="recMsg" class="mt-2.5 text-[11px]" :class="recMsgBad ? 'text-red-400' : 'text-primary-500'">{{ recMsg }}</p>
      </section>

      <!-- 今日课程与循环日程：时间线卡片（循环日程带小循环标记 + 专属灰蓝，与课程区分） -->
      <section>
        <h2 class="mb-2 px-1 text-sm font-semibold text-ink">今日课程</h2>
        <div v-if="todayCourses.length" class="space-y-2.5">
          <article
            v-for="c in todayCourses"
            :key="c.id"
            data-today-item
            :data-item-type="c.type || 'course'"
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
              <p
                class="text-sm font-bold"
                :class="courseStatus(c) === 'now' ? 'text-primary-600' : 'text-primary-500'"
                :style="isRoutine(c) ? { color: pal(c).text } : {}"
              >{{ c.start }}</p>
              <p class="text-[11px] text-ink-dim">{{ c.end }}</p>
            </div>
            <div
              class="h-9 w-1 rounded-full"
              :class="courseStatus(c) === 'now' ? 'bg-primary-500' : 'bg-primary-200'"
              :style="isRoutine(c) ? { background: pal(c).bar } : {}"
            ></div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1">
                <svg
                  v-if="isRoutine(c)"
                  data-routine-mark
                  viewBox="0 0 16 16"
                  aria-label="循环日程"
                  class="h-3.5 w-3.5 shrink-0"
                  :style="{ color: pal(c).text }"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.9"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M13 8a5 5 0 11-1.9-3.9" />
                  <path d="M13 2.2V5h-2.8" />
                </svg>
                <p class="truncate text-[15px] font-medium">{{ c.name }}</p>
              </div>
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
            <span
              v-if="c.tag"
              class="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-[11px] text-primary-600"
              :style="isRoutine(c) ? { background: hexA(pal(c).bar, 0.14), color: pal(c).text } : {}"
            >
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

<!-- 今日打卡（三期）：今日页只留「一按即打」这个高频动作——它跟「今天的课/待办」同住一屏，
     不用为了打个卡先切页。7 格 / 连续 / 累计 / 添加 / 删除 / 补卡都是管理动作（低频），
     全部收在「打卡」页，同一个动作不到处各写一份。
     打卡圆圈保留 h-11 热区；aria-label 沿用「今日打卡 / 取消今日打卡」。
     ⚠️ 减法（2026-10-02）：**全部打完就收成一行**——不摆无意义的 0 项待办列表，
     已完成的事退出视线（设计三原则之一「与当前任务无关的界面元素绝不出现」）。
     收起来后仍要能「取消打卡」和进管理页，所以那一行右边留小勾按钮 + 管理入口。 -->
<section>
  <!-- 全部打完：一行摘要（可取消 · 可进管理 · 可展开回看） -->
  <div v-if="habits.length && habitsAllDoneToday" data-today-habit-done class="flex items-center gap-2 px-1">
    <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-500 text-white">
      <svg viewBox="0 0 16 16" class="h-3 w-3" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </span>
    <p class="min-w-0 flex-1 truncate text-xs text-ink-dim">今日打卡已完成 · {{ habits.length }} 项</p>
    <button
      type="button"
      data-today-habit-undo
      class="shrink-0 text-xs text-ink-dim/70 underline decoration-dotted underline-offset-2 transition active:opacity-60"
      @click="undoAllHabitsToday"
    >
      取消
    </button>
    <button
      type="button"
      data-today-habit-more
      class="shrink-0 rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-ink-dim transition active:scale-95"
      @click="switchTab('habit')"
    >
      管理 ›
    </button>
  </div>

  <template v-else>
    <div class="mb-2 flex items-center justify-between px-1">
      <h2 class="text-sm font-semibold text-ink">今日打卡</h2>
      <button
        type="button"
        data-today-habit-more
        class="rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-ink-dim transition active:scale-95"
        @click="switchTab('habit')"
      >
        管理 ›
      </button>
    </div>

    <div v-if="habits.length" class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
      <div v-for="h in habits" :key="h.id" :data-today-habit="h.id" class="flex items-center gap-3 p-3.5">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm" :class="h.records[habitToday] ? 'text-ink-dim' : 'text-ink'">{{ h.name }}</p>
          <p class="mt-0.5 text-[11px] text-ink-dim/70">{{ streakOf(h, habitToday) > 0 ? '连续 ' + streakOf(h, habitToday) + ' 天' : '未开始' }}</p>
        </div>
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
      </div>
    </div>
    <p v-else class="rounded-2xl border border-dashed border-line bg-card/60 p-5 text-center text-sm text-ink-dim">
      还没有打卡习惯，去「打卡」页建一个
    </p>
  </template>
</section>
    </main>

    <!-- ===== 周课表 =====
         pb-16（64px）不是随手写的：网格本来就一屏看完，底部留白只需保证「不被底部导航压住」，
         留 pb-28(112px) 会让文档比屏幕高 44px → 用户能上下滑出一片空白
         （2026-10-01 实测：390×844 下 pb-28 时 maxScroll=44）。 -->
    <main data-page="week" class="w-1/5 px-4 pt-4 pb-16" :inert="tab !== 'week'">
      <!-- 周次切换 -->
      <section class="flex items-center justify-between rounded-2xl border border-line bg-card px-2 py-2 shadow-sm">
        <button
          data-week-prev
          class="flex h-9 w-9 items-center justify-center rounded-xl text-ink-dim transition active:bg-ink/10"
          @click="weekOffset--"
        >
          <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5" /></svg>
        </button>
        <p class="text-sm font-semibold" data-week-label>
          第 {{ weekNo }} 周
          <span class="ml-1 text-xs font-normal text-ink-dim">/ 共 {{ semester.totalWeeks }} 周</span>
        </p>
        <button
          data-week-next
          class="flex h-9 w-9 items-center justify-center rounded-xl text-ink-dim transition active:bg-ink/10"
          @click="weekOffset++"
        >
          <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>
      </section>

      <!-- 节次网格：行 = 节次、列 = 星期、课程 = 格子 —— 一屏看完，不用上下左右滑。
           课程卡与格子共用同一套坐标系，所以不存在「平行线对不齐」这回事。 -->
      <section class="mt-3 overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
        <!-- 表头：星期 + 日期 -->
        <div class="grid border-b border-line" :style="gridColsStyle">
          <div class="py-1.5"></div>
          <div
            v-for="d in weekCols"
            :key="d.wd"
            class="border-l border-line/50 py-1.5 text-center"
          >
            <p class="text-[11px] leading-tight" :class="d.isToday ? 'font-semibold text-primary-600' : 'text-ink-dim'">周{{ d.label }}</p>
            <p class="mt-0.5 text-[12px] leading-tight font-semibold" :class="d.isToday ? 'text-primary-600' : 'text-ink'">
              {{ d.date }}
            </p>
          </div>
        </div>

        <!-- 网格主体 -->
        <div
          data-grid
          class="relative grid select-none"
          :style="gridBodyStyle"
          @pointerdown="gridDown"
          @pointermove="gridMove"
          @pointerup="gridUp"
          @pointercancel="gridUp"
          @dblclick="gridDbl"
        >
          <template v-for="(r, ri) in gridRows" :key="ri">
            <!-- 分隔行：上午/下午/晚上之间的午休、晚休（补回网格里看不见的时间差） -->
            <div
              v-if="r.type === 'gap'"
              data-gap
              class="flex items-center gap-1.5 bg-ink/[0.04] px-1 text-[9px] font-medium text-ink-dim/80"
              :style="{ gridColumn: '1 / -1', gridRow: ri + 1 }"
            >
              <span class="h-px flex-1 bg-line/70"></span>
              <span class="shrink-0">{{ r.label }}</span>
              <span class="h-px flex-1 bg-line/70"></span>
            </div>

            <!-- 节次行：左侧「第N节 / 08:00」+ 每天的格子 -->
            <template v-else>
              <div
                :data-axis="r.p.no"
                class="flex flex-col items-center justify-center overflow-hidden bg-ink/[0.02] leading-none"
                :style="{ gridColumn: 1, gridRow: ri + 1 }"
              >
                <span class="text-[10px] font-semibold text-primary-600/90">第{{ r.p.no }}节</span>
                <span class="mt-0.5 text-[9px] text-ink-dim/80">{{ r.p.start }}</span>
              </div>
              <div
                v-for="d in weekCols"
                :key="d.wd"
                :data-cell="d.wd + '-' + r.idx"
                :data-today="d.isToday ? '1' : null"
                class="border-t border-l border-line/50"
                :class="d.isToday ? 'bg-primary-500/[0.06]' : ''"
                :style="{ gridColumn: d.wd + 1, gridRow: ri + 1 }"
              ></div>
            </template>
          </template>

          <!-- 课程卡：跨行表达连堂，与格线天然对齐；纯色块风格与识别预览表统一
               （2026-10-01 板块 C：去掉左侧 3px 色条与配套缩进，两边一套画法） -->
          <article
            v-for="it in gridCourses"
            :key="it.c.id"
            :data-item-type="it.c.type || 'course'"
            class="relative m-[1px] cursor-pointer overflow-hidden rounded-[5px] px-1 py-0.5 shadow-sm ring-1 ring-line/70 transition active:scale-[0.97]"
            :class="gridStatus(it) === 'now' ? 'ring-2 ring-primary-500' : (gridStatus(it) === 'past' ? 'opacity-55' : '')"
            :style="{ ...gridStyleOf(it, gridRowOfIdx), background: pal(it.c).bg }"
            @click="openDetail(it.c)"
          >
            <!-- 课名行包一层 flex：循环日程在课名前挂一枚小循环标记
                 （2026-10-01 用户拍板「卡片带小图标/前缀标记」，与固定灰蓝底色双重区分） -->
            <div class="flex items-start gap-[2px]">
              <svg
                v-if="isRoutine(it.c)"
                data-routine-mark
                viewBox="0 0 16 16"
                aria-label="循环日程"
                class="mt-[1.5px] h-3 w-3 shrink-0"
                :style="{ color: pal(it.c).text }"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M13 8a5 5 0 11-1.9-3.9" />
                <path d="M13 2.2V5h-2.8" />
              </svg>
              <!-- 课名与地点按卡片实际高度决定行数（2026-10-01 用户要「看到完整信息」）：
                   原来 truncate 只给一行，长课名（「习近平新时代…概论」）全被省略号吃掉。
                   min-w-0 是 flex 子项能正常收缩+clamp 的前提。 -->
              <p
                class="min-w-0 text-[10px] leading-[1.15] font-semibold"
                :class="cardFit(it) === 'tight' ? 'truncate' : 'line-clamp-2 break-words'"
                :style="{ color: pal(it.c).text }"
              >{{ it.c.name }}</p>
            </div>
            <p
              v-if="it.c.place && cardFit(it) !== 'mid2'"
              class="text-[9px] leading-tight text-ink-dim"
              :class="cardFit(it) === 'loose' ? 'line-clamp-3 break-words' : 'truncate'"
            >{{ it.c.place }}</p>
            <!-- 只在与节次边界不齐时标真实时间（识别导入的课常见），对齐的不啰嗦 -->
            <span
              v-if="!isAligned(it.c, periods)"
              class="absolute right-0.5 bottom-0 text-[8px] leading-none text-ink-dim/80"
            >{{ it.c.start }}</span>
          </article>
        </div>
      </section>
    </main>

<!-- ===== 日程清单页（三期「日程分类视图」，2026-10-02）=====
     为什么需要它：独立日程（event）此前没有任何集中入口——加一条「10 月 20 日交材料」，
     除非翻到那天的今日页，否则根本看不见。这一页把三类日程 + 待办平铺成清单。
     分组口径：课程（导入态 + 自加）、独立日程、循环日程、待办；课程/循环按星期排，
     独立日程/待办按日期排。点条目复用 openDetail（同一套详情与编辑），待办直接勾选。
     减法（2026-10-02）：**砍掉顶部 5 个筛选 chips**——分组标题已经说明一切，
     chips 只是又一层「先做选择」的门槛；想只看待办时往下滚比先点一下更便宜。 -->
<main data-page="list" class="w-1/5 space-y-4 px-4 pt-4 pb-28" :inert="tab !== 'list'">
  <section data-list-page>
    <div class="mb-2 flex items-baseline justify-between px-1">
      <h2 class="text-sm font-semibold text-ink">日程清单</h2>
      <span class="text-xs text-ink-dim/70">{{ listTotalCount }} 项</span>
    </div>

    <!-- 空态：本来就没有 -->
    <p
      v-if="!listGroups.length"
      data-list-empty
      class="rounded-2xl border border-dashed border-line bg-card/60 p-5 text-center text-sm text-ink-dim"
    >
      还没有任何日程，去周课表长按空白处加一条
    </p>

    <!-- 分组列表 -->
    <div v-for="g in listGroups" :key="g.key" :data-list-group="g.key" class="mb-4">
      <p class="mb-1.5 px-1 text-xs font-semibold text-ink-dim">{{ g.title }} · {{ g.items.length }}</p>
      <div class="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
        <div
          v-for="it in g.items"
          :key="g.key + '-' + it.id"
          data-list-item
              :data-item-type="g.key"
              class="flex items-center gap-3 px-3.5 py-3"
            >
              <!-- 待办：左侧直接给勾选圆圈（点圆圈才算打勾，不包整行） -->
              <button
                v-if="g.key === 'todo'"
                type="button"
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition active:scale-90"
                :class="it.done ? 'border-primary-500 bg-primary-500 text-white' : 'border-ink-dim/30 text-transparent'"
                :aria-label="it.done ? '取消完成' : '标记完成'"
                @click="toggleTodo(it.id)"
              >
                <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>

              <!-- 主体：点开详情（待办也点开，但不含勾选动作） -->
              <button type="button" class="flex min-w-0 flex-1 items-center gap-3 text-left" @click="onListItem(it, g.key)">
                <span class="h-9 w-1.5 shrink-0 rounded-full" :style="{ backgroundColor: listBarColor(it, g.key) }"></span>
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-1.5">
                    <svg
                      v-if="g.key === 'routine'"
                      data-routine-mark
                      viewBox="0 0 16 16"
                      class="h-3.5 w-3.5 shrink-0 text-ink-dim"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                    ><path d="M3 8a5 5 0 105-5M3 8V5M3 8h3" /></svg>
                    <span class="truncate text-sm" :class="g.key === 'todo' && it.done ? 'text-ink-dim line-through' : 'text-ink'">{{ entryName(it) }}</span>
                  </span>
                  <span class="mt-0.5 block truncate text-[11px] text-ink-dim/80">{{ listMeta(it, g.key) }}</span>
                </span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- ===== 打卡页（三期「每日打卡」）=====
         分工：今日页只留「一按即打」的高频动作，管理（添加 / 删除 / 翻历史周 / 补卡）收在这一页。
         宽限期 = 本周内且今天之前（口径见 data/store.js）；过期/未来格子明确画成锁定态，
         并且**不用 disabled**（那样点下去毫无反馈还挡测试），改由 onHabitCell 静默忽略。 -->
    <main data-page="habit" class="w-1/5 space-y-4 px-4 pt-4 pb-28" :inert="tab !== 'habit'">
      <!-- 今日完成度 -->
      <section class="rounded-3xl border border-line bg-card p-5 shadow-sm">
        <div class="flex items-end justify-between">
          <div>
            <p class="text-xs text-ink-dim">{{ habitTodayText }}</p>
            <p class="mt-1 text-2xl font-bold tabular-nums text-ink">
              {{ habitTodayDone }}<span class="text-base font-semibold text-ink-dim"> / {{ habits.length }}</span>
            </p>
          </div>
          <p class="pb-1 text-xs text-ink-dim">今日已打卡</p>
        </div>
        <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-ink/[0.08]">
          <div
            class="h-full rounded-full bg-primary-500 transition-all duration-300"
            :style="{ width: habits.length ? (habitTodayDone / habits.length) * 100 + '%' : '0%' }"
          />
        </div>
      </section>

      <!-- 打卡记录：周切换 + 习惯卡片 -->
      <section>
        <div class="mb-2 flex items-center justify-between px-1">
          <h2 class="text-sm font-semibold text-ink">打卡记录</h2>
          <button
            class="rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-ink-dim transition active:scale-95"
            @click="habitInput = !habitInput; habitName = ''"
          >
            {{ habitInput ? '收起' : '＋ 添加' }}
          </button>
        </div>

        <!-- 周切换：只能往回看（未来没有记录），最多 52 周 -->
        <div class="mb-2 flex items-center justify-between rounded-2xl border border-line bg-card px-1.5 py-1.5 shadow-sm">
          <button
            type="button"
            data-habit-prev
            class="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-ink-dim transition active:scale-90 disabled:opacity-25"
            :disabled="habitWeekBase <= -52"
            aria-label="看上一周"
            @click="shiftHabitWeek(-1)"
          >‹</button>
          <div class="text-center">
            <p class="text-xs font-medium text-ink tabular-nums">{{ habitWeekLabel }}</p>
            <p class="text-[10px]" :class="habitWeekBase === 0 ? 'text-primary-500' : 'text-ink-dim/70'">
              {{ habitWeekBase === 0 ? '本周 · 漏卡可补' : (habitWeekBase === -1 ? '上周' : -habitWeekBase + ' 周前') + ' · 已锁定' }}
            </p>
          </div>
          <button
            type="button"
            data-habit-next
            class="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-ink-dim transition active:scale-90 disabled:opacity-25"
            :disabled="habitWeekBase >= 0"
            aria-label="看下一周"
            @click="shiftHabitWeek(1)"
          >›</button>
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
            @keyup.enter="addHabitConfirm"
          />
          <button
            class="shrink-0 rounded-xl bg-primary-500 px-4 text-sm font-medium text-white transition active:scale-95 disabled:opacity-40"
            :disabled="!habitName.trim()"
            @click="addHabitConfirm"
          >
            确定
          </button>
        </div>

        <!-- 习惯卡片：名称 + 连续/累计 + 本周格（可补）+ 今日圆圈 + 删除 -->
        <div v-if="habits.length" class="space-y-2">
          <div
            v-for="h in habits"
            :key="h.id"
            :data-habit-row="h.id"
            class="rounded-2xl border border-line bg-card p-3.5 shadow-sm"
          >
            <div class="flex items-center gap-3">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm" :class="h.records[habitToday] ? 'text-ink-dim' : 'text-ink'">{{ h.name }}</p>
                <p class="mt-0.5 text-[11px] text-ink-dim">
                  <span :data-habit-streak="h.id">{{ streakOf(h, habitToday) > 0 ? '连续 ' + streakOf(h, habitToday) + ' 天' : '未开始' }}</span>
                  <span class="mx-1 text-ink-dim/40">·</span>
                  <span :data-habit-total="h.id">共 {{ totalDoneOf(h) }} 天</span>
                </p>
              </div>
              <!-- 今日打卡主操作：h-11 = 44px 热区；已打卡实心勾（可点取消） -->
              <button
                type="button"
                :data-habit-today="h.id"
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

            <!-- 本周 7 格：实心=当天打的 · 空心勾=事后补的 · 虚线圈=宽限期内可补 · 淡=锁定/未来 -->
            <div class="mt-3 grid grid-cols-7 gap-1">
              <button
                v-for="d in habitViewDays"
                :key="d.key"
                type="button"
                :data-habit-cell="h.id + '@' + d.key"
                :data-cell-state="habitCellState(h, d)"
                class="flex flex-col items-center gap-1 rounded-xl py-1.5 transition active:scale-95"
                @click="onHabitCell(h.id, d.key)"
              >
                <span class="text-[10px] leading-none" :class="d.isToday ? 'font-semibold text-primary-500' : 'text-ink-dim/70'">{{ d.name }}</span>
                <span
                  class="flex h-6 w-6 items-center justify-center rounded-full text-[10px] tabular-nums"
                  :class="HABIT_CELL_CLS[habitCellState(h, d)]"
                >
                  <svg v-if="h.records[d.key]" viewBox="0 0 10 10" class="h-2.5 w-2.5" fill="none"><path d="M2 5.2l2 2 4-4.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                  <template v-else>{{ d.day }}</template>
                </span>
              </button>
            </div>
          </div>

          <!-- 图例：补卡是这一轮新增的视觉态，不解释一下没人看得懂 -->
          <p class="px-1 pt-1 text-[11px] leading-relaxed text-ink-dim/80">
            <span class="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-primary-500 align-[-1px]" />当天打卡
            <span class="mx-1 inline-block h-2.5 w-2.5 rounded-full border border-primary-400 bg-primary-50 align-[-1px]" />事后补卡
            <span class="mx-1 inline-block h-2.5 w-2.5 rounded-full border border-dashed border-primary-300 align-[-1px]" />可补
            <span class="ml-1 inline-block h-2.5 w-2.5 rounded-full bg-ink/[0.06] align-[-1px]" />已锁定
          </p>
        </div>
        <p v-else class="rounded-2xl border border-dashed border-line bg-card/60 p-5 text-center text-sm text-ink-dim">
          还没有打卡习惯，点「＋ 添加」建一个
        </p>
      </section>
    </main>

    <!-- ===== 我的 ===== -->
    <main data-page="me" class="w-1/5 space-y-4 px-4 pt-4 pb-28" :inert="tab !== 'me'">
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
      </section>

      <!-- 课堂录音（二期 M2）：App 平台可用；浏览器环境点按给就地提示，不做假录音 -->
      <section class="rounded-2xl border border-line bg-card p-4 shadow-sm">
        <div class="flex items-center gap-3.5">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="1.5" width="4" height="8" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 009 0M8 12v2.5M5.5 14.5h5" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">课堂录音</span>
            <span class="block text-[11px] text-ink-dim/70">下课后 2 分钟自动停；停录后自动转写并生成纪要；长按场次可删除</span>
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

      </section>

      <!-- ===== 设置（折叠）：一次配好、装完就不碰的东西全收在这里 =====
           减法（2026-10-02）：此前主题/纪要/通知/清理/重置/关于全部平铺在首页，
           「我的」页要滑约 3.5 屏，其中 2.5 屏是低频设置 —— 高频的「换学期、导数据」
           反而被埋住。设计三原则第一条写着「与当前任务无关的界面元素绝不出现」，
           折叠就是这句话的落地：平时不出现，需要时一步可达。
           默认收起（高频动作优先）；「课堂纪要」缺 API Key 时会自动展开（见 llmInputOpen）。 -->
      <section class="rounded-2xl border border-line bg-card shadow-sm">
        <button
          type="button"
          data-settings-toggle
          class="flex w-full items-center gap-3.5 p-4 text-left transition active:bg-ink/5"
          :aria-expanded="settingsOpen"
          @click="settingsOpen = !settingsOpen"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">设置</span>
            <span class="block text-[11px] text-ink-dim/70">主题外观 · 课前提醒 · 课堂纪要 · 数据重置</span>
          </span>
          <svg
            viewBox="0 0 16 16"
            class="h-3.5 w-3.5 shrink-0 text-ink-dim/50 transition-transform"
            :class="settingsOpen ? 'rotate-90' : ''"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          ><path d="M6 3l5 5-5 5" /></svg>
        </button>

        <div v-if="settingsOpen" data-settings-body class="divide-y divide-line border-t border-line">

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

        <!-- 清除数据并重置（危险项：二次确认后回到初始设定，无法恢复） -->
        <button
          data-clear-entry
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
                ? '上课前高优先级提醒（会响、会弹横幅），点通知或「开始录音」直接开录。课程、独立日程、循环日程都包含。'
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

        <!-- 数据清理：多次导入叠加的重复课程（有重复才显示，干净的数据不摆这个入口） -->
        <div v-if="addedDupCount" data-dedup-entry class="flex items-center gap-3.5 p-4">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-amber-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6l-1.6 7.2a1.5 1.5 0 01-1.5 1.3H4.6a1.5 1.5 0 01-1.5-1.3L1.5 6M6 6V4a2 2 0 012-2h0a2 2 0 012 2v2M14 6H2" /></svg>
          </span>
          <div class="flex-1">
            <span class="block text-sm font-medium">清理重复课程</span>
            <span class="block text-[11px] text-ink-dim/70">检测到 {{ addedDupCount }} 门重复（多次导入叠加），一键删掉多余的</span>
          </div>
          <button
            class="rounded-full bg-ink/5 px-3 py-1.5 text-xs font-medium transition active:scale-95"
            @click="dedupCourses"
          >一键清理</button>
        </div>

        <!-- 关于 -->
        <div class="flex items-center gap-3.5 p-4">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8a3 3 0 100-6 3 3 0 000 6zM2 14c0-2.5 2.5-4 6-4s6 1.5 6 4" /></svg>
          </span>
          <span class="flex-1 text-sm font-medium">关于</span>
          <span class="text-xs text-ink-dim/70" data-app-version>{{ APP_VERSION }}</span>
        </div>
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
      <div class="relative mx-auto grid max-w-md grid-cols-5 px-6 py-1">
        <!-- 滑块：一个药丸在四个槽位间连续滑动，连点时 transition 自动改道（可打断） -->
        <div class="pointer-events-none absolute inset-0 overflow-hidden">
          <div class="absolute inset-y-0 left-6 right-6">
            <div
              class="flex h-full w-1/5 justify-center transition-transform duration-300"
              style="transition-timing-function: cubic-bezier(0.32, 0.72, 0.35, 1)"
              :style="{ transform: `translateX(${tabIndex * 100}%)` }"
            >
              <!-- 药丸顶=容器py-1(4px)+按钮pt-1(4px)=8px，与 h-7 的图标 wrapper 逐像素重叠
                   （2026-10-01 导航整体压矮：py-2→py-1、pt/pb-1.5→1、图标区 h-8→h-7，78px→62px） -->
              <span class="mt-2 h-7 w-12 rounded-full bg-primary-50"></span>
            </div>
          </div>
        </div>
        <button
          v-for="t in [
            { key: 'today', label: '今日', icon: 'M8 3a5 5 0 100 10A5 5 0 008 3zM8 1v2M8 13v2M1 8h2M13 8h2' },
            { key: 'week', label: '周课表', icon: 'M2 4h12v11H2zM2 7h12M5.5 2v3M10.5 2v3' },
            { key: 'list', label: '日程', icon: 'M2.5 4h1.2M6 4h7.5M2.5 8h1.2M6 8h7.5M2.5 12h1.2M6 12h4.5' },
            { key: 'habit', label: '打卡', icon: 'M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM5.4 8.3l1.8 1.8 3.6-4' },
            { key: 'me', label: '我的', icon: 'M8 8a3 3 0 100-6 3 3 0 000 6zM2 14c0-2.5 2.5-4 6-4s6 1.5 6 4' },
          ]"
          :key="t.key"
          class="relative flex flex-col items-center pt-1 pb-1 transition-transform duration-150 active:scale-90"
          :class="tab === t.key ? 'text-primary-500' : 'text-ink-dim/70'"
          @click="switchTab(t.key)"
        >
          <!-- 图标 wrapper：h-7 w-12 与滑块药丸同尺寸同位置，图标在药丸内绝对居中；
               待办徽标挂在图标容器上（2026-10-01 用户报「离得太远」——原来挂在整宽按钮的
               -top-1.5 -right-2.5，飞到两格之间的半空），贴住图标右上角 -->
          <span class="relative flex h-7 w-12 items-center justify-center">
            <span
              v-if="t.key === 'today' && undoneCount"
              class="absolute top-0 right-1.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-400 px-1 text-[10px] font-bold text-white"
            >{{ undoneCount }}</span>
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
        data-sheet-detail
        class="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
      >
        <!-- 顶部小把手（暗示可下滑关闭） -->
        <div class="mx-auto mb-4 h-1 w-9 rounded-full bg-ink/15"></div>
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <!-- 循环日程在详情里也挂同一枚小循环标记 + 一行类型说明（点开也能确认这不是课） -->
            <p class="flex items-center gap-1.5 text-lg font-bold">
              <svg
                v-if="isRoutine(detail)"
                data-routine-mark
                viewBox="0 0 16 16"
                aria-hidden="true"
                class="h-4 w-4 shrink-0 text-ink-dim"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M13 8a5 5 0 11-1.9-3.9" />
                <path d="M13 2.2V5h-2.8" />
              </svg>
              <span class="truncate">{{ detail.name }}</span>
            </p>
            <p class="mt-1 text-xs text-ink-dim">
              <span v-if="isRoutine(detail)" class="mr-1">循环日程 ·</span>
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
        <!-- 循环日程：编辑与删除，版式与课程一致；二次确认共用同一个 confirmDel -->
        <div v-else-if="detail.type === 'routine'" class="mt-4 grid grid-cols-2 gap-2.5">
          <button
            data-routine-edit
            class="rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
            @click="editRoutineFromDetail"
          >
            编辑
          </button>
          <button
            data-routine-del
            class="rounded-xl border py-2.5 text-sm font-medium transition active:scale-[0.98]"
            :class="confirmDel ? 'border-red-400 bg-red-400/10 text-red-500' : 'border-red-200 text-red-400'"
            @click="onDelRoutine"
          >
            {{ confirmDel ? '再点一次确认' : '删除' }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- 核对页预览的格子弹层：点空格=加课、点课块=改课（同一个面板两态）。
         位置由点中的格子定好，默认只问课名与地点；「位置与节次」要用时才展开 -->
    <Transition name="fade">
      <div v-if="recCell" class="fixed inset-0 z-50 bg-black/40" @click="recCell = null"></div>
    </Transition>
    <Transition name="slide">
      <div
        v-if="recCell"
        data-sheet-cell
        class="fixed inset-x-0 bottom-0 z-[60] mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
      >
        <div class="mx-auto mb-3 h-1 w-9 rounded-full bg-ink/15"></div>
        <p class="text-base font-bold" data-cell-where>{{ recCellWhere }}</p>
        <p class="mt-0.5 text-xs text-ink-dim">{{ recCell.index === null ? '这一格还没有课，填个课名就加上' : '改完记得保存' }}</p>
        <div class="mt-4 space-y-2.5">
          <input
            v-model="recCell.title"
            data-cell-title
            maxlength="30"
            placeholder="课程名称（必填）"
            class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
          />
          <input
            v-model="recCell.location"
            data-cell-place
            maxlength="30"
            placeholder="地点（选填）"
            class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
          />
          <button
            type="button"
            data-cell-more
            class="flex w-full items-center justify-between rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-left transition active:scale-[0.99]"
            @click="recCell.more = !recCell.more"
          >
            <span class="text-xs text-ink-dim">位置与节次</span>
            <span class="flex items-center gap-1.5 text-xs font-medium text-ink">
              {{ recCellWhen }}
              <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 text-ink-dim transition-transform" :class="recCell.more ? 'rotate-90' : ''" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
            </span>
          </button>
          <div v-if="recCell.more" data-cell-more-body class="space-y-2.5 rounded-xl border border-line bg-canvas p-3">
            <div class="flex gap-1.5">
              <button
                v-for="(w, wi) in WDN"
                :key="wi"
                class="flex-1 rounded-lg py-1.5 text-[11px] font-medium transition active:scale-95"
                :class="recCell.weekday === wi + 1 ? 'bg-primary-500 text-white' : 'bg-ink/5 text-ink-dim'"
                @click="recCell.weekday = wi + 1"
              >
                {{ w }}
              </button>
            </div>
            <div class="flex gap-2">
              <label class="flex flex-1 items-center gap-1.5 text-[11px] text-ink-dim">
                从第
                <select v-model.number="recCell.startIdx" data-cell-from class="min-w-[3rem] flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                  <option v-for="(p, i) in recPeriods" :key="i" :value="i">{{ p.no }} 节</option>
                </select>
              </label>
              <label class="flex flex-1 items-center gap-1.5 text-[11px] text-ink-dim">
                到第
                <select v-model.number="recCell.endIdx" data-cell-to class="min-w-[3rem] flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                  <option v-for="(p, i) in recPeriods" :key="i" :value="i">{{ p.no }} 节</option>
                </select>
              </label>
            </div>
            <p class="text-[11px]" :class="recCellWhen ? 'text-ink-dim' : 'text-red-400'">
              {{ recCellWhen ? '上课时间 ' + recCellWhen : '节次超出当前节次表' }}
            </p>
          </div>
        </div>
        <p v-if="recCellErr" data-cell-err class="mt-2.5 text-xs text-red-400">{{ recCellErr }}</p>
        <div class="mt-4 flex gap-2.5">
          <button
            v-if="recCell.index !== null"
            data-cell-del
            class="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-red-400 transition active:scale-[0.98]"
            @click="delRecCell"
          >
            删除
          </button>
          <button
            class="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
            @click="recCell = null"
          >
            取消
          </button>
          <button
            data-cell-save
            class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
            @click="submitRecCell"
          >
            {{ recCell.index === null ? '添加' : '保存' }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- 长按空白处弹出的类型菜单：加课程 / 加循环日程（用户拍板：长按弹菜单、双击直接加课）。
         与下面的表单面板同为 z-20/z-30 层，二者互斥（选完立刻关菜单再开表单）。 -->
    <Transition name="fade">
      <div v-if="addPick" data-add-pick-mask class="fixed inset-0 z-20 bg-black/40" @click="addPick = null"></div>
    </Transition>
    <Transition name="slide">
      <div
        v-if="addPick"
        data-add-pick
        class="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
      >
        <div class="mx-auto mb-3 h-1 w-9 rounded-full bg-ink/15"></div>
        <p class="text-base font-bold">在 {{ WDN[addPick.wd - 1] }} {{ addPick.start }} 添加</p>
        <p class="mt-1 text-xs text-ink-dim">选一个类型</p>
        <div class="mt-4 space-y-2.5">
          <button
            data-pick-course
            class="flex w-full items-center justify-between rounded-xl border border-line bg-canvas px-3.5 py-3 text-left transition active:scale-[0.98]"
            @click="pickKind('course')"
          >
            <span class="text-sm font-semibold">课程</span>
            <span class="text-xs text-ink-dim">按周重复 · 计入学期课表</span>
          </button>
          <button
            data-pick-routine
            class="flex w-full items-center justify-between rounded-xl border border-line bg-canvas px-3.5 py-3 text-left transition active:scale-[0.98]"
            @click="pickKind('routine')"
          >
            <span class="flex items-center gap-1.5 text-sm font-semibold">
              <!-- 小循环箭头，与周视图卡片上的标记同款，选的时候就认得出 -->
              <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0" fill="none" stroke="#5b6b8c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2.5 8a5.5 5.5 0 0 1 9.3-4M13.5 8a5.5 5.5 0 0 1-9.3 4" />
                <path d="M11.5 1.6v2.6h-2.6M4.5 14.4v-2.6h2.6" />
              </svg>
              循环日程
            </span>
            <span class="text-xs text-ink-dim">每周固定 · 不占课表</span>
          </button>
        </div>
        <button
          data-pick-cancel
          class="mt-3 w-full rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
          @click="addPick = null"
        >
          取消
        </button>
      </div>
    </Transition>

    <!-- 添加/编辑面板：长按菜单或双击周网格空白处唤起；同一个面板两态，靠 addForm.kind 分流 -->
    <Transition name="fade">
      <div v-if="addForm" class="fixed inset-0 z-20 bg-black/40" @click="addForm = null"></div>
    </Transition>
    <Transition name="slide">
      <div
        v-if="addForm"
        data-sheet-add
        class="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
      >
        <div class="mx-auto mb-3 h-1 w-9 rounded-full bg-ink/15"></div>
        <p class="text-base font-bold" data-add-title>{{ addForm.editingId ? (addForm.kind === 'routine' ? '编辑循环日程' : '编辑课程') : (addForm.kind === 'routine' ? '添加循环日程' : '添加课程') }} · {{ WDN[addForm.weekday - 1] }}</p>
        <div class="mt-4 space-y-3">
          <input
            v-model="addForm.name"
            :placeholder="addForm.kind === 'routine' ? '日程名称（必填）' : '课程名称（必填）'"
            class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
          />
          <!-- 时间：点哪填哪，左右微调 -->
          <div class="flex items-center gap-2.5">
            <div class="flex flex-1 items-center justify-between rounded-xl border border-line bg-canvas px-2 py-1.5">
              <button class="flex h-8 w-8 items-center justify-center rounded-lg text-ink-dim active:bg-ink/10" @click="stepStart(-5)">
                <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5" /></svg>
              </button>
              <span class="text-sm font-semibold tabular-nums" data-add-start>{{ addForm.start }}</span>
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
          <!-- 周次规则：循环日程固定每周，不显示单双周（2026-10-01 用户拍板口径） -->
          <div v-if="addForm.kind !== 'routine'" class="flex gap-2">
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
          <!-- 编辑导入进来的单/双周循环日程时如实说明：表单不给这个选项，但也不会把它改掉 -->
          <p v-else class="rounded-xl border border-line bg-canvas px-3 py-2 text-xs leading-relaxed text-ink-dim">
            {{ addForm.week_rule === 'every'
              ? '循环日程每周重复，不占学期课表。'
              : '这条原本是' + ({ odd: '单周', even: '双周' }[addForm.week_rule] || '每周') + '，保存后保持原样（循环日程表单不提供单双周选项）。' }}
          </p>
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
            {{ addForm.editingId ? '保存修改' : (addForm.kind === 'routine' ? '添加日程' : '添加') }}
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
        data-sheet-evt
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
        <p v-if="evtWarn" class="mt-2.5 rounded-xl border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-500">{{ evtWarn }}</p>
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
        <p class="mt-2 text-xs text-ink-dim">将清空学期、课程、日程与待办并回到初始设定，无法恢复。API Key、主题与通知设置会保留。</p>
        <div class="mt-5 grid grid-cols-2 gap-2.5">
          <button
            class="rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
            @click="confirmClear = false"
          >
            取消
          </button>
          <button
            data-clear-confirm
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

          <!-- 步骤级切换动画（2026-09-30 用户反馈「三个选项点下去秒跳、没有动画」）：
               复用第 1 步二级页那套 obpage 滑动（style.css 已定义），方向由 obStepDir 决定。
               每个步骤必须是单个根元素 Transition 才认（原来是并列的 <template>，所以没动画）；
               relative 让离场页（CSS 里 position:absolute）以自身卡片高度为基准，
               overflow-hidden 把 ±26px 平移关在框内，不撑出横向滚动条。 -->
          <Transition :name="obStepDir">
          <div v-if="onboardStep === 'choice'" key="choice" class="relative overflow-hidden">
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
          </div>

          <!-- 第 2 步的引导子页：没配 AI Key 时落这里（第一次用的人都没有 Key）。
               原来只在识别页甩一行红字让人「去我的页配」，而引导层是 fixed 全屏、把整个应用
               盖住了 → 那条路根本走不到，是死路。现在三处检测点（第 1 步「下一步：识别课表」、
               识别页的识别按钮、我的页识别入口）缺 Key 一律落到这一页，就地配完再回识别页。 -->
          <div v-else-if="onboardStep === 'aiCfg'" key="aiCfg" class="relative overflow-hidden">
            <div class="rounded-2xl border border-line bg-card p-4 shadow-sm">
              <p class="text-sm font-semibold">识别课表要先配好 AI</p>
              <p class="mt-1 text-xs leading-relaxed text-ink-dim">
                拍课表识别是把图片交给 DeepSeek 的图片识别能力，读成「星期 × 第几节 × 课程名」。所以要有一个 API Key —— 它和「课堂纪要」共用同一个，配一次两处都能用。
              </p>
              <label class="mt-3 block">
                <span class="mb-1 block text-[11px] text-ink-dim/80">DeepSeek API Key（只存在这台设备，不会上传）</span>
                <input
                  v-model="llmCfg.key"
                  data-ob-ai-key
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="sk-…"
                  enterkeyhint="done"
                  class="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-dim/40 focus:border-primary-400"
                  @input="onObAiKey"
                />
              </label>
              <p class="mt-1.5 text-[11px] leading-relaxed text-ink-dim/60">
                去 platform.deepseek.com 注册后，在「API Keys」里新建一个，复制粘贴到上面即可；识别一张课表通常只要几分钱。
              </p>
              <button
                type="button"
                data-ob-ai-test
                class="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-card py-2.5 text-sm font-medium text-ink transition active:scale-[0.98]"
                :class="llmTest.busy ? 'opacity-60' : ''"
                @click="obAiTest"
              >
                <span v-if="llmTest.busy" class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-400 border-t-transparent"></span>
                {{ llmTest.busy ? '正在测试…' : '测试连接' }}
              </button>
              <p
                v-if="llmTest.msg"
                data-ob-ai-test-msg
                class="mt-1.5 px-1 text-[11px] leading-relaxed"
                :class="llmTest.ok ? 'text-primary-500' : 'text-red-400'"
              >{{ llmTest.msg }}</p>

              <button
                type="button"
                data-ob-ai-save
                class="mt-3 w-full rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
                @click="obAiDone"
              >
                保存，去识别课表
              </button>
              <p v-if="obAiErr" data-ob-ai-err class="mt-2 px-1 text-xs text-red-500">{{ obAiErr }}</p>

              <!-- 退路：不想配 Key 也能直接手动建课表（与识别结果走同一套核对/入库链路） -->
              <button
                type="button"
                data-ob-ai-manual
                class="mt-2.5 w-full rounded-xl border border-dashed border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                @click="obManualAdd"
              >
                ＋ 先不配，手动加课
              </button>
              <button
                v-if="!recFromMine"
                type="button"
                data-ob-ai-back
                class="mt-3 w-full rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                @click="obAiBack"
              >
                ← 返回上一步
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
          </div>

          <!-- 第 2 步：识别课表（用户反馈：先在第 1 步设好节次，这一页只负责选图识别） -->
          <div v-else-if="onboardStep === 'rec'" key="rec" class="relative overflow-hidden">
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
          </div>

          <!-- 第 3 步：课表识别确认页 —— 逐条核对/修改后与手填学期一起入库 -->
          <div v-else-if="onboardStep === 'recConfirm'" key="recConfirm" class="relative overflow-hidden">
            <div class="rounded-2xl border border-line bg-card p-4 shadow-sm">
              <p class="text-sm font-semibold">共 {{ recPreview.items.length }} 门课，核对后导入</p>
              <p class="mt-1 text-xs text-ink-dim">上半是整周排布，点空格子加课、点课块改课；下半逐条改细节</p>

              <div v-if="recPreview.warnings.length" class="mt-2.5 rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] text-amber-600">
                <span v-for="(w, i) in recPreview.warnings" :key="i" class="block">{{ w }}</span>
              </div>

              <!-- 整周预览：与正式课表同一套网格（行=节次、列=星期）。
                   点空格子加课、点课块改课；同一格两门课在格子里标红 -->
              <div class="mt-3 rounded-2xl border border-line bg-canvas p-2.5">
                <div class="grid" :style="recColsStyle">
                  <span></span>
                  <span v-for="wd in recCols" :key="wd" class="pb-1 text-center text-[11px] text-ink-dim">{{ WDN[wd - 1] }}</span>
                </div>
                <div class="grid select-none" data-rec-grid :style="recGridStyle">
                  <template v-for="(r, ri) in recRows" :key="ri">
                    <div
                      v-if="r.type === 'gap'"
                      data-gap
                      class="flex items-center gap-1.5 bg-ink/[0.04] px-1 text-[9px] font-medium text-ink-dim/80"
                      :style="{ gridColumn: '1 / -1', gridRow: ri + 1 }"
                    >
                      <span class="h-px flex-1 bg-line/70"></span>
                      <span class="shrink-0">{{ r.label }}</span>
                      <span class="h-px flex-1 bg-line/70"></span>
                    </div>
                    <template v-else>
                      <div
                        :data-raxis="r.p.no"
                        class="flex flex-col items-center justify-center overflow-hidden bg-ink/[0.02] leading-none"
                        :style="{ gridColumn: 1, gridRow: ri + 1 }"
                      >
                        <span class="text-[10px] font-semibold text-primary-600/90">{{ r.p.no }}</span>
                        <span class="mt-0.5 text-[8px] text-ink-dim/80">{{ r.p.start }}</span>
                      </div>
                      <div
                        v-for="wd in recCols"
                        :key="wd"
                        :data-rcell="wd + '-' + r.idx"
                        class="border-t border-l border-line/50 transition-colors"
                        :class="recPressCell === wd + '-' + r.idx ? 'border-primary-400 bg-primary-500/10' : ''"
                        :style="{ gridColumn: wd + 1, gridRow: ri + 1 }"
                        @pointerdown="recCellDown(wd, r.idx)"
                        @pointerup="recCellUp"
                        @pointercancel="recCellUp"
                        @pointerleave="recCellUp"
                        @click="openRecAdd(wd, r.idx)"
                      ></div>
                    </template>
                  </template>

                  <article
                    v-for="it in recGrid.items"
                    :key="it.wd + '-' + it.from + '-' + it.level"
                    data-rcourse
                    class="relative m-[1px] cursor-pointer overflow-hidden rounded-[5px] px-1 py-0.5 shadow-sm ring-1 transition active:scale-[0.97]"
                    :class="[
                      recGrid.hot.has(it) ? 'bg-red-500/15 ring-2 ring-red-400' : 'ring-line/70',
                      it.c.selected ? '' : 'opacity-35',
                    ]"
                    :style="{ ...gridStyleOf(it, recRowIdx), background: recGrid.hot.has(it) ? '' : palOf(it.c.title).bg }"
                    @click.stop="openRecEdit(it)"
                  >
                    <span
                      class="block truncate text-[10px] leading-tight font-semibold"
                      :class="recGrid.hot.has(it) ? 'text-red-500' : ''"
                      :style="{ color: recGrid.hot.has(it) ? '' : palOf(it.c.title).text }"
                    >{{ it.c.title || '未命名' }}</span>
                  </article>
                </div>
                <p
                  v-if="recOverlapNote"
                  data-rec-conflict
                  class="mt-2 rounded-xl bg-red-500/10 px-3 py-1.5 text-[11px] leading-snug text-red-500"
                >{{ recOverlapNote }}</p>
              </div>

              <p class="mt-3 text-xs font-medium text-ink-dim">逐条核对 · {{ recPreview.items.length }} 门</p>
              <div class="mt-2 space-y-2">
                <div v-for="(it, i) in recPreview.items" :key="i" data-rec-item class="rounded-xl border bg-canvas p-3" :class="recItemHot(it) ? 'border-red-400' : 'border-line'">
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
                        class="w-full truncate rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-primary-400"
                      />
                      <div class="mt-2 grid grid-cols-2 gap-2">
                        <label class="flex items-center gap-1.5 text-[11px] text-ink-dim">
                          星期
                          <select v-model.number="it.weekday" class="min-w-[3rem] flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                            <option v-for="(w, wi) in WEEKDAY_LABELS" :key="wi" :value="wi + 1">{{ w }}</option>
                          </select>
                        </label>
                        <label class="flex items-center gap-1.5 text-[11px] text-ink-dim">
                          周次
                          <select v-model="it.weekRule" class="min-w-[3rem] flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                            <option value="every">每周</option>
                            <option value="odd">单周</option>
                            <option value="even">双周</option>
                          </select>
                        </label>
                        <label class="flex items-center gap-1.5 text-[11px] text-ink-dim">
                          从第
                          <select v-model.number="it.startSec" class="min-w-[3rem] flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                            <option v-for="n in recSecOptions()" :key="n" :value="n">{{ n }} 节</option>
                          </select>
                        </label>
                        <label class="flex items-center gap-1.5 text-[11px] text-ink-dim">
                          到第
                          <select v-model.number="it.endSec" class="min-w-[3rem] flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                            <option v-for="n in recSecOptions()" :key="n" :value="n">{{ n }} 节</option>
                          </select>
                        </label>
                      </div>
                      <p class="mt-1.5 text-[11px]" :class="recTimeRange(it) ? 'text-ink-dim' : 'text-red-400'">
                        {{ recTimeRange(it) ? '上课时间 ' + recTimeRange(it) : '节次超出当前节次表，导入时会跳过这门课' }}
                      </p>
                      <div class="mt-2 space-y-2">
                        <input v-model="it.location" maxlength="30" placeholder="地点（可留空）" class="min-w-0 w-full truncate rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary-400" />
                        <input v-model="it.teacher" maxlength="20" placeholder="教师（可留空）" class="min-w-0 w-full truncate rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary-400" />
                      </div>
                      <p v-if="recItemHot(it)" data-item-conflict class="mt-1.5 text-[11px] leading-snug text-red-500">与同一格的另一门课重叠：留一门，或者下面改成别的节次</p>
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
          </div>

          <!-- 第 1 步：开学时间 / 本学期周数 / 课程时间设置（Day 14 用户测试反馈：
               原页文字、按钮、功能太多；重构为三项，节次编辑收进二级页） -->
          <div v-else-if="onboardStep === 'form' || onboardStep === 'periods'" key="form" class="relative overflow-hidden">
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
                      <button
                        type="button"
                        class="min-w-0 flex-1 rounded-md border border-line bg-card px-2 py-1 text-center text-xs tabular-nums transition active:scale-[0.98]"
                        @click="obPickPeriodEnd(g.from + i - 1)"
                      >
                        {{ obForm.periods[g.from + i - 1].end }}
                      </button>
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
          </div>
          </Transition>

                    <p class="mt-6 text-center text-[11px] text-ink-dim/70">这个选择只记一次，之后随时可以在「我的」页切换示例或导入</p>
          <input ref="onboardFile" type="file" accept=".json,application/json" class="hidden" @change="onOnboardFile" />
          <input ref="obRecFile" type="file" accept="image/*" class="hidden" @change="onObRecFile" />
        </div>
      </div>
    </Transition>
  </div>
</template>
