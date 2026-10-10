#!/usr/bin/env node
/* verify-project 运行器 —— 发布前检查（18 条）
   用法：
     node skills/verify-project/verify.mjs          # 全量（含构建 / 基线 / 验包）
     node skills/verify-project/verify.mjs --fast   # 快档：跳过 D2 构建 / D3 质量扫描 / D4 基线 / E1 验包
   纪律：只读检查，绝不修改被检查的文件（唯一的写动作是 D1 起本地静态服务、D2/D4 产物落在 web2/dist 与 web2/tmp）。
   退出码：全部 PASS（SKIP 不算 FAIL）→ 0；有任何 FAIL → 1。
*/
import { spawnSync, spawn } from 'node:child_process'
import { readFileSync, existsSync, statSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')            // 主项目根
const SHELL = path.resolve(ROOT, '..', 'vibe-coding-project-app')
const NODE = process.execPath
const FAST = process.argv.includes('--fast')
const PORT = 4177
const BASE = `http://127.0.0.1:${PORT}/`

const results = []
let failCount = 0
let skipCount = 0

function rec(id, title, ok, evidence, skipped = false) {
  let status
  if (skipped) { status = 'SKIP'; skipCount++ } else if (ok) { status = 'PASS' } else { status = 'FAIL'; failCount++ }
  results.push({ id, title, status, evidence })
  const tag = `[${status}]`.padEnd(8)
  console.log(`${tag} ${id}  ${title}`)
  console.log(`         └─ ${evidence}`)
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 180000,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), err: r.error }
}

function git(args) { return run('git', args) }

console.log(`\n=== verify-project 发布前检查（${FAST ? '快档 --fast' : '全量'}）===\n`)

/* ═══════════ A 组｜密钥与仓库卫生 ═══════════ */

// A1 跟踪文件里没有真实密钥（按密钥真实形状扫，不用裸关键词）
{
  const SKIP_EXT = /\.(apk|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|eot|zip|zst|gz|jar|so|dex|mp3|mp4)$/i
  const PATTERNS = [
    ['腾讯云 SecretId', /AKID[A-Za-z0-9]{32}/],
    ['私钥块', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['OpenAI 风格 key', /\bsk-[A-Za-z0-9]{20,}/],
    ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/],
    ['带密码的连接串', /(?:mongodb|mysql|postgres|redis):\/\/[^:\s/]+:[^@\s/]+@/],
    ['赋值型真实密钥', /(?:API_?KEY|APIKEY|WRITE_?TOKEN|SECRET|PASSWORD|ACCESS_?KEY)\s*[:=]\s*["'][A-Za-z0-9_\-/+]{16,}["']/],
  ]
  const ls = git(['ls-files', '-z'])
  const files = ls.out.split('\0').filter(Boolean)
  const hits = []
  let scanned = 0
  for (const f of files) {
    if (SKIP_EXT.test(f)) continue
    const abs = path.join(ROOT, f)
    let st
    try { st = statSync(abs) } catch { continue }
    if (!st.isFile() || st.size > 2 * 1024 * 1024) continue
    let text
    try { text = readFileSync(abs, 'utf8') } catch { continue }
    scanned++
    text.split(/\r?\n/).forEach((line, i) => {
      for (const [name, re] of PATTERNS) {
        if (re.test(line)) hits.push(`${f}:${i + 1} [${name}]`)
      }
    })
  }
  rec('A1', '跟踪文件里没有真实密钥', hits.length === 0,
    hits.length ? `命中 ${hits.length} 处：${hits.slice(0, 5).join(' / ')}` : `扫描 ${files.length} 个跟踪文件（实读 ${scanned} 个文本），0 命中`)
}

// A2 .gitignore 否定规则生效：模板放行、真值忽略
{
  const tpl = git(['check-ignore', '-v', '.env.example'])
  const real = git(['check-ignore', '-v', '.env'])
  const rc = git(['check-ignore', '-v', 'cloudbaserc.json'])
  const tplOk = tpl.code !== 0 && tpl.out.trim() === ''      // 无输出 = 放行
  const realOk = real.code === 0 && /\.gitignore:/.test(real.out)
  const rcOk = rc.code === 0 && /\.gitignore:/.test(rc.out)
  const ok = tplOk && realOk && rcOk
  rec('A2', '.gitignore 否定规则生效（模板放行 / 真值忽略）', ok,
    `.env.example ${tplOk ? '放行 ✓' : '被忽略 ✗'} ｜ .env ${realOk ? '命中 ' + real.out.trim().split(/\s+/)[0] : '未命中 ✗'} ｜ cloudbaserc.json ${rcOk ? '命中 ' + rc.out.trim().split(/\s+/)[0] : '未命中 ✗'}`)
}

// A3 机密文件未被 git 跟踪
{
  const ls = git(['ls-files'])
  const tracked = ls.out.split(/\r?\n/).filter(Boolean)
  const bad = tracked.filter((f) => /(^|\/)(\.env|cloudbaserc\.json)$/.test(f) || /\.(key|pem|p12|jks)$/.test(f))
  rec('A3', '机密文件未被跟踪', bad.length === 0,
    bad.length ? `被跟踪了：${bad.join(' / ')}` : `已跟踪 ${tracked.length} 个文件，无 .env / cloudbaserc.json / *.key / *.pem`)
}

// A4 占位符模板已入库
{
  const need = ['.env.example', 'cloudbaserc.example.json']
  const tracked = git(['ls-files']).out.split(/\r?\n/)
  const miss = need.filter((f) => !tracked.includes(f) || !existsSync(path.join(ROOT, f)))
  rec('A4', '占位符模板已入库', miss.length === 0,
    miss.length ? `缺失或未跟踪：${miss.join(' / ')}` : `${need.join(' + ')} 都在且都被跟踪`)
}

/* ═══════════ B 组｜云端错误口径 ═══════════ */

const ERR_LIST = path.join(ROOT, 'cloudfunctions', 'list', 'errors.js')
const ERR_WRITE = path.join(ROOT, 'cloudfunctions', 'write', 'errors.js')

// B1 两份 errors.js 逐字节一致
// 判据按项目规矩（八.5）：list/errors.js 是 write/errors.js 的逐字节副本，裸 SHA256 必须相同。
// 坑（Day 25 实测）：本仓 core.autocrlf=true；若只有一侧被 git 改写成 CRLF，裸字节就不再相同。
// 所以判定用裸字节，但证据里同时给「行尾归一后是否等价」与 git blob 是否同一，便于分辨是
// 「内容真不同」还是「纯 CRLF/LF 差异」。
{
  const exists = existsSync(ERR_LIST) && existsSync(ERR_WRITE)
  if (!exists) {
    rec('B1', '两份 errors.js 逐字节一致（SHA256）', false, `文件缺失：${[!existsSync(ERR_LIST) && 'list/errors.js', !existsSync(ERR_WRITE) && 'write/errors.js'].filter(Boolean).join(' / ')}`)
  } else {
    const shaRaw = (p) => createHash('sha256').update(readFileSync(p)).digest('hex').toUpperCase()
    const shaNorm = (p) => createHash('sha256').update(readFileSync(p, 'utf8').replace(/\r\n/g, '\n')).digest('hex').toUpperCase()
    const rawA = shaRaw(ERR_LIST), rawB = shaRaw(ERR_WRITE)
    const normA = shaNorm(ERR_LIST), normB = shaNorm(ERR_WRITE)
    const gList = run('git', ['hash-object', ERR_LIST]).out.trim()
    const gWrite = run('git', ['hash-object', ERR_WRITE]).out.trim()
    const ok = rawA === rawB
    let ev
    if (ok) {
      ev = `两侧同为 ${rawA.slice(0, 17)}…（${readFileSync(ERR_LIST).length} B）；git blob ${gList.slice(0, 12)}… 也同一`
    } else if (normA === normB) {
      ev = `裸字节不同（${readFileSync(ERR_LIST).length} B vs ${readFileSync(ERR_WRITE).length} B）—— 但行尾归一后内容等价（${normA.slice(0, 13)}…）；多半是 core.autocrlf=true 只改写了一侧，请用 git -c core.autocrlf=false checkout 还原`
    } else {
      ev = `list=${rawA.slice(0, 17)}… ≠ write=${rawB.slice(0, 17)}…（内容真的不同）；git blob ${gList.slice(0, 12)}… ${gList === gWrite ? '=' : '≠'} ${gWrite.slice(0, 12)}…`
    }
    rec('B1', '两份 errors.js 逐字节一致（SHA256）', ok, ev)
  }
}

// B2 失败响应是人话（行为测试，不靠 grep）
{
  if (!existsSync(ERR_LIST) || !existsSync(ERR_WRITE)) {
    rec('B2', '失败响应是人话（{ok:false,kind,message,status} 且无 [object Object]）', false, 'errors.js 缺失，无法测试')
  } else {
    const cases = [
      ['普通 Error', new Error('boom')],
      ['空对象', {}],
      ['null', null],
      ['字符串', 'network timeout'],
    ]
    const bad = []
    for (const [label, file] of [['list', ERR_LIST], ['write', ERR_WRITE]]) {
      let mod
      try {
        mod = await import(`file://${file.replace(/\\/g, '/')}`)
        mod = mod.default || mod
      } catch (e) { bad.push(`${label}: 无法加载 (${e.message})`); continue }
      if (typeof mod.toResponse !== 'function') { bad.push(`${label}: 没导出 toResponse`); continue }
      for (const [cname, input] of cases) {
        let r
        try { r = mod.toResponse(input) } catch (e) { bad.push(`${label}/${cname}: 抛异常 ${e.message}`); continue }
        if (!r || r.ok !== false || typeof r.kind !== 'string' || typeof r.message !== 'string' || r.message === '' || !r.message.trim()) {
          bad.push(`${label}/${cname}: 形状不对 ${JSON.stringify(r)}`)
        } else if (r.message.includes('[object Object]')) {
          bad.push(`${label}/${cname}: 漏出 [object Object]`)
        }
      }
    }
    rec('B2', '失败响应是人话（{ok:false,kind,message,status} 且无 [object Object]）', bad.length === 0,
      bad.length ? bad.slice(0, 3).join(' / ') : `list + write × 4 类异常输入（Error / {} / null / string）全部返回可读 {ok:false,kind,message,status}`)
  }
}

/* ═══════════ 前置：确保本地静态服务在（C2/C3 与 D 组都要）═══════════ */
const probeBase = async () => {
  try {
    const r = await fetch(BASE, { signal: AbortSignal.timeout(2500) })
    return r.status < 500
  } catch { return false }
}
let serverUp = await probeBase()
let serverStarted = false
if (!serverUp) {
  try {
    const child = spawn(NODE, ['serve.js'], {
      cwd: path.join(ROOT, 'web2'),
      env: { ...process.env, PORT: String(PORT) },
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    serverStarted = true
    for (let i = 0; i < 20 && !serverUp; i++) {
      await new Promise((r) => setTimeout(r, 400))
      serverUp = await probeBase()
    }
  } catch { /* D1 统一报 */ }
}

/* ═══════════ C 组｜前端不变量 ═══════════ */

// C1 APP_CTX 无漏解构
{
  const r = run(NODE, ['web2/tmp/gen-app-ctx.mjs', '--check'])
  const cov = (r.out.match(/覆盖\s*(\d+)\s*个绑定/) || [])[1]
  const stale = /过期|不是最新|FAIL|✗/.test(r.out)
  rec('C1', 'APP_CTX 无漏解构（gen-app-ctx --check）', r.code === 0 && !stale,
    `exit=${r.code}${cov ? ` ｜ 覆盖 ${cov} 个绑定` : ''} ｜ ${r.out.split(/\r?\n/).filter((l) => l.trim()).slice(-1)[0] || ''}`)
}

// C2 二级页安全区
{
  const r = run(NODE, ['tmp/safe-area-check.mjs'], { cwd: path.join(ROOT, 'web2') })
  const tail = r.out.split(/\r?\n/).filter((l) => l.trim()).slice(-2).join(' ')
  const m = tail.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/)
  rec('C2', '二级页安全区（safe-area-check）', r.code === 0 && (!m || m[2] === '0'),
    `exit=${r.code} ｜ ${m ? `${m[1]} 通过 / ${m[2]} 失败` : tail.slice(0, 140)}`)
}

// C3 时间行唯一实现（RowItem）：以它独占的锚点 `data-row-state` 为准，避免误伤 import/注释
{
  const files = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!/node_modules|dist|\.git/.test(e.name)) walk(path.join(dir, e.name)) }
      else if (/\.(vue|js|mjs|ts)$/.test(e.name)) files.push(path.join(dir, e.name))
    }
  }
  walk(path.join(ROOT, 'web2', 'src'))
  const impl = files.filter((p) => readFileSync(p, 'utf8').includes('data-row-state')).map((p) => path.relative(ROOT, p))
  rec('C3', '时间行只有一处实现（RowItem）', impl.length === 1,
    impl.length === 1 ? `唯一实现处 ${impl[0]}（独占锚点 data-row-state 只此一处）` : `实现处数量 ${impl.length}：${impl.join(' / ') || '未找到'}`)
}

/* ═══════════ D 组｜构建与质量门 ═══════════ */

// D1 本地静态服务（前置已确保在）
{
  rec('D1', `本地静态服务 ${BASE} 可访问（不在则自动拉起）`, serverUp,
    serverUp ? `${serverStarted ? '原先没起，已自动拉起' : '原本就在运行'}，探测 ${BASE} 通` : `探测 ${BASE} 失败（已尝试自动拉起）`)
}

// D2 构建过
if (FAST) {
  rec('D2', '生产构建通过（vite build）', false, '快档 --fast 跳过', true)
} else {
  const vite = path.join(ROOT, 'web2', 'node_modules', 'vite', 'bin', 'vite.js')
  if (!existsSync(vite)) {
    rec('D2', '生产构建通过（vite build）', false, `找不到 vite：${path.relative(ROOT, vite)}（先在 web2/ 里 npm install）`)
  } else {
    const r = run(NODE, [vite, 'build'], { cwd: path.join(ROOT, 'web2'), timeout: 300000 })
    const html = path.join(ROOT, 'web2', 'dist', 'index.html')
    const ok = r.code === 0 && existsSync(html)
    const tail = r.out.split(/\r?\n/).filter((l) => l.trim()).slice(-1)[0] || ''
    rec('D2', '生产构建通过（vite build）', ok,
      `exit=${r.code} ｜ dist/index.html ${existsSync(html) ? '已生成 ' + statSync(html).size + ' B' : '不存在'} ｜ ${tail.slice(0, 120)}`)
  }
}

// D3 质量扫描
if (FAST) {
  rec('D3', '全页质量扫描 0 处问题（quality-scan）', false, '快档 --fast 跳过', true)
} else {
  const r = run(NODE, ['tmp/quality-scan.mjs'], { cwd: path.join(ROOT, 'web2'), timeout: 600000 })
  const m = r.out.match(/合计：\s*(\d+)\s*处问题/)
  const n = m ? Number(m[1]) : null
  rec('D3', '全页质量扫描 0 处问题（quality-scan）', n === 0,
    n === null ? `没能从输出解析出计数：${r.out.split(/\r?\n/).filter((l) => l.trim()).slice(-1)[0] || '(空)'}` : `合计 ${n} 处问题 ｜ exit=${r.code}（脚本恒 0，以计数为准）`)
}

// D4 测试基线
// 说明：day19-baseline.mjs 控制台末行是「非 0 退出的脚本名」而不是汇总句，
// 所以优先读它写出的产物文件 tmp/day19-baseline.txt 里的「非 0 退出的脚本（N 个）」。
if (FAST) {
  rec('D4', '测试基线无非 0 退出（day19-baseline）', false, '快档 --fast 跳过', true)
} else {
  const r = run(NODE, ['tmp/day19-baseline.mjs'], { cwd: path.join(ROOT, 'web2'), timeout: 1200000 })
  const outFile = path.join(ROOT, 'web2', 'tmp', 'day19-baseline.txt')
  let total = null, bad = null, badList = []
  if (existsSync(outFile)) {
    const txt = readFileSync(outFile, 'utf8')
    const exits = (txt.match(/^\[exit (\S+)\]/gm) || []).map((l) => l.match(/^\[exit (\S+)\]/)[1])
    total = exits.length
    bad = exits.filter((c) => c !== '0').length
    const block = txt.match(/非\s*0\s*退出的脚本[（(]?\s*(\d+)?\s*个?[)）]?：\s*([\s\S]*)$/)
    if (block && block[2]) badList = block[2].split(/\r?\n/).map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean)
  }
  if (total === null) {
    const m = r.out.match(/(\d+)\s*个脚本，非\s*0\s*退出\s*(\d+)\s*个/)
    if (m) { total = Number(m[1]); bad = Number(m[2]) }
  }
  // 基线脚本是并发/连续跑的，浏览器类脚本会互相抢资源 → 失败可能是「真回归」也可能是「并发抖动」。
  // 判据：把每个失败脚本**单独再跑一次**，仍失败才算真回归（单独跑还红 = 稳定复现）。
  let soloNote = ''
  if (bad) {
    const stable = [], flaky = []
    for (const f of badList) {
      const sr = run(NODE, [`tmp/${f}`], { cwd: path.join(ROOT, 'web2'), timeout: 300000 })
      if (sr.code === 0) flaky.push(f); else stable.push(f)
    }
    if (stable.length || flaky.length) {
      soloNote = ` ｜ 单独复跑：稳定红 ${stable.length} 个（${stable.join(' / ') || '无'}）${flaky.length ? `，抖动绿 ${flaky.length} 个（${flaky.join(' / ')}）` : ''}`
    }
  }
  rec('D4', '测试基线无非 0 退出（day19-baseline）', bad === 0,
    bad === null ? `没能解析出基线结果（产物 ${existsSync(outFile) ? '存在但没解析到 exit 行' : '不存在'}；console 尾：${r.out.split(/\r?\n/).filter((l) => l.trim()).slice(-1)[0] || '(空)'}）`
      : `${total} 个脚本，非 0 退出 ${bad} 个${bad ? '：' + badList.slice(0, 6).join(' / ') : ''}${soloNote}`)
}

/* ═══════════ E 组｜出包链 ═══════════ */

const APK_DIR = path.join(SHELL, 'dist-apk')
const listApks = () => {
  if (!existsSync(APK_DIR)) return []
  return readdirSync(APK_DIR).filter((f) => /\.apk$/i.test(f)).map((f) => {
    const p = path.join(APK_DIR, f)
    return { name: f, path: p, mtime: statSync(p).mtimeMs, size: statSync(p).size, release: /release/i.test(f) }
  }).sort((a, b) => b.mtime - a.mtime)
}

// E1 APK 三级一致
if (FAST) {
  rec('E1', 'APK 三方一致（dist ↔ www ↔ APK）', false, '快档 --fast 跳过', true)
} else {
  const apks = listApks()
  const distDir = path.join(ROOT, 'web2', 'dist')
  const newestDist = existsSync(distDir)
    ? Math.max(...readdirSync(path.join(distDir, 'assets'), { withFileTypes: true }).map((e) => statSync(path.join(distDir, 'assets', e.name)).mtimeMs))
    : 0
  if (!apks.length) {
    rec('E1', 'APK 三方一致（dist ↔ www ↔ APK）', false, `本机无 APK 产物（${path.relative(ROOT, APK_DIR)} 为空）`, true)
  } else if (apks[0].mtime < newestDist) {
    rec('E1', 'APK 三方一致（dist ↔ www ↔ APK）', false,
      `最新 APK ${apks[0].name} 比 web2/dist 旧（dist 有未出包的改动），出包链检查跳过 —— 交付前请先跑壳仓 npm run ship`, true)
  } else {
    const py = 'C:\\Users\\26502\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe'
    const r = run(py, ['web2/tmp/verify-apk.py', apks[0].path], { timeout: 300000 })
    rec('E1', 'APK 三方一致（dist ↔ www ↔ APK）', r.code === 0,
      `验 ${apks[0].name} ｜ exit=${r.code} ｜ ${r.out.split(/\r?\n/).filter((l) => /一致|命中|不一致|缺失/.test(l)).slice(0, 3).join(' ； ') || r.out.slice(-140)}`)
  }
}

// E2 release 不是假包
if (FAST) {
  rec('E2', 'release 包不是 debug 签名', false, '快档 --fast 跳过', true)
} else {
  const rel = listApks().filter((a) => a.release)
  if (!rel.length) {
    rec('E2', 'release 包不是 debug 签名', false, '本机没有 release 包（只有 debug 侧载包），无签名可比', true)
  } else {
    const bt = 'C:\\Users\\26502\\AppData\\Local\\Android\\Sdk\\build-tools'
    const ver = existsSync(bt) ? readdirSync(bt).sort().reverse()[0] : null
    const signer = ver ? path.join(bt, ver, 'apksigner.bat') : null
    if (!signer || !existsSync(signer)) {
      rec('E2', 'release 包不是 debug 签名', false, `找不到 apksigner：${signer || bt}`)
    } else {
      // Windows 上不能直接用 spawnSync 调 .bat（会 exit=null、读不到输出），必须经 cmd /c
      const r = run('cmd', ['/c', signer, 'verify', '--print-certs', rel[0].path], { timeout: 120000 })
      const dn = (r.out.match(/signer #1 certificate DN:\s*(.+)/i) || [])[1]?.trim() || ''
      const isDebug = /Android Debug/i.test(dn)
      rec('E2', 'release 包不是 debug 签名', r.code === 0 && dn !== '' && !isDebug,
        `验 ${rel[0].name} ｜ exit=${r.code} ｜ DN=${dn || '(没读到)'}${isDebug ? ' ← 是 debug 签名！' : ''}`)
    }
  }
}

// E3 版本号处处对（单一来源：web2/package.json → vite 注入 vX.Y → APK 文件名）
{
  const webPkg = path.join(ROOT, 'web2', 'package.json')
  const webVer = existsSync(webPkg) ? JSON.parse(readFileSync(webPkg, 'utf8')).version : null
  const [maj, min] = String(webVer || '').split('.')
  const wantMarker = `v${maj}.${min}`                 // vite.config.js 注入：__APP_VERSION__ = 去 patch 的 vX.Y
  const apks = listApks()
  const apkVer = apks.length ? (apks[0].name.match(/v(\d+\.\d+(?:\.\d+)?)/) || [])[1] : null

  // dist 内嵌：build 后 bundle 里应出现 "v1.43"
  const distDir = path.join(ROOT, 'web2', 'dist')
  let distHasMarker = null
  if (existsSync(distDir) && existsSync(path.join(distDir, 'assets'))) {
    for (const e of readdirSync(path.join(distDir, 'assets'), { withFileTypes: true })) {
      const t = readFileSync(path.join(distDir, 'assets', e.name), 'utf8')
      if (t.includes(wantMarker)) { distHasMarker = true; break }
    }
    if (distHasMarker === null) distHasMarker = false
  }

  const apkOk = !apkVer || apkVer === webVer || webVer.startsWith(apkVer)
  const ok = Boolean(webVer && distHasMarker === true && apkOk)
  const detail = !webVer ? 'web2/package.json 读不到 version'
    : distHasMarker === null ? 'web2/dist 不存在（先构建）'
    : distHasMarker === false ? `dist 里找不到注入标记 "${wantMarker}"（vite.config.js 应把 __APP_VERSION__ 注入为它）`
    : !apkOk ? `最新 APK 版本 v${apkVer} 与 package.json ${webVer} 对不上`
    : `package.json=${webVer} → 期望注入标记 "${wantMarker}"，dist 命中 ✓ ｜ 最新 APK=${apkVer ? 'v' + apkVer : '(无 APK)'}`
  rec('E3', '版本号处处对（package.json ↔ dist 注入 ↔ APK 名）', ok, detail)
}

/* ═══════════ F 组｜纪律项 ═══════════ */

// F1 推送前连通性预检（实地探测，环境变量代理为空也要探）
{
  let ok = false, how = ''
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || ''
  try {
    const r = await fetch('https://github.com', { method: 'HEAD', signal: AbortSignal.timeout(10000) })
    ok = r.status > 0 && r.status < 500
    how = `直接 fetch https://github.com → HTTP ${r.status}`
  } catch (e) {
    how = `直接 fetch 失败：${e.name === 'TimeoutError' ? '超时 10s' : e.message}`
    const g = git(['ls-remote', '--heads', 'origin'])
    if (g.code === 0) { ok = true; how += ` ｜ 但 git ls-remote origin 成功（exit 0）` }
    else { how += ` ｜ git ls-remote origin 也失败（exit ${g.code}）` }
  }
  rec('F1', '推送前连通性预检（github.com 可达）', ok,
    `代理环境变量 ${proxy ? '已设置' : '全为空'} ｜ ${how}`)
}

// F2 数据模型改了有没有同步三份文档
{
  const DOCS = ['大学生日程助手-设计方案.md', 'PRD.md', 'TECH_DESIGN.md']
  const changed = new Set()
  const st = git(['status', '--porcelain'])
  st.out.split(/\r?\n/).filter(Boolean).forEach((l) => {
    const f = l.slice(3).trim().replace(/^"|"$/g, '').split(' -> ').pop()
    changed.add(f)
  })
  const last = git(['show', '--name-only', '--pretty=format:', 'HEAD'])
  last.out.split(/\r?\n/).filter(Boolean).forEach((f) => changed.add(f.trim()))

  const touchedModel = [...changed].filter((f) => /(^|\/)(store\.js|schema\.js)$/.test(f) || /schema_version/.test(f))
  const touchedDocs = DOCS.filter((d) => changed.has(d))
  if (!touchedModel.length) {
    rec('F2', '动了数据模型则三份文档同步', true, `本次改动/最新提交未触碰 store.js / schema_version，无需同步（改了 ${changed.size} 个文件）`)
  } else {
    rec('F2', '动了数据模型则三份文档同步', touchedDocs.length === DOCS.length,
      `动了 ${touchedModel.join(' / ')} ｜ 同步了的文档：${touchedDocs.join(' / ') || '（一份都没改）'} ｜ 缺：${DOCS.filter((d) => !touchedDocs.includes(d)).join(' / ') || '无'}`)
  }
}

/* ═══════════ 总结论 ═══════════ */

const total = results.length
const passCount = total - failCount - skipCount
console.log('\n' + '─'.repeat(64))
if (skipCount) console.log(`（本次跳过 ${skipCount} 项：${results.filter((r) => r.status === 'SKIP').map((r) => r.id).join(' / ')}）`)
console.log(failCount ? `发布检查：未通过（${failCount} 项 FAIL，${passCount} 项 PASS / 共 ${total} 项）`
  : `发布检查：通过（${passCount}/${total} PASS，0 FAIL${skipCount ? `，${skipCount} SKIP` : ''}）`)

// 落一份机器可读结果，方便归档/贴图
const outFile = path.join(ROOT, 'skills', 'verify-project', 'last-run.txt')
try {
  writeFileSync(outFile, results.map((r) => `[${r.status}] ${r.id} ${r.title}\n        ${r.evidence}`).join('\n')
    + `\n\n${failCount ? `发布检查：未通过（${failCount} 项 FAIL）` : `发布检查：通过（${passCount}/${total} PASS${skipCount ? `，${skipCount} SKIP` : ''}）`}\n`
    + `时间：${new Date().toLocaleString('sv-SE')}\n`, 'utf8')
  console.log(`（明细已写入 ${path.relative(ROOT, outFile)}）`)
} catch { /* 写不了不影响退出码 */ }

console.log('─'.repeat(64) + '\n')
process.exit(failCount ? 1 : 0)
