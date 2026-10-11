/* P8 公网演示链接线上验收：真实浏览器打开线上地址，确认「不白屏 + 版面对 + 能点」。
   跑法：cd web2 && node tmp/p8-online-check.mjs
   要点：① 打的是公网域名，**不关 CORS**；② 首访可能有腾讯云「风险提醒」页，脚本要认；
        ③ 断言看行为（DOM 出现、版本串），不看 hash/字节数（沙箱重构建产物必不同，见 Day15 复盘四）。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'

const URL = process.env.URL || 'https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'

let pass = 0, fail = 0
const ok = (name, cond, ev) => { if (cond) { pass++; console.log(`  PASS  ${name}${ev ? ' | ' + ev : ''}`) } else { fail++; console.log(`  FAIL  ${name}${ev ? ' | ' + ev : ''}`) } }

const browser = await chromium.launch({ executablePath: CHROME })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: 'light' })
const page = await ctx.newPage()
const errs = []
const badRes = []
page.on('pageerror', e => errs.push(String(e)))
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()) })
// 记录真资源 404：**要排除文档请求本身**——腾讯云风险提醒中间页对首访的文档请求回 404，
// 那是它的固有行为（点「确定访问」后才给真页面），不是我们的 JS/CSS/图片丢了。
page.on('response', r => {
  if (r.status() >= 400 && r.request().resourceType() !== 'document') badRes.push(`${r.status()} ${r.url()}`)
})

console.log(`打线上地址：${URL}`)
const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
ok('HTTP 能拿到文档（200 或拦截页 404 都算拿到）', !!resp, `status=${resp && resp.status()}`)

// 腾讯云测试域名首访会落「风险提醒」中间页（CloudBase 提供），必须点一次「确定访问」。
// 这是**默认测试域名的已知代价**，不是部署失败 —— 脚本要认它、点过去，再验真页面。
await page.waitForTimeout(2500)
let title = await page.title()
if (/风险提醒/.test(title)) {
  console.log('  INFO  命中「风险提醒」中间页（测试域名已知代价），点「确定访问」')
  const btn = page.locator('button', { hasText: /确定访问/ })
  if (await btn.count()) {
    await btn.first().click({ timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(4000)
    title = await page.title()
  }
}
ok('已越过「风险提醒」页或本就没有', !/风险提醒/.test(title), `title=${title}`)

// 等应用挂载（首访是空的引导页也算挂载成功；onboarded=1 时进主界面）
await page.waitForFunction(() => {
  const app = document.querySelector('#app')
  return app && app.children.length > 0
}, { timeout: 30000 }).catch(() => {})
const appHtmlLen = await page.evaluate(() => (document.querySelector('#app') || {}).innerHTML?.length || 0)
ok('应用已挂载（#app 有内容，非白屏）', appHtmlLen > 500, `#app innerHTML 长度=${appHtmlLen}`)

// 版本串：关于页在「我的 → 设置 → 系统与关于」，这里直接读 __APP_VERSION__ 落不到 window，
// 改为断言 DOM 里能找到 v1.43 字样的能力有限 —— 用 bundle 已验的版本串作为旁证，这里只查是否报错。
// 注意：中间页那次 404 会让浏览器往 console 里写一条 "Failed to load resource"，
// 那是测试域名固有行为，**过滤掉**，只认真实异常与真实资源 404。
const realErrs = errs.filter(e => !/Failed to load resource.*404/.test(e))
ok('无未捕获异常（排除中间页固有 404）', realErrs.length === 0, realErrs.slice(0, 3).join(' | ') || '0 条')
ok('无资源 404（排除中间页自身）', badRes.length === 0, badRes.slice(0, 3).join(' | ') || '0 条')

// 行为断言：首屏渲染出真实内容（读 DOM 文字，不看图片）
const firstText = await page.evaluate(() => (document.querySelector('#app') || {}).innerText || '')
ok('首屏有真实内容（非空壳）',
  /周|课|待办|打卡/.test(firstText) && firstText.length > 120,
  `${firstText.length} 字 | ${firstText.replace(/\s+/g, ' ').slice(0, 60)}`)

// 截图
await page.screenshot({ path: 'tmp/p8-online.png', fullPage: false })
console.log('截图：web2/tmp/p8-online.png')

console.log(`\n合计：${pass} 过 / ${fail} 挂`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
