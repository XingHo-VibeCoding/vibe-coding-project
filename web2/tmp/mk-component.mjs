#!/usr/bin/env node
/* mk-component.mjs —— 把 App.vue 里的一段 markup 搬进独立组件（Stage 9 页面拆分的机械步骤）
 *
 * 用它的理由：搬走的 markup **一个字都不用改**。组件不改写成 `app.x` 的前缀风格，
 * 而是在 <script setup> 里 `const { ... } = toRefs(app)` 把上下文里的绑定**按原名**接出来
 * （toRefs 给的是 ref，模板里自动解包；读不用 .value，写也走得通 —— 模板对 ref 的赋值会被
 * 编译成 `_isRef(x) ? x.value = v : x = v`）。这样「搬」这件事没有转换步骤，也就没有转换 bug。
 *
 * 用法：
 *   node tmp/mk-component.mjs src/App.vue <from> <to> src/pages/TodayPage.vue TodayPage [--dry]
 * from/to 为 1-based 闭区间（只含 markup 行本身，不含 <main> 外壳）。
 *
 * 它会做四件事：
 *   1. 从 App.vue 的 APP_CTX 块里取出全部绑定名（provide(APP_CTX, reactive({ ... }))）。
 *   2. 扫这段 markup 真正用到的**组件**（大写开头、且在 APP_CTX 名里出现的标签），
 *      从 App.vue 现有的 import 行里找出它们各自的 import 语句，原样复制进新组件；
 *      这些名字**不**进 toRefs 解构（避免组件对象被包成 ref 而解析不出来）。
 *   3. 写组件文件：<script setup> + 逐字搬运的 template。
 *   4. 打印：解构名数量 / 复制过来的 import / 行数，供人工核对（--dry 只预览不落盘）。
 */
import fs from 'node:fs'
import path from 'node:path'

const [srcArg, fromArg, toArg, outArg, tagArg, ...rest] = process.argv.slice(2)
const dry = rest.includes('--dry')
if (!srcArg || !fromArg || !toArg || !outArg || !tagArg) {
  console.error('用法: node tmp/mk-component.mjs src/App.vue <from> <to> src/pages/X.vue X [--dry]')
  process.exit(2)
}
const from = Number(fromArg)
const to = Number(toArg)
if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
  console.error('行号不对')
  process.exit(2)
}

const srcPath = path.resolve(srcArg)
const srcText = fs.readFileSync(srcPath, 'utf8')
const eol = srcText.includes('\r\n') ? '\r\n' : '\n'
const lines = srcText.split(/\r?\n/)

/* ---- 1. 取 APP_CTX 绑定名 ---- */
const begin = lines.findIndex((l) => l.includes('APP_CTX:begin'))
const end = lines.findIndex((l) => l.includes('APP_CTX:end'))
if (begin < 0 || end < 0 || end < begin) {
  console.error('没找到 APP_CTX 块（先跑 node tmp/gen-app-ctx.mjs）')
  process.exit(2)
}
const ctxNames = []
for (const raw of lines.slice(begin + 1, end)) {
  /* 只收「纯名字列表」行：标识符 + 逗号 + 空白。块里还有中文注释行（含 useApp/.value/web2 这类词），
     按整行形状过滤才不会把它们当成绑定名（曾经因此把 useApp 解构出来，报「已声明过」）。 */
  if (!/^\s*[A-Za-z_$][\w$]*\s*(?:,\s*[A-Za-z_$][\w$]*\s*)*,?\s*$/.test(raw)) continue
  for (const m of raw.matchAll(/([A-Za-z_$][\w$]*)/g)) {
    const n = m[1]
    if (!ctxNames.includes(n)) ctxNames.push(n)
  }
}
if (!ctxNames.length) {
  console.error('APP_CTX 名字列表为空')
  process.exit(2)
}

/* ---- 2. 这段 markup 里用到的组件 ---- */
const body = lines.slice(from - 1, to)
const bodyText = body.join('\n')
const compNames = ctxNames.filter((n) => /^[A-Z]/.test(n) && new RegExp('<\\s*' + n + '(?=[\\s/>])').test(bodyText))
/* 从 App.vue 的 import 里找出这些组件的 import 语句（连同 default/具名一起原样搬） */
const importLines = lines.filter((l) => /^\s*import\s/.test(l))
const compImports = importLines.filter((l) => {
  const m = l.match(/^\s*import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/)
  if (!m) return false
  const names = []
  if (m[1]) names.push(m[1])
  if (m[2]) for (const part of m[2].split(',')) {
    const t = part.trim().split(/\s+as\s+/).pop().trim()
    if (t) names.push(t)
  }
  return names.some((n) => compNames.includes(n))
})
const compImportedNames = []
for (const l of compImports) {
  const m = l.match(/^\s*import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/)
  if (m?.[1]) compImportedNames.push(m[1])
  if (m?.[2]) for (const part of m[2].split(',')) {
    const t = part.trim().split(/\s+as\s+/).pop().trim()
    if (t) compImportedNames.push(t)
  }
}
const missingImports = compNames.filter((n) => !compImportedNames.includes(n))
if (missingImports.length) {
  console.error('⚠ 这些组件在 markup 里用了，但没在 App.vue 的 import 行里找到：', missingImports.join(', '))
  process.exit(3)
}

/* 解构名单 = 这段 markup **真正用到**的 ctx 名 − 被 import 的组件名（组件对象不能包成 ref）。
   按用到的收（而不是把 670 个全解构一遍）是为了让组件头部保持可读：一般 10–60 个。
   边界判定要求名字前后不是 [\w$.]：`nowPct` 不会命中 `nowPctAll`，也不会命中 `x.nowPct` 这种属性访问。
   **例外：展开运算符** `{ ...gridStyleOf(it, row) }` —— 名字前面那个点是 `...` 的一部分，
   不算属性访问；所以先把 `...` 抹成空格再判定（2026-10-05 踩过：`gridStyleOf` 就这么漏了，
   组件里成 undefined，渲染期抛 TypeError 被 Vue 吞掉，表现是整页空白）。 */
const usedInBody = new Set(
  ctxNames.filter((n) => {
    if (compNames.includes(n)) return false
    const re = new RegExp('(^|[^\\w$.])' + n.replace(/\$/g, '\\$') + '($|[^\\w$])')
    return re.test(bodyText.replace(/\.\.\./g, ' '))
  }),
)
const destructured = ctxNames.filter((n) => usedInBody.has(n))
/* 组件 import 语句照搬，但**相对路径要按新家重算**（原样搬会写成 './components/X.vue'，
   而组件现在在 src/pages/ 里 —— 必须变成 '../components/X.vue'）。 */
const srcDir = path.dirname(srcPath)
const outDir = path.dirname(path.resolve(outArg))
const rebase = (line) => {
  const m = line.match(/^(\s*import\s+[\s\S]*?from\s+)(['"])(.+?)\2(.*)$/)
  if (!m) return line
  const spec = m[3]
  if (!spec.startsWith('.')) return line
  let rel = path.relative(outDir, path.resolve(srcDir, spec)).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = './' + rel
  return m[1] + "'" + rel + "'" + m[4]
}
/* useApp 的 import 路径同样按新家重算（组件可能在 src/pages、src/pages/sub、src/sheets 里） */
const ctxRel = (() => {
  let rel = path.relative(outDir, path.resolve(srcDir, 'composables/app-ctx.js')).replace(/\\/g, '/')
  if (!rel.startsWith('.')) rel = './' + rel
  return rel
})()
const script = [
  '<script setup>',
  "import { toRefs } from 'vue'",
  ...compImports.map((l) => rebase(l).trim().replace(/\s+/g, ' ')),
  `import { useApp } from '${ctxRel}'`,
  '',
  'const app = useApp()',
  '/* 这段 markup 是从 App.vue 逐字搬过来的：绑定名一个没改，靠 toRefs 按原名接出（模板里自动解包）。',
  '   名单由 tmp/mk-component.mjs 从 APP_CTX 生成，新增顶层绑定后重跑该脚本即可。 */',
  `const {\n${destructured.map((n) => '  ' + n + ',').join('\n')}\n} = toRefs(app)`,
  '</script>',
  '',
  '<template>',
]
const out = [...script, ...body, '</template>', ''].join(eol)

console.log(`${tagArg}: 取 App.vue ${from}–${to}（${body.length} 行）`)
console.log(`  组件 import 搬过来 ${compImports.length} 条: ${compImportedNames.join(', ') || '（无）'}`)
console.log(`  toRefs 解构 ${destructured.length} 个名字（APP_CTX 共 ${ctxNames.length}）`)
console.log(`  首行: ${(body[0] || '').trim().slice(0, 90)}`)
console.log(`  末行: ${(body[body.length - 1] || '').trim().slice(0, 90)}`)
if (dry) {
  console.log('（--dry：未落盘）')
} else {
  const outPath = path.resolve(outArg)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, out, 'utf8')
  console.log(`  → 已写出 ${outPath}`)
}
