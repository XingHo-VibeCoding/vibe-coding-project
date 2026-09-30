<script setup>
// 单列数字滚轮：总周数 / 单节时长 / 课间时长共用（口径同 TimeWheel 的滚轮手感三定律）
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 99 },
  step: { type: Number, default: 1 },
  unit: { type: String, default: '' }, // 选中行后缀，如「周」「分钟」
})
const emit = defineEmits(['update:modelValue'])

const ROW = 40 // 每项高度，需与样式一致
const values = computed(() => {
  const out = []
  for (let v = props.min; v <= props.max; v += props.step) out.push(v)
  return out
})
const count = computed(() => values.value.length)

const col = ref(null)
const value = ref(props.modelValue)
const idx = computed(() => Math.max(0, values.value.indexOf(value.value)))

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
  if (el) el.scrollTop = i * ROW // 瞬移到吸附点：落点恰对齐，系统不会再吸回去（TimeWheel 同款）
  setValue(values.value[i])
}
const pick = (v) => pickAt(values.value.indexOf(v))

/* ---------- 鼠标滚轮接管（TimeWheel 同款口径） ---------- */
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
  if (Math.abs(acc) < WHEEL_UNIT) { el._acc = acc; return }
  el._acc = 0
  el.scrollTop = next * ROW
  setValue(values.value[next])
}
let scrollTimer = null
function onScroll() {
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
  scroll-snap-type: y mandatory;
  scrollbar-width: none;
  overscroll-behavior: contain;
  mask-image: linear-gradient(to bottom, transparent, #000 44px, #000 calc(100% - 44px), transparent);
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 44px, #000 calc(100% - 44px), transparent);
}
.wheel::-webkit-scrollbar {
  display: none;
}
.wheel > * {
  scroll-snap-align: center;
}
</style>
