/* 开录关联判定的 DOM 检查（2026-10-01 用户问：提前 10 分 / 5 分 / 2 分 / 上课后 2 分有什么区别）。

   纯函数口径见 tmp/lec-auto-unit.mjs（37 项）。这里验的是「判定结果真的传到了界面上」：
   场次标题挂不挂课名、原生 scheduleAutoStop 排不排、录音提示说不说有自动停。

   关键：自动停的毫秒数是拿**真实时钟**算的（end - Date.now()），`?t=` 后门只影响判定用的
   nowTime，所以这里用「相对现在的分钟数」造课，不用时间后门——这样排程断言才有效。

   场景对照（课间长度可变，正是用户强调的点）：
     A 单节课剩 5 分钟下课 → 认 + 排自动停 + 提示有自动停
     B 单节课剩 2 分钟下课 → 不认 + 不排 + 提示没排（快下课不认）
     C 课间 10 分：前一节刚下课那一刻开录（用户原始场景）→ 不认 + 不排
     D 课间 5 分：后一节提前窗正好盖到当前 → 认后一节 + 排
     E 午休式大空窗（前一节 1 小时前下、后一节 1 小时后）→ 不认 + 不排

   跑法：先起 dev server（4177）再 node tmp/rec-assoc-check.mjs（支持 TW_URL 覆盖） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + extra : ''))
}

const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'

const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const MONDAY = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`
const TODAY_WD = ((now.getDay() + 6) % 7) + 1
const pad = (n) => String(n).padStart(2, '0')
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const at = (minDelta) => {
  const d = new Date()
  d.setMinutes(d.getMinutes() + minDelta)
  return d
}

/* 相对现在造课：start 是「现在 + 偏移」的整分，duration 分钟 → end 可精确推 */
const course = (id, title, startMinDelta, duration) => ({
  id, type: 'course', semester_id: 'sem1', title, location: '教1-101',
  weekday: TODAY_WD, start_time: hm(at(startMinDelta)), duration, week_rule: 'every',
})
const TODAY_STR = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
/* 独立日程：字段口径与课程不同（title/location + date，weekday 为 null），
   但同样会进 todayCourses 参与开录判定 —— 名字显示必须也能取到 */
const event = (id, title, startMinDelta, duration) => ({
  id, type: 'event', title, note: '', location: '紫金港北4-319', weekday: null,
  start_time: hm(at(startMinDelta)), duration, week_rule: null,
  date: TODAY_STR, color: '', semester_id: null,
})
function seedDoc(schedules) {
  return JSON.stringify({
    app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
    semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
    schedules, todos: [],
  })
}

const FAKE = `
window.__fake = { scheduled: null, recording: false };
window.Capacitor = {
  isNativePlatform: function () { return true },
  Plugins: {
    VoiceRecorder: {
      canDeviceVoiceRecord: async () => ({ value: true }),
      hasAudioRecordingPermission: async () => ({ value: true }),
      requestAudioRecordingPermission: async () => ({ value: true }),
      startRecording: async () => { window.__fake.recording = true; return { value: true } },
      stopRecording: async () => ({ value: { path: 'lectures/x.aac', mimeType: 'audio/aac', msDuration: 1000 } })
    },
    RecorderService: {
      start: async () => ({ running: true }),
      stop: async () => ({}),
      isRunning: async () => ({ running: false }),
      scheduleAutoStop: async (o) => { window.__fake.scheduled = o.delayMs; return {} },
      consumeAutoStop: async () => ({ consumed: false })
    }
  }
}
`

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })

async function probe(schedules) {
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  await page.addInitScript(FAKE)
  await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc(schedules))})`)
  await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.locator('[data-today-rec-start]').click()
  await page.waitForTimeout(600)
  const scheduled = await page.evaluate(() => window.__fake.scheduled)
  const card = await page.locator('[data-today-rec]').textContent()
  await page.locator('nav button').nth(2).click()
  await page.waitForTimeout(500)
  const li = await page
    .locator('main').nth(2)
    .locator('section', { hasText: '课堂录音' })
    .locator('ul li').first()
    .innerText()
  await page.close()
  return { scheduled, card: card.replace(/\s+/g, ' '), title: li.replace(/\s+/g, ' '), errs }
}

/* ---------- A. 剩 5 分钟下课：正常认 ---------- */
let r = await probe([course('a1', '高等数学', -40, 45)])
t('A1 剩 5 分钟下课 → 场次挂上课名', r.title.includes('高等数学'), r.title)
t('A2 排了自动停（≈下课+2 分 = 7 分钟后）', r.scheduled > 0 && r.scheduled < 10 * 60000, String(r.scheduled))
t('A3 提示说有自动停', r.card.includes('下课后 2 分钟自动停'), r.card.slice(-40))

/* ---------- B. 剩 2 分钟下课：不认（快下课不认） ---------- */
r = await probe([course('b1', '高等数学', -43, 45)])
t('B1 剩 2 分钟下课 → 不挂课名（用默认「课堂录音」标题）', !r.title.includes('高等数学') && r.title.includes('课堂录音'), r.title)
t('B2 没有排自动停', r.scheduled === null, String(r.scheduled))
t('B3 提示改为「没排自动停，记得自己停」', r.card.includes('没排自动停'), r.card.slice(-40))

/* ---------- C. 课间 10 分：前一节刚下课那一刻开录（用户原始场景） ---------- */
r = await probe([course('c1', '高等数学', -45, 45), course('c2', '大学英语', 10, 45)])
t('C1 不挂前一节（不再误认成上一节课）', !r.title.includes('高等数学'), r.title)
t('C2 也没挂后一节（提前窗还差 5 分钟）', !r.title.includes('大学英语'))
t('C3 没排自动停（原来会按前一节排成 2 分钟后）', r.scheduled === null, String(r.scheduled))

/* ---------- D. 课间 5 分：后一节提前窗正好盖到当前 ---------- */
r = await probe([course('d1', '高等数学', -45, 45), course('d2', '大学英语', 5, 45)])
t('D1 改挂后一节「大学英语」', r.title.includes('大学英语'), r.title)
t('D2 排了自动停（≈后一节下课+2 分 = 52 分钟后）', r.scheduled > 40 * 60000 && r.scheduled < 60 * 60000, String(r.scheduled))

/* ---------- E. 午休式大空窗 ---------- */
r = await probe([course('e1', '高等数学', -105, 45), course('e2', '大学英语', 60, 45)])
t('E1 大空窗也不硬塞课', !r.title.includes('高等数学') && !r.title.includes('大学英语'), r.title)
t('E2 没排自动停', r.scheduled === null, String(r.scheduled))
t('E3 全程无 pageerror', r.errs.length === 0, r.errs.join(' | '))

/* ---------- F. 独立日程也能被关联，且名字正确（日程用 title，课程用 name） ---------- */
r = await probe([event('f1', '学术讲座', -40, 45)])
t('F1 日程挂上日程名（不是 undefined）', r.title.includes('学术讲座'), r.title)
t('F2 日程也排自动停', r.scheduled > 0 && r.scheduled < 10 * 60000, String(r.scheduled))
t('F3 标题里不出现 undefined', !r.title.includes('undefined'), r.title)

/* ---------- G. 课程 + 日程同日混排：各自认自己的名字 ---------- */
r = await probe([course('g1', '高等数学', -40, 45), event('g2', '社团例会', 60, 60)])
t('G1 只按时间认，两套字段都给对名字', r.title.includes('高等数学') && !r.title.includes('undefined'), r.title)

await browser.close()
const fails = results.filter((x) => !x[1])
console.log(`\n=== 开录关联判定（DOM）：${results.length - fails.length}/${results.length} 通过 ===`)
process.exit(fails.length ? 1 : 0)
