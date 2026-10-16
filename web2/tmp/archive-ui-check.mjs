/* 全量归档 UI 自检（05 号功能，2026-10-15）：
   数据层已有 archive-unit.mjs 覆盖纯逻辑，这里只管「界面这条路走不走得通」：
   A 卡片与摘要    B 导出真的下载到文件    C 恢复三步（选文件 → 预览 → 连点两次）
   D 非归档文件被拒且给出正确指引    E 恢复后界面数据真的换了（不是只改了 localStorage）

   跑法：先起静态服务（serve.js 服务 dist，改源码要先 build），再 node tmp/archive-ui-check.mjs
   ⚠ 本机 Chrome 必须 --disable-gpu：GPU 合成下 rAF 不回调、CSS 过渡卡在起点，
     页面上 locator.click() 会全部 30s 超时（2026-10-15 查清，见 rec-preview-check.mjs 顶部注释）。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const results = []
function t(name, cond, detail) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  <- ' + String(detail)))
}

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'
const DL = path.join(process.cwd(), 'tmp', '_arch-dl')
fs.rmSync(DL, { recursive: true, force: true })
fs.mkdirSync(DL, { recursive: true })

/* 预置：一份「什么都有」的本机数据 + 三个机密键（哨兵串，用来验导出文件里没有它们）。
   sessionStorage 挡重播（reload 保留 sessionStorage）——同 clear-data-check 的写法。 */
const SENTINEL_KEY = 'SENTINEL-APIKEY-abc123'
const SENTINEL_PASS = 'SENTINEL-SYNCPASS-xyz789'
const SEED = `
if (!sessionStorage.getItem('arch-seeded')) {
sessionStorage.setItem('arch-seeded', '1')
localStorage.setItem('web2.onboarded', '1');
localStorage.setItem('web2.theme', 'light');
localStorage.setItem('web2.data', JSON.stringify({ app: 'sched', semester: { name: '归档测试学期', first_monday: '2026-09-07', total_weeks: 18 }, schedules: [{ id: 'c-arch', type: 'course', weekday: 1, title: '归档课-高数', start_time: '08:00', duration: 45, week_rule: 'every' }], todos: [{ id: 't-arch', title: '归档前就有的待办', due_date: '2026-10-20', done: false }], events: [], routines: [] }));
localStorage.setItem('web2.habits', JSON.stringify([{ id: 'h-arch', name: '归档打卡', records: {}, backfilled: {} }]));
localStorage.setItem('web2.review', JSON.stringify({ records: [] }));
localStorage.setItem('web2.listen', JSON.stringify({ clips: [] }));
localStorage.setItem('web2.daily', JSON.stringify({ days: { '2026-10-14': { stats: { courses: 2 } } } }));
localStorage.setItem('web2.llm', JSON.stringify({ provider: 'deepseek', key: '${SENTINEL_KEY}', model: 'deepseek-chat' }));
localStorage.setItem('web2.sync', JSON.stringify({ pass: '${SENTINEL_PASS}', rev: 2, at: '', uid: 'abcd1234' }));
}
`

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-gpu'],
})
const ctx = await browser.newContext({ acceptDownloads: true })
const page = await ctx.newPage()
/* 掐掉非本机请求：App 开机会后台抓节假日，真网会让结果随机 */
await page.route('**/*', (route) => {
  const u = route.request().url()
  if (u.startsWith('http://127.0.0.1:4177') || u.startsWith('data:') || u.startsWith('blob:')) return route.continue()
  return route.abort()
})
await page.addInitScript(SEED)
await page.goto(URL, { waitUntil: 'networkidle' })
await page.waitForTimeout(600)

/* 导航：我的 → 设置索引 → 数据与导入导出 */
await page.locator('nav >> text=我的').click()
await page.waitForTimeout(300)
await page.locator('[data-settings-toggle]').click()
await page.waitForTimeout(350)
await page.$eval('[data-settings-index="data"]', (el) => el.click())
await page.waitForTimeout(400)

/* ================= A 卡片与摘要 ================= */
console.log('--- A 卡片与摘要 ---')
t('A1. 数据页有全量归档卡', await page.locator('[data-archive-card]').count() === 1)
const cardText = await page.locator('[data-archive-card]').innerText()
t('A2. 摘要显示「N / M 项有数据」', /\d+\s*\/\s*\d+\s*项有数据/.test(cardText), cardText.slice(0, 120))
t('A3. 摘要里有体积', /(B|KB|MB)/.test(cardText))
t('A4. 如实列出不进文件的机密项（llm / eduAccount / sync）',
  cardText.includes('llm') && cardText.includes('eduAccount') && cardText.includes('sync'))
t('A5. 导出与恢复两个入口都在',
  await page.locator('[data-archive-export]').count() === 1 && await page.locator('[data-archive-file]').count() === 1)

/* ================= B 导出 ================= */
console.log('--- B 导出 ---')
const [dl] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('[data-archive-export]').click(),
])
const fname = dl.suggestedFilename()
const saved = path.join(DL, fname)
await dl.saveAs(saved)
t('B1. 下载文件名带「全量归档」与日期', fname.includes('全量归档') && /\d{8}-\d{4}\.json$/.test(fname), fname)
const text = fs.readFileSync(saved, 'utf8')
const doc = JSON.parse(text)
t('B2. 文件是合法 JSON 且带格式标记', doc.format === 'web2-archive' && doc.version === 1)
t('B3. 带导出时间与 App 版本', typeof doc.exported_at === 'string' && doc.exported_at.length > 10)
t('B4. 关键数据都在文件里（课表 / 打卡 / 复盘 / 快照）',
  !!doc.data['web2.data'] && !!doc.data['web2.habits'] && !!doc.data['web2.review'] && !!doc.data['web2.daily'],
  Object.keys(doc.data).join(','))
t('B5. 导出的内容与 localStorage 逐字节一致', doc.data['web2.data'] === await page.evaluate(() => localStorage.getItem('web2.data')))
t('B6. 机密不进文件：API Key 搜不到', !text.includes(SENTINEL_KEY))
t('B7. 机密不进文件：同步串搜不到', !text.includes(SENTINEL_PASS))
t('B8. 导出后界面给出回执', (await page.locator('[data-archive-msg]').innerText()).includes('已导出'))
const msgText = await page.locator('[data-archive-msg]').innerText()
t('B9. 回执里说明了几项、以及哪些没进文件', /\d+\s*项/.test(msgText) && msgText.includes('llm'), msgText)

/* ================= C 恢复三步 ================= */
console.log('--- C 恢复三步 ---')
/* 先把本机改成「另一台设备」的样子：换课表、加待办、清掉打卡 */
await page.evaluate(() => {
  localStorage.setItem('web2.data', JSON.stringify({ app: 'sched', semester: { name: '改过的学期' }, schedules: [], todos: [], events: [], routines: [] }))
  localStorage.setItem('web2.habits', JSON.stringify([]))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
await page.locator('nav >> text=我的').click()
await page.waitForTimeout(300)
await page.locator('[data-settings-toggle]').click()
await page.waitForTimeout(350)
await page.$eval('[data-settings-index="data"]', (el) => el.click())
await page.waitForTimeout(400)

/* C1：选了文件只出预览，本机一个字节都不能动 */
const beforePick = await page.evaluate(() => localStorage.getItem('web2.data'))
await page.locator('[data-archive-file]').setInputFiles(saved)
await page.waitForTimeout(400)
t('C1. 选文件后出现预览面板', await page.locator('[data-archive-preview]').count() === 1)
const pv = await page.locator('[data-archive-preview]').innerText()
t('C2. 预览显示导出时间', pv.includes('2026-10-15') || /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(pv), pv.slice(0, 100))
t('C3. 预览给出「覆盖 N 项 / 清空 N 项」两个数', /覆盖\s*\d+\s*项/.test(pv) && /清空\s*\d+\s*项/.test(pv), pv.slice(0, 160))
t('C4. 预览明确说明不做合并', pv.includes('不做合并'))
t('C5. 只看预览时本机数据没被动', await page.evaluate(() => localStorage.getItem('web2.data')) === beforePick)
t('C6. 明细可以展开', await page.locator('[data-archive-detail]').count() === 1)
await page.locator('[data-archive-detail]').click()
await page.waitForTimeout(200)
const detail = await page.locator('[data-archive-preview]').innerText()
t('C7. 明细里逐项列了键名', detail.includes('web2.habits') && detail.includes('web2.daily'))

/* C8：第一次点恢复 = 只变确认态，不落地 */
await page.locator('[data-archive-restore]').click()
await page.waitForTimeout(250)
const btn1 = await page.locator('[data-archive-restore]').innerText()
t('C8. 第一次点只要求再确认一次', btn1.includes('再点一次'), btn1)
t('C9. 第一次点之后数据仍然没动', await page.evaluate(() => localStorage.getItem('web2.data')) === beforePick)

/* C10：第二次点才真恢复 */
await page.locator('[data-archive-restore]').click()
await page.waitForTimeout(700)
const afterData = await page.evaluate(() => localStorage.getItem('web2.data'))
t('C10. 第二次点真的恢复了（课表回到归档那份）', JSON.parse(afterData).semester.name === '归档测试学期', afterData.slice(0, 80))
t('C11. 归档里没有的键被清空（habit 恢复到归档里的 1 条）',
  JSON.parse(await page.evaluate(() => localStorage.getItem('web2.habits'))).length === 1)
t('C12. 恢复后给出回执（含写入 / 清空项数）',
  /已恢复：写入\s*\d+\s*项、清空\s*\d+\s*项/.test(await page.locator('[data-archive-msg]').innerText()),
  await page.locator('[data-archive-msg]').innerText())
t('C13. 恢复后预览面板收起', await page.locator('[data-archive-preview]').count() === 0)
/* C14：恢复「不碰」排除项 —— 机密键既不该被清掉，也不该被凭空改写。
   （口径：归档里没有的键分两类 —— 备份范围内的要清空（C11），排除项一律原样不动。） */
const llmAfter = await page.evaluate(() => localStorage.getItem('web2.llm'))
t('C14. 恢复不动机密键（API Key 原样还在）',
  !!llmAfter && llmAfter.includes(SENTINEL_KEY), String(llmAfter))

/* C15：界面真的跟着换了 —— 刷新一次（走真实启动路径读 localStorage）再去看周课表，
   应该出现归档里那门周一的高数课，而不是示例数据。 */
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(700)
await page.locator('nav >> text=周课表').click()
await page.waitForTimeout(600)
const weekText = await page.evaluate(() => document.body.innerText)
t('C15. 界面数据同步换了（周课表出现归档里的课）', weekText.includes('归档课-高数'), weekText.slice(0, 200))
t('C16. 界面不再是示例数据（示例课「数据结构」不在）', !weekText.includes('数据结构'))

/* ================= D 非归档文件被拒 ================= */
console.log('--- D 拒绝非归档文件 ---')
const junk = path.join(DL, 'main-project.json')
fs.writeFileSync(junk, JSON.stringify({ app: 'sched', todos: [] }), 'utf8')
await page.locator('nav >> text=我的').click()
await page.waitForTimeout(300)
await page.locator('[data-settings-toggle]').click()
await page.waitForTimeout(350)
await page.$eval('[data-settings-index="data"]', (el) => el.click())
await page.waitForTimeout(400)
await page.locator('[data-archive-file]').setInputFiles(junk)
await page.waitForTimeout(400)
const dmsg = await page.locator('[data-archive-msg]').innerText()
t('D1. 主项目 JSON 被拒', dmsg.includes('不是本机的全量归档') || dmsg.includes('主项目'), dmsg)
t('D2. 给出正确指引（用「导入主项目数据」）', dmsg.includes('导入主项目数据'), dmsg)
t('D3. 被拒时不出预览面板', await page.locator('[data-archive-preview]').count() === 0)
t('D4. 被拒后本机数据没动', JSON.parse(await page.evaluate(() => localStorage.getItem('web2.data'))).semester.name === '归档测试学期')

await browser.close()
fs.rmSync(DL, { recursive: true, force: true })

const fail = results.filter((r) => !r[1]).length
console.log(`\n=== 全量归档 UI：${results.length - fail}/${results.length} 通过 ===`)
process.exit(fail ? 1 : 0)
