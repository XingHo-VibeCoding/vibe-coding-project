/* 按标签配对找闭行：给起始行号，返回与它配对的 </tag> 行号（含嵌套计数）。
   用法：node tmp/find-close.mjs src/App.vue 3992 template 4141 template ... */
import { readFileSync } from 'node:fs'
const [, , file, ...rest] = process.argv
const lines = readFileSync(file, 'utf8').split(/\r?\n/)
for (const spec of rest.join(' ').split(/\s+/).filter(Boolean)) {
  const [startStr, tag] = spec.split(':')
  const start = Number(startStr)
  const open = new RegExp(`<${tag}(?=[\\s>])`, 'g')
  const close = new RegExp(`</${tag}>`, 'g')
  let depth = 0
  let end = -1
  for (let i = start - 1; i < lines.length; i++) {
    const ln = lines[i]
    // 先算开、再算闭（同一行可能既有开又有闭）
    const o = (ln.match(open) || []).length
    const c = (ln.match(close) || []).length
    depth += o - c
    if (depth <= 0 && (o || c)) { end = i + 1; break }
  }
  console.log(`${tag} ${start} → ${end}  (内容 ${start + 1}–${end - 1}，共 ${end - start - 1} 行)`)
}
