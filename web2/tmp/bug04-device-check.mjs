/* 真机：周课表恒定七列（bug 04，2026-10-23）
 * 前置：adb 在线 + adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 * 跑法：cd web2 && node tmp/bug04-device-check.mjs
 *
 * 结构备忘：[data-grid] 只是**网格本体**（节次行 + 课程格），星期表头是它上面那个
 * <div class="grid" :style="gridColsStyle">，所以表头不能进 [data-grid] 里找。
 */
const PW = 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
const { chromium } = await import(PW)

let pass = 0, fail = 0
function ok(id, what, cond, ev) {
  if (cond) pass++; else fail++
  console.log('  [' + (cond ? 'PASS' : 'FAIL') + '] ' + id + ' ' + what + (ev === undefined ? '' : '  → ' + ev))
}

const b = await chromium.connectOverCDP('http://127.0.0.1:9222')
let p = null
for (const c of b.contexts()) for (const pg of c.pages()) p = pg
console.log('=== 真机 bug04 恒定七列 ===')
console.log('  url=' + p.url())

await p.evaluate(() => { const n = document.querySelector('[data-nav="today"]'); if (n) n.click() })
await p.waitForTimeout(600)
await p.evaluate(() => { const n = document.querySelector('[data-nav="week"]'); if (n) n.click() })
await p.waitForTimeout(1200)

const facts = await p.evaluate(() => {
  const grid = document.querySelector('[data-grid]')
  const section = grid ? grid.closest('section') : null
  const header = section ? section.querySelector(':scope > div.grid') : null
  const heads = header ? [...header.children].map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim()) : []
  /* 表头第一个格子是左上角空白（节次轴那一列），后面才是七个星期 */
  const dayHeads = heads.slice(1)
  return {
    hasGrid: !!grid,
    hasHeader: !!header,
    dayCount: dayHeads.length,
    dayHeads: dayHeads,
    gridCols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
    headerCols: header ? getComputedStyle(header).gridTemplateColumns.split(' ').length : 0,
    scrollW: grid ? grid.scrollWidth : -1,
    clientW: grid ? grid.clientWidth : -1,
  }
})
console.log('  事实: ' + JSON.stringify(facts))

ok('A1 网格在（周课表页真的打开了）', '网格与星期表头都找到了', facts.hasGrid && facts.hasHeader)
ok('A2 表头是七列', facts.dayCount === 7, '数到 ' + facts.dayCount + ' 列')
ok('A3 周日那一列在（bug 04 的核心）', facts.dayHeads.some((x) => x.indexOf('周日') >= 0), JSON.stringify(facts.dayHeads))
ok('A4 网格列数 = 节次轴 + 七天（8）', facts.gridCols === 8, 'gridTemplateColumns 拆出 ' + facts.gridCols)
ok('A5 七列不横向溢出', facts.scrollW <= facts.clientW + 2, facts.scrollW + ' vs ' + facts.clientW)

await p.evaluate(() => { const n = document.querySelector('[data-nav="today"]'); if (n) n.click() })
await b.close()
console.log('\n=== 汇总：' + pass + ' PASS / ' + fail + ' FAIL ===')
process.exit(fail ? 1 : 0)
