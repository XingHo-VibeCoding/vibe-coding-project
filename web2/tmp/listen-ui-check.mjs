/* 碎片练耳 UI 检查（playwright，走 dist 静态服务）
   四期 Day 18：覆盖 L1（导入 + 列表 + 刷新不丢）、放满遍数**自动**记一次已听（2026-10-03 用户决策，
   手工「已听」按钮已去掉）、暂停/继续保留遍数与断点、
   会话内连放（repeatTimes），以及 L3/L4（复习到点提醒排练程 + 到点提醒开关 + 点通知只提醒不自动播放），
   另有 M 段：练耳设置面板（连放遍数 / 复习间隔 / 勿扰跨零点 / 两个空档阈值 / 非法输入不写库 / 恢复默认）。
   跑法：先起 dist 静态服务（默认 4177，可用 TW_URL 覆盖）再 node tmp/listen-ui-check.mjs
   注意：playwright 会 spawn Chrome，沙箱下会被拦（EPERM），需要 danger-full-access。 */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
let pass = 0, fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}
function dkey(offsetDays = 0) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
/* 最小可用的 WAV（1 秒静音，44 字节头 + 8000 字节数据）——只用于验证导入链路，不做真实播放 */
function wavBuffer() {
  const dataLen = 8000
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28); buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34)
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40)
  return buf
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url()) })

/* Stage 6：「我的」页改成索引页，练耳功能搬进全屏二级页 [data-sub-page][data-sub="listen"]。
   所有以 [data-page="me"] 为域的 locator 换成二级页内容容器 [data-sub-body]；
   进入路径固定为：切「我的」tab（程序化点击，避开非当前页 inert 吃掉真实鼠标）→ 点 [data-me-entry="listen"]，
   卡片默认收起，再点二级页里的「打开」。 */
function listenHelpers(pg) {
  const body = pg.locator('[data-sub-body]')
  const enter = async () => {
    await pg.$eval('[data-nav="me"]', (el) => el.click())
    await pg.waitForTimeout(250)
    await pg.$eval('[data-me-entry="listen"]', (el) => el.click())
    await pg.waitForTimeout(300)
  }
  const openCard = async () => {
    if ((await body.locator('[data-listen-import]').count()) === 0) {
      await body.locator('button', { hasText: '打开' }).first().click()
      await pg.waitForTimeout(300)
    }
  }
  return { body, enter, openCard, enterOpen: async () => { await enter(); await openCard() } }
}

/* 预置一条「拖期」记录：stage=1 → 下一次间隔应为 reviewIntervals[1] = 2 天。
   注意：addInitScript **每次导航都会重跑**，所以必须用哨兵把种子限制成只灌一次，
   否则 reload 会把种子重新写回 localStorage，看起来像"改了没持久化"（E2 踩过）。 */
await page.addInitScript((seed) => {
  localStorage.setItem('web2.onboarded', '1')
  if (!sessionStorage.getItem('seed-done')) {
    sessionStorage.setItem('seed-done', '1')
    localStorage.setItem('web2.listen', JSON.stringify(seed))
  }
}, [{
  id: 'lis_seed1', name: '种子音频', file: 'seed.mp3', seconds: 45, played_count: 2,
  last_played_at: null, review_stage: 1, next_due_date: '2026-10-01', repeat_times: null,
  archived: false, created_at: '2026-09-30T00:00:00.000Z',
}])

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)

const ME_INDEX = page.locator('main[data-page="me"]')
const H = listenHelpers(page)
const ME = H.body
const enterListen = H.enter
const openListenCard = H.openCard
await page.$eval('[data-nav="me"]', (el) => el.click())
await page.waitForTimeout(250)

/* ===== A. 入口 ===== */
t('A1. 「我的」索引页有「碎片练耳」入口', (await ME_INDEX.locator('section', { hasText: '碎片练耳' }).count()) >= 1)
await enterListen()
t('A2. 二级页默认收起（导入控件不可见）', (await ME.locator('[data-listen-import]').count()) === 0)
await openListenCard()
t('A3. 展开后出现导入控件', (await ME.locator('[data-listen-import]').count()) === 1)
t('A4. 文件选择框对用户隐藏（label 触发）', await ME.locator('[data-listen-import]').isHidden())

/* ===== B. 列表渲染（已听次数 / 时长 / 复习状态） ===== */
t('B1. 列表渲染出种子音频', (await ME.locator('li', { hasText: '种子音频' }).count()) === 1)
const seedRow = ME.locator('li', { hasText: '种子音频' }).first()
const seedText = await seedRow.innerText()
t('B2. 显示已听次数 2 次', seedText.includes('已听 2 次'), seedText)
t('B3. 显示时长 0:45', seedText.includes('0:45'), seedText)
t('B4. 拖期提示', seedText.includes('拖了'), seedText)
t('B5. 手工「已听」按钮已去掉（改为放满遍数自动记账）', (await seedRow.locator('button', { hasText: '已听' }).count()) === 0)
const slotsText = await ME.locator('[data-listen-slots]').first().innerText()
t('B6. 显示今日空闲槽建议（L2）', slotsText.includes('今天可听'), slotsText)
t('B7. 建议含时段与段数', /\d{2}:\d{2}–\d{2}:\d{2} · \d+ 分钟 · .+ → 放 \d+ 段/.test(slotsText), slotsText)

/* ===== C. 自动记账：没有手工入口时，记录一动不动 ===== */
const stored0 = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.listen') || '[]')[0])
t('C1. 种子记录的复习排期原样未动（stage=1 / 已听 2 次）',
  stored0.review_stage === 1 && stored0.played_count === 2, JSON.stringify({ stage: stored0.review_stage, played: stored0.played_count }))
t('C2. next_due_date 仍是原值 2026-10-01', stored0.next_due_date === '2026-10-01', String(stored0.next_due_date))

/* ===== M. 练耳设置面板（遍数 / 复习间隔 / 勿扰 / 空档阈值） ===== */
const setOf = () => page.evaluate(() => JSON.parse(localStorage.getItem('web2.listen.set') || '{}'))
const openSettings = async () => {
  if ((await ME.locator('[data-listen-settings]').count()) === 0) {
    await ME.locator('[data-listen-settings-toggle]').first().click()
    await page.waitForTimeout(250)
  }
}
t('M1. 有「练耳设置」展开入口', (await ME.locator('[data-listen-settings-toggle]').count()) === 1)
await openSettings()
t('M2. 展开后有设置区', (await ME.locator('[data-listen-settings]').count()) === 1)
t('M3. 连放遍数默认 3 遍高亮',
  ((await ME.locator('[data-listen-repeat="3"]').first().getAttribute('class')) || '').includes('bg-primary-500'))
await ME.locator('[data-listen-repeat="5"]').first().click()
await page.waitForTimeout(250)
t('M4. 选 5 遍后落库 repeatTimes=5', (await setOf()).repeatTimes === 5, JSON.stringify(await setOf()))
t('M5. 5 遍按钮接管高亮',
  ((await ME.locator('[data-listen-repeat="5"]').first().getAttribute('class')) || '').includes('bg-primary-500'))
const ivEl = ME.locator('[data-listen-intervals]').first()
t('M6. 复习间隔回显默认 6 档', (await ivEl.inputValue()) === '1,2,4,7,15,30', await ivEl.inputValue())
await ivEl.fill('1,3')
await ivEl.dispatchEvent('change')
await page.waitForTimeout(250)
t('M7. 改成 1,3 后落库', JSON.stringify((await setOf()).reviewIntervals) === '[1,3]', JSON.stringify((await setOf()).reviewIntervals))
await ivEl.fill('全是垃圾abc')
await ivEl.dispatchEvent('change')
await page.waitForTimeout(250)
t('M8. 非法间隔不写库（仍是 1,3）', JSON.stringify((await setOf()).reviewIntervals) === '[1,3]')
t('M9. 非法输入被回退成当前值', (await ivEl.inputValue()) === '1,3', await ivEl.inputValue())
const dndS = ME.locator('[data-listen-dnd-start]').first()
const dndE = ME.locator('[data-listen-dnd-end]').first()
t('M10. 勿扰回显默认 23:00–07:00',
  (await dndS.inputValue()) === '23:00' && (await dndE.inputValue()) === '07:00',
  `${await dndS.inputValue()}–${await dndE.inputValue()}`)
await dndS.fill('22:00'); await dndS.dispatchEvent('change'); await page.waitForTimeout(200)
await dndE.fill('06:30'); await dndE.dispatchEvent('change'); await page.waitForTimeout(200)
const dndSet = await setOf()
t('M11. 勿扰跨零点改动落库（22:00–06:30）', dndSet.dndStart === '22:00' && dndSet.dndEnd === '06:30', JSON.stringify({ s: dndSet.dndStart, e: dndSet.dndEnd }))
const sg = ME.locator('[data-listen-short-gap]').first()
const sm = ME.locator('[data-listen-slot-min]').first()
t('M12. 两个阈值回显默认 10 / 5',
  (await sg.inputValue()) === '10' && (await sm.inputValue()) === '5',
  `${await sg.inputValue()}/${await sm.inputValue()}`)
await sg.fill('15'); await sg.dispatchEvent('change'); await page.waitForTimeout(200)
await sm.fill('8'); await sm.dispatchEvent('change'); await page.waitForTimeout(200)
const numSet = await setOf()
t('M13. 阈值改动落库 15 / 8', numSet.shortGapMaxMin === 15 && numSet.slotMinMin === 8, JSON.stringify({ g: numSet.shortGapMaxMin, s: numSet.slotMinMin }))
await ME.locator('[data-listen-settings-reset]').first().click()
await page.waitForTimeout(300)
const resetSet = await setOf()
t('M14. 恢复默认：遍数 3 / 间隔 6 档 / 勿扰 23:00–07:00 / 阈值 10-5',
  resetSet.repeatTimes === 3 && JSON.stringify(resetSet.reviewIntervals) === '[1,2,4,7,15,30]'
  && resetSet.dndStart === '23:00' && resetSet.dndEnd === '07:00'
  && resetSet.shortGapMaxMin === 10 && resetSet.slotMinMin === 5,
  JSON.stringify(resetSet))
t('M15. 恢复默认后输入框也回显默认值',
  (await ivEl.inputValue()) === '1,2,4,7,15,30' && (await dndS.inputValue()) === '23:00'
  && (await sg.inputValue()) === '10',
  `${await ivEl.inputValue()} / ${await dndS.inputValue()} / ${await sg.inputValue()}`)

/* ===== D. 导入（L1） ===== */
await ME.locator('[data-listen-import]').setInputFiles({ name: '我的听力材料.wav', mimeType: 'audio/wav', buffer: wavBuffer() })
await page.waitForTimeout(700)
const newRow = ME.locator('li', { hasText: '我的听力材料' })
t('D1. 导入后列表出现该音频（文件名去掉扩展名）', (await newRow.count()) === 1)
const newText = await newRow.first().innerText()
t('D2. 新导入记录「今天该听」', newText.includes('今天该听'), newText)
t('D3. 新导入已听 0 次', newText.includes('已听 0 次'), newText)
t('D4. 新导入有「播放」按钮（不再需要先点「已听」）', (await newRow.first().locator('[data-listen-play]').count()) === 1)
t('D5. 落盘 2 条记录', (await page.evaluate(() => JSON.parse(localStorage.getItem('web2.listen') || '[]').length)) === 2)
t('D6. 浏览器提示「刷新后要重新导入」', (await ME.locator('p', { hasText: '刷新后要重新导入' }).count()) === 1)

/* ===== E. 刷新重开不丢（L1 硬要求） ===== */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await enterListen()
await openListenCard()
const reloadText = await ME.locator('li', { hasText: '种子音频' }).first().innerText()
t('E1. 刷新后列表仍在', (await ME.locator('li', { hasText: '种子音频' }).count()) === 1)
t('E2. 刷新后已听次数仍是 2（自动记账没被触发过）', reloadText.includes('已听 2 次'), reloadText)

/* ===== F. 无到期音频时的空态（L2 的另一种分支） ===== */
await page.evaluate((seed) => {
  localStorage.setItem('web2.listen', JSON.stringify(seed))
}, [{
  id: 'lis_future', name: '未来音频', file: 'future.mp3', seconds: 40, played_count: 1,
  last_played_at: null, review_stage: 1, next_due_date: '2026-12-31', repeat_times: null,
  archived: false, created_at: '2026-09-30T00:00:00.000Z',
}])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await enterListen()
await openListenCard()
const emptySlotsText = await ME.locator('[data-listen-slots]').first().innerText()
t('F1. 今天没有到期音频时的提示', emptySlotsText.includes('没有到期'), emptySlotsText)
t('F2. 不显示「今天可听」', !emptySlotsText.includes('今天可听'), emptySlotsText)

/* ===== G. 无页面报错 ===== */
t('G1. 无页面报错 / 无 4xx-5xx 资源', errors.length === 0, errors.slice(0, 3).join(' | '))

/* ===== H. 真机路径（Step 7）：App 模式下落盘 listen/<文件名> =====
   注入假 Filesystem 桥（同 notify-ui-check 的范式）：验的是**网页侧与插件的契约**
   （真机才验得了文件真的躺进 getFilesDir()）。 */
const appCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const appPage = await appCtx.newPage()
const appErrors = []
appPage.on('pageerror', (e) => appErrors.push(String(e)))
appPage.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) appErrors.push('HTTP ' + r.status() + ' ' + r.url()) })
await appPage.addInitScript(() => {
  /* 假 Filesystem 桥 —— **按真插件语义建模**（2026-10-03 真机 bug 的教训）：
     插件定义原文：writeFile.encoding "If not provided, data is written as base64 encoded.
     Pass Encoding.UTF8 to write data as string"；readFile 同理（不传 = 二进制、回 base64）。
     所以这里：**不传 encoding → 按 base64 解码成字节**；**传了 encoding → 当字符串写**。
     上一版假桥是「看到 encoding==='base64' 就解码」——等于替代码把错误圆过去了，
     真机上照样写坏（大小 4/3）。假桥必须和真插件一样"不配合"。 */
  const files = new Map()
  const bytesOf = (data, encoding) => {
    const s = String(data == null ? '' : data)
    if (encoding) return new TextEncoder().encode(s)   // 当字符串写（UTF-8）
    const bin = atob(s)                                // 不传 encoding：按 base64 解码
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  const b64Of = (bytes) => {
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return btoa(s)
  }
  window.__listenFs = { writes: [], mkdirs: [], getUris: [], deletes: [], reads: [], stats: [] }
  window.Capacitor = {
    isNativePlatform: () => true,
    convertFileSrc: (p) => 'https://localhost/_capacitor_file_' + p,
    Plugins: {
      Filesystem: {
        mkdir: async (o) => { window.__listenFs.mkdirs.push(o) },
        writeFile: async (o) => {
          const bytes = bytesOf(o.data, o.encoding)
          files.set(o.path, bytes)
          window.__listenFs.writes.push(Object.assign({}, o, { _bytes: bytes.length }))
        },
        getUri: async (o) => { window.__listenFs.getUris.push(o); return { uri: 'file:///data/user/0/app/files/' + o.path } },
        /* 真的从"盘"上回吐：不传 encoding 回 base64（与真插件一致）。
           这样「写进去的字节」和「读出来的字节」必须自己兜得上——
           上一版直接回吐注入的 cfg.b64，等于不管写坏没写坏都说"读得到"。 */
        readFile: async (o) => {
          window.__listenFs.reads.push(o)
          const bytes = files.get(o.path)
          if (!bytes) { const e = new Error('File does not exist'); e.code = 'NOT_FOUND'; throw e }
          return { data: o.encoding ? new TextDecoder().decode(bytes) : b64Of(bytes) }
        },
        stat: async (o) => {
          window.__listenFs.stats.push(o)
          const bytes = files.get(o.path)
          if (!bytes) { const e = new Error('File does not exist'); e.code = 'NOT_FOUND'; throw e }
          return { size: bytes.length }
        },
        deleteFile: async (o) => { window.__listenFs.deletes.push(o); files.delete(o.path) },
      },
    },
  }
  localStorage.setItem('web2.onboarded', '1')
})
await appPage.goto(BASE, { waitUntil: 'domcontentloaded' })
await appPage.waitForTimeout(700)
const APP_H = listenHelpers(appPage)
const APP_ME = APP_H.body
await APP_H.enterOpen()

await APP_ME.locator('[data-listen-import]').setInputFiles({ name: '真机材料.wav', mimeType: 'audio/wav', buffer: wavBuffer() })
await appPage.waitForTimeout(1000)
/* 导入之后才断言"没有浏览器黄字"——列表为空时那句话本来就不显示，放导入前等于假通过 */
t('H1. App 模式导入后不出现「刷新后要重新导入」黄字', (await APP_ME.locator('p', { hasText: '刷新后要重新导入' }).count()) === 0)
const fsLog = await appPage.evaluate(() => ({ writes: window.__listenFs.writes, mkdirs: window.__listenFs.mkdirs }))
const w0 = fsLog.writes[0]
t('H2. 触发了一次 writeFile', fsLog.writes.length === 1, JSON.stringify(fsLog.writes.map((w) => w.path)))
t('H3. 落盘路径 = listen/<文件名>', w0 && w0.path === 'listen/真机材料.wav', w0 && w0.path)
t('H4. 目录 = DATA（应用私有目录，同课堂录音）', w0 && w0.directory === 'DATA', w0 && w0.directory)
t('H5. 落盘**不传** encoding（传了会被当字符串写）且落盘字节数 = 原文件字节数',
  !!w0 && w0.encoding === undefined && w0._bytes === wavBuffer().length && w0.data === wavBuffer().toString('base64'),
  'encoding=' + (w0 && w0.encoding) + ' 落盘字节=' + (w0 && w0._bytes) + ' 原文件字节=' + wavBuffer().length)
t('H6. 先建了 listen 子目录', fsLog.mkdirs.some((m) => m.path === 'listen'))
t('H7. 记录仍落 localStorage（本机数据）', (await appPage.evaluate(() => JSON.parse(localStorage.getItem('web2.listen') || '[]').length)) === 1)
t('H8. 成功文案写明已存到本机', (await APP_ME.locator('p', { hasText: '存到本机' }).count()) >= 1)
/* 点「播放」→ 修复后的主路径：读盘拿字节 → 自造 Blob URL → 播（不再走 _capacitor_file_） */
await APP_ME.locator('li', { hasText: '真机材料' }).first().locator('[data-listen-play]').click()
await appPage.waitForTimeout(700)
const fsLog2 = await appPage.evaluate(() => ({ reads: window.__listenFs.reads, uris: window.__listenFs.getUris, stats: window.__listenFs.stats }))
const rd0 = fsLog2.reads[0]
t('H10. App 模式点播放 → 按 listen/<file> 读字节（DATA、不传 encoding）', fsLog2.reads.length === 1 && !!rd0 && rd0.path === 'listen/真机材料.wav' && rd0.directory === 'DATA' && rd0.encoding === undefined, JSON.stringify(fsLog2.reads))
t('H11. 播放不再依赖 getUri + convertFileSrc（真机上就是它报不支持的源）', fsLog2.uris.length === 0, JSON.stringify(fsLog2.uris))
t('H12. 读到字节后真的播起来（按钮变「停止」）', (await APP_ME.locator('li', { hasText: '真机材料' }).first().locator('[data-listen-play]').innerText()).trim() === '停止')
t('H13. 导入后回读大小核对**通过**（stat 被调用，且没报「大小对不上」）',
  fsLog2.stats.length >= 1 && (await APP_ME.locator('p', { hasText: '大小对不上' }).count()) === 0,
  JSON.stringify(fsLog2.stats))
t('H14. 没有出现「播不了」红字', (await APP_ME.locator('p', { hasText: '播不了' }).count()) === 0)
t('H9. App 模式无页面报错', appErrors.length === 0, appErrors.slice(0, 3).join(' | '))

/* ===== I. 播放（浏览器模式：导入后当次会话内可播，且不推进进度） ===== */
const pctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const ppage = await pctx.newPage()
const pErrors = []
ppage.on('pageerror', (e) => pErrors.push(String(e)))
await ppage.addInitScript(() => { localStorage.setItem('web2.onboarded', '1') })
await ppage.goto(BASE, { waitUntil: 'domcontentloaded' })
await ppage.waitForTimeout(700)
const P_H = listenHelpers(ppage)
const P_ME = P_H.body
await P_H.enterOpen()
await P_ME.locator('[data-listen-import]').setInputFiles({ name: '试听音频.wav', mimeType: 'audio/wav', buffer: wavBuffer() })
await ppage.waitForTimeout(900)
const prow = P_ME.locator('li', { hasText: '试听音频' }).first()
t('I1. 每条有「播放」按钮', (await prow.locator('[data-listen-play]').count()) === 1)
t('I2. 初始是「播放」', (await prow.locator('[data-listen-play]').innerText()).trim() === '播放')
await prow.locator('[data-listen-play]').click()
await ppage.waitForTimeout(600)
t('I3. 点后变「停止」（正在播）', (await prow.locator('[data-listen-play]').innerText()).trim() === '停止')
t('I4. 播放**不**推进已听次数（仍 0 次）', (await prow.innerText()).includes('已听 0 次'), await prow.innerText())
await prow.locator('[data-listen-play]').click()
await ppage.waitForTimeout(300)
t('I5. 再点变「继续」（停止=暂停，遍数与断点都留着）', (await prow.locator('[data-listen-play]').innerText()).trim() === '继续')
await prow.locator('[data-listen-play]').click()
await ppage.waitForTimeout(300)
t('I5b. 点「继续」又变回「停止」（真的接着放了）', (await prow.locator('[data-listen-play]').innerText()).trim() === '停止')
t('I6. 浏览器模式无页面报错', pErrors.length === 0, pErrors.slice(0, 3).join(' | '))

/* ===== J. 会话内重复（repeatTimes 默认 3）：连放 3 遍、放完自停、且不推进进度 ===== */
const rctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const rpage = await rctx.newPage()
const rErrors = []
rpage.on('pageerror', (e) => rErrors.push(String(e)))
await rpage.addInitScript(() => { localStorage.setItem('web2.onboarded', '1') })
await rpage.goto(BASE, { waitUntil: 'domcontentloaded' })
await rpage.waitForTimeout(700)
const R_H = listenHelpers(rpage)
const R_ME = R_H.body
await R_H.enterOpen()
await R_ME.locator('[data-listen-import]').setInputFiles({ name: '连放测试.wav', mimeType: 'audio/wav', buffer: wavBuffer() })
await rpage.waitForTimeout(900)
const rrow = R_ME.locator('li', { hasText: '连放测试' }).first()
const roundOf = async () => ((await rrow.locator('[data-listen-round]').count())
  ? (await rrow.locator('[data-listen-round]').innerText()).trim()
  : '')
const waitRound = async (want, ms) => {
  const end = Date.now() + ms
  for (;;) {
    if ((await roundOf()) === want) return true
    if (Date.now() > end) return false
    await rpage.waitForTimeout(120)
  }
}
await rrow.locator('[data-listen-play]').click()
await rpage.waitForTimeout(400)
t('J1. 播放时显示「第 1/3 遍」（默认连放 3 遍）', (await roundOf()) === '第 1/3 遍', await roundOf())
t('J2. 一遍放完自动接上第 2/3 遍', await waitRound('第 2/3 遍', 4000))
t('J3. 再放完接上第 3/3 遍', await waitRound('第 3/3 遍', 4000))
t('J4. 放满 3 遍后自停（按钮回「播放」、轮次提示消失）',
  (await waitRound('', 6000)) && (await rrow.locator('[data-listen-play]').innerText()).trim() === '播放',
  await rrow.innerText())
await rpage.waitForTimeout(400)
t('J5. 放满 3 遍 → **自动**记一次已听（2 遍不算，放满才算）', (await rrow.innerText()).includes('已听 1 次'), await rrow.innerText())
const jStored = await rpage.evaluate(() => JSON.parse(localStorage.getItem('web2.listen') || '[]').find((x) => x.name === '连放测试'))
t('J5b. 到复习日 → 档位推进到 1、下次复习 = 今天 + intervals[0]=1 天',
  !!jStored && jStored.review_stage === 1 && jStored.next_due_date === dkey(1), JSON.stringify(jStored))
t('J5c. 行里不再有手工「已听」按钮', (await rrow.locator('button', { hasText: '已听' }).count()) === 0)
t('J6. 无页面报错', rErrors.length === 0, rErrors.slice(0, 3).join(' | '))

/* ===== L. 修 bug：停止 = 暂停（遍数与断点保留），再点「继续」接着放 ===== */
await rrow.locator('[data-listen-play]').click()
await rpage.waitForTimeout(400)
t('L1. 重新播放从第 1/3 遍开始', (await roundOf()) === '第 1/3 遍', await roundOf())
await rrow.locator('[data-listen-play]').click()
await rpage.waitForTimeout(300)
t('L2. 点「停止」后按钮变「继续」', (await rrow.locator('[data-listen-play]').innerText()).trim() === '继续')
t('L3. 停止后遍数提示**不清空**（用户反馈的 bug：原来说"播放次数会清空"）', (await roundOf()) === '第 1/3 遍', await roundOf())
await rrow.locator('[data-listen-play]').click()
await rpage.waitForTimeout(300)
t('L4. 点「继续」回到「停止」（从断点接着放）', (await rrow.locator('[data-listen-play]').innerText()).trim() === '停止', await rrow.locator('[data-listen-play]').innerText())
t('L5. 暂停/继续期间不重复记账（仍 1 次）', (await rrow.innerText()).includes('已听 1 次'), await rrow.innerText())

/* ===== K. 复习到点提醒（L4）与通知（L3）：App 模式排练耳通知，与课前提醒互不干扰 =====
   注入假 LocalNotifications 桥（同 notify-ui-check 的范式）。验三件事：
   ① 练耳通知排上了、走自己的渠道、**不挂 action 按钮**（守住「点通知不自动播放」）；
   ② 课程提醒仍排着（证明 applySchedule 传 src 后不会互相清空——这是共用标签的必然冲突）；
   ③ 点练耳通知只回「我的」页并展开练耳卡，不出声。 */
const nctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const npage = await nctx.newPage()
const nErrors = []
npage.on('pageerror', (e) => nErrors.push(String(e)))
npage.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) nErrors.push('HTTP ' + r.status() + ' ' + r.url()) })
await npage.addInitScript((seed) => {
  window.__notify = { channels: [], actionTypes: [], scheduled: [], cancelled: [], permReq: 0, listeners: [] }
  window.Capacitor = {
    isNativePlatform: () => true,
    convertFileSrc: (p) => 'https://localhost/_capacitor_file_' + p,
    Plugins: {
      LocalNotifications: {
        createChannel: async (o) => { window.__notify.channels.push(o.id) },
        registerActionTypes: async (o) => { window.__notify.actionTypes.push(o.types[0].id) },
        checkPermissions: async () => ({ display: 'granted' }),
        requestPermissions: async () => { window.__notify.permReq++; return { display: 'granted' } },
        getPending: async () => ({ notifications: window.__notify.scheduled.map((n) => ({ id: n.id, extra: n.extra })) }),
        cancel: async (o) => {
          const ids = (o.notifications || []).map((n) => n.id)
          window.__notify.cancelled.push(...ids)
          window.__notify.scheduled = window.__notify.scheduled.filter((n) => !ids.includes(n.id))
        },
        schedule: async (o) => { window.__notify.scheduled.push(...o.notifications); return { notifications: o.notifications.map((n) => ({ id: n.id })) } },
        addListener: async (ev, cb) => { window.__notify.listeners.push(cb); return { remove: () => {} } },
      },
    },
  }
  localStorage.setItem('web2.onboarded', '1')
  if (!sessionStorage.getItem('k-seed')) {
    sessionStorage.setItem('k-seed', '1')
    localStorage.setItem('web2.notify', JSON.stringify({ enabled: true, minutesBefore: 0 }))
    localStorage.setItem('web2.listen', JSON.stringify([seed]))
    localStorage.setItem('web2.listen.set', JSON.stringify({ enabled: true }))
  }
}, {
  id: 'lis_notice', name: '排程测试', file: 'notice.mp3', seconds: 60, played_count: 0,
  last_played_at: null, review_stage: 0, next_due_date: dkey(0), repeat_times: null,
  archived: false, created_at: new Date().toISOString(),
})
await npage.goto(BASE, { waitUntil: 'domcontentloaded' })
await npage.waitForTimeout(1500) // 权限 → 排程是异步链，多等一点
const nSnap = await npage.evaluate(() => window.__notify)
const listenOnes = nSnap.scheduled.filter((x) => x.extra && x.extra.src === 'web2-listen')
const courseOnes = nSnap.scheduled.filter((x) => x.extra && x.extra.src === 'web2-m5')
t('K1. 建了练耳专属渠道 listen-reminder', nSnap.channels.includes('listen-reminder'), JSON.stringify(nSnap.channels))
t('K2. 练耳通知排上了（1~7 条，按 horizonDays 逐日一条）', listenOnes.length >= 1 && listenOnes.length <= 7, String(listenOnes.length))
t('K3. 练耳通知走自己的渠道', listenOnes.every((x) => x.channelId === 'listen-reminder'), JSON.stringify(listenOnes.map((x) => x.channelId)))
t('K4. 练耳通知**不挂按钮**（守住「点通知不自动播放」）', listenOnes.every((x) => x.actionTypeId === undefined), JSON.stringify(listenOnes.map((x) => x.actionTypeId)))
t('K5. 键名按日期 l_YYYY-MM-DD', listenOnes.every((x) => /^l_\d{4}-\d{2}-\d{2}$/.test(String(x.extra.key))), JSON.stringify(listenOnes.map((x) => x.extra.key)))
t('K6. 文案是「今天有 N 段待复习（约 N 分钟）」', listenOnes.every((x) => /^今天有 \d+ 段待复习（约 \d+ 分钟）· 挑空档去听$/.test(String(x.body))), String(listenOnes[0] && listenOnes[0].body))
t('K7. 时刻都在未来', listenOnes.every((x) => new Date(x.schedule.at).getTime() > Date.now() - 60000), JSON.stringify(listenOnes.map((x) => x.schedule.at)))
t('K8. 课程提醒同时排着（两条线互不清空）', courseOnes.length > 10, String(courseOnes.length))
t('K9. 课程提醒仍带自己的按钮与渠道', courseOnes.every((x) => x.channelId === 'class-reminder' && x.actionTypeId === 'class-reminder'))

/* 点练耳通知 → 回「我的」页 + 展开练耳卡，且不出声。
   事件形状按 notify.js 的口径：`notify.js` 是从 `ev.notification.extra` 取 extra 的，
   写成 `ev.extra` 会取不到（第一次写这条用例就踩了，K14 假失败）。 */
await npage.evaluate(() => {
  const cbs = window.__notify.listeners
  const cb = cbs && cbs[cbs.length - 1]
  if (cb) cb({ actionId: 'tap', notification: { extra: { src: 'web2-listen', key: 'l_x', count: 1 } } })
})
await npage.waitForTimeout(500)
const K_MAIN = npage.locator('[data-page="me"]')
const K_ME = npage.locator('[data-sub-body]')
t('K10. 点练耳通知后停在「我的」页（索引页非 inert）且练耳二级页被推出',
  !(await K_MAIN.evaluate((el) => el.hasAttribute('inert')))
  && (await npage.locator('[data-sub-page][data-sub="listen"]').count()) === 1)
t('K11. 练耳卡自动展开（通知即入口）', (await K_ME.locator('[data-listen-import]').count()) === 1)
t('K12. 点通知**不出声**（没有任何一条在播）', (await K_ME.locator('button', { hasText: '停止' }).count()) === 0)
t('K12b. 通知链路无页面报错 / 无 4xx-5xx 资源', nErrors.length === 0, nErrors.slice(0, 3).join(' | '))

/* K16–K18：卡上「到点提醒我去听」开关（2026-10-03 补 bug——此前 enabled 默认 false 且界面上没有开关，
   于是练耳通知永远排不出来；这三条把"开关真的写进设置"钉住）。 */
const tog = K_ME.locator('[data-listen-notify-toggle]')
t('K16. 练耳卡上有「到点提醒我去听」开关，且反映"已开启"',
  (await tog.count()) === 1 && (await tog.getAttribute('aria-pressed')) === 'true',
  String(await tog.count()) + '/' + String(await tog.getAttribute('aria-pressed')))
await tog.click()
await npage.waitForTimeout(400)
const setOff = await npage.evaluate(() => JSON.parse(localStorage.getItem('web2.listen.set') || '{}'))
t('K17. 点一下 → enabled:false 落盘', setOff.enabled === false, JSON.stringify(setOff))
await tog.click()
await npage.waitForTimeout(400)
const setOn = await npage.evaluate(() => JSON.parse(localStorage.getItem('web2.listen.set') || '{}'))
t('K18. 再点一下 → enabled:true 落盘（能自己关掉，也能自己开回来）', setOn.enabled === true, JSON.stringify(setOn))

/* 练耳开关关着（开屏即禁用）→ 不排练耳通知；课程提醒照旧排。
   这里刻意用「开屏即禁用」而不是「开着再关」：假桥的内存状态会在 reload 时重置，
   跨加载观察不到 cancel 次数。而「关开关会清掉自己那一批」走的是与课前提醒
   同一段 applySchedule 代码（只差 src），已由 notify-ui-check 的 B1 覆盖；
   本段只验「开关门控」与「两条线共存」（后者见 K8）。 */
const offCtx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const offPage = await offCtx.newPage()
const offErrors = []
offPage.on('pageerror', (e) => offErrors.push(String(e)))
offPage.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) offErrors.push('HTTP ' + r.status() + ' ' + r.url()) })
await offPage.addInitScript((seed) => {
  window.__notify = { channels: [], actionTypes: [], scheduled: [], cancelled: [], permReq: 0, listeners: [] }
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      LocalNotifications: {
        createChannel: async (o) => { window.__notify.channels.push(o.id) },
        registerActionTypes: async (o) => { window.__notify.actionTypes.push(o.types[0].id) },
        requestPermissions: async () => { window.__notify.permReq++; return { display: 'granted' } },
        getPending: async () => ({ notifications: window.__notify.scheduled.map((n) => ({ id: n.id, extra: n.extra })) }),
        cancel: async (o) => {
          const ids = (o.notifications || []).map((n) => n.id)
          window.__notify.cancelled.push(...ids)
          window.__notify.scheduled = window.__notify.scheduled.filter((n) => !ids.includes(n.id))
        },
        schedule: async (o) => { window.__notify.scheduled.push(...o.notifications); return { notifications: o.notifications.map((n) => ({ id: n.id })) } },
        addListener: async (ev, cb) => { window.__notify.listeners.push(cb); return { remove: () => {} } },
      },
    },
  }
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.notify', JSON.stringify({ enabled: true, minutesBefore: 0 }))
  localStorage.setItem('web2.listen', JSON.stringify([seed]))
  localStorage.setItem('web2.listen.set', JSON.stringify({ enabled: false }))
}, {
  id: 'lis_notice_off', name: '排程测试', file: 'notice.mp3', seconds: 60, played_count: 0,
  last_played_at: null, review_stage: 0, next_due_date: dkey(0), repeat_times: null,
  archived: false, created_at: new Date().toISOString(),
})
await offPage.goto(BASE, { waitUntil: 'domcontentloaded' })
await offPage.waitForTimeout(1500)
const offSnap = await offPage.evaluate(() => window.__notify)
t('K13. 练耳开关关着 → 不排练耳通知', offSnap.scheduled.filter((x) => x.extra && x.extra.src === 'web2-listen').length === 0)
t('K14. 关着也不影响课程提醒', offSnap.scheduled.filter((x) => x.extra && x.extra.src === 'web2-m5').length > 10)
t('K15. 无页面报错 / 无 4xx-5xx 资源', offErrors.length === 0, offErrors.slice(0, 3).join(' | '))

console.log(`\n碎片练耳 UI 检查：${pass} 项通过 / ${fail} 项失败`)
await browser.close()
process.exit(fail ? 1 : 0)
