<script setup>
/* 底部浮层外壳（2026-10-03 方案 C Step 6 抽出）
   把 7 处此前逐字复制的外壳收成一处：遮罩（含统一锚点 data-sheet-mask）、
   面板（max-h-[86vh] + overflow-y-auto → 小屏也滚得到底部按钮）、顶部把手、进出动画。
   调用方只关心「内容 + 锚点」：

     <BottomSheet :open="!!todoForm" sheet-attr="data-sheet-todo" @close="todoForm = null">
       ...面板内容...
     </BottomSheet>

   · sheetAttr ：面板上的 data-* 锚点（测试用；picker / 识别格那两种异构层不用本组件）
   · maskAttr  ：遮罩上的历史附加锚点（如 data-habit-sheet-mask / data-add-pick-mask）
   · panelClass：面板额外 class（打卡浮层的内边距与其它不同）
                 —— 下内边距不归它管：组件用 inline style 统一留出
                 max(24px, 底部安全区 + 24px)，免得按钮落进真机的手势条
                 （真机坑 A，见 docs/真机复验清单.md 第八节）
   · handle / handleClass：顶部把手的显隐与样式（课程详情原来的把手 mb-4，别的都是 mb-3）
   背景滚动锁由 App.vue 的 syncBodyScrollLock 统一管，组件不管。 */
import { computed } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  sheetAttr: { type: String, default: '' },
  maskAttr: { type: String, default: '' },
  panelClass: { type: String, default: 'p-5 pb-10' },
  handle: { type: Boolean, default: true },
  handleClass: { type: String, default: 'mx-auto mb-3 h-1 w-9 rounded-full bg-soft-2' },
})
defineEmits(['close'])

/* 遮罩一律带 data-sheet-mask；历史锚点（打卡/类型菜单）按需附加 */
const maskAttrs = computed(() => ({
  'data-sheet-mask': '',
  ...(props.maskAttr ? { [props.maskAttr]: '' } : {}),
}))
const sheetAttrs = computed(() => (props.sheetAttr ? { [props.sheetAttr]: '' } : {}))
</script>

<template>
  <Transition name="fade">
    <div v-if="open" v-bind="maskAttrs" class="fixed inset-0 z-20 bg-black/40" @click="$emit('close')"></div>
  </Transition>
  <Transition name="slide">
    <div
      v-if="open"
      v-bind="sheetAttrs"
      class="fixed inset-x-0 bottom-0 z-30 mx-auto max-h-[86vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-line bg-card shadow-2xl"
      :class="panelClass"
      :style="{ paddingBottom: 'max(24px, calc(var(--sab, 0px) + 24px))' }"
    >
      <div v-if="handle" :class="handleClass"></div>
      <slot />
    </div>
  </Transition>
</template>
