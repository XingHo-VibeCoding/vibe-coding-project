/* M3 手工桥时序验证：只模拟 bridge 底层 API（nativePromise/addListener），
   不直接挂 Plugins.Transcriber——让 APK 内真实的 shell.js?v=20260926d
   顶层桥代码自己执行挂载，然后断言网页侧 trSupported 判定与按钮渲染。
   （v1.8b 的 bug 正是这种真实时序下才暴露：假插件直接挂 Plugins 测不出） */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core')

let pass = 0, fail = 0
function t(name, ok) { if (ok) { pass++; console.log('PASS  ' + name) } else { fail++; console.log('FAIL  ' + name) } }

/* 2026-10-04：原来硬编码 http://127.0.0.1:4190/ —— 没有任何东西监听那个端口，
   脚本必然 ERR_CONNECTION_REFUSED 而永久变红。改成和其它脚本同一口径。 */
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.addInitScript(`
  // 模拟 Capacitor native-bridge：只有底层 API，无 Plugins
  const listeners = { download: [], transcribe: [] }
  window.__calls = []
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    nativePromise: (plugin, method, opts) => {
      window.__calls.push(method)
      if (method === 'isModelReady') return Promise.resolve({ ready: true, modelBytes: 239233841, tokensBytes: 309000 })
      if (method === 'downloadModel') {
        for (const cb of listeners.download.slice()) cb({ which: opts.which, percent: 50, loaded: 5, total: 10 })
        return Promise.resolve({ done: true })
      }
      if (method === 'transcribe') {
        for (const cb of listeners.transcribe.slice()) cb({ phase: 'asr', chunk: 1, chunkTotal: 1, percent: 100 })
        return Promise.resolve({ text: '桥时序验证文字稿。', chunks: 1 })
      }
      return Promise.resolve({})
    },
    addListener: (plugin, eventName, cb) => { listeners[eventName] = listeners[eventName] || []; listeners[eventName].push(cb); return { remove: () => {} } },
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

/* 2026-10-04：文件头写着「让 APK 内真实的 shell.js 顶层桥代码自己执行挂载」，
   但 readFileSync 一直是**死导入**——dist 构建里不含 shell.js，于是
   Capacitor.Plugins.Transcriber 永远挂不上，本脚本必然两条 FAIL。
   这里把壳工程里的真实 shell.js 注入进去（它自带 isNativePlatform 守卫，
   在假 Capacitor 之后执行，正好复现 App 里的真实时序）。 */
let shellSrc = ''
try {
  shellSrc = readFileSync('D:/Document/Project/vibe-coding-project-app/www-shell/shell.js', 'utf8')
} catch (e) {
  console.log('SKIP | 全部断言 ← 找不到壳工程的 www-shell/shell.js（' + e.message + '）')
  await browser.close()
  process.exit(0)
}
await page.addInitScript(shellSrc)

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.locator('nav button').nth(2).click()
await page.waitForTimeout(400)

// 1. 桥已由 shell.js 顶层代码挂上（模拟环境里 shell.js 是真实文件）
t('1. shell.js 顶层桥已挂 Plugins.Transcriber', await page.evaluate(() => !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Transcriber)))
// 2. 网页侧判定支持，转写按钮渲染（限定「我的」页：今日页也有一张课堂录音卡）
const btn = page.locator('[data-page="me"] li button:has-text("转写")')
t('2. 转写按钮渲染（trSupported=true）', await btn.count() >= 1)
// 3. 点转写 → isModelReady=true 直接识别 → 文字稿落库
await btn.first().click()
await page.waitForFunction(() => {
  const arr = JSON.parse(localStorage.getItem('web2.lectures'))
  return arr[0].status === 'transcribed'
}, undefined, { timeout: 10000 })
t('3. 转写完成：状态 transcribed', true)
t('4. 文字稿经桥正确回传', (await page.evaluate(() => JSON.parse(localStorage.getItem('web2.lectures'))[0].transcript)) === '桥时序验证文字稿。')
// 5. 完成后文字稿自动展开
t('5. 界面可见文字稿正文', (await page.locator('[data-page="me"]').getByText('桥时序验证文字稿。').count()) >= 1)
t('6. 无页面报错', errors.length === 0)
if (errors.length) console.log('  pageerror:', errors[0].slice(0, 200))

await browser.close()
console.log(`\\n结果: ${pass} 过 / ${fail} 挂`)
process.exit(fail ? 1 : 0)
