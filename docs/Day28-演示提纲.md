# 结营演示提纲（Day 28 · 3–5 分钟）

> 演示前：一个 PowerShell 窗口（停在仓库根）、一个浏览器标签（公网作品）、可选一个 CloudBase 控制台「数据库 → 表行数」页。
> 全程只用**两条命令**：`node web2/tmp/day28-online-acceptance.mjs`、以及一段 `curl`（见 §附）。

## ① 我为什么做它（0:00–0:30）

大学生一天的信息是散的：课表在教务系统、作业在群里、录音在手机里、日程在心里。
**一句话**：把「今天要上什么、要交什么、要坚持什么」压进一个手机 App，并且**离线可用、数据是自己的**——没有账号、不登录、不联网也能记。

## ② 作品长什么样（0:30–1:30）——当场打开公网地址

浏览器打开 `https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/`（首次点一下腾讯云「确定访问」）。

顺着底部三个主视图走一遍：

1. **今日**：顶部是「下一节 · 数据结构 / 14:00 机房 401」，往下是今天要交的待办、今天要坚持的打卡、今天要听的练耳、今天的日精进。上滑头部会**真收缩**成一条状态条并钉在顶上。
2. **周课表**：整周网格，左右滑换周，今天高亮；右上 ＋ 里是「手动加课 / 加日程 / 拍课表识别 / 特殊日期（调休）」。点一节课出详情，长按出快捷菜单。
3. **我的**：学期条 + 录音历史 + 碎片练耳 + 待办清单，再一层是设置索引 5 行（外观 / 提醒 / 录音 / 数据 / 系统），每行直接显示现在的设定。
4. 再点两个浮层：任意「＋ 添加日程」→ 底部弹出表单（第 6 类界面）；「设置 → 数据与导入导出」→ 里面既有**本地 JSON 导入导出**，也有**云同步**。

## ③ 核心流程：一次真交互 + 一次真写入（1:30–3:00）

**A. 本地闭环（30 秒）**：在今日页点待办右侧的圆点打勾 → 同一行立刻出现删除线与置灰；切到「已完成」筛选项 → 那条从「未完成」列表里消失，点回「全部」又回来。**再点一下能撤销**，不是一次性的。

**B. 上云闭环（60 秒，全场唯一的联网动作）**：

1. 设置 → 数据与导入导出 → 云同步，填一个同步串（≥6 字符），点「上传到云」→ 回执「**已上传：3 项（课表与待办），云端现在是最新一版（rev 1）**」。
2. 打开浏览器 DevTools 的 Application → Local Storage，**手动删掉本机那份待办** → 刷新页面 → 待办确实没了（这一步是为了证明不是假证据）。
3. 回云同步点「从云端取回」→ 回执「**已从云端取回：3 项已写进这台设备（rev 1）**」，那条待办**从数据库里回来了**。
4. 结束时点「清空云端」→ 「云端那份已删除。本机数据原样保留」（不留垃圾数据）。

**C. 后端确实在干活（30 秒）**：PowerShell 里跑 `curl`（见 §附），现场看到 `health 200 {"ok":true}`、`list` 的 `semesters 6 / schedules 22 / todos 10`，再**新建→更新→删除一条真数据**，`201 → 200 → 200`，跑完行数**回到 6 / 22 / 10**。

## ④ 我怎么知道它是对的（3:00–4:00）

一条命令：`cd web2 && node tmp/day28-online-acceptance.mjs` → **18 项通过 / 0 项失败**（公网发布 3 项、界面 6 项、交互反馈 3 项、云同步全链路 5 项 + 1 张移动端截图）。

再一条：`node skills/verify-project/verify.mjs` → **16 PASS / 1 FAIL / 1 SKIP**，我**不改这个带 FAIL 的口径**：
- FAIL 是 `rec-preview-check.mjs` 长期红（长按菜单落到视口外）；我用 `git stash` 回到干净版本复现了同样的红，才写「历史环境敏感项，与近期改动无关」。
- SKIP 是「安装包与线上同版」——要出包得跑壳仓 `npm run ship`，本轮没跑，就不假装过了。

还会顺手说三件**没做**的：真机人工点验、教务直连的真账号那一遍、云函数/数据/App 三条回滚从未演练（`docs/回滚手册.md` §4–§6 只写了步骤）。

## ⑤ 提示词/协作方式的改变（4:00–4:30）

**从「帮我写个日程 App」到「清单即边界 + 一次一步 + 先取证再断言」。**

- 开头我只会说功能；后来学会了**把范围钉死**：「只做只读 `GET /api/list`，返回必须带 counts，用来和数据库对账」——一个能当场验证的接口，比十个"差不多能用"的功能有用。
- 中途学会**让 AI 交证据**而不是交结果：改了哪些文件、怎么验证、哪条没过、为什么不是这次弄坏的。
- 收尾学会**把规范写进 `AGENTS.md`**：不许 `git reset --hard`、提交前列文件清单等人确认、机密不进仓库、出包只跑一条命令。这些规矩是"复盘"变成"资产"的方式。

## ⑥ 如果继续做（4:30–5:00）

1. 先跑壳仓 `npm run ship` 出一版真安装包，让「线上 = 安装包」这件事不再 SKIP。
2. 教务直连找一台真机、用我自己的账号跑一遍（我手动做，不代跑）。
3. 把 `rec-preview-check` 那类"环境敏感红"改成可复现的稳定断言，别再让它长期挂着当噪音。

## 附：可粘贴的命令清单

```powershell
# 1) App 侧 18 项验收（公网 + 云同步全链路），最后落一张移动端截图
cd D:\Document\Project\vibe-coding-project\web2
node tmp/day28-online-acceptance.mjs

# 2) 全档发布检查（16 PASS / 1 FAIL / 1 SKIP）
cd D:\Document\Project\vibe-coding-project
node skills\verify-project\verify.mjs

# 3) 后端真读写（PowerShell 一行；口令只在本机 cloudbaserc.json 里，不进仓库）
$B="https://vibecoding-test-d5fqmhbb955e19dd-1499011319.ap-shanghai.app.tcloudbase.com/api"
$T=(Get-Content cloudbaserc.json | ConvertFrom-Json).framework.plugins.functions.environmentVariables.WRITE_TOKEN.Value
curl.exe -s -i "$B/health"
curl.exe -s "$B/list?limit=200"
curl.exe -s -X POST "$B/create" -H "X-Write-Token: $T" -H "Content-Type: application/json" -d '{\"table\":\"todos\",\"row\":{\"id\":\"demo1\",\"title\":\"演示用\",\"due_date\":\"2026-10-14\",\"done\":false}}'
curl.exe -s -X DELETE "$B/delete?table=todos&id=demo1" -H "X-Write-Token: $T"

# 4) 公网作品
start https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/
```
