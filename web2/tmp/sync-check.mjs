/* sync-check：云同步（P7）自检 —— 数据层白名单 + 上传/下载/冲突/清空 + 界面口径。
   口径（用户 2026-10-12 拍板）：同步串派身份、只同步课表与待办、整份上传不做逐条 CRUD、
   冲突不自动选（两份摆出来让用户定）。
   纪律：**绝不发真网**。window.fetch 被 stub 拦下，把每个请求的 method/url/body 抓出来验；
   也绝不真的写云端（stub 全部回预设报文）。同步串用假串。
   跑法：先 build + 起 dist 静态服务（默认 4177），再 node tmp/sync-check.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = process.env.BASE || 'http://127.0.0.1:4177/'

/* 一份最小可同步数据：导入态（web2.data 是主项目导出文本）+ 一条叠加待办。 */
const IMPORted = {
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '2026-2027 秋冬', first_monday: '2026-08-31', total_weeks: 18 },
  schedules: [{ id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教三 302', teacher: '张明', weekday: 1, start_time: '08:00', duration: 100, week_rule: 'every' }],
  todos: [{ id: 't1', title: '交作业', done: false, due_date: '2026-10-13' }],
}

let pass = 0
let fail = 0
const t = (name, ok, ev = '') => {
  if (ok) pass += 1
  else fail += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ev ? '  → ' + ev : ''}`)
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

/* 每个用例一个干净上下文。responses 是按顺序取用的预设报文；
   取完后重复最后一个（避免用例里多点一次就崩）。 */
async function newPage({ responses = [], seed = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  await ctx.route('**cdn.jsdelivr.net/**', (r) => r.abort())
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message || e)))
  await ctx.addInitScript(`
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.theme', '"light"')
    localStorage.setItem('web2.data', ${JSON.stringify(JSON.stringify(IMPORted))})
    ${Object.entries(seed).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`).join('\n    ')}
  `)
  await ctx.addInitScript(`window.__syncCalls = [];
    window.__syncQueue = ${JSON.stringify(responses)};
    window.__syncIdx = 0;
    window.fetch = (function (orig) {
      return function (url, init) {
        var u = String(url);
        if (u.indexOf('/api/sync') === -1) return orig.apply(this, arguments);
        var body = null;
        if (init && init.body) { try { body = JSON.parse(init.body) } catch (e) { body = String(init.body) } }
        window.__syncCalls.push({ url: u, method: (init && init.method) || 'GET', body: body });
        var q = window.__syncQueue;
        var r = q.length ? q[Math.min(window.__syncIdx, q.length - 1)] : { status: 200, json: { ok: true, action: 'upload', uid: 'abcd1234', rev: 1 } };
        window.__syncIdx++;
        var st = r.status || 200;
        return Promise.resolve({
          ok: st >= 200 && st < 300,
          status: st,
          text: function () { return Promise.resolve(JSON.stringify(r.json || {})) },
          json: function () { return Promise.resolve(r.json || {}) },
        });
      };
    })(window.fetch);`)
  await page.goto(BASE, { waitUntil: 'load' })
  await page.waitForSelector('[data-page="today"]', { timeout: 15000 })
  await page.waitForTimeout(900)
  return { ctx, page, errs }
}

const settle = (page) => page.evaluate(() => { for (const a of document.getAnimations()) { try { a.finish() } catch {} } })
const activeKey = (page) => page.evaluate(() => (document.querySelector('nav [data-nav][data-active="1"]') || {}).dataset?.nav || null)

async function clickTab(page, name) {
  for (let i = 0; i < 6; i++) {
    if ((await activeKey(page)) === name) return true
    await page.evaluate((n) => { const b = document.querySelector(`nav [data-nav="${n}"]`); if (b) b.click() }, name)
    await page.waitForTimeout(600)
  }
  return (await activeKey(page)) === name
}
const clickSel = async (page, sel, ms = 380) => {
  await page.evaluate((s) => { const b = document.querySelector(s); if (b) b.click() }, sel)
  await page.waitForTimeout(ms)
  await settle(page)
}
/* 进「我的 → 设置 → 数据与导入导出」，即云同步卡片所在的那一页 */
async function openSyncCard(page) {
  await clickTab(page, 'me')
  await clickSel(page, '[data-settings-toggle]')
  await clickSel(page, '[data-settings-index="data"]')
  await page.waitForSelector('[data-sync-card]', { timeout: 8000 })
}
const calls = (page) => page.evaluate(() => window.__syncCalls)
const ls = (page, k) => page.evaluate((kk) => localStorage.getItem(kk), k)
const snap = (page) => page.evaluate(() => ({
  msg: (document.querySelector('[data-sync-msg]') || {}).textContent?.trim() || '',
  conflict: !!document.querySelector('[data-sync-conflict]'),
  conflictText: (document.querySelector('[data-sync-conflict]') || {}).textContent?.replace(/\s+/g, ' ').trim() || '',
  uploadDisabled: !!(document.querySelector('[data-sync-upload]') || {}).disabled,
  downloadDisabled: !!(document.querySelector('[data-sync-download]') || {}).disabled,
  clearDisabled: !!(document.querySelector('[data-sync-clear]') || {}).disabled,
}))
const setPass = async (page, v) => { await page.fill('[data-sync-pass]', v); await page.waitForTimeout(200) }

/* ---------- A. 入口形态：同步卡片长什么样 ---------- */
{
  const { ctx, page, errs } = await newPage()
  await openSyncCard(page)
  const ui = await page.evaluate(() => ({
    card: !!document.querySelector('[data-sync-card]'),
    pass: !!document.querySelector('[data-sync-pass]'),
    save: !!document.querySelector('[data-sync-save]'),
    upload: !!document.querySelector('[data-sync-upload]'),
    download: !!document.querySelector('[data-sync-download]'),
    clear: !!document.querySelector('[data-sync-clear]'),
    passType: (document.querySelector('[data-sync-pass]') || {}).type,
    text: (document.querySelector('[data-sync-card]') || {}).textContent?.replace(/\s+/g, ' ').trim() || '',
  }))
  t('A1 数据页里有同步卡片', ui.card)
  t('A2 有同步串输入框，且是 password 类型（不明文显示）', ui.pass && ui.passType === 'password', 'type=' + ui.passType)
  t('A3 有「保存串」按钮', ui.save)
  t('A4 有 上传 / 从云端取回 / 清空云端 三颗按钮', ui.upload && ui.download && ui.clear)
  t('A5 卡片说明了同步范围（课表与待办）', /课表/.test(ui.text) && /待办/.test(ui.text), ui.text.slice(0, 60))
  t('A6 卡片说明了大件不上云（录音）', /录音/.test(ui.text))
  t('A7 卡片说明了串只存本机/不上传原文', /本机/.test(ui.text))
  const s0 = await snap(page)
  t('A8 没填串时上传按钮是禁用的', s0.uploadDisabled)
  t('A9 没填串时取回按钮是禁用的', s0.downloadDisabled)
  t('A10 没填串时清空按钮是禁用的', s0.clearDisabled)
  t('A11 无 pageerror', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

/* ---------- B. 串长度守卫（前端先挡，不等一个来回） ---------- */
{
  const { ctx, page } = await newPage()
  await openSyncCard(page)
  await setPass(page, 'abc') // 3 字符 < 6
  const s = await snap(page)
  t('B1 串太短时上传仍禁用', s.uploadDisabled)
  t('B2 串太短时给出口径提示（至少 N 个字符）', /至少/.test(await page.locator('[data-sync-card]').innerText()))
  await setPass(page, 'mypass123')
  t('B3 串够长后上传可用（本机有数据）', !(await snap(page)).uploadDisabled)
  await ctx.close()
}

/* ---------- C. 上传：请求体形状 + baseRev 语义 + 版本回写 ---------- */
{
  const { ctx, page, errs } = await newPage({ responses: [{ status: 200, json: { ok: true, action: 'upload', uid: 'abcd1234', rev: 1, updated_at: 'T' } }] })
  await openSyncCard(page)
  await setPass(page, 'mypass123')
  await page.locator('[data-sync-upload]').click()
  await page.waitForTimeout(700)
  const c = await calls(page)
  t('C1 发出了一个 POST', c.length === 1 && c[0].method === 'POST', JSON.stringify(c.map((x) => x.method)))
  t('C2 打到 /api/sync', c[0] && c[0].url.indexOf('/api/sync') !== -1, c[0] && c[0].url)
  const body = c[0] && c[0].body
  t('C3 请求体带同步串', body && body.pass === 'mypass123', JSON.stringify(body && body.pass))
  t('C4 首次上传 baseRev = 0（不是漏传）', body && body.baseRev === 0, 'baseRev=' + (body && body.baseRev))
  t('C5 首次上传 force = false', body && body.force === false, 'force=' + (body && body.force))
  t('C6 doc 是整份对象（app=sched + version）', body && body.doc && body.doc.app === 'sched' && body.doc.version === 1)
  const keys = (body && body.doc && body.doc.keys) || {}
  t('C7 doc.keys 只含白名单六键里的（课表/待办）', Array.isArray(Object.keys(keys)) && Object.keys(keys).length > 0 && Object.keys(keys).every((k) => ['web2.data', 'web2.added', 'web2.courseOv', 'web2.todos', 'web2.events', 'web2.dayOverrides'].indexOf(k) >= 0), JSON.stringify(Object.keys(keys)))
  t('C8 上传成功后有回执（提到 rev 1）', /rev 1/.test((await snap(page)).msg), (await snap(page)).msg)
  const cfg = JSON.parse(await ls(page, 'web2.sync') || '{}')
  t('C9 本机记住了串', cfg.pass === 'mypass123')
  t('C10 本机记下上次同步版本 rev=1', cfg.rev === 1, 'rev=' + cfg.rev)
  t('C11 本机记下服务端身份前 8 位', cfg.uid === 'abcd1234', 'uid=' + cfg.uid)
  t('C12 无 pageerror', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

/* ---------- D. 第二次上传：baseRev 跟着本机 rev 走 ---------- */
{
  const { ctx, page } = await newPage({
    seed: { 'web2.sync': JSON.stringify({ pass: 'mypass123', rev: 4, at: 'T0', uid: 'abcd1234' }) },
    responses: [{ status: 200, json: { ok: true, action: 'upload', uid: 'abcd1234', rev: 5, updated_at: 'T' } }],
  })
  await openSyncCard(page)
  await setPass(page, 'mypass123')
  await page.locator('[data-sync-upload]').click()
  await page.waitForTimeout(700)
  const body = (await calls(page))[0].body
  t('D1 第二次上传 baseRev = 本机记的 rev（4）', body.baseRev === 4, 'baseRev=' + body.baseRev)
  t('D2 上传后 rev 前进到 5', JSON.parse(await ls(page, 'web2.sync')).rev === 5)
  t('D3 界面显示云端身份', /abcd1234/.test(await page.locator('[data-sync-card]').innerText()))
  await ctx.close()
}

/* ---------- E. 冲突 409：不覆盖，两份摆出来让用户选 ---------- */
{
  const { ctx, page, errs } = await newPage({
    seed: { 'web2.sync': JSON.stringify({ pass: 'mypass123', rev: 1, at: 'T0', uid: 'abcd1234' }) },
    responses: [{ status: 409, json: { ok: false, kind: 'input', status: 409, message: '云端那份比本机新（云端 rev 7，本机基于 rev 1）：先取回云端，或用本机覆盖云端。', cloudRev: 7, cloudUpdatedAt: 'T7' } }],
  })
  await openSyncCard(page)
  await setPass(page, 'mypass123')
  const before = await ls(page, 'web2.data')
  await page.locator('[data-sync-upload]').click()
  await page.waitForTimeout(700)
  const s = await snap(page)
  t('E1 冲突时出现二选一面板', s.conflict)
  t('E2 面板写明云端 rev（7）', /7/.test(s.conflictText), s.conflictText.slice(0, 80))
  t('E3 面板说明本机没被覆盖', /没被覆盖/.test(s.conflictText), s.conflictText.slice(0, 80))
  t('E4 有「取回云端」按钮', (await page.locator('[data-sync-take-cloud]').count()) === 1)
  t('E5 有「用本机覆盖云端」按钮', (await page.locator('[data-sync-force]').count()) === 1)
  t('E6 冲突时本机数据一字未动', (await ls(page, 'web2.data')) === before)
  t('E7 冲突没有把本机 rev 改掉（仍是 1）', JSON.parse(await ls(page, 'web2.sync')).rev === 1)
  t('E8 无 pageerror', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

/* ---------- F. 覆盖云端：撞冲突后点「用本机覆盖云端」= force=true ---------- */
{
  const { ctx, page } = await newPage({
    seed: { 'web2.sync': JSON.stringify({ pass: 'mypass123', rev: 1, at: 'T0', uid: 'abcd1234' }) },
    responses: [
      { status: 409, json: { ok: false, kind: 'input', status: 409, message: '云端那份比本机新（云端 rev 7，本机基于 rev 1）…', cloudRev: 7, cloudUpdatedAt: 'T7' } },
      { status: 200, json: { ok: true, action: 'upload', uid: 'abcd1234', rev: 8, updated_at: 'T' } },
    ],
  })
  await openSyncCard(page)
  await setPass(page, 'mypass123')
  await page.locator('[data-sync-upload]').click()
  await page.waitForTimeout(700)
  t('F0 普通上传带 force=false', (await calls(page))[0].body.force === false)
  t('F1 撞冲突后出现覆盖按钮', (await page.locator('[data-sync-force]').count()) === 1)
  await page.locator('[data-sync-force]').click()
  await page.waitForTimeout(700)
  const c = await calls(page)
  t('F2 「用本机覆盖云端」发出 force=true', c.length === 2 && c[1].body.force === true, 'force=' + (c[1] && c[1].body.force))
  t('F3 覆盖上传的 baseRev 传 -1（不给旧 rev 添乱）', c.length === 2 && c[1].body.baseRev === -1, 'baseRev=' + (c[1] && c[1].body.baseRev))
  t('F4 覆盖成功后冲突面板消失', !(await snap(page)).conflict)
  t('F5 覆盖后 rev 前进到 8', JSON.parse(await ls(page, 'web2.sync')).rev === 8)
  await ctx.close()
}

/* ---------- G. 下载：云端覆盖本机（替换语义，不是合并） ---------- */
{
  const cloudDoc = { version: 1, app: 'sched', exported_at: 'T', keys: { 'web2.data': JSON.stringify({ ...IMPORted, todos: [{ id: 't9', title: '云端的待办', done: false }] }) } }
  const { ctx, page, errs } = await newPage({
    seed: { 'web2.sync': JSON.stringify({ pass: 'mypass123', rev: 0, at: '', uid: '' }), 'web2.added': JSON.stringify([{ id: 'x1', title: '本机独有' }]) },
    responses: [{ status: 200, json: { ok: true, action: 'download', uid: 'abcd1234', found: true, doc: cloudDoc, rev: 3, updated_at: 'T3' } }],
  })
  await openSyncCard(page)
  await setPass(page, 'mypass123')
  await page.locator('[data-sync-download]').click()
  await page.waitForTimeout(900)
  const s = await snap(page)
  t('G1 下载发出的是 GET', (await calls(page))[0].method === 'GET', (await calls(page))[0].method)
  t('G2 下载回到的人话回执（提到 3）', /3/.test(s.msg), s.msg)
  const data = JSON.parse(await ls(page, 'web2.data'))
  t('G3 云端那份写进了本机（看到云端的待办）', JSON.stringify(data).indexOf('云端的待办') !== -1)
  t('G4 替换语义：本机独有、云端没有的键被删掉', (await ls(page, 'web2.added')) === null, 'web2.added=' + (await ls(page, 'web2.added')))
  t('G5 下载后本机 rev 更新为 3', JSON.parse(await ls(page, 'web2.sync')).rev === 3)
  t('G6 无 pageerror', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

/* ---------- H. 云端空：不是错误，是一条该怎么做的提示 ---------- */
{
  const { ctx, page } = await newPage({
    responses: [{ status: 200, json: { ok: true, action: 'download', uid: 'abcd1234', found: false, doc: null, rev: 0 } }],
  })
  await openSyncCard(page)
  await setPass(page, 'mypass123')
  await page.locator('[data-sync-download]').click()
  await page.waitForTimeout(800)
  const s = await snap(page)
  t('H1 云端没有数据时给的是提示不是报错（不标红）', /上传/.test(s.msg), s.msg)
  t('H2 提示里引导用户去上传', /上传/.test(s.msg))
  t('H3 没有把它显示成冲突', !s.conflict)
  await ctx.close()
}

/* ---------- I. 清空云端：必须点两次（防误删） ---------- */
{
  const { ctx, page } = await newPage({
    responses: [{ status: 200, json: { ok: true, action: 'delete', uid: 'abcd1234', deleted: true } }],
  })
  await openSyncCard(page)
  await setPass(page, 'mypass123')
  await page.locator('[data-sync-clear]').click()
  await page.waitForTimeout(500)
  const afterOne = await snap(page)
  t('I1 第一次点「清空云端」不放行，改成确认', /确认/.test(afterOne.msg) || (await page.locator('[data-sync-clear]').innerText()).indexOf('确认') !== -1, afterOne.msg + ' / ' + (await page.locator('[data-sync-clear]').innerText()))
  t('I2 点一次还没发删除请求', (await calls(page)).length === 0, 'calls=' + (await calls(page)).length)
  await page.locator('[data-sync-clear]').click()
  await page.waitForTimeout(700)
  const c = await calls(page)
  t('I3 第二次点才发 DELETE', c.length === 1 && c[0].method === 'DELETE', JSON.stringify(c.map((x) => x.method)))
  t('I4 清空后给出回执（本机数据不受影响）', /本机/.test((await snap(page)).msg) || /删除/.test((await snap(page)).msg), (await snap(page)).msg)
  t('I5 清空后本机课表还在（只删云端）', (await ls(page, 'web2.data')) !== null)
  await ctx.close()
}

/* ---------- J. 白名单：机密键绝不上传 ---------- */
{
  const { ctx, page } = await newPage({
    seed: {
      'web2.llm': JSON.stringify({ provider: 'deepseek', key: 'sk-SECRET-DO-NOT-SYNC', model: 'deepseek-flash' }),
      'web2.eduAccount': JSON.stringify({ user: 'SECRET-USER', pass: 'SECRET-PASS' }),
      'web2.lectures': JSON.stringify([{ id: 'l1', title: '录音', audio: '/local/path.m4a' }]),
    },
    responses: [{ status: 200, json: { ok: true, action: 'upload', uid: 'abcd1234', rev: 1 } }],
  })
  await openSyncCard(page)
  await setPass(page, 'mypass123')
  await page.locator('[data-sync-upload]').click()
  await page.waitForTimeout(800)
  const raw = JSON.stringify((await calls(page))[0].body)
  t('J1 上传的报文里没有 DeepSeek API Key', raw.indexOf('sk-SECRET-DO-NOT-SYNC') === -1)
  t('J2 上传的报文里没有教务账号密码', raw.indexOf('SECRET-USER') === -1 && raw.indexOf('SECRET-PASS') === -1)
  t('J3 上传的报文里没有录音元数据键', raw.indexOf('web2.lectures') === -1)
  t('J4 上传的报文里没有本机同步串以外的配置（web2.llm 键名都不出现）', raw.indexOf('web2.llm') === -1)
  t('J5 上传的报文里没有同步串原文以外的身份信息', raw.indexOf('SECRET') === -1)
  await ctx.close()
}

/* ---------- K. 网络不通：人话 + 本机不动 ---------- */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.route('**cdn.jsdelivr.net/**', (r) => r.abort())
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message || e)))
  await ctx.addInitScript(`
    localStorage.setItem('web2.onboarded', '1')
    localStorage.setItem('web2.theme', '"light"')
    localStorage.setItem('web2.data', ${JSON.stringify(JSON.stringify(IMPORted))})
    window.fetch = (function (orig) {
      return function (url, init) {
        if (String(url).indexOf('/api/sync') === -1) return orig.apply(this, arguments);
        return Promise.reject(new TypeError('Failed to fetch'));
      };
    })(window.fetch);`)
  await page.goto(BASE, { waitUntil: 'load' })
  await page.waitForSelector('[data-page="today"]', { timeout: 15000 })
  await page.waitForTimeout(900)
  await openSyncCard(page)
  await setPass(page, 'mypass123')
  const before = await ls(page, 'web2.data')
  await page.locator('[data-sync-upload]').click()
  await page.waitForTimeout(800)
  const s = await snap(page)
  t('K1 连不上时给人话（提到网络/连不上）', /网络|连不上/.test(s.msg), s.msg)
  t('K2 连不上时本机数据一字未动', (await ls(page, 'web2.data')) === before)
  t('K3 连不上不是崩溃（无 pageerror）', errs.length === 0, errs.join(' | '))
  await ctx.close()
}

/* ---------- L. 换串必须把 rev 归零（否则冲突判断张冠李戴） ---------- */
{
  const { ctx, page } = await newPage({
    seed: { 'web2.sync': JSON.stringify({ pass: 'oldpass1', rev: 9, at: 'T0', uid: 'OLDUID00' }) },
    responses: [{ status: 200, json: { ok: true, action: 'upload', uid: 'abcd1234', rev: 1 } }],
  })
  await openSyncCard(page)
  await setPass(page, 'newpass9')
  await page.locator('[data-sync-save]').click()
  await page.waitForTimeout(500)
  const cfg = JSON.parse(await ls(page, 'web2.sync'))
  t('L1 保存了新串', cfg.pass === 'newpass9', 'pass=' + cfg.pass)
  t('L2 换串后 rev 归零', cfg.rev === 0, 'rev=' + cfg.rev)
  await page.locator('[data-sync-upload]').click()
  await page.waitForTimeout(700)
  const body = (await calls(page))[0].body
  t('L3 换串后的第一次上传 baseRev=0（不拿旧串的版本号去比）', body.baseRev === 0, 'baseRev=' + body.baseRev)
  await ctx.close()
}

/* ---------- M. 上传发送的是「原文」不是重排后的 JSON（保住回写链路） ---------- */
{
  const rawText = JSON.stringify(IMPORted)
  const { ctx, page } = await newPage({ responses: [{ status: 200, json: { ok: true, action: 'upload', uid: 'abcd1234', rev: 1 } }] })
  await openSyncCard(page)
  await setPass(page, 'mypass123')
  await page.locator('[data-sync-upload]').click()
  await page.waitForTimeout(700)
  const sent = (await calls(page))[0].body.doc.keys['web2.data']
  t('M1 上传的 web2.data 与本机存的原文逐字符一致（不被解析再重排）', sent === rawText, '同=' + (sent === rawText) + ' len ' + (sent || '').length + '/' + rawText.length)
  await ctx.close()
}

await browser.close()
console.log(`\n${pass} 过 / ${fail} 挂`)
process.exit(fail ? 1 : 0)
