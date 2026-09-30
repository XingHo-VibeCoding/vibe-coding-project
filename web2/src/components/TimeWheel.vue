<script setup>
// 时间滚轮面板：时/分两列 scroll-snap，滚动或点选；对齐主项目「自建时间面板」口径
import { ref, computed, onMounted, nextTick } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' }, // 'HH:mm' 或 ''
})
const emit = defineEmits(['update:modelValue'])

const ROW = 40 // 每项高度，需与模板样式一致
const init = props.modelValue || '08:00'
const [initH, initM] = init.split(':').map(Number)

const hourCol = ref(null)
const minCol = ref(null)
const hour = ref(initH)
const min = ref(initM)

const hours = Array.from({ length: 24 }, (_, i) => i)
const minutes = Array.from({ length: 60 }, (_, i) => i)
const pad = (n) => String(n).padStart(2, '0')

const display = computed(() => `${pad(hour.value)}:${pad(min.value)}`)

function snap(colRef, count, setVal) {
  const el = colRef.value
  if (!el) return
  const idx = Math.min(count - 1, Math.max(0, Math.round(el.scrollTop / ROW)))
  setVal(idx)
}
function onScrollHour() {
  clearTimeout(hourCol.value?._t)
  hourCol.value._t = setTimeout(() => snap(hourCol, 24, (i) => (hour.value = i)), 140)
}
function onScrollMin() {
  clearTimeout(minCol.value?._t)
  minCol.value._t = setTimeout(() => snap(minCol, 60, (i) => (min.value = i)), 140)
}
function pickAt(colRef, i, setVal) {
  const el = colRef.value
  if (el) el.scrollTop = i * ROW // 瞬移到吸附点：落点正好对齐，系统不会再吸回去（主项目同款，smooth 反而慢吞吞）
  setVal(i)
}
/* 点选入口必须在 script 里包一层：模板中 ref 会自动解包成数字/元素，
   直接在模板里写 min.value = i 会变成给数字赋值而报错 */
function pickHour(i) {
  pickAt(hourCol, i, (v) => (hour.value = v))
}
function pickMin(i) {
  pickAt(minCol, i, (v) => (min.value = v))
}

/* ---------- 鼠标滚轮接管（主项目 app.js 同款口径） ---------- */
const WHEEL_UNIT = 50 // 滚轮累计到这个像素数才走一格：嫌迟钝调小、嫌太灵敏调大
/* 把各浏览器口径不一的 deltaY 统一成像素（Firefox 默认按「行」给） */
function wheelPixels(e) {
  let d = Number(e.deltaY) || 0
  if (e.deltaMode === 1) d *= 40
  else if (e.deltaMode === 2) d *= 400
  return d
}
/* 一格滚轮 = 走一格。为什么得自己接管：浏览器转一格 ~100px 而一项只有 40px，
   再叠加 scroll-snap 强制吸附，一滚就跳 2~3 格还一顿一顿（用户实测反馈）。
   preventDefault 后按「累计到 WHEEL_UNIT 才走一格」来推；触屏不归这里管：
   手指是原生滚动 + 吸附，手感本来就是对的。 */
function attachWheel(colRef, count, setVal) {
  const el = colRef.value
  if (!el) return
  el.addEventListener('wheel', (e) => {
    const px = wheelPixels(e)
    if (!px) return
    const dir = px > 0 ? 1 : -1
    const idx = Math.round(el.scrollTop / ROW)
    const next = idx + dir
    if (next < 0 || next > count - 1) return // 已经到顶/到底：不吞这一下，让外层还能滚
    e.preventDefault() // 关键的一步：不拦就还是系统那 ~100px
    let acc = el._acc || 0
    if (acc && (acc > 0) !== (px > 0)) acc = 0 // 换方向就重新攒
    acc += px
    if (Math.abs(acc) < WHEEL_UNIT) { el._acc = acc; return }
    el._acc = 0 // 走一格就清零：一格滚轮 = 一格
    el.scrollTop = next * ROW
    setVal(next)
  }, { passive: false })
}
onMounted(async () => {
  await nextTick()
  // 双 rAF：等弹层 Transition 期间布局真正稳定再定位，防止 scrollTo 被 clamp 到 0
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  hourCol.value?.scrollTo({ top: initH * ROW })
  minCol.value?.scrollTo({ top: initM * ROW })
  attachWheel(hourCol, 24, (v) => (hour.value = v))
  attachWheel(minCol, 60, (v) => (min.value = v))
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
            v-for="h in hours"
            :key="h"
            type="button"
            class="flex h-10 w-full shrink-0 cursor-pointer items-center justify-center tabular-nums"
            :class="h === hour ? 'text-xl font-semibold text-primary-600' : 'text-lg text-ink-dim/60'"
            @click="pickHour(h)"
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
            v-for="m in minutes"
            :key="m"
            type="button"
            class="flex h-10 w-full shrink-0 cursor-pointer items-center justify-center tabular-nums"
            :class="m === min ? 'text-xl font-semibold text-primary-600' : 'text-lg text-ink-dim/60'"
            @click="pickMin(m)"
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
  scroll-snap-type: y mandatory;
  scrollbar-width: none;
  overscroll-behavior: contain;
  /* 上下边缘渐隐：滚动的数字「进出」有层次，接近原生 picker 观感（纯视觉，不影响点击） */
  mask-image: linear-gradient(to bottom, transparent, #000 44px, #000 calc(100% - 44px), transparent);
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 44px, #000 calc(100% - 44px), transparent);
}
.wheel::-webkit-scrollbar {
  display: none;
}
/* 垫片和数字项都要吸附居中：programmatic scrollTo(i*ROW) 才会正好落在吸附点，
   否则 mandatory 回吸会把位置弹到最近的垫片上，snap() 读到错误 scrollTop。
   不加 scroll-snap-stop:always——它把惯性逐格急刹，阻尼感太重（用户实测）；
   触屏用普通 mandatory 吸附（主项目同款），鼠标滚轮已由 attachWheel 接管 */
.wheel > * {
  scroll-snap-align: center;
}
</style>
