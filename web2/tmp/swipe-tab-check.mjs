/* 左右滑动手势切 tab 回归（2026-10-01 用户要求「在今日/周课表/我的之间丝滑切换」）。
   实现：strip 平移层 touchstart/move/end——轴向锁定（先动满 12px 判横竖，竖向让位原生
   滚动）、拖动跟手（swipeDx 并进 translateX、期间关 transform 过渡）、松手按
   「位移 >18% 屏宽 或 末速 >0.55px/ms」切相邻 tab，否则回弹；边界页 clamp 拖不动。
   断言（全部读 strip 的 computed transform matrix m41 = -视口宽×tabIndex + swipeDx）：
     A1 今日向左滑到底松手 → 切到周课表（m41 ≈ -390）
     A2 回弹：周课表向右滑 40px 慢松手 → 停在周课表（m41 ≈ -390）
     A3 周课表继续向右滑到底 → 回今日（m41 ≈ 0）
     B1 今日向右滑（边界）→ 拖不动（m41 = 0）
     C1 纵向滑动 → 不切 tab（m41 仍 0）
     D1 快甩 50px（速度够）→ 切到周课表
     E1 横向拖动后松手不误点卡片（详情弹层不出现）
   跑法：先起 dev server（4177）再 node tmp/swipe-tab-check.mjs */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const results = []
function t(name, cond, extra) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  → ' + extra : ''))
}

// TW_URL 可覆盖线上产物做行为断言
const URL = process.env.TW_URL || 'http://127.0.0.1:4177/'
const now = new Date()
const mon = new Date(now)
mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
const MONDAY = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`

const COURSES = [
  { id: 'c1', type: 'course', semester_id: 'sem1', title: '高等数学', location: '教学楼101', weekday: ((now.getDay() + 6) % 7) || 1, start_time: '08:00', duration: 45, week_rule: 'every' },
]
const seedDoc = JSON.stringify({
  app: 'sched', schema_version: 1, exported_at: '2026-10-01T02:00:00.000Z',
  semester: { id: 'sem1', name: '测试学期', first_monday: MONDAY, total_weeks: 16 },
  schedules: COURSES, todos: [],
})

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
await page.addInitScript(`localStorage.setItem('web2.data', ${JSON.stringify(seedDoc)})`)
await page.addInitScript(`localStorage.setItem('web2.onboarded', '1')`)
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)

/* 在平移层上合成一次触摸滑动。moves: [{dx,dy,wait}] 相对起点的增量序列，
   wait 是帧间真实等待 ms——vx = 位移/真实时间，帧间隔必须真实存在 */
async function swipe(x0, y0, moves) {
  await page.evaluate(async ({ x0, y0, moves }) => {
    const el = document.querySelector('main').parentElement // strip 平移层
    const mk = (type, x, y) => {
      const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y })
      el.dispatchEvent(new TouchEvent(type, {
        touches: type === 'touchend' ? [] : [touch],
        targetTouches: type === 'touchend' ? [] : [touch],
        changedTouches: [touch],
        bubbles: true, cancelable: true,
      }))
    }
    mk('touchstart', x0, y0)
    let cx = x0
    let cy = y0
    for (const m of moves) {
      if (m.wait) await new Promise((r) => setTimeout(r, m.wait))
      cx += m.dx
      cy += m.dy
      mk('touchmove', cx, cy)
    }
    mk('touchend', cx, cy)
  }, { x0, y0, moves })
}

const m41 = () => page.evaluate(() => {
  const tr = getComputedStyle(document.querySelector('main').parentElement).transform
  return Math.round(new DOMMatrix(tr).m41)
})

await page.waitForTimeout(300)
console.log('初始 m41:', await m41())

/* A1 今日 → 周课表：向左滑 140px（分帧、中等速度） */
await swipe(330, 500, [{ dx: -25, dy: 0, wait: 0 }, { dx: -35, dy: 0, wait: 0 }, { dx: -40, dy: 0, wait: 0 }, { dx: -40, dy: 0, wait: 0 }])
await page.waitForTimeout(600)
const a1 = await m41()
t('A1 今日向左滑 → 切到周课表', a1 <= -385, `m41=${a1}`)

/* A2 回弹：向右滑 40px 但慢速小幅 → 不切 */
await swipe(80, 500, [{ dx: 12, dy: 0, wait: 45 }, { dx: 14, dy: 0, wait: 45 }, { dx: 14, dy: 0, wait: 45 }])
await page.waitForTimeout(600)
const a2 = await m41()
t('A2 小幅慢滑 → 回弹停在周课表', Math.abs(a2 + 390) <= 6, `m41=${a2}`)

/* A3 周课表 → 今日：向右滑到底 */
await swipe(60, 500, [{ dx: 30, dy: 0, wait: 0 }, { dx: 45, dy: 0, wait: 0 }, { dx: 45, dy: 0, wait: 0 }, { dx: 30, dy: 0, wait: 0 }])
await page.waitForTimeout(600)
const a3 = await m41()
t('A3 周课表向右滑 → 回今日', Math.abs(a3) <= 5, `m41=${a3}`)

/* B1 边界：今日向右滑 → 拖不动 */
await swipe(60, 500, [{ dx: 30, dy: 0, wait: 0 }, { dx: 45, dy: 0, wait: 0 }, { dx: 45, dy: 0, wait: 0 }])
await page.waitForTimeout(600)
const b1 = await m41()
t('B1 第一页向右滑 → 拖不动', Math.abs(b1) <= 5, `m41=${b1}`)

/* C1 纵向滑动 → 不切 tab */
await swipe(200, 300, [{ dx: 0, dy: 25, wait: 0 }, { dx: 0, dy: 35, wait: 0 }, { dx: 0, dy: 35, wait: 0 }, { dx: 0, dy: 25, wait: 0 }])
await page.waitForTimeout(600)
const c1 = await m41()
t('C1 纵向滑动 → 不切 tab', Math.abs(c1) <= 5, `m41=${c1}`)

/* D1 快甩：60px 快速（末速大）→ 切换 */
await swipe(300, 500, [{ dx: -30, dy: 0, wait: 16 }, { dx: -30, dy: 0, wait: 16 }])
await page.waitForTimeout(600)
const d1 = await m41()
t('D1 快甩 60px → 切到周课表', d1 <= -385, `m41=${d1}`)

/* E1 横向拖完松手不误点卡片：滑去又滑回，详情弹层不应出现 */
await swipe(120, 500, [{ dx: 30, dy: 0, wait: 0 }, { dx: 45, dy: 0, wait: 0 }, { dx: 45, dy: 0, wait: 0 }, { dx: 30, dy: 0, wait: 0 }])
await page.waitForTimeout(400)
const e1 = await page.evaluate(() => !document.querySelector('.fixed.inset-0.z-20')) // 详情遮罩未出现
const back = await m41()
t('E1 滑动不误触详情（回今日且无弹层）', e1 && Math.abs(back) <= 5, `m41=${back}`)

await browser.close()
const fails = results.filter((r) => !r[1])
console.log(`\n=== 左右滑动切 tab：${results.length - fails.length}/${results.length} 通过 ===`)
process.exit(fails.length ? 1 : 0)
