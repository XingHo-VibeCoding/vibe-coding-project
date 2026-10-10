# 大学生日程助手

一款大学生自用的日程管理工具：**课表 + 待办同屏**的轻量网页应用。纯前端、本地保存、无账号、无服务器。

> **正式版代码位置（Day 15 起）**：正式版界面是 `web2/` 子目录下的 Vue 3 实现（`npm install && npm run build`，产物在 `web2/dist`），在线站点与手机 App 都由它构建；根目录的原生实现是 Day 1–14 的版本，已封存不再迭代。

## 功能（一期 MVP）

- **学期设置**：学期名、第一周周一、总周数 → 自动换算「今天是第几周」
- **课程管理**：添加 / 编辑 / 删除课程，支持 每周 / 单周 / 双周 周次规则
- **冲突检测**：时间重叠的课程保存时会提示（不强制阻止）
- **待办与打勾**：待办显示在截止日对应列，可打勾 / 取消
- **今日视图**：今天的课 + 到期待办 + 今日结算（完成 N / 共 M）
- **导出 .ics**：每节课展开为日历事件，导入手机系统日历后**课前 15 分钟**提醒
- **JSON 备份 / 导入**：换设备迁移数据
- **响应式**：手机、电脑都能用

## 如何运行

方式一（推荐，电脑端）：

1. 下载本仓库（Code → Download ZIP，或 `git clone`）
2. 解压后双击 `index.html`，用浏览器打开即可

方式二（本地小服务器，功能完全一致）：

```bash
# 在项目目录下执行（需要 Python 或 Node 任一）
python -m http.server 8000
# 然后浏览器访问 http://localhost:8000
```

## 数据保存在哪？

全部数据存在**本机浏览器的 localStorage** 里，不上传任何服务器。注意：

- 不同浏览器、不同打开方式（`file://` 与 `http://localhost`）的数据**互相独立**；
- 清除浏览器数据会连带清掉课表，请定期用「导出 / 备份 → 导出 JSON 备份」存档；
- 换设备：旧设备导出 JSON → 新设备「导入 JSON 数据」即可完整迁移。

## 手机上提醒怎么来？

导出 `.ics` 文件 → 发到手机 → 导入系统日历（或 Google 日历等）→ 每节课在课前 15 分钟由系统日历提醒。**修改课程后需要重新导出并重新导入，提醒才会更新。**

## 技术栈与目录结构

**正式版：`web2/`**（Day 15 起）—— Vue 3（`<script setup>`）+ Vite + Tailwind 4，有构建步骤。

```
web2/index.html              入口页面
web2/src/main.js             启动入口（挂载 Vue）
web2/src/App.vue             应用主体：视图 + 交互（单页，无路由）
web2/src/style.css           全局样式（Tailwind 4 + 设计令牌）
web2/src/components/         通用组件：TimeWheel / NumberWheel / MonthCalendar / PeriodsEditor / DropdownSelect
web2/src/data/               数据与逻辑层（9 个模块）：
  store.js                     数据唯一闸门（localStorage），负责增删改查
  periods.js                   节次表：分段 / 段内重排 / 合并（纯函数）
  recognizer.js                课表识别：图片 → 课程（走大模型）
  ics.js                       导出层：.ics 生成与下载
  recorder.js / transcriber.js 录音与语音转写（浏览器 / App 原生桥两条路径）
  summarizer.js                录音总结
  notify.js / mock.js          提醒 / 示例数据
web2/serve.js                线上发布用静态服务（读 PORT，serve dist/）
web2/dist/                   构建产物（npm run build 生成，不入库）
```

```bash
cd web2
npm install
npm run build    # 产出 web2/dist
npm run dev      # 本地开发（http://localhost:5180）
```

**根目录：Day 1–14 的实现，已封存不再迭代** —— 原生 HTML/CSS/JavaScript，无框架、无构建工具、无 ES Module（双击 `index.html` 就能跑）。

```
index.html        入口页面
css/style.css     样式（含移动端适配）
js/store.js       数据层：localStorage 唯一出入口
js/rules.js       规则层：周次换算 / 冲突检测 / 今日结算（纯函数）
js/ics.js         导出层：.ics 生成与下载
js/views.js       渲染层：把数据画成界面
js/app.js         入口层：绑定事件，串起取数→校验→存数→重渲染
```

## 自检 Skill（交付前跑一遍）

`skills/` 下是可复用的检查清单，每条规则都来自项目**真实踩过的坑**。

**发布前检查 `verify-project`** — 推代码 / 出 APK / 发演示链接**之前**跑一遍，把「可能悄悄坏掉」的环节全查一次（密钥卫生、两份 `errors.js` 是否逐字节一致、`APP_CTX` 漏解构、安全区、构建、质量门、测试基线、APK 三方一致、版本号、推前连通性、文档同步），逐项给 `PASS/FAIL/SKIP` + 一行证据：

```bash
node skills/verify-project/verify.mjs          # 全量（含构建 / 质量扫描 / 基线 / 验包，几分钟）
node skills/verify-project/verify.mjs --fast   # 快档：跳过构建与出包链，改前端小逻辑时用
```

退出码即结论：**任一 FAIL → 1；全 PASS（SKIP 不算 FAIL）→ 0**。明细同时写进 `skills/verify-project/last-run.txt`。说明见 [SKILL.md](./skills/verify-project/SKILL.md)。

> 规矩：**新增检查项必须先自证会报红**（故意造个坏样例确认真 FAIL 再恢复）——静默假通过的检查器比没有更危险。

另有 `skills/frontend-guidelines` — 前端改动检查清单。

## 文档

- [设计方案](./大学生日程助手-设计方案.md) — 产品定位与五期路线
- [research.md](./research.md) — 竞品研究
- [PRD.md](./PRD.md) — 一期功能清单与验收标准
- [TECH_DESIGN.md](./TECH_DESIGN.md) — 技术设计

## 状态

- **正式版（`web2/`）**：一期功能已全部实现并在线上运行 —— https://college-schedule-assistant.app.workbuddy.host/
- **手机 App**：Capacitor 外壳工程 `vibe-coding-project-app`（独立目录）打包同一份 `web2/dist` 产物
- **根目录原生版**：Day 1–14 的实现，已封存
- 后续按五期路线迭代（课表识别 / 录音总结 / 打卡 / 练耳 / 复盘），**开发主线在 `web2/`**。详见设计方案。
