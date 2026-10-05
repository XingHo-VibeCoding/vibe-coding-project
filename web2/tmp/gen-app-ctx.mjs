/* 生成 App.vue 尾部的 APP_CTX provide 块（Stage 9 组件化用）。
   为什么要有它：App.vue 顶层有 500+ 个绑定，手抄进 provide 一定会漏、会烂；
   这里从源码里扫出来重新生成，所以「加了新状态忘了交出去」这种事不会发生。

   扫两类东西：
   1) 顶格声明（const/let/var/function，含 async function）—— 漏了 async 会让子组件里的
      app.xxx() 变 undefined，而且 Vue 会把它吞掉（点了没反应、连 pageerror 都没有），真实踩过；
   2) 顶部 import 进来的名字（除了 vue 的）—— minOf / streakOf 这类从 data/store.js 导入的
      工具函数原来靠 <script setup> 作用域直接给模板用，搬进子组件后同样会变 undefined。

   用法：cd web2; node tmp/gen-app-ctx.mjs [--check]
     --check  只检查（不写文件）：① 现有块是不是最新的；② 各 .vue 里用到的 app.X 是否都在块里。
              不一致时 exit 1，给基线/CI 用。
*/
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(here, '..', 'src')
const APP = path.join(SRC, 'App.vue')

const BEGIN = '/* ===== APP_CTX:begin（由 tmp/gen-app-ctx.mjs 生成，勿手改）====='
const END = '/* ===== APP_CTX:end ===== */'

const VUE_SOURCES = new Set(['vue', 'vue-router', 'pinia'])

export function collectNames(script) {
  const names = []
  const seen = new Set()
  const push = (n) => {
    const name = (n || '').trim().replace(/^type\s+/, '')
    if (!name || seen.has(name)) return
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return
    seen.add(name)
    names.push(name)
  }
  const collectImportSpec = (spec) => {
    for (const part of spec.split(',')) {
      const seg = part.trim()
      if (!seg) continue
      // `a as b` 取本地名；`{ x as y }` 里已按逗号拆开，这里统一取最后一段
      const local = seg.split(/\s+as\s+/).pop().trim()
      push(local)
    }
  }

  for (const raw of script.split(/\r?\n/)) {
    // ── import（跳过 vue 自家；类型导入与纯副作用导入也跳过）
    if (/^import\s/.test(raw)) {
      if (/^import\s+type\s/.test(raw)) continue
      const from = raw.match(/from\s+['"]([^'"]+)['"]/)
      if (!from) continue
      if (VUE_SOURCES.has(from[1])) continue
      const head = raw.slice(0, raw.indexOf('from'))
      const mDefault = head.match(/^import\s+([A-Za-z_$][\w$]*)/)
      if (mDefault) push(mDefault[1])
      const mNamespace = head.match(/^\s*import\s*\*\s*as\s+([A-Za-z_$][\w$]*)/)
      if (mNamespace) push(mNamespace[1])
      const mNamed = head.match(/\{([^}]*)\}/)
      if (mNamed) collectImportSpec(mNamed[1])
      continue
    }

    // ── 顶格声明（函数体内的都缩进了，所以只认顶格）
    let m = raw.match(/^(?:export\s+)?(?:async\s+)?(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/)
    if (m) { push(m[1]); continue }
    m = raw.match(/^(?:const|let|var)\s*\{([^}]*)\}\s*=/)
    if (m) {
      for (const part of m[1].split(',')) {
        const seg = part.trim()
        if (!seg) continue
        const as = seg.split(':').pop()
        push(as.replace(/=.*$/, ''))
      }
      continue
    }
    m = raw.match(/^(?:const|let|var)\s*\[([^\]]*)\]\s*=/)
    if (m) for (const part of m[1].split(',')) push(part.replace(/=.*$/, ''))
  }
  return names
}

export function renderBlock(names, eol = '\n') {
  const lines = []
  lines.push(BEGIN)
  lines.push('   Stage 9：App 仍是唯一状态持有者，这里把上下文交出去；')
  lines.push('   拆出去的页面/浮层用 useApp() 取（reactive 会自动解包 ref，读写都不用 .value）。')
  lines.push('   这个块是生成的：改了状态就重跑 web2/tmp/gen-app-ctx.mjs，别手改。 */')
  lines.push('provide(APP_CTX, reactive({')
  for (let i = 0; i < names.length; i += 8) {
    lines.push('  ' + names.slice(i, i + 8).join(', ') + ',')
  }
  lines.push('}))')
  lines.push(END)
  return lines.join(eol)
}

const norm = (s) => s.replace(/\r\n/g, '\n')

export function plan(text) {
  const tplAt = text.indexOf('<template>')
  const scriptAt = text.indexOf('<script setup>')
  const scriptEnd = text.indexOf('</script>')
  if (tplAt < 0 || scriptAt < 0 || scriptEnd < 0 || scriptEnd > tplAt) {
    throw new Error('App.vue 结构不符合预期（找不到 script/template 边界）')
  }
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const script = text.slice(scriptAt, scriptEnd)
  const names = collectNames(script)
  const block = renderBlock(names, eol)

  const b = text.indexOf(BEGIN)
  const e = text.indexOf(END)
  let next
  if (b >= 0 && e > b) {
    next = text.slice(0, b) + block + text.slice(e + END.length)
  } else {
    // 首次：插在 </script> 之前，保证所有绑定都已初始化
    const insertAt = text.lastIndexOf('\n', scriptEnd)
    next = text.slice(0, insertAt) + eol + eol + block + text.slice(insertAt)
  }
  // 行尾差异不算「过期」：core.autocrlf=true 的机器上工作区是 CRLF，重写只会制造噪声
  return { names, next, changed: norm(next) !== norm(text) }
}

/** 扫 src 下所有 .vue（App.vue 自己除外）里用到的 app.X，返回 ctx 里没有的那些。
    只扫「真的用了 useApp() 的组件」——没接上下文的组件里出现的 app. 是别的东西（例如注释里的 app.js）。
    注释也要先去掉：TimeWheel.vue 里那句「主项目 app.js 同款口径」就骗过一版扫描器。
    注意**不要去引号**：模板里的 @click="app.xxx" 本身就是引号包着的表达式，去掉引号就等于把真用掉的键藏起来。 */
export function missingKeys(names, files = listVueFiles(SRC)) {
  const known = new Set(names)
  const missing = new Map()
  const stripComments = (s) =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  for (const file of files) {
    if (path.resolve(file) === APP) continue
    const text = fs.readFileSync(file, 'utf8')
    if (!text.includes('useApp(')) continue
    for (const m of stripComments(text).matchAll(/\bapp\.([A-Za-z_$][\w$]*)/g)) {
      const key = m[1]
      if (known.has(key)) continue
      if (!missing.has(key)) missing.set(key, [])
      missing.get(key).push(path.relative(SRC, file))
    }
  }
  return missing
}

function listVueFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) listVueFiles(p, out)
    else if (ent.name.endsWith('.vue')) out.push(p)
  }
  return out
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const text = fs.readFileSync(APP, 'utf8')
  const { names, next, changed } = plan(text)
  const check = process.argv.includes('--check')
  const missing = missingKeys(names)
  if (check) {
    const lines = [`APP_CTX 覆盖 ${names.length} 个绑定；${changed ? '❗已过期（重跑 gen-app-ctx.mjs）' : '✓ 最新'}`]
    if (missing.size) {
      lines.push(`❗有 ${missing.size} 个键被 .vue 用到但不在 APP_CTX 里：`)
      for (const [key, files] of missing) lines.push(`   ${key} ← ${[...new Set(files)].join(', ')}`)
    }
    console.log(lines.join('\n'))
    process.exit(changed || missing.size ? 1 : 0)
  }
  if (changed) fs.writeFileSync(APP, next)
  console.log(`APP_CTX 覆盖 ${names.length} 个绑定；${changed ? '已更新 App.vue' : '无需改动'}`)
  if (missing.size) {
    console.log(`⚠️ 有 ${missing.size} 个键被 .vue 用到但不在 APP_CTX 里（子组件里会是 undefined！）：`)
    for (const [key, files] of missing) console.log(`   ${key} ← ${[...new Set(files)].join(', ')}`)
  }
}
