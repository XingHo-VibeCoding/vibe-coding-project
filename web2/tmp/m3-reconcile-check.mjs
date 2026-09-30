/* M3 补丁（v1.15）启动对账验证：转写中途被杀（重启/冻结后杀进程）的场次
   status 卡在 'transcribing'，状态机不允许重进 → 转写按钮永远消失（真机实证）。
   onMounted 对账应把它回退 'recording'，按钮重新出现且能完整跑完转写。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}

const fakePlugin = /* js */ `
window.Capacitor = { Plugins: {
  Transcriber: {
    _ls: { download: [], transcribe: [] },
    addListener(name, cb) { this._ls[name].push(cb); return { remove: () => {} } },
    async _emit(name, data) { for (const cb of this._ls[name].slice()) cb(data) },
    async isModelReady() { return { ready: true, modelBytes: 239233841, tokensBytes: 309000 } },
    async downloadModel() { return { done: true } },
    async transcribe(args) {
      await this._emit('transcribe', { phase: 'decode', percent: 0, path: args.path })
      await this._emit('transcribe', { phase: 'resample', percent: 0, path: args.path })
      for (let i = 1; i <= 4; i++) { await this._emit('transcribe', { phase: 'asr', chunk: i, chunkTotal: 4, percent: i * 25, path: args.path }); await new Promise((r) => setTimeout(r, 100)) }
      return { text: '对账恢复后转写成功。', chunks: 4, durationMs: 30000, path: args.path }
    },
    async cancel() { return {} }
  }
}}`

const seed = /* js */ `
const lectures = [
  { id: 'lec_stuck', schedule_id: null, title: '卡死场次', status: 'transcribing', started_at: '2026-09-28T07:05:00.000Z', ended_at: '2026-09-28T08:05:00.000Z', duration_ms: 3600000, clip_count: 1, clips: [{ index: 0, path: 'lectures/stuck.aac', mime: 'audio/aac', duration_ms: 3600000, recorded_at: '2026-09-28T08:05:00.000Z' }], created_at: '2026-09-28T07:05:00.000Z', updated_at: '2026-09-28T07:06:00.000Z', transcript: null },
  { id: 'lec_ok', schedule_id: null, title: '正常场次', status: 'recording', started_at: '2026-09-28T09:00:00.000Z', ended_at: '2026-09-28T09:30:00.000Z', duration_ms: 1800000, clip_count: 1, clips: [{ index: 0, path: 'lectures/ok.aac', mime: 'audio/aac', duration_ms: 1800000, recorded_at: '2026-09-28T09:30:00.000Z' }], created_at: '2026-09-28T09:00:00.000Z', updated_at: '2026-09-28T09:30:00.000Z', transcript: null }
]
localStorage.setItem('web2.lectures', JSON.stringify(lectures))
localStorage.setItem('web2.onboarded', '1')`

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
await page.addInitScript(fakePlugin)
await page.addInitScript(seed)

try {
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
  await page.goto('http://127.0.0.1:4177/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)

  const navBtns = page.locator('nav button')
  await navBtns.nth(2).click()
  await page.waitForTimeout(400)

  const stuckRow = page.locator('li', { hasText: '卡死场次' })
  const okRow = page.locator('li', { hasText: '正常场次' })

  // 1. 对账：卡死场次回退 recording，状态文案不再是「转写中」
  const stuckLabel = (await stuckRow.locator('span').allTextContents()).join('')
  t('1. 卡死场次不再显示「转写中」', !stuckLabel.includes('转写中'))
  const db = JSON.parse(await page.evaluate(() => localStorage.getItem('web2.lectures')))
  t('2. localStorage 已回退 recording', db.find((x) => x.id === 'lec_stuck').status === 'recording')
  t('3. 正常场次不受影响', db.find((x) => x.id === 'lec_ok').status === 'recording')

  // 4. 转写按钮重新出现（两场各一个）
  t('4. 两场次均有「转写」按钮', (await page.locator('li button:has-text("转写")').count()) === 2)

  // 5. 恢复后能完整跑完转写（状态落库 transcribed + 文字稿）
  await stuckRow.locator('button:has-text("转写")').click()
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('web2.lectures')).find((x) => x.id === 'lec_stuck').status === 'transcribed',
    undefined,
    { timeout: 15000 }
  )
  t('5. 对账恢复后转写能跑完（transcribed 落库）', true)
  const db2 = JSON.parse(await page.evaluate(() => localStorage.getItem('web2.lectures')))
  t('6. 文字稿已写入', (db2.find((x) => x.id === 'lec_stuck').transcript || '').includes('对账恢复'))
} finally {
  await browser.close()
}
const failed = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
