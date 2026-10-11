// Day 28｜云同步的数据层（P7）：把「课表 + 待办」这一小撮键整份上传/下载。
//
// 口径（用户 2026-10-12 拍板）：
//   · 同步范围 = 只传课表与待办（下面 SYNC_KEYS 六把键），录音音频 / 每日快照 /
//     练耳进度 / 习惯打卡这些本机大件**不动**。录音是设备本地的生命记录，几十 MB
//     传不上去也不该传；每日快照是本机节奏，跨设备反而会互相打架。
//   · 同步串派身份 = 用户在设置里自己定一个串，**只存本机**（SYNC_KEY），
//     服务端 owner_uid = HMAC(WRITE_TOKEN, 串)。两台设备输入同一个串 → 同一份数据。
//   · **绝不**同步这些：web2.llm（里面是 DeepSeek API Key）、web2.eduAccount
//     （统一身份认证账号密码）、web2.notify（本机通知设置）、web2.lectures
//     （录音元数据与音频路径——换了设备路径全是死的，传过去只是噪音）。
//
// 为什么是「整份」而不是「逐条 CRUD」：见 docs/api-contract.md §6。逐条同步中途断网
// 会得到半份数据（半份比没有更坏）；整份上传是原子的，要么旧版要么新版。
//
// 冲突口径：上传时带上「本机这份是基于云端哪一版改的」（baseRev）：
//   · 云端 rev <= baseRev → 正常写入，rev +1
//   · 云端 rev >  baseRev → 服务端回 409，**不覆盖**；界面把两份摆出来让用户选
//     （要云端的就下载，要本机的就「覆盖云端」= 再传一次带 force）。
//   不传 baseRev（新设备第一次上传）按 0 算 —— 云端早有数据就如实报冲突，
//   绝不静默把云端那份冲掉。
'use strict'

/* 同步串与「上次同步到哪一版」只存本机：换设备要重新输入串（这正是设计意图——
   串就是跨设备的钥匙，不是账号）。 */
export const SYNC_KEY = 'web2.sync'

/* 后端网关（CloudBase HTTP 访问服务）。这不是机密：它只是一个公开可访问的地址，
   真正拦人的是同步串。写死了才能在没有 .env 的真机里也跑起来（P8 同一取舍）。 */
export const SYNC_GATEWAY = 'https://vibecoding-test-d5fqmhbb955e19dd-1499011319.ap-shanghai.app.tcloudbase.com'

/* 同步的六把键。**这是一份白名单**：将来新增本机键，默认不同步，
   要同步必须显式加进这里并想清楚「换设备后它还有意义吗」。 */
export const SYNC_KEYS = [
  'web2.data', // 导入的整份课表导出文本（学期 + schedules + todos 的载体）
  'web2.added', // 手动加的课程（叠加层）
  'web2.courseOv', // 课程编辑/删除覆盖层
  'web2.todos', // 待办新增/编辑/删除覆盖层
  'web2.events', // 独立日程覆盖层
  'web2.dayOverrides', // 调休/放假（跨设备看到同一份"这周怎么上"）
]

/* 同步文档的形状版本：云端 doc 自带的 version。将来改形状靠它分流，
   老客户端读到新版本时至少能认出"这不是我认识的形状"。 */
export const SYNC_DOC_VERSION = 1

/* 串下限与后端一致（MIN_PASS=6）：前端先挡一道，用户不用等一个来回才知道串太短。 */
export const SYNC_MIN_PASS = 6

/* 一份数据的上限，与后端 sync/index.js 的 MAX_DOC_CHARS 同值（90,000）。
   这个数不是拍的：CloudBase 网关对 HTTP 访问服务的请求体有硬上限，实测
   body 100,081 B 能进、120,081 B 被网关挡在函数外（413 EXCEED_MAX_PAYLOAD_SIZE）。
   在前端拦一道，用户看到的是「课表太大，录音请留在本机」这种人话，
   而不是网关那句英文报文。 */
export const SYNC_MAX_DOC_CHARS = 90000

/* ---------- 本机配置（串 + 上次同步版本） ---------- */
export function loadSyncConfig() {
  try {
    const o = JSON.parse(localStorage.getItem(SYNC_KEY) || '')
    return {
      pass: typeof o.pass === 'string' ? o.pass : '',
      rev: Number.isFinite(Number(o.rev)) ? Math.max(0, Math.floor(Number(o.rev))) : 0,
      at: typeof o.at === 'string' ? o.at : '',
      uid: typeof o.uid === 'string' ? o.uid : '', // 服务端回的身份前 8 位，用于界面显示
    }
  } catch {
    return { pass: '', rev: 0, at: '', uid: '' }
  }
}

export function saveSyncConfig(patch) {
  const next = { ...loadSyncConfig(), ...patch }
  localStorage.setItem(SYNC_KEY, JSON.stringify(next))
  return next
}

/* 只清「上次同步版本」，保留串 —— 换了自己的同步串后版本号会张冠李戴 */
export function resetSyncRev() {
  return saveSyncConfig({ rev: 0, at: '', uid: '' })
}

/* ---------- 本机这一小撮键 → 一整份文档 ---------- */
export function collectLocalDoc(now = new Date()) {
  const keys = {}
  for (const k of SYNC_KEYS) {
    const raw = localStorage.getItem(k)
    if (raw === null || raw === '') continue
    /* 存**原文**而不是解析后的对象：这些键里有的存的就是 JSON 文本（web2.data），
       解析再序列化会丢掉「原样回写主项目」这条链路上的格式（换行/字段顺序）。
       原文本身已经是合法 JSON 文本，塞进 doc 里照样是一层 JSON。 */
    keys[k] = raw
  }
  return {
    version: SYNC_DOC_VERSION,
    app: 'sched',
    exported_at: now.toISOString(),
    keys,
  }
}

/* 本地有没有可传的东西（界面上区分「还没导入过数据」和「导入过但没同步过」） */
export function localDocSummary() {
  const doc = collectLocalDoc()
  const n = Object.keys(doc.keys).length
  let courses = 0
  let todos = 0
  try {
    const raw = doc.keys['web2.data']
    if (raw) {
      const d = JSON.parse(raw)
      const arr = Array.isArray(d.schedules) ? d.schedules : []
      courses = arr.filter((s) => s && s.type === 'course').length
      todos = (Array.isArray(d.todos) ? d.todos : []).length
    }
  } catch {
    /* 坏数据只影响"几条"的显示，不影响同步本身（原文照传） */
  }
  return { keys: n, courses, todos }
}

/* 整份下载的文档 → 本机。**替换语义**：文档里没有的键会被删掉。
   「下载 = 用云端那份覆盖本机」是用户在冲突提示里主动选的，含糊地合并两层
   反而会留下"本机有、云端没有"的鬼数据（下次上传又带回去，两份永远不一致）。 */
export function applyLocalDoc(doc) {
  if (!doc || typeof doc !== 'object' || !doc.keys || typeof doc.keys !== 'object') {
    throw new Error('云端那份数据格式不对（缺少 keys）：可能不是本应用同步上去的，已放弃，未改动本机数据。')
  }
  const incoming = doc.keys
  for (const k of SYNC_KEYS) {
    const v = incoming[k]
    // 只认白名单里的键：云端被塞了别人的键也写不进本机
    if (v === undefined || v === null || v === '') localStorage.removeItem(k)
    else localStorage.setItem(k, String(v))
  }
  return Object.keys(incoming).filter((k) => SYNC_KEYS.indexOf(k) >= 0).length
}

/* ---------- 一个请求 ---------- */
async function callSync({ method = 'POST', pass, body, signal }) {
  const url = SYNC_GATEWAY + '/api/sync' + (method === 'GET' ? '?pass=' + encodeURIComponent(pass) : '')
  let res
  try {
    res = await fetch(url, {
      method,
      headers: method === 'GET'
        ? { Accept: 'application/json' }
        : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify({ pass, ...body }),
      signal,
    })
  } catch (e) {
    if (e && e.name === 'AbortError') throw e
    throw new Error('连不上同步服务：检查一下网络。本机数据没有动。')
  }
  let data = null
  const text = await res.text().catch(() => '')
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error('同步服务返回了看不懂的内容（HTTP ' + res.status + '）。稍后重试。')
    }
  }
  if (!res.ok) {
    /* 服务端的错误文案本身就是人话（errors.js 收口），直接透传；
       409 是冲突，调用方要拿 rev 做判断，所以整包丢出去。 */
    /* 413 是**网关**拦的，报文是英文的 EXCEED_MAX_PAYLOAD_SIZE，不是我们函数写的。
       同一个上限前端已经先挡了一道（SYNC_MAX_DOC_CHARS），走到这里只可能是估算偏差，
       所以在这里翻译成人话，别把腾讯云那句英文甩给用户。 */
    if (res.status === 413) {
      const e413 = new Error('这一份数据超过了同步接口的大小上限：同步只带课表和待办，录音音频这类大件请留在本机。')
      e413.status = 413
      e413.kind = 'input'
      throw e413
    }
    const msg = (data && data.message) || ('同步服务出错（HTTP ' + res.status + '）')
    const err = new Error(msg)
    err.status = res.status
    err.kind = (data && data.kind) || 'server'
    err.cloudRev = data && data.cloudRev
    err.cloudUpdatedAt = data && data.cloudUpdatedAt
    throw err
  }
  return data || {}
}

/* ---------- 三个动作 ---------- */

/* 上传整份。opts.force = 用户已经选过「覆盖云端」。
   返回 {rev, at, uid}；冲突时抛的 err.status === 409（带 cloudRev）。 */
export async function syncUpload({ pass, force = false, signal } = {}) {
  const cfg = loadSyncConfig()
  const p = String(pass === undefined ? cfg.pass : pass)
  if (p.length < SYNC_MIN_PASS) throw new Error(`同步串至少 ${SYNC_MIN_PASS} 个字符。`)
  const doc = collectLocalDoc()
  const n = Object.keys(doc.keys).length
  if (!n) throw new Error('本机还没有可同步的数据：先导入课表或加几条待办。')
  const size = JSON.stringify(doc).length
  if (size > SYNC_MAX_DOC_CHARS) {
    throw new Error(
      `这一份太大（${Math.round(size / 1024)} KB，上限约 ${Math.round(SYNC_MAX_DOC_CHARS / 1024)} KB）：`
      + '同步只带课表和待办，录音音频这类大件请留在本机。'
    )
  }
  const data = await callSync({
    method: 'POST',
    pass: p,
    body: { doc, baseRev: force ? -1 : cfg.rev, force },
    signal,
  })
  /* baseRev=-1 + force：服务端只看 force；不用 -1 走冲突分支，只是不给旧 rev 添乱 */
  const next = saveSyncConfig({
    pass: p,
    rev: Number(data.rev) || 0,
    at: new Date().toISOString(),
    uid: data.uid || cfg.uid,
  })
  return { rev: next.rev, at: next.at, uid: next.uid, keys: n }
}

/* 下载整份并写进本机。返回 {found, rev, applied}。
   found=false（云端还没有这一份）不是错误：新设备第一次就是这样。 */
export async function syncDownload({ pass, signal } = {}) {
  const cfg = loadSyncConfig()
  const p = String(pass === undefined ? cfg.pass : pass)
  if (p.length < SYNC_MIN_PASS) throw new Error(`同步串至少 ${SYNC_MIN_PASS} 个字符。`)
  const data = await callSync({ method: 'GET', pass: p, signal })
  if (!data.found) {
    saveSyncConfig({ pass: p, rev: 0, at: '', uid: data.uid || '' })
    return { found: false, rev: 0, applied: 0 }
  }
  const applied = applyLocalDoc(data.doc)
  const next = saveSyncConfig({ pass: p, rev: Number(data.rev) || 0, at: new Date().toISOString(), uid: data.uid || cfg.uid })
  return { found: true, rev: next.rev, applied, at: data.updated_at || '' }
}

/* 清空云端那一份（本机数据不动）。删前界面必须让用户确认过。 */
export async function syncClearCloud({ pass, signal } = {}) {
  const cfg = loadSyncConfig()
  const p = String(pass === undefined ? cfg.pass : pass)
  if (p.length < SYNC_MIN_PASS) throw new Error(`同步串至少 ${SYNC_MIN_PASS} 个字符。`)
  const data = await callSync({ method: 'DELETE', pass: p, signal })
  saveSyncConfig({ pass: p, rev: 0, at: '', uid: data.uid || cfg.uid })
  return { deleted: !!data.deleted }
}
