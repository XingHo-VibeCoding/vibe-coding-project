/* M2 第 2 步验证：lectures 数据层 + 导出合并 + 主项目 importAll 交叉检查
   跑法：node tmp/m2-lectures-test.mjs（web2 目录下） */
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}
globalThis.window = globalThis

const S = await import('../src/data/store.js')
let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log('PASS  ' + name) }
  else { fail++; console.log('FAIL  ' + name) }
}

/* 1. 空态 */
t('1.1 空态 loadLectures 返回 []', JSON.stringify(S.loadLectures()) === '[]')

/* 2. 新开录音：默认字段与状态机起点 */
const lec = S.addLecture({})
t('2.1 id 前缀 lec_', lec.id.startsWith('lec_'))
t('2.2 初始状态 recording', lec.status === 'recording')
t('2.3 started_at 为 ISO 时间', !Number.isNaN(Date.parse(lec.started_at)))
t('2.4 空标题回落「未命名录音」', lec.title === '未命名录音')
t('2.5 clip_count 初始 0', lec.clip_count === 0)

/* 3. 有标题 + 关联日程 */
const lec2 = S.addLecture({ title: '高数第三章', schedule_id: 'sch_abc' })
t('3.1 标题写入', lec2.title === '高数第三章')
t('3.2 schedule_id 写入', lec2.schedule_id === 'sch_abc')

/* 4. 状态机：只许前进 */
t('4.1 recording→transcribing 放行', S.updateLecture(lec.id, { status: 'transcribing' }).ok === true)
t('4.2 transcribing→summarized 放行', S.updateLecture(lec.id, { status: 'summarized' }).ok === true)
t('4.3 summarized→recording 倒退被拒', S.updateLecture(lec.id, { status: 'recording' }).ok === false)
t('4.4 未知状态被拒', S.updateLecture(lec.id, { status: 'paused' }).ok === false)

/* 5. clips 写入与 clip_count 自动同步 */
const r5 = S.updateLecture(lec2.id, {
  ended_at: new Date().toISOString(),
  duration_ms: 45 * 60 * 1000,
  clips: [
    { index: 1, path: 'file:///records/b.mp3', mime: 'audio/mp3', duration_ms: 300000, recorded_at: '2026-09-26T10:10:00Z' },
    { index: 0, path: 'file:///records/a.mp3', mime: 'audio/mp3', duration_ms: 600000, recorded_at: '2026-09-26T10:00:00Z' },
  ],
})
t('5.1 clips 更新成功', r5.ok === true)
t('5.2 clip_count 自动 = clips.length', r5.lecture.clip_count === 2)
t('5.3 clips 按 index 排序', r5.lecture.clips[0].index === 0)

/* 6. 坏数据防御：乱塞 localStorage 不炸、自动清掉 */
localStorage.setItem(S.LECTURES_KEY, '{不是json')
t('6.1 坏 JSON 回落 []', JSON.stringify(S.loadLectures()) === '[]')
localStorage.setItem(S.LECTURES_KEY, JSON.stringify([{ status: 'recording', id: '', started_at: '' }, null, { id: 'ok1', status: 'nope', started_at: 'x' }, { id: 'ok2', status: 'recording', started_at: '2026-09-26T00:00:00Z' }]))
t('6.2 非法条目被剔除、合法条目保留', S.loadLectures().length === 1 && S.loadLectures()[0].id === 'ok2')

/* 7. 导出合并：种一份主项目格式文档，导出应含 lectures 且 schema_version 不变
   （6.2 的垃圾数据把前面场次清掉了，这里重新种两条合法记录再导出） */
const lec3 = S.addLecture({ title: '英语听力课' })
S.updateLecture(lec3.id, { status: 'transcribing' })
const mk = S.createManualSemester({ name: '测试学期', first_monday: '2026-09-07', total_weeks: 16 })
t('7.1 createManualSemester 成功', mk.ok === true)
const exportText = S.exportImportedText()
const exported = JSON.parse(exportText)
t('7.2 导出含 app:"sched"', exported.app === 'sched')
t('7.3 schema_version 仍为 1（不触发主项目版本拒收）', exported.schema_version === 1)
t('7.4 导出含 lectures 数组', Array.isArray(exported.lectures))
t('7.5 导出的 lectures 与活源一致', exported.lectures.length === 2 && exported.lectures.some((x) => x.id === lec3.id))
t('7.6 导出仍含 semester/schedules/todos 三表', !!exported.semester && Array.isArray(exported.schedules) && Array.isArray(exported.todos))

/* 8. 金标准跨检：导出文本喂主项目 store.js，importAll 必须吃进且忽略 lectures */
const { createRequire } = await import('module')
const require = createRequire(import.meta.url)
require('D:/Document/Project/vibe-coding-project/js/store.js')
const Store = globalThis.Store
t('8.1 主项目 Store 挂到 global', typeof Store === 'object' && typeof Store.importAll === 'function')
const imp = Store.importAll(exportText)
t('8.2 主项目 importAll 放行（lectures 被忽略不报错）', imp.ok === true)
const mainLoaded = Store.load()
t('8.3 主项目 load 无 lectures 字段（未知字段不进主项目）', !('lectures' in mainLoaded))
t('8.4 主项目正常读到学期', mainLoaded.semester && mainLoaded.semester.name === '测试学期')

/* 9. 导入规则：带 lectures 才接管；不带则保留本地 */
const beforeImport = S.loadLectures().map((x) => x.id)
const docNoLec = JSON.parse(exportText); delete docNoLec.lectures
S.importFromText(JSON.stringify(docNoLec))
t('9.1 旧格式（无 lectures）导入后本地录音记录原样保留', JSON.stringify(S.loadLectures().map((x) => x.id)) === JSON.stringify(beforeImport))
const docWithLec = JSON.parse(exportText)
docWithLec.lectures = [{ id: 'lec_remote1', status: 'summarized', started_at: '2026-09-20T08:00:00Z', title: '别的设备的录音' }]
S.importFromText(JSON.stringify(docWithLec))
t('9.2 带 lectures 的文件导入后整体接管', S.loadLectures().length === 1 && S.loadLectures()[0].id === 'lec_remote1')

/* 10. 删除 */
t('10.1 removeLecture 删掉存在的', S.removeLecture('lec_remote1') === true)
t('10.2 removeLecture 删不存在的返回 false', S.removeLecture('不存在') === false)

console.log('\n结果：' + pass + ' 过，' + fail + ' 挂')
process.exit(fail ? 1 : 0)
