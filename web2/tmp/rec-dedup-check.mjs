/* 识别导入去重验证：同一批识别结果里出现两门完全相同的课，只应导入一次 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}

const URL = 'http://127.0.0.1:4177/'
const LLM_CFG = JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' })

const AI_DUP = {
  courses: [
    { title: '高等数学', weekday: 1, startSec: 1, endSec: 2, weekRule: 'every', location: '教1-101', teacher: '张老师' },
    { title: '高等数学', weekday: 1, startSec: 1, endSec: 2, weekRule: 'every', location: '教1-101', teacher: '张老师' }, // 重复
    { title: '大学英语', weekday: 3, startSec: 3, endSec: 4, weekRule: 'odd', location: '外语楼203', teacher: '' },
    { title: '体育', weekday: 5, startSec: 14, endSec: 15, weekRule: 'every', location: '操场', teacher: '' },
    { title: '', weekday: 2, startSec: 5, endSec: 6, weekRule: 'every' }, // 无课名，parser 丢掉
  ],
  notes: [],
}

function fakeFetchScript(payloadText) {
  return `window.fetch = (function (orig) {
    return function (url, init) {
      if (String(url).indexOf('api.deepseek.com') !== -1) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: ${JSON.stringify(payloadText)} } }] }) } });
      }
      return orig.apply(this, arguments);
    };
  })(window.fetch);`
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  page.on('console', (msg) => console.log('CONSOLE:', msg.text()))
  await page.addInitScript(`localStorage.setItem('web2.llm', ${JSON.stringify(LLM_CFG)})`)
  await page.addInitScript(fakeFetchScript(JSON.stringify(AI_DUP)))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)

  // 走引导页导入
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
  console.log('step after gotoForm:', await page.locator('[data-ob-step]').getAttribute('data-ob-step'))

  // 进入识别页，直接选图（假 fetch 会立即返回结果）
  await page.locator('input[accept="image/*"]').setInputFiles('D:/Document/Project/vibe-coding-project/web2/tmp/rec-sample.jpg')
  await page.waitForTimeout(900)
  console.log('url after pick:', page.url())
  console.log('text after pick:', await page.locator('body').innerText().then(t => t.replace(/\s+/g, ' ').slice(0, 200)))

  await page.waitForSelector('[data-rec-import]', { timeout: 3000 })
  await page.waitForTimeout(300)

  t('D1. 预览网格里重复的两门课显示为重叠标红', (await page.locator('[data-rec-conflict]').count()) >= 1)

  await page.locator('[data-rec-import]').click()
  await page.waitForTimeout(900)

  const toast = await page.locator('[data-app-toast]').textContent().catch(() => '')
  t('D2. 导入提示含「重复已跳过 1」', toast.includes('重复已跳过') && toast.includes('1'), toast)
  t('D3. 导入提示含「新增 2 门课」', /新增\s*2\s*门课/.test(toast), toast)
  t('D4. 导入提示含「1 门因课程名没填或节次超出被跳过」', /1\s*门因课程名没填或节次超出被跳过/.test(toast), toast)

  const data = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.data') || '{}'))
  const courses = (data.schedules || []).filter((s) => s.type === 'course')
  t('D5. 最终落盘只有 2 门课', courses.length === 2, String(courses.length))
} catch (e) {
  console.log('SCRIPT ERROR:', e && e.message)
  results.push(['脚本异常', false])
}
await browser.close()

const fail = results.filter(([, ok]) => !ok)
console.log(`\n=== 识别导入去重：${results.length - fail.length}/${results.length} 通过 ===`)
if (fail.length) console.log('失败项：' + fail.map((x) => x[0]).join(' / '))
process.exit(fail.length ? 1 : 0)
