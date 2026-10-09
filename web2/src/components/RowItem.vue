<script setup>
/* RowItem —— 「一条日程 / 待办」的唯一实现处
 *
 * 形态（2026-10-09 W 方案，用户拍板）：**一行一张卡片**。
 *   · 卡高 50px：标题行 leading-20(20) + 副信息行 leading-16(16) + py-1.5(6+6) + 上边框 1+1 = 50
 *   · 左侧固定 40px 时间列 + 一条 2px 竖轴（进行中 = 主色实心轴，其余 = soft-2）
 *   · 进行中：`border-primary-200 bg-primary-50` + 蓝色轴 + 主色半粗标题
 *   · 已过 / 已完成：整行**实色** `text-ink-dim` 灰字（不许 `/60` 这类 alpha 档 ——
 *     A4 可读性扫描：alpha 档在白底与浅灰底都不到 WCAG AA）
 *   · 卡高 50px 本身已 ≥ 44px，**不需要**再拿 after 伪元素补触区
 *     （旧 26px 紧凑行靠 `after:-inset-y-[9px]` 外扩，那种密度已随本轮卡片化退休）
 *
 * 锚点：根 `data-row` + `data-row-state`，时间列 `data-row-time`，副信息 `data-row-sub`。
 * 调用方要挂自己的锚点（如 `data-today-item`）直接写在 <RowItem> 上即可（inheritAttrs: false + $attrs 透传）。
 */
defineOptions({ inheritAttrs: false })

const props = defineProps({
  time: { type: String, default: '' }, // '08:00'；空则不占时间列
  title: { type: String, default: '' },
  sub: { type: String, default: '' }, // 标题下的小字（地点 · 标签），会截断
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
    class="flex w-full items-stretch gap-2 rounded-xl border px-2.5 py-1.5 text-left"
    :class="[
      state === 'now' ? 'border-primary-200 bg-primary-50' : 'border-line bg-card',
      clickable ? 'transition active:opacity-70' : '',
      state === 'done' ? 'text-ink-dim' : 'text-ink',
    ]"
  >
    <span
      v-if="time"
      data-row-time
      class="w-10 flex-none pt-0.5 text-right text-[11px] leading-[20px] tabular-nums text-ink-dim"
    >{{ time }}</span>
    <!-- 竖轴：把这一列连成一条时间线 -->
    <span class="w-[2px] flex-none rounded-full" :class="state === 'now' ? 'bg-primary-500' : 'bg-soft-2'"></span>
    <span class="min-w-0 flex-1">
      <span class="flex items-center gap-1.5">
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
        <span
          class="min-w-0 flex-1 truncate text-[13px] leading-[20px]"
          :class="state === 'now' ? 'font-semibold text-primary-600' : ''"
        >{{ title }}</span>
      </span>
      <span v-if="sub" data-row-sub class="block truncate text-[11px] leading-[16px] text-ink-dim">{{ sub }}</span>
      <!-- sub 为空时用一行等高的空气保住 50px 卡高（同一天里卡片不许高低不齐） -->
      <span v-else class="block text-[11px] leading-[16px]" aria-hidden="true">&nbsp;</span>
    </span>
    <span
      v-if="meta"
      class="flex-none pt-0.5 text-[11px] leading-[20px] tabular-nums"
      :class="state === 'due' ? 'font-medium text-amber-600' : 'text-ink-dim'"
    >{{ meta }}</span>
    <slot />
  </component>
</template>
