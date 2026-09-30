<script setup>
// 单列数字滚轮：总周数 / 单节时长 / 课间时长共用
// 手感口径与 TimeWheel **完全同源**（物理纯函数见 src/data/wheelPhysics.js 顶部注释）：
//   拖动 1:1 直写 scrollTop、松手按速度换算格数、自己写 rAF 短缓动吸附、动画时长由速度反推。
// 与 TimeWheel 的唯一差别：本组件**不循环**（值域是 min..max），所以
//   · 松手目标与拖动位置都要夹在 [0, (count-1)*ROW] 之间；
//   · 用不上 normalizeTop / 三份重复那套（没有跨份边界，也就没有归位问题）。
// 2026-09-30（Day 15 收尾遗留项）：从「原生滚动 + scroll-snap mandatory」改为自接管。
//   原生那套在 TimeWheel 上已被实测否掉（慢速档跟手比只剩 0.56~0.80 = 拖沓、
//   循环后原生惯性无上限 = 太快），两个滚轮不能两种手感；回归见 tmp/numberwheel-touch-check.mjs
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { flingSteps, flingDuration, velocityFromSamples, easeOutCubic } from '../data/wheelPhysics.js'

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 99 },
  step: { type: Number, default: 1 },
  unit: { type: String, default: '' }, // 选中行后缀，如「周」「分钟」
})
const emit = defineEmits(['update:modelValue'])

const ROW = 40 // 每项高度，需与样式一致
const ANIM_SNAP_MS = 150 // 松手只吸附（没甩起来）的时长；甩动时长由松手速度反推
const AXIS_LOCK_PX = 8 // 手指移动超过它才判方向（避免轻微抖动被当成横向手势）

const values = computed(() => {
  const out = []
  for (let v = props.min; v <= props.max; v += props.step) out.push(v)
  return out
})
const count = computed(() => values.value.length)

const col = ref(null)
const value = ref(props.modelValue)
const idx = computed(() => Math.max(0, values.value.indexOf(value.value)))

/* 可滚范围：上下各留 80px 撑位（h-20）让首/尾项也能停在选中带正中，
   所以最大 scrollTop = (count-1)*ROW，而不是 scrollHeight-clientHeight 那套。 */
const maxTop = () => Math.max(0, (count.value - 1) * ROW)
const clampTop = (t) => Math.min(maxTop(), Math.max(0, t))

/* ---------- 位置动画（自己写 rAF；scrollTo smooth 又慢又会被吸附回吸） ---------- */
function cancelAnim(el) {
  if (!el) return
  if (el._raf) cancelAnimationFrame(el._raf)
  el._raf = 0
  el._anim = false
}
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
    done && done() // 回调里仍处于 _anim，避免 scroll 兜底插一脚
    el._anim = false
  }
  el._raf = requestAnimationFrame(frame)
}

function snap() {
  const el = col.value
  if (!el || !count.value) return
  const i = Math.min(count.value - 1, Math.max(0, Math.round(el.scrollTop / ROW)))
  setValue(values.value[i])
}
function setValue(v) {
  if (v === value.value) return
  value.value = v
  emit('update:modelValue', v)
}
function pickAt(i) {
  const el = col.value
  if (!el) return
  cancelAnim(el)
  el.scrollTop = i * ROW // 瞬移到吸附点：落点恰对齐，系统不会再吸回去（TimeWheel 同款）
  setValue(values.value[i])
}
const pick = (v) => pickAt(values.value.indexOf(v))

/* ---------- 鼠标滚轮接管（TimeWheel 同款口径；触屏不归这里管） ---------- */
const WHEEL_UNIT = 50
function wheelPixels(e) {
  let d = Number(e.deltaY) || 0
  if (e.deltaMode === 1) d *= 40
  else if (e.deltaMode === 2) d *= 400
  return d
}
function onWheel(e) {
  const el = col.value
  if (!el) return
  const px = wheelPixels(e)
  if (!px) return
  const dir = px > 0 ? 1 : -1
  const i = Math.round(el.scrollTop / ROW)
  const next = i + dir
  if (next < 0 || next > count.value - 1) return
  e.preventDefault()
  let acc = el._acc || 0
  if (acc && (acc > 0) !== (px > 0)) acc = 0
  acc += px
  if (Math.abs(acc) < WHEEL_UNIT) {
    el._acc = acc
    return
  }
  el._acc = 0
  cancelAnim(el)
  el.scrollTop = next * ROW
  setValue(values.value[next])
}

/* ---------- 触屏自接管：拖动 1:1，松手按速度滑几格（首尾夹紧） ---------- */
function attachTouch() {
  const el = col.value
  if (!el) return
  let dragging = false
  let axis = '' // '' 未定 / 'y' 纵向（接管）/ 'x' 横向（让出去）
  let startX = 0
  let startY = 0
  let startTop = 0
  let samples = []

  const syncVal = () => {
    const i = Math.min(count.value - 1, Math.max(0, Math.round(el.scrollTop / ROW)))
    setValue(values.value[i])
  }

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
      startTop = el.scrollTop
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
      // 1:1 直写：手指走多少内容走多少，全程不吸附（吸附只在松手后那一下）。
      // 非循环，所以越界直接夹在首尾——手指还在动但内容停住 = 正常的「到头了」反馈。
      el.scrollTop = clampTop(startTop - dy)
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
    const steps = flingSteps(v) * (v > 0 ? 1 : -1)
    const snapped = Math.round(el.scrollTop / ROW) * ROW
    const target = clampTop(snapped + steps * ROW)
    /* 时长按**实际**位移反推，而不是 steps*ROW：被首尾夹住时实际位移更小，
       若仍按原格数算时长，动画首帧速度会虚高（松手处反而窜一下）。
       数学上等价于「动画首帧速度 = 手指末速」，见 wheelPhysics.flingDuration */
    const dist = target - snapped
    const dur = dist ? flingDuration(dist, v) * 1000 : ANIM_SNAP_MS
    animTo(el, target, dur, syncVal)
  }
  el.addEventListener('touchend', finish, { passive: true })
  el.addEventListener('touchcancel', finish, { passive: true })
}

let scrollTimer = null
function onScroll() {
  const el = col.value
  if (el && (el._anim || el._dragging)) return // 自家动画/拖动期间不插手
  clearTimeout(scrollTimer)
  scrollTimer = setTimeout(snap, 140)
}
onMounted(async () => {
  await nextTick()
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const el = col.value
  if (el) {
    el.scrollTop = idx.value * ROW
    el.addEventListener('wheel', onWheel, { passive: false })
    attachTouch()
  }
})
onBeforeUnmount(() => {
  clearTimeout(scrollTimer)
  col.value && col.value.removeEventListener('wheel', onWheel)
})
defineExpose({ value })
</script>

<template>
  <div class="relative">
    <div class="pointer-events-none absolute inset-x-2 top-1/2 h-10 -translate-y-1/2 rounded-xl bg-primary-50"></div>
    <div ref="col" class="wheel" @scroll.passive="onScroll">
      <div class="h-20 shrink-0"></div>
      <button
        v-for="v in values"
        :key="v"
        type="button"
        :data-wheel-val="v"
        class="flex h-10 w-full shrink-0 cursor-pointer items-center justify-center gap-1 tabular-nums"
        :class="v === value ? 'text-xl font-semibold text-primary-600' : 'text-lg text-ink-dim/60'"
        @click="pick(v)"
      >
        {{ v }}<span v-if="unit" class="text-xs font-normal text-ink-dim">{{ unit }}</span>
      </button>
      <div class="h-20 shrink-0"></div>
    </div>
  </div>
</template>

<style scoped>
.wheel {
  height: 200px;
  overflow-y: auto;
  scrollbar-width: none;
  overscroll-behavior: contain;
  /* 触屏自接管（与 TimeWheel 同口径，理由见 wheelPhysics.js 顶部）：
     touch-action:none 让浏览器不再原生滚动这一列，滚动位置完全由组件的手势/rAF 代码写；
     scroll-snap-type 随之删掉——没有原生滚动就没有东西需要吸附，
     留着反而会在 rAF 逐帧写 scrollTop 时把位置回吸到吸附点。 */
  touch-action: none;
  mask-image: linear-gradient(to bottom, transparent, #000 44px, #000 calc(100% - 44px), transparent);
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 44px, #000 calc(100% - 44px), transparent);
}
.wheel::-webkit-scrollbar {
  display: none;
}
</style>
