<script setup>
import { toRefs } from 'vue'
import BottomSheet from '../components/BottomSheet.vue'
import { useApp } from '../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  openDateField,
  todoForm,
  todoErr,
  submitTodo,
  confirmDelTodo,
  onDeleteTodo,
} = toRefs(app)
</script>

<template>
    <BottomSheet
      :open="!!todoForm"
      sheet-attr="data-sheet-todo"
      @close="todoForm = null"
    >
      <p class="text-base font-bold">{{ todoForm.id ? '编辑待办' : '添加待办' }}</p>
      <div class="mt-4 space-y-3">
        <input
          v-model="todoForm.title"
          placeholder="要做什么？（必填）"
          class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
        />
        <button
          type="button"
          class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-left text-sm tabular-nums transition active:scale-[0.99]"
          :class="todoForm.due_date ? 'text-ink' : 'text-ink-dim'"
          @click="openDateField({ value: todoForm.due_date, onDone: (v) => (todoForm.due_date = v) })"
        >
          {{ todoForm.due_date || '哪天前做完？（可选）' }}
        </button>
      </div>
      <p v-if="todoErr" class="mt-2.5 text-xs text-red-600 dark:text-red-400">{{ todoErr }}</p>
      <div class="mt-4 flex gap-2.5">
        <button
          v-if="todoForm.id"
          class="rounded-xl border py-2.5 px-4 text-sm font-medium transition active:scale-[0.98]"
          :class="confirmDelTodo ? 'border-red-400 bg-red-400/10 text-red-600 dark:text-red-400' : 'border-red-200 text-red-600 dark:text-red-400'"
          @click="onDeleteTodo"
        >
          {{ confirmDelTodo ? '再点一次确认' : '删除' }}
        </button>
        <button
          class="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
          @click="todoForm = null"
        >
          取消
        </button>
        <button
          class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
          @click="submitTodo"
        >
          {{ todoForm.id ? '保存修改' : '添加' }}
        </button>
      </div>
    </BottomSheet>
</template>
