---
name: verify-project
description: 发布前检查清单——密钥与仓库卫生、云端错误口径、前端不变量、构建与质量门、出包链、纪律项，共 18 条。每次要交付（推代码 / 出 APK / 发演示链接）之前跑一遍 skills/verify-project/verify.mjs，逐项 PASS/FAIL 带证据，末尾给总结论。
---

# verify-project —— 发布前检查

> 用途：交付前的最后一道闸。**一条命令**把「可能悄悄坏掉」的环节全查一遍，输出逐项 `PASS/FAIL/SKIP` + 一行证据，末尾给「发布检查：通过 / 未通过」。
> 原则：每一条都来自本项目**真实踩过的坑**，不是形式主义——违反过就会出真 bug（跨域报错、环境变量没生效、重复写入、假 release 包…）。

## 怎么跑

```bash
node skills/verify-project/verify.mjs          # 全量（含构建 / 质量扫描 / 基线 / 验包，几分钟）
node skills/verify-project/verify.mjs --fast   # 快档：跳过 D2/D3/D4/E1（改动前端小逻辑时用）
```

退出码即结论：**任一 FAIL → 1；全 PASS（SKIP 不算 FAIL）→ 0**。明细会同时写进 `skills/verify-project/last-run.txt`，方便归档和贴图。

## 检查项（18 条）

### A 组｜密钥与仓库卫生
| # | 检查 | 通过标准 |
|---|---|---|
| A1 | 跟踪文件里没有真实密钥 | 按密钥**真实形状**（`AKID…` / 私钥块 / `sk-…` / JWT / 带密码连接串 / 赋值型真值）扫全部跟踪文本文件，0 命中 |
| A2 | `.gitignore` 否定规则生效 | `git check-ignore -v .env.example` **无输出**（放行）、`.env` 与 `cloudbaserc.json` 命中规则（忽略） |
| A3 | 机密文件未被跟踪 | `git ls-files` 里没有 `.env` / `cloudbaserc.json` / `*.key` / `*.pem` |
| A4 | 占位符模板已入库 | `.env.example` + `cloudbaserc.example.json` 都在且都被跟踪 |

### B 组｜云端错误口径
| # | 检查 | 通过标准 |
|---|---|---|
| B1 | 两份 `errors.js` 逐字节一致 | `cloudfunctions/list/errors.js` 与 `cloudfunctions/write/errors.js` **裸 SHA256 相同**（项目规矩八.5）。⚠ 坑：本仓 `core.autocrlf=true`，若只有一侧被 git 改写成 CRLF，裸字节就不相等；证据里会区分「内容真不同」和「纯 CRLF/LF 差异」，后者用 `git -c core.autocrlf=false checkout -- <文件>` 还原 |
| B2 | 失败响应是人话 | **实调**两份模块的 `toResponse()`，喂 `Error` / `{}` / `null` / 字符串 四类输入，每个都返回 `{ok:false,kind,message,status}` 且 message 非空、不含 `[object Object]` |

### C 组｜前端不变量
| # | 检查 | 通过标准 |
|---|---|---|
| C1 | `APP_CTX` 无漏解构 | `node web2/tmp/gen-app-ctx.mjs --check` exit 0 且不报「过期」 |
| C2 | 二级页安全区 | `node web2/tmp/safe-area-check.mjs` 全通过 |
| C3 | 时间行只有一处实现 | 全仓 `web2/src` 下 `RowItem` 实现处数量 = 1 |

### D 组｜构建与质量门
| # | 检查 | 通过标准 | 档位 |
|---|---|---|---|
| D1 | 本地静态服务可访问 | `127.0.0.1:4177` 探通；**没起就自己 detached 拉起**再探 | 全档 |
| D2 | 生产构建通过 | `vite build` exit 0 且 `web2/dist/index.html` 存在 | 全量 |
| D3 | 全页质量扫描 0 处问题 | `node tmp/quality-scan.mjs` 输出「合计：0 处问题」 | 全量 |
| D4 | 测试基线无非 0 退出 | `node tmp/day19-baseline.mjs` 产物 `tmp/day19-baseline.txt` 里 `[exit N]` 行的非 0 数 = 0（⚠ 该脚本控制台**不打印汇总句**，末行只是失败脚本名，所以必须读产物文件而不是 grep 控制台。⚠ **凌晨跨零点跑会假红**：`grid-status-check` / `rec-assoc-check` / `listen-ui-check` / `wheel-touch-gesture-check` / `numberwheel-touch-check` 拿 `new Date()` 造相对当前时刻 fixture 的脚本跨零点自洽性会崩，白天同样代码全绿。2026-10-15 起：`grid-status-check` / `rec-assoc-check` 在本地时间 `<2 点` 或 `>=23 点` 时**直接 SKIP**（该时刻不可构造，不算 FAIL）；`lively-check` 的时段档位、`device-s1s8-check` 的时刻 fixture 已钉死；`wheel-touch-gesture-check` / `numberwheel-touch-check` 未处理。**2026-10-16 又修两个**：`habits-check` 崩在设置页多出来的「从归档恢复」file input（与「导入主项目数据」`accept` 相同 ⇒ strict mode violation；选择器加 `:not([data-archive-file])`）；`numberwheel-touch-check` 的 B5 由「≥18 格」放宽为「明显多滑 ≥10 格」（CDP 派发间隔抖动导致末速在 1200~2700px/s 之间跳，精确映射交给纯函数单测）。遇红先用 A/B 区分真回归还是既有问题） | 全量 |

### E 组｜出包链
| # | 检查 | 通过标准 | 备注 |
|---|---|---|---|
| E1 | APK 三方一致 | `web2/dist ↔ app/www ↔ APK` 逐文件 SHA256 一致 | 无 APK 或 APK 比 dist 旧 → SKIP（不算 FAIL，但会明说）。⚠ **判据是 mtime**（`apks[0].mtime < newestDist`），而**全档 verify 自己的 D2 会重建 `web2/dist`** ⇒ 只要同一趟里跑过 D2，E1 必然 SKIP（2026-10-15 实测：出包后跑全档仍 SKIP）。**要看真结论就绕过 mtime 直接跑** `python web2/tmp/verify-apk.py <apk路径>`（应输出 `dist vs APK = 一致 / dist vs www = 一致 / 版本串 = 命中` 且 exit 0） |
| E2 | release 不是假包 | `apksigner verify --print-certs` 的 DN 不含 `Android Debug` | 只有 debug 包 → SKIP。⚠ Windows 上必须经 `cmd /c <apksigner.bat>` 调用：直接 spawn `.bat` 会 `exit=null` 且读不到 DN |
| E3 | 版本号处处对 | `web2/package.json` = dist 内嵌版本 = 最新 APK 名版本 | 全档 |

### F 组｜纪律项
| # | 检查 | 通过标准 |
|---|---|---|
| F1 | 推送前连通性预检 | **实地**探 `https://github.com`（环境变量代理为空也要探），失败则回退 `git ls-remote origin` |
| F2 | 动了数据模型则三份文档同步 | 本次改动/最新提交若碰了 `store.js` / `schema_version`，则 `大学生日程助手-设计方案.md` / `PRD.md` / `TECH_DESIGN.md` 三份都得在改动清单里；没碰模型则直接 PASS |

## SKIP 的口径

`SKIP` 意为「本机条件下这条无从判定」，**不算 FAIL、退出码仍可为 0**，但总结论会明确列出跳过了哪几条。触发 SKIP 的情形：

- `--fast` 跳过 D2 / D3 / D4 / E1（快档不做出包链与重活）。
- E1 / E2：本机没有 APK 产物，或最新 APK 比 `web2/dist` 旧（说明有改动还没出包）——这时应去壳仓跑 `npm run ship` 而不是把检查判红。

## 改检查项的规矩

1. 新增检查项必须写清**执行命令 + 通过标准**，并且能在输出里给出一行证据；不给证据的检查项等于没检查。
2. 新写的检查项**先自证会报红**：故意造一个坏样例，确认它真的 FAIL，再恢复。静默假通过的检查器比没有检查器更危险。
3. 检查器本身**只读**：除 D1 起服务、D2/D4 落构建与基线产物外，不许写入被检查的文件。
4. 动了项目真实踩过的坑 → 顺手加一条进来（坑的来源写在证据文案里）。

## 调用记录

> 每次真实调用本清单，在这里追加一行：日期 ｜ 用在哪个改动 ｜ 结论（几条 PASS/FAIL/SKIP、有无新增规则）。

- 2026-10-09 ｜ Day 25 制作本 Skill（板块③实跑验证）｜ 首轮跑出误报并修正；随后故意改坏 `cloudfunctions/list/errors.js` 一个字节，确认 B1 真的报 FAIL，`git checkout` 恢复后复跑全绿。
- 2026-10-10 凌晨 ｜ Day 25 全量实跑 ｜ 16 PASS / 1 FAIL（D4）/ 1 SKIP（E1）。D4 的 5 个红（`grid-status-check` / `listen-ui-check` / `numberwheel-touch-check` / `wheel-touch-gesture-check` / `rec-assoc-check`）经 A/B 实测（`git checkout HEAD -- web2/src/App.vue` 后逐条结果完全一致）确认是**既有问题、与当时未提交的改动无关**；这些脚本都用 `new Date()` 造相对当前时刻的 fixture，跨零点跑会自洽性崩掉（HEAD 基线是当天 12:21 记的，本次跑在 00:15–00:40）。白天复跑是否全绿**尚未验证**。当日新增/修正 4 处检查器自身 bug：E3 版本号误报、D4 解析（读产物而非 grep 控制台）、B1 行尾陷阱文档、E2 经 `cmd /c` 调 apksigner。
- 2026-10-10 ｜ Day 25 二次自证 ｜ 再次故意给 `cloudfunctions/list/errors.js` 追加一行（8992 → 9061 B）→ B1 报 FAIL（blob `91b3460308b4…` ≠ `b9ebce728f76…`）→ `git -c core.autocrlf=false checkout --` 还原 → 快档复跑 13 PASS / 0 FAIL / 5 SKIP，exit 0。
- 2026-10-15 ｜ 清 Day 28 遗留的三条红项 ｜ 三条逐一查清并修好：① `rec-preview-check` **48/48**（J 段真因 = 导入后落回「今日」tab，周课表整页还在三页平移层里、左边界 x=407 > 视口 390 ⇒ 点格子报 `outside of the viewport`；修法 = 先点 `[data-nav="week"]` 再量，并加 `J0` 把「切到周课表」这个前提断言出来）；② `wheel-touch-gesture-check` **18/18**（C2 是**断言写错**：分钟列 12 项循环，快拖一轮 = 拖动 3 格 + 惯性 6 格 = 前进 45 分钟，而「前进 45 分」与「后退 15 分」落在同一个值上，旧断言 `Number(seen[0]) > Number(startVal)` 看到 30 → 15 必然假红；改成慢拖（帧间隔 80ms ⇒ 末速 125px/s < FLING_MIN_V 不叠惯性、一轮正好 3 格 = 15 分钟 < 半圈）+ 按**循环差**判方向）；③ `numberwheel-touch-check` **19/19**（B5 属临界：甩动 18.0 格 对 阈值 ≥18）。⚠ **新增第三类红：环境类（本机 headless Chrome GPU 合成不产帧）** —— 实测 `requestAnimationFrame` 6 秒一次都不响、CSS 过渡冻在起始帧（BottomSheet 停在 `slide-enter-from` 的 translateY(100%)）⇒ 触摸手势类断言与 `locator.click()` 的 actionability「stable」判定全假红；三个脚本的 `chromium.launch` 都补了 `args: ['--disable-gpu']`（加完 rAF 20ms 就响）。**遇红先分三型**：真回归 / 凌晨跨零点 fixture / 不产帧环境。
- 2026-10-15 深夜 ｜ 全档收尾（出包 + 部署后复核）｜ **17 PASS / 0 FAIL / 1 SKIP，exit 0**。D4 = 「109 个脚本，非 0 退出 1 个（`callout-check.mjs`）｜ 单独复跑稳定红 0 个 ⇒ 抖动绿不拦」（新判据首次真实生效）。唯一 SKIP 是 `E1`：**判据是 mtime，而 D2 刚重建过 dist**，出包也照样 SKIP —— 直接跑 `verify-apk.py` 得 exit 0 三级一致。**顺手拆掉 E1 里一颗埋伏的雷**：`web2/tmp/verify-apk.py` 在 **GBK 控制台**下打印 `↔` 会 `UnicodeEncodeError: 'gbk' codec can't encode character '\u2194'` 并以 exit 1 崩掉（2026-10-15 实测；此前 E1 长期因 mtime 提前 return，这颗雷一直没被踩到）⇒ 脚本头部加 `sys.stdout.reconfigure(encoding='utf-8', errors='replace')`，并在 `verify.mjs` 的 `run()` 增加 `opts.env` 透传、E1 调用处传 `PYTHONIOENCODING: 'utf-8'`（双保险）。复核：不带任何环境变量直接跑 `verify-apk.py` = 打印正常 + exit 0。
- 2026-10-15 ｜ 轻量化收尾：D4 判据改「只认稳定红」+ 四个脚本钉死时钟 ｜ ① `tmp/day19-baseline.mjs` 由**串行**改**并发 3**（新增环境变量 `BASE_CONCURRENCY` / `BASE_ONLY` / `BASE_TIMEOUT_MS`，单脚本超时 120s → 90s）；② `verify.mjs` 的 D4 判据改成「**批跑红但单独复跑绿 = 抖动，不判 FAIL**」（`d4ok = bad===0 || (bad 列表非空 && 稳定红列表为空)`）；③ `device-s1s8-check` 假红根因 = fixture 用 `now ± N 小时` 造「进行中 / 即将开始」，凌晨跑跨零点自洽性崩（`S3b` 只剩 1 条活行、40px）⇒ 改成钉死钟点的 fixture；④ `lively-check` D4 假红根因 = 主题选档读**真实小时**（`?t=` 后门只管「现在」游标 / 活进度条，**不管主题档**——实测 `?t=11:00` 时 22 点仍落「夜里」），而断言里的 `h` 取的是脚本启动时抓的 `now`（可能早好几分钟）⇒ 改为在点开开关的当口现读 `new Date().getHours()`，并给 D 段传 `t=11:00` 钉死本段其它时刻项；⑤ `grid-status-check` / `rec-assoc-check` 加零点守卫（本地时间 `<2 点` 或 `>=23 点` 直接打印 SKIP 原因后退出——这种时刻「今天的课」不可构造）；⑥ `listen-ui-check` 无需改（`listen-ui-check.mjs:107` 自带 `pastWindow = nowH >= 23` 的自洽分支）。复跑：`lively-check` 31/0、`grid-status-check` 6/6、`rec-assoc-check` 18/18、`listen-ui-check` 92/0。
- 2026-10-16 ｜ 05 全量归档带来的两个检查器红项（**都是检查器侧，不是产品 bug**）｜ ① `habits-check.mjs:178` 崩在 `locator.setInputFiles: Error: strict mode violation: locator('input[accept=".json,application/json"]') resolved to 2 elements` —— 新增的「从归档恢复」`<input data-archive-file>` 与「导入主项目数据」的 `accept` 完全相同；修法 = 选择器加 `:not([data-archive-file])`（**回归断言：29 过 / 0 挂**）。教训：同页出现同 `accept` 的 file input 时，按属性选必须加锚点。② `numberwheel-touch-check.mjs` 的 B5「快甩档甩动 ≥18 格」**随机红**（实测 4 轮：19.0 / 19.0 / 12.0 / 14.0 格）—— 根因 = CDP 合成触摸的**派发间隔本身在 16~48ms 之间抖**，而末速 = 步长 ÷ 最后两帧间隔，组件按 `VELOCITY_WINDOW=90ms` 取窗口时有时只剩最后两个采样点 ⇒ 同一手势量到的末速在 1200~2700px/s 间跳。两手一起改：**手势 4 步 → 8 步**（总时长 ~64ms → ~128ms，窗口内稳定覆盖 5~6 个采样点）+ **断言由「≥18 格」放宽为「明显多滑 ≥10 格」**（精确的 `v → 格数` 映射与 30 格封顶由纯函数单测 `tmp/wheel-physics-unit.mjs` 钉死：v=1000→10、v=2000→20、v=3000→30、v=20000→仍 30）。改后连跑 4 轮全 **19/19**。**教训：把「精确数值」的断言放在端到端合成手势上必然抖；端到端只断言方向与趋势，数值交给纯函数单测。**
- 2026-10-16 ｜ 五条新功能线 01「反向排课」｜ **17 PASS / 0 FAIL / 1 SKIP，exit 0**（113 个脚本，D4 非 0 退出 **0** 个；唯一 SKIP 仍是 E1 的 mtime 判据）。新增 `tmp/planner-unit.mjs`（纯函数，**56/56**）与 `tmp/planner-ui-check.mjs`（playwright，**26/26**）。**本轮没有发现检查器侧红项**。产品侧顺带修一处真 bug（**影响练耳，不只排课**）：`web2/src/data/listen.js` 的 `itemMinutes()` 原来拿 `notify.js` 的 `at` 当忙时段起点，而 `at` 是**被提前量挪过的提醒时刻**（`NOTIFY_DEFAULTS.minutesBefore = 10`）⇒ 每块忙时段整体前移 10 分钟，**课程开始前的准备时间被误判成空档**（09:30 的课算成 09:20 开始，09:00–09:20 凭空多出一段「空档」，30 分钟的待办因此排不下）；`notify.js:236-238` 的注释本来就把这条纪律写在明面上（「空闲槽要用真实起止算，不能拿被提前量挪过的 `at` 当起点」），代码没照做。修法 = 优先取真实 `start`、`at` 只作兜底；回归加进 `tmp/listen-unit.mjs`（**167 过 / 0 挂**，新增 2 条：起点取真实 `start`、空档右边界是真实上课时刻）。**教训：同一份数据在项目里有「真实时刻」和「提醒时刻」两种语义，拿错一个不会报错，只会算出看似合理的错结果 —— 写 `…-check.mjs` 时专挑这类「两套语义」的字段做断言最划算。**

- 2026-10-16 ② ｜ 五条新功能线 02「纪要作业截止日」｜ **17 PASS / 0 FAIL / 1 SKIP，exit 0**（114 个脚本，D4 非 0 退出 1 个 `ob-ai-cfg-check.mjs`，单独复跑绿 ⇒ 抖动绿不拦；唯一 SKIP 仍是 E1 的 mtime 判据）。新增 `tmp/homework-unit.mjs`（纯函数 **31/31**）与两个既有脚本的加固（`tmp/m4-summarizer-test.mjs` **48/0**、`tmp/m4-summarize-ui-check.mjs` **40/40**）。**本轮发现并修掉一个检查器侧真 bug（很重要，以后每次都在踩）**：`verify.mjs` 的 `git()` 助手直接用 `git status --porcelain`，而 **git 默认把非 ASCII 路径转义成 `"docs/\344\270\213..."` 八进制形式**（`core.quotepath=true` 是默认值）⇒ F2「动了数据模型则三份文档同步」按文件名比对时**永远看不见 `大学生日程助手-设计方案.md` 被改过**，只要动了 `store.js` 就必然假红报「缺：大学生日程助手-设计方案.md」。修法 = `git()` 统一加 `-c core.quotepath=false`（一处改动，所有 git 调用受益）。**教训：把「检查器报红」当产品问题查之前，先确认检查器看的输入本身是不是变形过的 —— 这一条与 05 那次的 `missingDestructures()` 假阳性是同一类病。**
  - 02 顺带的产品侧设计记账：`web2/src/data/homework.js` 的 `parseDueHint` 排除「第 1-5 题」「10-20 页」这类量词需要**两道防线** —— 第一版只写「后面不许跟页/题/章」，实测 `10-20 页` 会**先退化成 `10-2` 再匹配**（读出 2027-10-02），于是又补 `(?!\d)`（后面不许再跟数字）。**教训：正则的「排除」要防的是退化后的部分匹配，不是原串。**

- 2026-10-16 ③ ｜ 五条新功能线 03「时间去哪了」｜ **17 PASS / 0 FAIL / 1 SKIP，exit 0**（116 个脚本，D4 非 0 退出 0 个；唯一 SKIP 仍是 E1 的 mtime 判据）。新增 `tmp/timeline-unit.mjs`（纯函数 **71/71**）与 `tmp/timeline-ui-check.mjs`（界面 **33/33**），并同步了被「我的」页新增入口影响的 `tmp/me-index-check.mjs`（4 个入口变 5 个，A2/A3/G1 三处断言跟着改，**30 项通过 / 0 项失败**）。
  - 03 顺带的产品侧真 bug（**最隐蔽的一个，因为它不报错**）：`App.vue` 的 `snapshotToday()` 在「这一分钟没有新读数」时给 `upsertDay` 传了 **`null`**，而 `upsertDay` 的纪律是「**显式传值才动**」—— 传 `null` 等于说「今天没抓到」，把先前记下的手机时长抹掉；静默快照每分钟跑一次，于是真机上表现为「权限开了却天天显示未开启」，无报错无红。修法 = 没有新读数时传 `undefined`（别动）。**教训：`null` 表达「这次没有新值」会与「显式设为空」撞车，凡是「显式传值才动」的 API 都要在调用点把空值语义写清楚。**
  - 03 的检查器经验：新增二级页入口/新增 `data-*` 锚点会让**别人的** UI 自检红（`me-index-check` 按入口个数与文案断言）。**教训：往已有界面加东西时，先 grep 一下哪些自检脚本在对这段 DOM 做断言。**
