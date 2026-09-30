/* M2 第 3 步截图：我的页录音区（空闲/录音中），供人工核对视觉 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = 'http://127.0.0.1:4187/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = 'D:/Document/Project/vibe-coding-project-web2/tmp/'

const FAKE_CAP = `
  window.Capacitor = { isNativePlatform: () => true, convertFileSrc: (p) => p,
    Plugins: { VoiceRecorder: {
      canDeviceVoiceRecord: async () => ({ value: true }),
      hasAudioRecordingPermission: async () => ({ value: true }),
      requestAudioRecordingPermission: async () => ({ value: true }),
      startRecording: async () => ({ value: true }),
      stopRecording: async () => ({ value: { path: '/x/rec.m4a', mimeType: 'audio/mp4', msDuration: 318000 } }) } } }
`
const SEED_LECS = `
  localStorage.setItem('web2.onboarded','1')
  localStorage.setItem('web2.lectures', JSON.stringify([
    { id:'lec_a', status:'summarized', title:'高等数学 · 第三章', started_at:'2026-09-26T02:00:00.000Z', ended_at:'2026-09-26T02:50:00.000Z', duration_ms:3000000, clip_count:1, clips:[{index:0,path:'/x/a.m4a',mime:'audio/mp4',duration_ms:3000000,recorded_at:'2026-09-26T02:50:00.000Z'}] },
    { id:'lec_b', status:'recording', title:'大学英语听说', started_at:'2026-09-25T06:10:00.000Z', ended_at:'2026-09-25T06:55:00.000Z', duration_ms:2700000, clip_count:1, clips:[{index:0,path:'/x/b.m4a',mime:'audio/mp4',duration_ms:2700000,recorded_at:'2026-09-25T06:55:00.000Z'}] }
  ]))
`

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
for (const mode of ['idle', 'recording']) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2 })
  await ctx.addInitScript(SEED_LECS)
  await ctx.addInitScript(FAKE_CAP)
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'load' })
  await page.click('nav button >> nth=2')
  await page.waitForTimeout(500)
  if (mode === 'recording') {
    await page.click('button:has-text("开始录音")')
    await page.waitForTimeout(3200)
  }
  await page.locator('section', { hasText: '课堂录音' }).first().screenshot({ path: OUT + 'shot-record-' + mode + '.png' })
  await ctx.close()
  console.log('已截图 shot-record-' + mode + '.png')
}
await browser.close()
