# 接口契约（api-contract.md）

> 本文件登记大学生日程助手后端接口的形状。  
> Day 15 只实现 `/api/health` 并保证公网可访问；Day 17 补 `GET /api/list`；**Day 22 补齐写闭环**：新增 `POST /api/create`、`PUT /api/update`、`DELETE /api/delete`（三条路由共用 `write` 云函数 + `X-Write-Token` 口令）。原 `POST /api/favorite`（收藏/取消收藏）在业务上并不存在，已移除。  
> **Day 22 当日复核补充**：`PUT` / `DELETE` 的「id 不存在」都以中文 404 明确回答（文案见第 4、5 节）；数据检查台的删除按钮补上**两段式二次确认**（第 7 节）；并补了一份「同 id 前后各 select 一次」的对比验证脚本（第 8 节）。

---

## 环境信息

| 项目 | 值 |
|------|------|
| CloudBase 环境 ID | `vibecoding-test-d5fqmhbb955e19dd` |
| HTTP 网关（后端接口） | `https://vibecoding-test-d5fqmhbb955e19dd-1499011319.ap-shanghai.app.tcloudbase.com` |
| 静态托管（前端页面） | `https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com` |
| 已上线接口 | `GET /api/health`、`GET /api/list`、`POST /api/create`、`PUT /api/update`、`DELETE /api/delete` |
| 静态托管当前页面 | 「大学生日程助手 · 数据检查台」（Day 22 版；删除按钮已是**两段式二次确认**。首次访问会先落 CloudBase 测试域名的「风险提醒」页，点一次「确定访问」才进页面） |
| 写接口实现 | 云函数 `write`（Nodejs20.19、Event 型，网关路径 `/api/create`、`/api/update`、`/api/delete`）；`WRITE_TOKEN` 与数据库凭据只在函数环境变量里 |
| 部署清单 | 本地 `cloudbaserc.json`（含 `WRITE_TOKEN` 与服务端 API Key，已在 `.gitignore` 里**绝不提交**）；模板见仓库根 `cloudbaserc.example.json`。部署两步：`tcb fn deploy write -e <envId> --force`，再 `tcb deploy --only gateway`（按 `gateway.routes` 幂等收敛网关路由，不动的路由会 Skip） |

---

## 接口总览

| 序号 | 方法 | 路径 | 说明 | 状态 |
|------|------|------|------|------|
| 1 | GET | `/api/health` | 服务健康检查 | ✅ 已上线 |
| 2 | GET | `/api/list` | 获取列表数据 | ✅ 已实现（Day 17） |
| 3 | POST | `/api/create` | 新增一行（todos / schedules） | ✅ 已实现（Day 22） |
| 4 | PUT | `/api/update` | 按 id 修改某行的字段 | ✅ 已实现（Day 22） |
| 5 | DELETE | `/api/delete` | 按 id 删除某行 | ✅ 已实现（Day 22） |
| — | POST | ~~`/api/favorite`~~ | 收藏/取消收藏（业务上不存在，已废弃） | 🚫 已移除 |

---

## 1. 健康检查

- **请求**
  - `GET /api/health`
  - 无参数、无鉴权

- **响应示例**
  ```json
  { "ok": true }
  ```

- **约定**
  - HTTP 状态码 200 且 `ok === true` 时，代表后端服务可用。
  - 前端 mock 版页面首次加载时会调用该接口显示服务状态。

---

## 2. 获取列表（已实现，Day 17）

- **请求**
  - `GET /api/list`
  - 无必填参数，不传时返回库里三张表的全部行
  - 可选 Query 参数：
    - `semester=<semester_id>`：只看某个学期（对 schedules / todos 生效）
    - `type=course|event|routine`：只看某类日程（只对 schedules 生效），逗号组合如 `type=course,event`
      ⚠️ 与实现保持一致：exam 及未来预留的 lectures/reviews **尚未进白名单**（`cloudfunctions/list/index.js` 的 `allowedTypes`），用它们查询会报错。扩类型时必须同步改：函数白名单 + 本行 + `db/schema.sql` 注释。
    - `limit=<1~500>`：每张表最多返回条数，不传不限、超界按 500 收口
  - 排序不开放自定义，按表固定（课程按学期/星期/开始时间，待办按截止日期）

- **实现位置**：`cloudfunctions/list/index.js`
  - 云函数内通过 CloudBase 官方 REST API（PostgREST）读 PostgreSQL
  - 数据库凭据只放在函数环境变量（`TCB_ENV_ID` / `CLOUDBASE_API_KEY`），不进代码、不进 git
  - 服务端 Key 只存在云函数里，浏览器拿不到，读接口免登录也是安全的

- **响应示例（真实形状，时间字段略）**
  ```json
  {
    "ok": true,
    "data": {
      "semesters": [
        { "id": "sem_2026b", "name": "2026 秋", "first_monday": "2026-08-31",
          "total_weeks": 18, "periods": null, "created_at": "…", "updated_at": "…" }
      ],
      "schedules": [
        { "id": "sch_001", "semester_id": "sem_2026b", "type": "course",
          "title": "高等数学", "note": null, "location": "三教 401",
          "weekday": 3, "start_time": "10:00:00", "duration": 90,
          "week_rule": "every", "date": null, "color": "#3b82f6",
          "manual_edited": false, "created_at": "…", "updated_at": "…" }
      ],
      "todos": [
        { "id": "todo_001", "title": "高数作业 §2.1", "note": null,
          "due_date": "2026-09-30", "done": false, "done_at": null,
          "source": "manual", "created_at": "…", "updated_at": "…" }
      ],
      "counts": { "semesters": 6, "schedules": 22, "todos": 10 }
    }
  }
  ```

- **原「Day 16 实现时确认」三问的答案**
  - 分页：不做 page/pageSize，用 `limit` 收口（数据量小，够用）
  - 过滤与排序：`semester` / `type` 过滤，排序按表固定
  - 未登录只读：允许——服务端 Key 不出云函数，公网只暴露这一条只读路由

---

## 3. 新增一行（已实现，Day 22）

- **请求**
  - `POST /api/create`
  - 鉴权：请求头 `X-Write-Token: <口令>`（也支持 `?token=<口令>` 查询参数，方便 curl 调试）
  - Body：
    ```json
    {
      "table": "todos",
      "row": { "id": "todo_002", "title": "高数作业 §2.1", "due_date": "2026-09-30" }
    }
    ```
  - `table` 白名单：`todos` / `schedules` / `semesters`（`cloudfunctions/write/index.js` 的 `TABLES`；三张表的可写列与必填列也都在那里）
  - `row.id` 必填，沿用前端的字符串 id 口径（`todo_*` / `sch_*` / `evt_*` / `rout_*`）
  - 只接受出现在该表列白名单里的字段；多传的列会被拒绝（`400`），防止写出库里不存在的列

- **响应示例（真实）**
  ```json
  {
    "ok": true, "action": "create", "table": "todos",
    "row": { "id": "todo_002", "title": "…", "note": null, "due_date": "2026-10-07",
             "done": false, "done_at": null, "source": "manual",
             "created_at": "2026-10-05T13:00:52.328", "updated_at": "2026-10-05T13:00:52.328" }
  }
  ```
  HTTP `201`。`created_at` / `updated_at` 由**服务端写**（schema 不设触发器，时间戳由应用层负责，与 `db/schema.sql` 的口径一致）。

---

## 4. 修改一行（已实现，Day 22）

- **请求**
  - `PUT /api/update`
  - 鉴权：同 `/api/create`
  - Body：
    ```json
    {
      "table": "todos",
      "id": "todo_002",
      "patch": { "title": "改后的标题", "done": true, "done_at": "2026-10-05T21:00:00" }
    }
    ```
  - `patch` 是**字段级**更新（不是整行替换），字段同样受列白名单限制；`patch` 为空报 `400`
  - 服务端刷新 `updated_at`，`created_at` 不动

- **响应示例（真实）**
  ```json
  {
    "ok": true, "action": "update", "table": "todos", "id": "todo_002",
    "row": { "id": "todo_002", "title": "改后的标题", "note": "…",
             "created_at": "2026-10-05T13:00:52.328", "updated_at": "2026-10-05T21:01:05.383426" }
  }
  ```
  HTTP `200`；id 不存在 → `404`，body：

  ```json
  { "ok": false, "message": "没有找到这条记录：todos / todo_不存在的id", "status": 404 }
  ```

  （文案由 `cloudfunctions/write/index.js:189` 拼出：`'没有找到这条记录：' + table + ' / ' + id`，报错里带够排查所需的定位信息，而不是一句「失败了」。）

---

## 5. 删除一行（已实现，Day 22）

- **请求**
  - `DELETE /api/delete`
  - 鉴权：同 `/api/create`
  - 参数：`?table=todos&id=todo_002`（也支持同形状的 JSON body）
  - 物理删除（不做软删除）；删除前先把整行读出来一并返回，便于调用方核对删掉的是什么

- **响应示例（真实：被删的整行原样带回）**
  ```json
  {
    "ok": true, "action": "delete", "table": "todos", "id": "todo_002",
    "row": { "id": "todo_002", "title": "改后的标题", "…": "被删那一行的完整字段" }
  }
  ```
  HTTP `200`；id 不存在 → `404`，与第 4 节同一条中文文案：

  ```json
  { "ok": false, "message": "没有找到这条记录：todos / todo_不存在的id", "status": 404 }
  ```

  因为删除是「先让 PostgREST 回传被删的那一行、空数组即没命中」，所以对同一条 id **重复删除**也是这个 `404`（幂等地告诉你「这条已经没有了」），而不是静默返回成功。

---

## 6. 写接口的鉴权与错误码（Day 22）

- **口令**：请求头 `X-Write-Token`（或 `?token=`）与云函数环境变量 `WRITE_TOKEN` 比对。
  ⚠️ 当前是**共享口令**，只适合测试环境：口令写在页面里就等于公开，拿到它的人可以写库。升级路径＝CloudBase 匿名登录 + 每行 `owner_uid`（本仓尚未做，列在后续计划里）。
- **校验顺序**：先查口令 → 再查方法 → 再解析 body。所以未授权一律 `401`，不泄露「body 格式」这类探测信息。
- **错误码表（实测；`kind` 列见下一节，Day 23 补）**

  | 场景 | HTTP | `kind` | body |
  |------|------|--------|------|
  | 缺口令 | 401 | `input` | `{"ok":false,"kind":"input","message":"缺少口令：请带 X-Write-Token 请求头（或 ?token= 查询参数）","status":401}` |
  | 口令错 | 401 | `input` | `{"ok":false,"kind":"input","message":"口令不正确…请核对 X-Write-Token 的值是否与云函数环境变量 WRITE_TOKEN 一致","status":401}` |
  | 方法不支持（如 GET） | 405 | `input` | `{"ok":false,"kind":"input","message":"不支持的方法：GET（写接口只接受 POST / PUT / DELETE）","status":405}` |
  | 表不在白名单 / 字段超白名单 / 缺必填 / body 非 JSON 对象 | 400 | `input` | `{"ok":false,"kind":"input","message":"…","status":400}` |
  | id 不存在 | 404 | `input` | `{"ok":false,"kind":"input","message":"没有找到这条记录：todos / todo_不存在的id（可能已经被删过了）","status":404}` |
  | 函数环境变量缺失 | 500 | `server` | `{"ok":false,"kind":"server","message":"环境变量未配置：TCB_ENV_ID / CLOUDBASE_API_KEY（在云函数的环境变量里补上，别写进代码）","status":500}` |

- **实现位置**：`cloudfunctions/write/index.js`（接口层：口令 / 方法 / body / 列白名单 / 错误码）+ `cloudfunctions/write/db.js`（数据访问层：PostgREST 读写）。与 `list` 同规矩——接口层不出现 URL、headers、`process.env`。

---

## 6b. 三类错误与 `kind` 字段（Day 23）

**为什么要分类**：改动前 `list` 的失败响应只有 `{ ok:false, message }`——**没有状态码**，前端拿到一串中文也分不清「你填错了，改一下再试」和「服务端炸了，重试也没用」。写接口虽然一直有 `status`，但网络层会把 Node 抛的英文原文（`fetch failed` / `ECONNREFUSED` / `ETIMEDOUT`）直接冒给使用者看。

**分类口径**——按「人拿到之后该做什么」分，不是按异常类型分：

| `kind` | 中文标签 | 含义 | 使用者该做什么 | HTTP |
|--------|----------|------|----------------|------|
| `input` | 输入有误 | 调用方自己填错了（参数 / 表名 / 列名 / 口令 / body 格式） | **自己改**，文案会告诉他改成什么、有哪些选项 | 400 / 401 / 404 / 405 |
| `network` | 网络不通 | 请求**没送到**对方（超时 / DNS 解析不了 / 拒连 / 被断开 / 证书没过） | 这不是填错了，**可以稍后重试** | 502 |
| `server` | 服务端出错 | 请求送到了，但对方回错误码或非 JSON（含环境变量没配） | **多半不是你的问题，重试通常没用**；原文保留便于排查 | 上游码 / 500 |

- **响应体统一形状**：`{ ok:false, kind, message, status }`。`list` 与 `write` 现在口径一致（`list` 是 Day 23 才补上 `kind`/`status` 的）。
- **`kind` 的取值定义与文案生成只有一处**：`cloudfunctions/write/errors.js`。因为 CloudBase 按 `cloudfunctions/<函数名>/` **整目录**打包、两个函数之间不能互相 `require`，所以 `cloudfunctions/list/errors.js` 是它的**逐字节副本**（测试用 SHA256 校对两份必须一致，改一份忘另一份会立刻报错）。
- **绝不把英文原文漏出去**：`networkReason()` 用包含匹配认 12 种网络错（`abort`/`timeout`/`enotfound`/`eai_again`/`econnrefused`/`econnreset`/`econnaborted`/`ehostunreach`/`enetunreach`/`certificate`/`fetch failed`/`socket`/`network`）→ 换成中文；**都不匹配也兜底成中文**。上游原文只在「服务端错」里以 `原文：…` 附上，并截断到 300 字符（非 JSON 是 200 字符）。
- **兜底不用 `String(err)`**：老代码对非 Error 对象会得到 `[object Object]`。现在按类型分支（string 直接用 / number、boolean 转字符串 / 其它给「未知错误（没有拿到可读的原因）」）。
- **fail-closed**：`WRITE_TOKEN` 没配时**一律拒绝所有写入**（`kind=server`/500），不会因为「没配口令」而放行。
- **只报变量名不报值**：`环境变量未配置：CLOUDBASE_API_KEY` —— 这样日志和响应都不会把密钥抄出去。
- **老文案全部保留**：`course / event / routine`、`1~500`、`检查 CLOUDBASE_API_KEY`、`检查 TCB_ENV_ID`、`请求失败`、`没有找到这条记录` 逐字没动，既有脚本（Day 17 `list-fn-selftest.js`、Day 22 `day22-db-diff.mjs`）复跑仍全绿。

**验证方法（可照着重跑）**

| 验什么 | 怎么验 | 期望 |
|--------|--------|------|
| 三类错误都带 `kind` | `node .workbuddy/tmp/day23-online-check.mjs`（真实公网 HTTP） | 16 过 / 0 挂 |
| 单元与集成（含假密钥红线） | `node .workbuddy/tmp/day23-errors-selftest.js` | 57 过 / 0 挂 |
| 旧断言没被改坏 | `node .workbuddy/tmp/list-fn-selftest.js`（Day 17 脚本） | 31 过 / 0 挂 |
| 两份 `errors.js` 一致 | 上面自测的 B 段按 SHA256 比对 | 哈希相同 |
| 输入错不联网 | 自测 C1–C4 断言 `called === 0` | 校验先于请求 |

> 上面三个脚本都在 `.workbuddy/tmp/`（本地工具临时区、被 `.gitignore` 忽略，不入库）。要重跑请照本节表格的手敲命令自建。

**请求日志（Day 23 余力加练）**：`list` 与 `write` 入口各有一行 `console.log`，格式为
`[list] 2026-10-07T14:01:12.903Z | GET /api/list | 参数=type | FAIL [input 400] type 只能是 course / event / routine 之一，收到：bogus`
（写接口是 `[write] … | POST /api/create | 动作=create 表=todos id=- | OK 201`）。
**只记表名与 id，不记请求体**（请求体里可能有整行数据，也可能有人把口令塞进 body）；`list` 只记参数**名**不记值（万一有人把口令写进 URL，打印等于抄进日志）。

---

## 7. 前端删除的二次确认（Day 22 检查台）

「删除比新增更容易出事」，所以确认要放在**最靠近动作**的地方，而不是离得老远的设置页。

- **App 内**（`web2/src/App.vue`）：待办删除走 `onDeleteTodo()`（第一次点只置 `confirmDelTodo=true` 并起 3 秒定时器，第二次才调 `deleteTodoNow()` 真删），按钮文案由 `TodoSheet.vue:49` 按 `confirmDelTodo` 在「删除 / 再点一次确认」间切换。
- **课程与循环日程**：同一套思路，`App.vue:4069` 起的 `confirmDel` + `onDelCourse()` / `onDelRoutine()`，文案在 `DetailSheet.vue:86,104`。
- **录音场次**：另有 `DeleteLectureSheet.vue`（整场连同录音文件、文字稿、纪要一起删的独立确认浮层）。
- **数据检查台**（`mock-frontend/index.html`）：`#btn-delete` 同样两段式——
  1. 第一次点：只改按钮（加 `.arming` 类变红、文字改成「再点一次确认删除」）并提示「要删除 xxx 吗？」，**不发网络请求**；
  2. 3 秒内在同一按钮上再点一次才真的发 `DELETE`；
  3. 3 秒不点 `setTimeout` 复位；「或手填一个 id」输入框一改动也会清掉待确认态（避免确认跨到另一条记录上）。
- 检查台另有「或手填一个 id」输入框：填一个库里**不存在**的 id 再点删除，就能亲眼看到第 5 节那个中文 `404`。

---

## 8. 「数据库 select 前后对比」验证法（Day 22）

要证明「改一条真的改了、删一条真的没了」，不能只看页面上的提示，要看**同一个 id 在操作前后各查一次库**。做法与脚本：

- **怎么 select**：用只读接口 `GET /api/list` —— 它就是 `list` 云函数对 PostgreSQL 的 `SELECT`（`cloudfunctions/list/index.js` → PostgREST `/v1/rdb/rest/{table}`）。它**免鉴权、不需要数据库密码**，所以任何人随时能自己重跑。
- **脚本**：`.workbuddy/tmp/day22-db-diff.mjs`（跑法 `node .workbuddy/tmp/day22-db-diff.mjs`，口令读 `.workbuddy/tmp/write-token.txt`）。它只创建/修改/删除自己的 `todo_difftest_*`，**不碰库里已有的正式数据**；跑完把总数还原（实测回到 10，库里零残留）。
  > `.workbuddy/` 是**本地工具临时区、被 `.gitignore` 忽略**（见 `docs/PROJECT_MAP.md`），所以这份脚本不在仓库里；要重跑请按本节步骤自己建一份，或直接照上面的「怎么 select」手敲命令。
- **它打印的对比**：同一个 id 的整行「改之前 / 改之后」并列 + 变了哪些字段；以及「删之前 / 删之后」+ 待办总数。
- **实测结果（17 通过 / 0 失败）**：

  | 步骤 | 观察到的库内实况 |
  |------|------------------|
  | 开局 select | 该 id 不存在，待办总数 **10** |
  | `POST /api/create` | HTTP **201**；再 select 能查到，待办 **11**（+1） |
  | `PUT /api/update` | HTTP **200**；select 对比：`title` 旧→新、`done` **false→true**、`note` 变、`done_at` null→值；**`created_at` 没动**、`updated_at` 变；总数仍 **11** |
  | `PUT` 不存在的 id | HTTP **404** + `没有找到这条记录：todos / todo_根本不存在` |
  | `DELETE /api/delete` | HTTP **200**，被删整行原样带回；再 select **查不到**，总数回到 **10** |
  | `DELETE` 已删过的 id | HTTP **404** + 同一条中文文案（幂等告知「已经没有了」） |

- **页面侧同一件事的另一个证据**：`.workbuddy/tmp/day22-check-page.mjs`（真实浏览器、不关 CORS，打公网静态托管页）**25 通过 / 0 失败**，其中 E0c 专门断言「只点一次删除时库里那行还在」——把「二次确认真的挡住了误删」变成可核对的断言，而不是口头保证。（同在本地 `.workbuddy/` 区，不入库。）

---

## 通用约定

1. **返回格式**：接口统一返回 JSON。成功时 `ok: true`，失败时 `ok: false` 并携带 `message`。
2. **鉴权**：读接口（`/api/health`、`/api/list`）保持**免鉴权**——服务端 Key 只存在云函数里，公网只暴露只读路由；写接口（`/api/create`、`/api/update`、`/api/delete`）**必须带 `X-Write-Token`**（Day 22 起的共享口令方案，见第 6 节）。
3. **跨域**：CloudBase HTTP 网关只放**白名单 Origin**——Day 20 实测只有静态托管域名 `https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com` 会拿到 `access-control-allow-origin`（并带 `access-control-allow-credentials: true`），`Origin: https://evil.example.com`、web2 线上域名、以及不带 `Origin` 的请求**都没有任何 `access-control-*` 头**（不是 `*`，也不回显任意 Origin）；`OPTIONS` 预检返回 `204`。Day 20 已用**真实浏览器（不关 CORS）**验证线上页面能跨域拿到 `/api/health` 与 `/api/list`。Day 22 补测写接口的预检：`OPTIONS /api/create` 带 `Access-Control-Request-Method: POST|PUT|DELETE` 与 `Access-Control-Request-Headers: content-type,x-write-token` 时，网关回 `204` 且 `access-control-allow-methods` / `access-control-allow-headers` **回显请求的值**；只请求 `GET` 时才回 `GET`。所以白名单域名下的浏览器页面可以直接调写接口（「数据检查台」就是这么做的）。如后续换自定义域名，要把新域名加进白名单；**带自定义请求头的接口**也要确认预检回显（网关会回显，无需手工配置）。
4. **版本管理**：接口路径暂不带版本号 `v1`，等 Day 25 之后若形态稳定再统一加 `/api/v1/` 前缀。

---

*最后更新：2026-10-05（Day 22，写闭环上线：`write` 云函数 + `/api/create`、`/api/update`、`/api/delete` 三条网关路由已公网验收；`/api/favorite` 因业务上不存在而移除；本次不涉及类型白名单与表结构变化，函数白名单与 `db/schema.sql` 无需同步）*
*同日复核补充：① `PUT`/`DELETE` 的「id 不存在 → 中文 404」文案按实现写准（第 4、5、6 节）；② `table` 白名单此前漏写了 `semesters`，已补（第 3 节，与 `cloudfunctions/write/index.js` 的 `TABLES` 一致）；③ 新增第 7 节「前端删除的二次确认」（检查台已实测）与第 8 节「数据库 select 前后对比验证法」（附脚本与实测数字）。*
