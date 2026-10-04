/* A4 全页质量扫描（2026-10-04）：小屏 + 暗色 版式体检
   覆盖：360×640（主）与 390×844（参照）× 亮/暗 × 3 个 tab × 开关浮层；
   检查：E1 横向溢出 / E2 元素出界 / E3 触控目标过小 / E4 暗色低对比 / E5 被遮挡的可点元素 / E6 浮层超屏。
   只读扫描，不改任何数据；产物：tmp/quality-scan.txt + 有问题的状态截图 tmp/qa-*.png。
   跑法：先起 dist 静态服务（默认 4177，可用 TW_URL 覆盖），再 node tmp/quality-scan.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const { writeFileSync } = await import('node:fs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'

/* ---------------- 种子数据：一份「导入态」导出文档，横向拉满压力 ----------------
   课程铺满周一~周日（今天必有课，不受星期几影响）；含超长课名/超长地点/120 分钟大课；
   待办含超长标题 + 今天到期 + 已完成；打卡两条长名；课堂录音一条已转写。 */
const pad = (n) => String(n).padStart(2, '0')
const d0 = new Date()
const TODAY = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}`
const WD = [0, 1, 2, 3, 4, 5, 6, 7][new Date().getDay()] || 7 // 0(周日)→7
const iso = (h, m) => `${TODAY}T${pad(h)}:${pad(m)}:00.000Z`

const schedules = []
const COURSES = [
  [1, '高等数学 A', '教1-101', '08:00', 90],
  [2, '毛泽东思想和中国特色社会主义理论体系概论（专题研讨课）', '第三教学楼 A 区 305 多媒体教室', '08:00', 90],
  [3, '线性代数与空间解析几何', '教2-203', '10:00', 90],
  [4, '大学英语视听说（分级教学 B 班）', '外语楼 502 语音室', '14:00', 120],
  [5, '数据结构与算法', '计算机楼 407', '14:00', 120],
  [6, '创新创业讲座', '大学生活动中心报告厅', '10:00', 45],
  [7, '体育（篮球）', '东区体育馆', '16:00', 45],
]
for (const [wd, title, location, start_time, duration] of COURSES) {
  schedules.push({ id: 'c' + wd, type: 'course', semester_id: 'sem1', title, location, weekday: wd, start_time, duration, week_rule: 'every' })
}
schedules.push({ id: 'c3b', type: 'course', semester_id: 'sem1', title: '大学物理实验', location: '物理楼 B1-06', weekday: 3, start_time: '14:00', duration: 120, week_rule: 'every' })
schedules.push({ id: 'r1', type: 'routine', semester_id: 'sem1', title: '每日背单词 50 个', location: '图书馆四层', weekday: null, start_time: '21:30', duration: 30, week_rule: 'every' })

const DOC = {
  app: 'sched',
  schema_version: 1,
  exported_at: new Date().toISOString(),
  semester: { id: 'sem1', name: '2026 秋冬学期（A4 扫描）', first_monday: '2026-08-31', total_weeks: 18, periods: [] },
  schedules,
  todos: [
    { id: 't1', title: '交《马克思主义基本原理》课程论文（不少于 3000 字，写清参考文献）', done: false, due_date: TODAY },
    { id: 't2', title: '买洗发水', done: false, due_date: null },
    { id: 't3', title: '还掉图书馆借的《算法导论》', done: true, due_date: null },
  ],
  lectures: [
    {
      id: 'lec1', schedule_id: 'c3', title: '线性代数与空间解析几何 · 第 4 周', status: 'transcribed',
      started_at: iso(10, 0), ended_at: iso(11, 30), duration_ms: 5400000, clip_count: 1,
      clips: [{ index: 0, path: null, mime: 'audio/aac', duration_ms: 5400000, recorded_at: iso(10, 0) }],
      created_at: iso(10, 0), updated_at: iso(11, 35), transcript: '今天讲的是矩阵的秩……', summary: null,
    },
  ],
  habits: [
    { id: 'h1', name: '每天背 50 个单词', created_at: iso(8, 0), records: {}, backfilled: {} },
    { id: 'h2', name: '23 点前睡觉（真的别再熬夜了）', created_at: iso(8, 0), records: {}, backfilled: {} },
  ],
}
const DOC_STR = JSON.stringify(DOC)

const SEED = ([doc]) => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.data', doc)
  localStorage.setItem('web2.theme.auto', '0')
}

/* ---------------- 浏览器内审计 ---------------- */
const AUDIT = (args) => {
  const { scopeSel, textFlag } = args
  const vw = window.innerWidth, vh = window.innerHeight
  const out = { overflow: [], escape: [], tiny: [], tinyWarn: [], contrast: [], weak: [], occluded: [], tall: [], nan: [], translucent: 0, gradient: 0, unparsed: 0, note: [] }
  const r1 = (n) => Math.round(n * 10) / 10

  const brief = (el) => {
    if (!el || !el.tagName) return String(el)
    const parts = [el.tagName.toLowerCase()]
    for (const a of el.attributes || []) if (a.name.startsWith('data-') && a.value.length < 26) parts.push(`[${a.name}${a.value && a.value !== 'true' ? '=' + a.value : ''}]`)
    const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)
    if (cls.length) parts.push('.' + cls.slice(0, 3).join('.'))
    return parts.join('')
  }
  const txt = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 34)
  const vis = (el) => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
    if (el.closest('[inert]') || el.closest('[aria-hidden="true"]')) return false
    const b = el.getBoundingClientRect()
    return b.width > 0 && b.height > 0
  }
  /* 累计祖先透明度：半透明子树（如「录音不可用」的 opacity-60 置灰）不是配色问题，跳过对比度判定 */
  const opacityOf = (el) => { let op = 1, p = el; while (p && p !== document.body) { op *= Number(getComputedStyle(p).opacity); p = p.parentElement } return op }

  const panel = scopeSel ? document.querySelector(scopeSel) : null
  const roots = panel ? [panel] : [document.querySelector('main:not([inert])')].filter(Boolean)
  if (!roots.length) { out.note.push('找不到扫描根节点'); return out }

  /* E1 横向溢出：先看整页，再看当前页容器 */
  const se = document.scrollingElement || document.documentElement
  if (se.scrollWidth > vw + 1) out.overflow.push({ where: 'documentElement', scrollW: se.scrollWidth, clientW: vw })
  for (const r of roots) if (r.scrollWidth > r.clientWidth + 1) out.overflow.push({ where: brief(r), scrollW: r.scrollWidth, clientW: r.clientWidth })

  /* 收集节点（不含 inert 子树） */
  const nodes = []
  const walk = (el) => {
    if (el.closest('[inert]')) return
    nodes.push(el)
    for (const c of el.children) walk(c)
  }
  for (const r of roots) walk(r)

  /* E2 元素出界（跳过可横向滚动/裁剪的容器内部） */
  const clipped = (el) => {
    let p = el.parentElement
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true
      p = p.parentElement
    }
    return false
  }
  for (const el of nodes) {
    if (el === roots[0] || !vis(el) || clipped(el)) continue
    const b = el.getBoundingClientRect()
    if (b.right > vw + 1.5 || b.left < -1.5) {
      if (b.width > vw * 0.98 && el.parentElement && el.parentElement.getBoundingClientRect().width > vw) continue // 外层轨道，不算单个元素出界
      out.escape.push({ sel: brief(el), text: txt(el), left: r1(b.left), right: r1(b.right), w: r1(b.width) })
    }
  }

  /* E3 触控目标过小
     判据按 WCAG 2.5.8(AA)：目标尺寸下限 24×24，小于 24 才算问题；
     24–32 只是「未达 Material/Apple 建议的 44/48」，列为提示不计数。 */
  const seenTiny = new Set()
  for (const el of nodes) {
    if (!el.matches || !el.matches('button,[role="switch"],a[href],select,input[type=checkbox],input[type=radio]')) continue
    if (!vis(el) || el.closest('[disabled]') || el.getAttribute('aria-disabled') === 'true') continue
    const b = el.getBoundingClientRect()
    if (Math.min(b.width, b.height) >= 32) continue
    const k = `${Math.round(b.width)}x${Math.round(b.height)}|${txt(el)}|${el.getAttribute('class') || ''}`
    if (seenTiny.has(k)) continue
    seenTiny.add(k)
    const rec = { sel: brief(el), text: txt(el), w: Math.round(b.width), h: Math.round(b.height) }
    if (Math.min(b.width, b.height) < 24) out.tiny.push(rec)
    else out.tinyWarn.push(rec)
  }

  /* E4 对比度
     颜色解析必须覆盖 Tailwind v4 的两种现代格式（实测踩过）：
     ① 透明度修饰符 `text-ink-dim/70` → getComputedStyle 给 `oklab(L a b / α)`；
     ② 调色板色 `text-amber-500` → `oklch(L C H)`。
     只认 `rgb()` 会把整类浅色文字静默跳过（初版就漏了 13 种）。 */
  const oklabToRgb = (L, a, b) => {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ]
    const g = (v) => Math.max(0, Math.min(255, 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055)))
    return { r: g(lin[0]), g: g(lin[1]), b: g(lin[2]) }
  }
  const rgb = (s) => {
    const str = String(s)
    const num = (x) => (String(x).endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x))
    let m = str.match(/rgba?\(([^)]+)\)/)
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(num)
      if (p.length < 3 || p.some((v) => Number.isNaN(v))) return null
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
    }
    m = str.match(/oklch\(([^)]+)\)/)
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter(Boolean)
      const L = p[0].endsWith('%') ? parseFloat(p[0]) / 100 : parseFloat(p[0])
      const rad = (parseFloat(p[2]) * Math.PI) / 180
      const C = parseFloat(p[1])
      return { ...oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad)), a: p.length > 3 ? parseFloat(p[3]) : 1 }
    }
    m = str.match(/oklab\(([^)]+)\)/)
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter(Boolean)
      const L = p[0].endsWith('%') ? parseFloat(p[0]) / 100 : parseFloat(p[0])
      return { ...oklabToRgb(L, parseFloat(p[1]), parseFloat(p[2])), a: p.length > 3 ? parseFloat(p[3]) : 1 }
    }
    return null
  }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 })
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05) }
  const bgOf = (el) => {
    const layers = []
    let p = el
    while (p && p !== document.documentElement) {
      const c = rgb(getComputedStyle(p).backgroundColor)
      if (c && c.a > 0) { layers.push(c); if (c.a >= 0.95) break }
      p = p.parentElement
    }
    const base = rgb(getComputedStyle(document.body).backgroundColor)
    layers.push(base && base.a > 0.95 ? base : { r: 255, g: 255, b: 255, a: 1 })
    let acc = layers[layers.length - 1]
    for (let i = layers.length - 2; i >= 0; i--) acc = over(layers[i], acc)
    return acc
  }
  for (const el of nodes) {
    if (!el.childNodes || !vis(el)) continue
    let hasText = false
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim()) hasText = true
    if (!hasText) continue
    const cs = getComputedStyle(el)
    const fg0 = rgb(cs.color)
    if (!fg0) { out.unparsed++; continue }
    const op = opacityOf(el)
    if (op < 0.95) { out.translucent++; continue }
    let grad = false
    { let q = el; while (q && q !== document.body) { const bi = getComputedStyle(q).backgroundImage; if (bi && bi !== 'none') { grad = true; break } q = q.parentElement } }
    if (grad) { out.gradient++; continue }
    const bg = bgOf(el)
    const fg = over({ ...fg0, a: fg0.a * op }, bg)
    const size = parseFloat(cs.fontSize)
    const bold = Number(cs.fontWeight) >= 600
    const large = size >= 24 || (bold && size >= 18.66)
    const need = large ? 3 : 4.5
    const c = ratio(fg, bg)
    const rec = { sel: brief(el), text: txt(el), ratio: Math.round(c * 100) / 100, need, size: Math.round(size), color: cs.color, bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})` }
    if (c < need - 0.05) out.contrast.push(rec)
    else if (c < 4.5 - 0.05 && !large) out.weak.push(rec)
  }
  /* E7 异常文案：界面上不该出现 NaN / Invalid Date（种子数据故意铺长，容易顶出脏值） */
  const seenNan = new Set()
  for (const el of nodes) {
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !/NaN|Invalid Date/.test(n.nodeValue)) continue
      const path = []
      let p = el
      while (p && p !== document.body) { path.unshift(p.tagName.toLowerCase() + [...(p.attributes || [])].filter((a) => a.name.startsWith('data-')).map((a) => '[' + a.name + ']').join('')); p = p.parentElement }
      const k = n.nodeValue.trim() + '|' + path.slice(-3).join('>')
      if (seenNan.has(k)) continue
      seenNan.add(k)
      out.nan.push({ text: n.nodeValue.trim().slice(0, 50), path: path.slice(-4).join(' > ') })
    }
  }

  out.contrast.sort((a, b) => a.ratio - b.ratio)
  out.weak.sort((a, b) => a.ratio - b.ratio)

  /* E5 被遮挡的可点元素（只在扫描根内找目标，用全文档命中测试） */
  for (const el of nodes) {
    if (!el.matches || !el.matches('button,a[href],[role="switch"],input,select')) continue
    if (!vis(el) || getComputedStyle(el).pointerEvents === 'none') continue
    const b = el.getBoundingClientRect()
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2
    if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue
    const hit = document.elementFromPoint(cx, cy)
    if (!hit || hit === el || el.contains(hit) || (hit.contains && hit.contains(el))) continue
    /* 底部导航是 fixed 的，元素滚到它下面属正常（页面自己有 pb-28），不算被遮挡 */
    if (hit.closest && (hit.closest('nav') || hit.closest('[data-frame-toast]') || hit.closest('[data-rec-banner]'))) continue
    out.occluded.push({ sel: brief(el), text: txt(el), coveredBy: brief(hit), hitText: txt(hit) })
  }

  /* E6 浮层超屏 */
  if (panel) {
    const b = panel.getBoundingClientRect()
    if (panel.scrollHeight > panel.clientHeight + 1) out.tall.push({ sel: brief(panel), scrollH: panel.scrollHeight, clientH: panel.clientHeight })
    /* 4px 容差：浮层是 bottom-0 + 上滑动画，量到亚像素级出头不算超屏 */
    if (b.bottom > vh + 4 || b.top < -4) out.tall.push({ sel: brief(panel), top: r1(b.top), bottom: r1(b.bottom) })
  }
  return out
}

/* ---------------- 状态表 ---------------- */
const tab = async (p, label) => { await p.locator('nav button', { hasText: label }).first().click(); await p.waitForTimeout(420) }
const waitSheet = async (p, sel) => { try { await p.locator(sel).first().waitFor({ state: 'visible', timeout: 2500 }); return true } catch { return false } }

/* 「加课程 / 加循环日程」菜单是**长按周网格空格子**长出来的（App.vue:3451 gridDown → 400ms → firePick），
   不是点按钮；`[data-week-add]` 是「拍课表识别」的另一个入口，点它会进识别页而不是这个菜单。 */
async function openAddPick(p) {
  await tab(p, '周课表')
  const cells = p.locator('main[data-page="week"] [data-cell]')
  const n = await cells.count()
  const vh = p.viewportSize()?.height || 640
  for (let i = 0; i < n; i++) {
    const c = cells.nth(i)
    if (await c.locator('article').count()) continue
    const b = await c.boundingBox()
    if (!b || b.width < 24 || b.height < 16) continue
    const cx = b.x + b.width / 2
    const cy = b.y + b.height / 2
    if (cy < 60 || cy > vh - 60) continue /* 视口外的格子鼠标事件打不到 */
    await p.mouse.move(cx, cy)
    await p.mouse.down()
    await p.waitForTimeout(650)
    await p.mouse.up()
    if (await p.locator('[data-add-pick]').count()) return true
  }
  return false
}

const STATES = [
  { id: 'today', scope: null, open: async (p) => { await tab(p, '今日') } },
  { id: 'week', scope: null, open: async (p) => { await tab(p, '周课表') } },
  { id: 'week-list', scope: null, open: async (p) => { await tab(p, '周课表'); await p.locator('[data-week-sub-list]').first().click(); await p.waitForTimeout(420) } },
  { id: 'me', scope: null, open: async (p) => { await tab(p, '我的') } },
  {
    id: 'me-open', scope: null, open: async (p) => {
      await tab(p, '我的')
      for (let i = 0; i < 20; i++) {
        const b = p.locator('main[data-page="me"] button', { hasText: '打开' })
        if (!(await b.count())) break
        await b.first().click().catch(() => {}); await p.waitForTimeout(140)
      }
      await p.waitForTimeout(300)
    },
  },
  { id: 'sheet-evt', scope: '[data-sheet-evt]', open: async (p) => { await tab(p, '今日'); await p.locator('button', { hasText: '添加日程' }).first().click(); await waitSheet(p, '[data-sheet-evt]') } },
  { id: 'sheet-todo', scope: '[data-sheet-todo]', open: async (p) => { await tab(p, '今日'); await p.locator('button', { hasText: '添加待办' }).first().click(); await waitSheet(p, '[data-sheet-todo]') } },
  { id: 'habit-sheet', scope: '[data-habit-sheet]', open: async (p) => { await tab(p, '今日'); await p.locator('[data-today-habit-more]').first().click(); await waitSheet(p, '[data-habit-sheet]') } },
  { id: 'sheet-review', scope: '[data-sheet-review]', open: async (p) => { await tab(p, '今日'); await p.locator('[data-review-start]').first().click(); await waitSheet(p, '[data-sheet-review]') } },
  {
    id: 'sheet-detail', scope: '[data-sheet-detail]', open: async (p) => {
      await tab(p, '周课表')
      /* 详情挂在课程卡 article 上；`[data-cell]` 只是格子容器，点它不开详情 */
      const card = p.locator('main[data-page="week"] article[data-item-type]').filter({ hasText: '线性代数' }).first()
      await card.scrollIntoViewIfNeeded().catch(() => {})
      await card.click({ timeout: 3000 }).catch(() => {})
      return waitSheet(p, '[data-sheet-detail]')
    },
  },
  {
    id: 'add-pick', scope: '[data-add-pick]', open: async (p) => {
      const at = await openAddPick(p)
      return at ? waitSheet(p, '[data-add-pick]') : false
    },
  },
  {
    id: 'sheet-add', scope: '[data-sheet-add]', open: async (p) => {
      const at = await openAddPick(p)
      if (!at) return false
      await p.locator('[data-add-pick] [data-pick-course]').first().click({ timeout: 3000 }).catch(() => {})
      return waitSheet(p, '[data-sheet-add]')
    },
  },
]

/* ---------------- 跑 ---------------- */
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const lines = []
const say = (s) => { console.log(s); lines.push(s) }
let problems = 0
const shots = []
/* SHOT_ALL=1 时把「要出报告对照」的几个状态都存图（含 0 问题的）；默认只存有问题的前 14 张 */
const SHOT_ALL = process.env.SHOT_ALL === '1'
const SHOT_IDS = ['today', 'week', 'week-list', 'me', 'me-open', 'sheet-evt', 'sheet-review', 'habit-sheet']
async function shoot(page, st, theme, vp) {
  if (SHOT_ALL ? !SHOT_IDS.includes(st.id) : shots.length >= 14) return
  const png = `tmp/qa-${st.id}-${theme}-${vp.tag}.png`
  await page.screenshot({ path: png }).then(() => shots.push(png)).catch(() => {})
}

for (const vp of [{ w: 360, h: 640, tag: '360x640' }, { w: 390, h: 844, tag: '390x844' }]) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2 })
    await ctx.addInitScript(SEED, [DOC_STR])
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.goto(BASE + '?t=10:30', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    await page.evaluate((t) => localStorage.setItem('web2.theme', t), theme)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)

    say(`\n${'='.repeat(72)}\n## ${vp.tag} / ${theme}\n${'='.repeat(72)}`)
    for (const st of STATES) {
      await page.goto(BASE + '?t=10:30', { waitUntil: 'domcontentloaded' }).catch(() => {})
      await page.waitForTimeout(500)
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('main').forEach((m) => (m.scrollTop = 0)) })
      const ok = await st.open(page)
      await page.waitForTimeout(450)
      if (ok === false) { say(`  [${st.id}] 打不开（入口没命中），跳过`); continue }
      const f = await page.evaluate(AUDIT, { scopeSel: st.scope })
      const head = `  [${st.id}]`
      const hits = f.overflow.length + f.escape.length + f.tiny.length + f.contrast.length + f.occluded.length + f.tall.length + f.nan.length
      if (!hits && !f.weak.length && !f.tinyWarn.length) {
        say(`${head} 无问题${f.note.length ? '（' + f.note.join('；') + '）' : ''}`)
        await shoot(page, st, theme, vp)
        continue
      }
      problems += hits
      const skipNote = f.translucent || f.gradient || f.unparsed ? `（对比度判定另跳过 半透明 ${f.translucent} / 渐变底 ${f.gradient} / 颜色解析失败 ${f.unparsed} 处）` : ''
      say(`${head} ${hits} 处问题${f.note.length ? '（' + f.note.join('；') + '）' : ''} ${skipNote}`)
      for (const x of f.nan.slice(0, 5)) say(`      E0 异常文案 "${x.text}" @ ${x.path}`)
      if (f.nan.length > 5) say(`      E0 异常文案 …另有 ${f.nan.length - 5} 处`)
      for (const x of f.overflow) say(`      E1 横向溢出 ${x.where}: scrollW=${x.scrollW} clientW=${x.clientW} (+${x.scrollW - x.clientW})`)
      for (const x of f.escape.slice(0, 8)) say(`      E2 出界 ${x.sel} left=${x.left} right=${x.right} w=${x.w} ← ${x.text}`)
      if (f.escape.length > 8) say(`      E2 出界 …另有 ${f.escape.length - 8} 个`)
      for (const x of f.tiny) say(`      E3 触控目标 ${x.w}×${x.h} ${x.sel} ← ${x.text}`)
      if (f.tinyWarn.length) say(`      · 触控目标 24–32px（达 WCAG AA，未达 44px 建议，未计入问题）${f.tinyWarn.length} 处：${f.tinyWarn.slice(0, 4).map((x) => `${x.w}×${x.h} ${x.text || x.sel}`).join(' / ')}${f.tinyWarn.length > 4 ? ' …' : ''}`)
      for (const x of f.contrast.slice(0, 6)) say(`      E4 低对比 ${x.ratio} (需 ${x.need}) ${x.size}px ${x.sel} fg=${x.color} bg=${x.bg} ← ${x.text}`)
      if (f.contrast.length > 6) say(`      E4 低对比 …另有 ${f.contrast.length - 6} 个`)
      if (f.weak.length) say(`      · 偏低（未计入问题）${f.weak.length} 处，最差 ${f.weak[0].ratio} ← ${f.weak[0].text}`)
      for (const x of f.occluded) say(`      E5 被遮挡 ${x.sel} ← ${x.text} 被 ${x.coveredBy} 盖住（${x.hitText}）`)
      for (const x of f.tall) say(`      E6 浮层超屏 ${x.sel} ${JSON.stringify(x)}`)
      await shoot(page, st, theme, vp)
    }
    if (errs.length) say(`  ! 页面报错 ${errs.length} 条：${errs.slice(0, 3).join(' | ')}`)
    await ctx.close()
  }
}

say(`\n${'='.repeat(72)}\n合计：${problems} 处问题；截图 ${shots.length} 张（${shots.join(', ')}）`)
writeFileSync('tmp/quality-scan.txt', lines.join('\n') + '\n', 'utf8')
console.log('\n已写出 tmp/quality-scan.txt')
await browser.close()
