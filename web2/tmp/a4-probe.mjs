/* A4 勘察（临时）：360×640 下列出三个 tab 的可见按钮文案/尺寸、localStorage 键、浮层容器清单
   跑法：先起 dist 静态服务（默认 4177），再 node tmp/a4-probe.mjs */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')
const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)
/* 引导页：2026-10-09 起「先用示例数据逛逛」已删，改为种标记跳过引导（无 web2.data ⇒ 示例态） */
await page.addInitScript(() => { try { localStorage.setItem('web2.onboarded', '1') } catch (e) {} })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(800)

console.log('localStorage 键: ' + await page.evaluate(() => Object.keys(localStorage).map((k) => k + '=' + String(localStorage.getItem(k)).slice(0, 24)).join(' | ')))

for (const [label, key] of [['今日', 'today'], ['周课表', 'week'], ['我的', 'me']]) {
  if (await page.locator('nav button', { hasText: label }).count()) {
    await page.locator('nav button', { hasText: label }).first().click()
  }
  await page.waitForTimeout(500)
  const list = await page.evaluate((k) => {
    const root = document.querySelector(`main[data-page="${k}"]`)
    return [...root.querySelectorAll('button,[role="switch"],a[href]')].map((b) => {
      const r = b.getBoundingClientRect()
      return { t: (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 34), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }
    })
  }, key)
  console.log(`\n=== ${label}（${list.length} 个可点）`)
  for (const b of list) console.log(`  ${String(b.w).padStart(4)}x${String(b.h).padStart(3)} @${b.x},${b.y}  ${b.t}`)
}

console.log('\n=== 浮层容器（DOM 中存在的 data-* 锚点）')
const anchors = await page.evaluate(() => {
  const out = []
  const walk = (el) => {
    for (const a of el.attributes || []) {
      if (a.name.startsWith('data-') && /sheet|pick|review|habit|sem|detail|confirm|picker|onboard|nav/.test(a.name)) out.push(a.name + (a.value ? '=' + a.value : ''))
    }
    for (const c of el.children) walk(c)
  }
  walk(document.body)
  return [...new Set(out)]
})
console.log(anchors.join(' | '))
await browser.close()
