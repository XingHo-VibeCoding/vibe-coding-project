# 项目地图（给新接手的 AI Agent）

> 本文件是 AI 助手（DSH / Claude Code / 其他 Agent）的导读。
> 分工：`AGENTS.md` 管「**怎么和用户配合干活**」（规矩，必须先读），本文件管「**项目是什么、东西在哪、做到哪、有哪些坑**」，**`docs/交接说明.md` 管「新对话怎么快速接手」**（环境事实 / 常用命令 / 当前版本 / 已知坑 / 下一步计划，一读完就能开工）。三份都读完再动手。

*最后更新：2026-10-08（收口）。**当前事实以这一行为准，下面按时间倒序排列的历史段落里的数字可能已过期**：版本 **1.43.0**、最新提交 **`fdefa40`**、装机包 `dist-apk/schedule-v1.43.0-20261008-debug.apk`（debug 侧载，含 P12b 密钥库插件）；`web2/src/App.vue` **4745 行**、`sheets/*.vue` **13 个**、**APP_CTX 792 个绑定**（以 `node web2/tmp/gen-app-ctx.mjs --check` 的输出为准）、`web2/tmp/*.mjs` **161 个**；测试基线 **95 个脚本 / 非 0 退出 0 个**、质量门 **0 处问题**。施工单里**还剩 P6 / P7 / P10 / P11 / P8**（P6/P7 开工前需用户定口径），详见 `docs/下一轮施工单.md` §5b 与 `docs/交接说明.md` §1。*

*2026-10-05（Day 21 收尾 —— **全应用简化十段计划 Stage 0–10 全部完成**，版本出到 **v1.42.0** 并已在真机复验 S1–S8 全过。要点：今日页三段壳（头/中滚动/尾固定）→ 26px 行组件 `components/RowItem.vue` → 「只向前看」D↔F 两种密度 → 录音入口归位三处（顶卡 / 课表页正在上的那节课 / 通知栏状态框）→ 「我的」页变索引 + 四个全屏二级页（`pages/sub/*.vue`）→ 课表页去掉重复问候卡、「其他日程」收进右上 ＋ 选单 → **Stage 9 组件化**：`App.vue` 从 6902 行降到 4127 行，拆出 `pages/{TodayPage,WeekPage,MePage,OnboardingPage}.vue` 与 12 个 `sheets/*.vue`，状态仍由 App.vue 单一持有、用文件末尾生成的 `APP_CTX`（**792 个绑定**，`web2/tmp/gen-app-ctx.mjs` 生成/校验）注入，子组件 `useApp()` 取用。测试基线 **94 个脚本**（2026-10-06；**已知 flaky 两条**：`wheel-touch-gesture-check.mjs` 自己单独跑 3 次也会挂 1 次、`week-fit-check.mjs` 在机器有负载时会间歇挂 —— 两条都与教务改动无关，**没有**为了让它们变绿而放松断言；`step2-check` 的 5 条过期期望已按自洽口径重写，详见 `docs/交接说明.md` §6.1）。**真机复验结果与两条真机坑见 `docs/真机复验清单.md` 第八节**（其中「录音中常驻小条命中区偏移」那条 2026-10-06 已复查为**不复现**）；设计正本与逐段进度见 `docs/结构动效前置约定.md`。*
*　↑ 这一段是 **Day 21 的历史快照**：那时是 v1.42.0 / 基线 94 脚本 / 12 个 sheets；此后 P12a/P12b/P13/P14 又加回了约 600 行与 1 个浮层，当前值见本页最上面那行。*

*同日**美术收口**（十段计划后补的一轮，已完成，并出了 **v1.42.1** 装机包 `dist-apk/schedule-v1.42.1-20261005.apk` / `versionCode 14201`，真机抽查已过）：① 84 处 `bg-ink/<alpha>` 次要底色换成逐主题不透明 token `bg-soft` / `bg-soft-2`（`web2/src/style.css`，四套皮肤各给值；工具 `web2/tmp/alpha-to-soft.mjs`）；② 二级页加 `.push` 推入动效（0.28s `translateX(100%)`，与 `.slide` 同曲线）。自检 `web2/tmp/motion-check.mjs`（9/0），真机抽查记录见 `docs/真机复验清单.md` 第八节末。*

*2026-10-08（Day 24 · 修掉检查台一个真实 Bug）：**现象**——检查台「先成功过一次、再点刷新且这次失败」时，**失败提示永远不显示，上一次的旧数据留在屏幕上冒充新数据**，「本次拉取」也停在旧时间；控制台里有 `Uncaught (in promise) TypeError: Cannot set properties of null (setting 'textContent') at loadList (index.html:237:53)`。**根因**——失败分支写 `document.getElementById('list-msg').textContent = …`，而 `#list-msg` 是 `#rows` 里的**初始加载提示**，成功分支 `document.getElementById('rows').innerHTML = html` 会把它整块换掉 ⇒ 「先成功后失败」时这一句对着 `null` 设属性当场抛异常；异常抛在 **catch 内部**，后面「写 `#rows`」「重置 `#last-updated`」两行再也执行不到。**修法**——新增 `showListError(text)`：不再假设任何节点一定在（逐个判 null）；失败时把数字区 `#counts` 设 `display:none`（**让「上一次的结果」不可能被看成「这一次的结果」**）、把 `#fetched-at` 写成「拉取失败 · 时间」、`#last-updated` 置 `–`。**教训**：「成功分支会换掉整块 DOM」时，失败分支**不能引用那块里的节点**——这是「先成功后失败」这类两段式路径才暴露的 bug，单测第一次就失败反而测不出来。**验证**——本地 `web2/tmp/day24-check.mjs` **12 过 / 0 挂**（三场景：打开就失败 / 先成功后失败 / 连续点 3 次）；**线上复验**（真实浏览器打公网静态托管、不关 CORS）**10 过 / 0 挂**，全程零 pageerror。**部署坑**：`tcb hosting deploy . /` 会报 `一致性发布失败，已自动回滚` + `missing=/index.html`（目录形式在本环境校验不过），**必须按 `tcb hosting deploy index.html index.html -e <envId> --safe --verify` 传单文件**；线上核对要取 `RawContentStream.ToArray()` 再 `[System.Text.Encoding]::UTF8.GetString()`（`.Content` 会乱码）。**测试自身的坑**：对页面做 `page.route` 网络拦截前**必须先等首访请求落定**（等 `#rows` 不再是「正在加载 …」），否则首访请求会被拦、后续断言全部错位。*

*2026-10-08（P14 调休 / 特殊日期）：国务院放假与学校补课是**两层**——国家层全国统一（可自动抓），学校层一校一策（浙大只在**纯矢量 PDF 校历**里写「10月6日与9月20日的课对调」这类话，**没有可抓的结构化源**）。用户拍板三条（m23021/m23594）：**① 抓不到学校层就不调休，绝不猜「补周一」；② 本轮不碰「第几周」口径（App 锚点 `first_monday=2026-09-07` 比校历的第 1 周早一周，等 release 清数据后用户自己改）；③ 考试周/校运会/寒假也要收进「特殊日期」**；④ 自动抓回来的**只填「放假」，补课日留空让用户自己选周几**；⑤ 打开 App 时**后台静默拉**，不打扰。落地：`store.js` 新增本机键 `web2.dayOverrides` + `normalizeDayOverrides` / `loadDayOverrides` / `saveDayOverrides` / `dayOverrideOf` / **`effectiveWeekdayOf(dateStr, overrides, naturalWd)`**（唯一判断入口）/ `isDayOff`；三种 kind 的语义是 **`off`=放假（课全空）· `swap`=补课（按 `useWeekday` 1–7 上）· `info`=只提示（**课照上**）**——`info` 曾被我错写成返回 `null`（=静默藏课），与它自己的文档注释直接矛盾，已修。接线 10 处调用点，**全部是「可选参数」**（不传则与加调休之前**逐字一致**，老数据零迁移）：`App.vue` 的 `todayCourses`（走 `todayEffWd` computed，因为 `todayIdx/todayStr` 是模块顶层静态常量）/ `frameTomorrowFirst` / `menuAddSlot` / `nextCourseDate` / `buildIcs` / `buildScheduleItems`（3 处）/ `weekVisible`（**重写成逐列**，把「本来就是列号」的 `weekday` 传下去，所以 `weekGrid.js` 一行没改）/ `conflictPool`；`notify.js` 与 `ics.js` 各自新增可选第 N 参。**独立日程（用户自己排的班会/日程）刻意不受调休影响**——调休只换课表。新增 `web2/src/data/holidays.js`：数据源 **`holiday-cn` 走 jsDelivr CDN**（实测 `raw.githubusercontent` **无 CORS 取不到**、`timor.tech` 可用但字段没它干净——**服务端能取 ≠ 浏览器能取**，必须实测），`parseHolidayCn` 只收 `isOffDay===true`、`mergeNationalOffs` **只补空缺绝不覆盖用户手标的条目**、缓存键 `web2.holidayCache`、**一律静默失败**（不抛不提示、不挡启动）。界面放在**设置二级页**新的一栏 `[data-dayover-section]`（日期 / 三种 kind / 补课才出现的七个星期钮 / 说明 / 删除 + 「从网上更新法定节假日」）——**独立落盘、改完立即生效**，不跟学期设置的「保存/取消」绑一起（用户是边看课表边改的）；今日页 `[data-today-mark]` 与周课表列头 `[data-day-mark]` 各挂一枚「放假/补课/提示」小标，**不然用户只会看到「今天没课」或「周六怎么有课」而不知道为什么**。**质量门抓到一处真问题**：新小标一开始用 `text-ink-dim` on `bg-soft-2`，9px 下只有 **4.29:1**（需 4.5）⇒ 改 `text-ink`。**两个 JS 陷阱写进注释**：`new Date('2026-02-30')` **不返回 NaN，自己滚到 03-02** ⇒ 合法性必须「解析后反拼、与原串逐字比对」（`store.js` 的 `sameLocalDate`）；`Response.body 只能读一次`。自检 `web2/tmp/dayover-check.mjs` **55 过 / 0 挂**（A 清洗与三语义 / B ics·提醒·下次上课日 / C 浏览器端到端含设置页加改删 / D 抓取纯逻辑）；**测试自身的三个坑**：`toISOString()` 是 UTC（东八区清晨日期错位）、`indexOf('20261007')` 撞上 `DTSTAMP`（要只数 `DTSTART:` 前缀）、headless Chrome 有真网会真抓 33 条节假日把「空态」夹具灌满（用 `ctx.route('**/*')` 只放行本地服务——**窄 pattern `**cdn.jsdelivr.net**` 实测不命中带路径的 URL**）。浙大那几条日期**只作测试夹具，不写进产品代码**（用户要求：以后要分享给别的学校，m22812）。*

*2026-10-08（P12b 后续 · 教务密码存系统密钥库）：升级前密码明文躺在 `localStorage`（App 私有目录、别的 App 读不到，但**确实是明文**）。用户此前拍板的可选项，本轮提到硬需求。**新建原生插件 `scripts/native/SecureStorePlugin.kt`**（`@CapacitorPlugin(name="SecureStore")`）+ **新建 `web2/src/data/secureStore.js`**（网页侧唯一出口）；`patch-android.js` 的 kt 清单与 `MAIN_TPL` 的 `registerPlugin` 各加一处。做法：`AndroidKeyStore` 里生成 AES-256 密钥（别名 `web2.secure.v1`），`AES/GCM/NoPadding` 加密，落盘格式 `base64(iv):base64(密文)` 存 SharedPreferences `web2_secure`；**私钥永不出系统**，应用只能「用」不能「读」。**刻意不设 `setUserAuthenticationRequired(true)`**：那会要求每次读密码都过生物识别，而这里的用途是「打开 App 自动登录」，加了指纹反而把自动登录变成手动。三个方法 `set/get/remove`；**`get` 的三态必须分得开**：`{value:null}` = 从没存过（首次登录，**不是错误**）、有值 = 读到了、`reject` = 存过但解不开（换设备 / 清过应用数据）——静默返回空会让用户以为「没记住」而不是「密码丢了」。**储存分工是这次的核心**：`eduLogin.js` 只管「非机密」（学号 / 记住开关 / 上次学年学期），密码单独走 `secretSet('eduPassword', …)` ⇒ **`localStorage` 里再也不出现 password 字段**（自检有一条专门盯这个）。三条必须守住的口径：① **老用户无感** —— `loadEduAccountAsync()` 发现密钥库空而老 `localStorage` 有密码就搬过去并抹掉明文，不用重输；② **不勾「记住」就删密钥库旧值**，否则下次还会自动登录、开关等于没作用；③ **写密钥库失败时绝不退回明文**，如实返回 `secretError`。浏览器没有密钥库 → 如实退回老办法并在界面标注「当前环境没有系统密钥库」，不做假成功。自检 `web2/tmp/secure-store-check.mjs` **29 通过 / 0 挂**（假插件能造「解不开」「写失败」两种真机上很难复现的状态）。测试自身的两个坑（已修）：假插件 `corrupt()` 最初只写乱码而**没有模拟抛异常**（导致 A2e/B5b 假红）；C2b 期望写错 —— 密钥库里有密码时 localStorage 坏了，**密码仍读得出来**，恰是「机密/非机密分开存」的好处。**教训：直接拿 APK 原始字节搜 `SecureStorePlugin` 搜不到**（dex 是压缩的），必须先解压再搜，否则会得出「插件没打进包」这种错误结论。

---
*2026-10-06（P1 / P2）：**P1 正式签名链**本地一半就位 —— 仓库外密钥 `D:\Document\Project\.keys\schedule-release.jks`、壳仓 `android/key.properties`、`signingConfigs.release` 由 `scripts/patch-android.js` 幂等固化（重生成原生工程也能复现）、出包 `dist-apk/schedule-v1.42.1-20261006-release.apk`（证书 `CN=Schedule Assistant`），**真机换签名挂起**（要先留 debug 包做 P3 远程调试）。**P2 练耳记号可见可撤销**：通知栏按过的「我去听了」现在在碎片练耳二级页顶部（收起态也看得见）和今日页「今天要听」那行都能看到、能撤销（`web2/src/data/statusFrame.js` 新增 `unmarkListenDone`，`App.vue` 新增 `frameMarksToday` / `frameMarkedClips` / `unmarkListenDone`），顺带修掉 `dueClips()` 不看记号导致的两处口径打架。自检 `web2/tmp/listen-mark-check.mjs`（19/0）。*

*2026-10-06（P3 / P4）：**P3 真机坑 B 结案 —— 不复现（未改代码）**：录音中常驻小条的「画面位置 vs 命中位置」在真机上逐像素对齐（截图找红条 中心 y=2446 / 高 106；DOM `getBoundingClientRect`×dpr3.5 中心 y=2447 / 高 107 ⇒ 差 1px），按画面中心注入点击命中 `REC-BANNER` 且真进了「课堂录音」，小条四周一圈探测全判 `REC-BANNER`；用户手指复验同样通过。旧结论「命中区高约 120px」是**用预览截图乘 1.4388 估坐标**推出来的（当时小条还带 `transform`）。真机几何的正确量法：`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` + playwright-core `connectOverCDP`。**P4 六期第三步 AI 判读**：`web2/src/data/summarizer.js` 新增 `phraseFact()` + `sameFacts()` 数字闸门（「规则算数、AI 只说」：AI 回话里的数字必须是原句数字的子集，否则整句丢弃退回规则原句，界面不标来源），`App.vue` 新增 `patternAi`/`patternLine`/`askPatternLine`，`ReviewSheet` 只在账卡真的摆上台面时才问一次 AI。自检 `web2/tmp/pattern-ai-check.mjs`（21/0）。同轮把 `BottomSheet` 的滚动从**面板**挪到**内层**（面板 `overflow-hidden` + 内层 `min-h-0 flex-1 overflow-y-auto`），质量门 E6「浮层超屏」2 处清零（`step5-check` 的 A3/A4 跟着改成量内层，并新增 A3b 守住「滚动在内层」）。版本 → **1.42.2**。*

*2026-10-06（P12a 教务课表导入）：用户拿到浙大教务（**方正 zfsoft**）导出的课表 `课表_3240103876.xlsx`，并拍板「**不要追加，我只希望有一套课表**」+「**A + 要快照**」。落地口径：**只替换 `web2.data` 里 `type==='course'` 的条目**（同文档里的 todos / events / routines / semester 原样不动）、清掉 `web2.added` 里的**课程**（非课程保留）、替换前把旧课表原文写进 `web2.eduSnapshot` 可一键恢复。新增 `web2/src/data/eduImport.js`（解析器，纯函数、自己解 zip、不引库）+ `App.vue` 的全屏预览浮层（`data-edu-preview`，逐门列星期/节次/钟点/周次/地点 + 「没进课表」+「需要注意」，**二次确认**才写，解析失败明确报错且不动数据）+ 设置页「从教务导入课表」与「恢复上一套课表」。模型扩展：`course` 新增可选 `weeks: number[] | null`，`matchWeek` 有 `weeks` 只认它、`null` 照旧走 `every/odd/even` ⇒ **老数据无需迁移、行为逐字一致**。三份文档已同步（`PRD.md` 那条「❌ 教务系统自动导入」部分推翻、`TECH_DESIGN.md` 字段表与模块表、`大学生日程助手-设计方案.md` 的 `weeks` 与「重新导入课表」口径）。自检 `web2/tmp/edu-import-check.mjs`（纯逻辑 32/0，带真文件 40/0）+ `web2/tmp/edu-ui-check.mjs`（界面端到端 20/0）。版本 → **1.42.2**。*

*2026-10-06（P12b 教务直连 · 真机跑通）：设置页新增「**登录教务网抓课表**」（在「从教务导入课表」上面，直连是主路径、选 .xlsx 是备胎）。壳仓 `capacitor.config.json` 打开 **`CapacitorHttp`**（②甲：请求走手机原生网络，绕开浏览器跨域）。新增 `web2/src/data/eduLogin.js`（统一身份认证三步 + 取课表 + 翻译 + 按学期筛 + 账号存档）与 `web2/src/sheets/EduLoginSheet.vue`（登录浮层；**手动写浮层**，因为它是从 `z-40` 的二级页里开的）。抓回来的课走**同一个预览核对页**（复用 P12a 的二次确认 / 只换课程 / 快照可恢复）。**两个只有真机+真数据才能发现的坑（都已写进代码注释）**：① 浮层用共用组件 `BottomSheet`（`z-30`）会被 `z-40` 的设置二级页**整个盖住** —— DOM 量得到、断言全过、**截图上空的**，靠"两张截图字节完全相同"才发现；② 教务课表接口**不认**请求里的学期参数、且**把好几个学期混在一起返回**（实测 56 行 = 本学年秋冬 14 + 去年秋冬 18 + 去年春夏 24），而**光看「小学期文本」分不开去年与今年**（两年秋冬都写「秋冬」）⇒ 只能按**选课课号前缀 `(2026-2027-1)`** 本地筛。诊断方式值得记下来：`adb forward` 把 WebView 调试口转出来 + playwright `connectOverCDP`，**在真机页面里直接把原始返回读出来看**，比一轮轮猜省事得多。同轮补了 `web2/tmp/edu-compat-check.mjs`（老数据兼容实测 9/0，满足 AGENTS 八.2）。

*2026-10-07（Day 27 · P5 通知栏「甲」精修）：用户拍板「甲」（精修细节、不动结构），点通知本体走「**跟着场景走**」（按钮那一半当天又收窄成只剩一枚「开始录音」）。**策略只在网页侧定义一处**（与 `listen` 同一条纪律），原生只管照着画。五件事：① **自己的通知小图标** `scripts/native/res/ic_frame_notify.xml`（矢量钟面，按 alpha 当遮罩重着色）—— `android/` 整个目录被 gitignore，所以 `patch-android.js` 新增第 **4b 段**（`scripts/native/res/` → `android/app/src/main/res/`，逐目录 `mkdir` + 覆盖拷贝），**漏了这步 = 编译期「找不到符号 `R.drawable.ic_frame_notify`」**；② 标题**只留课名**（`现在 · 课名` 里的「现在 ·」是废话）；③ `setUsesChronometer(true)` + `setChronometerCountDown(true)`，倒计时**由系统自己走**、不再靠 30 秒重画；④ **状态栏胶囊**（Android 16 promoted ongoing）：`b.extras.putBoolean("android.requestPromotedOngoing", true)` + `putString("android.shortCriticalText", chip)`（chip ≤7 字）——**用裸 Bundle 是因为 `compileSdk = 35` 而这两个 API 36 才进 `android.jar`**（本机 `javap` 对着 `android-35/android.jar` 实测缺这两个 setter，键字面值已在 `Notification.java` 确认）；⑤ **按钮收窄为只剩一枚 + 点通知跟着场景走**：网页侧 `statusFrame.js` 新增 `export const LEDGER_FROM = 18*60` + 快照字段 `tapLedger`，`App.vue` 的 `pushFrameNow()` 多推 `nowMin`/`ledgerFrom`，`applyFrameActions()` 新增 `openLedger` 分支（只 `openReview('ask')`、不改数据、不 pushFrameNow）；**「上完了 / 我去听了 / 结账」三枚按钮当天就被用户继续收窄砍掉**，原生 `build()` 只剩 `if (t.canRec)` 一段 addAction，判据三条「①此刻真需要 ②比开 App 明显省事 ③不重复通知本体」逐条不成立。**`Notification.MAX_ACTION_BUTTONS = 3`**（`sources/android-37.0/android/app/Notification.java:322`，:7435 计数到 3 就 break，注释明写故意不让第 4 枚折进来）是当初「只能换不能加」的依据。**`requestCode` 仍必须区分**（`PendingIntent` 判等看 action/data/component/`requestCode`，**不看 extras**）——`REQ_TAP=8810` 与 `REQ_TAP_LEDGER=8814` 两个不同的码（原「结账」的 `REQ_LEDGER=8815` 已随按钮删除）；② **`minOf` 只认 `'HH:MM'` 字符串**，而 `pushFrameNow()` 传的是**数字**分钟数 ⇒ 恒 `-1` ⇒ `tapLedger` 永远 false、点通知永远只回今日页；新增 `minAny(v)`（数字走 `Math.round`，否则回落 `minOf`）+ `tapLedger: afterLedger && !inClass`（**上课中即便过了 18:00 也回今日页**；**拿不到时间就不给结论**，与 `dndMin()` 的「省掉 ≠ 0」同一条纪律）。自检 `web2/tmp/status-frame-check.mjs` **63 过 / 0 挂**（A17–A22 `tapLedger` 纯逻辑六项 + B14 已砍动作被无声忽略 + C5–C7 假原生桥发 `openLedger` → 复盘浮层出现**且 `web2.frame.marks` 仍为 null**）。**这次改动带出一处真实回归并已修**：`listenDone` 记号改由 `listenAutoMark()` 在放满遍数时写，于是放满 3 遍瞬间「今天已去听过」卡片凭空出现，其 `<li>` 抢在练耳行前面 → `listen-ui-check.mjs` 的 `li:hasText(段名).first()` 挑到没有播放按钮的记号卡而超时。修法是给定位加 `.filter({ has: locator('[data-listen-play]') })`（**断言一条没放松**），复跑 **92 过 / 0 挂**。**质量门也顺手修掉一处判据盲点**：`quality-scan.mjs` 的 E3 只量元素盒、不量 `::after`，把 `WeekPage.vue` 那个视觉 36×20 但真实命中区 56×40（`after:-inset-[10px]`）的录音钮误报成 4 处问题 → 新增 `hitBox(el)` 把伪元素盒并入判定，**合计 0 处问题**。**另外**：本次全量基线一开始有 4 个红，逐一定位**全部是「今天恰好是周三」的日期敏感假红**（`pattern-ai-check`「共 N 个周三」的 N 会因 `snapshotToday()` 把今天也记进去而变；`step2-check` B2 无条件断言「进行中 · 」而 mock 周三 10:00 没课；`density-fade-check` F2/H 把周二形状写死 —— 折叠行是**替掉**那条已过行，周三 12:30 实测 F 反而矮 2px），**全部改写为按真实不变量断言**（行集合成员关系 / 同一分支自适应 / 「有折叠行且写着件数且行数更少」），**没有放松任何断言**；剩下 `wheel-touch-gesture-check` 是既有 flaky。*

*2026-10-06（P13 小学期）：用户发现「标秋/冬的课在整学期里都显示」——因为 App 之前**没有小学期这一层**（课程上的 `term`（秋/冬/秋冬）存了却完全没参与周次判断）。按用户拍板落地：**秋 = 第 1–8 周、冬 = 第 9–16 周（对半分）**，存进 `semester.sub_terms`（跟节次表 `periods` 同一处 —— 都是校历参数、跟着主项目 JSON 导出走），**学期设置里可编辑**（名字也能改成 春/夏，所以春夏学期同一套用），另给一个「按总周数对半分」按钮；周课表标题顺带显示「· 秋学期 / · 冬学期」方便一眼核对。`matchWeek(c, weekNo, subTerms)` 加了**可选**第三参：不传就与 P13 之前**逐字一致**（老调用点不会静默变行为），全部 10 个调用点都已显式传上（含 `ics.js` 与 `nextCourseDate`）。口径：`秋冬` = 两个小学期名都命中 → **并集 = 整学期**；**没写学期的手动课/老课整学期都在（行为不变）**；`短`（暑假）**暂不参与**（用户拍板先不管）—— 但会在预览「需要注意」里如实说明，不静默丢。老数据没有 `sub_terms` → **按总周数对半分兜底、不做迁移**（`subTermsOf()` 同时认 snake `sub_terms` 与 camel `subTerms`）。自检 `web2/tmp/subterm-check.mjs`（**22/0**：纯逻辑 12 条 + 浏览器 9 条，含"与显式 weeks/单双周叠加""换一套表判断跟着变""老数据兜底"）。**质量门抓到一处真问题并已修**：新加的「· 秋学期」标签一开始用 `text-primary-500`，暗色卡片上只有 3.69:1（需 4.5）→ 改 `text-ink-dim`（元信息本来就该用次要文字色）。

*2026-10-07（Day 27 · P9 出包收成一条命令）：新增壳仓 `scripts/ship.js`（约 480 行）+ `package.json` 两条 script `ship` / `ship:release`，把原来 5 步手工出包（`web2` 构建 → `sync` + `patch-android` → `gradlew` → 拷 `dist-apk/` 并命名 → `verify-apk.py`）收成一条，**任一步失败立即非 0 退出**。它做的事：① 前置体检（主项目 / `android/` / JDK21 都在；`--release` 缺 `android/key.properties` 直接退出、**不静默退回 debug 签名**）；② `npm run build` + 校验 `dist/index.html` 新鲜；③ `npm run sync` + `patch-android` + 校验 `www/index.html`；④ **先删上一轮 apk** → `gradlew --stop` → `gradlew assemble<type>`（JDK21 由脚本显式注入、不依赖系统 `JAVA_HOME`）→ 产物不存在即报错 → `aapt2` 核 versionCode/Name → `--release` 时 `apksigner` 核签名、**DN 含 `Android Debug` 直接判「假 release 包」**；⑤ 自动命名归档 + 大小比对 + sha256；⑥ `verify-apk.py` 三级校验（自动注入 `PYTHONIOENCODING=utf-8`）。实测（2026-10-07）：debug 全链 **20.0s** → `dist-apk/schedule-v1.42.2-20261007-debug.apk`（37,484,194 B）；release 全链 **31.8s** → `dist-apk/schedule-v1.42.2-20261007-release.apk`（36,419,684 B，签名 `CN=Schedule Assistant`，证书 SHA-256 `1420dda8…` 与 `.keys/schedule-release.jks` 一致）；两个失败用例（主项目路径 / JDK21 路径不存在）都正确非 0 退出。**踩到的坑**：`findPython()` 最初用 `execSync` 拼字符串探测，`-c import sys` 的参数被 shell 拆开导致误报「找不到 python」→ 改 `spawnSync` 数组传参（`shell:false`），顺带也解决了路径带空格的问题。规矩落点：`AGENTS.md` **八.4**、`docs/交接说明.md` §4.2（原手工 5 步折叠进 `<details>` 留作原理说明）、本文件 §五第 4 条铁律。*

*2026-10-07（Day 23 · 安全审计与三类错误统一）：今日清单是「审计 → 修复」——硬编码密钥 / 裸报错 / 非法输入 / `.gitignore` 完整性。**审计结论（红线干净）**：`git ls-files` 全部 **303** 个被跟踪文件按密钥**真实形状**（`AKID…` / `-----BEGIN … PRIVATE KEY-----` / `sk-` 长串 / `API_KEY=` 实值 / JWT / 数据库连接串）扫描 **0 命中**；`git log --all -S <value>` 查**全历史 141 个提交**同样 **0 命中**，历史上从未提交过 `cloudbaserc.json` 或 `.env` ⇒ **无需作废重发密钥**。（做法要点：`git ls-files -z` 按 NUL 切 + `Test-Path -LiteralPath`，否则中文文件名被 git 转义成 `"docs/\347…"` 导致路径非法；只看密钥形状、不匹配 `sk-…` 这种省略号占位符，避免把文档误报成泄漏。）**修掉两个真实缺陷**：① **`.gitignore` 漏洞** —— `.env.*` 把模板 `.env.example` 一起忽略了（`git check-ignore -v` 实测命中该行），新人拿到项目不知道要配哪几个变量；补一行 `!.env.example` 放行模板，`.env` / `.env.local` / `.env.production` 仍被忽略（**没有放松**），并新建只有占位符的 `.env.example`（`TCB_ENV_ID` / `CLOUDBASE_API_KEY` / `WRITE_TOKEN` / `API_BASE`）。② **裸报错与口径不一致** —— 改动前 `list` 的失败响应**只有 `{ok:false,message}` 没有 status**（前端分不清「你填错了」和「服务端炸了」），而网络层把 Node 的英文原文（`fetch failed` / `ECONNREFUSED` / `ETIMEDOUT`）直接冒给使用者，`write` 兜底还用了 `String(e)`（非 Error 对象会得到 `[object Object]`）。**修法**：新建 `cloudfunctions/write/errors.js`，按「人拿到之后该做什么」分三类 —— `kind=input`（你填错了，自己改）/ `network`（没送到，可重试）/ `server`（对方坏了，重试没用），响应统一成 `{ok:false,kind,message,status}`；`list/errors.js` 是**逐字节副本**（CloudBase 按 `cloudfunctions/<函数名>/` 整目录打包、两函数不能互相 require；自测用 SHA256 校验两份一致，**改一份忘另一份立刻报错**）。`networkReason()` 用**包含匹配**认 12 种网络错（Node 报错带前缀如 `TypeError: fetch failed`，精确相等匹配不上）→ 一律换成中文，**不匹配也兜底成中文**；**老文案逐字保留**（`course / event / routine`、`1~500`、`检查 CLOUDBASE_API_KEY`、`检查 TCB_ENV_ID`、`请求失败`、`没有找到这条记录`），Day 17 老脚本复跑仍全绿。**余力加练的请求日志**只记「时间 / 方法 路径 / 动作 表 id / 结果」，**不记请求体、不记参数值**（请求体可能有整行数据、也可能有人把口令塞进去）。**一个必修的实现细节**：`list/db.js` 必须先把 body 读成文本再 `JSON.parse`（`const text = await res.text()`）——**Response.body 只能读一次**，先 `res.json()` 失败再 `res.text()` 会拿到空串、把上游错误原文丢掉。**验证**：本地 `day23-errors-selftest.js` **57 过 / 0 挂**（含「把假密钥塞进环境变量，断言任何错误文案都不回显它」的红线断言）+ Day 17 `list-fn-selftest.js` 复跑 **31 过 / 0 挂**；**部署到 CloudBase 后用真实公网 HTTP 复验 16 过 / 0 挂**（`tcb fn deploy list|write -e <envId> --force`；注意 `cloudbaserc.json` 原先只声明了 `write`，`fn deploy list` 会提示用默认配置，已给该文件补上 `list` 条目并**复用同一组 envVariables**，避免部署把变量清空）。两张交付截图：`.workbuddy/tmp/day23-secret-scan.png`（搜密钥 0 条）、`.workbuddy/tmp/day23-error-kinds.png`（三类错误改前/改后对照 + 线上 16 过原文）。文档同步：`docs/api-contract.md` 新增 **6b 节**（三类口径表 + 验证方法表）、`TECH_DESIGN.md` 七、环境变量拆成 7.1 云端 / 7.2 前端 / 7.3 三类错误、`PRD.md` 新增 **F14**、`大学生日程助手-设计方案.md` 新增「云端接口的错误口径」一节。*

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
| `App.vue` | 单一状态持有者 + 外壳（顶卡 / 内容平移层 / 底部 nav / 二级页 Teleport 容器）；Day 21 那次拆分是 **6902 → 4127 行**（历史值），**2026-10-08 实测 4745 行**（后续 P12a/P12b/P13/P14 又加回来了）；页面与浮层全部拆到下面几处，靠文件末尾生成的 `APP_CTX` 区块（**792 个绑定**，以 `node web2/tmp/gen-app-ctx.mjs --check` 的输出为准）provide 给子组件 |
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

后端线（跟五期并行）：Day 15 `/api/health` 上线 → Day 16 建库灌数 → Day 17 `/api/list` 读接口上线 → **Day 22 写闭环上线**：`write` 云函数 + `POST /api/create` / `PUT /api/update` / `DELETE /api/delete` 三条网关路由公网验收（契约见 `docs/api-contract.md`，1–5 号接口现全部「✅ 已实现」；原 `/api/favorite` 业务上不存在已移除）→ Day 20 前端页面从 mock 练习页改成「数据检查台」（真实数据 + 最后更新时间 + 刷新 / 写入测试入口）并重新部署到静态托管。**Day 22 收尾时检查台的删除按钮补上了两段式二次确认**（第一次点只进入待确认、3 秒不点自动复位，避免误删），并新增了一份「同一个 id 操作前后各 select 一次」的对比验证脚本（见 `docs/api-contract.md` 第 7、8 节）。

📱 **攒着等手机连上验的项**（状态框勿扰时段 / 精确提醒引导 / 时间感三件套 / 每日复盘提醒链路）见 `docs/真机复验清单.md`——电脑上验不了，别重复怀疑是代码坏了。

## 四、数据流（一条线记住）

```
web2 导出 JSON ──→ 主项目 js/store.js 校验（硬闸门）──→ db/schema.sql 三张表
（semesters / schedules / todos，CloudBase PostgreSQL）
        ↑ cloudfunctions/list 用 CloudBase REST API 读这三张表，公网返回 {ok, data}
        ↑ cloudfunctions/write 用同一套 REST API 写这三张表（create/update/delete，
          需 X-Write-Token；「id 不存在」一律中文 404）
```

- 五个接口已上线的公网地址见 `docs/api-contract.md`「环境信息」。
- 云函数凭据只放在**函数环境变量**（`TCB_ENV_ID` / `CLOUDBASE_API_KEY`），永远不进代码、不进 git、不进聊天。仓库里的模板是 `.env.example` 与 `cloudbaserc.example.json`（**只有占位符，必须进仓库**）。
- **失败响应统一带 `kind`（Day 23）**：`{ ok:false, kind, message, status }`，`kind` = `input`（你填错了，自己改）/ `network`（没送到，可重试）/ `server`（对方坏了，重试没用）。定义与文案只有一处 `cloudfunctions/write/errors.js`，`cloudfunctions/list/errors.js` 是**逐字节副本**（CloudBase 按目录打包、两函数不能互相 require；测试用 SHA256 校验两份一致，**改一份忘另一份会立刻报错**）。英文异常原文一律不出现给使用者，兜底不用 `String(err)`。表与验证方法见 `docs/api-contract.md` 第 6b 节。
- **`.gitignore` 有一个必须记住的坑（Day 23 实测修掉）**：`\.env.*` 会连带忽略模板 `.env.example`，所以文件里紧跟其后有一行 `!.env.example` 专门放行模板。**新增 `.env` 变体前先 `git check-ignore -v <文件>` 确认它到底是被忽略还是被放行**。
- **权限：改名/加规则前先实测**——`git check-ignore -v` 是唯一可信的判据（读 `.gitignore` 文本会漏掉否定规则）；扫被跟踪文件要 `git ls-files -z` 按 NUL 切 + `Test-Path -LiteralPath`，否则中文文件名会被 git 转义成 `"docs/\347…"` 导致路径报错。
- **两个线上地址别混淆**：`college-schedule-assistant.app.workbuddy.host` ＝ web2 应用本体（TECH_DESIGN §2.3 的线上入口）；`*.tcloudbaseapp.com` ＝ Day 15 mock 练习页（api-contract 的静态托管）。互不替代。
- **`/api/list` 的 type 白名单目前只有 `course/event/routine`**（`cloudfunctions/list/index.js` 的 `allowedTypes`）——exam 与未来预留的 lectures/reviews 还没进白名单，**四期/五期开单时必须同步扩**（函数白名单 + api-contract + schema 注释三处）。

## 五、三条铁律（都真实踩过坑）

1. **加新数据类型必须同步改主项目 `js/store.js`**：未知 type 会被 `validateSchedule()` 报错、`importAll()` 整份拒收；数据形状由 web2 侧写死（如 `fullRoutine()`）。只改 web2 不改主项目＝用户导出的数据直接报废。
2. **外壳给状态栏让位必须用 fixed 遮罩，绝不能用流内 padding**：padding 属文档流，一滚就滚出视口。
3. **APK 打包链里 `npx cap sync android` 会被批量删除守卫拦截**（删重建插件目录超过阈值）→ 只用 `npx cap copy android`；真要 sync 让用户自己开终端跑。
4. **出包只跑一条命令**（Day 27 起，施工单 P9）：壳仓 `cd D:\Document\Project\vibe-coding-project-app` → `npm run ship`（debug 冒烟）/ `npm run ship:release`（交付包）。`scripts/ship.js` 一次做完「web2 构建 → sync → patch-android → gradle(JDK21) 打包 → 归档 `dist-apk/` → `verify-apk.py` 三校」，**任一步失败立即非 0 退出**。之所以必须收成一条：原来第 ④ 步 `Copy-Item` 是独立命令，gradle 失败时它照跑，会把**上一轮的旧包**改名归档成新版本（2026-10-03 真踩过）——现在跑前先删旧产物、gradle 退出 0 但产物不存在即报错、release 包签名若是 `CN=Android Debug` 直接判「假 release」。参数见 `node scripts/ship.js --help`，原理对照见 `docs/交接说明.md` §4.2。

## 六、工作规矩速查（全文见 AGENTS.md，这里只列最容易踩的）

- **清单即边界**：只做用户当天清单里的事，不多建文件、不顺手优化；拿不准先问。
- **一次一步**：每步做完停下报「做了什么/改了哪些文件/怎么验证」，等用户说「进入下一板块」；简单低不确定任务可以直接做（由 AI 判断并说明理由）。
- **commit**：标题 `Day X｜一句话`，正文两行（改了什么/加了什么）；提交前先列文件清单等用户确认；一天任务全做完才提交。
- **git 禁忌**：禁止 `git reset --hard`、禁止强推；撤销用 `git revert`；推送前做代理连通性预检，预检不过就停。
- **文档同步**：改数据模型或项目范围时，同步更新 设计方案 / `PRD.md` / `TECH_DESIGN.md` 三份。
- **数据兼容**：动 `store.js` 字段或 `schema_version` 必须带旧数据升级方案，并实测旧数据可读。
- **验证要实证**：结论要附用户能亲眼确认的证据；web2 发布后的线上实证用版本串/特征串/行为断言，**hash 与字节数不适用**（沙箱重构建，产物必不同）。
- **界面质量门**：`cd web2` 再 `node tmp/quality-scan.mjs` → **0 处问题**（2 视口 360×640 / 390×844 × 亮/暗 2 主题 × 12 个状态；查异常文案 `NaN` / 横向溢出 / 元素出界 / 触控目标 <24px / 对比度 / 被遮挡 / 浮层超屏）。**改主题色、文案颜色、色板之后必须跑，跑到 0 处**；`SHOT_ALL=1` 出 32 张 `qa-*.png` 肉眼复核。颜色规则见 `TECH_DESIGN.md` §2.2.1（说明文字实色、主色当文字用 `primary-600`、暗色单独看）。
- **测试基线**：`cd web2` 再 `node tmp/day19-baseline.mjs` → 全量 **95 个脚本**（2026-10-08；flaky 两条见上；`step2-check.mjs` 的 5 条过期期望已重写为自洽断言。脚本清单与逐个退出码见 `web2/tmp/day19-baseline.txt`，以那份为准）。**跑之前先确认 4177 静态服务在**：`run_in_background` 起的 `node serve.js` 会随 job 一起死（症状：所有浏览器脚本 3 秒内集体失败），要用 detached `Start-Process -FilePath "node" -ArgumentList "serve.js" -WindowStyle Hidden`。脚本变红**先怀疑脚本自己的陈旧前提**，不是产品坏了：日期敏感（今天没课/周末）、**时刻敏感**（`slots-notify-check.mjs` 写死「排 7 天」而 `review.js:noticeDate()` 当天已过就返回 null ⇒ 22:00 后只有 6 条；`listen-ui-check.mjs` 写死「今天可听」而可听窗口 07:00–23:00 且会滤掉已过去的空档 ⇒ 23:00 后本该显示「自己找时间听」—— 两处都已改成按当前时刻现算期望，**没有放松断言**）、端口写死（dist 静态服务在 **4177**、Vite dev 在 **5180**）、缺 `[data-page="me"]` 作用域（报 `element is outside of the viewport`）、dist 上没有 `/src/…`。排查套路见 `TECH_DESIGN.md` 附录速查最后一行。**状态断言别 match class 名**（当前 tab 用 `nav button[data-active]`）。**带假原生桥的脚本，假桥必须有状态**：`getPending()` 要回上一轮排的、`cancel()` 要真按 id 摘掉，否则第二次排程清不掉旧的、条数翻倍（`slots-notify-check.mjs` 首跑就是这么误报 14 条）。**改完必须先 `npx vite build`**（断言的脚本走 dist 静态服务，不重建就等于测旧包）。

## 七、新 Agent 的第一个任务（建议）

只读熟悉项目：读 `AGENTS.md` → `docs/api-contract.md` → `db/schema.sql` → `cloudfunctions/*/index.js` → `web2/package.json` → `js/store.js`，然后向用户输出一份全貌汇报（项目是什么/结构/进度/规矩/坑），并列出看不懂的地方。**确认读懂之前不要改任何文件。**
