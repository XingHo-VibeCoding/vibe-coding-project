/* P10 真机自动化 S1–S8（把 docs/真机复验清单.md 第八节固化成脚本）
 *
 * 两种跑法，断言同一套：
 *   ① 真机（默认优先）：要求 adb 设备在线 + WebView 调试通道已转发
 *        adb shell monkey -p com.llltl6.schedule -c android.intent.category.LAUNCHER 1
 *        adb shell cat /proc/net/unix | grep webview_devtools   → @webview_devtools_remote_<pid>
 *        adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *        node tmp/device-s1s8-check.mjs
 *        —— 真机模式额外验「系统返回键」与「通知栏录音入口」，并用 adb input tap 真点。
 *   ② 桌面替身（无设备时）：P10_FALLBACK=1，走 4177 静态服务 + 注入固定样例数据
 *        cd web2; $env:PORT='4177'; node serve.js
 *        node tmp/device-s1s8-check.mjs
 *        —— 只验网页侧结构（S1/S2/S3/S5/S6/S7/S8 的大部分）；系统返回键与通知栏那两条 SKIP。
 *
 * 退出码：全过 0；任一 FAIL 非 0。截图落在 tmp/s1s8-shots/（含真机 adb 整屏）。
 * 口径来源：docs/真机复验清单.md 第八节 S1–S8 表 + v1.42.0 现场记录。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const PW = 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const { chromium } = await import(PW)
const ADB = 'C:\\Users\\26502\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe'
const OUT = 'tmp/s1s8-shots'
const PKG = 'com.llltl6.schedule'
const BASE = `http://127.0.0.1:${process.env.PORT || 4177}/`
mkdirSync(OUT, { recursive: true })

// ---------- 计数与断言 ----------
let pass = 0, fail = 0, skip = 0
const rows = []
function ok(id, what, cond, evidence) {
  const st = cond ? 'PASS' : 'FAIL'
  if (cond) pass++; else fail++
  rows.push({ id, what, st, evidence })
  console.log(`  [${st}] ${id} ${what}${evidence ? ` — ${evidence}` : ''}`)
}
function skipped(id, what, why) {
  skip++
  rows.push({ id, what, st: 'SKIP', evidence: why })
  console.log(`  [SKIP] ${id} ${what} — ${why}`)
}

// maxBuffer 必须放大：`dumpsys notification --noredact` 在本机真机上 ~1.3 MB，
// 默认 1 MB 会让 execFileSync 抛 ENOBUFS，被 catch 吞成空串，S4c 就变成假 FAIL
// （2026-10-13 真机首跑就是这么挂的：adb 侧明明有通知、有「开始录音」action）。
const adbOut = (args) => { try { return execFileSync(ADB, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim() } catch { return '' } }
const devices = adbOut(['devices']).split('\n').slice(1).map(l => l.trim()).filter(l => l.endsWith('device'))
const DEVICE = devices.length > 0

/* 息屏时 requestAnimationFrame 永不触发 ⇒ 脚本里那些「等 6 帧」的循环会永久挂住
   （2026-10-14 实测：设备 mWakefulness=Dozing 时 S1 卡死，日志停在标题行）。
   真机模式下先点亮屏幕并让它别睡。 */
if (DEVICE) {
  adbOut(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'])
  adbOut(['shell', 'input', 'keyevent', 'KEYCODE_MENU'])
  adbOut(['shell', 'svc', 'power', 'stayon', 'true'])
  const wake = adbOut(['shell', 'dumpsys', 'power'])
  const m = wake.match(/mWakefulness=(\w+)/)
  console.log(`  屏幕: ${m ? m[1] : '未知'}（息屏会让 rAF 不触发、脚本挂死，已尝试唤醒）`)
}

console.log('=== P10 真机自动化 S1–S8 ===')
console.log(`  设备: ${DEVICE ? devices.join(', ') : '（无 adb 设备）'}`)

// ---------- 起会话 ----------
let browser, page, mode
let appUrl = null   // 真机模式下记下不带 ?t= 的原始页面地址，收尾时 reload 回去
if (DEVICE) {
  mode = 'device'
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
  } catch (e) {
    console.log('\n无法连上 9222（WebView 调试通道未转发？）：' + String(e).split('\n')[0])
    console.log('  先跑：adb shell monkey -p ' + PKG + ' -c android.intent.category.LAUNCHER 1')
    console.log('        adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>')
    process.exit(2)
  }
  page = null
  for (const c of browser.contexts()) for (const p of c.pages()) page = p
  if (!page) { console.log('9222 上没找到页面'); process.exit(2) }
  // 真机首跑（2026-10-13 21:08）5 个 FAIL 里有 4 个是「时辰不对」造成的假 FAIL：
  // 那天晚上课全上完了，「接下来」只剩一条折叠行 ⇒ [data-today-item] 一条都没有（S2a/S3a 挂）。
  // 所以真机模式也走同一个 ?t= 时间后门，把钟点钉在「正在上高等数学」的 10:30 再断言。
  // ?t= 只冻结钟点、不冻日期（见 App.vue:3900），也不动任何数据，跑完再 reload 回真实时间。
  // 注：S4b 原本也吃「时辰」亏（没正在上的课 ⇒ 课表页没录音钮），但 2026-10-13 用户把那个钮去掉了，
  // 断言已反转为「不该存在」，不再依赖时刻。
  const T = process.env.S1S8_T || '10:30'
  appUrl = page.url().split('?')[0]
  await page.goto(appUrl + '?t=' + T, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(2600)
  console.log('  模式: device（真实 WebView）+ 已连 9222 | url=' + page.url() + `（时间后门 ?t=${T}）`)
} else {
  mode = 'fallback'
  const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  const pad = (n) => String(n).padStart(2, '0')
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const MON = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return keyOf(d) })()
  const WD = ((new Date().getDay() + 6) % 7) + 1
  const now = new Date()
  /* 时钟钉死（2026-10-15 修）：原来用 `now ± Nh` 造 fixture —— 晚上跑时 +4/+6/+8h 会跨过零点，
     那三节课被算成「今天已过」折叠掉，「接下来」只剩 1 条 live 行；S3b 取的是**所有行的最长
     连续可点段最大值**，只有一条行时它上下紧挨「已过 / 展开全部」两个带 after:-inset-y-[9px]
     扩触区的控制行，量到 40px < 44px 就假红。改成固定钟点（含 ?t= 后门同值）后任何时刻跑都一致。 */
  const APP_T = '10:30'                 // 应用内的「现在」（?t= 后门）
  const hhmm = '10:00'                  // 「正在进行」的一节：10:00–12:25（含 10:30）
  // 再造一节「已上完」的课（08:00–08:45），好把 S2 的折叠行也真跑到
  const pastHM = '08:00'
  // 再造几节「接下来」的课，凑够「展开全部」出现的条件（超过首屏 3 条）
  const later = [
    { id: 'n0', start: '14:00', loc: '东1-100' },
    { id: 'n1', start: '16:00', loc: '东2-101' },
    { id: 'n2', start: '18:00', loc: '东3-102' },
  ].map((x, i) => ({ id: x.id, type: 'course', semester_id: 'sem1', title: '后续课' + (i + 1), location: x.loc, weekday: WD, start_time: x.start, duration: 95, week_rule: 'every' }))
  const DOC = JSON.stringify({
    app: 'sched', schema_version: 1, exported_at: now.toISOString(),
    semester: { id: 'sem1', name: '测试学期', first_monday: MON, total_weeks: 16 },
    schedules: [
      { id: 'c0', type: 'course', semester_id: 'sem1', title: '早八英语', location: '西2-105', weekday: WD, start_time: pastHM, duration: 45, week_rule: 'every' },
      { id: 'c1', type: 'course', semester_id: 'sem1', title: '环境工程概论', location: '紫金港北4-319', weekday: WD, start_time: hhmm, duration: 145, week_rule: 'every' },
      ...later,
    ],
    todos: [
      { id: 't1', title: '高数作业第三章', note: '', due_date: keyOf(now), done: true, done_at: now.toISOString(), source: 'manual', created_at: now.toISOString() },
      { id: 't2', title: '写实验报告', note: '', due_date: keyOf(now), done: false, done_at: null, source: 'manual', created_at: now.toISOString() },
    ],
  })
  browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })
  page = await ctx.newPage()
  await page.addInitScript((d) => {
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.data', d)
    localStorage.setItem('web2.theme', 'light')
    for (const k of ['web2.review', 'web2.daily', 'web2.usage', 'web2.llm']) localStorage.removeItem(k)
  }, DOC)
  await page.goto(BASE + '?t=' + APP_T, { waitUntil: 'domcontentloaded' })
  console.log('  模式: fallback（桌面 Chrome + 样例数据）| ' + page.url())
}
await page.waitForTimeout(1800)

const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()) })

// 系统返回键只在真机上有意义：桌面替身里没有任何东西监听 Capacitor backButton，
// page.goBack() 只会把页面整个导航走（曾把后续 S8/Z 全带崩）。所以替身模式下直接跳过。
const canSysBack = mode === 'device'
const sysBack = async () => {
  if (canSysBack) { execFileSync(ADB, ['shell', 'input', 'keyevent', '4']); await page.waitForTimeout(700) }
}

// 问候卡是常挂 DOM 的绝对定位浮层（切页时靠 translateX 滑出视口）。
// 判「这一页有没有问候卡」必须看它是否落在视口里，不能只看元素存不存在。
const heroVisible = () => page.evaluate(() => {
  const el = document.querySelector('[data-hero-wrap]')
  if (!el) return false
  const r = el.getBoundingClientRect()
  const vw = window.innerWidth
  return r.width > 0 && r.right > 2 && r.left < vw - 2
})
const shoot = async (name) => {
  /* 真机 CDP 上 page.screenshot() 会挂死（等到 30s+ 也不返回，且设备一断就抛
     "Target page, context or browser has been closed"）⇒ 真机一律走 adb 整屏截图，
     只有桌面替身才用 CDP 截图。2026-10-14 实测：S1 就是卡在 page.screenshot() 上。 */
  if (mode !== 'device') {
    await page.screenshot({ path: `${OUT}/${mode}-${name}.png` })
    return
  }
  try {
    execFileSync(ADB, ['shell', 'screencap', '-p', `/sdcard/s1s8-${name}.png`])
    execFileSync(ADB, ['pull', `/sdcard/s1s8-${name}.png`, `${OUT}/${mode}-adb-${name}.png`])
    execFileSync(ADB, ['shell', 'rm', `/sdcard/s1s8-${name}.png`])
  } catch { /* 截图失败不该中断检查 */ }
}
// 真机 CDP 上 playwright 的「可操作性」检查会失效：按钮只要贴近视口底部/被 BottomSheet 的
// 进场动画推着（例如 [data-todo-submit] 在 top 726 / vh 794），locator.click() 会一直等
// 「stable」到 8–30s 超时，但元素本身完全可点。实机验证：evaluate 里原生 .click() 一次就成。
// 所以真机分支统一走这个「按锚点直接派发 click」的通道，桌面替身仍用真实鼠标点击。
const tap = async (sel, idx = 0) => {
  const n = await page.evaluate(([s, i]) => {
    const els = document.querySelectorAll(s)
    if (els.length <= i) return 0
    els[i].click()
    return els.length
  }, [sel, idx])
  await page.waitForTimeout(500)
  return n
}
const go = async (tabKey) => {
  await page.evaluate(async (k) => {
    const b = document.querySelector(`nav [data-nav="${k}"]`)
    if (b) b.click()
    await new Promise((r) => setTimeout(r, 500))
  }, tabKey)
  await page.waitForTimeout(600)
}
const rectOf = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), w: Math.round(r.width) }
}, sel)

// ================= S1 今日页上下滑：只有中间在滚 =================
console.log('\n=== S1 今日页上下滑：只有中间那块在滚 ===')
await go('today')
{
  const before = await page.evaluate(() => {
    const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) } }
    return { hero: q('[data-hero-wrap]'), nav: q('nav'), scrollTop: document.querySelector('[data-today-scroll]')?.scrollTop ?? -1 }
  })
  await page.evaluate(async () => {
    /* 等帧用「rAF 或 60ms 兜底」：息屏 / 后台标签页里 rAF 永不触发，
       直接 await requestAnimationFrame 会把整个脚本挂死（2026-10-14 踩过）。 */
    const frame = () => new Promise((r) => {
      let done = false
      const fin = () => { if (!done) { done = true; r() } }
      requestAnimationFrame(fin)
      setTimeout(fin, 60)
    })
    const s = document.querySelector('[data-today-scroll]')
    if (s) { s.scrollTop = 220; for (let i = 0; i < 6; i++) await frame() }
    await new Promise(r => setTimeout(r, 300))
  })
  await page.waitForTimeout(400)
  const after = await page.evaluate(() => {
    const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height) } }
    return { hero: q('[data-hero-wrap]'), nav: q('nav'), scrollTop: document.querySelector('[data-today-scroll]')?.scrollTop ?? -1 }
  })
  const scrolled = after.scrollTop > before.scrollTop
  // 底部 tab 条固定：视口高 - nav.top 恒定（不随滚动变）
  const navPinned = before.nav && after.nav && before.nav.top === after.nav.top
  // 顶部问候卡：折叠会把 wrap 压矮，但 wrap 顶边必须钉住不动（m01369 的「钉住」）
  const heroPinned = before.hero && after.hero && Math.abs(after.hero.top - before.hero.top) <= 1
  ok('S1a', '中间内容真的滚了', scrolled, `scrollTop ${before.scrollTop} → ${after.scrollTop}`)
  ok('S1b', '底部 tab 条不动', navPinned, `nav.top ${before.nav?.top} → ${after.nav?.top}`)
  ok('S1c', '顶部问候卡/学期进度不位移', heroPinned, `hero.top ${before.hero?.top} → ${after.hero?.top}，高 ${before.hero?.h} → ${after.hero?.h}`)
  await shoot('s1-scrolled')
  await page.evaluate(async () => {
    const frame = () => new Promise((r) => { let d = false; const f = () => { if (!d) { d = true; r() } }; requestAnimationFrame(f); setTimeout(f, 60) })
    const s = document.querySelector('[data-today-scroll]'); if (s) { s.scrollTop = 0; for (let i = 0; i < 6; i++) await frame() }
  })
  await page.waitForTimeout(500)
}

// ================= S2「接下来」区结构 =================
console.log('\n=== S2「接下来」区上下滑一屏 ===')
{
  const info = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-today-item]')]
    const hs = items.map(e => Math.round(e.getBoundingClientRect().height))
    const foldBtn = document.querySelector('[data-today-past-fold]')
    const expandBtn = document.querySelector('[data-today-expand]')
    const nowCard = document.querySelector('[data-today-now]')
    return {
      n: items.length, heights: hs,
      fold: foldBtn ? foldBtn.innerText.trim() : null,
      expand: expandBtn ? expandBtn.innerText.trim() : null,
      hasNow: !!nowCard,
      strip: document.querySelector('[data-today-strip]')?.innerText.replace(/\n/g, ' | ') || null,
    }
  })
  console.log(`    条目 ${info.n} 条，高度 ${JSON.stringify([...new Set(info.heights)])}`)
  console.log(`    折叠行「${info.fold}」| 展开行「${info.expand}」`)
  console.log(`    顶卡页脚「${info.strip}」`)
  const tall = info.heights.filter(h => h >= 44)
  ok('S2a', '「接下来」每条是够高的时间轴卡（≥44px）', info.n > 0 && tall.length === info.n,
    info.n > 0 ? `${tall.length}/${info.n} 条 ≥44px（高度集合 ${JSON.stringify([...new Set(info.heights)])}）` : '一条都没有')
  ok('S2b', '首屏有「现在」卡 + 顶卡页脚', info.hasNow && !!info.strip, `hasNow=${info.hasNow} strip="${info.strip}"`)
  // 就地展开：点折叠行，必须真的多出「已过」明细行（严格判定，不能只比文字）
  if (info.fold) {
    const before = info.n
    await page.locator('[data-today-past-fold]').first().click().catch(() => {})
    await page.waitForTimeout(600)
    const after = await page.evaluate(() => ({
      n: document.querySelectorAll('[data-today-item]').length,
      past: document.querySelectorAll('[data-today-past-row]').length,
      txt: document.querySelector('[data-today-past-fold]')?.innerText.trim(),
    }))
    ok('S2c', '点「已过 N 件」就地展开', after.past >= 1 && after.n > before,
      `条目 ${before} → ${after.n}（其中「已过」明细行 ${after.past} 条），文字「${info.fold}」→「${after.txt}」`)
    await page.locator('[data-today-past-fold]').first().click().catch(() => {})
    await page.waitForTimeout(400)
  } else {
    skipped('S2c', '点「已过 N 件」就地展开', '今天没有「已过」的行（该按钮不出现）')
  }
  // 展开全部 = 换密度，必须把首屏没显示的那几条也放出来（严格判定：条数要变多）
  if (info.expand) {
    await page.locator('[data-today-expand]').first().click().catch(() => {})
    await page.waitForTimeout(600)
    const after = await page.evaluate(() => ({
      n: document.querySelectorAll('[data-today-item]').length,
      txt: document.querySelector('[data-today-expand]')?.innerText.trim() || null,
    }))
    ok('S2d', '「展开全部」可切换且放出被折叠的条目', after.txt !== null && after.txt !== info.expand && after.n > info.n,
      `「${info.expand}」→「${after.txt}」，条目 ${info.n} → ${after.n}`)
    await page.locator('[data-today-expand]').first().click().catch(() => {})
    await page.waitForTimeout(400)
  } else skipped('S2d', '「展开全部」可切换', '今天条目没多到出现这个按钮')
  await shoot('s2-today')
}

// ================= S3 点「接下来」某一行进详情 =================
console.log('\n=== S3 手指点「接下来」某一行 → 进课程详情 ===')
{
  const r = await rectOf('[data-today-item]')
  if (!r) ok('S3a', '有可点的行', false, '找不到 [data-today-item]')
  else {
    ok('S3a', '行进详情前触区高度 ≥44px', r.h >= 44, `rect h=${r.h}（top ${r.top} / bottom ${r.bottom}）`)
    // 用 elementFromPoint 竖扫，确认真实落在**本行**上的连续跨度。
    // 判据语义：这一条守的是「课行的可点区不被别的层吃掉」。相邻的「已过 / 展开全部」控制行各带
    // after:-inset-y-[9px] 的扩触区（设计如此，让 20px 高的细控制条也好点），它会盖住课行最上几像素。
    // 因此判据取**最长连续命中段**（不是总命中数）：手指要的是一块连着的 44px 落点。
    // 扫描上界用 y < floor(bottom)：y <= floor(bottom) 会把下边界那个「盒子外」像素算进来，
    // 那是父容器的像素、永远不属于本行（白扣 1px）。
    const scan = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-today-item]')]
      let best = 0, bestIdx = -1, lost = []
      const detail = []
      rows.forEach((el, i) => {
        const b = el.getBoundingClientRect()
        let run = 0, localBest = 0
        for (let y = Math.ceil(b.top); y < Math.floor(b.bottom); y++) {
          const t = document.elementFromPoint(Math.round(b.left + b.width / 2), y)
          const inRow = !!(t && (el.contains(t) || t === el))
          if (inRow) { run++; if (run > localBest) localBest = run } else {
            run = 0
            const owner = t ? (t.closest('[data-today-past-fold]') ? 'fold(已过)' : t.closest('[data-today-expand]') ? 'expand(展开)' : t.tagName + '.' + String(t.className).slice(0, 34)) : 'null'
            if (!lost.includes(owner)) lost.push(owner)
          }
        }
        detail.push(localBest)
        if (localBest > best) { best = localBest; bestIdx = i }
      })
      return { best, bestIdx, count: rows.length, detail, lost }
    })
    ok('S3b', '最长连续可点段 ≥44px（不被上层遮罩裁掉）', scan.best >= 44,
      `第 ${scan.bestIdx} 行最长连续 ${scan.best}px / 共 ${scan.count} 行 ${JSON.stringify(scan.detail)}px / 占位=${JSON.stringify(scan.lost)}`)
    /* 真机 CDP 上 locator.click() 会卡在 actionability（见上面 tap 的注释）⇒ 真机用 tap 派发 click */
    if (mode === 'device') await tap('[data-today-item]')
    else await page.locator('[data-today-item]').first().click({ force: false }).catch(() => {})
    await page.waitForTimeout(700)
    const detail = await page.evaluate(() => {
      const s = document.querySelector('[data-sheet-detail]')
      return { open: !!s, txt: s ? s.innerText.replace(/\n/g, ' | ').slice(0, 90) : null, hasEdit: !!document.querySelector('[data-routine-edit]') }
    })
    ok('S3c', '点行真的进课程详情', detail.open, detail.txt ? `「${detail.txt}」` : '详情浮层没出现')
    await shoot('s3-detail')
    // 关掉
    await page.locator('[data-sheet-mask]').first().click({ force: true }).catch(() => {})
    await page.waitForTimeout(600)
  }
}

// ================= S4 三个录音入口 =================
console.log('\n=== S4 三个录音入口 ===')
{
  await go('today')
  const e1 = await page.evaluate(() => {
    const b = document.querySelector('[data-today-rec]')
    return b ? { ok: true, txt: b.innerText.trim().slice(0, 14) } : { ok: false }
  })
  ok('S4a', '① 今日页顶卡「录音」钮存在', e1.ok, e1.ok ? `文案「${e1.txt}」` : '找不到 [data-today-rec]')

  await go('week')
  const e2 = await page.evaluate(() => {
    const b = document.querySelector('[data-week-rec-now]')
    return b ? { ok: true, txt: b.innerText.trim().slice(0, 14) } : { ok: false }
  })
  /* 2026-10-13 用户 m12586 拍板「周课表里的录音按钮可以去掉」⇒ 现在它**不该**存在。
     断言反转为「课表页没有录音钮」，防它以后被谁不知不觉加回来。 */
  ok('S4b', '② 课表页不再有录音钮（2026-10-13 用户要求去掉）', !e2.ok, e2.ok ? `仍有 [data-week-rec-now]（文案「${e2.txt}」）` : '课表页无 [data-week-rec-now]，符合预期')

  if (mode === 'device') {
    // ③ 通知栏状态框的「开始录音」：从 adb 侧看通知里有没有这个 action
    const dump = adbOut(['shell', 'dumpsys', 'notification', '--noredact'])
    const hasNotif = dump.includes(PKG)
    const hasRecAction = /开始录音|开始记录|录音/.test(dump)
    ok('S4c', '③ 通知栏状态框带「开始录音」', hasNotif && hasRecAction,
      hasNotif ? (hasRecAction ? '通知存在且含录音 action' : '通知在，但没读到录音 action 文案') : 'dumpsys 里没找到本包通知')
  } else {
    skipped('S4c', '③ 通知栏状态框带「开始录音」', '通知栏只能在真机上验（需 adb dumpsys notification）')
  }

  // 真机：真点一次开始录音，验「停止并保存」出现，再停掉，不留垃圾
  if (mode === 'device' && e1.ok) {
    await go('today')
    // 注意：要点的必须是里面那颗 [data-today-rec-start] 按钮。
    // [data-today-rec] 只是包住「录音区」的容器 div（App.vue:4864-4865），点它没有任何 handler，
    // 首跑就是这么假挂的（点了容器 → 没进录音态 → S4d FAIL）。
    const before = await page.evaluate(() => document.querySelector('[data-today-rec]')?.innerText.trim() || '')
    const hasStart = await page.evaluate(() => !!document.querySelector('[data-today-rec-start]'))
    if (!hasStart) {
      skipped('S4d', '真点录音钮进录音态', '此刻顶卡没有录音钮（当前没有正在上的课，recEntryOn=false）')
    } else {
      await page.locator('[data-today-rec-start]').first().click().catch(() => {})
      await page.waitForTimeout(2600)
      const rec = await page.evaluate(() => ({
        stop: !!document.querySelector('[data-today-rec-stop]'),
        banner: !!document.querySelector('[data-rec-banner]'),
        txt: document.querySelector('[data-today-rec]')?.innerText.trim().slice(0, 20) || '',
      }))
      ok('S4d', '真点①后进入录音态（出现「停止并保存」/常驻小条）', rec.stop || rec.banner,
        `stop=${rec.stop} banner=${rec.banner} 顶卡文案「${rec.txt}」（点前「${before}」）`)
      if (rec.stop) {
        await page.locator('[data-today-rec-stop]').first().click().catch(() => {})
        await page.waitForTimeout(2600)
        // 停录会弹确认或直接保存；能收拾干净就行
        const still = await page.evaluate(() => !!document.querySelector('[data-today-rec-stop]'))
        ok('S4e', '停录后退出录音态（不残留）', !still, still ? '还在录音态' : '已退出，测试场次已自动落库/丢弃')
      }
    }
    await shoot('s4-recording')
  } else if (mode === 'fallback' && e1.ok) {
    skipped('S4d', '真点录音钮进录音态', '桌面替身没有原生录音桥（需真机）')
  }
}

// ================= S5「我的」页与返回链 =================
console.log('\n=== S5「我的」页：一屏 + 二级页返回链 ===')
{
  await go('me')
  // 先把「我的」页的二级页栈清干净：meSubStack 是**栈**，可能被上一步（或上一次跑、或某个深链，
  // 比如「生成纪要缺配置」会把栈铺成 ['settings','settings-recording']）留在非空状态。
  // 不清的话 S5d 点一次「返回」只会弹一层、data-sub 仍非 null ⇒ 假 FAIL（2026-10-13 真机撞到过：
  // 上一轮探针把栈留在 settings-recording，S5c 显示 data-sub=settings-recording、S5d 显示 data-sub=settings）。
  for (let i = 0; i < 6; i++) {
    const inSub = await page.evaluate(() => !!document.querySelector('[data-sub-page]'))
    if (!inSub) break
    await page.locator('[data-sub-back]').first().click().catch(() => {})
    await page.waitForTimeout(500)
  }
  const cleaned = await page.evaluate(() => !!document.querySelector('[data-sub-page]'))
  if (cleaned) console.log('    ⚠ 二级页栈未能清空（S5d 可能受影响）')
  const me = await page.evaluate(() => {
    const entries = [...document.querySelectorAll('[data-me-entry]')].map(e => e.getAttribute('data-me-entry'))
    const term = document.querySelector('[data-me-term]')?.innerText.replace(/\n/g, ' | ') || null
    return { entries, term, hasHero: !!document.querySelector('[data-hero-wrap]') }
  })
  console.log(`    学期行「${me.term}」| 入口 ${JSON.stringify(me.entries)}`)
  ok('S5a', '「我的」页有一行学期 + 六个入口', !!me.term && me.entries.length === 6, `entries=${JSON.stringify(me.entries)}`)
  ok('S5b', '「我的」页不显示今日页问候卡', !(await heroVisible()), `问候卡在视口内=${await heroVisible()}`)

  // 进第一个入口 → 二级页全屏（真机 CDP 上必须走 evaluate click，见 tap 注释）
  const entryKey = me.entries[0]
  await tap(`[data-me-entry="${entryKey}"]`)
  await page.waitForTimeout(700)
  const sub1 = await page.evaluate(() => {
    const s = document.querySelector('[data-sub-page]')
    if (!s) return null
    const r = s.getBoundingClientRect()
    return { key: s.getAttribute('data-sub'), top: Math.round(r.top), h: Math.round(r.height), title: document.querySelector('[data-sub-title]')?.innerText.trim() || null }
  })
  ok('S5c', '点入口全屏推入二级页', !!sub1 && sub1.h > 500, sub1 ? `data-sub=${sub1.key} 高 ${sub1.h} top ${sub1.top} 标题「${sub1.title}」` : '没出现 [data-sub-page]')

  // 返回按钮 → 回索引
  await page.locator('[data-sub-back]').first().click().catch(() => {})
  await page.waitForTimeout(700)
  const back1 = await page.evaluate(() => ({ sub: document.querySelector('[data-sub-page]')?.getAttribute('data-sub') ?? null, index: !!document.querySelector('[data-settings-index], [data-me-entry]') }))
  ok('S5d', '点「‹ 返回」回索引（不是跳级回今日页）', back1.sub === null && back1.index, `data-sub=${back1.sub}`)

  // 系统返回键逐级回退：再进二级页 → adb keyevent 4 → 应回索引
  if (mode === 'device') {
    await page.locator(`[data-me-entry="${entryKey}"]`).first().click().catch(() => {})
    await page.waitForTimeout(700)
    const inSub = await page.evaluate(() => document.querySelector('[data-sub-page]')?.getAttribute('data-sub') ?? null)
    await sysBack()
    const afterBack = await page.evaluate(() => ({ sub: document.querySelector('[data-sub-page]')?.getAttribute('data-sub') ?? null, stillApp: !!document.querySelector('[data-nav]') }))
    ok('S5e', '系统返回键逐级回退（二级页 → 索引，不误退出）', inSub !== null && afterBack.sub === null && afterBack.stillApp,
      `进 ${inSub} → 按返回 → data-sub=${afterBack.sub}，App 仍在=${afterBack.stillApp}`)
    // 再按一次：索引 → 今日页（不是退出 App）
    await sysBack()
    const backToToday = await page.evaluate(() => !!document.querySelector('[data-nav]'))
    ok('S5f', '再按一次返回：回今日页而非退出 App', backToToday, `App 前台=${backToToday}`)
  } else {
    skipped('S5e', '系统返回键逐级回退', '系统返回键只能在真机上按（需 adb keyevent 4）')
    skipped('S5f', '再按一次返回不退出 App', '同上')
  }
  await shoot('s5-me')
}

// ================= S6 待办清单页 =================
console.log('\n=== S6 待办清单页：勾选就地生效 ===')
{
  await go('me')
  await tap('[data-me-entry="todos"]')
  await page.waitForTimeout(700)

  // 真机（或用户真数据）里「一条待办都没有」是**合法状态**，不该判 FAIL。
  // 所以这一组自给自足：没条目就先经 UI 真建一条，验完再删掉，不留痕迹
  // （顺带把「＋ 添加待办 → 填标题 → 添加」这条主路径也真跑了一遍）。
  //
  // ⚠ 选择器一律「锚点优先、文案兜底」：真机跑的是**已装 APK 里打包的那份产物**，
  // 不是我刚 build 出来的 dist —— 新加的 data-* 锚点要等下次出包才在机上。用文案兜底
  // 才能让同一个脚本在「旧包 + 新源码」下都跑得动。
  const TMP = '自动化检查用（会自己删）'
  const has = (s) => page.evaluate((x) => document.querySelectorAll(x).length, s)
  let provisioned = false
  let before = await page.evaluate(() => {
    const cbs = [...document.querySelectorAll('[data-todo-all-check]')]
    return { n: cbs.length, count: document.querySelector('[data-todos-count]')?.innerText.trim() || null }
  })
  if (before.n === 0) {
    console.log('    清单是空的 —— 先经 UI 建一条临时待办（验完删）')
    // 「＋ 添加待办」：新包有 data-todo-add，旧包/兜底用文案找
    if ((await has('[data-todo-add]')) > 0) await tap('[data-todo-add]')
    else {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.innerText.includes('添加待办'))
        if (b) b.click()
      })
      await page.waitForTimeout(600)
    }
    // 填标题：优先锚点，其次浮层里唯一的文本 input
    await page.evaluate((t) => {
      const el = document.querySelector('[data-todo-title]') || document.querySelector('[data-sheet-todo] input')
      if (!el) return
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, t)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, TMP)
    await page.waitForTimeout(400)
    // 提交：锚点优先，其次浮层里写「添加」的按钮（真机 CDP 上必须走 evaluate click，见 tap 注释）
    if ((await has('[data-todo-submit]')) > 0) await tap('[data-todo-submit]')
    else {
      await page.evaluate(() => {
        const s = document.querySelector('[data-sheet-todo]') || document
        const b = [...s.querySelectorAll('button')].find((x) => x.innerText.trim() === '添加')
        if (b) b.click()
      })
      await page.waitForTimeout(800)
    }
    before = await page.evaluate(() => {
      const cbs = [...document.querySelectorAll('[data-todo-all-check]')]
      return { n: cbs.length, count: document.querySelector('[data-todos-count]')?.innerText.trim() || null }
    })
    provisioned = before.n > 0
  }
  console.log(`    待办 ${before.n} 条 | 「${before.count}」${provisioned ? '（含 1 条临时）' : ''}`)
  ok('S6a', '待办清单页有条目与计数（空清单会自动建一条临时待办）', before.n > 0,
    `${before.n} 条，计数「${before.count}」${provisioned ? '（临时建的）' : ''}`)

  if (before.n > 0) {
    const firstId = await page.evaluate(() => document.querySelector('[data-todo-all-check]')?.getAttribute('data-todo-all-check'))
    await tap(`[data-todo-all-check="${firstId}"]`)
    await page.waitForTimeout(500)
    const after = await page.evaluate(() => ({ count: document.querySelector('[data-todos-count]')?.innerText.trim() || null }))
    ok('S6b', '勾选/取消就地生效（计数变化）', after.count !== before.count, `「${before.count}」→「${after.count}」`)
    // 还原，别改动真实数据
    await tap(`[data-todo-all-check="${firstId}"]`)
    await page.waitForTimeout(500)
    const restored = await page.evaluate(() => document.querySelector('[data-todos-count]')?.innerText.trim() || null)
    ok('S6c', '再点一次还原（不计入改动）', restored === before.count, `「${before.count}」→「${restored}」`)
  } else {
    skipped('S6b', '勾选/取消就地生效', '清单仍为空（连临时待办都没建出来）')
    skipped('S6c', '再点一次还原', '同上')
  }
  await shoot('s6-todos')

  // 清理：把临时待办删掉。点**标题文字**进编辑（点勾选框只会切完成态，不开浮层），
  // 再在浮层里点两次「删除」（第二次是确认）。
  if (provisioned) {
    const hasTitle = (await has('[data-todo-title-id]')) > 0
    if (hasTitle) {
      const tid = await page.evaluate(() => {
        const s = [...document.querySelectorAll('[data-todo-title-id]')].find((e) => e.innerText.includes('自动化检查用'))
        return s ? s.getAttribute('data-todo-title-id') : null
      })
      await tap(`[data-todo-title-id="${tid}"]`)
    } else {
      // 旧包没有标题锚点：按文案找那一行标题 span
      await page.evaluate((t) => {
        const el = [...document.querySelectorAll('span,div')].find((e) => e.innerText.trim() === t && e.children.length === 0)
        if (el) el.click()
      }, TMP)
      await page.waitForTimeout(700)
    }
    const delSel = (await has('[data-todo-delete]')) > 0 ? '[data-todo-delete]' : null
    if ((await has('[data-sheet-todo]')) > 0) {
      if (delSel) { await tap(delSel); await page.waitForTimeout(400); await tap(delSel) }
      else {
        await page.evaluate(() => {
          const s = document.querySelector('[data-sheet-todo]') || document
          const b = [...s.querySelectorAll('button')].find((x) => x.innerText.includes('删除'))
          if (b) b.click()
        })
        await page.waitForTimeout(500)
        await page.evaluate(() => {
          const s = document.querySelector('[data-sheet-todo]') || document
          const b = [...s.querySelectorAll('button')].find((x) => x.innerText.includes('确认'))
          if (b) b.click()
        })
      }
      await page.waitForTimeout(800)
    }
    const left = await page.evaluate(() => [...document.querySelectorAll('[data-todo-all-check]')].length)
    console.log(`    清理后剩 ${left} 条${left === 0 ? '（临时待办已删掉）' : '（⚠ 可能没删干净）'}`)
    ok('S6d', '清理：临时待办已删掉（不留痕）', left === 0, `剩 ${left} 条`)
  }
  if ((await has('[data-sub-back]')) > 0) await tap('[data-sub-back]')
  await page.waitForTimeout(500)
}

// ================= S7 课表页 ＋ 选单 =================
console.log('\n=== S7 课表页：顶部只有周次条 + ＋，选单四/五项 ===')
{
  await go('week')
  const top = await page.evaluate(() => ({
    label: document.querySelector('[data-week-label]')?.innerText.replace(/\n/g, ' ') || null,
    hasAdd: !!document.querySelector('[data-week-add]'),
    hasHero: !!document.querySelector('[data-hero-wrap]'),
    hasGrid: !!document.querySelector('[data-grid]'),
  }))
  console.log(`    周次条「${top.label}」`)
  ok('S7a', '顶部只有「‹ 第 N 周 / 共 M 周 ›」+ ＋', !!top.label && top.hasAdd, `label="${top.label}" hasAdd=${top.hasAdd}`)
  ok('S7b', '课表页不显示今日页问候卡', !(await heroVisible()), `问候卡在视口内=${await heroVisible()}`)
  // 开选单（真机 CDP 上必须走 evaluate click，见 tap 注释）
  await tap('[data-week-add]')
  await page.waitForTimeout(700)
  const menu = await page.evaluate(() => {
    const m = document.querySelector('[data-week-menu]')
    if (!m) return null
    const items = ['course', 'event', 'scan', 'dayover'].filter(k => m.querySelector(`[data-week-menu-${k}]`))
    return { items, txt: m.innerText.replace(/\n/g, ' / ').trim() }
  })
  ok('S7c', '点 ＋ 出选单', !!menu, menu ? `含 ${JSON.stringify(menu.items)}：「${menu.txt}」` : '选单没出现')
  if (menu) {
    ok('S7d', '选单条目覆盖 手动加课/加日程/拍课表识别/特殊日期', ['course', 'event', 'scan', 'dayover'].every(k => menu.items.includes(k)), JSON.stringify(menu.items))
  }
  // 点空白处收选单
  await page.mouse.click(20, 400).catch(() => {})
  await page.waitForTimeout(600)
  const closed = await page.evaluate(() => !document.querySelector('[data-week-menu]'))
  ok('S7e', '点空白处收选单', closed, closed ? '已收起' : '选单还在')
  await shoot('s7-week')
  // 返回键收选单（真机专属：替身里没有 backButton 监听）
  if (canSysBack) {
    await tap('[data-week-add]')
    await page.waitForTimeout(600)
    await sysBack()
    const backGrid = await page.evaluate(() => ({ menu: !!document.querySelector('[data-week-menu]'), grid: !!document.querySelector('[data-grid]') }))
    ok('S7f', '按返回键收选单且仍在网格', !backGrid.menu && backGrid.grid, `menu=${backGrid.menu} grid=${backGrid.grid}`)
  } else {
    skipped('S7f', '按返回键收选单且仍在网格', '系统返回键只能在真机上按（替身里没有 backButton 监听）')
  }
}

// ================= S8 网格填满 + 长页面滚到底不被 tab 挡 =================
console.log('\n=== S8 网格与长页面 ===')
{
  await go('week')
  const grid = await page.evaluate(() => {
    const g = document.querySelector('[data-grid]')
    if (!g) return null
    const r = g.getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: window.innerHeight, navTop: Math.round(document.querySelector('nav').getBoundingClientRect().top) }
  })
  if (grid) {
    const noOverflow = grid.bottom <= grid.navTop + 2
    const fills = grid.h > grid.vh * 0.4
    ok('S8a', '课表网格不溢出到 tab 条之下', noOverflow, `grid.bottom=${grid.bottom} nav.top=${grid.navTop}`)
    ok('S8b', '课表网格填满一屏（不塌成一条）', fills, `grid 高 ${grid.h} / 视口 ${grid.vh}`)
  } else ok('S8a', '课表网格存在', false, '找不到 [data-grid]')

  // 长页面滚到底：设置页
  await go('me')
  await page.locator('[data-me-entry="settings"]').first().click().catch(() => {})
  await page.waitForTimeout(800)
  const deep = await page.evaluate(async () => {
    const body = document.querySelector('[data-sub-body]')
    if (!body) return null
    body.scrollTop = body.scrollHeight
    await new Promise(r => setTimeout(r, 400))
    const last = body.lastElementChild?.getBoundingClientRect()
    const nav = document.querySelector('nav').getBoundingClientRect()
    return {
      maxScroll: Math.round(body.scrollHeight - body.clientHeight),
      scrolled: Math.round(body.scrollTop),
      lastBottom: last ? Math.round(last.bottom) : null,
      navTop: Math.round(nav.top),
      clientH: Math.round(body.clientHeight),
    }
  })
  if (deep) {
    ok('S8c', '设置页能滚到底', deep.maxScroll === 0 || deep.scrolled >= deep.maxScroll - 2, `maxScroll=${deep.maxScroll} 实到 ${deep.scrolled}`)
    ok('S8d', '最后一行不被底部 tab 条挡住', deep.lastBottom !== null && deep.lastBottom <= deep.navTop + 1, `末行 bottom=${deep.lastBottom} nav.top=${deep.navTop}`)
  } else ok('S8c', '设置二级页存在可滚区', false, '找不到 [data-sub-body]')
  await shoot('s8-settings-long')

  // 练耳页也滚到底
  await page.locator('[data-sub-back]').first().click().catch(() => {})
  await page.waitForTimeout(600)
  await page.locator('[data-me-entry="listen"]').first().click().catch(() => {})
  await page.waitForTimeout(800)
  const lp = await page.evaluate(async () => {
    const body = document.querySelector('[data-sub-body]')
    if (!body) return null
    body.scrollTop = body.scrollHeight
    await new Promise(r => setTimeout(r, 400))
    const last = body.lastElementChild?.getBoundingClientRect()
    const nav = document.querySelector('nav').getBoundingClientRect()
    return { maxScroll: Math.round(body.scrollHeight - body.clientHeight), scrolled: Math.round(body.scrollTop), lastBottom: last ? Math.round(last.bottom) : null, navTop: Math.round(nav.top) }
  })
  if (lp) ok('S8e', '练耳页能滚到底且末行不被挡', (lp.maxScroll === 0 || lp.scrolled >= lp.maxScroll - 2) && (lp.lastBottom === null || lp.lastBottom <= lp.navTop + 1),
    `maxScroll=${lp.maxScroll} 实到 ${lp.scrolled}，末行 bottom=${lp.lastBottom} nav.top=${lp.navTop}`)
  else skipped('S8e', '练耳页滚到底', '找不到 [data-sub-body]')
  await shoot('s8-listen-long')
  // 收尾：回今日页
  await page.locator('[data-sub-back]').first().click().catch(() => {})
  await page.waitForTimeout(500)
  await go('today')
}

// ================= Z 错误 =================
console.log('\n=== Z 全程错误 ===')
ok('Z1', '全程无 pageerror / console.error', errs.length === 0, errs.length ? errs.slice(0, 3).join(' | ') : '干净')

// 真机模式收尾：把页面 reload 回不带 ?t= 的真实时间，别把测试用的冻结钟点留给用户
if (mode === 'device') {
  await page.goto(appUrl || page.url().split('?')[0], { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1500)
  console.log('  已把真机页面 reload 回真实时间：' + page.url())
}

// ================= 汇总 =================
const total = pass + fail + skip
console.log(`\n=== 汇总（${mode}）===`)
console.log(`  PASS ${pass} / FAIL ${fail} / SKIP ${skip}（共 ${total} 项）`)
if (skip) console.log(`  ⚠ 跳过了 ${skip} 项：${rows.filter(r => r.st === 'SKIP').map(r => r.id).join(', ')}`)
console.log(`  截图目录 ${OUT}/`)
if (fail) {
  console.log('\n未通过：')
  for (const r of rows.filter(r => r.st === 'FAIL')) console.log(`  ✗ ${r.id} ${r.what} — ${r.evidence}`)
}
await browser.close()
console.log(fail === 0 ? '\nS1–S8 全过（SKIP 项见上，多为真机专属）' : `\n有 ${fail} 项未过`)
process.exit(fail === 0 ? 0 : 1)
