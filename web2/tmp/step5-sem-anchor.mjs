import { readFileSync, writeFileSync } from 'node:fs'
const APP = 'D:/Document/Project/vibe-coding-project/web2/src/App.vue'
let s = readFileSync(APP, 'utf8')
const A = '        class="fixed inset-x-0 bottom-0 z-30 mx-auto max-h-[86vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-line bg-card p-5 pb-10 shadow-2xl"'
const n = s.split(A).length - 1
if (n !== 1) throw new Error(`锚点 ${n} 处 —— 未写盘`)
s = s.replace(A, '        data-sheet-sem\r\n' + A)
writeFileSync(APP, s, 'utf8')
console.log('已给「编辑学期」浮层加 data-sheet-sem 锚点')
