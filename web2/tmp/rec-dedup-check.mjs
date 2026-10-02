/* 识别导入去重验证：同一批识别结果里出现两门完全相同的课，只应导入一次。

   ⚠️ 口径说明（2026-10-02 Day 17 重写，替换已腐坏的旧断言）：
   旧脚本断言「核对页把重复的两门课标红重叠」+「导入提示含『重复已跳过 1』」——
   这两条在 M5 识别重构后已经不成立：**重复项在解析层（recognizer.js parseScheduleJson
   的 seen 集合）就被丢掉了，根本到不了核对页**。核对页的「重叠标红」只对
   「同一天同一节但不同课」生效（findCellOverlaps），不负责去重。

   所以本脚本改为验证真实、有意义的三层口径：
     ① 解析层：完全重复的两条只留一条（值：不给核对页刷无意义的重复条目）
     ② 解析层：空课名的记录被丢弃并给出 warnings 文案（值：不污染核对页）
     ③ 导入层：节次超出当前学期节次表的课被跳过并计入 bad（值：不静默丢，有文案兜底）
     ④ 落盘层：最终只有去重后的课进 web2.added

   跑法：先起 4177 静态服务（服务的就是本轮 dist）再 node tmp/rec-dedup-check.mjs
   支持 TW_URL 覆盖。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + extra : ''))
}

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'
const LLM_CFG = JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' })

/* 载荷设计（每条都对应一个要验的口径）：
   - 高等数学 ×2 完全重复   → ① 解析层只留一条
   - 大学英语              → 正常课，用来确认去重没误伤
   - 体育 14–15 节         → ③ 解析层放行（≤15）但学期节次表只到 13 节 → 导入时计 bad
   - 空课名                → ② 解析层丢弃 + warnings
   去重后进核对页的应为 3 门（高数 / 大学英语 / 体育） */
const AI_DUP = {
  courses: [
    { title: '高等数学', weekday: 1, startSec: 1, endSec: 2, weekRule: 'every', location: '教1-101', teacher: '张老师' },
    { title: '高等数学', weekday: 1, startSec: 1, endSec: 2, weekRule: 'every', location: '教1-101', teacher: '张老师' }, // 完全重复
    { title: '大学英语', weekday: 3, startSec: 3, endSec: 4, weekRule: 'odd', location: '外语楼203', teacher: '' },
    { title: '体育', weekday: 5, startSec: 14, endSec: 15, weekRule: 'every', location: '操场', teacher: '' }, // 节次超表
    { title: '', weekday: 2, startSec: 5, endSec: 6, weekRule: 'every' }, // 无课名
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

const IMG = 'D:/Document/Project/vibe-coding-project/web2/tmp/rec-sample.jpg'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.addInitScript(`localStorage.setItem('web2.llm', ${JSON.stringify(LLM_CFG)})`)
  await page.addInitScript(fakeFetchScript(JSON.stringify(AI_DUP)))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)

  /* 引导页第 1 步：填学期信息 */
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

  /* 第 2 步：选图（假 fetch 立即返回结果）→ 自动进第 3 步核对页 */
  await page.locator('input[accept="image/*"]').setInputFiles(IMG)
  await page.waitForSelector('[data-rec-import]', { timeout: 8000 })
  await page.waitForTimeout(400)

  /* 核对页：解析层已去重 —— 5 条载荷里重复的高数与空课名都在解析层被处理掉，
     落进 recPreview 的应为 3 条 */
  const layerText = (await page.locator('[data-ob-step]').innerText()).replace(/\s+/g, ' ')
  t('① 核对页条目数为 3（重复项与空课名已在解析层被剔除）', /共\s*3\s*门课/.test(layerText), layerText.slice(0, 60))
  t('② 空课名记录被丢弃并给出 warnings 文案', layerText.includes('丢弃一条没有课程名的记录'))
  t('③ 完全重复的两门课在核对页不重复出现', (await page.locator('[data-rec-item]').count()) === 3, String(await page.locator('[data-rec-item]').count()))

  /* 导入 → 引导层关闭、跳周视图 */
  await page.locator('[data-rec-import]').click()
  await page.waitForTimeout(1200)

  /* 反馈文案挂在 [data-import-msg]（不是 data-app-toast） */
  const msg = (await page.locator('[data-import-msg]').textContent().catch(() => '')) || ''
  t('④ 导入反馈含「课表识别已导入 2 门课」', /已导入\s*2\s*门课/.test(msg), msg)
  t('⑤ 反馈把「节次超出」单列（不再与「课程名没填」混为一句）', /1\s*门因节次超出当前节次表被跳过/.test(msg), msg)
  t('⑤b 反馈没有出现混为一谈的旧文案', !/课程名没填或节次超出/.test(msg), msg)

  /* 落盘：added overlay 应为 2 门（高数 + 大学英语），体育 14–15 节被挡 */
  const added = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.added') || '[]'))
  const names = added.map((c) => c.name)
  t('⑥ 落盘 2 门课', added.length === 2, JSON.stringify(names))
  t('⑦ 落盘的是高数与大学英语（体育 14–15 节未越界落盘）', names.includes('高等数学') && names.includes('大学英语') && !names.includes('体育'), JSON.stringify(names))
  t('⑧ 高数只落了一条（去重生效）', names.filter((n) => n === '高等数学').length === 1, JSON.stringify(names))
} catch (e) {
  console.log('SCRIPT ERROR:', e && e.message)
  results.push(['脚本异常', false])
}
await browser.close()

const fail = results.filter(([, ok]) => !ok)
console.log(`\n=== 识别导入去重：${results.length - fail.length}/${results.length} 通过 ===`)
if (fail.length) console.log('失败项：' + fail.map((x) => x[0]).join(' / '))
process.exit(fail.length ? 1 : 0)
