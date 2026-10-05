/* 「我的」页识别入口（第三步）：
   1) 入口在「我的」页可见，点开进识别页；
   2) 换算表用「当前学期的节次表」（seed 里第一节的开始是 08:30，与默认表 08:00 可区分）；
   3) mine 模式不显示「← 改节次表 / 学期信息」，返回键位是「取消识别」；
   4) 取消后回到应用、引导层关闭；
   5) 识别 → 核对页预览用学期节次表换算（08:30–10:10）；
   6) 导入走 addCourse 增量：不动学期数据（web2.data 原样）；
   7) 与现有课表时间重叠的课给出冲突提示（高等数学 vs 已有周一 08:00–09:30 那门）。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'
const IMG = 'D:/Document/Project/vibe-coding-project/web2/tmp/rec-sample.jpg'
const LLM_CFG = JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' })

const P10 = [
  { no: 1, start: '08:30', end: '09:15' },
  { no: 2, start: '09:25', end: '10:10' },
  { no: 3, start: '10:20', end: '11:05' },
  { no: 4, start: '11:15', end: '12:00' },
  { no: 5, start: '14:00', end: '14:45' },
  { no: 6, start: '14:55', end: '15:40' },
  { no: 7, start: '16:00', end: '16:45' },
  { no: 8, start: '16:55', end: '17:40' },
  { no: 9, start: '19:00', end: '19:45' },
  { no: 10, start: '19:55', end: '20:40' },
]

/* 导入态 seed：学期带自定义节次表（第一节 08:30 起，区别于默认 08:00），
   已有一门周一 08:00–09:30 的「高等数学」——识别结果里同名同星期那门应撞出冲突提示 */
const SEED = JSON.stringify({
  app: 'sched',
  schema_version: 1,
  exported_at: '2026-09-28T14:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: '2026-09-07', total_weeks: 16, periods: P10 },
  schedules: [
    { id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教1-101', weekday: 1, start_time: '08:00', duration: 90, week_rule: 'every' },
  ],
  todos: [],
})

const AI_COURSES = {
  courses: [
    { title: '高等数学', weekday: 1, startSec: 1, endSec: 2, weekRule: 'every', location: '教1-201', teacher: '' },
    { title: '大学英语', weekday: 3, startSec: 3, endSec: 4, weekRule: 'every', location: '外语楼203', teacher: '' },
  ],
  notes: [],
}

/* v1.41.9 真机反馈：老版本把 undefined 拼进模板串落了盘，场次列表里出现过「undefined · 10月1日」。
   v1.41.10 收紧：真机落盘的**不是裸 "undefined"**，而是拼好的复合串，所以 sanitizeLecture 改成
   前缀正则（`/^(?:undefined|null|nan)\b/i`），空串 / 复合串一律收敛成「未命名录音」。 */
const LEC_SEED = [
  { id: 'l_broken', title: 'undefined', status: 'transcribed', started_at: '2026-10-01T09:12:00.000Z', duration_ms: 2520000, clip_count: 0, clips: [], created_at: '2026-10-01T09:12:00.000Z', updated_at: '2026-10-01T09:12:00.000Z' },
  { id: 'l_broken2', title: 'undefined · 10月1日', status: 'summarized', started_at: '2026-10-01T10:14:00.000Z', duration_ms: 2522000, clip_count: 0, clips: [], created_at: '2026-10-01T10:14:00.000Z', updated_at: '2026-10-01T10:14:00.000Z' },
  { id: 'l_ok', title: '课堂录音 10月2日', status: 'transcribed', started_at: '2026-10-02T09:12:00.000Z', duration_ms: 600000, clip_count: 0, clips: [], created_at: '2026-10-02T09:12:00.000Z', updated_at: '2026-10-02T09:12:00.000Z' },
]

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(SEED)})`)
  await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
  await page.addInitScript(`localStorage.setItem('web2.llm', ${JSON.stringify(LLM_CFG)})`)
  await page.addInitScript(`localStorage.setItem('web2.lectures', ${JSON.stringify(JSON.stringify(LEC_SEED))})`)
  await page.addInitScript(`window.fetch = (function (orig) {
    return function (url, init) {
      if (String(url).indexOf('api.deepseek.com') !== -1) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: ${JSON.stringify(JSON.stringify(AI_COURSES))} } }] }) } });
      }
      return orig.apply(this, arguments);
    };
  })(window.fetch);`)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)

  // 1. 入口
  t('A1. 已引导用户直接进应用（无引导层）', !(await page.locator('text=欢迎来到日程助手').isVisible().catch(() => false)))
  const mineNav = page.locator('nav button', { hasText: '周课表' })
  await mineNav.click()
  await page.waitForTimeout(400)
  t('A2. 课表页右上「＋」有识别入口', await page.locator('[data-mine-rec]').isVisible())

  // 2. 点开 → 识别页：换算表用当前学期的
  await page.locator('[data-mine-rec]').click()
  await page.waitForTimeout(400)
  const sum = (await page.locator('[data-ob-summary]').innerText()).replace(/\s+/g, ' ')
  console.log('   mine 识别页摘要：', sum)
  t('B1. 摘要用学期节次表（共 10 节）', sum.includes('共 10 节'))
  t('B2. 摘要显示学期时间（08:30，不是默认 08:00）', sum.includes('08:30') && !sum.includes('08:00'))
  t('B3. mine 模式没有「改节次表」按钮', (await page.locator('[data-ob-edit-periods]').count()) === 0)
  t('B4. 有「取消识别」出口', await page.locator('[data-mine-rec-cancel]').isVisible())

  // 3. 取消识别
  await page.locator('[data-mine-rec-cancel]').click()
  await page.waitForTimeout(400)
  t('C1. 取消后回到应用（课表页可见）', await page.locator('[data-mine-rec]').isVisible())
  t('C2. 引导层已关闭', !(await page.locator('[data-ob-summary]').isVisible().catch(() => false)))

  // 4. 再进 → 识别 → 确认页
  await page.locator('[data-mine-rec]').click()
  await page.waitForTimeout(300)
  await page.locator('input[accept="image/*"]').setInputFiles(IMG)
  await page.waitForTimeout(1000)
  t('D1. 进入核对页', await page.locator('text=核对后导入').isVisible())
  t('D2. 预览用学期节次表（08:30–10:10）', await page.locator('text=上课时间 08:30–10:10').isVisible())

  // 5. 导入：增量 + 冲突提示，学期数据不动
  await page.locator('[data-rec-import]').click()
  await page.waitForTimeout(800)
  const added = await page.evaluate(() => localStorage.getItem('web2.added') || '')
  console.log('   web2.added:', added.slice(0, 300))
  t('E1. 识别课落盘（含大学英语）', added.includes('大学英语'))
  t('E2. 落盘时间用学期节次表（08:30 / 10:10）', added.includes('"08:30"') && added.includes('"10:10"'))
  const sem = await page.evaluate(() => localStorage.getItem('web2.data') || '')
  t('E3. 学期数据未被改动（first_monday 原样）', sem.includes('2026-09-07') && sem.includes('"08:30"'))
  // Stage 6：导入回执渲染在「设置」二级页里（原先在「我的」索引页）→ 先推进去看
  await page.$eval('[data-nav="me"]', (el) => el.click())
  await page.waitForTimeout(400)
  await page.$eval('[data-me-entry="settings"]', (el) => el.click())
  await page.waitForTimeout(400)
  const msg = await page.locator('[data-import-msg]').innerText().catch(() => '')
  console.log('   导入反馈：', msg)
  t('E4. 反馈含冲突提示（高等数学）', msg.includes('冲突') && msg.includes('高等数学'))
  t('E5. 反馈含成功计数（2 门）', msg.includes('2'))
  t('E6. 引导层已关闭', !(await page.locator('[data-ob-summary]').isVisible().catch(() => false)))

  // 6. 场次列表：标题是字符串 "undefined" 的坏数据必须显示成「未命名录音」
  // Stage 6：录音场次搬进「我的」二级页（索引页只剩入口），先推进 lectures 二级页再读列表
  await page.$eval('[data-nav="me"]', (el) => el.click())
  await page.waitForTimeout(400)
  await page.$eval('[data-me-entry="lectures"]', (el) => el.click())
  await page.waitForTimeout(400)
  const lecTxt = await page.locator('[data-sub-body] ul').filter({ hasText: '课堂录音 10月2日' }).first().innerText().catch(() => '')
  console.log('   场次列表：', lecTxt.replace(/\s+/g, ' ').slice(0, 200))
  t('F1. 坏标题显示成「未命名录音」', lecTxt.includes('未命名录音'))
  t('F2. 界面上不再出现字面量 undefined', !lecTxt.includes('undefined'))
  t('F3. 正常标题原样保留', lecTxt.includes('课堂录音 10月2日'))
  /* 两条坏数据（裸 "undefined" + 复合串 "undefined · 10月1日"）都要被收敛 → 数到正好两次 */
  const unnamedCount = (lecTxt.match(/未命名录音/g) || []).length
  t('F4. 两条坏数据都被收敛（未命名录音 ×2）', unnamedCount === 2)
  await ctx.close()
} catch (e) {
  console.log('ERROR:', e.message)
  results.push(['无异常跑完', false])
}

await browser.close()
const fails = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
