/* 核对页「整周网格预览」验证（2026-09-30 第六轮，用户定方案 A）。
   识别核对页 = 网格在上（一眼看排布 / 点空格加课 / 点课块改课）+ 逐条卡片在下；
   同一格两门课在格子上标红 + 顶部点名。正常页课表仍保留长按加课（防误触）。
   本脚本验的是可见的硬事实：落格几何、点格子弹层、加课/改课/删除、冲突标红、周末补列。
   假 fetch：只拦 api.deepseek.com（识别接口），其余放行。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

const URL = 'http://127.0.0.1:4177/'
const IMG = 'D:/Document/Project/vibe-coding-project/web2/tmp/rec-sample.jpg'
const LLM_CFG = JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-flash' })

/* 主场景：4 条识别结果 —— 周一 1-2 连堂（验跨行）、周三 3-4 两门重叠（验冲突）、周五 5 单节 */
const AI_MAIN = {
  courses: [
    { title: '高等数学', weekday: 1, startSec: 1, endSec: 2, weekRule: 'every', location: '教1-101' },
    { title: '大学物理', weekday: 3, startSec: 3, endSec: 4, weekRule: 'every', location: '教2-305' },
    { title: '程序设计实验', weekday: 3, startSec: 3, endSec: 4, weekRule: 'every', location: '信工楼401' },
    { title: '体育', weekday: 5, startSec: 5, endSec: 5, weekRule: 'every', location: '体育馆' },
  ],
  notes: [],
}
/* 周末场景：周六有课 → 列应自动补到 6 列 */
const AI_SAT = {
  courses: [
    { title: '体育', weekday: 6, startSec: 1, endSec: 2, weekRule: 'every', location: '操场' },
  ],
  notes: [],
}

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})

async function newPage(payload) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.addInitScript(`localStorage.setItem('web2.llm', ${JSON.stringify(LLM_CFG)})`)
  await page.addInitScript(`window.fetch = (function (orig) {
    return function (url, init) {
      if (String(url).indexOf('api.deepseek.com') !== -1) {
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ choices: [{ message: { content: ${JSON.stringify(JSON.stringify(payload))} } }] }) } });
      }
      return orig.apply(this, arguments);
    };
  })(window.fetch);`)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  return page
}
/* 引导页 → 第 3 步核对页（走真实路径：填学期 → 识别 → 核对） */
async function toRecConfirm(page) {
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
  await page.waitForTimeout(1100)
}
const box = async (page, sel) => await page.locator(sel).first().boundingBox()

try {
  const page = await newPage(AI_MAIN)
  await toRecConfirm(page)

  /* ---- A. 预览网格结构 ---- */
  t('A0. 进到了核对页（第 3 步）', (await page.locator('[data-ob-step]').getAttribute('data-ob-step')) === '3')
  t('A1. 核对页有整周预览网格', await page.locator('[data-rec-grid]').isVisible())
  t('A2. 无周末课时只画 5 列（周一~周五）', (await page.locator('[data-rcell="5-0"]').count()) === 1 && (await page.locator('[data-rcell="6-0"]').count()) === 0)
  t('A3. 行数 = 13 节（每列 13 个格子）', (await page.locator('[data-rcell]').count()) === 13 * 5, String(await page.locator('[data-rcell]').count()) + '/5')
  t('A4. 左侧栏是「第N节 + 时间」两行', (await page.locator('[data-raxis="1"]').innerText()).replace(/\s+/g, ' ').includes('08:00'))
  t('A5. 有午休/晚休分段行', (await page.locator('[data-rec-grid] [data-gap]').count()) >= 2)
  t('A6. 4 条识别结果都落了格', (await page.locator('[data-rcourse]').count()) === 4, String(await page.locator('[data-rcourse]').count()))

  /* ---- B. 落格几何：课块与格子对齐、连堂跨行 ---- */
  const cell1 = await box(page, '[data-rcell="1-0"]')   // 周一 第1节
  const cell2 = await box(page, '[data-rcell="1-1"]')   // 周一 第2节
  const math = await box(page, '[data-rcourse]:has-text("高等数学")')
  const rowH = cell2.y - cell1.y
  t('B1. 连堂课跨 2 行（高度 ≈ 2 个格子）', Math.abs(math.height - (cell1.height + rowH)) <= 4, `课块 ${math.height.toFixed(1)} / 两格 ${(cell1.height + rowH).toFixed(1)}`)
  t('B2. 课块左边界贴格子左边界（≤3px）', Math.abs(math.x - cell1.x) <= 3, `${math.x.toFixed(1)} vs ${cell1.x.toFixed(1)}`)
  t('B3. 课块顶边贴第 1 节格顶边（≤3px）', Math.abs(math.y - cell1.y) <= 3, `${math.y.toFixed(1)} vs ${cell1.y.toFixed(1)}`)
  const phys = await box(page, '[data-rcourse]:has-text("大学物理")')
  const c33 = await box(page, '[data-rcell="3-2"]')     // 周三 第3节
  t('B4. 周三的课落在第 3 节那一行', Math.abs(phys.y - c33.y) <= 3, `${phys.y.toFixed(1)} vs ${c33.y.toFixed(1)}`)
  t('B5. 同一格两门课横向平分（不叠在一起）', Math.abs(phys.width - c33.width / 2) <= 6, `课块 ${phys.width.toFixed(1)} / 半格 ${(c33.width / 2).toFixed(1)}`)

  /* ---- C. 冲突：格子标红 + 顶部点名 ---- */
  t('C1. 顶部出现冲突提示', await page.locator('[data-rec-conflict]').isVisible())
  const note = (await page.locator('[data-rec-conflict]').innerText()).replace(/\s+/g, '')
  t('C2. 提示点到具体位置与条数', note.includes('周三') && note.includes('第3-4节') && note.includes('2门课') && !note.includes('周周'), note)
  const physCls = await page.locator('[data-rcourse]:has-text("大学物理")').getAttribute('class')
  const progCls = await page.locator('[data-rcourse]:has-text("程序设计实验")').getAttribute('class')
  const mathCls = await page.locator('[data-rcourse]:has-text("高等数学")').getAttribute('class')
  t('C3. 重叠的两门课在格子上标红', physCls.includes('ring-red') && progCls.includes('ring-red'))
  t('C4. 不重叠的课不标红', !mathCls.includes('ring-red'))
  const cardHot = await page.locator('[data-rec-item]').nth(1).getAttribute('class')
  const cardCool = await page.locator('[data-rec-item]').nth(0).getAttribute('class')
  t('C5. 重叠的两条在下方卡片上也带红边', cardHot.includes('border-red-400') && !cardCool.includes('border-red-400'))
  t('C6. 卡片里说清怎么处理（留一门或改节次）', (await page.locator('[data-item-conflict]').count()) === 2, String(await page.locator('[data-item-conflict]').count()))

  /* ---- D. 点空格子 → 弹层加课 ---- */
  await page.locator('[data-rcell="4-3"]').click()      // 周四 第4节（空格）
  await page.waitForTimeout(450)
  t('D1. 点空格子弹出加课面板', await page.locator('[data-sheet-cell]').isVisible())
  const where = await page.locator('[data-cell-where]').innerText()
  t('D2. 面板标明点的是哪一格', where.includes('周四') && where.includes('第 4 节'), where)
  t('D3. 默认只问课名与地点（节次折叠）', (await page.locator('[data-cell-more-body]').count()) === 0)

  await page.locator('[data-cell-save]').click()
  await page.waitForTimeout(350)
  t('D4. 课名为空 → 就地报错且不关面板', (await page.locator('[data-cell-err]').count()) === 1 && (await page.locator('[data-sheet-cell]').isVisible()))
  await page.locator('[data-cell-title]').fill('形势与政策')
  await page.locator('[data-cell-place]').fill('线上')
  await page.locator('[data-cell-save]').click()
  await page.waitForTimeout(450)
  t('D5. 填好保存 → 面板关闭', (await page.locator('[data-sheet-cell]').count()) === 0)
  t('D6. 新加的课落进刚点的格子', (await page.locator('[data-rcourse]:has-text("形势与政策")').count()) === 1)
  const newBox = await box(page, '[data-rcourse]:has-text("形势与政策")')
  const c43 = await box(page, '[data-rcell="4-3"]')
  t('D7. 它落在周四第 4 节（几何对齐）', Math.abs(newBox.y - c43.y) <= 3 && Math.abs(newBox.x - c43.x) <= 3, `${newBox.y.toFixed(1)} vs ${c43.y.toFixed(1)}`)
  t('D8. 下方逐条卡片同步多了一条（4 → 5）', (await page.locator('[data-rec-item]').count()) === 5, String(await page.locator('[data-rec-item]').count()))

  /* ---- E. 点课块 → 同一个面板改课 ---- */
  await page.locator('[data-rcourse]:has-text("体育")').click()
  await page.waitForTimeout(450)
  t('E1. 点课块弹出改课面板', await page.locator('[data-sheet-cell]').isVisible())
  t('E2. 课名已预填', (await page.locator('[data-cell-title]').inputValue()) === '体育')
  t('E3. 地点已预填', (await page.locator('[data-cell-place]').inputValue()) === '体育馆')
  t('E4. 有删除入口（改课态才有）', await page.locator('[data-cell-del]').isVisible())

  const beforeY = (await box(page, '[data-rcourse]:has-text("体育")')).y
  await page.locator('[data-cell-more]').click()
  await page.waitForTimeout(300)
  t('E5. 「位置与节次」展开后才显示星期与节次控件', await page.locator('[data-cell-more-body]').isVisible() && (await page.locator('[data-cell-more-body] select').count()) === 2)
  t('E6. 星期选区有 7 个', (await page.locator('[data-cell-more-body] button').count()) === 7)
  await page.locator('[data-cell-from]').selectOption('5')
  await page.locator('[data-cell-to]').selectOption('6')
  await page.locator('[data-cell-save]').click()
  await page.waitForTimeout(450)
  const afterY = (await box(page, '[data-rcourse]:has-text("体育")')).y
  t('E7. 改成第 6-7 节后课块下移', afterY > beforeY + 20, `${beforeY.toFixed(1)} → ${afterY.toFixed(1)}`)
  /* 卡片里的课名是 input 的 value（:has-text 匹配不到），按顺序取第 4 条（体育） */
  const cardSpan = await page.locator('[data-rec-item]').nth(3).locator('select').nth(2).inputValue()
  t('E8. 下方卡片里的节次跟着变（同一条数据，5 → 6）', cardSpan === '6', cardSpan)

  /* ---- F. 卡片改课名 → 网格同步；取消勾选 → 课块变淡 ---- */
  await page.locator('[data-rec-item]').nth(3).locator('input').first().fill('体育（篮球）')
  await page.waitForTimeout(350)
  t('F1. 卡片改课名，网格课块跟着变', (await page.locator('[data-rcourse]:has-text("体育（篮球）")').count()) === 1)
  await page.locator('[data-rec-item]').nth(3).locator('button[aria-label="取消选择这门课"]').click()
  await page.waitForTimeout(300)
  const offCls = await page.locator('[data-rcourse]:has-text("体育（篮球）")').getAttribute('class')
  t('F2. 取消勾选的课在网格里变淡', offCls.includes('opacity-35'), offCls.match(/opacity-\S+/)?.[0] || '无 opacity 类')

  /* ---- G. 改课态删除 ---- */
  await page.locator('[data-rcourse]:has-text("形势与政策")').click()
  await page.waitForTimeout(400)
  await page.locator('[data-cell-del]').click()
  await page.waitForTimeout(400)
  t('G1. 面板里删除 → 该课从网格消失', (await page.locator('[data-rcourse]:has-text("形势与政策")').count()) === 0)
  t('G2. 卡片列表同步减少（5 → 4）', (await page.locator('[data-rec-item]').count()) === 4, String(await page.locator('[data-rec-item]').count()))
  t('G3. 删完面板自动关闭', (await page.locator('[data-sheet-cell]').count()) === 0)

  /* ---- H. 导入按钮仍按勾选数走 ---- */
  const importText = (await page.locator('[data-rec-import]').innerText()).replace(/\s+/g, '')
  t('H1. 导入按钮标出门数（取消勾选的那门不算）', importText.includes('3门课'), importText)

  /* ---- I. 周末有课 → 自动补列 ---- */
  const p2 = await newPage(AI_SAT)
  await toRecConfirm(p2)
  t('I1. 识别到周六课 → 列自动补到 6', (await p2.locator('[data-rcell="6-0"]').count()) === 1)
  t('I2. 补列后格子总数 = 13 × 6', (await p2.locator('[data-rcell]').count()) === 78, String(await p2.locator('[data-rcell]').count()))
  t('I3. 单门课不报冲突', (await p2.locator('[data-rec-conflict]').count()) === 0)

  /* ---- J. 正常页课表仍保留长按加课（防误触，本轮没改成点按） ---- */
  await p2.locator('[data-rec-import]').click()
  await p2.waitForTimeout(900)
  const cBefore = await p2.locator('[data-grid] article').count()
  await p2.locator('[data-cell="2-6"]').click()   // 正常页第 7 节空格：单击不该弹任何表单
  await p2.waitForTimeout(400)
  t('J1. 正常页课表单击空格子不加课（防误触）', (await p2.locator('[data-sheet-add]').count()) === 0)
  t('J2. 课数没变', (await p2.locator('[data-grid] article').count()) === cBefore)
  const b = await p2.locator('[data-cell="2-6"]').boundingBox()
  await p2.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await p2.mouse.down()
  await p2.waitForTimeout(800)
  await p2.mouse.up()
  await p2.waitForTimeout(400)
  t('J3. 长按仍能唤起添加课程表单', await p2.locator('[data-sheet-add]').isVisible())
} catch (e) {
  console.log('SCRIPT ERROR:', e && e.message)
  results.push(['脚本异常', false])
}

const fail = results.filter(([, ok]) => !ok)
console.log(`\n=== 核对页整周预览：${results.length - fail.length}/${results.length} 通过 ===`)
if (fail.length) console.log('失败项：' + fail.map((x) => x[0]).join(' / '))
process.exit(fail.length ? 1 : 0)
