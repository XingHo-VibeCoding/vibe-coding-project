<script setup>
import { ref, computed, watch, toRefs } from 'vue'
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
  submitEvents,
  DURATIONS,
  durText,
  pickDuration,
  todayStr,
} = toRefs(app)

/* ---------- ✨ 智能填写（2026-10-12，用户 m05813 / m06155 / m07172）----------
   两条路：拍照/选图（多模态）、粘贴文字。识别结果**只回填表单、不直接落库** ——
   日期时间是最容易出错的一环，让用户核对一遍再点「添加」。
   2026-10-12 增补第三条路「一次多条」（用户 m07172 选「列表核对 + 一次『添加所选』」）：
   一份素材里有多件事时抽成一串，列表里逐条改完勾选，一次落库。
   状态全放组件本地：它是这张表单自己的 UI，不进 APP_CTX（免得又添一堆全局绑定）。 */
const smartOpen = ref(false) // 小选单展开
const textOpen = ref(false) // 单条「粘贴文字」面板
const multiOpen = ref(false) // 「一次多条」面板（文字 + 选图）
const smartBusy = ref(false)
const smartErr = ref('')
const smartHint = ref('') // 识别成功后的一句话交代（改了哪些字段 / 有什么拿不准）
const smartText = ref('')
const smartFile = ref(null)
const smartMode = ref('one') // 'one' | 'multi' —— 选图回调要知道这次该走哪套提示词
const batchItems = ref([]) // [{ event, warnText, checked }] 非空即进入「批量核对」界面
const batchConfirmed = ref(false) // 冲突二次确认（口径同单条：第一次只提示，再点一次放行）

const pickedCount = computed(() => batchItems.value.filter((i) => i.checked).length)
const allPicked = computed(() => batchItems.value.length > 0 && pickedCount.value === batchItems.value.length)

/* 每次打开表单都回到干净状态（上次识别的提示与列表不该串到这一次） */
watch(evtForm, (v) => {
  if (v) {
    smartOpen.value = false
    textOpen.value = false
    multiOpen.value = false
    smartBusy.value = false
    smartErr.value = ''
    smartHint.value = ''
    smartText.value = ''
    smartMode.value = 'one'
    batchItems.value = []
    batchConfirmed.value = false
  }
})

function pickImage(mode) {
  smartOpen.value = false
  const miss = eventParserAvailable()
  if (miss) { smartErr.value = miss; return }
  smartErr.value = ''
  smartMode.value = mode || 'one'
  if (smartFile.value) smartFile.value.click()
}

function openText(mode) {
  smartOpen.value = false
  smartErr.value = ''
  smartMode.value = mode || 'one'
  if (smartMode.value === 'multi') { multiOpen.value = true; textOpen.value = false } else { textOpen.value = true; multiOpen.value = false }
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

/* 批量结果 → 核对列表。**不落库**：勾选 + 改完再点「添加所选 N 条」。
   每条的拿不准单独写在它自己卡片里（不能都堆在顶部，否则用户不知道是哪一条）。 */
function fillBatch(r) {
  const items = (r.events || []).map((ev, i) => {
    const ws = [].concat(r.warnings && r.warnings[i] ? r.warnings[i] : [], r.notes && r.notes[i] ? r.notes[i] : [])
    return { event: ev, warnText: ws.join('；'), checked: true }
  })
  batchItems.value = items
  batchConfirmed.value = false
  smartHint.value = '认出 ' + items.length + ' 条，改完勾选后点「添加所选」。'
  smartErr.value = ''
}

async function onSmartFile(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = '' // 允许重复选同一张
  if (!file) return
  const multi = smartMode.value === 'multi'
  smartBusy.value = true
  smartErr.value = ''
  smartHint.value = ''
  try {
    const r = await parseEventImage(file, { today: todayStr.value, weekdayCN: anchorWeekday(), list: multi })
    if (multi) { fillBatch(r); multiOpen.value = false } else { fillForm(r.event, r.warnings.concat(r.notes || [])) }
  } catch (err) {
    smartErr.value = err && err.message ? err.message : '识别失败，换张图再试。'
  } finally {
    smartBusy.value = false
  }
}

async function runText(mode) {
  const src = String(smartText.value || '').trim()
  if (!src) { smartErr.value = '先粘贴或打一段话。'; return }
  const multi = (mode || smartMode.value) === 'multi'
  smartBusy.value = true
  smartErr.value = ''
  smartHint.value = ''
  try {
    const r = await parseEventText(src, { today: todayStr.value, weekdayCN: anchorWeekday(), list: multi })
    if (multi) { fillBatch(r); multiOpen.value = false } else { fillForm(r.event, r.warnings.concat(r.notes || [])); textOpen.value = false }
  } catch (err) {
    smartErr.value = err && err.message ? err.message : '识别失败，重试一次。'
  } finally {
    smartBusy.value = false
  }
}

function toggleAll() {
  const to = !allPicked.value
  for (const it of batchItems.value) it.checked = to
}

function discardBatch() {
  batchItems.value = []
  batchConfirmed.value = false
  smartHint.value = ''
  smartErr.value = ''
}

/* 一次落库。冲突口径与单条完全一致（第一次只提示、再点一次照样添加），
   避免出现「单条拦、批量不拦」这种同功能两套规则。 */
function addSelected() {
  const picked = batchItems.value.filter((i) => i.checked)
  if (!picked.length) { smartErr.value = '一条都没勾选。'; return }
  /* 注意：toRefs(app) 把一切都包成 ref（函数也是）——在模板里自动解包，在 <script setup> 里
     必须写 .value。这里漏 .value 的报错是运行期 `s is not a function`，编译期看不出来。 */
  const r = submitEvents.value(picked.map((i) => i.event), batchConfirmed.value)
  if (r.conflicts && r.conflicts.length && !batchConfirmed.value) {
    batchConfirmed.value = true
    smartErr.value = '有 ' + r.conflicts.length + ' 条与已有安排时间冲突：'
      + r.conflicts.map((c) => '「' + c.title + '」撞「' + c.names.join('」「') + '」').join('；')
      + '。再点一次「添加所选」照样添加'
    return
  }
  evtForm.value = null // 落库完成，关掉表单
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
        <!-- 智能填写入口：表单里只多这一颗小按钮，三条路藏在选单里（用户 m06155 / m07172） -->
        <div v-if="!batchItems.length" class="relative shrink-0">
          <button
            data-event-smart
            type="button"
            class="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-600 transition active:scale-95 dark:bg-primary-500/15 dark:text-primary-400"
            :disabled="smartBusy"
            @click="smartOpen = !smartOpen"
          >
            {{ smartBusy ? '识别中…' : '✨ 智能填写' }}
          </button>
          <div v-if="smartOpen" class="absolute right-0 top-8 z-10 w-40 overflow-hidden rounded-xl border border-line bg-card shadow-lg">
            <button
              data-event-smart-image
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-ink transition active:bg-soft"
              @click="pickImage('one')"
            >
              📷 拍照 / 选图
            </button>
            <button
              data-event-smart-text
              type="button"
              class="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left text-sm text-ink transition active:bg-soft"
              @click="openText('one')"
            >
              📝 粘贴文字
            </button>
            <button
              data-event-smart-multi
              type="button"
              class="flex w-full items-center gap-2 border-t border-line px-3 py-2.5 text-left text-sm text-ink transition active:bg-soft"
              @click="openText('multi')"
            >
              📋 一次多条
            </button>
          </div>
        </div>
      </div>

      <!-- 单条 · 粘贴文字面板：识别完自动收起 -->
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
            @click="runText('one')"
          >
            {{ smartBusy ? '识别中…' : '识别并填写' }}
          </button>
        </div>
      </div>

      <!-- 批量 · 一次多条面板：一段话或一张图，抽出一串 -->
      <div v-if="multiOpen" class="mt-3 rounded-xl border border-line bg-canvas p-3">
        <p class="text-xs text-ink-dim">粘一段通知或传张图，一次认出多条，改完勾选一起添加。</p>
        <textarea
          data-event-smart-input-multi
          v-model="smartText"
          rows="4"
          placeholder="如：周三下午三点班会（教二 110）；周五上午十点高数期中考试；下周一 18:00 项目答辩，大概两小时"
          class="mt-2 w-full resize-none rounded-lg border border-line bg-card px-3 py-2 text-sm outline-none focus:border-primary-400"
        ></textarea>
        <div class="mt-2 flex gap-2">
          <button
            data-event-smart-image-multi
            type="button"
            class="flex-1 rounded-lg border border-line py-2 text-xs font-medium text-ink-dim transition active:scale-[0.98]"
            @click="pickImage('multi')"
          >
            🖼 选张图
          </button>
          <button
            type="button"
            class="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-dim transition active:scale-[0.98]"
            @click="multiOpen = false"
          >
            收起
          </button>
          <button
            data-event-smart-run-multi
            type="button"
            class="flex-1 rounded-lg bg-primary-500 py-2 text-xs font-semibold text-white shadow-sm transition active:scale-[0.98] disabled:opacity-60"
            :disabled="smartBusy"
            @click="runText('multi')"
          >
            {{ smartBusy ? '识别中…' : '识别多条' }}
          </button>
        </div>
      </div>

      <p v-if="smartHint" data-event-smart-hint class="mt-2.5 rounded-xl border border-primary-300/40 bg-primary-400/10 px-3 py-2 text-xs text-primary-700 dark:text-primary-400">{{ smartHint }}</p>
      <p v-if="smartErr" data-event-smart-err class="mt-2.5 text-xs text-red-600 dark:text-red-400">{{ smartErr }}</p>

      <!-- 批量核对列表：改完勾选，一次落库（用户 m07172 拍板） -->
      <div v-if="batchItems.length" data-event-batch-list class="mt-3 space-y-2.5">
        <div class="flex items-center justify-between">
          <p data-event-batch-count class="text-xs text-ink-dim">认出 {{ batchItems.length }} 条 · 已勾选 {{ pickedCount }} 条</p>
          <button data-event-batch-all type="button" class="text-xs font-medium text-primary-600 dark:text-primary-400" @click="toggleAll">
            {{ allPicked ? '全不选' : '全选' }}
          </button>
        </div>
        <div v-for="(it, i) in batchItems" :key="i" data-event-batch-item class="rounded-xl border border-line bg-canvas p-2.5">
          <div class="flex items-center gap-2">
            <!-- 配色走 style.css 里的 .evt-batch-check（理由写在那儿），别在这里用工具类 -->
            <input data-event-batch-check type="checkbox" v-model="it.checked" class="evt-batch-check h-4 w-4 shrink-0" />
            <input
              data-event-batch-title
              v-model="it.event.title"
              class="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-sm outline-none focus:border-primary-400"
            />
          </div>
          <div class="mt-1.5 flex gap-1.5 pl-6">
            <button
              type="button"
              class="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1 text-left text-xs tabular-nums transition active:scale-[0.98]"
              :class="it.event.date ? 'text-ink' : 'text-ink-dim'"
              @click="openDateField({ value: it.event.date, onDone: (v) => (it.event.date = v) })"
            >
              {{ it.event.date || '日期' }}
            </button>
            <button
              type="button"
              class="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1 text-left text-xs tabular-nums transition active:scale-[0.98]"
              :class="it.event.start ? 'text-ink' : 'text-ink-dim'"
              @click="openTimeField({ value: it.event.start, onDone: (v) => (it.event.start = v) })"
            >
              {{ it.event.start || '几点' }}
            </button>
          </div>
          <div class="mt-1.5 flex gap-1 pl-6">
            <button
              v-for="d in DURATIONS"
              :key="d"
              type="button"
              class="flex-1 rounded-full py-0.5 text-[10px] font-medium transition active:scale-95"
              :class="it.event.duration === d ? 'bg-primary-500 text-white' : 'bg-soft text-ink-dim'"
              @click="it.event.duration = d"
            >
              {{ d }}分
            </button>
            <button
              type="button"
              class="flex-1 rounded-full py-0.5 text-[10px] font-medium transition active:scale-95"
              :class="DURATIONS.includes(it.event.duration) ? 'bg-soft text-ink-dim' : 'bg-primary-500 text-white'"
              data-batch-dur-custom
              @click="pickDuration(it.event.duration, (v) => (it.event.duration = v))"
            >
              {{ DURATIONS.includes(it.event.duration) ? '自定义' : durText(it.event.duration) }}
            </button>
          </div>
          <input
            v-model="it.event.place"
            placeholder="地点（选填）"
            class="mt-1.5 w-[calc(100%-1.5rem)] translate-x-6 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400"
          />
          <p v-if="it.warnText" class="mt-1.5 pl-6 text-[11px] text-amber-600 dark:text-amber-500">{{ it.warnText }}</p>
        </div>
        <div class="flex gap-2.5 pt-1">
          <button
            type="button"
            class="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
            @click="discardBatch"
          >
            取消
          </button>
          <button
            data-event-batch-add
            type="button"
            class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98] disabled:opacity-60"
            :disabled="!pickedCount || smartBusy"
            @click="addSelected"
          >
            添加所选 {{ pickedCount }} 条
          </button>
        </div>
      </div>

      <!-- 单条表单（批量核对时让位） -->
      <template v-else>
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
        <button
          class="flex w-full items-center justify-between rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-sm transition active:scale-[0.99]"
          :class="DURATIONS.includes(evtForm.duration) ? 'text-ink-dim' : 'text-ink'"
          data-evt-dur-custom
          @click="pickDuration(evtForm.duration, (v) => (evtForm.duration = v))"
        >
          <span>持续时长</span>
          <span class="font-semibold tabular-nums" data-evt-dur-text>{{ durText(evtForm.duration) }}</span>
        </button>
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
          data-evt-submit
          class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
          @click="submitEvent"
        >
          添加
        </button>
      </div>
      </template>

      <input ref="smartFile" data-event-smart-file type="file" accept="image/*" class="hidden" @change="onSmartFile" />
    </BottomSheet>
</template>
