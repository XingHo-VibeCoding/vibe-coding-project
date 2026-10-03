/* 练耳区块截图（人工目视用，产物进 tmp/，截图不入库）
   跑法：node tmp/listen-shot.mjs（需先起 dist 静态服务，默认 4177） */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
function dkey(off) {
  const d = new Date(); d.setDate(d.getDate() + off)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
const seed = [
  { id: 'lis_a', name: '英语新闻听力 2026-10-01', file: 'news.mp3', seconds: 45, played_count: 3, last_played_at: null, review_stage: 2, next_due_date: dkey(-1), repeat_times: null, archived: false, created_at: '2026-09-28T00:00:00.000Z' },
  { id: 'lis_b', name: 'VOA 慢速', file: 'voa.mp3', seconds: 58, played_count: 1, last_played_at: null, review_stage: 1, next_due_date: dkey(0), repeat_times: null, archived: false, created_at: '2026-10-02T00:00:00.000Z' },
  { id: 'lis_c', name: 'TED 三分钟精选', file: 'ted.mp3', seconds: 180, played_count: 0, last_played_at: null, review_stage: 0, next_due_date: dkey(0), repeat_times: null, archived: false, created_at: '2026-10-03T00:00:00.000Z' },
]
/* 1 秒静音 WAV：用来真导入一段可播的音频，好在截图里看到「第 1/3 遍」 */
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.addInitScript((s) => {
  localStorage.setItem('web2.onboarded', '1')
  if (!sessionStorage.getItem('shot-seed')) { sessionStorage.setItem('shot-seed', '1'); localStorage.setItem('web2.listen', JSON.stringify(s)) }
}, seed)
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
await page.locator('nav button', { hasText: '我的' }).click()
await page.waitForTimeout(500)
await page.locator('[data-page="me"] button', { hasText: '打开' }).first().click()
await page.waitForTimeout(400)
/* 真导入一段 1 秒音频并点播放，让截图里能看到「第 N/3 遍」的连放提示 */
await page.locator('[data-page="me"] [data-listen-import]').setInputFiles({ name: '连放示例.wav', mimeType: 'audio/wav', buffer: wavBuffer() })
await page.waitForTimeout(900)
await page.locator('[data-page="me"] li', { hasText: '连放示例' }).first().locator('[data-listen-play]').click()
await page.waitForTimeout(350)
const card = page.locator('[data-page="me"] section', { hasText: '碎片练耳' }).first()
await card.scrollIntoViewIfNeeded()
await page.waitForTimeout(200)
await card.screenshot({ path: 'tmp/shot-listen-card.png' })
console.log('已写出 tmp/shot-listen-card.png')
await browser.close()
