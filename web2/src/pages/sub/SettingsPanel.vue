<script setup>
import { toRefs } from 'vue'
import { useApp } from '../../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  APP_VERSION,
  source,
  openMeSub,
  // 下面这些只在「当前值摘要」里出现（不展开具体项），用来让索引页一眼看懂现在是什么设定
  isDark,
  accent,
  ACCENTS,
  autoTheme,
  notifyOk,
  notifySettings,
  reviewSettings,
  llmReady,
  lectures,
  listenClips,
} = toRefs(app)

/* 索引页摘要：把「现在的设定」拼成一句话，避免点进去才知道是什么状态。
   这些都是只读展示，改值仍然去各自的子页 —— 索引页不承担编辑职责。 */
const accentName = () => {
  const a = ACCENTS.value.find((x) => x.key === accent.value)
  return a ? a.name : ''
}
const appearanceSummary = () => {
  const parts = [isDark.value ? '深色' : '浅色']
  if (accentName()) parts.push(accentName())
  parts.push(autoTheme.value ? '跟着时间换' : '不自动换')
  return parts.join(' · ')
}
const remindSummary = () => {
  if (!notifyOk.value) return '仅 App 内可用'
  const on = notifySettings.value && notifySettings.value.enabled
  const lead = notifySettings.value ? notifySettings.value.minutesBefore : 10
  const review = reviewSettings.value && reviewSettings.value.enabled
  if (!on && !review) return '都关着'
  return `${on ? `课前 ${lead} 分钟` : '课前提醒关着'} · ${review ? `复盘 ${reviewSettings.value.at}` : '复盘关着'}`
}
const recordingSummary = () => (llmReady.value ? 'AI 纪要已配置' : 'AI 纪要未配置')
const dataSummary = () => (source.value === 'import' ? `已导入主项目 · ${lectures.value.length} 场录音` : '示例数据 · 可导入自己的')
</script>

<template>
      <!-- ===== 设置索引页（2026-10-12 大扫除）=====
           改前：这一页把外观 / 提醒 / 纪要 / 数据 / 特殊日期五类东西平铺在约 2 屏里，
           还靠 CSS order-1/2/3 把 DOM 顺序和显示顺序拆开；危险动作（清除数据）
           夹在课堂纪要和后台录音说明中间。
           改后：这一页只列入口、每行带「当前值摘要」，具体项在各自的子页里。
           好处：设置首页永远一屏，以后加设置项只多一行，不会把别人挤走；
           也符合设计方案第一节「与当前任务无关的界面元素绝不出现」。 -->
      <section class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
        <button
          type="button"
          data-settings-index="appearance"
          class="flex w-full items-center gap-3.5 p-4 text-left transition active:bg-soft"
          @click="openMeSub('settings-appearance')"
        >
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 9.5A6 6 0 116.5 2.5a5 5 0 007 7z" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">外观与主题</span>
            <span class="block truncate text-[11px] text-ink-dim" data-settings-sum="appearance">{{ appearanceSummary() }}</span>
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>

        <button
          type="button"
          data-settings-index="remind"
          class="flex w-full items-center gap-3.5 p-4 text-left transition active:bg-soft"
          @click="openMeSub('settings-remind')"
        >
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2a3.5 3.5 0 00-3.5 3.5c0 3-1.5 4-1.5 4h10s-1.5-1-1.5-4A3.5 3.5 0 008 2z" /><path d="M6.5 12.5a1.6 1.6 0 003 0" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">提醒</span>
            <span class="block truncate text-[11px] text-ink-dim" data-settings-sum="remind">{{ remindSummary() }}</span>
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>

        <button
          type="button"
          data-settings-index="recording"
          class="flex w-full items-center gap-3.5 p-4 text-left transition active:bg-soft"
          @click="openMeSub('settings-recording')"
        >
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="1.5" width="4" height="8" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 009 0M8 12v2.5M5.5 14.5h5" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">课堂录音与纪要</span>
            <span class="block truncate text-[11px] text-ink-dim" data-settings-sum="recording">{{ recordingSummary() }}</span>
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>

        <button
          type="button"
          data-settings-index="data"
          class="flex w-full items-center gap-3.5 p-4 text-left transition active:bg-soft"
          @click="openMeSub('settings-data')"
        >
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V2M4.5 5.5L8 2l3.5 3.5M3 11v2.5A.5.5 0 003.5 14h9a.5.5 0 00.5-.5V11" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">数据与导入导出</span>
            <span class="block truncate text-[11px] text-ink-dim" data-settings-sum="data">{{ dataSummary() }}</span>
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>

        <button
          type="button"
          data-settings-index="system"
          class="flex w-full items-center gap-3.5 p-4 text-left transition active:bg-soft"
          @click="openMeSub('settings-system')"
        >
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">系统与关于</span>
            <span class="block truncate text-[11px] text-ink-dim" data-settings-sum="system">{{ APP_VERSION }} · 清理与重置</span>
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
        </button>
      </section>
</template>
