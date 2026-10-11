<script setup>
import { toRefs } from 'vue'
import { useApp } from '../../../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  APP_VERSION,
  addedDupCount,
  dedupCourses,
  confirmClear,
} = toRefs(app)
</script>

<template>
      <!-- 系统与关于（2026-10-12 大扫除）：
           改前「清除数据并重置」这个危险动作夹在「课堂纪要」和「后台录音说明」中间，
           点开设置一路往下滚就可能误触。现在它和「清理重复课程」「关于」一起收在这一页，
           且排在上面两类正常项之后 —— 危险动作永远在最后。 -->
      <section class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
        <!-- 数据清理：多次导入叠加的重复课程（有重复才显示，干净的数据不摆这个入口） -->
        <div v-if="addedDupCount" data-dedup-entry class="flex items-center gap-3.5 p-4">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-amber-700 dark:text-amber-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6l-1.6 7.2a1.5 1.5 0 01-1.5 1.3H4.6a1.5 1.5 0 01-1.5-1.3L1.5 6M6 6V4a2 2 0 012-2h0a2 2 0 012 2v2M14 6H2" /></svg>
          </span>
          <div class="flex-1">
            <span class="block text-sm font-medium">清理重复课程</span>
            <span class="block text-[11px] text-ink-dim">检测到 {{ addedDupCount }} 门重复（多次导入叠加），一键删掉多余的</span>
          </div>
          <button
            class="rounded-full bg-soft px-3 py-1.5 text-xs font-medium transition active:scale-95"
            @click="dedupCourses"
          >一键清理</button>
        </div>

        <!-- 关于 -->
        <div class="flex items-center gap-3.5 p-4">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8a3 3 0 100-6 3 3 0 000 6zM2 14c0-2.5 2.5-4 6-4s6 1.5 6 4" /></svg>
          </span>
          <span class="flex-1 text-sm font-medium">关于</span>
          <span class="text-xs text-ink-dim" data-app-version>{{ APP_VERSION }}</span>
        </div>

        <!-- 清除数据并重置（危险项：二次确认后回到初始设定，无法恢复） -->
        <button
          data-clear-entry
          class="flex w-full items-center gap-3.5 p-4 text-left active:bg-soft"
          @click="confirmClear = true"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-red-400/10">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6.5 2.5h3M4 4.5l.6 9a1 1 0 001 .9h4.8a1 1 0 001-.9l.6-9M6.8 7.5v4M9.2 7.5v4" /></svg>
          </span>
          <span class="flex-1">
            <span class="block text-sm font-medium text-red-600 dark:text-red-400">清除数据并重置</span>
            <span class="block text-[11px] text-ink-dim">想从头开始（换学期 / 重测）用它，无法恢复</span>
          </span>
        </button>
      </section>
</template>
