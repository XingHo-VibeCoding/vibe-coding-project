/* Day 28 两张交付图（本地生成，不联网）
   图 1 release-archive/v1.2/验收清单-Day28.png   —— 附录 J 式验收清单逐项打勾
   图 2 release-archive/v1.2/公网打开-Day28.png   —— 模拟手机外壳 + 地址栏 + 公网作品全页截图
   用法：node tmp/day28-checklist-shot.mjs          （先跑过 day28-online-acceptance.mjs 拿到页面截图） */
import { chromium } from 'file:///C:/Users/26502/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = path.resolve('../release-archive/v1.2')
const PAGE_SHOT = path.resolve('tmp/day28-shots/online-today.png')
const URL = 'https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/'

const ITEMS = [
  ['作品有公网地址，打开就是作品本身', 'PASS', 'title=大学生日程助手（首访点一次「确定访问」）'],
  ['线上产物与入库归档逐名一致', 'PASS', '线上 = 归档 = assets/index-DCzAj8UX.js + index-F09JQENE.css'],
  ['手机视口不横向溢出', 'PASS', '390×844，scrollWidth- innerWidth = 0px'],
  ['主视图与六类界面都在', 'PASS', '今日 · 周课表 · 我的；含浮层与二级页'],
  ['界面交互有反馈、能撤销', 'PASS', '筛选 aria-pressed 与列表同步；打卡后该条移走'],
  ['云同步整链路（前端→网关→云函数→PostgreSQL）', 'PASS', '上传 rev 1 → 删本机 → 刷新取回 → 清空云端'],
  ['后端接口真读写', 'PASS', 'health 200；list 6/22/10；create 201 → update 200 → delete 200'],
  ['出错时人话 + 可回嘴', 'PASS', '401 缺口令 / 401 口令错 / 405 方法错 / 400 白名单外'],
  ['合法数据来源、敏感信息不进仓库', 'PASS', '只有 .example 入库；cloudbaserc.json 与 .env 被忽略'],
  ['回滚备份底牌在仓库、真演练过', 'PASS（有保留）', '静态托管回滚 18.3 秒；云函数/数据/App 未演练'],
  ['CloudBase 到期与额度如实交代', 'PASS', '体验版到 2027-03-31；其余项目计数为 0'],
  ['全档发布检查一条命令', '16 PASS / 1 FAIL / 1 SKIP', 'FAIL = rec-preview-check 历史环境敏感项'],
]

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const TONE = (r) => (r === 'PASS' ? ['#1F6F54', '#E6F4EE'] : r.startsWith('PASS') ? ['#8A5A00', '#FBF1DC'] : ['#9A3412', '#FDECE3'])
const MARK = (r) => (r === 'PASS' ? '&#10003;' : r.startsWith('PASS') ? '&#10003;' : '&#33;')

const rows = ITEMS.map(([name, res, ev], i) => {
  const [fg, bg] = TONE(res)
  return `<div class="row">
    <div class="no">${String(i + 1).padStart(2, '0')}</div>
    <div class="mid"><div class="name">${esc(name)}</div><div class="ev">${esc(ev)}</div></div>
    <div class="badge" style="color:${fg};background:${bg}"><span class="tick">${MARK(res)}</span>${esc(res)}</div>
  </div>`
}).join('')

const checklist = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1240px;background:#F7F3EC;font-family:"Microsoft YaHei",system-ui,sans-serif;color:#20242B;padding:44px 52px 40px}
  h1{font-size:30px;letter-spacing:.5px}
  .sub{margin-top:10px;font-size:14px;color:#6B7280;line-height:1.7}
  .sub b{color:#20242B;font-weight:600}
  .hero{margin-top:22px;display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #E3DED4;border-radius:14px;padding:16px 20px}
  .big{font-size:38px;font-weight:700;color:#1F6F54;letter-spacing:-1px}
  .hero .t{font-size:15px;font-weight:600}
  .hero .d{font-size:12.5px;color:#6B7280;margin-top:3px}
  .list{margin-top:18px;border:1px solid #E3DED4;border-radius:14px;overflow:hidden;background:#fff}
  .row{display:flex;align-items:center;gap:16px;padding:13px 20px;border-top:1px solid #EFEAE0}
  .row:first-child{border-top:0}
  .no{width:30px;font-size:12px;color:#A8A29A;font-variant-numeric:tabular-nums}
  .mid{flex:1;min-width:0}
  .name{font-size:15px;font-weight:600}
  .ev{margin-top:3px;font-size:12.5px;color:#6B7280}
  .badge{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;border-radius:999px;padding:5px 12px;white-space:nowrap}
  .tick{font-size:13px}
  .foot{margin-top:16px;display:flex;justify-content:space-between;font-size:12.5px;color:#6B7280}
</style></head><body>
  <h1>附录 J · 验收清单（Day 28 结营）</h1>
  <div class="sub">作品：<b>大学生日程助手</b>（Vue3 + Vite + Capacitor / Android）　·　验收日期 <b>2026-10-14</b><br>
  公网作品：<b>${esc(URL)}</b>　·　验收方式：可复现命令与脚本，逐项留证据</div>
  <div class="hero"><div class="big">10</div>
    <div><div class="t">项全 PASS</div><div class="d">另有 1 项 PASS（有保留：回滚只演练了静态托管一条）、1 项部分 PASS（全档检查 16 PASS / 1 FAIL / 1 SKIP，FAIL 已归因为历史环境敏感项）</div></div>
  </div>
  <div class="list">${rows}</div>
  <div class="foot"><span>一条命令跑完 App 侧 A–E 五组：<b>node web2/tmp/day28-online-acceptance.mjs</b> → 18 项通过 / 0 项失败</span><span>结营验收表：docs/Day28-结营验收表.md</span></div>
</body></html>`

const dataUri = fs.existsSync(PAGE_SHOT) ? 'data:image/png;base64,' + fs.readFileSync(PAGE_SHOT).toString('base64') : ''
const phone = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{width:1120px;background:#0F1620;font-family:"Microsoft YaHei",system-ui,sans-serif;color:#E8EDF3;padding:38px 40px 34px}
  .bar{display:flex;align-items:center;gap:14px;background:#182233;border:1px solid #26344A;border-radius:12px;padding:12px 16px}
  .dots{display:flex;gap:6px}.dot{width:10px;height:10px;border-radius:50%;background:#3A4A63}
  .url{flex:1;background:#0F1620;border:1px solid #26344A;border-radius:8px;padding:9px 14px;font-size:14px;color:#7FD1B0;letter-spacing:.2px;overflow:hidden;white-space:nowrap}
  .lock{font-size:13px;color:#5B6B85}
  .stage{margin-top:20px;display:flex;gap:28px;align-items:flex-start}
  .frame{width:390px;border:12px solid #0A0F16;border-radius:44px;overflow:hidden;background:#fff;box-shadow:0 18px 46px rgba(0,0,0,.45)}
  .frame img{display:block;width:100%}
  .note{flex:1}
  .note h2{font-size:22px}
  .note p{margin-top:10px;font-size:14px;line-height:1.85;color:#A9B6C7}
  .note b{color:#E8EDF3}
  .k{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
  .k div{font-size:12.5px;color:#CFE3DA;background:#16261F;border:1px solid #23483A;border-radius:999px;padding:6px 12px}
  .foot{margin-top:22px;font-size:12.5px;color:#6B7C95}
</style></head><body>
  <div class="bar"><div class="dots"><i class="dot"></i><i class="dot"></i><i class="dot"></i></div>
    <span class="lock">&#128274;</span><div class="url">${esc(URL)}</div><span class="lock">已通过腾讯云「确定访问」</span></div>
  <div class="stage">
    <div class="frame">${dataUri ? `<img src="${dataUri}">` : '<div style="height:700px"></div>'}</div>
    <div class="note"><h2>公网地址打开的样子</h2>
      <p>浏览器直接打开上面这条地址就是完整作品：<b>今日 / 周课表 / 我的</b>三个主视图、可滚动与可折叠的头部、浮层与二级页全部在位；<b>390×844 手机视口无横向溢出</b>。</p>
      <p>这张图由验收脚本当场抓取（<b>node web2/tmp/day28-online-acceptance.mjs</b> 的 E1 段，390×844 @2x），不是手工拼的界面。</p>
      <div class="k"><div>title=大学生日程助手</div><div>assets/index-DCzAj8UX.js</div><div>assets/index-F09JQENE.css</div><div>= 归档 release-archive/v1.2</div></div>
    </div>
  </div>
  <div class="foot">截图时间 2026-10-14 ｜ 托管：CloudBase 静态托管（体验版，至 2027-03-31）｜ 归档与线上逐名一致</div>
</body></html>`

const browser = await chromium.launch({ executablePath: CHROME })
fs.mkdirSync(OUT, { recursive: true })
for (const [html, file, width] of [[checklist, '验收清单-Day28.png', 1240], [phone, '公网打开-Day28.png', 1120]]) {
  const p = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 })
  await p.setContent(html, { waitUntil: 'load' })
  await p.screenshot({ path: path.join(OUT, file), fullPage: true })
  await p.close()
  const st = fs.statSync(path.join(OUT, file))
  console.log(`PASS | 已生成 ${file} — ${(st.size / 1024).toFixed(0)} KB`)
}
await browser.close()
