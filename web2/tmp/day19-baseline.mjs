/* Day 19 改版基线：把 tmp/ 下所有 单测/检查 脚本跑一遍，记录改版前的绿/红状态。
   跑法：先构建 + 起 dist 静态服务（默认 4177），再
     cd web2 && node tmp/day19-baseline.mjs
   产物：tmp/day19-baseline.txt（每行：exit / 耗时 / 文件名 / 汇总行）
   用途：改版每一步之后重跑，和这份基线对照，看有没有撞坏已有功能。 */
import { spawnSync } from 'node:child_process'
import { readdirSync, writeFileSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'

const DIR = 'tmp'
const OUT = 'tmp/day19-baseline.txt'
const TIMEOUT = 120000
const files = readdirSync(DIR)
  .filter((f) => /\.(mjs|js)$/.test(f) && /(unit|check|test)/.test(f))
  .sort()

const stamp = new Date().toLocaleString('sv-SE').replace('T', ' ')
const lines = []
let git = ''
try { git = execSync('git log --oneline -1', { encoding: 'utf8' }).trim() } catch {}
try { git += `  |  工作区改动 ${execSync('git status --short', { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length} 条` } catch {}
lines.push(`# Day 19 改版基线 ${stamp}`)
lines.push(`# git: ${git}`)
lines.push(`# 脚本数：${files.length}`, '')

const problems = []
const rows = []
for (const f of files) {
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [`${DIR}/${f}`], { encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 32 * 1024 * 1024 })
  const ms = Date.now() - t0
  const txt = `${r.stdout || ''}\n${r.stderr || ''}`
  const all = txt.split(/\r?\n/).filter((l) => l.trim())
  const summary =
    all.filter((l) => /\d+\s*(\/\s*\d+|\s*项|\s*pass|passed|failed|通过|失败|挂)/i.test(l)).slice(-1)[0] || all.slice(-1)[0] || '(无输出)'
  const code = r.error && r.error.code === 'ETIMEDOUT' ? 'TIMEOUT' : String(r.status)
  const bad = code !== '0'
  if (bad) problems.push(f)
  rows.push({ f, code, ms, summary: summary.replace(/\s+/g, ' ').trim().slice(0, 118), bad })
}

for (const r of rows) {
  lines.push(`[exit ${r.code}] [${r.ms}ms] ${r.f}${r.bad ? '  ← 非 0 退出' : ''}`)
  lines.push(`        ${r.summary}`)
}
lines.push('', `### 非 0 退出的脚本（${problems.length} 个）：`)
lines.push(problems.length ? problems.map((p) => `- ${p}`).join('\n') : '（无）')
writeFileSync(OUT, lines.join('\n') + '\n')
console.log(`基线已写出 ${OUT}：${files.length} 个脚本，非 0 退出 ${problems.length} 个`)
console.log(problems.join('\n'))
