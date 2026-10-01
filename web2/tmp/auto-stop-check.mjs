/* M5 第 3 步 DOM 检查：到点自动停录的网页侧链路（注入假原生插件，全链路可跑）。
   断言：A 开录时把「下课 + 2 分钟宽限」排给原生 scheduleAutoStop（毫秒数吻合）
        B 手动停：正常收尾、场次落盘（假插件给 123s 文件）
        C 锁屏回来（visibilitychange）：原生强停结果被捞回，场次补齐 + 提示「自动停了」+ 不再手动 stop
        D App 内强停后用户点「停止并保存」：JS stop 报「没在录」→ 捞回结果按成功收尾（不误报中断）
   跑法：先起 dev server（4177）再 node tmp/auto-stop-check.mjs（支持 TW_URL 覆盖） */
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
const pad = (n) => String(n).padStart(2, '0')
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

// 今天一门「10 分钟前开、50 分钟后下」的课：开录即关联，下课时刻可精确预判
const startD = new Date(now.getTime() - 10 * 60000)
const endD = new Date(now.getTime() + 40 * 60000)
const seedDoc = JSON.stringify({
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
  schedules: [
    { id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教1-101', weekday: ((now.getDay() + 6) % 7) + 1, start_time: hm(startD), duration: 50, week_rule: 'every' },
  ],
  todos: [],
})

/* 假原生插件：覆盖 VoiceRecorder + RecorderService 两个桥（平台判定只看它们存在） */
const FAKE = `
window.__fake = { scheduled: null, consume: null, startCount: 0, stopCount: 0, svcStop: 0, recording: false };
window.Capacitor = {
  isNativePlatform: function () { return true },
  Plugins: {
    VoiceRecorder: {
      canDeviceVoiceRecord: async () => ({ value: true }),
      hasAudioRecordingPermission: async () => ({ value: true }),
      requestAudioRecordingPermission: async () => ({ value: true }),
      startRecording: async () => { window.__fake.recording = true; window.__fake.startCount++; return { value: true } },
      stopRecording: async () => {
        if (!window.__fake.recording) throw { code: 'RECORDING_HAS_NOT_STARTED' }
        window.__fake.recording = false; window.__fake.stopCount++
        return { value: { path: 'lectures/fake.aac', mimeType: 'audio/aac', msDuration: 123000 } }
      }
    },
    RecorderService: {
      start: async () => ({ running: true }),
      stop: async () => { window.__fake.svcStop++; return {} },
      isRunning: async () => ({ running: false }),
      scheduleAutoStop: async (o) => { window.__fake.scheduled = o.delayMs; return {} },
      consumeAutoStop: async () => {
        const c = window.__fake.consume; window.__fake.consume = null
        return c ? { consumed: true, path: c.path, msDuration: c.msDuration } : { consumed: false }
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

/* ===== A. 开录排程 ===== */
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.locator('[data-today-rec-start]').click()
await page.waitForTimeout(600)
const fakeA = await page.evaluate(() => window.__fake)
// 期望排程 = 下课整分 + 2 分钟 − 当前（与 App.vue 同口径：下课秒位归零）
const endMs = endD.getSeconds() || 0
const endAligned = new Date(endD); endAligned.setSeconds(0, 0)
const expected = endAligned.getTime() + 2 * 60000 - Date.now()
t('A1 排程发生了', fakeA.scheduled !== null && fakeA.scheduled !== undefined, JSON.stringify(fakeA.scheduled))
t('A2 排程毫秒 = 下课+2分钟宽限−现在（±3s）', Math.abs(fakeA.scheduled - expected) < 3000, `实际 ${fakeA.scheduled}，期望 ${expected}`)
t('A3 录音真的开了（假插件 startRecording 被调）', fakeA.startCount === 1 && fakeA.recording === true)
t('A4 保活服务拉起', fakeA.svcStop === 0)
const cardA = await page.locator('[data-today-rec]').textContent()
t('A5 提示含「下课后 2 分钟自动停」', cardA.includes('下课后 2 分钟自动停'))
t('A6 停止按钮出现', await page.locator('[data-today-rec-stop]').isVisible())

/* ===== B. 手动停正常收尾 ===== */
await page.locator('[data-today-rec-stop]').click()
await page.waitForTimeout(600)
await page.locator('nav button').nth(2).click()
await page.waitForTimeout(500)
const mineText = await page.locator('main').nth(2).textContent()
t('B1 场次落盘（我的页列表有这场）', mineText.includes('2:03'), '')
t('B2 停止按钮消失（回未录音态）', !(await page.locator('[data-today-rec-stop]').isVisible().catch(() => false)))

/* ===== C. 锁屏回来捞回强停结果 ===== */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.locator('[data-today-rec-start]').click()
await page.waitForTimeout(500)
await page.evaluate(() => {
  window.__fake.consume = { path: 'lectures/auto.aac', msDuration: 456000 }
  window.__fake.recording = false // 模拟原生已把 MediaRecorder 强停
  document.dispatchEvent(new Event('visibilitychange'))
})
await page.waitForTimeout(700)
const fakeC = await page.evaluate(() => window.__fake)
await page.locator('nav button').nth(2).click()
await page.waitForTimeout(500)
const mineC = await page.locator('main').nth(2).textContent()
t('C1 强停结果被消费', fakeC.consume === null)
t('C2 没有再调手动 stopRecording（原生已停过）', fakeC.stopCount === 0)
t('C3 场次补齐（7:36）', mineC.includes('7:36'))
t('C4 保活服务兜底撤下', fakeC.svcStop >= 1)

/* ===== D. App 内强停后用户点停止 → 捞回，不误报中断 ===== */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)
await page.locator('[data-today-rec-start]').click()
await page.waitForTimeout(500)
await page.evaluate(() => {
  window.__fake.consume = { path: 'lectures/auto2.aac', msDuration: 789000 }
  window.__fake.recording = false
})
await page.locator('[data-today-rec-stop]').click()
await page.waitForTimeout(700)
const fakeD = await page.evaluate(() => window.__fake)
const cardD = await page.locator('[data-today-rec]').textContent()
await page.locator('nav button').nth(2).click()
await page.waitForTimeout(500)
const mineD = await page.locator('main').nth(2).textContent()
t('D1 捞回了强停结果', fakeD.consume === null)
t('D2 提示「自动停」而不是「录音中断」', cardD.includes('自动停') && !cardD.includes('中断'))
t('D3 场次补齐（13:09）', mineD.includes('13:09'))

t('E1 全程无 pageerror', pageErrors.length === 0, pageErrors.join(' | '))

await browser.close()
const fails = results.filter((r) => !r[1])
console.log(`\n=== 到点自动停录：${results.length - fails.length}/${results.length} 项通过 ===`)
process.exit(fails.length ? 1 : 0)
