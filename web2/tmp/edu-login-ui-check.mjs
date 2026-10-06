/* P12b 界面检查（登录教务网浮层，浏览器里能验的那部分）
   验的是**界面本身**：入口能开、字段都在、网页里如实说「这个环境不行」、空输入会拦、
   显示/隐藏密码、记住开关能切、零 pageerror。
   ⚠️ 真的登录 + 真的抓课表**这里验不了**（浏览器会被跨域挡，且没有手机的原生网络），
      那一步只能装到手机上验 —— 本脚本**不假装**它过了。

   跑法：先起 4177 静态服务，再 node tmp/edu-login-ui-check.mjs
   产物：tmp/edu-login-1-entry.png / tmp/edu-login-2-sheet.png */

let pass = 0
let fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const logs = []
page.on('console', (m) => {
  if (m.type() === 'error') logs.push(m.text().slice(0, 200))
})

const seed = {
  app: 'sched',
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 16 },
  schedules: [{ id: 'c1', type: 'course', title: '结构力学Ⅰ', weekday: 1, start_time: '08:00', duration: 95, week_rule: 'every', semester_id: 'sem1' }],
  todos: [],
}
await page.addInitScript(
  ([doc]) => {
    localStorage.setItem('web2.data', JSON.stringify(doc))
    localStorage.setItem('web2.onboarded', '1')
    localStorage.removeItem('web2.eduAccount')
  },
  [seed],
)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)

/* 我的 → 设置 */
await page.waitForSelector('[data-nav="me"]', { timeout: 8000 })
await page.$eval('[data-nav="me"]', (el) => el.click())
await page.waitForSelector('[data-me-entry="settings"]', { state: 'visible', timeout: 8000 })
await page.$eval('[data-me-entry="settings"]', (el) => el.click())
await page.waitForSelector('[data-edu-login-open]', { state: 'visible', timeout: 8000 })
t('1. 设置页出现「登录教务网抓课表」入口', true)
await page.screenshot({ path: 'tmp/edu-login-1-entry.png' })

/* 打开浮层 */
await page.$eval('[data-edu-login-open]', (el) => el.click())
await page.waitForSelector('[data-edu-login]', { state: 'visible', timeout: 5000 })
await page.waitForTimeout(300)
t('2. 浮层打开了', (await page.locator('[data-edu-login]').count()) === 1)
t('3. 账号 / 密码 / 显示开关 / 记住开关 / 学年 / 学期 / 抓取按钮 都在',
  (await page.locator('[data-edu-login-user]').count()) === 1
  && (await page.locator('[data-edu-login-pw]').count()) === 1
  && (await page.locator('[data-edu-login-showpw]').count()) === 1
  && (await page.locator('[data-edu-login-remember]').count()) === 1
  && (await page.locator('[data-edu-login-xnm]').count()) === 1
  && (await page.locator('[data-edu-login-xqm]').count()) === 1
  && (await page.locator('[data-edu-login-go]').count()) === 1)
t('4. 学年/学期按本机学期名预填（2026-2027 秋冬 → 2026 + 秋冬码 3）',
  (await page.inputValue('[data-edu-login-xnm]')) === '2026' && (await page.inputValue('[data-edu-login-xqm]')) === '3',
  (await page.inputValue('[data-edu-login-xnm]')) + ' / ' + (await page.inputValue('[data-edu-login-xqm]')))
t('5. 浏览器里**如实**提示「这个环境不行」（不装成能用）', (await page.locator('[data-edu-login-noweb]').count()) === 1)
t('6. 密码默认是隐藏的', (await page.getAttribute('[data-edu-login-pw]', 'type')) === 'password')
/* 「连其他学期一起留」默认必须是**关**的：服务器会把整年都返回来，默认不筛就会混进整年的课
   （2026-10-06 真机踩到） */
t('6c. 「连其他学期一起留」默认关着（默认按所选学期本地筛一遍）',
  (await page.locator('[data-edu-login-allterms]').count()) === 1
  && (await page.$eval('[data-edu-login-allterms] .relative', (el) => el.className)).indexOf('bg-soft-2') >= 0,
  await page.$eval('[data-edu-login-allterms] .relative', (el) => el.className).catch(() => 'no-el'))
/* 回归守卫：没有存档时「记住账号密码」必须默认**开着**（曾经因 sanitize 把 remember 归成 false
   而默认关掉 —— 截图里发现的） */
t('6b. 「记住账号密码」默认是开着的（用户选的「①乙」就该默认记住）',
  (await page.$eval('[data-edu-login-remember] .relative', (el) => el.className)).indexOf('bg-primary-500') >= 0,
  await page.$eval('[data-edu-login-remember] .relative', (el) => el.className))
await page.screenshot({ path: 'tmp/edu-login-2-sheet.png' })

/* 空输入要拦住 */
await page.$eval('[data-edu-login-go]', (el) => el.click())
await page.waitForTimeout(200)
t('7. 空着点「抓取课表」→ 提示要填账号密码',
  /账号和密码都要填/.test(await page.locator('[data-edu-login-msg]').innerText()),
  (await page.locator('[data-edu-login-msg]').innerText()).replace(/\s+/g, ' '))

/* 填上之后：浏览器里必须明确报「环境不支持」，而不是假装去登录 */
await page.fill('[data-edu-login-user]', '0000000000')
await page.fill('[data-edu-login-pw]', 'not-a-real-password')
await page.$eval('[data-edu-login-showpw]', (el) => el.click())
t('8. 「显示」能把密码切成明文（再点回隐藏）',
  (await page.getAttribute('[data-edu-login-pw]', 'type')) === 'text')
await page.$eval('[data-edu-login-showpw]', (el) => el.click())
t('8b. 再点一次变回隐藏', (await page.getAttribute('[data-edu-login-pw]', 'type')) === 'password')

await page.$eval('[data-edu-login-go]', (el) => el.click())
await page.waitForTimeout(200)
t('9. 浏览器里点抓取 → 明确说「装到手机 App 里才生效」，**不假装成功**',
  /不能直连教务网/.test(await page.locator('[data-edu-login-msg]').innerText()),
  (await page.locator('[data-edu-login-msg]').innerText()).replace(/\s+/g, ' '))

/* 记住开关可切 */
const beforeCls = await page.$eval('[data-edu-login-remember] .relative', (el) => el.className)
await page.$eval('[data-edu-login-remember]', (el) => el.click())
await page.waitForTimeout(150)
const afterCls = await page.$eval('[data-edu-login-remember] .relative', (el) => el.className)
t('10. 「记住账号密码」开关能切换（视觉状态真的变了）', beforeCls !== afterCls, beforeCls + ' → ' + afterCls)

/* 关闭 */
await page.$eval('[data-edu-login-close]', (el) => el.click())
await page.waitForTimeout(350)
t('11. 点关闭浮层收起', (await page.locator('[data-edu-login]').count()) === 0)
t('12. 全程零 pageerror / 零 console error', errors.length === 0 && logs.length === 0, JSON.stringify([errors.slice(0, 2), logs.slice(0, 2)]))

await browser.close()
console.log(`\n教务直连界面检查：${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
