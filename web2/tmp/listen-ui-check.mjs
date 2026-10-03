/* 碎片练耳 UI 检查（playwright，走 dist 静态服务）
   四期 Day 18：覆盖 L1（导入 + 列表 + 刷新不丢）、「已听」手动确认推进艾宾浩斯排期、
   会话内连放（repeatTimes），以及 L3/L4（复习到点提醒排练程 + 点通知只提醒不自动播放）。
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

const ME = page.locator('[data-page="me"]')
await page.locator('nav button', { hasText: '我的' }).click()
await page.waitForTimeout(500)

/* ===== A. 入口 ===== */
t('A1. 「我的」页有「碎片练耳」入口', (await ME.locator('section', { hasText: '碎片练耳' }).count()) >= 1)
t('A2. 默认收起（导入控件不可见）', (await ME.locator('[data-listen-import]').count()) === 0)
await ME.locator('button', { hasText: '打开' }).first().click()
await page.waitForTimeout(300)
t('A3. 展开后出现导入控件', (await ME.locator('[data-listen-import]').count()) === 1)
t('A4. 文件选择框对用户隐藏（label 触发）', await ME.locator('[data-listen-import]').isHidden())

/* ===== B. 列表渲染（已听次数 / 时长 / 复习状态） ===== */
t('B1. 列表渲染出种子音频', (await ME.locator('li', { hasText: '种子音频' }).count()) === 1)
const seedRow = ME.locator('li', { hasText: '种子音频' }).first()
const seedText = await seedRow.innerText()
t('B2. 显示已听次数 2 次', seedText.includes('已听 2 次'), seedText)
t('B3. 显示时长 0:45', seedText.includes('0:45'), seedText)
t('B4. 拖期提示', seedText.includes('拖了'), seedText)
t('B5. 「已听」按钮可点（拖期→今天就能补）', await seedRow.locator('button', { hasText: '已听' }).isEnabled())
const slotsText = await ME.locator('[data-listen-slots]').first().innerText()
t('B6. 显示今日空闲槽建议（L2）', slotsText.includes('今天可听'), slotsText)
t('B7. 建议含时段与段数', /\d{2}:\d{2}–\d{2}:\d{2} · \d+ 分钟 · .+ → 放 \d+ 段/.test(slotsText), slotsText)

/* ===== C. 已听 = 手动确认推进（艾宾浩斯） ===== */
await seedRow.locator('button', { hasText: '已听' }).click()
await page.waitForTimeout(300)
const afterText = await ME.locator('li', { hasText: '种子音频' }).first().innerText()
t('C1. 已听次数 +1（2 → 3）', afterText.includes('已听 3 次'), afterText)
t('C2. 状态推进到下一档（stage=2 → 今天 + intervals[1]=2 天）', afterText.includes('下次复习 ' + dkey(2)), afterText)
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.listen') || '[]')[0])
t('C3. next_due_date = 今天 + 2 天（第 2 档间隔）', stored.next_due_date === dkey(2), stored.next_due_date + ' vs ' + dkey(2))
t('C4. review_stage 推进到 2', stored.review_stage === 2, stored.review_stage)
t('C5. 按钮转为不可点（还没到复习日）', await ME.locator('li', { hasText: '种子音频' }).first().locator('button', { hasText: '已听' }).isDisabled())

/* ===== D. 导入（L1） ===== */
await ME.locator('[data-listen-import]').setInputFiles({ name: '我的听力材料.wav', mimeType: 'audio/wav', buffer: wavBuffer() })
await page.waitForTimeout(700)
const newRow = ME.locator('li', { hasText: '我的听力材料' })
t('D1. 导入后列表出现该音频（文件名去掉扩展名）', (await newRow.count()) === 1)
const newText = await newRow.first().innerText()
t('D2. 新导入记录「今天该听」', newText.includes('今天该听'), newText)
t('D3. 新导入已听 0 次', newText.includes('已听 0 次'), newText)
t('D4. 新导入就能点「已听」', await newRow.first().locator('button', { hasText: '已听' }).isEnabled())
t('D5. 落盘 2 条记录', (await page.evaluate(() => JSON.parse(localStorage.getItem('web2.listen') || '[]').length)) === 2)
t('D6. 浏览器提示「刷新后要重新导入」', (await ME.locator('p', { hasText: '刷新后要重新导入' }).count()) === 1)

/* ===== E. 刷新重开不丢（L1 硬要求） ===== */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await page.locator('nav button', { hasText: '我的' }).click()
await page.waitForTimeout(400)
await ME.locator('button', { hasText: '打开' }).first().click()
await page.waitForTimeout(300)
const reloadText = await ME.locator('li', { hasText: '种子音频' }).first().innerText()
t('E1. 刷新后列表仍在', (await ME.locator('li', { hasText: '种子音频' }).count()) === 1)
t('E2. 刷新后已听次数仍是 3', reloadText.includes('已听 3 次'), reloadText)

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
await page.locator('nav button', { hasText: '我的' }).click()
await page.waitForTimeout(400)
await ME.locator('button', { hasText: '打开' }).first().click()
await page.waitForTimeout(300)
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
  window.__listenFs = { writes: [], mkdirs: [], getUris: [], deletes: [] }
  window.Capacitor = {
    isNativePlatform: () => true,
    convertFileSrc: (p) => 'https://localhost/_capacitor_file_' + p,
    Plugins: {
      Filesystem: {
        mkdir: async (o) => { window.__listenFs.mkdirs.push(o) },
        writeFile: async (o) => { window.__listenFs.writes.push(o) },
        getUri: async (o) => { window.__listenFs.getUris.push(o); return { uri: 'file:///data/user/0/app/files/' + o.path } },
        deleteFile: async (o) => { window.__listenFs.deletes.push(o) },
      },
    },
  }
  localStorage.setItem('web2.onboarded', '1')
})
await appPage.goto(BASE, { waitUntil: 'domcontentloaded' })
await appPage.waitForTimeout(700)
const APP_ME = appPage.locator('[data-page="me"]')
await appPage.locator('nav button', { hasText: '我的' }).click()
await appPage.waitForTimeout(500)
await APP_ME.locator('button', { hasText: '打开' }).first().click()
await appPage.waitForTimeout(300)

await APP_ME.locator('[data-listen-import]').setInputFiles({ name: '真机材料.wav', mimeType: 'audio/wav', buffer: wavBuffer() })
await appPage.waitForTimeout(1000)
/* 导入之后才断言"没有浏览器黄字"——列表为空时那句话本来就不显示，放导入前等于假通过 */
t('H1. App 模式导入后不出现「刷新后要重新导入」黄字', (await APP_ME.locator('p', { hasText: '刷新后要重新导入' }).count()) === 0)
const fsLog = await appPage.evaluate(() => ({ writes: window.__listenFs.writes, mkdirs: window.__listenFs.mkdirs }))
const w0 = fsLog.writes[0]
t('H2. 触发了一次 writeFile', fsLog.writes.length === 1, JSON.stringify(fsLog.writes.map((w) => w.path)))
t('H3. 落盘路径 = listen/<文件名>', w0 && w0.path === 'listen/真机材料.wav', w0 && w0.path)
t('H4. 目录 = DATA（应用私有目录，同课堂录音）', w0 && w0.directory === 'DATA', w0 && w0.directory)
t('H5. 编码 = base64 且字节与原文件一致', !!w0 && w0.encoding === 'base64' && w0.data === wavBuffer().toString('base64'), w0 && ((w0.data || '').length + ' chars'))
t('H6. 先建了 listen 子目录', fsLog.mkdirs.some((m) => m.path === 'listen'))
t('H7. 记录仍落 localStorage（本机数据）', (await appPage.evaluate(() => JSON.parse(localStorage.getItem('web2.listen') || '[]').length)) === 1)
t('H8. 成功文案写明已存到本机', (await APP_ME.locator('p', { hasText: '存到本机' }).count()) >= 1)
/* 点「播放」→ 应拿 listen/<file> 去问插件要地址（真机上这个地址才播得响；这里只验"问对了"） */
await APP_ME.locator('li', { hasText: '真机材料' }).first().locator('[data-listen-play]').click()
await appPage.waitForTimeout(700)
const uris = await appPage.evaluate(() => window.__listenFs.getUris)
t('H10. App 模式点播放 → 按 listen/<file> 解析本机地址', uris.length === 1 && uris[0].path === 'listen/真机材料.wav' && uris[0].directory === 'DATA', JSON.stringify(uris))
t('H9. App 模式无页面报错', appErrors.length === 0, appErrors.slice(0, 3).join(' | '))

/* ===== I. 播放（浏览器模式：导入后当次会话内可播，且不推进进度） ===== */
const pctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const ppage = await pctx.newPage()
const pErrors = []
ppage.on('pageerror', (e) => pErrors.push(String(e)))
await ppage.addInitScript(() => { localStorage.setItem('web2.onboarded', '1') })
await ppage.goto(BASE, { waitUntil: 'domcontentloaded' })
await ppage.waitForTimeout(700)
const P_ME = ppage.locator('[data-page="me"]')
await ppage.locator('nav button', { hasText: '我的' }).click()
await ppage.waitForTimeout(500)
await P_ME.locator('button', { hasText: '打开' }).first().click()
await ppage.waitForTimeout(300)
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
t('I5. 再点变回「播放」（已停）', (await prow.locator('[data-listen-play]').innerText()).trim() === '播放')
t('I6. 浏览器模式无页面报错', pErrors.length === 0, pErrors.slice(0, 3).join(' | '))

/* ===== J. 会话内重复（repeatTimes 默认 3）：连放 3 遍、放完自停、且不推进进度 ===== */
const rctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const rpage = await rctx.newPage()
const rErrors = []
rpage.on('pageerror', (e) => rErrors.push(String(e)))
await rpage.addInitScript(() => { localStorage.setItem('web2.onboarded', '1') })
await rpage.goto(BASE, { waitUntil: 'domcontentloaded' })
await rpage.waitForTimeout(700)
const R_ME = rpage.locator('[data-page="me"]')
await rpage.locator('nav button', { hasText: '我的' }).click()
await rpage.waitForTimeout(500)
await R_ME.locator('button', { hasText: '打开' }).first().click()
await rpage.waitForTimeout(300)
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
t('J5. 连放 3 遍仍**不**推进已听次数（人工确认前进度不动）', (await rrow.innerText()).includes('已听 0 次'), await rrow.innerText())
t('J6. 无页面报错', rErrors.length === 0, rErrors.slice(0, 3).join(' | '))

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
const K_ME = npage.locator('[data-page="me"]')
t('K10. 点练耳通知后停在「我的」页', !(await K_ME.evaluate((el) => el.hasAttribute('inert'))))
t('K11. 练耳卡自动展开（通知即入口）', (await K_ME.locator('[data-listen-import]').count()) === 1)
t('K12. 点通知**不出声**（没有任何一条在播）', (await K_ME.locator('button', { hasText: '停止' }).count()) === 0)
t('K12b. 通知链路无页面报错 / 无 4xx-5xx 资源', nErrors.length === 0, nErrors.slice(0, 3).join(' | '))

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
