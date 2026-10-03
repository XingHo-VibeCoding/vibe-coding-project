/* 方案 C · Step 4 结构改造一次性迁移脚本（2026-10-03）
   目的：① 拍课表识别从「我的」页搬到课表页右上「＋」（保留 data-mine-rec 锚点，
            另给 data-week-add）；② 我的页常显的「主题配色」色点并进设置折叠里的
            「主题外观」行（此前有两个主题入口）；③ 同步改 2 个点旧入口的测试脚本。
   做法：按行手术 + 断言（找不到锚点就抛错，绝不半应用）。跑法：
     cd web2 && node tmp/step4-restructure.mjs
   只改 web2/src/App.vue + web2/tmp/mine-rec-check.mjs + web2/tmp/ob-ai-cfg-check.mjs。 */
import fs from 'node:fs'

const ROOT = 'D:/Document/Project/vibe-coding-project/web2'
const P = ROOT + '/src/App.vue'
const raw = fs.readFileSync(P, 'utf8')
const eol = raw.includes('\r\n') ? '\r\n' : '\n'
const lines = raw.split(eol)

const idxOf = (pred, name, from = 0) => {
  for (let i = from; i < lines.length; i++) if (pred(lines[i], i)) return i
  throw new Error('找不到行：' + name)
}
const eq = (t) => (l) => l === t
const has = (t) => (l) => l.includes(t)

/* ---------- ① 课表页：分段控件右侧加「＋」入口 ---------- */
const iOpen = idxOf(has('<div data-week-sub class="mb-3 grid grid-cols-2'), '课表页分段控件开标签')
const iClose = idxOf(eq('      </div>'), '课表页分段控件闭合', iOpen)
if (iClose <= iOpen) throw new Error('分段控件闭合位置异常')
// 里面几行整体缩进两级（外层多包了一个 flex 行）
for (let i = iOpen; i <= iClose; i++) lines[i] = '  ' + lines[i]
lines[iOpen] = '      <div class="mb-3 flex items-center gap-2">'
lines.splice(iOpen + 1, 0, '      <div data-week-sub class="grid flex-1 grid-cols-2 gap-1 rounded-2xl border border-line bg-card p-1 shadow-sm">')
const iClose2 = iClose + 1
const plusHtml = [
  '      <!-- 拍课表识别（第三步）：2026-10-03 方案 C Step 4 从「我的」页搬到课表页右上角。',
  '           仍复用识别页/核对页，用当前学期节次表换算，导入走增量；原锚点保留不动，',
  '           另给 data-week-add 表明新家。 -->',
  '      <button',
  "        v-if=\"weekSub === 'week'\"",
  '        data-week-add',
  '        data-mine-rec',
  '        type="button"',
  '        title="拍课表识别"',
  '        aria-label="拍课表识别：截图课表自动加课"',
  '        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-line bg-card text-primary-500 shadow-sm transition active:scale-95"',
  '        @click="mineRecStart"',
  '      >',
  '        <svg viewBox="0 0 16 16" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5v9M3.5 8h9" /></svg>',
  '      </button>',
  '      </div>',
].join(eol)
if (!plusHtml.includes('data-week-add')) throw new Error('＋ 按钮拼装失败')
lines.splice(iClose2 + 1, 0, ...plusHtml.split(eol))
console.log('✓ 课表页右上「＋」入口')

/* ---------- ② 我的页：删掉「拍课表识别」整块 ---------- */
const iRec = idxOf(has('<!-- 拍课表识别（第三步）：复用识别页/核对页'), '我的页拍课表识别注释')
const iRecNext = idxOf(has('<!-- 课堂录音（二期 M2）'), '我的页课堂录音注释', iRec)
const cutN = iRecNext - 1 - iRec + 1 // 保留下一块前的那一行空行
lines.splice(iRec, cutN)
console.log('✓ 我的页已移除拍课表识别块（' + cutN + ' 行）')

/* ---------- ③ 我的页：常显的「主题配色」色点行删掉 ---------- */
const iAccent = idxOf(has('<!-- 配色皮肤：色点即点即换 -->'), '主题配色注释')
const iImport = idxOf(has('<!-- 导入主项目数据 -->'), '导入主项目数据注释', iAccent)
lines.splice(iAccent, iImport - 2 - iAccent + 1)
console.log('✓ 我的页已移除重复的「主题配色」常显行')

/* ---------- ④ 设置折叠：「主题外观」行并入色点 + 明暗切换按钮 ---------- */
const iTheme = idxOf(has('<span class="flex-1 text-sm font-medium">主题外观</span>'), '主题外观行文案')
// 该行容器从上一个 <div 开始，到本行之后的 </div> 结束
let iThemeStart = iTheme
while (iThemeStart > 0 && !/^\s*<div$/.test(lines[iThemeStart])) iThemeStart--
if (iThemeStart <= 0) throw new Error('主题外观行容器起点未找到')
const iThemeEnd = idxOf(eq('        </div>'), '主题外观行容器闭合', iTheme)
const themeBlock = [
  '        <!-- 主题外观 + 主题配色（2026-10-03 方案 C Step 4：原「我的」页常显的「主题配色」',
  '             并进这里 —— 此前有两个主题入口，现在一个入口管全部外观）。 -->',
  '        <div class="p-4">',
  '          <div class="flex items-center gap-3.5">',
  '            <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50">',
  '              <svg viewBox="0 0 16 16" class="h-4.5 w-4.5 text-primary-500" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 9.5A6 6 0 116.5 2.5a5 5 0 007 7z" /></svg>',
  '            </span>',
  '            <span class="min-w-0 flex-1">',
  '              <span class="block text-sm font-medium">主题外观</span>',
  "              <span class=\"block text-[11px] text-ink-dim/70\">{{ isDark ? '当前：深色' : '当前：浅色' }}</span>",
  '            </span>',
  '            <button',
  '              type="button"',
  '              data-theme-toggle',
  '              class="flex shrink-0 items-center gap-1.5 rounded-full bg-ink/5 px-3 py-2 text-xs font-medium text-ink-dim transition active:scale-95"',
  '              @click="toggleTheme"',
  '            >',
  '              <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h9M9.5 2.5L12 5l-2.5 2.5M13 11H4M6.5 8.5L4 11l2.5 2.5" /></svg>',
  "              {{ isDark ? '切浅色' : '切深色' }}",
  '            </button>',
  '          </div>',
  '          <div class="mt-3 flex items-center gap-3 border-t border-line pt-3">',
  '            <span class="text-[11px] text-ink-dim/80">主题配色</span>',
  '            <div class="flex items-center gap-2.5">',
  '              <button',
  '                v-for="a in ACCENTS"',
  '                :key="a.key"',
  '                class="h-6 w-6 rounded-full transition active:scale-90"',
  '                :class="accent === a.key ? \'ring-2 ring-primary-400 ring-offset-2 ring-offset-card\' : \'\'"',
  '                :style="{ background: a.color }"',
  '                :title="a.name"',
  '                @click="setAccent(a.key)"',
  '              ></button>',
  '            </div>',
  '          </div>',
  '        </div>',
]
lines.splice(iThemeStart, iThemeEnd - iThemeStart + 1, ...themeBlock)
console.log('✓ 设置折叠：「主题外观」行并入配色色点')

const out = lines.join(eol)
if (!out.includes('data-week-add') || out.includes('拍课表识别（第三步）：复用识别页')) throw new Error('自检失败')
if ((out.match(/data-mine-rec(?![-\w])/g) || []).length !== 1) throw new Error('data-mine-rec 应恰有 1 个')
if (out.includes('色点即点即换')) throw new Error('旧的常显配色行没删干净')
fs.writeFileSync(P, out)
console.log('✓ App.vue 已写回，行数 ' + lines.length)

/* ---------- ⑤ 同步 2 个点旧入口的测试脚本 ---------- */
const fix = (file, pairs) => {
  let t = fs.readFileSync(file, 'utf8')
  const feol = t.includes('\r\n') ? '\r\n' : '\n'
  for (const [a0, b0] of pairs) {
    const a = a0.replace(/\n/g, feol)
    const b = b0.replace(/\n/g, feol)
    if (!t.includes(a)) throw new Error('脚本锚点未找到：' + file + ' :: ' + a.slice(0, 40))
    t = t.replace(a, b)
  }
  fs.writeFileSync(file, t)
  console.log('✓ 已同步 ' + file.replace(/^.*\//, '') + '（' + pairs.length + ' 处）')
}

fix(ROOT + '/tmp/mine-rec-check.mjs', [
  ["const mineNav = page.locator('nav button', { hasText: '我的' })", "const mineNav = page.locator('nav button', { hasText: '周课表' })"],
  ["t('A2. 「我的」页有识别入口'", "t('A2. 课表页右上「＋」有识别入口'"],
  ["t('C1. 取消后回到应用（我的页可见）'", "t('C1. 取消后回到应用（课表页可见）'"],
])

fix(ROOT + '/tmp/ob-ai-cfg-check.mjs', [
  ["await page.locator('nav button', { hasText: '我的' }).click()\n  await page.waitForTimeout(400)\n  await page.locator('[data-mine-rec]').click()",
    "await page.locator('nav button', { hasText: '周课表' }).click()\n  await page.waitForTimeout(400)\n  await page.locator('[data-mine-rec]').click()"],
  ["t('I1. 我的页识别入口、缺 Key → 落到配置页（不再只给红字）'", "t('I1. 课表页识别入口、缺 Key → 落到配置页（不再只给红字）'"],
  ["t('I3. 取消后整层关掉、回到我的页'", "t('I3. 取消后整层关掉、回到课表页'"],
])
