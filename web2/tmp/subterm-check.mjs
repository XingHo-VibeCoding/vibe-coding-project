/* P13 小学期检查（秋/冬各半，课程上的「学期」决定它出现在哪些周）
   A 段：纯逻辑（默认对半分、老数据兜底、四种学期文本、与 weeks/单双周叠加）
   B 段：浏览器（周课表看第 5 周 / 第 10 周，确认「秋」和「冬」的课各只出现在自己那半段）

   背景（用户 2026-10-06 发现）：课程上的「学期」文本分三档 —— 秋（只上前半段）/ 冬（只上后半段）/
   秋冬（整学期）。之前完全没有这一层，导致只上前半段的课在整 16 周里都显示出来。
   口径：**秋 = 第 1–8 周、冬 = 第 9–16 周（对半分，可在学期设置里改）**；短学期（暑假）先不管。

   跑法：node tmp/subterm-check.mjs（B 段要先起 4177 静态服务）
   产物：tmp/subterm-w5.png / tmp/subterm-w10.png */

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

const S = await import('../src/data/store.js')

/* ---------- A1–A3 小学期表的来源与兜底 ---------- */
t('A1. 默认对半分：16 周 → 秋 1-8 / 冬 9-16',
  JSON.stringify(S.defaultSubTerms(16)) === JSON.stringify([{ name: '秋', from: 1, to: 8 }, { name: '冬', from: 9, to: 16 }]),
  JSON.stringify(S.defaultSubTerms(16)))
t('A1b. 奇数周数也对半（15 → 秋 1-8 / 冬 9-15）；没给周数按 16',
  JSON.stringify(S.defaultSubTerms(15)) === JSON.stringify([{ name: '秋', from: 1, to: 8 }, { name: '冬', from: 9, to: 15 }])
  && S.defaultSubTerms(0)[1].to === 16 && S.defaultSubTerms(undefined)[1].to === 16,
  JSON.stringify(S.defaultSubTerms(15)))
t('A2. **老数据没有这个字段 → 按总周数对半分兜底**（不做迁移）',
  JSON.stringify(S.subTermsOf({ total_weeks: 16 })) === JSON.stringify([{ name: '秋', from: 1, to: 8 }, { name: '冬', from: 9, to: 16 }])
  && JSON.stringify(S.subTermsOf({ totalWeeks: 12 })) === JSON.stringify([{ name: '秋', from: 1, to: 6 }, { name: '冬', from: 7, to: 12 }]))
t('A3. 两种拼写都认（主项目 snake `sub_terms` / 界面 camel `subTerms`），脏数据被清掉、空表回落默认',
  S.subTermsOf({ sub_terms: [{ name: '春', from: 1, to: 8 }, { name: '夏', from: 9, to: 16 }] })[0].name === '春'
  && S.subTermsOf({ subTerms: [{ name: '秋', from: 1, to: 8 }] })[0].name === '秋'
  && S.subTermsOf({ sub_terms: [{ name: '', from: 1, to: 8 }], total_weeks: 16 })[0].name === '秋'
  && S.subTermsOf({ sub_terms: [], total_weeks: 16 }).length === 2)

/* ---------- A4–A8 四种学期文本各出现在哪些周 ---------- */
const SUBS = S.defaultSubTerms(16)
const mk = (term, extra) => ({ id: 'x', type: 'course', name: '课', weekday: 1, start: '08:00', end: '09:40', weeks: null, week_rule: 'every', term, ...(extra || {}) })
const weeksOf = (c, subs = SUBS) => {
  const out = []
  for (let w = 1; w <= 16; w++) if (S.matchWeek(c, w, subs)) out.push(w)
  return out.join(',')
}
t('A4. 「秋」→ 只在第 1-8 周出现，第 9-16 周不出现', weeksOf(mk('秋')) === '1,2,3,4,5,6,7,8', weeksOf(mk('秋')))
t('A5. 「冬」→ 只在第 9-16 周出现', weeksOf(mk('冬')) === '9,10,11,12,13,14,15,16', weeksOf(mk('冬')))
t('A6. 「秋冬」→ 整学期都在（两个小学期名都命中 → 并集）', weeksOf(mk('秋冬')) === Array.from({ length: 16 }, (_, i) => i + 1).join(','), weeksOf(mk('秋冬')))
t('A7. **没写学期（手动加的课 / 老课）→ 整学期都在，行为不变**', weeksOf(mk('')) === weeksOf(mk('秋冬')), weeksOf(mk('')))
t('A8. 「短」（暑假短学期，你拍板先不管）→ 不参与小学期判断，照旧整学期都在',
  weeksOf(mk('短')) === weeksOf(mk('')), weeksOf(mk('短')))

/* ---------- A9–A11 向后兼容与叠加 ---------- */
t('A9. **不传小学期表时行为与改动前逐字一致**（「秋」的课照样整学期都在）—— 老调用点不会静默变化',
  (() => {
    const out = []
    for (let w = 1; w <= 16; w++) if (S.matchWeek(mk('秋'), w)) out.push(w)
    return out.length === 16
  })())
t('A10. 小学期与显式周次叠加：冬 + [9,11,13] → 只有 9/11/13',
  weeksOf(mk('冬', { weeks: [9, 11, 13] })) === '9,11,13', weeksOf(mk('冬', { weeks: [9, 11, 13] })))
t('A11. 小学期与单双周叠加：冬 + 单周 → 9,11,13,15（不在冬那半段的奇数周不算）',
  weeksOf(mk('冬', { week_rule: 'odd' })) === '9,11,13,15', weeksOf(mk('冬', { week_rule: 'odd' })))
t('A12. 换一套小学期表（改成 1-9 / 10-16）→ 判断跟着变（可编辑的意义）',
  weeksOf(mk('秋'), [{ name: '秋', from: 1, to: 9 }, { name: '冬', from: 10, to: 16 }]) === '1,2,3,4,5,6,7,8,9',
  weeksOf(mk('秋'), [{ name: '秋', from: 1, to: 9 }, { name: '冬', from: 10, to: 16 }]))

/* ---------- B 段：浏览器 ---------- */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'

function mondayOfToday() {
  const d = new Date()
  const wd = d.getDay() === 0 ? 7 : d.getDay()
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (wd - 1))
  const p = (n) => String(n).padStart(2, '0')
  return m.getFullYear() + '-' + p(m.getMonth() + 1) + '-' + p(m.getDate())
}
function mondayOfWeekOffset(offsetWeeks) {
  const d = new Date(mondayOfToday() + 'T00:00:00')
  d.setDate(d.getDate() + offsetWeeks * 7)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

/* 翻到第 target 周：点一次、**等到标题真的变了**再点下一次。
   （第一版写「连点 5 次 + 每次等 120ms」——结果只前进了 1 周：周切换有 280ms 过渡，
   点太快后几次被吃掉。别用固定 sleep 猜时序，直接等状态收敛。） */
async function gotoWeek(page, target) {
  for (let i = 0; i < 40; i++) {
    const cur = await page.$eval('[data-week-label]', (el) => {
      const m = String(el.innerText || '').match(/第\s*(\d+)\s*周/)
      return m ? Number(m[1]) : 0
    })
    if (cur === target) return true
    await page.$eval(cur < target ? '[data-week-next]' : '[data-week-prev]', (el) => el.click())
    await page.waitForTimeout(420)
  }
  return false
}

async function shoot({ label, firstMonday, subTerms, shot5, shot10 }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
/* P14 测试隔离：掐掉节假日 CDN（headless Chrome 有真网，开机会真抓到国庆放假，把夹具里本周的课藏掉）。用宽 pattern + 域判断——窄的 '**cdn.jsdelivr.net**' 不命中带路径的 URL。 */
await ctx.route('**/*', (r) => (r.request().url().includes('cdn.jsdelivr.net') ? r.abort() : r.continue()))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const doc = {
    app: 'sched',
    semester: { id: 's', name: '2026-2027 秋冬', first_monday: firstMonday, total_weeks: 16, ...(subTerms ? { sub_terms: subTerms } : {}) },
    schedules: [
      { id: 'c1', type: 'course', title: '秋课', weekday: 1, start_time: '08:00', duration: 95, week_rule: 'every', term: '秋', semester_id: 's' },
      { id: 'c2', type: 'course', title: '冬课', weekday: 2, start_time: '08:00', duration: 95, week_rule: 'every', term: '冬', semester_id: 's' },
      { id: 'c3', type: 'course', title: '秋冬课', weekday: 3, start_time: '08:00', duration: 95, week_rule: 'every', term: '秋冬', semester_id: 's' },
      { id: 'c4', type: 'course', title: '没写学期的课', weekday: 4, start_time: '08:00', duration: 95, week_rule: 'every', semester_id: 's' },
    ],
    todos: [],
  }
  await page.addInitScript(
    ([d]) => {
      localStorage.setItem('web2.data', JSON.stringify(d))
      localStorage.setItem('web2.onboarded', '1')
    },
    [doc],
  )
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  await page.$eval('[data-nav="week"]', (el) => el.click())
  await page.waitForTimeout(500)
  /* 先翻到第 5 周再读 —— 不然断言名写着"第 5 周"、实际读的是第 1 周（都属秋学期，结论一样，
     但名字骗人；测试里的名字必须跟它真验的东西一致）。 */
  const got5 = await gotoWeek(page, 5)
  const textOf = async () => (await page.$eval('main[data-page="week"]', (el) => el.innerText)).replace(/\s+/g, ' ')
  const labelOf = async () => (await page.$eval('[data-week-label]', (el) => el.innerText)).replace(/\s+/g, ' ')
  const w5 = await textOf()
  const l5 = await labelOf()
  if (shot5) await page.screenshot({ path: 'tmp/subterm-w5.png' })
  const got10 = await gotoWeek(page, 10)
  const w10 = await textOf()
  const l10 = await labelOf()
  if (shot10) await page.screenshot({ path: 'tmp/subterm-w10.png' })
  await ctx.close()
  return { label, w5, l5, w10, l10, got5, got10, errors }
}

{
  /* ⚠️「秋冬课」这个词**同时含**「秋课」「冬课」两个子串 —— 判"看得见/看不见"之前先剔掉它，
     否则断言会假过。 */
  const strip = (s) => String(s).replace(/秋冬课/g, '')

  /* 今天落在第 1 周 → 第 5 周 = 本周 +4 周 */
  const r = await shoot({ label: 'sub_terms 明写 秋1-8/冬9-16', firstMonday: mondayOfToday(), subTerms: [{ name: '秋', from: 1, to: 8 }, { name: '冬', from: 9, to: 16 }], shot5: true, shot10: true })
  t('B0. 能翻到第 5 周和第 10 周（翻页本身没问题，免得翻页失败伪装成逻辑失败）', r.got5 === true && r.got10 === true, r.l5 + ' → ' + r.l10)
  t('B1. 第 5 周（秋学期）：看得见「秋课」「秋冬课」「没写学期的课」，**看不见「冬课」**',
    /秋课/.test(r.w5) && /秋冬课/.test(r.w5) && /没写学期的课/.test(r.w5) && !/冬课/.test(strip(r.w5)),
    r.w5.slice(0, 120))
  t('B2. 第 5 周标题标着「秋学期」', /秋学期/.test(r.l5), r.l5)
  t('B3. 第 10 周（冬学期）：看得见「冬课」「秋冬课」「没写学期的课」，**看不见「秋课」**',
    /冬课/.test(strip(r.w10)) && /秋冬课/.test(r.w10) && /没写学期的课/.test(r.w10) && !/秋课/.test(strip(r.w10)),
    r.w10.slice(0, 120))
  t('B4. 第 10 周标题标着「冬学期」', /冬学期/.test(r.l10), r.l10)
  t('B5. 零 pageerror', r.errors.length === 0, JSON.stringify(r.errors.slice(0, 2)))
}
{
  /* 老数据：没有 sub_terms → 走对半分兜底（AGENTS 八.2 的实测） */
  const strip = (s) => String(s).replace(/秋冬课/g, '')
  const r = await shoot({ label: '老数据（没有 sub_terms）', firstMonday: mondayOfToday(), subTerms: null })
  t('B6. **老数据没写小学期表也能正常分辨**：第 5 周看得见「秋课」、看不见「冬课」',
    /秋课/.test(r.w5) && !/冬课/.test(strip(r.w5)),
    r.w5.slice(0, 120))
  t('B7. 老数据下第 10 周反过来：看得见「冬课」、看不见「秋课」',
    /冬课/.test(strip(r.w10)) && !/秋课/.test(strip(r.w10)),
    r.w10.slice(0, 120))
}
{
  /* 自定义：秋 1-9 / 冬 10-16 —— 第 9 周仍算秋（可编辑的意义） */
  const strip = (s) => String(s).replace(/秋冬课/g, '')
  const r = await shoot({ label: '自定义 秋1-9/冬10-16', firstMonday: mondayOfWeekOffset(-4), subTerms: [{ name: '秋', from: 1, to: 9 }, { name: '冬', from: 10, to: 16 }] })
  t('B8. 自定义表也生效：第 5 周照样是「秋学期」（能只看见秋课+秋冬课）',
    /秋课/.test(r.w5) && !/冬课/.test(strip(r.w5)) && /秋学期/.test(r.l5),
    r.l5)
}

await browser.close()
console.log(`\n小学期检查：${pass} 项通过 / ${fail} 项失败`)
process.exit(fail ? 1 : 0)
