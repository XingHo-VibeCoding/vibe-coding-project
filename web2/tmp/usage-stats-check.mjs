/* 六期 P6：手机使用时间（纯逻辑，不需要真机 / 不需要网络）

   设计稿 `docs/今天的账与可回嘴-设计稿.md` §1.2 / §1.7 / §1.8 是判据来源，验六件事：
     1. **环境三态分得开**：无桥（浏览器）/ 有桥无权限 / 有桥有权限 —— 无桥与无权限都**不报错**
     2. **隐私口径**：只回分类汇总，**包里绝不含 App 名**（用毒字符串塞进原始数据，确认不落盘/不上抛）
     3. **分类固定四类**：沟通不并进娱乐（微信 → comm，不是 fun）；陌生包名归 other 不丢数
     4. **本机存档**：`web2.usage` 的 sanitize / prune / upsert「没变就不写」三件事
     5. **展示逻辑**：formatMs / catBreakdown（占比）/ hourSlots（8 个 3 小时段）/ usageBaseline（攒够 8 天才说话）
     6. **不进云同步**：`web2.usage` **不在** sync.js 的白名单里（§1.8-3 隐私）

   跑法：node tmp/usage-stats-check.mjs
   注：用**假插件**注入 window.Capacitor，不碰真机、不读网络、不读真实 localStorage。 */

let pass = 0
let fail = 0
function t(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' ← ' + extra))
  ok ? pass++ : fail++
}

class FakeStore {
  constructor() {
    this.m = new Map()
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null
  }
  setItem(k, v) {
    this.m.set(k, String(v))
  }
  removeItem(k) {
    this.m.delete(k)
  }
}
globalThis.localStorage = new FakeStore()

const USAGE_KEY = 'web2.usage'

/* 起止时间窗：脚本跑在哪个时区都该是「本地日」，用北京时区（项目面向国内用户）造一个固定日。 */
const DAY = '2026-10-12'

/* ---------------- 假插件：行为可控的「系统使用情况」 ----------------
   能按需制造真机上难复现的状态：没权限、查询抛错、包名毒字符串。 */
function makeFakeUsage() {
  const box = {
    granted: true,
    /* 默认一份「像真的」的聚合。**故意带上包名**（原生真插件会吃掉，这里用来验 web 侧不依赖它）。 */
    grantedCats: [
      { key: 'comm', ms: 2 * 3600 * 1000, pkg: 'com.tencent.mm' },
      { key: 'fun', ms: 90 * 60 * 1000, pkg: 'com.ss.android.ugc.aweme' },
      { key: 'study', ms: 40 * 60 * 1000, pkg: 'com.chaoxing.mobile' },
    ],
    throwOnToday: false,
    throwOnAvailable: false,
  }
  const U = {
    box,
    calls: { available: 0, today: 0, openSettings: 0 },
    settingsOpened: false,
    async available() {
      U.calls.available++
      if (box.throwOnAvailable) throw new Error('AppOps 查询炸了')
      return { granted: box.granted }
    },
    async openSettings() {
      U.calls.openSettings++
      U.settingsOpened = true
      return { ok: true }
    },
    async today({ start, end }) {
      U.calls.today++
      U.lastWindow = { start, end }
      if (box.throwOnToday) throw new Error('queryUsageStats 炸了')
      if (!box.granted) return { granted: false, totalMs: 0, byCategory: [], byHour: [] }
      const total = box.grantedCats.reduce((s, c) => s + c.ms, 0)
      const hours = new Array(24).fill(0)
      hours[9] = 30 * 60 * 1000
      hours[20] = 2 * 3600 * 1000
      return { granted: true, totalMs: total, byCategory: box.grantedCats.map((c) => ({ key: c.key, ms: c.ms })), byHour: hours }
    },
  }
  return U
}

function installFake(u) {
  globalThis.window = globalThis.window || globalThis
  globalThis.window.Capacitor = { Plugins: u ? { UsageStats: u } : {} }
}
function clearLS() {
  for (const k of [...localStorage.m.keys()]) localStorage.removeItem(k)
}

const U = await import('../src/data/usageStats.js')

/* ---------- A 段：环境三态 ---------- */
installFake(null)
t('A1. 无桥（浏览器）：usageAvailable() false，三个方法都如实报 unsupported（不抛）',
  U.usageAvailable() === false
  && (await U.usageGranted()).unsupported === true
  && (await U.fetchUsageDay(DAY)).unsupported === true
  && (await U.openUsageSettings()).unsupported === true)
t('A2. 无桥时 usageGranted() 的 granted 是 false（不是 undefined）= 界面能直接判「未开启」',
  (await U.usageGranted()).granted === false)

{
  const fake = makeFakeUsage()
  installFake(fake)
  fake.box.granted = false
  t('A3. 有桥无权限：usageAvailable() true、usageGranted() {ok:true,granted:false}（**不是错误**）', (() => {
    return U.usageAvailable() === true
  })())
  const g = await U.usageGranted()
  t('A3b. 有桥无权限 usageGranted() → ok:true granted:false（用户没开权限是正常状态，不是 error）',
    g.ok === true && g.granted === false && !g.error, JSON.stringify(g))
  const d = await U.fetchUsageDay(DAY)
  t('A3c. 有桥无权限 fetchUsageDay() → ok:true granted:false 空数据（不报错，界面照常画「未开启」）',
    d.ok === true && d.granted === false && d.totalMs === 0 && d.byCategory.length === 0, JSON.stringify(d))

  /* ---------- B 段：有权限读一天 ---------- */
  fake.box.granted = true
  const day = await U.fetchUsageDay(DAY)
  const sum = 2 * 3600 * 1000 + 90 * 60 * 1000 + 40 * 60 * 1000
  t('B1. 有权限：totalMs 等于三类之和（数据没在 web 侧被丢）', day.ok && day.granted && day.totalMs === sum, `totalMs=${day.totalMs} 期望=${sum}`)
  t('B2. byCategory 收敛成**固定四类、固定顺序** comm/study/fun/other（顺序稳定，图表不会跳）',
    JSON.stringify(day.byCategory.map((c) => c.key)) === JSON.stringify(['comm', 'study', 'fun', 'other']),
    JSON.stringify(day.byCategory.map((c) => c.key)))
  t('B3. byHour 恰好 24 桶且都是数字', day.byHour.length === 24 && day.byHour.every((n) => Number.isFinite(n)))
  const win = fake.lastWindow
  t('B4. 传给原生的时间窗是**本地日**（24 小时整，end-start === 86400000）', win && win.end - win.start === 86400000, JSON.stringify(win))
  const localDay = new Date(win.start)
  t('B4b. 窗口起点落在本地 00:00:00（用本机时区算，不是 UTC）',
    localDay.getHours() === 0 && localDay.getMinutes() === 0 && localDay.getSeconds() === 0, localDay.toString())
}

/* ---------- C 段：隐私口径（§1.8-3） ---------- */
{
  const fake = makeFakeUsage()
  installFake(fake)
  clearLS()
  /* 把「带包名的原始数据」直接塞进 byCategory 输入，确认 normalize 只取 key/ms */
  const out = U.normalizeCats([
    { key: 'comm', ms: 1000, pkg: 'com.tencent.mm', appName: '微信' },
    { key: 'fun', ms: 2000, pkg: 'com.x', appName: '某App' },
  ])
  const json = JSON.stringify(out)
  t('C1. normalizeCats 只留 key/ms：**原始里的包名与 App 名一个都不出现在输出里**',
    json.indexOf('com.tencent.mm') < 0 && json.indexOf('微信') < 0 && json.indexOf('pkg') < 0, json)

  const d = await U.fetchUsageDay(DAY)
  const djson = JSON.stringify(d)
  t('C2. fetchUsageDay 返回值整个序列化后也不含包名/App 名', djson.indexOf('com.') < 0 && djson.indexOf('微信') < 0, djson.slice(0, 160))

  /* 落盘也别带 */
  const r = U.upsertUsageDay({ version: 1, days: {} }, { date: DAY, granted: true, totalMs: d.totalMs, byCategory: d.byCategory, byHour: d.byHour, now: 1 })
  const stored = JSON.stringify(r.book)
  t('C3. 写进 `web2.usage` 的那份书里也没有包名/App 名', stored.indexOf('com.') < 0 && stored.indexOf('微信') < 0)
}

/* ---------- C 段续：分类映射口径（§1.8-2 沟通单列） ---------- */
{
  /* 原生侧负责「包名 → 类别」，web 侧只认类别。这里验**陌生 key 不丢数**（归 other）。 */
  const out = U.normalizeCats([
    { key: 'comm', ms: 100 },
    { key: 'weird-key-not-in-table', ms: 300 },   // 原生万一回了没见过的 key
    { key: 'other', ms: 50 },
  ])
  const other = out.find((c) => c.key === 'other')
  t('C4. 陌生 key 不丢：归进 other（宁可算「其他」也不要凭空少一块）', other.ms === 350, JSON.stringify(out))
  const bad = U.normalizeCats([{ key: 'comm', ms: -5 }, { key: 'fun', ms: 'abc' }, null, 3])
  t('C4b. 负数/非数字/非对象的条目直接忽略（不产生 NaN 宽度把条形图搞崩）',
    bad.every((c) => Number.isFinite(c.ms) && c.ms >= 0), JSON.stringify(bad))
  t('C5. USAGE_CATS 里沟通与娱乐是两个不同 key（微信不与抖音合并 —— §1.8-2）',
    U.USAGE_CATS.find((c) => c.key === 'comm') && U.USAGE_CATS.find((c) => c.key === 'fun')
    && U.USAGE_CATS.find((c) => c.key === 'comm').label === '沟通'
    && U.USAGE_CATS.find((c) => c.key === 'fun').label === '娱乐')
}

/* ---------- D 段：本机存档 sanitize / prune / upsert ---------- */
{
  clearLS()
  const bad = U.sanitizeUsageBook({ days: { x: { date: 'not-a-date', totalMs: 5 }, y: { date: DAY, totalMs: -9, byCategory: 'nope' } } })
  t('D1. sanitize 丢掉日期非法的条目，把负数 totalMs 夹到 0、把非数组 byCategory 归零',
    !bad.days.x && bad.days[DAY] && bad.days[DAY].totalMs === 0 && Array.isArray(bad.days[DAY].byCategory),
    JSON.stringify(bad))

  const many = { version: 1, days: {} }
  for (let i = 0; i < 200; i++) {
    const d = new Date(2026, 0, 1)
    d.setDate(d.getDate() + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    many.days[key] = { date: key, granted: true, totalMs: 1000, byCategory: [], byHour: [], updated_at: 1 }
  }
  const pruned = U.pruneUsage(many, 120)
  t('D2. prune 只留最近 keep 天（默认 120，与 daily.js 同口径）', Object.keys(pruned.days).length === 120)
  const newest = Object.values(pruned.days).sort((a, b) => (a.date < b.date ? 1 : -1))[0]
  /* 从 2026-01-01 起造 200 天 → 最后一天是 01-01 + 199 天 = 2026-07-19 */
  t('D2b. prune 留的是**最新**那批（不是随便 120 天）', newest.date === '2026-07-19', newest.date)

  /* upsert「没变就不写」：这正是 snapshot 每分钟跑一次却不该每分钟写盘的原因 */
  let book = { version: 1, days: {} }
  const r1 = U.upsertUsageDay(book, { date: DAY, granted: true, totalMs: 1000, byCategory: [{ key: 'fun', ms: 1000 }], byHour: [], now: 1 })
  t('D3. 第一次 upsert changed=true', r1.changed === true && !!r1.day)
  const r2 = U.upsertUsageDay(r1.book, { date: DAY, granted: true, totalMs: 1000, byCategory: [{ key: 'fun', ms: 1000 }], byHour: [], now: 2 })
  t('D3b. 同样的数字第二次 upsert changed=**false**（每分钟的快照不会每分钟写盘）', r2.changed === false, JSON.stringify(r2.day))
  const r3 = U.upsertUsageDay(r1.book, { date: DAY, granted: true, totalMs: 2000, byCategory: [{ key: 'fun', ms: 2000 }], byHour: [], now: 3 })
  t('D3c. 数字变了就 changed=true', r3.changed === true && r3.day.totalMs === 2000)

  /* granted 也是「变化」的一部分：昨天开了权限、今天关了，书里要能如实降级 */
  const r4 = U.upsertUsageDay(r1.book, { date: DAY, granted: false, totalMs: 0, now: 4 })
  t('D3d. 权限状态从 true 变 false 也算 changed（否则关了权限界面还报昨天的数）', r4.changed === true && r4.day.granted === false)

  U.saveUsage(r1.book)
  const load = U.loadUsage()
  t('D4. saveUsage/loadUsage 往返一致（走的是真 localStorage 键 `' + USAGE_KEY + '`）',
    !!load.days[DAY] && load.days[DAY].totalMs === 1000 && localStorage.getItem(USAGE_KEY) !== null)
  t('D5. usageOfDay 取得到当天、取不到别的天', U.usageOfDay(load, DAY) !== null && U.usageOfDay(load, '2000-01-01') === null)
}

/* ---------- E 段：展示逻辑 ---------- */
t('E1. formatMs：0→0m / 48 分→48m / 6h5m→6h05m / 正好整点→6h00m',
  U.formatMs(0) === '0m' && U.formatMs(48 * 60 * 1000) === '48m'
  && U.formatMs((6 * 60 + 5) * 60 * 1000) === '6h05m' && U.formatMs(6 * 3600 * 1000) === '6h00m',
  [U.formatMs(0), U.formatMs(48 * 60 * 1000), U.formatMs((6 * 60 + 5) * 60 * 1000)].join('/'))
t('E1b. formatMs 对负数/NaN 兜底成 0m（不会显示 NaNm）',
  U.formatMs(-100) === '0m' && U.formatMs('abc') === '0m')

{
  const day = { date: DAY, granted: true, totalMs: 300, byCategory: [{ key: 'comm', ms: 100 }, { key: 'fun', ms: 200 }], byHour: [] }
  const bd = U.catBreakdown(day)
  t('E2. catBreakdown 只列非 0 类，按固定顺序，占比按总时长算',
    bd.length === 2 && bd[0].key === 'comm' && bd[1].key === 'fun'
    && Math.abs(bd[0].pct - 33.3) < 0.06 && Math.abs(bd[1].pct - 66.7) < 0.06,
    JSON.stringify(bd))
  t('E3. 全 0 的那天 catBreakdown 返回空数组（界面走「今天没数据」，不画全灰条）',
    U.catBreakdown({ date: DAY, granted: true, totalMs: 0, byCategory: [] }).length === 0)

  const hours = new Array(24).fill(0)
  hours[0] = 10; hours[2] = 5; hours[11] = 100; hours[21] = 7
  const slots = U.hourSlots({ date: DAY, granted: true, totalMs: 115, byCategory: [], byHour: hours })
  t('E4. hourSlots 恰好 8 个 3 小时段，桶按 [0-3)/[3-6)/… 归位',
    slots.length === 8 && slots[0].ms === 15 && slots[3].ms === 100 && slots[7].ms === 7,
    JSON.stringify(slots.map((s) => s.ms)))

  t('E5. 全 0 的一天 slots 也是 8 个（画成一条平线，不是空数组把 DOM 拆了）',
    U.hourSlots({ date: DAY, granted: true, totalMs: 0, byCategory: [], byHour: new Array(24).fill(0) }).length === 8)
}

/* ---------- E 段续：8 天基线（§1.7 攒够才说话） ---------- */
{
  const mk = (n, ms, granted = true) => {
    const days = {}
    for (let i = 0; i < n; i++) {
      const d = new Date(2026, 9, 12)
      d.setDate(d.getDate() - i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      days[key] = { date: key, granted, totalMs: ms, byCategory: [], byHour: [], updated_at: 1 }
    }
    return { version: 1, days }
  }
  const few = U.usageBaseline(mk(3, 3600 * 1000), 8)
  t('E6. 只有 3 天：enough=false，界面只能说「基线建立中 3/8」', few.enough === false && few.kept === 3 && few.need === 8)
  const full = U.usageBaseline(mk(8, [(2 * 3600 + 30 * 60) * 1000, (1 * 3600) * 1000][0]), 8)
  t('E7. 攒够 8 天：enough=true，avgMs 是这 8 天的平均', full.enough === true && full.kept === 8 && full.avgMs === (2 * 3600 + 30 * 60) * 1000)
  const withDenied = { version: 1, days: Object.assign(U.sanitizeUsageBook(mk(8, 1000)).days, { [DAY]: { date: DAY, granted: false, totalMs: 0, byCategory: [], byHour: [], updated_at: 1 } }) }
  const base = U.usageBaseline(withDenied, 8)
  t('E8. 未授权的天**不算进基线**（否则「没开权限」会被当成「那天没玩手机」拉低平均）',
    base.kept === 7, `kept=${base.kept}`)
}

/* ---------- F 段：usageLine 折叠那一行的三态 ---------- */
{
  t('F1. 没数据/未授权 → 文案「手机 · 未开启」，granted=false',
    U.usageLine(null).text === '手机 · 未开启' && U.usageLine(null).granted === false)
  t('F1b. 授权了但今天 0 分钟 → has=false（界面说「今天没数据」，不说「未开启」）',
    U.usageLine({ date: DAY, granted: true, totalMs: 0, byCategory: [], byHour: [] }).has === false)
  t('F2. 有数 → 「手机 6h32m」', (() => {
    const l = U.usageLine({ date: DAY, granted: true, totalMs: (6 * 60 + 32) * 60 * 1000, byCategory: [], byHour: [] })
    return l.has === true && l.text === '手机 6h32m'
  })())
}

/* ---------- G 段：不进云同步（§1.8-3） ---------- */
{
  const S = await import('../src/data/sync.js')
  /* sync.js 若没导出 SYNC_KEYS，就从源码里读（两种都认）。 */
  let keys = null
  if (S.SYNC_KEYS) keys = S.SYNC_KEYS
  if (!keys) {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '../src/data/sync.js'), 'utf8')
    const m = src.match(/SYNC_KEYS\s*=\s*\[([^\]]*)\]/)
    keys = m ? m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean) : []
  }
  t('G1. `web2.usage` **不在**云同步白名单里（手机使用时间只留本机，§1.8-3）',
    keys.indexOf('web2.usage') < 0, JSON.stringify(keys))
  t('G2. 同步白名单仍只含六键（P7 口径没被 P6 悄悄改宽）', keys.length === 6, JSON.stringify(keys))
}

/* ---------- Z：报错路径要如实上抛，不能假装「今天没玩手机」 ---------- */
{
  const fake = makeFakeUsage()
  installFake(fake)
  fake.box.throwOnToday = true
  const d = await U.fetchUsageDay(DAY)
  t('Z1. 插件调用抛错时 fetchUsageDay 返回 ok:false + error（**绝不当成 0 分钟**）',
    d.ok === false && !!d.error && d.granted === false, JSON.stringify(d))
  fake.box.throwOnToday = false
  fake.box.throwOnAvailable = true
  const g = await U.usageGranted()
  t('Z2. available() 抛错时 usageGranted 返回 ok:false + error（不是 granted:false 蒙混过关）',
    g.ok === false && !!g.error, JSON.stringify(g))
  fake.box.throwOnAvailable = false
  const o = await U.openUsageSettings()
  t('Z3. openSettings 成功 → ok:true，且假插件收到了一次调用', o.ok === true && fake.settingsOpened === true)
}

console.log(`\n${pass} 过 / ${fail} 挂`)
process.exit(fail ? 1 : 0)
