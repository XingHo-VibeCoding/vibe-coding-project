<script setup>
import { toRefs } from 'vue'
import RowItem from '../components/RowItem.vue'
import { useApp } from '../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  streakOf,
  fmtSeconds,
  habitSheet,
  habits,
  habitToday,
  toggleHabit,
  habitsAllDoneToday,
  undoAllHabitsToday,
  reviewHistory,
  reviewMsg,
  reviewMsgBad,
  todayReview,
  openReview,
  listenDue,
  frameMarksToday,
  unmarkListenDone,
  listenTodayAll,
  listenPlayId,
  listenPlayRound,
  listenPlayTotal,
  listenPaused,
  onListenPlay,
  todos,
  toggleTodo,
  TODO_FILTERS,
  todoFilter,
  shownTodos,
  setTodoFilter,
  openTodoAdd,
  openTodoEdit,
  openEventAdd,
  today,
  todayCourses,
  todayMark,
  state,
  nextTodayId,
  rowMeta,
  todayPast,
  todayExpanded,
  pastOpen,
  pastSpan,
  livePreview,
  hiddenCount,
  isRoutine,
  pal,
  courseStatus,
  openDetail,
} = toRefs(app)
</script>

<template>
      <!-- Stage 2：原来这条「今天 N 节课 / 待办 + 进度条」窄条已并进顶卡页脚（同一锚点 data-today-strip），
           今天页正文从「接下来」开始——首屏第一眼是顶卡的「现在做什么」。 -->

      <!-- 接下来：今天剩下的安排（课程 / 循环日程 / 今天的独立日程）。
           2026-10-03 方案 C Step 2：原「今日课程」改名并提到今天页最前——旧版首页把课藏在一张
           大录音卡下面，打开第一眼看到的是「开始录音」而不是「我接下来要上什么」。
           nextTodayId 命中那条（正在进行、否则最近的一节）打 data-today-next，供检查脚本定位。
           课堂录音卡下沉到页面末尾（它的使用时机是"课已开始"，不该占第一屏）。 -->
      <section>
        <h2 class="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-ink">
          <span>接下来</span>
          <!-- 调休：今天放假/补课/有提示时挂一枚小标，回答「今天为什么没课」「周六为什么有课」。
               没有特殊日期就什么都不加（老数据零变化）。 -->
          <span
            v-if="todayMark"
            :data-today-mark="todayMark.kind"
            class="rounded px-1.5 py-[1px] text-[10px] font-semibold leading-tight"
            :class="todayMark.kind === 'swap' ? 'bg-primary-500/15 text-primary-600' : 'bg-soft-2 text-ink'"
          >{{ todayMark.label }}</span>
          <span v-if="todayMark" data-today-mark-note class="text-[11px] font-normal text-ink-dim">{{ todayMark.note }}</span>
        </h2>
        <div v-if="todayCourses.length" class="space-y-0.5">
          <!-- Stage 4：已过压成一行（点开就地展开成 26px 行，内容一条不丢） -->
          <button
            v-if="!todayExpanded && todayPast.length"
            data-today-past-fold
            class="relative flex w-full items-center gap-2 py-[3px] text-left text-[11px] leading-[20px] text-ink-dim after:absolute after:inset-x-0 after:-inset-y-[9px] after:content-[''] active:opacity-70"
            :aria-expanded="pastOpen"
            @click="pastOpen = !pastOpen"
          >
            <span class="w-10 flex-none text-right tabular-nums">已过</span>
            <span class="min-w-0 flex-1 truncate">{{ todayPast.length }} 件 · {{ pastSpan }}</span>
            <span class="flex-none">{{ pastOpen ? '收起 ▴' : '展开 ▾' }}</span>
          </button>
          <!-- 动效约定 1a：D（折叠一行）↔ F（全天 26px 表）在同一位置交叉淡入 0.2s，
               滚动位置不动。key 挂在 Transition 上：换密度时旧列表整体淡出、新列表淡入；
               行高两种密度完全一样，所以淡入淡出期间容器高度不跳。 -->
          <Transition name="density" mode="out-in">
            <div v-if="todayExpanded" key="dense">
              <RowItem
                v-for="c in todayCourses"
                :key="c.id"
                data-today-item
                :data-today-next="c.id === nextTodayId || undefined"
                :data-item-type="c.type || 'course'"
                :time="c.start"
                :title="c.name"
                :sub="[c.place, c.tag].filter(Boolean).join(' · ')"
                :meta="rowMeta(c)"
                :state="courseStatus(c) === 'past' ? 'done' : courseStatus(c) === 'now' ? 'now' : 'plain'"
                :tone="isRoutine(c) ? pal(c).text : ''"
                :routine="isRoutine(c)"
                clickable
                @click="openDetail(c)"
              />
            </div>
            <div v-else key="list">
              <template v-if="pastOpen">
                <RowItem
                  v-for="c in todayPast"
                  :key="c.id"
                  data-today-item
                  data-today-past-row
                  :data-item-type="c.type || 'course'"
                  :time="c.start"
                  :title="c.name"
                  :sub="[c.place, c.tag].filter(Boolean).join(' · ')"
                  :meta="rowMeta(c)"
                  state="done"
                  :tone="isRoutine(c) ? pal(c).text : ''"
                  :routine="isRoutine(c)"
                  clickable
                  @click="openDetail(c)"
                />
              </template>
              <RowItem
                v-for="c in livePreview"
                :key="c.id"
                data-today-item
                :data-today-next="c.id === nextTodayId || undefined"
                :data-item-type="c.type || 'course'"
                :time="c.start"
                :title="c.name"
                :sub="[c.place, c.tag].filter(Boolean).join(' · ')"
                :meta="rowMeta(c)"
                :state="courseStatus(c) === 'now' ? 'now' : 'plain'"
                :tone="isRoutine(c) ? pal(c).text : ''"
                :routine="isRoutine(c)"
                clickable
                @click="openDetail(c)"
              />
            </div>
          </Transition>
          <!-- 展开全部 = 就地换密度（D → F），不换页、行高不变；收起后回到「已过一行 + 接下来 3 行」
               —— 密度切换的交叉淡入见上面 <Transition name="density">（动效约定 1a） -->
          <button
            v-if="hiddenCount > 0 || todayExpanded"
            data-today-expand
            class="relative flex w-full items-center gap-2 py-[3px] text-left text-[11px] leading-[20px] text-ink-dim after:absolute after:inset-x-0 after:-inset-y-[9px] after:content-[''] active:opacity-70"
            :aria-expanded="todayExpanded"
            @click="
              todayExpanded = !todayExpanded;
              if (todayExpanded) pastOpen = false
            "
          >
            <span class="w-10 flex-none text-right tabular-nums">{{ todayExpanded ? '收起' : '全部' }}</span>
            <span class="min-w-0 flex-1 truncate">
              {{ todayExpanded ? '只看接下来' : `共 ${todayCourses.length} 件 · 展开全部` }}
            </span>
            <span class="flex-none text-ink-dim">{{ todayExpanded ? '▴' : '▾' }}</span>
          </button>
        </div>
        <p v-else class="rounded-2xl border border-dashed border-line bg-card/60 p-6 text-center text-sm text-ink-dim">
          今天没有课程安排～
        </p>
        <button
          class="mt-2 flex w-full items-center justify-center rounded-2xl border border-dashed border-line bg-card/60 py-2.5 text-xs font-medium text-ink-dim transition active:bg-soft"
          @click="openEventAdd"
        >
          ＋ 添加日程（班会、聚餐这类）
        </button>
      </section>

      <!-- 待办：轻量勾选 -->
      <section>
        <h2 class="mb-2 px-1 text-sm font-semibold text-ink">今天要交 <span class="text-xs font-normal text-ink-dim">· 待办</span></h2>
        <!-- 状态筛选 chips：热区 min-h-11(44px)、选中态走字重+主色、aria-pressed 供读屏；
             一条待办都没有且不在筛选态时不出现（无感易用） -->
        <div
          v-if="todos.length || todoFilter !== 'all'"
          class="mb-2 flex flex-wrap gap-2 px-1"
          role="group"
          aria-label="待办状态筛选"
        >
          <button
            v-for="f in TODO_FILTERS"
            :key="f.key"
            type="button"
            class="flex min-h-11 items-center rounded-full border px-4 text-[13px] transition active:scale-95"
            :class="todoFilter === f.key
              ? 'border-primary-500 bg-primary-500/10 font-semibold text-primary-600'
              : 'border-line bg-card text-ink-dim'"
            :aria-pressed="todoFilter === f.key"
            @click="setTodoFilter(f.key)"
          >
            {{ f.label }}
          </button>
        </div>
        <div v-if="shownTodos.length" class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
          <div
            v-for="t in shownTodos"
            :key="t.id"
            class="flex items-center gap-3 p-3.5"
          >
            <!-- 打勾只认这个圆圈（不能把整行包成 label：button 是 label 的隐式关联控件，点行内任意处都会触发打勾）。
                 24×24 是 WCAG 2.5.8(AA) 的目标下限，原先的 h-5.5(22px) 差 2px（2026-10-04 A4 扫描）。 -->
            <button
              type="button"
              class="-m-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 p-1.5 transition active:scale-90"
              :class="t.done ? 'border-primary-500 bg-primary-500' : 'border-ink-dim/40'"
              :aria-label="t.done ? '标记为未完成' : '标记为完成'"
              @click="toggleTodo(t.id)"
            >
              <svg v-if="t.done" viewBox="0 0 16 16" class="h-3 w-3 text-white" fill="none">
                <path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <span
              class="min-w-0 flex-1 cursor-pointer truncate text-sm"
              :class="t.done ? 'text-ink-dim line-through' : ''"
              @click.stop="openTodoEdit(t)"
            >
              {{ t.title }}
            </span>
            <span class="shrink-0 text-[11px]" :class="t.done ? 'text-ink-dim' : 'text-primary-600'">
              {{ t.due }}
            </span>
          </div>
        </div>
        <!-- 空态三档：筛选中明确「是筛选导致空，不是数据丢了」 -->
        <p
          v-else-if="todoFilter !== 'all'"
          class="rounded-2xl border border-dashed border-line bg-card/60 p-6 text-center text-sm text-ink-dim"
        >
          没有{{ todoFilter === 'open' ? '未完成' : '已完成' }}的待办
        </p>
        <p v-else class="rounded-2xl border border-dashed border-line bg-card/60 p-6 text-center text-sm text-ink-dim">
          没有待办，轻松自在～
        </p>
        <button
          class="mt-2 flex w-full items-center justify-center rounded-2xl border border-dashed border-line bg-card/60 py-3 text-sm font-medium text-ink-dim transition active:bg-soft"
          @click="openTodoAdd"
        >
          ＋ 添加待办
        </button>
      </section>

<!-- 今日打卡（三期）：今日页只留「一按即打」这个高频动作——它跟「今天的课/待办」同住一屏，
     不用为了打个卡先切页。7 格 / 连续 / 累计 / 添加 / 删除 / 补卡都是管理动作（低频），
     全部收在「打卡」页，同一个动作不到处各写一份。
     打卡圆圈保留 h-11 热区；aria-label 沿用「今日打卡 / 取消今日打卡」。
     ⚠️ 减法（2026-10-02）：**全部打完就收成一行**——不摆无意义的 0 项待办列表，
     已完成的事退出视线（设计三原则之一「与当前任务无关的界面元素绝不出现」）。
     收起来后仍要能「取消打卡」和进管理页，所以那一行右边留小勾按钮 + 管理入口。 -->
<section>
  <!-- 全部打完：一行摘要（可取消 · 可进管理 · 可展开回看） -->
  <div v-if="habits.length && habitsAllDoneToday" data-today-habit-done class="flex items-center gap-2 px-1">
    <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-500 text-white">
      <svg viewBox="0 0 16 16" class="h-3 w-3" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </span>
    <p class="min-w-0 flex-1 truncate text-xs text-ink-dim">今日打卡已完成 · {{ habits.length }} 项</p>
    <button
      type="button"
      data-today-habit-undo
      class="shrink-0 text-xs text-ink-dim underline decoration-dotted underline-offset-2 transition active:opacity-60"
      @click="undoAllHabitsToday"
    >
      取消
    </button>
    <button
      type="button"
      data-today-habit-more
      class="shrink-0 rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-ink-dim transition active:scale-95"
      @click="habitSheet = true"
    >
      管理 ›
    </button>
  </div>

  <template v-else>
    <div class="mb-2 flex items-center justify-between px-1">
      <h2 class="text-sm font-semibold text-ink">今天要坚持 <span class="text-xs font-normal text-ink-dim">· 打卡</span></h2>
      <button
        type="button"
        data-today-habit-more
        class="rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-ink-dim transition active:scale-95"
        @click="habitSheet = true"
      >
        管理 ›
      </button>
    </div>

    <div v-if="habits.length" class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
      <div v-for="h in habits" :key="h.id" :data-today-habit="h.id" class="flex items-center gap-3 p-3.5">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm" :class="h.records[habitToday] ? 'text-ink-dim' : 'text-ink'">{{ h.name }}</p>
          <p class="mt-0.5 text-[11px] text-ink-dim">{{ streakOf(h, habitToday) > 0 ? '连续 ' + streakOf(h, habitToday) + ' 天' : '未开始' }}</p>
        </div>
        <!-- 打卡主操作：h-11 = 44px 热区；已打卡实心勾（可点取消） -->
        <button
          type="button"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-90"
          :class="h.records[habitToday] ? 'bg-primary-500 text-white' : 'border-2 border-ink-dim/30 text-ink-dim/40'"
          :aria-label="h.records[habitToday] ? '取消今日打卡' : '今日打卡'"
          @click="toggleHabit(h.id)"
        >
          <svg viewBox="0 0 16 16" class="h-4.5 w-4.5" fill="none"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </div>
    </div>
    <p v-else class="rounded-2xl border border-dashed border-line bg-card/60 p-5 text-center text-sm text-ink-dim">
      还没有打卡习惯，点右上「管理」建一个
    </p>
  </template>
</section>

      <!-- 今天要听（2026-10-03 方案 C Step 3）：到期音频在首页就地排两行、点一下直接放。
           它的使用时机就是「今天有空 + 今天到期」，不该逼人先切到「我的」去找那张卡。
           超过 2 段给「还有 N 段」就地展开，不新增页面；没有到期音频时整段不出现。 -->
      <section v-if="listenDue.length" data-today-listen>
        <div class="mb-2 flex items-center justify-between px-1">
          <h2 class="text-sm font-semibold text-ink">今天要听 <span class="text-xs font-normal text-ink-dim">· 练耳</span></h2>
          <button
            v-if="listenDue.length > 2"
            type="button"
            data-today-listen-more
            class="rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-ink-dim transition active:scale-95"
            @click="listenTodayAll = !listenTodayAll"
          >
            {{ listenTodayAll ? '收起' : '还有 ' + (listenDue.length - 2) + ' 段 ›' }}
          </button>
        </div>
        <ul class="divide-y divide-line rounded-2xl border border-line bg-card shadow-sm">
          <li
            v-for="c in (listenTodayAll ? listenDue : listenDue.slice(0, 2))"
            :key="c.id"
            :data-today-listen-item="c.id"
            class="flex items-center gap-3 p-3.5"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm text-ink">
                {{ c.name }}
                <!-- P2：通知栏按过「我去听了」的那段，这里不再假装没发生过：
                     仍然列出来（今天确实到期、你可能还想听），只是打个标记并给「撤销」。 -->
                <span
                  v-if="frameMarksToday.listenDone.includes(c.id)"
                  data-today-listen-mark
                  class="ml-1.5 rounded-full bg-soft-2 px-2 py-0.5 align-middle text-[10px] font-normal text-ink-dim"
                >今天已去听过</span>
              </p>
              <p class="mt-0.5 text-[11px] text-ink-dim">
                已听 {{ c.played_count }} 次 · {{ fmtSeconds(c.seconds) }}<template v-if="listenPlayId === c.id && listenPlayTotal > 1"> · <span class="font-medium text-primary-600" data-listen-round>第 {{ listenPlayRound }}/{{ listenPlayTotal }} 遍</span></template>
              </p>
            </div>
            <button
              v-if="frameMarksToday.listenDone.includes(c.id)"
              type="button"
              :data-today-listen-unmark="c.id"
              class="h-11 shrink-0 rounded-full px-3 text-xs font-medium text-ink-dim transition active:scale-95"
              @click="unmarkListenDone(c.id)"
            >撤销</button>
            <button
              type="button"
              :data-today-listen-play="c.id"
              class="h-11 shrink-0 rounded-full px-4 text-sm font-medium transition active:scale-95"
              :class="listenPlayId === c.id && !listenPaused ? 'bg-primary-500 text-white' : 'bg-primary-50 text-primary-500'"
              :aria-label="listenPlayId === c.id && !listenPaused ? '停止播放' : '播放'"
              @click="onListenPlay(c)"
            >
              {{ listenPlayId === c.id ? (listenPaused ? '继续' : '停止') : '播放' }}
            </button>
          </li>
        </ul>
      </section>

      <!-- 课堂录音（M5 第 2 步）：Stage 2 起压成顶卡主体里的一颗「录音」钮（见 header 的 data-today-rec），
           今天页正文里不再单占一张卡——用户 m12341：「太显眼了」。 -->

      <!-- ===== 每日复盘（五期）=====
           Stage 2 起不再常驻（用户 m12341：它是每天最后只做一次的事）：
           该收尾的时候（晚上、还没复盘）入口在顶卡主体里；写完之后只在今天页留这一行「今天的日精进」，
           想改还能点「改一改」，想回顾点右上「日精进 N 篇」。存档只在本机（web2.review），不进主项目导出。 -->
      <section v-if="todayReview" data-today-review class="rounded-2xl border border-line bg-card px-3.5 py-3 shadow-sm">
        <div class="flex items-baseline justify-between gap-2">
          <p class="text-xs font-semibold text-ink">今天的日精进</p>
          <button
            v-if="reviewHistory.length"
            data-review-open-history
            class="shrink-0 text-[11px] text-ink-dim transition active:scale-95"
            @click="openReview('history')"
          >日精进 {{ reviewHistory.length }} 篇 ›</button>
        </div>
        <p data-today-review-summary class="mt-1 line-clamp-2 whitespace-pre-line text-[11.5px] leading-relaxed text-ink-dim">{{ todayReview.summary }}</p>
        <div class="mt-2.5 flex items-center gap-2">
          <button
            data-review-start
            class="rounded-full bg-soft px-3.5 py-1.5 text-xs font-medium transition active:scale-95"
            @click="openReview('ask')"
          >改一改</button>
          <button
            data-review-open-result
            class="rounded-full bg-primary-500 px-3.5 py-1.5 text-xs font-medium text-white shadow-md shadow-primary-500/25 transition active:scale-95"
            @click="openReview('result')"
          >转待办 / 再看一遍</button>
        </div>
        <p v-if="reviewMsg" data-review-card-msg class="mt-2 text-[11px]" :class="reviewMsgBad ? 'text-red-600 dark:text-red-400' : 'text-primary-600'">{{ reviewMsg }}</p>
      </section>
</template>
