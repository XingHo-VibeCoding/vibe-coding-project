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

const adbOut = (args) => { try { return execFileSync(ADB, args, { encoding: 'utf8' }).trim() } catch { return '' } }
const devices = adbOut(['devices']).split('\n').slice(1).map(l => l.trim()).filter(l => l.endsWith('device'))
const DEVICE = devices.length > 0

console.log('=== P10 真机自动化 S1–S8 ===')
console.log(`  设备: ${DEVICE ? devices.join(', ') : '（无 adb 设备）'}`)

// ---------- 起会话 ----------
let browser, page, mode
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
  console.log('  模式: device（真实 WebView）+ 已连 9222 | url=' + page.url())
} else {
  mode = 'fallback'
  const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  const pad = (n) => String(n).padStart(2, '0')
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const MON = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return keyOf(d) })()
  const WD = ((new Date().getDay() + 6) % 7) + 1
  const now = new Date()
  // 造一节「正在进行」的课：起始 = 现在往前 30 分钟，时长 145
  const st = new Date(now.getTime() - 30 * 60 * 1000)
  const hhmm = `${pad(st.getHours())}:${pad(st.getMinutes())}`
  // 再造一节「已上完」的课（现在往前 3 小时、45 分钟），好把 S2 的折叠行也真跑到
  const past = new Date(now.getTime() - 3 * 3600 * 1000)
  const pastHM = `${pad(past.getHours())}:${pad(past.getMinutes())}`
  // 再造几节「接下来」的课，凑够「展开全部」出现的条件（超过首屏 3 条）
  const later = [4, 6, 8].map((h, i) => {
    const d = new Date(now.getTime() + h * 3600 * 1000)
    return { id: 'n' + i, type: 'course', semester_id: 'sem1', title: '后续课' + (i + 1), location: '东' + (i + 1) + '-10' + i, weekday: WD, start_time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, duration: 95, week_rule: 'every' }
  })
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
  await page.goto(BASE + '?t=' + hhmm, { waitUntil: 'domcontentloaded' })
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
  await page.screenshot({ path: `${OUT}/${mode}-${name}.png` })
  if (mode === 'device') {
    try {
      execFileSync(ADB, ['shell', 'screencap', '-p', `/sdcard/s1s8-${name}.png`])
      execFileSync(ADB, ['pull', `/sdcard/s1s8-${name}.png`, `${OUT}/${mode}-adb-${name}.png`])
      execFileSync(ADB, ['shell', 'rm', `/sdcard/s1s8-${name}.png`])
    } catch { /* 截图失败不该中断检查 */ }
  }
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
    const s = document.querySelector('[data-today-scroll]')
    if (s) { s.scrollTop = 220; for (let i = 0; i < 6; i++) await new Promise(r => requestAnimationFrame(r)) }
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
  await page.evaluate(async () => { const s = document.querySelector('[data-today-scroll]'); if (s) { s.scrollTop = 0; for (let i = 0; i < 6; i++) await new Promise(r => requestAnimationFrame(r)) } })
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
    // 用 elementFromPoint 竖扫，确认真实可点跨度（不被上层裁掉）
    const scan = await page.evaluate(() => {
      const el = document.querySelector('[data-today-item]')
      const b = el.getBoundingClientRect()
      let hit = 0
      for (let y = Math.ceil(b.top); y <= Math.floor(b.bottom); y++) {
        const t = document.elementFromPoint(Math.round(b.left + b.width / 2), y)
        if (t && (el.contains(t) || t === el)) hit++
      }
      return { hit, span: Math.round(b.bottom - b.top) }
    })
    ok('S3b', '真实可点跨度 ≥44px（不被上层裁掉）', scan.hit >= 44, `竖扫命中 ${scan.hit}px / 几何高 ${scan.span}px`)
    await page.locator('[data-today-item]').first().click({ force: false }).catch(() => {})
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
  ok('S4b', '② 课表页「正在上的那节课」卡右下录音钮存在', e2.ok, e2.ok ? `文案「${e2.txt}」` : '找不到 [data-week-rec-now]（今天此刻可能没课）')

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
    const before = await page.evaluate(() => document.querySelector('[data-today-rec]')?.innerText.trim() || '')
    await page.locator('[data-today-rec]').first().click().catch(() => {})
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
      await page.waitForTimeout(2000)
      // 停录会弹确认或直接保存；能收拾干净就行
      const still = await page.evaluate(() => !!document.querySelector('[data-today-rec-stop]'))
      ok('S4e', '停录后退出录音态（不残留）', !still, still ? '还在录音态' : '已退出，测试场次已自动落库/丢弃')
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
  const me = await page.evaluate(() => {
    const entries = [...document.querySelectorAll('[data-me-entry]')].map(e => e.getAttribute('data-me-entry'))
    const term = document.querySelector('[data-me-term]')?.innerText.replace(/\n/g, ' | ') || null
    return { entries, term, hasHero: !!document.querySelector('[data-hero-wrap]') }
  })
  console.log(`    学期行「${me.term}」| 入口 ${JSON.stringify(me.entries)}`)
  ok('S5a', '「我的」页有一行学期 + 四个入口', !!me.term && me.entries.length === 4, `entries=${JSON.stringify(me.entries)}`)
  ok('S5b', '「我的」页不显示今日页问候卡', !(await heroVisible()), `问候卡在视口内=${await heroVisible()}`)

  // 进第一个入口 → 二级页全屏
  const entryKey = me.entries[0]
  await page.locator(`[data-me-entry="${entryKey}"]`).first().click().catch(() => {})
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
  await page.locator('[data-me-entry="todos"]').first().click().catch(() => {})
  await page.waitForTimeout(800)
  const before = await page.evaluate(() => {
    const cbs = [...document.querySelectorAll('[data-todo-all-check]')]
    return { n: cbs.length, count: document.querySelector('[data-todos-count]')?.innerText.trim() || null }
  })
  console.log(`    待办 ${before.n} 条 | 「${before.count}」`)
  ok('S6a', '待办清单页有条目与计数', before.n > 0, `${before.n} 条，计数「${before.count}」`)
  if (before.n > 0) {
    const firstId = await page.evaluate(() => document.querySelector('[data-todo-all-check]')?.getAttribute('data-todo-all-check'))
    await page.locator(`[data-todo-all-check="${firstId}"]`).first().click().catch(() => {})
    await page.waitForTimeout(700)
    const after = await page.evaluate(() => ({ count: document.querySelector('[data-todos-count]')?.innerText.trim() || null }))
    ok('S6b', '勾选/取消就地生效（计数变化）', after.count !== before.count, `「${before.count}」→「${after.count}」`)
    // 还原，别改动真实数据
    await page.locator(`[data-todo-all-check="${firstId}"]`).first().click().catch(() => {})
    await page.waitForTimeout(600)
    const restored = await page.evaluate(() => document.querySelector('[data-todos-count]')?.innerText.trim() || null)
    ok('S6c', '再点一次还原（不计入改动）', restored === before.count, `「${before.count}」→「${restored}」`)
  }
  await shoot('s6-todos')
  await page.locator('[data-sub-back]').first().click().catch(() => {})
  await page.waitForTimeout(600)
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
  // 开选单
  await page.locator('[data-week-add]').first().click().catch(() => {})
  await page.waitForTimeout(600)
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
    await page.locator('[data-week-add]').first().click().catch(() => {})
    await page.waitForTimeout(500)
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
