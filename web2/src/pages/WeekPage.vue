<script setup>
import { toRefs } from 'vue'
import { useApp } from '../composables/app-ctx.js'

const app = useApp()
/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。
   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */
const {
  courseCovering,
  gridStyleOf,
  isAligned,
  weekSubTerm,
  weekDayMarks,
  weekMenuOpen,
  toggleWeekMenu,
  menuAddCourse,
  menuAddEvent,
  menuScan,
  menuDayover,
  semester,
  events,
  entryName,
  toggleTodo,
  today,
  weekOffset,
  weekNo,
  weekCols,
  gridRows,
  gridRowOfIdx,
  gridCourses,
  gridColsStyle,
  gridBodyStyle,
  cardFit,
  isRoutine,
  pal,
  periods,
  gridStatus,
  nowClock,
  nowLineY,
  openDetail,
  gridDown,
  gridMove,
  gridUp,
  gridDbl,
} = toRefs(app)
</script>

<template>
      <!-- Stage 8（用户 m12154 拍的版）：顶部只留周次切换 + 右上 ＋ 选单。
           原来占一整条分段位的「周课表 / 其他日程」并进 ＋ 选单（手动加课 / 加日程 / 拍课表识别 / 其他日程），
           与今日页重复的问候卡在课表页也不再出现（头部整体只在别的页显示）→ 网格拿回整屏。
           2026-10-12：用户 m04853/m04885 把「其他日程」整块删了 —— 待办在今日页与「我的 → 待办清单」
           都有、独立日程在周课表里翻到那一周就看得到，单独一个跨周总览视图是重复入口。
           于是这里不再有 weekSub 二选一，课表页永远只渲染周课表。 -->
      <div class="relative mb-3 flex items-stretch gap-2">
        <!-- 周次切换 -->
        <section class="flex flex-1 items-center justify-between rounded-2xl border border-line bg-card px-2 py-2 shadow-sm">
          <button
            data-week-prev
            class="flex h-9 w-9 items-center justify-center rounded-xl text-ink-dim transition active:bg-soft-2"
            @click="weekOffset--"
          >
            <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L5 8l5 5" /></svg>
          </button>
          <p class="text-sm font-semibold" data-week-label>
            第 {{ weekNo }} 周
            <span class="ml-1 text-xs font-normal text-ink-dim">/ 共 {{ semester.totalWeeks }} 周</span>
            <!-- P13：这一周属于哪个小学期（标「秋/冬」的课只在各自那半段出现，显示出来好核对）。
                 用 ink-dim 而不是 primary-500：质量门 E4 实测过 —— primary-500 在暗色卡片上只有 3.69:1
                 （需 4.5），属于元信息就该用次要文字色。 -->
            <span v-if="weekSubTerm" class="ml-1 text-xs font-normal text-ink-dim" data-week-subterm>· {{ weekSubTerm }}</span>
          </p>
          <button
            data-week-next
            class="flex h-9 w-9 items-center justify-center rounded-xl text-ink-dim transition active:bg-soft-2"
            @click="weekOffset++"
          >
            <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3l5 5-5 5" /></svg>
          </button>
        </section>

        <!-- 右上「＋」：加课 / 加日程 / 拍课表识别 / 特殊日期 都在选单里
             （data-week-add 是它的旧锚点，data-mine-rec 跟着识别那一项搬进选单） -->
        <button
          data-week-add
          type="button"
          title="添加"
          aria-label="添加：加课 / 加日程 / 拍课表识别 / 特殊日期"
          aria-haspopup="menu"
          :aria-expanded="weekMenuOpen ? 'true' : 'false'"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-line bg-card text-primary-600 shadow-sm transition active:scale-95"
          @click="toggleWeekMenu"
        >
          <svg viewBox="0 0 16 16" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5v9M3.5 8h9" /></svg>
        </button>

        <!-- ＋ 选单：就地弹在 ＋ 下方（absolute 相对本行，不跟平移层的 transform 打架）。
             选中任一项、点别处（document 监听）、按返回键都会收起。
             2026-10-23 用户报「周课表右上角加号点开没有动画」：原来 v-if 直接显隐 = 硬闪，
             套 .ddpop 过渡（从触发器方向淡入 + 轻缩放 0.16s），与下拉面板同一套观感。 -->
        <Transition name="ddpop">
        <div
          v-if="weekMenuOpen"
          data-week-menu
          class="absolute right-0 top-[52px] z-40 w-44 overflow-hidden rounded-2xl border border-line bg-card py-1 shadow-xl"
        >          <button
            data-week-menu-course
            type="button"
            class="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm text-ink transition active:bg-soft"
            @click="menuAddCourse"
          >
            <svg viewBox="0 0 16 16" class="h-4 w-4 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="3" width="11" height="10.5" rx="2" /><path d="M2.5 6.5h11M8 9v3M6.5 10.5h3" /></svg>
            手动加课
          </button>
          <button
            data-week-menu-event
            type="button"
            class="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm text-ink transition active:bg-soft"
            @click="menuAddEvent"
          >
            <svg viewBox="0 0 16 16" class="h-4 w-4 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M3 8h10M3 11.5h6" /></svg>
            加日程
          </button>
          <button
            data-week-menu-scan
            data-mine-rec
            type="button"
            class="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm text-ink transition active:bg-soft"
            @click="menuScan"
          >
            <svg viewBox="0 0 16 16" class="h-4 w-4 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6V4.5A1.5 1.5 0 014.5 3H6M10 3h1.5A1.5 1.5 0 0113 4.5V6M13 10v1.5A1.5 1.5 0 0111.5 13H10M6 13H4.5A1.5 1.5 0 013 11.5V10M3.5 8h9" /></svg>
            拍课表识别
          </button>
          <button
            data-week-menu-dayover
            type="button"
            class="flex w-full items-center gap-2 border-t border-line px-3.5 py-2.5 text-left text-sm text-ink transition active:bg-soft"
            @click="menuDayover"
          >
            <svg viewBox="0 0 16 16" class="h-4 w-4 shrink-0 text-ink-dim" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5A1.5 1.5 0 013.5 3h9A1.5 1.5 0 0114 4.5v7a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5z" /><path d="M2 6.5h12M5.5 3v2M10.5 3v2M5.5 9.5l1.5 1.5 3-3" /></svg>
            特殊日期
          </button>
        </div>
        </Transition>
      </div>

      <!-- 节次网格：行 = 节次、列 = 星期、课程 = 格子 —— 一屏看完，不用上下左右滑。
           课程卡与格子共用同一套坐标系，所以不存在「平行线对不齐」这回事。 -->
      <section class="mt-3 overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
        <!-- 表头：星期 + 日期 -->
        <div class="grid border-b border-line" :style="gridColsStyle">
          <div class="py-1.5"></div>
          <div
            v-for="d in weekCols"
            :key="d.wd"
            class="border-l border-line/50 py-1.5 text-center"
          >
            <p class="text-[11px] leading-tight" :class="d.isToday ? 'font-semibold text-primary-600' : 'text-ink-dim'">周{{ d.label }}</p>
            <p class="mt-0.5 text-[12px] leading-tight font-semibold" :class="d.isToday ? 'text-primary-600' : 'text-ink'">
              {{ d.date }}
            </p>
            <!-- 调休标记：放假 / 补课 / 提示。放在日期下面一小枚，用户一眼看出「周六怎么有课」
                 是补课、而不是课表错了。 -->
            <span
              v-if="weekDayMarks[d.wd - 1]"
              :data-day-mark="weekDayMarks[d.wd - 1].kind"
              :title="weekDayMarks[d.wd - 1].title"
              class="mt-0.5 inline-block rounded px-1 py-[0.5px] text-[9px] font-semibold leading-tight"
              :class="weekDayMarks[d.wd - 1].kind === 'swap'
                ? 'bg-primary-500/15 text-primary-600'
                : 'bg-soft-2 text-ink'"
            >{{ weekDayMarks[d.wd - 1].label }}</span>
          </div>
        </div>

        <!-- 网格主体 -->
        <div
          data-grid
          class="relative grid select-none"
          :style="gridBodyStyle"
          @pointerdown="gridDown"
          @pointermove="gridMove"
          @pointerup="gridUp"
          @pointercancel="gridUp"
          @dblclick="gridDbl"
        >
          <!-- 「现在」游标（v1.41.6）：只在本周画；行是等高 1fr，按「第几行 + 行内比例」折算，
               午休/晚休也走自己的真实起止，所以它永远和格子里的课对齐。 -->
          <div
            v-if="nowLineY !== null"
            data-now-line
            class="pointer-events-none absolute inset-x-0 z-20"
            :style="{ top: nowLineY + 'px' }"
          >
            <div class="relative">
              <div class="absolute inset-x-0 h-[1.5px] -translate-y-1/2 bg-primary-500/75"></div>
              <div class="absolute left-0 top-0 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary-500 shadow-sm"></div>
              <span class="absolute right-0 top-0 -translate-y-1/2 rounded-full bg-primary-500 px-1.5 py-[1px] text-[9px] font-semibold leading-none text-white shadow-sm">
                {{ nowClock }}
              </span>
            </div>
          </div>
          <template v-for="(r, ri) in gridRows" :key="ri">
            <!-- 分隔行：上午/下午/晚上之间的午休、晚休（补回网格里看不见的时间差） -->
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

            <!-- 节次行：左侧「第N节 / 08:00」+ 每天的格子 -->
            <template v-else>
              <div
                :data-axis="r.p.no"
                class="flex flex-col items-center justify-center overflow-hidden bg-soft leading-none"
                :style="{ gridColumn: 1, gridRow: ri + 1 }"
              >
                <span class="text-[10px] font-semibold text-primary-600/90">第{{ r.p.no }}节</span>
                <span class="mt-0.5 text-[10px] text-ink-dim">{{ r.p.start }}</span>
              </div>
              <div
                v-for="d in weekCols"
                :key="d.wd"
                :data-cell="d.wd + '-' + r.idx"
                :data-today="d.isToday ? '1' : null"
                class="border-t border-l border-line/50"
                :class="d.isToday ? 'bg-primary-500/[0.06]' : ''"
                :style="{ gridColumn: d.wd + 1, gridRow: ri + 1 }"
              ></div>
            </template>
          </template>

          <!-- 课程卡：跨行表达连堂，与格线天然对齐；纯色块风格与识别预览表统一
               （2026-10-01 板块 C：去掉左侧 3px 色条与配套缩进，两边一套画法） -->
          <article
            v-for="it in gridCourses"
            :key="it.c.id"
            :data-item-type="it.c.type || 'course'"
            class="relative m-[1px] cursor-pointer overflow-hidden rounded-[5px] px-1 py-0.5 shadow-sm ring-1 ring-line/70 transition active:scale-[0.97]"
            :class="gridStatus(it) === 'now' ? 'ring-2 ring-primary-500' : (gridStatus(it) === 'past' ? 'opacity-55' : '')"
            :style="{ ...gridStyleOf(it, gridRowOfIdx), background: pal(it.c).bg }"
            @click="openDetail(it.c)"
          >
            <!-- 课名行包一层 flex：循环日程在课名前挂一枚小循环标记
                 （2026-10-01 用户拍板「卡片带小图标/前缀标记」，与固定灰蓝底色双重区分） -->
            <div class="flex items-start gap-[2px]">
              <svg
                v-if="isRoutine(it.c)"
                data-routine-mark
                viewBox="0 0 16 16"
                aria-label="循环日程"
                class="mt-[1.5px] h-3 w-3 shrink-0"
                :style="{ color: pal(it.c).text }"
                fill="none"
                stroke="currentColor"
                stroke-width="1.9"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M13 8a5 5 0 11-1.9-3.9" />
                <path d="M13 2.2V5h-2.8" />
              </svg>
              <!-- 课名与地点按卡片实际高度决定行数（2026-10-01 用户要「看到完整信息」）：
                   原来 truncate 只给一行，长课名（「习近平新时代…概论」）全被省略号吃掉。
                   min-w-0 是 flex 子项能正常收缩+clamp 的前提。 -->
              <p
                class="min-w-0 text-[10px] leading-[1.15] font-semibold"
                :class="cardFit(it) === 'tight' ? 'truncate' : 'line-clamp-2 break-words'"
                :style="{ color: pal(it.c).text }"
              >{{ it.c.name }}</p>
            </div>
            <p
              v-if="it.c.place && cardFit(it) !== 'mid2'"
              class="text-[10px] leading-tight text-ink-dim"
              :class="cardFit(it) === 'loose' ? 'line-clamp-3 break-words' : 'truncate'"
            >{{ it.c.place }}</p>
            <!-- 2026-10-13 用户 m12586：「周课表里的录音按钮可以去掉」。
                 原来 Stage 5 在这里贴了一颗开始/停止录音的小胶囊（data-week-rec-now）；
                 录音入口现在只留今日页顶卡那一处（同一个 startRec/courseCovering 口径）。 -->
            <!-- 只在与节次边界不齐时标真实时间（识别导入的课常见），对齐的不啰嗦 -->
            <span
              v-if="!isAligned(it.c, periods)"
              class="absolute right-0.5 bottom-0 text-[9px] leading-none text-ink-dim"
            >{{ it.c.start }}</span>
          </article>
        </div>
      </section>
</template>
