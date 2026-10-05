<script setup>
import { toRefs } from 'vue'
import { useApp } from '../../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  fmtSeconds,
  formatIntervals,
  notifyOk,
  listenClips,
  listenSettings,
  listenMsg,
  listenMsgBad,
  listenOpen,
  listenIsApp,
  listenSuggestions,
  listenStageLabel,
  onListenPick,
  toggleListenNotify,
  listenSettingsOpen,
  onListenRepeat,
  onListenIntervals,
  onListenDnd,
  onListenNum,
  resetListenSettings,
  listenPlayId,
  listenPlayRound,
  listenPlayTotal,
  listenPaused,
  onListenPlay,
} = toRefs(app)
</script>

<template>
      <!-- 碎片练耳（四期 Day 18）：导入 + 列表（L1）。通知/播放见后续板块 -->
      <section class="rounded-2xl border border-line bg-card p-4 shadow-sm">
        <div class="flex items-center gap-3.5">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12.5V7a5 5 0 0110 0v5.5" /><path d="M1.5 11.5h2v3h-2zM12.5 11.5h2v3h-2z" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">碎片练耳</span>
            <span class="block text-[11px] text-ink-dim">
              本地音频按艾宾浩斯排复习；到点只提醒你去听，不自动播放
            </span>
          </span>
          <button
            class="shrink-0 rounded-full bg-primary-500 px-4 py-2 text-xs font-medium text-white transition active:scale-95"
            @click="listenOpen = !listenOpen"
          >
            {{ listenOpen ? '收起' : '打开' }}
          </button>
        </div>

        <template v-if="listenOpen">
          <!-- 到点提醒开关（2026-10-03 补：以前默认关且没有开关，通知永远不响） -->
          <div class="mt-3 flex items-center gap-3 rounded-xl bg-soft px-3 py-2.5">
            <span class="min-w-0 flex-1">
              <span class="block text-[12px] font-medium">到点提醒我去听</span>
              <span class="block text-[11px] text-ink-dim">到复习日合并成一条「今天有 N 段待复习」</span>
            </span>
            <button
              class="relative h-6 w-11 shrink-0 rounded-full transition"
              :class="listenSettings.enabled ? 'bg-primary-500' : 'bg-soft-2'"
              data-listen-notify-toggle
              :aria-pressed="listenSettings.enabled ? 'true' : 'false'"
              @click="toggleListenNotify"
            >
              <span class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all" :class="listenSettings.enabled ? 'left-[22px]' : 'left-0.5'"></span>
            </button>
          </div>
          <p v-if="listenSettings.enabled && !notifyOk" class="mt-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-500">
            这个环境没有通知能力（浏览器里收不到）——装到手机 App 里才生效。
          </p>

          <!-- 练耳设置面板（2026-10-03 补：这几项原来只能改代码里的 DEFAULTS） -->
          <button
            class="mt-2.5 flex w-full items-center justify-between rounded-xl bg-soft px-3 py-2 text-[12px] font-medium text-ink-dim transition active:scale-[0.99]"
            data-listen-settings-toggle
            :aria-expanded="listenSettingsOpen ? 'true' : 'false'"
            @click="listenSettingsOpen = !listenSettingsOpen"
          >
            <span>练耳设置（遍数 / 复习间隔 / 勿扰 / 空档）</span>
            <span class="text-[11px] text-ink-dim">{{ listenSettingsOpen ? '收起' : '展开' }}</span>
          </button>

          <div v-if="listenSettingsOpen" data-listen-settings class="mt-2 space-y-2.5 rounded-xl bg-soft px-3 py-3">
            <div class="flex items-center gap-2">
              <span class="w-[72px] shrink-0 text-[12px] text-ink-dim">连放遍数</span>
              <div class="flex gap-1.5">
                <button
                  v-for="n in [3, 4, 5]"
                  :key="n"
                  class="h-7 rounded-lg px-2.5 text-[12px] font-medium transition active:scale-95"
                  :class="listenSettings.repeatTimes === n ? 'bg-primary-500 text-white' : 'bg-soft-2 text-ink-dim'"
                  :data-listen-repeat="n"
                  @click="onListenRepeat(n)"
                >{{ n }} 遍</button>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-[72px] shrink-0 text-[12px] text-ink-dim">复习间隔</span>
              <input
                type="text"
                inputmode="numeric"
                data-listen-intervals
                class="min-w-0 flex-1 rounded-lg border border-line bg-white px-2 py-1.5 text-[12px]"
                :value="formatIntervals(listenSettings.reviewIntervals)"
                @change="onListenIntervals"
              />
              <span class="shrink-0 text-[11px] text-ink-dim">天</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-[72px] shrink-0 text-[12px] text-ink-dim">勿扰时段</span>
              <input
                type="time"
                data-listen-dnd-start
                class="rounded-lg border border-line bg-white px-2 py-1.5 text-[12px]"
                :value="listenSettings.dndStart"
                @change="onListenDnd('start', $event)"
              />
              <span class="text-[11px] text-ink-dim">至</span>
              <input
                type="time"
                data-listen-dnd-end
                class="rounded-lg border border-line bg-white px-2 py-1.5 text-[12px]"
                :value="listenSettings.dndEnd"
                @change="onListenDnd('end', $event)"
              />
            </div>
            <p class="text-[11px] leading-relaxed text-ink-dim">结束时间早于开始时间 = 跨夜（默认 23:00–07:00），这段时间不发提醒。</p>
            <div class="flex items-center gap-2">
              <span class="w-[72px] shrink-0 text-[12px] text-ink-dim">短槽上限</span>
              <input
                type="number"
                min="1"
                max="120"
                data-listen-short-gap
                class="w-16 rounded-lg border border-line bg-white px-2 py-1.5 text-[12px]"
                :value="listenSettings.shortGapMaxMin"
                @change="onListenNum('shortGapMaxMin', $event)"
              />
              <span class="text-[11px] text-ink-dim">分钟以内算短槽（只放 1 段）</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-[72px] shrink-0 text-[12px] text-ink-dim">最短空档</span>
              <input
                type="number"
                min="1"
                max="120"
                data-listen-slot-min
                class="w-16 rounded-lg border border-line bg-white px-2 py-1.5 text-[12px]"
                :value="listenSettings.slotMinMin"
                @change="onListenNum('slotMinMin', $event)"
              />
              <span class="text-[11px] text-ink-dim">分钟以下不排（太碎听不完）</span>
            </div>
            <button
              class="w-full rounded-lg bg-soft-2 py-2 text-[12px] font-medium text-ink-dim transition active:scale-[0.99]"
              data-listen-settings-reset
              @click="resetListenSettings"
            >恢复默认</button>
          </div>

          <label class="mt-3.5 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-primary-400/50 bg-primary-50/40 px-3 py-3 text-xs font-medium text-primary-600 transition active:scale-[0.99]">
            <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V3M4.5 6.5L8 3l3.5 3.5" /><path d="M3 11.5V13a1 1 0 001 1h8a1 1 0 001-1v-1.5" /></svg>
            <span>从本地导入音频（mp3 / m4a / wav 等）</span>
            <input type="file" accept="audio/*" class="hidden" data-listen-import @change="onListenPick" />
          </label>

          <!-- L2：空闲槽建议时段（哪些空档能放几段） -->
          <div v-if="listenClips.length" data-listen-slots class="mt-3 rounded-xl bg-soft px-3 py-2.5">
            <p v-if="listenSuggestions.suggestions.length" class="text-[11px] font-medium text-ink-dim">
              今天可听：{{ listenSuggestions.suggestions.reduce((n, s) => n + s.take, 0) }} 段，挑这些空档去听
            </p>
            <ul v-if="listenSuggestions.suggestions.length" class="mt-1 space-y-0.5">
              <li v-for="(s, i) in listenSuggestions.suggestions" :key="i" class="text-[11px] text-ink-dim">
                {{ s.start }}–{{ s.end }} · {{ s.mins }} 分钟 · {{ s.kind === 'short' ? '短槽' : '可多段' }} → 放 {{ s.take }} 段
              </li>
            </ul>
            <p v-else-if="listenSuggestions.due.length" class="text-[11px] text-ink-dim">
              今天待复习 {{ listenSuggestions.due.length }} 段，但课表已排满 / 空档小于 5 分钟——自己找时间听
            </p>
            <p v-else class="text-[11px] text-ink-dim">
              今天没有到期的音频；列表里 {{ listenClips.length }} 段都排在未来
            </p>
          </div>

          <ul v-if="listenClips.length" class="mt-3 divide-y divide-line border-t border-line">            <li v-for="c in listenClips" :key="c.id" class="py-2.5">
              <div class="flex items-center gap-3">
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[13px] font-medium">{{ c.name }}</span>
                  <span class="block text-[11px] text-ink-dim">
                    已听 {{ c.played_count }} 次 · {{ fmtSeconds(c.seconds) }} · {{ listenStageLabel(c) }}<template v-if="listenPlayId === c.id && listenPlayTotal > 1"> · <span class="font-medium text-primary-600" data-listen-round>第 {{ listenPlayRound }}/{{ listenPlayTotal }} 遍</span></template>
                  </span>
                </span>
                <button
                  class="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium transition active:scale-95"
                  :class="listenPlayId === c.id && !listenPaused ? 'bg-primary-500 text-white' : 'bg-primary-50 text-primary-500'"
                  data-listen-play
                  @click="onListenPlay(c)"
                >
                  {{ listenPlayId === c.id ? (listenPaused ? '继续' : '停止') : '播放' }}
                </button>
              </div>
            </li>
          </ul>
          <p v-else class="mt-3 rounded-xl bg-soft px-3 py-2.5 text-[11px] text-ink-dim">
            还没有音频。导入一段（20 秒–1 分钟最合适），当天就可以开始听。
          </p>

          <p v-if="listenClips.length && !listenIsApp" class="mt-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-500">
            浏览器里音频字节不落盘：刷新后要重新导入（听过的次数与复习排期会保留）。
          </p>
          <p v-if="listenMsg" class="mt-2 text-[11px]" :class="listenMsgBad ? 'text-red-600 dark:text-red-400' : 'text-primary-600'">{{ listenMsg }}</p>
        </template>
      </section>
</template>
