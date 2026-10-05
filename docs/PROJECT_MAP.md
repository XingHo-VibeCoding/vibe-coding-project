# 项目地图（给新接手的 AI Agent）

> 本文件是 AI 助手（DSH / Claude Code / 其他 Agent）的导读。
> 分工：`AGENTS.md` 管「**怎么和用户配合干活**」（规矩，必须先读），本文件管「**项目是什么、东西在哪、做到哪、有哪些坑**」。两份都读完再动手。

*最后更新：2026-10-05（Day 21 收尾 —— **全应用简化十段计划 Stage 0–10 全部完成**，版本出到 **v1.42.0** 并已在真机复验 S1–S8 全过。要点：今日页三段壳（头/中滚动/尾固定）→ 26px 行组件 `components/RowItem.vue` → 「只向前看」D↔F 两种密度 → 录音入口归位三处（顶卡 / 课表页正在上的那节课 / 通知栏状态框）→ 「我的」页变索引 + 四个全屏二级页（`pages/sub/*.vue`）→ 课表页去掉重复问候卡、「其他日程」收进右上 ＋ 选单 → **Stage 9 组件化**：`App.vue` 从 6902 行降到 4127 行，拆出 `pages/{TodayPage,WeekPage,MePage,OnboardingPage}.vue` 与 12 个 `sheets/*.vue`，状态仍由 App.vue 单一持有、用文件末尾生成的 `APP_CTX`（680 个绑定，`web2/tmp/gen-app-ctx.mjs` 生成/校验）注入，子组件 `useApp()` 取用。测试基线 **79 个脚本 / 非 0 退出 1 个**（只剩 `step2-check` 这个既有日期敏感脚本）。**真机复验结果与两条真机坑（底部系统手势区吞 tap、录音中常驻小条命中区偏移）见 `docs/真机复验清单.md` 第八节**；设计正本与逐段进度见 `docs/结构动效前置约定.md`。*

---

## 一、这是什么项目

**大学生日程助手**——用户（大学生本人）的自用工具，也是他的 vibe coding 训练营作品：他发「今日任务清单」，AI 按清单干活，他在过程中学习。分五期开发。

## 二、目录地图

```
vibe-coding-project/
├── AGENTS.md            # 工作规矩（任务边界/节奏/git/收尾），最高优先级
├── PRD.md               # 产品需求文档
├── TECH_DESIGN.md       # 技术设计（含数据库 §3，db/ 的字段依据）
├── 大学生日程助手-设计方案.md
├── README.md / research.md / components-demo.html
├── index.html           # 主应用入口（原生 JS，无构建）
├── css/
├── js/                  # 主应用核心（见下）
├── samples/             # 素材样本
├── skills/              # 训练营相关素材
├── web2/                # 正式版应用（Vite 构建，当前 v1.41.10，已上线）
├── db/                  # schema.sql + seed.sql（PostgreSQL 版，Day 16）
├── cloudfunctions/      # 云函数（health=Day15 健康检查，list=Day17 读接口）
├── mock-frontend/       # Day15 建、Day20 改成「数据检查台」并部署（线上 = *.tcloudbaseapp.com，不是 web2 本体）
├── .workbuddy/          # 工具临时区（检查脚本/备份），被 .gitignore 忽略，有意保留不清理
└── docs/                # api-contract.md（接口契约）、结构动效前置约定.md（简化方案的密度/动效/语义约定 + 逐 Stage 进度）、真机复验清单.md、Day15-复盘.md、本文件
```

`js/` 逐文件（主应用是硬闸门所在）：

| 文件 | 作用 |
|---|---|
| `store.js` | **数据校验层，硬闸门**：`validateSchedule()` 遇未知 type 直接报错；`importAll()` 一条不过整份拒收；保真写入、不重新归一化 |
| `views.js` | 渲染与表单交互（termNameChoices、pickerField、即时反馈都在这） |
| `rules.js` | 冲突检测 `Rules.findConflicts` 等 |
| `ics.js` | 导出 .ics 日历文件 |
| `app.js` | 应用装配入口 |
| `mock.js` / `components.js` / `components-demo.js` | mock 数据 / 组件库 / 组件演示 |
| `ai/` | AI 能力相关（录音总结、课表识别用到） |

`web2/`（正式版，原「概念版」，Day 14/15 起转正为开发主线；独立可运行）：`src/` 源码、`dist/` 构建产物、`serve.js` 本地预览；**升版本号只改 `web2/package.json` 一处**。

`web2/src/` 结构（Day 21 简化起）：

| 路径 | 是什么 |
|---|---|
| `App.vue` | 单一状态持有者 + 外壳（顶卡 / 内容平移层 / 底部 nav / 二级页 Teleport 容器）；Day 21 起 **6902 → 4127 行**，页面与浮层全部拆到下面几处，靠文件末尾生成的 `APP_CTX` 区块（**680 个绑定**）provide 给子组件 |
| `components/` | 通用件：`RowItem.vue`（**26px 时间行的唯一实现处**）、`BottomSheet.vue`、`MonthCalendar.vue`、`TimeWheel.vue` / `NumberWheel.vue` 等 |
| `pages/` | 页面主体：`TodayPage.vue` / `WeekPage.vue` / `MePage.vue` / `OnboardingPage.vue`；二级页四块在 `pages/sub/`（`LecturesPanel` / `ListenPanel` / `TodosPanel` / `SettingsPanel`） |
| `sheets/` | 十二个浮层：`PickerSheet` / `ConfirmClearSheet` / `DeleteLectureSheet` / `HabitSheet` / `DetailSheet` / `ReviewGridSheet` / `PressTypeSheet` / `AddSheet` / `TodoSheet` / `ReviewSheet` / `EventSheet` / `SemesterSheet` |
| `composables/app-ctx.js` | 上下文：`APP_CTX` + `useApp()`；子组件用 `toRefs(app)` **按原名**接绑定，所以搬走的 markup 一个字都不用改。生成器 `web2/tmp/gen-app-ctx.mjs` 产出并校验那个区块（`--check` 同时查「块是否最新」与「有没有漏解构」） |
| `data/store.js` | 存档读写、`sanitize*` 兜底、导入导出 |

## 三、五期路线与当前进度

| 期 | 功能 | 状态 |
|---|---|---|
| 1 | 课表识别 | ✅ 完成 |
| 2 | 录音总结 | ✅ 完成 |
| 3 | 打卡（含每日打卡、日程清单页） | ✅ 完成（2026-10-02 收尾） |
| 4 | 碎片练耳 | ✅ 完成（Day 18 起，v1.41.x 持续打磨） |
| 5 | 复盘 | 🔄 进行中（Day 20，v1.41.7 最小闭环：四题引导 + 本机日精进 + 每晚轻提醒；AI 引导式对话与 `reviews` 云表留后续） |

后端线（跟五期并行）：Day 15 `/api/health` 上线 → Day 16 建库灌数 → Day 17 `/api/list` 读接口上线（契约见 `docs/api-contract.md`，只实现了表里的 1、2 号接口，3–5 号还是占位）→ Day 20 前端页面从 mock 练习页改成「数据检查台」（真实数据 + 最后更新时间 + 刷新 / 写入测试入口）并重新部署到静态托管。

📱 **攒着等手机连上验的项**（状态框勿扰时段 / 精确提醒引导 / 时间感三件套 / 每日复盘提醒链路）见 `docs/真机复验清单.md`——电脑上验不了，别重复怀疑是代码坏了。

## 四、数据流（一条线记住）

```
web2 导出 JSON ──→ 主项目 js/store.js 校验（硬闸门）──→ db/schema.sql 三张表
（semesters / schedules / todos，CloudBase PostgreSQL）
        ↑ cloudfunctions/list 用 CloudBase REST API 读这三张表，公网返回 {ok, data}
```

- 三个接口已上线的公网地址见 `docs/api-contract.md`「环境信息」。
- 云函数凭据只放在**函数环境变量**（`TCB_ENV_ID` / `CLOUDBASE_API_KEY`），永远不进代码、不进 git、不进聊天。
- **两个线上地址别混淆**：`college-schedule-assistant.app.workbuddy.host` ＝ web2 应用本体（TECH_DESIGN §2.3 的线上入口）；`*.tcloudbaseapp.com` ＝ Day 15 mock 练习页（api-contract 的静态托管）。互不替代。
- **`/api/list` 的 type 白名单目前只有 `course/event/routine`**（`cloudfunctions/list/index.js` 的 `allowedTypes`）——exam 与未来预留的 lectures/reviews 还没进白名单，**四期/五期开单时必须同步扩**（函数白名单 + api-contract + schema 注释三处）。

## 五、三条铁律（都真实踩过坑）

1. **加新数据类型必须同步改主项目 `js/store.js`**：未知 type 会被 `validateSchedule()` 报错、`importAll()` 整份拒收；数据形状由 web2 侧写死（如 `fullRoutine()`）。只改 web2 不改主项目＝用户导出的数据直接报废。
2. **外壳给状态栏让位必须用 fixed 遮罩，绝不能用流内 padding**：padding 属文档流，一滚就滚出视口。
3. **APK 打包链里 `npx cap sync android` 会被批量删除守卫拦截**（删重建插件目录超过阈值）→ 只用 `npx cap copy android`；真要 sync 让用户自己开终端跑。

## 六、工作规矩速查（全文见 AGENTS.md，这里只列最容易踩的）

- **清单即边界**：只做用户当天清单里的事，不多建文件、不顺手优化；拿不准先问。
- **一次一步**：每步做完停下报「做了什么/改了哪些文件/怎么验证」，等用户说「进入下一板块」；简单低不确定任务可以直接做（由 AI 判断并说明理由）。
- **commit**：标题 `Day X｜一句话`，正文两行（改了什么/加了什么）；提交前先列文件清单等用户确认；一天任务全做完才提交。
- **git 禁忌**：禁止 `git reset --hard`、禁止强推；撤销用 `git revert`；推送前做代理连通性预检，预检不过就停。
- **文档同步**：改数据模型或项目范围时，同步更新 设计方案 / `PRD.md` / `TECH_DESIGN.md` 三份。
- **数据兼容**：动 `store.js` 字段或 `schema_version` 必须带旧数据升级方案，并实测旧数据可读。
- **验证要实证**：结论要附用户能亲眼确认的证据；web2 发布后的线上实证用版本串/特征串/行为断言，**hash 与字节数不适用**（沙箱重构建，产物必不同）。
- **界面质量门**：`cd web2` 再 `node tmp/quality-scan.mjs` → **0 处问题**（2 视口 360×640 / 390×844 × 亮/暗 2 主题 × 12 个状态；查异常文案 `NaN` / 横向溢出 / 元素出界 / 触控目标 <24px / 对比度 / 被遮挡 / 浮层超屏）。**改主题色、文案颜色、色板之后必须跑，跑到 0 处**；`SHOT_ALL=1` 出 32 张 `qa-*.png` 肉眼复核。颜色规则见 `TECH_DESIGN.md` §2.2.1（说明文字实色、主色当文字用 `primary-600`、暗色单独看）。
- **测试基线**：`cd web2` 再 `node tmp/day19-baseline.mjs` → 全量 **79 个脚本、非 0 退出 1 个**（2026-10-05，Day 21 Stage 8 后；唯一红的是 `step2-check.mjs` 这个既有日期敏感脚本。脚本清单与逐个退出码见 `web2/tmp/day19-baseline.txt`，以那份为准）。脚本变红**先怀疑脚本自己的陈旧前提**，不是产品坏了：日期敏感（今天没课/周末）、端口写死（dist 静态服务在 **4177**、Vite dev 在 **5180**）、缺 `[data-page="me"]` 作用域（报 `element is outside of the viewport`）、dist 上没有 `/src/…`。排查套路见 `TECH_DESIGN.md` 附录速查最后一行。**状态断言别 match class 名**（当前 tab 用 `nav button[data-active]`）。**带假原生桥的脚本，假桥必须有状态**：`getPending()` 要回上一轮排的、`cancel()` 要真按 id 摘掉，否则第二次排程清不掉旧的、条数翻倍（`slots-notify-check.mjs` 首跑就是这么误报 14 条）。

## 七、新 Agent 的第一个任务（建议）

只读熟悉项目：读 `AGENTS.md` → `docs/api-contract.md` → `db/schema.sql` → `cloudfunctions/*/index.js` → `web2/package.json` → `js/store.js`，然后向用户输出一份全貌汇报（项目是什么/结构/进度/规矩/坑），并列出看不懂的地方。**确认读懂之前不要改任何文件。**
