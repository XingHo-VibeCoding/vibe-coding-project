<script setup>
import { toRefs } from 'vue'
import PeriodsEditor from '../components/PeriodsEditor.vue'
import BottomSheet from '../components/BottomSheet.vue'
import { useApp } from '../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  openDateField,
  openTimeField,
  semForm,
  semErr,
  DEFAULT_PERIODS,
  saveSemEdit,
} = toRefs(app)
</script>

<template>
    <BottomSheet
      :open="!!semForm"
      sheet-attr="data-sheet-sem"
      @close="semForm = null"
    >
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
            :class="semForm.first_monday ? 'text-ink' : 'text-ink-dim'"
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

      <p v-if="semErr" class="mt-3 text-xs text-red-600 dark:text-red-400">{{ semErr }}</p>
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
    </BottomSheet>
</template>
