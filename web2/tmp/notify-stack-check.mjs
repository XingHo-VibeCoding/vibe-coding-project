/* bug 02 通知堆积 —— applySchedule / pruneDelivered 的行为单测（node 直跑，无需浏览器）
   跑法：node tmp/notify-stack-check.mjs
   背景：用户报「时间提醒会一条条堆起来，不会更新」。两处原因——
     ① 每条通知没有 group，Android 不会把它们折成一组，三节课就是三条并排；
     ② 已经发出去的通知躺在通知栏里没人收，第二天又发一条，越叠越多。
   这里用假插件把这两件事钉住（真插件在 node 里不存在）。 */

/* ---- 假环境：localStorage + window.Capacitor.Plugins.LocalNotifications ---- */
const mem = {}
globalThis.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v) },
  removeItem: (k) => { delete mem[k] },
}

let pending = []
let delivered = []
const calls = { schedule: [], cancel: [], removed: [] }
const fake = {
  async schedule({ notifications }) {
    calls.schedule.push(notifications)
    for (const n of notifications) {
      /* 真插件按 id 覆盖（同一个 id 只会留一条），这里照做 —— 不然幂等性测不出来 */
      pending = pending.filter((x) => x.id !== n.id)
      pending.push({ id: n.id, title: n.title, body: n.body, group: n.group, extra: n.extra })
    }
  },
  async cancel({ notifications }) {
    calls.cancel.push(notifications)
    const ids = new Set(notifications.map((n) => n.id))
    pending = pending.filter((x) => !ids.has(x.id))
  },
  async getPending() { return { notifications: pending.map((x) => ({ ...x })) } },
  async getDeliveredNotifications() { return { notifications: delivered.map((x) => ({ ...x })) } },
  async removeDeliveredNotifications({ notifications }) {
    calls.removed.push(notifications)
    const ids = new Set(notifications.map((n) => n.id))
    delivered = delivered.filter((x) => !ids.has(x.id))
  },
  async createChannel() {},
  async registerActionTypes() {},
  async checkPermissions() { return { display: 'granted' } },
  async requestPermissions() { return { display: 'granted' } },
  async addListener() { return { remove() {} } },
}
globalThis.window = { Capacitor: { Plugins: { LocalNotifications: fake } } }

const N = await import('../src/data/notify.js')

let pass = 0, fail = 0
const t = (name, cond, ev) => {
  if (cond) { pass++; console.log('PASS  ' + name + (ev === undefined ? '' : '  → ' + ev)) }
  else { fail++; console.log('FAIL  ' + name + (ev === undefined ? '' : '  → ' + ev)) }
}
const reset = () => { pending = []; delivered = []; calls.schedule.length = 0; calls.cancel.length = 0; calls.removed.length = 0 }
const mk = (key, h, m, title) => ({ key, at: new Date(2026, 9, 24, h, m), title, body: '10 分钟后开始' })

/* ================= A 排程带 group（Android 才会折成一组） ================= */
console.log('\n--- A 排程带 group ---')
reset()
{
  const items = [mk('c_a_2026-10-24', 7, 50, '高等数学'), mk('c_b_2026-10-24', 9, 50, '线性代数'), mk('c_c_2026-10-24', 13, 50, '结构力学')]
  const r = await N.applySchedule(items)
  t('A1 三条都排上了', r.ok && r.scheduled === 3, 'scheduled=' + r.scheduled)
  t('A2 每条都带 group（否则通知栏就是三条并排）', calls.schedule[0].every((n) => typeof n.group === 'string' && n.group), calls.schedule[0][0].group)
  t('A3 同一批用同一个 group', new Set(calls.schedule[0].map((n) => n.group)).size === 1)
  t('A4 group 按 src 区分（课前提醒一组）', calls.schedule[0][0].group === 'web2-' + 'web2-m5', calls.schedule[0][0].group)
}

console.log('\n--- A5 练耳/复盘各自成组 ---')
{
  reset()
  await N.applySchedule([mk('l_1_2026-10-24', 20, 0, '练耳')], { src: N.LISTEN_TAG, channelId: N.LISTEN_CHANNEL, actionTypeId: null })
  t('A5 练耳提醒进自己那组，不混进课前提醒', calls.schedule[0][0].group === 'web2-' + N.LISTEN_TAG, calls.schedule[0][0].group)
}

/* ================= B 幂等：调两次不翻倍 ================= */
console.log('\n--- B 幂等重排 ---')
reset()
{
  const items = [mk('c_a_2026-10-24', 7, 50, '高等数学'), mk('c_b_2026-10-24', 9, 50, '线性代数')]
  await N.applySchedule(items)
  await N.applySchedule(items)
  t('B1 连调两次，pending 还是 2 条（不翻倍）', pending.length === 2, pending.length + ' 条')
  /* 第一次排的时候 pending 本来是空的，所以只有第二次才真的 cancel（1 次、2 条） */
  t('B2 第二次先 cancel 了旧的那批', calls.cancel.length === 1 && calls.cancel[0].length === 2, JSON.stringify(calls.cancel.map((c) => c.length)))
}

/* ================= C 并发：两次不 await 同时调，不能丢也不能重 ================= */
console.log('\n--- C 并发排程（cancel/schedule 交错） ---')
reset()
{
  const a = [mk('c_a_2026-10-24', 7, 50, '高等数学')]
  const b = [mk('c_a_2026-10-24', 7, 50, '高等数学'), mk('c_b_2026-10-24', 9, 50, '线性代数')]
  await Promise.all([N.applySchedule(a), N.applySchedule(b)])
  t('C1 串行化后最后一次赢（2 条，不是 3 条也不是 0 条）', pending.length === 2, pending.length + ' 条')
  t('C2 没有出现「A 排完被 B 的 cancel 清掉」的空档', pending.some((x) => x.title === '线性代数'))
}

/* ================= D 关掉开关 = 清空 ================= */
console.log('\n--- D 关掉开关 ---')
reset()
{
  await N.applySchedule([mk('c_a_2026-10-24', 7, 50, '高等数学')])
  const r = await N.applySchedule([], { enabled: false })
  t('D1 关掉后 pending 清空', pending.length === 0, pending.length + ' 条')
  t('D2 返回 cancelled 标记', r.ok && r.cancelled === true && r.scheduled === 0)
}

/* ================= E 通知栏去重 ================= */
console.log('\n--- E 通知栏去重（pruneDelivered） ---')
reset()
{
  delivered = [
    { id: 1, tag: null, group: 'web2-web2-m5', title: '昨天那条' },
    { id: 2, tag: null, group: 'web2-web2-m5', title: '前天那条' },
    { id: 3, tag: null, group: 'web2-web2-m5', title: '最新那条' },
    { id: 4, tag: null, group: 'other-app', title: '别人的' },
    { id: 5, tag: null, group: null, title: '录音中的常驻状态框' },
  ]
  const r = await N.pruneDelivered()
  t('E1 同组 3 条只留 1 条', r.ok && r.removed === 2, 'removed=' + r.removed)
  t('E2 留下的是最后那条（最新的）', delivered.some((x) => x.title === '最新那条'), delivered.map((x) => x.title).join(' | '))
  t('E3 别人组的通知一条不碰', delivered.some((x) => x.title === '别人的'))
  t('E4 录音中的常驻状态框（无 group）一条不碰', delivered.some((x) => x.title === '录音中的常驻状态框'))
}

console.log('\n--- E5 只有一条时不动 ---')
{
  reset()
  delivered = [{ id: 9, tag: null, group: 'web2-web2-m5', title: '就一条' }]
  const r = await N.pruneDelivered()
  t('E5 已经只有一条 → 一条都不删', r.ok && r.removed === 0, 'removed=' + r.removed)
  t('E6 没有多余的 remove 调用', calls.removed.length === 0)
}

/* ================= F 完成通知也成组 ================= */
console.log('\n--- F 完成通知 ---')
reset()
{
  const r = await N.notifyDone('纪要好了', '可以去看看')
  t('F1 完成通知发得出去', r.ok === true)
  t('F2 完成通知带自己的 group（连转两段不会并排两条）', calls.schedule[0][0].group === 'web2-done', calls.schedule[0][0].group)
}

/* ================= G 常量与降级 ================= */
console.log('\n--- G 常量与降级 ---')
{
  t('G1 每组默认只留 1 条', N.DELIVERED_KEEP === 1, N.DELIVERED_KEEP)
  const saved = globalThis.window
  globalThis.window = {}
  const r = await N.pruneDelivered()
  t('G2 浏览器里（没有插件）不抛、返回 unsupported', r.ok === false && r.unsupported === true)
  const r2 = await N.applySchedule([mk('x', 7, 0, 'x')])
  t('G3 浏览器里排程同样安全降级', r2.ok === false && r2.unsupported === true)
  globalThis.window = saved
}

console.log('\n===== ' + pass + ' PASS / ' + fail + ' FAIL =====')
process.exit(fail ? 1 : 0)