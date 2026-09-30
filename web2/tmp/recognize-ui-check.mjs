/* 课表识别全流程验证（引导页入口）：
   ① 无 Key → 就地提示去哪配（不弹文件选择）
   ② 有 Key + 返回非法 JSON → 就地报错，留在表单
   ③ 有 Key + 正常 → 确认页：条数/警告/时间预览/编辑/勾选/删除 → 导入 → 学期+课程落盘、进周视图
   假 fetch：只拦 api.deepseek.com，其他请求（vite 资源）放行。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}

const URL = 'http://127.0.0.1:4177/'
const IMG = 'D:/Document/Project/vibe-coding-project-web2/tmp/rec-sample.jpg'
const LLM_CFG = JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' })

/* 假 AI 结果：3 门课，其中「体育」节次 14–15 超出默认 13 节 → 应标红并跳过；
   另含一条无课程名的脏数据（应被 parseScheduleJson 丢掉并计 warning） */
const AI_COURSES = {
  courses: [
    { title: '高等数学', weekday: 1, startSec: 1, endSec: 2, weekRule: 'every', location: '教1-101', teacher: '张老师' },
    { title: '大学英语', weekday: 3, startSec: 3, endSec: 4, weekRule: 'odd', location: '外语楼203', teacher: '' },
    { title: '体育', weekday: 5, startSec: 14, endSec: 15, weekRule: 'every', location: '操场', teacher: '' },
    { title: '', weekday: 2, startSec: 5, endSec: 6, weekRule: 'every' },
  ],
  notes: ['第三周周四那门课字迹模糊'],
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

async function newPage({ llm, payload }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  if (llm) await page.addInitScript(`localStorage.setItem('web2.llm', ${JSON.stringify(LLM_CFG)})`)
  if (payload !== undefined) await page.addInitScript(fakeFetchScript(payload))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  return page
}
async function gotoForm(page) {
  await page.locator('text=直接填学期信息，自己加课').click()
  await page.waitForTimeout(400)
  await page.locator('[data-ob-start]').click() // 弹层月历选开学日（任意日期，内部归一到周一）
  await page.waitForTimeout(400)
  await page.locator('[data-cal-day]:not([data-cal-day=""])').nth(9).click()
  await page.waitForTimeout(150)
  await page.locator('button:has-text("确定")').click()
  await page.waitForTimeout(250)
  await page.locator('[data-ob-goto-rec]').click() // 三步流程：第 1 步 → 第 2 步识别页
  await page.waitForTimeout(400)
}

try {
  /* ---- ① 无 Key ---- */
  let page = await newPage({ llm: false })
  await gotoForm(page)
  const recBtn = page.locator('[data-ob-rec]')
  t('1a. 表单里有「拍课表识别」入口', await recBtn.isVisible())
  await recBtn.click()
  await page.waitForTimeout(300)
  t('1b. 无 Key → 就地提示（含课堂纪要路径）', await page.locator('text=还没配置 DeepSeek API Key').isVisible())
  t('1c. 失败后仍留在识别页（没跳确认页）', (await page.locator('[data-ob-step]').getAttribute('data-ob-step')) === '2')
  await page.context().close()

  /* ---- ② 有 Key + AI 返回非法 JSON ---- */
  page = await newPage({ llm: true, payload: '这不是 JSON' })
  await gotoForm(page)
  await page.locator('input[accept="image/*"]').setInputFiles(IMG)
  await page.waitForTimeout(900)
  t('2a. 非法 JSON → 就地报错', await page.locator('text=不是有效 JSON').isVisible())
  t('2b. 留在识别页（第 2 步），结果不丢', (await page.locator('[data-ob-step]').getAttribute('data-ob-step')) === '2' && await page.locator('[data-ob-rec]').isVisible())
  await page.context().close()

  /* ---- ③ 正常识别 → 确认页 → 导入 ---- */
  page = await newPage({ llm: true, payload: JSON.stringify(AI_COURSES) })
  await gotoForm(page)
  await page.locator('input[accept="image/*"]').setInputFiles(IMG)
  await page.waitForTimeout(900)

  t('3a. 进入确认页', await page.locator('text=核对后导入').isVisible())
  const items = page.locator('[data-rec-item]')
  t('3b. 脏数据（无课程名）被丢弃 → 只剩 3 条', (await items.count()) === 3)
  t('3c. 警告区显示丢弃/回落提示', (await page.locator('text=丢弃一条没有课程名的记录').count()) > 0)
  t('3d. 课程名已带入', await items.first().locator('input').first().inputValue() === '高等数学')
  t('3e. 节次 → 时间预览（本地节次表换算）', await page.locator('text=上课时间 08:00–09:40').isVisible())
  t('3f. 超界节次标红提示', await page.locator('text=节次超出当前节次表').isVisible())
  t('3g. 图片存疑点透传', await page.locator('text=字迹模糊').isVisible())
  t('3h. 默认全选 3 门', await page.locator('text=导入选中的 3 门课，开始使用').isVisible())

  // 编辑：改课程名 + 星期
  const firstTitle = items.first().locator('input').first()
  await firstTitle.fill('高等数学（改）')
  await items.first().locator('select').first().selectOption('3') // 星期改周三
  await page.waitForTimeout(200)
  t('3i. 改名生效', (await firstTitle.inputValue()) === '高等数学（改）')

  // 勾选：取消第三门 → 计数变 2
  await items.nth(2).locator('button[aria-label="取消选择这门课"]').click()
  await page.waitForTimeout(200)
  t('3j. 取消勾选 → 计数 2', await page.locator('text=导入选中的 2 门课，开始使用').isVisible())

  // 删除：删掉第二门 → 剩 2 条
  await items.nth(1).locator('button[aria-label="删除这条识别结果"]').click()
  await page.waitForTimeout(200)
  t('3k. 删除一条 → 剩 2 条', (await items.count()) === 2)

  // 返回识别页再回来：数据保留
  await page.locator('[data-rec-back-rec]').click()
  await page.waitForTimeout(400)
  t('3l. 返回后回到识别页（选图按钮在，且提示已有结果）', (await page.locator('[data-ob-step]').getAttribute('data-ob-step')) === '2' && await page.locator('[data-ob-rec]').isVisible())
  t('3l2. 识别页提示「已有识别结果」', await page.locator('[data-ob-rec-done]').isVisible())
  await page.locator('input[accept="image/*"]').setInputFiles(IMG)
  await page.waitForTimeout(900)
  t('3m. 重新识别回到确认页（结果按新一次识别重置）', await page.locator('text=核对后导入').isVisible())

  // 导入
  await page.locator('text=开始使用').first().click()
  await page.waitForTimeout(700)
  t('3n. 引导页已关闭', !(await page.locator('text=欢迎来到日程助手').isVisible().catch(() => false)))
  const onboarded = await page.evaluate(() => localStorage.getItem('web2.onboarded'))
  t('3o. onboarded 标记已记', onboarded === '1')
  const added = await page.evaluate(() => localStorage.getItem('web2.added') || '')
  const sem = await page.evaluate(() => localStorage.getItem('web2.data') || '')
  t('3p. 课程落盘到 web2.added（自加课表）', added.includes('高等数学') && added.includes('大学英语'))
  t('3q. 节次超界的课被跳过（没入库）', !added.includes('体育'))
  t('3s. 学期信息已建（web2.data 含 semester 与开学日）', sem.includes('"semester"') && sem.includes('first_monday'))
  const weekTitle = await page.evaluate(() =>
    [...document.querySelectorAll('*')].some((el) => el.textContent && el.textContent.includes('高等数学'))
  )
  t('3r. 周视图能看到导入的课', weekTitle)
  await page.context().close()
} catch (e) {
  console.log('ERROR:', e.message)
  results.push(['无异常跑完', false])
}

await browser.close()
const fails = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
