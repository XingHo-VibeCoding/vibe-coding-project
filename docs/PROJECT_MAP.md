# 项目地图（给新接手的 AI Agent）

> 本文件是 AI 助手（DSH / Claude Code / 其他 Agent）的导读。
> 分工：`AGENTS.md` 管「**怎么和用户配合干活**」（规矩，必须先读），本文件管「**项目是什么、东西在哪、做到哪、有哪些坑**」。两份都读完再动手。

*最后更新：2026-10-02（Day 17）*

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
├── web2/                # 概念版应用（Vite 构建，当前 v1.38.0，已上线）
├── db/                  # schema.sql + seed.sql（PostgreSQL 版，Day 16）
├── cloudfunctions/      # 云函数（health=Day15 健康检查，list=Day17 读接口）
├── mock-frontend/       # Day15 部署练习页（部署在静态托管）
└── docs/                # api-contract.md（接口契约）、Day15-复盘.md、本文件
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

`web2/`（概念版，独立可运行）：`src/` 源码、`dist/` 构建产物、`serve.js` 本地预览；**升版本号只改 `web2/package.json` 一处**。

## 三、五期路线与当前进度

| 期 | 功能 | 状态 |
|---|---|---|
| 1 | 课表识别 | ✅ 完成 |
| 2 | 录音总结 | ✅ 完成 |
| 3 | 打卡（含每日打卡、日程清单页） | ✅ 完成（2026-10-02 收尾） |
| 4 | 碎片练耳 | ⬜ 未开始（等用户开单） |
| 5 | 复盘 | ⬜ 未开始 |

后端线（跟五期并行）：Day 15 `/api/health` 上线 → Day 16 建库灌数 → Day 17 `/api/list` 读接口上线（契约见 `docs/api-contract.md`，只实现了表里的 1、2 号接口，3–5 号还是占位）。

## 四、数据流（一条线记住）

```
web2 导出 JSON ──→ 主项目 js/store.js 校验（硬闸门）──→ db/schema.sql 三张表
（semesters / schedules / todos，CloudBase PostgreSQL）
        ↑ cloudfunctions/list 用 CloudBase REST API 读这三张表，公网返回 {ok, data}
```

- 三个接口已上线的公网地址见 `docs/api-contract.md`「环境信息」。
- 云函数凭据只放在**函数环境变量**（`TCB_ENV_ID` / `CLOUDBASE_API_KEY`），永远不进代码、不进 git、不进聊天。

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

## 七、新 Agent 的第一个任务（建议）

只读熟悉项目：读 `AGENTS.md` → `docs/api-contract.md` → `db/schema.sql` → `cloudfunctions/*/index.js` → `web2/package.json` → `js/store.js`，然后向用户输出一份全貌汇报（项目是什么/结构/进度/规矩/坑），并列出看不懂的地方。**确认读懂之前不要改任何文件。**
