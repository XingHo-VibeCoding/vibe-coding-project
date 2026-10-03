/* Step 6：把 7 处逐字复制的底部浮层外壳收进 web2/src/components/BottomSheet.vue。
   做法：按 <div>/</div> token 配平找到每个面板的闭合位置，把
     「<Transition name="fade"> + 遮罩 + </Transition> + <Transition name="slide"> + 面板开标签 + 把手行」
   整段换成 <BottomSheet …>，把「面板 </div> + </Transition>」换成 </BottomSheet>，正文减 2 空格缩进。
   每一步都做锚点/结构断言：任何一处不符合预期就抛错，绝不半写盘。

   用法（在 web2 目录下）：
     node tmp/step6-sheet-extract.mjs           只打印计划，不写盘
     node tmp/step6-sheet-extract.mjs --write   真写盘
   注意：src/App.vue 是 CRLF，插入的多行文本必须用 \r\n 拼。 */
import fs from 'node:fs'
import path from 'node:path'

const FILE = path.resolve(process.cwd(), 'src/App.vue')
const WRITE = process.argv.includes('--write')
let src = fs.readFileSync(FILE, 'utf8')

const EOL = src.includes('\r\n') ? '\r\n' : '\n'
const count = (s, needle) => s.split(needle).length - 1
/* 只匹配真正的把手 div，别把生成出来的 handle-class="…" 也算进去 */
const HANDLE_NEEDLE = 'bg-ink/15"></div>'
/* 组件里写死的外壳基类：面板 class 必须完整包含这些，多出来的才作为 panel-class 传 */
const BASE = [
  'fixed', 'inset-x-0', 'bottom-0', 'z-30', 'mx-auto', 'max-h-[86vh]', 'w-full', 'max-w-md',
  'overflow-y-auto', 'rounded-t-3xl', 'border-t', 'border-line', 'bg-card', 'shadow-2xl',
]
const DEFAULT_PAD = 'p-5 pb-10'
const DEFAULT_HANDLE = 'mx-auto mb-3 h-1 w-9 rounded-full bg-ink/15'

const SPECS = [
  { name: '打卡浮层', expr: 'habitSheet', sheetAttr: 'data-habit-sheet' },
  { name: '课程详情', expr: 'detail', sheetAttr: 'data-sheet-detail' },
  { name: '类型菜单', expr: 'addPick', sheetAttr: 'data-add-pick' },
  { name: '添加课程', expr: 'addForm', sheetAttr: 'data-sheet-add' },
  { name: '待办编辑', expr: 'todoForm', sheetAttr: 'data-sheet-todo' },
  { name: '日程编辑', expr: 'evtForm', sheetAttr: 'data-sheet-evt' },
  { name: '编辑学期', expr: 'semForm', sheetAttr: 'data-sheet-sem' },
]

/* ---------- 1. 收集所有 div token 并配平 ---------- */
const toks = []
for (const m of src.matchAll(/<div\b[^>]*>|<\/div>/g)) {
  toks.push({ i: m.index, end: m.index + m[0].length, text: m[0], close: m[0].startsWith('</div') })
}
const pairs = new Map()
const stack = []
toks.forEach((t, n) => {
  if (t.close) {
    const o = stack.pop()
    if (o === undefined) throw new Error(`div 配平失败：多余的 </div> @${t.i}`)
    pairs.set(o, n)
  } else if (!t.text.trimEnd().endsWith('/>')) {
    stack.push(n)
  }
})
if (stack.length) throw new Error(`div 配平失败：还有 ${stack.length} 个 <div> 未闭合`)

const attrOf = (text, name) => {
  /* 不能用 \b：@click 这类属性名前缀不是 word 字符 */
  const m = new RegExp(`(?:^|[\\s"'])${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}=(?:"([^"]*)"|'([^']*)')`).exec(text)
  return m ? (m[1] ?? m[2]) : null
}

/* ---------- 2. 逐个浮层算替换计划 ---------- */
const plan = []
for (const spec of SPECS) {
  const pi = toks.findIndex(
    (t) =>
      !t.close &&
      t.text.includes(`v-if="${spec.expr}"`) &&
      t.text.includes('class="fixed inset-x-0 bottom-0 z-30') &&
      t.text.includes(spec.sheetAttr),
  )
  if (pi < 0) throw new Error(`${spec.name}：找不到面板开标签（v-if="${spec.expr}" + ${spec.sheetAttr}）`)
  const p = toks[pi]
  const ci = pairs.get(pi)
  if (ci === undefined) throw new Error(`${spec.name}：面板开标签没有配平`)
  const c = toks[ci]
  if (src.slice(c.i, c.end) !== '</div>') throw new Error(`${spec.name}：闭合 token 不是 </div>`)

  /* 面板 class 拆解 */
  const cls = (attrOf(p.text, 'class') || '').split(/\s+/).filter(Boolean)
  const missing = BASE.filter((b) => !cls.includes(b))
  if (missing.length) throw new Error(`${spec.name}：面板 class 缺 [${missing.join(' ')}]，与外壳基类不一致`)
  const extras = cls.filter((x) => !BASE.includes(x))

  /* 遮罩：面板之前最后一个带 data-sheet-mask 的 div */
  let mi = -1
  toks.forEach((t, n) => {
    if (!t.close && t.i < p.i && t.text.includes('data-sheet-mask') && (mi < 0 || t.i > toks[mi].i)) mi = n
  })
  if (mi < 0) throw new Error(`${spec.name}：找不到遮罩（带 data-sheet-mask）`)
  const maskT = toks[mi]
  const closeExpr = attrOf(maskT.text, '@click')
  if (!closeExpr) throw new Error(`${spec.name}：遮罩上没有 @click 关闭表达式`)
  const maskAttr = (maskT.text.match(/\bdata-[a-z-]+(?=[\s>])/g) || []).filter((a) => a !== 'data-sheet-mask')[0] || ''

  /* A 段起点：遮罩上面紧邻的 <Transition name="fade"> */
  const fadeTag = '<Transition name="fade">'
  const A0 = src.lastIndexOf(fadeTag, maskT.i)
  if (A0 < 0) throw new Error(`${spec.name}：遮罩之前找不到 <Transition name="fade">`)
  const betweenFade = src.slice(A0 + fadeTag.length, maskT.i).replace(/[\r\n]/g, '')
  if (/\S/.test(betweenFade)) throw new Error(`${spec.name}：<Transition name="fade"> 与遮罩之间有多余内容：${betweenFade.trim()}`)

  /* A 段终点：面板开标签之后的首个 token；若它是把手则一并吃进 A 段 */
  let A1 = p.end
  let handleClass = ''
  const hTok = toks[pi + 1]
  if (hTok && !hTok.close && hTok.i < c.i && hTok.text.includes('h-1 w-9 rounded-full')) {
    handleClass = (attrOf(hTok.text, 'class') || '').split(/\s+/).filter(Boolean).join(' ')
    const nl = src.indexOf('\n', hTok.end)
    if (nl < 0) throw new Error(`${spec.name}：把手行后面没有换行`)
    A1 = nl + 1
  }

  /* B 段终点：面板 </div> 之后紧邻的 </Transition> */
  const ct = src.indexOf('</Transition>', c.end)
  if (ct < 0) throw new Error(`${spec.name}：面板后面找不到 </Transition>`)
  const betweenClose = src.slice(c.end, ct).replace(/[\r\n]/g, '')
  if (/\S/.test(betweenClose)) throw new Error(`${spec.name}：面板 </div> 与 </Transition> 之间有多余内容：${betweenClose.trim()}`)

  const body = src.slice(A1, c.i).replace(/^(  )/gm, '')
  if (!body.trim()) throw new Error(`${spec.name}：面板正文是空的，八成锚点找错了`)

  const head = ['    <BottomSheet', `      :open="!!${spec.expr}"`, `      sheet-attr="${spec.sheetAttr}"`]
  if (maskAttr) head.push(`      mask-attr="${maskAttr}"`)
  if (extras.length && extras.join(' ') !== DEFAULT_PAD) head.push(`      panel-class="${extras.join(' ')}"`)
  if (handleClass && handleClass !== DEFAULT_HANDLE) head.push(`      handle-class="${handleClass}"`)
  head.push(`      @close="${closeExpr}"`, '    >')

  plan.push({ spec, A0, A1, B0: c.i, B1: ct + '</Transition>'.length, head: head.join(EOL) + EOL, body, extras, maskAttr, handleClass })
}

/* ---------- 3. 打印计划 ---------- */
console.log(`App.vue ${src.length} 字符 / ${src.split(/\n/).length} 行；计划迁移 ${plan.length} 个浮层：${EOL}`)
for (const it of plan) {
  const head1 = it.head.replace(/\r?\n/g, ' ').trim()
  console.log(`· ${it.spec.name.padEnd(6, ' ')} A[${it.A0}..${it.A1}] B[${it.B0}..${it.B1}] 正文 ${it.body.length} 字符`)
  console.log(`    把手：${it.handleClass ? '吃进 A 段' : '未识别（正文首个元素不是把手）'}；正文里残留把手：${count(it.body, HANDLE_NEEDLE)}`)
  console.log(`    ${head1}`)
  if (it.extras.join(' ') !== DEFAULT_PAD) console.log(`    panel-class = "${it.extras.join(' ')}"`)
  if (it.handleClass && it.handleClass !== DEFAULT_HANDLE) console.log(`    handle-class = "${it.handleClass}"`)
  if (it.maskAttr) console.log(`    mask-attr = "${it.maskAttr}"`)
}

/* ---------- 4. 应用（倒序，保证前面的偏移不失效） ---------- */
/* 文件里本来就有一处只有 fade 没有 slide 的确认层，所以只断言「差值不变」 */
const diffBefore = src.split('<Transition name="fade">').length - src.split('<Transition name="slide">').length
const handleBefore = count(src, HANDLE_NEEDLE)
for (const it of [...plan].sort((a, b) => b.A0 - a.A0)) {
  src = src.slice(0, it.A0) + it.head + it.body + '    </BottomSheet>' + src.slice(it.B1)
}

/* ---------- 5. 结果断言 ---------- */
if (count(src, '<BottomSheet') !== plan.length) throw new Error(`<BottomSheet 出现 ${count(src, '<BottomSheet')} 次，应为 ${plan.length}`)
if (count(src, '</BottomSheet>') !== plan.length) throw new Error(`</BottomSheet> 出现 ${count(src, '</BottomSheet>')} 次，应为 ${plan.length}`)
if (count(src, 'data-sheet-mask') !== 0) throw new Error(`data-sheet-mask 应全部随外壳移走，仍剩 ${count(src, 'data-sheet-mask')} 处`)
for (const it of plan) {
  if (count(src, `sheet-attr="${it.spec.sheetAttr}"`) !== 1) throw new Error(`${it.spec.sheetAttr} 的 sheet-attr 不是恰好 1 处`)
}
const diffAfter = src.split('<Transition name="fade">').length - src.split('<Transition name="slide">').length
if (diffAfter !== diffBefore) throw new Error(`fade/slide Transition 配对数变了：${diffBefore} → ${diffAfter}`)
/* 文件里除了这 7 个浮层，别处（识别格/picker/引导层…）也有把手，所以只断言「正好少了 7 个」 */
const handleLeft = count(src, HANDLE_NEEDLE)
if (handleLeft !== handleBefore - plan.length) {
  let at = -1
  while ((at = src.indexOf(HANDLE_NEEDLE, at + 1)) >= 0) {
    console.log(`  残留把手 @${at}：…${src.slice(Math.max(0, at - 90), at + 40).replace(/\r?\n/g, ' ⏎ ')}…`)
  }
  throw new Error(`把手 div 数量 ${handleBefore} → ${handleLeft}，应减少 ${plan.length} 个`)
}

console.log(`\n断言全过：App.vue ${src.length} 字符（${src.length - fs.readFileSync(FILE, 'utf8').length >= 0 ? '+' : ''}${src.length - fs.readFileSync(FILE, 'utf8').length}）`)
if (WRITE) {
  fs.writeFileSync(FILE, src, 'utf8')
  console.log(`已写盘：${FILE}`)
} else {
  console.log('（演练模式，未写盘；加 --write 才真写）')
}
