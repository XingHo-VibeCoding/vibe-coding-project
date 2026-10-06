# 项目地图（给新接手的 AI Agent）

> 本文件是 AI 助手（DSH / Claude Code / 其他 Agent）的导读。
> 分工：`AGENTS.md` 管「**怎么和用户配合干活**」（规矩，必须先读），本文件管「**项目是什么、东西在哪、做到哪、有哪些坑**」，**`docs/交接说明.md` 管「新对话怎么快速接手」**（环境事实 / 常用命令 / 当前版本 / 已知坑 / 下一步计划，一读完就能开工）。三份都读完再动手。

*最后更新：2026-10-05（Day 21 收尾 —— **全应用简化十段计划 Stage 0–10 全部完成**，版本出到 **v1.42.0** 并已在真机复验 S1–S8 全过。要点：今日页三段壳（头/中滚动/尾固定）→ 26px 行组件 `components/RowItem.vue` → 「只向前看」D↔F 两种密度 → 录音入口归位三处（顶卡 / 课表页正在上的那节课 / 通知栏状态框）→ 「我的」页变索引 + 四个全屏二级页（`pages/sub/*.vue`）→ 课表页去掉重复问候卡、「其他日程」收进右上 ＋ 选单 → **Stage 9 组件化**：`App.vue` 从 6902 行降到 4127 行，拆出 `pages/{TodayPage,WeekPage,MePage,OnboardingPage}.vue` 与 12 个 `sheets/*.vue`，状态仍由 App.vue 单一持有、用文件末尾生成的 `APP_CTX`（**767 个绑定**，`web2/tmp/gen-app-ctx.mjs` 生成/校验）注入，子组件 `useApp()` 取用。测试基线 **92 个脚本**（2026-10-06；**已知 flaky 两条**：`wheel-touch-gesture-check.mjs` 自己单独跑 3 次也会挂 1 次、`week-fit-check.mjs` 在机器有负载时会间歇挂 —— 两条都与教务改动无关，**没有**为了让它们变绿而放松断言；`step2-check` 的 5 条过期期望已按自洽口径重写，详见 `docs/交接说明.md` §6.1）。**真机复验结果与两条真机坑见 `docs/真机复验清单.md` 第八节**（其中「录音中常驻小条命中区偏移」那条 2026-10-06 已复查为**不复现**）；设计正本与逐段进度见 `docs/结构动效前置约定.md`。*

*同日**美术收口**（十段计划后补的一轮，已完成，并出了 **v1.42.1** 装机包 `dist-apk/schedule-v1.42.1-20261005.apk` / `versionCode 14201`，真机抽查已过）：① 84 处 `bg-ink/<alpha>` 次要底色换成逐主题不透明 token `bg-soft` / `bg-soft-2`（`web2/src/style.css`，四套皮肤各给值；工具 `web2/tmp/alpha-to-soft.mjs`）；② 二级页加 `.push` 推入动效（0.28s `translateX(100%)`，与 `.slide` 同曲线）。自检 `web2/tmp/motion-check.mjs`（9/0），真机抽查记录见 `docs/真机复验清单.md` 第八节末。*

---

*2026-10-06（P1 / P2）：**P1 正式签名链**本地一半就位 —— 仓库外密钥 `D:\Document\Project\.keys\schedule-release.jks`、壳仓 `android/key.properties`、`signingConfigs.release` 由 `scripts/patch-android.js` 幂等固化（重生成原生工程也能复现）、出包 `dist-apk/schedule-v1.42.1-20261006-release.apk`（证书 `CN=Schedule Assistant`），**真机换签名挂起**（要先留 debug 包做 P3 远程调试）。**P2 练耳记号可见可撤销**：通知栏按过的「我去听了」现在在碎片练耳二级页顶部（收起态也看得见）和今日页「今天要听」那行都能看到、能撤销（`web2/src/data/statusFrame.js` 新增 `unmarkListenDone`，`App.vue` 新增 `frameMarksToday` / `frameMarkedClips` / `unmarkListenDone`），顺带修掉 `dueClips()` 不看记号导致的两处口径打架。自检 `web2/tmp/listen-mark-check.mjs`（19/0）。*

*2026-10-06（P3 / P4）：**P3 真机坑 B 结案 —— 不复现（未改代码）**：录音中常驻小条的「画面位置 vs 命中位置」在真机上逐像素对齐（截图找红条 中心 y=2446 / 高 106；DOM `getBoundingClientRect`×dpr3.5 中心 y=2447 / 高 107 ⇒ 差 1px），按画面中心注入点击命中 `REC-BANNER` 且真进了「课堂录音」，小条四周一圈探测全判 `REC-BANNER`；用户手指复验同样通过。旧结论「命中区高约 120px」是**用预览截图乘 1.4388 估坐标**推出来的（当时小条还带 `transform`）。真机几何的正确量法：`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` + playwright-core `connectOverCDP`。**P4 六期第三步 AI 判读**：`web2/src/data/summarizer.js` 新增 `phraseFact()` + `sameFacts()` 数字闸门（「规则算数、AI 只说」：AI 回话里的数字必须是原句数字的子集，否则整句丢弃退回规则原句，界面不标来源），`App.vue` 新增 `patternAi`/`patternLine`/`askPatternLine`，`ReviewSheet` 只在账卡真的摆上台面时才问一次 AI。自检 `web2/tmp/pattern-ai-check.mjs`（21/0）。同轮把 `BottomSheet` 的滚动从**面板**挪到**内层**（面板 `overflow-hidden` + 内层 `min-h-0 flex-1 overflow-y-auto`），质量门 E6「浮层超屏」2 处清零（`step5-check` 的 A3/A4 跟着改成量内层，并新增 A3b 守住「滚动在内层」）。版本 → **1.42.2**。*

*2026-10-06（P12a 教务课表导入）：用户拿到浙大教务（**方正 zfsoft**）导出的课表 `课表_3240103876.xlsx`，并拍板「**不要追加，我只希望有一套课表**」+「**A + 要快照**」。落地口径：**只替换 `web2.data` 里 `type==='course'` 的条目**（同文档里的 todos / events / routines / semester 原样不动）、清掉 `web2.added` 里的**课程**（非课程保留）、替换前把旧课表原文写进 `web2.eduSnapshot` 可一键恢复。新增 `web2/src/data/eduImport.js`（解析器，纯函数、自己解 zip、不引库）+ `App.vue` 的全屏预览浮层（`data-edu-preview`，逐门列星期/节次/钟点/周次/地点 + 「没进课表」+「需要注意」，**二次确认**才写，解析失败明确报错且不动数据）+ 设置页「从教务导入课表」与「恢复上一套课表」。模型扩展：`course` 新增可选 `weeks: number[] | null`，`matchWeek` 有 `weeks` 只认它、`null` 照旧走 `every/odd/even` ⇒ **老数据无需迁移、行为逐字一致**。三份文档已同步（`PRD.md` 那条「❌ 教务系统自动导入」部分推翻、`TECH_DESIGN.md` 字段表与模块表、`大学生日程助手-设计方案.md` 的 `weeks` 与「重新导入课表」口径）。自检 `web2/tmp/edu-import-check.mjs`（纯逻辑 32/0，带真文件 40/0）+ `web2/tmp/edu-ui-check.mjs`（界面端到端 20/0）。版本 → **1.42.2**。*

*2026-10-06（P12b 教务直连 · 真机跑通）：设置页新增「**登录教务网抓课表**」（在「从教务导入课表」上面，直连是主路径、选 .xlsx 是备胎）。壳仓 `capacitor.config.json` 打开 **`CapacitorHttp`**（②甲：请求走手机原生网络，绕开浏览器跨域）。新增 `web2/src/data/eduLogin.js`（统一身份认证三步 + 取课表 + 翻译 + 按学期筛 + 账号存档）与 `web2/src/sheets/EduLoginSheet.vue`（登录浮层；**手动写浮层**，因为它是从 `z-40` 的二级页里开的）。抓回来的课走**同一个预览核对页**（复用 P12a 的二次确认 / 只换课程 / 快照可恢复）。**两个只有真机+真数据才能发现的坑（都已写进代码注释）**：① 浮层用共用组件 `BottomSheet`（`z-30`）会被 `z-40` 的设置二级页**整个盖住** —— DOM 量得到、断言全过、**截图上空的**，靠"两张截图字节完全相同"才发现；② 教务课表接口**不认**请求里的学期参数、且**把好几个学期混在一起返回**（实测 56 行 = 本学年秋冬 14 + 去年秋冬 18 + 去年春夏 24），而**光看「小学期文本」分不开去年与今年**（两年秋冬都写「秋冬」）⇒ 只能按**选课课号前缀 `(2026-2027-1)`** 本地筛。诊断方式值得记下来：`adb forward` 把 WebView 调试口转出来 + playwright `connectOverCDP`，**在真机页面里直接把原始返回读出来看**，比一轮轮猜省事得多。同轮补了 `web2/tmp/edu-compat-check.mjs`（老数据兼容实测 9/0，满足 AGENTS 八.2）。

*2026-10-06（P13 小学期）：用户发现「标秋/冬的课在整学期里都显示」——因为 App 之前**没有小学期这一层**（课程上的 `term`（秋/冬/秋冬）存了却完全没参与周次判断）。按用户拍板落地：**秋 = 第 1–8 周、冬 = 第 9–16 周（对半分）**，存进 `semester.sub_terms`（跟节次表 `periods` 同一处 —— 都是校历参数、跟着主项目 JSON 导出走），**学期设置里可编辑**（名字也能改成 春/夏，所以春夏学期同一套用），另给一个「按总周数对半分」按钮；周课表标题顺带显示「· 秋学期 / · 冬学期」方便一眼核对。`matchWeek(c, weekNo, subTerms)` 加了**可选**第三参：不传就与 P13 之前**逐字一致**（老调用点不会静默变行为），全部 10 个调用点都已显式传上（含 `ics.js` 与 `nextCourseDate`）。口径：`秋冬` = 两个小学期名都命中 → **并集 = 整学期**；**没写学期的手动课/老课整学期都在（行为不变）**；`短`（暑假）**暂不参与**（用户拍板先不管）—— 但会在预览「需要注意」里如实说明，不静默丢。老数据没有 `sub_terms` → **按总周数对半分兜底、不做迁移**（`subTermsOf()` 同时认 snake `sub_terms` 与 camel `subTerms`）。自检 `web2/tmp/subterm-check.mjs`（**22/0**：纯逻辑 12 条 + 浏览器 9 条，含"与显式 weeks/单双周叠加""换一套表判断跟着变""老数据兜底"）。**质量门抓到一处真问题并已修**：新加的「· 秋学期」标签一开始用 `text-primary-500`，暗色卡片上只有 3.69:1（需 4.5）→ 改 `text-ink-dim`（元信息本来就该用次要文字色）。

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
| `App.vue` | 单一状态持有者 + 外壳（顶卡 / 内容平移层 / 底部 nav / 二级页 Teleport 容器）；Day 21 起 **6902 → 4127 行**，页面与浮层全部拆到下面几处，靠文件末尾生成的 `APP_CTX` 区块（**767 个绑定**）provide 给子组件 |
| `components/` | 通用件：`RowItem.vue`（**26px 时间行的唯一实现处**）、`BottomSheet.vue`、`MonthCalendar.vue`、`TimeWheel.vue` / `NumberWheel.vue` 等 |
| `pages/` | 页面主体：`TodayPage.vue` / `WeekPage.vue` / `MePage.vue` / `OnboardingPage.vue`；二级页四块在 `pages/sub/`（`LecturesPanel` / `ListenPanel` / `TodosPanel` / `SettingsPanel`） |
| `sheets/` | 十三个浮层：`PickerSheet` / `ConfirmClearSheet` / `DeleteLectureSheet` / `HabitSheet` / `DetailSheet` / `ReviewGridSheet` / `PressTypeSheet` / `AddSheet` / `TodoSheet` / `ReviewSheet` / `EventSheet` / `SemesterSheet` / `EduLoginSheet`（**P12b 新建**，登录教务网抓课表；**自己手写浮层不用 `BottomSheet`** —— 它从「设置」这个 `z-40` 的二级页里打开，而 `BottomSheet` 是 `z-30`，会被整个盖住：DOM 量得到、断言全过、**截图上什么都看不见**，2026-10-06 真踩过） |
| `composables/app-ctx.js` | 上下文：`APP_CTX` + `useApp()`；子组件用 `toRefs(app)` **按原名**接绑定，所以搬走的 markup 一个字都不用改。生成器 `web2/tmp/gen-app-ctx.mjs` 产出并校验那个区块（`--check` 同时查「块是否最新」与「有没有漏解构」） |
| `data/store.js` | 存档读写、`sanitize*` 兜底、导入导出；**P12a 起还有** `matchWeek`（支持 `weeks` 周次集合）、`weekTagOf`、`replaceCoursesFromEdu` / `hasEduSnapshot` / `eduSnapshotInfo` / `restoreEduSnapshot`（键 `web2.eduSnapshot`） |
| `data/eduImport.js` | **P12a 新建**：教务导出 xlsx 的解析器。**纯函数、不碰 DOM/网络/存储**，node 可直接单测；自己解 zip（读中央目录 + 原生 `DecompressionStream('deflate-raw')`，**不引第三方库**），认方正 zfsoft 的 8 列表头、`;` 多时段、`{单周}`/`{1-8周}` 周次、地点同序号配对，节次经 `semester.periods` 换算钟点 |
| `data/eduLogin.js` | **P12b 新建**：教务**直连**（浙大统一身份认证 zjuam + 方正 zdbk 课表接口）。纯逻辑 + 网络，**不碰 DOM**。登录三步（取 `execution` → 取 RSA 公钥 → POST 加密密码），密码用 **`BigInt` 手写无填充 RSA**（浏览器原生 `crypto.subtle` 只支持 OAEP，用不了；**不引加密库**，已与 Python 参考实现逐位对照）。拉回 `kbList` 后翻译成**与 P12a 同形**的课程，落库复用同一套。**两条防坑的口径**：① 接口**不认**请求里的学期参数、且**混着好几个学期返回**（实测 56 行 = 本学年秋冬 14 + 去年秋冬 18 + 去年春夏 24）⇒ `filterByTerm()` 按 **`xkkh` 前缀 `(学年-学年-序号)`** 本地筛（序号 1=秋冬 2=春夏 3=短），**不能用 `xxq` 小学期文本**（两年秋冬都写「秋冬」）；② 输错多次会锁号 ⇒ **不做自动重试、只手动触发**。账号存 `web2.eduAccount`（App 私有目录、**非密钥库级**，代码与界面都如实标注） |
| `data/daily.js` | 六期「今天的账」的每日快照：本机 localStorage 键 `web2.daily`（**不进导出**），`upsertDay` 逐字比数字、没变就 `changed:false`（避免每分钟写盘），`baselineOf(book,8)` 给 8 天基线 |

*同日**六期「今天的账」第一步**（已完成、未提交）：`web2/src/data/daily.js` 每日快照（本机 `web2.daily`，不进导出）+ 账卡并进现有「日精进」浮层（`web2/src/sheets/ReviewSheet.vue`：第一题顶上「今天也结账啦～」、结果页「今天的账：排 N 做完 M」、历史两路合流——复盘行 + 浅色「这天没结账，只留了数字」行），不新增页面/入口；自检 `web2/tmp/daily-account-check.mjs` **24/0**，取证图 `web2/tmp/acct-{1-ask,2-result,3-history}.png`。设计正本 `docs/今天的账与可回嘴-设计稿.md`（手机使用时间那栏本轮未做，需动壳仓原生代码）。*

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
- **测试基线**：`cd web2` 再 `node tmp/day19-baseline.mjs` → 全量 **92 个脚本**（2026-10-06；flaky 两条见上；`step2-check.mjs` 的 5 条过期期望已重写为自洽断言。脚本清单与逐个退出码见 `web2/tmp/day19-baseline.txt`，以那份为准）。脚本变红**先怀疑脚本自己的陈旧前提**，不是产品坏了：日期敏感（今天没课/周末）、端口写死（dist 静态服务在 **4177**、Vite dev 在 **5180**）、缺 `[data-page="me"]` 作用域（报 `element is outside of the viewport`）、dist 上没有 `/src/…`。排查套路见 `TECH_DESIGN.md` 附录速查最后一行。**状态断言别 match class 名**（当前 tab 用 `nav button[data-active]`）。**带假原生桥的脚本，假桥必须有状态**：`getPending()` 要回上一轮排的、`cancel()` 要真按 id 摘掉，否则第二次排程清不掉旧的、条数翻倍（`slots-notify-check.mjs` 首跑就是这么误报 14 条）。**改完必须先 `npx vite build`**（断言的脚本走 dist 静态服务，不重建就等于测旧包）。

## 七、新 Agent 的第一个任务（建议）

只读熟悉项目：读 `AGENTS.md` → `docs/api-contract.md` → `db/schema.sql` → `cloudfunctions/*/index.js` → `web2/package.json` → `js/store.js`，然后向用户输出一份全貌汇报（项目是什么/结构/进度/规矩/坑），并列出看不懂的地方。**确认读懂之前不要改任何文件。**
