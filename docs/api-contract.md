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
| 已上线健康检查 | `GET /api/health` |

---

## 接口总览

| 序号 | 方法 | 路径 | 说明 | 状态 |
|------|------|------|------|------|
| 1 | GET | `/api/health` | 服务健康检查 | ✅ 已上线 |
| 2 | GET | `/api/list` | 获取列表数据 | ⬜ 未实现（Day 16+） |
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

## 2. 获取列表（占位）

- **请求**
  - `GET /api/list`
  - Query 参数待定，可能包含 `page`、`pageSize`、`keyword`

- **响应示例（占位）**
  ```json
  {
    "items": [],
    "total": 0
  }
  ```

- **Day 16 实现时确认**
  - 数据结构如何分页
  - 是否需要过滤与排序
  - 未登录时是否允许只读访问

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

*最后更新：2026-09-30（Day 15）*
