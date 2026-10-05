<script setup>
/* Stage 9：添加/编辑面板（长按菜单或双击周网格空白处唤起；同一个面板两态，靠 addForm.kind 分流）。 */
import BottomSheet from '../components/BottomSheet.vue'
import { useApp } from '../composables/app-ctx.js'

const app = useApp()
</script>

<template>
  <!-- 添加/编辑面板：长按菜单或双击周网格空白处唤起；同一个面板两态，靠 addForm.kind 分流 -->
  <BottomSheet
    :open="!!app.addForm"
    sheet-attr="data-sheet-add"
    @close="app.addForm = null"
  >
    <p class="text-base font-bold" data-add-title>{{ app.addForm.editingId ? (app.addForm.kind === 'routine' ? '编辑循环日程' : '编辑课程') : (app.addForm.kind === 'routine' ? '添加循环日程' : '添加课程') }} · {{ app.WDN[app.addForm.weekday - 1] }}</p>
    <div class="mt-4 space-y-3">
      <input
        v-model="app.addForm.name"
        :placeholder="app.addForm.kind === 'routine' ? '日程名称（必填）' : '课程名称（必填）'"
        class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
      />
      <!-- 时间：点哪填哪，左右微调 -->
      <div class="flex items-center gap-2.5">
        <div class="flex flex-1 items-center justify-between rounded-xl border border-line bg-canvas px-2 py-1.5">
          <button class="flex h-8 w-8 items-center justify-center rounded-lg text-ink-dim active:bg-soft-2" @click="app.stepStart(-5)">
            <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5" /></svg>
          </button>
          <span class="text-sm font-semibold tabular-nums" data-add-start>{{ app.addForm.start }}</span>
          <button class="flex h-8 w-8 items-center justify-center rounded-lg text-ink-dim active:bg-soft-2" @click="app.stepStart(5)">
            <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
          </button>
        </div>
        <button
          v-for="d in app.DURATIONS"
          :key="d"
          class="rounded-full px-2.5 py-1.5 text-xs font-medium transition active:scale-95"
          :class="app.addForm.duration === d ? 'bg-primary-500 text-white' : 'bg-soft text-ink-dim'"
          @click="app.addForm.duration = d"
        >
          {{ d }}分
        </button>
      </div>
      <input
        v-model="app.addForm.place"
        placeholder="地点（选填）"
        class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
      />
      <!-- 周次规则：循环日程固定每周，不显示单双周（2026-10-01 用户拍板口径） -->
      <div v-if="app.addForm.kind !== 'routine'" class="flex gap-2">
        <button
          v-for="r in [{ k: 'every', n: '每周' }, { k: 'odd', n: '单周' }, { k: 'even', n: '双周' }]"
          :key="r.k"
          class="flex-1 rounded-xl border py-2 text-xs font-medium transition active:scale-[0.97]"
          :class="app.addForm.week_rule === r.k ? 'border-primary-400 bg-primary-50 text-primary-600' : 'border-line text-ink-dim'"
          @click="app.addForm.week_rule = r.k"
        >
          {{ r.n }}
        </button>
      </div>
      <!-- 编辑导入进来的单/双周循环日程时如实说明：表单不给这个选项，但也不会把它改掉 -->
      <p v-else class="rounded-xl border border-line bg-canvas px-3 py-2 text-xs leading-relaxed text-ink-dim">
        {{ app.addForm.week_rule === 'every'
          ? '循环日程每周重复，不占学期课表。'
          : '这条原本是' + ({ odd: '单周', even: '双周' }[app.addForm.week_rule] || '每周') + '，保存后保持原样（循环日程表单不提供单双周选项）。' }}
      </p>
    </div>
    <p v-if="app.addWarn" class="mt-2.5 rounded-xl border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">{{ app.addWarn }}</p>
    <p v-if="app.addErr" class="mt-2.5 text-xs text-red-600 dark:text-red-400">{{ app.addErr }}</p>
    <div class="mt-4 flex gap-2.5">
      <button
        class="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
        @click="app.addForm = null"
      >
        取消
      </button>
      <button
        class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
        @click="app.submitAdd"
      >
        {{ app.addForm.editingId ? '保存修改' : (app.addForm.kind === 'routine' ? '添加日程' : '添加') }}
      </button>
    </div>
  </BottomSheet>
</template>
