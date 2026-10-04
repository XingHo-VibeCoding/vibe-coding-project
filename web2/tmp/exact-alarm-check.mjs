/* 精确提醒（Android 12+ SCHEDULE_EXACT_ALARM）检查
   背景：Android 12 起没这个特殊权限的应用只能排「非精确闹钟」，系统给最多 1 小时的浮动窗口
   （2026-10-03 真机 `dumpsys alarm` 实测 window=+1h0m0s0ms），到点可能晚很久。
   这一段的契约：
     ① 插件能查（checkExactNotificationSetting）且回报没允许时，「我的 → 设置」里出现一行提示；
     ② 点「去允许精确提醒」会调 changeExactNotificationSetting；
     ③ 允许之后提示消失、有回执，并且**重排一次提醒**（插件文档：改这个开关会清掉已排的精确闹钟）；
     ④ 已经允许 / 两种提醒都关掉 / 插件没有这两个方法 → 那一行都不出现，且不报错。

   跑法：先起 dist 静态服务（默认 4177）再 node tmp/exact-alarm-check.mjs
   注意：playwright 会 spawn Chrome，沙箱下会被拦（EPERM），需要 danger-full-access。 */

let pass = 0
let fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

/* 今天的日期串（种子日程用具体日期） */
const pad = (n) => String(n).padStart(2, '0')
const now = new Date()
const TODAY = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())

/* 假 LocalNotifications 桥：按真插件语义建模
   - checkExactNotificationSetting / changeExactNotificationSetting 是 Android 12+ 才有的方法（易漏，故做成可开关）
   - schedule 记账，用来验「允许之后有没有重排」 */
function initScript({ exact = 'denied', after = 'granted', hasApi = true, notifyEnabled = true, listenEnabled = true, seedEvent = true } = {}) {
  return (cfg) => {
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.notify', JSON.stringify({ enabled: cfg.notifyEnabled, minutesBefore: 10 }))
    localStorage.setItem('web2.listen.set', JSON.stringify({ enabled: cfg.listenEnabled }))
    if (cfg.seedEvent) {
      localStorage.setItem(
        'web2.events',
        JSON.stringify([
          {
            id: 'evt_exact1',
            type: 'event',
            title: '精确提醒测试日程',
            note: '',
            location: '测试楼 202',
            weekday: null,
            start_time: '13:05',
            duration: 60,
            week_rule: null,
            date: cfg.today,
            color: '',
            semester_id: null,
            manual_edited: true,
          },
        ])
      )
    }
    window.__n = { exact: cfg.exact, after: cfg.after, asked: 0, scheduled: [], channels: [], actionTypes: [] }
    const ln = {
      createChannel: async (o) => {
        window.__n.channels.push(o && o.id)
        return {}
      },
      registerActionTypes: async (o) => {
        window.__n.actionTypes.push(o)
        return {}
      },
      checkPermissions: async () => ({ display: 'granted' }),
      requestPermissions: async () => ({ display: 'granted' }),
      getPending: async () => ({ notifications: [] }),
      cancel: async () => ({}),
      schedule: async (o) => {
        window.__n.scheduled.push((o && o.notifications ? o.notifications.length : 0))
        return { notifications: (o && o.notifications) || [] }
      },
      addListener: async () => ({ remove: async () => {} }),
    }
    if (cfg.hasApi) {
      ln.checkExactNotificationSetting = async () => ({ exact_alarm: window.__n.exact })
      ln.changeExactNotificationSetting = async () => {
        window.__n.asked++
        window.__n.exact = window.__n.after
        return { exact_alarm: window.__n.after }
      }
    }
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        LocalNotifications: ln,
        /* 别让状态框/录音桥缺席导致页面报错（那不是这一段要测的东西） */
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
}

async function openMeSettings(page) {
  await page.locator('nav button', { hasText: '我的' }).click()
  await page.waitForTimeout(400)
  const tg = page.locator('[data-settings-toggle]')
  if ((await tg.count()) === 1) {
    await tg.click()
    await page.waitForTimeout(300)
  }
}

/* ===== A. 没允许 → 出现提示、点按钮能去授权、允许后消失并重排 ===== */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url())
  })
  await page.addInitScript(initScript({ exact: 'denied', after: 'granted' }), { exact: 'denied', after: 'granted', notifyEnabled: true, listenEnabled: true, seedEvent: true, today: TODAY, hasApi: true })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  await openMeSettings(page)

  const row = page.locator('[data-exact-row]')
  t('A1. 查得到、又没允许、提醒是开着的 → 设置里出现提示行', (await row.count()) === 1)                                    
  const rowText = (await row.count()) === 1 ? await row.innerText() : ''
  t('A2. 文案说清后果（最多 1 小时）与是谁的权限', rowText.includes('1 小时') && rowText.includes('闹钟和提醒'), rowText.replace(/\s+/g, ' ').slice(0, 80))
  t('A3. 有「去允许精确提醒」按钮', (await page.locator('[data-exact-ask]').count()) === 1, await page.locator('[data-exact-ask]').innerText().catch(() => '(无)'))

  const schedBefore = await page.evaluate(() => window.__n.scheduled.length)
  await page.locator('[data-exact-ask]').click()
  await page.waitForTimeout(900)
  t('A4. 点按钮真的调了 changeExactNotificationSetting', (await page.evaluate(() => window.__n.asked)) === 1, String(await page.evaluate(() => window.__n.asked)))
  t('A5. 允许之后警告部分撤掉（按钮消失，不再让人去授权）', (await page.locator('[data-exact-warn]').count()) === 0 && (await page.locator('[data-exact-ask]').count()) === 0)
  const msg = await page.locator('[data-exact-msg]').innerText().catch(() => '')
  t('A6. 有回执文案说明已重排', msg.includes('精确') && (await page.locator('[data-exact-msg]').count()) === 1, msg)
  const schedAfter = await page.evaluate(() => window.__n.scheduled.length)
  t('A7. 允许之后重排了一次提醒（改这个开关会清掉已排的精确闹钟）', schedAfter > schedBefore, schedBefore + ' → ' + schedAfter)
  t('A8. 重排的提醒条数 > 0（种子日程真的进了排程）', (await page.evaluate(() => window.__n.scheduled.slice(-1)[0])) > 0, String(await page.evaluate(() => window.__n.scheduled.slice(-1)[0])))
  t('A9. 全程无报错', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/* ===== B. 已经允许 → 不出现 ===== */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(initScript({ exact: 'granted' }), { exact: 'granted', after: 'granted', notifyEnabled: true, listenEnabled: true, seedEvent: true, today: TODAY, hasApi: true })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  await openMeSettings(page)
  t('B1. 已经允许精确提醒 → 没有这一行（不打扰）', (await page.locator('[data-exact-row]').count()) === 0)
  t('B2. 没点过授权按钮', (await page.evaluate(() => window.__n.asked)) === 0)
  t('B3. 无报错', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/* ===== C. 两种到点提醒都关着 → 不出现（没排提醒就别提权限） ===== */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(initScript({ exact: 'denied' }), { exact: 'denied', after: 'granted', notifyEnabled: false, listenEnabled: false, seedEvent: true, today: TODAY, hasApi: true })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  await openMeSettings(page)
  t('C1. 课前提醒与练耳提醒都关掉 → 没有这一行', (await page.locator('[data-exact-row]').count()) === 0)
  t('C2. 无报错', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/* ===== D. 老壳/老系统没有这两个方法 → 整块不出现且不报错 ===== */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(initScript({ hasApi: false }), { exact: 'denied', after: 'granted', notifyEnabled: true, listenEnabled: true, seedEvent: true, today: TODAY, hasApi: false })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
  await openMeSettings(page)
  t('D1. 插件没有 checkExactNotificationSetting → 不出现（能力探测，不写死平台）', (await page.locator('[data-exact-row]').count()) === 0)
  t('D2. 无报错（降级静默）', errors.length === 0, errors.join(' | '))
  /* 顺带守一句：课前提醒本身仍然照常排（不能因为探测不到权限就不排了） */
  t('D3. 探测不到精确闹钟能力也不影响正常排提醒', (await page.evaluate(() => window.__n.scheduled.length)) >= 1, String(await page.evaluate(() => window.__n.scheduled.length)))
  await ctx.close()
}

/* ===== E. 浏览器（没有原生桥）→ 零变化 ===== */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(() => localStorage.setItem('web2.onboarded', '1'))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await openMeSettings(page)
  t('E1. 没有原生桥时不出现这一行（网页版零变化）', (await page.locator('[data-exact-row]').count()) === 0)
  t('E2. 无报错', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
console.log('\n结果：' + pass + ' 过 / ' + fail + ' 挂')
process.exit(fail ? 1 : 0)
