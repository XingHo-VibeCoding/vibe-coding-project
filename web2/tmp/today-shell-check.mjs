/* 今日页三段壳（方案 C Stage 1「结构地基」）检查——playwright，走 dist 静态服务。
   约定（docs/结构动效前置约定.md）：「头（问候卡）/ 尾（底部导航）固定，中间是唯一的滚动窗口」。
   断言：
   A1-A5 结构：今日页自己就是那个窗口（data-today-scroll + overflow-y:auto + overscroll contain），
          问候卡在窗口外，导航是 fixed，窗口内容确实超出（滚得动）；
   B1-B2 高度：窗口高 = 视口 − 页顶 − 导航 − 8px（±2）；文档不高出视口（body 不参与滚动）；
   C1-C2 头尾不动：窗口内滑到底后 header 顶、nav 底都不动，window.scrollY 始终 0；
   D1 回来看得见原位置：切到周课表再切回今日，窗口 scrollTop 保留；
   E1-E2 内容短时不滚：把视口拉高到 1200（同样的数据，块高不变）→ maxScroll = 0，文档仍不高出视口；
   F 全程无报错。
   跑法：先构建 + 起 dist 静态服务（默认 4177，TW_URL 可覆盖）再 node tmp/today-shell-check.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
let pass = 0, fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}
const r1 = (n) => Math.round(n * 10) / 10

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

async function open(height) {
  const ctx = await browser.newContext({ viewport: { width: 390, height } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url()) })
  await page.addInitScript(() => { localStorage.setItem('web2.onboarded', '1') })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  return { page, ctx, errors }
}

/* 一段量：窗口几何 + 头尾几何 + 文档几何（都在一次 evaluate 里取，避免中间发生重排） */
const PROBE = () => {
  const sc = document.querySelector('[data-page="today"]')
  const hero = document.querySelector('header')
  const nav = document.querySelector('nav')
  const se = document.scrollingElement
  const s = sc.getBoundingClientRect()
  const h = hero.getBoundingClientRect()
  const n = nav.getBoundingClientRect()
  return {
    scrollTop: sc.scrollTop,
    maxScroll: sc.scrollHeight - sc.clientHeight,
    clientH: sc.clientHeight,
    scrollH: sc.scrollHeight,
    pageTop: s.top,
    heroTop: h.top,
    navBottom: n.bottom,
    navH: n.height,
    winH: window.innerHeight,
    winScrollY: window.scrollY,
    docH: se.scrollHeight,
    docClientH: se.clientHeight,
  }
}

/* ================= A. 结构 ================= */
const a = await open(900)
const p = a.page
t('A1. 今日页有且只有一个滚动窗口 [data-today-scroll]',
  (await p.locator('[data-page="today"][data-today-scroll]').count()) === 1,
  `count=${await p.locator('[data-page="today"][data-today-scroll]').count()}`)

const scStyle = await p.locator('[data-today-scroll]').evaluate((el) => {
  const cs = getComputedStyle(el)
  return { overflowY: cs.overflowY, osb: cs.overscrollBehaviorY || cs.overscrollBehavior, h: el.style.height }
})
t('A2. 窗口是纵向滚动容器 + 到底只回弹（overscroll-behavior: contain）',
  scStyle.overflowY === 'auto' && scStyle.osb === 'contain', JSON.stringify(scStyle))
t('A3. 问候卡在窗口外（不在 [data-today-scroll] 里）',
  (await p.locator('header').evaluate((el) => el.closest('[data-today-scroll]') === null)))
t('A4. 底部导航是 fixed（尾固定）',
  (await p.locator('nav').evaluate((el) => getComputedStyle(el).position === 'fixed')))
t('A5. 窗口写死了实测高度（inline style height）', /^\d+px$/.test(scStyle.h), scStyle.h)

const A = await p.evaluate(PROBE)
t('A6. 示例数据下窗口内容确实超出（滚得动）', A.maxScroll > 0, `maxScroll=${A.maxScroll}`)

/* ================= B. 高度 ================= */
t('B1. 窗口高 = 视口 − 页顶 − 导航 − 8px（±2）',
  Math.abs(A.pageTop + A.clientH + A.navH + 8 - A.winH) <= 2,
  `top=${r1(A.pageTop)} h=${A.clientH} nav=${r1(A.navH)} win=${A.winH}`)
t('B2. 文档不高出视口（body 不参与滚动）',
  A.docH <= A.winH + 1 && A.docClientH <= A.winH + 1, `docH=${A.docH} win=${A.winH}`)

/* ================= C. 滑到底：只动窗口 ================= */
await p.evaluate(() => { document.querySelector('[data-today-scroll]').scrollTop = 99999 })
await p.waitForTimeout(250)
const C = await p.evaluate(PROBE)
t('C1. 窗口内滑到底：窗口真的滚了', C.scrollTop > 0 && Math.abs(C.scrollTop - A.scrollTop) > 20,
  `scrollTop ${A.scrollTop} → ${C.scrollTop}`)
t('C2. 头不动：问候卡顶边与滚动前一致（±1）且 window.scrollY 仍 0',
  Math.abs(C.heroTop - A.heroTop) <= 1 && C.winScrollY === 0, `heroTop ${A.heroTop} → ${C.heroTop} y=${C.winScrollY}`)
t('C3. 尾不动：导航底边与滚动前一致（±1）', Math.abs(C.navBottom - A.navBottom) <= 1)

/* ================= D. 回来还看得见原位置 ================= */
await p.locator('nav button').filter({ hasText: '周课表' }).click()
await p.waitForTimeout(500)
await p.locator('nav button').filter({ hasText: '今日' }).click()
await p.waitForTimeout(600)
const D = await p.evaluate(PROBE)
t('D1. 切走再切回来：窗口滚动位置保留（±2）',
  Math.abs(D.scrollTop - C.scrollTop) <= 2, `${C.scrollTop} → ${D.scrollTop}`)
t('D2. 切回来仍是「三段壳」高度（±2）',
  Math.abs(D.pageTop + D.clientH + D.navH + 8 - D.winH) <= 2, `h=${D.clientH} win=${D.winH}`)

/* ================= E. 内容不够长时不滚（同样的数据，视口拉高到 1700） ================= */
const e = await open(1700)
const pe = e.page
const E = await pe.evaluate(PROBE)
t('E1. 视口 1700（内容放得下）时窗口不出滚动条（maxScroll = 0）', E.maxScroll <= 0, `maxScroll=${E.maxScroll} clientH=${E.clientH} scrollH=${E.scrollH}`)
t('E2. 高视口下文档仍不高出视口', E.docH <= E.winH + 1, `docH=${E.docH} win=${E.winH}`)
t('E3. 高视口下窗口高仍是「视口 − 页顶 − 导航 − 8」（±2）',
  Math.abs(E.pageTop + E.clientH + E.navH + 8 - E.winH) <= 2, `top=${r1(E.pageTop)} h=${E.clientH}`)

/* ================= F. 报错 ================= */
t('F1. 两个视口下都没有页面报错 / 失败请求',
  a.errors.length === 0 && e.errors.length === 0, JSON.stringify([...a.errors, ...e.errors]))

await a.ctx.close()
await e.ctx.close()
await browser.close()
console.log(`\n== today-shell-check: ${pass} 过 / ${fail} 挂 ==`)
process.exit(fail ? 1 : 0)
