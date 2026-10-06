<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount, provide, reactive } from 'vue'
import { loadDataset, importFromText, clearImport, matchWeek, minOf, addCourse, dedupAdded, countAddedDups, removeCourse, updateCourse, updateImportedCourse, removeImportedCourse, patchMockCourse, removeMockCourse, findConflicts, dayScope, exportImportedText, addTodo, patchTodo, removeTodoById, addEvent, addRoutine, updateRoutine, removeRoutine, periodsOf, createManualSemester, updateImportedSemester, LECTURES_KEY, loadLectures, addLecture, updateLecture, removeLecture, setLectureSummary, courseCovering, nextCourseDate, HABITS_KEY, loadHabits, addHabit, removeHabit, toggleHabitRecord, streakOf, todayKeyOf, isGraceKey, graceKeysOf, isBackfilled, totalDoneOf, weekMondayKeyOf, ADDED_KEY, TODOS_KEY, EVENTS_KEY, COURSE_OV_KEY } from './data/store.js'
import { normalizeSegs, segmentView, reperiodAll, shiftWithinSegment, addPeriodToSegment, removePeriodAt } from './data/periods.js'
import { GRID_AXIS_W, buildGridRows, rowIndexMap, courseItems, previewItems, gridStyleOf, isAligned, findCellOverlaps, secRowRange, clampCoursesToSegments } from './data/weekGrid.js'
import { recorderAvailable, ensureMicPermission, startRecording as recStart, stopRecording as recStop, resolvePlayableUri, statClip, deleteClipFile, startKeepAlive, stopKeepAlive, keepAliveRunning, scheduleAutoStop, consumeAutoStop } from './data/recorder.js'
import { transcriberAvailable, modelState, ensureModel, transcribeLecture, startLiveTranscribe, stopLiveTranscribe } from './data/transcriber.js'
import { loadLlmConfig, saveLlmConfig, summarizeTranscript, summarizerAvailable, testConnection, DEEPSEEK_MODELS } from './data/summarizer.js'
import { compressImageForRecognize, recognizeScheduleImage, recognizerAvailable } from './data/recognizer.js'
import { buildIcs, downloadText } from './data/ics.js'
import { notifyAvailable, loadNotifySettings, saveNotifySettings, ensureNotifyEnv, buildScheduleItems, applySchedule, notifyDone, testNotify, onNotificationAction, LISTEN_TAG, LISTEN_CHANNEL, exactAlarmState, askExactAlarm } from './data/notify.js'
import { loadClips, saveClips, loadSettings as loadListenSettings, saveSettings as saveListenSettings, reviewAdvance, countPlayed, compareDateKey, newClipFromImport, clipDuration, fmtSeconds, todayKey, addDaysKey, minOf as minOfTime, dueClips, buildListenItems, repeatTimesOf, nextPlayRound, buildListenNotices, parseIntervals, formatIntervals, intInRange, isTimeStr, DEFAULTS as LISTEN_DEFAULTS } from './data/listen.js'
import { fileToBase64, writeClipBytes, resolveListenUri, makeClipBlobUrl, statClipFile } from './data/listenStore.js'
import { loadReviews, saveReviews, upsertReview, findReview, loadSettings as loadReviewSettings, saveSettings as saveReviewSettings, newRecord, summarize as summarizeReview, MOODS, QUESTIONS, noticeItem, noticeDate, REVIEW_TAG, REVIEW_CHANNEL } from './data/review.js'
import { loadDaily, saveDaily, upsertDay, dayOf, recentDays, baselineOf, dayLine } from './data/daily.js'
/* Day 19 状态框：只依赖 listen.js 的两个小工具（todayKey / minOf），没有循环依赖 */
import {
  frameAvailable,
  loadFrameSettings,
  saveFrameSettings,
  loadFrameMarks as loadFrameMarksNow,
  markClassDone as frameMarkClassDone,
  markListenDone as frameMarkListenDone,
  buildFrameSnapshot,
  pushFrame,
  setFrameEnabled,
  frameRunning,
  consumeFrameActions,
  onFrameActions,
} from './data/statusFrame.js'
import MonthCalendar from './components/MonthCalendar.vue'
import NumberWheel from './components/NumberWheel.vue'
import TimeWheel from './components/TimeWheel.vue'
import DropdownSelect from './components/DropdownSelect.vue'
import PeriodsEditor from './components/PeriodsEditor.vue'
import BottomSheet from './components/BottomSheet.vue'
import RowItem from './components/RowItem.vue'
/* Stage 9 组件化：拆出去的页面/浮层用 useApp() 取这份上下文（App 仍是唯一状态持有者） */
import { APP_CTX } from './composables/app-ctx.js'
import TodayPage from './pages/TodayPage.vue'
import WeekPage from './pages/WeekPage.vue'
import MePage from './pages/MePage.vue'
import LecturesPanel from './pages/sub/LecturesPanel.vue'
import ListenPanel from './pages/sub/ListenPanel.vue'
import TodosPanel from './pages/sub/TodosPanel.vue'
import SettingsPanel from './pages/sub/SettingsPanel.vue'
import OnboardingPage from './pages/OnboardingPage.vue'
import TodoSheet from './sheets/TodoSheet.vue'
import ReviewSheet from './sheets/ReviewSheet.vue'
import EventSheet from './sheets/EventSheet.vue'
import SemesterSheet from './sheets/SemesterSheet.vue'
/* Stage 9 拆出来的浮层/页面组件（各自用 useApp() 取上下文） */
import PickerSheet from './sheets/PickerSheet.vue'
import ConfirmClearSheet from './sheets/ConfirmClearSheet.vue'
import DeleteLectureSheet from './sheets/DeleteLectureSheet.vue'
import AddSheet from './sheets/AddSheet.vue'
import PressTypeSheet from './sheets/PressTypeSheet.vue'
import ReviewGridSheet from './sheets/ReviewGridSheet.vue'
import DetailSheet from './sheets/DetailSheet.vue'
import HabitSheet from './sheets/HabitSheet.vue'

/* 版本串不再手写：由 vite.config.js 从 package.json 的 version 注入（单一来源）。
   改版本号只改 web2/package.json 一处，App 打包脚本读的是同一个文件。 */
const APP_VERSION = __APP_VERSION__

const tab = ref('today')

/* ---------------- 底部导航切换（Day 11 二轮：滑块 + 平移 + 可打断） ----------------
   滑块与内容层都是 CSS transition：快速连点时 transform 直接改道新目标，从当前位置
   平滑续走——动画天然可打断，不需要锁定和「切换中」提示；bounce 用 WAAPI 重触发，
   新动画自动覆盖旧动画，同样可打断。全部前端临时状态，不接数据库。 */
const TAB_KEYS = ['today', 'week', 'me']
const tabIndex = computed(() => TAB_KEYS.indexOf(tab.value))
const weekSub = ref('week') // 课表页内「周课表 / 日程清单」分段（2026-10-03 方案 C Step 1：日程页并入）
const habitSheet = ref(false) // 打卡浮层（原「打卡」tab 改底部浮层，2026-10-03）
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
  syncBodyScrollLock()
  // 头部收缩动画（280ms）会改变网格顶的位置，动画结束后重校网格高度
  setTimeout(measureGridTop, 320)
  const svg = document.querySelectorAll('nav button svg')[TAB_KEYS.indexOf(key)]
  svg && svg.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.28)', offset: 0.4 }, { transform: 'scale(1)' }],
    { duration: 300, easing: 'ease' }
  )
}

/* 课表页子视图切换（2026-10-03 方案 C Step 1）：只有「周课表」子视图要锁文档滚动，
   日程清单是要上下滚的，所以切换时重算一遍 body overflow 与网格顶。 */
function setWeekSub(v) {
  weekSub.value = v
  closeWeekMenu()
  syncBodyScrollLock()
  setTimeout(measureGridTop, 320)
}

/* ---------------- 课表页右上「＋」选单（Stage 8） ----------------
   原来「周课表 / 其他日程」占着一整条分段位、＋ 又直接进拍课表识别；用户 m12154 批准的设计是：
   顶部只留周次切换，加课 / 加日程 / 拍课表识别 / 其他日程都收进 ＋ 选单（网格拿回整屏）。
   ＋ 是「拍课表识别」的旧家（data-week-add + data-mine-rec 锚点都还在，只是移进了选单）。 */
const weekMenuOpen = ref(false)
function toggleWeekMenu() { weekMenuOpen.value = !weekMenuOpen.value }
function closeWeekMenu() { weekMenuOpen.value = false }
/* 手动加课 / 长按加课的默认落点：本周第 1 节，星期取今天（不在本周就用周一）。
   表单里星期与开始时间都能改，这里只求「点开就能填」。 */
function menuAddSlot() {
  const per = periods.value[0]
  const wd = weekOffset.value === 0 ? ((today.getDay() + 6) % 7) + 1 : 1
  return { wd, min: per && per.start ? minOf(per.start) : 8 * 60 }
}
function menuAddCourse() { closeWeekMenu(); const s = menuAddSlot(); openAdd(s.wd, s.min) }
function menuAddEvent() { closeWeekMenu(); openEventAdd() }
function menuScan() { closeWeekMenu(); mineRecStart() }
function menuOpenList() { closeWeekMenu(); setWeekSub('list') }
/* 点选单以外的地方就收起（capture 阶段监听：即使点在 inert 页面里也算「点别处」）。
   ＋ 自己排除掉，否则同一次点击会先关再开、看起来没反应。 */
function onWeekMenuAway(e) {
  const t = e.target
  if (t && t.closest && (t.closest('[data-week-menu]') || t.closest('[data-week-add]'))) return
  closeWeekMenu()
}
watch(weekMenuOpen, (open) => {
  if (open) document.addEventListener('click', onWeekMenuAway, true)
  else document.removeEventListener('click', onWeekMenuAway, true)
})
onBeforeUnmount(() => document.removeEventListener('click', onWeekMenuAway, true))

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
/* ---------------- 今日页三段壳（方案 C Stage 1） ----------------
   头（问候卡）/ 尾（底部导航）固定，今日页自己就是中间那唯一的滚动窗口：
   main 带 data-today-scroll + overflow-y-auto，高度实测反推（与 gridH 同思路，不写常数）——
   innerHeight − 今日页顶的视口坐标 − 导航高 − 8px 间隙。文档高度正好一屏：body 不参与滚动，
   窗口里怎么滑都不带动头尾；内容不够长时它也不出滚动条（height 就是可用高度）。 */
const todayH = ref(0)
const todayRef = ref(null)
/* 今日页顶相对根容器顶的偏移（文档坐标差，含问候卡高度与它的 mt-3）：只涨不跌。
   为什么不直接用今日页 rect.top：切 tab 时问候卡有 280ms 收缩/展开动画，动画中途量到的 top
   偏小会把窗口写大 → 浏览器立刻把窗口里的 scrollTop 夹到新的 maxScroll，切回来就丢了原位置
   （2026-10-05 实证：685 → 541）。缓存「展开态偏移」后，窗口高度就与动画无关了。 */
let todayTopOffset = 0
function measureTodayH() {
  const el = todayRef.value
  if (!el) return
  // 只在今日页可见时量：切走时问候卡会收缩，那时量出来的偏移没有意义
  if (tab.value !== 'today') return
  const root = el.parentElement && el.parentElement.parentElement
  if (!root) return
  const sy = window.scrollY || 0
  const off = Math.round(el.getBoundingClientRect().top - root.getBoundingClientRect().top)
  if (off > todayTopOffset) todayTopOffset = off
  const rootTop = root.getBoundingClientRect().top + sy
  todayH.value = Math.max(320, Math.round(window.innerHeight - rootTop - todayTopOffset - navH.value - 8))
}
watch(tabIndex, () => nextTick(() => {
  measureStrip()
  measureTodayH()
  // 今日页自己不滚 body，切回来把可能残留的文档滚动归零（「我的」页仍走 body 滚动）
  if (tab.value === 'today' && window.scrollY) window.scrollTo(0, 0)
}))

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
  const ro = new ResizeObserver(() => { measureStrip(); measureTodayH() })
  if (stripRef.value) for (const page of stripRef.value.children) ro.observe(page)
  // 问候卡高度会随 tab 切换与字体缩放变化 → 今日页可用高度跟着重算
  const heroEl = document.querySelector('header')
  if (heroEl) ro.observe(heroEl)
  refreshLectures() // 录音场次列表（二期 M2）
  initListen() // 碎片练耳：列表 + 设置（四期）
  initReview() // 五期：每日复盘存档 + 设置（纯本机，无桥也能用）
  snapshotToday() // 六期：今天的账——先把今天这条快照落下来（不打扰用户）
  setInterval(() => { if (document.visibilityState !== 'hidden') snapshotToday() }, 60_000)
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
  initFrame() // Day 19：常驻状态框（推快照 + 领按钮动作；无原生桥则整个失效）
  initBackButton() // Android 返回键分级处理（App 内生效；浏览器无桥不注册）
  window.addEventListener('resize', onWinResize) // 周课表高度按视口重算（一屏看完的保证）
  measureNavH() // 底部导航实测高度（含系统手势条安全区），网格高度要用它
  measureTodayH() // 今日页滚动窗口高度（三段壳 Stage 1）
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
  syncBodyScrollLock()
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
  if (habitSheet.value) { habitSheet.value = false; return true } // 打卡浮层最外层（2026-10-03 方案 C）
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
  /* 日精进浮层（问答 / 今天的日精进 / 日精进·全部 三种模式同一个 reviewSheet，v1.41.9 真机反馈）：
     开着时按返回键以前什么都不做，直接落到「退到今日页」——与「不可见状态绝不能吞返回键」同一条纪律的两面。 */
  if (reviewSheet.value) { closeReview(); return true }
  // 2026-10-03 方案 C Step 5 / Stage 6：二级层一路往回收（页内展开块 → 二级页 → 课表子视图）
  // 注意：展开块切走/关页后看不见——不可见的状态绝不能吞掉返回键
  if (tab.value === 'me' && meSub.value === 'listen' && listenSettingsOpen.value) { listenSettingsOpen.value = false; return true }
  if (meSub.value) { closeMeSub(); return true }
  // Stage 8：课表页 ＋ 选单是周课表视图里最细的一层，先收它再收子视图
  if (tab.value === 'week' && weekMenuOpen.value) { weekMenuOpen.value = false; return true }
  if (tab.value === 'week' && weekSub.value === 'list') { setWeekSub('week'); return true }
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
/* 滚轮当前值只有弹层自己知道，所以由它把自己的模板 ref 传进来（Stage 9 拆出 PickerSheet 后）。 */
function pickerConfirm(wheel) {
  const p = picker.value
  if (!p) return
  let v
  if (p.type === 'date') v = p.value
  else if (p.type === 'number') v = wheel ? Number(wheel.value) : p.value
  else v = wheel ? wheel.display : p.value
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

/* 精确提醒（Android 12+）：没拿到 SCHEDULE_EXACT_ALARM 时只能用非精确闹钟，系统给最多
   1 小时的浮动窗口，提醒可能晚到。只在「确实在排提醒」且「确实没权限」时提示，不打扰。 */
const exactAlarm = ref({ supported: false, allowed: null })
const exactAsking = ref(false)
const exactMsg = ref('')
const exactMsgBad = ref(false)
const exactHint = computed(
  () =>
    !!notifyOk &&
    exactAlarm.value.supported &&
    exactAlarm.value.allowed === false &&
    (notifySettings.value.enabled || listenSettings.value.enabled),
)

async function refreshExactAlarm() {
  if (!notifyOk) return
  exactAlarm.value = await exactAlarmState()
}

async function onAskExactAlarm() {
  if (exactAsking.value) return
  exactAsking.value = true
  const r = await askExactAlarm()
  exactAsking.value = false
  await refreshExactAlarm()
  if (r.ok) {
    exactMsgBad.value = false
    exactMsg.value = '已允许精确提醒 · 正在按精确闹钟重排…'
    await applyNotifySchedule()
    await applyListenSchedule()
    exactMsg.value = '已允许精确提醒，提醒已按精确闹钟重排。'
  } else if (r.unsupported) {
    exactMsgBad.value = true
    exactMsg.value = '这个版本的系统没有这个开关，不用管它。'
  } else {
    exactMsgBad.value = true
    exactMsg.value = '还没有允许：' + (r.error || '请在系统那页打开「闹钟和提醒」')
  }
}

function goMeTab(sub = 'settings') {
  if (tab.value !== 'me') switchTab('me')
  /* 「我的」页的低频项（录音列表、练耳设置、课前提醒开关、纪要配置、清除数据…）都收在二级页里，
     凡是从别处「跳过来让用户看某样东西」的路径，都得顺手把那一页打开，
     否则用户跳到我的页也是一脸茫然（2026-10-02 减法后新增，Stage 6 起改成二级页）：
     传 null 表示只切页（比如复盘提醒，浮层会盖在上面，不需要动二级页）。 */
  if (sub) openMeSub(sub)
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
  await refreshExactAlarm()
  onNotificationAction(({ actionId, extra }) => {
    /* 通知栏那颗「开始录音」按钮落在「我的」页的录音二级页上（那里才有录音钮） */
    goMeTab(actionId === 'START_REC' ? 'lectures' : null)
    if (actionId === 'START_REC') startRec() // 幂等：已在录音则 startRec 直接 return
    /* 练耳复习提醒：无按钮，点通知回「我的」页并把练耳二级页打开、卡片展开——**不自动播放**（L6） */
    if (extra && extra.src === LISTEN_TAG) { openMeSub('listen'); listenOpen.value = true }
    /* 每日复盘提醒（五期）：无按钮，点通知直接把复盘浮层打开（浮层自带一层，二级页不动） */
    if (extra && extra.src === REVIEW_TAG) openReview('ask')
  })
  await applyNotifySchedule()
  await applyListenSchedule()
  await applyReviewSchedule()
}

/* ---------------- 常驻通知栏状态框（Day 19，路线 3：原生前台服务 specialUse） ----------------
   为什么用原生前台服务而不是 LocalNotifications 预排：通知栏那条要一直是「现在/下一节」，
   而网页切后台就被冻结，预排的静态文案几分钟后就过期了。原生服务自己每 30 秒重画，
   网页被冻结、进程被回收都不影响；网页只负责把「今天剩余安排」压成快照推过去（见
   web2/src/data/statusFrame.js）。用户按通知栏按钮时原生就地记账，网页起来后领回来落地。 */
const frameSettings = ref(loadFrameSettings())
const frameIsApp = ref(false) // 只在 App 内为 true（决定设置里那行要不要出现）
const frameMsg = ref('')
const frameMsgBad = ref(false)
function setFrameMsg(t, bad = false) {
  frameMsg.value = t
  frameMsgBad.value = !!bad
}
/* 通知栏按钮按下后，App 这边必须**当场看得见**：
   设置里那行 frameMsg 藏在「我的」页的折叠里，等于没有反馈——
   真机第一次验收的教训（按了「开始录音」只跳回今日页、按了「我去听了」什么也没发生）。
   所以按钮动作一律再播一条浮在最上层的轻提示。 */
const frameToast = ref('')
let frameToastTimer = null
function showFrameToast(text) {
  if (!text) return
  frameToast.value = text
  clearTimeout(frameToastTimer)
  frameToastTimer = setTimeout(() => { frameToast.value = '' }, 4200)
}
/* 领动作的时机：冷启动 / 从后台回前台 / 窗口重新聚焦，外加兜底轮询。
   为什么不能只靠 visibilitychange：**下拉通知栏不会让 WebView 失焦**——
   用户最常见的手势（拉下通知栏点按钮）恰好一个事件都不触发，
   于是原生那边已经记账、App 这边却一直没领（真机验收的第二个现象）。 */
let frameDrainTimer = null
function startFrameDrainLoop() {
  if (frameDrainTimer) return
  frameDrainTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && frameIsApp.value) drainFrameActions()
  }, 6000)
}
function stopFrameDrainLoop() {
  if (frameDrainTimer) { clearInterval(frameDrainTimer); frameDrainTimer = null }
}
/* 今天剩余安排压成状态框要的形状：课程/循环日程/独立日程统一成 kind c/r/e */
function frameTodayItems() {
  return todayCourses.value.map((c) => ({
    kind: c.type === 'routine' ? 'r' : c.type === 'event' ? 'e' : 'c',
    id: c.id,
    name: entryName(c),
    place: c.place || '',
    start: c.start,
    end: c.end,
  }))
}
/* 明天第一节（今天结束后状态框显示「明天 HH:MM 有 X」）。
   明天属于第几周用 store 的 dayScope 算（与冲突检测同一份口径），算不出来就不显示。 */
function frameTomorrowFirst() {
  const t = new Date()
  t.setDate(t.getDate() + 1)
  const wd = t.getDay() === 0 ? 7 : t.getDay()
  const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  const sc = dayScope(key, semester.value)
  const list = []
  for (const c of weekAll.value) if (c.weekday === wd && (!sc || matchWeek(c, sc.weekNo))) list.push(c)
  for (const r of routines.value) if (r.weekday === wd && (!sc || matchWeek(r, sc.weekNo))) list.push(r)
  for (const ev of events.value) if (ev.date === key) list.push(ev)
  if (!list.length) return null
  const first = list.sort((a, b) => minOf(a.start) - minOf(b.start))[0]
  return { name: entryName(first), start: first.start }
}
/* 推快照：静默失败（没有原生桥就什么都不做，浏览器零变化） */
async function pushFrameNow() {
  if (!frameIsApp.value) return
  const snap = buildFrameSnapshot({
    enabled: frameSettings.value.enabled,
    dndStart: listenSettings.value.dndStart,
    dndEnd: listenSettings.value.dndEnd,
    todosDue: undoneCount.value,
    today: frameTodayItems(),
    tomorrowFirst: frameTomorrowFirst(),
    listen: listenDue.value.map((c) => ({ id: c.id, name: c.name })),
    marks: loadFrameMarksNow(),
  })
  const r = await pushFrame(snap)
  if (!r.ok && r.error) setFrameMsg('状态框同步失败：' + r.error, true)
}
/* 落地原生记下的按钮动作。
   注意「我去听了」**不替用户记账**：只把这段从状态框撤下（今天不再提醒），
   已听次数与复习档位仍由 App 内「放满设定遍数」自动记 —— 通知栏那一下不该冒充已听。 */
function applyFrameActions(list) {
  let touched = false
  for (const a of list || []) {
    const type = a && a.type
    const id = a && a.id
    if (type === 'startRec') {
      touched = true
      if (recActiveId.value) { showFrameToast('已经在录音了'); continue }
      showFrameToast('收到「开始录音」，正在开录…')
      /* startRec 失败时只把原因写进 recMsg，而那张录音卡在今日页最底部、「我的」页才第一屏——
         通知栏进来的人多半正看着今日页顶部，所以这里必须把原因再播一遍，不能悄悄失败。 */
      const p = startRec()
      Promise.resolve(p).then(() => {
        if (recActiveId.value) showFrameToast('已开始录音 · 到「我的」页可以停止')
        else if (recMsg.value) showFrameToast('没能开始录音：' + recMsg.value)
      })
      continue
    }
    if (type === 'classDone') {
      if (id) frameMarkClassDone(id)
      /* 「这节上完了」= 这节课真的结束：正为这节课录音就顺手停掉，不等下课自动停 */
      if (id && recActiveId.value) {
        const lec = lectures.value.find((l) => l.id === recActiveId.value)
        if (lec && lec.schedule_id === id) stopRec()
      }
      setFrameMsg('已记下：这节上完了')
      showFrameToast('已记下：这节上完了')
      touched = true
    }
    if (type === 'listenDone') {
      if (!id) continue
      frameMarkListenDone(id)
      const c = listenClips.value.find((x) => x.id === id)
      setFrameMsg(`已记下「我去听了」：今天不再提醒${c ? '「' + c.name + '」' : ''}`)
      showFrameToast(`已记下「我去听了」${c ? '：' + c.name : ''} · 今天不再提醒它`)
      touched = true
    }
  }
  if (touched) pushFrameNow()
}
let frameDrainErr = ''
async function drainFrameActions() {
  const r = await consumeFrameActions()
  if (!r.ok) {
    /* 领不到也必须当场看得见：v1.41.1 真机上原生只回一个 {}，动作被取走清空、
       网页什么都没收到，而这份错误原来只写进返回值、没人看——静默失败就是这么来的。 */
    if (r.error && r.error !== frameDrainErr) {
      frameDrainErr = r.error
      setFrameMsg('状态框动作领取失败：' + r.error, true)
      showFrameToast('状态框动作领取失败：' + r.error)
    }
    return
  }
  frameDrainErr = ''
  if (r.actions.length) applyFrameActions(r.actions)
}
async function initFrame() {
  frameIsApp.value = frameAvailable()
  if (!frameIsApp.value) return
  /* 顺序要紧：先把「收动作」的通道挂上（监听 + 轮询），再去推快照。
     推快照是一次原生往返，万一卡住/超时，原来会把后面的注册一起拖死——
     动作通道根本没建立，用户按按钮就永远是「原生有反应、App 毫无动静」。 */
  onFrameActions(applyFrameActions) // App 在跑时按按钮走这条，不用等下次冷启动
  startFrameDrainLoop()
  await drainFrameActions() // 冷启动：原生那侧可能已经攒下了动作
  try {
    await pushFrameNow() // 再把本地开关与今天的快照同步给原生（原生据此决定起不起服务）
    const r = await frameRunning()
    if (r.ok && !r.running && frameSettings.value.enabled) setFrameMsg('状态框没能常驻（系统可能限制了后台运行），下拉通知栏看得到吗？', true)
    await drainFrameActions() // 推快照时原生可能又补发了事件，再领一次
  } catch (_) {
    /* 推送失败不许影响领动作 */
  }
}
async function toggleFrame() {
  const next = saveFrameSettings({ enabled: !frameSettings.value.enabled })
  frameSettings.value = next
  await setFrameEnabled(next.enabled)
  await pushFrameNow()
  setFrameMsg(next.enabled ? '状态框已打开：下拉通知栏就能看到现在/下一节。' : '状态框已关掉（不影响课前提醒）。')
}
/* 数据一变就推：注册放在下面（今天剩余安排 / 待办数 / 练耳到期 这几个 computed 都在后面声明，
   在这里 watch 会撞上 TDZ），见「状态框：数据变动 → 重推快照」那处。 */
/* 从后台回来：先领走冻结期间按下的按钮，再补推一次快照（数据可能已经变了） */
function onFrameVisible() {
  if (document.visibilityState !== 'visible') return
  drainFrameActions()
  pushFrameNow()
  /* 用户可能刚去系统那页允许了精确提醒（改那个开关系统会重启 App，没重启的情况在这里补一次） */
  if (notifyOk) refreshExactAlarm()
}
document.addEventListener('visibilitychange', onFrameVisible)
/* 窗口重新聚焦也领一次（桌面/平板的多任务切换不走 visibilitychange） */
window.addEventListener('focus', onFrameVisible)
/* App 插件的前后台事件是最可靠的一道（真机拉下通知栏点按钮时上面那些可能一个都不响） */
if (APP_PLUGIN && APP_PLUGIN.addListener) {
  try { APP_PLUGIN.addListener('appStateChange', (s) => { if (!s || s.isActive !== false) onFrameVisible() }) } catch (_) {}
  try { APP_PLUGIN.addListener('resume', onFrameVisible) } catch (_) {}
}
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onFrameVisible)
  window.removeEventListener('focus', onFrameVisible)
  stopFrameDrainLoop()
  clearTimeout(frameToastTimer)
})

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
  localStorage.removeItem('web2.daily') // 六期：每日快照属于用户数据，清数据一并清掉（主题/强调色/Key/通知设置仍保留）
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
  back: 'border border-primary-400 bg-primary-50 text-primary-600',
  today: 'border-2 border-primary-400 text-primary-600',
  open: 'border border-dashed border-primary-300 text-primary-600',
  future: 'bg-soft text-ink-dim/30',
  locked: 'bg-soft-2 text-ink-dim/45',
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

/* ---------------- 碎片练耳（四期 Day 18，入口「我的」页） ----------------
   口径：数据走 web2.listen / web2.listen.set（本机，不进导出）；通知只提醒、不自动播放；
   已听次数与复习档位（艾宾浩斯 review_stage / next_due_date）**只由「已听」手动确认推进**。
   浏览器环境不落盘音频字节：文件仅本次会话可用，刷新后重新导入即可（记录与计数保留）。 */
const listenClips = ref([])
const listenSettings = ref(loadListenSettings())
const listenMsg = ref('')
const listenMsgBad = ref(false)
const listenOpen = ref(false)
const listenIsApp = ref(false)

function setListenMsg(text, bad = false) {
  listenMsg.value = text
  listenMsgBad.value = !!bad
}
function refreshListen() {
  listenClips.value = loadClips()
}
function initListen() {
  try {
    listenClips.value = loadClips()
    listenSettings.value = loadListenSettings()
  } catch {
    listenClips.value = []
  }
  /* 平台判定放到 mounted：App 外壳的手工桥可能晚于模块求值完成
     （与 trSupported 同一个坑，见下方转写一节的注释）。 */
  const c = typeof window !== 'undefined' ? window.Capacitor : null
  const p = c && c.Plugins ? c.Plugins : null
  listenIsApp.value = !!(p && p.Filesystem)
}

/* L3/L4：把未来 7 天的复习提醒排进系统通知（有通知能力 + 练耳总开关打开才排）。
   与课前提醒**各用各的标记**（LISTEN_TAG）：applySchedule 只清自己那一批，互不删。
   通知**不带按钮**：点它只回 App（定位到练耳卡），绝不自动播放（L6）。 */
function listenDayKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
async function applyListenSchedule() {
  if (!notifyOk) return
  const cfg = listenSettings.value
  const now = new Date()
  /* 空档要按**真实起止**算，所以提前量设为 0 —— 否则 b/class 的 at 被挪前 10 分钟，
     算出来的空档起点也跟着偏，提醒时刻会和界面上写的建议对不上。 */
  const items = buildScheduleItems({
    courses: weekAll.value,
    events: events.value,
    routines: routines.value,
    semester: semester.value,
    settings: { ...notifySettings.value, minutesBefore: 0 },
    now,
    horizonDays: 7,
  })
  const notices = buildListenNotices({
    clips: listenClips.value,
    settings: cfg,
    now,
    horizonDays: 7,
    itemsOfDay: (dKey) => items.filter((it) => it.at instanceof Date && listenDayKey(it.at) === dKey),
    durationOf: (it) => minOfTime(String(it.end)) - minOfTime(String(it.start)),
  })
  await applySchedule(notices, { src: LISTEN_TAG, channelId: LISTEN_CHANNEL, actionTypeId: null, enabled: cfg.enabled })
}
/* 导入 / 点「已听」/ 改设置 → 重排（saveClips/loadClips 返回新数组，引用变化即触发） */
watch([listenClips, listenSettings], () => { applyListenSchedule() })

/* ---------------- 五期：每日复盘（2026-10-04） ----------------
   它归哪一层、进哪个页：数据层 `web2/src/data/review.js`（纯逻辑 + 本机 localStorage），
   入口放今日页最底部（晚间主动收个尾）与「我的」页·设置折叠里的「每日复盘」行（开关 / 时间 / 历史）。
   存档只在本机（键 `web2.review`），**不进主项目导出**——导出给主项目的数据保持课程/日程/待办的干净口径，
   复盘属于「个人反思」，将来要归档再扩 reviews 表与 store.js。
   日精进是**模板汇总**（不联网）：把当日课程/待办/打卡/练耳串成一段话，AI 润色留到后面再说。 */
const reviewSheet = ref(null) // { mode:'ask'|'result'|'history', step, mood, answers, stats, record }
const reviewHistory = ref([])
const reviewSettings = ref(loadReviewSettings())
const reviewMsg = ref('')
const reviewMsgBad = ref(false)
const REVIEW_AT_CHOICES = ['21:00', '22:00', '23:00']
const WD_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const todayReview = computed(() => findReview(reviewHistory.value, todayStr))
const reviewStepTotal = QUESTIONS.length

function weekdayLabelOf(dKey) {
  const d = new Date(String(dKey) + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? '' : WD_LABELS[d.getDay()] || ''
}
function refreshReviews() {
  reviewHistory.value = loadReviews()
}
function setReviewMsg(text, bad = false) {
  reviewMsg.value = text
  reviewMsgBad.value = !!bad
}
function moodLabelOf(v) {
  const m = MOODS.find((x) => x.v === Number(v))
  return m ? `${m.emoji} ${m.label}` : ''
}
function initReview() {
  try {
    refreshReviews()
    reviewSettings.value = loadReviewSettings()
  } catch {
    reviewHistory.value = []
  }
}
/* 复盘要用的当日快照：课程数 / 待办完成 / 打卡 / 练耳。
   练耳没有「按天」的账（clip 只有累积 played_count），只能按 last_played_at 落在今天算「今天听过几段」*/
function reviewStatsNow() {
  const listened = listenClips.value.filter((c) => String(c.last_played_at || '').slice(0, 10) === todayStr).length
  return {
    courses: todayCourses.value.length,
    todosDone: doneCount.value,
    todosTotal: todos.value.length,
    habitsDone: habits.value.filter((h) => h.records && h.records[habitToday]).length,
    habitsTotal: habits.value.length,
    listenToday: listened,
  }
}
function openReview(mode = 'ask') {
  setReviewMsg('')
  if (mode === 'history') {
    reviewSheet.value = { mode: 'history' }
    return
  }
  const exist = todayReview.value
  if (mode === 'result' && exist) {
    reviewSheet.value = { mode: 'result', record: exist }
    return
  }
  /* 今天已经复盘过就带出旧答案（改一改，而不是从头再问一遍） */
  reviewSheet.value = {
    mode: 'ask',
    step: 0,
    mood: exist ? exist.mood : 0,
    answers: Object.assign({ proud: '', keep: '', focus: '' }, exist ? exist.answers : {}),
    stats: reviewStatsNow(),
    startedAt: Date.now(),
  }
}
function closeReview() {
  reviewSheet.value = null
}
function reviewSetAnswer(key, val) {
  const s = reviewSheet.value
  if (!s) return
  s.answers[key] = val
}
function reviewNext() {
  const s = reviewSheet.value
  if (!s || s.mode !== 'ask') return
  if (s.step < reviewStepTotal - 1) s.step += 1
  else reviewFinish()
}
function reviewBack() {
  const s = reviewSheet.value
  if (!s || s.mode !== 'ask' || s.step <= 0) return
  s.step -= 1
}
/* 生成日精进并落盘：同一天重做就覆盖（upsertReview 会把首次 created_at 留下来） */
function reviewFinish() {
  const s = reviewSheet.value
  if (!s) return
  const rec = newRecord({
    date: todayStr,
    mood: s.mood,
    answers: s.answers,
    stats: s.stats || reviewStatsNow(),
    now: Date.now(),
  })
  rec.summary = summarizeReview(rec, { weekdayLabel: weekdayLabelOf(todayStr) })
  reviewHistory.value = upsertReview(reviewHistory.value, rec)
  saveReviews(reviewHistory.value)
  refreshReviews()
  reviewSheet.value = { mode: 'result', record: rec }
  setReviewMsg('日精进已存好 · 想改随时再来')
}
function toggleReviewNotify() {
  reviewSettings.value = saveReviewSettings(Object.assign({}, reviewSettings.value, { enabled: !reviewSettings.value.enabled }))
}
function setReviewAt(t) {
  if (reviewSettings.value.at === t) return
  reviewSettings.value = saveReviewSettings(Object.assign({}, reviewSettings.value, { at: t }))
}
/* 每晚一条轻提醒：排未来 7 天，每天一条（今天那一刻已过就不排今天，不补发）。
   与课前提醒、练耳提醒**各用各的标记**（REVIEW_TAG），applySchedule 只清自己那一批；不带按钮。 */
async function applyReviewSchedule() {
  if (!notifyOk) return
  const cfg = reviewSettings.value
  const now = new Date()
  const items = []
  for (let i = 0; i < 7; i += 1) {
    const dKey = i === 0 ? todayStr : addDaysKey(todayStr, i)
    const at = noticeDate({ date: dKey, at: cfg.at, now })
    if (at) items.push(noticeItem({ date: dKey, at }))
  }
  await applySchedule(items, { src: REVIEW_TAG, channelId: REVIEW_CHANNEL, actionTypeId: null, enabled: cfg.enabled })
}
watch(reviewSettings, () => { applyReviewSchedule() })

/* ---------- 六期：今天的账（每日快照 + 念给你听的那张卡） ----------
   数据层 `web2/src/data/daily.js`（纯逻辑 + 本机 localStorage，键 `web2.daily`，不进导出）。
   · 快照每天静默落一条（mount 时 + 每 60 秒看一次；数字没变就不写盘）——不打扰用户
   · UI 只有一处：并进原来的「日精进」浮层（用户拍板：不加新页面、不加新入口）
   · 「手机使用时间」那一路还没做（要安卓使用情况访问权限），所以卡里先不出现这一栏 */
const dailyBook = ref(loadDaily())
const todayDaily = computed(() => dayOf(dailyBook.value, todayStr))
const dailyBaseline = computed(() => baselineOf(dailyBook.value, 8))
function snapshotToday() {
  let r = null
  try {
    r = upsertDay(dailyBook.value, { date: todayStr, stats: reviewStatsNow() })
  } catch {
    return null
  }
  if (r && r.changed) {
    dailyBook.value = r.book
    saveDaily(r.book)
  }
  return r
}
function dailyLineOf(dateKey) {
  return dayLine(dayOf(dailyBook.value, dateKey))
}
/* 账卡要用的整块数字：排了几件 / 做完几件 / 几节课 / 基线攒到第几天
   · 数字优先取当天快照（用户可能一天开好几次，快照是「当天那一条」）
   · 没有快照（首次打开的那一瞬间）就现场按复盘同一口径算一遍，口径一致不会两套数 */
const accountToday = computed(() => {
  const d = todayDaily.value
  const s = d ? d.stats : reviewStatsNow()
  const planned = s.todosTotal
  const done = s.todosDone
  const rest = Math.max(0, planned - done)
  return {
    planned,
    done,
    rest,
    courses: s.courses,
    habitsDone: s.habitsDone,
    habitsTotal: s.habitsTotal,
    pct: planned ? Math.min(100, Math.round((done / planned) * 100)) : 0,
    line: planned ? `你排了 ${planned} 件事，做完了 ${done} 件。` : '今天没排事。',
    sub: planned ? `${done} / ${planned} · ${rest ? `还有 ${rest} 件没动` : '一件不剩'}` : '待办里今天没有要交的事',
    lead: !planned ? '今天没排事。' : rest ? `还有 ${rest} 件没动。` : '今天全清了。',
    baseline: dailyBaseline.value,
  }
})
/* 历史列表两路合流：复盘记录（有答案和日精进）+ 只有数字的日子（快照留下的，浅色一行）
   同一天两边都有 → 以复盘记录为准，快照只补那行数字，不重复成两条 */
const accountHistory = computed(() => {
  const rows = reviewHistory.value.map((r) => ({ date: r.date, record: r, line: dailyLineOf(r.date) }))
  const seen = new Set(rows.map((x) => x.date))
  for (const d of recentDays(dailyBook.value, 60)) {
    if (seen.has(d.date)) continue
    rows.push({ date: d.date, record: null, line: dayLine(d) })
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1))
})
/* 「明天最重要的一件事」→ 明天的待办：一句话的产物要落成一件能执行的事 */
function reviewFocusText() {
  const s = reviewSheet.value
  const rec = s && s.record ? s.record : todayReview.value
  const fromRec = rec && rec.answers ? String(rec.answers.focus || '').trim() : ''
  if (fromRec) return fromRec
  return s && s.answers ? String(s.answers.focus || '').trim() : ''
}
function reviewAddTodo() {
  const title = reviewFocusText()
  if (!title) {
    setReviewMsg('先写下「明天最重要的一件事」，再转待办。', true)
    return
  }
  if (todos.value.some((t) => !t.done && String(t.title).trim() === title)) {
    setReviewMsg('明天待办里已经有这条了。')
    return
  }
  addTodo({ title, due_date: tomorrowStr() })
  reloadDataset()
  setReviewMsg(`已加进明天待办：${title}`)
}
/* 今天要提醒的练耳建议（L2 空闲槽标记）：
   用 notify.js 的排程项（buildScheduleItems 的输出，形态 { at, title, ... }）
   反推今天几点到几点有空 → 空闲槽 ∩ 今日到期音频 → "几点可放几段"。
   与「课前提醒」共用同一份时刻展开口径，两者不会各算一套。 */
function isSameDay(d, ref) {
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate()
}
const listenSuggestions = computed(() => {
  if (!listenClips.value.length) return { due: [], suggestions: [], remaining: 0 }
  const now = new Date()
  const items = buildScheduleItems({
    courses: weekAll.value,
    events: events.value,
    routines: routines.value,
    semester: semester.value,
    settings: notifySettings.value,
    now,
    horizonDays: 1,
  }).filter((it) => it.at instanceof Date && isSameDay(it.at, now))
  return buildListenItems({
    items,
    clips: listenClips.value,
    settings: listenSettings.value,
    now,
    durationOf: (it) => {
      const end = it && it.end
      if (!end) return 0
      const d = minOfTime(String(end)) - minOfTime(String(it.start || ''))
      return d > 0 ? d : 0
    },
  })
})

/* 今日到期的音频（含"今天刚导入"的第一段）——用于"今天在等听的 N 段"提示 */
const listenDue = computed(() => dueClips(listenClips.value, todayKey()))
/* 今天页「今天要听」是否展开到全部（默认只排前 2 段，超过给「还有 N 段」，方案 C Step 3） */
const listenTodayAll = ref(false)

/* 列表里每条显示「已听 N 次 · 下次复习 X」 */function listenStageLabel(c) {
  const stage = Math.max(0, Number(c.review_stage) || 0)
  if (!c.next_due_date) return stage > 0 ? '已完成全部复习' : '未开始'
  const today = todayKey()
  const d = String(c.next_due_date)
  if (d <= today) return d === today ? '今天该听' : `拖了：原定 ${d}`
  const later = addDaysKey(today, 1)
  if (d === later) return '明天该复习'
  return `下次复习 ${d}`
}
async function onListenPick(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = '' // 允许重复选同一个文件
  if (!file) return
  setListenMsg('')
  if (file.size > 20 * 1024 * 1024) return setListenMsg('这个文件超过 20MB，先剪短再导入。', true)
  const seconds = await clipDuration(file)
  const { clip, added } = newClipFromImport({ fileName: file.name, seconds }, listenClips.value)
  if (!added) return setListenMsg('这段音频已经在列表里了，没有重复导入。')
  /* 真机路径（Step 7）：把音频字节写进应用私有目录 listen/<file>，
     这样关掉 App / 刷新之后不用重新导入（记录里 file 只存文件名，路径前缀落盘时拼）。 */
  if (listenIsApp.value) {
    try {
      const b64 = await fileToBase64(file)
      const r = await writeClipBytes(clip.file, b64)
      if (!r || !r.ok) {
        return setListenMsg('音频没能存到本机：' + ((r && r.error) || '未知原因') + '。请重试一次。', true)
      }
      /* 写成功 ≠ 写对了：回读一次大小核对（真机播放报「不支持的源」时，最该先排除的就是没写全） */
      const st = await statClipFile(clip.file)
      if (st && st.ok && Number(st.size) !== Number(file.size)) {
        return setListenMsg('音频存到本机后大小对不上（原 ' + file.size + ' 字节 / 本机 ' + st.size + ' 字节）：请重试一次，或换个文件。', true)
      }
    } catch (err) {
      return setListenMsg('音频没能存到本机：' + (err && err.message ? err.message : String(err)) + '。请重试一次。', true)
    }
  } else {
    /* 浏览器：字节不落盘（刷新就没了，界面已明说），但把这次选中的文件留成 blob URL，
       当前会话里点「播放」能直接听——否则刚导入就播不了，体验上讲不通。 */
    try { listenBlobUrls.set(clip.id, URL.createObjectURL(file)) } catch { /* 拿不到就别播，下面会提示重新导入 */ }
  }
  const next = saveClips([...listenClips.value, clip])
  listenClips.value = next
  const durText = seconds ? '（' + fmtSeconds(seconds) + '）' : ''
  setListenMsg(listenIsApp.value
    ? `已导入「${clip.name}」${durText}并存到本机——刷新或重开都不会丢。`
    : `已导入「${clip.name}」${durText}——今天就可以听。`)
}
/* 自动记账（2026-10-03 用户决策：去掉手工「已听」按钮，放满设定遍数自动加）。
   到复习日（或刚导入当天）→ 走 reviewAdvance：已听次数 +1、复习档位 +1、按艾宾浩斯重算下次复习日；
   还没到复习日 → 只加已听次数（countPlayed），排期不动。
   为什么去掉手工确认：用户说"听完次数自动加上去就好了"；代价是中途停掉不算，
   只有真放满设定遍数才算一次（仍然不会自动播放，"点通知不出声"这条口径不变）。 */
function listenAutoMark(p) {
  const c = listenClips.value.find((x) => x.id === p.id)
  if (!c) return
  const due = !c.next_due_date || compareDateKey(c.next_due_date, todayKey()) <= 0
  const next = due
    ? reviewAdvance(c, { fromDateKey: todayKey(), intervals: listenSettings.value.reviewIntervals })
    : countPlayed(c)
  if (!next) return setListenMsg('这条数据有问题，先不记账。', true)
  listenClips.value = saveClips(listenClips.value.map((x) => (x.id === c.id ? next : x)))
  setListenMsg(due
    ? `放满 ${listenPlayTotal.value} 遍，自动记一次：「${next.name}」共听 ${next.played_count} 次 · ${listenStageLabel(next)}`
    : `放满 ${listenPlayTotal.value} 遍，自动记一次：「${next.name}」共听 ${next.played_count} 次（还没到复习日，排期先不动）`)
  applyListenSchedule()
}
/* 「到点提醒我去听」开关（2026-10-03 修 bug：此前 enabled 默认 false 且界面上没有开关，
   于是练耳通知永远排不出来）。写进 web2.listen.set.enabled，watch 会触发重排。 */
function toggleListenNotify() {
  const enabled = !listenSettings.value.enabled
  listenSettings.value = saveListenSettings({ enabled })
  setListenMsg(enabled
    ? '已开启到点提醒：到复习日合并成一条通知（记得允许通知权限）。'
    : '已关掉练耳提醒（课前提醒不受影响）。')
  applyListenSchedule()
}

/* ------------------------------------------------------------------
   练耳设置面板（2026-10-03 补：repeatTimes / reviewIntervals / 勿扰 / 两个阈值
   原来只能改代码里的 DEFAULTS，真机上没法自己调，连"改勿扰验 L5"都做不到）。
   面板里的输入一律先过 listen.js 的纯函数解析（parseIntervals / intInRange / isTimeStr），
   非法值**不写库**、界面回退成当前值；写库后 applyListenSchedule() 重排通知。
   ------------------------------------------------------------------ */
const listenSettingsOpen = ref(false)
function patchListenSettings(patch, msg) {
  listenSettings.value = saveListenSettings(patch)
  if (msg) setListenMsg(msg)
  applyListenSchedule()
}
/* 连放遍数：3–5（点一下直接落库，不用再点保存） */
function onListenRepeat(n) {
  const v = intInRange(n, listenSettings.value.repeatTimes, LISTEN_DEFAULTS.repeatTimesMin, LISTEN_DEFAULTS.repeatTimesMax)
  patchListenSettings({ repeatTimes: v }, `连放遍数已改成 ${v} 遍。`)
}
/* 复习间隔：手输 '1,2,4,7,15,30'；解析不出来就保留原值并把输入框回退 */
function onListenIntervals(e) {
  const el = e && e.target
  const iv = parseIntervals(el ? el.value : '', listenSettings.value.reviewIntervals)
  if (el) el.value = formatIntervals(iv)
  patchListenSettings({ reviewIntervals: iv }, `复习间隔已改成 ${formatIntervals(iv)} 天。`)
}
/* 勿扰时段：支持跨零点（start > end 就是跨夜） */
function onListenDnd(kind, e) {
  const el = e && e.target
  const cur = kind === 'start' ? listenSettings.value.dndStart : listenSettings.value.dndEnd
  const t = String((el && el.value) || '')
  if (!isTimeStr(t)) { if (el) el.value = cur; return }
  const next = kind === 'start' ? { dndStart: t } : { dndEnd: t }
  const s = kind === 'start' ? t : listenSettings.value.dndStart
  const en = kind === 'start' ? listenSettings.value.dndEnd : t
  patchListenSettings(next, `勿扰时段已改成 ${s}–${en}${minOfTime(en) <= minOfTime(s) ? '（跨夜）' : ''}，这段时间不发提醒。`)
}
/* 两个分钟阈值：短槽上限 / 最短空档（都 ≥1 分钟） */
function onListenNum(key, e) {
  const el = e && e.target
  const v = intInRange(el ? el.value : '', listenSettings.value[key], 1, 120)
  if (el) el.value = String(v)
  patchListenSettings({ [key]: v }, key === 'shortGapMaxMin'
    ? `短槽上限已改成 ${v} 分钟（${v} 分钟以内的空档按短槽算，只放 1 段）。`
    : `最短空档已改成 ${v} 分钟（比这更碎的空档不排）。`)
}
/* 一键回到 DEFAULTS（只改练耳这几项，不动课程提醒的设置） */
function resetListenSettings() {
  patchListenSettings({
    repeatTimes: LISTEN_DEFAULTS.repeatTimes,
    reviewIntervals: LISTEN_DEFAULTS.reviewIntervals.slice(),
    dndStart: LISTEN_DEFAULTS.dndStart,
    dndEnd: LISTEN_DEFAULTS.dndEnd,
    shortGapMaxMin: LISTEN_DEFAULTS.shortGapMaxMin,
    slotMinMin: LISTEN_DEFAULTS.slotMinMin,
  }, '练耳设置已恢复默认。')
}

/* ------------------------------------------------------------------
   播放（四期）：播放 / 停止 + 会话内重复遍数（repeatTimes，L4 那半截）。
   - App：用 listenStore.resolveListenUri 把 listen/<file> 解析成可播地址
     （getUri → convertFileSrc，与课堂录音同链路）
   - 浏览器：用导入时留下的 blob URL（刷新后字节没了，提示重新导入）
   会话内重复：一遍放完自动接着下一遍，直到下一遍 = 0（放完 total 遍）才停；
   连放几遍由 repeatTimesOf 决定（本条 repeat_times 优先，null 跟全局设置）。
   进度：放满设定遍数 = 完成一次复习 → 自动记一次「已听」（2026-10-03 用户决策，手工按钮已去掉）。
   点「停止」只是暂停：遍数与播放位置都留着，再点「继续」从断点接着放。
   ------------------------------------------------------------------ */
const listenBlobUrls = new Map() // 浏览器模式：id → blob URL（仅当前会话有效）
const listenPlayId = ref('') // 正在播的那条 id（空 = 没在播）
const listenPlayRound = ref(0) // 当前放到第几遍（0 = 没在播）
const listenPlayTotal = ref(0) // 这次要点连放几遍
let listenAudio = null

const listenPaused = ref(false) // 暂停中（点过「停止」：遍数与播放位置都留着，可「继续」）

/* 点「停止」= 暂停（不是清空）：记住放到第几遍、记住播放位置，再点「继续」从断点接着放。
   2026-10-03 用户反馈的 bug 就是这里原来把遍数清 0 了。 */
function pauseListen() {
  if (listenAudio) { try { listenAudio.pause() } catch { /* 停不下来也别崩 */ } }
  listenPaused.value = true
}
/* 彻底收摊：换段、放完一遍不剩、出错时用 */
function clearListen() {
  if (listenAudio) { try { listenAudio.pause() } catch { /* 忽略 */ } }
  listenPlayId.value = ''
  listenPlayRound.value = 0
  listenPlayTotal.value = 0
  listenPaused.value = false
}
/* 从暂停处接着放（不动遍数） */
async function resumeListen() {
  const a = listenAudio
  if (!a || !listenPlayId.value) return clearListen()
  try {
    await a.play()
    listenPaused.value = false
  } catch {
    setListenMsg('播放失败：文件可能不在了，重新导入试试。', true)
    clearListen()
  }
}
/* 一遍放完：还有下一遍就重头再放，否则这一轮算完成 → 自动记账（不再需要点「已听」）。
   重放失败（少见：音频被系统回收/浏览器限制）就老实停下，不空转。 */
function onListenEnded() {
  const id = listenPlayId.value
  if (!id) return
  const nextRound = nextPlayRound(listenPlayRound.value, listenPlayTotal.value)
  const a = listenAudio
  if (nextRound) {
    listenPlayRound.value = nextRound
    if (!a) return clearListen()
    try {
      a.currentTime = 0
      const p = a.play()
      if (p && typeof p.catch === 'function') p.catch(() => clearListen())
    } catch { clearListen() }
    return
  }
  /* 放满 total 遍 = 完成一次复习 */
  clearListen()
  const c = listenClips.value.find((x) => x.id === id)
  if (c) listenAutoMark(c)
}
async function onListenPlay(c) {
  /* 同一段：正在放 → 暂停；暂停中 → 从断点继续（遍数不清零） */
  if (listenPlayId.value === c.id) {
    if (listenPaused.value) return resumeListen()
    return pauseListen()
  }
  clearListen()
  setListenMsg('')
  let src = listenBlobUrls.get(c.id) || ''
  if (!src && listenIsApp.value) {
    /* 真机播放主路径（2026-10-03 真机实测后改）：读盘→Blob URL。
       原来用 getUri + convertFileSrc 得到 https://localhost/_capacitor_file_/…，
       真机上 <audio> 报 "Failed to load because no supported source was found."；
       而导入时读时长用的 URL.createObjectURL(File) 是通的，所以改成读字节自造 Blob，
       与能用的那条路对齐。读不出来才退回原链路，两条都失败就把原因如实说出来。 */
    const b = await makeClipBlobUrl(c.file)
    if (b && b.ok && b.url) {
      const old = listenBlobUrls.get(c.id)
      if (old) { try { URL.revokeObjectURL(old) } catch { /* 忽略 */ } }
      listenBlobUrls.set(c.id, b.url)
      src = b.url
    } else {
      const r = await resolveListenUri(c.file)
      if (r && r.ok && r.uri) {
        src = r.uri
      } else {
        return setListenMsg('播不了：' + ((b && b.error) || (r && r.error) || '未知原因'), true)
      }
    }
  }
  if (!src) return setListenMsg('这段音频的原始文件不在本机了，请重新导入一次。', true)
  try {
    if (!listenAudio) {
      listenAudio = new Audio()
      listenAudio.onended = onListenEnded
    }
    listenAudio.src = src
    try { listenAudio.currentTime = 0 } catch { /* 有些浏览器设不了，无妨 */ }
    const total = repeatTimesOf(c, listenSettings.value)
    listenPlayId.value = c.id
    listenPlayRound.value = 1
    listenPlayTotal.value = total
    await listenAudio.play()
  } catch (e) {
    clearListen()
    setListenMsg('播放失败：' + (e && e.message ? e.message : String(e)) + '（文件可能不在了，重新导入试试）', true)
  }
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
/* Stage 6：「我的」页从「功能堆砌」改成索引页——功能都在自己的全屏二级页里。
   settingsOpen 是旧「设置折叠」的开关，折叠没了，这个 ref 只为旧锚点/旧脚本留着（永远 false）。 */
const settingsOpen = ref(false)
const meSub = ref(null) // null | 'lectures' | 'listen' | 'todos' | 'settings'
const meSubTitle = computed(() => ({ lectures: '课堂录音', listen: '碎片练耳', todos: '待办清单', settings: '设置' }[meSub.value] || ''))
function openMeSub(k) { meSub.value = k }
function closeMeSub() { meSub.value = null }
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
    openMeSub('settings') // 顺手把「设置」二级页打开，否则展开了也看不见
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

/* ---------------- 主题「跟着时间呼吸」（v1.41.6，默认关） ----------------
   早 05–09 薄荷绿 / 白天 09–17 蓝白 / 傍晚 17–21 薰衣草紫 / 夜里 21–05 薰衣草紫 + 深色。
   刻意只在**跨时段**那一刻生效（记住上次自动应用的那一档）：用户中途手动改深浅/配色，
   不会被 5 分钟一次的巡检抢回去，等到 next 时段才自动接管。 */
const AUTO_THEME_KEY = 'web2.theme.auto'
const autoTheme = ref(localStorage.getItem(AUTO_THEME_KEY) === '1')
const AUTO_SLOTS = [
  { from: 5, to: 9, accent: 'mint', dark: false, name: '清晨' },
  { from: 9, to: 17, accent: 'blue', dark: false, name: '白天' },
  { from: 17, to: 21, accent: 'lavender', dark: false, name: '傍晚' },
  { from: 21, to: 29, accent: 'lavender', dark: true, name: '夜里' },
]
function autoSlot(h = new Date().getHours()) {
  const hh = h < 5 ? h + 24 : h
  return AUTO_SLOTS.find((s) => hh >= s.from && hh < s.to) || AUTO_SLOTS[1]
}
const autoSlotName = computed(() => (autoTheme.value ? autoSlot().name : ''))
let autoApplied = ''
function applyAutoTheme(force = false) {
  if (!autoTheme.value) {
    autoApplied = ''
    return
  }
  const slot = autoSlot()
  const key = slot.accent + (slot.dark ? '/dark' : '/light')
  if (!force && key === autoApplied) return
  autoApplied = key
  accent.value = slot.accent
  localStorage.setItem(ACCENT_KEY, slot.accent)
  applyAccent()
  theme.value = slot.dark ? 'dark' : 'light'
  localStorage.setItem(THEME_KEY, theme.value)
  applyTheme()
}
function setAutoTheme(on) {
  autoTheme.value = !!on
  localStorage.setItem(AUTO_THEME_KEY, autoTheme.value ? '1' : '0')
  if (autoTheme.value) applyAutoTheme(true)
}
applyAutoTheme(true)
setInterval(() => applyAutoTheme(), 5 * 60_000)

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

/* 学期进度（v1.41.6）：第 N / 共 M 周 + 距期末天数 + 逐周点亮的格子。
   缺 totalWeeks 就整条不出现；缺 firstMonday 只给周次、不猜期末日期（宁可少说，不猜）。 */
const termInfo = computed(() => {
  const s = semester.value
  const total = Number(s && s.totalWeeks) || 0
  if (!total) return null
  const wk = Math.min(Math.max(Number(s.week) || 1, 1), total)
  let daysLeft = null
  if (s.firstMonday) {
    const end = new Date(s.firstMonday + 'T00:00:00')
    if (!Number.isNaN(end.getTime())) {
      end.setDate(end.getDate() + total * 7)
      daysLeft = Math.max(0, Math.ceil((end - new Date(todayStr + 'T00:00:00')) / 86400000))
    }
  }
  return { wk, total, pct: Math.round((wk / total) * 100), daysLeft, weeks: Array.from({ length: total }, (_, i) => i + 1) }
})

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
/* 时间后门：?t=09:35（或带日期的 2026-10-06T09:35，只取时间部分）可假装时间（演示/测试用），
   不带参数走真实时间。注意它只冻结「钟点」，不冻结日期 —— 页面里的「今天」永远是真实今天，
   所以日期敏感的老脚本靠它挑不到星期，得自己把日期选好。 */
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

/* 「接下来」的那一条（2026-10-03 方案 C Step 2）：正在进行的那节优先，否则最近的下一节。
   都没有（今天的安排全结束 / 今天没课）返回空串——今天页就不给某条打强调。 */
const nextTodayId = computed(() => {
  const list = todayCourses.value
  const now = list.find((c) => courseStatus(c) === 'now')
  if (now) return now.id
  const next = list.find((c) => courseStatus(c) === 'future')
  return next ? next.id : ''
})
/* 距某条安排开始还有几分钟（只对未来的条目有意义；用 nowTime 而不是 new Date()，
   ?t= 时间后门冻结时倒计时也跟着冻结，测试可断言） */
function minUntil(c) {
  return minOf(c.start) - nowTime.value
}

/* Stage 3：26px 时间行右侧的状态字。
   已过 = 「已上完」（整行灰字，见 components/RowItem.vue），
   进行中 = 「还剩 N 分」，下一节 = 「N 分钟后」，其余未来条目留空（时刻列已经给了开始时间）。 */
function rowMeta(c) {
  const st = courseStatus(c)
  if (st === 'past') return '已上完'
  if (st === 'now') return `还剩 ${Math.max(0, minOf(c.end) - nowTime.value)} 分`
  if (c.id === nextTodayId.value) return `${minUntil(c)} 分钟后`
  return ''
}

/* ---------------- Stage 4：D↔F 两种密度 ----------------
   D（默认）：已过压成一行「已过 N 件 · 首–末」+ 接下来最多 3 行，其余进「展开全部」；
   点「展开全部」就地换 F：26px 全天表，一行一条，已过就是整行灰字（信息一条不丢，只换密度）。
   · 行高两种密度完全一样（都是 RowItem 的 26px），切换时列表不跳高度；
   · 「已过 N 件」点开是就地展开（不换页、不动别处），再点收起；
   · 顶上「现在」卡与页脚计数不参与折叠——首屏第一眼永远是「现在做什么」。 */
const LIVE_PREVIEW = 3
const todayPast = computed(() => todayCourses.value.filter((c) => courseStatus(c) === 'past'))
const todayLive = computed(() => todayCourses.value.filter((c) => courseStatus(c) !== 'past'))
const todayExpanded = ref(false) // false = D 形态；true = F 全天表
const pastOpen = ref(false) // 「已过 N 件」就地展开
const pastSpan = computed(() => {
  const list = todayPast.value
  if (!list.length) return ''
  return `${list[0].start}–${fmtTime(minOf(list[list.length - 1].end))}`
})
const livePreview = computed(() => (todayExpanded.value ? todayLive.value : todayLive.value.slice(0, LIVE_PREVIEW)))
const hiddenCount = computed(
  () => (todayExpanded.value ? 0 : todayPast.value.length + Math.max(0, todayLive.value.length - LIVE_PREVIEW)),
)
const rowsShown = computed(() => (todayExpanded.value || pastOpen.value ? todayPast.value.length : 0) + livePreview.value.length)

/* ---------------- Stage 2：顶卡主体（现在做什么） ----------------
   顶卡从此一张卡三行：情绪行（greetingText，特色文案不动）→ 主体 → 页脚计数。
   主体吃掉原来分散在四处的信息（状态气泡 / 今日状态行 / 录音卡 / 复盘卡），三种形态：
     class  = 有课可上（进行中优先，否则今天最近的一节）——课名 · 地点 · 剩余 + 录音按钮
     review = 该收尾了（≥18:00 且今天还没复盘，课都上完或已过 21:00）——收个尾 + 开始复盘
     free   = 今天没有安排——直接说「今天没有课」，副行沿用状态轴的可爱文案
   复盘不再常驻（用户 m12341）：只有该收尾时才占主体，写完日精进后降成一行「今天的日精进」。 */
const REVIEW_FROM = 18 * 60
const heroCourse = computed(
  () => currentCourse.value || todayCourses.value.find((c) => c.id === nextTodayId.value) || null,
)
const allTodayCoursesDone = computed(
  () => todayCourses.value.length > 0 && todayCourses.value.every((c) => nowTime.value > minOf(c.end)),
)
const heroMode = computed(() => {
  if (
    !todayReview.value &&
    nowTime.value >= REVIEW_FROM &&
    (allTodayCoursesDone.value || !todayCourses.value.length || nowTime.value >= 21 * 60)
  ) {
    return 'review'
  }
  return heroCourse.value ? 'class' : 'free'
})
/* 主体副行：地点 + 进行中剩余 / 下一节倒计时（口径与「接下来」那行一致） */
const heroSubline = computed(() => {
  const c = heroCourse.value
  if (!c) return ''
  const head = c.place || '—'
  if (courseStatus(c) === 'now') return `${head} · 还剩 ${Math.max(0, minOf(c.end) - nowTime.value)} 分钟`
  const until = minUntil(c)
  return until > 0 && until <= 120 ? `${head} · ${until} 分钟后开始` : head
})
/* 主体第一行：review 形态换成「收个尾」，其余沿用状态行口径（headerCourseText） */
const heroTitle = computed(() => (heroMode.value === 'review' ? '今天收个尾' : headerCourseText.value))
/* 录音钮按需出现（用户 m12661：不用常驻，只有上课时候才出现）：
   判据与开录挂课名/排自动停同一个 courseCovering（含开课前 5 分钟）——也就是说
   「这一颗钮出现在哪儿，按下去就会挂到哪节课上」，口径天然一致；
   录音进行中永远显示（课上到一半下课了也要能停）。 */
const recEntryOn = computed(() => !!recActiveId.value || !!courseCovering(todayCourses.value, nowTime.value))

const heroSub = computed(() => {
  if (heroMode.value === 'review') return '两分钟：今天怎么样、明天最重要的一件事，写完存成今天的日精进'
  if (heroMode.value === 'class') return heroSubline.value
  return (state.value && state.value.text) || '今天没有安排，看看待办和练耳吧'
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
   夹到 [300, 760]：小屏不至于把行挤成一条线，大屏也不至于拉得空荡。
   （Stage 8 把上限从 620 提到 760：课表页的问候卡收起了，腾出来的那 ~110px 本来就是要
   还给网格的；仍卡 620 的话网格底下会留一条 35px 空档 —— week-fit-check 的 B2 守着。）
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
  return Math.max(300, Math.min(760, winH.value - top - navH.value - 8))
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
  measureTodayH()
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
   深色模式下改为「同色系半透明底 + 原色文字」，避免大块高亮糊在暗底上。
   text 是浅色模式的文字色（对 bg ≥4.85），textDark 是深色模式的文字色
   （对「bar@16% 叠卡片」的底 ≥4.87）——深色下不能直接用 bar，那样只有 3.0–4.4。 */
const PALETTES = [
  { bg: '#eef4fe', bar: '#2f6feb', text: '#1f57cc', textDark: '#6d9af1' },
  { bg: '#f1eefe', bar: '#7c5ce0', text: '#5b3fc0', textDark: '#a38de9' },
  { bg: '#e9f9ef', bar: '#22a95e', text: '#157a43', textDark: '#38b26e' },
  { bg: '#fff4e8', bar: '#ef9436', text: '#a55309', textDark: '#ef9436' },
  { bg: '#fdeef4', bar: '#e8659f', text: '#b63a77', textDark: '#ea74a9' },
  { bg: '#e8f6f8', bar: '#2ba3b5', text: '#167383', textDark: '#40acbc' },
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
  return { bg: hexA(p.bar, 0.16), bar: p.bar, text: p.textDark }
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

/* 周课表「现在」游标（v1.41.6）：行是等高 1fr，所以把当前时刻映射成「第几行 + 行内比例」。
   只看本周（weekOffset === 0）才画；落在哪一行都算——午休/晚休这种被压成一行的空档
   按它自己的真实起止（上一节结束 → 下一节开始）做行内插值，游标与格子里的课同一套坐标。
   不在任何一行内（比如课表第一行之前 / 最后一行之后）返回 null，整条不画。 */
const nowClock = computed(() => {
  const h = Math.floor(nowTime.value / 60)
  const m = nowTime.value % 60
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
})
const nowLineY = computed(() => {
  if (weekOffset.value !== 0) return null
  const rows = gridRows.value
  const n = rows.length
  if (!n || !gridH.value) return null
  const t = nowTime.value
  for (let i = 0; i < n; i++) {
    const r = rows[i]
    let from = null
    let to = null
    if (r.type === 'p') {
      from = minOf(r.p.start)
      to = minOf(r.p.end)
    } else {
      const prev = rows[i - 1]
      const next = rows[i + 1]
      from = prev && prev.type === 'p' ? minOf(prev.p.end) : null
      to = next && next.type === 'p' ? minOf(next.p.start) : null
    }
    if (from === null || to === null || !(to > from)) continue
    if (t >= from && t < to) return ((i + (t - from) / (to - from)) / n) * gridH.value
  }
  return null
})

const undoneCount = computed(() => todos.value.filter((t) => !t.done).length)
/* 五期·每日复盘第 3 题要把「没做完的」摆出来（继续还是放掉得有据可依） */
const undoneTodos = computed(() => todos.value.filter((t) => !t.done))
const doneTodos = computed(() => todos.value.filter((t) => t.done))

/* 状态框（Day 19）：数据变动 → 重推快照。注册点必须在 todayCourses(2431) / listenDue(1088) /
   undoneCount(2760) 之后 —— 这三个 computed 在 setup 里是 const，提前 watch 会撞 TDZ
   （实测：提前注册会让整个 setup 抛 "Cannot access 'ya' before initialization"）。
   v1.41.9 真机反馈补 listenSettings（1178）：勿扰时段改了不重推，状态框要等下一次数据变动或重启
   才变——用户看到的就是「改了等于没改」，和 v1.41.3 修的那个现象是同一句话、不同的层。 */
watch([todayCourses, listenDue, undoneCount, frameSettings, recActiveId, listenSettings], () => { pushFrameNow() })

/* 详情弹层：点任意课卡弹出，点遮罩/×关闭 */
const detail = ref(null)
function openDetail(c) {
  detail.value = c
  confirmDel.value = false // 重开弹层时复位删除确认
}
const WDN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

/* ---------------- 其他日程页（三期「日程分类视图」，2026-10-02；2026-10-03 大减法） ----------------
   存在理由见模板顶部注释：独立日程此前没有集中入口。
   数据全部来自已就绪的 ref（weekAll / events / routines / todos），不新增任何存储。
   减法（2026-10-02）：筛选 chips / listFilter / listCounts 整组移除。
   分组标题自带数量（「待办 · 3」），chips 提供的计数是重复信息；
   而 chips 的代价是每次进页都要先做一次「我该选哪个」的判断——这正是不无感。

   减法（2026-10-03，方案 C Step 1 并入课表页后）：**课程与循环日程两组从清单里删掉。**
   它们本来就按「星期 × 节次」整整齐齐画在同一个页面签的周课表网格里，列在这里等于同一份
   数据说两遍（示例数据一进去 20 项里 16 项是课程）。清单只留**课表放不下的两类**：
   独立日程（单次日期的事）与待办（任务，不固定占某段时间）。
   不再列出的固定安排用一行「去周课表」的提示兜住，免得用户以为它们消失了。 */

const listTotalCount = computed(() => events.value.length + todos.value.length)
/* 被清单省略、但在周课表里看得到的固定安排数（课程 + 循环日程），给提示行用 */
const listFixedCount = computed(() => weekAll.value.length + routines.value.length)

/* 绝对日期：清单是总览，不跟今日页用「今天 / 明天」那种相对文案 */
function listDateLabel(d) {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? Number(m[2]) + '月' + Number(m[3]) + '日' : ''
}

/* 分组：独立日程 / 待办（课程与循环日程已从清单删除，理由见上方注释）。
   排序口径——独立日程按「日期 → 起始时间」，待办按「未完成优先 → 截止日期」。
   空组不输出（没有内容的组连标题都不出现）。 */
const listGroups = computed(() => {
  const out = []
  const evs = [...events.value].sort(
    (a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (minOf(a.start) - minOf(b.start))
  )
  if (evs.length) out.push({ key: 'event', title: '独立日程', items: evs })
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
/* ---------------- 二级层收尾（2026-10-03 方案 C Step 5） ----------------
   背景滚动锁的唯一真源：任何浮层/二级页开着时，底下的页面不能再滑。
   （此前只在周课表子视图锁，浮层打开后还能拖动背景页面。）
   switchTab / setWeekSub / onMounted 都调 syncBodyScrollLock()；
   函数声明会提升，所以上面几处调用点写在本段之前也安全。 */
const anySheetOpen = computed(() => !!(
  onboarding.value || habitSheet.value || detail.value || addPick.value ||
  addForm.value || todoForm.value || evtForm.value || picker.value ||
  confirmClear.value || delLecId.value || semForm.value
))
function syncBodyScrollLock() {
  const lock = anySheetOpen.value || (tab.value === 'week' && weekSub.value === 'week')
  document.body.style.overflow = lock ? 'hidden' : ''
}
watch([anySheetOpen, tab, weekSub], syncBodyScrollLock)

/* ===== APP_CTX:begin（由 tmp/gen-app-ctx.mjs 生成，勿手改）=====
   Stage 9：App 仍是唯一状态持有者，这里把上下文交出去；
   拆出去的页面/浮层用 useApp() 取（reactive 会自动解包 ref，读写都不用 .value）。
   这个块是生成的：改了状态就重跑 web2/tmp/gen-app-ctx.mjs，别手改。 */
provide(APP_CTX, reactive({
  loadDataset, importFromText, clearImport, matchWeek, minOf, addCourse, dedupAdded, countAddedDups,
  removeCourse, updateCourse, updateImportedCourse, removeImportedCourse, patchMockCourse, removeMockCourse, findConflicts, dayScope,
  exportImportedText, addTodo, patchTodo, removeTodoById, addEvent, addRoutine, updateRoutine, removeRoutine,
  periodsOf, createManualSemester, updateImportedSemester, LECTURES_KEY, loadLectures, addLecture, updateLecture, removeLecture,
  setLectureSummary, courseCovering, nextCourseDate, HABITS_KEY, loadHabits, addHabit, removeHabit, toggleHabitRecord,
  streakOf, todayKeyOf, isGraceKey, graceKeysOf, isBackfilled, totalDoneOf, weekMondayKeyOf, ADDED_KEY,
  TODOS_KEY, EVENTS_KEY, COURSE_OV_KEY, normalizeSegs, segmentView, reperiodAll, shiftWithinSegment, addPeriodToSegment,
  removePeriodAt, GRID_AXIS_W, buildGridRows, rowIndexMap, courseItems, previewItems, gridStyleOf, isAligned,
  findCellOverlaps, secRowRange, clampCoursesToSegments, recorderAvailable, ensureMicPermission, recStart, recStop, resolvePlayableUri,
  statClip, deleteClipFile, startKeepAlive, stopKeepAlive, keepAliveRunning, scheduleAutoStop, consumeAutoStop, transcriberAvailable,
  modelState, ensureModel, transcribeLecture, startLiveTranscribe, stopLiveTranscribe, loadLlmConfig, saveLlmConfig, summarizeTranscript,
  summarizerAvailable, testConnection, DEEPSEEK_MODELS, compressImageForRecognize, recognizeScheduleImage, recognizerAvailable, buildIcs, downloadText,
  notifyAvailable, loadNotifySettings, saveNotifySettings, ensureNotifyEnv, buildScheduleItems, applySchedule, notifyDone, testNotify,
  onNotificationAction, LISTEN_TAG, LISTEN_CHANNEL, exactAlarmState, askExactAlarm, loadClips, saveClips, loadListenSettings,
  saveListenSettings, reviewAdvance, countPlayed, compareDateKey, newClipFromImport, clipDuration, fmtSeconds, todayKey,
  addDaysKey, minOfTime, dueClips, buildListenItems, repeatTimesOf, nextPlayRound, buildListenNotices, parseIntervals,
  formatIntervals, intInRange, isTimeStr, LISTEN_DEFAULTS, fileToBase64, writeClipBytes, resolveListenUri, makeClipBlobUrl,
  statClipFile, loadReviews, saveReviews, upsertReview, findReview, loadReviewSettings, saveReviewSettings, newRecord,
  summarizeReview, MOODS, QUESTIONS, noticeItem, noticeDate, REVIEW_TAG, REVIEW_CHANNEL, loadDaily,
  saveDaily, upsertDay, dayOf, recentDays, baselineOf, dayLine, MonthCalendar, NumberWheel,
  TimeWheel, DropdownSelect, PeriodsEditor, BottomSheet, RowItem, APP_CTX, TodayPage, WeekPage,
  MePage, LecturesPanel, ListenPanel, TodosPanel, SettingsPanel, OnboardingPage, TodoSheet, ReviewSheet,
  EventSheet, SemesterSheet, PickerSheet, ConfirmClearSheet, DeleteLectureSheet, AddSheet, PressTypeSheet, ReviewGridSheet,
  DetailSheet, HabitSheet, APP_VERSION, tab, TAB_KEYS, tabIndex, weekSub, habitSheet,
  stripDelay, switchTab, setWeekSub, weekMenuOpen, toggleWeekMenu, closeWeekMenu, menuAddSlot, menuAddCourse,
  menuAddEvent, menuScan, menuOpenList, onWeekMenuAway, stripRef, stripH, measureStrip, todayH,
  todayRef, todayTopOffset, measureTodayH, swipeDx, swiping, sw, onStripTouchStart, onStripTouchMove,
  onStripTouchEnd, onStripTouchCancel, APP_PLUGIN, backHint, closeTopmostLayer, lastBackTs, backHintTimer, initBackButton,
  picker, pickerRef, openDateField, openTimeField, openNumberField, pickerConfirm, initial, source,
  semester, weekAll, events, routines, importMsg, reloadDataset, addedDupCount, dedupCourses,
  onImportFile, onClearImport, notifySettings, notifyPerm, notifyOk, notifyTesting, notifyMsg, notifyMsgBad,
  exactAlarm, exactAsking, exactMsg, exactMsgBad, exactHint, refreshExactAlarm, onAskExactAlarm, goMeTab,
  applyNotifySchedule, toggleNotify, setNotifyLead, onTestNotify, initNotify, frameSettings, frameIsApp, frameMsg,
  frameMsgBad, setFrameMsg, frameToast, frameToastTimer, showFrameToast, frameDrainTimer, startFrameDrainLoop, stopFrameDrainLoop,
  frameTodayItems, frameTomorrowFirst, pushFrameNow, applyFrameActions, frameDrainErr, drainFrameActions, initFrame, toggleFrame,
  onFrameVisible, ONBOARD_KEY, onboarding, onboardStep, OB_STEP_LABELS, onboardStepNo, finishOnboarding, confirmClear,
  doClearData, habits, habitInput, habitName, habitToday, reloadHabits, addHabitConfirm, removeHabitConfirm,
  habitDelId, habitDelTimer, onHabitDelete, toggleHabit, habitsAllDoneToday, undoAllHabitsToday, habitGrace, habitWeekBase,
  habitViewDays, habitWeekLabel, shiftHabitWeek, habitTodayDone, onHabitCell, habitCellState, HABIT_CELL_CLS, habitTodayText,
  lectures, recActiveId, recElapsed, recMsg, recMsgBad, playingId, recTicker, audioEl,
  recSupported, refreshLectures, setRecMsg, fmtDur, fmtLecDate, lecStatusLabel, defaultLecTitle, entryName,
  tickRec, startRec, AUTO_STOP_GRACE_MIN, finalizeRecording, stopRec, onVisibleCheckAutoStop, reconcileKeepAlive, playLec,
  onPlayFail, delLecId, pressActiveId, pressTimer, pressPos, delLec, startLecPress, moveLecPress,
  cancelLecPress, doDeleteLecture, listenClips, listenSettings, listenMsg, listenMsgBad, listenOpen, listenIsApp,
  setListenMsg, refreshListen, initListen, listenDayKey, applyListenSchedule, reviewSheet, reviewHistory, reviewSettings,
  reviewMsg, reviewMsgBad, REVIEW_AT_CHOICES, WD_LABELS, todayReview, reviewStepTotal, weekdayLabelOf, refreshReviews,
  setReviewMsg, moodLabelOf, initReview, reviewStatsNow, openReview, closeReview, reviewSetAnswer, reviewNext,
  reviewBack, reviewFinish, toggleReviewNotify, setReviewAt, applyReviewSchedule, dailyBook, todayDaily, dailyBaseline,
  snapshotToday, dailyLineOf, accountToday, accountHistory, reviewFocusText, reviewAddTodo, isSameDay, listenSuggestions,
  listenDue, listenTodayAll, listenStageLabel, onListenPick, listenAutoMark, toggleListenNotify, listenSettingsOpen, patchListenSettings,
  onListenRepeat, onListenIntervals, onListenDnd, onListenNum, resetListenSettings, listenBlobUrls, listenPlayId, listenPlayRound,
  listenPlayTotal, listenAudio, listenPaused, pauseListen, clearListen, resumeListen, onListenEnded, onListenPlay,
  trSupported, trBusyId, trPhase, trPercent, trLabel, trOpenId, fmtSize, startTr,
  llmCfg, llmInputOpen, settingsOpen, meSub, meSubTitle, openMeSub, closeMeSub, PROVIDER_OPTIONS,
  llmReady, sumBusyId, sumStage, sumOpenId, sumCtrl, saveLlm, onLlmProvider, onLlmKey,
  llmTest, llmModels, testLlm, cancelSummary, startSummary, runAutoPipeline, tomorrowStr, homeworkToTodos,
  onboardFile, onboardImport, obImportMsg, onOnboardFile, semForm, semErr, DEFAULT_PERIODS, openSemEdit,
  saveSemEdit, defaultTermName, fmtDateYMD, obForm, obErr, goObForm, obPageDir, goObPeriods,
  backObForm, obStepDir, obAiFrom, obAiErr, gotoAiCfg, onObAiKey, obAiTest, obAiDone,
  obAiBack, obPickStart, obStartHint, obPickWeeks, SEG_NAMES, segName, obTimeSummary, obPickDur,
  obPickGap, obGlobal, obReperiod, obSegGroups, obPickPeriodStart, obPickPeriodEnd, obAddPeriod, obRemovePeriod,
  obSubmit, obRecFile, obRecBusy, obRecErr, recPreview, WEEKDAY_LABELS, WEEK_RULE_LABELS, recSelectedCount,
  obPeriods, obSegView, recFromMine, minePeriods, recPeriods, recSegView, mineRecStart, mineRecCancel,
  goObRec, recBackForm, obManualAdd, obRecClick, onObRecFile, recSecOptions, recTimeRange, recRemove,
  recGrid, recCols, recRows, recRowIdx, recColsStyle, recGridStyle, recOverlapNote, palOf,
  recItemHot, recPressCell, recCellDown, recCellUp, recCell, recCellErr, openRecAdd, openRecEdit,
  recCellWhere, recCellWhen, submitRecCell, delRecCell, recBack, recImport, THEME_KEY, theme,
  isDark, applyTheme, toggleTheme, ACCENTS, ACCENT_KEY, savedAccent, accent, applyAccent,
  setAccent, AUTO_THEME_KEY, autoTheme, AUTO_SLOTS, autoSlot, autoSlotName, autoApplied, applyAutoTheme,
  setAutoTheme, todos, doneCount, toggleTodo, TODO_FILTERS, todoFilter, shownTodos, setTodoFilter,
  todoForm, todoErr, openTodoAdd, openTodoEdit, submitTodo, deleteTodoNow, confirmDelTodo, confirmDelTodoTimer,
  onDeleteTodo, evtForm, evtErr, evtWarn, evtConfirmed, openEventAdd, submitEvent, onExportBack,
  onExportIcs, today, todayIdx, todayStr, todayCourses, todayRoutineCount, termInfo, conflictPool,
  tParam, nowTime, GREET_CUTE, greetingText, state, currentCourse, headerCourseText, nextTodayId,
  minUntil, rowMeta, LIVE_PREVIEW, todayPast, todayLive, todayExpanded, pastOpen, pastSpan,
  livePreview, hiddenCount, rowsShown, REVIEW_FROM, heroCourse, allTodayCoursesDone, heroMode, heroSubline,
  heroTitle, recEntryOn, heroSub, dateText, weekDay, DAY_START, DAY_END, weekOffset,
  weekNo, monday, weekDays, weekVisible, weekCols, gridRows, gridRowOfIdx, gridCourses,
  WEEK_CHROME, winH, navH, satPx, gridTop, gridH, measureNavH, measureSat,
  measureGridTop, onWinResize, gridColsStyle, gridBodyStyle, cardFit, PALETTES, hashName, hexA,
  ROUTINE_PAL, isRoutine, pal, periods, periodSpan, courseStatus, gridStatus, nowPct,
  nowClock, nowLineY, undoneCount, undoneTodos, doneTodos, detail, openDetail, WDN,
  listTotalCount, listFixedCount, listDateLabel, listGroups, listBarColor, listMeta, onListItem, addForm,
  addErr, addWarn, addConfirmed, DURATIONS, fmtTime, clampStart, openAdd, openAddRoutine,
  addPick, pickKind, editCourseFromDetail, editRoutineFromDetail, stepStart, submitAdd, removeCourseFromDetail, confirmDel,
  confirmDelTimer, onDelCourse, removeRoutineFromDetail, onDelRoutine, lpTimer, lpFrom, cellAt, firePick,
  gridDown, gridMove, gridUp, gridDbl, anySheetOpen, syncBodyScrollLock,
}))
/* ===== APP_CTX:end ===== */
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
    <!-- Stage 8：课表页不需要问候卡（今日页那句在这儿是重复的），整张头部在课表页收起，
         网格拿回整屏。用与今日页主体同一套 grid-rows 塌缩，0fr 时 overflow-hidden 把
         卡片连同 mt-3 外边距一起裁掉，所以收起后不残留一条空白。 -->
    <div
      class="grid transition-[grid-template-rows] duration-[280ms]"
      :class="tab === 'week' ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'"
      style="transition-timing-function: cubic-bezier(0.3, 0.75, 0.3, 1)"
    >
      <div class="min-h-0 overflow-hidden">
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
          <!-- Stage 2：原「状态气泡」并入顶卡主体（没课时用它那句可爱话当副行），这里不再单独占一行 -->
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
      <!-- Stage 2 主体 + 页脚：随 tab 收起（沿用同一套 grid-rows 塌缩，高度动画与原来一致） -->
      <div
        class="grid transition-[grid-template-rows] duration-[280ms]"
        :class="tab === 'today' ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'"
        style="transition-timing-function: cubic-bezier(0.3, 0.75, 0.3, 1)"
        :style="{ transitionDelay: tab === 'today' ? '110ms' : '0ms' }"
      >
        <div class="min-h-0 overflow-hidden">
          <!-- 主体：现在做什么（class 有课 / review 该收尾 / free 没安排）
               录音钮三种形态都在——无感录音的入口只留这一颗，不随形态消失。
               data-today-rec 挂在本块上（录音按钮 + 计时 + 提示都算「录音区」），
               原来那张「课堂录音」大卡压成这里一颗钮（用户 m12341：它不该单独占一张卡）。 -->
          <div
            data-today-now
            data-today-rec
            class="mt-3 rounded-2xl border border-white/70 bg-card/75 px-3.5 py-3 shadow-sm dark:border-white/10"
          >
            <div class="flex items-center gap-3">
              <span class="min-w-0 flex-1">
                <span data-header-status class="block truncate text-sm font-semibold text-ink">{{ heroTitle }}</span>
                <span class="mt-0.5 block truncate text-[11px] text-ink-dim">{{ heroSub }}</span>
              </span>
              <div class="flex shrink-0 items-center gap-2">
                <button
                  v-if="heroMode === 'review'"
                  data-review-start
                  class="rounded-full bg-primary-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-primary-500/25 transition active:scale-95"
                  @click="openReview('ask')"
                >开始复盘</button>
                <button
                  v-if="recEntryOn && !recActiveId"
                  data-today-rec-start
                  aria-label="开始录音"
                  class="flex items-center gap-1 rounded-full bg-primary-500 px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-primary-500/25 transition active:scale-95"
                  :class="recSupported ? '' : 'opacity-60'"
                  @click="startRec"
                >
                  <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="1.5" width="4" height="8" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 009 0M8 12v2.5M5.5 14.5h5" /></svg>
                  录音
                </button>
                <button
                  v-if="recActiveId"
                  data-today-rec-stop
                  class="flex items-center gap-1 rounded-full bg-red-400 px-3 py-2 text-xs font-semibold text-white shadow-sm transition active:scale-95"
                  @click="stopRec"
                >
                  停止并保存
                </button>
              </div>
            </div>
            <!-- 进行中的实时进度条（v1.41.6）：原在「接下来」那条行里，Stage 3 把行高收到 26px 后
                 挪到「现在」卡上——lively-check 读的仍是同一个 data-now-bar，且此刻全页仍恰好一条 -->
            <div
              v-if="currentCourse"
              data-now-bar
              class="mt-2 h-1 w-full overflow-hidden rounded-full bg-primary-100"
            >
              <div
                class="h-full rounded-full bg-primary-500 transition-all duration-700"
                :style="{ width: nowPct(currentCourse) + '%' }"
              ></div>
            </div>
            <p v-if="recActiveId" class="mt-1.5 flex items-center gap-1.5 text-[11px] text-red-600 dark:text-red-400">
              <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400"></span>
              录音中 {{ fmtDur(recElapsed * 1000) }} · 下课 2 分钟自动停 · 锁屏也会继续录
            </p>
            <p v-if="recMsg" class="mt-1.5 text-[11px]" :class="recMsgBad ? 'text-red-600 dark:text-red-400' : 'text-primary-600'">{{ recMsg }}</p>
          </div>
          <!-- 页脚计数：原来今天页顶部那条 data-today-strip 整块搬进来（锚点与内部结构不变） -->
          <section data-today-strip class="mt-2.5 flex items-center gap-3 rounded-2xl border border-line bg-card px-3.5 py-2 shadow-sm">
            <p class="min-w-0 flex-1 truncate text-xs text-ink-dim">
              今天 {{ todayCourses.length }} {{ todayRoutineCount ? '项安排' : '节课' }}
            </p>
            <span class="shrink-0 text-[11px] text-ink-dim">待办 {{ doneCount }}/{{ todos.length }}</span>
            <div class="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-primary-100">
              <div
                class="h-full rounded-full bg-primary-500 transition-all duration-500"
                :style="{ width: todos.length ? (doneCount / todos.length) * 100 + '%' : '0%' }"
              ></div>
            </div>
          </section>
        </div>
      </div>
      <!-- 学期进度（v1.41.6）：一周点亮一格，一眼看到「学期过到哪了」。
           Stage 2 起从「顶卡最上面」下沉到主体之后——顶卡第一眼该是「现在做什么」。
           只在今日页出现——周课表/我的页的头部是紧凑版，塞进来会把它们撑高。 -->
      <div v-if="tab === 'today' && termInfo" data-term-ribbon class="mt-3">
        <div class="flex items-end justify-between gap-2">
          <p class="text-[11px] font-medium text-primary-600/90">
            学期进度 · 第 {{ termInfo.wk }} / {{ termInfo.total }} 周
          </p>
          <p v-if="termInfo.daysLeft !== null" data-term-left class="shrink-0 text-[11px] text-ink-dim">
            距期末 {{ termInfo.daysLeft }} 天
          </p>
        </div>
        <div class="mt-1.5 flex items-end gap-[3px]">
          <span
            v-for="w in termInfo.weeks"
            :key="w"
            data-term-w
            class="flex-1 rounded-[2px] transition-all duration-500"
            :class="w <= termInfo.wk ? 'bg-primary-500/85' : 'bg-white/70'"
            :style="{ height: w === termInfo.wk ? '10px' : '7px' }"
            :title="'第 ' + w + ' 周'"
          ></span>
        </div>
      </div>
    </header>
      </div>
    </div>

    <!-- 内容平移层（Day 11 二轮）：三页并排各占 1/3，translateX 跟随 tab，连点改道可打断。
         2026-10-01 加左右滑动手势：swipeDx 并进 translateX 跟手，swiping 时关 transform
         过渡（拖动零延迟），松手恢复过渡播放回弹/切换动画；touch-pan-y 把横向手势让给 JS。
         除数用 TAB_KEYS.length 而不是写死——2026-10-02 加第四页「打卡」时，
         原来写死的 /3 让平移只走四分之三，页面错位（截图实证）。 -->
    <div
      ref="stripRef"
      class="flex w-[300%] shrink-0 items-start overflow-y-clip touch-pan-y duration-[280ms]"
      style="transition-property: transform, height; transition-timing-function: cubic-bezier(0.32, 0.72, 0.35, 1)"
      :style="{
        transform: `translateX(calc(-${(tabIndex * 100) / TAB_KEYS.length}% + ${swipeDx}px))`,
        transitionDelay: stripDelay,
        transitionProperty: swiping ? 'height' : 'transform, height',
        height: stripH ? stripH + 'px' : 'auto',
      }"
    >
    <!-- ===== 今日 ===== -->
    <main
      ref="todayRef"
      data-page="today"
      data-today-scroll
      class="w-1/3 space-y-4 overflow-y-auto overscroll-contain px-4 pt-4 pb-28"
      :inert="tab !== 'today'"
      :style="todayH ? { height: todayH + 'px' } : null"
    >
      <TodayPage />
    </main>

    <!-- ===== 周课表 =====
         pb-16（64px）不是随手写的：网格本来就一屏看完，底部留白只需保证「不被底部导航压住」，
         留 pb-28(112px) 会让文档比屏幕高 44px → 用户能上下滑出一片空白
         （2026-10-01 实测：390×844 下 pb-28 时 maxScroll=44）。 -->
    <main data-page="week" class="w-1/3 px-4 pt-4 pb-16" :inert="tab !== 'week'">
      <WeekPage />
    </main>

    <!-- ===== 我的 ===== -->
    <main data-page="me" class="w-1/3 space-y-4 px-4 pt-4 pb-28" :inert="tab !== 'me'">
      <MePage />
    </main>

    <!-- ===== 「我的」二级页（Stage 6）=====
         四个功能各有一个全屏页，推入/返回沿用同一套（返回按钮 + 系统返回键都能回索引）。
         内容全部是原来「我的」页里那几块（锚点与内部结构一字未动），只是换了个容器。 -->
    <!-- 平移层带 transform：fixed 会相对它（300% 宽）定位 → 二级页必须 Teleport 到 body，
         否则整页会错位（Stage 6 踩过：todos 页只剩右边的日期，标题全跑到视口外）。 -->
    <!-- 真机状态栏让位：外壳给 #app 加了 padding-top: var(--sat)，但 Teleport 到 body 之后
         就不在 #app 里了 —— 不加这行，真机上页头「‹ 返回」会压在系统时间上（v1.42 真机复验 S6 抓到，
         浏览器里 --sat=0 所以看不出）。 -->
    <Teleport to="body">
    <!-- 二级页推入（美术收口，约定 2a）：从右整屏推进来、返回时推回去（.push-* 在 style.css）。
         原来这里没有 Transition，切换是瞬时的。只动 transform，不碰布局。 -->
    <Transition name="push">
    <div v-if="meSub" data-sub-page :data-sub="meSub" class="fixed inset-0 z-40 flex flex-col bg-canvas" :style="{ paddingTop: 'var(--sat, 0px)' }">
      <header class="flex shrink-0 items-center gap-2 border-b border-line bg-card/90 px-3 py-2.5 backdrop-blur">
        <button type="button" data-sub-back class="flex h-9 shrink-0 items-center gap-0.5 rounded-full pl-1 pr-2 text-sm text-ink-dim transition active:scale-95" @click="closeMeSub">
          <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5" /></svg>
          返回
        </button>
        <h2 data-sub-title class="min-w-0 flex-1 truncate text-center text-sm font-semibold">{{ meSubTitle }}</h2>
        <span class="w-[62px] shrink-0"></span>
      </header>
      <div data-sub-body class="flex flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-4 pb-28">
        <LecturesPanel v-if="meSub === 'lectures'" />

        <ListenPanel v-else-if="meSub === 'listen'" />

        <!-- 待办清单（Stage 6 新增）：今天页只看今天，这一页看全部——未完成在前，已完成收在后面 -->
        <TodosPanel v-else-if="meSub === 'todos'" />

        <SettingsPanel v-else />
      </div>
    </div>
    </Transition>
    </Teleport>
    </div><!-- /内容平移层 -->

    <!-- 退出预备提示条（v1.17：2 秒内再按返回键才退出） -->
    <Transition name="fade">
      <div
        v-if="backHint"
        class="fixed bottom-20 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-xs font-medium text-white shadow-lg"
      >{{ backHint }}</div>
    </Transition>

    <!-- 通知栏状态框的按钮动作回执（v1.41.1：按了按钮必须当场看得见，别只跳回今日页） -->
    <Transition name="fade">
      <div
        v-if="frameToast"
        data-frame-toast
        class="fixed bottom-32 left-1/2 z-[60] w-[86%] max-w-sm -translate-x-1/2 rounded-2xl bg-black/80 px-4 py-3 text-center text-xs font-medium leading-relaxed text-white shadow-lg"
      >{{ frameToast }}</div>
    </Transition>

    <!-- 录音中常驻小条（v1.41.1）：录音卡在今日页最底部，开了录却看不到状态等于没反馈。
         放在底部导航正上方（像迷你播放条），不要压顶部——今日页顶部第一行就是日期与问候。
         v1.42 真机修复：**不要再套 `<Transition>`** —— 真机 WebView 上被 Transition 包住的
         fixed 元素，合成层画面会比布局盒低 ~80px，结果是「看得见、点不到」（点它会穿透到
         下面那条待办筛选 chips 上；Playwright 的 locator.click() 走布局盒，所以电脑侧测不出来）。 -->
    <button
      v-if="recActiveId"
      data-rec-banner
      class="fixed inset-x-0 bottom-20 z-[60] mx-auto flex w-fit items-center gap-2 whitespace-nowrap rounded-full bg-red-500/95 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg"
      @click="goMeTab(recActiveId ? 'lectures' : null)"
    >
      <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-white"></span>
      录音中 {{ fmtDur(recElapsed * 1000) }}
      <span class="font-normal opacity-80">· 去停</span>
    </button>

    <!-- 底部导航：app 感的核心 -->
    <nav
      class="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-card/85 backdrop-blur-lg"
      style="padding-bottom: env(safe-area-inset-bottom)"
    >
      <div class="relative mx-auto grid max-w-md grid-cols-3 px-6 py-1">
        <!-- 滑块：一个药丸在四个槽位间连续滑动，连点时 transition 自动改道（可打断） -->
        <div class="pointer-events-none absolute inset-0 overflow-hidden">
          <div class="absolute inset-y-0 left-6 right-6">
            <div
              class="flex h-full w-1/3 justify-center transition-transform duration-300"
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
            { key: 'me', label: '我的', icon: 'M8 8a3 3 0 100-6 3 3 0 000 6zM2 14c0-2.5 2.5-4 6-4s6 1.5 6 4' },
          ]"
          :key="t.key"
          class="relative flex flex-col items-center pt-1 pb-1 transition-transform duration-150 active:scale-90"
          :class="tab === t.key ? 'text-primary-600' : 'text-ink-dim'"
          :data-nav="t.key"
          :data-active="tab === t.key ? '1' : null"
          :aria-current="tab === t.key ? 'page' : undefined"
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

<HabitSheet />

<DetailSheet />

<ReviewGridSheet />

<PressTypeSheet />

<AddSheet />

    <!-- 待办增删改面板：点待办文字编辑，＋添加待办新增 -->
  <TodoSheet />

    <!-- ===== 每日复盘浮层（五期）=====
         一页一题（四题、可跳过）→ 生成日精进 → 关键句一键转明天待办；
         历史模式在同一张浮层里翻（不做第二张浮层）。 -->
  <ReviewSheet />

    <!-- 独立日程添加面板：今日视图「＋ 添加日程」唤起 -->
  <EventSheet />

    <!-- 学期信息/节次表编辑弹层 -->
  <SemesterSheet />

<PickerSheet />

<ConfirmClearSheet />

<DeleteLectureSheet />

    <!-- 初始设定引导页：首次打开出现，选一次就记住 -->
  <OnboardingPage />
  </div>
</template>
