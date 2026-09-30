/* Day 12 余力：概念版待办状态筛选交互测试（frontend-guidelines 第二次调用）。
   mock 自带 4 条待办（1 条已完成），种子只需 onboarded 标记；覆盖层 deleted 清空用于「无待办隐藏 chips」。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}

const URL = 'http://127.0.0.1:4177/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
await page.addInitScript(() => localStorage.setItem('web2.onboarded', '1'))
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

const section = page.locator('section').filter({ has: page.locator('h2', { hasText: '待办' }) }).first()
const chips = section.locator('[role="group"][aria-label="待办状态筛选"] button')
const rows = section.locator('.divide-y > div')
const chip = (label) => chips.filter({ hasText: label })

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)

  t('1. 初态显示 4 条待办', (await rows.count()) === 4)
  t('2. 筛选 chips 出现且为 3 个', (await chips.count()) === 3)
  t('3. 默认「全部」激活', (await chip('全部').getAttribute('aria-pressed')) === 'true')

  /* 有结果：已完成 → 只剩 1 条带删除线 */
  await chip('已完成').click()
  await page.waitForTimeout(200)
  t('4. 有结果：已完成筛出 1 条', (await rows.count()) === 1)
  t('5. 筛出的是已完成那条（含删除线样式）', ((await rows.first().locator('span').nth(0).getAttribute('class')) || '').includes('line-through'))
  t('6. 激活态切到「已完成」', (await chip('已完成').getAttribute('aria-pressed')) === 'true' && (await chip('已完成').getAttribute('class')).includes('font-semibold'))

  /* 未完成 → 3 条 */
  await chip('未完成').click()
  await page.waitForTimeout(200)
  t('7. 未完成筛出 3 条', (await rows.count()) === 3)

  /* 清空恢复：全部 → 4 条 */
  await chip('全部').click()
  await page.waitForTimeout(200)
  t('8. 清空恢复：回到 4 条', (await rows.count()) === 4)
  t('9. 激活态回到「全部」', (await chip('全部').getAttribute('aria-pressed')) === 'true')

  /* 无结果：已完成下把唯一一条撤销 → 空态文案 + chips 仍在 */
  await chip('已完成').click()
  await page.waitForTimeout(200)
  await rows.first().locator('button').click()
  await page.waitForTimeout(300)
  t('10. 无结果：出现「没有已完成的待办」', (await section.locator('p:has-text("没有已完成的待办")').count()) === 1)
  t('11. 无结果时 chips 仍可见（能切回去）', (await chips.count()) === 3)

  /* 切回全部恢复，撤销结果如实渲染 */
  await chip('全部').click()
  await page.waitForTimeout(200)
  t('12. 切回全部：4 条都在', (await rows.count()) === 4)
  t('13. 撤销后无删除线行', (await section.locator('.line-through').count()) === 0)

  /* 筛选态跨打勾重渲染保持：未完成下打勾一条，仍留在「未完成」 */
  await chip('未完成').click()
  await page.waitForTimeout(200)
  await rows.filter({ hasText: '高数作业' }).locator('button').click()
  await page.waitForTimeout(300)
  t('14. 重渲染后筛选态保持', (await chip('未完成').getAttribute('aria-pressed')) === 'true')
  /* 注意：第 10 步已把英语口语撤销成未完成，此刻未完成 = 4 条，打勾高数后剩 3 条 */
  t('15. 打勾后未完成剩 3 条', (await rows.count()) === 3)

  /* 全部待办被删光 → chips 不出现（无感易用）；用覆盖层 deleted 清空 mock */
  const p2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  await p2.addInitScript(() => {
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.todos', JSON.stringify({ added: [], edited: {}, deleted: [1, 2, 3, 4] }))
  })
  await p2.goto(URL, { waitUntil: 'domcontentloaded' })
  await p2.waitForTimeout(600)
  const s2 = p2.locator('section').filter({ has: p2.locator('h2', { hasText: '待办' }) }).first()
  t('16. 无待办时不出现筛选 chips', (await s2.locator('[role="group"][aria-label="待办状态筛选"]').count()) === 0)
  t('17. 空态文案正常', (await s2.locator('p:has-text("没有待办，轻松自在～")').count()) === 1)
  await p2.close()

  /* 桌面宽度冒烟 */
  const p3 = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  await p3.addInitScript(() => localStorage.setItem('web2.onboarded', '1'))
  await p3.goto(URL, { waitUntil: 'domcontentloaded' })
  await p3.waitForTimeout(600)
  await p3.locator('[role="group"][aria-label="待办状态筛选"] button').filter({ hasText: '已完成' }).click()
  await p3.waitForTimeout(200)
  t('18. 桌面宽度：筛选照常工作（1 条）', (await p3.locator('section').filter({ has: p3.locator('h2', { hasText: '待办' }) }).first().locator('.divide-y > div').count()) === 1)
  await p3.close()

  t('19. 全程无页面报错', errors.length === 0)
} catch (e) {
  t('测试执行异常：' + e.message, false)
} finally {
  await browser.close()
}

const fails = results.filter((r) => !r[1])
console.log(`\n结果：${results.length - fails.length} 过，${fails.length} 挂`)
process.exit(fails.length ? 1 : 0)
