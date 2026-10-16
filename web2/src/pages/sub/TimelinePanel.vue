<script setup>
import { toRefs } from 'vue'
import { useApp } from '../../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  timelineData,
  usageState,
  openUsagePermission,
} = toRefs(app)
</script>

<template>
  <!-- 03 时间去哪了（2026-10-16）：把最近 7 天已经记下的几件事摆到同一条横轴上。
       三条界面纪律（与数据层 timeline.js 同一套）：
         · 只呈现不评判 —— 不排名、不打分、不写「手机玩多了」；数字本身已经足够说明问题。
         · 不假装完整 —— 那天没抓到手机时长就写「未开启」，**绝不画成 0**。
         · 不催 —— 没开权限只在底部安静地说一句怎么开，不弹窗、不挡路。 -->
  <p data-timeline-line class="px-1 text-[12px] leading-relaxed text-ink-dim">{{ timelineData.line }}</p>

  <section v-if="timelineData.days.length" class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm" data-timeline-card>
    <div v-for="d in timelineData.days" :key="d.date" class="px-4 py-3" :data-timeline-day="d.date">
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-sm font-medium">{{ d.label }}</span>
        <span
          class="shrink-0 text-[11px]"
          :class="d.usageKnown ? 'text-ink-dim' : 'text-ink-dim/70'"
          :data-timeline-usage="d.usageKnown ? 'known' : 'unknown'"
        >手机 {{ d.usageText }}</span>
      </div>
      <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-dim">
        <span v-if="d.courses">课 {{ d.courses }} 节</span>
        <span v-if="d.todosTotal">待办 {{ d.todosDone }} / {{ d.todosTotal }}</span>
        <span v-else-if="d.todosDone">做完 {{ d.todosDone }} 件</span>
        <span v-if="d.habitsTotal">打卡 {{ d.habitsDone }} / {{ d.habitsTotal }}</span>
        <span v-if="d.listened">练耳 {{ d.listened }} 段</span>
        <span v-if="!d.courses && !d.todosTotal && !d.todosDone && !d.habitsTotal && !d.listened">这天没记下课与待办</span>
      </div>
    </div>
  </section>
  <p v-else class="rounded-2xl border border-dashed border-line bg-card/60 p-6 text-center text-sm text-ink-dim" data-timeline-empty>
    还没有攒下记录，用几天就会出现。
  </p>

  <p v-if="timelineData.usage.missing > 0" data-timeline-usage-hint class="px-1 text-[11px] leading-relaxed text-ink-dim">
    <template v-if="!usageState.granted">手机时长有几天没抓到 —— 开了「使用情况访问权限」才会有。</template>
    <template v-else>手机时长有几天没抓到，这几天不参与平均。</template>
  </p>
  <button
    v-if="!usageState.granted && usageState.supported"
    type="button"
    data-timeline-grant
    class="self-start rounded-full bg-soft-2 px-3 py-1.5 text-[11px] text-ink"
    @click="openUsagePermission"
  >去开启手机时长</button>
</template>
