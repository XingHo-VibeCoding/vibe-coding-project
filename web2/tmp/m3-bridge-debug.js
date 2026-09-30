/* 一次性调试：看桥挂载、trSupported、按钮区结构 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core')

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 150)) })

await page.addInitScript(`
  const listeners = { download: [], transcribe: [] }
  window.__calls = []
  window.Capacitor = {
    isNativePlatform: () => true,
    nativePromise: (p, method, opts) => {
      window.__calls.push(method)
      if (method === 'isModelReady') return Promise.resolve({ ready: true, modelBytes: 1, tokensBytes: 1 })
      if (method === 'transcribe') return Promise.resolve({ text: 'x', chunks: 1 })
      return Promise.resolve({ done: true })
    },
    addListener: (p, eventName, cb) => { (listeners[eventName] = listeners[eventName] || []).push(cb); return { remove: () => {} } },
  }
  localStorage.setItem('web2.lectures', JSON.stringify([{
    id: 'lec_a', schedule_id: null, title: '桥时序场次', status: 'recording',
    started_at: '2026-09-26T09:00:00.000Z', ended_at: '2026-09-26T09:45:00.000Z',
    duration_ms: 2700000, clip_count: 1,
    clips: [{ index: 0, path: 'lectures/a.aac', mime: 'audio/aac', duration_ms: 2700000, recorded_at: 'x' }],
    created_at: 'x', updated_at: 'x', transcript: null,
  }]))
  localStorage.setItem('web2.onboarded', '1')
`)

await page.goto('http://127.0.0.1:4190/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
await page.locator('nav button').nth(2).click()
await page.waitForTimeout(500)

const probe = await page.evaluate(() => {
  const cap = window.Capacitor
  const lis = [...document.querySelectorAll('li')].map((x) => x.textContent.replace(/\s+/g, ' ').slice(0, 120))
  return {
    hasCap: !!cap,
    isNative: cap ? String(cap.isNativePlatform()) : null,
    pluginsKeys: cap && cap.Plugins ? Object.keys(cap.Plugins) : null,
    hasBridge: !!(cap && cap.Plugins && cap.Plugins.Transcriber),
    nativePromiseType: typeof (cap && cap.nativePromise),
    lis,
  }
})
console.log(JSON.stringify(probe, null, 2))
console.log('pageerrors:', errors.length ? errors.slice(0, 4) : 'none')
await browser.close()
