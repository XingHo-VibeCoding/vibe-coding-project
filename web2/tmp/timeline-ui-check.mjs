/* 03 时间去哪了 —— 界面自检
   用法：先起 4177 静态服务（serve.js 服务的是 dist/，改源码要先 build），再 node tmp/timeline-ui-check.mjs
   钉死夹具：不依赖真实时刻，`web2.daily` 与 `web2.usage` 全部自己种。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

let ok = 0, bad = 0
const fails = []
function t(name, cond, extra) {
  if (cond) { ok++; console.log('  PASS ' + name + (extra !== undefined ? '  → ' + extra : '')) }
  else { bad++; fails.push(name); console.log('  FAIL ' + name + '  → ' + extra) }
}

/* 日期键按「今天」倒推，别写死 —— 写死的话某天跑就会因为「今天不是 10-16」而假红。
   ⚠ 用 UTC 加天数再取 UTC 日期，避免本地时区把日期扭到前一天。 */
function keyOf(offsetDays) {
  const d = new Date()
  const t = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - offsetDays * 86400000
  const x = new Date(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`
}
const D0 = keyOf(0), D1 = keyOf(1), D2 = keyOf(2), D3 = keyOf(3), D4 = keyOf(4)

/* 种一份 daily 存档：3 天有手机时长（含边界 0 与「没抓到」）、2 天缺手机时长。 */
const DAYS = {
  [D4]: { date: D4, stats: { courses: 4, todosDone: 1, todosTotal: 3, habitsDone: 2, habitsTotal: 3, listenToday: 2 }, usage_ms: 7200000, updated_at: 1 },
  [D3]: { date: D3, stats: { courses: 0, todosDone: 0, todosTotal: 0, habitsDone: 0, habitsTotal: 0, listenToday: 0 }, usage_ms: 0, updated_at: 1 },
  [D2]: { date: D2, stats: { courses: 2, todosDone: 3, todosTotal: 3, habitsDone: 1, habitsTotal: 1, listenToday: 0 }, usage_ms: null, updated_at: 1 },
  [D1]: { date: D1, stats: { courses: 3, todosDone: 0, todosTotal: 2, habitsDone: 0, habitsTotal: 2, listenToday: 5 }, usage_ms: 3600000, updated_at: 1 },
  [D0]: { date: D0, stats: { courses: 1, todosDone: 2, todosTotal: 2, habitsDone: 1, habitsTotal: 1, listenToday: 1 }, usage_ms: 1800000, updated_at: 1 },
}

function seed(lv, extra = {}) {
  const o = Object.assign({ 'web2.onboarded': '1', 'web2.theme': 'light', 'web2.daily': { version: 1, days: DAYS } }, extra)
  for (const [k, v] of Object.entries(lv)) o[k] = v
  return o
}

const ctxOpts = { viewport: { width: 390, height: 844 } }

async function openPage(browser, kv, { reload = false, page = null } = {}) {
  let p = page
  if (!p) {
    const ctx = await browser.newContext(ctxOpts)
    await ctx.route('**/*', (route) => {
      const u = route.request().url()
      if (u.startsWith(URL) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue()
      return route.abort()
    })
    p = await ctx.newPage()
    await p.addInitScript((kv) => {
      if (sessionStorage.getItem('tl-seeded')) return
      sessionStorage.setItem('tl-seeded', '1')
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
    }, kv)
  }
  await p.goto(URL, { waitUntil: 'networkidle' })
  await p.waitForTimeout(600)
  if (reload) { await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(600) }
  return p
}

/* 进「我的 → 时间去哪了」二级页 */
async function openTimeline(p) {
  await p.evaluate(() => document.querySelector('[data-nav="me"]').click())
  await p.waitForTimeout(500)
  const hit = await p.evaluate(() => {
    const b = document.querySelector('[data-me-timeline]')
    if (!b) return false
    b.click()
    return true
  })
  await p.waitForTimeout(500)
  return hit
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu'] })
try {
  console.log('\n--- A 入口 ---')
  {
    const ctx = await browser.newContext(ctxOpts)
    await ctx.route('**/*', (r) => (r.request().url().startsWith(URL) ? r.continue() : r.abort()))
    const p = await ctx.newPage()
    await p.addInitScript((kv) => {
      if (sessionStorage.getItem('tl-seeded')) return
      sessionStorage.setItem('tl-seeded', '1')
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
    }, seed({}))
    await p.goto(URL, { waitUntil: 'networkidle' })
    await p.waitForTimeout(600)
    await p.evaluate(() => document.querySelector('[data-nav="me"]').click())
    await p.waitForTimeout(500)
    const entry = await p.evaluate(() => {
      const b = document.querySelector('[data-me-timeline]')
      if (!b) return null
      return { text: b.innerText.replace(/\s+/g, ' ').trim(), sub: (b.querySelector('[data-me-timeline-count]') || {}).textContent || '' }
    })
    t('A1 「我的」页有「时间去哪了」入口', !!entry, entry ? entry.text : '缺')
    t('A2 入口副标题写了范围与内容', entry && /最近一周/.test(entry.sub), entry ? entry.sub : '')
    const opened = await p.evaluate(() => { const b = document.querySelector('[data-me-timeline]'); if (!b) return false; b.click(); return true })
    await p.waitForTimeout(500)
    const title = await p.evaluate(() => (document.body.innerText.match(/时间去哪了/) ? 'hit' : 'miss'))
    t('A3 点进去进入二级页', opened && title === 'hit', title)
    await ctx.close()
  }

  console.log('\n--- B 卡呈现的是「已记下的天」 ---')
  const p = await openPage(browser, seed({}))
  await openTimeline(p)
  const dump = await p.evaluate(() => {
    const card = document.querySelector('[data-timeline-card]')
    if (!card) return { has: false }
    const rows = [...document.querySelectorAll('[data-timeline-day]')].map((el) => ({
      date: el.getAttribute('data-timeline-day'),
      text: el.innerText.replace(/\s+/g, ' ').trim(),
      usage: (el.querySelector('[data-timeline-usage]') || {}).getAttribute
        ? el.querySelector('[data-timeline-usage]').getAttribute('data-timeline-usage') : '',
    }))
    return { has: true, rows, line: (document.querySelector('[data-timeline-line]') || {}).innerText || '' }
  })
  t('B1 卡存在', dump.has, dump.has ? dump.rows.length + ' 行' : '缺')
  t('B2 记了 5 天就列 5 行（缺的天不补空行）', dump.has && dump.rows.length === 5, dump.has ? dump.rows.length : 0)
  t('B3 最近的在最前', dump.has && dump.rows[0].date === D0, dump.has ? dump.rows[0].date : '')
  t('B4 每行都带日期与星期', dump.has && dump.rows.every((r) => /\d{1,2} 月 \d{1,2} 日 周[一二三四五六日]/.test(r.text)), '')
  t('B5 今日那行标了「今天」', dump.has && dump.rows[0].text.includes('今天'), dump.has ? dump.rows[0].text.slice(0, 24) : '')

  console.log('\n--- C 手机时长：有数/没抓到/零 三种要长得不一样 ---')
  const byDate = {}
  for (const r of dump.rows) byDate[r.date] = r
  t('C1 有数的天标 known', byDate[D0].usage === 'known', byDate[D0].usage)
  t('C2 有数的天文案是时长（30 分钟）', /30 分钟/.test(byDate[D0].text), byDate[D0].text)
  t('C3 没抓到的天标 unknown', byDate[D2].usage === 'unknown', byDate[D2].usage)
  t('C4 没抓到的天文案是「未开启」而不是 0', /未开启/.test(byDate[D2].text) && !/手机 0/.test(byDate[D2].text), byDate[D2].text)
  t('C5 真的一分钟没碰 → 「没使用」（与未开启不同）', /没使用/.test(byDate[D3].text), byDate[D3].text)
  t('C6 2 小时写成「2 小时」不是「120 分钟」', /2 小时/.test(byDate[D4].text), byDate[D4].text)

  console.log('\n--- D 其它四类照实呈现 ---')
  t('D1 课程数', /课 4 节/.test(byDate[D4].text), byDate[D4].text)
  t('D2 待办「做完 / 总数」', /待办 1 \/ 3/.test(byDate[D4].text), byDate[D4].text)
  t('D3 打卡「做完 / 总数」', /打卡 2 \/ 3/.test(byDate[D4].text), byDate[D4].text)
  t('D4 练耳段数', /练耳 2 段/.test(byDate[D4].text), byDate[D4].text)
  t('D5 全零那天不等于空白（有手机那一项就够）', byDate[D3].text.includes('手机'), byDate[D3].text)

  console.log('\n--- E 摘要行说实话，不把没抓到的当 0 ---')
  t('E1 摘要含「抓到 N 天」（0 分钟也算抓到，null 才算没抓到）', /4 天抓到/.test(dump.line), dump.line)
  t('E2 摘要含日均', /平均每天/.test(dump.line), dump.line)
  t('E3 摘要如实说「另有 1 天没抓到」', /另有 1 天没抓到/.test(dump.line), dump.line)
  t('E4 摘要不含催/评判词', !/加油|努力|赶紧|必须|懒|拖延|少玩|超标|应该|自制力/.test(dump.line), dump.line)

  console.log('\n--- F 没开权限时不假装完整 ---')
  {
    const ctx2 = await browser.newContext(ctxOpts)
    await ctx2.route('**/*', (r) => (r.request().url().startsWith(URL) ? r.continue() : r.abort()))
    const p2 = await ctx2.newPage()
    /* 「没开权限」= 这台机器（浏览器）压根没有插件；种一份全 null 的 daily 存档 */
    const noUsage = {}
    for (const [k, v] of Object.entries(DAYS)) noUsage[k] = Object.assign({}, v, { usage_ms: null })
    await p2.addInitScript((kv) => {
      if (sessionStorage.getItem('tl-seeded2')) return
      sessionStorage.setItem('tl-seeded2', '1')
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
    }, seed({ 'web2.daily': { version: 1, days: noUsage } }))
    await p2.goto(URL, { waitUntil: 'networkidle' })
    await p2.waitForTimeout(600)
    await p2.evaluate(() => document.querySelector('[data-nav="me"]').click())
    await p2.waitForTimeout(400)
    await p2.evaluate(() => document.querySelector('[data-me-timeline]').click())
    await p2.waitForTimeout(500)
    const r2 = await p2.evaluate(() => ({
      line: (document.querySelector('[data-timeline-line]') || {}).innerText || '',
      allUnknown: [...document.querySelectorAll('[data-timeline-usage]')].every((e) => e.getAttribute('data-timeline-usage') === 'unknown'),
      anyZero: [...document.querySelectorAll('[data-timeline-day]')].some((e) => /手机 没使用|手机 0/.test(e.innerText)),
      hint: !!(document.querySelector('[data-timeline-usage-hint]')),
    }))
    t('F1 一天都没抓到 → 全部标 unknown', r2.allUnknown, r2.allUnknown)
    t('F2 一天都没抓到 → 绝不显示成 0 或「没使用」', !r2.anyZero, r2.anyZero ? '出现了 0' : 'clean')
    t('F3 指向权限（说了怎么办）', /使用情况访问/.test(r2.line), r2.line)
    t('F4 不催、不吓唬', !/加油|努力|赶紧|必须|戒|自制力|堕落/.test(r2.line), r2.line)
    await ctx2.close()
  }

  console.log('\n--- G 只呈现不评判（全页扫一遍） ---')
  {
    const full = await p.evaluate(() => document.body.innerText)
    const banned = ['加油', '努力', '赶紧', '必须', '懒', '拖延', '超标', '少玩', '你应该', '你怎么', '自制力', '堕落', '戒']
    const hit = banned.filter((w) => full.includes(w))
    t('G1 整页无评判/催促词', hit.length === 0, hit.join(',') || 'clean')
    /* 「N 分」要排除「30 分钟」这种时长单位，只拦真的当分数用的写法。
       2026-10-23 补：bug 06 起顶卡会写「还剩 1 小时 25 分」—— 那是**剩余时间**不是分数，
       先把「还剩 …」整段摘掉再扫，否则这条会随钟点假红（傍晚以后必然出现）。 */
    const noRemain = full.replace(/还剩\s*\d+(?:\s*小时(?:\s*\d+\s*分)?|\s*分)/g, '')
    const scoring = /第\s*\d+\s*名|\d+\s*分(?!钟)/.test(noRemain)
    t('G2 没有任何排名或分数（不写「第N名」「N分」）', !scoring, '')
  }

  console.log('\n--- H 不改数据、不发请求 ---')
  {
    const before = await p.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('web2.daily'))))
    await p.waitForTimeout(400)
    const after = await p.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('web2.daily'))))
    t('H1 只是看一眼，存档本身没被改写', before === after, before === after ? '未变' : '变了')
    const keys = await p.evaluate(() => Object.keys(localStorage).filter((k) => !/^web2\./.test(k)))
    t('H2 没新增奇怪的键', keys.length === 0, keys.join(','))
  }

  console.log('\n--- I 空存档的诚实空态 ---')
  {
    const ctx3 = await browser.newContext(ctxOpts)
    await ctx3.route('**/*', (r) => (r.request().url().startsWith(URL) ? r.continue() : r.abort()))
    const p3 = await ctx3.newPage()
    await p3.addInitScript((kv) => {
      if (sessionStorage.getItem('tl-seeded3')) return
      sessionStorage.setItem('tl-seeded3', '1')
      for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
    }, seed({ 'web2.daily': { version: 1, days: {} } }))
    await p3.goto(URL, { waitUntil: 'networkidle' })
    await p3.waitForTimeout(600)
    await p3.evaluate(() => document.querySelector('[data-nav="me"]').click())
    await p3.waitForTimeout(400)
    await p3.evaluate(() => document.querySelector('[data-me-timeline]').click())
    await p3.waitForTimeout(500)
    const r3 = await p3.evaluate(() => ({
      empty: !!(document.querySelector('[data-timeline-empty]')),
      card: !!(document.querySelector('[data-timeline-card]')),
      line: (document.querySelector('[data-timeline-line]') || {}).innerText || '',
      rows: document.querySelectorAll('[data-timeline-day]').length,
      todayUsage: (document.querySelector('[data-timeline-day] [data-timeline-usage]') || {getAttribute:()=>null}).getAttribute('data-timeline-usage'),
      todayText: (document.querySelector('[data-timeline-day]') || {innerText:''}).innerText,
    }))
    t('I1 全新装机时卡上只有今天一行（App 会静默记下当天）', r3.card && r3.rows === 1, JSON.stringify(r3))
    t('I2 今天那行的手机写「未开启」而不是 0', r3.todayUsage === 'unknown' && !/手机 没使用|手机 0/.test(r3.todayText), r3.todayText)
    await ctx3.close()
  }
} finally {
  await browser.close()
}

console.log(`\n=== 时间去哪了界面：${ok}/${ok + bad} 通过 ===`)
if (fails.length) console.log('失败项：' + fails.join(' / '))
process.exit(bad ? 1 : 0)
