<script setup>
import { toRefs } from 'vue'
import DropdownSelect from '../../components/DropdownSelect.vue'
import { useApp } from '../../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  APP_VERSION,
  source,
  importMsg,
  addedDupCount,
  dedupCourses,
  onImportFile,
  onClearImport,
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
  confirmClear,
  recSupported,
  reviewHistory,
  reviewSettings,
  REVIEW_AT_CHOICES,
  openReview,
  toggleReviewNotify,
  setReviewAt,
  llmCfg,
  llmInputOpen,
  PROVIDER_OPTIONS,
  llmReady,
  onLlmProvider,
  onLlmKey,
  llmTest,
  llmModels,
  testLlm,
  theme,
  isDark,
  toggleTheme,
  ACCENTS,
  accent,
  setAccent,
  autoTheme,
  autoSlotName,
  setAutoTheme,
  onExportBack,
  onExportIcs,
} = toRefs(app)
</script>

<template>
      <section class="order-2 divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">

        <!-- 导入主项目数据 -->
        <label class="flex cursor-pointer items-center gap-3.5 p-4 active:bg-ink/5">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V2M4.5 5.5L8 2l3.5 3.5M3 11v2.5A.5.5 0 003.5 14h9a.5.5 0 00.5-.5V11" /></svg>
          </span>
          <span class="flex-1 text-sm font-medium">导入主项目数据</span>
          <span class="text-xs" :class="source === 'import' ? 'text-primary-600' : 'text-ink-dim'">
            {{ source === 'import' ? '已导入 ✓' : '选择导出的 JSON' }}
          </span>
          <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
          <input type="file" accept=".json,application/json" class="hidden" @change="onImportFile" />
        </label>

        <!-- 恢复示例数据（仅导入态出现） -->
        <button
          v-if="source === 'import'"
          class="flex w-full items-center gap-3.5 p-4 text-left active:bg-ink/5"
          @click="onClearImport"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 109.8-3.4M2.5 2.5v3h3" /></svg>
          </span>
          <span class="flex-1 text-sm font-medium">恢复示例数据</span>
        </button>

        <!-- 导出回写主项目（仅导入态出现）：勾选过的待办随文件带走 -->
        <button
          v-if="source === 'import'"
          class="flex w-full items-center gap-3.5 p-4 text-left active:bg-ink/5"
          @click="onExportBack"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v9M4.5 7.5L8 11l3.5-3.5M3 13h10" /></svg>
          </span>
          <span class="flex-1">
            <span class="block text-sm font-medium">导出回写主项目</span>
            <span class="block text-[11px] text-ink-dim">勾选过的待办会同步进导出文件</span>
          </span>
        </button>

        <!-- 导出日历 .ics：把课表装进系统日历 -->
        <button
          class="flex w-full items-center gap-3.5 p-4 text-left active:bg-ink/5"
          @click="onExportIcs"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /></svg>
          </span>
          <span class="flex-1">
            <span class="block text-sm font-medium">导出日历（.ics）</span>
            <span class="block text-[11px] text-ink-dim">整学期课表装进手机系统日历，带课前提醒</span>
          </span>
        </button>

      </section>

      <!-- ===== 设置（折叠）：一次配好、装完就不碰的东西全收在这里 =====
           减法（2026-10-02）：此前主题/纪要/通知/清理/重置/关于全部平铺在首页，
           「我的」页要滑约 3.5 屏，其中 2.5 屏是低频设置 —— 高频的「换学期、导数据」
           反而被埋住。设计三原则第一条写着「与当前任务无关的界面元素绝不出现」，
           折叠就是这句话的落地：平时不出现，需要时一步可达。
           默认收起（高频动作优先）；「课堂纪要」缺 API Key 时会自动展开（见 llmInputOpen）。 -->
      <!-- Stage 6：设置不再需要「折叠」——它自己就是一整页（从索引页「设置」入口推入）。
           顺序：外观/提醒在前，数据（导入导出）在后（order-1/order-2，DOM 结构不动）。 -->
      <section class="order-1 rounded-2xl border border-line bg-card shadow-sm">
        <div data-settings-body class="divide-y divide-line">

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
              class="flex shrink-0 items-center gap-1.5 rounded-full bg-ink/5 px-3 py-2 text-xs font-medium text-ink-dim transition active:scale-95"
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
              :class="autoTheme ? 'bg-primary-500' : 'bg-ink/15'"
              @click="setAutoTheme(!autoTheme)"
            >
              <span
                class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
                :style="{ left: autoTheme ? '22px' : '2px' }"
              ></span>
            </button>
          </div>
        </div>

        <!-- 课堂纪要（M4）：LLM 配置。key 只存本机 localStorage，不进导出、不经手上传 -->
        <div class="p-4">
          <button
            type="button"
            class="flex w-full items-center gap-3.5 text-left active:bg-ink/5"
            @click="llmInputOpen = !llmInputOpen"
          >
            <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
              <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5l1.8 3.7 4 .6-2.9 2.8.7 4L8 10.7l-3.6 1.9.7-4L2.2 5.8l4-.6z" /><path d="M8 13.5v1.5" /></svg>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">课堂纪要</span>
              <span class="block text-[11px] text-ink-dim">{{ llmReady ? 'AI 服务已配置，可在录音场次一键生成' : '转写完成后用 AI 把文字稿总结成复习纪要' }}</span>
            </span>
            <svg viewBox="0 0 16 16" class="h-3.5 w-3.5 shrink-0 text-ink-dim transition-transform" :class="llmInputOpen ? 'rotate-90' : ''" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
          </button>

          <div v-if="llmInputOpen" class="mt-3 space-y-2.5">
            <div>
              <span class="mb-1 block text-[11px] text-ink-dim">纪要服务</span>
              <DropdownSelect
                v-model="llmCfg.provider"
                data-dd="provider"
                :options="PROVIDER_OPTIONS"
                placeholder="未选择"
                @update:model-value="onLlmProvider"
              />
            </div>
            <label v-if="llmCfg.provider === 'deepseek'" class="block">
              <span class="mb-1 block text-[11px] text-ink-dim">DeepSeek API Key（只存在本机，不会上传）</span>
              <input
                v-model="llmCfg.key"
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="sk-…"
                enterkeyhint="done"
                class="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-dim focus:border-primary-400"
                @input="onLlmKey"
              />
            </label>
            <div v-if="llmCfg.provider === 'deepseek'">
              <span class="mb-1 block text-[11px] text-ink-dim">模型（二选一，不用手填）</span>
              <DropdownSelect
                v-model="llmCfg.model"
                data-dd="model"
                :options="llmModels"
                @update:model-value="onLlmKey"
              />
            </div>
            <!-- 测试连接：填完就能验，不用等一次真生成来撞错 -->
            <button
              type="button"
              class="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-card py-2.5 text-sm font-medium text-ink transition active:scale-[0.98]"
              :class="llmTest.busy ? 'opacity-60' : ''"
              @click="testLlm"
            >
              <span v-if="llmTest.busy" class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-400 border-t-transparent"></span>
              {{ llmTest.busy ? '正在测试…' : '测试连接' }}
            </button>
            <p
              v-if="llmTest.msg"
              class="text-[11px] leading-relaxed"
              :class="llmTest.ok ? 'text-primary-600' : 'text-red-600 dark:text-red-400'"
            >{{ llmTest.msg }}</p>
            <p class="text-[11px] leading-relaxed text-ink-dim">
              Key 在 platform.deepseek.com 申请；一次纪要通常几分钱以内。配置存在本机，换设备后需重填。
            </p>
          </div>
        </div>

        <!-- 清除数据并重置（危险项：二次确认后回到初始设定，无法恢复） -->
        <button
          data-clear-entry
          class="flex w-full items-center gap-3.5 p-4 text-left active:bg-ink/5"
          @click="confirmClear = true"
        >
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-red-400/10">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6.5 2.5h3M4 4.5l.6 9a1 1 0 001 .9h4.8a1 1 0 001-.9l.6-9M6.8 7.5v4M9.2 7.5v4" /></svg>
          </span>
          <span class="flex-1">
            <span class="block text-sm font-medium text-red-600 dark:text-red-400">清除数据并重置</span>
            <span class="block text-[11px] text-ink-dim">想从头开始（换学期 / 重测）用它，无法恢复</span>
          </span>
        </button>

        <!-- 后台录音说明（仅 App 平台：网页版没有前台服务，属于 M2.5 原生能力） -->
        <div v-if="recSupported" class="flex items-start gap-3.5 p-4">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2a3.5 3.5 0 00-3.5 3.5c0 3-1.5 4-1.5 4h10s-1.5-1-1.5-4A3.5 3.5 0 008 2z" /><path d="M6.5 12.5a1.6 1.6 0 003 0" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">后台录音</span>
            <span class="block text-[11px] leading-relaxed text-ink-dim">
              录音时锁屏、切到别的应用都会继续录，通知栏会有一条「正在录音」。看不到这条通知的话，去系统设置里打开本应用的通知权限——通知被拦掉时，后台更容易被系统清理。
            </span>
          </span>
        </div>

        <!-- 课前提醒（M5）：开关 + 提前量 + 测试按钮（通知能力仅 App 生效，浏览器置灰） -->
        <div class="flex items-center gap-3.5 p-4" :class="notifyOk ? '' : 'opacity-50'">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="9" r="4.8" /><path d="M5.2 2.2 3.4 3.8M10.8 2.2l1.8 1.6M8 6.8V9l1.6 1.2" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">课前提醒</span>
            <span class="block text-[11px] leading-relaxed text-ink-dim">
              {{ notifyOk
                ? '上课前高优先级提醒（会响、会弹横幅），点通知或「开始录音」直接开录。课程、独立日程、循环日程都包含。'
                : '通知能力仅 App 内生效，浏览器上不可用。' }}
            </span>
          </span>
          <button
            v-if="notifyOk"
            class="relative h-6 w-11 shrink-0 rounded-full transition"
            :class="notifySettings.enabled ? 'bg-primary-500' : 'bg-ink/15'"
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
              :class="notifySettings.minutesBefore === m ? 'bg-primary-500 text-white' : 'bg-ink/5 text-ink'"
              @click="setNotifyLead(m)"
            >{{ m }} 分钟</button>
            <button
              class="ml-auto rounded-full bg-ink/5 px-3 py-1.5 text-[11px] font-medium transition active:scale-95"
              :class="notifyTesting ? 'opacity-60' : ''"
              @click="onTestNotify"
            >{{ notifyTesting ? '发送中…' : '发测试通知' }}</button>
          </div>
          <p v-if="notifyPerm === false" class="mt-2 text-[11px] text-red-600 dark:text-red-400">通知权限被拒绝了：请在系统设置里允许本应用发通知，否则提醒收不到。</p>
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
              <span class="block text-[11px] leading-relaxed text-ink-dim">每晚轻提醒一次，点开花 2 分钟收个尾，生成当天的日精进。存档只在本机，不进导出。</span>
            </span>
            <button
              v-if="notifyOk"
              data-review-toggle
              class="relative h-6 w-11 shrink-0 rounded-full transition"
              :class="reviewSettings.enabled ? 'bg-primary-500' : 'bg-ink/15'"
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
              :class="reviewSettings.at === t ? 'bg-primary-500 text-white' : 'bg-ink/5 text-ink'"
              @click="setReviewAt(t)"
            >{{ t }}</button>
            <button
              data-review-history
              class="ml-auto rounded-full bg-ink/5 px-3 py-1.5 text-[11px] font-medium transition active:scale-95"
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
                  还没允许本应用「设置闹钟和提醒」，系统会把这批提醒当成普通闹钟，到点可能晚一小时才响。允许之后，课前提醒和练耳提醒就能准点到。
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
                通知栏常驻一条「现在 · 课名 / 还有多久」，可直接开始录音、标记「这节上完了」「我去听了」；录音时变身成录音态，全程只有一条常驻通知。
              </span>
            </span>
            <button
              data-frame-toggle
              class="relative h-6 w-11 shrink-0 rounded-full transition"
              :class="frameSettings.enabled ? 'bg-primary-500' : 'bg-ink/15'"
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

        <!-- 数据清理：多次导入叠加的重复课程（有重复才显示，干净的数据不摆这个入口） -->
        <div v-if="addedDupCount" data-dedup-entry class="flex items-center gap-3.5 p-4">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-amber-700 dark:text-amber-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 6l-1.6 7.2a1.5 1.5 0 01-1.5 1.3H4.6a1.5 1.5 0 01-1.5-1.3L1.5 6M6 6V4a2 2 0 012-2h0a2 2 0 012 2v2M14 6H2" /></svg>
          </span>
          <div class="flex-1">
            <span class="block text-sm font-medium">清理重复课程</span>
            <span class="block text-[11px] text-ink-dim">检测到 {{ addedDupCount }} 门重复（多次导入叠加），一键删掉多余的</span>
          </div>
          <button
            class="rounded-full bg-ink/5 px-3 py-1.5 text-xs font-medium transition active:scale-95"
            @click="dedupCourses"
          >一键清理</button>
        </div>

        <!-- 关于 -->
        <div class="flex items-center gap-3.5 p-4">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8a3 3 0 100-6 3 3 0 000 6zM2 14c0-2.5 2.5-4 6-4s6 1.5 6 4" /></svg>
          </span>
          <span class="flex-1 text-sm font-medium">关于</span>
          <span class="text-xs text-ink-dim" data-app-version>{{ APP_VERSION }}</span>
        </div>
        </div>
      </section>

      <!-- 导入结果反馈（导入/导出都在设置页，回执也留在这里） -->
      <p
        v-if="importMsg"
        data-import-msg
        class="order-3 px-1 text-center text-xs"
        :class="importMsg.startsWith('导入成功') || importMsg.startsWith('已导出') ? 'text-primary-600' : 'text-red-600 dark:text-red-400'"
      >
        {{ importMsg }}
      </p>
</template>
