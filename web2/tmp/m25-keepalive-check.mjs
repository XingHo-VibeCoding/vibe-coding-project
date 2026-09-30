/* M2.5 录音保活：playwright 验证（注入假 RecorderService 桥，浏览器里跑全链路）
   跑法：先起 dev server（4177）再 node tmp/m25-keepalive-check.mjs
   验的是网页侧与保活桥的契约（真机才验得了「锁屏不断录」本身）：
   - 起录拉起服务且带场次标题、停录撤下一次
   - 录音停止失败时也照样撤下（finally 保证，不留幽灵通知）
   - 保活启动失败不影响录音，只把提示换成「先别锁屏」
   - App 启动对账：没有进行中的录音却检测到服务在跑 → 自动撤下
   - 浏览器无桥时静默降级（起录仍走「需在 App 内使用」提示） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = 'http://127.0.0.1:4177/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let pass = 0, fail = 0
const t = (name, cond) => { if (cond) { pass++; console.log('PASS  ' + name) } else { fail++; console.log('FAIL  ' + name) } }

const SEED = `localStorage.setItem('web2.onboarded','1')`

/* 假 Capacitor（App 平台）：录音插件 + 保活桥。
   行为开关走 URL query（init script 在每次导航都会重跑，用 localStorage/全局变量传配置会被重置）：
     ?recStopFails=1 录音插件停止报错   ?startFails=1 保活启动报错   ?running=1 保活服务已在跑
   调用记录放 window.__ka = [['start', title] | ['stop']] */
const FAKE_APP = `
  const q = new URLSearchParams(location.search)
  window.__ka = []
  window.__kaOpts = {
    startFails: q.get('startFails') === '1',
    recStopFails: q.get('recStopFails') === '1',
    running: q.get('running') === '1',
  }
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      VoiceRecorder: {
        canDeviceVoiceRecord: async () => ({ value: true }),
        hasAudioRecordingPermission: async () => ({ value: true }),
        requestAudioRecordingPermission: async () => ({ value: true }),
        startRecording: async () => ({ value: true }),
        stopRecording: async () => {
          if (window.__kaOpts.recStopFails) throw new Error('FAILED_TO_FETCH_RECORDING')
          return { value: { path: 'lectures/rec_fake.aac', mimeType: 'audio/aac', msDuration: 123456 } }
        },
      },
      RecorderService: {
        start: async (o) => {
          window.__ka.push(['start', (o && o.title) || ''])
          if (window.__kaOpts.startFails) throw new Error('系统不允许后台服务')
          return { running: true }
        },
        stop: async () => { window.__ka.push(['stop']); return {} },
        isRunning: async () => ({ running: !!window.__kaOpts.running }),
      },
    },
  }
`
const count = (ka, kind) => ka.filter((c) => c[0] === kind).length

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

/* ---------- 场景 A：正常链路——起录拉起保活、停录撤下 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } })
  await ctx.addInitScript(SEED)
  await ctx.addInitScript(FAKE_APP)
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'load' })
  await page.click('nav button >> nth=2') // 我的
  await page.waitForTimeout(400)
  await page.click('button:has-text("开始录音")')
  await page.waitForTimeout(600)

  const ka1 = await page.evaluate(() => window.__ka)
  t('A1 起录后保活服务被拉起一次', count(ka1, 'start') === 1)
  t('A2 保活带上了场次标题（' + (ka1[0] ? ka1[0][1] : '-') + '）', count(ka1, 'start') === 1 && String(ka1[0][1]).indexOf('课堂录音') === 0)
  t('A3 此时还没撤下服务', count(ka1, 'stop') === 0)
  t('A4 提示改为「锁屏、切到后台都会继续录」', (await page.locator('text=锁屏、切到后台都会继续录').count()) > 0)
  t('A5 录音条文案改为「锁屏也会继续录」', (await page.locator('text=录音中 · 锁屏也会继续录').count()) > 0)

  await page.click('button:has-text("停止并保存")')
  await page.waitForTimeout(600)
  const ka2 = await page.evaluate(() => window.__ka)
  t('A6 停录后撤下服务一次', count(ka2, 'stop') === 1)
  t('A7 撤下后没有多余的 start', count(ka2, 'start') === 1)
  t('A8 停录仍正常落盘（提示含「已保存」）', (await page.locator('text=已保存').first().isVisible()))
  await ctx.close()
}

/* ---------- 场景 B：录音停止失败——保活照样撤下（finally 路径） ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } })
  await ctx.addInitScript(SEED)
  await ctx.addInitScript(FAKE_APP)
  const page = await ctx.newPage()
  await page.goto(URL + '?recStopFails=1', { waitUntil: 'load' })
  await page.click('nav button >> nth=2')
  await page.waitForTimeout(400)
  await page.click('button:has-text("开始录音")')
  await page.waitForTimeout(500)
  await page.click('button:has-text("停止并保存")')
  await page.waitForTimeout(600)
  const ka = await page.evaluate(() => window.__ka)
  t('B1 录音停止报错后仍撤下服务一次', count(ka, 'stop') === 1)
  t('B2 报错就地提示「录音中断」', (await page.locator('text=录音中断').count()) > 0)
  await ctx.close()
}

/* ---------- 场景 C：保活启动失败——不影响录音，只换提示 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } })
  await ctx.addInitScript(SEED)
  await ctx.addInitScript(FAKE_APP)
  const page = await ctx.newPage()
  await page.goto(URL + '?startFails=1', { waitUntil: 'load' })
  await page.click('nav button >> nth=2')
  await page.waitForTimeout(400)
  await page.click('button:has-text("开始录音")')
  await page.waitForTimeout(600)
  const ka = await page.evaluate(() => window.__ka)
  t('C1 保活启动被尝试过一次', count(ka, 'start') === 1)
  t('C2 保活失败仍进入录音态（按钮为「停止并保存」）', await page.locator('button:has-text("停止并保存")').isVisible())
  t('C3 保活失败仍产生「录音中」场次', (await page.locator('text=录音中').count()) > 0)
  t('C4 提示改为「后台保活没起来…先别锁屏」', (await page.locator('text=后台保活没起来').count()) > 0)
  await page.click('button:has-text("停止并保存")')
  await page.waitForTimeout(600)
  const ka2 = await page.evaluate(() => window.__ka)
  t('C5 失败启动后停录仍撤下服务', count(ka2, 'stop') === 1)
  await ctx.close()
}

/* ---------- 场景 D：启动对账——残留的服务通知要被清掉 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } })
  await ctx.addInitScript(SEED)
  await ctx.addInitScript(FAKE_APP)
  const page = await ctx.newPage()
  await page.goto(URL + '?running=1', { waitUntil: 'load' })
  await page.waitForTimeout(800)
  const ka = await page.evaluate(() => window.__ka)
  t('D1 启动时检测到残留保活服务 → 自动撤下', count(ka, 'stop') === 1)
  t('D2 对账没有误起服务', count(ka, 'start') === 0)
  await ctx.close()
}

/* ---------- 场景 E：浏览器环境（无桥）→ 静默降级，不报错 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } })
  await ctx.addInitScript(SEED)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(URL, { waitUntil: 'load' })
  await page.click('nav button >> nth=2')
  await page.waitForTimeout(400)
  await page.click('button:has-text("开始录音")')
  await page.waitForTimeout(400)
  t('E1 浏览器点开始仍给「需在 App 内使用」提示', (await page.locator('text=需在 App 内使用').count()) > 0)
  t('E2 无桥时没有页面异常', errs.length === 0)
  t('E3 浏览器不显示「后台录音」说明（App 专属）', (await page.locator('text=录音时锁屏、切到别的应用').count()) === 0)
  await ctx.close()
}

/* ---------- 场景 F：App 环境「我的」页显示后台录音说明 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } })
  await ctx.addInitScript(SEED)
  await ctx.addInitScript(FAKE_APP)
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'load' })
  await page.click('nav button >> nth=2')
  await page.waitForTimeout(400)
  await page.locator('text=后台录音').first().scrollIntoViewIfNeeded()
  t('F1 App 环境显示「后台录音」说明行', (await page.locator('text=后台录音').count()) > 0)
  t('F2 说明里含通知权限提示', (await page.locator('text=打开本应用的通知权限').count()) > 0)
  t('F3 版本串已到 v1.23', (await page.locator('text=v1.23').count()) > 0)
  await ctx.close()
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
