/* 用用户实测的两张真实截图，在真实浏览器里验证 compressImageForRecognize：
   1) 第一张教务长图（1264×6315）应切 4 块，每块保持可读尺寸
   2) 第二张日历 App 截图（1264×2780）不切块，压到长边 2000
   只测前端压缩链路，不调 API。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'

const BASE = 'http://127.0.0.1:4177/'
const IMGS = [
  ['教务长图', 'C:/Users/26502/.workbuddy/clipboard-images/clipboard-2026-09-29T04-31-32-627Z-a9d75eb6.jpg'],
  ['日历App截图', 'C:/Users/26502/.workbuddy/clipboard-images/clipboard-2026-09-29T04-31-32-632Z-8eb748df.jpg'],
]

const results = []
function t(name, cond) {
  results.push([name, !!cond])
  console.log((cond ? 'PASS ' : 'FAIL ') + name)
}

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage()
await page.goto(BASE, { waitUntil: 'domcontentloaded' })

for (const [label, path] of IMGS) {
  const b64 = fs.readFileSync(path).toString('base64')
  const out = await page.evaluate(async (b) => {
    const { compressImageForRecognize } = await import('/src/data/recognizer.js')
    const bytes = Uint8Array.from(atob(b), (ch) => ch.charCodeAt(0))
    const file = new File([bytes], 'test.jpg', { type: 'image/jpeg' })
    const { dataUrls, tiles } = await compressImageForRecognize(file)
    // 逐块量尺寸 + 估 base64 体积
    const sizes = []
    for (const du of dataUrls) {
      const img = new Image()
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = du })
      sizes.push({ w: img.naturalWidth, h: img.naturalHeight, kb: Math.round(du.length * 3 / 4 / 1024) })
    }
    return { tiles, sizes }
  }, b64)
  console.log(`  [${label}] tiles=${out.tiles} sizes=${JSON.stringify(out.sizes)}`)
  if (label === '教务长图') {
    t('1. 教务长图切了 4 块', out.tiles === 4 && out.sizes.length === 4)
    t('2. 每块宽度保持原宽（≥1000px，字可读）', out.sizes.every((s) => s.w >= 1000))
    t('3. 每块高度 ≤ 2000（长边约束）', out.sizes.every((s) => s.h <= 2000))
    t('4. 每块体积 ≤ 900KB（请求体安全）', out.sizes.every((s) => s.kb <= 900))
  } else {
    t('5. 日历截图不切块（单图）', out.tiles === 0 && out.sizes.length === 1)
    t('6. 压到长边 2000 内', out.sizes[0].w <= 2000 && out.sizes[0].h <= 2000)
    t('7. 宽度 ≥ 900（比旧策略 682 更可读）', out.sizes[0].w >= 900)
  }
}

await browser.close()
const fails = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
process.exit(fails.length ? 1 : 0)
