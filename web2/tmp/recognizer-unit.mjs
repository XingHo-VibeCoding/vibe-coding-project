/* recognizer 单元测试：prompt 结构 / 解析校验 / 调用链（假 fetch）。
   压缩链路（compressImage）依赖 DOM，放 playwright 阶段测。 */
const store = {}
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v) },
  removeItem: (k) => { delete store[k] },
}

const { buildRecognizerPrompt, parseScheduleJson, recognizeScheduleImage, recognizerAvailable, calcTilePlan, RECOGNIZER_PROMPT_VERSION } =
  await import('../src/data/recognizer.js')

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}
function setCfg(cfg) {
  localStorage.setItem('web2.llm', JSON.stringify(cfg))
}

/* ---- 1. prompt：用户要求把课表结构讲清楚 ---- */
const P = buildRecognizerPrompt()
t('1a. prompt 含结构描述（列=星期/行=节次）', P.includes('「列」是星期') && P.includes('「行」是节次'))
t('1b. prompt 含单双周写法说明', P.includes('单周') && P.includes('双周'))
t('1c. prompt 含合并大格与叠课拆条', P.includes('连排') && P.includes('拆成两条'))
t('1d. prompt 含排除项与宁缺勿猜', P.includes('排除项') && P.includes('宁缺勿猜'))
t('1e. prompt 约束 weekRule 三值与 JSON 结构', P.includes('"every"') && P.includes('"notes"'))
t('1f. prompt 放宽过度保守（能认一门输出一门）', P.includes('能认出一门课就输出一门') && P.includes('不要编造'))
t('1g. prompt 含卡片式布局说明', P.includes('卡片式布局') && P.includes('startSec'))
t('1h. 多图 prompt 含切块拼接说明', buildRecognizerPrompt(true).includes('从上到下') && buildRecognizerPrompt(true).includes('重叠'))
t('1i. 单图 prompt 不含多图说明', !P.includes('多图说明'))

/* ---- 1j~1m. 节次口径（用户反馈：只按第几节排课，不按图上时间）---- */
t('1j. prompt 有专门讲「节次怎么数」的段落', P.includes('【节次怎么数') && P.includes('节次序号'))
t('1k. 明确禁止用图上时间换算节次', P.includes('不要用图上的时间换算') && P.includes('期末'))
t('1l. 只写时间没写序号时按行序推断（空行不占号）', P.includes('第 1 行 = 第 1 节') && P.includes('不占序号'))
t('1m. 大节写法（第一大节 = 1-2 节）有交代', P.includes('第一大节') && P.includes('展开'))
t('1n. prompt 版本号已 bump 到 2', RECOGNIZER_PROMPT_VERSION === 2)

/* ---- 1x. calcTilePlan：长图切块规划 ---- */
t('4a. 普通比例截图不切块', calcTilePlan(1080, 1920) === null && calcTilePlan(1264, 2780) === null)
const plan = calcTilePlan(1264, 6315) // 用户实测的教务长截图
t('4b. 长图切块返回 tiles', !!plan && plan.tiles.length >= 2)
t('4c. 块覆盖全高且首尾不越界', plan.tiles[0].y === 0 && plan.tiles[plan.tiles.length - 1].y + plan.tiles[plan.tiles.length - 1].h === 6315)
let covered = 0
for (let i = 0; i < plan.tiles.length; i++) {
  const seg = plan.tiles[i]
  covered += seg.h
  if (i > 0) t('4d.' + i + ' 相邻块有重叠（防跨缝截断）', plan.tiles[i - 1].y + plan.tiles[i - 1].h > seg.y)
}
t('4e. 覆盖总高 ≥ 原高（重叠导致）', covered >= 6315)
const plan2 = calcTilePlan(1080, 2400)
t('4f. 略超比例的截图切 2 块', plan2 && plan2.tiles.length === 2)
t('4g. 块数封顶 4', (calcTilePlan(800, 12000) || { tiles: [] }).tiles.length <= 4)

/* ---- 2. parseScheduleJson ---- */
const ok = parseScheduleJson('{"courses":[{"title":"高数","weekday":"1","startSec":"1","endSec":"2","weekRule":"odd","location":"教1","teacher":"张"}],"notes":["看不清教师"]}')
t('2a. 数字字符串自动纠偏 + 字段保留', ok.courses.length === 1 && ok.courses[0].weekday === 1 && ok.courses[0].startSec === 1 && ok.notes.length === 1)

const fenced = parseScheduleJson('```json\n{"courses":[{"title":"英语","weekday":3,"startSec":3,"endSec":4,"weekRule":"even"}]}\n```')
t('2b. 剥 ```json 代码块壳', fenced.courses.length === 1 && fenced.courses[0].weekRule === 'even')

const dropped = parseScheduleJson(JSON.stringify({ courses: [
  { title: '', weekday: 1, startSec: 1, endSec: 2 },           // 无课程名
  { title: '课A', weekday: 8, startSec: 1, endSec: 2 },         // 星期无效
  { title: '课B', weekday: 0, startSec: 1, endSec: 2 },         // 星期无效
  { title: '课C', weekday: 2, startSec: 5, endSec: 4 },         // 节次倒挂
  { title: '课D', weekday: 2, startSec: 0, endSec: 2 },         // 节次越界
  { title: '课E', weekday: 2, startSec: 14, endSec: 16 },       // 节次越界
]}))
t('2c. 六条全非法 → 全丢弃且带 warning', dropped.courses.length === 0 && dropped.warnings.length === 6)

const weird = parseScheduleJson(JSON.stringify({ courses: [
  { title: '体育', weekday: 5, startSec: 7, endSec: 8, weekRule: '1-16周' }, // 非法规则 → 回落
  { title: '高数', weekday: 1, startSec: 1, endSec: 2 },
  { title: '高数', weekday: 1, startSec: 1, endSec: 2 },                      // 完全重复
]}))
t('2d. 非法 weekRule 回落 every + 去重', weird.courses.length === 2 && weird.courses[0].weekRule === 'every' && weird.warnings.length === 1)

t('2e. 空 courses 合法（识别不出课不报错）', parseScheduleJson('{"courses":[],"notes":[]}').courses.length === 0)
let threw = false
try { parseScheduleJson('{"overview":"错形状"}') } catch { threw = true }
t('2f. 缺 courses 数组 → 报错', threw)
threw = false
try { parseScheduleJson('这不是 JSON') } catch { threw = true }
t('2g. 非 JSON → 报错', threw)

/* ---- 3. recognizeScheduleImage（假 fetch）---- */
setCfg({ provider: '', key: '', model: '' })
t('3a. 未配置 Key → 可用性提示', typeof recognizerAvailable() === 'string')
let err = null
try { await recognizeScheduleImage('data:image/jpeg;base64,xxx') } catch (e) { err = e }
t('3b. 未配置 Key → 调用被拒', err && err.message.includes('还没配置'))

setCfg({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-v4-pro' })
t('3c. 配置齐 → 可用性 null', recognizerAvailable() === null)

let captured = null
let callCount = 0
globalThis.fetch = async (url, init) => {
  callCount++
  captured = { url, body: JSON.parse(init.body) }
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{"courses":[{"title":"高数","weekday":1,"startSec":1,"endSec":2,"weekRule":"every"}],"notes":[]}' } }] }),
  }
}
const stages = []
const out = await recognizeScheduleImage('data:image/jpeg;base64,AAAA', { onStage: (s) => stages.push(s) })
t('3d. 正常返回且解析出课程', out.courses.length === 1 && out.courses[0].title === '高数')
t('3e. onStage 报了 call + parse', stages[0] === 'call' && stages[1] === 'parse')
t('3f. 请求打到 chat/completions 且带 Key', captured.url === 'https://api.deepseek.com/chat/completions' && captured.body.model === 'deepseek-flash')
const content = captured.body.messages[0].content
t('3g. content 是数组：text prompt + base64 图片原样传', Array.isArray(content) && content[0].type === 'text' && content[1].type === 'image_url' && content[1].image_url.url === 'data:image/jpeg;base64,AAAA')
t('3h. json_object + 温度 0.1 + max_tokens 4000', captured.body.response_format.type === 'json_object' && captured.body.temperature === 0.1 && captured.body.max_tokens === 4000)

setCfg({ provider: 'deepseek', key: 'sk-test', model: '旧手填错名' })
await recognizeScheduleImage('data:image/jpeg;base64,AAAA')
t('3i. 纪要模型是文字型/手填错名 → 识别固定 deepseek-flash（视觉模型）', captured.body.model === 'deepseek-flash')

setCfg({ provider: 'deepseek', key: 'sk-test', model: 'deepseek-v4-pro' })
await recognizeScheduleImage('data:image/jpeg;base64,AAAA')
t('3i2. 纪要配置 v4-pro 也不影响识别模型（v4-pro 无视觉，发图被静默忽略会编课）', captured.body.model === 'deepseek-flash')

// 多图（长图切块）：content 应有 1 个 text + N 个 image_url
await recognizeScheduleImage(['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB', 'data:image/jpeg;base64,CCCC'])
const mc = captured.body.messages[0].content
t('3m. 多图 content = text + 3 个 image_url', mc.length === 4 && mc[0].type === 'text' && mc.slice(1).every((x) => x.type === 'image_url'))
t('3n. 多图时 prompt 带拼接说明', mc[0].text.includes('多图说明'))
t('3o. 图片顺序保持', mc[1].image_url.url.endsWith('AAAA') && mc[3].image_url.url.endsWith('CCCC'))

globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) })
err = null
try { await recognizeScheduleImage('data:image/jpeg;base64,AAAA') } catch (e) { err = e }
t('3j. 401 → Key 无效文案', err && err.message.includes('401'))

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' } }] }) })
err = null
try { await recognizeScheduleImage('data:image/jpeg;base64,AAAA') } catch (e) { err = e }
t('3k. 空内容 → 报错', err && err.message.includes('空内容'))

globalThis.fetch = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e }
err = null
try { await recognizeScheduleImage('data:image/jpeg;base64,AAAA') } catch (e) { err = e }
t('3l. AbortError 原样上抛（取消语义）', err && err.name === 'AbortError')

const fails = results.filter(([, ok2]) => !ok2)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
