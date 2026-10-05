/* 把静态示意图 HTML 渲染成 PNG（不跑 App、不写业务代码）。
   用法：node tmp/render-mock.mjs tmp/xxx.html tmp/xxx.png [宽 高]
   固定加 retina 2x，字体走系统（Windows 上中文用雅黑）。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const [src, out, w = '1330', h = '1020'] = process.argv.slice(2)
if (!src || !out) {
  console.error('用法：node tmp/render-mock.mjs <in.html> <out.png> [宽] [高]')
  process.exit(1)
}
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const page = await browser.newPage({
  viewport: { width: Number(w), height: Number(h) },
  deviceScaleFactor: 2,
})
await page.goto(pathToFileURL(resolve(src)).href, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.screenshot({ path: resolve(out), fullPage: true })
const box = await page.evaluate(() => ({
  w: document.documentElement.scrollWidth,
  h: document.documentElement.scrollHeight,
  fonts: document.fonts ? document.fonts.size : -1,
}))
console.log(`${out} ✓ 内容尺寸 ${box.w}×${box.h}（2x 输出）`)
await browser.close()
