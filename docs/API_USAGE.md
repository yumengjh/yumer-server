# API 使用文档

## 目录

- [基础信息](#基础信息)
- [认证流程](#认证流程)
- [完整 API 接口一览](#完整-api-接口一览)
- [业务接口说明](#业务接口说明)
- [错误处理](#错误处理)
- [示例代码](#示例代码)
- [Swagger 与相关文档](#swagger-与相关文档)
- [最佳实践](#最佳实践)
- [常见问题](#常见问题)
- [更新日志](#更新日志)
- [技术支持](#技术支持)

---

## 基础信息

### 基础 URL

```
开发环境: http://localhost:5200
API 前缀: /api/v1
```

### 完整 API 地址示例

```
http://localhost:5200/api/v1/auth/register
```

### 响应格式

所有成功响应统一格式：

```json
{
  "success": true,
  "data": {}
}
```

错误响应格式：

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述"
  }
}
```

### 认证方式

除注册、登录、刷新令牌外，其余接口均需 JWT 鉴权，请求头：

```
Authorization: Bearer <your-access-token>
```

---

## 认证流程

### 1. 用户注册

**接口** `POST /api/v1/auth/register`

```json
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "displayName": "John Doe"
}
```

字段说明：`username` 3-50 字符，仅字母/数字/下划线；`password` 至少 8 位且包含大小写与数字；`displayName` 最多 100 字符。

**响应示例**

```json
{
  "success": true,
  "data": {
    "user": {
      "userId": "u_1705123456789_abc123",
      "username": "john_doe",
      "email": "john@example.com",
      "displayName": "John Doe",
      "avatar": null
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### 2. 用户登录

**接口** `POST /api/v1/auth/login`

```json
{
  "emailOrUsername": "john@example.com",
  "password": "SecurePass123!"
}
```

返回结构与注册相同，包含用户信息与 accessToken、refreshToken。

### 3. 刷新令牌

**接口** `POST /api/v1/auth/refresh`

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

返回新的 accessToken 与 refreshToken。

### 4. 获取当前用户信息

**接口** `GET /api/v1/auth/me`
请求头：`Authorization: Bearer <your-access-token>`

```json
{
  "success": true,
  "data": {
    "userId": "u_1705123456789_abc123",
    "username": "john_doe",
    "email": "john@example.com",
    "displayName": "John Doe",
    "avatar": null,
    "bio": null,
    "settings": {},
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### 5. 用户登出

**接口** `POST /api/v1/auth/logout`
请求头：`Authorization: Bearer <your-access-token>`

```json
{
  "token": "refresh-or-access-token"
}
```

响应：`204 No Content`

---

## 完整 API 接口一览

除特别说明外，路径均以 `/api/v1` 为前缀，需认证接口需在请求头附带 `Authorization: Bearer <accessToken>`。

### 认证 (auth)

| 方法  | 路径                  | 说明                     | 认证           |
| ----- | --------------------- | ------------------------ | -------------- |
| POST  | `/auth/register`      | 用户注册                 | 否             |
| POST  | `/auth/login`         | 用户登录                 | 否             |
| POST  | `/auth/refresh`       | 刷新令牌                 | 否             |
| POST  | `/auth/logout`        | 用户登出                 | 是             |
| GET   | `/auth/me`            | 获取当前用户             | 是             |
| PATCH | `/auth/me`            | 更新当前用户信息         | 是             |
| GET   | `/auth/users/:userId` | 根据 userId 获取用户信息 | JWT / 站点公开 |

### 工作空间 (workspaces)

| 方法   | 路径                                       | 说明                 | 认证 |
| ------ | ------------------------------------------ | -------------------- | ---- |
| POST   | `/workspaces`                              | 创建工作空间         | 是   |
| GET    | `/workspaces`                              | 工作空间列表（分页） | 是   |
| GET    | `/workspaces/:workspaceId`                 | 工作空间详情         | 是   |
| PATCH  | `/workspaces/:workspaceId`                 | 更新工作空间         | 是   |
| DELETE | `/workspaces/:workspaceId`                 | 删除工作空间         | 是   |
| POST   | `/workspaces/:workspaceId/members`         | 邀请成员             | 是   |
| GET    | `/workspaces/:workspaceId/members`         | 成员列表             | 是   |
| PATCH  | `/workspaces/:workspaceId/members/:userId` | 更新成员角色         | 是   |
| DELETE | `/workspaces/:workspaceId/members/:userId` | 移除成员             | 是   |

### 文档 (documents)

| 方法   | 路径                                 | 说明               | 认证 |
| ------ | ------------------------------------ | ------------------ | ---- |
| POST   | `/documents`                         | 创建文档           | 是   |
| GET    | `/documents`                         | 文档列表           | 是   |
| GET    | `/documents/search`                  | 搜索文档           | 是   |
| GET    | `/documents/:docId`                  | 文档详情           | 是   |
| GET    | `/documents/:docId/content`          | 文档内容/渲染树    | 是   |
| PATCH  | `/documents/:docId`                  | 更新文档元数据     | 是   |
| POST   | `/documents/:docId/publish`          | 发布文档           | 是   |
| POST   | `/documents/:docId/move`             | 移动文档           | 是   |
| DELETE | `/documents/:docId`                  | 删除文档           | 是   |
| GET    | `/documents/:docId/revisions`        | 修订历史           | 是   |
| GET    | `/documents/:docId/diff`             | 版本对比           | 是   |
| POST   | `/documents/:docId/revert`           | 回滚到指定版本     | 是   |
| POST   | `/documents/:docId/snapshots`        | 创建快照           | 是   |
| POST   | `/documents/:docId/commit`           | 手动触发创建版本   | 是   |
| GET    | `/documents/:docId/pending-versions` | 获取待创建版本数量 | 是   |
| GET    | `/documents/:docId/sync-state`       | 获取同步状态快照   | 是   |

### 块 (blocks)

| 方法   | 路径                        | 说明                                  | 认证 |
| ------ | --------------------------- | ------------------------------------- | ---- |
| POST   | `/blocks`                   | 创建块                                | 是   |
| PATCH  | `/blocks/:blockId/content`  | 更新块内容                            | 是   |
| POST   | `/blocks/:blockId/move`     | 移动块                                | 是   |
| DELETE | `/blocks/:blockId`          | 删除块（软删）                        | 是   |
| GET    | `/blocks/:blockId/versions` | 块版本历史                            | 是   |
| POST   | `/blocks/batch`             | 批量操作（create/update/delete/move） | 是   |

### 同步协议增强（2026-05）

`/blocks/batch` 已可作为前端同步主通道使用，支持以下扩展字段：

- `baseVersion`：客户端本地基线版本
- `clientBatchId`：客户端批次 ID（用于 ack 对账）
- `source`：`autosync | manual-save`
- create 操作可带 `clientId`，用于服务端 create ack 回填

返回结构包含：

- `acceptedBatchId`
- `appliedAt`
- `serverHead`
- `needsReload`
- `conflicts[]`
- `results[]`（逐操作结果，含 `clientId/blockId/version/error`）

并新增 `GET /documents/:docId/sync-state`，用于低成本查询：

- `docId/head/publishedHead/pendingCount/hasPendingDraft/updatedAt`

### 标签 (tags)

| 方法   | 路径                 | 说明                             | 认证 |
| ------ | -------------------- | -------------------------------- | ---- |
| POST   | `/tags`              | 创建标签                         | 是   |
| GET    | `/tags`              | 标签列表（需 workspaceId，分页） | 是   |
| GET    | `/tags/:tagId`       | 标签详情                         | 是   |
| GET    | `/tags/:tagId/usage` | 标签使用统计                     | 是   |
| PATCH  | `/tags/:tagId`       | 更新标签                         | 是   |
| DELETE | `/tags/:tagId`       | 删除标签                         | 是   |

### 收藏 (favorites)

| 方法   | 路径                | 说明                    | 认证 |
| ------ | ------------------- | ----------------------- | ---- |
| POST   | `/favorites`        | 添加收藏（Body: docId） | 是   |
| GET    | `/favorites`        | 收藏列表（分页）        | 是   |
| DELETE | `/favorites/:docId` | 取消收藏                | 是   |

### 评论 (comments)

| 方法   | 路径                   | 说明                                                              | 认证 |
| ------ | ---------------------- | ----------------------------------------------------------------- | ---- |
| POST   | `/comments`            | 创建评论（docId, content，可选 blockId/mentions/parentCommentId） | 是   |
| GET    | `/comments`            | 评论列表（docId 必填，可选 blockId，分页）                        | 是   |
| GET    | `/comments/:commentId` | 评论详情                                                          | 是   |
| PATCH  | `/comments/:commentId` | 更新评论（仅本人）                                                | 是   |
| DELETE | `/comments/:commentId` | 删除评论（软删，仅本人）                                          | 是   |

### 搜索 (search)

| 方法 | 路径               | 说明                                               | 认证 |
| ---- | ------------------ | -------------------------------------------------- | ---- |
| GET  | `/search`          | 全局搜索（type=doc\|block\|all）                   | 是   |
| POST | `/search/advanced` | 高级搜索（query、workspaceId、tags、时间、排序等） | 是   |

### 活动日志 (activities)

| 方法 | 路径          | 说明                                                             | 认证 |
| ---- | ------------- | ---------------------------------------------------------------- | ---- |
| GET  | `/activities` | 活动列表（workspaceId 必填；userId/action/entityType/日期/分页） | 是   |

### 资产 (assets)

| 方法   | 路径                    | 说明                                                            | 认证 |
| ------ | ----------------------- | --------------------------------------------------------------- | ---- |
| POST   | `/assets/upload`        | 上传文件（multipart: workspaceId, file；默认上限 10MB，可配置） | 是   |
| GET    | `/assets`               | 资产列表（workspaceId 必填，分页）                              | 是   |
| GET    | `/assets/:assetId/file` | 下载/预览文件流                                                 | 是   |
| DELETE | `/assets/:assetId`      | 删除资产                                                        | 是   |

### 安全 (security)

| 方法 | 路径               | 说明                                                        | 认证 |
| ---- | ------------------ | ----------------------------------------------------------- | ---- |
| GET  | `/security/events` | 安全日志（eventType/userId/ip/时间/分页）                   | 是   |
| GET  | `/security/audit`  | 审计日志（userId/action/resourceType/resourceId/时间/分页） | 是   |

### 设置 (settings)

| 方法   | 路径                                | 说明                             | 认证           |
| ------ | ----------------------------------- | -------------------------------- | -------------- |
| GET    | `/settings/me`                      | 获取当前用户设置（含默认值）     | 是             |
| PATCH  | `/settings/me`                      | 更新当前用户设置                 | 是             |
| GET    | `/settings/effective`               | 获取生效设置（可带 workspaceId） | 是             |
| GET    | `/workspaces/:workspaceId/settings` | 获取工作空间覆盖设置             | JWT / 站点公开 |
| PATCH  | `/workspaces/:workspaceId/settings` | 更新工作空间覆盖设置             | 是             |
| DELETE | `/workspaces/:workspaceId/settings` | 清空工作空间覆盖设置             | 是             |

### 运行时配置 (runtime-configs)

> 该模块不使用 JWT，而是使用 `x-system-admin-token` 请求头鉴权，用于运维/平台层控制。

| 方法  | 路径                                | 说明         | 认证               |
| ----- | ----------------------------------- | ------------ | ------------------ |
| GET   | `/runtime-configs/rate-limit`       | 读取限流配置 | 系统管理员令牌     |
| PATCH | `/runtime-configs/rate-limit`       | 更新限流配置 | 系统管理员令牌     |
| POST  | `/runtime-configs/rate-limit/reset` | 重置限流配置 | 系统管理员令牌     |

---

## 业务接口说明
- **详情** `GET /documents/:docId`  
  返回文档元数据，并额外补充 `creator` / `updater`：`{ userId, displayName, avatar }`，适合公开页 SSR 直接展示作者与最后更新者。

### 工作空间

- **创建** `POST /workspaces`  
  Body: `{ name, description?, icon? }`，创建者自动成为 owner。
- **列表** `GET /workspaces`  
  Query: `page`，`pageSize`（默认 1,20），返回 `{ items, total, page, pageSize }`，包含 `userRole`。
- **角色说明**：owner > admin > editor > viewer；邀请成员时不可直接设置 owner，转移所有权需单独处理。

### 文档

- **创建** `POST /documents`  
  Body: `{ workspaceId, title, icon?, cover?, visibility?, parentId?, tags?, category? }`  
  自动创建根块 `rootBlockId` 和初始版本 `head=1`。`tags` 需传标签 ID 列表，系统会校验并维护使用计数。
- **列表** `GET /documents`  
  Query: `workspaceId?`（为空则查询有权限的全部）、`status`、`visibility`、`parentId`、`tags`、`category`、`sortBy`(updatedAt|createdAt|title)、`sortOrder`(DESC|ASC)、`page`、`pageSize`。
- **搜索** `GET /documents/search`  
  Query: `query`、`workspaceId?`、`status?`(draft|normal|archived)、`tags?`、`page`、`pageSize`。基于 tsvector 的全文检索。
- **内容** `GET /documents/:docId/content`  
  Query: `version?`（默认最新 `head`）、`maxDepth?`（0=仅根，1=根+一层，默认全量）、`startBlockId?`、`limit?`（默认 1000，最大 10000）。返回 `tree` 及分页信息 `{ totalBlocks, returnedBlocks, hasMore, nextStartBlockId }`，适合大文档分段加载。
- **发布** `POST /documents/:docId/publish`  
  将 `publishedHead` 置为当前 `head`。权限：owner/admin/editor。
- **移动** `POST /documents/:docId/move`  
  Body: `{ parentId?, sortOrder? }`，不可形成循环引用。
- **删除** `DELETE /documents/:docId`  
  软删，级联删除子文档。仅 owner/admin。
- **版本相关**：
  - 修订历史 `GET /documents/:docId/revisions`（分页）
  - 版本对比 `GET /documents/:docId/diff`（fromVer、toVer）→ 返回 `summary`（added/deleted/modified/moved/reordered/indentChanged/unchanged）+ `changes` 列表 + 双版本内容树
  - 回滚版本 `POST /documents/:docId/revert` Body: `{ version }`
  - 创建快照 `POST /documents/:docId/snapshots`（幂等，按 docVer）
  - **手动创建版本** `POST /documents/:docId/commit` Body: `{ message? }`，将待创建操作合并为单一版本
  - **查询待创建版本数** `GET /documents/:docId/pending-versions` 返回 `{ pendingCount, hasPending }`

### 块

- **创建** `POST /blocks`  
  Body: `{ docId, type, payload, parentId?, sortKey?, indent?, collapsed?, createVersion? }`，默认 `createVersion=true`。强烈推荐不传 `sortKey`，让系统自动生成，避免排序冲突。
- **更新内容** `PATCH /blocks/:blockId/content`  
  Body: `{ payload, plainText?, createVersion? }`，默认创建文档版本；当 `createVersion=false` 时会计入待创建版本。
- **移动** `POST /blocks/:blockId/move`  
  Body: `{ parentId, sortKey, indent?, createVersion? }`，默认创建版本，禁止循环引用。
- **删除** `DELETE /blocks/:blockId`  
  软删并级联子块，始终立即创建文档版本。
- **批量** `POST /blocks/batch`  
  Body: `{ docId, createVersion?, operations }`；operations 支持 `create/update/delete/move`，在同一事务中执行；无论多少操作只创建一次文档版本（如 `createVersion=true`）。
- **版本历史** `GET /blocks/:blockId/versions`（分页）。

### 标签

- **创建** `POST /tags` Body: `{ workspaceId, name, color? }`，同一工作空间名称唯一。
- **列表** `GET /tags` Query: `workspaceId`（必填）、`page`、`pageSize`。
- **使用统计** `GET /tags/:tagId/usage`。

### 收藏

- **添加** `POST /favorites` Body: `{ docId }`，同一用户同一文档不可重复。
- **列表** `GET /favorites` 分页返回，包含文档摘要；已删除文档会被过滤。
- **取消** `DELETE /favorites/:docId`。

### 评论

- **创建** `POST /comments` Body: `{ docId, content, blockId?, mentions?, parentCommentId? }`。
- **列表** `GET /comments` Query: `docId`（必填）、`blockId?`、`page`、`pageSize`。
- **更新/删除** 仅作者可操作，删除为软删。

### 搜索

- **全局** `GET /search` Query: `query`、`workspaceId?`、`type?`(doc|block|all, 默认 all)、`page`、`pageSize`。
- **高级** `POST /search/advanced` Body: `query`、`workspaceId?`、`type?`、`tags?`、`startDate?`、`endDate?`、`createdBy?`、`sortBy?`(rank|updatedAt|createdAt)、`sortOrder?`、`page`、`pageSize`。

### 活动日志

- **列表** `GET /activities` Query: `workspaceId`（必填）、`userId?`、`action?`、`entityType?`、`startDate?`、`endDate?`、`page`、`pageSize`。需具备该工作空间访问权限。

### 资产

- **上传** `POST /assets/upload`  
  multipart 表单：`workspaceId`、`file`，默认限制 10MB，可配置。
- **文件流** `GET /assets/:assetId/file`  
  返回文件流，`Content-Disposition: inline` 可预览。

### 安全与审计

- **安全日志** `GET /security/events` Query: `eventType`、`userId`、`ip`、`startDate`、`endDate`、`page`、`pageSize`。通常需管理员权限。
- **审计日志** `GET /security/audit` Query: `userId`、`action`、`resourceType`、`resourceId`、`startDate`、`endDate`、`page`、`pageSize`。

### 设置

- **用户设置** `GET /settings/me` 返回当前用户的完整设置（含默认值）。`PATCH /settings/me` 深合并更新，传 `null` 删除字段。
- **生效设置** `GET /settings/effective` 按 user > workspace > default 优先级返回生效值，可带 `?workspaceId=`。
- **工作空间覆盖** `GET/PATCH/DELETE /workspaces/:workspaceId/settings` 管理工作空间级别的设置覆盖（仅 owner/admin），支持站点公开读取。
- 设置范围：`reader.contentWidth`(680-1200)、`reader.fontSize`(13-22)、`editor.*`（同 reader）、`advanced.compactList`、`advanced.codeFontFamily`。

### 运行时配置

- 使用 `x-system-admin-token` 请求头鉴权，不使用 JWT。
- `GET /runtime-configs/rate-limit` 读取当前限流配置（ttlMs、limit）。
- `PATCH /runtime-configs/rate-limit` 部分更新限流参数。
- `POST /runtime-configs/rate-limit/reset` 重置为环境变量默认值。

### Token 说明

- **Access Token**：访问受保护接口，默认约 24 小时有效。
- **Refresh Token**：刷新 Access Token，默认约 7 天有效。
- 登录/注册返回 `data.accessToken`、`data.refreshToken`；刷新接口返回新的双 Token。

---

## 错误处理

### 错误响应结构

```json
{
  "success": false,
  "error": {
    "code": "string",
    "message": "string | string[]"
  }
}
```

### 常见错误码

| HTTP 状态码 | 错误码              | 说明                         |
| ----------- | ------------------- | ---------------------------- |
| 400         | `VALIDATION_ERROR`  | 请求参数校验失败             |
| 401         | `UNAUTHORIZED`      | 未授权（Token 无效或已过期） |
| 403         | `FORBIDDEN`         | 没有权限                     |
| 404         | `NOT_FOUND`         | 资源不存在                   |
| 409         | `CONFLICT`          | 资源冲突（如重复）           |
| 429         | `TOO_MANY_REQUESTS` | 触发限流                     |
| 500         | `INTERNAL_ERROR`    | 服务器内部错误               |

### 错误响应示例

**校验错误（message 可能为数组）**

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": ["用户名只能包含字母、数字和下划线", "密码至少 8 位"]
  }
}
```

**认证失败**

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "登录状态已失效"
  }
}
```

---

## 示例代码

### JavaScript / TypeScript (Fetch API)

#### 注册用户

```typescript
async function register() {
  const response = await fetch("http://localhost:5200/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "john_doe",
      email: "john@example.com",
      password: "SecurePass123!",
      displayName: "John Doe",
    }),
  });
  const data = await response.json();
  if (data.success) {
    localStorage.setItem("accessToken", data.data.accessToken);
    localStorage.setItem("refreshToken", data.data.refreshToken);
    console.log("注册成功:", data.data.user);
  } else {
    console.error("注册失败:", data.error);
  }
}
```

#### 用户登录

```typescript
async function login() {
  const response = await fetch("http://localhost:5200/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      emailOrUsername: "john@example.com",
      password: "SecurePass123!",
    }),
  });
  const data = await response.json();
  if (data.success) {
    localStorage.setItem("accessToken", data.data.accessToken);
    localStorage.setItem("refreshToken", data.data.refreshToken);
    console.log("登录成功:", data.data.user);
  } else {
    console.error("登录失败:", data.error);
  }
}
```

#### 获取当前用户信息

```typescript
async function getCurrentUser() {
  const token = localStorage.getItem("accessToken");
  const response = await fetch("http://localhost:5200/api/v1/auth/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (data.success) {
    console.log("当前用户:", data.data);
  } else {
    console.error("获取失败:", data.error);
  }
}
```

#### 刷新 Token

```typescript
async function refreshToken() {
  const refreshToken = localStorage.getItem("refreshToken");
  const response = await fetch("http://localhost:5200/api/v1/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  const data = await response.json();
  if (data.success) {
    localStorage.setItem("accessToken", data.data.accessToken);
    localStorage.setItem("refreshToken", data.data.refreshToken);
    console.log("Token 刷新成功");
  } else {
    console.error("刷新失败:", data.error);
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
  }
}
```

#### 自动处理 Token 过期

```typescript
async function apiRequest(url: string, options: RequestInit = {}) {
  let token = localStorage.getItem("accessToken");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(options.headers as Record<string, string>),
  };

  let response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    const refreshToken = localStorage.getItem("refreshToken");
    if (refreshToken) {
      const refreshResponse = await fetch(
        "http://localhost:5200/api/v1/auth/refresh",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        },
      );
      const refreshData = await refreshResponse.json();
      if (refreshData.success) {
        localStorage.setItem("accessToken", refreshData.data.accessToken);
        localStorage.setItem("refreshToken", refreshData.data.refreshToken);
        headers.Authorization = `Bearer ${refreshData.data.accessToken}`;
        response = await fetch(url, { ...options, headers });
      } else {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        throw new Error("请重新登录");
      }
    }
  }
  return response.json();
}
```

#### 业务接口示例：创建工作空间、文档与块并手动创建版本

```typescript
async function createWorkspaceAndDoc(accessToken: string) {
  const base = "http://localhost:5200/api/v1";
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };

  const ws = await fetch(`${base}/workspaces`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "我的空间", description: "示例", icon: "📁" }),
  }).then((r) => r.json());
  if (!ws.success) throw new Error(ws.error?.message || "创建工作空间失败");
  const workspaceId = ws.data.workspaceId;

  const doc = await fetch(`${base}/documents`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      workspaceId,
      title: "第一篇文档",
      visibility: "workspace",
      tags: [],
    }),
  }).then((r) => r.json());
  if (!doc.success) throw new Error(doc.error?.message || "创建文档失败");
  const { docId, rootBlockId } = doc.data;

  const block = await fetch(`${base}/blocks`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      docId,
      type: "paragraph",
      payload: { text: "这是第一段内容" },
      parentId: rootBlockId,
      createVersion: false, // 延迟创建版本
    }),
  }).then((r) => r.json());
  if (!block.success) throw new Error(block.error?.message || "创建块失败");

  // 手动提交版本，合并待创建操作
  await fetch(`${base}/documents/${docId}/commit`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message: "完成编辑" }),
  });

  return { workspaceId, docId, rootBlockId };
}
```

### cURL 示例

#### 注册用户

```bash
curl -X POST http://localhost:5200/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "john_doe",
    "email": "john@example.com",
    "password": "SecurePass123!",
    "displayName": "John Doe"
  }'
```

#### 用户登录

```bash
curl -X POST http://localhost:5200/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "emailOrUsername": "john@example.com",
    "password": "SecurePass123!"
  }'
```

#### 获取当前用户

```bash
curl -X GET http://localhost:5200/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

#### 刷新 Token

```bash
curl -X POST http://localhost:5200/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "YOUR_REFRESH_TOKEN"}'
```

#### 创建工作空间（需登录拿到 ACCESS_TOKEN）

```bash
curl -X POST http://localhost:5200/api/v1/workspaces \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -d '{"name": "我的空间", "description": "示例", "icon": "📁"}'
```

### Axios 示例

```typescript
import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:5200/api/v1",
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("accessToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = localStorage.getItem("refreshToken");
        const response = await axios.post(
          "http://localhost:5200/api/v1/auth/refresh",
          { refreshToken },
        );
        const { accessToken, refreshToken: newRefreshToken } =
          response.data.data;
        localStorage.setItem("accessToken", accessToken);
        localStorage.setItem("refreshToken", newRefreshToken);
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        window.location.href = "/login";
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  },
);
```

---

## Swagger 与相关文档

### Swagger

启动应用后访问：

```
http://localhost:5200/api/docs
```

可查看全部接口、请求/响应 Schema，并在浏览器中调试。

### 相关文档

- [API 设计文档](./API_DESIGN.md)
- [用户行为 E2E 测试说明](./E2E_USER_JOURNEY.md)
- [设置文档](./SETUP.md)
- [安全机制说明](./SECURITY.md)

---

## 最佳实践

### 1. Token 存储

- Web 应用使用 `localStorage` 或 `sessionStorage`
- 移动端使用安全存储（Keychain/Keystore）
- 不要将 Token 暴露在日志或非安全存储中

### 2. Token 刷新策略

- 在 Access Token 即将过期（如剩余 < 1 小时）时自动刷新
- 收到 401 时尝试刷新 Token 并重试
- Refresh Token 过期则引导用户重新登录

### 3. 文档版本策略

- 高频编辑时，将块操作的 `createVersion` 设为 `false`，完成后调用 `/documents/:docId/commit` 统一生成版本
- 删除块始终会立即创建版本，请提前规划
- 使用 `pending-versions` 接口判断是否有未提交的版本

### 4. 块排序

- 优先让系统自动生成 `sortKey`，避免手动传递过小或重复的值
- 需要精确调整时使用移动接口而非手写 `sortKey`

### 5. 限流与重试

- 系统全局限流：默认 60 秒内最多 100 次请求，超过返回 429
- 客户端应对 429 做延迟重试或提示用户
- 运行时可通过 `/runtime-configs/rate-limit` 接口动态调优（需系统管理员令牌）

### 6. 安全性

- 生产环境使用 HTTPS
- 定期更新密码并审计安全/审计日志
- 服务端启用全局限流与统一异常处理

---

## 常见问题

### Token 过期后怎么办？

使用 `POST /auth/refresh` 获取新的 Access Token 和 Refresh Token，或重新登录。

### 如何判断 Token 是否过期？

接口返回 401 或错误码 `UNAUTHORIZED` 时视为需要刷新或重新登录。

### Refresh Token 也会过期吗？

会，默认约 7 天，过期后需重新登录。

### 可以同时有多个有效 Token 吗？

可以，不同设备/会话互不影响；登出时传入要失效的 Token。

### 收到 429 的原因？

触发全局限流（如 60 秒内超过 100 次请求），稍后重试或联系管理员调节配置。

### 文档、块、工作空间等 ID 的格式？

由服务端生成的字符串，如 `doc_`、`b_`、`ws_`、`u_` 等前缀，见 `src/common/utils/id-generator.util.ts`。

---

## 更新日志

### 2026-01

- 文档：新增手动创建版本 `/documents/:docId/commit`、待创建版本查询 `/pending-versions`
- 文档内容：支持 `maxDepth`、`startBlockId`、`limit` 分段加载大文档
- 块：新增 `createVersion` 控制；加强 `sortKey` 自动生成与排序说明
- 版本相关：修订历史、差异、回滚、快照说明补充
- 全局：错误码对齐网站文档，增加限流说明与最新最佳实践

### 2026-05

- 版本对比：重写 diff API，返回块级变更列表（added/deleted/modified/moved/reordered/indent-changed）和统计摘要
- 时间旅行修复：修复历史版本重建受全局 `isDeleted` 标志影响导致发布内容丢失的问题
- 新增模块：设置（settings）、运行时配置（runtime-configs）
- 新增接口：`PATCH /auth/me`（更新用户信息）、`GET /auth/users/:userId`（获取用户公开资料）
- 文档内容：`limit` 最大值从 5000 更新为 10000

---

## 技术支持

- Swagger: http://localhost:5200/api/docs
- 参考：`API_DESIGN.md` · `E2E_USER_JOURNEY.md` · `SETUP.md` · `INSTALL.md`

## 文档版本快照语义（GC 前置）

每个文档版本都会有一条对应的 `doc_snapshots` 记录。该快照保存精确的
`{ blockId: blockVersion }` 映射，用于重建该文档版本的内容。

历史内容读取、版本对比、回滚和发布内容读取都会优先使用
`doc_snapshots.blockVersionMap`。旧的基于 `DocRevision.createdAt` 的时间点反推逻辑只作为
历史数据完成快照回填前的兼容回退路径。

发布文档时，系统发布的是一个确定的文档版本快照：`documents.publishedHead` 记录发布版本号，
`documents.publishedSnapshotId` 记录对应的快照 ID。匿名公开站点读取始终返回已发布快照，
不会因为传入 `version` 查询参数而读取草稿或任意历史版本。
