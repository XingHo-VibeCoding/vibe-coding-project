/* 六期·今天的账：每日快照 + 账卡并进「日精进」（playwright，走 dist 静态服务）
   覆盖：mount 落当天快照（不打扰用户）→ 账卡数字与本地数据同一口径（排 / 做完 / 几节课）
        → 基线文案（攒够之前不给结论）→ 四题走完生成日精进 → 结果页带「今天的账：排 N 做完 M」
        → 历史两路合流（复盘行 + 只有数字的浅色行）→ 数字没变不重复写盘 → 无 pageerror
   跑法：cd web2; $env:PORT='4177'; node serve.js  然后 node tmp/daily-account-check.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const { upsertDay } = await import('../src/data/daily.js')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let pass = 0, fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

const pad = (n) => String(n).padStart(2, '0')
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dk = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return keyOf(d) }
const T = dk(0)
const Y = dk(-1)
const MON = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return keyOf(d) })()
const WD = ((new Date().getDay() + 6) % 7) + 1

/* 2 件待办（1 件已完成）+ 今天 1 节课 ⇒ 账应该是「排 2 做完 1 · 今天上了 1 节课」 */
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
    { id: 'td1', title: '高数作业第三章', note: '', due_date: T, done: false, done_at: null, source: 'manual', created_at: new Date().toISOString() },
    { id: 'td2', title: '英语单词 50 个', note: '', due_date: T, done: true, done_at: new Date().toISOString(), source: 'manual', created_at: new Date().toISOString() },
  ],
})

/* 只有数字、没做四题的昨天：历史里应出现一条浅色行 */
const BOOK = JSON.stringify({
  version: 1,
  days: {
    [Y]: { date: Y, stats: { courses: 2, todosDone: 0, todosTotal: 3, habitsDone: 0, habitsTotal: 0, listenToday: 0 }, updated_at: Date.now() - 86400000 },
  },
})

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

async function open({ book = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url()) })
  await page.addInitScript(([docStr, bookStr]) => {
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.data', docStr)
    localStorage.removeItem('web2.review')
    localStorage.removeItem('web2.daily')
    if (bookStr) localStorage.setItem('web2.daily', bookStr)
  }, [DOC, book])
  await page.goto(BASE + '?t=21:30', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  return { page, ctx, errors }
}

const rawDaily = (page) => page.evaluate(() => localStorage.getItem('web2.daily') || '')
const day = (page, k) => page.evaluate((kk) => {
  const b = JSON.parse(localStorage.getItem('web2.daily') || 'null')
  return (b && b.days && b.days[kk]) || null
}, k)
const openAsk = async (page) => {
  await page.locator('[data-review-start]:visible').first().click()
  await page.waitForTimeout(400)
}

/* ---------- A 快照 ---------- */
{
  const { page, ctx, errors } = await open()
  const d = await day(page, T)
  t('A1 打开就落了当天快照', !!d, JSON.stringify(d))
  t('A2 快照数字与本地数据同一口径（排 2 做完 1 上 1 节课）',
    !!d && d.stats.todosTotal === 2 && d.stats.todosDone === 1 && d.stats.courses === 1,
    d ? JSON.stringify(d.stats) : 'no day')

  /* 账卡：说账 → 说人 */
  const q0 = await page.locator('[data-review-start]:visible').count()
  t('A3 今日页有复盘入口', q0 > 0, 'count=' + q0)
  await openAsk(page)
  const card = page.locator('[data-account-card]')
  t('A4 第一题顶部有账卡', (await card.count()) === 1)
  const line = await page.locator('[data-account-say]').textContent()
  const sub = await card.locator('[data-account-sub]').textContent()
  const lead = await card.locator('[data-account-lead]').textContent()
  t('A5 播报行是「你排了 2 件事，做完了 1 件。」', /你排了\s*2\s*件事，做完了\s*1\s*件/.test(line), line)
  t('A6 副行 1 / 2 + 还有 1 件没动', /1\s*\/\s*2/.test(sub) && /还有\s*1\s*件没动/.test(sub), sub)
  t('A7 主笔一句「还有 1 件没动。」', /还有\s*1\s*件没动/.test(lead), lead)
  const cardText = await card.textContent()
  t('A8 账卡带「今天上了 1 节课」', /今天上了\s*1\s*节课/.test(cardText), cardText.slice(0, 80))
  t('A9 基线文案「基线建立中 1 / 8 天」', /基线建立中\s*1\s*\/\s*8\s*天/.test(cardText), cardText.slice(-60))

  /* 进度条宽度 = 1/2 = 50% */
  const w = await page.evaluate(() => {
    const b = document.querySelector('[data-account-card] span[style]')
    return b ? b.getAttribute('style') : ''
  })
  t('A10 进度条按 1/2 给 50%', /width:\s*50%/.test(w), w)

  /* 走到第二题：账卡只该出现在第一题 */
  await page.locator('[data-review-next]').click()
  await page.waitForTimeout(350)
  t('A11 第二题不再重复显示账卡', (await page.locator('[data-account-card]').count()) === 0)

  /* ---------- B 生成 + 结果 ---------- */
  for (let i = 0; i < 3; i += 1) { await page.locator('[data-review-next]').click(); await page.waitForTimeout(250) }
  const sum = await page.locator('[data-review-summary]').textContent()
  const acc = await page.locator('[data-account-line]').textContent().catch(() => '')
  t('B1 生成日精进（结果页有 summary）', !!sum && sum.length > 0, (sum || '').slice(0, 30))
  t('B2 结果页带「今天的账：排 2 做完 1」', /今天的账：/.test(acc) && /排\s*2\s*做完\s*1/.test(acc), acc)
  t('B3 日精进正文照旧含待办口径', /待办完成\s*1\/2/.test(sum), sum)

  /* ---------- C 历史两路合流 ---------- */
  await page.locator('[data-review-done]').click()
  await page.waitForTimeout(300)
  await page.locator('[data-review-open-history]').click()
  await page.waitForTimeout(400)
  const rows = await page.locator('[data-review-history-item]').count()
  const rev = await page.locator('[data-account-history-item="review"]').count()
  const snap = await page.locator('[data-account-history-item="snapshot"]').count()
  t('C1 历史里有今天这条复盘', rev === 1, 'rows=' + rows)
  t('C2 数字行显示「排 2 做完 1」', /排\s*2\s*做完\s*1/.test(await page.locator('[data-account-history-line]').first().textContent()))

  /* ---------- D 预置「只有数字的昨天」 ---------- */
  const { page: p2, ctx: c2, errors: e2 } = await open({ book: BOOK })
  t('D0 没有复盘记录时今日页不显示历史入口（预设前提）', (await p2.locator('[data-review-open-history]').count()) === 0)
  await p2.locator('nav button').filter({ hasText: '我的' }).click()
  await p2.waitForTimeout(300)
  await p2.locator('[data-me-entry="settings"]').click()
  await p2.waitForTimeout(400)
  await p2.locator('[data-review-history]').click()
  await p2.waitForTimeout(400)
  const snap2 = await p2.locator('[data-account-history-item="snapshot"]').count()
  const txt2 = await p2.locator('[data-account-history-item="snapshot"]').first().textContent().catch(() => '')
  const yLine = await p2.locator('[data-review-history-item]', { hasText: '排 3 做完 0' }).count()
  t('D1 只有数字的日子也进历史（浅色行）', snap2 >= 1, 'snap=' + snap2)
  t('D2 浅色行写明「这天没结账，只留了数字」', /没结账/.test(txt2), txt2)
  t('D3 浅色行带昨天数字「排 3 做完 0」', yLine >= 1, 'rows=' + yLine)

  /* ---------- E 数字没变不重复写盘 ---------- */
  const st = { courses: 1, todosDone: 1, todosTotal: 2, habitsDone: 0, habitsTotal: 0, listenToday: 0 }
  const u1 = upsertDay({ version: 1, days: {} }, { date: T, stats: st, now: 111 })
  const u2 = upsertDay(u1.book, { date: T, stats: st, now: 222 })
  const u3 = upsertDay(u2.book, { date: T, stats: { ...st, todosDone: 2 }, now: 333 })
  t('E1 同一份数字再落一次：changed=false、updated_at 不动', u2.changed === false && u2.day.updated_at === 111, `changed=${u2.changed} at=${u2.day.updated_at}`)
  t('E2 数字变了才算 changed（并写新时间）', u3.changed === true && u3.day.updated_at === 333, `changed=${u3.changed} at=${u3.day.updated_at}`)
  const before = await rawDaily(p2)
  await p2.waitForTimeout(1500)
  const after = await rawDaily(p2)
  t('E3 同一会话里不会反复写盘（1.5 秒后原文一字不差）', before === after && before.length > 0, before === after ? 'same' : 'diff')

  t('F1 无 pageerror', errors.length === 0 && e2.length === 0, (errors[0] || e2[0] || ''))
  await ctx.close(); await c2.close()
}

await browser.close()
console.log(`\n六期·今天的账：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
