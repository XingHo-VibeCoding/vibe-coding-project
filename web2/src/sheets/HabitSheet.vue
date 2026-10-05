<script setup>
/* Stage 9：打卡浮层（原「打卡」tab 改成的底部浮层）。 */
import { useApp } from '../composables/app-ctx.js'
import BottomSheet from '../components/BottomSheet.vue'
/* streakOf / totalDoneOf 是 data/store.js 的模块函数（不是 App 的顶层绑定，进不了 APP_CTX），
   原来在 App.vue 里靠 <script setup> 作用域直接给模板用，搬进子组件要自己引一次。 */
import { streakOf, totalDoneOf } from '../data/store.js'

const app = useApp()
</script>

<template>
  <!-- 打卡浮层（2026-10-03 方案 C Step 1：原「打卡」tab 改为底部浮层）
       宽限期 = 本周内且今天之前（口径见 data/store.js）；过期/未来格子画成锁定态，
       但**不用 disabled**（那样点下去毫无反馈还挡测试），改由 onHabitCell 静默忽略。 -->
  <BottomSheet
    :open="!!app.habitSheet"
    sheet-attr="data-habit-sheet"
    mask-attr="data-habit-sheet-mask"
    panel-class="px-4 pt-3 pb-10"
    @close="app.habitSheet = false"
  >
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-lg font-bold text-ink">打卡</h2>
      <button
        type="button"
        data-habit-sheet-close
        class="rounded-full bg-soft px-3 py-1 text-xs font-medium text-ink-dim transition active:scale-95"
        @click="app.habitSheet = false"
      >关闭</button>
    </div>
    <div class="space-y-4">
  <!-- 今日完成度 -->
  <section class="rounded-3xl border border-line bg-card p-5 shadow-sm">
    <div class="flex items-end justify-between">
      <div>
        <p class="text-xs text-ink-dim">{{ app.habitTodayText }}</p>
        <p class="mt-1 text-2xl font-bold tabular-nums text-ink">
          {{ app.habitTodayDone }}<span class="text-base font-semibold text-ink-dim"> / {{ app.habits.length }}</span>
        </p>
      </div>
      <p class="pb-1 text-xs text-ink-dim">今日已打卡</p>
    </div>
    <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-soft-2">
      <div
        class="h-full rounded-full bg-primary-500 transition-all duration-300"
        :style="{ width: app.habits.length ? (app.habitTodayDone / app.habits.length) * 100 + '%' : '0%' }"
      />
    </div>
  </section>

  <!-- 打卡记录：周切换 + 习惯卡片 -->
  <section>
    <div class="mb-2 flex items-center justify-between px-1">
      <h2 class="text-sm font-semibold text-ink">打卡记录</h2>
      <button
        class="rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-ink-dim transition active:scale-95"
        @click="app.habitInput = !app.habitInput; app.habitName = ''"
      >
        {{ app.habitInput ? '收起' : '＋ 添加' }}
      </button>
    </div>

    <!-- 周切换：只能往回看（未来没有记录），最多 52 周 -->
    <div class="mb-2 flex items-center justify-between rounded-2xl border border-line bg-card px-1.5 py-1.5 shadow-sm">
      <button
        type="button"
        data-habit-prev
        class="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-ink-dim transition active:scale-90 disabled:opacity-25"
        :disabled="app.habitWeekBase <= -52"
        aria-label="看上一周"
        @click="app.shiftHabitWeek(-1)"
      >‹</button>
      <div class="text-center">
        <p class="text-xs font-medium text-ink tabular-nums">{{ app.habitWeekLabel }}</p>
        <p class="text-[10px]" :class="app.habitWeekBase === 0 ? 'text-primary-600' : 'text-ink-dim'">
          {{ app.habitWeekBase === 0 ? '本周 · 漏卡可补' : (app.habitWeekBase === -1 ? '上周' : -app.habitWeekBase + ' 周前') + ' · 已锁定' }}
        </p>
      </div>
      <button
        type="button"
        data-habit-next
        class="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-ink-dim transition active:scale-90 disabled:opacity-25"
        :disabled="app.habitWeekBase >= 0"
        aria-label="看下一周"
        @click="app.shiftHabitWeek(1)"
      >›</button>
    </div>

    <!-- 添加行：行内输入，回车即提交 -->
    <div v-if="app.habitInput" class="mb-2 flex gap-2 rounded-2xl border border-line bg-card p-3 shadow-sm">
      <input
        v-model="app.habitName"
        type="text"
        maxlength="20"
        placeholder="习惯名，如：背单词"
        enterkeyhint="done"
        class="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-dim focus:border-primary-400"
        @keyup.enter="app.addHabitConfirm"
      />
      <button
        class="shrink-0 rounded-xl bg-primary-500 px-4 text-sm font-medium text-white transition active:scale-95 disabled:opacity-40"
        :disabled="!app.habitName.trim()"
        @click="app.addHabitConfirm"
      >
        确定
      </button>
    </div>

    <!-- 习惯卡片：名称 + 连续/累计 + 本周格（可补）+ 今日圆圈 + 删除 -->
    <div v-if="app.habits.length" class="space-y-2">
      <div
        v-for="h in app.habits"
        :key="h.id"
        :data-habit-row="h.id"
        class="rounded-2xl border border-line bg-card p-3.5 shadow-sm"
      >
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm" :class="h.records[app.habitToday] ? 'text-ink-dim' : 'text-ink'">{{ h.name }}</p>
            <p class="mt-0.5 text-[11px] text-ink-dim">
              <span :data-habit-streak="h.id">{{ streakOf(h, app.habitToday) > 0 ? '连续 ' + streakOf(h, app.habitToday) + ' 天' : '未开始' }}</span>
              <span class="mx-1 text-ink-dim/40">·</span>
              <span :data-habit-total="h.id">共 {{ totalDoneOf(h) }} 天</span>
            </p>
          </div>
          <!-- 今日打卡主操作：h-11 = 44px 热区；已打卡实心勾（可点取消） -->
          <button
            type="button"
            :data-habit-today="h.id"
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-90"
            :class="h.records[app.habitToday] ? 'bg-primary-500 text-white' : 'border-2 border-ink-dim/30 text-ink-dim/40'"
            :aria-label="h.records[app.habitToday] ? '取消今日打卡' : '今日打卡'"
            @click="app.toggleHabit(h.id)"
          >
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <!-- 删除：两段式确认 -->
          <button
            type="button"
            class="h-8 w-8 shrink-0 text-xs transition active:scale-90"
            :class="app.habitDelId === h.id ? 'font-bold text-red-600 dark:text-red-400' : 'text-ink-dim/40'"
            :aria-label="app.habitDelId === h.id ? '确认删除该习惯' : '删除习惯'"
            @click="app.onHabitDelete(h.id)"
          >
            {{ app.habitDelId === h.id ? '确认' : '✕' }}
          </button>
        </div>

        <!-- 本周 7 格：实心=当天打的 · 空心勾=事后补的 · 虚线圈=宽限期内可补 · 淡=锁定/未来 -->
        <div class="mt-3 grid grid-cols-7 gap-1">
          <button
            v-for="d in app.habitViewDays"
            :key="d.key"
            type="button"
            :data-habit-cell="h.id + '@' + d.key"
            :data-cell-state="app.habitCellState(h, d)"
            class="flex flex-col items-center gap-1 rounded-xl py-1.5 transition active:scale-95"
            @click="app.onHabitCell(h.id, d.key)"
          >
            <span class="text-[10px] leading-none" :class="d.isToday ? 'font-semibold text-primary-600' : 'text-ink-dim'">{{ d.name }}</span>
            <span
              class="flex h-6 w-6 items-center justify-center rounded-full text-[10px] tabular-nums"
              :class="app.HABIT_CELL_CLS[app.habitCellState(h, d)]"
            >
              <svg v-if="h.records[d.key]" viewBox="0 0 10 10" class="h-2.5 w-2.5" fill="none"><path d="M2 5.2l2 2 4-4.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
              <template v-else>{{ d.day }}</template>
            </span>
          </button>
        </div>
      </div>

      <!-- 图例：补卡是这一轮新增的视觉态，不解释一下没人看得懂 -->
      <p class="px-1 pt-1 text-[11px] leading-relaxed text-ink-dim">
        <span class="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-primary-500 align-[-1px]" />当天打卡
        <span class="mx-1 inline-block h-2.5 w-2.5 rounded-full border border-primary-400 bg-primary-50 align-[-1px]" />事后补卡
        <span class="mx-1 inline-block h-2.5 w-2.5 rounded-full border border-dashed border-primary-300 align-[-1px]" />可补
        <span class="ml-1 inline-block h-2.5 w-2.5 rounded-full bg-soft-2 align-[-1px]" />已锁定
      </p>
    </div>
    <p v-else class="rounded-2xl border border-dashed border-line bg-card/60 p-5 text-center text-sm text-ink-dim">
      还没有打卡习惯，点「＋ 添加」建一个
    </p>
  </section>

    </div>
  </BottomSheet>
</template>
