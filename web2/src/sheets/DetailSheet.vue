<script setup>
/* Stage 9：课程详情浮层（点课卡/循环日程弹出）。 */
import { useApp } from '../composables/app-ctx.js'
import BottomSheet from '../components/BottomSheet.vue'
/* minOf 是 data/store.js 的模块函数（不是 App 的顶层绑定，进不了 APP_CTX），
   原来在 App.vue 里靠 <script setup> 作用域直接给模板用，搬进子组件要自己引一次。 */
import { minOf } from '../data/store.js'

const app = useApp()
</script>

<template>
  <!-- 课程详情弹层：点课卡弹出 -->
  <BottomSheet
    :open="!!app.detail"
    sheet-attr="data-sheet-detail"
    handle-class="mx-auto mb-4 h-1 w-9 rounded-full bg-ink/15"
    @close="app.detail = null"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <!-- 循环日程在详情里也挂同一枚小循环标记 + 一行类型说明（点开也能确认这不是课） -->
        <p class="flex items-center gap-1.5 text-lg font-bold">
          <svg
            v-if="app.isRoutine(app.detail)"
            data-routine-mark
            viewBox="0 0 16 16"
            aria-hidden="true"
            class="h-4 w-4 shrink-0 text-ink-dim"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M13 8a5 5 0 11-1.9-3.9" />
            <path d="M13 2.2V5h-2.8" />
          </svg>
          <span class="truncate">{{ app.detail.name }}</span>
        </p>
        <p class="mt-1 text-xs text-ink-dim">
          <span v-if="app.isRoutine(app.detail)" class="mr-1">循环日程 ·</span>
          {{ app.detail.type === 'event' ? app.detail.date : app.WDN[(app.detail.weekday || 1) - 1] }}
          <span v-if="app.detail.tag" class="ml-1.5 rounded-full bg-primary-50 px-2 py-0.5 text-primary-600">{{ app.detail.tag }}</span>
        </p>
      </div>
      <button
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink/5 text-ink-dim transition active:scale-90"
        @click="app.detail = null"
      >
        <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
      </button>
    </div>
    <div class="mt-4 space-y-2.5">
      <div class="flex items-center gap-3 rounded-xl bg-primary-50/60 px-3.5 py-3">
        <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 shrink-0 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></svg>
        <div class="min-w-0">
          <p class="text-sm font-medium">{{ app.detail.start }} – {{ app.detail.end }}</p>
          <p class="text-[11px] text-ink-dim">
            共 {{ minOf(app.detail.end) - minOf(app.detail.start) }} 分钟
            <span v-if="app.periodSpan(app.detail)" class="ml-1 rounded-full bg-primary-500/10 px-1.5 py-0.5 text-primary-600">{{ app.periodSpan(app.detail) }}</span>
          </p>
        </div>
      </div>
      <div class="flex items-center gap-3 rounded-xl bg-ink/[0.04] px-3.5 py-3">
        <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 shrink-0 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.5L8 2l6 4.5V14a.5.5 0 01-.5.5h-11A.5.5 0 012 14z" /><path d="M6 14.5V9h4v5.5" /></svg>
        <div class="min-w-0">
          <p class="text-sm font-medium">{{ app.detail.place || '未填写地点' }}</p>
          <p class="text-[11px] text-ink-dim">地点</p>
        </div>
      </div>
    </div>
    <!-- 所有课程都可编辑/删除：自加课改覆盖层，导入课改原始导出文本（随回写带回主项目），mock 课改示例覆盖层 -->
    <div v-if="app.detail.type === 'course'" class="mt-4 grid grid-cols-2 gap-2.5">
      <button
        class="rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
        @click="app.editCourseFromDetail"
      >
        编辑
      </button>
      <button
        class="rounded-xl border py-2.5 text-sm font-medium transition active:scale-[0.98]"
        :class="app.confirmDel ? 'border-red-400 bg-red-400/10 text-red-600 dark:text-red-400' : 'border-red-200 text-red-600 dark:text-red-400'"
        @click="app.onDelCourse"
      >
        {{ app.confirmDel ? '再点一次确认' : '删除' }}
      </button>
    </div>
    <!-- 循环日程：编辑与删除，版式与课程一致；二次确认共用同一个 confirmDel -->
    <div v-else-if="app.detail.type === 'routine'" class="mt-4 grid grid-cols-2 gap-2.5">
      <button
        data-routine-edit
        class="rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
        @click="app.editRoutineFromDetail"
      >
        编辑
      </button>
      <button
        data-routine-del
        class="rounded-xl border py-2.5 text-sm font-medium transition active:scale-[0.98]"
        :class="app.confirmDel ? 'border-red-400 bg-red-400/10 text-red-600 dark:text-red-400' : 'border-red-200 text-red-600 dark:text-red-400'"
        @click="app.onDelRoutine"
      >
        {{ app.confirmDel ? '再点一次确认' : '删除' }}
      </button>
    </div>
  </BottomSheet>
</template>
