/* A4 诊断件：看清 Tailwind v4 的 `/70` 透明度修饰符在 getComputedStyle 里到底长什么样。
   背景：quality-scan 的 E4 用 /rgba?\(/ 解析颜色，`text-ink-dim/70` 这类如果算出来是
   `color(srgb … / 0.7)`，解析会返回 null → 整类带 alpha 的浅色文字被静默跳过。 */
const { chromium } = await import('file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs')

const BASE = process.env.TW_URL || 'http://127.0.0.1:4177/'
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const page = await browser.newPage({ viewport: { width: 360, height: 640 } })
await page.addInitScript(() => {
  localStorage.setItem('web2.onboarded', '1')
  localStorage.setItem('web2.theme.auto', '0')
  localStorage.setItem('web2.theme', 'light')
})
await page.goto(BASE, { waitUntil: 'load' })
await page.click('nav button:has-text("我的")')
await page.waitForTimeout(400)
/* 展开设置折叠，把 /70 /60 /80 这些浅色文字都露出来 */
for (let i = 0; i < 6; i++) {
  const b = page.locator('main[data-page="me"] button:has-text("打开")')
  if (!(await b.count())) break
  await b.first().click().catch(() => {})
  await page.waitForTimeout(150)
}
const res = await page.evaluate(() => {
  const seen = new Map()
  for (const el of document.querySelectorAll('*')) {
    if (!el.childNodes.length) continue
    const has = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue && n.nodeValue.trim())
    if (!has) continue
    const c = getComputedStyle(el).color
    const cls = String(el.className || '').slice(0, 70)
    const k = c + ' ## ' + cls
    if (!seen.has(k)) seen.set(k, el.textContent.trim().slice(0, 24))
  }
  return [...seen].map(([k, t]) => k + '  ← ' + t)
})
const odd = res.filter((r) => !/^(rgba?\(|rgb\()/.test(r))
console.log('颜色格式种类：', res.length, '；其中非 rgb() 开头：', odd.length)
for (const r of odd.slice(0, 30)) console.log('  ' + r)
console.log('---- 抽样：class 带 ink-dim/ 或 primary-500 的 ----')
for (const r of res.filter((x) => /ink-dim\/|primary-500/.test(x)).slice(0, 20)) console.log('  ' + r)
await browser.close()
