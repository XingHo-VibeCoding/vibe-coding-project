/* M2 第 3/4 步：录音界面 playwright 验证（假 Capacitor 插件注入，浏览器里跑全链路）
   跑法：先起 dist 静态服务（默认 4177，可用 TW_URL 覆盖）再 node tmp/m2-record-ui-check.js
   说明：真实录音能力由真机验证（浏览器不承担），这里验的是 UI 状态机 + 数据落盘 + 试听 URL 解析 + 错误路径。
   第 4 步新增：试听 URL 必须是 Filesystem.getUri → convertFileSrc 后的 _capacitor_file_ 形式。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = 'http://127.0.0.1:4177/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
let pass = 0, fail = 0
const t = (name, cond) => { if (cond) { pass++; console.log('PASS  ' + name) } else { fail++; console.log('FAIL  ' + name) } }

/* Stage 6：录音区搬进「我的」二级页。所有定位限定在二级页内容容器 [data-sub-body] 内，
   避免命中今日页那张同名「课堂录音」卡（原 2026-10-04 的视口外超时问题同源）。 */
const me = (pg) => pg.locator('[data-sub-body]')

/* 切「我的」tab 并推进 lectures 二级页（已在二级页时跳过） */
async function openMeLectures(pg) {
  if ((await pg.locator('[data-sub="lectures"]').count()) === 0) {
    await pg.$eval('[data-nav="me"]', (el) => el.click())
    await pg.waitForTimeout(400)
    await pg.$eval('[data-me-entry="lectures"]', (el) => el.click())
    await pg.waitForTimeout(400)
  }
}

const EXPECT_URL = 'https://localhost/_capacitor_file_/data/user/0/com.llltl6.schedule/files/lectures/rec_fake.aac'

/* 假 Capacitor：模拟 App 平台。
   - stop 返回「相对路径」（口径同插件源码：subDirectory/文件名）
   - convertFileSrc 复刻 native-bridge 的真实分支（只认 / 与 file://）
   - Filesystem 提供 getUri / stat 并记录调用
   - 包一层 Audio 以便断言最终喂给播放器的 URL */
const FAKE_CAP = `
  const _Audio = window.Audio
  window.__audios = []
  window.Audio = function () {
    const el = new _Audio()
    window.__audios.push(el)
    return el
  }
  window.__fsCalls = []
  window.Capacitor = {
    isNativePlatform: () => true,
    convertFileSrc: (p) => {
      if (typeof p === 'string') {
        if (p.startsWith('/')) return 'https://localhost/_capacitor_file_' + p
        if (p.startsWith('file://')) return 'https://localhost' + p.replace('file://', '/_capacitor_file_')
      }
      return p
    },
    Plugins: {
      VoiceRecorder: {
        canDeviceVoiceRecord: async () => ({ value: true }),
        hasAudioRecordingPermission: async () => ({ value: true }),
        requestAudioRecordingPermission: async () => ({ value: true }),
        startRecording: async () => ({ value: true }),
        stopRecording: async () => ({ value: { path: 'lectures/rec_fake.aac', mimeType: 'audio/aac', msDuration: 123456 } }),
      },
      Filesystem: {
        getUri: async (o) => {
          window.__fsCalls.push(['getUri', o.directory, o.path])
          return { uri: 'file:///data/user/0/com.llltl6.schedule/files/' + o.path }
        },
        stat: async (o) => {
          window.__fsCalls.push(['stat', o.directory, o.path])
          return { size: 20480 }
        },
      },
    },
  }
`
const SEED_BASE = `localStorage.setItem('web2.onboarded','1')`

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

/* ---------- 场景 A：浏览器环境（无插件）→ 就地提示，不产生场次 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } })
  await ctx.addInitScript(SEED_BASE)
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'load' })
  await openMeLectures(page)
  const entry = me(page).locator('section', { hasText: '课堂录音' }).first()
  t('A1 我的页出现「课堂录音」入口', await entry.isVisible())
  t('A2 浏览器环境列表为空（无场次）', (await me(page).locator('text=试听').count()) === 0)
  await me(page).locator('button:has-text("开始录音")').first().click()
  await page.waitForTimeout(300)
  t('A3 浏览器环境点开始给「需在 App 内使用」提示', await me(page).locator('text=需在 App 内使用').first().isVisible())
  t('A4 未产生任何场次', (await me(page).locator('text=试听').count()) === 0 && (await page.evaluate(() => localStorage.getItem('web2.lectures'))) === null)
  /* 录音中断标签：种一条未结束的场次 */
  await page.evaluate(() => localStorage.setItem('web2.lectures', JSON.stringify([{ id: 'lec_broken', status: 'recording', started_at: '2026-09-26T03:00:00.000Z', title: '中断的录音', ended_at: null, duration_ms: 0 }])))
  await page.reload({ waitUntil: 'load' })
  await openMeLectures(page)
  t('A5 未正常结束的场次显示「录音中断」', await me(page).locator('text=录音中断').first().isVisible())
  await ctx.close()
}

/* ---------- 场景 B：App 环境（假插件）→ 开始/计时/停止/落盘/试听 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } })
  await ctx.addInitScript(SEED_BASE)
  await ctx.addInitScript(FAKE_CAP)
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'load' })
  await openMeLectures(page)

  await me(page).locator('button:has-text("开始录音")').first().click()
  await page.waitForTimeout(500)
  t('B1 点开始后按钮变「停止并保存」', await me(page).locator('button:has-text("停止并保存")').isVisible())
  t('B2 出现录音中提示', (await me(page).locator('text=锁屏也会继续录').count()) > 0)
  t('B3 列表立即出现「录音中」场次', (await me(page).locator('text=录音中').count()) > 0)
  const dur1 = await me(page).locator('.tabular-nums').first().innerText()
  await page.waitForTimeout(2200)
  const dur2 = await me(page).locator('.tabular-nums').first().innerText()
  t('B4 计时器在走字（' + dur1 + ' → ' + dur2 + '）', dur1 !== dur2)
  t('B5 计时初始为 00:0x 形状', /^00:0\d$/.test(dur1.trim()))

  await me(page).locator('button:has-text("停止并保存")').click()
  await page.waitForTimeout(600)
  t('B6 停止后按钮回到「开始录音」', await me(page).locator('button:has-text("开始录音")').isVisible())
  /* 2026-10-04：提示语后来精简成「录音已保存。」（时长搬到列表行里显示），
     旧断言还在提示语里找 '2:03'，属陈旧断言 —— 改成查「提示还在 + 行里有时长」。 */
  const savedRow = await me(page).locator('li', { hasText: '待转写' }).first().innerText()
  t('B7 提示「录音已保存」，且列表行带时长 02:03', (await me(page).locator('text=录音已保存').first().isVisible()) && savedRow.indexOf('2:03') !== -1)
  t('B8 场次状态变「已录完 · 待转写」', (await me(page).locator('text=待转写').count()) > 0)
  t('B9 计时区消失', (await me(page).locator('.tabular-nums').count()) === 0)

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('web2.lectures') || '[]'))
  t('B10 落盘 1 条场次', saved.length === 1)
  const lec = saved[0] || {}
  t('B11 场次存入插件返回的相对路径', lec.clips && lec.clips[0] && lec.clips[0].path === 'lectures/rec_fake.aac')
  t('B12 clip_count = 1', lec.clip_count === 1)
  t('B13 duration_ms = 插件返回的 123456', lec.duration_ms === 123456)
  t('B14 ended_at 已写入', !!lec.ended_at)
  t('B15 状态仍为 recording（M3 才推进 transcribing）', lec.status === 'recording')

  /* 试听 —— 第 4 步修复核心：相对路径必须转成 _capacitor_file_ URL 才能被 <audio> 播 */
  await me(page).locator('button:has-text("试听")').first().click()
  await page.waitForTimeout(900)
  const audioSrc = await page.evaluate(() => (window.__audios[0] ? window.__audios[0].src : ''))
  t('B16 试听 URL 是 WebView 可访问形式（_capacitor_file_ + 绝对路径）', audioSrc === EXPECT_URL)
  const fsCalls = await page.evaluate(() => window.__fsCalls)
  t('B17 getUri 以 DATA 目录 + 相对路径调用', fsCalls.some((c) => c[0] === 'getUri' && c[1] === 'DATA' && c[2] === 'lectures/rec_fake.aac'))
  /* 浏览器里 https://localhost 连不上 → 必然播放失败，验证「失败也要说清是哪一环」的探测链路 */
  const failMsg = await me(page).locator('text=试听失败').first().innerText().catch(() => '')
  t('B18 播放失败时就地提示走 stat 探测分支（' + failMsg.slice(0, 28) + '）', fsCalls.some((c) => c[0] === 'stat') && failMsg.indexOf('无法播放') !== -1)

  /* 刷新后仍在（模拟 App 重启） */
  await page.reload({ waitUntil: 'load' })
  await openMeLectures(page)
  t('B19 重启后场次仍在且状态为已录完', (await me(page).locator('text=待转写').count()) > 0)
  await ctx.close()
}

await browser.close()
console.log('\n结果：' + pass + ' 过，' + fail + ' 挂')
process.exit(fail ? 1 : 0)
