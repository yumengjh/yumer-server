# 项目当前进度

> 最后更新：2026-01-17

## 📊 总体完成度

```
已完成: ████████████████████ 95%
```

- ✅ 基础架构：100%
- ✅ 认证模块：100%
- ✅ 数据库实体：100%
- ✅ 工作空间模块：100%
- ✅ 文档模块：100%
- ✅ 块模块：100%
- ✅ 版本控制模块：100%
- ✅ 资产模块：100%
- ✅ 标签模块：100%
- ✅ 收藏模块：100%
- ✅ 评论模块：100%
- ✅ 搜索模块：100%
- ✅ 活动日志模块：100%
- ❌ 业务模块：98%（工作空间、文档、块、版本控制、资产、标签、收藏、评论、搜索、活动日志已完成）

---

## ✅ 已完成的功能

### 1. 认证模块 (auth)

**路径：** `src/modules/auth/`

**已实现的接口：**

- ✅ `POST /api/v1/auth/register` - 用户注册
- ✅ `POST /api/v1/auth/login` - 用户登录
- ✅ `POST /api/v1/auth/refresh` - 刷新令牌
- ✅ `POST /api/v1/auth/logout` - 用户登出
- ✅ `GET /api/v1/auth/me` - 获取当前用户信息

**功能特性：**

- JWT Token 认证
- Refresh Token 机制
- 密码加密（bcryptjs）
- 会话管理
- 用户状态管理

**相关文件：**

- `auth.controller.ts` - 控制器
- `auth.service.ts` - 业务逻辑
- `auth.module.ts` - 模块定义
- `strategies/jwt.strategy.ts` - JWT 策略
- `strategies/local.strategy.ts` - 本地策略
- `dto/register.dto.ts` - 注册 DTO
- `dto/login.dto.ts` - 登录 DTO
- `dto/refresh-token.dto.ts` - 刷新令牌 DTO

### 2. 基础设施

#### 配置模块 (`src/config/`)

- ✅ `database.config.ts` - 数据库配置
- ✅ `jwt.config.ts` - JWT 配置
- ✅ `app.config.ts` - 应用配置
- ✅ `config.module.ts` - 配置模块

#### 公共模块 (`src/common/`)

**装饰器 (decorators/)**

- ✅ `current-user.decorator.ts` - 获取当前用户
- ✅ `public.decorator.ts` - 公开接口标记
- ✅ `audit-log.decorator.ts` - 审计日志（@AuditLog）
- ⏳ `roles.decorator.ts` - 角色权限（待使用）

**守卫 (guards/)**

- ✅ `jwt-auth.guard.ts` - JWT 认证守卫
- ⏳ `roles.guard.ts` - 角色权限守卫（待使用）

**拦截器 (interceptors/)**

- ✅ `transform.interceptor.ts` - 响应格式化拦截器（全局）

**过滤器 (filters/)**

- ✅ `http-exception.filter.ts` - 全局异常过滤器

**管道 (pipes/)**

- ⏳ `validation.pipe.ts` - 自定义验证管道（目前使用 NestJS 内置）

**DTO (dto/)**

- ✅ `response.dto.ts` - 统一响应格式
- ✅ `pagination.dto.ts` - 分页 DTO（已使用）

**工具类 (utils/)**

- ✅ `hash.util.ts` - 密码加密/验证工具
- ✅ `id-generator.util.ts` - ID 生成工具
- ⏳ `sort-key.util.ts` - 排序键工具（待使用）

### 3. 数据库实体

**路径：** `src/entities/`

**已定义的实体（16个）：**

- ✅ `user.entity.ts` - 用户
- ✅ `workspace.entity.ts` - 工作空间
- ✅ `workspace-member.entity.ts` - 工作空间成员
- ✅ `document.entity.ts` - 文档
- ✅ `block.entity.ts` - 块
- ✅ `block-version.entity.ts` - 块版本
- ✅ `doc-revision.entity.ts` - 文档修订
- ✅ `doc-snapshot.entity.ts` - 文档快照
- ✅ `asset.entity.ts` - 资产
- ✅ `audit-log.entity.ts` - 审计日志
- ✅ `security-log.entity.ts` - 安全日志
- ✅ `tag.entity.ts` - 标签
- ✅ `favorite.entity.ts` - 收藏
- ✅ `comment.entity.ts` - 评论
- ✅ `activity.entity.ts` - 活动日志
- ✅ `session.entity.ts` - 会话

**数据库配置：**

- ✅ TypeORM 配置完成
- ✅ 开发环境自动同步（synchronize: true）
- ✅ 开发环境 SQL 日志（logging: true）

### 4. 应用配置

**主文件：** `src/main.ts`

- ✅ Swagger API 文档集成
- ✅ 全局验证管道
- ✅ 全局异常过滤器
- ✅ 全局响应拦截器
- ✅ CORS 配置
- ✅ 全局 API 前缀（`/api/v1`）

**模块配置：** `src/app.module.ts`

- ✅ 配置模块集成
- ✅ 数据库模块集成
- ✅ 认证模块集成
- ✅ 工作空间模块集成
- ✅ 文档模块集成
- ✅ 块模块集成
- ✅ 资产模块集成
- ✅ 安全模块集成
- ✅ 全局限流（Throttler）
- ✅ 标签模块集成
- ✅ 收藏模块集成
- ✅ 评论模块集成
- ✅ 搜索模块集成
- ✅ 活动日志模块集成

---

## ❌ 未完成的功能

### 1. 工作空间模块 (workspaces) ✅

**路径：** `src/modules/workspaces/`

**已实现的接口：**

- ✅ `POST /api/v1/workspaces` - 创建工作空间
- ✅ `GET /api/v1/workspaces` - 获取工作空间列表
- ✅ `GET /api/v1/workspaces/:workspaceId` - 获取工作空间详情
- ✅ `PATCH /api/v1/workspaces/:workspaceId` - 更新工作空间
- ✅ `DELETE /api/v1/workspaces/:workspaceId` - 删除工作空间
- ✅ `POST /api/v1/workspaces/:workspaceId/members` - 邀请成员
- ✅ `GET /api/v1/workspaces/:workspaceId/members` - 获取成员列表
- ✅ `PATCH /api/v1/workspaces/:workspaceId/members/:userId` - 更新成员角色
- ✅ `DELETE /api/v1/workspaces/:workspaceId/members/:userId` - 移除成员

**功能特性：**

- 工作空间 CRUD 操作
- 成员管理（邀请、更新角色、移除）
- 权限控制（owner、admin、editor、viewer）
- 分页支持
- 工作空间状态管理（active、archived）

**相关文件：**

- `workspaces.module.ts` - 模块定义
- `workspaces.controller.ts` - 控制器
- `workspaces.service.ts` - 业务逻辑
- `dto/create-workspace.dto.ts` - 创建 DTO
- `dto/update-workspace.dto.ts` - 更新 DTO
- `dto/invite-member.dto.ts` - 邀请成员 DTO
- `dto/update-member-role.dto.ts` - 更新角色 DTO

### 5. 文档模块 (documents) ✅

**路径：** `src/modules/documents/`

**已实现的接口：**

- ✅ `POST /api/v1/documents` - 创建文档
- ✅ `GET /api/v1/documents` - 获取文档列表
- ✅ `GET /api/v1/documents/:docId` - 获取文档详情
- ✅ `GET /api/v1/documents/:docId/content` - 获取文档内容（渲染树）
- ✅ `PATCH /api/v1/documents/:docId` - 更新文档元数据
- ✅ `POST /api/v1/documents/:docId/publish` - 发布文档
- ✅ `POST /api/v1/documents/:docId/move` - 移动文档
- ✅ `DELETE /api/v1/documents/:docId` - 删除文档
- ✅ `GET /api/v1/documents/search` - 搜索文档

**功能特性：**

- 文档 CRUD 操作
- 文档树结构管理（父子关系）
- 文档版本控制（head、publishedHead）
- 文档可见性控制（private、workspace、public）
- 全文搜索（PostgreSQL tsvector）
- 标签和分类管理
- 文档状态管理（draft、normal、archived、deleted）
- 自动创建根块和初始版本
- 循环引用检测

**相关文件：**

- `documents.module.ts` - 模块定义
- `documents.controller.ts` - 控制器
- `documents.service.ts` - 业务逻辑
- `dto/create-document.dto.ts` - 创建文档 DTO
- `dto/update-document.dto.ts` - 更新文档 DTO
- `dto/move-document.dto.ts` - 移动文档 DTO
- `dto/query-documents.dto.ts` - 查询文档 DTO
- `dto/search-query.dto.ts` - 搜索查询 DTO

### 6. 块模块 (blocks) ✅

**路径：** `src/modules/blocks/`

**已实现的接口：**

- ✅ `POST /api/v1/blocks` - 创建块
- ✅ `PATCH /api/v1/blocks/:blockId/content` - 更新块内容
- ✅ `POST /api/v1/blocks/:blockId/move` - 移动块
- ✅ `DELETE /api/v1/blocks/:blockId` - 删除块
- ✅ `GET /api/v1/blocks/:blockId/versions` - 获取块版本历史
- ✅ `POST /api/v1/blocks/batch` - 批量操作块

**功能特性：**

- 块 CRUD 操作
- 块版本控制（每次更新创建新版本）
- 块树结构管理（父子关系）
- 块移动和排序
- 软删除机制
- 批量操作（创建、更新、删除、移动）
- 循环引用检测
- 内容哈希计算（避免重复版本）
- 纯文本提取（用于搜索）

**相关文件：**

- `blocks.module.ts` - 模块定义
- `blocks.controller.ts` - 控制器
- `blocks.service.ts` - 业务逻辑
- `dto/create-block.dto.ts` - 创建块 DTO
- `dto/update-block.dto.ts` - 更新块 DTO
- `dto/move-block.dto.ts` - 移动块 DTO
- `dto/batch-block.dto.ts` - 批量操作 DTO

### 7. 版本控制模块 ✅

**路径：** 集成在 `src/modules/documents/`

**已实现的接口：**

- ✅ `GET /api/v1/documents/:docId/revisions` - 获取修订历史
- ✅ `GET /api/v1/documents/:docId/diff` - 版本对比
- ✅ `POST /api/v1/documents/:docId/revert` - 版本回滚
- ✅ `POST /api/v1/documents/:docId/snapshots` - 创建快照

**功能特性：**

- 文档创建时自动创建初始 DocRevision (head=1)
- 块变更时（创建/更新/删除/移动、批量）自动创建 DocRevision
- 基于 DocRevision.createdAt 计算任意版本的块版本映射 (block_version_map)
- 版本对比返回两个版本的内容树 (fromContent / toContent)
- 回滚：将各块 latestVer 恢复为目标版本映射，并软删除目标版本中不存在的块
- 快照：保存当前 head 的 blockVersionMap，已存在则幂等返回

**相关文件：**

- `documents.controller.ts` - 新增 getRevisions、getDiff、revert、createSnapshot 路由
- `documents.service.ts` - 新增 getRevisions、getDiff、revert、createSnapshot、getBlockVersionMapForVersion、buildContentTreeFromVersionMap
- `blocks.service.ts` - incrementDocumentHead 中创建 DocRevision
- `dto/query-revisions.dto.ts` - 修订列表分页
- `dto/diff-versions.dto.ts` - 版本对比查询 (fromVer, toVer)
- `dto/revert-version.dto.ts` - 回滚 body (version)

### 8. 资产模块 (assets) ✅

**路径：** `src/modules/assets/`

**已实现的接口：**

- ✅ `POST /api/v1/assets/upload` - 上传资产（multipart/form-data: file + workspaceId）
- ✅ `GET /api/v1/assets` - 获取资产列表（query: workspaceId, page, pageSize）
- ✅ `GET /api/v1/assets/:assetId/file` - 获取资产文件流（预览/下载）
- ✅ `DELETE /api/v1/assets/:assetId` - 删除资产（软删除并删除磁盘文件）

**功能特性：**

- 本地存储（storageProvider: local），目录：uploads/workspaces/{workspaceId}/
- 配置文件：app.uploadDir、app.maxFileSize（默认 10MB）
- 软删除 + 物理删除文件，url 为 /api/v1/assets/:assetId/file

**相关文件：**

- `assets.module.ts`、`assets.controller.ts`、`assets.service.ts`
- `dto/upload-asset.dto.ts`、`dto/query-assets.dto.ts`

### 9. 安全模块 (security) ✅

**路径：** `src/modules/security/`，参考 [SAFE_DESIGN.md](./SAFE_DESIGN.md)

**已实现：**

- ✅ **安全日志 (security_logs)**：SecurityService.logEvent / logLoginSuccess / logLoginFailed / logLogout / logUnauthorizedAccess / logPermissionDenied / logRateLimitExceeded
- ✅ **审计日志 (audit_logs)**：AuditService.record、findFiltered、findUserActivities、findResourceHistory、findSensitiveActions
- ✅ **@AuditLog 装饰器** + **AuditLogInterceptor**（全局）：对带 @AuditLog 的接口自动写入 audit_logs，敏感字段脱敏
- ✅ **ErrorCode 与 BusinessException**：`common/errors/error-codes.ts`、`common/exceptions/business.exception.ts`
- ✅ **全局限流**：ThrottlerModule（60s/100 次）+ ThrottlerGuard

**已实现接口：**

- ✅ `GET /api/v1/security/events` - 查询安全日志（eventType、userId、ip、startDate、endDate、分页）
- ✅ `GET /api/v1/security/audit` - 查询审计日志（action、resourceType、resourceId、userId、日期、分页）

**集成：**

- Auth：登录成功/失败、登出时写入 security_logs（ip、userAgent）
- Documents：创建、删除时通过 @AuditLog 写入 audit_logs

**相关文件：**

- `security.module.ts`、`security.service.ts`、`audit.service.ts`、`security.controller.ts`
- `interceptors/audit-log.interceptor.ts`、`constants/security-events.ts`
- `dto/query-security-logs.dto.ts`、`dto/query-audit-logs.dto.ts`
- `entities/audit-log.entity.ts`、`entities/security-log.entity.ts`
- `common/decorators/audit-log.decorator.ts`、`common/errors/error-codes.ts`、`common/exceptions/business.exception.ts`

### 10. 标签模块 (tags) ✅

**路径：** `src/modules/tags/`

**已实现的接口：**

- ✅ `POST /api/v1/tags` - 创建标签（workspaceId、name、color）
- ✅ `GET /api/v1/tags` - 获取标签列表（workspaceId、分页）
- ✅ `GET /api/v1/tags/:tagId` - 获取标签详情
- ✅ `GET /api/v1/tags/:tagId/usage` - 标签使用统计（文档数）
- ✅ `PATCH /api/v1/tags/:tagId` - 更新标签（含 documents.tags 联动更名）
- ✅ `DELETE /api/v1/tags/:tagId` - 删除标签（并从 documents.tags 中移除）

**相关文件：** `tags.module.ts`、`tags.service.ts`、`tags.controller.ts`、`dto/create-tag.dto.ts`、`dto/update-tag.dto.ts`、`dto/query-tags.dto.ts`

### 11. 收藏模块 (favorites) ✅

**路径：** `src/modules/favorites/`

**已实现的接口：**

- ✅ `POST /api/v1/favorites` - 收藏文档（body: docId）
- ✅ `GET /api/v1/favorites` - 获取收藏列表（分页，含 document）
- ✅ `DELETE /api/v1/favorites/:docId` - 取消收藏

**功能：** 收藏/取消时同步 document.favoriteCount

**相关文件：** `favorites.module.ts`、`favorites.service.ts`、`favorites.controller.ts`、`dto/create-favorite.dto.ts`、`dto/query-favorites.dto.ts`

### 12. 评论模块 (comments) ✅

**路径：** `src/modules/comments/`

**已实现的接口：**

- ✅ `POST /api/v1/comments` - 创建评论/回复（docId、blockId?、content、mentions?、parentCommentId?）
- ✅ `GET /api/v1/comments` - 获取评论列表（docId、blockId?、分页）
- ✅ `GET /api/v1/comments/:commentId` - 获取评论详情
- ✅ `PATCH /api/v1/comments/:commentId` - 更新评论（仅本人）
- ✅ `DELETE /api/v1/comments/:commentId` - 删除评论（软删除，仅本人）

**相关文件：** `comments.module.ts`、`comments.service.ts`、`comments.controller.ts`、`dto/create-comment.dto.ts`、`dto/update-comment.dto.ts`、`dto/query-comments.dto.ts`

### 13. 搜索模块 (search) ✅

**路径：** `src/modules/search/`

**已实现的接口：**

- ✅ `GET /api/v1/search` - 全局搜索（query、workspaceId?、type?=doc|block|all、page、pageSize）
- ✅ `POST /api/v1/search/advanced` - 高级搜索（标签、时间范围、createdBy、sortBy、sortOrder）

**功能：**

- 文档标题：searchVector @@ plainto_tsquery 或 title ILIKE
- 块内容：BlockVersion.searchVector / plainText，仅最新版本（b.latestVer = bv.ver），权限过滤
- 高级：tags &&、updatedAt 范围、createdBy、排序（rank/updatedAt/createdAt）

**相关文件：** `search.module.ts`、`search.service.ts`、`search.controller.ts`、`dto/search-query.dto.ts`、`dto/advanced-search.dto.ts`

### 14. 活动日志模块 (activities) ✅

**路径：** `src/modules/activities/`

**已实现的接口：**

- ✅ `GET /api/v1/activities` - 获取活动日志（workspaceId 必填，userId、action、entityType、startDate、endDate、分页）

**记录埋点（Service 层）：**

- 工作空间：create、update、delete；成员：invite、role、remove
- 文档：create、update、publish、move、delete
- 块：create、updateContent、move、remove、batch
- 收藏：create、remove
- 评论：create、delete
- 标签：create、update、delete

**相关文件：** `activities.module.ts`、`activities.service.ts`、`activities.controller.ts`、`constants/activity-actions.ts`、`dto/query-activities.dto.ts`

### 6. 其他功能模块

（暂无）

---

## 📁 项目结构

```
app/
├── src/
│   ├── common/              ✅ 公共模块
│   │   ├── decorators/      ✅ 装饰器
│   │   ├── guards/          ✅ 守卫
│   │   ├── interceptors/    ✅ 拦截器
│   │   ├── filters/         ✅ 过滤器
│   │   ├── pipes/           ⏳ 管道
│   │   ├── dto/             ✅ DTO
│   │   └── utils/           ✅ 工具类
│   ├── config/              ✅ 配置模块
│   ├── entities/            ✅ 数据库实体（16个）
│   ├── modules/
│   │   ├── auth/            ✅ 认证模块
│   │   ├── workspaces/      ✅ 工作空间模块
│   │   ├── documents/       ✅ 文档模块
│   │   ├── blocks/          ✅ 块模块
│   │   ├── assets/          ✅ 资产模块
│   │   ├── security/         ✅ 安全模块
│   │   ├── tags/            ✅ 标签模块
│   │   ├── favorites/       ✅ 收藏模块
│   │   ├── comments/        ✅ 评论模块
│   │   ├── search/          ✅ 搜索模块
│   │   └── activities/      ✅ 活动日志模块
│   ├── app.module.ts        ✅ 主模块
│   └── main.ts              ✅ 应用入口
├── docs/
│   ├── API_DESIGN.md        ✅ API 设计文档
│   ├── TODO.md              ✅ 待办事项
│   ├── SETUP.md             ✅ 设置文档
│   └── CURRENT_PROGRESS.md  ✅ 当前进度（本文件）
└── package.json             ✅ 依赖配置
```

---

## 🔧 技术栈

### 已使用

- ✅ NestJS 11.x
- ✅ TypeORM 0.3.x
- ✅ PostgreSQL
- ✅ Passport + JWT
- ✅ Swagger/OpenAPI
- ✅ class-validator
- ✅ class-transformer
- ✅ bcryptjs

### 待使用

- ⏳ Redis（缓存，可选）
- ⏳ Bull（队列，可选）

### 已使用（资产模块）

- ✅ Multer（文件上传，@nestjs/platform-express + multer）

### 已使用（安全模块）

- ✅ @nestjs/throttler（全局限流）

---

## 📝 下一步计划

### 优先级 P0（必须）

1. ✅ **工作空间模块** - 文档功能的基础依赖（已完成）
2. ✅ **文档模块** - 核心业务功能（已完成）
3. ✅ **块模块** - 文档内容的基础单元（已完成）

### 优先级 P1（重要）

4. ✅ **版本控制模块** - 文档历史管理（已完成）
5. ✅ **资产模块** - 文件上传和管理（已完成）

### 优先级 P2（增强）

6. ✅ **标签模块** - 文档分类（已完成）
7. ✅ **收藏模块** - 用户功能（已完成）
8. ✅ **评论模块** - 协作功能（已完成）
9. ✅ **搜索模块** - 全文搜索（已完成）

### 优先级 P3（优化）

10. ✅ **活动日志模块** - 审计功能（已完成）
11. **性能优化** - 缓存、限流等
12. **测试** - 单元测试、集成测试

---

## 🐛 已知问题

1. **SQL 日志过多** - 开发环境开启了详细 SQL 日志，启动时会输出大量元数据查询
   - 解决方案：调整 `logging` 配置为 `['error', 'warn']` 或 `false`

2. **依赖版本警告** - 部分 NestJS 包存在 peer dependency 警告
   - 影响：通常不影响运行，但建议后续升级到兼容版本

---

## 📚 相关文档

- [API 设计文档](./API_DESIGN.md) - 详细的 API 接口设计
- [安全与日志设计](./SAFE_DESIGN.md) - 安全机制、日志、审计、限流
- [安全机制说明](./SECURITY.md) - 当前已实现的安全机制说明
- [用户行为 E2E 测试说明](./E2E_USER_JOURNEY.md) - user-journey.e2e-spec 运行方式、架构与接口清单
- [文档操作流程指南](./DOCUMENT_WORKFLOW.md) - 从注册到创建文档、块的完整操作流程与接口顺序
- [批量块操作 API 文档](./BATCH_BLOCKS_API.md) - 批量块操作接口的详细使用说明
- [文档版本控制 API 文档](./VERSION_CONTROL_API.md) - 延迟版本创建和手动触发机制说明
- [待办事项](./TODO.md) - 功能实现清单
- [设置文档](./SETUP.md) - 环境配置说明

---

## 🎯 里程碑

- [x] 2026-01-17 - 完成基础架构和认证模块
- [x] 2026-01-17 - 完成工作空间模块
- [x] 2026-01-17 - 完成文档模块
- [x] 2026-01-17 - 完成块模块
- [x] 2026-01-17 - 完成版本控制模块（P1）
- [x] 2026-01-17 - 完成资产模块（P1）
- [x] 2026-01-17 - 完成标签、收藏、评论模块（P2）
- [x] 2026-01-17 - 完成搜索模块（P2）
- [x] 2026-01-17 - 完成活动日志模块（P3）
- [ ] 待定 - 完成核心功能（P0）
- [ ] 待定 - 完成增强功能（P1-P2）
- [ ] 待定 - 项目上线准备
