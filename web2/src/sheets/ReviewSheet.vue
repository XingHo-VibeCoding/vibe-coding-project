<script setup>
import { toRefs } from 'vue'
import BottomSheet from '../components/BottomSheet.vue'
import { useApp } from '../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  MOODS,
  QUESTIONS,
  reviewSheet,
  reviewHistory,
  reviewMsg,
  reviewMsgBad,
  reviewStepTotal,
  weekdayLabelOf,
  moodLabelOf,
  closeReview,
  reviewSetAnswer,
  reviewNext,
  reviewBack,
  reviewAddTodo,
  undoneTodos,
  accountToday,
  accountHistory,
  dailyLineOf,
} = toRefs(app)
</script>

<template>
    <BottomSheet
      :open="!!reviewSheet"
      sheet-attr="data-sheet-review"
      @close="closeReview"
    >
      <template v-if="reviewSheet">
        <!-- 四题 -->
        <template v-if="reviewSheet.mode === 'ask'">
          <div class="flex items-baseline justify-between">
            <p class="text-base font-bold">今天收个尾</p>
            <span data-review-step class="text-[11px] text-ink-dim">{{ reviewSheet.step + 1 }} / {{ reviewStepTotal }}</span>
          </div>
          <div class="mt-2 flex gap-1">
            <span
              v-for="(q, i) in QUESTIONS"
              :key="q.key"
              class="h-1 flex-1 rounded-full"
              :class="i <= reviewSheet.step ? 'bg-primary-500' : 'bg-soft-2'"
            ></span>
          </div>

          <!-- 今天的账（六期）：先说账，再换你说；四题还是四题，只是顶上加了一张卡 -->
          <div v-if="reviewSheet.step === 0" data-account-card class="mt-3 rounded-xl bg-soft p-3">
            <p class="text-[13px] font-semibold">今天也结账啦～</p>
            <p data-account-say class="mt-1 text-[12px] text-ink">{{ accountToday.line }}</p>
            <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-soft-2">
              <span class="block h-full rounded-full bg-primary-500" :style="{ width: accountToday.pct + '%' }"></span>
            </div>
            <p data-account-sub class="mt-1.5 text-[11px] text-ink-dim">{{ accountToday.sub }}</p>
            <p v-if="accountToday.courses || accountToday.habitsTotal" class="mt-0.5 text-[11px] text-ink-dim">
              <span v-if="accountToday.courses">今天上了 {{ accountToday.courses }} 节课</span>
              <span v-if="accountToday.courses && accountToday.habitsTotal"> · </span>
              <span v-if="accountToday.habitsTotal">打卡 {{ accountToday.habitsDone }}/{{ accountToday.habitsTotal }}</span>
            </p>
            <p class="mt-2 text-[11px] text-ink-dim">今天主笔</p>
            <p data-account-lead class="text-[12px] text-ink">{{ accountToday.lead }}</p>
            <p v-if="!accountToday.baseline.enough" data-account-baseline class="mt-2 text-[11px] text-ink-dim">
              基线建立中 {{ accountToday.baseline.kept }} / {{ accountToday.baseline.need }} 天 · 攒够才说「比平时多还是少」
            </p>
          </div>

          <p data-review-q class="mt-4 text-sm font-semibold">{{ QUESTIONS[reviewSheet.step].title }}</p>
          <p class="mt-1 text-[11px] leading-relaxed text-ink-dim">{{ QUESTIONS[reviewSheet.step].hint }}</p>

          <!-- 今天状态：五档，点一下就答完 -->
          <div v-if="QUESTIONS[reviewSheet.step].kind === 'mood'" class="mt-4 flex items-center justify-between gap-2">
            <button
              v-for="m in MOODS"
              :key="m.v"
              :data-review-mood="m.v"
              class="flex flex-1 flex-col items-center gap-1 rounded-xl border py-2.5 transition active:scale-95"
              :class="reviewSheet.mood === m.v ? 'border-primary-500 bg-primary-50' : 'border-line'"
              @click="reviewSheet.mood = m.v"
            >
              <span class="text-lg leading-none">{{ m.emoji }}</span>
              <span class="text-[10px]" :class="reviewSheet.mood === m.v ? 'text-primary-600' : 'text-ink-dim'">{{ m.label }}</span>
            </button>
          </div>

          <!-- 没做完的：把未完成待办列出来，让「继续还是放掉」是有据可依的选择 -->
          <div v-else-if="QUESTIONS[reviewSheet.step].kind === 'keep'" class="mt-4">
            <div v-if="undoneTodos.length" class="mb-3 space-y-1.5 rounded-xl bg-soft p-3">
              <p v-for="t in undoneTodos" :key="t.id" class="truncate text-[12px] text-ink-dim">· {{ t.title }}</p>
            </div>
            <p v-else class="mb-3 rounded-xl bg-soft p-3 text-[12px] text-ink-dim">今天没有没做完的事，挺好。</p>
            <div class="flex items-center gap-2">
              <button
                v-for="c in ['明天接着做', '今天就到这儿']"
                :key="c"
                :data-review-keep="c"
                class="rounded-full px-3.5 py-1.5 text-xs font-medium transition active:scale-95"
                :class="reviewSheet.answers.keep === c ? 'bg-primary-500 text-white' : 'bg-soft text-ink'"
                @click="reviewSetAnswer('keep', c)"
              >{{ c }}</button>
            </div>
          </div>

          <!-- 自由文本两题 -->
          <textarea
            v-else
            data-review-input
            rows="3"
            class="mt-4 w-full rounded-xl border border-line bg-card p-3 text-[13px] leading-relaxed outline-none focus:border-primary-500"
            :placeholder="QUESTIONS[reviewSheet.step].placeholder || '写一句就行，不想写就跳过'"
            :value="reviewSheet.answers[QUESTIONS[reviewSheet.step].key]"
            @input="reviewSetAnswer(QUESTIONS[reviewSheet.step].key, $event.target.value)"
          ></textarea>

          <div class="mt-4 flex items-center gap-2">
            <button
              v-if="reviewSheet.step > 0"
              data-review-back
              class="rounded-xl bg-soft px-4 py-2.5 text-sm font-medium transition active:scale-95"
              @click="reviewBack"
            >上一步</button>
            <button
              data-review-skip
              class="rounded-xl bg-soft px-4 py-2.5 text-sm font-medium transition active:scale-95"
              @click="reviewNext"
            >跳过</button>
            <button
              data-review-next
              class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
              @click="reviewNext"
            >{{ reviewSheet.step + 1 >= reviewStepTotal ? '生成日精进' : '下一题' }}</button>
          </div>
        </template>

        <!-- 日精进（刚生成 / 看今天这篇） -->
        <template v-else-if="reviewSheet.mode === 'result'">
          <div class="flex items-baseline justify-between">
            <p class="text-base font-bold">今天的日精进</p>
            <span class="text-[11px] text-ink-dim">{{ reviewSheet.record.date }}</span>
          </div>
          <p v-if="dailyLineOf(reviewSheet.record.date)" data-account-line class="mt-1.5 text-[11px] text-primary-600">今天的账：{{ dailyLineOf(reviewSheet.record.date) }}</p>
          <p data-review-summary class="mt-3 whitespace-pre-line rounded-xl bg-soft p-3 text-[12.5px] leading-relaxed text-ink">{{ reviewSheet.record.summary }}</p>
          <p v-if="reviewMsg" data-review-msg class="mt-2.5 text-[11px]" :class="reviewMsgBad ? 'text-red-600 dark:text-red-400' : 'text-primary-600'">{{ reviewMsg }}</p>
          <div class="mt-4 flex items-center gap-2">
            <button
              data-review-todo
              class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
              @click="reviewAddTodo"
            >「明天最重要的一件事」转待办</button>
            <button
              data-review-done
              class="rounded-xl bg-soft px-4 py-2.5 text-sm font-medium transition active:scale-95"
              @click="closeReview"
            >完成</button>
          </div>
        </template>

        <!-- 日精进历史 -->
        <template v-else>
          <div class="flex items-baseline justify-between">
            <p class="text-base font-bold">日精进 · 全部</p>
            <span class="text-[11px] text-ink-dim">共 {{ accountHistory.length }} 天 · 只在本机</span>
          </div>
          <p v-if="!accountHistory.length" class="mt-3 text-[12.5px] leading-relaxed text-ink-dim">还没有复盘记录。从今天开始，每晚花 2 分钟收个尾。</p>
          <div v-else data-review-history-list class="mt-3 max-h-[58vh] space-y-2.5 overflow-y-auto">
            <div
              v-for="r in accountHistory"
              :key="r.date"
              data-review-history-item
              :data-account-history-item="r.record ? 'review' : 'snapshot'"
              class="rounded-xl border border-line p-3"
              :class="r.record ? '' : 'bg-soft'"
            >
              <div class="flex items-baseline justify-between">
                <span class="text-xs font-semibold">{{ r.date }}{{ weekdayLabelOf(r.date) ? ' · ' + weekdayLabelOf(r.date) : '' }}</span>
                <span class="text-[11px] text-ink-dim">{{ r.record ? moodLabelOf(r.record.mood) : '没做四题' }}</span>
              </div>
              <p v-if="r.line" data-account-history-line class="mt-1 text-[11px] text-primary-600">{{ r.line }}</p>
              <p v-if="r.record" class="mt-1.5 whitespace-pre-line text-[12px] leading-relaxed text-ink-dim">{{ r.record.summary }}</p>
              <p v-else class="mt-0.5 text-[11px] text-ink-dim">这天没结账，只留了数字。</p>
            </div>
          </div>
        </template>
      </template>
    </BottomSheet>
</template>
