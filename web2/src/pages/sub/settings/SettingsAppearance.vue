<script setup>
import { toRefs } from 'vue'
import { useApp } from '../../../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  theme,
  isDark,
  toggleTheme,
  ACCENTS,
  accent,
  setAccent,
  autoTheme,
  autoSlotName,
  setAutoTheme,
} = toRefs(app)
</script>

<template>
      <section class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
        <!-- 主题外观 + 主题配色（2026-10-03 方案 C Step 4：原「我的」页常显的「主题配色」
             并进这里 —— 此前有两个主题入口，现在一个入口管全部外观）。 -->
        <div class="p-4">
          <div class="flex items-center gap-3.5">
            <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
              <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 9.5A6 6 0 116.5 2.5a5 5 0 007 7z" /></svg>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">主题外观</span>
              <span class="block text-[11px] text-ink-dim">{{ isDark ? '当前：深色' : '当前：浅色' }}</span>
            </span>
            <button
              type="button"
              data-theme-toggle
              class="flex shrink-0 items-center gap-1.5 rounded-full bg-soft px-3 py-2 text-xs font-medium text-ink-dim transition active:scale-95"
              @click="toggleTheme"
            >
              <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h9M9.5 2.5L12 5l-2.5 2.5M13 11H4M6.5 8.5L4 11l2.5 2.5" /></svg>
              {{ isDark ? '切浅色' : '切深色' }}
            </button>
          </div>
          <div class="mt-3 flex items-center gap-3 border-t border-line pt-3">
            <span class="text-[11px] text-ink-dim">主题配色</span>
            <div class="flex items-center gap-2.5">
              <button
                v-for="a in ACCENTS"
                :key="a.key"
                class="h-6 w-6 rounded-full transition active:scale-90"
                :class="accent === a.key ? 'ring-2 ring-primary-400 ring-offset-2 ring-offset-card' : ''"
                :style="{ background: a.color }"
                :title="a.name"
                @click="setAccent(a.key)"
              ></button>
            </div>
          </div>
          <!-- 跟着时间呼吸（v1.41.6）：默认关；打开后清晨薄荷绿 / 白天蓝白 / 傍晚与夜里薰衣草紫
               （夜里同时切深色）。只在跨时段那刻接管，中途手动改配色/深浅不会被抢回去。 -->
          <div class="mt-3 flex items-center gap-3 border-t border-line pt-3">
            <span class="min-w-0 flex-1">
              <span class="block text-[11px] text-ink-dim">跟着时间自动换</span>
              <span class="block text-[11px] text-ink-dim">
                {{ autoTheme ? '当前时段：' + autoSlotName + '（' + (isDark ? '深色' : '浅色') + '）' : '清晨 / 白天 / 傍晚 / 夜里各一套' }}
              </span>
            </span>
            <button
              type="button"
              data-theme-auto
              role="switch"
              :aria-checked="autoTheme ? 'true' : 'false'"
              class="relative h-6 w-11 shrink-0 rounded-full transition"
              :class="autoTheme ? 'bg-primary-500' : 'bg-soft-2'"
              @click="setAutoTheme(!autoTheme)"
            >
              <span
                class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
                :style="{ left: autoTheme ? '22px' : '2px' }"
              ></span>
            </button>
          </div>
        </div>
      </section>
</template>
