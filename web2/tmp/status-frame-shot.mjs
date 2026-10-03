/* v1.41.1 真机反馈修正的看图脚本：按通知栏「开始录音」后，今日页顶部到底长什么样。
   跑法：先起 dist 静态服务（默认 4177）再 node tmp/status-frame-shot.mjs */

const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

async function shot(name, viewport, act) {
  const ctx = await browser.newContext({ viewport })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    localStorage.setItem('web2.onboarded', '1')
    window.__f = { cbs: {} }
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        VoiceRecorder: {
          canDeviceVoiceRecord: async () => ({ value: true }),
          hasAudioRecordingPermission: async () => ({ value: true }),
          requestAudioRecordingPermission: async () => ({ value: true }),
          startRecording: async () => ({ value: true }),
          stopRecording: async () => ({ value: { path: 'lectures/shot.aac', mimeType: 'audio/aac', msDuration: 60000 } }),
        },
        StatusFrame: {
          pushSnapshot: async () => ({ ok: true, running: true }),
          setEnabled: async () => ({ ok: true }),
          isRunning: async () => ({ running: true, enabled: true }),
          consumeActions: async () => ({ actions: [] }),
          addListener: async (ev, cb) => {
            window.__f.cbs[ev] = cb
            return { remove: async () => {} }
          },
        },
      },
    }
  })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  if (act) await act(page)
  await page.screenshot({ path: name })
  await ctx.close()
}

/* 1. 今日页：按了「开始录音」→ 回执 + 录音中小条（看会不会盖住问候条） */
await shot('tmp/frame-toast-today.png', { width: 390, height: 844 }, async (page) => {
  await page.evaluate(() => window.__f.cbs.frameActions && window.__f.cbs.frameActions({ actions: [{ type: 'startRec' }] }))
  await page.waitForTimeout(600)
})

/* 2. 录音中小条的通高：只留小条，看看压在顶部什么位置 */
await shot('tmp/frame-banner-only.png', { width: 390, height: 844 }, async (page) => {
  await page.evaluate(() => window.__f.cbs.frameActions && window.__f.cbs.frameActions({ actions: [{ type: 'startRec' }] }))
  await page.waitForTimeout(1300)
})

/* 3. 小屏（小机型）：小条 + 回执是否挡住关键信息 */
await shot('tmp/frame-toast-small.png', { width: 360, height: 640 }, async (page) => {
  await page.evaluate(() => window.__f.cbs.frameActions && window.__f.cbs.frameActions({ actions: [{ type: 'startRec' }] }))
  await page.waitForTimeout(600)
})

/* 4. 周课表页：小条在别的 tab 上的位置 */
await shot('tmp/frame-toast-week.png', { width: 390, height: 844 }, async (page) => {
  await page.evaluate(() => window.__f.cbs.frameActions && window.__f.cbs.frameActions({ actions: [{ type: 'startRec' }] }))
  await page.waitForTimeout(600)
  await page.locator('nav button', { hasText: '周课表' }).click()
  await page.waitForTimeout(500)
})

await browser.close()
console.log('已写出 tmp/frame-toast-today.png / frame-banner-only.png / frame-toast-small.png / frame-toast-week.png')
