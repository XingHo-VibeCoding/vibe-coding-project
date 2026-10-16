/* 全量归档（一键导出 / 从归档恢复）—— 保命功能，不是同步。
   为什么要有：本机数据全在 localStorage 里（27 个键），而清缓存、换浏览器、
   重装系统都会把它清掉。原来唯一的出口 `exportImportedText()`（store.js:1075）
   只带三个键（主数据 + 录音 + 习惯），练耳进度 / 复盘记录 / 每日快照 / 使用时长 /
   打卡 / 调休覆盖全都不在文件里 —— 丢了就是真丢了。

   口径三条（都跟着项目既有规矩走）：
   1. **纯逻辑，不碰 DOM** —— 只负责把归档拼成字符串、把字符串解析回对象，
      下载与选文件留给界面（同 eduImport.js 的纪律，Node 可直接单测）。
   2. **机密绝不进归档**：web2.llm（API Key）、web2.eduAccount（统一身份认证账号）、
      web2.sync（同步串 = 能读写你云端数据的那把钥匙）。这条不是「顺手少写几个键」，
      是这份文件会被拷来拷去、发到聊天窗口，进去就等于泄漏。
      另排除 web2.holidayCache（节假日缓存，联网就能重新抓，没必要占地方）。
   3. **恢复 = 真恢复（整份替换）**：归档里有的键覆盖本机，归档里没有的备份范围键清掉
      —— 否则「恢复到上周」会得到上周 + 这周的混合物。破坏性操作，界面必须二次确认，
      且本函数在写盘失败时会把改动整个回滚（见 applyArchive）。

   与云同步（sync.js）的分工：云同步传的是「课表 + 待办」六把键、要两台设备、要联网；
   归档是**本机 23 把键的完整快照**、一个文件、离线可用。两者不重叠、不互相替代。 */

export const ARCHIVE_FORMAT = 'web2-archive'
export const ARCHIVE_VERSION = 1

/* 备份范围：本机 27 个键里除下面 4 个之外的全部。
   label 给界面看，group 只用于分组展示，两个都不参与逻辑。 */
export const ARCHIVE_INCLUDE = [
  { k: 'web2.data', label: '课表与待办原始数据', group: '课程' },
  { k: 'web2.added', label: '手动加的课程', group: '课程' },
  { k: 'web2.courseOv', label: '课程编辑与删除', group: '课程' },
  { k: 'web2.eduSnapshot', label: '上一套课表（可恢复）', group: '课程' },
  { k: 'web2.dayOverrides', label: '调休与特殊日期', group: '课程' },
  { k: 'web2.exams', label: '考试安排', group: '课程' },
  { k: 'web2.exam.set', label: '考前提醒设置', group: '课程' },
  { k: 'web2.todos', label: '待办增删改', group: '待办与日程' },
  { k: 'web2.events', label: '独立日程', group: '待办与日程' },
  { k: 'web2.habits', label: '打卡习惯与记录', group: '坚持' },
  { k: 'web2.listen', label: '碎片练耳素材', group: '坚持' },
  { k: 'web2.listen.set', label: '练耳设置', group: '坚持' },
  { k: 'web2.review', label: '日精进复盘记录', group: '复盘' },
  { k: 'web2.review.set', label: '复盘设置', group: '复盘' },
  { k: 'web2.reasons', label: '日精进理由库', group: '复盘' },
  { k: 'web2.daily', label: '每日快照（120 天）', group: '复盘' },
  { k: 'web2.usage', label: '手机使用时长', group: '复盘' },
  { k: 'web2.lectures', label: '课堂录音与纪要', group: '录音' },
  { k: 'web2.frame', label: '通知栏状态框', group: '录音' },
  { k: 'web2.frame.marks', label: '状态框标记', group: '录音' },
  { k: 'web2.notify', label: '提醒设置', group: '外观与设置' },
  { k: 'web2.theme', label: '深浅色', group: '外观与设置' },
  { k: 'web2.theme.auto', label: '跟随系统', group: '外观与设置' },
  { k: 'web2.accent', label: '主题色', group: '外观与设置' },
  { k: 'web2.onboarded', label: '新手引导已完成', group: '外观与设置' },
]

/* 不进归档的键与理由（界面上要如实列出来，不能只说「已排除机密」）。 */
export const ARCHIVE_EXCLUDE = [
  { k: 'web2.llm', why: '里面是 API Key' },
  { k: 'web2.eduAccount', why: '统一身份认证账号' },
  { k: 'web2.sync', why: '同步串（能读写你云端数据）' },
  { k: 'web2.holidayCache', why: '节假日缓存，联网会自己重新抓' },
]

const INCLUDE_SET = new Set(ARCHIVE_INCLUDE.map((x) => x.k))
const EXCLUDE_SET = new Set(ARCHIVE_EXCLUDE.map((x) => x.k))

/* 本机键的读取封装：Node 单测里挂 globalThis.localStorage 桩即可跑。 */
function ls() {
  return globalThis.localStorage
}

export function isBackupKey(k) {
  return INCLUDE_SET.has(k)
}
export function isExcludedKey(k) {
  return EXCLUDE_SET.has(k)
}

/* 本机现在有多少键有内容 —— 界面上先给个数，用户才知道「导出的到底是什么」。 */
export function localArchiveSummary() {
  const keys = []
  for (const it of ARCHIVE_INCLUDE) {
    const raw = ls().getItem(it.k)
    if (raw != null && raw !== '') keys.push({ ...it, bytes: raw.length })
  }
  return {
    keys: keys.length,
    total: ARCHIVE_INCLUDE.length,
    bytes: keys.reduce((n, x) => n + x.bytes, 0),
    list: keys,
  }
}

/* 生成归档对象。now 可注入，方便单测断言时间戳。
   返回 { ok, archive?, error? }；一个键都没有时也允许导出（空归档照样是有效文件），
   但要如实报 empty=true，界面好提示「这台设备还没有数据」。 */
export function buildArchive(now = new Date()) {
  const data = {}
  const items = []
  for (const it of ARCHIVE_INCLUDE) {
    const raw = ls().getItem(it.k)
    if (raw == null || raw === '') continue
    data[it.k] = String(raw)
    items.push({ k: it.k, label: it.label, bytes: String(raw).length })
  }
  const archive = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exported_at: now.toISOString(),
    app_version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '',
    keys: items.length,
    data,
  }
  return {
    ok: true,
    archive,
    empty: items.length === 0,
    keys: items.length,
    items,
  }
}

/* 归档 → 文本（缩进 2 空格，方便用户自己打开看；也便于出问题时人肉比对） */
export function archiveToText(archive) {
  return JSON.stringify(archive, null, 2)
}

/* 解析归档文本。**只认本格式**：主项目导出的 JSON 不是归档，不能被这里悄悄收下。
   返回 { ok, error? } 或 { ok, archive, preview } —— preview 给恢复前的确认面板用。 */
export function readArchive(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: '文件是空的。' }
  let doc
  try {
    doc = JSON.parse(text)
  } catch {
    return { ok: false, error: '这不是一个 JSON 文件（内容读不出来）。' }
  }
  if (!doc || typeof doc !== 'object') return { ok: false, error: '文件内容不是归档格式。' }
  if (doc.format !== ARCHIVE_FORMAT) {
    return {
      ok: false,
      error:
        doc.app === 'sched'
          ? '这是主项目导出的课表文件，不是本机的全量归档：请用「导入主项目数据」。'
          : '这个文件不是本机归档（缺少格式标记），不能用来恢复。',
    }
  }
  if (Number(doc.version) > ARCHIVE_VERSION) {
    return { ok: false, error: `归档版本比这个 App 新（v${doc.version}），请先更新 App 再恢复。` }
  }
  if (!doc.data || typeof doc.data !== 'object') return { ok: false, error: '归档里没有数据段。' }

  /* 只取白名单内的键，且值必须是字符串 —— 归档文件是可以被手改的，
     不能让一个伪造的键名往 localStorage 里写东西。 */
  const clean = {}
  const items = []
  const ignored = []
  for (const k of Object.keys(doc.data)) {
    if (!INCLUDE_SET.has(k)) {
      ignored.push({ k, why: EXCLUDE_SET.has(k) ? '属于排除项（机密或缓存）' : '不在备份范围内' })
      continue
    }
    const v = doc.data[k]
    if (typeof v !== 'string') {
      ignored.push({ k, why: '值不是文本' })
      continue
    }
    clean[k] = v
    items.push({ k, label: (ARCHIVE_INCLUDE.find((x) => x.k === k) || {}).label || k, bytes: v.length })
  }
  const archive = { ...doc, data: clean }
  return {
    ok: true,
    archive,
    ignored,
    preview: {
      exportedAt: typeof doc.exported_at === 'string' ? doc.exported_at : '',
      appVersion: typeof doc.app_version === 'string' ? doc.app_version : '',
      keys: items.length,
      bytes: items.reduce((n, x) => n + x.bytes, 0),
      items,
      ignored,
    },
  }
}

/* 恢复前先算一遍「会发生什么」：要覆盖几项、要清空几项、本机有几项归档里没有。
   界面上把这三个数摆出来，比一句「将覆盖本机数据」诚实得多。 */
export function planRestore(archive) {
  const clean = (archive && archive.data) || {}
  const overwrite = []
  const same = []
  for (const it of ARCHIVE_INCLUDE) {
    if (!(it.k in clean)) continue
    const cur = ls().getItem(it.k)
    if (cur == null || cur === '') overwrite.push({ k: it.k, label: it.label })
    else if (cur === clean[it.k]) same.push({ k: it.k, label: it.label })
    else overwrite.push({ k: it.k, label: it.label, replace: true })
  }
  const clear = []
  for (const it of ARCHIVE_INCLUDE) {
    if (it.k in clean) continue
    const cur = ls().getItem(it.k)
    if (cur != null && cur !== '') clear.push({ k: it.k, label: it.label })
  }
  return { overwrite, same, clear, write: overwrite.length, remove: clear.length }
}

/* 落地恢复：**整份替换**，并且要么全成、要么全不动。
   先取本机现值当回滚点，逐键写；任何一步抛错（最可能是 localStorage 写满）
   就把已改的键还原回去，再返回错误 —— 半份恢复比不恢复更坏。 */
export function applyArchive(archive) {
  if (!archive || !archive.data || typeof archive.data !== 'object') {
    return { ok: false, error: '归档内容无效。' }
  }
  const plan = planRestore(archive)
  const rollback = []
  for (const it of ARCHIVE_INCLUDE) rollback.push({ k: it.k, v: ls().getItem(it.k) })
  const undo = () => {
    for (const r of rollback) {
      try {
        if (r.v == null) ls().removeItem(r.k)
        else ls().setItem(r.k, r.v)
      } catch {
        /* 回滚途中再失败只能放弃：已经尽力，下面照常报错 */
      }
    }
  }
  try {
    for (const it of ARCHIVE_INCLUDE) {
      if (it.k in archive.data) ls().setItem(it.k, String(archive.data[it.k]))
      else ls().removeItem(it.k)
    }
  } catch (e) {
    undo()
    const full = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)
    return {
      ok: false,
      error: full ? '本机存储空间不够，已把改动全部还原（数据没动）。' : '恢复中途出错，已把改动全部还原：' + String((e && e.message) || e),
      rolledBack: true,
    }
  }
  return { ok: true, written: plan.write, removed: plan.remove }
}

/* 自检用：确认归档文本里没有夹带任何机密值。
   单测会往 web2.llm / web2.eduAccount / web2.sync 里塞哨兵串，然后断言它们不在文本里。 */
export function archiveLeaksSecrets(text) {
  const leaks = []
  for (const ex of ARCHIVE_EXCLUDE) {
    const v = ls().getItem(ex.k)
    if (v == null || v === '') continue
    /* 值可能是 JSON（如 web2.sync = {"pass":"..."}），把里面的长串也逐个拿出来比 */
    const parts = [v]
    try {
      const o = JSON.parse(v)
      if (o && typeof o === 'object') {
        for (const kk of Object.keys(o)) if (typeof o[kk] === 'string' && o[kk].length >= 4) parts.push(o[kk])
      }
    } catch {
      /* 不是 JSON 就只比原文 */
    }
    for (const p of parts) if (p.length >= 4 && text.includes(p)) leaks.push({ k: ex.k, sample: p.slice(0, 4) + '…' })
  }
  return leaks
}
