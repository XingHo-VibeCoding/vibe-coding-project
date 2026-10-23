/* 全量归档单测（纯逻辑，不需要浏览器）。
   跑法：node tmp/archive-unit.mjs（web2 目录下）

   覆盖四件事：
   A 白名单完整性 —— 备份范围必须覆盖本机全部非机密键（漏一个键 = 那个键的数据没退路）
   B 机密不外泄 —— 往三个机密键里塞哨兵串，断言归档文本里搜不到
   C 往返一致 —— 导出 → 清空 → 恢复 → 逐键比对
   D 拒绝非法输入 —— 主项目 JSON / 坏 JSON / 高版本 / 伪造键名

   D 里的「伪造键名」是安全项：归档文件用户可以手改，不能让一个不认识的键名
   往 localStorage 里写东西。 */
const store = {}
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
  key: (i) => Object.keys(store)[i],
  get length() { return Object.keys(store).length },
}
globalThis.window = globalThis

const A = await import('../src/data/archive.js')

let pass = 0, fail = 0
function t(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name) }
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  → ' + extra : '')) }
}
const reset = () => Object.keys(store).forEach((k) => delete store[k])

/* 本机真实存在的键（2026-10-16 从源码里 grep 出来的权威清单，29 个）。
   任何时刻新增了键而忘了加进 ARCHIVE_INCLUDE，这条会红 —— 这正是它存在的意义。
   2026-10-16 五条线 04 新增两个键：web2.exams（考试安排）、web2.exam.set（考前提醒设置）。
   2026-10-23 06 新增 web2.examSyncAt（考试自动同步的时间戳，进「不归档」那一列）。 */
const ALL_KEYS = [
  'web2.accent', 'web2.added', 'web2.courseOv', 'web2.daily', 'web2.data',
  'web2.dayOverrides', 'web2.eduAccount', 'web2.eduSnapshot', 'web2.events',
  'web2.exam.set', 'web2.exams',
  'web2.frame', 'web2.frame.marks', 'web2.habits', 'web2.holidayCache',
  'web2.lectures', 'web2.listen', 'web2.listen.set', 'web2.llm', 'web2.notify',
  'web2.onboarded', 'web2.reasons', 'web2.review', 'web2.review.set',
  'web2.sync', 'web2.theme', 'web2.theme.auto', 'web2.todos', 'web2.usage',
  'web2.examSyncAt',
]
const SECRET_KEYS = ['web2.llm', 'web2.eduAccount', 'web2.sync']

/* ================= 组 A：白名单完整性 ================= */
console.log('--- A 备份范围 ---')
{
  const included = new Set(A.ARCHIVE_INCLUDE.map((x) => x.k))
  const excluded = new Set(A.ARCHIVE_EXCLUDE.map((x) => x.k))
  const missing = ALL_KEYS.filter((k) => !included.has(k) && !excluded.has(k))
  t('A1. 每个本机键都被明确归入「备份」或「排除」', missing.length === 0, missing.join(','))
  t('A2. 备份 + 排除 = 本机全部键', included.size + excluded.size === ALL_KEYS.length,
    `${included.size}+${excluded.size} vs ${ALL_KEYS.length}`)
  const dup = A.ARCHIVE_INCLUDE.filter((x) => included.size !== new Set(A.ARCHIVE_INCLUDE.map((y) => y.k)).size)
  t('A3. 备份清单无重复键', dup.length === 0)
  t('A4. 三个机密键都在排除名单里',
    SECRET_KEYS.every((k) => excluded.has(k)),
    SECRET_KEYS.filter((k) => !excluded.has(k)).join(','))
  t('A5. 每个备份项都带 label（界面要显示它是什么）',
    A.ARCHIVE_INCLUDE.every((x) => x.label && x.label.length > 0))
  t('A6. 每个排除项都带 why（界面要如实说明为什么）',
    A.ARCHIVE_EXCLUDE.every((x) => x.why && x.why.length > 0))
  t('A7. isBackupKey / isExcludedKey 判定与清单一致',
    A.isBackupKey('web2.daily') && !A.isBackupKey('web2.llm') && A.isExcludedKey('web2.llm'))
}

/* ================= 组 B：机密不外泄 ================= */
console.log('--- B 机密不外泄 ---')
{
  reset()
  store['web2.llm'] = JSON.stringify({ provider: 'deepseek', key: 'SENTINEL-APIKEY-9f3a', model: 'x' })
  store['web2.eduAccount'] = JSON.stringify({ user: 'SENTINEL-ZJUUSER', pass: 'SENTINEL-ZJUPASS' })
  store['web2.sync'] = JSON.stringify({ pass: 'SENTINEL-SYNCPASS', rev: 3, at: '', uid: 'abcd1234' })
  store['web2.holidayCache'] = JSON.stringify({ fetchedAt: 'SENTINEL-CACHE', byYear: {} })
  store['web2.data'] = JSON.stringify({ app: 'sched', todos: [{ id: 'x' }] })

  const built = A.buildArchive(new Date('2026-10-15T12:00:00Z'))
  const text = A.archiveToText(built.archive)
  t('B1. 归档里搜不到 API Key', !text.includes('SENTINEL-APIKEY-9f3a'))
  t('B2. 归档里搜不到教务账号与密码',
    !text.includes('SENTINEL-ZJUUSER') && !text.includes('SENTINEL-ZJUPASS'))
  t('B3. 归档里搜不到同步串', !text.includes('SENTINEL-SYNCPASS'))
  t('B4. 归档里搜不到节假日缓存', !text.includes('SENTINEL-CACHE'))
  t('B5. archiveLeaksSecrets 对干净归档返回空', A.archiveLeaksSecrets(text).length === 0,
    JSON.stringify(A.archiveLeaksSecrets(text)))
  t('B6. archiveLeaksSecrets 能咬住人为泄漏（把 Key 塞进导出）',
    A.archiveLeaksSecrets(text + 'SENTINEL-APIKEY-9f3a').length > 0)
  t('B7. 备份范围内的键确实进了归档', built.archive.data['web2.data'] !== undefined)
  t('B8. 归档带格式标记与版本',
    built.archive.format === 'web2-archive' && built.archive.version === 1)
}

/* ================= 组 C：往返一致 ================= */
console.log('--- C 导出 → 清空 → 恢复 ---')
{
  reset()
  /* 造一份「什么都有」的本机状态 */
  for (const k of ALL_KEYS) {
    if (SECRET_KEYS.includes(k) || A.isExcludedKey(k)) continue /* 机密与「不归档」的键本来就不该往返 */
    store[k] = JSON.stringify({ tag: k, n: k.length })
  }
  store['web2.theme'] = 'dark'          // 裸字符串（不是 JSON）也要能往返
  store['web2.onboarded'] = '1'
  const before = {}
  for (const k of ALL_KEYS) before[k] = store[k] === undefined ? null : store[k]

  const built = A.buildArchive(new Date('2026-10-15T12:00:00Z'))
  const text = A.archiveToText(built.archive)
  const read = A.readArchive(text)
  t('C1. 自己写的归档能读回来', read.ok, read.error)
  t('C2. 预览里的键数 = 备份项数', read.preview.keys === built.keys,
    `${read.preview.keys} vs ${built.keys}`)
  t('C3. 预览带导出时间', read.preview.exportedAt.startsWith('2026-10-15'))
  t('C4. 预览里没有忽略项（自己写的都是白名单内的）', read.ignored.length === 0,
    JSON.stringify(read.ignored))

  /* 清空整个本机（模拟换机 / 清缓存） */
  reset()
  const plan0 = A.planRestore(read.archive)
  t('C5. 空机上恢复计划：全部是「写入」，没有要清空的', plan0.write > 0 && plan0.remove === 0,
    `write=${plan0.write} remove=${plan0.remove}`)

  const applied = A.applyArchive(read.archive)
  t('C6. 恢复成功', applied.ok, applied.error)
  let same = 0, diff = []
  for (const k of ALL_KEYS) {
    const now = store[k] === undefined ? null : store[k]
    if (now === before[k]) same++
    else diff.push(k)
  }
  t('C7. 27 个键逐个与导出前一致', diff.length === 0, diff.join(','))
  t('C8. 机密键恢复后仍是空（归档里没有它们，不该被写回）',
    SECRET_KEYS.every((k) => store[k] === undefined))

  /* 整份替换语义：**归档里没有的**备份范围内键，本机要清掉。
     上面那份归档什么都有，所以这里另造一份「只含两个键」的残缺归档来验。 */
  store['web2.reasons'] = 'THIS-SHOULD-BE-CLEARED'
  store['web2.daily'] = 'THIS-TOO'
  const partial = { format: 'web2-archive', version: 1, data: { 'web2.data': '{"ok":1}', 'web2.theme': 'dark' } }
  const plan1 = A.planRestore(partial)
  t('C9. 本机有、归档没有的键会被列入「清空」',
    plan1.clear.some((x) => x.k === 'web2.reasons') && plan1.clear.some((x) => x.k === 'web2.daily'),
    JSON.stringify(plan1.clear.map((x) => x.k)))
  A.applyArchive(partial)
  t('C10. 恢复后这些键确实被清掉（整份替换，不是合并）',
    store['web2.reasons'] === undefined && store['web2.daily'] === undefined)

  /* 幂等：再恢复一次，结果不变 */
  const again = A.applyArchive(read.archive)
  t('C11. 重复恢复幂等', again.ok && store['web2.theme'] === 'dark')
}

/* ================= 组 D：拒绝非法输入 ================= */
console.log('--- D 拒绝非法输入 ---')
{
  reset()
  t('D1. 空文本被拒', !A.readArchive('').ok)
  t('D2. 坏 JSON 被拒', !A.readArchive('{oops').ok)
  t('D3. 主项目导出文件被拒，并给出正确指引',
    (() => { const r = A.readArchive('{"app":"sched","todos":[]}'); return !r.ok && r.error.includes('导入主项目数据') })(),
    A.readArchive('{"app":"sched","todos":[]}').error)
  t('D4. 缺格式标记的 JSON 被拒', !A.readArchive('{"data":{}}').ok)
  t('D5. 高版本归档被拒（不让新格式被旧代码吃掉）',
    (() => { const r = A.readArchive(JSON.stringify({ format: 'web2-archive', version: 99, data: {} })); return !r.ok && r.error.includes('更新') })())
  t('D6. 没有数据段的归档被拒',
    !A.readArchive(JSON.stringify({ format: 'web2-archive', version: 1 })).ok)

  /* 安全项：伪造键名不能写进本机 */
  const forged = JSON.stringify({
    format: 'web2-archive', version: 1, exported_at: 'x',
    data: { 'web2.data': '{"ok":1}', 'web2.evil': 'HACK', 'web2.llm': '{"key":"STOLEN"}' },
  })
  const rf = A.readArchive(forged)
  t('D7. 伪造归档能读，但只保留白名单内的键', rf.ok && rf.archive.data['web2.evil'] === undefined)
  t('D8. 归档里夹带的机密键被丢弃', rf.archive.data['web2.llm'] === undefined)
  t('D9. 被丢弃的键在预览里如实列出（不静默吞掉）',
    rf.ignored.length === 2 && rf.ignored.some((x) => x.k === 'web2.evil'),
    JSON.stringify(rf.ignored))
  A.applyArchive(rf.archive)
  t('D10. 落地后本机不存在伪造键', store['web2.evil'] === undefined && store['web2.llm'] === undefined)

  /* 值不是字符串的也要挡掉 */
  const badVal = JSON.stringify({ format: 'web2-archive', version: 1, data: { 'web2.data': { nested: true } } })
  const rb = A.readArchive(badVal)
  t('D11. 值不是文本的键被丢弃', rb.ok && rb.archive.data['web2.data'] === undefined)
  t('D12. 无效归档调用 applyArchive 会被拒', !A.applyArchive({}).ok && !A.applyArchive(null).ok)
}

/* ================= 组 E：写满时的回滚 ================= */
console.log('--- E 写盘失败要回滚 ---')
{
  reset()
  store['web2.data'] = 'OLD-DATA'
  store['web2.theme'] = 'light'
  const archive = {
    format: 'web2-archive', version: 1, data: { 'web2.data': 'NEW-DATA', 'web2.todos': 'NEW-TODOS' },
  }
  /* 让第 2 次写入抛 QuotaExceededError，模拟存储写满。
     只抛一次：回滚过程本身也在写，不能让它再炸一次（否则测的是桩不是代码）。 */
  let n = 0, boom = true
  const realSet = globalThis.localStorage.setItem
  globalThis.localStorage.setItem = (k, v) => {
    n++
    if (boom && n === 2) { boom = false; const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e }
    realSet(k, v)
  }
  const r = A.applyArchive(archive)
  globalThis.localStorage.setItem = realSet
  t('E1. 写盘失败时返回 ok:false', !r.ok, JSON.stringify(r))
  t('E2. 错误文案说明已还原（不是含糊的「失败」）', String(r.error).includes('还原'), r.error)
  t('E3. 原数据没被改坏（web2.data 还是旧值）', store['web2.data'] === 'OLD-DATA', store['web2.data'])
  t('E4. 第一次写进去的键也被回滚掉', store['web2.todos'] === undefined, store['web2.todos'])
  t('E5. rolledBack 标记为真', r.rolledBack === true)
  t('E6. 未参与本次恢复的键没被动过（web2.theme 仍是 light）', store['web2.theme'] === 'light', store['web2.theme'])
}

console.log(`\n=== 全量归档：${pass}/${pass + fail} 通过 ===`)
if (fail) console.log('失败项：见上面 FAIL 行')
process.exit(fail ? 1 : 0)
