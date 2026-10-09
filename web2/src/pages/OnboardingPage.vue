<script setup>
import { toRefs } from 'vue'
import { useApp } from '../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  gridStyleOf,
  onboarding,
  onboardStep,
  OB_STEP_LABELS,
  onboardStepNo,
  finishOnboarding,
  llmCfg,
  llmTest,
  onboardFile,
  onboardImport,
  onboardEduLogin,
  obImportMsg,
  onOnboardFile,
  obForm,
  obErr,
  goObForm,
  obPageDir,
  goObPeriods,
  backObForm,
  obStepDir,
  obAiErr,
  onObAiKey,
  obAiTest,
  obAiDone,
  obAiBack,
  obPickStart,
  obStartHint,
  obPickWeeks,
  obTimeSummary,
  obPickDur,
  obPickGap,
  obGlobal,
  obSegGroups,
  obPickPeriodStart,
  obPickPeriodEnd,
  obAddPeriod,
  obRemovePeriod,
  obSubmit,
  obRecFile,
  obRecBusy,
  obRecErr,
  recPreview,
  WEEKDAY_LABELS,
  recSelectedCount,
  recFromMine,
  recPeriods,
  recSegView,
  mineRecCancel,
  goObRec,
  recBackForm,
  obManualAdd,
  obRecClick,
  onObRecFile,
  recSecOptions,
  recTimeRange,
  recRemove,
  recGrid,
  recCols,
  recRows,
  recRowIdx,
  recColsStyle,
  recGridStyle,
  recOverlapNote,
  palOf,
  recItemHot,
  recPressCell,
  recCellDown,
  recCellUp,
  openRecAdd,
  openRecEdit,
  recBack,
  recImport,
  periods,
  WDN,
} = toRefs(app)
</script>

<template>
      <div v-if="onboarding" class="fixed inset-0 z-40 overflow-y-auto bg-canvas" :data-ob-step="onboardStepNo" :style="{ paddingTop: 'var(--sat, 0px)' }">
        <div class="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-10">
          <div v-if="!recFromMine" class="mb-7 text-center">
            <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-primary-400 to-primary-600 text-2xl font-bold text-white shadow-lg shadow-primary-500/25">
              日
            </div>
            <h1 class="text-xl font-bold">欢迎来到日程助手</h1>
            <p class="mt-1.5 text-sm text-ink-dim">把课表和 deadline 收进同一张时间轴</p>
          </div>

          <!-- 三步指示（第 1 步学期与节次 / 第 2 步识别课表 / 第 3 步核对导入）；mine 入口不走三步流程，不显示 -->
          <div v-if="onboardStep !== 'choice' && !recFromMine" class="mb-4 flex items-center justify-center gap-1.5">
            <template v-for="(lb, i) in OB_STEP_LABELS" :key="lb">
              <div
                :data-step-item="i + 1"
                :aria-current="onboardStepNo === i + 1 ? 'step' : undefined"
                class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition"
                :class="onboardStepNo === i + 1
                  ? 'bg-primary-500/10 font-semibold text-primary-600'
                  : 'text-ink-dim'"
              >
                <span
                  class="flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold"
                  :class="onboardStepNo >= i + 1 ? 'bg-primary-500 text-white' : 'bg-soft-2 text-ink-dim'"
                >{{ i + 1 }}</span>
                {{ lb }}
              </div>
              <span v-if="i < OB_STEP_LABELS.length - 1" class="h-px w-2.5 bg-line"></span>
            </template>
          </div>

          <!-- 步骤级切换动画（2026-09-30 用户反馈「三个选项点下去秒跳、没有动画」）：
               复用第 1 步二级页那套 obpage 滑动（style.css 已定义），方向由 obStepDir 决定。
               每个步骤必须是单个根元素 Transition 才认（原来是并列的 <template>，所以没动画）；
               relative 让离场页（CSS 里 position:absolute）以自身卡片高度为基准，
               overflow-hidden 把 ±26px 平移关在框内，不撑出横向滚动条。 -->
          <Transition :name="obStepDir">
          <div v-if="onboardStep === 'choice'" key="choice" class="relative overflow-hidden">
            <!-- 三个入口（2026-10-09 用户重排）：上／中／下分别是「自己填学期」「连教务抓」「导文件」，
                 按「最省事的放中间」排。原来那个「先用示例数据逛逛」已删掉——示例数据以后只从「我的」页切。 -->
            <button
              class="w-full rounded-2xl border border-line bg-card p-4 text-left shadow-sm transition active:scale-[0.98]"
              data-ob-choice-form
              @click="goObForm"
            >
              <p class="text-sm font-semibold">直接填学期信息，自己加课</p>
              <p class="mt-1 text-xs text-ink-dim">三步走：先填学期与节次表 → 再拍课表截图识别（也可以跳过）→ 核对后入库</p>
            </button>
            <button
              class="mt-3 w-full rounded-2xl border border-primary-200 bg-primary-50/60 p-4 text-left shadow-sm transition active:scale-[0.98]"
              data-ob-choice-edu
              @click="onboardEduLogin"
            >
              <p class="text-sm font-semibold text-primary-600">登录教务系统，直接抓课表</p>
              <p class="mt-1 text-xs text-ink-dim">用你的统一身份认证账号登录，抓回来先给你核对再入库；也能顺手从教务导出的 Excel 导入</p>
            </button>
            <button
              class="mt-3 w-full rounded-2xl border border-line bg-card p-4 text-left shadow-sm transition active:scale-[0.98]"
              data-ob-choice-import
              @click="onboardImport"
            >
              <p class="text-sm font-semibold">导入数据</p>
              <p class="mt-1 text-xs text-ink-dim">选主项目导出的 JSON 备份，或教务导出的课表 Excel（.xlsx）</p>
            </button>
            <p v-if="obImportMsg" class="mt-2 px-1 text-xs text-red-600 dark:text-red-400">{{ obImportMsg }}</p>
          </div>

          <!-- 第 2 步的引导子页：没配 AI Key 时落这里（第一次用的人都没有 Key）。
               原来只在识别页甩一行红字让人「去我的页配」，而引导层是 fixed 全屏、把整个应用
               盖住了 → 那条路根本走不到，是死路。现在三处检测点（第 1 步「下一步：识别课表」、
               识别页的识别按钮、我的页识别入口）缺 Key 一律落到这一页，就地配完再回识别页。 -->
          <div v-else-if="onboardStep === 'aiCfg'" key="aiCfg" class="relative overflow-hidden">
            <div class="rounded-2xl border border-line bg-card p-4 shadow-sm">
              <p class="text-sm font-semibold">识别课表要先配好 AI</p>
              <p class="mt-1 text-xs leading-relaxed text-ink-dim">
                拍课表识别是把图片交给 DeepSeek 的图片识别能力，读成「星期 × 第几节 × 课程名」。所以要有一个 API Key —— 它和「课堂纪要」共用同一个，配一次两处都能用。
              </p>
              <label class="mt-3 block">
                <span class="mb-1 block text-[11px] text-ink-dim">DeepSeek API Key（只存在这台设备，不会上传）</span>
                <input
                  v-model="llmCfg.key"
                  data-ob-ai-key
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="sk-…"
                  enterkeyhint="done"
                  class="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-dim focus:border-primary-400"
                  @input="onObAiKey"
                />
              </label>
              <p class="mt-1.5 text-[11px] leading-relaxed text-ink-dim">
                去 platform.deepseek.com 注册后，在「API Keys」里新建一个，复制粘贴到上面即可；识别一张课表通常只要几分钱。
              </p>
              <button
                type="button"
                data-ob-ai-test
                class="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-card py-2.5 text-sm font-medium text-ink transition active:scale-[0.98]"
                :class="llmTest.busy ? 'opacity-60' : ''"
                @click="obAiTest"
              >
                <span v-if="llmTest.busy" class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-400 border-t-transparent"></span>
                {{ llmTest.busy ? '正在测试…' : '测试连接' }}
              </button>
              <p
                v-if="llmTest.msg"
                data-ob-ai-test-msg
                class="mt-1.5 px-1 text-[11px] leading-relaxed"
                :class="llmTest.ok ? 'text-primary-600' : 'text-red-600 dark:text-red-400'"
              >{{ llmTest.msg }}</p>

              <button
                type="button"
                data-ob-ai-save
                class="mt-3 w-full rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
                @click="obAiDone"
              >
                保存，去识别课表
              </button>
              <p v-if="obAiErr" data-ob-ai-err class="mt-2 px-1 text-xs text-red-600 dark:text-red-400">{{ obAiErr }}</p>

              <!-- 退路：不想配 Key 也能直接手动建课表（与识别结果走同一套核对/入库链路） -->
              <button
                type="button"
                data-ob-ai-manual
                class="mt-2.5 w-full rounded-xl border border-dashed border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                @click="obManualAdd"
              >
                ＋ 先不配，手动加课
              </button>
              <button
                v-if="!recFromMine"
                type="button"
                data-ob-ai-back
                class="mt-3 w-full rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                @click="obAiBack"
              >
                ← 返回上一步
              </button>
              <button
                v-else
                type="button"
                data-mine-rec-cancel
                class="mt-3 w-full rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                @click="mineRecCancel"
              >
                取消识别
              </button>
            </div>
          </div>

          <!-- 第 2 步：识别课表（用户反馈：先在第 1 步设好节次，这一页只负责选图识别） -->
          <div v-else-if="onboardStep === 'rec'" key="rec" class="relative overflow-hidden">
            <div class="rounded-2xl border border-line bg-card p-4 shadow-sm">
              <p class="text-sm font-semibold">拍课表识别</p>
              <p class="mt-1 text-xs text-ink-dim">截图里能看清「星期 × 第几节 × 课程名」就够。图上写的时间是学校自己的作息（课表截图上常是期末考时间），识别只取第几节，时间按下面这张表换算。</p>

              <!-- 本次换算用的节次表：让「节次先设好」这件事在识别前可见、可改。
                   mine 入口 = 当前学期的节次表（recPeriods 已切源）；引导页 = 第 1 步里那张 -->
              <div class="mt-3 rounded-xl bg-soft px-3 py-2.5" data-ob-summary>
                <p class="text-xs font-semibold">本次换算用的节次表</p>
                <p class="mt-0.5 text-[11px] text-ink-dim">{{ recFromMine ? '识别结果只给第几节，上课时间按你当前学期的这张表算' : '识别结果只给第几节，上课时间按这张表算' }}</p>
                <template v-if="recFromMine || obForm.periods.length">
                  <p class="mt-1.5 text-[11px] tabular-nums text-ink-dim">共 {{ recPeriods.length }} 节 · 分 {{ recSegView.length }} 段</p>
                  <p class="mt-0.5 text-[11px] leading-relaxed tabular-nums text-ink-dim">
                    <span v-for="(g, i) in recSegView" :key="g.seg" class="inline-block"><template v-if="i">&nbsp;·&nbsp;</template>第 {{ g.nos[0] }}<template v-if="g.nos.length > 1">–{{ g.nos[g.nos.length - 1] }}</template> 节 {{ g.start }}–{{ g.end }}</span>
                  </p>
                </template>
                <p v-else class="mt-1.5 text-[11px] leading-relaxed text-ink-dim">你没设置节次表，按默认 13 节换算（上午 5 节 · 下午 5 节 · 晚上 3 节；每节 45 分钟、课间 10 分钟，午休/晚休时段可在上一步改）</p>
                <button
                  v-if="!recFromMine"
                  type="button"
                  data-ob-edit-periods
                  class="mt-2 rounded-lg border border-line bg-card px-2.5 py-1 text-[11px] font-medium text-ink-dim transition active:scale-95"
                  @click="recBackForm"
                >
                  ← 改节次表 / 学期信息
                </button>
                <p v-else class="mt-2 text-[11px] text-ink-dim">节次表不对？点「取消识别」后在学期卡片的 ✎ 编辑里改</p>
              </div>

              <button
                type="button"
                data-ob-rec
                class="mt-3 w-full rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
                :class="obRecBusy ? 'opacity-60' : ''"
                :disabled="obRecBusy"
                @click="obRecClick"
              >
                {{ obRecBusy ? '识别中…（大约十几秒，别退出去）' : '选课表截图 / 拍照识别' }}
              </button>
              <p class="mt-1.5 px-1 text-[11px] text-ink-dim">用已配置的 DeepSeek Key（与课堂纪要共用）；识别结果会先给你逐条核对，改完才入库</p>
              <p v-if="obRecErr" class="mt-2 px-1 text-xs text-red-600 dark:text-red-400" data-ob-rec-err>{{ obRecErr }}</p>

              <!-- 手动输入入口：不想识别 / 识别不全时，直接手动补课进核对页 -->
              <button
                type="button"
                data-ob-manual
                class="mt-2.5 w-full rounded-xl border border-dashed border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                @click="obManualAdd"
              >
                ＋ 不识别了，手动加一门课
              </button>

              <!-- 已识别过一次：可以直接回到核对，也可以重新选图 -->
              <div v-if="recPreview" data-ob-rec-done class="mt-3 rounded-xl border border-line bg-canvas px-3 py-2.5">
                <p class="text-xs">已有识别结果（{{ recPreview.items.length }} 门课），可以直接核对，也可以重新选图识别</p>
                <button
                  type="button"
                  data-ob-rec-continue
                  class="mt-2 w-full rounded-lg bg-primary-500 py-2 text-xs font-semibold text-white transition active:scale-[0.98]"
                  @click="onboardStep = 'recConfirm'"
                >
                  继续核对这 {{ recPreview.items.length }} 门课
                </button>
              </div>

              <button
                v-if="!recFromMine"
                type="button"
                class="mt-3 w-full rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                @click="recBackForm"
              >
                返回上一步
              </button>
              <button
                v-else
                type="button"
                data-mine-rec-cancel
                class="mt-3 w-full rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                @click="mineRecCancel"
              >
                取消识别
              </button>
            </div>
          </div>

          <!-- 第 3 步：课表识别确认页 —— 逐条核对/修改后与手填学期一起入库 -->
          <div v-else-if="onboardStep === 'recConfirm'" key="recConfirm" class="relative overflow-hidden">
            <div class="rounded-2xl border border-line bg-card p-4 shadow-sm">
              <p class="text-sm font-semibold">共 {{ recPreview.items.length }} 门课，核对后导入</p>
              <p class="mt-1 text-xs text-ink-dim">上半是整周排布，点空格子加课、点课块改课；下半逐条改细节</p>

              <div v-if="recPreview.warnings.length" class="mt-2.5 rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-600">
                <span v-for="(w, i) in recPreview.warnings" :key="i" class="block">{{ w }}</span>
              </div>

              <!-- 整周预览：与正式课表同一套网格（行=节次、列=星期）。
                   点空格子加课、点课块改课；同一格两门课在格子里标红 -->
              <div class="mt-3 rounded-2xl border border-line bg-canvas p-2.5">
                <div class="grid" :style="recColsStyle">
                  <span></span>
                  <span v-for="wd in recCols" :key="wd" class="pb-1 text-center text-[11px] text-ink-dim">{{ WDN[wd - 1] }}</span>
                </div>
                <div class="grid select-none" data-rec-grid :style="recGridStyle">
                  <template v-for="(r, ri) in recRows" :key="ri">
                    <div
                      v-if="r.type === 'gap'"
                      data-gap
                      class="flex items-center gap-1.5 bg-soft px-1 text-[10px] font-medium text-ink-dim"
                      :style="{ gridColumn: '1 / -1', gridRow: ri + 1 }"
                    >
                      <span class="h-px flex-1 bg-line/70"></span>
                      <span class="shrink-0">{{ r.label }}</span>
                      <span class="h-px flex-1 bg-line/70"></span>
                    </div>
                    <template v-else>
                      <div
                        :data-raxis="r.p.no"
                        class="flex flex-col items-center justify-center overflow-hidden bg-soft leading-none"
                        :style="{ gridColumn: 1, gridRow: ri + 1 }"
                      >
                        <span class="text-[10px] font-semibold text-primary-600/90">{{ r.p.no }}</span>
                        <span class="mt-0.5 text-[9px] text-ink-dim">{{ r.p.start }}</span>
                      </div>
                      <div
                        v-for="wd in recCols"
                        :key="wd"
                        :data-rcell="wd + '-' + r.idx"
                        class="border-t border-l border-line/50 transition-colors"
                        :class="recPressCell === wd + '-' + r.idx ? 'border-primary-400 bg-primary-500/10' : ''"
                        :style="{ gridColumn: wd + 1, gridRow: ri + 1 }"
                        @pointerdown="recCellDown(wd, r.idx)"
                        @pointerup="recCellUp"
                        @pointercancel="recCellUp"
                        @pointerleave="recCellUp"
                        @click="openRecAdd(wd, r.idx)"
                      ></div>
                    </template>
                  </template>

                  <article
                    v-for="it in recGrid.items"
                    :key="it.wd + '-' + it.from + '-' + it.level"
                    data-rcourse
                    class="relative m-[1px] cursor-pointer overflow-hidden rounded-[5px] px-1 py-0.5 shadow-sm ring-1 transition active:scale-[0.97]"
                    :class="[
                      recGrid.hot.has(it) ? 'bg-red-500/15 ring-2 ring-red-400' : 'ring-line/70',
                      it.c.selected ? '' : 'opacity-35',
                    ]"
                    :style="{ ...gridStyleOf(it, recRowIdx), background: recGrid.hot.has(it) ? '' : palOf(it.c.title).bg }"
                    @click.stop="openRecEdit(it)"
                  >
                    <span
                      class="block truncate text-[10px] leading-tight font-semibold"
                      :class="recGrid.hot.has(it) ? 'text-red-600 dark:text-red-400' : ''"
                      :style="{ color: recGrid.hot.has(it) ? '' : palOf(it.c.title).text }"
                    >{{ it.c.title || '未命名' }}</span>
                  </article>
                </div>
                <p
                  v-if="recOverlapNote"
                  data-rec-conflict
                  class="mt-2 rounded-xl bg-red-500/10 px-3 py-1.5 text-[11px] leading-snug text-red-600 dark:text-red-400"
                >{{ recOverlapNote }}</p>
              </div>

              <p class="mt-3 text-xs font-medium text-ink-dim">逐条核对 · {{ recPreview.items.length }} 门</p>
              <div class="mt-2 space-y-2">
                <div v-for="(it, i) in recPreview.items" :key="i" data-rec-item class="rounded-xl border bg-canvas p-3" :class="recItemHot(it) ? 'border-red-400' : 'border-line'">
                  <div class="flex items-start gap-2.5">
                    <button
                      type="button"
                      class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition"
                      :class="it.selected ? 'border-primary-500 bg-primary-500 text-white' : 'border-line text-transparent'"
                      :aria-label="it.selected ? '取消选择这门课' : '选择这门课'"
                      @click="it.selected = !it.selected"
                    >
                      <svg viewBox="0 0 16 16" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
                    </button>
                    <div class="min-w-0 flex-1">
                      <input
                        v-model="it.title"
                        maxlength="30"
                        placeholder="课程名"
                        class="w-full truncate rounded-lg border border-line bg-card px-2.5 py-1.5 text-sm font-semibold outline-none focus:border-primary-400"
                      />
                      <div class="mt-2 grid grid-cols-2 gap-2">
                        <label class="flex items-center gap-1.5 text-[11px] text-ink-dim">
                          星期
                          <select v-model.number="it.weekday" class="min-w-[3rem] flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                            <option v-for="(w, wi) in WEEKDAY_LABELS" :key="wi" :value="wi + 1">{{ w }}</option>
                          </select>
                        </label>
                        <label class="flex items-center gap-1.5 text-[11px] text-ink-dim">
                          周次
                          <select v-model="it.weekRule" class="min-w-[3rem] flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                            <option value="every">每周</option>
                            <option value="odd">单周</option>
                            <option value="even">双周</option>
                          </select>
                        </label>
                        <label class="flex items-center gap-1.5 text-[11px] text-ink-dim">
                          从第
                          <select v-model.number="it.startSec" class="min-w-[3rem] flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                            <option v-for="n in recSecOptions()" :key="n" :value="n">{{ n }} 节</option>
                          </select>
                        </label>
                        <label class="flex items-center gap-1.5 text-[11px] text-ink-dim">
                          到第
                          <select v-model.number="it.endSec" class="min-w-[3rem] flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-xs outline-none focus:border-primary-400">
                            <option v-for="n in recSecOptions()" :key="n" :value="n">{{ n }} 节</option>
                          </select>
                        </label>
                      </div>
                      <p class="mt-1.5 text-[11px]" :class="recTimeRange(it) ? 'text-ink-dim' : 'text-red-600 dark:text-red-400'">
                        {{ recTimeRange(it) ? '上课时间 ' + recTimeRange(it) : '节次超出当前节次表，导入时会跳过这门课' }}
                      </p>
                      <div class="mt-2 space-y-2">
                        <input v-model="it.location" maxlength="30" placeholder="地点（可留空）" class="min-w-0 w-full truncate rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary-400" />
                        <input v-model="it.teacher" maxlength="20" placeholder="教师（可留空）" class="min-w-0 w-full truncate rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary-400" />
                      </div>
                      <p v-if="recItemHot(it)" data-item-conflict class="mt-1.5 text-[11px] leading-snug text-red-600 dark:text-red-400">与同一格的另一门课重叠：留一门，或者下面改成别的节次</p>
                    </div>
                    <button
                      type="button"
                      class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-red-300 transition active:scale-90"
                      aria-label="删除这条识别结果"
                      @click="recRemove(i)"
                    >
                      <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5h10M6.5 5V3.5h3V5M5 5l.6 8h4.8L11 5" /></svg>
                    </button>
                  </div>
                </div>
              </div>

              <p v-if="recPreview.notes.length" class="mt-2.5 text-[11px] text-ink-dim">图片里看不清的地方：{{ recPreview.notes.join('；') }}</p>
              <p v-if="obRecErr" class="mt-2.5 text-xs text-red-600 dark:text-red-400">{{ obRecErr }}</p>

              <div class="mt-4 flex gap-2.5">
                <button
                  data-rec-back-rec
                  class="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                  @click="recBack"
                >
                  返回识别页
                </button>
                <button
                  data-rec-import
                  class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
                  @click="recImport"
                >
                  {{ recFromMine ? '导入选中的 ' + recSelectedCount + ' 门课' : '导入选中的 ' + recSelectedCount + ' 门课，开始使用' }}
                </button>
              </div>
            </div>
          </div>

          <!-- 第 1 步：开学时间 / 本学期周数 / 课程时间设置（Day 14 用户测试反馈：
               原页文字、按钮、功能太多；重构为三项，节次编辑收进二级页） -->
          <div v-else-if="onboardStep === 'form' || onboardStep === 'periods'" key="form" class="relative overflow-hidden">
            <div class="relative overflow-hidden rounded-2xl border border-line bg-card p-4 shadow-sm">
              <Transition :name="obPageDir">
              <div v-if="onboardStep === 'form'" key="ob-form">
                <!-- ① 开学时间：弹层月历任意日期可点，内部归一到所在周周一 -->
                <button
                  type="button"
                  data-ob-start
                  class="mt-1 flex w-full items-center justify-between rounded-xl border border-line bg-canvas px-3.5 py-3 text-left transition active:scale-[0.99]"
                  @click="obPickStart"
                >
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold">开学时间</span>
                    <span class="mt-0.5 block truncate text-[11px]" :class="obStartHint.bad ? 'text-red-600 dark:text-red-400' : 'text-ink-dim'">{{ obStartHint.t }}</span>
                  </span>
                  <span class="shrink-0 text-xs font-medium" :class="obForm.first_monday ? 'text-primary-600' : 'text-ink-dim'">{{ obForm.first_monday || '选日期' }}</span>
                </button>

                <!-- ② 本学期周数：数字滚轮 -->
                <button
                  type="button"
                  data-ob-weeks
                  class="mt-2.5 flex w-full items-center justify-between rounded-xl border border-line bg-canvas px-3.5 py-3 text-left transition active:scale-[0.99]"
                  @click="obPickWeeks"
                >
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold">本学期周数</span>
                    <span class="mt-0.5 block text-[11px] text-ink-dim">假期不算，只算要上课的周</span>
                  </span>
                  <span class="shrink-0 text-sm font-semibold tabular-nums text-primary-600">{{ obForm.total_weeks }} 周</span>
                </button>

                <!-- ③ 课程时间设置：二级页 -->
                <button
                  type="button"
                  data-ob-time
                  class="mt-2.5 flex w-full items-center justify-between rounded-xl border border-line bg-canvas px-3.5 py-3 text-left transition active:scale-[0.99]"
                  @click="goObPeriods"
                >
                  <span class="min-w-0">
                    <span class="block text-sm font-semibold">课程时间设置</span>
                    <span class="mt-0.5 block truncate text-[11px] text-ink-dim">{{ obTimeSummary }}，点进去可调</span>
                  </span>
                  <svg viewBox="0 0 16 16" class="h-4 w-4 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
                </button>

                <p v-if="obErr" class="mt-2.5 text-xs text-red-600 dark:text-red-400" data-ob-err>{{ obErr }}</p>
                <div class="mt-4 flex gap-2.5">
                  <button
                    class="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                    @click="onboardStep = 'choice'"
                  >
                    返回
                  </button>
                  <button
                    data-ob-goto-rec
                    class="flex-1 rounded-xl bg-primary-500 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary-500/25 transition active:scale-[0.98]"
                    @click="goObRec"
                  >
                    下一步：识别课表
                  </button>
                </div>
                <button
                  data-ob-skip-rec
                  class="mt-2.5 w-full rounded-xl border border-line py-2.5 text-sm font-medium text-ink-dim transition active:scale-[0.98]"
                  @click="obSubmit"
                >
                  先跳过识别，自己加课
                </button>
              </div>

              <!-- ③ 的二级页：单节时长 / 课间（滚轮） + 上午/下午/晚上三块 -->
              <div v-else key="ob-periods">
                <div class="flex items-center justify-between">
                  <p class="text-sm font-semibold">课程时间设置</p>
                  <button type="button" data-ob-time-back class="rounded-lg px-2 py-1 text-xs font-medium text-primary-600 transition active:bg-primary-50" @click="backObForm">完成</button>
                </div>
                <p class="mt-1 text-[11px] text-ink-dim">改时长或课间，三块时间自动重排；开学时间在上一页</p>

                <div class="mt-3 grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    data-ob-dur
                    class="rounded-xl border border-line bg-canvas px-3 py-2.5 text-left transition active:scale-[0.99]"
                    @click="obPickDur"
                  >
                    <span class="block text-[11px] text-ink-dim">单节课程时长</span>
                    <span class="mt-0.5 block text-sm font-semibold tabular-nums text-primary-600">{{ obGlobal.dur }} 分钟</span>
                  </button>
                  <button
                    type="button"
                    data-ob-gap
                    class="rounded-xl border border-line bg-canvas px-3 py-2.5 text-left transition active:scale-[0.99]"
                    @click="obPickGap"
                  >
                    <span class="block text-[11px] text-ink-dim">课间休息时长</span>
                    <span class="mt-0.5 block text-sm font-semibold tabular-nums text-primary-600">{{ obGlobal.gap }} 分钟</span>
                  </button>
                </div>

                <div v-for="g in obSegGroups" :key="g.seg" class="mt-3 rounded-xl border border-line bg-canvas p-2.5" :data-ob-seg="g.seg">
                  <div class="flex items-center justify-between px-0.5">
                    <p class="text-xs font-semibold">{{ g.name }} · 第 {{ g.nos[0] }}–{{ g.nos[g.nos.length - 1] }} 节</p>
                    <p class="text-[11px] tabular-nums text-ink-dim">{{ g.start }}–{{ g.end }}</p>
                  </div>
                  <div class="mt-1.5 space-y-1">
                    <div v-for="i in g.nos.length" :key="g.from + i - 1" class="flex items-center gap-2 rounded-lg bg-card px-2 py-1.5" :data-ob-period-row="obForm.periods[g.from + i - 1].no">
                      <span class="w-8 shrink-0 text-[11px] font-semibold text-ink-dim">第{{ obForm.periods[g.from + i - 1].no }}节</span>
                      <button
                        type="button"
                        class="min-w-0 flex-1 rounded-md border border-line bg-card px-2 py-1 text-center text-xs tabular-nums transition active:scale-[0.98]"
                        @click="obPickPeriodStart(g.from + i - 1)"
                      >
                        {{ obForm.periods[g.from + i - 1].start }}
                      </button>
                      <span class="shrink-0 text-[11px] text-ink-dim">–</span>
                      <button
                        type="button"
                        class="min-w-0 flex-1 rounded-md border border-line bg-card px-2 py-1 text-center text-xs tabular-nums transition active:scale-[0.98]"
                        @click="obPickPeriodEnd(g.from + i - 1)"
                      >
                        {{ obForm.periods[g.from + i - 1].end }}
                      </button>
                      <button
                        type="button"
                        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-red-300 transition active:scale-90"
                        :aria-label="'删除第 ' + obForm.periods[g.from + i - 1].no + ' 节'"
                        @click="obRemovePeriod(g.from + i - 1)"
                      >
                        <svg viewBox="0 0 16 16" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 5h10M6.5 5V3.5h3V5M5 5l.6 8h4.8L11 5" /></svg>
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="mt-2 w-full rounded-lg border border-dashed border-line py-1.5 text-[11px] font-medium text-ink-dim transition active:scale-[0.98]"
                    :data-ob-seg-add="g.seg"
                    @click="obAddPeriod(g.seg)"
                  >
                    ＋ 加一节
                  </button>
                </div>

                <p v-if="obErr" class="mt-2.5 text-xs text-red-600 dark:text-red-400" data-ob-err>{{ obErr }}</p>
              </div>
              </Transition>
            </div>
          </div>
          </Transition>

                    <p class="mt-6 text-center text-[11px] text-ink-dim">这个选择只记一次，之后随时可以在「我的」页切换示例或导入</p>
          <input ref="onboardFile" data-ob-file type="file" accept=".json,application/json,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" class="hidden" @change="onOnboardFile" />
          <input ref="obRecFile" type="file" accept="image/*" class="hidden" @change="onObRecFile" />
        </div>
      </div>
</template>
