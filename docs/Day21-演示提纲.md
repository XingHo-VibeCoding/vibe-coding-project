# 第 3 周演示提纲（3–5 分钟）

> 演示对象：大学生日程助手 · 后端线（CloudBase + PostgreSQL + 云函数）
> 建议时长 **4 分 30 秒**（每段可压缩；3 分钟版把 ③ 压到 30 秒、⑤ 只念一句）
> 演示前置：一个 PowerShell 窗口、一个浏览器标签（公网检查台）、可选一个 CloudBase 控制台「数据库 → 表行数」页

---

## ① 用户问题（0:00–0:30）

> 「教务系统只能看课，手机上既没有提醒，也不方便随时翻『今天还有什么』。我想要一个**自己的**日程助手：课表能一次导进去、手机上随时看得到今天和这一周、快上课前能被提醒——而且数据得落在云端，换手机不用重录。」

要点：一周就为这三件事——**数据落云端**（不锁在某个浏览器里）、**公网可读**（任何设备打开就能看）、**可验证**（不是演示用的假数据）。

## ② 核心流程（0:30–2:00）——含一次真实写入 + 刷新持久化

1. 打开静态托管页（**公网地址**）：`https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com`
   - 首次访问会先出 CloudBase 测试域名的「风险提醒」，点一次「确定访问」进页面（这是云厂商对测试域名的拦截，不是我们的页面）。
   - 页面顶部状态点变绿：`后端连通，返回：{"ok":true}`。
2. 点「**刷新数据**」→ 页面显示：**学期 6 / 日程 22 / 待办 10**、当前学期「2026 秋」的课程列表、未完成待办，「数据最后更新」取库里最大的 `updated_at`。
3. **真实写入环节（如实说明）**：点「写入测试」会看到页面自己写的一段解释——`POST/PUT/DELETE` 还没实现，今天点不出真正的写入。**这一步我不做假动作**：直接说明后端本周只完成读闭环。
   - **替代验证（仍然证明"读的是真库"）**：在 CloudBase 控制台把某条待办的标题改一个字（或加一行）→ 回到页面点「刷新数据」→ 数字 / 列表跟着变，且「数据最后更新」跳到新时间。这说明页面没有任何写死数据。
4. 一句收口：「所以本周的真正闭环是 **建表 → 种子 → 只读接口 → 公网页面**，写入是下周第一件事。」

> 演示时**不要**去改生产数据：本轮验收全程只读；如果要现场演示"库变了页面就变"，只改测试环境里的一条待办标题，演示完改回。

## ③ 提示词改写过程（2:00–3:00）

四次改写，每次都是"上一步的结果暴露了新约束"：

| 轮次 | 一开始怎么说 | 改成了什么 | 为什么改 |
|---|---|---|---|
| 1 | 「帮我写一个日程助手的后端」 | 「用 CloudBase + **PostgreSQL**；先只做 `GET /api/health` 并保证**公网可访问**」 | 环境先钉死（Day 16 才发现只有 PG，MySQL 建表语法整段要改）；先证明"通路"再谈功能 |
| 2 | 「把接口都实现」 | 「只做**只读** `GET /api/list`；返回必须带 `counts`，作为和数据库控制台对账的凭据」 | 范围收窄到一个能当场验证的接口；`counts` 让"取漏了"一眼可见 |
| 3 | 「代码写得干净点」 | 「把**数据访问**从接口里拆出去：接口层不许出现 URL / headers / `process.env`」 | "干净"无法验收，"接口层不许出现什么"可以验收（Day 19 拆出 `db.js`，接口形状不变） |
| 4 | 「记得同步文档」 | 「每次改接口，同时改三处：**函数里的类型白名单 + `docs/api-contract.md` + `db/schema.sql` 注释**」 | 单一处改动必然漂移；把"三处同步"写成硬规则，契约才可信 |

一句话总结给听众：**把"做得好"改写成"能当场验证的形状"**。

## ④ 验证方式（3:00–4:00）

| 验证 | 命令 / 动作 | 期望 |
|---|---|---|
| 服务活着 | `curl -i https://.../api/health` | `200` + `{"ok":true}` |
| 读到真库 | `curl -s "https://.../api/list?limit=200"` | `ok:true`，`counts 6/22/10`，含真实行与 `updated_at` |
| 写接口不存在（诚实标记） | `curl -X POST .../api/favorite -d '{}'` | `404` + `{"code":"INVALID_PATH"}` |
| 跨域只放白名单 | 带 `Origin: https://evil.example.com` 再请求一次 | `200` 但**无任何 `access-control-*` 头** |
| 预检 | `curl -X OPTIONS .../api/list` | `204` + `access-control-allow-methods: GET` |
| 契约与实现一致 | 打开 `docs/api-contract.md` 对 5 条接口 | 2 ✅ / 3 ⬜，与线上行为逐条对上 |
| 第三方复核 | 同伴独立只读验证（见 `docs/Day21-同伴交叉验证.md`） | 三行结论：能打开 / 读真库·写不可用 / 无报错 |

## ⑤ 本周未完成项（4:00–4:30）

1. **写闭环没开始**：`POST/PUT/DELETE` 三个写接口全是占位（线上 404），所以"真实写入 + 刷新持久化"只能在控制台侧演示。
2. **没有鉴权**：读接口免登录（服务端 Key 不出云函数，只读是安全的选择）；写接口必须先定登录态，否则谁都能改库。
3. **类型白名单偏窄**：只有 `course/event/routine`，`exam/lectures/reviews` 还没进（要改三处）。
4. **不分页**：用 `limit(1–500)` 收口，数据量大起来要补 `page/pageSize`。
5. **前端 App 还没有连云**：手机端目前仍是本地数据，把云接口接进 App 是下一阶段。

---

## 附：可粘贴的命令清单

```powershell
$base='https://vibecoding-test-d5fqmhbb955e19dd-1499011319.ap-shanghai.app.tcloudbase.com'
curl.exe -s -i "$base/api/health"
curl.exe -s "$base/api/list?limit=200"
curl.exe -s -D - -o NUL -H "Origin: https://evil.example.com" "$base/api/health"      # 无 access-control-*
curl.exe -s -D - -o NUL -X OPTIONS -H "Access-Control-Request-Method: GET" "$base/api/list"  # 204
curl.exe -s -i -X POST -H "Content-Type: application/json" -d '{}' "$base/api/favorite"      # 404
```

```powershell
# 直捣公网检查台（看标题即可，页面内容是浏览器里由 JS 拉的）
$site='https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com'
curl.exe -s -I $site
curl.exe -s $site | Select-String '<title>'
```
