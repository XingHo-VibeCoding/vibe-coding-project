<script setup>
/* Stage 9：清除数据二次确认（自建弹窗，不用原生 confirm；对齐主项目 confirmResetModal）。 */
import { useApp } from '../composables/app-ctx.js'

const app = useApp()
</script>

<template>
  <Transition name="fade">
    <div v-if="app.confirmClear" class="fixed inset-0 z-40 bg-black/40" @click="app.confirmClear = false"></div>
  </Transition>
  <Transition name="slide">
    <div
      v-if="app.confirmClear"
      class="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
    >
      <div class="mx-auto mb-4 h-1 w-9 rounded-full bg-soft-2"></div>
      <h2 class="text-lg font-bold">确认清除全部数据</h2>
      <p class="mt-2 text-xs text-ink-dim">将清空学期、课程、日程与待办并回到初始设定，无法恢复。API Key、主题与通知设置会保留。</p>
      <div class="mt-5 grid grid-cols-2 gap-2.5">
        <button
          class="rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
          @click="app.confirmClear = false"
        >
          取消
        </button>
        <button
          data-clear-confirm
          class="rounded-xl border border-red-400 bg-red-400/10 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 transition active:scale-[0.98]"
          @click="app.doClearData"
        >
          确认清除
        </button>
      </div>
    </div>
  </Transition>
</template>
