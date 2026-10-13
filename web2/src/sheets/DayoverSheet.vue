<script setup>
/* 特殊日期（调休）浮层 —— 2026-10-12 从「设置」搬到周课表页右上 ＋ 选单。
   为什么搬：它是**看课表时才会想起来改**的东西（今天怎么没课 / 周六怎么有课），
   埋在设置最底一屏之外，用户找不着；放进 ＋ 选单就和「加课 / 加日程」站在同一处。

   markup 是从原 web2/src/pages/sub/SettingsPanel.vue（HEAD 版 :207-296）逐字搬过来的，
   绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。

   这一栏**独立落盘、改完立即生效**（不跟学期设置的「保存」绑一起）：
   用户是边看课表边改的，要求「改完马上能在今日页看到对不对」。 */
import { toRefs } from 'vue'
import BottomSheet from '../components/BottomSheet.vue'
import { useApp } from '../composables/app-ctx.js'

const app = useApp()
const {
  dayoverSheet,
  dayOverrides,
  addDayOverride,
  patchDayOverride,
  removeDayOverride,
  WEEKDAY_CN,
  KIND_OPTIONS,
  holidayMsg,
  holidayBusy,
  refreshHolidaysNow,
  openDateField,
} = toRefs(app)

/* 日期显示成「10 月 13 日 周二」——原生 <input type="date"> 自带这个格式化，换成按钮后得自己写。
   WEEKDAY_CN 是 1..7 的「一二三四五六日」，与 Date.getDay()（0=周日）差一位。 */
function dayoverLabel(date) {
  const d = new Date(date + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return date
  const wd = d.getDay() === 0 ? 7 : d.getDay()
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${WEEKDAY_CN[wd - 1]}`
}
/* 改这一条的日期：**必须**走项目自己的月历（不用原生 <input type="date">）。
   2026-10-13 用户口径：原生控件在手机上长得跟 App 两样，全项目统一换成自做弹层。
   注意 patchDayOverride 按「旧日期」当 key 匹配（map 里 x.date !== date 比对），
   所以要把旧 date 闭包带进来，不能直接用新的。 */
function pickDayoverDate(ov) {
  openDateField.value({
    value: ov.date,
    onDone: (v) => {
      if (!v || v === ov.date) return
      patchDayOverride(ov.date, { date: v })
    },
  })
}
</script>

<template>
  <BottomSheet
    :open="dayoverSheet"
    sheet-attr="data-sheet-dayover"
    @close="dayoverSheet = false"
  >
    <p class="text-base font-bold">特殊日期</p>
    <p class="mt-1.5 text-[11px] leading-relaxed text-ink-dim">
      放假 / 补课 / 只提示。放假 = 这天没课；补课 = 这天按你选的星期上课；只提示 = 挂个说明，课照上。
    </p>

    <div class="mt-4 flex gap-2.5">
      <button
        type="button"
        data-dayover-add
        class="shrink-0 rounded-xl bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
        @click="addDayOverride"
      >＋ 添加</button>
      <button
        type="button"
        data-dayover-refresh
        class="min-w-0 flex-1 rounded-xl border border-line py-2.5 text-xs font-medium text-ink-dim transition active:scale-[0.99] disabled:opacity-50"
        :disabled="holidayBusy"
        @click="refreshHolidaysNow"
      >{{ holidayBusy ? '正在更新…' : '从网上更新法定节假日' }}</button>
    </div>
    <p class="mt-2 text-[11px] leading-relaxed text-ink-dim">
      只自动填「放假」。政府公告只说哪天放假、不说补哪天的课，所以
      <span class="font-medium text-ink">补课日的星期要你自己选</span>（打开 App 时会自动更新一次，不打扰你）。
    </p>
    <p v-if="holidayMsg" data-dayover-refresh-msg class="mt-2 text-[11px] text-primary-600">{{ holidayMsg }}</p>

    <p v-if="!dayOverrides.length" data-dayover-empty class="mt-4 rounded-xl border border-dashed border-line bg-canvas p-4 text-center text-xs text-ink-dim">
      还没有特殊日期。放假/补课的日子在这里加，或者直接点上面的「从网上更新」。
    </p>

    <div v-else class="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-canvas">
      <div v-for="ov in dayOverrides" :key="ov.date" :data-dayover-row="ov.date" class="p-3.5">
        <div class="flex items-center gap-2">
          <!-- 日期：自做月历（2026-10-13 从原生 <input type="date"> 换过来） -->
          <button
            type="button"
            :data-dayover-date="ov.date"
            class="min-w-0 flex-1 truncate rounded-xl border border-line bg-card px-2.5 py-2 text-left text-sm tabular-nums transition active:scale-[0.99]"
            @click="pickDayoverDate(ov)"
          >{{ dayoverLabel(ov.date) }}</button>
          <button
            type="button"
            :data-dayover-del="ov.date"
            class="shrink-0 rounded-full bg-soft px-3 py-2 text-xs font-medium text-red-600 transition active:scale-95 dark:text-red-400"
            @click="removeDayOverride(ov.date)"
          >删除</button>
        </div>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <button
            v-for="k in KIND_OPTIONS"
            :key="k.key"
            type="button"
            :data-dayover-kind="ov.date + ':' + k.key"
            class="rounded-full px-3 py-1.5 text-xs transition active:scale-95"
            :class="ov.kind === k.key ? 'bg-primary-500 font-semibold text-white' : 'bg-soft text-ink-dim'"
            @click="patchDayOverride(ov.date, { kind: k.key })"
          >{{ k.label }}</button>
        </div>
        <!-- 补课：选「按星期几的课表上」。这是整件事里唯一需要人判断的地方（见上面说明） -->
        <div v-if="ov.kind === 'swap'" class="mt-2 flex flex-wrap items-center gap-1.5">
          <span class="text-[11px] text-ink-dim">按</span>
          <button
            v-for="(cn, i) in WEEKDAY_CN"
            :key="i"
            type="button"
            :data-dayover-wd="ov.date + ':' + (i + 1)"
            class="h-7 w-7 rounded-full text-xs transition active:scale-95"
            :class="Number(ov.useWeekday) === i + 1 ? 'bg-primary-500 font-semibold text-white' : 'bg-soft text-ink-dim'"
            @click="patchDayOverride(ov.date, { useWeekday: i + 1 })"
          >{{ cn }}</button>
          <span class="text-[11px] text-ink-dim">的课表上</span>
        </div>
        <input
          :value="ov.note"
          :data-dayover-note="ov.date"
          placeholder="说明（可不填）：国庆放假 / 补周五"
          class="mt-2 w-full rounded-xl border border-line bg-card px-2.5 py-2 text-[13px] outline-none focus:border-primary-400"
          @change="(e) => patchDayOverride(ov.date, { note: e.target.value })"
        />
      </div>
    </div>
  </BottomSheet>
</template>
