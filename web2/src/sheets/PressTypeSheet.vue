<script setup>
/* Stage 9：长按空白处弹出的类型菜单（加课程 / 加循环日程）。 */
import BottomSheet from '../components/BottomSheet.vue'
import { useApp } from '../composables/app-ctx.js'

const app = useApp()
</script>

<template>
  <!-- 长按空白处弹出的类型菜单：加课程 / 加循环日程（用户拍板：长按弹菜单、双击直接加课）。
       与下面的表单面板同为 z-20/z-30 层，二者互斥（选完立刻关菜单再开表单）。 -->
  <BottomSheet
    :open="!!app.addPick"
    sheet-attr="data-add-pick"
    mask-attr="data-add-pick-mask"
    @close="app.addPick = null"
  >
    <p class="text-base font-bold">在 {{ app.WDN[app.addPick.wd - 1] }} {{ app.addPick.start }} 添加</p>
    <p class="mt-1 text-xs text-ink-dim">选一个类型</p>
    <div class="mt-4 space-y-2.5">
      <button
        data-pick-course
        class="flex w-full items-center justify-between rounded-xl border border-line bg-canvas px-3.5 py-3 text-left transition active:scale-[0.98]"
        @click="app.pickKind('course')"
      >
        <span class="text-sm font-semibold">课程</span>
        <span class="text-xs text-ink-dim">按周重复 · 计入学期课表</span>
      </button>
      <button
        data-pick-routine
        class="flex w-full items-center justify-between rounded-xl border border-line bg-canvas px-3.5 py-3 text-left transition active:scale-[0.98]"
        @click="app.pickKind('routine')"
      >
        <span class="flex items-center gap-1.5 text-sm font-semibold">
          <!-- 小循环箭头，与周视图卡片上的标记同款，选的时候就认得出 -->
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0" fill="none" stroke="#5b6b8c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.5 8a5.5 5.5 0 0 1 9.3-4M13.5 8a5.5 5.5 0 0 1-9.3 4" />
            <path d="M11.5 1.6v2.6h-2.6M4.5 14.4v-2.6h2.6" />
          </svg>
          循环日程
        </span>
        <span class="text-xs text-ink-dim">每周固定 · 不占课表</span>
      </button>
    </div>
    <button
      data-pick-cancel
      class="mt-3 w-full rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
      @click="app.addPick = null"
    >
      取消
    </button>
  </BottomSheet>
</template>
