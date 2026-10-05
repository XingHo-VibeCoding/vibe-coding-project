<script setup>
/* Stage 9：删除录音场次二次确认（长按触发；不用原生 confirm，样式对齐清除数据弹层）。 */
import { useApp } from '../composables/app-ctx.js'

const app = useApp()
</script>

<template>
  <Transition name="fade">
    <div v-if="app.delLec" class="fixed inset-0 z-40 bg-black/40" @click="app.delLecId = null"></div>
  </Transition>
  <Transition name="slide">
    <div
      v-if="app.delLec"
      class="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
    >
      <div class="mx-auto mb-4 h-1 w-9 rounded-full bg-soft-2"></div>
      <h2 class="text-lg font-bold">删除这场录音？</h2>
      <p class="mt-2 text-xs text-ink-dim">「{{ app.delLec.title }}」及其录音文件、文字稿和纪要将一并删除，无法恢复。</p>
      <div class="mt-5 grid grid-cols-2 gap-2.5">
        <button
          class="rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
          @click="app.delLecId = null"
        >
          取消
        </button>
        <button
          class="rounded-xl border border-red-400 bg-red-400/10 py-2.5 text-sm font-medium text-red-600 dark:text-red-400 transition active:scale-[0.98]"
          @click="app.doDeleteLecture"
        >
          删除
        </button>
      </div>
    </div>
  </Transition>
</template>
