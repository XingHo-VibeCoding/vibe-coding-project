/* 精确提醒提示行截图（我的 → 设置）
   跑法：先起 dist 静态服务（默认 4177）再 node tmp/exact-shot.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const pad = (n) => String(n).padStart(2, '0')
const d = new Date()
const TODAY = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())

const init = (cfg) => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.notify', JSON.stringify({ enabled: true, minutesBefore: 10 }))
  window.__n = { exact: cfg.exact, after: 'granted', asked: 0 }
  const ln = {
    createChannel: async () => ({}),
    registerActionTypes: async () => ({}),
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => ({ display: 'granted' }),
    getPending: async () => ({ notifications: [] }),
    cancel: async () => ({}),
    schedule: async () => ({ notifications: [] }),
    addListener: async () => ({ remove: async () => {} }),
    checkExactNotificationSetting: async () => ({ exact_alarm: window.__n.exact }),
    changeExactNotificationSetting: async () => {
      window.__n.asked++
      window.__n.exact = window.__n.after
      return { exact_alarm: window.__n.after }
    },
  }
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      LocalNotifications: ln,
      StatusFrame: {
        pushSnapshot: async () => ({ ok: true, running: true }),
        setEnabled: async () => ({ ok: true }),
        isRunning: async () => ({ running: true, enabled: true }),
        consumeActions: async () => ({ actions: [] }),
        addListener: async () => ({ remove: async () => {} }),
      },
      VoiceRecorder: {
        canDeviceVoiceRecord: async () => ({ value: true }),
        hasAudioRecordingPermission: async () => ({ value: true }),
        requestAudioRecordingPermission: async () => ({ value: true }),
        startRecording: async () => ({ value: true }),
        stopRecording: async () => ({ value: null }),
      },
    },
  }
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()
await page.addInitScript(init, { exact: 'denied' })
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
await page.locator('nav button', { hasText: '我的' }).click()
await page.waitForTimeout(400)
await page.locator('[data-settings-toggle]').click()
await page.waitForTimeout(400)
/* 把提示行滚到画面中间 */
await page.locator('[data-exact-row]').scrollIntoViewIfNeeded()
await page.waitForTimeout(300)
await page.screenshot({ path: 'tmp/exact-hint.png' })
console.log('写图 tmp/exact-hint.png')
await page.locator('[data-exact-ask]').click()
await page.waitForTimeout(900)
await page.locator('[data-exact-row]').scrollIntoViewIfNeeded()
await page.waitForTimeout(300)
await page.screenshot({ path: 'tmp/exact-after.png' })
console.log('写图 tmp/exact-after.png')
await browser.close()
