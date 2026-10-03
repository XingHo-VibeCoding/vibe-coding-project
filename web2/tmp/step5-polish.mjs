/* 方案 C · Step 5「二级页收尾」文本手术（一次性脚本，跑完即可留档）。
   做四件事，每步先断言锚点唯一，找不到就抛错、绝不半应用：
   1) 6 个底部浮层都能滚到底（补 max-h-[86vh] overflow-y-auto，并统一 86vh）
   2) 每个浮层遮罩都有统一锚点 data-sheet-mask（picker 用 data-picker-mask）
   3) 「背景滚动锁」收敛成唯一真源 syncBodyScrollLock()（浮层开着时锁住底下页面）
   4) 返回键链补全：练耳设置面板 / 设置折叠 / 课表「其他日程」子视图
   跑法：cd web2 && node tmp/step5-polish.mjs   （沙箱需 danger-full-access） */
import { readFileSync, writeFileSync } from 'node:fs'

const APP = 'D:/Document/Project/vibe-coding-project/web2/src/App.vue'
let src = readFileSync(APP, 'utf8')
const before = src
const log = []

function sub(name, from, to, expect) {
  const n = src.split(from).length - 1
  if (n !== expect) throw new Error(`锚点异常：${name} 期望 ${expect} 处，实际 ${n} 处 —— 未写盘`)
  src = src.split(from).join(to)
  log.push(`${name} ×${n}`)
}

/* ---- 1. 浮层可滚到底：5 个同款面板补 max-h + overflow-y-auto ---- */
const PANEL = 'class="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"'
const PANEL_FIXED = 'class="fixed inset-x-0 bottom-0 z-30 max-h-[86vh] overflow-y-auto mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"'
sub('浮层面板补可滚（detail/addPick/addForm/todoForm/evtForm）', PANEL, PANEL_FIXED, 5)
sub('统一可滚上限 85vh→86vh', 'max-h-[85vh]', 'max-h-[86vh]', 1)

/* ---- 2. 遮罩统一锚点 ---- */
// 7 个底部浮层的遮罩（habitSheet / detail / addPick / addForm / todoForm / evtForm / semForm）
sub('遮罩统一加 data-sheet-mask（含已有专属锚点的打卡层与长按菜单）',
  'class="fixed inset-0 z-20 bg-black/40"', 'data-sheet-mask class="fixed inset-0 z-20 bg-black/40"', 7)
sub('picker 遮罩加 data-picker-mask', 'class="fixed inset-0 z-40 bg-black/40" @click="picker = null"', 'data-picker-mask class="fixed inset-0 z-40 bg-black/40" @click="picker = null"', 1)

/* ---- 3. 背景滚动锁收敛 ---- */
sub('switchTab 改用 syncBodyScrollLock()',
  "  document.body.style.overflow = key === 'week' && weekSub.value === 'week' ? 'hidden' : ''",
  '  syncBodyScrollLock()', 1)
sub('setWeekSub 改用 syncBodyScrollLock()',
  "  document.body.style.overflow = tab.value === 'week' && v === 'week' ? 'hidden' : ''",
  '  syncBodyScrollLock()', 1)
sub('onMounted 改用 syncBodyScrollLock()',
  "  document.body.style.overflow = tab.value === 'week' ? 'hidden' : ''",
  '  syncBodyScrollLock()', 1)

/* ---- 4. 返回键链补全（放在最内层浮层都判完之后、退出之前）。注意 App.vue 是 CRLF ---- */
sub('返回键链补三层',
  '  if (evtForm.value) { evtForm.value = null; return true }',
  [
    '  if (evtForm.value) { evtForm.value = null; return true }',
    '  // 2026-10-03 方案 C Step 5：二级层一路往回收（练耳设置面板 → 设置折叠 → 课表子视图）',
    '  if (listenSettingsOpen.value) { listenSettingsOpen.value = false; return true }',
    '  if (settingsOpen.value) { settingsOpen.value = false; return true }',
    "  if (weekSub.value === 'list') { setWeekSub('week'); return true }",
  ].join('\r\n'), 1)

/* ---- 5. 末尾追加：锁滚动的唯一真源 + 监听 ---- */
const TAIL = [
  '/* ---------------- 二级层收尾（2026-10-03 方案 C Step 5） ----------------',
  '   背景滚动锁的唯一真源：任何浮层/二级页开着时，底下的页面不能再滑。',
  '   （此前只在周课表子视图锁，浮层打开后还能拖动背景页面。）',
  '   switchTab / setWeekSub / onMounted 都调 syncBodyScrollLock()；',
  '   函数声明会提升，所以上面几处调用点写在本段之前也安全。 */',
  'const anySheetOpen = computed(() => !!(',
  '  onboarding.value || habitSheet.value || detail.value || addPick.value ||',
  '  addForm.value || todoForm.value || evtForm.value || picker.value ||',
  '  confirmClear.value || delLecId.value || semForm.value',
  '))',
  'function syncBodyScrollLock() {',
  "  const lock = anySheetOpen.value || (tab.value === 'week' && weekSub.value === 'week')",
  "  document.body.style.overflow = lock ? 'hidden' : ''",
  '}',
  'watch([anySheetOpen, tab, weekSub], syncBodyScrollLock)',
  '',
].join('\r\n')
sub('末尾追加锁滚动真源', '</script>', TAIL + '</script>', 1)

writeFileSync(APP, src, 'utf8')
console.log(log.join('\n'))
console.log(`\nApp.vue: ${before.length} → ${src.length} 字符（+${src.length - before.length}）`)
