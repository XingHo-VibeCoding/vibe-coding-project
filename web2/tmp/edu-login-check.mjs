/* P12b 教务直连检查（A 段纯逻辑，不需要网络 / 不需要真账号）
   验的是「能在这台机器上验的那部分」：
     · RSA 加密是否与 Python 参考实现**逐位一致**（拿 python 算的向量对；无关填充，比大整数）
     · 防伪令牌抽取、课表地址拼装（用**占位学号**，不写真实学号）
     · kbList → 课程 的翻译：单双周/节次→钟点/缺节号不静默丢/去重
     · 账号存档的口径（存什么、清什么、脏数据怎么净化）
     · 默认学年学期推算
   网络那半（真的登录 + 真的抓课表）只能到真机上验，这里**不假装**。

   跑法：node tmp/edu-login-check.mjs
   注：本文件不读网络、不写用户的浏览器数据。 */

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

const L = await import('../src/data/eduLogin.js')

/* ---------- A1–A4 RSA：与 Python 参考实现对齐 ----------
   向量由 python 生成：
     N = 0xf3a1…a1f8（126 位十六进制，512 位左右）
     E = 0x10001
     'test1234' / 'abc' 的 pow(int.from_bytes(pw), E, N) 结果 */
const N_HEX = 'f3a1c47b19e5d6082b4f7a1c9e3d5b8f02a6c4e1093d7b5f8a2c6e4d1b7f3095a4c8e6d2b0f9a7c5e3d1b8f6a4c2e0d9b7f5a3c1e8d6b4f2a0c9e7d5b3a1f8'
const E_HEX = '10001'
const VEC = [
  ['test1234', 'ecea5e5c2f1ba5acafc74cbc1d3c376b0bd60c800ee8e43345c47de2123029871706925af32aa2ea2e8c275e64898c580a1a3461b5ebfa628dc2b38b535da8'],
  ['abc', '942eb1621cfe86c71f45cefb98cb4ab772938bd7658bfb2bba35dbfa006fb11f5cd6ef532537ac66525785ccc0a01acf43b5833e199c124093da71864323f3'],
]
for (const [pw, expected] of VEC) {
  const got = L.rsaEncrypt(pw, N_HEX, E_HEX)
  t(`A1. RSA「${pw}」与 Python 参考实现一致`, BigInt('0x' + got) === BigInt('0x' + expected), got.slice(0, 24) + '…')
}
t('A2. 输出长度 = 模数十六进制长度（这就是线上要的那个定长串）',
  L.rsaEncrypt('test1234', N_HEX, E_HEX).length === N_HEX.length, String(L.rsaEncrypt('test1234', N_HEX, E_HEX).length) + ' vs ' + N_HEX.length)
t('A3. 空密码 / 空公钥 / 超长密码 都要报错（不静默返回半截）',
  (() => {
    let a = false
    let b = false
    let c = false
    try { L.rsaEncrypt('', N_HEX, E_HEX) } catch { a = true }
    try { L.rsaEncrypt('x', '', '') } catch { b = true }
    try { L.rsaEncrypt('x'.repeat(200), N_HEX, E_HEX) } catch { c = true }
    return a && b && c
  })())
t('A4. 同样的输入两次结果相同（纯函数，不带随机）',
  L.rsaEncrypt('test1234', N_HEX, E_HEX) === L.rsaEncrypt('test1234', N_HEX, E_HEX))

/* ---------- A5 令牌抽取：两种写法都认 ---------- */
t('A5. 抠 execution：`name="execution" value="…"` 与 `"execution" value="…"` 都认',
  L.pickExecution('<input type="hidden" name="execution" value="e1s1" />') === 'e1s1'
  && L.pickExecution('{"execution" value="e2s2"}') === 'e2s2'
  && L.pickExecution('<html>什么都没</html>') === '')

/* ---------- A6 课表地址：带功能模块代码与学号（用占位符） ---------- */
{
  const url = L.kbUrlOf('0000000000')
  t('A6. 课表地址带 gnmkdm 与 su（学号只看占位符，代码里不写真实学号）',
    url.indexOf('gnmkdm=' + L.EDU_GNMKDM) > 0 && url.indexOf('su=0000000000') > 0 && url.indexOf('/kbcx/xskbcx_cxXsKb.html') > 0,
    url)
  t('A6b. 学期码与调研一致：秋冬=3 / 春夏=12 / 短=16',
    L.TERM_CODES.秋冬 === '3' && L.TERM_CODES.春夏 === '12' && L.TERM_CODES.短 === '16', JSON.stringify(L.TERM_CODES))
  const u = new URL(L.EDU_LOGIN_PAGE)
  t('A6c. 统一认证登录页带着 service=教务网 SSO 入口',
    u.searchParams.get('service') === L.EDU_SERVICE, u.searchParams.get('service'))
}

/* ---------- A7 默认学年学期推算 ---------- */
t('A7. 默认学期：9 月开学 → 当年秋冬；1 月 → 上一学年秋冬；3 月 → 上一学年春夏',
  L.defaultTerm(new Date('2026-09-07T00:00:00')).xnm === '2026' && L.defaultTerm(new Date('2026-09-07T00:00:00')).xqm === '3'
  && L.defaultTerm(new Date('2027-01-05T00:00:00')).xnm === '2026' && L.defaultTerm(new Date('2027-01-05T00:00:00')).xqm === '3'
  && L.defaultTerm(new Date('2027-03-01T00:00:00')).xnm === '2026' && L.defaultTerm(new Date('2027-03-01T00:00:00')).xqm === '12',
  JSON.stringify([L.defaultTerm(new Date('2026-09-07')), L.defaultTerm(new Date('2027-01-05')), L.defaultTerm(new Date('2027-03-01'))]))

/* ---------- A8 kcb 单元格解析 ---------- */
t('A8. kcb 用 <br> 分段、剥掉 zwf 尾巴、全角括号归一',
  (() => {
    const r = L.parseKcbCell('结构设计原理和方法Ⅰ(双语)<br>周二第6,7,8节<br>夏晋/冀晓华<br>紫金港北3-205zwf')
    return r.name === '结构设计原理和方法Ⅰ（双语）' && r.timeText === '周二第6,7,8节' && r.teacher === '夏晋/冀晓华' && r.place === '紫金港北3-205'
  })())
t('A8b. 地点为空时不崩（实践课常见）',
  L.parseKcbCell('测量实习<br>时间<br>汪孔政<br>').place === '')

/* ---------- A9–A13 翻译层 ---------- */
const periods = [
  { no: 1, start: '08:00', end: '08:45' }, { no: 2, start: '08:55', end: '09:40' },
  { no: 3, start: '09:50', end: '10:35' }, { no: 4, start: '10:45', end: '11:30' },
  { no: 6, start: '14:00', end: '14:45' }, { no: 7, start: '14:55', end: '15:40' },
  { no: 8, start: '15:50', end: '16:35' }, { no: 9, start: '16:45', end: '17:30' },
  { no: 10, start: '17:40', end: '18:25' },
]
const kb = [
  /* 每周、第6-8节（连续三节要合成 14:00–16:35）。xkkh 用**真机实测的真实格式**：
     `(2026-2027-1)-课号-序号` —— 学年和学期序号就藏在这个前缀里。 */
  { xkkh: '(2026-2027-1)-CCEA3757M-001', xqj: '2', dsz: '', kcb: '结构设计原理和方法Ⅰ<br>周二第6,7,8节<br>夏晋/冀晓华<br>紫金港北3-205', xxq: '秋冬', djj: '6', skcd: '3' },
  /* 单周、第9-10节 */
  { xkkh: '(2026-2027-1)-CCEA3757M-002', xqj: '3', dsz: '0', kcb: '结构设计原理和方法Ⅰ<br>周三第9,10节{单周}<br>夏晋/冀晓华<br>紫金港西4-120', xxq: '秋冬', djj: '9', skcd: '2' },
  /* 双周 */
  { xkkh: '(2026-2027-1)-X2', xqj: '5', dsz: '1', kcb: '工程信息化<br>周五第3,4节{双周}<br>舒江鹏<br>紫金港北3-110', xxq: '秋', djj: '3', skcd: '2' },
  /* 节次表里没有第 12 节 → 应进 skipped */
  { xkkh: '(2026-2027-1)-X3', xqj: '4', dsz: '', kcb: '神秘课<br>周四第12节<br>某老师<br>某地', xxq: '短', djj: '12', skcd: '1' },
  /* 与第 1 条完全重复 → 应被去重 */
  { xkkh: '(2026-2027-1)-CCEA3757M-001', xqj: '2', dsz: '', kcb: '结构设计原理和方法Ⅰ<br>周二第6,7,8节<br>夏晋/冀晓华<br>紫金港北3-205', xxq: '秋冬', djj: '6', skcd: '3' },
]
const tr = L.translateKbList(kb, { periods, totalWeeks: 16 })
t('A9. 翻译出 3 条（第 4 条缺节号进 skipped、第 5 条重复去掉）', tr.courses.length === 3 && tr.dupRows === 1, JSON.stringify({ n: tr.courses.length, dup: tr.dupRows }))
{
  const c = tr.courses.find((x) => x.weekday === 2)
  t('A10. 连续三节 6,7,8 → 14:00–16:35（用节次表换算，不是猜）',
    !!c && c.secs.join(',') === '6,7,8' && c.start === '14:00' && c.end === '16:35' && c.weeks === null && c.week_rule === 'every',
    JSON.stringify(c && { secs: c.secs, start: c.start, end: c.end, weeks: c.weeks, rule: c.week_rule }))
  t('A10b. 教师/地点/小学期都带上了', !!c && c.teacher === '夏晋/冀晓华' && c.place === '紫金港北3-205' && c.term === '秋冬')
}
{
  const c = tr.courses.find((x) => x.weekday === 3)
  t('A11. dsz=0 → 单周：周次展开成 1,3,5…15 且 week_rule=odd',
    !!c && JSON.stringify(c.weeks) === JSON.stringify([1, 3, 5, 7, 9, 11, 13, 15]) && c.week_rule === 'odd',
    JSON.stringify(c && { weeks: c.weeks, rule: c.week_rule }))
}
{
  const c = tr.courses.find((x) => x.weekday === 5)
  t('A11b. dsz=1 → 双周：2,4,6…16 且 week_rule=even',
    !!c && JSON.stringify(c.weeks) === JSON.stringify([2, 4, 6, 8, 10, 12, 14, 16]) && c.week_rule === 'even',
    JSON.stringify(c && { weeks: c.weeks, rule: c.week_rule }))
}
t('A12. 节次表里没有第 12 节 → 进 skipped 并说清原因，**不静默丢**',
  tr.skipped.length === 1 && tr.skipped[0].name === '神秘课' && /12/.test(tr.skipped[0].reason || ''),
  JSON.stringify(tr.skipped))
t('A13. 每条都有 id / type=course / source=edu（能直接喂给 P12a 的落库函数）',
  tr.courses.every((c) => c.id && c.type === 'course' && c.source === 'edu'))
t('A13b. 学年/学期从选课课号 xkkh 里读出来（接口不给 xnm/xqm 字段，只能这样）',
  tr.courses.every((c) => c.xnm === '2026' && c.xqm === '1'),
  JSON.stringify(tr.courses.map((c) => [c.name, c.xnm, c.xqm])))

/* ---------- A14 账号存档口径 ---------- */
{
  L.saveEduAccount({ username: '0000000000', password: 'pw-here', remember: true, 垃圾字段: 1, xnm: '2026', xqm: '3' })
  const a = L.loadEduAccount()
  t('A14. 存档只留四个已知字段（脏字段被净化掉）',
    a.username === '0000000000' && a.password === 'pw-here' && a.remember === true && a.xnm === '2026' && a.xqm === '3'
    && Object.keys(a).sort().join(',') === 'password,remember,username,xnm,xqm',
    JSON.stringify(Object.keys(a)))
  t('A14b. 不勾「记住」时 remember=false（密码仍存，但界面据此提示）', L.saveEduAccount({ username: 'u', password: 'p' }).remember === false)
  L.clearEduAccount()
  t('A14c. 清掉之后读回来是空账号（不是残留）', L.loadEduAccount().username === '' && L.loadEduAccount().password === '')
  localStorage.setItem(L.EDU_ACCOUNT_KEY, '{坏 JSON')
  t('A14d. 存档坏了也不抛（读回空账号）', L.loadEduAccount().username === '')
}

/* ---------- A15 环境探测：浏览器里没有原生 HTTP ---------- */
t('A15. 没有 Capacitor 时 eduHttpAvailable() 为 false（网页端如实报「不是 App」）', L.eduHttpAvailable() === false)

/* ---------- A16–A20 按「学年 + 学期」筛（真机实测后重写） ----------
   真机实测（2026-10-06，从 App 的 WebView 里读回原始返回）：
     · 接口**完全不认**请求里的 xqm：用 3 / 1 / 2 / 12 各问一次，返回行数与分布一模一样（56 行）
     · 它把好几个学期混在一起返回：2026-2027-1 的 14 行 + 2025-2026-1 的 18 行 + 2025-2026-2 的 24 行
     · 行里没有 xnm/xqm 字段；学年学期只藏在 xkkh 的前缀 `(2026-2027-1)` 里
     · **光按小学期文本（xxq）筛会翻车**：去年秋冬和今年秋冬都是「秋冬/冬/秋」 */
t('A21. 选课课号能读出学年+学期序号；读不出的返回 null',
  JSON.stringify(L.parseXkkhTerm('(2026-2027-1)-CCEA2710M-0093')) === JSON.stringify({ y1: '2026', ord: '1' })
  && JSON.stringify(L.parseXkkhTerm('(2025-2026-2)-CCEA2004F-0008')) === JSON.stringify({ y1: '2025', ord: '2' })
  && L.parseXkkhTerm('乱七八糟') === null
  && L.parseXkkhTerm('') === null)
t('A21b. 请求码 → 学期序号：秋冬 3→1 / 春夏 12→2 / 短 16→3',
  L.TERM_ORDINAL['3'] === '1' && L.TERM_ORDINAL['12'] === '2' && L.TERM_ORDINAL['16'] === '3',
  JSON.stringify(L.TERM_ORDINAL))
{
  /* 照真机那份数据的形状造：今年秋冬 2 条 + 去年秋冬 2 条 + 去年春夏 1 条 + 1 条读不出课号 */
  const mk = (xkkh, term, name) => ({ id: name + xkkh, type: 'course', source: 'edu', name, xkkh: undefined, term, weekday: 1, start: '08:00', end: '09:40', secs: [1, 2], xnm: (L.parseXkkhTerm(xkkh) || {}).y1 || '', xqm: (L.parseXkkhTerm(xkkh) || {}).ord || '' })
  const all = [
    mk('(2026-2027-1)-A', '秋冬', '今年A'),
    mk('(2026-2027-1)-B', '冬', '今年B'),
    mk('(2025-2026-1)-C', '秋冬', '去年秋冬C'),
    mk('(2025-2026-1)-D', '冬', '去年秋冬D'),
    mk('(2025-2026-2)-E', '春夏', '去年春夏E'),
    mk('认不出', '秋冬', '读不出F'),
  ]
  const r1 = L.filterByTerm(all, { xnm: '2026', xqm: '3' })
  /* 注意：`.sort()` 是按 UTF-16 码位排的，中文不是拼音序 —— 别用肉眼看顺序，逐项对。 */
  t('A22. **要今年秋冬：只留今年那 2 条**（去年秋冬虽然也写「秋冬」但要去掉）—— 这就是之前翻车的点',
    r1.courses.map((c) => c.name).sort().join(',') === ['今年A', '今年B', '读不出F'].sort().join(',')
    && r1.dropped.map((c) => c.name).sort().join(',') === ['去年春夏E', '去年秋冬C', '去年秋冬D'].sort().join(','),
    JSON.stringify([r1.courses.map((c) => c.name).sort(), r1.dropped.map((c) => c.name).sort()]))
  t('A22b. 如实报出「服务器返回里各学期各多少条」+ 读不出的条数',
    JSON.stringify(r1.counts) === JSON.stringify({ '2026-1': 2, '2025-1': 2, '2025-2': 1 }) && r1.unknown === 1 && r1.label === '2026-1',
    JSON.stringify(r1.counts) + ' unknown=' + r1.unknown + ' label=' + r1.label)
  t('A23. 要去年春夏 → 只留那 1 条（学年也参与筛选，不只是学期）',
    L.filterByTerm(all, { xnm: '2025', xqm: '12' }).courses.map((c) => c.name).sort().join('') === '去年春夏E读不出F',
    JSON.stringify(L.filterByTerm(all, { xnm: '2025', xqm: '12' }).courses.map((c) => c.name)))
  t('A24. **读不出学年的行默认留着**（"读不出"不等于"不是这个学期"），显式关掉才去掉',
    L.filterByTerm(all, { xnm: '2026', xqm: '3' }).courses.some((c) => c.name === '读不出F')
    && !L.filterByTerm(all, { xnm: '2026', xqm: '3' }, { keepUnknown: false }).courses.some((c) => c.name === '读不出F'),
    JSON.stringify(L.filterByTerm(all, { xnm: '2026', xqm: '3' }, { keepUnknown: false }).courses.map((c) => c.name)))
  t('A25. 学年或学期码缺了就不乱筛（原样返回，label=null）',
    (() => {
      const a = L.filterByTerm(all, { xnm: '', xqm: '3' })
      const b = L.filterByTerm(all, { xnm: '2026', xqm: '99' })
      return a.label === null && a.courses.length === all.length && b.label === null && b.courses.length === all.length
    })())
}

console.log(`\n教务直连检查：${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
