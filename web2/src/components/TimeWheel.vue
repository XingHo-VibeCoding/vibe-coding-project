<script setup>
// 时间滚轮面板：时/分两列，滚动或点选；对齐主项目「自建时间面板」口径
// 2026-09-30 第二轮改造（用户反馈「改完之后滑动手感没有之前好了：快滑太快、慢滑拖沓」）：
//   触屏改为**自接管**，与「组件手感三定律」第一条同源（物理纯函数见 src/data/wheelPhysics.js）：
//     · 拖动：1:1 直写 scrollTop，全程不做吸附 → 跟手（旧版交给原生 mandatory 吸附，
//       实测慢速档跟手度只有 0.56~0.80，手指走 72px 内容只挪 40px = 用户说的「拖沓」）
//     · 松手：按速度换算滑几格，**封顶 8 格** → 可控（循环化后没有了顶/底兜底，
//       原生惯性一次快甩能跑很远 = 用户说的「太快」）
//     · 循环：列表重复 3 份（REPEAT），越界时平移整数份——内容完全重复、对 ROW 相位相同，
//       所以视觉绝对无缝，永远到不了底
import { ref, computed, onMounted, nextTick } from 'vue'
import { flingSteps, velocityFromSamples, normalizeTop, easeOutCubic } from '../data/wheelPhysics.js'

const props = defineProps({
  modelValue: { type: String, default: '' }, // 'HH:mm' 或 ''
})
const emit = defineEmits(['update:modelValue'])

const ROW = 40 // 每项高度，需与模板样式一致
const REPEAT = 3 // 循环份数：活动窗口维持在中间一份
const ANIM_SNAP_MS = 150 // 松手只吸附（没甩起来）的时长
const ANIM_FLING_BASE = 150 // 甩动动画基础时长
const ANIM_FLING_PER_STEP = 26 // 每多滑一格补的时长
const AXIS_LOCK_PX = 8 // 手指移动超过它才判方向（避免轻微抖动被当成横向手势）

const init = props.modelValue || '08:00'
const [initH, initM] = init.split(':').map(Number)

const hourCol = ref(null)
const minCol = ref(null)
const hour = ref(initH)
const min = ref(initM)

// 三份重复列表；渲染索引用 i（0..3N-1），显示值 = i % N，故 :key 必须用索引
const hours = Array.from({ length: 24 * REPEAT }, (_, i) => i % 24)
const minutes = Array.from({ length: 60 * REPEAT }, (_, i) => i % 60)
const pad = (n) => String(n).padStart(2, '0')

const display = computed(() => `${pad(hour.value)}:${pad(min.value)}`)
const spanOf = (count) => count * ROW

/* ---------- 滚动位置读写：所有写入都过 normalizeTop，永远待在中间那份 ---------- */
function cancelAnim(el) {
  if (!el) return
  if (el._raf) cancelAnimationFrame(el._raf)
  el._raf = 0
  el._anim = false
}
/* 短缓动到目标位置（自己写的 rAF，不用 scrollTo smooth——那个又慢又被吸附回吸） */
function animTo(el, to, dur, done) {
  cancelAnim(el)
  const from = el.scrollTop
  if (Math.abs(to - from) < 0.5) {
    done && done()
    return
  }
  const t0 = performance.now()
  el._anim = true
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / dur)
    el.scrollTop = from + (to - from) * easeOutCubic(p)
    if (p < 1) {
      el._raf = requestAnimationFrame(frame)
      return
    }
    el._raf = 0
    done && done() // 回调里还在 _anim 状态，避免 scroll 监听插一脚
    el._anim = false
  }
  el._raf = requestAnimationFrame(frame)
}
/* 兜底：万一还有非我方可控的 scrollTop 变化（测试直写、键盘），也拉回中间那份并同步值 */
function onScroll(colRef, count, setVal) {
  const el = colRef.value
  if (!el || el._anim || el._dragging) return
  const span = spanOf(count)
  const st = el.scrollTop
  if (st < span) el.scrollTop = st + span
  else if (st >= span * 2) el.scrollTop = st - span
  clearTimeout(el._t)
  el._t = setTimeout(() => {
    if (el._anim || el._dragging) return
    setVal(Math.round(el.scrollTop / ROW) % count)
  }, 140)
}
function onScrollHour() {
  onScroll(hourCol, 24, (i) => (hour.value = i))
}
function onScrollMin() {
  onScroll(minCol, 60, (i) => (min.value = i))
}

/* ---------- 触屏自接管：拖动 1:1，松手按速度滑几格 ---------- */
function attachTouch(colRef, count, setVal) {
  const el = colRef.value
  if (!el) return
  const span = spanOf(count)
  let dragging = false
  let axis = '' // '' 未定 / 'y' 纵向（接管）/ 'x' 横向（让出去）
  let startX = 0
  let startY = 0
  let startTop = 0
  let samples = []

  const syncVal = () => setVal(Math.round(el.scrollTop / ROW) % count)

  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return
      cancelAnim(el)
      const t = e.touches[0]
      dragging = true
      axis = ''
      startX = t.clientX
      startY = t.clientY
      startTop = normalizeTop(el.scrollTop, span) // 先把起点拉回中间份，之后按位移累加
      el.scrollTop = startTop
      samples = [{ t: Date.now(), y: startY }]
    },
    { passive: true }
  )

  el.addEventListener(
    'touchmove',
    (e) => {
      if (!dragging) return
      const t = e.touches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (!axis) {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return
        axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x'
        if (axis === 'x') {
          dragging = false // 横向手势让出去（别抢弹层/切页的横滑）
          return
        }
        el._dragging = true
      }
      // 1:1 直写：手指走多少，内容走多少，全程不吸附。
      // 拖动阶段不做 normalizeTop，否则跨越份边界时会瞬移回中间份 → 用户看到闪烁。
      // 松手 / 兜底时才把位置拉回中间份（内容重复且相位一致，视觉上才是无缝）。
      el.scrollTop = startTop - dy
      samples.push({ t: Date.now(), y: t.clientY })
      if (samples.length > 16) samples.shift()
      syncVal() // 高亮实时跟手
    },
    { passive: true }
  )

  const finish = () => {
    if (!dragging) return
    dragging = false
    el._dragging = false
    const v = velocityFromSamples(samples)
    const dir = v > 0 ? 1 : -1
    const steps = flingSteps(v) * dir
    const snapped = Math.round(el.scrollTop / ROW) * ROW
    const target = normalizeTop(snapped + steps * ROW, span)
    const dur = steps ? ANIM_FLING_BASE + Math.abs(steps) * ANIM_FLING_PER_STEP : ANIM_SNAP_MS
    animTo(el, target, dur, () => {
      el.scrollTop = normalizeTop(el.scrollTop, span)
      syncVal()
    })
  }
  el.addEventListener('touchend', finish, { passive: true })
  el.addEventListener('touchcancel', finish, { passive: true })
}

/* 点选：i 是三份中的实际渲染索引，scrollTop = i*ROW 恰是项中心（相位对，不会回吸） */
function pickAt(colRef, i, count, setVal) {
  const el = colRef.value
  if (!el) return
  cancelAnim(el)
  el.scrollTop = i * ROW // 瞬移到吸附点：点一下就走，别慢吞吞（主项目同款）
  setVal(i % count)
}
/* 点选入口必须在 script 里包一层：模板中 ref 会自动解包成元素，
   直接在模板里写 min.value = i 会变成给数字赋值而报错 */
function pickHour(i) {
  pickAt(hourCol, i, 24, (v) => (hour.value = v))
}
function pickMin(i) {
  pickAt(minCol, i, 60, (v) => (min.value = v))
}

/* ---------- 鼠标滚轮接管（主项目 app.js 同款口径；触屏不归这里管） ---------- */
const WHEEL_UNIT = 50 // 滚轮累计到这个像素数才走一格：嫌迟钝调小、嫌太灵敏调大
/* 把各浏览器口径不一的 deltaY 统一成像素（Firefox 默认按「行」给） */
function wheelPixels(e) {
  let d = Number(e.deltaY) || 0
  if (e.deltaMode === 1) d *= 40
  else if (e.deltaMode === 2) d *= 400
  return d
}
/* 一格滚轮 = 走一格。为什么得自己接管：浏览器转一格 ~100px 而一项只有 40px，
   再叠加吸附，一滚就跳 2~3 格还一顿一顿（用户实测反馈）。
   preventDefault 后按「累计到 WHEEL_UNIT 才走一格」来推。
   循环后没有顶/底：位置始终被 normalizeTop 维持在中间份附近，±1 永远不出界。 */
function attachWheel(colRef, count, setVal) {
  const el = colRef.value
  if (!el) return
  const span = spanOf(count)
  el.addEventListener(
    'wheel',
    (e) => {
      const px = wheelPixels(e)
      if (!px) return
      const dir = px > 0 ? 1 : -1
      const idx = Math.round(el.scrollTop / ROW)
      const next = idx + dir
      if (next < 0 || next > count * REPEAT - 1) return // 理论上到不了（normalizeTop 兜底）；真到了不吞
      e.preventDefault() // 关键的一步：不拦就还是系统那 ~100px
      let acc = el._acc || 0
      if (acc && (acc > 0) !== (px > 0)) acc = 0 // 换方向就重新攒
      acc += px
      if (Math.abs(acc) < WHEEL_UNIT) {
        el._acc = acc
        return
      }
      el._acc = 0 // 走一格就清零：一格滚轮 = 一格
      cancelAnim(el)
      el.scrollTop = normalizeTop(next * ROW, span)
      setVal(next % count)
    },
    { passive: false }
  )
}

onMounted(async () => {
  await nextTick()
  // 双 rAF：等弹层 Transition 期间布局真正稳定再定位，防止 scrollTo 被 clamp 到 0
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  // 初始定位到「中间一份」的对应值，上下各留一整份余量
  hourCol.value?.scrollTo({ top: (24 + initH) * ROW })
  minCol.value?.scrollTo({ top: (60 + initM) * ROW })
  attachWheel(hourCol, 24, (v) => (hour.value = v))
  attachWheel(minCol, 60, (v) => (min.value = v))
  attachTouch(hourCol, 24, (v) => (hour.value = v))
  attachTouch(minCol, 60, (v) => (min.value = v))
})
defineExpose({ display })
</script>

<template>
  <div>
    <div class="mb-1 grid grid-cols-2 gap-2">
      <div class="text-center text-[11px] text-ink-dim">时</div>
      <div class="text-center text-[11px] text-ink-dim">分</div>
    </div>
    <!-- relative 只包滚轮区：中心带 top-1/2 才是滚轮正中。
         此前参照含上方 label 行，带子整体偏高约 12px，选中数字显得贴带底 -->
    <div class="relative">
      <!-- 中心选中带 -->
      <div class="pointer-events-none absolute inset-x-2 top-1/2 h-10 -translate-y-1/2 rounded-xl bg-primary-50"></div>
      <div class="grid grid-cols-2 gap-2">
        <div
          ref="hourCol"
          class="wheel"
          @scroll.passive="onScrollHour"
        >
          <div class="h-20 shrink-0"></div>
          <button
            v-for="(h, i) in hours"
            :key="i"
            v-memo="[h === hour]"
            type="button"
            class="flex h-10 w-full shrink-0 cursor-pointer items-center justify-center tabular-nums"
            :class="h === hour ? 'text-xl font-semibold text-primary-600' : 'text-lg text-ink-dim/60'"
            @click="pickHour(i)"
          >
            {{ pad(h) }}
          </button>
          <div class="h-20 shrink-0"></div>
        </div>
        <div
          ref="minCol"
          class="wheel"
          @scroll.passive="onScrollMin"
        >
          <div class="h-20 shrink-0"></div>
          <button
            v-for="(m, i) in minutes"
            :key="i"
            v-memo="[m === min]"
            type="button"
            class="flex h-10 w-full shrink-0 cursor-pointer items-center justify-center tabular-nums"
            :class="m === min ? 'text-xl font-semibold text-primary-600' : 'text-lg text-ink-dim/60'"
            @click="pickMin(i)"
          >
            {{ pad(m) }}
          </button>
          <div class="h-20 shrink-0"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wheel {
  height: 200px;
  overflow-y: auto;
  scrollbar-width: none;
  overscroll-behavior: contain;
  /* 触屏自接管：交给浏览器就等于把「跟手」和「滑多远」都交出去了（见 wheelPhysics.js 顶部注释）。
     touch-action:none 让浏览器不再原生滚动这一列，滚动位置完全由组件的 rAF/手势代码写。
     随之 scroll-snap-type 也去掉——没有原生滚动就没有东西需要吸附，
     留着反而会在 rAF 动画逐帧写 scrollTop 时把位置回吸到吸附点。 */
  touch-action: none;
  /* 上下边缘渐隐：滚动的数字「进出」有层次，接近原生 picker 观感（纯视觉，不影响点击） */
  mask-image: linear-gradient(to bottom, transparent, #000 44px, #000 calc(100% - 44px), transparent);
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 44px, #000 calc(100% - 44px), transparent);
}
.wheel::-webkit-scrollbar {
  display: none;
}
</style>
