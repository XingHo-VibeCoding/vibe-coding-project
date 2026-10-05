<script setup>
/* RowItem —— 26px 时间行（规格见 docs/结构动效前置约定.md §一「新增规格：26px 时间行」）
 *
 * 为什么不是 44px 行：20 件 × 44px = 880px，密度就白省了。所以
 *   · 视觉行高锁死 26px：`py-[3px]`（3+3）+ `leading-[20px]`（20）= 26；
 *   · 触区靠 `after` 伪元素上下各外扩 9px 到 44px —— 绝对定位不参与布局，行高一点不变。
 *
 * 已完成 / 已过 = **整行实色 `text-ink-dim` 灰字**，不许用 `/60` 这类 alpha 档
 * （A4 可读性扫描：alpha 档在白底与浅灰底都不到 WCAG AA）。
 *
 * 锚点：根 `data-row` + `data-row-state`，时间列 `data-row-time`。
 * 调用方要挂自己的锚点（如 `data-today-item`）直接写在 <RowItem> 上即可（inheritAttrs: false + $attrs 透传）。
 */
defineOptions({ inheritAttrs: false })

const props = defineProps({
  time: { type: String, default: '' }, // '08:00'；空则不占时间列
  title: { type: String, default: '' },
  sub: { type: String, default: '' }, // 标题后的次要信息（地点 · 标签），会截断
  meta: { type: String, default: '' }, // 右侧状态（已上完 / 3 遍 / 今天到期）
  state: { type: String, default: 'plain' }, // plain | now | due | done
  tone: { type: String, default: '' }, // 标题前小圆点颜色（循环日程等）
  routine: { type: Boolean, default: false }, // 循环日程：用 ↻ 标记代替圆点（沿用 data-routine-mark 锚点）
  clickable: { type: Boolean, default: false },
})
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    data-row
    :data-row-state="state"
    v-bind="$attrs"
    class="relative flex w-full items-center gap-2 text-left text-[11px] leading-[20px]"
    :class="[
      time ? 'py-[3px]' : 'py-[3px]',
      clickable ? 'after:absolute after:inset-x-0 after:-inset-y-[9px] after:content-[\'\'] active:opacity-70' : '',
      state === 'done' ? 'text-ink-dim' : 'text-ink',
    ]"
  >
    <span v-if="time" data-row-time class="w-10 flex-none text-right tabular-nums text-ink-dim">{{ time }}</span>
    <svg
      v-if="routine"
      data-routine-mark
      viewBox="0 0 16 16"
      aria-label="循环日程"
      class="h-3 w-3 flex-none"
      :style="{ color: tone || 'currentColor' }"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M13 8a5 5 0 11-1.9-3.9" />
      <path d="M13 2.2V5h-2.8" />
    </svg>
    <span v-else-if="tone" class="h-1.5 w-1.5 flex-none rounded-full" :style="{ background: tone }"></span>
    <span class="min-w-0 flex-1 truncate" :class="state === 'now' ? 'font-medium text-primary-600' : ''">{{ title }}</span>
    <span v-if="sub" data-row-sub class="max-w-[42%] flex-none truncate text-ink-dim">{{ sub }}</span>
    <span
      v-if="meta"
      class="flex-none tabular-nums"
      :class="state === 'due' ? 'font-medium text-amber-600' : 'text-ink-dim'"
    >{{ meta }}</span>
    <slot />
  </component>
</template>
