/* v1.11 UI 验证：自建下拉（纪要服务/模型）+ 长按删除录音场次。
   坑位继承：三页在 translateX 平移层里，定位先切「我的」；场次列表倒序；
   浏览器环境无录音插件，删除走「无文件」分支（deleteClipFile 不应被调用）。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}
const ok = () => results.every((r) => r[1])
const failed = () => results.filter((r) => !r[1]).map((r) => r[0])

const seed = /* js */ `
localStorage.setItem('web2.lectures', JSON.stringify([
  { id: 'lec_d', schedule_id: null, title: '长按删除我', status: 'recording', started_at: '2026-09-28T09:00:00.000Z', ended_at: '2026-09-28T09:40:00.000Z', duration_ms: 2400000, clip_count: 0, clips: [], created_at: '2026-09-28T09:00:00.000Z', updated_at: '2026-09-28T09:40:00.000Z', transcript: null }
]))
localStorage.setItem('web2.llm', JSON.stringify({ provider: '', key: '', model: '' }))
localStorage.setItem('web2.onboarded', '1')`

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(seed)
  await page.goto('http://127.0.0.1:4177/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.locator('nav button').nth(2).click() // 我的
  await page.waitForTimeout(400)

  const row = page.locator('li', { hasText: '长按删除我' })

  // ---- A. 自建下拉 ----
  await page.getByRole('button', { name: /课堂纪要/ }).click() // 展开设置区
  await page.waitForTimeout(200)
  t('A1. 纪要服务触发器显示「未选择」', (await page.locator('[data-dd="provider"] button').innerText()).trim() === '未选择')

  await page.locator('[data-dd="provider"] button').click()
  await page.waitForTimeout(300)
  t('A2. 展开后有 3 个选项', (await page.locator('[data-dd="provider"] ul button').count()) === 3)

  await page.locator('[data-dd="provider"] ul button', { hasText: 'DeepSeek（自己的 API Key）' }).click()
  await page.waitForTimeout(300)
  t('A3. 选中后触发器文案更新', (await page.locator('[data-dd="provider"] button').innerText()).includes('DeepSeek'))
  const saved1 = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.llm')).provider)
  t('A4. 选完即落库 provider=deepseek', saved1 === 'deepseek')

  await page.locator('[data-dd="model"] button').click()
  await page.waitForTimeout(300)
  t('A5. 模型下拉 2 档', (await page.locator('[data-dd="model"] ul button').count()) === 2)
  await page.locator('[data-dd="model"] ul button', { hasText: 'deepseek-v4-pro' }).click()
  await page.waitForTimeout(300)
  const saved2 = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.llm')).model)
  t('A6. 模型落库 deepseek-v4-pro', saved2 === 'deepseek-v4-pro')

  // 外点关闭：再展开，点设置区标题（面板外）
  await page.locator('[data-dd="model"] button').click()
  await page.waitForTimeout(200)
  await page.getByText('课堂纪要', { exact: true }).first().click()
  await page.waitForTimeout(200)
  t('A7. 点外面收起面板', (await page.locator('[data-dd="model"] ul').count()) === 0)

  // ---- B. 长按删除 ----
  // 短按不触发
  await row.locator('span').first().dispatchEvent('pointerdown')
  await page.waitForTimeout(120)
  await row.locator('span').first().dispatchEvent('pointerup')
  await page.waitForTimeout(600)
  t('B1. 短按不弹删除层', (await page.getByText('删除这场录音？').count()) === 0)

  // 长按 500ms 触发
  await row.locator('span').first().dispatchEvent('pointerdown')
  await page.waitForTimeout(800)
  t('B2. 长按后弹确认层', (await page.getByText('删除这场录音？').count()) === 1)
  t('B3. 确认层带场次标题', (await page.getByText(/「长按删除我」/).count()) === 1)

  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.waitForTimeout(400)
  t('B4. 取消后场次还在', (await row.count()) === 1)

  // 长按 → 删除
  await row.locator('span').first().dispatchEvent('pointerdown')
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.waitForTimeout(500)
  t('B5. 确认后场次消失', (await row.count()) === 0)
  const left = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.lectures')).length)
  t('B6. 落库同步删除（0 条）', left === 0)
  t('B7. 就近提示已删除', (await page.getByText(/已删除「长按删除我」/).count()) === 1)

  t('B8. 全程无 pageerror', errors.length === 0)
  if (errors.length) console.log('PAGEERROR:', errors.join(' | '))
} finally {
  await browser.close()
}
console.log(ok() ? 'ALL PASS (' + results.length + ')' : 'FAILED: ' + failed().join(' / '))
process.exit(ok() ? 0 : 1)
