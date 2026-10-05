# 同伴交叉验证（Day 21）

> 目的：让**不是本轮执行人**的一方独立复核「公网可访问 / 真实读写 / 有无报错」三件事，避免"自己验自己"。
> 本轮同伴 = 独立 agent（新会话、无本轮上下文，只拿到被验证的 URL 与期望形状），**全程只读**：不改文件、不部署、不写库、不动控制台。

---

## 一、三行结论模板（直接抄用）

```
【能否打开】…（一句话：能/不能 + 证据：命令与关键原始输出）
【能否真实读写】…（读：真库/假数据/不可用；写：可用/不可用/未验证 + 证据）
【有无报错】…（一句话：有/无 + 证据；判定「无」必须写清验证了哪几项）
```

填写要求：
1. 每条结论后面**必须**跟可复现命令与原始输出关键行，不接受"看起来正常"。
2. 写不出来的项写「未验证」，不写「应该没问题」。
3. 只读验证；需要写库才能验证的项，标「未验证（无写接口）」而不是自己想办法绕。

---

## 二、本轮同伴结论（原文照抄）

```
【能否打开】能：两条 GET 接口与静态托管页均 HTTP 200，页面就是「数据检查台」。
- 证据：curl.exe -s -w "[%{http_code}]" .../api/health → {"ok":true} [200] application/json
- curl.exe -s -w "[%{http_code}]" ".../api/list?limit=200" → [200] application/json; charset=utf-8
- curl.exe -s ".../tcloudbaseapp.com" → [200] text/html，含 <title>大学生日程助手 · 数据检查台</title>（本次未出现「风险提醒」页，直接拿到 HTML）

【能否真实读写】读：来自真实数据库；写：不可用（与契约登记一致）。
- 读：返回真实行（sch_c001 高等数学 A、todo_t001 高数第一章习题 1-15）；字段形状完整（id/semester_id/type/created_at/updated_at，todos 有 done/done_at/source）；updated_at 存在且值各异（多数 2026-10-02T09:23:58.940965，todo_t001 为 2026-10-02T23:09:59.164875），非写死。
- 写：POST /api/favorite {} → HTTP 404，body {"code":"INVALID_PATH","message":"Invalid path...","requestId":"cce0ff41-..."}，即网关无该路由、未实现。未执行任何 PUT/DELETE，未触碰控制台。

【有无报错】无异常（逐点验证后判定「无」）。
- 无 5xx；两接口均为 JSON，静态页为 HTML。
- CORS：Origin: https://evil.example.com → 无任何 access-control-* 头；白名单 Origin → access-control-allow-origin: https://vibecoding-test-...tcloudbaseapp.com + access-control-allow-credentials: true + vary: Origin；OPTIONS 预检 → 204 + access-control-allow-methods: GET。与 docs/api-contract.md:154 登记一致。
- 无超时：health 0.21s / list 0.23s / 静态页 0.28s。
```

### 同伴附的原始证据

```
GET /api/health            -> [200] {"ok":true}
GET /api/list?limit=200    -> [200] {"ok":true,"data":{...,"counts":{"semesters":6,"schedules":22,"todos":10}}}
GET tcloudbaseapp.com      -> [200] <title>大学生日程助手 · 数据检查台</title>
POST /api/favorite {}      -> [404] {"code":"INVALID_PATH","message":"Invalid path...","requestId":"cce0ff41-5a24-47db-97cc-e67bafae0658"}
# CORS evil
HTTP/1.1 200 OK   (无 access-control-allow-origin)
# CORS 白名单
access-control-allow-origin: https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com
access-control-allow-credentials: true
# OPTIONS 预检
HTTP/1.1 204 No Content
access-control-allow-methods: GET
```

---

## 三、复核一致性

| 项目 | 执行人自验（`docs/Day21-第3周验收表.md`） | 同伴复核 | 是否一致 |
|---|---|---|---|
| `GET /api/health` | 200 + `{"ok":true}` | 200 + `{"ok":true}` | ✅ 一致 |
| `GET /api/list?limit=200` | `ok:true`，counts 6/22/10，含真实行 | 同上，且核对了行数与 `updated_at` 互异 | ✅ 一致 |
| 静态托管页 | 200、`<title>…数据检查台</title>`、含 `btn-refresh` | 200、同样的标题 | ✅ 一致 |
| 写接口 | `POST /api/favorite` → 404 `INVALID_PATH` | 同上（未做 PUT/DELETE） | ✅ 一致 |
| CORS | 白名单回显 + `allow-credentials`；evil Origin 无 CORS 头；`OPTIONS` 204 | 同上，并补测了响应耗时 | ✅ 一致 |

**结论**：公网可访问与真实读两项证据由两方独立复现、结论一致；写接口的不存在也由两方各自探活确认（404）。无口径分歧，无"只有一方能复现"的现象。

---

## 四、复现方式（任何人可重跑）

1. 只改 `$base` 一个变量，其余命令按《第 3 周演示提纲》附录粘贴执行。
2. 判定标准只看三件事：**状态码**、**JSON 里的 `ok` 与 `counts`**、**是否有 `access-control-allow-origin`**。
3. 需要写库才能验证的项目**不要自行尝试**——写接口未实现，任何"绕过接口直写"都会污染测试环境且无法说明接口行为。
