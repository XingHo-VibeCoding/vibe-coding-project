/* 用「行号区间」替换 App.vue 里的一段（Stage 9 拆组件时用：把内联 markup 换成 <Xxx />）。
   为什么不用 edit 工具：这些块动辄上百行，old_string 太长，空白/换行差一点就匹配不上；行号更稳。
   用法：cd web2; node tmp/cut-block.mjs <from> <to> "<replacement>" [--dry]
     from/to 是 1-based 闭区间的行号（对照 read 的行号）。
     会先打印将被切掉的首行/末行与行数（先用 --dry 看一眼），再写文件。 */
import fs from 'node:fs'
import path from 'node:path'

const [file, fromS, toS, rep = '', ...flags] = process.argv.slice(2)
if (!file || !fromS || !toS) {
  console.error('用法：node tmp/cut-block.mjs src/App.vue <from> <to> "<replacement>" [--dry]')
  process.exit(2)
}
const dry = flags.includes('--dry')
const from = Number(fromS)
const to = Number(toS)
if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
  console.error(`行号不合法：from=${fromS} to=${toS}`)
  process.exit(2)
}

const abs = path.resolve(file)
const eol = fs.readFileSync(abs, 'utf8').includes('\r\n') ? '\r\n' : '\n'
const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/)
if (to > lines.length) {
  console.error(`to=${to} 超出文件行数 ${lines.length}`)
  process.exit(2)
}
const cut = lines.slice(from - 1, to)
console.log(`将切掉 ${cut.length} 行（${from}–${to}）：`)
console.log(`  首行: ${cut[0].trim().slice(0, 96)}`)
console.log(`  末行: ${cut[cut.length - 1].trim().slice(0, 96)}`)
console.log(`  换成: ${rep.trim().slice(0, 96)}`)
if (dry) {
  console.log('（--dry：未写文件）')
  process.exit(0)
}
const next = [...lines.slice(0, from - 1), ...rep.split('\n'), ...lines.slice(to)].join(eol)
fs.writeFileSync(abs, next)
console.log(`已写 ${file}：${lines.length} 行 → ${next.split(/\r?\n/).length} 行`)
