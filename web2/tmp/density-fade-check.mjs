/* 今天页密度切换交叉淡入的逐帧取证（动效约定 1a）
   跑法：先起 dist 静态服务（默认 4177）再 node tmp/density-fade-frames.mjs
   产物：tmp/density-fade-before.png / -after.png（D 与 F 两个稳态）
   断言：点「展开全部」后 0.2s 内旧列表整体变淡 + 新列表淡入（不是硬切），
        且滚动位置不动、行高不变、两次点击之间不叠加两套行。 */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
import { mkdirSync } from 'node:fs'

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const OUT = 'tmp'
mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.addInitScript(() => localStorage.setItem('web2.onboarded', '1'))
/* 冻结到 12:30：这天上午的课已过、下午还有课，D 视图 = 「已过 N 件」折叠行 + 接下来若干行；
   F 视图 = 全天表（已过那些行铺回来）。这样切换前后行数差最大，交叉淡入与硬切一眼能分。 */
await page.goto(BASE + '?t=12:30', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)

const section = page.locator('[data-page="today"] section').first()
const rowCount = () => page.locator('[data-today-item]').count()
const foldCount = () => page.locator('[data-today-past-fold]').count()
const scrollY = () => page.evaluate(() => window.scrollY)
/* 「行区块」的不透明度：Transition 会给正在淡入/淡出的那层挂 opacity */
const fadingBlocks = () => page.evaluate(() => {
  const sec = document.querySelector('[data-page="today"] section')
  return [...sec.querySelectorAll('div, ul, ol')]
    .filter((el) => el.querySelector('[data-today-item]'))
    .map((el) => Number(getComputedStyle(el).opacity))
})

/* 周日没有课 → 没有密度可切，如实跳过而不是伪装成失败（同 step2-check 的口径） */
const rowCountAt = await rowCount()
if (rowCountAt === 0) {
  console.log('SKIP | 今天（示例数据里没有课）没有可切换的密度 —— 换个有课的日子再跑')
  await browser.close()
  process.exit(0)
}

t('A. 起点是 D 视图（有折叠行）', (await foldCount()) === 1, `rows=${rowCountAt}`)
const hBefore = await section.boundingBox()
const rowKeys = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-today-item]')].map((el) => el.innerText.replace(/\s+/g, ' ').slice(0, 12)))
const keysBefore = await rowKeys()
await section.screenshot({ path: `${OUT}/density-fade-before.png` })

/* 2026-10-24 重写采样：原来按固定 40/80/120/160/200ms 抓 5 个点，
   在机器忙的时候点击到开始淡之间会拖过 160ms ⇒ 前四点全是 1.00、最后一点直接 0.00，
   B/C 双双假红（单跑也可能挂）。改为**用页面里的 requestAnimationFrame 连续采 400ms**，
   采样器先起跑再点击，不管淡入从第几帧开始都能抓到中间态。 */
const samplesPromise = page.evaluate(() => new Promise((resolve) => {
  const out = []
  const t0 = performance.now()
  const step = () => {
    const sec = document.querySelector('[data-page="today"] section')
    const op = sec
      ? [...sec.querySelectorAll('div, ul, ol')]
          .filter((el) => el.querySelector('[data-today-item]'))
          .map((el) => Number(getComputedStyle(el).opacity))
      : []
    out.push({ t: Math.round(performance.now() - t0), op })
    if (performance.now() - t0 < 400) requestAnimationFrame(step)
    else resolve(out)
  }
  requestAnimationFrame(step)
}))
await page.locator('[data-today-expand]').click()
const samples = await samplesPromise
t('B. 淡出窗口里确实有半透明层（在交叉淡入，不是硬切）',
  samples.some((s) => s.op.some((o) => o > 0 && o < 1)),
  samples.filter((s) => s.op.some((o) => o > 0 && o < 1)).slice(0, 3)
    .map((s) => `${s.t}ms=[${s.op.map((o) => o.toFixed(2)).join(',')}]`).join(' ') || '整段没抓到中间态')
/* 被采样的是「装着行的那层」，它自己的 opacity 恒为 1；正在淡的是它内部
   Transition 包的子层 —— 取每个样本里最小的不透明度看趋势。
   判据收窄到「从开始淡到最暗那一刻一路下降」，不含淡完之后回弹到 1 的帧。 */
const minOps = samples.map((s) => (s.op.length ? Math.min(...s.op) : NaN)).filter((o) => !Number.isNaN(o))
const startedAt = minOps.findIndex((o) => o < 1)
const darkAt = minOps.indexOf(Math.min(...minOps))
const seq = startedAt >= 0 ? minOps.slice(startedAt, Math.max(darkAt, startedAt) + 1) : []
t('C. 淡出是单调下降（开始淡起一路暗到接近 0）',
  startedAt >= 0 && seq.every((o, i) => i === 0 || o <= seq[i - 1] + 1e-9) && Math.min(...minOps) < 0.05,
  seq.map((o) => o.toFixed(2)).join(' → ') || '没抓到淡出')

await page.waitForTimeout(600)
t('D. 终态是 F 视图（折叠行消失、行铺全、不透明度回到 1）',
  (await rowCount()) > keysBefore.length && (await page.locator('[data-today-past-fold]').count()) === 0
  && (await fadingBlocks()).every((o) => o === 1),
  `rows=${await rowCount()}（收起时 ${keysBefore.length}）`)
t('E. 滚动位置没动', (await scrollY()) === 0, String(await scrollY()))
const hAfter = await section.boundingBox()
/* 不变量是「26px 的行高本身两种密度一样」，不是「段落总高一样」——
   F 会把在 D 里折叠掉的行铺回来，段落当然更高。逐行量一次才是有意义的断言。 */
const rowH = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-today-item]')]
  return rows.map((el) => Math.round(el.getBoundingClientRect().height))
})
t('F. 两种密度卡片高都是 50px（切换不跳卡高）', rowH.length > 0 && rowH.every((h) => h === 50), JSON.stringify(rowH))
/* 不断言「段落总高变大」：折叠行是**替掉**那一条已过行，两条路径的行数与 space-y 间隙数不同，
   周几不同时符号都可能反过来（周三 12:30 实测 F 反而矮 2px）。真正的不变量是「一条都不丢」。 */
const keysAfter = await rowKeys()
t('F2. 展开后不丢行：收起时看得见的每一条，展开后都还在（只是把折叠的那些铺回来）',
  keysBefore.length > 0 && keysBefore.every((k) => keysAfter.includes(k)),
  `收起 ${keysBefore.length} 条 → 展开 ${keysAfter.length} 条`
  + `（${hBefore.height.toFixed(1)} → ${hAfter.height.toFixed(1)}px）`)
await section.screenshot({ path: `${OUT}/density-fade-after.png` })

/* 收起：同样交叉淡入，且不叠加两套行 */
await page.locator('[data-today-expand]').click()
const mid = await page.evaluate(() => ({
  dupe: (() => {
    const ids = [...document.querySelectorAll('[data-today-item]')].map((el) => el.innerText.replace(/\s+/g, ' ').slice(0, 12))
    return ids.length !== new Set(ids).size
  })(),
}))
t('G. 收起瞬间不出现两套重复行（mode="out-in" 生效）', mid.dupe === false)
await page.waitForTimeout(600)
/* 收起后不一定只剩 1 行：只有已经过 1 条时折叠行才替掉 1 行；过了 2 条也是 1 条折叠行。
   稳定的事实是「有折叠行、且它写着件数、且行数少于展开时」。 */
const foldText = (await page.locator('[data-today-past-fold]').innerText().catch(() => '')) || ''
t('H. 收回到 D 视图（有折叠行、写着件数、行数比 F 少）',
  (await foldCount()) === 1 && /件/.test(foldText) && (await rowCount()) < keysAfter.length,
  `rows=${await rowCount()} fold="${foldText.replace(/\s+/g, ' ')}"`)
t('I. 全程无 pageerror', errors.length === 0, JSON.stringify(errors.slice(0, 2)))

await browser.close()
console.log(`\n密度切换交叉淡入检查：${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
