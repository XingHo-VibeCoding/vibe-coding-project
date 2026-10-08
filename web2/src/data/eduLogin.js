/* P12b 教务直连（浙大统一身份认证 + 方正 zdbk 课表接口）
 *
 * 定位：**纯逻辑 + 网络**，不碰 DOM（但会读写 localStorage 存账号与上次同步时间）。
 *       输出的课程结构与 P12a 的 `eduImport.parseEduXlsx()` **完全同形**，
 *       所以「预览核对 → 二次确认 → 只换课程 → 快照可恢复」那整套直接复用，一行不用重写。
 *
 * 调研依据（用的是**公开项目记录的接口事实**，代码自己写，不搬它们的代码 ——
 * 它们多是 LGPL/GPL，本项目没必要背那个包袱）：
 *   · `zju-ical-py` 的 `zjuam/ugrs.py`：登录三步（取 execution → 取 RSA 公钥 → POST 加密密码）
 *   · `zju-scholar` 的 `references/api_endpoints.md`：zdbk 课表接口字段与学期码
 *
 * 三条自律（写死在代码里，不是口号）：
 *   ① **不做自动重试**：学校的登录页会「输错太多次锁号」，错了就停下来让用户看清原因；
 *   ② **只手动触发**：不轮询、不定时后台抓；
 *   ③ **密码只在手机 ↔ 学校之间走**：RSA 加密后 POST，不经任何第三方服务器。 */

export const EDU_ACCOUNT_KEY = 'web2.eduAccount'
/* 钟点换算与节次解析都复用 listen.js 的那两个（和 eduImport.js 一个口径，别各写一份） */
import { hhmm, minOf } from './listen.js'
import { secureStoreAvailable, secretGet, secretSet, secretRemove } from './secureStore.js'

const CAS_LOGIN = 'https://zjuam.zju.edu.cn/cas/login'
/* service 就是「登录成功后要回到哪儿」：教务网的 SSO 入口 */
export const EDU_SERVICE = 'https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html'
export const EDU_LOGIN_PAGE = CAS_LOGIN + '?service=' + encodeURIComponent(EDU_SERVICE)
export const EDU_PUBKEY_URL = 'https://zjuam.zju.edu.cn/cas/v2/getPubKey'
export const EDU_KB_URL = 'https://zdbk.zju.edu.cn/jwglxt/kbcx/xskbcx_cxXsKb.html'
/* 功能模块代码：本科生课表查询（浏览器地址栏里那个 gnmkdm） */
export const EDU_GNMKDM = 'N253508'

/* 学期码（调研得来）：3=秋冬 / 12=春夏 / 16=短学期 */
export const TERM_CODES = { 秋冬: '3', 春夏: '12', 短: '16' }

/* 一个「大学期」底下有哪些「小学期」文本（真机确认 2026-10-06）：
   教务返回的「学期」字段是**文本**，用户看到的形态是「老师 · 春夏学期」「春学期」「夏学期」，
   即取值形如 秋 / 冬 / 秋冬 / 春 / 夏 / 春夏 / 短。
   ⚠️ 为什么必须本地再筛一遍：**服务器会把整年的都返回**（我们请的是秋冬，它给整年），
   看板那个「学期」下拉很可能是**网页自己在前端筛**的。所以这里照它做一遍，别信服务器。
   匹配用「包含」：'秋冬' 含 '秋'/'冬'，所以一个 group 里列出的片段能覆盖合并写法。 */
export const TERM_GROUPS = {
  3: { label: '秋冬', parts: ['秋', '冬'] },
  12: { label: '春夏', parts: ['春', '夏'] },
  16: { label: '短学期', parts: ['短', '暑期'] },
}

/* 请求码 → `xkkh` 里的学期序号。
   **真机实测（2026-10-06）**：接口请求里的 `xqm` 用 3/12/16，而 `xkkh` 里写的是序号 1/2/3 ——
   实测 `(2025-2026-2)` 的行 `xxq` 全是「春夏」，`(…-1)` 的全是「秋冬」，故：1=秋冬 2=春夏 3=短。
   （短学期这次样本里没出现，按 3 处理；真遇到再校。） */
export const TERM_ORDINAL = { 3: '1', 12: '2', 16: '3' }

/** 从选课课号 `xkkh` 里读学年与学期：`(2026-2027-1)-CCEA1234M-0001` → { y1:'2026', ord:'1' } */
export function parseXkkhTerm(xkkh) {
  const m = String(xkkh == null ? '' : xkkh).match(/^\((\d{4})-(\d{4})-(\d+)\)/)
  return m ? { y1: m[1], ord: m[3] } : null
}

/** 按当前日期推一个默认学年/学期（教务的秋冬学期 9 月开、春夏 2 月开） */
export function defaultTerm(now = new Date()) {
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  /* 9–12 月与 1 月算秋季学年（1 月归属上一个学年的秋冬），2–8 月算春夏 */
  if (m >= 9) return { xnm: String(y), xqm: TERM_CODES.秋冬, label: `${y}-${y + 1} 秋冬` }
  if (m === 1) return { xnm: String(y - 1), xqm: TERM_CODES.秋冬, label: `${y - 1}-${y} 秋冬` }
  return { xnm: String(y - 1), xqm: TERM_CODES.春夏, label: `${y - 1}-${y} 春夏` }
}

/* ---------------- 账号存档 ----------------
   用户拍板「①乙」：密码存本机、自动登录。
   2026-10-08 升级（用户拍板做 P12b 后续）：**密码不再写进 localStorage**，改走系统密钥库。
     · App（有 SecureStore 插件）→ 密码走 AndroidKeyStore 的 AES-GCM，私钥永不出系统；
        localStorage 只留「非机密」：学号、记住开关、上次选的学年/学期。
     · 浏览器（无插件）→ 如实退回老办法（整份存 localStorage），保证开发/测试能用；
       调用方可以用 `eduSecretBackend()` 知道当前是哪一种，界面上也可以如实说明。
   老数据（密码还在 localStorage 里）**读的时候自动搬家**：见 loadEduAccountAsync 的迁移段。 */
export const EDU_SECRET_KEY = 'eduPassword'

/* 当前密码存在哪：'keystore'（系统密钥库）/ 'local'（退回 localStorage） */
export function eduSecretBackend() {
  return secureStoreAvailable() ? 'keystore' : 'local'
}

export function sanitizeAccount(a) {
  const o = a && typeof a === 'object' ? a : {}
  return {
    username: String(o.username || '').trim(),
    password: String(o.password || ''),
    remember: !!o.remember,
    xnm: String(o.xnm || ''),
    xqm: String(o.xqm || ''),
  }
}
export function loadEduAccount() {
  try {
    const raw = localStorage.getItem(EDU_ACCOUNT_KEY)
    return sanitizeAccount(raw ? JSON.parse(raw) : null)
  } catch {
    return sanitizeAccount(null)
  }
}
export function saveEduAccount(a) {
  const clean = sanitizeAccount(a)
  try {
    localStorage.setItem(EDU_ACCOUNT_KEY, JSON.stringify(clean))
  } catch {
    /* 存不下也不抛：下次让用户重输 */
  }
  return clean
}
export function clearEduAccount() {
  try {
    localStorage.removeItem(EDU_ACCOUNT_KEY)
  } catch {
    /* 忽略 */
  }
}

/* 只写「非机密」那一份进 localStorage（**不含 password**）。
   存不下也不抛 —— 与 saveEduAccount 一个口径。 */
function writePublicPart(clean) {
  try {
    localStorage.setItem(EDU_ACCOUNT_KEY, JSON.stringify({
      username: clean.username,
      remember: clean.remember,
      xnm: clean.xnm,
      xqm: clean.xqm,
    }))
  } catch {
    /* 忽略 */
  }
}

/* 异步读：App 里会把密码从密钥库补上，并且**顺手把老数据搬进密钥库**。
   返回 { username, password, remember, xnm, xqm, secretError? }
     · secretError 非空 = 密文解不开（换设备/清过数据）→ 界面应提示「请重新输一次密码」，
       而不是当作「没记住」；password 这时是空串。 */
export async function loadEduAccountAsync() {
  const acc = loadEduAccount()
  if (!secureStoreAvailable()) return acc /* 浏览器：如实走老路 */
  const r = await secretGet(EDU_SECRET_KEY)
  if (!r.ok) {
    return { ...acc, password: '', secretError: r.error || '密码读不出来' }
  }
  if (!r.missing && r.value) {
    /* 密钥库里已经有了。老 localStorage 里若还留着 password（升级前存的），清掉不留副本。 */
    if (acc.password) writePublicPart(acc)
    return { ...acc, password: r.value }
  }
  /* 密钥库还没有：若老数据里有密码（升级前的存档），搬进去并从 localStorage 抹掉。 */
  if (acc.password) {
    const w = await secretSet(EDU_SECRET_KEY, acc.password)
    if (w.ok) writePublicPart(acc)
    return acc
  }
  return acc
}

/* 异步写：机密与「非机密」分开落盘。返回 { ok, clean, secretError? }
   · 存密码失败（密钥库不可用/写入报错）时 **不写 localStorage 的那份**，
     并把原因回给调用方 —— 绝不静默降级成「明文存下来但界面说存好了」。
   · password 为空 = 用户没勾「记住」：要把密钥库里旧的那份**删掉**，
     否则「这次没记」之后还能自动登录，等于「记住」开关失效。 */
export async function saveEduAccountAsync(a) {
  const clean = sanitizeAccount(a)
  if (!secureStoreAvailable()) {
    saveEduAccount(clean) /* 浏览器：老办法 */
    return { ok: true, clean }
  }
  if (clean.password) {
    const w = await secretSet(EDU_SECRET_KEY, clean.password)
    if (!w.ok) return { ok: false, clean, secretError: w.error || '密码没能存进系统密钥库' }
  } else {
    const r = await secretRemove(EDU_SECRET_KEY)
    if (!r.ok) return { ok: false, clean, secretError: r.error || '旧密码没能从系统密钥库删掉' }
  }
  writePublicPart(clean)
  return { ok: true, clean }
}

/* 清空：两处都要清（只清一处会留下「学号没了但密码还在」这种半截状态）。 */
export async function clearEduAccountAsync() {
  clearEduAccount()
  if (!secureStoreAvailable()) return { ok: true }
  const r = await secretRemove(EDU_SECRET_KEY)
  return { ok: r.ok, error: r.error }
}

/* ---------------- RSA：把密码加密（无填充，照学校网页的做法） ----------------
   学校给的公钥是 {modulus, exponent}（十六进制），网页把密码当一个大整数做模幂：
       cipher = pow(int(password_bytes), exponent, modulus)
   再补零成固定长度的十六进制串。
   **为什么用 BigInt 而不是 crypto.subtle**：浏览器原生的 RSA 只支持 OAEP 填充，
   而这里要的是**无填充的裸 RSA**；BigInt 几十行就够，且不引任何第三方加密库。
   注意：这不是"自己发明加密"——是把学校网页自己做的事照样做一遍，安全性由 HTTPS 保证。 */
export function rsaEncrypt(password, modulusHex, exponentHex) {
  const N = BigInt('0x' + String(modulusHex || ''))
  const E = BigInt('0x' + String(exponentHex || ''))
  if (N <= 0n || E <= 0n) throw new Error('公钥不合法')
  const bytes = new TextEncoder().encode(String(password == null ? '' : password))
  if (!bytes.length) throw new Error('密码是空的')
  /* 字节 → 大整数（大端） */
  let m = 0n
  for (const b of bytes) m = (m << 8n) | BigInt(b)
  if (m >= N) throw new Error('密码太长，公钥装不下')
  /* 模幂：平方-乘 */
  let r = 1n
  let base = m % N
  let e = E
  while (e > 0n) {
    if (e & 1n) r = (r * base) % N
    base = (base * base) % N
    e >>= 1n
  }
  const hex = r.toString(16)
  return hex.padStart(N.toString(16).length, '0')
}

/* ---------------- HTTP 一层 ----------------
   两条路，同一个调用面：
     · App 内：Capacitor 的 `CapacitorHttp`（走手机原生网络，**不受浏览器跨域限制**）
     · 浏览器/测试：普通 fetch（会被 CORS 挡，所以只能用来跑断言）
   Cookie 不自己管：两种实现的底层都会带 Cookie（原生客户端有 cookie jar，
   浏览器 fetch 用 credentials:'include'），所以登录后的通行证会自动带上。 */
function nativeHttp() {
  const c = typeof window !== 'undefined' ? window.Capacitor : null
  const p = c && c.Plugins ? c.Plugins.CapacitorHttp : null
  return p && typeof p.post === 'function' ? p : null
}
export function eduHttpAvailable() {
  return !!nativeHttp()
}

async function httpRequest({ method = 'GET', url, headers, body, timeoutMs = 20000 }) {
  const h = { ...(headers || {}) }
  const svc = nativeHttp()
  if (svc) {
    const opts = { url, method, headers: h, connectTimeout: timeoutMs, readTimeout: timeoutMs }
    if (body !== undefined) opts.data = typeof body === 'string' ? body : JSON.stringify(body)
    const r = method === 'POST' ? await svc.post(opts) : await svc.get(opts)
    const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data == null ? '' : r.data)
    return { status: r.status || 0, text, url: r.url || url }
  }
  const res = await fetch(url, {
    method,
    headers: h,
    body,
    credentials: 'include',
    redirect: 'follow',
  })
  return { status: res.status, text: await res.text(), url: res.url || url }
}

/* 表单体：教务这套接口吃 application/x-www-form-urlencoded */
function formBody(obj) {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(obj || {})) usp.append(k, v == null ? '' : String(v))
  return usp.toString()
}
const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' }

/* ---------------- 登录 + 拉课表 ---------------- */

/** 从 CAS 登录页 HTML 里抠出隐藏字段 execution（防伪令牌） */
export function pickExecution(html) {
  const m = String(html || '').match(/name="execution"\s+value="([^"]+)"/) || String(html || '').match(/"execution"\s+value="([^"]+)"/)
  return m ? m[1] : ''
}

/** 课表接口的完整地址（带功能模块代码与学号，跟浏览器地址栏一致） */
export function kbUrlOf(username) {
  return `${EDU_KB_URL}?gnmkdm=${EDU_GNMKDM}&su=${encodeURIComponent(String(username || ''))}`
}

/**
 * 登录并抓课表。返回 { ok, courses, term, error, stage }。
 * onStage(stage) 用来让界面显示「正在做什么」（get_token / get_key / login / sso / kb）。
 */
export async function loginAndFetchKb({ username, password, xnm, xqm, onStage } = {}) {
  const say = (s) => {
    if (typeof onStage === 'function') onStage(s)
  }
  const u = String(username || '').trim()
  const p = String(password == null ? '' : password)
  if (!u || !p) return { ok: false, error: '账号或密码是空的。', stage: 'input' }
  try {
    /* ① 拿令牌 */
    say('get_token')
    const page = await httpRequest({ url: EDU_LOGIN_PAGE })
    if (page.status !== 200) return { ok: false, error: `登录页打不开（HTTP ${page.status}），可能是网络不通。`, stage: 'get_token' }
    const execution = pickExecution(page.text)
    if (!execution) return { ok: false, error: '登录页结构变了（没找到防伪令牌），这套接口可能已被学校改版。', stage: 'get_token' }

    /* ② 拿公钥并加密密码 */
    say('get_key')
    const keyRes = await httpRequest({ url: EDU_PUBKEY_URL })
    let pub
    try {
      pub = JSON.parse(keyRes.text)
    } catch {
      return { ok: false, error: '取公钥失败（返回的不是 JSON）。', stage: 'get_key' }
    }
    if (!pub || !pub.modulus || !pub.exponent) return { ok: false, error: '公钥字段不对，接口可能已改版。', stage: 'get_key' }
    const cipher = rsaEncrypt(p, pub.modulus, pub.exponent)

    /* ③ 提交登录 */
    say('login')
    const loginRes = await httpRequest({
      method: 'POST',
      url: CAS_LOGIN,
      headers: FORM_HEADERS,
      body: formBody({ username: u, password: cipher, authcode: '', execution, _eventId: 'submit' }),
    })
    const t = loginRes.text || ''
    if (t.indexOf('用户名或密码错误') >= 0) return { ok: false, error: '用户名或密码不对（学校说：输错太多次会锁账号，所以我不自动重试）。', stage: 'login' }
    if (t.indexOf('账号被锁定') >= 0) return { ok: false, error: '账号已被锁定，请过一会儿再试。', stage: 'login' }
    if (t.indexOf('execution') >= 0 && t.indexOf('login') >= 0) {
      /* 还停在登录页（令牌过期 / 用户名密码被拒但文案不同） */
      if (loginRes.url && loginRes.url.indexOf('zjuam.zju.edu.cn') >= 0) {
        return { ok: false, error: '登录没通过（还停在统一身份认证页）——请检查账号密码，或稍后重试。', stage: 'login' }
      }
    }

    /* ④ 换成教务网的会话 */
    say('sso')
    const sso = await httpRequest({ url: EDU_SERVICE })
    if (sso.status >= 400) return { ok: false, error: `进教务网失败（HTTP ${sso.status}）。`, stage: 'sso' }

    /* ⑤ 拉课表 */
    say('kb')
    const kb = await httpRequest({
      method: 'POST',
      url: kbUrlOf(u),
      headers: FORM_HEADERS,
      body: formBody({ xnm: String(xnm || ''), xqm: String(xqm || '') }),
    })
    let json = null
    try {
      json = JSON.parse(kb.text)
    } catch {
      /* 返回 HTML 通常意味着**没登录上**（被弹回登录页） */
      const looksLogin = /统一身份认证|login_ssologin|j_username|cas\/login/i.test(kb.text || '')
      return {
        ok: false,
        error: looksLogin ? '课表没拿到：会话没建立（被弹回登录页），登录这一步没真正成功。' : '课表接口返回的不是 JSON，接口可能已改版。',
        stage: 'kb',
      }
    }
    const list = json && Array.isArray(json.kbList) ? json.kbList : null
    if (!list) return { ok: false, error: '课表返回里没有 kbList 字段，接口可能已改版。', stage: 'kb' }
    return { ok: true, list, term: { xnm: String(xnm || ''), xqm: String(xqm || '') }, stage: 'done' }
  } catch (e) {
    return { ok: false, error: '请求失败：' + ((e && e.message) || '未知原因'), stage: 'error' }
  }
}

/* ---------------- kbList → 课程（与 eduImport 同形） ----------------
   原始记录字段（调研得来）：
     xkkh 选课课号（取前 22 位当 id，celecron 也这么做）
     xqj  星期几（1–7）
     dsz  单双周：'0'=单周 / '1'=双周 / 其它=每周
     kcb  用 <br> 分隔的「课程名 / 时间 / 教师 / 地点」（尾上可能带 zwf 标记，要剥掉）
     xxq  小学期**文本**（真机确认：秋 / 冬 / 秋冬 / 春 / 夏 / 春夏 / 短 —— 界面上显示成「…学期」）
     djj  从第几节开始；skcd 一共几节
   ⚠️ 这个接口**只给单双周**，不给「1-8 周」这种任意区间 —— 我们模型里 weeks 照样能装，
   所以单双周就展开成显式周次集合（和 xlsx 导入的口径一致）。 */
export function parseKcbCell(kcb) {
  const raw = String(kcb == null ? '' : kcb)
  const parts = raw.split('zwf')[0].split(/<br\s*\/?>/i)
  const clean = (s) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
  return {
    name: clean(parts[0] || '').replace(/\(/g, '（').replace(/\)/g, '）'),
    timeText: clean(parts[1] || ''),
    teacher: clean(parts[2] || ''),
    place: clean(parts[3] || ''),
  }
}

/** kbList → [{...与 parseEduXlsx 同形的课程}]，另附 skipped（节次表里没有的节号等，可看到不静默丢） */
export function translateKbList(kbList, { periods = [], totalWeeks = 16, codeOf } = {}) {
  const byNo = new Map()
  for (const p of Array.isArray(periods) ? periods : []) {
    const no = Number(p && p.no)
    if (Number.isFinite(no)) byNo.set(no, p)
  }
  const courses = []
  const skipped = []
  const weeksOf = (dsz) => {
    const d = String(dsz == null ? '' : dsz).trim()
    if (d === '0') {
      const w = []
      for (let i = 1; i <= totalWeeks; i += 2) w.push(i)
      return { weeks: w, rule: 'odd' }
    }
    if (d === '1') {
      const w = []
      for (let i = 2; i <= totalWeeks; i += 2) w.push(i)
      return { weeks: w, rule: 'even' }
    }
    return { weeks: null, rule: 'every' }
  }
  for (const raw of Array.isArray(kbList) ? kbList : []) {
    if (!raw) continue
    const weekday = Number(raw.xqj)
    const startSec = Number(raw.djj)
    const lenSec = Number(raw.skcd)
    const info = parseKcbCell(raw.kcb)
    if (!weekday || !info.name || !(startSec >= 1) || !(lenSec >= 1)) continue
    const secs = []
    for (let i = 0; i < lenSec; i++) secs.push(startSec + i)
    /* 节次表换算钟点；缺的节号如实记下来，不猜 */
    const missing = []
    let s = null
    let e = null
    for (const n of secs) {
      const p = byNo.get(n)
      if (!p) {
        missing.push(n)
        continue
      }
      const ps = minOf(p.start)
      const pe = minOf(p.end)
      if (ps >= 0 && (s === null || ps < s)) s = ps
      if (pe >= 0 && (e === null || pe > e)) e = pe
    }
    if (s === null || e === null || e <= s) {
      skipped.push({ name: info.name, weekday, secs, reason: '节次表里没有第 ' + missing.join('、') + ' 节' })
      continue
    }
    const wk = weeksOf(raw.dsz)
    /* 学年/学期**只能从 xkkh 里读**：接口返回的行没有 xnm/xqm 字段（实测都是空），
       而它会把**好几个学期混在一起**返回来（实测一次 56 行 = 2026-2027-1 的 14 行
       + 2025-2026-1 的 18 行 + 2025-2026-2 的 24 行）。所以「哪个学期的课」靠 xkkh 前缀判断。 */
    const tk = parseXkkhTerm(raw.xkkh)
    courses.push({
      id: codeOf ? codeOf(raw, secs) : 'edu_' + String(raw.xkkh || '').slice(0, 22) + '_' + weekday + '_' + hhmm(s).replace(':', ''),
      type: 'course',
      source: 'edu',
      weekday,
      name: info.name,
      place: info.place,
      teacher: info.teacher,
      code: String(raw.xkkh || '').slice(0, 22),
      term: String(raw.xxq || ''),
      xnm: tk ? tk.y1 : '',
      xqm: tk ? tk.ord : '',
      start: hhmm(s),
      end: hhmm(e),
      secs,
      weeks: wk.weeks,
      week_rule: wk.rule,
      week_note: wk.weeks ? wk.weeks.join(',') : info.timeText,
    })
  }
  /* 同一门课同一时段可能被教务拆成多条（比如不同周次）—— 按「星期+起止+课名+周次」去重，
     口径与 xlsx 那侧一致 */
  const seen = new Set()
  const uniq = []
  let dupRows = 0
  for (const c of courses) {
    const key = [c.weekday, c.start, c.end, c.name, (c.weeks || []).join('/')].join('|')
    if (seen.has(key)) {
      dupRows++
      continue
    }
    seen.add(key)
    uniq.push(c)
  }
  return { courses: uniq, skipped, dupRows }
}

/**
 * 按「学年 + 学期」筛一遍 —— **这步绝不能省**。
 *
 * 为什么：实测（2026-10-06 真机）教务这个接口**完全不认**请求里的 xqm（用 3 / 1 / 2 / 12
 * 各问一次，四次返回的行数、分布一模一样，都是 56 行），而且它是**好几个学期混在一起**返回的：
 *   2026-2027-1（本学年秋冬）14 行 / 2025-2026-1（去年秋冬）18 行 / 2025-2026-2（去年春夏）24 行。
 * 更阴的是光看 `xxq`（小学期文本）分不开：**去年秋冬和今年秋冬都是「秋冬/冬/秋」** ——
 * 只按文本筛会混进去年同期的课（2026-10-06 就是这么翻车的）。
 * 唯一可靠的判据是选课课号 `xkkh` 的前缀 `(2026-2027-1)` ⇒ 学年 + 学期序号。
 *
 * @param courses  translateKbList 的输出
 * @param term     { xnm: '2026', xqm: '3' } —— xnm 是学年，xqm 是**请求码**（3/12/16）
 * 返回 { courses, dropped, counts, unknown, label }：
 *   · counts —— 服务器返回里各学期各多少条（用来如实说"到底拿回来些什么、去掉了什么"）
 *   · 学年或学期序号读不出来的行 → 默认**留下**（"读不出"不等于"不是这个学期"），计入 unknown
 */
export function filterByTerm(courses, term, { keepUnknown = true } = {}) {
  const list = Array.isArray(courses) ? courses : []
  const wantYear = String((term && term.xnm) || '')
  const wantOrd = TERM_ORDINAL[String((term && term.xqm) == null ? '' : (term && term.xqm))]
  if (!wantYear || !wantOrd) return { courses: list, dropped: [], counts: {}, unknown: 0, label: null }
  const labelOf = (c) => (c && c.xnm && c.xqm ? c.xnm + '-' + c.xqm : '')
  const kept = []
  const dropped = []
  const counts = {}
  let unknown = 0
  for (const c of list) {
    const lb = labelOf(c)
    if (!lb) {
      unknown++
      if (keepUnknown) kept.push(c)
      else dropped.push(c)
      continue
    }
    counts[lb] = (counts[lb] || 0) + 1
    if (String(c.xnm) === wantYear && String(c.xqm) === wantOrd) kept.push(c)
    else dropped.push(c)
  }
  return { courses: kept, dropped, counts, unknown, label: wantYear + '-' + wantOrd }
}
