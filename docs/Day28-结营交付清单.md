# 结营交付清单（Day 28）

> 营地要求的 8 项，逐项给出**在哪、怎么复现、缺什么**。本文是索引，细节都在被指向的文件里。
> 一句话结论：**8 项里 7 项齐了，1 项（录屏）已产出但没有配音**——见第 3 项。

| # | 交付项 | 状态 | 在哪 |
|---|---|---|---|
| 1 | 公网地址 | ✅ | 见 §1 |
| 2 | 代码仓库链接 | ✅ | 见 §2 |
| 3 | 3–5 分钟演示录屏 | ⚠️ 已产出（2′47″，**无配音**） | `release-archive/v1.2/演示录屏-Day28.webm`（配 `演示录屏-Day28.html` 可在浏览器直接播）+ 讲解词 `docs/Day28-演示提纲.md` |
| 4 | 最终验收表 + 项目映射表 | ✅ | `docs/Day28-结营验收表.md`（12 项 + 缺项 + 复盘）、`docs/PROJECT_MAP.md` |
| 5 | 一条最有效的改写提示词 | ✅ | 见 §5 |
| 6 | 运行和技术路线说明 | ✅ | 见 §6（本文给浓缩版，细节指向 `README.md` / `docs/交接说明.md` / `TECH_DESIGN.md` / `大学生日程助手-设计方案.md`） |
| 7 | 数据库 / 部署 / 额度 / 到期 / 备份（不含密钥） | ✅ | 见 §7（`docs/资源与到期说明.md` + `docs/回滚手册.md` + `db/schema.sql`） |
| 8 | 200 字以内结营总结 | ✅ | 见 §8（195 字） |

---

## 1. 公网地址

- **作品（就是 App 本身）**：<https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/app/>
  - 首次访问会先过一页腾讯云「风险提醒」，点一次「确定访问」就进去了（体验版域名的固有拦截，不是故障）。
  - 线上产物 = `assets/index-DCzAj8UX.js` + `assets/index-F09JQENE.css`，与入库归档 `release-archive/v1.2/` **逐名一致**（脚本 A2 实测）。
- **后端接口基址**：`https://vibecoding-test-d5fqmhbb955e19dd-1499011319.ap-shanghai.app.tcloudbase.com/api`（`/api/health`、`/api/list`、`/api/create|update|delete`、`/api/sync`）
- **静态托管根目录**（数据检查台）：<https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com/> —— 它就是用来**当场读写线上库**的页面。
- 一条命令现场复验：`cd web2 && node tmp/day28-online-acceptance.mjs` → **18 项通过 / 0 项失败**。

## 2. 代码仓库链接

- <https://github.com/XingHo-VibeCoding/vibe-coding-project>（**公开可读**，2026-10-14 实测匿名 `git ls-remote` 拿到 HEAD）
- 本地 `origin` 走 SSH：`git@github.com:XingHo-VibeCoding/vibe-coding-project.git`
- 主仓 = 前端 + 文档 + 数据库 schema + 4 个云函数；配套**壳仓**（Capacitor + Android 工程，含 9 个原生 Kotlin 插件）在本地 `D:\Document\Project\vibe-coding-project-app`，**没有远端**——这一点在 §7 如实标注。
- 里程碑标签：`v1.0`（指向 `574a8a3`）。软件版本号 `web2/package.json` = **1.43.0**。

## 5. 一条最有效的改写提示词

> 这是 28 天里**回报最高的一次改写**——它一句话挡掉了后面三天的返工。

**原始（我一开始的说法）**
> 帮我写一个日程助手的后端。

**改后（我实际发出去的）**
> 用 **CloudBase + PostgreSQL**；**先只做** `GET /api/health`，并保证**公网可访问**；`/api/list` 的返回里必须带 **`counts`**（各表行数），我要拿它和数据库控制台**对账**。

**为什么它最有效（三点，都能在仓库里找到痕迹）**

1. **把环境钉死**：`PostgreSQL` 这一条直接挡掉了「按 MySQL 语法写完再整段重写」的返工——CloudBase 当时只提供 PG，这一点是 Day 16 才发现的。
2. **把范围收窄到一个能当场验证的接口**：不做 CRUD、不做鉴权、不做分页，只证明**通路**。一个能当场跑通的 `/api/health`，比十个「差不多能用」的功能更能推进项目。
3. **在需求里就内置了「怎么算做完了」**：`counts` 让「取漏了 / 少了一行」一眼可见；后来 Day 21 验收表就是拿它和 `db/seed.sql` 声明的 **6 / 22 / 10** 对账，今天再跑一次仍然是 **6 / 22 / 10**。

同一个套路在这个项目里复用过很多次，模板就一句：**「用什么 + 先只做什么 + 怎么证明它对」**。

## 6. 运行和技术路线说明

### 6.1 技术路线（一句话版）

Vue 3 + Vite 单页应用 → Capacitor 7 包成 Android App（原生能力用 9 个自写 Kotlin 插件：录音、转写、常驻状态框、安全存储、使用时间统计）→ 数据**默认全在本机**（localStorage，带 `schema_version` 迁移）→ 可选上云：CloudBase 静态托管放前端、HTTP 网关 + 4 个 Node 云函数做接口、PostgreSQL（PostgREST）存云同步文档与课程表。

- 前端：`web2/`（`src/App.vue` 约 5440 行 + 13 个 page + 14 个 sheet + 7 个组件 + 24 个 data 模块）
- 壳与原生：`D:\Document\Project\vibe-coding-project-app`（`scripts/native/*.kt` 9 个）
- 云：`cloudfunctions/{health,list,write,sync}`；表结构 `db/schema.sql`
- **离线优先**：不注册、不登录，除「云同步 / 教务直连 / 节假日抓取」外全部功能断网可用。

### 6.2 怎么跑（本机实测可用）

```powershell
# 前端开发态：起静态服务（自检脚本都依赖它）
cd D:\Document\Project\vibe-coding-project\web2
$env:PORT='4177'; Start-Process -FilePath "D:\Node.js\node.exe" -ArgumentList "serve.js" -WindowStyle Hidden
start http://127.0.0.1:4177/

# 构建（注意：本机 PATH 上的 npm 不可靠，一律用绝对路径）
cd D:\Document\Project\vibe-coding-project\web2
& D:\Node.js\npm.cmd run build

# 交付前跑一遍全档检查（A 密钥与仓库卫生 / B 两份 errors.js 逐字节一致 / C 上下文与安全区 /
# D 构建 + 108 个自检 / E APK 三方一致 / F 推前连通性与三文档同步）
cd D:\Document\Project\vibe-coding-project
node skills\verify-project\verify.mjs          # --fast 只跑 A/B/C/F

# 出 Android 安装包：在壳仓只跑一条命令（含版本号同步、补丁、编译、归档、三级校验）
cd D:\Document\Project\vibe-coding-project-app
npm run ship
```

- 详细环境事实（Node / Python / Chrome / adb / Java 的确切路径，以及 6 个已知坑）在 `docs/交接说明.md` §3–§4。
- 真机复验与 CDP 配方在 `docs/真机复验清单.md`。

## 7. 数据库、部署、额度、到期和备份（不含任何密钥）

> 本节**只写环境 id、命令和结构**；同步串、`WRITE_TOKEN`、`CLOUDBASE_API_KEY` 等真值一律不出现在这里，也不在仓库里（`.env` 与 `cloudbaserc.json` 都被 `.gitignore` 忽略，仓库只留 `.example` 模板）。

### 7.1 数据库

- 引擎：**PostgreSQL**（CloudBase 环境内置），通过 **PostgREST** 访问，基址 `https://{envId}.api.tcloudbasegateway.com/v1/rdb/rest`。
- 4 张表（`db/schema.sql`）：`semesters` / `schedules` / `todos` / `sync_docs`（`owner_uid` 主键 + `doc JSONB` + `doc_rev` + `updated_at`）。
- 线上现状：`semesters 6 / schedules 22 / todos 10`（`GET /api/list` 的 `counts`，2026-10-14 实测；跑完写入探针后已复原）。
- **写入全部走白名单**：`table` 只允许 `todos / schedules / semesters`，`users` 之类一律 `400 未知 table`。

### 7.2 部署

| 面 | 怎么发 |
|---|---|
| 前端（静态托管 `/app/`） | `cd web2 && npm run build` → `tcb hosting deploy ./web2/dist app -e <envId> --safe --verify` |
| 云函数（4 个） | 代码就在仓库 `cloudfunctions/`，部署即上传；环境变量（含真口令）只在云端配置，不进仓库 |
| Android 安装包 | 壳仓 `npm run ship`（一条命令） |

### 7.3 额度与到期

- 环境 `vibecoding-test-d5fqmhbb955e19dd`，**体验版**，地域 ap-shanghai，**到期 2027-03-31 23:59:59**。
- 额度实测：除 PostgreSQL 与静态托管外，其余项目（NoSQL / MySQL / Cloud hosting / AI / 鉴权 / Workflow 等）计数均为 **0**；到期前的动作清单在 `docs/资源与到期说明.md` §6。

### 7.4 备份与回滚

| 对象 | 底牌 | 实测 |
|---|---|---|
| 前端线上产物 | `release-archive/v1.0` / `v1.2`（入库，`.gitattributes` 里 `release-archive/** -text` 防 CRLF 改写），`v1.2` 与线上逐名一致 | **静态托管回滚真演练过：全程 18.3 秒，止血 5.3 秒**，恢复后 3 文件 sha256 3/3 一致 |
| 云函数 | 源码本身在仓库（重部署即回滚） | **未演练** |
| 数据 | PostgREST 导出 / `tcb` 下载 | **未演练** |
| Android 包 | `dist-apk/` 里的历史 APK | **未演练** |
| 本机用户数据 | App 内「数据与导入导出」可导出 JSON；云同步可跨设备整份取回 | 云同步上传/取回/清空三动作已实测 |

操作步骤见 `docs/回滚手册.md`（§1 必须回滚判断表 / §2 静态托管 / §3 用 `git revert` 而非强推 / §4–§6 未实操）。

### 7.5 如实标注的两件事

- 壳仓（Android 工程）**没有远端仓库**，只有本地目录；`release-archive/` 里有 APK 与网页归档，但原生代码不在 GitHub 上。
- 线上是 **Web 版**；Android 安装包本轮**未重新出包**（`verify.mjs` 的 `E1 APK 三方一致` 因此是 SKIP），所以「线上 = 安装包」这句话今天不成立。

## 8. 200 字以内结营总结

28 天做了一个自己每天真在用的日程 App：课表、待办、打卡、课堂录音转写、碎片练耳、云同步，五期做完，公网可打开、离线可用、数据在自己手里。更大的收获不是这些功能，而是学会让 AI 交证据：一条命令跑 18 项验收，全档检查敢留 FAIL，回滚敢真演练。清单即边界、一次一步、不假装完成——这三句话我从第一天听到最后一天，现在它们写进了 `AGENTS.md`，也写进了我的工作方式。下一步：出一版真安装包，再用自己的账号把教务直连跑通。

（正文 195 字，不含标点符号计数口径为「汉字 + 数字 + 英文单词」。）

---

## 9. 这一轮新增的文件（未提交）

| 文件 | 说明 |
|---|---|
| `docs/Day28-结营验收表.md` | 最终验收表（12 项 + 缺项汇总 + 结营复盘） |
| `docs/Day28-演示提纲.md` | 3–5 分钟演示提纲（六段 + 可粘贴命令） |
| `docs/Day28-结营交付清单.md` | 本文（8 项交付索引） |
| `release-archive/v1.2/演示录屏-Day28.webm` | 演示录屏 2′47″（脚本可重跑） |
| `release-archive/v1.2/演示录屏-Day28.html` | 播放器页（浏览器直接播，附讲解词指引） |
| `release-archive/v1.2/验收清单-Day28.png` | 交付图 1：验收清单逐项打勾 |
| `release-archive/v1.2/公网打开-Day28.png` | 交付图 2：公网 URL 打开的样子 |
| `web2/tmp/day28-online-acceptance.mjs` | 公网验收脚本（18 项，可重跑） |
| `web2/tmp/day28-checklist-shot.mjs` | 两张交付图的生成脚本 |
| `web2/tmp/day28-demo-video.mjs` | 录屏生成脚本（可重跑） |

> 另外为生成录屏，本机补装了 Playwright 用的 ffmpeg（`%LOCALAPPDATA%\ms-playwright\ffmpeg-1010\ffmpeg-win64.exe`，1.4 MB，从官方 CDN 下载）。它只支持 VP8/WebM，所以录屏是 `.webm`；要 mp4 得用完整版 ffmpeg 再转一次。
