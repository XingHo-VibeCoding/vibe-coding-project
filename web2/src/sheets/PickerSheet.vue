<script setup>
/* Stage 9：共享 picker 弹层（日期月历 / 时间滚轮 / 数字滚轮）。
   原来是 App.vue 里的内联块，现在搬出来；状态仍由 App 持有，这里用 useApp() 取。 */
import { ref } from 'vue'
import MonthCalendar from '../components/MonthCalendar.vue'
import NumberWheel from '../components/NumberWheel.vue'
import TimeWheel from '../components/TimeWheel.vue'
import { useApp } from '../composables/app-ctx.js'

const app = useApp()

/* 滚轮的当前值只能从组件实例上读，所以 ref 跟着弹层走；
   确认逻辑仍在 App（pickerConfirm(wheel)），避免两处各有一份「确认后干什么」。 */
const pickerRef = ref(null)
function confirmPick() {
  app.pickerConfirm(pickerRef.value)
}
</script>

<template>
  <Transition name="fade">
    <!-- z-[90]：picker 是所有弹层里最靠上的一层。原先 z-40/z-50，从「教务核对页」（z-[70]）里
         开月历/滚轮会被它整个盖住 —— 从引导页登录教务、抓完课表就在那一页选开学时间。
         这里是共享弹层，索性一次抬到最高，免得以后再出现「谁在谁上面」。 -->
    <div v-if="app.picker" data-picker-mask class="fixed inset-0 z-[90] bg-black/40" @click="app.picker = null"></div>
  </Transition>
  <Transition name="slide">
    <div
      v-if="app.picker"
      class="fixed inset-x-0 bottom-0 z-[90] mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"
    >
      <div class="mx-auto mb-3 h-1 w-9 rounded-full bg-soft-2"></div>
      <div class="mb-3 flex items-center justify-between">
        <button data-picker-cancel class="rounded-lg px-2 py-1 text-sm text-ink-dim transition active:bg-soft-2" @click="app.picker = null">取消</button>
        <p class="text-sm font-bold text-ink">{{ app.picker.title || (app.picker.type === 'date' ? '选择日期' : app.picker.type === 'number' ? '选择数值' : '选择时间') }}</p>
        <button data-picker-ok class="rounded-lg px-2 py-1 text-sm font-semibold text-primary-600 transition active:bg-primary-50" @click="confirmPick">确定</button>
      </div>
      <MonthCalendar
        v-if="app.picker.type === 'date'"
        v-model="app.picker.value"
        :restrict-monday="app.picker.restrictMonday"
      />
      <NumberWheel v-else-if="app.picker.type === 'number'" ref="pickerRef" :model-value="app.picker.value" :min="app.picker.min" :max="app.picker.max" :step="app.picker.step" :unit="app.picker.unit" />
      <TimeWheel v-else ref="pickerRef" :model-value="app.picker.value" />
    </div>
  </Transition>
</template>
