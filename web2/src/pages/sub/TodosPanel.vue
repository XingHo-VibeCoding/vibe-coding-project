<script setup>
import { toRefs } from 'vue'
import { useApp } from '../../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  todos,
  toggleTodo,
  openTodoAdd,
  openTodoEdit,
  undoneTodos,
  doneTodos,
} = toRefs(app)
</script>

<template>
          <p data-todos-count class="px-1 text-[11px] text-ink-dim">
            未完成 {{ undoneTodos.length }} 件 · 已完成 {{ doneTodos.length }} 件
          </p>

          <section v-if="undoneTodos.length" class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
            <div v-for="t in undoneTodos" :key="t.id" class="flex items-center gap-3 px-3.5 py-2.5">
              <button
                type="button"
                class="-m-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-ink-dim/40 transition active:scale-90"
                aria-label="标记为完成"
                :data-todo-all-check="t.id"
                @click="toggleTodo(t.id)"
              />
              <span class="min-w-0 flex-1 truncate text-sm" @click.stop="openTodoEdit(t)">{{ t.title }}</span>
              <span class="shrink-0 text-[11px] text-primary-600">{{ t.due }}</span>
            </div>
          </section>
          <p v-else class="rounded-2xl border border-dashed border-line bg-card/60 p-6 text-center text-sm text-ink-dim">
            没有未完成的待办，轻松自在～
          </p>

          <section v-if="doneTodos.length" class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
            <div v-for="t in doneTodos" :key="t.id" class="flex items-center gap-3 px-3.5 py-2.5">
              <button
                type="button"
                class="-m-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-primary-500 bg-primary-500 transition active:scale-90"
                aria-label="标记为未完成"
                :data-todo-all-check="t.id"
                @click="toggleTodo(t.id)"
              >
                <svg viewBox="0 0 16 16" class="h-3 w-3 text-white" fill="none">
                  <path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <span class="min-w-0 flex-1 truncate text-sm text-ink-dim line-through" @click.stop="openTodoEdit(t)">{{ t.title }}</span>
              <span class="shrink-0 text-[11px] text-ink-dim">{{ t.due }}</span>
            </div>
          </section>

          <button
            class="mt-2 flex w-full items-center justify-center rounded-2xl border border-dashed border-line bg-card/60 py-3 text-sm font-medium text-ink-dim transition active:bg-ink/5"
            @click="openTodoAdd"
          >
            ＋ 添加待办
          </button>
</template>
