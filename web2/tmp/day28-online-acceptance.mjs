// Day 28 结营验收：直接在**公网地址**上跑一遍「能力底线八条」里能当场观察到的项。
// 与 device-s1s8-check.mjs 的区别：那个跑真机 APK 的 WebView，这个跑公开的静态托管页，
// 用来证明「公网发布 + 前端页面与交互 + 前后端链路 + 刷新后数据仍在」四件事不是嘴上说的。
//
// 用法：node tmp/day28-online-acceptance.mjs
// 副作用（都自己清场）：① 往 sync_docs 写一份同步串为 day28-acceptance-2026 的文档，跑完点「清空云端」删掉；
//                      ② 只动浏览器临时 profile 的 localStorage，不碰线上 todos/schedules 表。
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const APP = 'https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/'
const SYNC_PASS = 'day28-acceptance-2026'
const MARK = 'DAY28-探针待办'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SHOTS = path.resolve('tmp/day28-shots')

let pass = 0
let fail = 0
const ok = (name, detail = '') => { pass++; console.log(`PASS | ${name}${detail ? ' — ' + detail : ''}`) }
const no = (name, detail = '') => { fail++; console.log(`FAIL | ${name}${detail ? ' — ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* 静态托管的测试域名前会插一页腾讯云「风险提醒」，点一次才进真页面 */
async function enter(page) {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await sleep(2200)
  if (!(await page.title()).includes('大学生日程助手')) {
    for (const sel of ['text=确定访问', 'text=继续访问', 'button:has-text("确定")', 'text=我知道了']) {
      if (await page.locator(sel).count()) { await page.locator(sel).first().click(); await sleep(3000); break }
    }
  }
  await page.waitForSelector('[data-today-scroll], [data-me-entry]', { timeout: 20000 })
}

/* 二级页是 fixed inset-0 的整屏浮层，会挡住底部 tab —— 先退回根层再点 tab */
async function backToRoot(page) {
  for (let i = 0; i < 5; i++) {
    if (!(await page.locator('[data-sub-page]').count())) break
    await page.locator('[data-sub-back]').first().click().catch(() => {})
    await sleep(600)
  }
}

async function openSettingsData(page) {
  await backToRoot(page)
  await page.locator('[data-nav="me"]').first().click(); await sleep(900)
  await page.locator('[data-me-entry="settings"]').first().click(); await sleep(900)
  await page.locator('[data-settings-index="data"]').first().click(); await sleep(900)
}

const run = async () => {
  fs.mkdirSync(SHOTS, { recursive: true })
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--lang=zh-CN'] })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })

  // 冻钟到 2026-10-14（周三）+ 塞一份样例课表 / 一条探针待办 / 一个打卡习惯
  await page.addInitScript((m) => {
    const FIXED = new Date('2026-10-14T10:30:00').getTime()
    const Real = Date
    class Fake extends Real { constructor(...a) { a.length ? super(...a) : super(FIXED) } static now() { return FIXED } }
    window.Date = Fake
    // 只在**首次**装载时播种：D3 要手动删掉本机那一份，播种若每次导航都跑就会把它塞回来（假证据）
    if (localStorage.getItem('web2.data')) return
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.theme', 'light')
    localStorage.setItem('web2.data', JSON.stringify({
      version: 1,
      schedules: [{ id: 'sch_1', semester: '2026-2027 秋冬', type: 'course', entries: [
        { id: 'c1', type: 'course', name: '高等数学', weekday: 3, start: '08:00', end: '09:35', place: '紫金港东1-205', weeks: null, term: '秋冬' },
        { id: 'c2', type: 'course', name: '结构力学Ⅰ', weekday: 3, start: '10:00', end: '11:35', place: '紫金港北4-317', weeks: null, term: '秋冬' },
        { id: 'c3', type: 'course', name: '环境工程概论', weekday: 3, start: '14:00', end: '15:45', place: '紫金港西2-301', weeks: null, term: '秋冬' },
      ] }],
      semester: { name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 16 },
    }))
    localStorage.setItem('web2.todos', JSON.stringify([{ id: 'todo_probe', title: m, note: '', due_date: '2026-10-14', done: false, done_at: null, source: 'manual', created_at: '2026-10-14T08:00:00', updated_at: '2026-10-14T08:00:00' }]))
    localStorage.setItem('web2.habits', JSON.stringify([{ id: 'habit_probe', name: '结营验收打卡', records: {}, backfilled: {}, created_at: '2026-10-14T08:00:00' }]))
  }, MARK)

  /* ===== A 段：公网地址本身 ===== */
  console.log('===== A 段：公网发布 =====')
  await enter(page)
  const title = await page.title()
  title.includes('大学生日程助手') ? ok('A1 公网地址能打开、且是应用本身（已过腾讯云风险提醒页）', `title=${title} · ${APP}`) : no('A1 公网地址', `title=${title}`)

  const live = await (await fetch(APP)).text()
  const liveAssets = (live.match(/assets\/index-[A-Za-z0-9_-]+\.(js|css)/g) || []).sort().join(',')
  const archFile = path.resolve('../release-archive/v1.2/index.html')
  const archAssets = fs.existsSync(archFile)
    ? (fs.readFileSync(archFile, 'utf8').match(/assets\/index-[A-Za-z0-9_-]+\.(js|css)/g) || []).sort().join(',')
    : '(没有归档)'
  liveAssets === archAssets && liveAssets
    ? ok('A2 线上产物与入库归档 release-archive/v1.2 逐名一致', liveAssets)
    : no('A2 线上产物 vs 归档', `线上=${liveAssets} 归档=${archAssets}`)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  overflow <= 1 ? ok('A3 手机视口（390×844）无横向溢出', `scrollWidth-innerWidth=${overflow}`) : no('A3 横向溢出', `${overflow}px`)

  /* ===== B 段：前端页面与视图数量 ===== */
  console.log('===== B 段：页面 / 视图 =====')
  const navCount = await page.locator('[data-nav]').count()
  navCount === 3 ? ok('B1 底部 3 个主视图', '今日 / 周课表 / 我的') : no('B1 主视图数量', `${navCount}`)
  ;(await page.locator('[data-today-scroll]').count()) ? ok('B2 昨日…今日页渲染出滚动容器', '[data-today-scroll]') : no('B2 今日页')

  await page.locator('[data-nav="week"]').first().click(); await sleep(900)
  ;(await page.locator('[data-week-add]').count()) ? ok('B3 周课表是独立视图（有 ＋ 选单入口）', '[data-week-add]') : no('B3 周课表')

  await page.locator('[data-nav="me"]').first().click(); await sleep(900)
  const meEntries = await page.locator('[data-me-entry]').count()
  meEntries >= 4 ? ok('B4 「我的」二级入口', `${meEntries} 个`) : no('B4 「我的」入口', `${meEntries}`)

  await page.locator('[data-me-entry="settings"]').first().click(); await sleep(900)
  const idx = await page.locator('[data-settings-index]').count()
  idx === 5 ? ok('B5 设置索引页 5 行（每行带当前值摘要）', '外观 / 提醒 / 录音 / 数据 / 系统') : no('B5 设置索引', `${idx}`)

  await backToRoot(page)
  await page.locator('[data-nav="today"]').first().click(); await sleep(900)
  const habits = await page.locator('[data-today-habit]').count()
  if (habits === 0) { no('B6 打卡浮层', '今日页没有打卡项，无法打开浮层') } else {
    await page.locator('[data-today-habit-more]').first().click(); await sleep(900)
    const opened = await page.locator('[data-sheet-mask]').count()
    await page.locator('[data-habit-sheet-close]').first().click().catch(() => {})
    await sleep(700)
    const closed = await page.locator('[data-sheet-mask]').count()
    opened && !closed ? ok('B6 浮层能打开也能关闭（第 6 类视图）', 'data-sheet-mask 1 → 0') : no('B6 浮层', `opened=${opened} closed=${closed}`)
  }

  /* ===== C 段：有反馈的交互 ===== */
  console.log('===== C 段：反馈交互 =====')
  await backToRoot(page)
  await page.locator('[data-nav="today"]').first().click(); await sleep(1000)
  const dbg = await page.evaluate(() => ({
    habits: document.querySelectorAll('[data-today-habit]').length,
    rowBtns: document.querySelectorAll('[data-today-habit] button').length,
    sub: !!document.querySelector('[data-sub-page]'),
    mask: !!document.querySelector('[data-sheet-mask]'),
    scroll: !!document.querySelector('[data-today-scroll]'),
  }))
  console.log('[debug C] ' + JSON.stringify(dbg))
  // 待办状态筛选 chips：选中态走 aria-pressed（读屏与视觉同一信号），列表随之变 —— 真交互反馈
  const probeFilter = (label, doClick = false) => page.evaluate(([l, c]) => {
    const btns = [...document.querySelectorAll('button')].filter((b) => ['全部', '未完成', '已完成'].includes(b.innerText.trim()))
    const b = btns.find((x) => x.innerText.trim() === l)
    const out = {
      n: btns.length,
      pressed: b ? b.getAttribute('aria-pressed') : null,
      openTodoShown: document.body.innerText.includes('高数作业'),
    }
    if (c && b) b.click()
    return out
  }, [label, doClick])
  const fBefore = await probeFilter('全部')
  await probeFilter('已完成', true); await sleep(900)
  const fAfter = await probeFilter('已完成')
  fBefore.n === 3 && fBefore.pressed === 'true' && fAfter.pressed === 'true' && fBefore.openTodoShown && !fAfter.openTodoShown
    ? ok('C1 点「已完成」筛选：选中态与列表同时变（aria-pressed + 列表被筛掉）', `chips=${fBefore.n}；未完成项可见 ${fBefore.openTodoShown} → ${fAfter.openTodoShown}`)
    : no('C1 筛选反馈', `${JSON.stringify(fBefore)} → ${JSON.stringify(fAfter)}`)
  await probeFilter('全部', true); await sleep(900)
  const fBack = await probeFilter('全部')
  fBack.pressed === 'true' && fBack.openTodoShown ? ok('C2 点回「全部」能复原（不锁死）', '列表回来了') : no('C2 筛选复原', JSON.stringify(fBack))
  await backToRoot(page)
  await page.locator('[data-nav="today"]').first().click(); await sleep(900)
  const probeHabit = (doClick = false) => page.evaluate((c) => {
    const rows = [...document.querySelectorAll('[data-today-habit]')]
    const b = rows[0] && rows[0].querySelector('button')
    const out = { rows: rows.length, streak: rows[0] ? rows[0].innerText.replace(/\s+/g, ' ').trim() : '' }
    if (c && b) b.click()
    return out
  }, doClick)
  const hb = await probeHabit(false)
  await probeHabit(true); await sleep(900)
  const ha = await probeHabit(false)
  hb.rows === 1 && ha.rows === 0
    ? ok('C3 打卡：点一下这条就从「今天要坚持」里移走（列表条数 1 → 0）', `"${hb.streak}" 已打卡`)
    : no('C3 打卡反馈', `rows ${hb.rows} → ${ha.rows}`)

  /* ===== D 段：前端 → 云函数 → 数据库，刷新后仍在 ===== */
  console.log('===== D 段：完整链路 + 刷新后持久化 =====')
  await openSettingsData(page)
  ;(await page.locator('[data-sync-card]').count()) ? ok('D1 App 里就有云同步这张卡', '设置 → 数据与导入导出') : no('D1 云同步卡')
  await page.locator('[data-sync-pass]').fill(SYNC_PASS)
  await page.locator('[data-sync-save]').click(); await sleep(700)
  await page.locator('[data-sync-upload]').click(); await sleep(4000)
  const upMsg = (await page.locator('[data-sync-msg]').first().textContent().catch(() => '')) || ''
  upMsg.startsWith('已上传') ? ok('D2 上传成功（前端 → 网关 → sync 云函数 → PostgreSQL）', upMsg.trim()) : no('D2 上传', upMsg.trim() || '(没有回执)')

  // 把本机那一份删掉再刷新页面 —— 这样「取回」就真的是从云端拿回来的，不是本机还剩着
  await page.evaluate(() => localStorage.removeItem('web2.todos'))
  await enter(page)
  const gone = await page.evaluate(() => localStorage.getItem('web2.todos'))
  gone === null ? ok('D3 清掉本机待办再刷新，本机确实没有了（排除假证）', 'web2.todos=null') : no('D3 清本机', String(gone))

  await openSettingsData(page)
  await page.locator('[data-sync-pass]').fill(SYNC_PASS)
  await page.locator('[data-sync-save]').click(); await sleep(700)
  await page.locator('[data-sync-download]').click(); await sleep(4000)
  const downMsg = (await page.locator('[data-sync-msg]').first().textContent().catch(() => '')) || ''
  await page.screenshot({ path: path.join(SHOTS, 'online-sync.png') })
  const back = await page.evaluate(() => (JSON.parse(localStorage.getItem('web2.todos') || '[]')[0] || {}).title || '')
  downMsg.startsWith('已从云端取回') && back === MARK
    ? ok('D4 刷新后「取回云端」，那条待办从数据库回来了', `${downMsg.trim()} · title=${back}`)
    : no('D4 取回', `${downMsg.trim()} · title=${back}`)

  await page.locator('[data-sync-clear]').click(); await sleep(400)
  await page.locator('[data-sync-clear]').click(); await sleep(3500)
  const clr = (await page.locator('[data-sync-msg]').first().textContent().catch(() => '')) || ''
  const cleared = /清空|删/.test(clr)
  cleared ? ok('D5 跑完自己清场（清空云端那份）', clr.trim()) : no('D5 清场', clr.trim())

  /* ===== E 段：移动端截图 ===== */
  await enter(page)
  await page.screenshot({ path: path.join(SHOTS, 'online-today.png') })
  fs.existsSync(path.join(SHOTS, 'online-today.png')) ? ok('E1 移动端截图已落盘（390×844 @2x）', 'tmp/day28-shots/online-today.png') : no('E1 截图')

  await browser.close()
  console.log(`\n公网验收检查：${pass} 项通过 / ${fail} 项失败`)
  process.exitCode = fail ? 1 : 0
}

run().catch((e) => { console.error('脚本异常：', e); process.exitCode = 2 })
