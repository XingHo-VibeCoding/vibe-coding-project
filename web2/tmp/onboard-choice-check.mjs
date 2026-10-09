/* 第一次使用页三个入口（2026-10-09 用户重排）：
   上「直接填学期信息，自己加课」/ 中「登录教务系统，直接抓课表」/ 下「导入数据」（JSON + 教务 xlsx 两个都收）。
   原「先用示例数据逛逛」已删除；示例数据以后只从「我的」页切。
   还要验：引导页里直接选 .xlsx → 预览页出现「先确认学期起止」两个输入 → 确认后
   自动建学期 + 装课表 + 关掉引导落到课表页。
   跑法：先起 dist 静态服务（默认 4177），再 node tmp/onboard-choice-check.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const { makeEduXlsx } = await import('./onboard-choice-xlsx.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
let pass = 0, fail = 0
const t = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')) }
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

try {
  /* ---------- A. 入口本身 ---------- */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)

  console.log('\n[A] 三个入口')
  t('A1. 干净环境出现引导页', await page.locator('[data-ob-step]').isVisible())
  t('A2. 「先用示例数据逛逛」已删除', (await page.locator('text=先用示例数据逛逛').count()) === 0)
  const order = await page.evaluate(() => [...document.querySelectorAll('[data-ob-choice-form],[data-ob-choice-edu],[data-ob-choice-import]')].map((e) => e.getAttribute('data-ob-choice-form') !== null ? 'form' : (e.getAttribute('data-ob-choice-edu') !== null ? 'edu' : 'import')))
  t('A3. 三个入口自上而下 = 填学期 / 教务 / 导入', JSON.stringify(order) === JSON.stringify(['form', 'edu', 'import']), JSON.stringify(order))
  const formText = await page.locator('[data-ob-choice-form]').innerText()
  t('A4. 第一个仍是「直接填学期信息，自己加课」（19 个老脚本依赖这句）', formText.includes('直接填学期信息，自己加课'), JSON.stringify(formText))
  const eduText = await page.locator('[data-ob-choice-edu]').innerText()
  t('A5. 中间是登录教务系统', /登录教务系统/.test(eduText))
  const impText = await page.locator('[data-ob-choice-import]').innerText()
  t('A6. 下面是导入数据，且说明里提到 Excel', impText.includes('导入数据') && /Excel|xlsx/i.test(impText), JSON.stringify(impText))
  /* 中间那个必须明显是主路径（用户把它排在中间＝推荐） */
  t('A7. 中间入口用的是主色底（主推那条）', (await page.locator('[data-ob-choice-edu]').getAttribute('class') || '').includes('primary'))
  const accept = await page.locator('[data-ob-file]').getAttribute('accept')
  t('A8. 文件选择器两个都收（JSON + xlsx）', /application\/json/.test(accept) && /xlsx|spreadsheetml/.test(accept), String(accept))
  t('A9. 零 pageerror', errs.length === 0, errs.join(' | '))

  /* ---------- B. 引导页里直接选 xlsx：要能建学期并落库 ---------- */
  console.log('\n[B] 引导页里选教务 xlsx')
  const xlsx = await makeEduXlsx()
  await page.locator('[data-ob-file]').setInputFiles({ name: '课表.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(xlsx) })
  await page.waitForTimeout(900)
  t('B1. 出现核对浮层', await page.locator('[data-edu-preview]').isVisible())
  t('B2. 解析出 2 门课', (await page.locator('[data-edu-row]').count()) === 2, String(await page.locator('[data-edu-row]').count()))
  t('B3. 出现「先确认学期起止」两个输入', await page.locator('[data-edu-needsem]').isVisible())
  const fm = await page.locator('[data-edu-first-monday]').inputValue()
  t('B4. 第一周周一已预填（非空日期）', /^\d{4}-\d{2}-\d{2}$/.test(fm), fm)
  /* 选定的开学日：明确不写死任何学校 —— 用输入框自己喂进去 */
  await page.locator('[data-edu-first-monday]').fill('2026-09-07')
  await page.locator('[data-edu-total-weeks]').fill('16')
  const confirmText = await page.locator('[data-edu-confirm]').innerText()
  t('B5. 按钮说的是「建学期并导入」而不是「替换现有课表」', confirmText.includes('建学期并导入'), JSON.stringify(confirmText))
  t('B6. 确认前一个字都没写盘', (await page.evaluate(() => localStorage.getItem('web2.data'))) === null)

  await page.locator('[data-edu-confirm]').click()   // 第一次＝亮出后果
  await page.waitForTimeout(200)
  const second = await page.locator('[data-edu-confirm]').innerText()
  t('B7. 第一次点后变成「再点一次」', /再点一次/.test(second), JSON.stringify(second))
  t('B8. 第一次点仍未写盘', (await page.evaluate(() => localStorage.getItem('web2.data'))) === null)
  await page.locator('[data-edu-confirm]').click()   // 第二次＝动手
  await page.waitForTimeout(900)

  const saved = await page.evaluate(() => localStorage.getItem('web2.data'))
  t('B9. 确认后 web2.data 已落盘', !!saved)
  if (saved) {
    const d = JSON.parse(saved)
    t('B10. 学期起始日 = 我们填的 2026-09-07', String(d.semester && d.semester.first_monday).slice(0, 10) === '2026-09-07', String(d.semester && d.semester.first_monday))
    t('B11. 总周数 = 16（落盘 doc 是 snake_case）', Number(d.semester && d.semester.total_weeks) === 16, String(d.semester && d.semester.total_weeks))
    const names = (d.schedules || []).filter((s) => s.type === 'course').map((s) => s.title)
    t('B12. 两门课都进去了', names.includes('高等数学') && names.includes('大学英语'), JSON.stringify(names))
  }
  t('B13. 引导层已自动关掉（直接进主界面）', !(await page.locator('[data-ob-step]').isVisible().catch(() => false)))
  t('B14. onboarded 标记已记', (await page.evaluate(() => localStorage.getItem('web2.onboarded'))) === '1')
  /* 课表页在平移容器里，永远在 DOM 里（inert 与否只看 tab）→ 用 nav 上的当前 tab 判，别用 isVisible */
  const activeTab = async (pg) => pg.evaluate(() => { const b = document.querySelector('nav button[data-active]'); return b ? (b.innerText || '').trim() : '' })
  t('B15. 落在了课表页（导航当前 tab = 周课表）', (await activeTab(page)).includes('周课表'), await activeTab(page))
  t('B16. 全程零 pageerror', errs.length === 0, errs.join(' | '))

  /* ---------- C. 老规矩不能破：设置页那条路照旧 ---------- */
  console.log('\n[C] 设置页进来的同一条路（不该被这一轮改动带坏）')
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const p2 = await ctx2.newPage()
  const errs2 = []
  p2.on('pageerror', (e) => errs2.push(e.message))
  await p2.addInitScript(() => { try { localStorage.setItem('web2.onboarded', '1') } catch (e) {} })
  await p2.goto(BASE, { waitUntil: 'domcontentloaded' })
  await p2.waitForTimeout(800)
  t('C1. 种标记后不再弹引导页', (await p2.locator('[data-ob-step]').count()) === 0)
  await p2.$eval('[data-nav="me"]', (el) => el.click())
  await p2.waitForTimeout(300)
  await p2.$eval('[data-me-entry="settings"]', (el) => el.click())
  await p2.waitForTimeout(400)
  t('C2. 设置里仍有「登录教务网抓课表」入口', (await p2.locator('[data-edu-login-open]').count()) >= 1)
  t('C3. 零 pageerror', errs2.length === 0, errs2.join(' | '))

  /* ---------- D. 中间那颗：点了要能开出登录浮层 ---------- */
  console.log('\n[D] 中间入口点开登录浮层')
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const p3 = await ctx3.newPage()
  const errs3 = []
  p3.on('pageerror', (e) => errs3.push(e.message))
  await p3.goto(BASE, { waitUntil: 'domcontentloaded' })
  await p3.waitForTimeout(800)
  await p3.locator('[data-ob-choice-edu]').click()
  await p3.waitForTimeout(600)
  t('D1. 登录浮层开出来了', await p3.locator('[data-edu-login-user]').isVisible().catch(() => false))
  t('D2. 引导层还在底下（没被顺带关掉）', await p3.locator('[data-ob-step]').isVisible().catch(() => false))
  await p3.locator('[data-edu-login-close]').click()
  await p3.waitForTimeout(400)
  t('D3. 关掉登录浮层后回到引导页（没有卡住）', await p3.locator('[data-ob-choice-edu]').isVisible().catch(() => false))
  t('D4. 零 pageerror', errs3.length === 0, errs3.join(' | '))
} finally {
  await browser.close()
}

console.log(`\n引导页三入口自检：${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
