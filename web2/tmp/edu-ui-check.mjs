/* P12a 界面端到端检查（390×844，真浏览器）
   验的是**界面那几步**（纯逻辑与落库已在 edu-import-check.mjs 的 A 段验过）：
     1) 设置页有「从教务导入课表」入口
     2) 选了文件之后**先出预览**，逐门课列出来，且此时**本机数据一个字没改**
     3) 没时间的课、注意事项、重复都在预览里说清楚
     4) 第一次点「确认导入」只改成红色警告文案、**仍然不写**；第二次点才真替换
     5) 替换后：课程变了、**待办还在**、设置页出现「恢复上一套课表」
     6) 点恢复 → 旧课表回来
     7) 全程零 pageerror

   跑法：先起 dist 静态服务（默认 4177）再 node tmp/edu-ui-check.mjs
        默认用内置的最小 xlsx（现造，不依赖用户 Downloads 里的真实文件）
        带真文件：TW_EDU_XLSX=<路径> node tmp/edu-ui-check.mjs
   产物：tmp/edu-ui-1-entry.png / -2-preview.png / -3-confirm.png / -4-after.png
   注意：playwright 会 spawn Chrome，沙箱下会被拦（EPERM），需要 danger-full-access。 */

let pass = 0
let fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

/* ---------- 现造一个最小的方正格式 xlsx（zip），不依赖用户文件 ---------- */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import { resolve } from 'node:path'

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function zipOf(files) {
  const chunks = []
  const central = []
  let offset = 0
  for (const [name, text] of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const raw = Buffer.from(text, 'utf8')
    const deflated = deflateRawSync(raw)
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, nameBuf, deflated)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(8, 10)
    cd.writeUInt32LE(0, 12)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(deflated.length, 20)
    cd.writeUInt32LE(raw.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cd, nameBuf]))
    offset += local.length + nameBuf.length + deflated.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, cdBuf, eocd])
}

const S = [
  '2026-2027学年秋冬学期测试用的课表',
  '课程代码', '课程名称', '教师姓名', '学期', '上课时间', '上课地点', '选课时间', '选课志愿',
  'EDU001', '课程一', '两位老师', '秋冬', '周一第1,2节;周三第3,4节{单周}', 'A楼101;B楼202', '2026-06-02 13:53:28', '1.0',
  'EDU002', '课程二', '老师乙', '冬', '', '', '2026-06-02 13:53:28', '1.0',
  'EDU001', '课程一', '两位老师', '秋冬', '周一第1,2节', 'A楼101', '2026-06-02 13:53:28', '1.0',
]
const shared = [...new Set(S)]
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const sst = '<?xml version="1.0" encoding="UTF-8"?><sst count="' + S.length + '" uniqueCount="' + shared.length + '" xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  shared.map((s) => '<si><t>' + esc(s) + '</t></si>').join('') + '</sst>'
const cell = (col, row, si) => `<c r="${col}${row}" t="s"><v>${shared.indexOf(si)}</v></c>`
const rowOf = (r, vals, withEmpty) => {
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
  let s = `<row r="${r}">`
  for (let i = 0; i < cols.length; i++) {
    const v = vals[i]
    if (v === '' || v === undefined) {
      /* 空单元格写成自闭合形式（真实文件就是这样，也顺带守着解析器那个坑） */
      if (withEmpty) s += `<c r="${cols[i]}${r}"/>`
    } else s += cell(cols[i], r, v)
  }
  return s + '</row>'
}
/* ⚠️ 每行必须给**满 8 个**值，且顺序与表头一一对应（课程代码在最前）。
   我第一版每行只给了 7 个（漏了课程代码），结果整行左移一列：课程名跑到「课程代码」列、
   上课时间跑到「学期」列 → 解析器认为所有行都没写时间 → 预览 0 门课 → 后面全崩。
   这个坑值得留着提醒：**自造样例时列数对不齐，症状会伪装成"解析器坏了"**。 */
const sheet =
  '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
  rowOf(1, [S[0]], false) +
  rowOf(2, [S[1], S[2], S[3], S[4], S[5], S[6], S[7], S[8]], false) +
  /* 一行两个时段（分号分），地点同理；第二个时段带 {单周} */
  rowOf(3, ['EDU001', '课程一', '两位老师', '秋冬', '周一第1,2节;周三第3,4节{单周}', 'A楼101;B楼202', '2026-06-02 13:53:28', '1.0'], true) +
  /* 没写上课时间 → 应当进「没进课表」清单 */
  rowOf(4, ['EDU002', '课程二', '老师乙', '冬', '', '', '2026-06-02 13:53:28', '1.0'], true) +
  /* 与第 3 行的「周一第1,2节」完全重复 → 应当被去重掉 */
  rowOf(5, ['EDU001', '课程一', '两位老师', '秋冬', '周一第1,2节', 'A楼101', '2026-06-02 13:53:28', '1.0'], true) +
  '</sheetData></worksheet>'
const wb =
  '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>'
const wbRels =
  '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'

mkdirSync('tmp', { recursive: true })
const genPath = 'tmp/edu-ui-fixture.xlsx'
writeFileSync(
  genPath,
  zipOf([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>'],
    ['xl/workbook.xml', wb],
    ['xl/_rels/workbook.xml.rels', wbRels],
    ['xl/sharedStrings.xml', sst],
    ['xl/worksheets/sheet1.xml', sheet],
  ]),
)
const xlsxPath = process.env.TW_EDU_XLSX || genPath
console.log((process.env.TW_EDU_XLSX ? '用真实文件：' : '用现造的最小 xlsx：') + xlsxPath)

/* ---------- 浏览器 ---------- */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
/* 也收 console：Vue 的警告/错误只走 console，不会变成 pageerror（历史教训）。 */
const logs = []
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ':' + m.text().slice(0, 200))
})

/* 种子：一份主项目导出文档（2 门旧课 + 1 条待办）+ 一门手动加的课。
   断言「待办还在」「手动加的课被清掉」都靠它。 */
const seed = {
  app: 'sched',
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 16 },
  schedules: [
    { id: 'old1', type: 'course', title: '旧课甲', weekday: 1, start_time: '08:00', duration: 95, week_rule: 'every', semester_id: 'sem1' },
    { id: 'old2', type: 'course', title: '旧课乙', weekday: 2, start_time: '10:00', duration: 95, week_rule: 'even', semester_id: 'sem1' },
  ],
  todos: [{ id: 't1', title: '把实验报告交了', done: false, due_date: '2026-10-10' }],
}
const added = [{ id: 'a1', type: 'course', name: '手动加的课', weekday: 5, start: '14:00', end: '15:40', added: true }]
await page.addInitScript(
  ([doc, add]) => {
    localStorage.setItem('web2.data', JSON.stringify(doc))
    localStorage.setItem('web2.added', JSON.stringify(add))
    localStorage.setItem('web2.onboarded', '1')
    localStorage.removeItem('web2.eduSnapshot')
  },
  [seed, added],
)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)

const dataNow = () => page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('web2.data') || '{}')
  const courses = (Array.isArray(d.schedules) ? d.schedules : []).filter((x) => x && x.type === 'course')
  return {
    courses: courses.map((c) => c.title),
    weeks: courses.map((c) => c.weeks || null),
    todos: (Array.isArray(d.todos) ? d.todos : []).map((t) => t.title),
    added: JSON.parse(localStorage.getItem('web2.added') || '[]').map((x) => x.name),
    snap: localStorage.getItem('web2.eduSnapshot') ? 1 : 0,
  }
})

/* 进「我的 → 设置」。
   ⚠️ 两个坑（2026-10-06 都踩过）：
   ① `[data-nav]` 的顺序/存在性不确定，点击前先等它出现，别假设页面已经渲染好；
   ② 点了「我的」之后要等**索引页真的在**（`[data-me-entry="settings"]` 可见）再点，
      否则第二次点击落空、人还留在今日页 —— 症状是后面所有断言都读不到设置页的东西，
      看起来完全像「新功能没做出来」，其实是测试自己没走到那个页。 */
await page.waitForSelector('[data-nav="me"]', { timeout: 8000 })
await page.$eval('[data-nav="me"]', (el) => el.click())
await page.waitForSelector('[data-me-entry="settings"]', { state: 'visible', timeout: 8000 })
await page.$eval('[data-me-entry="settings"]', (el) => el.click())
await page.waitForSelector('[data-edu-file]', { state: 'attached', timeout: 8000 })
await page.waitForTimeout(300)

t('1. 设置页有「从教务导入课表」入口', (await page.locator('[data-edu-file]').count()) === 1)
t('1b. 一开始没有「恢复上一套课表」（没换过就不摆这个按钮）', (await page.locator('[data-edu-restore]').count()) === 0)
await page.locator('[data-edu-file]').scrollIntoViewIfNeeded().catch(() => {})
await page.screenshot({ path: 'tmp/edu-ui-1-entry.png' })

const before = await dataNow()
t('2. 起点：2 门旧课 + 1 条待办 + 1 门手动加的课', before.courses.length === 2 && before.todos.length === 1 && before.added.length === 1, JSON.stringify(before))

/* 选文件（绕过系统文件选择器，直接给 input 设文件）。
   ⚠️ 必须给**绝对路径**：相对路径是按 playwright-core 模块所在位置解析的，不是 cwd，
   踩过 —— 文件没送到，`change` 根本没触发，表现为「预览一直不出现」，看起来像产品坏了。 */
await page.setInputFiles('[data-edu-file]', resolve(xlsxPath))
try {
  await page.waitForSelector('[data-edu-preview]', { timeout: 8000 })
} catch (e) {
  /* 超时就地打印诊断：把错因说清楚，别让人以为预览功能坏了。
     注意两个「看着像 bug 其实不是」的点（2026-10-06 各耽误过一轮）：
     ① `files.length` 一定是 0 —— 因为 `onEduFile` 开头就 `e.target.value = ''`（允许重选同一文件），
        这个数**不能**用来判断「文件送没送到」；
     ② `document.body.innerText` 的前 160 字一定是**今日页**的内容（#app 在 DOM 里排在 Teleport 之前），
        也不能用来判断「设置页开没开」。
     真正有用的是：解析异常的回执（在浮层外面那个 `[data-edu-msg-out]`）与 console。 */
  const diag = await page.evaluate(() => ({
    previewEls: document.querySelectorAll('[data-edu-preview]').length,
    subPage: (() => {
      const s = document.querySelector('[data-sub]')
      return s ? s.getAttribute('data-sub') : null
    })(),
    msgOut: (document.querySelector('[data-edu-msg-out]') || {}).textContent || '',
    bodyLen: String(document.body.innerText || '').length,
  }))
  await page.screenshot({ path: 'tmp/edu-ui-diag.png' }).catch(() => {})
  console.log('DIAG | 预览没出现：' + JSON.stringify(diag))
  console.log('DIAG | pageerror=' + JSON.stringify(errors.slice(0, 3)))
  console.log('DIAG | console=' + JSON.stringify(logs.slice(0, 6)))
  throw e
}
await page.waitForTimeout(300)

t('3. 选完文件先出**预览**，不直接写', (await page.locator('[data-edu-preview]').count()) === 1)
const mid = await dataNow()
t('4. **确认之前本机数据一个字没改**',
  JSON.stringify(mid.courses) === JSON.stringify(before.courses) && mid.todos.length === 1 && mid.added.length === 1 && mid.snap === 0,
  JSON.stringify(mid))
/* 2 条 = 周一第1,2节 + 周三第3,4节{单周}（同一门课拆两段）；第 3 行是**完全重复**的那条，
   去重掉；「课程二」没写时间，进下面单独的「没进课表」清单，不算上课记录。
   （断言数原来写成 3，是我算错了——fixture 自己跑解析器就是 2 条，这里跟着对齐。） */
const rows = await page.locator('[data-edu-row]').count()
const countTxt = await page.locator('[data-edu-count]').innerText()
t('5. 预览里逐门课列出来（两段上课记录，重复那条不进）', rows === 2, `rows=${rows} | ${countTxt.replace(/\s+/g, ' ')}`)
t('5b. 汇总里报出去掉了几条完全重复的', /去掉了\s*1\s*条/.test(countTxt.replace(/\s+/g, ' ')), countTxt.replace(/\s+/g, ' '))
t('6. 单周课在预览里显示成「单周」而不是「每周」',
  (await page.locator('[data-edu-week]').allInnerTexts()).some((x) => x.indexOf('单周') >= 0),
  JSON.stringify(await page.locator('[data-edu-week]').allInnerTexts()))
t('7. 没写时间的课单独列出来、并说清原因',
  (await page.locator('[data-edu-notime]').count()) === 1
  && /没进课表/.test(await page.locator('[data-edu-notime]').innerText())
  && /课程二/.test(await page.locator('[data-edu-notime]').innerText()),
  (await page.locator('[data-edu-notime]').innerText().catch(() => '')).replace(/\s+/g, ' '))
t('8. 「需要注意」清单在（小学期/重复/无时间都有交代）', (await page.locator('[data-edu-notes]').count()) === 1)
await page.screenshot({ path: 'tmp/edu-ui-2-preview.png' })

/* 第一次点确认：只该亮警告，不该写 */
await page.locator('[data-edu-confirm]').click()
await page.waitForTimeout(300)
const firstClick = await dataNow()
const btnTxt = await page.locator('[data-edu-confirm]').innerText()
t('9. 第一次点确认 → 文案变成「再点一次」，**仍然没写**',
  /再点一次/.test(btnTxt) && JSON.stringify(firstClick.courses) === JSON.stringify(before.courses) && firstClick.snap === 0,
  `btn="${btnTxt.trim()}" | ${JSON.stringify(firstClick)}`)
await page.screenshot({ path: 'tmp/edu-ui-3-confirm.png' })

/* 第二次点：真替换 */
await page.locator('[data-edu-confirm]').click()
await page.waitForTimeout(600)
const after = await dataNow()
t('10. 第二次点 → 课程换成教务那套（旧课没了）',
  after.courses.length === 2 && after.courses.indexOf('旧课甲') === -1 && after.courses.indexOf('旧课乙') === -1,
  JSON.stringify(after.courses))
t('11. 单周的课在数据里带上了显式周次集合',
  after.weeks.some((w) => Array.isArray(w) && w.length > 2 && w.every((x) => x % 2 === 1)), JSON.stringify(after.weeks))
t('12. **待办还在**（只换课程，不动待办）', after.todos.length === 1 && after.todos[0] === '把实验报告交了', JSON.stringify(after.todos))
t('13. 手动加的课被清掉（不然会和新课表叠）', after.added.length === 0, JSON.stringify(after.added))
t('14. 快照已存下', after.snap === 1)
t('15. 预览浮层收起来了', (await page.locator('[data-edu-preview]').count()) === 0)
await page.screenshot({ path: 'tmp/edu-ui-4-after.png' })

/* 恢复 */
t('16. 设置页出现「恢复上一套课表」', (await page.locator('[data-edu-restore]').count()) === 1)
await page.locator('[data-edu-restore]').click()
await page.waitForTimeout(600)
const back = await dataNow()
t('17. 恢复后旧课表回来、手动加的课也回来、快照用掉',
  back.courses.length === 2 && back.courses.indexOf('旧课甲') >= 0 && back.added.length === 1 && back.snap === 0,
  JSON.stringify(back))
t('18. 全程零 pageerror', errors.length === 0, JSON.stringify(errors.slice(0, 2)))

await browser.close()
console.log(`\n教务导入界面检查：${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
