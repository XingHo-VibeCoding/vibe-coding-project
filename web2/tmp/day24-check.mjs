// Day 24｜验证：修复后同一场景不再报错，且旧数据不再冒充新数据
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 截图路径相对脚本自身目录（脚本在 web2/tmp/ 下），避免 cwd 不同写进 web2/web2/
const HERE = dirname(fileURLToPath(import.meta.url))

const PAGE = 'file:///D:/Document/Project/vibe-coding-project/mock-frontend/index.html'
let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  ' + extra : '')) }
  else { fail++; console.log('  ✗ ' + name + '  ' + extra) }
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

// ---------- 场景 A：打开就失败（第一次失败）----------
{
  const ctx = await browser.newContext({ viewport: { width: 480, height: 1200 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e && e.message)))
  await page.route('**/api/list**', (r) => r.abort('failed'))
  await page.route('**/api/health**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))

  await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  const t = await page.evaluate(() => (document.getElementById('rows') || {}).innerText)
  ok('A1 第一次就失败时，屏幕上给出中文失败说明', /加载失败/.test(t), JSON.stringify(t))
  ok('A2 第一次失败时零 pageerror', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

// ---------- 场景 B：先成功、再失败（就是原来报错的那条路）----------
{
  const ctx = await browser.newContext({ viewport: { width: 480, height: 1200 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e && e.message)))

  const FAKE_OK = {
    ok: true,
    data: {
      semesters: [{ id: 'sem_x', name: '2026 假学期', first_monday: '2026-09-07', total_weeks: 16 }],
      schedules: [{ id: 's1', semester_id: 'sem_x', type: 'course', title: '假数据·高等数学', location: '教一 101', weekday: 1, start_time: '08:00:00' }],
      todos: [{ id: 't1', title: '假数据·还没写的作业', due_date: '2026-10-20', done: false }],
      counts: { semesters: 1, schedules: 1, todos: 1 },
    },
  }
  let mode = 'ok'
  await page.route('**/api/list**', async (r) => {
    if (mode === 'ok') await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_OK) })
    else await r.abort('failed')
  })
  await page.route('**/api/health**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))

  const snap = () => page.evaluate(() => ({
    rows: (document.getElementById('rows') || {}).innerText,
    todoCount: (document.getElementById('c-todo') || {}).textContent,
    countsVisible: (document.getElementById('counts') || {}).style.display,
    fetchedAt: (document.getElementById('fetched-at') || {}).textContent,
  }))

  await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
  const a = await snap()
  ok('B1 成功时假数据上屏', /假数据/.test(a.rows) && a.todoCount === '1')

  mode = 'fail'
  await page.click('#btn-refresh')
  await page.waitForTimeout(2500)
  const b = await snap()

  ok('B2 【原定要修的】再失败时不再抛 TypeError', errs.length === 0, errs.join(' | '))
  ok('B3 【关键】旧数据不再冒充新数据（屏幕上看不到「假数据」了）', !/假数据/.test(b.rows), JSON.stringify(b.rows))
  ok('B4 失败时给出中文说明', /加载失败/.test(b.rows), JSON.stringify(b.rows))
  ok('B5 失败时把旧数字藏掉（不再是 1）', b.countsVisible === 'none', 'display=' + b.countsVisible)
  ok('B6 「本次拉取」标明是失败那一次，不再停在旧时间',
    /拉取失败/.test(b.fetchedAt) && b.fetchedAt !== a.fetchedAt, a.fetchedAt + ' → ' + b.fetchedAt)

  await page.screenshot({ path: join(HERE, 'day24-after.png') })

  // 恢复：再点一次刷新（网络好了）应该能正常回来
  mode = 'ok'
  await page.click('#btn-refresh')
  await page.waitForTimeout(2000)
  const c = await snap()
  ok('B7 网络恢复后再刷新，数据正常回来（能自愈）', /假数据/.test(c.rows) && c.countsVisible === 'flex', 'display=' + c.countsVisible)
  ok('B8 全程零 pageerror', errs.length === 0, errs.join(' | '))

  await ctx.close()
}

// ---------- 场景 C：连续失败多次 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 480, height: 1200 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e && e.message)))
  await page.route('**/api/list**', (r) => r.abort('failed'))
  await page.route('**/api/health**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1800)
  for (let i = 0; i < 3; i++) { await page.click('#btn-refresh'); await page.waitForTimeout(1200) }
  const t = await page.evaluate(() => (document.getElementById('rows') || {}).innerText)
  ok('C1 连续点 3 次刷新不报错', errs.length === 0, errs.join(' | '))
  ok('C2 连点后仍显示中文失败说明', /加载失败/.test(t), JSON.stringify(t))
  await ctx.close()
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exit(fail ? 1 : 0)
