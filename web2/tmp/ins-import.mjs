#!/usr/bin/env node
/* ins-import.mjs —— 在某个锚点行之后插入若干 import 行（UTF-8 安全，替代 PowerShell 重定向）。
 * 用法：node tmp/ins-import.mjs src/App.vue "<锚点行原文>" "<要插入的第一行>" "<第二行>" ...
 * 幂等：锚点后已经存在同样内容就不再插。 */
import fs from 'node:fs'

const [file, anchor, ...addLines] = process.argv.slice(2)
if (!file || !anchor || !addLines.length) {
  console.error('用法: node tmp/ins-import.mjs <file> "<anchorLine>" "<line1>" ["<line2>" ...]')
  process.exit(2)
}
const text = fs.readFileSync(file, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'
const lines = text.split(/\r?\n/)
const idx = lines.findIndex((l) => l.trim() === anchor.trim())
if (idx < 0) {
  console.error('找不到锚点行：' + anchor)
  process.exit(2)
}
const already = addLines.every((a) => text.includes(a.trim()))
if (already) {
  console.log('已存在，跳过')
  process.exit(0)
}
lines.splice(idx + 1, 0, ...addLines)
fs.writeFileSync(file, lines.join(eol), 'utf8')
console.log(`${file}: 在「${anchor.trim()}」后插入 ${addLines.length} 行`)
