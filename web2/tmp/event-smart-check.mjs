/* 自检：「添加日程」表单的 ✨ 智能填写（2026-10-12，用户 m05813 / m06155）。
   口径（用户拍板）：
   ① 表单里只多一颗小按钮，两条路藏在选单里：拍照/选图、粘贴文字
   ② 识别结果**只回填表单**，不直接落库 —— 必须等用户自己点「添加」才入库
   ③ 文字走弹框粘贴/手打
   纪律：DeepSeek 请求一律被 stub 拦下（不发真网、不花余额），并把请求体抓出来验锚点。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const BASE = process.env.BASE || 'http://127.0.0.1:4177'
const LLM_CFG = JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' })
const TODAY = new Date()
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = iso(TODAY)
const tomorrow = iso(new Date(TODAY.getTime() + 86400000))

const AI_OUT = JSON.stringify({
  title: '班会',
  date: tomorrow,
  start: '15:00',
  duration: 100,
  place: '教二 110',
  notes: [],
})

const doc = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: '2026-08-31', total_weeks: 18 },
  schedules: [{ id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教三 302', teacher: '张明', weekday: 1, start_time: '08:00', duration: 100, week_rule: 'every' }],
  todos: [],
}

let pass = 0
let fail = 0
const t = (name, ok, extra = '') => {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? '  → ' + extra : ''}`)
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

async function newPage({ withKey = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(JSON.stringify(doc))})`)
  await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
  await page.addInitScript(`localStorage.setItem('web2.theme', '"light"')`)
  if (withKey) await page.addInitScript(`localStorage.setItem('web2.llm', ${JSON.stringify(LLM_CFG)})`)
  // 拦截 DeepSeek：记录请求体，返回预设 JSON
  await page.addInitScript(`window.__aiCalls = [];
    window.fetch = (function (orig) {
      return function (url, init) {
        if (String(url).indexOf('api.deepseek.com') !== -1) {
          window.__aiCalls.push(init && init.body ? String(init.body) : '');
          return Promise.resolve({ ok: true, status: 200, json: function () {
            return Promise.resolve({ choices: [{ message: { content: ${JSON.stringify(AI_OUT)} } }] });
          } });
        }
        return orig.apply(this, arguments);
      };
    })(window.fetch);`)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  return { ctx, page, errs }
}

const openEvtSheet = async (page) => {
  await page.locator('button', { hasText: '添加日程' }).first().click()
  await page.waitForTimeout(500)
}
const evtVal = (page, sel) => page.$eval(`[data-sheet-evt] ${sel}`, (el) => el.value).catch(() => null)
const titleVal = (page) => evtVal(page, 'input[placeholder^="日程名称"]')
const placeVal = (page) => evtVal(page, 'input[placeholder^="地点"]')
/* 表单里按钮不止日期/时间两颗（还有「✨ 智能填写」），按文本形状取，别用 nth 猜序号
   —— 第一版就是 nth(0)/nth(1) 拿错按钮，导致 B4/B5/E1/E2 得到假结果。 */
const btnTexts = (page) => page.$$eval('[data-sheet-evt] button', (bs) => bs.map((b) => b.innerText.replace(/\s+/g, ' ').trim()))
const dateBtnText = async (page) => (await btnTexts(page)).find((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) || x === '日期') || ''
const timeBtnText = async (page) => (await btnTexts(page)).find((x) => /^\d{2}:\d{2}$/.test(x) || x === '几点开始') || ''

/* ---------- A. 入口形态：一颗小按钮 + 两条路 ---------- */
{
  const { ctx, page, errs } = await newPage()
  await openEvtSheet(page)
  t('A1 表单里有「✨ 智能填写」按钮', (await page.locator('[data-event-smart]').count()) === 1)
  t('A2 默认不展开选单', (await page.locator('[data-event-smart-text]').count()) === 0)
  await page.locator('[data-event-smart]').click()
  await page.waitForTimeout(250)
  const items = await page.evaluate(() => [...document.querySelectorAll('[data-event-smart-image],[data-event-smart-text]')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()))
  t('A3 选单恰两条路', items.length === 2, JSON.stringify(items))
  t('A4 有「拍照 / 选图」', items.some((x) => x.includes('拍照')), JSON.stringify(items))
  t('A5 有「粘贴文字」', items.some((x) => x.includes('粘贴')), JSON.stringify(items))
  t('A6 隐藏的图片 input 存在', (await page.locator('[data-event-smart-file]').count()) === 1)
  t('A7 图片 input 只收图片', (await page.$eval('[data-event-smart-file]', (el) => el.accept)) === 'image/*')
  t('A8 无 pageerror', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

/* ---------- B. 粘贴文字 → 识别 → 回填表单（不落库） ---------- */
{
  const { ctx, page, errs } = await newPage()
  await openEvtSheet(page)
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.data')).events || [])
  await page.locator('[data-event-smart]').click()
  await page.waitForTimeout(200)
  await page.locator('[data-event-smart-text]').click()
  await page.waitForTimeout(250)
  t('B1 点「粘贴文字」出现输入框', (await page.locator('[data-event-smart-input]').count()) === 1)
  await page.fill('[data-event-smart-input]', '后天下午三点开班会，教二 110，大概一个半小时')
  await page.locator('[data-event-smart-run]').click()
  await page.waitForTimeout(900)
  t('B2 标题被回填', (await titleVal(page)) === '班会', String(await titleVal(page)))
  t('B3 地点被回填', (await placeVal(page)) === '教二 110', String(await placeVal(page)))
  const dateTxt = await dateBtnText(page)
  t('B4 日期被回填为明天', dateTxt === tomorrow, dateTxt)
  const timeTxt = await timeBtnText(page)
  t('B5 开始时间被回填 15:00', timeTxt === '15:00', timeTxt)
  const durCls = await page.locator('[data-sheet-evt] button', { hasText: '90分' }).getAttribute('class').catch(() => '')
  t('B6 时长吸附到 90 分并选中', durCls.includes('text-white'), durCls)
  t('B7 有「已填入 + 请核对」提示', (await page.locator('[data-event-smart-hint]').count()) === 1)
  t('B8 文字面板识别后收起', (await page.locator('[data-event-smart-input]').count()) === 0)
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.data')).events || [])
  t('B9 未点「添加」前没有落库', after.length === before.length, `before=${before.length} after=${after.length}`)
  t('B10 无 pageerror', errs.length === 0, errs.join(' | '))

  /* B11：识别结果没认出日期时，**必须保住用户自己已经选好的日期**。
     规则是「只覆盖识别到的字段」—— 识别不到就闭嘴，绝不用空白把用户填的东西冲掉。
     （反例：填表单→手选 10-20→再粘文字补标题，若这里清空，用户白选一次。） */
  await page.evaluate(() => { window.__aiNoDate = JSON.stringify({ title: '临时凑会', date: '', start: '', duration: 60, place: '', notes: [] }) })
  await page.evaluate(() => {
    const orig = window.fetch
    window.fetch = function (url, init) {
      if (String(url).indexOf('api.deepseek.com') !== -1) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ choices: [{ message: { content: window.__aiNoDate } }] }) })
      }
      return orig.apply(this, arguments)
    }
  })
  const keepDate = iso(new Date(TODAY.getTime() + 9 * 86400000))
  const dateBefore = await dateBtnText(page)
  await page.locator('[data-event-smart]').click()
  await page.waitForTimeout(150)
  await page.locator('[data-event-smart-text]').click()
  await page.waitForTimeout(200)
  await page.fill('[data-event-smart-input]', '临时凑个会')
  await page.locator('[data-event-smart-run]').click()
  await page.waitForTimeout(700)
  t('B11 没认出日期时不冲掉表单原有值', (await dateBtnText(page)) === dateBefore, `${dateBefore} → ${await dateBtnText(page)}`)
  t('B12 但识别到的标题照样填进', (await titleVal(page)) === '临时凑会', String(await titleVal(page)))
  t('B13 并明说日期拿不准', (await page.locator('[data-event-smart-err]').innerText().catch(() => '')).includes('日期'), '')
  await ctx.close()
}

/* ---------- C. 请求体：模型 + 日期锚点 ---------- */
{
  const { ctx, page } = await newPage()
  await openEvtSheet(page)
  await page.locator('[data-event-smart]').click()
  await page.waitForTimeout(200)
  await page.locator('[data-event-smart-text]').click()
  await page.waitForTimeout(250)
  await page.fill('[data-event-smart-input]', '明天开会')
  await page.locator('[data-event-smart-run]').click()
  await page.waitForTimeout(900)
  const calls = await page.evaluate(() => window.__aiCalls || [])
  t('C1 确实发了 DeepSeek 请求', calls.length === 1, `calls=${calls.length}`)
  const body = calls[0] || ''
  t('C2 模型是 deepseek-flash（视觉/便宜）', body.includes('deepseek-flash'))
  t('C3 请求体带「今天是哪天」锚点', body.includes(today), `today=${today}`)
  t('C4 提示词要求 JSON 输出', body.includes('json_object'))
  t('C5 关掉思考模式', body.includes('"thinking"'))
  await ctx.close()
}

/* ---------- D. 缺 Key：给可行动提示，不发请求 ---------- */
{
  const { ctx, page } = await newPage({ withKey: false })
  await openEvtSheet(page)
  await page.locator('[data-event-smart]').click()
  await page.waitForTimeout(200)
  await page.locator('[data-event-smart-text]').click()
  await page.waitForTimeout(250)
  await page.fill('[data-event-smart-input]', '明天开会')
  await page.locator('[data-event-smart-run]').click()
  await page.waitForTimeout(600)
  const err = await page.locator('[data-event-smart-err]').innerText().catch(() => '')
  t('D1 缺 Key 时提示配置（不发请求）', err.includes('API Key'), err)
  const calls = await page.evaluate(() => window.__aiCalls || [])
  t('D2 缺 Key 时确实没发请求', calls.length === 0, `calls=${calls.length}`)
  await ctx.close()
}

/* ---------- E. 识别结果字段非法 → 留空 + 拿不准提示（不填错） ---------- */
{
  const { ctx, page } = await newPage()
  // 覆盖这一次的返回值为「坏字段」
  await page.addInitScript(`window.__badOut = true`)
  await page.evaluate(() => { window.__aiCalls = [] })
  const bad = JSON.stringify({ title: '开会', date: '2026-02-31', start: '25:00', duration: '一小时', place: '', notes: ['看不清地点'] })
  await page.evaluate((out) => { window.__aiBad = out }, bad)
  await page.evaluate(() => {
    const orig = window.fetch
    window.fetch = function (url, init) {
      if (String(url).indexOf('api.deepseek.com') !== -1) {
        window.__aiCalls.push(init && init.body ? String(init.body) : '')
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ choices: [{ message: { content: window.__aiBad } }] }) })
      }
      return orig.apply(this, arguments)
    }
  })
  await openEvtSheet(page)
  await page.locator('[data-event-smart]').click()
  await page.waitForTimeout(200)
  await page.locator('[data-event-smart-text]').click()
  await page.waitForTimeout(250)
  await page.fill('[data-event-smart-input]', '开个会')
  await page.locator('[data-event-smart-run]').click()
  await page.waitForTimeout(800)
  /* E 组口径：**识别到的非法值绝不许落进表单**，但也不必把表单原有值清掉 ——
     表单里原本的日期/时间是用户（或默认值）已经定好的，识别不到就不该动它，
     拿不准的地方靠下方 warnings 明说（这正是不「瞎填」的落点：不填错 > 填满）。 */
  const dTxt = await dateBtnText(page)
  const tTxt = await timeBtnText(page)
  t('E1 非法日期没有被写进表单', !dTxt.includes('2026-02-31'), dTxt)
  t('E2 非法时间没有被写进表单', !tTxt.includes('25:00'), tTxt)
  const err = await page.locator('[data-event-smart-err]').innerText().catch(() => '')
  t('E3 把拿不准的地方讲出来', err.includes('拿不准') && err.includes('日期'), err)
  t('E4 非法时长回落 60 分而不是「一小时」', (await page.locator('[data-sheet-evt] button', { hasText: '60分' }).getAttribute('class').catch(() => '')).includes('text-white'), '')
  /* E5：表单里原本预填的今天没被冲掉，但提示必须点名「这个是保留你原先的」，
     否则用户会把预填的「今天」误读成「模型认出是今天」。 */
  t('E5 保留原先值时提示里点名说明', err.includes('日期保留你原先选的'), err)
  t('E6 保留的确实是原先那个日期', dTxt === today, `${dTxt} vs ${today}`)
  await ctx.close()
}

/* ---------- F. 拍照 / 选图这条路（图片走多模态，和文字是同一条回填逻辑） ---------- */
{
  const { ctx, page, errs } = await newPage()
  const IMG = 'D:/Document/Project/vibe-coding-project/web2/tmp/rec-sample.jpg'
  await openEvtSheet(page)
  await page.locator('[data-event-smart]').click()
  await page.waitForTimeout(200)
  await page.locator('[data-event-smart-image]').click()
  await page.waitForTimeout(200)
  await page.locator('[data-event-smart-file]').setInputFiles(IMG)
  await page.waitForTimeout(1200)
  t('F1 选图后标题被回填', (await titleVal(page)) === '班会', String(await titleVal(page)))
  t('F2 选图后地点被回填', (await placeVal(page)) === '教二 110', String(await placeVal(page)))
  t('F3 选图后日期被回填为明天', (await dateBtnText(page)) === tomorrow, await dateBtnText(page))
  t('F4 选图后时间被回填', (await timeBtnText(page)) === '15:00', await timeBtnText(page))
  const calls = await page.evaluate(() => window.__aiCalls || [])
  t('F5 图片走的是同一接口且带 image_url', calls.length === 1 && calls[0].includes('image_url'), `calls=${calls.length}`)
  t('F6 图片请求也用 deepseek-flash', (calls[0] || '').includes('deepseek-flash'))
  t('F7 图片路径无 pageerror', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

console.log('')
console.log(`合计：${pass} 过 / ${fail} 挂`)
await browser.close()
process.exit(fail ? 1 : 0)
