<script setup>
/* 自建下拉选择（替代原生 <select>）：App WebView 里原生 select 会弹系统级
   选择器，样式与页面完全脱节。这里触发器沿用设置区输入框的圆角描边风格，
   面板带展开/收起动效，选中项打勾。注意调用方处在 translateX 平移层里
   （transform 会把 fixed 变成相对平移层定位），所以面板用 absolute 随文档流走。 */
import { ref, computed, onBeforeUnmount } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  options: { type: Array, default: () => [] }, // [{ id, label }]
  placeholder: { type: String, default: '未选择' },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const root = ref(null)
const dropUp = ref(false) // 触发器太靠下时朝上弹

const current = computed(() => {
  const hit = props.options.find((o) => o.id === props.modelValue)
  return hit ? hit.label : ''
})

function toggle() {
  if (open.value) return close()
  const el = root.value
  if (el) {
    const r = el.getBoundingClientRect()
    // 估算面板高度（每行约 42px，上限 max-h-60）+ 底部导航留白：放不下就朝上
    const need = Math.min(props.options.length * 42 + 14, 240) + 72
    dropUp.value = r.bottom + need > window.innerHeight && r.top - need > 0
  }
  open.value = true
  document.addEventListener('pointerdown', onDocDown, true)
}
function close() {
  if (!open.value) return
  open.value = false
  document.removeEventListener('pointerdown', onDocDown, true)
}
function onDocDown(e) {
  if (root.value && !root.value.contains(e.target)) close()
}
function pick(id) {
  emit('update:modelValue', id)
  close()
}
/* Android 返回键等外部指令要收起下拉：监听全局关闭事件（App.vue backButton 里派发） */
function onExternalClose() { close() }
window.addEventListener('web2:dd-close', onExternalClose)
onBeforeUnmount(() => {
  window.removeEventListener('web2:dd-close', onExternalClose)
  close()
})
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-card px-3 py-2.5 text-left text-sm text-ink outline-none transition focus:border-primary-400 active:bg-soft"
      :class="open ? 'border-primary-400' : ''"
      @click="toggle"
    >
      <span class="min-w-0 flex-1 truncate" :class="current ? '' : 'text-ink-dim/40'">{{ current || placeholder }}</span>
      <svg
        viewBox="0 0 16 16"
        class="h-3.5 w-3.5 shrink-0 text-ink-dim transition-transform duration-200"
        :class="open ? 'rotate-180' : ''"
        fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
      ><path d="M4 6l4 4 4-4" /></svg>
    </button>
    <Transition name="ddpop">
      <div
        v-if="open"
        class="absolute inset-x-0 z-40 overflow-hidden rounded-xl border border-line bg-card shadow-lg"
        :class="[dropUp ? 'ddpop-up bottom-full mb-1.5 origin-bottom' : 'top-full mt-1.5 origin-top']"
      >
        <ul class="max-h-60 overflow-y-auto py-1">
          <li v-for="o in options" :key="o.id">
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] transition active:bg-primary-50"
              :class="o.id === modelValue ? 'bg-primary-50/70 font-medium text-primary-600' : 'text-ink'"
              @click="pick(o.id)"
            >
              <span class="min-w-0 flex-1 truncate">{{ o.label }}</span>
              <svg
                v-if="o.id === modelValue"
                viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-primary-600"
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
              ><path d="M3 8.5l3.5 3.5L13 5" /></svg>
            </button>
          </li>
        </ul>
      </div>
    </Transition>
  </div>
</template>
