/* P12b 后续：密码存「系统密钥库」检查（纯逻辑，不需要网络 / 不需要真设备）

   验的是三件事：
     1. `data/secureStore.js` 的桥行为——有没有插件、读不到/读坏了/没存过 三态分得开
     2. `data/eduLogin.js` 的「机密 / 非机密」分开落盘——**localStorage 里再也不该出现密码**
     3. 老数据（升级前密码明文躺在 localStorage）**读的时候自动搬家**，且搬完不留副本
     4. 非 App 环境（无插件）如实退回老办法，行为与升级前逐字一致

   跑法：node tmp/secure-store-check.mjs
   注：本文件用**假插件**注入 window.Capacitor，不碰真机、不读网络。 */

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

/* ---------------- 假插件：行为可控的「系统密钥库」 ----------------
   比真机强的地方：能按需制造「解不开」这种真机上很难复现的状态。 */
function makeFakeSecureStore() {
  const box = new Map()
  const S = {
    box,
    /* 把某一项改成「取的时候会抛」（模拟密文解不开：换设备/清过应用数据） */
    corrupt(k) {
      box.set(k, '__THROW__')
    },
    calls: { get: 0, set: 0, remove: 0 },
    async get({ key }) {
      S.calls.get++
      if (!box.has(key)) return { value: null } // 没存过 → null（不是错误）
      const v = box.get(key)
      if (v === '__THROW__') throw new Error('读取失败（密文解不开）')
      return { value: v }
    },
    async set({ key, value }) {
      S.calls.set++
      if (String(value) === '__THROW__') throw new Error('加密写入失败')
      box.set(key, String(value))
      return {}
    },
    async remove({ key }) {
      S.calls.remove++
      if (!box.has(key)) throw new Error('删除失败（内部错误）')
      box.delete(key)
      return {}
    },
  }
  return S
}

/* 装/卸假插件 */
function installFake(ss) {
  globalThis.window = globalThis.window || globalThis
  globalThis.window.Capacitor = { Plugins: ss ? { SecureStore: ss } : {} }
}

/* 每个 A/B 段之间要重置模块状态吗？这两个模块都没有模块级缓存，不用。
   localStorage 则每个断言前手动清。 */
function clearLS() {
  for (const k of [...localStorage.m.keys()]) localStorage.removeItem(k)
}

const SS = await import('../src/data/secureStore.js')
const L = await import('../src/data/eduLogin.js')

/* ---------- A 段：secureStore.js 的三态与平台判定 ---------- */
installFake(null)
t('A1. 没有插件时 secureStoreAvailable() 为 false，且三个方法都如实报 unsupported',
  SS.secureStoreAvailable() === false
  && (await SS.secretGet('k')).unsupported === true
  && (await SS.secretSet('k', 'v')).unsupported === true
  && (await SS.secretRemove('k')).unsupported === true)

{
  const fake = makeFakeSecureStore()
  installFake(fake)
  t('A2. 装了插件就 available', SS.secureStoreAvailable() === true)

  const miss = await SS.secretGet('nope')
  t('A2b. **没存过** 返回 ok + missing（不是错误）——首次登录走这条路',
    miss.ok === true && miss.missing === true && miss.value === '',
    JSON.stringify(miss))

  const w = await SS.secretSet('k1', 'p@ss w0rd 中文')
  const r = await SS.secretGet('k1')
  t('A2c. 写进去能原样读回来（含空格与中文）', w.ok === true && r.ok === true && r.value === 'p@ss w0rd 中文', JSON.stringify(r))

  await SS.secretRemove('k1')
  const after = await SS.secretGet('k1')
  t('A2d. 删掉之后回到「没存过」', after.ok === true && after.missing === true, JSON.stringify(after))

  fake.corrupt('k2')
  const bad = await SS.secretGet('k2')
  t('A2e. **存过但解不开** 返回 !ok + error（与「没存过」分得开，界面处置完全不同）',
    bad.ok === false && !bad.missing && /解不开|读取失败/.test(bad.error || ''),
    JSON.stringify(bad))

  /* 写入报错要如实上抛，不能假装成功 */
  const wf = await SS.secretSet('k3', '__THROW__')
  t('A2f. 写入报错时返回 !ok + error（绝不假装存好了）', wf.ok === false && /加密写入失败/.test(wf.error || ''), JSON.stringify(wf))

  /* 空值：插件返回 '' 时按「没存过」处理（避免把空串当成一个密码） */
  await fake.set({ key: 'k4', value: '' })
  const em = await SS.secretGet('k4')
  t('A2g. 空串按「没存过」处理（不把空密码当成密码）', em.ok === true && em.missing === true, JSON.stringify(em))
}

/* ---------- B 段：eduLogin.js 的机密/非机密分开落盘 ---------- */
installFake(null)
t('B1. 非 App 环境如实报后端是 local（保证开发/测试能用，不假装有密钥库）', L.eduSecretBackend() === 'local')

{
  clearLS()
  const fake = makeFakeSecureStore()
  installFake(fake)
  t('B2. App 环境报后端是 keystore', L.eduSecretBackend() === 'keystore')

  const r = await L.saveEduAccountAsync({ username: '3240000000', password: 'secret-pw', remember: true, xnm: '2026', xqm: '3' })
  t('B3. 保存成功', r.ok === true, JSON.stringify(r))

  const rawLS = localStorage.getItem(L.EDU_ACCOUNT_KEY) || ''
  t('B3b. **localStorage 里绝对没有密码**（这是整件事的目的）',
    rawLS.indexOf('secret-pw') === -1, rawLS)
  t('B3c. localStorage 只留非机密的四项：学号 / 记住 / 学年 / 学期',
    JSON.stringify(Object.keys(JSON.parse(rawLS)).sort()) === JSON.stringify(['remember', 'username', 'xnm', 'xqm']),
    rawLS)
  t('B3d. 密码确实进了「密钥库」',
    fake.box.get(L.EDU_SECRET_KEY) === 'secret-pw', JSON.stringify([...fake.box.entries()]))

  const back = await L.loadEduAccountAsync()
  t('B4. 读回来时密码被补上（学号/密码/学年/学期都对）',
    back.username === '3240000000' && back.password === 'secret-pw' && back.xnm === '2026' && back.xqm === '3' && !back.secretError,
    JSON.stringify({ ...back, password: back.password ? '<有>' : '<空>' }))

  /* 不勾「记住」= 密码为空 → 必须把密钥库里的旧密码删掉，否则开关形同虚设 */
  const r2 = await L.saveEduAccountAsync({ username: '3240000000', password: '', remember: false, xnm: '2026', xqm: '3' })
  const back2 = await L.loadEduAccountAsync()
  t('B5. 改成「不记住」后旧密码**真的被删掉**（否则下次还会自动登录，等于开关失效）',
    r2.ok === true && back2.password === '' && !fake.box.has(L.EDU_SECRET_KEY),
    JSON.stringify({ box: [...fake.box.keys()], pw: back2.password }))

  /* 换设备/清过数据：密文解不开 → 必须报出来，而不是当作「没记住」 */
  await L.saveEduAccountAsync({ username: '3240000000', password: 'secret-pw', remember: true, xnm: '2026', xqm: '3' })
  fake.corrupt(L.EDU_SECRET_KEY)
  const back3 = await L.loadEduAccountAsync()
  t('B5b. 密文解不开时给 secretError（界面据此说「请重新输一次」，而不是静默当没存过）',
    !!back3.secretError && back3.password === '',
    JSON.stringify(back3))

  /* 密钥库写不进去时：**绝不**退回明文写 localStorage，且如实报错 */
  const fake2 = makeFakeSecureStore()
  installFake(fake2)
  fake2.set = async () => {
    throw new Error('系统密钥库不可用')
  }
  clearLS()
  const rw = await L.saveEduAccountAsync({ username: 'u', password: 'p', remember: true })
  t('B6. 密钥库写失败 → 返回 !ok + secretError，且**没有**把明文塞进 localStorage',
    rw.ok === false && !!rw.secretError && (localStorage.getItem(L.EDU_ACCOUNT_KEY) || '').indexOf('"password"') === -1,
    JSON.stringify(rw) + ' ls=' + (localStorage.getItem(L.EDU_ACCOUNT_KEY) || '<空>'))

  /* 清空：两处一起清，不留「学号没了密码还在」的半截状态 */
  const fake3 = makeFakeSecureStore()
  installFake(fake3)
  clearLS()
  await L.saveEduAccountAsync({ username: 'u', password: 'p', remember: true })
  await L.clearEduAccountAsync()
  const a = await L.loadEduAccountAsync()
  t('B7. clearEduAccountAsync 把两处一起清干净',
    a.username === '' && a.password === '' && fake3.box.size === 0 && localStorage.getItem(L.EDU_ACCOUNT_KEY) === null,
    JSON.stringify({ box: fake3.box.size, ls: localStorage.getItem(L.EDU_ACCOUNT_KEY) }))
}

/* ---------- C 段：老数据（升级前：密码明文在 localStorage）自动搬家 ---------- */
{
  clearLS()
  const fake = makeFakeSecureStore()
  installFake(fake)
  /* 造一份升级前的存档：就是老 saveEduAccount 写出来的形状 */
  localStorage.setItem(L.EDU_ACCOUNT_KEY, JSON.stringify({
    username: '3240000000', password: 'old-pw', remember: true, xnm: '2026', xqm: '3',
  }))

  const a = await L.loadEduAccountAsync()
  t('C1. 老的明文密码仍能读出来（用户无感，不用重输）',
    a.username === '3240000000' && a.password === 'old-pw', JSON.stringify({ ...a, password: a.password ? '<有>' : '<空>' }))
  t('C1b. 顺手搬进密钥库了',
    fake.box.get(L.EDU_SECRET_KEY) === 'old-pw', JSON.stringify([...fake.box.entries()]))
  const rawLS = localStorage.getItem(L.EDU_ACCOUNT_KEY) || ''
  t('C1c. **搬完就从 localStorage 抹掉明文**（不留副本）',
    rawLS.indexOf('old-pw') === -1 && JSON.parse(rawLS).username === '3240000000', rawLS)

  /* 迁移只做一次：再读一次仍然正常，且不会重复搬 */
  const b = await L.loadEduAccountAsync()
  t('C1d. 再读一次仍然正常（幂等）', b.password === 'old-pw' && fake.calls.set === 1, 'set=' + fake.calls.set)

  /* 密钥库里已有新密码时，老 localStorage 里的明文必须被清掉（否则永远有一份明文躺着） */
  fake.box.set(L.EDU_SECRET_KEY, 'new-pw')
  localStorage.setItem(L.EDU_ACCOUNT_KEY, JSON.stringify({ username: 'u', password: 'stale-pw', remember: true, xnm: '2026', xqm: '3' }))
  const c = await L.loadEduAccountAsync()
  t('C2. 密钥库里已有密码 → 以密钥库为准，且清掉 localStorage 里的旧明文',
    c.password === 'new-pw'
    && (localStorage.getItem(L.EDU_ACCOUNT_KEY) || '').indexOf('stale-pw') === -1,
    JSON.stringify({ pw: c.password, ls: localStorage.getItem(L.EDU_ACCOUNT_KEY) }))

  /* 老数据坏了也不能抛。注意这里**密码仍然读得出来**——它住在密钥库里，
     localStorage 坏掉的只是「非机密」那一半（学号丢了）。这正是分开存的好处。 */
  localStorage.setItem(L.EDU_ACCOUNT_KEY, '{坏 JSON')
  const d = await L.loadEduAccountAsync()
  t('C2b. 老存档是坏 JSON 时也不抛；密码仍从密钥库读出来（学号丢了但不影响密码）',
    d.username === '' && d.password === 'new-pw', JSON.stringify({ ...d, password: d.password ? '<有>' : '<空>' }))
}

/* ---------- D 段：非 App 环境退回老办法，行为与升级前一致 ---------- */
{
  clearLS()
  installFake(null)
  const r = await L.saveEduAccountAsync({ username: 'u', password: 'p', remember: true, xnm: '2026', xqm: '3' })
  const raw = JSON.parse(localStorage.getItem(L.EDU_ACCOUNT_KEY) || '{}')
  t('D1. 没有密钥库时退回老办法（整份存 localStorage），保证浏览器里能用',
    r.ok === true && raw.password === 'p' && raw.username === 'u', JSON.stringify(raw))
  const a = await L.loadEduAccountAsync()
  t('D1b. 同步的 loadEduAccount() 仍能用（老调用点一行没改）', a.password === 'p' && a.username === 'u')
  const c = await L.clearEduAccountAsync()
  t('D1c. 清空也正常（通知密钥库那步如实跳过）', c.ok === true && L.loadEduAccount().username === '')
  /* saveEduAccount 同步版仍在（老测试 A14 靠它），不是遗留垃圾而是浏览器端的实现 */
  t('D1d. 同步版 saveEduAccount / clearEduAccount 仍在且行为不变（浏览器端就是它们）',
    L.saveEduAccount({ username: 'x', password: 'y', remember: true }).password === 'y'
    && L.loadEduAccount().password === 'y')
}

console.log(`\n系统密钥库检查：${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
