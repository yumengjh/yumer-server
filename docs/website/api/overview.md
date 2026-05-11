# API 总览

本文档提供个人知识库后端系统的完整 API 接口列表和快速参考。

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

默认情况下，除注册、登录、刷新令牌外，其余接口均需 JWT 认证：

```
Authorization: Bearer <your-access-token>
```

同时，部分只读接口支持通过 `@SitePublic()` 开放给指定站点匿名访问：

- 如果请求带有 `Authorization` 头，仍按 JWT 鉴权处理
- 如果请求不带 token，则只允许来自 `PUBLIC_SITE_ORIGINS` 的站点来源匿名访问
- 服务端优先校验 `Origin`，缺失时回退校验 `Referer`
- 未命中允许站点时返回 `403 Forbidden`
- `PUBLIC_SITE_ORIGINS` 会同时并入后端 CORS 白名单

### 站点公开接口（SitePublic）

| 方法 | 路径                                | 说明                                                 |
| ---- | ----------------------------------- | ---------------------------------------------------- |
| GET  | `/auth/users/:userId`               | 获取作者公开资料；匿名公开响应不返回 `email`         |
| GET  | `/documents`                        | 获取已发布文档列表；匿名访问时必须传 `workspaceId`   |
| GET  | `/documents/:docId`                 | 获取已发布文档详情                                   |
| GET  | `/documents/:docId/content`         | 获取已发布文档内容；匿名访问固定返回 `publishedHead` |
| GET  | `/tags`                             | 获取指定工作空间标签列表                             |
| GET  | `/workspaces/:workspaceId`          | 获取工作空间公开信息                                 |
| GET  | `/workspaces/:workspaceId/settings` | 获取工作空间公开设置                                 |

### 相关环境变量

```bash
PUBLIC_SITE_ORIGINS=https://publish.example.com,https://docs.example.com
PUBLIC_SITE_ALLOW_NO_ORIGIN=false
```

`PUBLIC_SITE_ORIGINS` 现支持以下写法：

- 精确匹配：`https://publish.example.com`
- 全量放开：`*`
- 子域通配符：`https://*.example.com`

`PUBLIC_SITE_ALLOW_NO_ORIGIN=true` 时，仅 `@SitePublic()` 接口会放行不带 `Origin` / `Referer` 的匿名请求。

## API 接口分类

### 1. 认证 (Auth)

用户注册、登录、令牌管理等基础认证功能。

| 方法  | 路径                  | 说明                     | 认证           |
| ----- | --------------------- | ------------------------ | -------------- |
| POST  | `/auth/register`      | 用户注册                 | 否             |
| POST  | `/auth/login`         | 用户登录                 | 否             |
| POST  | `/auth/refresh`       | 刷新令牌                 | 否             |
| POST  | `/auth/logout`        | 用户登出                 | 是             |
| GET   | `/auth/me`            | 获取当前用户             | 是             |
| PATCH | `/auth/me`            | 更新当前用户信息         | 是             |
| GET   | `/auth/users/:userId` | 根据 userId 获取用户信息 | JWT / 站点公开 |

**详细文档：** [认证 API](./auth.md)

### 2. 工作空间 (Workspaces)

工作空间的创建、管理、成员管理等功能。

| 方法   | 路径                                       | 说明         | 认证           |
| ------ | ------------------------------------------ | ------------ | -------------- |
| POST   | `/workspaces`                              | 创建工作空间 | 是             |
| GET    | `/workspaces`                              | 工作空间列表 | 是             |
| GET    | `/workspaces/:workspaceId`                 | 工作空间详情 | JWT / 站点公开 |
| PATCH  | `/workspaces/:workspaceId`                 | 更新工作空间 | 是             |
| DELETE | `/workspaces/:workspaceId`                 | 删除工作空间 | 是             |
| POST   | `/workspaces/:workspaceId/members`         | 邀请成员     | 是             |
| GET    | `/workspaces/:workspaceId/members`         | 成员列表     | 是             |
| PATCH  | `/workspaces/:workspaceId/members/:userId` | 更新成员角色 | 是             |
| DELETE | `/workspaces/:workspaceId/members/:userId` | 移除成员     | 是             |

**详细文档：** [工作空间 API](./workspaces.md)

### 3. 文档 (Documents)

文档的创建、编辑、版本控制、发布等功能。

| 方法   | 路径                                 | 说明               | 认证           |
| ------ | ------------------------------------ | ------------------ | -------------- |
| POST   | `/documents`                         | 创建文档           | 是             |
| GET    | `/documents`                         | 文档列表           | JWT / 站点公开 |
| GET    | `/documents/search`                  | 搜索文档           | 是             |
| GET    | `/documents/:docId`                  | 文档详情           | JWT / 站点公开 |
| GET    | `/documents/:docId/content`          | 文档内容/渲染树    | JWT / 站点公开 |
| PATCH  | `/documents/:docId`                  | 更新文档元数据     | 是             |
| POST   | `/documents/:docId/publish`          | 发布文档           | 是             |
| POST   | `/documents/:docId/move`             | 移动文档           | 是             |
| DELETE | `/documents/:docId`                  | 删除文档           | 是             |
| GET    | `/documents/:docId/revisions`        | 修订历史           | 是             |
| GET    | `/documents/:docId/diff`             | 版本对比           | 是             |
| POST   | `/documents/:docId/revert`           | 回滚到指定版本     | 是             |
| POST   | `/documents/:docId/snapshots`        | 创建快照           | 是             |
| POST   | `/documents/:docId/commit`           | 手动触发创建版本   | 是             |
| GET    | `/documents/:docId/pending-versions` | 获取待创建版本数量 | 是             |

**详细文档：** [文档 API](./documents.md)

### 4. 块 (Blocks)

文档块（内容单元）的创建、更新、移动、删除等功能。

| 方法   | 路径                        | 说明       | 认证 |
| ------ | --------------------------- | ---------- | ---- |
| POST   | `/blocks`                   | 创建块     | 是   |
| PATCH  | `/blocks/:blockId/content`  | 更新块内容 | 是   |
| POST   | `/blocks/:blockId/move`     | 移动块     | 是   |
| DELETE | `/blocks/:blockId`          | 删除块     | 是   |
| GET    | `/blocks/:blockId/versions` | 块版本历史 | 是   |
| POST   | `/blocks/batch`             | 批量操作   | 是   |

**详细文档：** [块 API](./blocks.md)

### 5. 标签 (Tags)

标签的创建、管理、使用统计等功能。

| 方法   | 路径                 | 说明         | 认证           |
| ------ | -------------------- | ------------ | -------------- |
| POST   | `/tags`              | 创建标签     | 是             |
| GET    | `/tags`              | 标签列表     | JWT / 站点公开 |
| GET    | `/tags/:tagId`       | 标签详情     | 是             |
| GET    | `/tags/:tagId/usage` | 标签使用统计 | 是             |
| PATCH  | `/tags/:tagId`       | 更新标签     | 是             |
| DELETE | `/tags/:tagId`       | 删除标签     | 是             |

**详细文档：** [标签 API](./tags.md)

### 6. 收藏 (Favorites)

文档收藏功能。

| 方法   | 路径                | 说明     | 认证 |
| ------ | ------------------- | -------- | ---- |
| POST   | `/favorites`        | 添加收藏 | 是   |
| GET    | `/favorites`        | 收藏列表 | 是   |
| DELETE | `/favorites/:docId` | 取消收藏 | 是   |

**详细文档：** [收藏 API](./favorites.md)

### 7. 评论 (Comments)

文档和块的评论功能。

| 方法   | 路径                   | 说明     | 认证 |
| ------ | ---------------------- | -------- | ---- |
| POST   | `/comments`            | 创建评论 | 是   |
| GET    | `/comments`            | 评论列表 | 是   |
| GET    | `/comments/:commentId` | 评论详情 | 是   |
| PATCH  | `/comments/:commentId` | 更新评论 | 是   |
| DELETE | `/comments/:commentId` | 删除评论 | 是   |

**详细文档：** [评论 API](./comments.md)

### 8. 搜索 (Search)

全局搜索和高级搜索功能。

| 方法 | 路径               | 说明     | 认证 |
| ---- | ------------------ | -------- | ---- |
| GET  | `/search`          | 全局搜索 | 是   |
| POST | `/search/advanced` | 高级搜索 | 是   |

**详细文档：** [搜索 API](./search.md)

### 9. 设置 (Settings)

阅读/编辑体验设置与工作空间覆盖配置。

| 方法   | 路径                                | 说明                             | 认证           |
| ------ | ----------------------------------- | -------------------------------- | -------------- |
| GET    | `/settings/me`                      | 获取当前用户设置（含默认值）     | 是             |
| PATCH  | `/settings/me`                      | 更新当前用户设置                 | 是             |
| GET    | `/settings/effective`               | 获取生效设置（可带 workspaceId） | 是             |
| GET    | `/workspaces/:workspaceId/settings` | 获取工作空间覆盖设置             | JWT / 站点公开 |
| PATCH  | `/workspaces/:workspaceId/settings` | 更新工作空间覆盖设置             | 是             |
| DELETE | `/workspaces/:workspaceId/settings` | 清空工作空间覆盖设置             | 是             |

**详细文档：** [设置 API](./settings.md)

### 10. 活动日志 (Activities)

用户活动日志查询功能。

| 方法 | 路径          | 说明         | 认证 |
| ---- | ------------- | ------------ | ---- |
| GET  | `/activities` | 活动日志列表 | 是   |

**详细文档：** [活动日志 API](./activities.md)

### 11. 资产 (Assets)

文件上传和管理功能。

| 方法   | 路径                    | 说明         | 认证 |
| ------ | ----------------------- | ------------ | ---- |
| POST   | `/assets/upload`        | 上传资产     | 是   |
| GET    | `/assets`               | 资产列表     | 是   |
| GET    | `/assets/:assetId/file` | 获取资产文件 | 是   |
| DELETE | `/assets/:assetId`      | 删除资产     | 是   |

**详细文档：** [资产 API](./assets.md)

### 12. 安全 (Security)

安全日志和审计日志查询功能。

| 方法 | 路径               | 说明         | 认证 |
| ---- | ------------------ | ------------ | ---- |
| GET  | `/security/events` | 安全日志列表 | 是   |
| GET  | `/security/audit`  | 审计日志列表 | 是   |

**详细文档：** [安全 API](./security.md)

### 13. 运行时配置 (Runtime Configs)

系统级动态配置管理（当前支持限流热更新）。

| 方法  | 路径                                | 说明         | 认证           |
| ----- | ----------------------------------- | ------------ | -------------- |
| GET   | `/runtime-configs/rate-limit`       | 读取限流配置 | 系统管理员令牌 |
| PATCH | `/runtime-configs/rate-limit`       | 更新限流配置 | 系统管理员令牌 |
| POST  | `/runtime-configs/rate-limit/reset` | 重置限流配置 | 系统管理员令牌 |

**说明：**

- 该模块不使用 JWT，而是使用 `x-system-admin-token`。
- 用于运维/平台层控制，不属于普通业务用户接口。

**详细文档：** [运行时配置 API](./runtime-configs.md)

### OpenAPI 导出

支持导出 OpenAPI 3.x 标准文件（JSON / YAML），可用于导入 Apifox 等工具。

**详细文档：** [OpenAPI 导出](./openapi.md)

## 快速开始

### 1. 用户注册

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

### 2. 用户登录

```bash
curl -X POST http://localhost:5200/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "emailOrUsername": "john@example.com",
    "password": "SecurePass123!"
  }'
```

### 3. 使用 Token 访问接口

```bash
curl -X GET http://localhost:5200/api/v1/auth/me \
  -H "Authorization: Bearer <your-access-token>"
```
