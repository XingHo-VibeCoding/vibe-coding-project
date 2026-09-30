/* 课表识别「三步流程」验证（Day 14 重构后）：
   第 1 步 = 三项（开学时间 / 周数滚轮 / 课程时间设置入口）+ 二级页（单节时长/课间滚轮 + 上午/下午/晚上三块）
   → 第 2 步 识别课表（页内显示「本次换算用的节次表」摘要）→ 第 3 步 核对导入。
   假 fetch：只拦 api.deepseek.com，其余放行。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}

const URL = 'http://127.0.0.1:4177/'
const IMG = 'D:/Document/Project/vibe-coding-project/web2/tmp/rec-sample.jpg'
const LLM_CFG = JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' })

const AI_COURSES = {
  courses: [
    { title: '高等数学', weekday: 1, startSec: 1, endSec: 2, weekRule: 'every', location: '教1-101', teacher: '张老师' },
  ],
  notes: [],
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})

async function newPage(payloadText) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.addInitScript(`localStorage.setItem('web2.llm', ${JSON.stringify(LLM_CFG)})`)
  if (payloadText !== undefined) {
    await page.addInitScript(`window.fetch = (function (orig) {
      return function (url, init) {
        if (String(url).indexOf('api.deepseek.com') !== -1) {
          return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: ${JSON.stringify(payloadText)} } }] }) } });
        }
        return orig.apply(this, arguments);
      };
    })(window.fetch);`)
  }
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  return page
}
async function toForm(page) {
  await page.locator('text=直接填学期信息，自己加课').click()
  await page.waitForTimeout(400)
}
/* 弹层月历选一个开学日（任意日期都行，内部归一到所在周周一） */
async function pickStart(page) {
  await page.locator('[data-ob-start]').click()
  await page.waitForTimeout(400)
  await page.locator('[data-cal-day]:not([data-cal-day=""])').nth(9).click()
  await page.waitForTimeout(150)
  await page.locator('button:has-text("确定")').click()
  await page.waitForTimeout(250)
}
const stepOf = (page) => page.locator('[data-ob-step]').getAttribute('data-ob-step')

try {
  /* ---- A. 第 1 页三项骨架 + 校验 ---- */
  let page = await newPage(JSON.stringify(AI_COURSES))
  await toForm(page)
  t('A1. 进表单即第 1 步', (await stepOf(page)) === '1')
  t('A2. 步骤条显示三步', (await page.locator('[data-step-item]').count()) === 3)
  t('A3. 当前步在步骤条上高亮', (await page.locator('[data-step-item="1"]').getAttribute('aria-current')) === 'step')
  t('A3b. 第 1 页只有三项入口', (await page.locator('[data-ob-start]').isVisible()) && (await page.locator('[data-ob-weeks]').isVisible()) && (await page.locator('[data-ob-time]').isVisible()))

  // 还没选开学时间：点下一步应被拦住并就地报错
  await page.locator('[data-ob-goto-rec]').click()
  await page.waitForTimeout(300)
  t('A4. 没选开学时间 → 拦住不跳步', (await stepOf(page)) === '1')
  t('A5. 就地报错（先选好开学时间）', await page.locator('text=先选好开学时间').first().isVisible())
  t('A6. 有「跳过识别，自己加课」', await page.locator('[data-ob-skip-rec]').isVisible())

  await pickStart(page)
  t('A7. 选完日期，开学时间行显示日期（周一）', (await page.locator('[data-ob-start]').innerText()).includes('周一'))
  await page.locator('[data-ob-goto-rec]').click()
  await page.waitForTimeout(400)
  t('A8. 信息齐了 → 进第 2 步（识别课表）', (await stepOf(page)) === '2')
  t('A9. 步骤条高亮跟到第 2 项', (await page.locator('[data-step-item="2"]').getAttribute('aria-current')) === 'step')

  /* ---- B. 第 2 步显示「本次换算用的节次表」摘要 ---- */
  const summary = page.locator('[data-ob-summary]')
  t('B1. 第 2 步有节次表摘要', await summary.isVisible())
  const st = (await summary.innerText()).replace(/\s+/g, ' ')
  console.log('   摘要：', st)
  t('B2. 摘要含节数（共 13 节）', st.includes('共 13 节'))
  t('B3. 摘要含分段数（分 3 段：上午/下午/晚上）', st.includes('分 3 段'))
  t('B4. 摘要列出各段时段（第 1–5 节 08:00–12:25）', st.includes('第 1–5 节') && st.includes('08:00–12:25'))
  t('B5. 摘要说明「识别只按第几节，时间按这张表算」', st.includes('第几节'))
  t('B6. 有「改节次表」回第 1 步的入口', await page.locator('[data-ob-edit-periods]').isVisible())

  /* ---- C. 回第 1 步 → 二级页改单节时长 50 → 摘要跟随 ---- */
  await page.locator('[data-ob-edit-periods]').click()
  await page.waitForTimeout(300)
  t('C1. 回到第 1 步', (await stepOf(page)) === '1')
  t('C2. 开学时间还选着', !(await page.locator('[data-ob-start]').innerText()).includes('选日期'))
  await page.locator('[data-ob-time]').click()
  await page.waitForTimeout(300)
  t('C3. 进二级页（三块）', (await page.locator('[data-ob-seg]').count()) === 3)
  t('C4. 三块命名 上午/下午/晚上', (await page.locator('[data-ob-seg="1"]').innerText()).includes('上午') && (await page.locator('[data-ob-seg="2"]').innerText()).includes('下午') && (await page.locator('[data-ob-seg="3"]').innerText()).includes('晚上'))
  await page.locator('[data-ob-dur]').click()
  await page.waitForTimeout(400)
  await page.locator('[data-wheel-val="50"]').click()
  await page.waitForTimeout(150)
  await page.locator('button:has-text("确定")').click()
  await page.waitForTimeout(300)
  t('C5. 改单节 50 分钟后第一块末节 12:50', (await page.locator('[data-ob-seg="1"]').innerText()).includes('12:50'))
  await page.locator('[data-ob-time-back]').click()
  await page.waitForTimeout(250)
  await page.locator('[data-ob-goto-rec]').click()
  await page.waitForTimeout(400)
  const st2 = (await summary.innerText()).replace(/\s+/g, ' ')
  console.log('   改后摘要：', st2)
  t('C6. 摘要跟随用户节次表（第 1 段变 08:00–12:50）', st2.includes('08:00–12:50') && !st2.includes('08:00–12:25'))

  /* ---- D. 第 2 步识别 → 第 3 步核对 → 回第 2 步不丢结果 ---- */
  await page.locator('input[accept="image/*"]').setInputFiles(IMG)
  await page.waitForTimeout(1000)
  t('D1. 识别成功 → 第 3 步（核对导入）', (await stepOf(page)) === '3')
  t('D2. 核对页列出 1 条', (await page.locator('[data-rec-item]').count()) === 1)
  t('D3. 核对页时间用刚改的表（08:00–09:50）', await page.locator('text=上课时间 08:00–09:50').isVisible())

  await page.locator('[data-rec-back-rec]').click()
  await page.waitForTimeout(300)
  t('D4. 返回识别页 → 第 2 步', (await stepOf(page)) === '2')
  const done = page.locator('[data-ob-rec-done]')
  t('D5. 识别页显示「已有识别结果」', await done.isVisible())
  t('D6. 且带上条数（1 门课）', (await done.innerText()).includes('1 门课'))
  await page.locator('[data-ob-rec-continue]').click()
  await page.waitForTimeout(300)
  t('D7. 「继续核对」回第 3 步', (await stepOf(page)) === '3')
  t('D8. 结果没被重置（还是 1 条）', (await page.locator('[data-rec-item]').count()) === 1)

  await page.locator('[data-rec-import]').click()
  await page.waitForTimeout(700)
  t('D9. 导入后引导页关闭', !(await page.locator('text=欢迎来到日程助手').isVisible().catch(() => false)))
  const added = await page.evaluate(() => localStorage.getItem('web2.added') || '')
  t('D10. 课程落盘（含改后节次表换算的 09:50）', added.includes('高等数学') && added.includes('"09:50"'))
  await page.context().close()

  /* ---- E. 二级页加一节 / 删一节 ---- */
  page = await newPage(JSON.stringify(AI_COURSES))
  await toForm(page)
  await pickStart(page)
  await page.locator('[data-ob-time]').click()
  await page.waitForTimeout(300)
  t('E1. 晚上块有 3 节', (await page.locator('[data-ob-seg="3"] [data-ob-period-row]').count()) === 3)
  await page.locator('[data-ob-seg-add="3"]').click()
  await page.waitForTimeout(250)
  t('E2. 加一节后晚上 4 节', (await page.locator('[data-ob-seg="3"] [data-ob-period-row]').count()) === 4)
  const added4 = page.locator('[data-ob-period-row="14"]')
  t('E3. 新节 21:45 起（21:35 + 课间 10）', (await added4.innerText()).includes('21:45'))
  await added4.locator('button[aria-label^="删除第 "]').click()
  await page.waitForTimeout(250)
  t('E4. 删掉后回到 3 节', (await page.locator('[data-ob-seg="3"] [data-ob-period-row]').count()) === 3)
  await page.context().close()

  /* ---- F. 跳过识别：直接建学期 ---- */
  page = await newPage(JSON.stringify(AI_COURSES))
  await toForm(page)
  await pickStart(page)
  await page.locator('[data-ob-skip-rec]').click()
  await page.waitForTimeout(700)
  t('F1. 跳过识别也能建好学期', (await page.evaluate(() => localStorage.getItem('web2.onboarded'))) === '1')
  const sem = await page.evaluate(() => localStorage.getItem('web2.data') || '')
  t('F2. 学期已落盘（含开学日）', sem.includes('"semester"') && sem.includes('first_monday'))
  t('F3. 没导入任何课', !(await page.evaluate(() => localStorage.getItem('web2.added') || '')).includes('高等数学'))
  await page.context().close()

  /* ---- G. 识别页的手动输入入口：不识别也能补课进核对页 ---- */
  page = await newPage(JSON.stringify(AI_COURSES))
  await toForm(page)
  await pickStart(page)
  await page.locator('[data-ob-goto-rec]').click()
  await page.waitForTimeout(400)
  t('G1. 识别页有「手动加一门课」入口', await page.locator('[data-ob-manual]').isVisible())
  await page.locator('[data-ob-manual]').click()
  await page.waitForTimeout(400)
  t('G2. 点击后直接进第 3 步核对', (await stepOf(page)) === '3')
  const gItems = page.locator('[data-rec-item]')
  t('G3. 核对页出现 1 条空课', (await gItems.count()) === 1)
  t('G4. 课程名是空的（等用户填）', (await gItems.first().locator('input').first().inputValue()) === '')
  await gItems.first().locator('input').first().fill('手动加的课')
  await gItems.first().locator('select').nth(2).selectOption('3') // 从第 3 节（0=星期 1=周次 2=从第 3=到第）
  await gItems.first().locator('select').nth(3).selectOption('4') // 到第 4 节
  await page.waitForTimeout(200)
  t('G5. 时间预览按默认表换算（09:50–11:30）', await page.locator('text=上课时间 09:50–11:30').isVisible())
  t('G6. 导入按钮计数 1 门', await page.locator('text=导入选中的 1 门课，开始使用').isVisible())
  await page.locator('[data-rec-import]').click()
  await page.waitForTimeout(700)
  const added3 = await page.evaluate(() => localStorage.getItem('web2.added') || '')
  t('G7. 手动课落盘（start 09:50 / end 11:30）', added3.includes('手动加的课') && added3.includes('"09:50"') && added3.includes('"11:30"'))
  await page.context().close()
} catch (e) {
  console.log('ERROR:', e.message)
  results.push(['无异常跑完', false])
}

await browser.close()
const fails = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
