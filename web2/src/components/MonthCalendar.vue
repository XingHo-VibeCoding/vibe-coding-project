<script setup>
// 月历选日期面板：周一开头；restrictMonday=true 时只有周一可选（学期起始日口径）
import { ref, computed, watch } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' }, // YYYY-MM-DD 或 ''
  restrictMonday: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const today = new Date()
const initVal = props.modelValue ? new Date(props.modelValue + 'T00:00:00') : today
const cal = ref({ y: initVal.getFullYear(), m: initVal.getMonth() })

const WEEK = ['一', '二', '三', '四', '五', '六', '日']
function fmtYMD(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
const cells = computed(() => {
  const { y, m } = cal.value
  const lead = (new Date(y, m, 1).getDay() + 6) % 7 // 周一开头
  const days = new Date(y, m + 1, 0).getDate()
  const list = []
  for (let i = 0; i < lead; i++) list.push(null)
  for (let d = 1; d <= days; d++) {
    const dt = new Date(y, m, d)
    list.push({ d, key: fmtYMD(dt), monday: dt.getDay() === 1, ok: !props.restrictMonday || dt.getDay() === 1 })
  }
  return list
})
const title = computed(() => `${cal.value.y} 年 ${cal.value.m + 1} 月`)
function shift(n) {
  let { y, m } = cal.value
  m += n
  if (m < 0) { m = 11; y-- }
  if (m > 11) { m = 0; y++ }
  cal.value = { y, m }
}
const monthShifted = ref(false)
watch(() => props.modelValue, (v) => {
  if (v && !monthShifted.value) {
    const dt = new Date(v + 'T00:00:00')
    cal.value = { y: dt.getFullYear(), m: dt.getMonth() }
  }
  monthShifted.value = false
})
function pick(c) {
  if (!c || !c.ok) return
  emit('update:modelValue', c.key)
}
</script>

<template>
  <div>
    <div class="mb-2 flex items-center justify-between">
      <button
        class="flex h-9 w-9 items-center justify-center rounded-xl text-ink-dim transition active:bg-ink/10"
        aria-label="上个月"
        @click="shift(-1)"
      >
        <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5" /></svg>
      </button>
      <p class="text-sm font-semibold text-ink">{{ title }}</p>
      <button
        class="flex h-9 w-9 items-center justify-center rounded-xl text-ink-dim transition active:bg-ink/10"
        aria-label="下个月"
        @click="monthShifted = true; shift(1)"
      >
        <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
      </button>
    </div>
    <div class="grid grid-cols-7 gap-1 text-center">
      <span v-for="w in WEEK" :key="w" class="pb-1 text-[11px] text-ink-dim">{{ w }}</span>
      <button
        v-for="(c, i) in cells"
        :key="i"
        type="button"
        :data-cal-day="c ? c.key : ''"
        class="flex h-9 items-center justify-center rounded-xl text-[13px] transition"
        :class="[
          !c ? 'pointer-events-none' : '',
          c && c.ok && c.key === modelValue ? 'bg-primary-500 font-semibold text-white' : '',
          c && c.ok && c.key !== modelValue ? 'text-ink active:bg-ink/10' : '',
          c && !c.ok ? 'text-ink-dim/30' : '',
        ]"
        @click="pick(c)"
      >
        {{ c ? c.d : '' }}
      </button>
    </div>
    <p v-if="restrictMonday" class="mt-2 text-center text-[11px] text-ink-dim">学期从周一开始：只有周一可选</p>
  </div>
</template>
