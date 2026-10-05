/* 生成 App.vue 尾部的 APP_CTX provide 块（Stage 9 组件化用）。
   为什么要有它：App.vue 顶层有 470+ 个绑定，手抄进 provide 一定会漏、会烂；
   这里从源码里扫出来重新生成，所以「加了新状态忘了交出去」这种事不会发生。

   用法：cd web2; node tmp/gen-app-ctx.mjs [--check]
     --check  只检查现有块是不是最新的（不写文件；不一致时 exit 1，给基线/CI 用）
*/
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(here, '..', 'src', 'App.vue')

const BEGIN = '/* ===== APP_CTX:begin（由 tmp/gen-app-ctx.mjs 生成，勿手改）====='
const END = '/* ===== APP_CTX:end ===== */'

export function collectNames(script) {
  const names = []
  const seen = new Set()
  const push = (n) => {
    const name = (n || '').trim()
    if (!name || seen.has(name)) return
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return
    seen.add(name)
    names.push(name)
  }
  for (const raw of script.split(/\r?\n/)) {
    // 只认顶格声明：顶格里出现的才是「App 上下文」的一部分（函数体内的都缩进了）
    // 注意 `async function` 也要算进来 —— 漏了它就会让子组件里的 app.xxx() 变成 undefined（真实踩过）
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

export function renderBlock(names) {
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
  return lines.join('\n')
}

export function plan(text) {
  const tplAt = text.indexOf('<template>')
  const scriptAt = text.indexOf('<script setup>')
  const scriptEnd = text.indexOf('</script>')
  if (tplAt < 0 || scriptAt < 0 || scriptEnd < 0 || scriptEnd > tplAt) {
    throw new Error('App.vue 结构不符合预期（找不到 script/template 边界）')
  }
  const script = text.slice(scriptAt, scriptEnd)
  const names = collectNames(script)
  const block = renderBlock(names)

  const b = text.indexOf(BEGIN)
  const e = text.indexOf(END)
  let next
  if (b >= 0 && e > b) {
    next = text.slice(0, b) + block + text.slice(e + END.length)
  } else {
    // 首次：插在 </script> 之前，保证所有绑定都已初始化
    const insertAt = text.lastIndexOf('\n', scriptEnd)
    next = text.slice(0, insertAt) + '\n\n' + block + text.slice(insertAt)
  }
  return { names, next, changed: next !== text }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const text = fs.readFileSync(APP, 'utf8')
  const { names, next, changed } = plan(text)
  const check = process.argv.includes('--check')
  if (check) {
    console.log(`APP_CTX 覆盖 ${names.length} 个绑定；${changed ? '❗已过期（重跑 gen-app-ctx.mjs）' : '✓ 最新'}`)
    process.exit(changed ? 1 : 0)
  }
  if (changed) fs.writeFileSync(APP, next)
  console.log(`APP_CTX 覆盖 ${names.length} 个绑定；${changed ? '已更新 App.vue' : '无需改动'}`)
}
