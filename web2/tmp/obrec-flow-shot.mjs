/* 截图：三步流程实拍（第 2 步识别页含手动入口 / 第 3 步核对页）。
   输出用新文件名（shot2-*），避开旧 png 可能的占用。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const AI = { courses: [{ title: '高等数学', weekday: 1, startSec: 1, endSec: 2, weekRule: 'every', location: '教1-101', teacher: '张老师' }], notes: [] }
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await b.newContext({ viewport: { width: 390, height: 1000 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()
await p.addInitScript(`localStorage.setItem('web2.llm', '{"provider":"deepseek","key":"sk-test","model":"deepseek-flash"}')`)
await p.addInitScript(`window.fetch = (function (orig) {
  return function (url, init) {
    if (String(url).indexOf('api.deepseek.com') !== -1) {
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: ${JSON.stringify(JSON.stringify(AI))} } }] }) } });
    }
    return orig.apply(this, arguments);
  };
})(window.fetch);`)
await p.goto('http://127.0.0.1:4177/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(700)

// 第 2 步：识别页（默认 13 节摘要 + 手动入口）
await p.locator('text=直接填学期信息，自己加课').click()
await p.waitForTimeout(500)
await p.locator('button[data-monday="1"]').first().click()
await p.waitForTimeout(300)
await p.locator('[data-ob-goto-rec]').click()
await p.waitForTimeout(600)
await p.screenshot({ path: 'tmp/shot2-ob-step2.png' })

// 第 3 步：核对页（识别结果）
await p.locator('input[accept="image/*"]').setInputFiles('tmp/rec-sample.jpg')
await p.waitForTimeout(1000)
await p.screenshot({ path: 'tmp/shot2-ob-step3.png' })

await ctx.close()
await b.close()
console.log('saved tmp/shot2-ob-step2.png tmp/shot2-ob-step3.png')
