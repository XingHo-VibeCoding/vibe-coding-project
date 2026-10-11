<script setup>
import { ref, watch, toRefs } from 'vue'
import BottomSheet from '../components/BottomSheet.vue'
import { useApp } from '../composables/app-ctx.js'
import { parseEventImage, parseEventText, eventParserAvailable } from '../data/eventParser.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  openDateField,
  openTimeField,
  evtForm,
  evtErr,
  evtWarn,
  submitEvent,
  DURATIONS,
  todayStr,
} = toRefs(app)

/* ---------- ✨ 智能填写（2026-10-12，用户 m05813 / m06155）----------
   两条路：拍照/选图（多模态）、粘贴文字。识别结果**只回填表单、不直接落库** ——
   日期时间是最容易出错的一环，让用户核对一遍再点「添加」。
   状态全放组件本地：它是这张表单自己的 UI，不进 APP_CTX（免得又添一个全局绑定）。 */
const smartOpen = ref(false) // 小选单展开
const textOpen = ref(false) // 文字面板展开
const smartBusy = ref(false)
const smartErr = ref('')
const smartHint = ref('') // 识别成功后的一句话交代（改了哪些字段 / 有什么拿不准）
const smartText = ref('')
const smartFile = ref(null)

/* 每次打开表单都回到干净状态（上次识别的提示不该串到这一次） */
watch(evtForm, (v) => {
  if (v) {
    smartOpen.value = false
    textOpen.value = false
    smartBusy.value = false
    smartErr.value = ''
    smartHint.value = ''
    smartText.value = ''
  }
})

function pickImage() {
  smartOpen.value = false
  const miss = eventParserAvailable()
  if (miss) { smartErr.value = miss; textOpen.value = false; return }
  smartErr.value = ''
  if (smartFile.value) smartFile.value.click()
}

function openText() {
  smartOpen.value = false
  smartErr.value = ''
  textOpen.value = true
}

/* 星期锚点：把 todayStr 换算成「几月几日 周几」写进提示词，「明天/下周三」才不会算错 */
function anchorWeekday() {
  const s = String(todayStr.value || '')
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return ''
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return '周' + '日一二三四五六'[d.getDay()]
}

/* 回填：**只覆盖识别到的字段**，没识别出来的保持原值。
   两条纪律（都是「宁可少填，不可填错」）：
   ① 解析层已把非法值（`2026-02-31` / `25:00`）置空 ⇒ 这里不会把坏值写进去；
   ② 没认出来时**不清空**用户已经选好的日期/时间 —— 但要在提示里点名
      「表单里现在还是 X」，否则用户看到日期栏里预填的「今天」会当成识别结果。 */
function fillForm(ev, warnings) {
  const f = evtForm.value
  if (!f) return
  if (ev.title) f.title = ev.title
  if (ev.date) f.date = ev.date
  if (ev.start) { f.start = ev.start }
  if (ev.duration) f.duration = ev.duration
  if (ev.place) f.place = ev.place
  const bits = []
  bits.push('已按识别结果填入：' + [ev.date, ev.start, ev.duration + '分钟', ev.place].filter(Boolean).join(' · '))
  bits.push('请核对后再点「添加」')
  smartHint.value = bits.join('；')
  const ws = (warnings || []).slice()
  if (!ev.date && f.date && ws.some((w) => w.indexOf('日期') !== -1)) ws.push('日期保留你原先选的 ' + f.date)
  if (!ev.start && f.start && ws.some((w) => w.indexOf('时间') !== -1)) ws.push('时间保留你原先选的 ' + f.start)
  if (ws.length) smartErr.value = '拿不准：' + ws.join('；')
  else smartErr.value = ''
}

async function onSmartFile(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = '' // 允许重复选同一张
  if (!file) return
  smartBusy.value = true
  smartErr.value = ''
  smartHint.value = ''
  try {
    const r = await parseEventImage(file, { today: todayStr.value, weekdayCN: anchorWeekday() })
    fillForm(r.event, r.warnings.concat(r.notes || []))
  } catch (err) {
    smartErr.value = err && err.message ? err.message : '识别失败，换张图再试。'
  } finally {
    smartBusy.value = false
  }
}

async function runText() {
  const src = String(smartText.value || '').trim()
  if (!src) { smartErr.value = '先粘贴或打一段话。'; return }
  smartBusy.value = true
  smartErr.value = ''
  smartHint.value = ''
  try {
    const r = await parseEventText(src, { today: todayStr.value, weekdayCN: anchorWeekday() })
    fillForm(r.event, r.warnings.concat(r.notes || []))
    textOpen.value = false
  } catch (err) {
    smartErr.value = err && err.message ? err.message : '识别失败，重试一次。'
  } finally {
    smartBusy.value = false
  }
}
</script>

<template>
    <BottomSheet
      :open="!!evtForm"
      sheet-attr="data-sheet-evt"
      @close="evtForm = null"
    >
      <div class="flex items-start justify-between gap-2">
        <p class="text-base font-bold">添加日程</p>
        <!-- 智能填写入口：表单里只多这一颗小按钮，两条路藏在选单里（用户 m06155 拍板） -->
        <div class="relative shrink-0">
          <button
            data-event-smart
            type="button"
            class="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-600 transition active:scale-95 dark:bg-primary-500/15 dark:text-primary-400"
            :disabled="smartBusy"
            @click="smartOpen = !smartOpen"
          >
            {{ smartBusy ? '识别中…' : '✨ 智能填写' }}
          </button>
          <div v-if="smartOpen" class="absolute right-0 top-8 z-10 w-36 overflow-hidden rounded-xl border border-line bg-card shadow-lg">
            <button
              data-event-smart-image
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-ink transition active:bg-soft"
              @click="pickImage"
            >
              📷 拍照 / 选图
            </button>
            <button
              data-event-smart-text
              type="button"
              class="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left text-sm text-ink transition active:bg-soft"
              @click="openText"
            >
              📝 粘贴文字
            </button>
          </div>
        </div>
      </div>

      <!-- 粘贴文字面板：识别完自动收起 -->
      <div v-if="textOpen" class="mt-3 rounded-xl border border-line bg-canvas p-3">
        <textarea
          data-event-smart-input
          v-model="smartText"
          rows="3"
          placeholder="把通知、群消息粘进来，如：后天下午三点开会，教二 110，大概一小时"
          class="w-full resize-none rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-primary-400"
        ></textarea>
        <div class="mt-2 flex gap-2">
          <button
            type="button"
            class="flex-1 rounded-lg border border-line py-2 text-xs font-medium text-ink-dim transition active:scale-[0.98]"
            @click="textOpen = false"
          >
            收起
          </button>
          <button
            data-event-smart-run
            type="button"
            class="flex-1 rounded-lg bg-primary-500 py-2 text-xs font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-60"
            :disabled="smartBusy"
            @click="runText"
          >
            {{ smartBusy ? '识别中…' : '识别并填写' }}
          </button>
        </div>
      </div>

      <p v-if="smartHint" data-event-smart-hint class="mt-2.5 rounded-xl border border-primary-300/40 bg-primary-400/10 px-3 py-2 text-xs text-primary-700 dark:text-primary-400">{{ smartHint }}</p>
      <p v-if="smartErr" data-event-smart-err class="mt-2.5 text-xs text-red-600 dark:text-red-400">{{ smartErr }}</p>

      <div class="mt-4 space-y-3">
        <input
          v-model="evtForm.title"
          placeholder="日程名称，如：班会（必填）"
          class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
        />
        <div class="flex gap-2.5">
          <button
            type="button"
            class="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2.5 text-left text-sm tabular-nums transition active:scale-[0.99]"
            :class="evtForm.date ? 'text-ink' : 'text-ink-dim'"
            @click="openDateField({ value: evtForm.date, onDone: (v) => (evtForm.date = v) })"
          >
            {{ evtForm.date || '日期' }}
          </button>
          <button
            type="button"
            class="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2.5 text-left text-sm tabular-nums transition active:scale-[0.99]"
            :class="evtForm.start ? 'text-ink' : 'text-ink-dim'"
            @click="openTimeField({ value: evtForm.start, onDone: (v) => (evtForm.start = v) })"
          >
            {{ evtForm.start || '几点开始' }}
          </button>
        </div>
        <div class="flex items-center gap-2.5">
          <button
            v-for="d in DURATIONS"
            :key="d"
            class="flex-1 rounded-full py-1.5 text-xs font-medium transition active:scale-95"
            :class="evtForm.duration === d ? 'bg-primary-500 text-white' : 'bg-soft text-ink-dim'"
            @click="evtForm.duration = d"
          >
            {{ d }}分
          </button>
        </div>
        <input
          v-model="evtForm.place"
          placeholder="地点（选填）"
          class="w-full rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm outline-none focus:border-primary-400"
        />
      </div>
      <p v-if="evtWarn" class="mt-2.5 rounded-xl border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-500">{{ evtWarn }}</p>
      <p v-if="evtErr" class="mt-2.5 text-xs text-red-600 dark:text-red-400">{{ evtErr }}</p>
      <div class="mt-4 flex gap-2.5">
        <button
          class="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
          @click="evtForm = null"
        >
          取消
        </button>
        <button
          class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
          @click="submitEvent"
        >
          添加
        </button>
      </div>
      <input ref="smartFile" data-event-smart-file type="file" accept="image/*" class="hidden" @change="onSmartFile" />
    </BottomSheet>
</template>
