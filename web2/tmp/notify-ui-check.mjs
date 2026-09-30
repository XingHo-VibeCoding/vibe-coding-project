/* M5 通知 UI：playwright 验证（注入假 LocalNotifications 桥，浏览器里跑全链路）
   跑法：先起 dev server（4177）再 node tmp/notify-ui-check.mjs
   验的是网页侧与通知插件的契约（真机才验得了系统通知实际弹出）：
   - 启动建渠道/注册 action/请求权限/按示例课表排程
   - 关开关 → 清空已排；改提前量 → 重排
   - 测试按钮 → 带「开始录音」action 的即时通知
   - action 事件（点通知上的「开始录音」）→ 跳「我的」并直接开录
   - 浏览器无桥降级 / 权限被拒提示 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = 'http://127.0.0.1:4177/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let pass = 0, fail = 0
const t = (name, cond) => { if (cond) { pass++; console.log('PASS  ' + name) } else { fail++; console.log('FAIL  ' + name) } }

const SEED = `localStorage.setItem('web2.onboarded','1')`

/* 假 Capacitor：LocalNotifications（行为开关走 ?permDenied=1）+ 录音插件（action 开录用）。
   调用记录放 window.__notify。 */
const FAKE_APP = `
  const q = new URLSearchParams(location.search)
  window.__notify = { channels: [], actionTypes: [], scheduled: [], cancelled: [], permReq: 0, listeners: [] }
  const denied = q.get('permDenied') === '1'
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      LocalNotifications: {
        createChannel: async (o) => { window.__notify.channels.push(o.id) },
        registerActionTypes: async (o) => { window.__notify.actionTypes.push(o.types[0].id) },
        checkPermissions: async () => ({ display: denied ? 'denied' : 'granted' }),
        requestPermissions: async () => { window.__notify.permReq++; return { display: denied ? 'denied' : 'granted' } },
        getPending: async () => ({ notifications: window.__notify.scheduled.map((n) => ({ id: n.id, extra: n.extra })) }),
        cancel: async (o) => {
          const ids = o.notifications.map((n) => n.id)
          window.__notify.cancelled.push(...ids)
          window.__notify.scheduled = window.__notify.scheduled.filter((n) => !ids.includes(n.id))
        },
        schedule: async (o) => { window.__notify.scheduled.push(...o.notifications); return { notifications: o.notifications.map((n) => ({ id: n.id })) } },
        addListener: async (ev, cb) => { window.__notify.listeners.push(cb); return { remove: () => {} } },
      },
      VoiceRecorder: {
        canDeviceVoiceRecord: async () => ({ value: true }),
        hasAudioRecordingPermission: async () => ({ value: true }),
        requestAudioRecordingPermission: async () => ({ value: true }),
        startRecording: async () => ({ value: true }),
        stopRecording: async () => ({ value: { path: 'lectures/x.aac', mimeType: 'audio/aac', msDuration: 1000 } }),
      },
      RecorderService: {
        start: async () => ({ running: true }),
        stop: async () => {},
        isRunning: async () => ({ running: false }),
      },
    },
  }
`

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

/* ---------- 场景 A：启动 → 环境 + 首次排程 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } })
  await ctx.addInitScript(SEED)
  await ctx.addInitScript(FAKE_APP)
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'load' })
  await page.waitForTimeout(1000)
  const n = await page.evaluate(() => window.__notify)
  t('A1 建了两个通知渠道（课前提醒 + 完成通知）', n.channels.join() === 'class-reminder,task-done')
  t('A2 注册了带「开始录音」按钮的 action 组', n.actionTypes.includes('class-reminder'))
  t('A3 已有权限时不重复申请（permReq=0）', n.permReq === 0)
  t('A4 按示例课表排了程（>10 条）', n.scheduled.length > 10)
  t('A5 每条都带渠道 + actionTypeId + 本应用标记', n.scheduled.every((x) => x.channelId === 'class-reminder' && x.actionTypeId === 'class-reminder' && x.extra && x.extra.src === 'web2-m5'))
  t('A6 排程时刻都是未来', n.scheduled.every((x) => new Date(x.schedule.at).getTime() > Date.now() - 60000))
  await page.click('nav button >> nth=2') // 我的
  await page.waitForTimeout(400)
  t('A7 设置区出现「课前提醒」且开关为开', (await page.locator('button[aria-label="课前提醒开关"]').count()) === 1)
  const verText = (await page.locator('text=/^v\\d+\\.\\d+$/').first().innerText()).trim()
  t('A8 页面上有 vX.Y 版本串（宽松匹配：以前写死 v1.23，每次升版本都要回来改，漏改就假红）', /^v\d+\.\d+$/.test(verText), verText)

  /* ---------- B：关开关 → 清空已排 ---------- */
  await page.click('button[aria-label="课前提醒开关"]')
  await page.waitForTimeout(400)
  let n2 = await page.evaluate(() => window.__notify)
  t('B1 关开关后清空了已排通知', n2.cancelled.length > 0 && n2.scheduled.length === 0)
  t('B2 开关视觉为关', (await page.locator('button[aria-label="课前提醒开关"]').getAttribute('class')).includes('bg-ink/15'))

  /* ---------- C：开回 + 改 15 分钟 → 重排 ---------- */
  const before = n2.scheduled.length
  await page.click('button[aria-label="课前提醒开关"]')
  await page.waitForTimeout(400)
  n2 = await page.evaluate(() => window.__notify)
  t('C1 重开后排程恢复', n2.scheduled.length > 10)
  await page.click('button:has-text("15 分钟")')
  await page.waitForTimeout(400)
  n2 = await page.evaluate(() => window.__notify)
  t('C2 改 15 分钟后重排（数量变化）', n2.scheduled.length !== before)
  t('C3 新排程用 15 分钟提前量', n2.scheduled.some((x) => x.body && x.body.indexOf('15 分钟后开始') !== -1))

  /* ---------- D：测试通知 ---------- */
  await page.click('button:has-text("发测试通知")')
  await page.waitForTimeout(400)
  n2 = await page.evaluate(() => window.__notify)
  const last = n2.scheduled[n2.scheduled.length - 1]
  t('D1 测试通知发出且带 action 按钮', last.title === '测试提醒' && last.actionTypeId === 'class-reminder')
  t('D2 就地提示已显示', (await page.locator('text=几秒后看通知栏').count()) > 0)

  /* ---------- E：action「开始录音」→ 跳我的页 + 直接开录 ---------- */
  await page.evaluate(() => {
    const cb = window.__notify.listeners[window.__notify.listeners.length - 1]
    cb({ actionId: 'START_REC', notification: { extra: {} } })
  })
  await page.waitForTimeout(800)
  t('E1 点「开始录音」action 后直接进入录音态', await page.locator('button:has-text("停止并保存")').isVisible())
  t('E2 录音条出现（在「我的」页可见）', (await page.locator('text=录音中 · 锁屏也会继续录').count()) > 0)

  /* ---------- F：点通知本体（tap）→ 只定位不开录 ---------- */
  await page.click('button:has-text("停止并保存")') // 先停
  await page.waitForTimeout(500)
  await page.evaluate(() => {
    const cb = window.__notify.listeners[window.__notify.listeners.length - 1]
    cb({ actionId: 'tap', notification: { extra: {} } })
  })
  await page.waitForTimeout(300)
  t('F 点通知本体只定位不开录（无新录音态）', (await page.locator('button:has-text("停止并保存")').count()) === 0)
  await ctx.close()
}

/* ---------- 场景 G：通知权限被拒 → 明确提示 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } })
  await ctx.addInitScript(SEED)
  await ctx.addInitScript(FAKE_APP)
  const page = await ctx.newPage()
  await page.goto(URL + '?permDenied=1', { waitUntil: 'load' })
  await page.waitForTimeout(1000)
  t('G1 权限被拒时显示红色提示', (await page.locator('text=通知权限被拒绝了').count()) > 0)
  const n = await page.evaluate(() => window.__notify)
  t('G2 被拒后仍完成排程（权限与排程互不阻塞）', n.scheduled.length > 10)
  t('G3 权限缺失时发起了申请', n.permReq === 1)
  await ctx.close()
}

/* ---------- 场景 H：浏览器无桥 → 置灰降级 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } })
  await ctx.addInitScript(SEED)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e)))
  await page.goto(URL, { waitUntil: 'load' })
  await page.click('nav button >> nth=2')
  await page.waitForTimeout(400)
  t('H1 无桥时开关不渲染（能力不可用）', (await page.locator('button[aria-label="课前提醒开关"]').count()) === 0)
  t('H2 副文案说明仅 App 生效', (await page.locator('text=通知能力仅 App 内生效').count()) > 0)
  t('H3 无页面异常', errs.length === 0)
  await ctx.close()
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
