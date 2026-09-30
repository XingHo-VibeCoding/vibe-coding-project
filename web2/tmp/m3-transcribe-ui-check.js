/* M3 第 2 步 UI 验证：假 Transcriber 插件注入，浏览器里跑通转写全链路。
   教训：UI 列表按 started_at 倒序，与种子数组顺序不同——所有定位/断言一律用场次 id，不用下标。
   覆盖：转写按钮显隐 / 模型下载进度 / 识别进度 / 状态机与文字稿落库 / 失败回退 / 浏览器无按钮 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}

const fakePlugin = /* js */ `
window.__modelReady = false
window.__failTranscribe = false
window.Capacitor = { Plugins: {
  Transcriber: {
    _ls: { download: [], transcribe: [] },
    addListener(name, cb) { this._ls[name].push(cb); return { remove: () => {} } },
    async _emit(name, data) { for (const cb of this._ls[name].slice()) cb(data) },
    async isModelReady() { return { ready: window.__modelReady, modelBytes: window.__modelReady ? 239233841 : 0, tokensBytes: window.__modelReady ? 309000 : 0 } },
    async downloadModel(args) {
      for (let i = 1; i <= 8; i++) { await this._emit('download', { which: args.which, percent: i * 12, loaded: i * 29904230, total: args.which === 'model' ? 239233841 : 309000 }); await new Promise((r) => setTimeout(r, 130)) }
      window.__modelReady = true
      return { which: args.which, done: true, total: 239233841 }
    },
    async transcribe(args) {
      if (window.__failTranscribe) throw new Error('模型加载失败（假插件注入）')
      // 模拟原生真实时序：识别前先解码/重采样（真机教训——这两步的 percent 若直接上进度条，
      // 会出现「先冲 90% 再跳回识别 50%」的假象）
      await this._emit('transcribe', { phase: 'decode', percent: 0, path: args.path })
      await new Promise((r) => setTimeout(r, 150))
      await this._emit('transcribe', { phase: 'resample', percent: 90, path: args.path })
      await new Promise((r) => setTimeout(r, 400))
      for (let i = 1; i <= 5; i++) { await this._emit('transcribe', { phase: 'asr', chunk: i, chunkTotal: 5, percent: i * 20, path: args.path }); await new Promise((r) => setTimeout(r, 130)) }
      return { text: '今天我们讲微积分第三章，重点是定积分的应用。', chunks: 5, durationMs: 60000, path: args.path }
    },
    async cancel() { return {} }
  }
}}`

const seed = /* js */ `
const lectures = [
  { id: 'lec_a', schedule_id: null, title: '高数三班 录音', status: 'recording', started_at: '2026-09-26T09:00:00.000Z', ended_at: '2026-09-26T09:45:00.000Z', duration_ms: 2700000, clip_count: 1, clips: [{ index: 0, path: 'lectures/a.aac', mime: 'audio/aac', duration_ms: 2700000, recorded_at: '2026-09-26T09:45:00.000Z' }], created_at: '2026-09-26T09:00:00.000Z', updated_at: '2026-09-26T09:45:00.000Z', transcript: null },
  { id: 'lec_b', schedule_id: null, title: '英语听力 录音', status: 'recording', started_at: '2026-09-26T10:00:00.000Z', ended_at: '2026-09-26T10:20:00.000Z', duration_ms: 1200000, clip_count: 1, clips: [{ index: 0, path: 'lectures/b.aac', mime: 'audio/aac', duration_ms: 1200000, recorded_at: '2026-09-26T10:20:00.000Z' }], created_at: '2026-09-26T10:00:00.000Z', updated_at: '2026-09-26T10:20:00.000Z', transcript: null }
]
localStorage.setItem('web2.lectures', JSON.stringify(lectures))
localStorage.setItem('web2.onboarded', '1')`

const waitStatus = (page, id, status, timeout) =>
  page.waitForFunction(
    ([i, s]) => JSON.parse(localStorage.getItem('web2.lectures')).find((x) => x.id === i).status === s,
    [id, status],
    { timeout: timeout || 15000 }
  )

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
await page.addInitScript(fakePlugin)
await page.addInitScript(seed)

try {
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto('http://127.0.0.1:4177/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)

  const navBtns = page.locator('nav button')
  await navBtns.nth(2).click()
  await page.waitForTimeout(400)

  const rowA = page.locator('li', { hasText: '高数三班' })
  const rowB = page.locator('li', { hasText: '英语听力' })

  // 1. 两场都有「转写」按钮
  t('1. 两场次均显示「转写」按钮', (await page.locator('li button:has-text("转写")').count()) === 2)

  // 2-5. 场次 A：点转写 → 下载进度 → 识别 → transcribed
  await rowA.locator('button:has-text("转写")').click()
  await page.waitForTimeout(150)
  t('2. 点击后出现进度条', (await page.locator('div.h-1\\.5').count()) >= 1)
  const label1 = await rowA.locator('p').filter({ hasText: /下载|识别|准备/ }).first().textContent().catch(() => '')
  t('3. 进度条带文字说明（下载/识别阶段）', /下载|识别|准备/.test(label1 || ''))

  // 2b-2c. 真机教训回归：解码/重采样阶段只改文字提示、进度条保持 0%；asr 阶段才驱动百分比
  await rowA.locator('p:has-text("重采样音频 90%")').waitFor({ timeout: 10000 }).catch(() => {})
  const style2b = await rowA.locator('div.h-1\\.5 > div').getAttribute('style').catch(() => '')
  t('2b. 解码/重采样阶段进度条保持 0%（不假冲）', /重采样音频/.test((await rowA.locator('p').allTextContents()).join('')) && /width:\s*0%/.test(style2b || ''))
  await rowA.locator('p').filter({ hasText: /识别/ }).first().waitFor({ timeout: 10000 }).catch(() => {})
  const style2c = await rowA.locator('div.h-1\\.5 > div').getAttribute('style').catch(() => '')
  t('2c. 识别阶段进度条正常增长', /width:\s*[1-9]/.test(style2c || ''))
  await waitStatus(page, 'lec_a', 'transcribed')
  t('4. 状态机推进到 transcribed', true)
  const lecA = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.lectures')).find((x) => x.id === 'lec_a'))
  t('5. 文字稿落库（含识别文本）', (lecA.transcript || '').indexOf('微积分') !== -1)

  // 6-7. 界面文案 + 文字稿（设计口径：转写完成自动展开，按钮显示「收起」）
  t('6. 状态文案为「已转写 · 待总结」', (await rowA.locator('text=已转写 · 待总结').count()) >= 1)
  t('7a. 转写完成自动展开文字稿', (await rowA.locator('p:has-text("定积分的应用")').count()) >= 1)
  await rowA.locator('button:has-text("收起文字稿")').click()
  await page.waitForTimeout(200)
  t('7b. 收起后正文隐藏', (await rowA.locator('p:has-text("定积分的应用")').count()) === 0)
  await rowA.locator('button:has-text("查看文字稿")').click()
  await page.waitForTimeout(200)
  t('7c. 再点查看重新展开', (await rowA.locator('p:has-text("定积分的应用")').count()) >= 1)

  // 8-10. 场次 B：注入识别失败 → 状态退回 recording，可重试
  await page.evaluate(() => { window.__failTranscribe = true })
  await rowB.locator('button:has-text("转写")').click()
  try {
    await waitStatus(page, 'lec_b', 'recording', 10000)
    t('8. 识别失败回退 recording（可重试）', true)
  } catch {
    const dump = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.lectures')).map((x) => x.id + ':' + x.status).join(','))
    console.log('  状态转储:', dump)
    t('8. 识别失败回退 recording（超时）', false)
  }
  t('9. 失败有就地报错文案', (await page.locator('text=转写失败').count()) >= 1)
  const lecB = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.lectures')).find((x) => x.id === 'lec_b'))
  t('10. 失败场不落文字稿', lecB.transcript == null)

  // 11. 模型已就绪：重试不再走下载，直达 transcribed
  await page.evaluate(() => { window.__failTranscribe = false })
  await rowB.locator('button:has-text("转写")').click()
  await waitStatus(page, 'lec_b', 'transcribed')
  t('11. 模型就绪后重试直达 transcribed', true)

  // 12. 浏览器环境（无 Capacitor）：转写按钮不存在
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const p3 = await ctx2.newPage()
  await p3.addInitScript(seed) // 只有种子，无假插件
  await p3.goto('http://127.0.0.1:4177/', { waitUntil: 'domcontentloaded' })
  await p3.waitForTimeout(500)
  await p3.locator('nav button').nth(2).click()
  await p3.waitForTimeout(300)
  t('12. 浏览器环境不显示「转写」按钮', (await p3.locator('li button:has-text("转写")').count()) === 0)
  await ctx2.close()
} catch (e) {
  t('测试执行异常：' + e.message, false)
} finally {
  await browser.close()
}

const fails = results.filter((r) => !r[1])
console.log(`\n结果：${results.length - fails.length} 过，${fails.length} 挂`)
process.exit(fails.length ? 1 : 0)
