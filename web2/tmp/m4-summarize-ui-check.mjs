/* M4-2 UI 验证：课堂纪要按钮 / LLM mock / 纪要卡渲染 / 状态机推进 / 持久化 / 错误分支。
   坑位继承：UI 列表倒序——定位一律用场次 id；fetch 只劫持 api.deepseek.com，其余放行。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

/* 支持对线上跑：TW_URL=https://… node tmp/m4-summarize-ui-check.mjs（默认本地 4177） */
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}
const ok = () => results.every((r) => r[1])
const failed = () => results.filter((r) => !r[1]).map((r) => r[0])

const GOOD = JSON.stringify({
  overview: '这堂课讲了定积分的应用，包括面积与做功两类问题。',
  key_points: ['定积分求平面图形面积', '旋转体体积公式', '变力做功的积分表达'],
  terms: [{ term: '定积分', note: '分割求和取极限' }],
  /* 五条路线 02（2026-10-16）：homework 升级为 [{text, due_hint}]。这里的 due_hint
     「下周三前」由 data/homework.js 解析成日期，用来断言「老师说的日期会被采用」。 */
  homework: [{ text: '课本 120 页习题 3.4', due_hint: '下周三前' }],
  questions: ['「黎曼」疑似识别为「李曼」'],
  extra_field: '应被白名单剔除',
})
const WRAPPED = '```json\n' + GOOD + '\n```'

const fetchMock = /* js */ `
const orig = window.fetch.bind(window)
window.__mockLLM = { mode: 'ok' } // 'ok' | 'wrapped' | '401'
window.fetch = async (url, opts) => {
  if (String(url).indexOf('api.deepseek.com') === -1) return orig(url, opts)
  const mode = window.__mockLLM.mode
  if (mode === '401') return { ok: false, status: 401, json: async () => ({}) }
  const content = mode === 'wrapped' ? ${JSON.stringify(WRAPPED)} : ${JSON.stringify(GOOD)}
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) }
}`

const seed = /* js */ `
const lectures = [
  { id: 'lec_t', schedule_id: null, title: '高数三班 录音', status: 'transcribed', started_at: '2026-09-27T09:00:00.000Z', ended_at: '2026-09-27T09:45:00.000Z', duration_ms: 2700000, clip_count: 1, clips: [{ index: 0, path: 'lectures/t.aac', mime: 'audio/aac', duration_ms: 2700000, recorded_at: '2026-09-27T09:45:00.000Z' }], created_at: '2026-09-27T09:00:00.000Z', updated_at: '2026-09-27T09:45:00.000Z', transcript: '今天我们讲定积分的应用。第一部分是求平面图形的面积，把曲线围成的区域分割成小矩形再求和。第二部分讲旋转体的体积，圆盘法和柱壳法两种思路。最后提到变力做功问题，用积分把每一段做的功累加起来。作业是课本 120 页习题 3.4。' },
  { id: 'lec_r', schedule_id: null, title: '未转写的录音', status: 'recording', started_at: '2026-09-27T10:00:00.000Z', ended_at: '2026-09-27T10:20:00.000Z', duration_ms: 1200000, clip_count: 1, clips: [{ index: 0, path: 'lectures/r.aac', mime: 'audio/aac', duration_ms: 1200000, recorded_at: '2026-09-27T10:20:00.000Z' }], created_at: '2026-09-27T10:00:00.000Z', updated_at: '2026-09-27T10:20:00.000Z', transcript: null }
]
localStorage.setItem('web2.lectures', JSON.stringify(lectures))
localStorage.setItem('web2.llm', JSON.stringify({ provider: 'deepseek', key: 'sk-test', model: '' }))
localStorage.setItem('web2.onboarded', '1')`

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(seed)
  await page.addInitScript(fetchMock)
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.$eval('[data-nav="me"]', (el) => el.click()) // 录音板块住「我的」页
  await page.waitForTimeout(400)
  await page.$eval('[data-me-entry="lectures"]', (el) => el.click()) // Stage 6：搬进二级页
  await page.waitForTimeout(400)

  const lecRow = (id) => page.locator('li').filter({ has: page.locator(`[data-lec="${id}"], text=${id}`) })
  // 场次卡定位：直接按标题找 li
  const rowT = page.locator('li', { hasText: '高数三班 录音' })
  const rowR = page.locator('li', { hasText: '未转写的录音' })

  t('1. 已转写场次显示「生成纪要」按钮', (await rowT.getByRole('button', { name: '生成纪要', exact: true }).count()) === 1)
  t('2. 未转写场次无纪要按钮', (await rowR.getByRole('button', { name: /纪要/ }).count()) === 0)

  await rowT.getByRole('button', { name: '生成纪要', exact: true }).click()
  await page.waitForTimeout(500)

  t('3. 纪要卡自动展开', (await rowT.getByText('课堂纪要', { exact: true }).count()) === 1)
  t('4. 总览渲染', (await rowT.getByText(/定积分的应用/).count()) >= 1)
  t('5. 要点 3 条渲染', (await rowT.locator('li').filter({ hasText: /^•/ }).count()) === 3)
  t('6. 术语 chip 渲染', (await rowT.getByText('定积分', { exact: true }).count()) >= 1)
  t('7. 存疑点渲染（含「黎曼」）', (await rowT.getByText(/黎曼/).count()) >= 1)
  t('8. 白名单剔除多余字段（extra_field 不显示）', (await rowT.getByText('应被白名单剔除').count()) === 0)

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.lectures')).find((x) => x.id === 'lec_t'))
  t('9. 状态推进 summarized', saved.status === 'summarized')
  t('10. 落库 summary 无 extra 字段', !('extra_field' in (saved.summary || {})))
  t('11. 落库 homework 形状正确（{text,due_hint}）', saved.summary.homework.length === 1 && saved.summary.homework[0].text === '课本 120 页习题 3.4' && saved.summary.homework[0].due_hint === '下周三前')
  t('12. 按钮变「重新生成纪要」', (await rowT.getByRole('button', { name: '重新生成纪要' }).count()) === 1)

  // 收起 / 展开
  await rowT.getByRole('button', { name: '收起 ▲' }).click()
  await page.waitForTimeout(150)
  t('13. 收起后卡片隐藏', (await rowT.getByText('课堂纪要', { exact: true }).count()) === 0)
  await rowT.getByRole('button', { name: '查看纪要 ▼' }).click()
  await page.waitForTimeout(150)
  t('14. 再展开成功', (await rowT.getByText('课堂纪要', { exact: true }).count()) === 1)

  // markdown 代码壳剥离
  await rowT.getByRole('button', { name: '重新生成纪要' }).click()
  await page.evaluate(() => { window.__mockLLM.mode = 'wrapped' })
  await page.waitForTimeout(500)
  const saved2 = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.lectures')).find((x) => x.id === 'lec_t'))
  t('15. 代码壳剥离：重生成成功且总览正确', saved2.summary && saved2.summary.overview.indexOf('定积分') !== -1)

  // 401 错误
  await page.evaluate(() => { window.__mockLLM.mode = '401' })
  await rowT.getByRole('button', { name: '重新生成纪要' }).click()
  await page.waitForTimeout(500)
  t('16. 401 给可读错误', (await page.getByText(/API Key 无效/).count()) >= 1)
  const saved3 = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.lectures')).find((x) => x.id === 'lec_t'))
  t('17. 失败不清空旧纪要', saved3.summary && saved3.summary.overview.indexOf('定积分') !== -1)

  // reload 持久化：addInitScript 在 reload 会重新播种（覆盖掉刚存的 summary，Day 12 老坑）——
  // 换成新 context + 内嵌 summary 的种子，等价验证「存盘数据重新加载后能展示」
  const p3ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const p3 = await p3ctx.newPage()
  const seedSaved = /* js */ `
const lectures = [
  { id: 'lec_s', schedule_id: null, title: '已总结的录音', status: 'summarized', started_at: '2026-09-26T09:00:00.000Z', ended_at: '2026-09-26T09:45:00.000Z', duration_ms: 2700000, clip_count: 1, clips: [{ index: 0, path: 'lectures/s.aac', mime: 'audio/aac', duration_ms: 2700000, recorded_at: '2026-09-26T09:45:00.000Z' }], created_at: '2026-09-26T09:00:00.000Z', updated_at: '2026-09-26T09:50:00.000Z', transcript: '一份足够长的文字稿。', summary: ${JSON.stringify(GOOD ? JSON.parse(GOOD) : null)} }
]
localStorage.setItem('web2.lectures', JSON.stringify(lectures))
localStorage.setItem('web2.onboarded', '1')`
  await p3.addInitScript(seedSaved)
  await p3.goto(BASE, { waitUntil: 'domcontentloaded' })
  await p3.waitForTimeout(700)
  await p3.$eval('[data-nav="me"]', (el) => el.click())
  await p3.waitForTimeout(400)
  await p3.$eval('[data-me-entry="lectures"]', (el) => el.click())
  await p3.waitForTimeout(400)
  const rowS = p3.locator('li', { hasText: '已总结的录音' })
  t('18. 存盘 summary 重新加载后可展开', (await rowS.getByRole('button', { name: '查看纪要 ▼' }).count()) === 1)
  await rowS.getByRole('button', { name: '查看纪要 ▼' }).click()
  await p3.waitForTimeout(150)
  t('19. 展开内容完整', (await rowS.getByText(/定积分的应用/).count()) >= 1)
  await p3ctx.close()

  t('20. 全程无页面报错', errors.length === 0)

  /* ---- 无配置分支：新页面不带 web2.llm ---- */
  const p2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  const seedNoCfg = seed.replace(/localStorage\.setItem\('web2\.llm'[^\n]*\n/, '')
  await p2.addInitScript(seedNoCfg)
  await p2.addInitScript(fetchMock)
  await p2.goto(BASE, { waitUntil: 'domcontentloaded' })
  await p2.waitForTimeout(700)
  await p2.$eval('[data-nav="me"]', (el) => el.click())
  await p2.waitForTimeout(400)
  await p2.$eval('[data-me-entry="lectures"]', (el) => el.click())
  await p2.waitForTimeout(400)
  const rowT3 = p2.locator('li', { hasText: '高数三班 录音' })
  await rowT3.getByRole('button', { name: '生成纪要', exact: true }).click()
  await p2.waitForTimeout(300)
  /* Stage 6：缺配置时 startSummary 直接把当前 lectures 二级页换成 settings 二级页，
     所以「设置区自动展开」＝此刻就在设置页；错误提示 recMsg 留在录音页，稍后回看。 */
  t('22. 缺配置 → 自动进入设置二级页（纪要服务标签可见）', (await p2.getByText('纪要服务').count()) >= 1)
  // 填配置（验证「缺啥补啥」链路）。v1.11 起下拉换成自建组件
  await p2.locator('[data-dd="provider"] button').click()
  await p2.locator('[data-dd="provider"] ul button', { hasText: 'DeepSeek（自己的 API Key）' }).click()
  await p2.locator('input[placeholder="sk-…"]').fill('sk-later')
  await p2.waitForTimeout(200)

  /* 模型下拉 + 测试连接（mock 对 /models 无 data 字段 → 成功提示不带模型列表） */
  await p2.locator('[data-dd="model"] button').click()
  await p2.waitForTimeout(200)
  t('24. 模型是下拉选项（含现役 deepseek-flash）', (await p2.locator('[data-dd="model"] ul button', { hasText: 'deepseek-flash' }).count()) === 1)
  await p2.locator('[data-dd="model"] ul button', { hasText: 'deepseek-flash' }).click()
  await p2.waitForTimeout(200)
  await p2.getByRole('button', { name: '测试连接' }).click()
  await p2.waitForTimeout(400)
  t('25. 测试连接成功提示', (await p2.getByText(/连接正常/).count()) >= 1)

  /* 回录音二级页：缺配置那次点击留下的错误提示仍在（recMsg 未被覆盖），
     此时再点「生成纪要」就能跑通——「缺啥补啥」链路完整。 */
  await p2.locator('[data-sub-back]').click()
  await p2.waitForTimeout(300)
  await p2.$eval('[data-me-entry="lectures"]', (el) => el.click())
  await p2.waitForTimeout(400)
  t('21. 无配置点生成：给可读提示', (await p2.getByText(/还没选择纪要服务/).count()) >= 1)
  await rowT3.getByRole('button', { name: '生成纪要', exact: true }).click()
  await p2.waitForTimeout(500)
  t('23. 补配置后直接生成成功', (await rowT3.getByText(/定积分的应用/).count()) >= 1)

  /* ---- M5 补充（2026-10-01）：手动生成纪要也要把 homework 转成待办 ----
     原来只有自动链路（停录→自动转写→自动纪要）会转；自动链路中途断环、
     用户手动补跑转写/纪要时，作业会永久停在纪要卡片里，而且看不出来。
     去重按标题，所以重复生成不会叠出重复待办。 */
  const readTodoTitles = (pg) => pg.evaluate(() => {
    const ov = JSON.parse(localStorage.getItem('web2.todos') || '{"added":[]}')
    return (ov.added || []).map((x) => String(x.title || ''))
  })
  const hwTitles = await readTodoTitles(p2)
  t('26. 手动生成纪要也把 homework 转成待办', hwTitles.some((s) => s.indexOf('课本 120 页习题 3.4') !== -1))
  await rowT3.getByRole('button', { name: '重新生成纪要' }).click()
  await p2.waitForTimeout(600)
  const hwTitles2 = await readTodoTitles(p2)
  t('27. 重复生成不叠出重复待办', hwTitles2.filter((s) => s.indexOf('课本 120 页习题 3.4') !== -1).length === 1)

  /* ---- 五条路线 02 补充（2026-10-16）：作业带截止日 + 来源 + 「加入待办」 ----
     老师说了 due_hint（本夹具「下周三前」）就用他说的那天，并标明「课堂提到」；
     已经自动转进待办的显示「已在待办」，没转到的给一个按钮就地补加。 */
  const hwItem = rowT3.locator('[data-hw-item]').first()
  const hwDue = await hwItem.locator('[data-hw-due]').innerText()
  t('28. 作业条目显示截止日', /^\d{4}-\d{2}-\d{2} · /.test(hwDue.trim()), hwDue)
  t('29. 截止日来源标明「课堂提到」（老师说了 due_hint 就不估）', /课堂提到/.test(hwDue), hwDue)
  t('30. 已自动转进待办的显示「已在待办」而不是按钮', (await hwItem.locator('[data-hw-added]').count()) === 1 && (await hwItem.locator('[data-hw-add]').count()) === 0)
  /* due_hint「下周三前」必须真的被解析成日期并用上——当天写入的待办 due_date 应与显示一致 */
  const todoDues = await p2.evaluate(() => {
    const ov = JSON.parse(localStorage.getItem('web2.todos') || '{"added":[]}')
    return (ov.added || []).filter((x) => String(x.title || '').indexOf('课本 120 页习题 3.4') !== -1).map((x) => String(x.due_date || ''))
  })
  t('31. 待办里的截止日 = 界面上显示的那个（due_hint 真被采用）', todoDues.length === 1 && hwDue.indexOf(todoDues[0]) === 0, { todoDues, hwDue })

  /* 注意：不能在 p2 上 reload 验「删掉待办后按钮回来」——addInitScript 每次导航都会重跑，
     会把 web2.lectures 重新播种回 transcribed（Day 12 老坑）。所以下面用独立 context 验。 */

  /* ---- 「加入待办」按钮的形态：自动转已覆盖的那条显示「已在待办」； ----
     这里再造一份**带课的、待办里没有的**纪要，验证按钮真的在、点了真能补回待办。 */
  const p5 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  const seedAdd = /* js */ `
const lectures = [
  { id: 'lec_add', schedule_id: null, title: '待补加的纪要', status: 'summarized', started_at: '2026-09-24T09:00:00.000Z', ended_at: '2026-09-24T09:45:00.000Z', duration_ms: 2700000, clip_count: 1, clips: [], created_at: '2026-09-24T09:00:00.000Z', updated_at: '2026-09-24T09:50:00.000Z', transcript: '一份足够长的文字稿。', summary: { overview: '有两条作业，但一条都没转进待办。', key_points: [], terms: [], homework: [{ text: '写高数作业', due_hint: '下周三前' }, { text: '读英语课文', due_hint: '' }], questions: [], created_at: '2026-09-24T09:50:00.000Z' } }
]
localStorage.setItem('web2.lectures', JSON.stringify(lectures))
localStorage.setItem('web2.onboarded', '1')`
  await p5.addInitScript(seedAdd)
  await p5.goto(BASE, { waitUntil: 'domcontentloaded' })
  await p5.waitForTimeout(700)
  await p5.$eval('[data-nav="me"]', (el) => el.click())
  await p5.waitForTimeout(400)
  await p5.$eval('[data-me-entry="lectures"]', (el) => el.click())
  await p5.waitForTimeout(400)
  const rowAdd = p5.locator('li', { hasText: '待补加的纪要' })
  await rowAdd.getByRole('button', { name: '查看纪要 ▼' }).click()
  await p5.waitForTimeout(200)
  t('32. 没在待办里的作业给「加入待办」按钮', (await rowAdd.locator('[data-hw-add]').count()) === 2)
  const addItems = rowAdd.locator('[data-hw-item]')
  t('33. 两条作业的截止日来源分别标明', /课堂提到/.test(await addItems.nth(0).locator('[data-hw-due]').innerText()) && /按下次上课日估的/.test(await addItems.nth(1).locator('[data-hw-due]').innerText()))
  const due0 = (await addItems.nth(0).locator('[data-hw-due]').innerText()).trim().slice(0, 10)
  await addItems.nth(0).locator('[data-hw-add]').click()
  await p5.waitForTimeout(400)
  t('34. 点「加入待办」补回一条（due_hint 解析出的日期）', JSON.stringify(await p5.evaluate(() => {
    const ov = JSON.parse(localStorage.getItem('web2.todos') || '{"added":[]}')
    return (ov.added || []).map((x) => [String(x.title || ''), String(x.due_date || '')])
  })) === JSON.stringify([['写高数作业', due0]]), await p5.evaluate(() => localStorage.getItem('web2.todos')))
  t('35. 加入后该条变「已在待办」，另一条仍有按钮', (await addItems.nth(0).locator('[data-hw-added]').count()) === 1 && (await addItems.nth(1).locator('[data-hw-add]').count()) === 1)
  await p5.context().close()

  /* ---- 旧纪要兼容：homework 还是字符串数组（升级提示词之前生成的） ----
     文案照常显示、截止日照常给（回落「按下次上课日估的」）、不因为形状变了而整块消失。 */
  const p4 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
  const seedOld = /* js */ `
const lectures = [
  { id: 'lec_old', schedule_id: null, title: '升级前的旧纪要', status: 'summarized', started_at: '2026-09-25T09:00:00.000Z', ended_at: '2026-09-25T09:45:00.000Z', duration_ms: 2700000, clip_count: 1, clips: [], created_at: '2026-09-25T09:00:00.000Z', updated_at: '2026-09-25T09:50:00.000Z', transcript: '一份足够长的文字稿。', summary: { overview: '升级前生成的纪要。', key_points: [], terms: [], homework: ['旧格式的作业条目'], questions: [], created_at: '2026-09-25T09:50:00.000Z' } }
]
localStorage.setItem('web2.lectures', JSON.stringify(lectures))
localStorage.setItem('web2.onboarded', '1')`
  await p4.addInitScript(seedOld)
  await p4.goto(BASE, { waitUntil: 'domcontentloaded' })
  await p4.waitForTimeout(700)
  await p4.$eval('[data-nav="me"]', (el) => el.click())
  await p4.waitForTimeout(400)
  await p4.$eval('[data-me-entry="lectures"]', (el) => el.click())
  await p4.waitForTimeout(400)
  const rowOld = p4.locator('li', { hasText: '升级前的旧纪要' })
  await rowOld.getByRole('button', { name: '查看纪要 ▼' }).click()
  await p4.waitForTimeout(200)
  t('36. 旧纪要（字符串 homework）照常显示', (await rowOld.getByText('旧格式的作业条目').count()) === 1)
  const oldDue = await rowOld.locator('[data-hw-due]').first().innerText()
  t('37. 旧条目照常给截止日，来源标「按下次上课日估的」', /^\d{4}-\d{2}-\d{2} · 按下次上课日估的$/.test(oldDue.trim()), oldDue)
  t('38. 旧纪要也能「加入待办」', (await rowOld.locator('[data-hw-add]').count()) === 1)
  /* 点「加入待办」：没在待办里的条目就地补一条；补完变「已在待办」，再点不会叠第二条 */
  await rowOld.locator('[data-hw-add]').first().click()
  await p4.waitForTimeout(400)
  await p4.$eval('[data-nav="me"]', (el) => el.click())
  await p4.waitForTimeout(300)
  await p4.$eval('[data-me-entry="lectures"]', (el) => el.click())
  await p4.waitForTimeout(400)
  const rowOld2 = p4.locator('li', { hasText: '升级前的旧纪要' })
  t('39. 点「加入待办」后按钮变「已在待办」', (await rowOld2.locator('[data-hw-added]').count()) === 1 && (await rowOld2.locator('[data-hw-add]').count()) === 0)
  const oldTodos = await p4.evaluate(() => {
    const ov = JSON.parse(localStorage.getItem('web2.todos') || '{"added":[]}')
    return (ov.added || []).filter((x) => String(x.title || '').indexOf('旧格式的作业条目') !== -1).map((x) => String(x.due_date || ''))
  })
  t('40. 待办里确实多了一条且截止日与界面一致', oldTodos.length === 1 && oldDue.indexOf(oldTodos[0]) === 0, { oldTodos, oldDue })
  await p4.context().close()

  console.log(ok() ? 'ALL PASS ' + results.length : 'FAILED: ' + failed().join(' | '))
} finally {
  await browser.close()
}
