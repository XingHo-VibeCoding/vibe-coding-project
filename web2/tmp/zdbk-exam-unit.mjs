/* 06 教务网考试 —— 纯逻辑单测（node 直跑，不联网、不需要浏览器）
   用法：node tmp/zdbk-exam-unit.mjs
   数据取自 2026-10-19 真机实测返回的 65 条记录（这里留了各类形态的代表行）。 */
import { parseExamTime, rowsToExams, mergeExams, isSyncedId, examQueryUrlOf, EXAM_QUERY_URL, EXAM_ID_PREFIX,
  autoSyncDecision, autoSyncExams, loadExamSyncAt, EXAM_SYNC_GAP_MS } from '../src/data/zdbkExam.js'

let ok = 0, bad = 0
const fails = []
function t(name, cond, extra) {
  if (cond) { ok++; console.log('  PASS ' + name + (extra !== undefined ? '  → ' + extra : '')) }
  else { bad++; fails.push(name); console.log('  FAIL ' + name + '  → ' + extra) }
}
function eq(name, got, want) {
  t(name, JSON.stringify(got) === JSON.stringify(want), 'got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))
}

const TODAY = '2026-10-19'

/* 真实记录的代表行（字段与线上一致；只留用得到的） */
const row = (o) => Object.assign({ kcmc: '', kssj: '', jsmc: '', zwxh: '', xf: '3.0', xkkh: '', xxq: '2026-2027-1', xm: '某某' }, o)
const ITEMS = [
  /* 6 场未来考试：考场全空 = 还没排（真实情况） */
  row({ kcmc: '习近平新时代中国特色社会主义思想概论', kssj: '2027年01月06日(14:00-16:00)', xkkh: '(2026-2027-1)-031E0011-01' }),
  row({ kcmc: '结构力学Ⅰ', kssj: '2027年01月07日(10:30-12:30)', xkkh: '(2026-2027-1)-031E0012-02' }),
  row({ kcmc: '工程水文学', kssj: '2027年01月12日(08:00-10:00)', xkkh: '(2026-2027-1)-031E0013-03' }),
  /* 已经考过的（2025 冬）→ 必须过滤 */
  row({ kcmc: '大学物理', kssj: '2025年01月04日(10:30-12:30)', jsmc: '东1-101', zwxh: '38', xkkh: '(2024-2025-1)-011E0001-01' }),
  /* 没有 kssj 也没有 qzkssj = 这门课没有考试 → 整行跳过 */
  row({ kcmc: '工程训练', xkkh: '(2026-2027-1)-031E0099-09' }),
  /* 一条记录同时有期中 + 期末 = 两场考试 */
  row({ kcmc: '概率论与数理统计', qzkssj: '2026年11月20日(14:00-16:00)', qzjsmc: '西2-205', qzzwxh: '12', kssj: '2027年01月09日(08:00-10:00)', xkkh: '(2026-2027-1)-031E0020-05' }),
  /* 「冬考试第 2 天」= 只有钟点、没有日期 → 进 undated，不冒充考试 */
  row({ kcmc: '军事理论', kssj: '冬考试第2天(10:30-12:30)', xkkh: '(2026-2027-1)-031E0030-07' }),
]

console.log('\n--- A 时间解析：两种真实格式都要认得 ---')
eq('A1 标准格式拆出日期/起/止', parseExamTime('2027年01月06日(14:00-16:00)'), { date: '2027-01-06', start: '14:00', end: '16:00' })
eq('A2 一位数月日补零', parseExamTime('2027年1月6日(9:05-11:05)'), { date: '2027-01-06', start: '09:05', end: '11:05' })
eq('A3 冬考试第N天：有钟点没日期', parseExamTime('冬考试第2天(10:30-12:30)'), { date: '', start: '10:30', end: '12:30' })
eq('A4 只有日期没钟点', parseExamTime('2027年01月06日'), { date: '2027-01-06', start: '', end: '' })
eq('A5 空串 = 没有这场考试', parseExamTime(''), null)
eq('A6 undefined / null 也当没有', [parseExamTime(undefined), parseExamTime(null)], [null, null])
eq('A7 无关文本算没有', parseExamTime('待定'), null)

console.log('\n--- B 记录 → 考试 ---')
const parsed = rowsToExams(ITEMS, { today: TODAY })
eq('B1 未来考试 5 场（3 场期末 + 概率论的期中 1 + 期末 1）', parsed.exams.length, 5)
eq('B2 已考过的不入档', parsed.exams.some((e) => e.date === '2025-01-04'), false)
eq('B3 没有 kssj 的课整行跳过（不能当成「待定考试」）', parsed.exams.some((e) => e.title === '工程训练'), false)
eq('B4 一条记录拆成期中 + 期末两条', parsed.exams.filter((e) => e.title.indexOf('概率论') === 0).map((e) => e.title), ['概率论与数理统计（期中）', '概率论与数理统计'])
eq('B5 「冬考试第N天」进 undated，不进 exams', [parsed.undated.length, parsed.undated[0].title], [1, '军事理论'])
eq('B6 undated 保留原文，界面能照原样说', parsed.undated[0].raw, '冬考试第2天(10:30-12:30)')
eq('B7 按日期升序', parsed.exams.map((e) => e.date), ['2026-11-20', '2027-01-06', '2027-01-07', '2027-01-09', '2027-01-12'])
const first = parsed.exams[0]
eq('B8 考场没排时 place 是空串（界面负责说「考场待公布」）', first.place, '西2-205')
eq('B9 有座位号就写进 note', first.note, '座位 12')
eq('B10 座位号为空时不写 note（不留「座位 」这种半句）', parsed.exams[1].note, '')
eq('B11 id 带同步前缀，按 xkkh 认而不是按标题', [isSyncedId(first.id), first.id], [true, EXAM_ID_PREFIX + '(2026-2027-1)-031E0020-05_mid'])
t('B12 两条不同课但同名日期不会互相吞（id 各自唯一）', new Set(parsed.exams.map((e) => e.id)).size === parsed.exams.length)
eq('B13 total 数的是原始行数（用户能核对）', parsed.total, ITEMS.length)

console.log('\n--- C 与手填考试合并：手填优先，且可反复同步 ---')
const manual = [
  { id: 'ex_a', title: '结构力学Ⅰ', date: '2027-01-07', start: '10:30', end: '12:30', place: '自己问到的 教4-201', note: '', created_at: 1 },
  { id: 'ex_b', title: '驾照科目一', date: '2026-12-01', start: '', end: '', place: '', note: '', created_at: 2 },
]
const m1 = mergeExams(manual, parsed.exams)
eq('C1 手填的两条都还在', m1.list.filter((e) => !isSyncedId(e.id)).length, 2)
eq('C2 同一天同课程的同步记录被手填的顶掉', m1.dropped.length, 1)
t('C3 顶掉之后不重复（列表里同一天只有一条结构力学）',
  m1.list.filter((e) => e.date === '2027-01-07').length === 1)
eq('C4 手填的考场不会被同步的空考场覆盖', m1.list.filter((e) => e.date === '2027-01-07')[0].place, '自己问到的 教4-201')
const m2 = mergeExams(m1.list, parsed.exams)
eq('C5 再同步一次总数不变（不累积）', m2.list.length, m1.list.length)
eq('C6 再同步仍然只有一份同步记录', m2.list.filter((e) => isSyncedId(e.id)).length, m1.list.filter((e) => isSyncedId(e.id)).length)
eq('C7 手工加进 ks_ 前缀的记录会被当成旧同步记录换掉', mergeExams([{ id: 'ks_x_final', title: '旧', date: '2030-01-01' }], []).list.length, 0)
eq('C8 空列表也不会崩', mergeExams(undefined, undefined).list, [])

console.log('\n--- D 地址拼装 ---')
eq('D1 学号进 su，gnmkdm 是 N509070', examQueryUrlOf('3210100001').indexOf('gnmkdm=N509070&su=3210100001') > 0, true)
eq('D2 doType=query 必须在', examQueryUrlOf('1').indexOf('doType=query') > 0, true)
eq('D3 学号做转义（不给它拼出怪 URL 的机会）', examQueryUrlOf('a b&c').indexOf('su=a%20b%26c') > 0, true)
eq('D4 地址指向考试查询而不是课表', EXAM_QUERY_URL.indexOf('/xskscx/') > 0, true)

console.log('\n--- E 自动导入的开关：什么时候该跑、什么时候绝对不能跑 ---')
/* 这一组守的是「别把用户账号搞锁了」：没密码不跑、24 小时内不重复跑。 */
eq('E1 节流窗口是 24 小时', EXAM_SYNC_GAP_MS, 24 * 60 * 60 * 1000)
eq('E2 不是 App 内（浏览器跨域）→ 不跑', autoSyncDecision({ hasPassword: true, native: false, lastAt: 0, now: 1 }), { run: false, reason: 'no-native' })
eq('E3 密钥库里没密码 → 不跑', autoSyncDecision({ hasPassword: false, native: true, lastAt: 0, now: 1 }), { run: false, reason: 'no-password' })
eq('E4 从没同步过 → 该跑', autoSyncDecision({ hasPassword: true, native: true, lastAt: 0, now: 1000 }), { run: true, reason: 'due' })
eq('E5 一小时前刚试过 → 不跑', autoSyncDecision({ hasPassword: true, native: true, lastAt: 1000, now: 1000 + 3600 * 1000 }), { run: false, reason: 'too-soon' })
eq('E6 差 1 毫秒到 24 小时 → 还不跑', autoSyncDecision({ hasPassword: true, native: true, lastAt: 0 + 1, now: 1 + EXAM_SYNC_GAP_MS - 1 }), { run: false, reason: 'too-soon' })
eq('E7 正好满 24 小时 → 该跑', autoSyncDecision({ hasPassword: true, native: true, lastAt: 1, now: 1 + EXAM_SYNC_GAP_MS }), { run: true, reason: 'due' })
eq('E8 没密码优先于「该跑」报出来（先说不跑的原因）', autoSyncDecision({ hasPassword: false, native: true, lastAt: 0, now: 9e12 }).reason, 'no-password')
eq('E9 全空入参也不崩', autoSyncDecision({}).run, false)

/* autoSyncExams 在非原生环境必须「安静地什么都不做」——不能抛、不能写时间戳 */
const nodeRun = await autoSyncExams()
eq('E10 node 里（非原生）自动同步直接跳过', { ok: nodeRun.ok, skipped: nodeRun.skipped, reason: nodeRun.reason }, { ok: false, skipped: true, reason: 'no-native' })
eq('E11 跳过时不会写同步时间戳', loadExamSyncAt(), 0)

console.log('\n===== ' + ok + ' PASS / ' + bad + ' FAIL =====')
if (bad) { console.log('失败项：' + fails.join('、')); process.exit(1) }
