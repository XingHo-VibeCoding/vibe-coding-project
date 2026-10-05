/* 今日页「行动流」结构检查（playwright，走 dist 静态服务）——2026-10-03 方案 C Step 2
   断言：顶部状态条只剩一行（计数/进度条已搬进今天页窄条，不在所有 tab 上方占位）；
   今天页顺序 = 进度窄条 → 接下来 → 今天要交 → 今天要坚持 → 课堂录音（最后）；
   「接下来」里现在/下一节那条被标成 data-today-next 并带倒计时文案；
   旧「今日课程」「待办」两段改名后原有锚点（data-today-item / chips）不丢。
   时间用 ?t= 后门冻结（带参数时不走表）。
   跑法：先起 dist 静态服务（默认 4177，可用 TW_URL 覆盖）再 node tmp/step2-check.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
let pass = 0, fail = 0, skipped = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}
/* 日期敏感项：示例数据 web2/src/data/mock.js 的 weekCourses 只有周一~周六，
   周日跑时「今天」一节课都没有，凡是找「今天的课 / 下一节」的断言都无从谈起——
   直接跳过并说明，不要伪装成失败（NaN/Timeout 会带崩整脚本）。 */
function ts(name, why) {
  console.log('SKIP | ' + name + ' ← ' + why)
  skipped++
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })

async function open(tm) {
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url()) })
  await page.addInitScript(() => { localStorage.setItem('web2.onboarded', '1') })
  await page.goto(BASE + (tm ? '?t=' + tm : ''), { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  return { page, errors }
}

/* 今天页各段顺序（用直接子元素 + 段内 h2 首词认身份） */
const SECTION_ORDER = () => {
  const main = document.querySelector('[data-page="today"]')
  return [...main.children].map((el) => {
    if (el.hasAttribute('data-today-strip')) return 'strip'
    if (el.hasAttribute('data-today-rec')) return 'rec'
    const h2 = el.querySelector('h2')
    return h2 ? h2.innerText.replace(/\s+/g, ' ').trim().split(' ')[0] : el.tagName.toLowerCase()
  })
}

/* ================= A. 09:00：下一节还没开始 ================= */
const a = await open('09:00')
const p = a.page
t('A1. 今天页顶部有进度窄条 [data-today-strip]', (await p.locator('[data-today-strip]').count()) === 1)
const strip = await p.locator('[data-today-strip]').innerText()
t('A2. 窄条含「今天 N 节课」与「待办 d/t」', /今天 \d+ 节课/.test(strip) && /待办 \d+\/\d+/.test(strip), strip.replace(/\s+/g, ' '))
t('A3. 窄条带进度条', (await p.locator('[data-today-strip] .bg-primary-500').count()) === 1)

/* 今天有没有课：示例数据 web2/src/data/mock.js 的 weekCourses 只有周一~周六，
   周日跑时「今天」一节课都没有，凡是找「今天的课 / 下一节」的断言都无从谈起。 */
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date().getDay()]
const hasToday = (await p.locator('[data-today-item]').count()) > 0
const NO_TODAY = `今天（${WD}）示例数据里没有课，无「下一节」可断言`

const headerText = (await p.locator('header').innerText()).replace(/\s+/g, ' ')
t('A4. 顶卡主体是状态行（header 里恰好一个 data-header-status，且是既有三种口径之一）',
  (await p.locator('header [data-header-status]').count()) === 1
  && /进行中 · |下一节 · |今日安排已结束|今天没有课|今天收个尾|今天没有安排/.test(headerText),
  headerText)
t('A5. 「今天 N 节课」全页只出现一次（没在 header 里重复一遍）',
  (await p.locator('text=/今天 \\d+ 节课/').count()) === 1)

const order = await p.evaluate(SECTION_ORDER)
t('A6. 段序 = 接下来 → 今天要交 → 今天要坚持（Stage 2 后窄条/录音/复盘在顶卡内）',
  JSON.stringify(order) === JSON.stringify(['接下来', '今天要交', '今天要坚持']),
  JSON.stringify(order))

if (!hasToday) ts('A7. 原「今日课程」条目锚点仍在（data-today-item）', NO_TODAY)
else t('A7. 原「今日课程」条目锚点仍在（data-today-item）', (await p.locator('[data-today-item]').count()) === 1)
t('A8. 待办段标题同时含「今天要交」与「待办」（旧测试按 h2 含「待办」定位，不能丢）',
  (await p.locator('[data-page="today"] h2', { hasText: '待办' }).count()) === 1)
t('A9. 打卡段标题是「今天要坚持」', (await p.locator('[data-page="today"] h2', { hasText: '今天要坚持' }).count()) === 1)
t('A10. 待办筛选 chips 仍在（Step 2 不动它）',
  (await p.locator('[role="group"][aria-label="待办状态筛选"] button').count()) === 3)

if (!hasToday) {
  ts('A11. 恰好一条被标为「接下来」', NO_TODAY)
  ts('A12. 被标记的就是 10:00 那节，且显示「还有 60 分钟开始」', NO_TODAY)
} else {
  t('A11. 恰好一条被标为「接下来」', (await p.locator('[data-today-next]').count()) === 1)
  t('A12. 被标记的就是 10:00 那节，且显示「还有 60 分钟开始」',
    (await p.locator('[data-today-next]').innerText()).includes('10:00')
    && (await p.locator('[data-today-next]').innerText()).includes('还有 60 分钟开始'),
    (await p.locator('[data-today-next]').innerText()).replace(/\s+/g, ' '))
}
t('A13. 全程无页面报错 / 4xx', a.errors.length === 0, JSON.stringify(a.errors))
await p.close()

/* ================= B. 10:30：那节正在进行 ================= */
const b = await open('10:30')
const p2 = b.page
if (!hasToday) {
  ts('B1. 进行中时不报倒计时、改报进度', NO_TODAY)
  ts('B2. 头部状态条同步显示「进行中 · 」', NO_TODAY)
} else {
  t('B1. 进行中时不报倒计时、改报进度',
    (await p2.locator('[data-today-next]').innerText()).includes('进行中 · 已过 '), 
    (await p2.locator('[data-today-next]').innerText()).replace(/\s+/g, ' '))
  t('B2. 头部状态条同步显示「进行中 · 」',
    (await p2.locator('[data-header-status]').innerText()).includes('进行中 · '))
}
await p2.close()

/* ================= C. 12:30：今天的课全结束 ================= */
const c = await open('12:30')
const p3 = c.page
t('C1. 全结束后不再给任何一条打「接下来」', (await p3.locator('[data-today-next]').count()) === 0)
if (!hasToday) {
  ts('C2. 头部状态条显示「今日安排已结束」', NO_TODAY)
  ts('C3. 条目本身还在（不因为「都结束了」就从今天页消失）', NO_TODAY)
} else {
  t('C2. 头部状态条显示「今日安排已结束」',
    (await p3.locator('[data-header-status]').innerText()).includes('今日安排已结束'))
  t('C3. 条目本身还在（不因为「都结束了」就从今天页消失）', (await p3.locator('[data-today-item]').count()) === 1)
}
t('C4. 全程无页面报错 / 4xx', c.errors.length === 0, JSON.stringify(c.errors))
await p3.close()

await browser.close()
console.log(`\n今日页行动流检查：${pass} 项通过 / ${fail} 项失败${skipped ? ` / ${skipped} 项跳过（日期敏感）` : ''}`)
process.exit(fail ? 1 : 0)
