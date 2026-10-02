/* 「清理重复课程」按钮的条件显示（2026-10-01 板块 D）：
   无重复 → 入口完全不出现；有重复 → 显示并点名数量；一键清理后入口消失。
   服务：python -m http.server 4177 --directory dist */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, detail) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  <- ' + String(detail)))
}
const URL = 'http://127.0.0.1:4177/'
const COURSE = (n) => JSON.stringify({ id: 'a' + n, type: 'course', added: true, weekday: 1, name: '高等数学', start: '08:00', end: '08:45', week_rule: 'every' })

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

async function openMine(seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.split('\n')[0]))
  await page.addInitScript(seed)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.locator('text=我的').last().click()
  await page.waitForTimeout(400)
  /* 2026-10-02 减法：「清理重复课程」收进了默认收起的「设置」折叠区 → 先展开 */
  if ((await page.locator('[data-settings-body]').count()) === 0) {
    await page.locator('[data-settings-toggle]').click()
    await page.waitForTimeout(350)
  }
  return page
}

/* 场景 1：无重复 → 不显示 */
{
  const page = await openMine(`
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.added', '[' + ${JSON.stringify(COURSE(1))} + ']')
  `)
  t('D1. 无重复时入口不显示', (await page.locator('[data-dedup-entry]').count()) === 0)
  await page.context().close()
}

/* 场景 2：有重复 → 显示 + 点名数量 */
{
  const page = await openMine(`
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.added', '[' + ${JSON.stringify(COURSE(1))} + ',' + ${JSON.stringify(COURSE(2))} + ']')
  `)
  t('D2. 有重复时入口显示', (await page.locator('[data-dedup-entry]').count()) === 1)
  const tip = (await page.locator('[data-dedup-entry]').evaluate((el) => el.textContent)).replace(/\s+/g, '')
  t('D3. 入口点名重复数量（1 门）', tip.includes('1门重复'), tip)
  await page.locator('[data-dedup-entry] button').evaluate((el) => el.click())
  await page.waitForTimeout(500)
  const after = await page.evaluate(() => localStorage.getItem('web2.added') || '')
  t('D4. 一键清理后 web2.added 只剩 1 条', JSON.parse(after).length === 1, after.slice(0, 100))
  t('D5. 提示已清理', (await page.locator('text=已清理 1 门重复课程').count()) === 1)
  t('D6. 清理后入口消失', (await page.locator('[data-dedup-entry]').count()) === 0)
  await page.context().close()
}

await browser.close()
const fail = results.filter((r) => !r[1]).length
console.log(`\n=== ${results.length - fail}/${results.length} 通过 ===`)
process.exit(fail ? 1 : 0)
