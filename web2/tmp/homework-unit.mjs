/* 五条新功能线 02：录音纪要 → 待办 —— due_hint 解析与 homework 形状纯函数单测。
   node 直跑：global.window=global + localStorage 桩（同 habit-unit / planner-unit 口径）。 */
global.window = global
global.window.Capacitor = undefined
const _d = {}
global.localStorage = {
  getItem(k) { return k in _d ? _d[k] : null },
  setItem(k, v) { _d[k] = String(v) },
  removeItem(k) { delete _d[k] },
}

const { parseDueHint, hwList, dueSourceText } = await import('file:///D:/Document/Project/vibe-coding-project/web2/src/data/homework.js')
const { sanitizeSummary } = await import('file:///D:/Document/Project/vibe-coding-project/web2/src/data/store.js')

let pass = 0, fail = 0
const t = (name, ok, extra) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (ok || extra === undefined ? '' : ' → ' + JSON.stringify(extra)))
  ok ? pass++ : fail++
}

const DAY = '2026-10-16' // 周五（已核对：2026-10-16 是星期五）
const at = (hint, today = DAY) => parseDueHint(hint, today)

/* ===== A 说死了日期 ===== */
t('A1 完整年月日 YYYY-MM-DD', at('2026-10-20 交').due === '2026-10-20' && at('2026-10-20 交').kind === 'exact')
t('A2 斜杠与中文写法', at('2026/10/20').due === '2026-10-20' && at('2026年10月20日').due === '2026-10-20')
t('A3 只说月日 → 今年还没过就用今年', at('10月20日交').due === '2026-10-20')
t('A4 月日已过 → 顺延到明年', at('10月1日前').due === '2027-10-01', at('10月1日前'))
t('A5 纯数字 10/20', at('10/20').due === '2026-10-20')
t('A6 今天 / 明天 / 后天 / 大后天', [at('今天交').due, at('明天交').due, at('后天交').due, at('大后天交').due].join(',') === '2026-10-16,2026-10-17,2026-10-18,2026-10-19')

/* ===== B 星期几 ===== */
t('B1 本周五（今天就是周五）→ 算今天', at('周五前交').due === '2026-10-16', at('周五前交'))
t('B2 下周三 → 本周之后的那个周三', at('下周三前').due === '2026-10-21', at('下周三前'))
t('B3 周三（本周已过）→ 顺延到下周三', at('周三前').due === '2026-10-21', at('周三前'))
t('B4 下下周一', at('下下周一交').due === '2026-10-26', at('下下周一交'))
t('B5 星期几写法也算 weekday 来源', at('下周三').kind === 'weekday')
t('B6 只说「下周」→ 下周一', at('下周交').due === '2026-10-19', at('下周交'))

/* ===== C 读不出来就说读不出来（不猜） ===== */
const none = ['', '下次上课前', '期末考试前', '本月底', '交作业前', '看通知', null, undefined]
t('C1 含糊说法一律 none', none.every((h) => at(h).due === null && at(h).kind === 'none'), none.map((h) => [h, at(h).due]))
t('C2 「第 1-5 题」不被读成日期', at('习题 5.1 第 1-5 题').due === null, at('习题 5.1 第 1-5 题'))
t('C3 「10-20 页」不被读成日期', at('看书 10-20 页').due === null, at('看书 10-20 页'))
t('C4 非法日期 2 月 30 日 → none', at('2026-02-30').due === null, at('2026-02-30'))
t('C5 today 非法时仍不崩', at('明天', 'not-a-date').due === null || /^\d{4}-\d{2}-\d{2}$/.test(at('明天', 'not-a-date').due))

/* ===== D hwList 兼容旧纪要 ===== */
t('D1 新形状 {text,due_hint}', hwList({ homework: [{ text: '写高数作业', due_hint: '下周三' }] })[0].due_hint === '下周三')
t('D2 旧形状字符串照读（due_hint 空）', JSON.stringify(hwList({ homework: ['课本 120 页习题 3.4'] })) === JSON.stringify([{ text: '课本 120 页习题 3.4', due_hint: '' }]), hwList({ homework: ['课本 120 页习题 3.4'] }))
t('D3 两种形状混在一份纪要里都能读', hwList({ homework: ['旧条目', { text: '新条目', due_hint: '明天' }] }).length === 2)
t('D4 空条目剔除', hwList({ homework: ['', '  ', null, { text: '' }] }).length === 0)
t('D5 非数组 / 缺字段不崩', hwList({}).length === 0 && hwList(null).length === 0 && hwList({ homework: '不是数组' }).length === 0)
t('D6 对象缺 text 时剔除，不当成空标题待办', hwList({ homework: [{ due_hint: '明天' }] }).length === 0)

/* ===== E sanitizeSummary 白名单要收新形状 ===== */
const cleanNew = sanitizeSummary({ overview: '总览', homework: [{ text: '写高数作业', due_hint: '下周三' }] })
t('E1 白名单保留 {text,due_hint}', cleanNew.homework.length === 1 && cleanNew.homework[0].text === '写高数作业' && cleanNew.homework[0].due_hint === '下周三', cleanNew.homework)
const cleanOld = sanitizeSummary({ overview: '总览', homework: ['课本 120 页习题 3.4'] })
t('E2 旧字符串纪要仍能读（不被静默丢掉）', cleanOld.homework.length === 1 && cleanOld.homework[0].text === '课本 120 页习题 3.4' && cleanOld.homework[0].due_hint === '', cleanOld.homework)
t('E3 坏条目剔除', sanitizeSummary({ overview: '总览', homework: ['', null, { }, { text: '好的', due_hint: ' 明天 ' }] }).homework.length === 1)
t('E4 due_hint 非字符串收敛成空串', sanitizeSummary({ overview: '总览', homework: [{ text: 'x', due_hint: { a: 1 } }] }).homework[0].due_hint === '')
t('E5 缺 homework 字段 → 空数组（不是 undefined）', Array.isArray(sanitizeSummary({ overview: '总览' }).homework) && sanitizeSummary({ overview: '总览' }).homework.length === 0)

/* ===== F 来源说明措辞（不评判） ===== */
t('F1 老师说了 → 课堂提到', dueSourceText(true) === '课堂提到')
t('F2 没说 → 按下次上课日估的', dueSourceText(false) === '按下次上课日估的')
const banned = ['加油', '努力', '赶紧', '必须', '懒', '拖延', '你应该', '你怎么']
t('F3 来源文案不含催促/评判词', banned.every((w) => dueSourceText(true).indexOf(w) === -1 && dueSourceText(false).indexOf(w) === -1))

console.log(`\n=== 纪要作业截止日解析：${pass}/${pass + fail} 通过 ===`)
if (fail) console.log('失败项：' + fail)
process.exit(fail ? 1 : 0)
