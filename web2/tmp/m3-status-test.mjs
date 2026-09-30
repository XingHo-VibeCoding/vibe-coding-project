/* M3 状态机补充测试：transcribed 中间态、回退规则、transcript 字段持久化 */
const store = {}
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
}
const { updateLecture, loadLectures, addLecture } = await import('../src/data/store.js')

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}

const lec = addLecture({ title: '状态机测试场' })
const id = lec.id
updateLecture(id, { ended_at: new Date().toISOString() })

t('1. recording → transcribing 前进放行', updateLecture(id, { status: 'transcribing' }).ok)
t('2. transcribing → recording 回退放行（转写失败可重试）', updateLecture(id, { status: 'recording' }).ok)
t('3. 回退后再进 transcribing', updateLecture(id, { status: 'transcribing' }).ok)
t('4. transcribing → transcribed 放行', updateLecture(id, { status: 'transcribed' }).ok)
t('5. transcribed → recording 倒退拦截', !updateLecture(id, { status: 'recording' }).ok)
t('6. transcribed → transcribing 倒退拦截', !updateLecture(id, { status: 'transcribing' }).ok)

updateLecture(id, { transcript: '这是转写出来的文字稿。' })
const loaded = loadLectures().find((x) => x.id === id)
t('9. transcript 字段落库', loaded.transcript === '这是转写出来的文字稿。')

t('7. transcribed → summarized 放行', updateLecture(id, { status: 'summarized' }).ok)
t('8. summarized 不可逆（→ recording 拦截）', !updateLecture(id, { status: 'recording' }).ok)
t('10. 无 transcript 的旧数据读出为 null', loadLectures().every((x) => x.id === id ? true : x.transcript == null))

const fails = results.filter((r) => !r[1])
console.log(`\n结果：${results.length - fails.length} 过，${fails.length} 挂`)
process.exit(fails.length ? 1 : 0)
