/* 真机复验清单的电脑侧补测（Day 20 第二轮收尾）：
   A 段 #7  老壳形态：有 Capacitor 但没有 StatusFrame / LocalNotifications 插件
            → 不显示入口、不报错、其余功能照常（精确提醒那一块也不出现 = #10 的老壳分支）
   B 段 #14 「跟着时间自动换」：用假时钟跨四个时段档，**只在跨档那一刻换一次**；
            同档内不来回跳、不抢用户手改（真机上要等真实时间流逝，这里用假时钟把逻辑跑完）
   C 段 #16 复盘提醒：排程契约（渠道 review-reminder / 标记 web2-review / 不带按钮 / 未来 7 天）
            + **点通知直达复盘浮层**（这条以前只有真机验过，补上断言与负例）

   跑法：先起 dist 静态服务（默认 4177，TW_URL 覆盖）再 node tmp/slots-notify-check.mjs
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

function watchErrors(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('favicon')) errors.push('HTTP ' + r.status() + ' ' + r.url())
  })
  return errors
}

/* ===== A. #7 / #10 老壳形态：Capacitor 在，但两个插件都没有 ===== */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = watchErrors(page)
  await page.addInitScript(() => {
    localStorage.setItem('web2.onboarded', '1')
    /* 老壳：壳在（isNativePlatform 真），但没装这两个插件 */
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        VoiceRecorder: {
          canDeviceVoiceRecord: async () => ({ value: true }),
          hasAudioRecordingPermission: async () => ({ value: true }),
          requestAudioRecordingPermission: async () => ({ value: true }),
          startRecording: async () => ({ value: true }),
          stopRecording: async () => ({ value: null }),
        },
      },
    }
  })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)

  /* 入口都在「我的 → 设置」折叠区里 */
  await page.locator('nav button', { hasText: '我的' }).click()
  await page.waitForTimeout(400)
  const tg = page.locator('[data-settings-toggle]')
  if ((await tg.count()) === 1) {
    await tg.click()
    await page.waitForTimeout(400)
  }
  t('A1. 没有 StatusFrame 插件 → 设置里不出现「常驻状态框」那一行', (await page.locator('[data-frame-row]').count()) === 0)
  t('A2. 没有 LocalNotifications 插件 → 精确提醒那一块整块不出现（#10 老壳分支）', (await page.locator('[data-exact-row]').count()) === 0)
  t('A3. 设置页仍然完整（关于/清除数据这些照常在）', (await page.locator('[data-settings-toggle]').count()) === 1)
  /* 其余功能照常：切页签能切、今日页有内容 */
  await page.locator('nav button', { hasText: '周课表' }).click()
  await page.waitForTimeout(400)
  t('A4. App 其余功能照常（能切到周课表）', (await page.locator('[data-page="week"]').count()) === 1)
  t('A5. 全程无报错（降级不抛异常）', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/* ===== B. #14 跟着时间自动换：假时钟跨档 ===== */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = watchErrors(page)
  /* 2026-10-04 是周日；12:00 落在「白天」档 */
  await page.clock.install({ time: new Date('2026-10-04T12:00:00') })
  await page.addInitScript(() => {
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.theme.auto', '1') // 开「跟着时间自动换」
  })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  const read = () =>
    page.evaluate(() => ({
      acc: document.documentElement.dataset.accent,
      dark: document.documentElement.classList.contains('dark'),
      savedAcc: localStorage.getItem('web2.accent'),
      savedTh: localStorage.getItem('web2.theme'),
      flag: localStorage.getItem('web2.theme.auto'),
    }))
  const H = 3600 * 1000

  let s = await read()
  t('B1. 12:00 开自动 → 落到「白天」蓝/浅', s.acc === 'blue' && s.dark === false && s.flag === '1', JSON.stringify(s))
  await page.clock.fastForward(30 * 60 * 1000)
  s = await read()
  t('B2. 同档内过 30 分钟不来回跳（还是白天蓝）', s.acc === 'blue' && s.dark === false, JSON.stringify(s))
  await page.clock.fastForward(4.5 * H)
  s = await read()
  t('B3. 跨 17:00 那一刻换到「傍晚」淡紫/浅（只换一次）', s.acc === 'lavender' && s.dark === false, JSON.stringify(s))
  await page.clock.fastForward(4 * H)
  s = await read()
  t('B4. 跨 21:00 换到「夜里」→ 深色', s.dark === true && s.acc === 'lavender', JSON.stringify(s))
  await page.clock.fastForward(5 * H)
  s = await read()
  t('B5. 跨零点（02:00）仍算「夜里」档（21–29 跨夜）', s.dark === true, JSON.stringify(s))
  await page.clock.fastForward(3 * H)
  s = await read()
  t('B6. 跨 05:00 换到「清晨」薄荷/浅', s.acc === 'mint' && s.dark === false, JSON.stringify(s))
  /* 同档内用户手改配色：巡检不许抢回去 */
  await page.evaluate(() => localStorage.setItem('web2.accent', 'blue'))
  await page.clock.fastForward(10 * 60 * 1000)
  s = await read()
  t('B7. 同档内手改配色不被抢回（跨档才接管）', s.savedAcc === 'blue', JSON.stringify(s))
  t('B8. 全程无报错', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/* ===== C. #16 复盘提醒：排程契约 + 点通知直达复盘浮层 ===== */
function bridgeScript() {
  return () => {
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.notify', JSON.stringify({ enabled: true, minutesBefore: 10 }))
    localStorage.setItem('web2.listen.set', JSON.stringify({ enabled: true }))
    localStorage.setItem('web2.review.set', JSON.stringify({ enabled: true, at: '22:00' }))
    /* 假桥要**有状态**：真机上 pending 里就是上一轮排的，重排时插件会按 id 取消自己那批。
       如果 getPending 永远回空，第二次排程就没法取消 → 条数翻倍（那是测试脚手架的失真，不是产品 bug）。 */
    window.__n = { scheduled: [], cancelled: [], pending: [], cbs: {}, channels: [], asked: 0, runs: 0 }
    const ln = {
      createChannel: async (o) => {
        window.__n.channels.push(o && o.id)
        return {}
      },
      registerActionTypes: async () => ({}),
      checkPermissions: async () => ({ display: 'granted' }),
      requestPermissions: async () => ({ display: 'granted' }),
      getPending: async () => ({ notifications: window.__n.pending.map((n) => ({ ...n })) }),
      cancel: async (o) => {
        const ids = ((o && o.notifications) || []).map((n) => n.id)
        window.__n.cancelled.push(...ids)
        window.__n.pending = window.__n.pending.filter((n) => !ids.includes(n.id))
        return {}
      },
      schedule: async (o) => {
        window.__n.runs += 1
        const list = ((o && o.notifications) || []).map((n) => ({ ...n }))
        window.__n.scheduled.push(...list)
        window.__n.pending.push(...list)
        return { notifications: [] }
      },
      addListener: async (ev, cb) => {
        window.__n.cbs[ev] = cb
        return { remove: async () => {} }
      },
      checkExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
      changeExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
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
}

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = watchErrors(page)
  await page.addInitScript(bridgeScript())
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)

  const rv = await page.evaluate(() => window.__n.pending.filter((n) => n.extra && n.extra.src === 'web2-review'))
  t('C1. 复盘提醒排了未来 7 天（每天一条）', rv.length === 7, String(rv.length))
  t('C2. 渠道是 review-reminder、标记是 web2-review', rv.length > 0 && rv.every((n) => n.channelId === 'review-reminder' && n.extra.src === 'web2-review'))
  t('C3. 复盘提醒**不带按钮**（点通知就进浮层，不是「开始录音」）', rv.every((n) => n.actionTypeId === undefined), JSON.stringify(rv[0] && rv[0].actionTypeId))
  t('C4. 时间落在设定的 22:00 上', rv.every((n) => new Date(n.schedule.at).getHours() === 22), rv.map((n) => new Date(n.schedule.at).getHours()).join(','))
  const srcs = await page.evaluate(() => [...new Set(window.__n.pending.map((n) => n.extra && n.extra.src))])
  t('C5. 三批提醒各用各的标记，同时并存没互相顶掉', srcs.includes('web2-review') && srcs.includes('web2-m5'), srcs.join(','))
  /* 重排契约：改一次提醒时间会重排 —— 只该清掉自己那批，不许叠加、不许误清别的批次 */
  const before = await page.evaluate(() => ({
    rv: window.__n.pending.filter((n) => n.extra && n.extra.src === 'web2-review').length,
    m5: window.__n.pending.filter((n) => n.extra && n.extra.src === 'web2-m5').length,
    cancelIds: window.__n.cancelled.length,
  }))
  await page.locator('nav button', { hasText: '我的' }).click()
  await page.waitForTimeout(400)
  const tg2 = page.locator('[data-settings-toggle]')
  if ((await tg2.count()) === 1) {
    await tg2.click()
    await page.waitForTimeout(400)
  }
  await page.locator('[data-review-at="23:00"]').click()
  await page.waitForTimeout(600)
  await page.locator('[data-review-at="22:00"]').click()
  await page.waitForTimeout(800)
  const after = await page.evaluate(() => ({
    rv: window.__n.pending.filter((n) => n.extra && n.extra.src === 'web2-review').length,
    m5: window.__n.pending.filter((n) => n.extra && n.extra.src === 'web2-m5').length,
    rvHours: window.__n.pending.filter((n) => n.extra && n.extra.src === 'web2-review').map((n) => new Date(n.schedule.at).getHours()),
    runs: window.__n.runs,
  }))
  t('C6. 重排不叠加（改时间后仍是 7 条，历史 pending 被自己清掉）', after.rv === 7 && after.runs >= 2, JSON.stringify(after))
  t('C7. 重排没误清别的批次（课前提醒条数不变）', after.m5 === before.m5, before.m5 + ' → ' + after.m5)
  t('C8. 改档后时间跟着走（全部落在 22:00）', after.rvHours.every((h) => h === 22), after.rvHours.join(','))

  /* 点通知：直接从事件进来，必须把复盘浮层打开 */
  await page.evaluate(() => window.__n.cbs.localNotificationActionPerformed({ actionId: 'tap', notification: { extra: { src: 'web2-review', key: 'rev_1' } } }))
  await page.waitForTimeout(900)
  t('C9. 点复盘通知 → 复盘浮层直接打开（第 1 题在）', (await page.locator('[data-review-q]').count()) === 1, await page.locator('[data-review-q]').innerText().catch(() => '(没开)'))
  const sheetTxt = await page.locator('[data-review-q]').locator('xpath=ancestor::div[1]').innerText().catch(() => '')
  t('C10. 打开的是「今天收个尾」这一套（带 N/4 进度）', /1\s*\/\s*4/.test(sheetTxt.replace(/\s+/g, ' ')) || sheetTxt.includes('今天收个尾'), sheetTxt.replace(/\s+/g, ' ').slice(0, 60))
  t('C11. 全程无报错', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

/* 负例：练耳提醒点进来只该展开练耳卡，不许开复盘浮层 */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  const errors = watchErrors(page)
  await page.addInitScript(bridgeScript())
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)
  await page.evaluate(() => window.__n.cbs.localNotificationActionPerformed({ actionId: 'tap', notification: { extra: { src: 'web2-listen' } } }))
  await page.waitForTimeout(800)
  t('C12. 点练耳通知不会误开复盘浮层（负例）', (await page.locator('[data-review-q]').count()) === 0)
  t('C13. 点未知来源的通知也不炸', await page.evaluate(async () => {
    try {
      window.__n.cbs.localNotificationActionPerformed({ actionId: 'tap', notification: {} })
      return true
    } catch (e) {
      return false
    }
  }))
  t('C14. 无报错', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

await browser.close()
console.log('\n结果：' + pass + ' 过 / ' + fail + ' 挂')
process.exit(fail ? 1 : 0)
