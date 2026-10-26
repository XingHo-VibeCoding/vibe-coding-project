/* 录音中头卡收起后的截图（bug 03 的证据） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:4177/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const clockAt = (iso) => `
  const FIXED = ${new Date(iso).getTime()};
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(FIXED); else super(...a) }
    static now() { return FIXED }
  }
  window.Date = FakeDate;
`
const FIXTURE = JSON.stringify({
  version: 1,
  schedules: [{ id: 'sch_1', semester: '2026-2027 秋冬', type: 'course', entries: [
    { id: 'c1', type: 'course', name: '交通工程', weekday: 1, start: '08:00', end: '09:35', place: '教二 108', weeks: null, term: '秋冬' },
    { id: 'c2', type: 'course', name: '结构力学Ⅰ', weekday: 1, start: '10:00', end: '11:40', place: '教二 209', weeks: null, term: '秋冬' },
    { id: 'c3', type: 'course', name: '线性代数', weekday: 1, start: '14:00', end: '15:40', place: '教二 110', weeks: null, term: '秋冬' },
    { id: 'c4', type: 'course', name: '弹性力学', weekday: 1, start: '16:45', end: '18:25', place: '教四 402', weeks: null, term: '秋冬' },
  ] }],
  semester: { name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 18 },
})
const FAKE = `
window.Capacitor = { isNativePlatform: () => true, Plugins: {
  VoiceRecorder: {
    canDeviceVoiceRecord: async () => ({ value: true }),
    hasAudioRecordingPermission: async () => ({ value: true }),
    requestAudioRecordingPermission: async () => ({ value: true }),
    startRecording: async () => ({ value: true }),
    stopRecording: async () => ({ value: { path: 'lectures/f.aac', mimeType: 'audio/aac', msDuration: 60000 } }),
  },
  RecorderService: { start: async () => ({ running: true }), stop: async () => ({}), isRunning: async () => ({ running: false }),
    scheduleAutoStop: async () => ({}), consumeAutoStop: async () => ({ consumed: false }) },
} }
`
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--disable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await ctx.route('**cdn.jsdelivr.net/**', (r) => r.abort())
await page.addInitScript(FAKE)
await page.addInitScript(clockAt('2026-10-12T14:30:00'))
await page.addInitScript(([fx]) => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme', 'light')
  localStorage.setItem('web2.data', fx)
  localStorage.removeItem('web2.dayOverrides')
}, [FIXTURE])
await page.goto(BASE, { waitUntil: 'load' })
await page.waitForSelector('[data-page="today"]')
await page.waitForTimeout(900)
await page.locator('[data-today-rec-start]').first().click()
/* ---- bug 04 证据：周课表恒定七列（周末没课也在） ---- */
const p2 = await ctx.newPage()
await p2.goto(BASE, { waitUntil: 'load' })
await p2.waitForSelector('[data-page="today"]')
await p2.waitForTimeout(900)
await p2.evaluate(() => document.querySelector('[data-nav="week"]').click())
await p2.waitForTimeout(900)
const grid = await p2.locator('[data-grid]').boundingBox()
await p2.screenshot({ path: 'tmp/week-7cols-shot.png', clip: { x: 0, y: Math.max(0, grid.y - 96), width: 390, height: grid.height + 120 } })
const cols = await p2.locator('[data-grid] [data-cell]').evaluateAll((els) => [...new Set(els.map((e) => e.dataset.cell.split('-')[0]))].length)
console.log('week cols =', cols)
