/* 截图：下拉展开态 + 删除确认层（给用户看效果用） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage()
await page.addInitScript(() => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.lectures', JSON.stringify([
    { id: 'lec_d', schedule_id: null, title: '高数三班 · 录音', status: 'recording', started_at: '2026-09-28T09:00:00.000Z', ended_at: '2026-09-28T09:40:00.000Z', duration_ms: 2400000, clip_count: 0, clips: [], created_at: '2026-09-28T09:00:00.000Z', updated_at: '2026-09-28T09:40:00.000Z', transcript: null }
  ]))
  localStorage.setItem('web2.llm', JSON.stringify({ provider: 'deepseek', key: '', model: 'deepseek-flash' }))
})
await page.goto('http://127.0.0.1:4177/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await page.locator('nav button').nth(2).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /课堂纪要/ }).click()
await page.waitForTimeout(200)
await page.locator('[data-dd="model"] button').click()
await page.waitForTimeout(400)
await page.screenshot({ path: 'tmp/shot-dropdown-open.png' })
await page.locator('[data-dd="model"] ul button', { hasText: 'deepseek-v4-pro' }).click()
await page.waitForTimeout(200)
const row = page.locator('li', { hasText: '高数三班 · 录音' })
await row.locator('span').first().dispatchEvent('pointerdown')
await page.waitForTimeout(800)
await page.waitForTimeout(300)
await page.screenshot({ path: 'tmp/shot-delete-sheet.png' })
await browser.close()
console.log('shots done')
