# 接口契约（api-contract.md）

> 本文件登记大学生日程助手后端接口的形状。  
> Day 15 只实现 `/api/health` 并保证公网可访问；其余接口仅做占位，Day 16–20 逐步实现。

---

## 环境信息

| 项目 | 值 |
|------|------|
| CloudBase 环境 ID | `vibecoding-test-d5fqmhbb955e19dd` |
| HTTP 网关（后端接口） | `https://vibecoding-test-d5fqmhbb955e19dd-1499011319.ap-shanghai.app.tcloudbase.com` |
| 静态托管（前端页面） | `https://vibecoding-test-d5fqmhbb955e19dd-1499011319.tcloudbaseapp.com` |
| 已上线接口 | `GET /api/health`、`GET /api/list` |

---

## 接口总览

| 序号 | 方法 | 路径 | 说明 | 状态 |
|------|------|------|------|------|
| 1 | GET | `/api/health` | 服务健康检查 | ✅ 已上线 |
| 2 | GET | `/api/list` | 获取列表数据 | ✅ 已实现（Day 17） |
| 3 | POST | `/api/favorite` | 收藏/取消收藏某条 | ⬜ 未实现（Day 17+） |
| 4 | PUT | `/api/update` | 修改某条数据 | ⬜ 未实现（Day 18+） |
| 5 | DELETE | `/api/delete` | 删除某条数据 | ⬜ 未实现（Day 19+） |

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
    - `type=course|event|routine|exam`：只看某类日程（只对 schedules 生效），逗号组合如 `type=course,event`
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

## 3. 收藏/取消收藏（占位）

- **请求**
  - `POST /api/favorite`
  - Body 待定，可能包含 `{ "id": "string", "favorited": true }`

- **响应示例（占位）**
  ```json
  { "ok": true }
  ```

- **Day 17 实现时确认**
  - 是否需要用户登录态
  - 重复收藏是幂等返回还是报错

---

## 4. 修改数据（占位）

- **请求**
  - `PUT /api/update`
  - Body 待定，可能包含 `{ "id": "string", "data": { ... } }`

- **响应示例（占位）**
  ```json
  { "ok": true }
  ```

- **Day 18 实现时确认**
  - 是整段替换还是字段级 PATCH
  - 修改权限校验规则

---

## 5. 删除数据（占位）

- **请求**
  - `DELETE /api/delete`
  - Body 或 Query 待定，可能包含 `{ "id": "string" }`

- **响应示例（占位）**
  ```json
  { "ok": true }
  ```

- **Day 19 实现时确认**
  - 是物理删除还是软删除
  - 删除权限校验规则

---

## 通用约定

1. **返回格式**：接口统一返回 JSON。成功时 `ok: true`，失败时 `ok: false` 并携带 `message`。
2. **鉴权**：Day 15–20 先全部使用「免鉴权」验证通路与形态；登录态方案 Day 21 后再定。
3. **跨域**：通过 CloudBase HTTP 网关默认已经支持跨域（浏览器中 mock 页可正常请求后端）。如后续换自定义域名，需单独检查 `Access-Control-Allow-Origin`。
4. **版本管理**：接口路径暂不带版本号 `v1`，等 Day 25 之后若形态稳定再统一加 `/api/v1/` 前缀。

---

*最后更新：2026-10-02（Day 17，`/api/list` 上线）*
