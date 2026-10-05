<script setup>
import { toRefs } from 'vue'
import { useApp } from '../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  source,
  semester,
  lectures,
  listenClips,
  openMeSub,
  openSemEdit,
  todos,
  undoneTodos,
} = toRefs(app)
</script>

<template>
      <!-- Stage 6：这一屏只有「1 行学期 + 4 个入口」——功能都搬进各自的全屏二级页，
           索引页不再随功能增加而变长（设计三原则第一条：与当前任务无关的界面元素绝不出现）。 -->
      <section class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
        <button
          type="button"
          data-me-term
          class="flex w-full items-center gap-3.5 p-4 text-left transition active:bg-soft"
          @click="source === 'import' && openSemEdit()"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium">{{ semester.name }} · 第 {{ semester.week }} 周</span>
            <span class="block text-[11px] text-ink-dim">{{ source === 'import' ? '主项目数据 · 共 ' + semester.totalWeeks + ' 周 · 点这里改学期与节次' : '示例数据不能编辑学期信息' }}</span>
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>
      </section>

      <section class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
        <button type="button" data-me-entry="lectures" data-me-lectures class="flex w-full items-center gap-3.5 p-4 text-left transition active:bg-soft" @click="openMeSub('lectures')">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="1.5" width="4" height="8" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 009 0M8 12v2.5M5.5 14.5h5" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">录音历史</span>
            <span class="block text-[11px] text-ink-dim" data-me-lectures-count>{{ lectures.length ? lectures.length + ' 场 · 转写 / 纪要' : '还没有录音' }}</span>
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>

        <button type="button" data-me-entry="listen" data-me-listen class="flex w-full items-center gap-3.5 p-4 text-left transition active:bg-soft" @click="openMeSub('listen')">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12.5V7a5 5 0 0110 0v5.5" /><path d="M1.5 11.5h2v3h-2zM12.5 11.5h2v3h-2z" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">碎片练耳</span>
            <span class="block text-[11px] text-ink-dim" data-me-listen-count>{{ listenClips.length ? listenClips.length + ' 段音频 · 空档自动提醒' : '还没有导入音频' }}</span>
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>

        <button type="button" data-me-entry="todos" data-me-todos class="flex w-full items-center gap-3.5 p-4 text-left transition active:bg-soft" @click="openMeSub('todos')">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5l1.3 1.3L6.3 3.3M2.5 9l1.3 1.3L6.3 7.8M2.5 13.5l1.3 1.3 2.5-2.5M8.5 5h5M8.5 9.5h5M8.5 14h5" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">待办清单</span>
            <span class="block text-[11px] text-ink-dim" data-me-todos-count>{{ todos.length ? '未完成 ' + undoneTodos.length + ' / 共 ' + todos.length + ' 件' : '还没有待办' }}</span>
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>

        <button type="button" data-me-entry="settings" data-settings-toggle class="flex w-full items-center gap-3.5 p-4 text-left transition active:bg-soft" @click="openMeSub('settings')">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">设置</span>
            <span class="block text-[11px] text-ink-dim">主题外观 · 提醒 · 课堂纪要 · 数据</span>
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>
      </section>
</template>
