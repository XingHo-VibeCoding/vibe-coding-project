<script setup>
import { toRefs } from 'vue'
import BottomSheet from '../components/BottomSheet.vue'
import { useApp } from '../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  openDateField,
  openTimeField,
  evtForm,
  evtErr,
  evtWarn,
  submitEvent,
  DURATIONS,
} = toRefs(app)
</script>

<template>
    <BottomSheet
      :open="!!evtForm"
      sheet-attr="data-sheet-evt"
      @close="evtForm = null"
    >
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
            :class="evtForm.date ? 'text-ink' : 'text-ink-dim'"
            @click="openDateField({ value: evtForm.date, onDone: (v) => (evtForm.date = v) })"
          >
            {{ evtForm.date || '日期' }}
          </button>
          <button
            type="button"
            class="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2.5 text-left text-sm tabular-nums transition active:scale-[0.99]"
            :class="evtForm.start ? 'text-ink' : 'text-ink-dim'"
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
      <p v-if="evtWarn" class="mt-2.5 rounded-xl border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">{{ evtWarn }}</p>
      <p v-if="evtErr" class="mt-2.5 text-xs text-red-600 dark:text-red-400">{{ evtErr }}</p>
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
    </BottomSheet>
</template>
