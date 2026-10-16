<script setup>
/* 课堂录音页（录音历史）。2026-10-12 按用户 m04810 拍板从「按周分组折叠」改成
   「默认只显示最近 3 场 + 展开更多」：
   按周分组的毛病是——某一周录得多（期末、连堂），点开那一组照样一次铺出十几场，
   还是得滑很久；而且想找的那场如果在上上周，得先猜它在哪个组里。
   现在只有一条倒序列表，默认露出最近 3 场（最可能要接着做转写/纪要的几场），
   其余收在一行「展开全部（还有 N 场）」后面，一屏内永远看得完。
   状态类的东西（转写/纪要/试听/长按删除）在每一场里原样保留。 */
import { computed, ref } from 'vue'
import { toRefs } from 'vue'
import { useApp } from '../../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  lectures,
  recActiveId,
  recElapsed,
  recMsg,
  recMsgBad,
  playingId,
  recSupported,
  fmtDur,
  fmtLecDate,
  lecStatusLabel,
  startRec,
  stopRec,
  playLec,
  pressActiveId,
  startLecPress,
  moveLecPress,
  cancelLecPress,
  trSupported,
  trBusyId,
  trPercent,
  trLabel,
  trOpenId,
  startTr,
  sumBusyId,
  sumStage,
  sumOpenId,
  cancelSummary,
  startSummary,
  hwInfoOf,
  addHomeworkTodo,
  hwExamHint,
  addHomeworkExam,
} = toRefs(app)

/* ---------------- 最近 3 场 + 展开更多（本地计算，不进 APP_CTX） ---------------- */
const RECENT_COUNT = 3
/* lectures 已按 started_at 倒序（App.vue 的 refreshLectures），前几场就是最近的，
   这里不重新排序。用「一旦展开就保持展开」的布尔量而不是每次 lectures 变都重置：
   转写完一场不该把用户的展开状态弹回去。 */
const lecExpanded = ref(false)
const lecRecent = computed(() => lectures.value.slice(0, RECENT_COUNT))
const lecVisible = computed(() => (lecExpanded.value ? lectures.value : lecRecent.value))
const lecHiddenCount = computed(() => Math.max(0, lectures.value.length - lecRecent.value.length))
</script>

<template>
      <!-- 课堂录音（二期 M2）：App 平台可用；浏览器环境点按给就地提示，不做假录音 -->
      <section class="rounded-2xl border border-line bg-card p-4 shadow-sm">
        <div class="flex items-center gap-3.5">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">
            <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="1.5" width="4" height="8" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 009 0M8 12v2.5M5.5 14.5h5" /></svg>
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium">课堂录音</span>
            <span class="block text-[11px] text-ink-dim">下课 2 分钟自动停，然后转写并生成纪要</span>
          </span>
          <button
            v-if="!recActiveId"
            class="shrink-0 rounded-full bg-primary-500 px-4 py-2 text-xs font-medium text-white transition active:scale-95"
            :class="recSupported ? '' : 'opacity-60'"
            @click="startRec"
          >
            开始录音
          </button>
          <button
            v-else
            class="shrink-0 rounded-full bg-red-400 px-4 py-2 text-xs font-medium text-white transition active:scale-95"
            @click="stopRec"
          >
            停止并保存
          </button>
        </div>

        <!-- 录音中：红点 + 实时计时 -->
        <div v-if="recActiveId" class="mt-3 flex items-center gap-2 rounded-xl bg-red-400/10 px-3 py-2.5">
          <span class="h-2 w-2 animate-pulse rounded-full bg-red-400"></span>
          <span class="text-sm font-semibold tabular-nums">{{ fmtDur(recElapsed * 1000) }}</span>
          <span class="ml-auto text-[11px] text-ink-dim">录音中 · 锁屏也继续录</span>
        </div>

        <p v-if="recMsg" class="mt-2.5 text-[11px]" :class="recMsgBad ? 'text-red-600 dark:text-red-400' : 'text-primary-600'">{{ recMsg }}</p>

        <!-- 场次列表：一条倒序列表，默认只露最近 3 场，其余收在「展开全部」后面；
             试听按钮在播放/暂停间切换 -->
        <div v-if="lectures.length" class="mt-3 border-t border-line" data-lec-list>
          <ul class="divide-y divide-line">
          <li
            v-for="l in lecVisible"
            :key="l.id"
            :data-lec-item="l.id"
            class="py-2.5 transition-opacity select-none"
            :class="pressActiveId === l.id ? 'opacity-50' : ''"
            @contextmenu.prevent
            @pointerdown="startLecPress(l, $event)"
            @pointermove="moveLecPress"
            @pointerup="cancelLecPress"
            @pointerleave="cancelLecPress"
            @pointercancel="cancelLecPress"
          >
            <div class="flex items-center gap-3">
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13px] font-medium">{{ l.title || '未命名录音' }}</span>
                <span class="block text-[11px] text-ink-dim">
                  {{ fmtLecDate(l.started_at) }} · {{ fmtDur(l.duration_ms) }} · {{ lecStatusLabel(l) }}
                </span>
              </span>
              <button
                v-if="l.clips && l.clips.length"
                class="shrink-0 rounded-full bg-soft px-3 py-1.5 text-[11px] font-medium transition active:scale-95"
                @click="playLec(l)"
              >
                {{ playingId === l.id ? '暂停' : '试听' }}
              </button>
              <button
                v-if="trSupported && l.status === 'recording' && l.ended_at && l.clips && l.clips.length"
                class="shrink-0 rounded-full bg-primary-500 px-3 py-1.5 text-[11px] font-medium text-white transition active:scale-95"
                :class="trBusyId && trBusyId !== l.id ? 'is-dim' : ''"
                @click="startTr(l)"
              >
                转写
              </button>
            </div>
            <!-- 转写进行中：进度条 + 阶段说明（下载模型 / 识别） -->
            <div v-if="trBusyId === l.id" class="mt-2">
              <div class="h-1.5 overflow-hidden rounded-full bg-soft-2">
                <div class="h-full rounded-full bg-primary-500 transition-[width] duration-300" :style="{ width: trPercent + '%' }"></div>
              </div>
              <p class="mt-1 text-[11px] text-ink-dim">{{ trLabel }}</p>
            </div>
            <!-- 文字稿 + 纪要：转写完成后解锁（纪要在浏览器里也能生成，与转写的 App 限制无关） -->
            <template v-if="(l.status === 'transcribed' || l.status === 'summarized') && l.transcript">
              <div class="mt-1.5 flex items-center gap-3">
                <button class="text-[11px] text-primary-600" @click="trOpenId = trOpenId === l.id ? null : l.id">
                  {{ trOpenId === l.id ? '收起文字稿 ▲' : '查看文字稿 ▼' }}
                </button>
                <button
                  class="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium transition active:scale-95"
                  :class="[
                    l.summary ? 'bg-soft' : 'bg-primary-500 text-white',
                    sumBusyId && sumBusyId !== l.id ? 'is-dim' : '',
                  ]"
                  @click="startSummary(l)"
                >
                  {{ l.summary ? '重新生成纪要' : '生成纪要' }}
                </button>
              </div>
              <p
                v-if="trOpenId === l.id"
                class="mt-1.5 whitespace-pre-wrap rounded-xl bg-soft p-3 text-[12px] leading-relaxed"
              >{{ l.transcript }}</p>
              <!-- 生成中：转圈 + 阶段说明 + 取消（LLM 调用是真网络请求，必须可掐断） -->
              <div v-if="sumBusyId === l.id" class="mt-2 flex items-center gap-2 text-[11px] text-ink-dim">
                <span class="h-3 w-3 animate-spin rounded-full border-2 border-primary-400 border-t-transparent"></span>
                <span class="flex-1">{{ sumStage === 'call' ? '正在调用 AI 生成纪要…' : '正在解析纪要…' }}</span>
                <button class="shrink-0 text-red-600 dark:text-red-400" @click="cancelSummary">取消</button>
              </div>
              <!-- 纪要卡：总览 / 要点 / 概念 / 作业 / 存疑（空块不渲染） -->
              <div v-if="l.summary && sumOpenId === l.id" class="mt-2 rounded-xl border border-primary-400/30 bg-primary-50 p-3">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-bold text-primary-600">课堂纪要</span>
                  <button class="text-[11px] text-ink-dim" @click="sumOpenId = null">收起 ▲</button>
                </div>
                <p class="mt-1.5 text-[12px] leading-relaxed text-ink">{{ l.summary.overview }}</p>
                <ul v-if="l.summary.key_points && l.summary.key_points.length" class="mt-2 space-y-1">
                  <li v-for="(k, i) in l.summary.key_points" :key="'k' + i" class="flex gap-1.5 text-[12px] leading-relaxed">
                    <span class="shrink-0 text-primary-600">•</span><span>{{ k }}</span>
                  </li>
                </ul>
                <div v-if="l.summary.terms && l.summary.terms.length" class="mt-2.5">
                  <p class="text-[11px] font-semibold text-ink-dim">概念术语</p>
                  <div class="mt-1 flex flex-wrap gap-1.5">
                    <span v-for="(t, i) in l.summary.terms" :key="'t' + i" class="rounded-full bg-soft-2 px-2 py-0.5 text-[11px]" :title="t.note">{{ t.term }}</span>
                  </div>
                </div>
                <div v-if="l.summary.homework && l.summary.homework.length" class="mt-2.5">
                  <p class="text-[11px] font-semibold text-ink-dim">作业 / 截止</p>
                  <ul class="mt-1 space-y-1">
                    <li v-for="(h, i) in l.summary.homework" :key="'h' + i" data-hw-item class="text-[12px] leading-relaxed">
                      <div class="flex items-start gap-1.5">
                        <span class="shrink-0 text-primary-600">{{ hwInfoOf(l, i) && hwInfoOf(l, i).added ? '☑' : '□' }}</span>
                        <span class="flex-1">{{ hwInfoOf(l, i) ? hwInfoOf(l, i).text : (h.text || h) }}</span>
                      </div>
                      <div v-if="hwInfoOf(l, i)" class="mt-0.5 flex items-center gap-2 pl-4 text-[11px] text-ink-dim">
                        <span data-hw-due>{{ hwInfoOf(l, i).due }} · {{ hwInfoOf(l, i).source }}</span>
                        <span v-if="hwInfoOf(l, i).added" data-hw-added class="text-primary-600">已在待办</span>
                        <button v-else type="button" data-hw-add class="text-primary-600 active:opacity-70" @click="addHomeworkTodo(l, i)">加入待办</button>
                        <button v-if="hwExamHint(l, i)" type="button" data-hw-exam class="text-amber-700 active:opacity-70 dark:text-amber-500" @click="addHomeworkExam(l, i)">加入考试</button>
                      </div>
                    </li>
                  </ul>
                </div>
                <div v-if="l.summary.questions && l.summary.questions.length" class="mt-2.5">
                  <p class="text-[11px] font-semibold text-amber-700 dark:text-amber-500">存疑点（可能识别有误）</p>
                  <ul class="mt-1 space-y-0.5">
                    <li v-for="(q, i) in l.summary.questions" :key="'q' + i" class="text-[12px] leading-relaxed">? {{ q }}</li>
                  </ul>
                </div>
              </div>
              <button v-else-if="l.summary" class="mt-1.5 text-[11px] text-primary-600" @click="sumOpenId = l.id">
                查看纪要 ▼
              </button>
            </template>
          </li>
          </ul>
          <!-- 展开全部 / 收起：只露最近 3 场，剩下的收在按钮后面。
               展开态用「展开更早的 N 场」而不是「展开全部」，让用户知道还要露出多少。 -->
          <button
            v-if="lecHiddenCount || lecExpanded"
            data-lec-toggle
            type="button"
            class="flex w-full items-center justify-center gap-1.5 py-3 text-[12px] font-medium text-primary-600 transition active:opacity-70"
            :aria-expanded="lecExpanded ? 'true' : 'false'"
            @click="lecExpanded = !lecExpanded"
          >
            <template v-if="lecExpanded">收起<span class="text-ink-dim">（只留最近 3 场）</span></template>
            <template v-else>展开全部<span class="text-ink-dim">（还有 {{ lecHiddenCount }} 场）</span></template>
            <svg
              viewBox="0 0 16 16"
              class="h-3.5 w-3.5 shrink-0 transition-transform duration-200"
              :class="lecExpanded ? 'rotate-180' : ''"
              fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
            ><path d="M4 6.5l4 4 4-4" /></svg>
          </button>
        </div>
      </section>

</template>
