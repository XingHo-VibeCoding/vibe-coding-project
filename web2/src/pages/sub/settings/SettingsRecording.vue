<script setup>
import { toRefs } from 'vue'
import DropdownSelect from '../../../components/DropdownSelect.vue'
import { useApp } from '../../../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  llmCfg,
  llmInputOpen,
  PROVIDER_OPTIONS,
  llmReady,
  onLlmProvider,
  onLlmKey,
  llmTest,
  llmModels,
  testLlm,
  recSupported,
} = toRefs(app)
</script>

<template>
      <section class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
        <!-- 课堂纪要（M4）：LLM 配置。key 只存本机 localStorage，不进导出、不经手上传 -->
        <div class="p-4">
          <button
            type="button"
            class="flex w-full items-center gap-3.5 text-left active:bg-soft"
            @click="llmInputOpen = !llmInputOpen"
          >
            <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
              <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.5l1.8 3.7 4 .6-2.9 2.8.7 4L8 10.7l-3.6 1.9.7-4L2.2 5.8l4-.6z" /><path d="M8 13.5v1.5" /></svg>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">课堂纪要</span>
              <span class="block text-[11px] text-ink-dim">{{ llmReady ? '已配置，可在录音场次一键生成' : '把文字稿交给 AI 总结成复习纪要' }}</span>
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
              <span class="mb-1 block text-[11px] text-ink-dim">DeepSeek API Key（只存本机）</span>
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
              Key 在 platform.deepseek.com 申请；一次纪要只要几分钱。配置只存本机，换设备要重填。
            </p>
          </div>
        </div>

        <!-- 后台录音说明（仅 App 平台：网页版没有前台服务，属于 M2.5 原生能力） -->
        <div v-if="recSupported" class="flex items-start gap-3.5 p-4">
          <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2a3.5 3.5 0 00-3.5 3.5c0 3-1.5 4-1.5 4h10s-1.5-1-1.5-4A3.5 3.5 0 008 2z" /><path d="M6.5 12.5a1.6 1.6 0 003 0" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">后台录音</span>
            <span class="block text-[11px] leading-relaxed text-ink-dim">
              锁屏、切到别的应用都会继续录，通知栏有一条「正在录音」。看不到就去系统设置里打开通知权限，否则后台更容易被系统清掉。
            </span>
          </span>
        </div>
      </section>
</template>
