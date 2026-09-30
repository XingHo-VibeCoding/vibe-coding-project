/* seg 专项金标准（2026-09-30）：引导页学期表现带显式 seg（固定三块修复的副作用），
   验证「web2 导出（periods 带 seg）→ 主项目 store.js importAll」不受影响。
   跑法：node tmp/seg-crosscheck.mjs（web2 目录下） */
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}
globalThis.window = globalThis

const { createRequire } = await import('node:module')
const require = createRequire(import.meta.url)
require('D:/Document/Project/vibe-coding-project/js/store.js')

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log('PASS  ' + name) }
  else { fail++; console.log('FAIL  ' + name) }
}

t('0. 主项目 Store 挂到 global', typeof Store === 'object' && typeof Store.importAll === 'function')

/* 与引导页 goObForm 修复后完全一致的 periods 形状（带显式 seg） */
const periods = [
  { no: 1, start: '08:00', end: '08:45', seg: 1 },
  { no: 2, start: '08:55', end: '09:40', seg: 1 },
  { no: 3, start: '09:50', end: '10:35', seg: 1 },
  { no: 4, start: '10:45', end: '11:30', seg: 1 },
  { no: 5, start: '11:40', end: '12:25', seg: 1 },
  { no: 6, start: '14:00', end: '14:45', seg: 2 },
  { no: 7, start: '14:55', end: '15:40', seg: 2 },
  { no: 8, start: '15:50', end: '16:35', seg: 2 },
  { no: 9, start: '16:45', end: '17:30', seg: 2 },
  { no: 10, start: '17:40', end: '18:25', seg: 2 },
  { no: 11, start: '19:00', end: '19:45', seg: 3 },
  { no: 12, start: '19:55', end: '20:40', seg: 3 },
  { no: 13, start: '20:50', end: '21:35', seg: 3 },
]
const doc = {
  app: 'sched',
  schema_version: 1,
  exported_at: new Date().toISOString(),
  semester: { name: '2026-2027 秋冬', first_monday: '2026-09-07', total_weeks: 18, periods },
  schedules: [],
  todos: [],
  meta: {},
}
const r = Store.importAll(JSON.stringify(doc))
t('1. 主项目 importAll 放行带 seg 的 periods', r.ok === true)
const loaded = Store.load()
t('2. 学期正常读回', loaded.semester && loaded.semester.name === '2026-2027 秋冬')
t('3. periods 完整读回（13 节）', Array.isArray(loaded.semester.periods) && loaded.semester.periods.length === 13)

console.log(`\n结果：${pass} 过，${fail} 挂`)
process.exit(fail ? 1 : 0)
