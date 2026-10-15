/* Day 19 改版基线：把 tmp/ 下所有 单测/检查 脚本跑一遍，记录改版前的绿/红状态。
   跑法：先构建 + 起 dist 静态服务（默认 4177），再
     cd web2 && node tmp/day19-baseline.mjs
   产物：tmp/day19-baseline.txt（每行：exit / 耗时 / 文件名 / 汇总行）
   用途：改版每一步之后重跑，和这份基线对照，看有没有撞坏已有功能。

   2026-10-15 提速（不改输出格式，verify.mjs 照旧解析）：
   · 并发跑：默认 3 个 worker（BASE_CONCURRENCY 可调），原来是一条 for 串行跑完全部。
     这些脚本都不自己起端口（全打同一个 4177），并发的唯一争用是 CPU/内存。
   · 单脚本超时 120s → 90s（先试过 60s：并发下最慢的浏览器脚本会顶到 59s+，`wheel-touch-gesture-check`
     直接 TIMEOUT —— 60s 太紧，90s 留出余量，又不至于让卡死的脚本白等两分钟）。
   · 冒烟用：BASE_ONLY=<文件名片段> 只跑匹配的那几个（产物是局部的，别拿它当基线）。
   · 计时敏感的手势/物理类脚本（文件名含 wheel / physics）先**串行跑完**，再并发跑其余：
     并发抢 CPU 会让「甩动格数」这类贴着阈值的测量抖红（2026-10-15 实测 numberwheel-touch-check）。
   注：并发仍会让个别浏览器类脚本偶发抖动红 —— verify.mjs 的 D4 会单独复跑区分
   「稳定红（真回归）」与「抖动绿」，只有稳定红才拦。 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readdirSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const execFileP = promisify(execFile)

const DIR = 'tmp'
const OUT = 'tmp/day19-baseline.txt'
const TIMEOUT = Number(process.env.BASE_TIMEOUT_MS || 90000)
const CONC = Math.max(1, Number(process.env.BASE_CONCURRENCY || 3))
const ONLY = process.env.BASE_ONLY || ''
let files = readdirSync(DIR)
  .filter((f) => /\.(mjs|js)$/.test(f) && /(unit|check|test)/.test(f))
  .sort()
if (ONLY) files = files.filter((f) => f.includes(ONLY))

const stamp = new Date().toLocaleString('sv-SE').replace('T', ' ')
const lines = []
let git = ''
try { git = execSync('git log --oneline -1', { encoding: 'utf8' }).trim() } catch {}
try { git += `  |  工作区改动 ${execSync('git status --short', { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length} 条` } catch {}
lines.push(`# Day 19 改版基线 ${stamp}`)
lines.push(`# git: ${git}`)
lines.push(`# 脚本数：${files.length}${ONLY ? `（仅 ${ONLY}）` : ''}  |  并发 ${CONC}  |  单脚本超时 ${Math.round(TIMEOUT / 1000)}s`, '')

async function runOne(f) {
  const t0 = Date.now()
  let code = '0', txt = ''
  try {
    const r = await execFileP(process.execPath, [`${DIR}/${f}`], { encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 32 * 1024 * 1024 })
    txt = `${r.stdout || ''}\n${r.stderr || ''}`
  } catch (e) {
    txt = `${e.stdout || ''}\n${e.stderr || ''}`
    code = e.killed || e.signal ? 'TIMEOUT' : String(e.code === undefined ? 1 : e.code)
  }
  const ms = Date.now() - t0
  const all = txt.split(/\r?\n/).filter((l) => l.trim())
  const summary =
    all.filter((l) => /\d+\s*(\/\s*\d+|\s*项|\s*pass|passed|failed|通过|失败|挂)/i.test(l)).slice(-1)[0] || all.slice(-1)[0] || '(无输出)'
  return { f, code, ms, summary: summary.replace(/\s+/g, ' ').trim().slice(0, 118), bad: code !== '0' }
}

const rows = new Array(files.length)
let done = 0
const report = (r) => {
  done++
  process.stdout.write(`[${done}/${files.length}] ${r.bad ? '红' : '绿'} ${r.f} (${r.ms}ms)\n`)
}
// 计时敏感的手势/物理类脚本先单独跑（这时机器空闲，速度测量才准）。
// 2026-10-15 实测：并发跑时 numberwheel-touch-check 的「快甩 ≥18 格」贴着阈值，
// 抢 CPU 会让实测位移掉到 18 以下 → 批跑红 / 单跑绿。这类脚本按 SERIAL_RE 串行。
const SERIAL_RE = /(wheel|physics)/
const serialIdx = files.map((f, i) => (SERIAL_RE.test(f) ? i : -1)).filter((i) => i >= 0)
const poolIdx = files.map((f, i) => (SERIAL_RE.test(f) ? -1 : i)).filter((i) => i >= 0)
for (const i of serialIdx) {
  rows[i] = await runOne(files[i])
  report(rows[i])
}
let cursor = 0
const worker = async () => {
  for (;;) {
    const i = poolIdx[cursor++]
    if (i === undefined) return
    rows[i] = await runOne(files[i])
    report(rows[i])
  }
}
await Promise.all(Array.from({ length: Math.min(CONC, poolIdx.length) }, worker))

const problems = rows.filter((r) => r.bad).map((r) => r.f)
for (const r of rows) {
  lines.push(`[exit ${r.code}] [${r.ms}ms] ${r.f}${r.bad ? '  ← 非 0 退出' : ''}`)
  lines.push(`        ${r.summary}`)
}
lines.push('', `### 非 0 退出的脚本（${problems.length} 个）：`)
lines.push(problems.length ? problems.map((p) => `- ${p}`).join('\n') : '（无）')
writeFileSync(OUT, lines.join('\n') + '\n')
console.log(`基线已写出 ${OUT}：${files.length} 个脚本，非 0 退出 ${problems.length} 个，总耗时 ${(rows.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(0)}s（并发 ${CONC}，墙钟约 1/${CONC}）`)
console.log(problems.join('\n'))
