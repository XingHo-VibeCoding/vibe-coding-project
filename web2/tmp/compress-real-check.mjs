/* 用用户实测的两张真实截图，在真实浏览器里验证 compressImageForRecognize：
   1) 第一张教务长图（1264×6315）应切 4 块，每块保持可读尺寸
   2) 第二张日历 App 截图（1264×2780）不切块，压到长边 2000
   只测前端压缩链路，不调 API。

   2026-10-04：本脚本有两个**仓库外的前提**，缺任一个都不可能过，长期挂着当红灯：
   ① 要 `import('/src/data/recognizer.js')` —— 这是 Vite dev 的源码路径，dist 静态
      服务（4177）上必然 404。改成自动探测：TW_DEV_URL → 5173 → 4177，都拿不到就 SKIP。
   ② 要用户机器上那两张剪贴板截图（在 ~/.workbuddy/clipboard-images 下）。文件不在就 SKIP。 */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'

const CANDIDATES = [process.env.TW_DEV_URL, 'http://127.0.0.1:5180/', 'http://127.0.0.1:5173/', 'http://127.0.0.1:4177/'].filter(Boolean)
const IMGS = [
  ['教务长图', 'C:/Users/26502/.workbuddy/clipboard-images/clipboard-2026-09-29T04-31-32-627Z-a9d75eb6.jpg'],
  ['日历App截图', 'C:/Users/26502/.workbuddy/clipboard-images/clipboard-2026-09-29T04-31-32-632Z-8eb748df.jpg'],
]

let BASE = ''
for (const c of CANDIDATES) {
  try {
    const r = await fetch(new URL('src/data/recognizer.js', c))
    /* 静态服务常把未知路径回落成 index.html（200 + text/html），光看 r.ok 会被骗：
       必须真的是 JS 才算 —— 否则 page.evaluate 里的动态 import 又会拿到 HTML 而炸。 */
    const ct = r.headers.get('content-type') || ''
    if (r.ok && /javascript|ecmascript/i.test(ct)) { BASE = c; break }
  } catch { /* 端口没服务，继续试下一个 */ }
}
if (!BASE) {
  console.log('SKIP | 全部断言 ← 需要能提供 /src/data/recognizer.js 的 Vite dev server（先 npm run dev，或用 TW_DEV_URL 指定）；已试：' + CANDIDATES.join(' / '))
  process.exit(0)
}
const missing = IMGS.filter(([, p]) => !fs.existsSync(p))
if (missing.length) {
  console.log('SKIP | 全部断言 ← 缺少用户实测截图素材：' + missing.map(([l, p]) => `${l}(${p})`).join('；'))
  process.exit(0)
}
console.log('使用 BASE = ' + BASE)

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
