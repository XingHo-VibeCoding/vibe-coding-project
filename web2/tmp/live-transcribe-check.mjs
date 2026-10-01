/* M5 第 4 步 DOM 检查：分段转写（边录边预转）的网页侧链路。
   注入假原生插件（VoiceRecorder/RecorderService/Transcriber），全链路可跑：
   A 开录 → startLive 被调（subDir=lectures）
   B 停录（live 有 2 段预转）→ 转写参数带 skipSegs=2 + prefixText，文字稿 = 前段+尾巴
   C 停录（live 没起过）→ 转写参数无 skipSegs，文字稿只有尾巴
   D 全程无页面错误
   （skipSegs 越界不重复拼、快照撕帧容错等原生逻辑只能真机验，见打包后清单）
   跑法：先起 dev server（4177）再 node tmp/live-transcribe-check.mjs（支持 TW_URL） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'

const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const MONDAY = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
const seedDoc = JSON.stringify({
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
  schedules: [], todos: [],
})

const FAKE = `
window.__fake = { live: null, liveResult: null, trCalls: [], stopCount: 0, recording: false };
window.Capacitor = {
  isNativePlatform: function () { return true },
  Plugins: {
    VoiceRecorder: {
      canDeviceVoiceRecord: async () => ({ value: true }),
      hasAudioRecordingPermission: async () => ({ value: true }),
      requestAudioRecordingPermission: async () => ({ value: true }),
      startRecording: async () => { window.__fake.recording = true; return { value: true } },
      stopRecording: async () => {
        if (!window.__fake.recording) throw { code: 'RECORDING_HAS_NOT_STARTED' }
        window.__fake.recording = false
        return { value: { path: 'lectures/fake.aac', mimeType: 'audio/aac', msDuration: 660000 } }
      }
    },
    RecorderService: {
      start: async () => ({ running: true }),
      stop: async () => ({}),
      isRunning: async () => ({ running: false }),
      scheduleAutoStop: async () => ({}),
      consumeAutoStop: async () => ({ consumed: false })
    },
    Transcriber: {
      isModelReady: async () => ({ ready: true, modelBytes: 230000000, tokensBytes: 309000 }),
      addListener: function () { return { remove: function () {} } },
      startLive: async (o) => { window.__fake.live = o; return { started: true } },
      stopLive: async () => {
        const r = window.__fake.liveResult; window.__fake.liveResult = null
        return r || { active: false }
      },
      transcribe: async (o) => {
        window.__fake.trCalls.push(o)
        return { text: (o.prefixText || '') + '尾巴文本', chunks: (o.skipSegs || 0) + 1, skipped: o.skipSegs || 0 }
      }
    }
  }
}
`

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
await page.addInitScript(FAKE)
await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc)})`)
await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)

async function latestLecture() {
  return page.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('web2.lectures') || '[]')
    return arr.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0] || null
  })
}

/* ===== A. 开录即 startLive ===== */
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.locator('[data-today-rec-start]').click()
await page.waitForTimeout(600)
const fakeA = await page.evaluate(() => window.__fake)
t('A1 开录后 startLive 被调', !!fakeA.live)
t('A2 subDir=lectures', fakeA.live && fakeA.live.subDir === 'lectures', JSON.stringify(fakeA.live))

/* ===== B. 停录：live 有 2 段预转 → 转写跳段 + 拼前缀 ===== */
await page.evaluate(() => { window.__fake.liveResult = { active: true, text: '前段文字', segs: 2 } })
await page.locator('[data-today-rec-stop]').click()
await page.waitForTimeout(1200)
const fakeB = await page.evaluate(() => window.__fake)
t('B1 最终转写被自动触发（1 次）', fakeB.trCalls.length === 1, JSON.stringify(fakeB.trCalls.map((c) => ({ s: c.skipSegs, p: c.prefixText }))))
t('B2 skipSegs=2 传给原生', fakeB.trCalls.length === 1 && fakeB.trCalls[0].skipSegs === 2)
t('B3 prefixText 传给原生', fakeB.trCalls.length === 1 && fakeB.trCalls[0].prefixText === '前段文字')
const lecB = await latestLecture()
t('B4 场次已转写完成', lecB && lecB.status === 'transcribed', lecB && lecB.status)
t('B5 文字稿 = 前段 + 尾巴', lecB && lecB.transcript === '前段文字尾巴文本', lecB && lecB.transcript)

/* ===== C. live 没起过 → 全量转写 ===== */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.locator('[data-today-rec-start]').click()
await page.waitForTimeout(600)
await page.locator('[data-today-rec-stop]').click()
await page.waitForTimeout(1200)
const fakeC = await page.evaluate(() => window.__fake)
t('C1 转写参数不带 skipSegs', fakeC.trCalls.length === 1 && fakeC.trCalls[0].skipSegs === undefined, JSON.stringify(Object.keys(fakeC.trCalls[0] || {})))
const lecC = await latestLecture()
t('C2 文字稿只有尾巴', lecC && lecC.transcript === '尾巴文本', lecC && lecC.transcript)

t('D1 全程无 pageerror', pageErrors.length === 0, pageErrors.join(' | '))

await browser.close()
const fails = results.filter((r) => !r[1])
console.log(`\n=== 分段转写：${results.length - fails.length}/${results.length} 项通过 ===`)
process.exit(fails.length ? 1 : 0)
