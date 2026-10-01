/* 截图：识别跨段课 → 确认页顶部的「已修正」提示 + 钳后的课卡（板块 B 效果图） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = 'http://127.0.0.1:4177/'
const IMG = 'D:/Document/Project/vibe-coding-project/web2/tmp/rec-sample.jpg'
const PAYLOAD = JSON.stringify({
  choices: [{ message: { content: JSON.stringify({ courses: [
    { title: '军事理论', weekday: 2, startSec: 1, endSec: 8, weekRule: 'every', location: '', teacher: '' },
    { title: '高等数学', weekday: 1, startSec: 1, endSec: 2, weekRule: 'every', location: '教1-101', teacher: '张老师' },
    { title: '大学英语', weekday: 3, startSec: 6, endSec: 7, weekRule: 'odd', location: '外语楼203', teacher: '' },
    { title: '程序设计', weekday: 4, startSec: 11, endSec: 13, weekRule: 'even', location: '机房3', teacher: '李老师' },
  ] }) } }],
})
const LLM = JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' })

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
await page.addInitScript(`localStorage.setItem('web2.llm', ${JSON.stringify(LLM)})`)
await page.addInitScript(`window.fetch = (function (orig) { return function (url) {
  if (String(url).indexOf('api.deepseek.com') !== -1) {
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(JSON.parse(${JSON.stringify(PAYLOAD)})) } })
  }
  return orig.apply(this, arguments)
} })(window.fetch)`)
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
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
await page.waitForTimeout(1000)
await page.screenshot({ path: 'tmp/shot-rec-clamp.png' })
console.log('done')
await browser.close()
