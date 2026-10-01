/* 核对页整周预览：真实效果截图（给用户确认手感用）。
   跑法：先起 dev server（4177）再 node tmp/shot-rec-preview.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = 'http://127.0.0.1:4177/'
const IMG = 'D:/Document/Project/vibe-coding-project/web2/tmp/rec-sample.jpg'
const OUT = 'D:/Document/Project/vibe-coding-project/web2/tmp/'
const LLM_CFG = JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' })

const AI = {
  courses: [
    { title: '高等数学 A', weekday: 1, startSec: 1, endSec: 2, weekRule: 'every', location: '教3-201' },
    { title: '大学英语', weekday: 1, startSec: 3, endSec: 4, weekRule: 'every', location: '外语楼105' },
    { title: '线性代数', weekday: 2, startSec: 1, endSec: 2, weekRule: 'every', location: '教3-108' },
    { title: '数据结构', weekday: 2, startSec: 3, endSec: 4, weekRule: 'every', location: '信工楼401' },
    { title: '大学物理', weekday: 3, startSec: 3, endSec: 4, weekRule: 'every', location: '教2-305' },
    { title: '程序设计实验', weekday: 3, startSec: 3, endSec: 4, weekRule: 'every', location: '信工楼302' },
    { title: '体育（篮球）', weekday: 5, startSec: 3, endSec: 4, weekRule: 'every', location: '体育馆' },
    { title: '形势与政策', weekday: 3, startSec: 11, endSec: 13, weekRule: 'every', location: '线上' },
  ],
  notes: [],
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript(`localStorage.setItem('web2.llm', ${JSON.stringify(LLM_CFG)})`)
await page.addInitScript(`window.fetch = (function (orig) {
  return function (url, init) {
    if (String(url).indexOf('api.deepseek.com') !== -1) {
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: ${JSON.stringify(JSON.stringify(AI))} } }] }) } });
    }
    return orig.apply(this, arguments);
  };
})(window.fetch);`)
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)

/* 走真实路径进核对页 */
await page.locator('text=直接填学期信息，自己加课').click()
await page.waitForTimeout(400)
await page.locator('[data-ob-start]').click()
await page.waitForTimeout(400)
await page.locator('button[aria-label="上个月"]').click()
  await page.waitForTimeout(250)
  await page.locator('[data-cal-ok="1"]').first().click()
await page.waitForTimeout(150)
await page.locator('button:has-text("确定")').click()
await page.waitForTimeout(250)
await page.locator('[data-ob-goto-rec]').click()
await page.waitForTimeout(400)
await page.locator('input[accept="image/*"]').setInputFiles(IMG)
await page.waitForTimeout(1200)

await page.screenshot({ path: OUT + 'shot-rec-preview-top.png' })
console.log('shot-rec-preview-top.png')

/* 下滑到逐条卡片 */
await page.locator('[data-rec-item]').first().scrollIntoViewIfNeeded()
await page.waitForTimeout(400)
await page.screenshot({ path: OUT + 'shot-rec-preview-cards.png' })
console.log('shot-rec-preview-cards.png')

/* 点空格子（周四 第 6 节）→ 加课弹层 */
await page.locator('[data-rcell="4-5"]').scrollIntoViewIfNeeded()
await page.waitForTimeout(200)
await page.locator('[data-rcell="4-5"]').click()
await page.waitForTimeout(500)
await page.locator('[data-cell-title]').fill('马克思主义基本原理')
await page.locator('[data-cell-place]').fill('文科楼 210')
await page.waitForTimeout(200)
await page.screenshot({ path: OUT + 'shot-rec-preview-add.png' })
console.log('shot-rec-preview-add.png')

/* 关掉弹层 → 点已有课块 → 改课弹层（展开位置与节次） */
await page.locator('[data-sheet-cell] button:has-text("取消")').click()
await page.waitForTimeout(400)
await page.locator('[data-rcourse]:has-text("大学物理")').scrollIntoViewIfNeeded()
await page.waitForTimeout(200)
await page.locator('[data-rcourse]:has-text("大学物理")').click()
await page.waitForTimeout(500)
await page.locator('[data-cell-more]').click()
await page.waitForTimeout(350)
await page.screenshot({ path: OUT + 'shot-rec-preview-edit.png' })
console.log('shot-rec-preview-edit.png')

await browser.close()
