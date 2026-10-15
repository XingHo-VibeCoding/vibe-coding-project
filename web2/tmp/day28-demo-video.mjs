// Day 28 结营：生成 3 分钟演示录屏（公网真实操作，非 PPT）
// 用法：node tmp/day28-demo-video.mjs
// 产物：tmp/day28-video/*.webm → 由调用方拷成 release-archive/v1.2/演示录屏-Day28.webm
// 副作用（自己清场）：往 sync_docs 写一份同步串 day28-demo-2026 的文档，末尾点「清空云端」删掉
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const APP = 'https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/'
const SYNC_PASS = 'day28-demo-2026'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const VID = path.resolve('tmp/day28-video')
// 统一放慢 1.45 倍：把整套动作拉到 3 分钟出头（营地要求 3–5 分钟录屏）
const PACE = 1.45
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * PACE)))
const step = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`)

async function enter(page) {
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await sleep(2500)
  if (!(await page.title()).includes('大学生日程助手')) {
    for (const sel of ['text=确定访问', 'text=继续访问', 'button:has-text("确定")']) {
      if (await page.locator(sel).count()) { await page.locator(sel).first().click(); await sleep(3000); break }
    }
  }
  await page.waitForSelector('[data-today-scroll], [data-me-entry]', { timeout: 20000 })
}
async function backToRoot(page) {
  for (let i = 0; i < 5; i++) {
    if (!(await page.locator('[data-sub-page]').count())) break
    await page.locator('[data-sub-back]').first().click().catch(() => {})
    await sleep(700)
  }
}
const slide = (title, lines) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:390px;height:844px;background:#0F1620;color:#E8EDF3;font-family:"Microsoft YaHei",system-ui,sans-serif;display:flex;flex-direction:column;justify-content:center;padding:54px 34px;box-sizing:border-box}
  .k{font-size:12px;letter-spacing:3px;color:#5B7C92}
  h1{margin:14px 0 0;font-size:31px;line-height:1.35}
  .u{margin-top:18px;font-size:12.5px;line-height:1.7;color:#7FD1B0;word-break:break-all}
  ul{margin:26px 0 0;padding-left:18px;font-size:14px;line-height:2;color:#A9B6C7}
  b{color:#E8EDF3}
</style></head><body><div class="k">DAY 28 · 结 营 演 示</div><h1>${title}</h1>
  <div class="u">${APP}</div><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul></body></html>`

const run = async () => {
  fs.rmSync(VID, { recursive: true, force: true })
  fs.mkdirSync(VID, { recursive: true })
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--lang=zh-CN', '--autoplay-policy=no-user-gesture-required'] })
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    recordVideo: { dir: VID, size: { width: 390, height: 844 } },
  })
  const page = await context.newPage()
  await page.addInitScript((m) => {
    const FIXED = new Date('2026-10-14T10:30:00').getTime()
    const Real = Date
    class Fake extends Real { constructor(...a) { a.length ? super(...a) : super(FIXED) } static now() { return FIXED } }
    window.Date = Fake
    if (localStorage.getItem('web2.data')) return
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.theme', 'light')
    localStorage.setItem('web2.data', JSON.stringify({
      version: 1,
      schedules: [{ id: 'sch_1', semester: '2026-2027 秋冬', type: 'course', entries: [
        { id: 'c1', type: 'course', name: '数据结构', weekday: 3, start: '14:00', end: '15:40', place: '机房 401', weeks: null, term: '秋冬' },
        { id: 'c2', type: 'course', name: '心理健康', weekday: 3, start: '16:00', end: '17:35', place: '教一 105', weeks: null, term: '秋冬' },
        { id: 'c3', type: 'course', name: '高等数学', weekday: 1, start: '08:00', end: '09:40', place: '东 1-205', weeks: null, term: '秋冬' },
      ] }],
      semester: { name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 18 },
    }))
    localStorage.setItem('web2.todos', JSON.stringify([{ id: 'todo_demo', title: '数据结构实验报告提交', note: '', due_date: '2026-10-14', done: false, done_at: null, source: 'manual', created_at: '2026-10-14T08:00:00', updated_at: '2026-10-14T08:00:00' }]))
    localStorage.setItem('web2.habits', JSON.stringify([{ id: 'habit_demo', name: '每天背 20 个单词', records: {}, backfilled: {}, created_at: '2026-10-14T08:00:00' }]))
  })

  step('片头')
  await page.setContent(slide('大学生日程助手',
    ['一句话：课表、待办、打卡、录音、练耳，<b>都在这一个 App 里</b>',
      '离线可用 · 不用注册 · <b>数据是你自己的</b>',
      '下面这段是<b>公网真机操作</b>，不是 PPT']))
  await sleep(6000)

  step('打开公网作品')
  await enter(page); await sleep(4500)

  step('今日页：先看默认首屏')
  await sleep(3500)
  step('上滑让头部收缩并钉住')
  await page.evaluate(() => { const el = document.querySelector('[data-today-scroll]'); if (el) el.scrollTop = 300 })
  await sleep(3000)
  await page.evaluate(() => { const el = document.querySelector('[data-today-scroll]'); if (el) el.scrollTop = 0 })
  await sleep(2200)

  step('待办打勾 → 撤销')
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === '标记为完成')
    if (b) b.click()
  }); await sleep(2600)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === '标记为未完成')
    if (b) b.click()
  }); await sleep(2600)

  step('打卡')
  await page.evaluate(() => { const b = document.querySelector('[data-today-habit] button'); if (b) b.click() })
  await sleep(3200)

  step('周课表 + ＋ 选单')
  await page.locator('[data-nav="week"]').first().click(); await sleep(2800)
  await page.locator('[data-week-add]').first().click(); await sleep(2800)
  await page.keyboard.press('Escape').catch(() => {})
  await page.locator('[data-week-mask], [data-sheet-mask]').first().click().catch(() => {})
  await sleep(1600)

  step('我的 → 设置索引')
  await backToRoot(page)
  await page.locator('[data-nav="me"]').first().click(); await sleep(2600)
  await page.locator('[data-me-entry="settings"]').first().click(); await sleep(3000)
  await page.locator('[data-settings-index="data"]').first().click(); await sleep(2600)

  step('云同步：上传')
  await page.locator('[data-sync-pass]').fill(SYNC_PASS); await sleep(900)
  await page.locator('[data-sync-save]').click(); await sleep(1600)
  await page.locator('[data-sync-upload]').click(); await sleep(5000)

  step('云同步：把本机那份删掉再刷新（证明不是假证据）')
  await page.evaluate(() => localStorage.removeItem('web2.todos'))
  await enter(page); await sleep(3000)
  await backToRoot(page)
  await page.locator('[data-nav="me"]').first().click(); await sleep(1600)
  await page.locator('[data-me-entry="settings"]').first().click(); await sleep(1600)
  await page.locator('[data-settings-index="data"]').first().click(); await sleep(1800)

  step('云同步：取回')
  await page.locator('[data-sync-pass]').fill(SYNC_PASS); await sleep(800)
  await page.locator('[data-sync-save]').click(); await sleep(1500)
  await page.locator('[data-sync-download]').click(); await sleep(5000)

  step('云同步：清空云端（不留垃圾）')
  await page.locator('[data-sync-clear]').click(); await sleep(700)
  await page.locator('[data-sync-clear]').click(); await sleep(4000)

  step('回到今日页看结果')
  await backToRoot(page)
  await page.locator('[data-nav="today"]').first().click(); await sleep(3800)

  step('片尾')
  await page.setContent(slide('它凭什么说自己是做完了',
    ['一条命令：<b>18 项通过 / 0 项失败</b>（公网 · 界面 · 交互 · 云同步全链路）',
      '全档检查：<b>16 PASS / 1 FAIL / 1 SKIP</b>，FAIL 不服软、SKIP 不假装',
      '后端真读写：<b>201 → 200 → 200</b>，清场后行数回到 <b>6 / 22 / 10</b>',
      '回滚演练过：静态托管 <b>18.3 秒</b>止血；归档 <b>release-archive/v1.2</b> 与线上逐名一致']))
  await sleep(9000)

  step('收尾写盘')
  const video = page.video()
  await page.close()
  await context.close()
  const p = video ? await video.path() : ''
  await browser.close()
  if (p && fs.existsSync(p)) {
    const dest = path.join(VID, '演示录屏-Day28.webm')
    if (p !== dest) fs.copyFileSync(p, dest)
    const st = fs.statSync(dest)
    console.log(`PASS | 录屏已生成 ${dest} — ${(st.size / 1024 / 1024).toFixed(1)} MB`)
  } else {
    console.log('FAIL | 没拿到录屏文件')
    process.exitCode = 1
  }
}
run().catch((e) => { console.error('脚本异常：', e); process.exitCode = 2 })
