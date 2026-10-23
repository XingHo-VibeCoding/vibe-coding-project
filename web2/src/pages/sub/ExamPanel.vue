<script setup>
/* 考试与复习（五条新功能线 04，2026-10-16）
   用户 m24447：「我想看到接下来的考试安排以及复习时间安排，最好催我复习」。
   教务导出的 xlsx 里**没有考试列** ⇒ 考试只能人手加，所以这一页的重心是
   「加得足够顺手」+「排出来的复习时间能直接用」。

   三条界面纪律（与数据层 exams.js 同一套）：
     · 只建议不落库 —— 复习时段是建议，不自动写课表、不自动建待办。
     · 不假装完整 —— 没排下就明说「这几天没空档」，不编一个假安排。
     · 不评判 —— 写「还有 3 天」「今天建议复习 19:00–19:30」，
       绝不写「你怎么还不复习」「再不看就来不及了」。 */
import { computed, toRefs } from 'vue'
import { useApp } from '../../composables/app-ctx.js'
import { examMetaText, REVIEW_BLOCK_MIN } from '../../data/exams.js'

const app = useApp()
const {
  examPlan,
  examText,
  examSettings,
  examForm,
  examErr,
  examMsg,
  examConfirmDel,
  openExamAdd,
  openExamEdit,
  submitExam,
  onDeleteExam,
  toggleExamNotify,
  setExamAt,
  openDateField,
  openTimeField,
  reviewAdviceLine,
  WEEKDAY_CN,
} = toRefs(app)

/* ---------- 今晚这一段（S4）----------
   用户 m00554：「复习时间可以先划出整块时间，然后让 ai 给出复习建议，就不用严格划分了」。
   所以这块卡只做两件事：说清「几点到几点」+ 把 AI 那句「先看哪门」原样摆出来。
   三条界面纪律：
     · 时间由程序算，AI 只说先看哪门 —— 不让模型编时段，编出来的时段用户照着做会撞课。
     · 没有那句就不留空位 —— 没配 Key / 断网 / 说错天数时不显示这一行，卡片本身照常。
     · 不评判 —— 那句话的收尾在 data/reviewAdvice.js 里已经过滤过催促词，这里只渲染。 */
const todayBlock = computed(() => (examPlan.value && examPlan.value.todayReview) || null)
/* 「先看 高等数学（还有 3 天）· 这段还有 2 场要准备」——只报事实，不排优先级之外的话 */
const todayWho = computed(() => {
  const b = todayBlock.value
  if (!b || !Array.isArray(b.exams) || !b.exams.length) return ''
  const first = b.exams[0]
  const rest = b.exams.length - 1
  return '先看 ' + first.title + '（' + first.text + '）' + (rest > 0 ? ' · 这段还有 ' + rest + ' 场要准备' : '')
})

/* ⚠ WEEKDAY_CN 是从 toRefs(app) 接出来的 ref，在这个普通函数里必须 .value 取数组，
   写 `WEEKDAY_CN[i]` 会得到 undefined（模板里才会自动解包）。 */
function wdCn(date) {
  const d = new Date(date + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return ''
  const list = WEEKDAY_CN.value || []
  return list[d.getDay() === 0 ? 6 : d.getDay() - 1] || ''
}
function dateLabel(date) {
  const d = new Date(date + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return date
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${wdCn(date)}`
}
/* 复习建议按天列：一天可能给两场考试各排一块，所以按日期合并。 */
function reviewDays(e) {
  const map = []
  for (const b of e.blocks) {
    let row = map.find((x) => x.date === b.date)
    if (!row) { row = { date: b.date, times: [] }; map.push(row) }
    row.times.push(b.time)
  }
  return map
}
</script>

<template>
  <!-- 一句话总结：没有考试整块不出现 -->
  <p v-if="examText" data-exam-line class="px-1 text-[12px] leading-relaxed text-ink-dim">{{ examText }}</p>
  <p v-else data-exam-line class="px-1 text-[12px] leading-relaxed text-ink-dim">
    还没有加考试。加完之后这里会列出考试安排，并给出考前几天的复习时间。
  </p>

  <!-- 今晚这一段：整块时间 + AI 一句「先看哪门」。
       只在「今天真排下了一段」时出现；没有就整块不出现，不占地方。 -->
  <section v-if="todayBlock" data-exam-today class="mt-3 rounded-2xl border border-line bg-card p-3.5 shadow-sm">
    <div class="flex items-baseline justify-between gap-3">
      <span class="min-w-0 text-sm font-semibold text-ink">今晚留给复习</span>
      <span data-exam-today-time class="shrink-0 text-[12px] font-medium tabular-nums text-primary-600">{{ todayBlock.time }}</span>
    </div>
    <p data-exam-today-who class="mt-1 text-[11.5px] leading-relaxed text-ink-dim">{{ todayWho }}</p>
    <p
      v-if="reviewAdviceLine"
      data-exam-advice
      class="mt-2 rounded-xl bg-canvas px-3 py-2 text-[12.5px] leading-relaxed text-ink"
    >{{ reviewAdviceLine }}</p>
  </section>

  <div class="mt-3 flex gap-2.5">
    <button
      type="button"
      data-exam-add
      class="shrink-0 rounded-xl bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
      @click="openExamAdd"
    >＋ 添加考试</button>
    <div class="min-w-0 flex-1"></div>
  </div>

  <p v-if="examMsg" data-exam-msg class="mt-2.5 text-[11px] leading-relaxed text-primary-600">{{ examMsg }}</p>

  <p v-if="!examPlan.exams.length" data-exam-empty class="mt-4 rounded-2xl border border-dashed border-line bg-card/60 p-6 text-center text-sm text-ink-dim">
    还没有考试。配过课表直连（勾了记住密码）的话，打开 App 会自动从教务网同步；也可以在这里自己加。
  </p>

  <section v-else data-exam-list class="mt-3 space-y-2.5">
    <div
      v-for="e in examPlan.exams"
      :key="e.id"
      :data-exam-item="e.id"
      class="rounded-2xl border border-line bg-card p-3.5 shadow-sm"
    >
      <div class="flex items-baseline justify-between gap-3">
        <span class="min-w-0 truncate text-sm font-medium">{{ e.title }}</span>
        <span :data-exam-countdown="e.id" class="shrink-0 text-[11px]" :class="e.soon ? 'font-medium text-primary-600' : 'text-ink-dim'">{{ e.text }}</span>
      </div>
      <p :data-exam-when="e.id" class="mt-1 text-[11px] tabular-nums text-ink-dim">{{ dateLabel(e.date) }}<template v-if="examMetaText(e)"> · {{ examMetaText(e) }}</template></p>

      <!-- 复习时间安排：只有「快到了」的考试才给（还有 25 天就开始每天排不合理） -->
      <div v-if="e.soon && e.blockCount" :data-exam-review="e.id" class="mt-2 rounded-xl bg-canvas p-2.5">
        <p class="text-[11px] font-medium text-ink">考前 {{ e.blockCount }} 天各留 {{ REVIEW_BLOCK_MIN }} 分钟 · 共 {{ e.reviewMins }} 分钟</p>
        <p v-for="r in reviewDays(e)" :key="r.date" class="mt-0.5 text-[11px] tabular-nums text-ink-dim">
          {{ dateLabel(r.date) }} · {{ r.times.join(' / ') }}
        </p>
      </div>
      <p v-else-if="e.soon" :data-exam-review="e.id" class="mt-2 rounded-xl bg-canvas p-2.5 text-[11px] text-ink-dim">
        考前这几天没找到空档，先把课表上的安排过一遍。
      </p>

      <div class="mt-2 flex items-center gap-2">
        <button
          type="button"
          :data-exam-edit="e.id"
          class="rounded-full bg-soft px-3 py-1.5 text-xs font-medium text-ink transition active:scale-95"
          @click="openExamEdit(e)"
        >编辑</button>
        <button
          v-if="e.daysLeft === 0"
          type="button"
          class="rounded-full bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-600"
        >今天考</button>
      </div>
    </div>
  </section>

  <!-- 每晚一句轻提醒（用户明确要「催我复习」，所以默认开着，也能关） -->
  <h3 class="mb-2 mt-5 px-1 text-sm font-semibold text-ink">考前提醒</h3>
  <section class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
    <button type="button" data-exam-notify class="flex w-full items-center justify-between gap-3 p-4 text-left transition active:bg-soft" @click="toggleExamNotify">
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium">每晚提醒我复习</span>
        <span class="block text-[11px] text-ink-dim">14 天内有考试才发；考试当天早上另发一条时间地点</span>
      </span>
      <span class="shrink-0 text-[11px] font-medium" :class="examSettings.enabled ? 'text-primary-600' : 'text-ink-dim'">{{ examSettings.enabled ? '已开' : '已关' }}</span>
    </button>
    <div v-if="examSettings.enabled" class="flex items-center gap-3 p-4">
      <span class="min-w-0 flex-1 text-sm">每天几点提醒</span>
      <button
        type="button"
        data-exam-at
        class="shrink-0 rounded-xl border border-line bg-canvas px-3 py-2 text-sm tabular-nums transition active:scale-[0.99]"
        @click="openTimeField({ value: examSettings.at, onDone: (v) => setExamAt(v) })"
      >{{ examSettings.at }}</button>
    </div>
  </section>

  <p class="mt-2 px-1 text-[11px] leading-relaxed text-ink-dim">
    复习时段是建议：从当天空档里挑一整段，优先晚上；先看哪门由 AI 说一句，说不出来就不显示。不会动你的课表和待办。
  </p>

  <!-- 添加 / 编辑考试 -->
  <div v-if="examForm" data-exam-form class="mt-4 rounded-2xl border border-line bg-card p-3.5 shadow-sm">
    <p class="text-sm font-semibold">{{ examForm.id ? '编辑考试' : '添加考试' }}</p>
    <div class="mt-3 space-y-2.5">
      <input
        v-model="examForm.title"
        data-exam-title
        placeholder="考哪一科？（必填）"
        class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
      />
      <button
        type="button"
        data-exam-date
        class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-left text-sm tabular-nums transition active:scale-[0.99]"
        @click="openDateField({ value: examForm.date, onDone: (v) => (examForm.date = v) })"
      >{{ examForm.date ? dateLabel(examForm.date) : '哪天考？（必填）' }}</button>
      <div class="flex gap-2.5">
        <button
          type="button"
          data-exam-start
          class="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-left text-sm tabular-nums transition active:scale-[0.99]"
          @click="openTimeField({ value: examForm.start, onDone: (v) => (examForm.start = v) })"
        >{{ examForm.start || '几点开始？（可选）' }}</button>
        <button
          type="button"
          data-exam-end
          class="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-left text-sm tabular-nums transition active:scale-[0.99]"
          @click="openTimeField({ value: examForm.end, onDone: (v) => (examForm.end = v) })"
        >{{ examForm.end || '几点结束？（可选）' }}</button>
      </div>
      <input
        v-model="examForm.place"
        data-exam-place
        placeholder="在哪考？（可选）"
        class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
      />
      <input
        v-model="examForm.note"
        data-exam-note
        placeholder="备注（可选）：开卷 / 带计算器"
        class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
      />
    </div>
    <p v-if="examErr" data-exam-err class="mt-2.5 text-xs text-red-600 dark:text-red-400">{{ examErr }}</p>
    <div class="mt-3 flex gap-2.5">
      <button
        v-if="examForm.id"
        type="button"
        data-exam-del
        class="rounded-xl border py-2.5 px-4 text-sm font-medium transition active:scale-[0.98]"
        :class="examConfirmDel ? 'border-red-400 bg-red-400/10 text-red-600 dark:text-red-400' : 'border-red-200 text-red-600 dark:text-red-400'"
        @click="onDeleteExam"
      >{{ examConfirmDel ? '再点一次确认' : '删除' }}</button>
      <button
        type="button"
        data-exam-cancel
        class="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
        @click="examForm = null"
      >取消</button>
      <button
        type="button"
        data-exam-submit
        class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
        @click="submitExam"
      >{{ examForm.id ? '保存修改' : '添加' }}</button>
    </div>
    <p class="mt-2 text-[11px] leading-relaxed text-ink-dim">时间可以不填，只记日期照样能在考试当天提醒你。</p>
  </div>
</template>
