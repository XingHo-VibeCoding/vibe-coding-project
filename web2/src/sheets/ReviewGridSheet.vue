<script setup>
/* Stage 9：核对页预览的格子弹层（点空格=加课、点课块=改课；同一面板两态）。 */
import { useApp } from '../composables/app-ctx.js'

const app = useApp()
</script>

<template>
  <!-- 核对页预览的格子弹层：点空格=加课、点课块=改课（同一个面板两态）。
       位置由点中的格子定好，默认只问课名与地点；「位置与节次」要用时才展开 -->
  <Transition name="fade">
    <div v-if="app.recCell" class="fixed inset-0 z-50 bg-black/40" @click="app.recCell = null"></div>
  </Transition>
  <Transition name="slide">
    <div
      v-if="app.recCell"
      data-sheet-cell
      class="fixed inset-x-0 bottom-0 z-[60] mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
    >
      <div class="mx-auto mb-3 h-1 w-9 rounded-full bg-ink/15"></div>
      <p class="text-base font-bold" data-cell-where>{{ app.recCellWhere }}</p>
      <p class="mt-0.5 text-xs text-ink-dim">{{ app.recCell.index === null ? '这一格还没有课，填个课名就加上' : '改完记得保存' }}</p>
      <div class="mt-4 space-y-2.5">
        <input
          v-model="app.recCell.title"
          data-cell-title
          maxlength="30"
          placeholder="课程名称（必填）"
          class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
        />
        <input
          v-model="app.recCell.location"
          data-cell-place
          maxlength="30"
          placeholder="地点（选填）"
          class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
        />
        <button
          type="button"
          data-cell-more
          class="flex w-full items-center justify-between rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-left transition active:scale-[0.99]"
          @click="app.recCell.more = !app.recCell.more"
        >
          <span class="text-xs text-ink-dim">位置与节次</span>
          <span class="flex items-center gap-1.5 text-xs font-medium text-ink">
            {{ app.recCellWhen }}
            <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 text-ink-dim transition-transform" :class="app.recCell.more ? 'rotate-90' : ''" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
          </span>
        </button>
        <div v-if="app.recCell.more" data-cell-more-body class="space-y-2.5 rounded-xl border border-line bg-canvas p-3">
          <div class="flex gap-1.5">
            <button
              v-for="(w, wi) in app.WDN"
              :key="wi"
              class="flex-1 rounded-lg py-1.5 text-[11px] font-medium transition active:scale-95"
              :class="app.recCell.weekday === wi + 1 ? 'bg-primary-500 text-white' : 'bg-ink/5 text-ink-dim'"
              @click="app.recCell.weekday = wi + 1"
            >
              {{ w }}
            </button>
          </div>
          <div class="flex gap-2">
            <label class="flex flex-1 items-center gap-1.5 text-[11px] text-ink-dim">
              从第
              <select v-model.number="app.recCell.startIdx" data-cell-from class="min-w-[3rem] flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                <option v-for="(p, i) in app.recPeriods" :key="i" :value="i">{{ p.no }} 节</option>
              </select>
            </label>
            <label class="flex flex-1 items-center gap-1.5 text-[11px] text-ink-dim">
              到第
              <select v-model.number="app.recCell.endIdx" data-cell-to class="min-w-[3rem] flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                <option v-for="(p, i) in app.recPeriods" :key="i" :value="i">{{ p.no }} 节</option>
              </select>
            </label>
          </div>
          <p class="text-[11px]" :class="app.recCellWhen ? 'text-ink-dim' : 'text-red-600 dark:text-red-400'">
            {{ app.recCellWhen ? '上课时间 ' + app.recCellWhen : '节次超出当前节次表' }}
          </p>
        </div>
      </div>
      <p v-if="app.recCellErr" data-cell-err class="mt-2.5 text-xs text-red-600 dark:text-red-400">{{ app.recCellErr }}</p>
      <div class="mt-4 flex gap-2.5">
        <button
          v-if="app.recCell.index !== null"
          data-cell-del
          class="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 transition active:scale-[0.98]"
          @click="app.delRecCell"
        >
          删除
        </button>
        <button
          class="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
          @click="app.recCell = null"
        >
          取消
        </button>
        <button
          data-cell-save
          class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
          @click="app.submitRecCell"
        >
          {{ app.recCell.index === null ? '添加' : '保存' }}
        </button>
      </div>
    </div>
  </Transition>
</template>
