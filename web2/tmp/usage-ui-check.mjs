/* 六期 P6：手机使用时间**界面**验收（playwright，走 dist 静态服务 + 假插件注入）
   跑法：cd web2; $env:PORT='4177'; node serve.js  然后 node tmp/usage-ui-check.mjs
   前置：改完 src 必须 npm run build（这些脚本走的是 dist）。

   覆盖（设计稿 §1.2 / §1.7 / §1.8 / §1.9）：
     A 副栏默认折叠（不点就不展开）+ 折叠行文案三态
     B 展开：四类分布条（沟通单列）+ 分时段形状 + 基线文案
     C 无权限：明说「未开启」+ 给「去开启」一条路（不报错、不拦人）
     D 非 App（无插件）：说「仅 App 内可用」，且**不给**去开启（给了也开不了）
     E 隐私：DOM 里不出现任何包名/App 名；落盘 `web2.usage` 里也没有
     F 不催：重开账卡不会自动弹窗/自动展开；展开幂等
     Z 全程无 pageerror / HTTP 4xx

   坑（照抄别重试）：
     1. 必须 localStorage.setItem('web2.onboarded','1') 跳过开屏引导层。
     2. 账卡只出现在**第一题**（reviewSheet.step === 0），走到第二题就没了。
     3. 时间冻钟用 ?t=21:30（只冻钟点）；「今天」永远是真实今天。
     4. 假插件必须在 **addInitScript** 里塞（页面脚本跑之前），晚一帧 Vue 就判无桥了。 */

import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.USAGE_URL || `http://127.0.0.1:${process.env.PORT || 4177}/`

let pass = 0
let fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

const pad = (n) => String(n).padStart(2, '0')
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const MON = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return keyOf(d) })()
const WD = ((new Date().getDay() + 6) % 7) + 1

/* 一份够开账卡的主项目导出文档（没有它会有开屏引导层；有个课 + 个未完成待办就有账） */
const DOC = JSON.stringify({
  app: 'sched',
  schema_version: 1,
  exported_at: new Date().toISOString(),
  semester: { id: 'sem1', name: '测试学期', first_monday: MON, total_weeks: 16 },
  schedules: [{
    id: 'c1', type: 'course', semester_id: 'sem1', title: '环境工程概论', location: '紫金港北4-319',
    weekday: WD, start_time: '10:00', duration: 145, week_rule: 'every',
  }],
  todos: [
    { id: 'td1', title: '高数作业第三章', note: '', due_date: keyOf(new Date()), done: false, done_at: null, source: 'manual', created_at: new Date().toISOString() },
  ],
})

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

/** 开一页。mode: 'granted' | 'denied' | 'none'（'none' = 不注入假插件，模拟浏览器） */
async function open({ mode = 'granted', doc = DOC } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url()) })
  await page.addInitScript(([d, m]) => {
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.data', d)
    localStorage.removeItem('web2.review')
    localStorage.removeItem('web2.daily')
    localStorage.removeItem('web2.usage')
    if (m === 'none') return
    /* 假插件：**故意把包名/App 名塞进返回值**，用来验 web 侧不把它们露出来 */
    const granted = m === 'granted'
    const cats = granted
      ? [
          { key: 'comm', ms: 2 * 3600 * 1000, pkg: 'com.tencent.mm', appName: '微信' },
          { key: 'fun', ms: 90 * 60 * 1000, pkg: 'com.ss.android.ugc.aweme', appName: '抖音' },
          { key: 'study', ms: 40 * 60 * 1000, pkg: 'com.chaoxing.mobile', appName: '学习通' },
        ]
      : []
    const hours = new Array(24).fill(0)
    hours[9] = 30 * 60 * 1000
    hours[20] = 2 * 3600 * 1000
    globalThis.window.Capacitor = {
      Plugins: {
        UsageStats: {
          async available() { return { granted } },
          async openSettings() { globalThis.__opened = true; return { ok: true } },
          async today() {
            if (!granted) return { granted: false, totalMs: 0, byCategory: [], byHour: [] }
            const total = cats.reduce((s, c) => s + c.ms, 0)
            return { granted: true, totalMs: total, byCategory: cats, byHour: hours }
          },
        },
      },
    }
  }, [doc, mode])
  await page.goto(BASE + '?t=21:30', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  return { page, ctx, errors }
}

/** 打开账卡（只出现在第一题）：点今日页的复盘入口 */
async function openCard(page) {
  await page.locator('[data-review-start]:visible').first().click()
  await page.waitForTimeout(450)
}

const usageLS = (page) => page.evaluate(() => localStorage.getItem('web2.usage') || '')

/* ---------- A 默认折叠 ---------- */
{
  const { page, ctx, errors } = await open({ mode: 'granted' })
  await openCard(page)
  t('A0 账卡在（副栏挂账卡里）', (await page.locator('[data-account-card]').count()) === 1)
  t('A1 副栏**默认折叠**：有折叠行，没有面板（设计稿 §1.2 主栏常显、副栏折叠）',
    (await page.locator('[data-usage-block]').count()) === 1
    && (await page.locator('[data-usage-panel]').count()) === 0)
  const line = await page.locator('[data-usage-line]').textContent()
  t('A2 折叠行报数「手机 4h10m」（2h + 90m + 40m = 250 分钟）', /手机\s*4h10m/.test(line), line)

  /* ---------- B 展开 ---------- */
  await page.locator('[data-usage-toggle]').click()
  await page.waitForTimeout(350)
  t('B1 点开有面板', (await page.locator('[data-usage-panel]').count()) === 1)
  t('B2 有分布条', (await page.locator('[data-usage-bar]').count()) === 1)
  const cats = await page.locator('[data-usage-legend]').allTextContents()
  t('B3 图例是「沟通」与「娱乐」两个不同项（§1.8-2 微信不并进抖音）',
    cats.some((x) => /沟通/.test(x)) && cats.some((x) => /娱乐/.test(x)) && cats.length === 3,
    JSON.stringify(cats))
  t('B3b 图例带时长：沟通 2h00m / 娱乐 1h30m / 学习 40m',
    cats.some((x) => /沟通\s*2h00m/.test(x)) && cats.some((x) => /娱乐\s*1h30m/.test(x)) && cats.some((x) => /学习\s*40m/.test(x)),
    JSON.stringify(cats))
  const barHtml = await page.locator('[data-usage-bar]').innerHTML()
  /* 总时长 250 分钟：沟通 120/250=48% / 娱乐 90/250=36% / 学习 40/250=16% */
  t('B4 条形宽度按占比：沟通 48% / 娱乐 36% / 学习 16%',
    /width:\s*48%/.test(barHtml) && /width:\s*36%/.test(barHtml) && /width:\s*16%/.test(barHtml), barHtml.slice(0, 220))
  t('B5 有分时段形状（8 段）', (await page.locator('[data-usage-hours] > span').count()) === 8)
  const note = await page.locator('[data-usage-note]').textContent()
  t('B6 只有 1 天 → 基线文案是「基线建立中」（§1.7 攒够 8 天才许下结论）', /基线建立中/.test(note), note)
  t('B7 分时段口径如实标注（不是逐条事件，别装精确）',
    /按时段归桶，非逐条记录/.test(await page.locator('[data-usage-panel]').textContent()))

  /* ---------- E 隐私：DOM 与落盘都不许有包名/App 名 ---------- */
  const blockText = await page.locator('[data-usage-block]').textContent()
  const blockHtml = await page.locator('[data-usage-block]').innerHTML()
  t('E1 DOM 文本里没有 App 名（微信/抖音/学习通）',
    !/微信|抖音|学习通/.test(blockText), blockText.slice(0, 120))
  t('E2 DOM 属性/结构里没有包名（com.*）', !/com\./.test(blockHtml))
  const ls = await usageLS(page)
  t('E3 落盘 `web2.usage` 里没有包名/App 名', !!ls && !/com\./.test(ls) && !/微信|抖音|学习通/.test(ls), (ls || '').slice(0, 200))
  const stored = JSON.parse(ls || '{}')
  const today = Object.values((stored && stored.days) || {})[0]
  t('E4 落盘的那条含分类与分时段（数存下来了，不是只画了图）',
    !!today && Array.isArray(today.byCategory) && Array.isArray(today.byHour) && today.totalMs === (2 * 3600 + 90 * 60 + 40 * 60) * 1000,
    JSON.stringify(today && { t: today.totalMs }))

  /* ---------- F 不催：重开不自动展开 ---------- */
  await page.locator('[data-usage-toggle]').click()
  await page.waitForTimeout(250)
  t('F1 再点一次收起（幂等）', (await page.locator('[data-usage-panel]').count()) === 0)

  t('Z1 授权路径全程无 pageerror / 4xx', errors.length === 0, errors.slice(0, 2).join(' | '))
  await ctx.close()
}

/* ---------- C 无权限 ---------- */
{
  const { page, ctx, errors } = await open({ mode: 'denied' })
  await openCard(page)
  const line = await page.locator('[data-usage-line]').textContent()
  t('C1 无权限：折叠行明说「手机 · 未开启」（§1.7 不假装有数）', /未开启/.test(line), line)
  await page.locator('[data-usage-toggle]').click()
  await page.waitForTimeout(350)
  const panel = await page.locator('[data-usage-panel]').textContent()
  t('C2 展开后说清楚要开「使用情况访问权限」', /使用情况访问权限/.test(panel), panel.slice(0, 120))
  t('C3 给「去开启」一条路（App 开不了，只能引导去系统设置 —— §1.9）',
    (await page.locator('[data-usage-grant]').count()) === 1)
  t('C3b 无权限时**不画**分布条（没有数就别画空条）', (await page.locator('[data-usage-bar]').count()) === 0)
  await page.locator('[data-usage-grant]').click()
  await page.waitForTimeout(300)
  t('C4 点「去开启」真的调到了原生 openSettings', (await page.evaluate(() => globalThis.__opened === true)) === true)
  t('C5 无权限全程无 pageerror（没权限是正常状态，不是错误）', errors.length === 0, errors.slice(0, 2).join(' | '))
  /* 关了权限要如实降级落盘（不能留着旧数字） */
  const s = JSON.parse((await usageLS(page)) || '{}')
  const td = Object.values((s && s.days) || {})[0]
  t('C6 无权限那天落盘 granted=false（明天再看不会拿旧数骗人）', !!td && td.granted === false, JSON.stringify(td && { g: td.granted }))
  await ctx.close()
}

/* ---------- D 非 App（无插件） ---------- */
{
  const { page, ctx, errors } = await open({ mode: 'none' })
  await openCard(page)
  const line = await page.locator('[data-usage-line]').textContent()
  t('D1 浏览器里说「仅 App 内可用」（不是「未开启」—— 这里根本没这个能力）', /仅\s*App\s*内可用/.test(line), line)
  await page.locator('[data-usage-toggle]').click()
  await page.waitForTimeout(350)
  t('D2 浏览器里**不给**「去开启」（给了也开不了，只会绕晕人）',
    (await page.locator('[data-usage-grant]').count()) === 0)
  t('D3 浏览器路径不报错、不写 `web2.usage` 假数据', errors.length === 0 && !(await usageLS(page)),
    errors.slice(0, 2).join(' | '))
  await ctx.close()
}

console.log(`\n${pass} 过 / ${fail} 挂`)
await browser.close()
process.exit(fail ? 1 : 0)
