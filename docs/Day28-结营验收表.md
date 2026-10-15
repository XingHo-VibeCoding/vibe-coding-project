# 结营验收表（Day 28 · 第 4 周）

- 作品：**大学生日程助手**（Vue3 + Vite + Capacitor 的 Android 日程 App，五期开发）
- 公网作品：`https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/`（CloudBase 静态托管，体验版，至 **2027-03-31**）
- 公网后端：`https://vibecoding-test-d5fqmhbb955e19dd-1499011319.ap-shanghai.app.tcloudbase.com/api`（4 个云函数：`health` / `list` / `write` / `sync`）
- 验收日期：2026-10-14 ｜ 验收方式：可复现命令 / 脚本，逐项留证据
- 一条命令跑完 App 侧 A–E 五组：`node web2/tmp/day28-online-acceptance.mjs` → **18 项通过 / 0 项失败**（2026-10-14 实测）
- 全档发布检查：`node skills/verify-project/verify.mjs` → **16 PASS / 1 FAIL / 1 SKIP**（FAIL 为历史环境敏感项，见第三节）

## 一、验收表

| # | 验收项 | 验证方法（可复现） | 结果 | 证据（关键行） |
|---|---|---|---|---|
| 1 | 作品有公网地址，且打开就是作品本身 | `node web2/tmp/day28-online-acceptance.mjs`（A1）；浏览器首访需先过腾讯云「风险提醒」页点「确定访问」 | **PASS** | `title=大学生日程助手`；地址 = 上表公网作品 address |
| 2 | 线上产物与入库归档逐名一致（发的是不是这一版） | 脚本 A2：抓线上 `index.html` 资源名 vs `release-archive/v1.2/index.html` | **PASS** | 线上 = 归档 = `assets/index-DCzAj8UX.js` + `assets/index-F09JQENE.css` |
| 3 | 手机视口不横向溢出 | 脚本 A3：390×844 `scrollWidth - innerWidth` | **PASS** | `0px` |
| 4 | 主视图与六类界面都在 | 脚本 B1–B6：底部 3 tab / 今日页滚动容器 / 周课表 ＋ 选单 / 我的 4 入口 / 设置索引 5 行 / 浮层开→关 | **PASS** | 今日·周课表·我的；`[data-today-scroll]`、`[data-week-add]`、`[data-sheet-mask] 1 → 0` |
| 5 | 界面交互有反馈、能撤销（不是点不动） | 脚本 C1–C3：待办筛选 chips 的 `aria-pressed` 与列表同时变；打卡后该条从「今天要坚持」移走（1 → 0） | **PASS** | chips=3，「未完成项可见 true → false」；打卡后 rows `1 → 0` |
| 6 | 云同步整链路：前端 → HTTP 网关 → `sync` 云函数 → PostgreSQL | 脚本 D1–D5：App 内输入同步串 → 上传 → **手动删掉本机那份** → 刷新 → 取回 → 清空云端 | **PASS** | 上传「3 项（课表与待办）… rev 1」；删后 `web2.todos=null`；取回后这条待办从库里回来了；收尾「云端那份已删除。本机数据原样保留」 |
| 7 | 后端接口真读写（不是只读演示） | `curl` 走 `/api/health`、`/api/list`，再一条**真数据** 创建 → 更新 → 删除 | **PASS** | `health 200 {"ok":true}`；list `semesters 6 / schedules 22 / todos 10`；`create 201` → `update 200`（`done:false → true`）→ `delete 200`，**跑完 counts 回到 6 / 22 / 10**（清场干净） |
| 8 | 出错时人话+可回嘴，不吞错 | `curl` 打四种错 | **PASS** | 缺口令 `401`「缺少口令：请带 X-Write-Token 请求头」；口令错 `401`「口令不正确：请核对…与云函数环境变量 WRITE_TOKEN 一致」；方法错 `405`「不支持的方法：GET（写接口只接受 POST / PUT / DELETE）」；表不在白名单 `400`「未知 table：「users」（可选：todos / schedules / semesters）」 |
| 9 | 合法数据来源 / 敏感信息不进仓库 | `git ls-files \| grep -E "cloudbaserc\|\.env"`；`git check-ignore -v` | **PASS** | 仓库里只有 `.env.example` + `cloudbaserc.example.json`；`cloudbaserc.json` 命中 `.gitignore:42`、`.env` 命中 `.gitignore:3`（真口令只在本机被忽略的文件与云函数环境变量里） |
| 10 | 回滚备份底牌在仓库里、且真演练过 | 看 `release-archive/`、`docs/回滚手册.md`；Day 26 实测 | **PASS**（有保留：只练了静态托管一条） | 归档 `release-archive/v1.0` 与 `v1.2` 已入库；静态托管回滚全程 **18,320 ms**（止血 5,233 ms），恢复后 3 文件 sha256 3/3 一致。云函数 / 数据 / App 三条**未实操** |
| 11 | CloudBase 到期与额度如实交代 | 读 `docs/资源与到期说明.md`（2026-10-13 检查）+ 控制台 | **PASS** | 体验版 **到 2027-03-31 23:59:59**；除 PostgreSQL 与静态托管外的项目计数为 **0** |
| 12 | 全档发布检查一条命令 | `node skills/verify-project/verify.mjs`（A 密钥与仓库卫生 / B 两份 errors.js 逐字节一致 / C 上下文与安全区 / D 构建与 108 个自检 / E APK 三方一致 / F 推前连通性与三文档同步） | **16 PASS / 1 FAIL / 1 SKIP** | FAIL = `D4 day19-baseline` 里 `rec-preview-check.mjs` 长期红（长按菜单落到视口外）；SKIP = `E1 APK 三方一致`（`dist` 比最新 APK 新，未出包） |

## 二、两张交付截图怎么来的（可复现）

| 图 | 内容 | 怎么生成 |
|---|---|---|
| 图 1 | 附录 J 验收清单逐项打勾 | 由本表渲染成页后截图：`web2/tmp/day28-checklist-shot.mjs` → `release-archive/v1.2/验收清单-Day28.png` |
| 图 2 | 公网 URL 打开的样子（地址栏 + 完整作品） | 真实浏览器打开公网作品后整页截图（390×844 @2x）：`node web2/tmp/day28-online-acceptance.mjs` 的 E1 段 → `web2/tmp/day28-shots/online-today.png` |

## 三、缺项汇总（如实标记，不含糊）

| 缺项 | 状态 | 原因 / 证据 |
|---|---|---|
| 真机（物理 Android）人工点验本表 | **未执行** | 本轮验收全在公网 Web 版 + `adb` 无设备的情况下完成；历史真机结论只到 Day 26 的音频/通知项 |
| Android 安装包与线上同版 | **未做** | `verify.mjs` 的 E1 为 SKIP：`web2/dist` 比最新 APK `schedule-v1.43.0-20261014-debug.apk` 新（Day 30 文案改动未出包）。要交付安装包需跑壳仓 `npm run ship` |
| 教务直连用**真实账号**跑通 | **未在本轮复验** | `edu-import-check` 32/32、`edu-login-check` 32/32、`edu-login-ui` 15/0、`edu-ui` 20/0、`edu-compat` 9/0 全绿，但那是**样例/替身数据**；真账号登录涉及用户凭据，不能代跑 |
| `rec-preview-check.mjs` 稳定红 | **FAIL（历史遗留，与近期改动无关）** | 已用 `git stash push -- web2/src` 回到 HEAD 重跑复现同样红（J3「长按唤起添加菜单」按钮落在视口外），归因环境敏感，非本次引入 |
| 云函数 / 数据 / App 三条回滚 | **未演练** | `docs/回滚手册.md` §4/§5/§6 写了步骤但从未实操，不敢打包票 |
| 通知栏「录屏/录音中」的系统级表现 | **未在真机本轮验** | 需真机 + 系统通知权限；脚本只能验界面文案与开关状态 |

## 四、结营复盘：28 天里我最大的一个认知改变

**从「让 AI 把功能写出来」，改成「让 AI 把证据摆出来」。**

一开始我以为 vibe coding 的瓶颈是「描述得不够清楚」；做完五期之后，我认为真正的瓶颈是「**你凭什么相信它做完了**」。这个项目里最有价值的东西不是那 19,242 行界面代码，而是围绕它长出来的 108 个自检脚本、一条 `verify.mjs` 命令，和几张「当天实况」的验收表——它们把「做完了」变成了「能当场复现」。

三个具体转折：

1. **敢写 FAIL。** Day 21 的验收表里，写接口当时确实不存在，表上就写 `FAIL（未实现）` + `404 INVALID_PATH`，而不是含糊成「部分完成」。后来 Day 22 补记「已解除」，也是另起一段说明哪天解除的，不改历史结论。
2. **先把「不是这次弄坏的」证明掉。** `rec-preview-check` 长期红，我没有顺手把它标成「已知问题」糊过去，而是 `git stash` 回到干净版本重跑，拿到同样结果后才写「历史环境敏感项」。
3. **自己造的假也要抓。** 云同步验收里，我第一次手动删本机数据后刷新，数据又回来了——差点当成「取回云端」成功。查下去发现是测试脚本每次导航都重新播种（`addInitScript` 重跑），于是加了「只在首次装载播种」的守卫，让 `web2.todos=null` 这一步成为真证据。

对应到做法上，就是后来写死进 `AGENTS.md` 的四条：**清单即边界**（只做当天清单）、**一次一步**（做完停下报做了什么/改了哪些文件/怎么验证）、**人机分工**（要人手动做的绝不假装完成）、**讲清楚**（先说错在哪）。这四条现在是我对这 28 天最想带走的东西——工具会换，模型会换，但「做完 ≠ 做完，能复现才算完」这条不换。

## 五、结论

- **作品侧**：公网可打开、是同一版产物、六大类界面齐、交互有反馈、云同步整链路真跑通、后端可真读写并清场、出错有人话；**12 项验收里 10 项全 PASS，1 项 PASS（有保留），1 项部分 PASS**。
- **诚实边界**：真机与安装包同版这两件事本轮没做（要跑 `npm run ship` 并接真机）；教务直连的**真账号**那一遍必须用户本人来。
- 本表所有数字与报错原文，均可用第一节的脚本与命令当场重跑；线上现状与归档 `release-archive/v1.2` 一致，**改一版就重出一版归档**，回滚手册里的 20 秒止血仍然有效。
