/* 美术收口一次性工具：把 alpha 档底 `bg-ink/<n>` 换成逐主题固定的实色 token。
 *
 * 背景（docs/结构动效前置约定.md 「待清理」）：`bg-ink/5`(`bg-ink/[0.02]`…`[0.04]`) 这类
 * 半透明底叠在卡片白底 / 浅灰画布上，实际灰度随主题漂移，A4 可读性扫描判定那层底上的次要
 * 文字不达 WCAG AA。改成 style.css 里逐主题定义的不透明 token：
 *
 *   bg-ink/5 · bg-ink/[0.02] · bg-ink/[0.03] · bg-ink/[0.04]  →  bg-soft
 *   bg-ink/10 · bg-ink/15 · bg-ink/[0.06] · bg-ink/[0.08]     →  bg-soft-2   （进度轨道 / 禁用块）
 *
 * 用法：node tmp/alpha-to-soft.mjs [--dry]
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const dry = process.argv.includes('--dry')

const SOFT = /bg-ink\/(?:\[0?\.0[234]\]|5)(?![\d.])/g
const SOFT2 = /bg-ink\/(?:\[0?\.0[68]\]|10|15)(?![\d.])/g

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (name === 'node_modules') continue
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

let files = 0
let total = 0
for (const file of walk(SRC)) {
  const before = readFileSync(file, 'utf8')
  const soft = (before.match(SOFT) || []).length
  const soft2 = (before.match(SOFT2) || []).length
  if (!soft && !soft2) continue
  const after = before.replace(SOFT, 'bg-soft').replace(SOFT2, 'bg-soft-2')
  files += 1
  total += soft + soft2
  console.log(`${relative(SRC, file).replace(/\\/g, '/')}: soft ${soft} · soft-2 ${soft2}`)
  if (!dry) writeFileSync(file, after)
}
console.log(`\n${dry ? '[dry] ' : ''}${files} 个文件、共 ${total} 处替换`)
