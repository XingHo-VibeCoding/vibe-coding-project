/* 方案 C · Step 1 结构改造一次性迁移脚本（2026-10-03）
   目的：把底部 tab 5→3（今天/课表/我的），「日程」页并进课表页做子视图，「打卡」页改成底部浮层。
   做法：纯文本手术 + 断言（找不到锚点就抛错，绝不半应用）。跑法：
     cd web2 && node tmp/step1-restructure.mjs
   只改 web2/src/App.vue 一个文件。 */
import fs from 'node:fs'

const P = 'D:/Document/Project/vibe-coding-project/web2/src/App.vue'
let s = fs.readFileSync(P, 'utf8')
const before = s
const hit = (name, from, to) => {
  if (from !== to && !s.includes(from)) throw new Error('锚点未找到：' + name)
  s = s.replace(from, to)
  console.log('✓ ' + name)
}

/* 1) tab 键 5 → 3 */
hit('TAB_KEYS', "const TAB_KEYS = ['today', 'week', 'list', 'habit', 'me']", "const TAB_KEYS = ['today', 'week', 'me']")

/* 2) 平移层宽度 500% → 300%（三个页面各 1/3） */
hit('平移层宽度', 'class="flex w-[500%] shrink-0 items-start overflow-y-clip touch-pan-y duration-[280ms]"',
  'class="flex w-[300%] shrink-0 items-start overflow-y-clip touch-pan-y duration-[280ms]"')
hit('今日页宽', '<main data-page="today" class="w-1/5 ', '<main data-page="today" class="w-1/3 ')
hit('课表页宽', '<main data-page="week" class="w-1/5 ', '<main data-page="week" class="w-1/3 ')
hit('我的页宽', '<main data-page="me" class="w-1/5 ', '<main data-page="me" class="w-1/3 ')

/* 3) 新增状态：课表子视图 + 打卡浮层 */
hit('新增状态 ref', 'const tabIndex = computed(() => TAB_KEYS.indexOf(tab.value))',
  `const tabIndex = computed(() => TAB_KEYS.indexOf(tab.value))
const weekSub = ref('week') // 课表页内「周课表 / 日程清单」分段（2026-10-03 方案 C Step 1：日程页并入）
const habitSheet = ref(false) // 打卡浮层（原「打卡」tab 改底部浮层，2026-10-03）`)

/* 4) 课表页锁滚动的条件要带上子视图：日程清单是要滚的 */
hit('body overflow 条件', "  document.body.style.overflow = key === 'week' ? 'hidden' : ''",
  "  document.body.style.overflow = key === 'week' && weekSub.value === 'week' ? 'hidden' : ''")
hit('setWeekSub 函数', '/* ---------------- 页高自适应 ----------------',
  `/* 课表页子视图切换（2026-10-03 方案 C Step 1）：只有「周课表」子视图要锁文档滚动，
   日程清单是要上下滚的，所以切换时重算一遍 body overflow 与网格顶。 */
function setWeekSub(v) {
  weekSub.value = v
  document.body.style.overflow = tab.value === 'week' && v === 'week' ? 'hidden' : ''
  setTimeout(measureGridTop, 320)
}

/* ---------------- 页高自适应 ----------------`)

/* 5) 返回键层级：打卡浮层最优先关闭 */
hit('返回键先关打卡浮层', '  if (picker.value) { picker.value = null; return true }',
  `  if (habitSheet.value) { habitSheet.value = false; return true } // 打卡浮层最外层（2026-10-03 方案 C）
  if (picker.value) { picker.value = null; return true }`)

/* 6) 取出「日程」页与「打卡」页的内部内容，再从平移层里删掉这两个 main */
function cutMain(page) {
  const startMark = '<main data-page="' + page + '"'
  const i = s.indexOf(startMark)
  if (i < 0) throw new Error('找不到 ' + page + ' main')
  const openEnd = s.indexOf('>', i) + 1
  const close = s.indexOf('</main>', openEnd)
  if (close < 0) throw new Error(page + ' main 没有闭合')
  const inner = s.slice(openEnd, close)
  s = s.slice(0, i) + s.slice(close + '</main>'.length)
  return inner
}
const listInner = cutMain('list')
const habitInner = cutMain('habit')
console.log('✓ 取出日程页内容 ' + listInner.length + ' 字符、打卡页内容 ' + habitInner.length + ' 字符')

/* 7) 课表页：顶部加「周课表 / 日程清单」分段，并把日程清单内容插在课表页末尾 */
hit('课表页分段切换', `      <!-- 周次切换 -->`,
  `      <!-- 课表 / 日程 分段切换（2026-10-03 方案 C Step 1：原「日程」页并入本页） -->
      <div data-week-sub class="mb-3 grid grid-cols-2 gap-1 rounded-2xl border border-line bg-card p-1 shadow-sm">
        <button
          type="button"
          data-week-sub-week
          class="rounded-xl py-1.5 text-sm font-medium transition"
          :class="weekSub === 'week' ? 'bg-primary-500 text-white shadow-sm' : 'text-ink-dim'"
          @click="setWeekSub('week')"
        >周课表</button>
        <button
          type="button"
          data-week-sub-list
          class="rounded-xl py-1.5 text-sm font-medium transition"
          :class="weekSub === 'list' ? 'bg-primary-500 text-white shadow-sm' : 'text-ink-dim'"
          @click="setWeekSub('list')"
        >日程清单</button>
      </div>

      <!-- 周次切换 -->`)
hit('周次切换只在课表子视图', '      <section class="flex items-center justify-between rounded-2xl border border-line bg-card px-2 py-2 shadow-sm">',
  `      <section v-if="weekSub === 'week'" class="flex items-center justify-between rounded-2xl border border-line bg-card px-2 py-2 shadow-sm">`)
hit('网格只在课表子视图', '      <section class="mt-3 overflow-hidden rounded-2xl border border-line bg-card shadow-sm">',
  '      <section v-if="weekSub === \'week\'" class="mt-3 overflow-hidden rounded-2xl border border-line bg-card shadow-sm">')

/* 把日程清单插到课表页 main 的收尾处 */
{
  const weekStart = s.indexOf('<main data-page="week"')
  const weekClose = s.indexOf('</main>', weekStart)
  if (weekStart < 0 || weekClose < 0) throw new Error('课表页 main 定位失败')
  const block = `
      <!-- 日程清单（原「日程」页并入课表页，2026-10-03 方案 C Step 1） -->
      <div v-if="weekSub === 'list'" class="mt-1 space-y-4">${listInner}
      </div>
    `
  s = s.slice(0, weekClose) + block + s.slice(weekClose)
  console.log('✓ 日程清单已并入课表页')
}

/* 8) 「今日」页的两处「管理 ›」不再切 tab，改成开浮层 */
{
  const n = (s.match(/@click="switchTab\('habit'\)"/g) || []).length
  s = s.replaceAll(`@click="switchTab('habit')"`, `@click="habitSheet = true"`)
  console.log('✓ 今日页打卡入口改为开浮层（' + n + ' 处）')
}

/* 9) 打卡浮层插在课程详情弹层之前 */
hit('打卡浮层', `    <!-- 课程详情弹层：点课卡弹出 -->`,
  `    <!-- 打卡浮层（2026-10-03 方案 C Step 1：原「打卡」tab 改为底部浮层） -->
    <Transition name="fade">
      <div v-if="habitSheet" data-habit-sheet-mask class="fixed inset-0 z-20 bg-black/40" @click="habitSheet = false"></div>
    </Transition>
    <Transition name="slide">
      <div
        v-if="habitSheet"
        data-habit-sheet
        class="fixed inset-x-0 bottom-0 z-30 mx-auto max-h-[86vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-line bg-card px-4 pt-3 pb-10 shadow-2xl"
      >
        <div class="mx-auto mb-3 h-1 w-9 rounded-full bg-ink/15"></div>
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-lg font-bold text-ink">打卡</h2>
          <button
            type="button"
            data-habit-sheet-close
            class="rounded-full bg-ink/5 px-3 py-1 text-xs font-medium text-ink-dim transition active:scale-95"
            @click="habitSheet = false"
          >关闭</button>
        </div>
        <div class="space-y-4">${habitInner}
        </div>
      </div>
    </Transition>

    <!-- 课程详情弹层：点课卡弹出 -->`)

/* 10) 底部导航：五格 → 三格 */
hit('导航栅格', 'class="relative mx-auto grid max-w-md grid-cols-5 px-6 py-1"',
  'class="relative mx-auto grid max-w-md grid-cols-3 px-6 py-1"')
hit('滑块宽度', 'class="flex h-full w-1/5 justify-center transition-transform duration-300"',
  'class="flex h-full w-1/3 justify-center transition-transform duration-300"')
{
  const m = s.match(/v-for="t in \[[\s\S]*?\]"/)
  if (!m) throw new Error('导航按钮数组没找到')
  s = s.replace(m[0], `v-for="t in [
            { key: 'today', label: '今日', icon: 'M8 3a5 5 0 100 10A5 5 0 008 3zM8 1v2M8 13v2M1 8h2M13 8h2' },
            { key: 'week', label: '周课表', icon: 'M2 4h12v11H2zM2 7h12M5.5 2v3M10.5 2v3' },
            { key: 'me', label: '我的', icon: 'M8 8a3 3 0 100-6 3 3 0 000 6zM2 14c0-2.5 2.5-4 6-4s6 1.5 6 4' },
          ]"`)
  console.log('✓ 导航按钮 5 → 3')
}

/* 11) 收尾断言：不该再出现 list / habit 页 */
for (const bad of ['data-page="list"', 'data-page="habit"', "switchTab('habit')", "switchTab('list')"]) {
  if (s.includes(bad)) throw new Error('改造后仍残留：' + bad)
}
if (s === before) throw new Error('什么都没改')

fs.writeFileSync(P, s, 'utf8')
console.log('\n已写回 ' + P + '（' + before.length + ' → ' + s.length + ' 字符）')
