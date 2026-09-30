<script setup>
// 分段式节次表编辑器：「引导页 · 自己填课表」与「我的 · 学期信息」两处共用。
// 一天里的课间不是一个数（小课间/大课间/午休/晚休混在一起），所以按「相邻间隔 > 15 分钟」
// 自动分段：段头改「每节时长 / 课间」只重排本段，大空档原样保留；段与段之间可一键「并入上一段」。
// 时间选择沿用 App 的自建面板：通过 openTime 回调传入，组件自己不造面板（口径统一）。
import { ref, computed, watch } from 'vue'
import {
  segmentView, inferSegAssist, reperiodSegment, shiftWithinSegment, addPeriodToSegment,
  removePeriodAt, mergeSegmentUp, resyncSegs, timeToMin,
} from '../data/periods.js'

const props = defineProps({
  modelValue: { type: Array, default: () => [] }, // [{ no, start, end, seg? }]
  openTime: { type: Function, default: null }, // (opt) => 打开自建时间面板
  fallback: { type: Array, default: () => [] }, // 全删后「恢复默认」用的表
  emptyHint: { type: String, default: '' }, // 全删后的说明文案
})
const emit = defineEmits(['update:modelValue', 'error'])

const list = ref([])
const assists = ref({}) // { [seg]: { dur, gap } } 段级辅助输入（不落盘，按现有表反推默认值）
let prevStart = '' // 改某节开始时间前的旧值（段内平移需要）

const groups = computed(() => segmentView(list.value))

watch(
  () => props.modelValue,
  (v) => {
    const next = (Array.isArray(v) ? v : []).map((p) => ({ ...p }))
    if (JSON.stringify(next) === JSON.stringify(list.value)) return
    list.value = next
  },
  { immediate: true }
)
/* 段结构变化时为每个段补默认辅助值；已有的段保留用户输入（不被打断） */
watch(
  groups,
  (gs) => {
    const out = {}
    for (const g of gs) out[g.seg] = assists.value[g.seg] || inferSegAssist(list.value, g.seg)
    assists.value = out
  },
  { immediate: true }
)

function assistOf(seg) {
  return assists.value[seg] || { dur: 45, gap: 10 }
}
function push() {
  emit('update:modelValue', list.value.map((p) => ({ ...p })))
}
function fail(reason) {
  if (reason === 'overlap') emit('error', '这一段放不下：会挤进下一段的第一节。先把本段的时长 / 课间调小，或改下一段的开始时间')
  else if (reason === 'midnight') emit('error', '按这样排会超出一天，节次表请排进同一天之内')
  else emit('error', '')
}

/* 段级「每节时长 / 课间」改动 → 只重排本段 */
function onAssist(seg) {
  const a = assistOf(seg)
  const d = Number(a.dur)
  const gp = Number(a.gap)
  if (!(d >= 10 && d <= 180) || !(gp >= 0 && gp <= 120)) return // 中途输入态不动表
  const r = reperiodSegment(list.value, seg, { dur: d, gap: gp })
  if (!r.ok) {
    fail(r.reason)
    return
  }
  list.value = r.periods
  emit('error', '')
  push()
}
/* 改某节开始时间 → 段内其后各节整体顺移（段外不动） */
function pickStart(g, idx, p) {
  if (!props.openTime) return
  prevStart = p.start
  props.openTime({
    value: p.start,
    onDone: (v) => {
      const r = shiftWithinSegment(list.value, g.seg, idx, v, assistOf(g.seg).dur, prevStart)
      if (!r.ok) {
        fail(r.reason)
        return
      }
      list.value = resyncSegs(r.periods)
      emit('error', '')
      push()
    },
  })
}
/* 改某节结束时间 → 只动这一节；改出大空档时同步裂开分段 */
function pickEnd(idx, p) {
  if (!props.openTime) return
  props.openTime({
    value: p.end,
    onDone: (v) => {
      if (timeToMin(v) <= timeToMin(p.start)) {
        emit('error', `第 ${p.no} 节的结束时间要晚于开始时间`)
        return
      }
      const next = list.value.map((x, i) => (i === idx ? { ...x, end: v } : { ...x }))
      list.value = resyncSegs(next)
      emit('error', '')
      push()
    },
  })
}
function addOne(seg) {
  const r = addPeriodToSegment(list.value, seg, assistOf(seg))
  if (!r.ok) {
    fail(r.reason)
    return
  }
  list.value = r.periods
  emit('error', '')
  push()
}
function removeOne(idx) {
  list.value = removePeriodAt(list.value, idx)
  emit('error', '')
  push()
}
function mergeUp(seg) {
  list.value = mergeSegmentUp(list.value, seg)
  emit('error', '')
  push()
}
function restore() {
  list.value = props.fallback.map((p) => ({ ...p }))
  emit('error', '')
  push()
}

function gapLabel(g) {
  const prev = list.value[g.from - 1]
  const m = g.gapBefore
  let d = ''
  if (m !== null && m >= 0) {
    d = m >= 60 ? `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分钟` : ''}` : `${m} 分钟`
  }
  return `空档 ${prev ? prev.end : ''}–${g.start}${d ? `（${d}）` : ''}`
}
defineExpose({ groups })
</script>

<template>
  <div>
    <div v-for="g in groups" :key="g.seg" :data-seg="g.seg">
      <!-- 与上一段之间的大空档（午休/晚休）：可一键并入上一段 -->
      <div v-if="g.seg > 1" class="my-3 flex items-center gap-2">
        <span class="h-px flex-1 bg-line"></span>
        <span class="shrink-0 text-[11px] text-ink-dim">{{ gapLabel(g) }}</span>
        <button
          type="button"
          :data-seg-merge="g.seg"
          class="shrink-0 rounded-full border border-line px-2 py-1 text-[11px] text-ink-dim transition active:scale-95"
          @click="mergeUp(g.seg)"
        >
          并入上一段
        </button>
        <span class="h-px flex-1 bg-line"></span>
      </div>

      <div class="rounded-xl border border-line bg-ink/[0.02] p-2.5">
        <div class="flex items-baseline justify-between">
          <span class="text-xs font-semibold">
            第 {{ g.nos[0] }}<template v-if="g.nos.length > 1">–{{ g.nos[g.nos.length - 1] }}</template> 节
          </span>
          <span class="text-[11px] tabular-nums text-ink-dim">{{ g.start }}–{{ g.end }}</span>
        </div>
        <div class="mt-2 flex items-center gap-3">
          <label class="flex items-center gap-1.5 text-xs text-ink-dim">
            每节
            <input
              v-model.number="assistOf(g.seg).dur"
              :data-seg-dur="g.seg"
              type="number"
              min="10"
              max="180"
              step="5"
              class="w-14 rounded-lg border border-line bg-canvas px-2 py-1 text-sm tabular-nums outline-none focus:border-primary-400"
              @input="onAssist(g.seg)"
            />
            分
          </label>
          <label class="flex items-center gap-1.5 text-xs text-ink-dim">
            课间
            <input
              v-model.number="assistOf(g.seg).gap"
              :data-seg-gap="g.seg"
              type="number"
              min="0"
              max="120"
              step="5"
              class="w-14 rounded-lg border border-line bg-canvas px-2 py-1 text-sm tabular-nums outline-none focus:border-primary-400"
              @input="onAssist(g.seg)"
            />
            分
          </label>
        </div>
        <div class="mt-2 space-y-2">
          <div v-for="(p, i) in list.slice(g.from, g.to + 1)" :key="p.no" :data-period="p.no" class="flex items-center gap-2">
            <span class="w-9 shrink-0 text-xs font-semibold text-ink-dim">第{{ p.no }}节</span>
            <button
              type="button"
              class="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-2 py-2 text-center text-sm tabular-nums transition active:scale-[0.98]"
              @click="pickStart(g, g.from + i, p)"
            >
              {{ p.start }}
            </button>
            <span class="shrink-0 text-xs text-ink-dim">–</span>
            <button
              type="button"
              class="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-2 py-2 text-center text-sm tabular-nums transition active:scale-[0.98]"
              @click="pickEnd(g.from + i, p)"
            >
              {{ p.end }}
            </button>
            <button
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-red-300 transition active:scale-90"
              :aria-label="'删除第 ' + p.no + ' 节'"
              @click="removeOne(g.from + i)"
            >
              <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5h10M6.5 5V3.5h3V5M5 5l.6 8h4.8L11 5" /></svg>
            </button>
          </div>
        </div>
        <button
          v-if="list.length < 15"
          type="button"
          :data-seg-add="g.seg"
          class="mt-2.5 w-full rounded-xl border border-dashed border-line py-2 text-xs font-medium text-ink-dim transition active:scale-[0.98]"
          @click="addOne(g.seg)"
        >
          ＋ 加一节
        </button>
      </div>
    </div>

    <button
      v-if="!list.length && fallback.length"
      type="button"
      data-periods-restore
      class="mt-2.5 w-full rounded-xl border border-dashed border-primary-300 py-2 text-xs font-medium text-primary-600 transition active:scale-[0.98]"
      @click="restore"
    >
      恢复默认 {{ fallback.length }} 节
    </button>
    <p v-if="!list.length && emptyHint" class="mt-1.5 text-[11px] text-ink-dim">{{ emptyHint }}</p>
  </div>
</template>
