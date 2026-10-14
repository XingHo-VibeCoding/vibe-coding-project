<script setup>
import { toRefs } from 'vue'
import { useApp } from '../../../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  notifySettings,
  notifyPerm,
  notifyOk,
  notifyTesting,
  notifyMsg,
  notifyMsgBad,
  exactAsking,
  exactMsg,
  exactMsgBad,
  exactHint,
  onAskExactAlarm,
  toggleNotify,
  setNotifyLead,
  onTestNotify,
  frameSettings,
  frameIsApp,
  frameMsg,
  frameMsgBad,
  toggleFrame,
  reviewHistory,
  reviewSettings,
  REVIEW_AT_CHOICES,
  openReview,
  toggleReviewNotify,
  setReviewAt,
} = toRefs(app)
</script>

<template>
      <!-- 四处「提醒」2026-10-12 归拢到这一页：课前提醒（M5）、每日复盘（五期）、
           精确提醒（Android 12+）、常驻状态框（Day 19）。
           改前它们被主题外观与课堂纪要拆散在设置页不同高度，用户想找「提醒」得翻两屏。 -->
      <section class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
        <!-- 课前提醒（M5）：开关 + 提前量 + 测试按钮（通知能力仅 App 生效，浏览器置灰） -->
        <div class="flex items-center gap-3.5 p-4" :class="notifyOk ? '' : 'opacity-50'">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="9" r="4.8" /><path d="M5.2 2.2 3.4 3.8M10.8 2.2l1.8 1.6M8 6.8V9l1.6 1.2" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">课前提醒</span>
            <span class="block text-[11px] leading-relaxed text-ink-dim">
              {{ notifyOk
                ? '上课前提醒（会响、会弹横幅），点通知直接开录。课程、日程都包含。'
                : '通知只在 App 里生效，浏览器上不可用。' }}
            </span>
          </span>
          <button
            v-if="notifyOk"
            class="relative h-6 w-11 shrink-0 rounded-full transition"
            :class="notifySettings.enabled ? 'bg-primary-500' : 'bg-soft-2'"
            aria-label="课前提醒开关"
            @click="toggleNotify"
          >
            <span
              class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
              :class="notifySettings.enabled ? 'left-[22px]' : 'left-0.5'"
            ></span>
          </button>
        </div>
        <div v-if="notifyOk && notifySettings.enabled" class="border-t border-line px-4 py-3.5">
          <div class="flex items-center gap-2">
            <span class="text-[11px] text-ink-dim">提前</span>
            <button
              v-for="m in [5, 10, 15]"
              :key="m"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium transition active:scale-95"
              :class="notifySettings.minutesBefore === m ? 'bg-primary-500 text-white' : 'bg-soft text-ink'"
              @click="setNotifyLead(m)"
            >{{ m }} 分钟</button>
            <button
              class="ml-auto rounded-full bg-soft px-3 py-1.5 text-[11px] font-medium transition active:scale-95"
              :class="notifyTesting ? 'opacity-60' : ''"
              @click="onTestNotify"
            >{{ notifyTesting ? '发送中…' : '发测试通知' }}</button>
          </div>
          <p v-if="notifyPerm === false" class="mt-2 text-[11px] text-red-600 dark:text-red-400">通知权限被拒了：去系统设置里允许本应用发通知，否则收不到提醒。</p>
          <p v-if="notifyMsg" class="mt-2 text-[11px]" :class="notifyMsgBad ? 'text-red-600 dark:text-red-400' : 'text-primary-600'">{{ notifyMsg }}</p>
        </div>

        <!-- 每日复盘（五期）：每晚一条轻提醒 + 提醒时间 + 日精进历史入口 -->
        <div data-review-row class="border-t border-line p-4" :class="notifyOk ? '' : 'opacity-50'">
          <div class="flex items-center gap-3.5">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
              <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.5h8.5A1.5 1.5 0 0113 4v9.5H4.5A1.5 1.5 0 013 12V2.5z" /><path d="M5.5 6h5M5.5 9h3.5" /></svg>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">每日复盘</span>
              <span class="block text-[11px] leading-relaxed text-ink-dim">每晚提醒一次，花 2 分钟收个尾，生成当天的日精进。存档只在本机。</span>
            </span>
            <button
              v-if="notifyOk"
              data-review-toggle
              class="relative h-6 w-11 shrink-0 rounded-full transition"
              :class="reviewSettings.enabled ? 'bg-primary-500' : 'bg-soft-2'"
              :aria-label="reviewSettings.enabled ? '关闭每日复盘提醒' : '打开每日复盘提醒'"
              @click="toggleReviewNotify"
            >
              <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" :class="reviewSettings.enabled ? 'left-[22px]' : 'left-0.5'"></span>
            </button>
          </div>
          <div class="mt-3 flex items-center gap-2">
            <span class="text-[11px] text-ink-dim">提醒</span>
            <button
              v-for="t in REVIEW_AT_CHOICES"
              :key="t"
              :data-review-at="t"
              class="rounded-full px-3 py-1.5 text-[11px] font-medium transition active:scale-95"
              :class="reviewSettings.at === t ? 'bg-primary-500 text-white' : 'bg-soft text-ink'"
              @click="setReviewAt(t)"
            >{{ t }}</button>
            <button
              data-review-history
              class="ml-auto rounded-full bg-soft px-3 py-1.5 text-[11px] font-medium transition active:scale-95"
              @click="openReview('history')"
            >日精进 {{ reviewHistory.length }} 篇</button>
          </div>
        </div>

        <!-- 精确提醒（Android 12+）：没有 SCHEDULE_EXACT_ALARM 时只能排非精确闹钟，系统给最多
             1 小时的浮动窗口，提醒可能晚到。只在真在排提醒、又真没权限时才出现（见 exactHint）；
             允许之后警告撤掉，只留一行回执（exactMsg 还在内存里，下次启动自然清掉）。 -->
        <div v-if="exactHint || exactMsg" data-exact-row class="border-t border-line px-4 py-3.5">
          <div class="flex items-start gap-2">
            <span v-if="exactHint" class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-700 dark:text-amber-600">!</span>
            <div class="min-w-0 flex-1">
              <div v-if="exactHint" data-exact-warn>
                <p class="text-[12px] font-medium text-ink">提醒可能晚到（最多 1 小时）</p>
                <p class="mt-1 text-[11px] leading-relaxed text-ink-dim">
                  还没允许本应用「设置闹钟和提醒」，这批提醒可能晚一小时才响。允许后课前与练耳提醒就能准点。
                </p>
                <button
                  data-exact-ask
                  class="mt-2 rounded-full bg-primary-500 px-3 py-1.5 text-[11px] font-medium text-white transition active:scale-95"
                  :class="exactAsking ? 'opacity-60' : ''"
                  @click="onAskExactAlarm"
                >{{ exactAsking ? '打开系统设置…' : '去允许精确提醒' }}</button>
              </div>
              <p v-if="exactMsg" data-exact-msg class="text-[11px]" :class="[exactMsgBad ? 'text-red-600 dark:text-red-400' : 'text-primary-600', exactHint ? 'mt-1.5' : '']">{{ exactMsg }}</p>
            </div>
          </div>
        </div>

        <!-- 常驻状态框（Day 19）：通知栏里一条常驻的「现在在上什么 / 还有多久 / 待办几项」，
             带「开始录音 / 上完了 / 我去听了」三个按钮；录音时它变身成录音态（只留一条常驻通知）。
             能力仅 App 内生效（原生前台服务），浏览器上整行不出现。 -->
        <div v-if="frameIsApp" data-frame-row class="p-4">
          <div class="flex items-center gap-3.5">
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
              <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="9" rx="1.6" /><path d="M5 5.5h6M5 8h4M8 13.5v-2" /></svg>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">常驻状态框</span>
              <span class="block text-[11px] leading-relaxed text-ink-dim">
                通知栏常驻一条「现在 · 课名 / 还有多久」，可直接开始录音、标记「上完了」「我去听了」；录音时变成录音态。
              </span>
            </span>
            <button
              data-frame-toggle
              class="relative h-6 w-11 shrink-0 rounded-full transition"
              :class="frameSettings.enabled ? 'bg-primary-500' : 'bg-soft-2'"
              aria-label="常驻状态框开关"
              @click="toggleFrame"
            >
              <span
                class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
                :class="frameSettings.enabled ? 'left-[22px]' : 'left-0.5'"
              ></span>
            </button>
          </div>
          <p v-if="frameMsg" data-frame-msg class="mt-2 text-[11px]" :class="frameMsgBad ? 'text-red-600 dark:text-red-400' : 'text-primary-600'">{{ frameMsg }}</p>
        </div>
      </section>
</template>
