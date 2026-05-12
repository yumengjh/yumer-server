# 开发任务清单

## 📋 项目初始化

- [x] 创建数据库架构 (schema.sql)
- [x] 创建测试数据 (seed.sql)
- [x] 配置环境变量 (.env)
- [ ] 执行数据库初始化
- [ ] 安装必要的依赖包

## 📦 依赖包安装

### 核心依赖

```bash
npm install @nestjs/typeorm typeorm pg
npm install @nestjs/config
npm install class-validator class-transformer
```

### 认证相关

```bash
npm install @nestjs/passport passport
npm install @nestjs/jwt passport-jwt
npm install bcrypt
npm install @types/bcrypt -D
npm install @types/passport-jwt -D
```

### API 文档

```bash
npm install @nestjs/swagger
```

### 限流和缓存

```bash
npm install @nestjs/throttler
npm install @nestjs/cache-manager cache-manager
```

## 🏗️ 基础模块创建

### 1. 配置模块 (config/)

- [ ] 创建 `src/config/database.config.ts` - 数据库配置
- [ ] 创建 `src/config/jwt.config.ts` - JWT 配置
- [ ] 创建 `src/config/app.config.ts` - 应用配置

```bash
nest g module config
```

### 2. 公共模块 (common/)

#### 装饰器 (decorators/)

- [ ] `src/common/decorators/current-user.decorator.ts` - 获取当前用户
- [ ] `src/common/decorators/public.decorator.ts` - 公开接口标记
- [ ] `src/common/decorators/roles.decorator.ts` - 角色权限标记
- [ ] `src/common/decorators/api-paginated-response.decorator.ts` - 分页响应装饰器

#### 守卫 (guards/)

- [ ] `src/common/guards/jwt-auth.guard.ts` - JWT 认证守卫
- [ ] `src/common/guards/roles.guard.ts` - 角色权限守卫
- [ ] `src/common/guards/workspace.guard.ts` - 工作空间权限守卫

#### 拦截器 (interceptors/)

- [ ] `src/common/interceptors/transform.interceptor.ts` - 统一响应格式拦截器
- [ ] `src/common/interceptors/logging.interceptor.ts` - 日志记录拦截器
- [ ] `src/common/interceptors/timeout.interceptor.ts` - 超时拦截器
- [ ] `src/common/interceptors/cache.interceptor.ts` - 缓存拦截器

#### 过滤器 (filters/)

- [ ] `src/common/filters/http-exception.filter.ts` - HTTP 异常过滤器
- [ ] `src/common/filters/all-exceptions.filter.ts` - 全局异常过滤器

#### 管道 (pipes/)

- [ ] `src/common/pipes/validation.pipe.ts` - 全局验证管道

#### DTO (dto/)

- [ ] `src/common/dto/pagination.dto.ts` - 分页查询 DTO
- [ ] `src/common/dto/response.dto.ts` - 统一响应 DTO

#### 工具类 (utils/)

- [ ] `src/common/utils/id-generator.util.ts` - ID 生成器 (user_id, doc_id 等)
- [ ] `src/common/utils/hash.util.ts` - 哈希工具 (密码加密、内容哈希)
- [ ] `src/common/utils/sort-key.util.ts` - 排序键生成器
- [ ] `src/common/utils/debounce.util.ts` - 防抖工具
- [ ] `src/common/utils/throttle.util.ts` - 节流工具

## 🗄️ 数据库实体创建 (entities/)

```bash
# 创建所有实体
nest g class entities/user.entity --no-spec
nest g class entities/workspace.entity --no-spec
nest g class entities/workspace-member.entity --no-spec
nest g class entities/document.entity --no-spec
nest g class entities/block.entity --no-spec
nest g class entities/block-version.entity --no-spec
nest g class entities/doc-revision.entity --no-spec
nest g class entities/doc-snapshot.entity --no-spec
nest g class entities/asset.entity --no-spec
nest g class entities/tag.entity --no-spec
nest g class entities/favorite.entity --no-spec
nest g class entities/comment.entity --no-spec
nest g class entities/activity.entity --no-spec
nest g class entities/session.entity --no-spec
```

- [ ] 实现所有实体的 TypeORM 装饰器
- [ ] 配置实体关系 (OneToMany, ManyToOne, ManyToMany)
- [ ] 添加实体监听器 (BeforeInsert, BeforeUpdate)

## 🔐 认证模块 (auth/)

```bash
nest g module modules/auth
nest g controller modules/auth
nest g service modules/auth
```

### 功能实现

- [ ] **注册功能** (`POST /auth/register`)
  - 邮箱验证
  - 密码强度验证
  - bcrypt 加密密码
  - 创建用户记录
- [ ] **登录功能** (`POST /auth/login`)
  - 邮箱/用户名登录
  - 密码验证
  - 生成 JWT Token
  - 创建会话记录
- [ ] **刷新令牌** (`POST /auth/refresh`)
  - Refresh Token 验证
  - 生成新的 Access Token
- [ ] **登出功能** (`POST /auth/logout`)
  - 删除会话记录
  - 加入 Token 黑名单（可选）
- [ ] **获取当前用户** (`GET /auth/me`)
  - JWT 验证
  - 返回用户信息

### JWT 策略

- [ ] 创建 `src/modules/auth/strategies/jwt.strategy.ts`
- [ ] 创建 `src/modules/auth/strategies/local.strategy.ts`

### DTO

- [ ] `dto/register.dto.ts` - 注册验证
- [ ] `dto/login.dto.ts` - 登录验证
- [ ] `dto/refresh-token.dto.ts` - 刷新令牌验证

## 👥 用户模块 (users/)

```bash
nest g module modules/users
nest g controller modules/users
nest g service modules/users
```

### 功能实现

- [ ] **获取用户信息** (`GET /users/:userId`)
- [ ] **更新用户信息** (`PATCH /users/:userId`)
- [ ] **更新密码** (`PUT /users/:userId/password`)
- [ ] **上传头像** (`POST /users/:userId/avatar`)
- [ ] **获取用户设置** (`GET /users/:userId/settings`)
- [ ] **更新用户设置** (`PUT /users/:userId/settings`)

### DTO

- [ ] `dto/update-user.dto.ts`
- [ ] `dto/update-password.dto.ts`
- [ ] `dto/update-settings.dto.ts`

## 🏢 工作空间模块 (workspaces/)

```bash
nest g module modules/workspaces
nest g controller modules/workspaces
nest g service modules/workspaces
```

### 功能实现

- [ ] **创建工作空间** (`POST /workspaces`)
  - 自动添加创建者为 owner
  - 生成唯一 workspace_id
- [ ] **获取工作空间列表** (`GET /workspaces`)
  - 仅返回用户有权限的工作空间
  - 支持分页
- [ ] **获取工作空间详情** (`GET /workspaces/:workspaceId`)
  - 权限检查
  - 包含成员信息
- [ ] **更新工作空间** (`PATCH /workspaces/:workspaceId`)
  - 仅 owner/admin 可操作
- [ ] **删除工作空间** (`DELETE /workspaces/:workspaceId`)
  - 仅 owner 可操作
  - 软删除或硬删除

### 成员管理

- [ ] **邀请成员** (`POST /workspaces/:workspaceId/members`)
  - 发送邀请通知（可选）
- [ ] **获取成员列表** (`GET /workspaces/:workspaceId/members`)
- [ ] **更新成员角色** (`PATCH /workspaces/:workspaceId/members/:userId`)
  - 仅 owner/admin 可操作
- [ ] **移除成员** (`DELETE /workspaces/:workspaceId/members/:userId`)
  - 仅 owner/admin 可操作

### DTO

- [ ] `dto/create-workspace.dto.ts`
- [ ] `dto/update-workspace.dto.ts`
- [ ] `dto/invite-member.dto.ts`
- [ ] `dto/update-member-role.dto.ts`

## 📄 文档模块 (documents/)

```bash
nest g module modules/documents
nest g controller modules/documents
nest g service modules/documents
```

### 功能实现

- [ ] **创建文档** (`POST /documents`)
  - 自动创建根块
  - 生成唯一 doc_id
  - 记录版本信息
- [ ] **获取文档列表** (`GET /documents`)
  - 工作空间过滤
  - 状态过滤
  - 标签过滤
  - 排序（更新时间、创建时间、标题）
  - 分页
- [ ] **获取文档详情** (`GET /documents/:docId`)
  - 权限检查
  - 增加浏览次数
- [ ] **获取文档内容** (`GET /documents/:docId/content`)
  - 返回渲染树
  - 支持版本查询
  - 递归加载所有块
- [ ] **更新文档元数据** (`PATCH /documents/:docId`)
  - 标题、图标、封面
  - 标签、分类
- [ ] **移动文档** (`POST /documents/:docId/move`)
  - 修改 parent_id
  - 更新 sort_order
- [ ] **发布文档** (`POST /documents/:docId/publish`)
  - 更新 published_head
  - 创建快照（可选）
- [ ] **删除文档** (`DELETE /documents/:docId`)
  - 软删除（修改 status）
  - 权限检查

### DTO

- [ ] `dto/create-document.dto.ts`
- [ ] `dto/update-document.dto.ts`
- [ ] `dto/move-document.dto.ts`
- [ ] `dto/query-documents.dto.ts`

## 🧱 块模块 (blocks/)

```bash
nest g module modules/blocks
nest g controller modules/blocks
nest g service modules/blocks
```

### 功能实现

- [ ] **创建块** (`POST /blocks`)
  - 生成 block_id
  - 创建初始版本
  - 计算内容哈希
- [ ] **更新块内容** (`PATCH /blocks/:blockId/content`)
  - 创建新版本
  - 更新 latest_ver
  - 防抖处理（避免频繁保存）
- [ ] **移动块** (`POST /blocks/:blockId/move`)
  - 更新 parent_id
  - 重新计算 sort_key
- [ ] **删除块** (`DELETE /blocks/:blockId`)
  - 软删除（设置 is_deleted）
  - 级联删除子块
- [ ] **获取块版本历史** (`GET /blocks/:blockId/versions`)
  - 分页返回
- [ ] **批量操作** (`POST /blocks/batch`)
  - 批量创建
  - 批量更新
  - 批量删除
  - 使用事务保证一致性

### 防抖机制

- [ ] 实现块内容更新防抖（500ms）
- [ ] 批量操作节流（1000ms）

### DTO

- [ ] `dto/create-block.dto.ts`
- [ ] `dto/update-block-content.dto.ts`
- [ ] `dto/move-block.dto.ts`
- [ ] `dto/batch-operations.dto.ts`

## 🔄 版本控制模块 (versions/)

```bash
nest g module modules/versions
nest g controller modules/versions
nest g service modules/versions
```

### 功能实现

- [ ] **获取文档修订列表** (`GET /documents/:docId/revisions`)
  - 分页
  - 包含提交信息
- [ ] **获取修订详情** (`GET /documents/:docId/revisions/:version`)
  - 完整的变更集信息
- [ ] **对比版本** (`GET /documents/:docId/diff`)
  - 对比两个版本差异
  - 返回 patches
- [ ] **回滚版本** (`POST /documents/:docId/revert`)
  - 恢复到指定版本
  - 创建新的修订记录
- [ ] **创建快照** (`POST /documents/:docId/snapshots`)
  - 保存完整的文档状态
  - 用于快速恢复

### DTO

- [ ] `dto/diff-versions.dto.ts`
- [ ] `dto/revert-version.dto.ts`

## 📁 资产模块 (assets/)

```bash
nest g module modules/assets
nest g controller modules/assets
nest g service modules/assets
```

### 功能实现

- [ ] **上传文件** (`POST /assets/upload`)
  - 文件类型验证
  - 文件大小限制
  - 生成 asset_id
  - 保存到本地或云存储
- [ ] **获取资产列表** (`GET /assets`)
  - 工作空间过滤
  - 文件类型过滤
  - 分页
- [ ] **获取资产详情** (`GET /assets/:assetId`)
- [ ] **删除资产** (`DELETE /assets/:assetId`)
  - 检查引用计数
  - 物理删除文件

### 文件上传配置

- [ ] 配置 Multer
- [ ] 文件类型白名单
- [ ] 文件大小限制
- [ ] 生成缩略图（图片）

### DTO

- [ ] `dto/upload-asset.dto.ts`
- [ ] `dto/query-assets.dto.ts`

## 🏷️ 标签模块 (tags/)

```bash
nest g module modules/tags
nest g controller modules/tags
nest g service modules/tags
```

### 功能实现

- [ ] **创建标签** (`POST /tags`)
- [ ] **获取标签列表** (`GET /tags`)
- [ ] **更新标签** (`PATCH /tags/:tagId`)
- [ ] **删除标签** (`DELETE /tags/:tagId`)
- [ ] **标签使用统计** (`GET /tags/statistics`)

## ⭐ 收藏模块 (favorites/)

```bash
nest g module modules/favorites
nest g controller modules/favorites
nest g service modules/favorites
```

### 功能实现

- [ ] **添加收藏** (`POST /favorites`)
- [ ] **取消收藏** (`DELETE /favorites/:docId`)
- [ ] **获取收藏列表** (`GET /favorites`)

## 💬 评论模块 (comments/)

```bash
nest g module modules/comments
nest g controller modules/comments
nest g service modules/comments
```

### 功能实现

- [ ] **创建评论** (`POST /comments`)
  - 支持 @mention
  - 支持回复评论
- [ ] **获取评论列表** (`GET /comments`)
  - 按文档查询
  - 按块查询
  - 支持分页
- [ ] **更新评论** (`PATCH /comments/:commentId`)
- [ ] **删除评论** (`DELETE /comments/:commentId`)

## 📊 活动日志模块 (activities/)

```bash
nest g module modules/activities
nest g controller modules/activities
nest g service modules/activities
```

### 功能实现

- [ ] **记录活动** (Service 层调用)
  - 文档创建/更新/删除
  - 块操作
  - 成员变更
- [ ] **获取活动日志** (`GET /activities`)
  - 工作空间过滤
  - 用户过滤
  - 操作类型过滤
  - 时间范围过滤
  - 分页

## 🔍 搜索模块 (search/)

```bash
nest g module modules/search
nest g controller modules/search
nest g service modules/search
```

### 功能实现

- [ ] **全局搜索** (`GET /search`)
  - 搜索文档标题
  - 搜索块内容
  - 使用 PostgreSQL 全文搜索
  - 结果高亮
  - 权限过滤
- [ ] **高级搜索** (`POST /search/advanced`)
  - 标签过滤
  - 时间范围
  - 创建者过滤
  - 排序选项

### DTO

- [ ] `dto/search-query.dto.ts`
- [ ] `dto/advanced-search.dto.ts`

## 🔒 安全与性能优化

### 限流 (Rate Limiting)

- [ ] 安装 `@nestjs/throttler`
- [ ] 配置全局限流
  ```typescript
  ThrottlerModule.forRoot({
    ttl: 60, // 时间窗口（秒）
    limit: 100, // 最大请求数
  });
  ```
- [ ] 为特定接口配置不同的限流规则
  - 登录接口: 5次/分钟
  - 注册接口: 3次/小时
  - 文件上传: 10次/小时

### 防抖与节流

- [ ] 块内容保存防抖（500ms）
- [ ] 搜索请求防抖（300ms）
- [ ] 批量操作节流（1000ms）

### 数据库优化

- [ ] 配置连接池
- [ ] 添加查询索引
- [ ] 使用 QueryBuilder 优化复杂查询
- [ ] 实现分页查询
- [ ] 避免 N+1 查询问题

### 缓存策略

- [ ] 用户信息缓存（5分钟）
- [ ] 工作空间信息缓存（10分钟）
- [ ] 文档列表缓存（2分钟）
- [ ] 实现缓存失效机制

## 📝 API 文档

- [ ] 配置 Swagger
- [ ] 为所有接口添加 API 装饰器
  - `@ApiOperation()`
  - `@ApiResponse()`
  - `@ApiTags()`
  - `@ApiBearerAuth()`
- [ ] 添加请求/响应示例
- [ ] 生成 OpenAPI 规范文件

## 🧪 测试

### 单元测试

- [ ] Auth Service 测试
- [ ] Users Service 测试
- [ ] Documents Service 测试
- [ ] Blocks Service 测试

### 集成测试

- [ ] 认证流程测试
- [ ] 文档 CRUD 测试
- [ ] 权限控制测试

### E2E 测试

- [ ] 完整的用户注册登录流程
- [ ] 文档创建编辑流程
- [ ] 协作功能测试

## 📚 文档完善

- [ ] API 使用文档
- [ ] 数据库设计文档
- [ ] 部署文档
- [ ] 开发者指南

## 🚀 部署准备

- [ ] 编写 Dockerfile
- [ ] 编写 docker-compose.yml
- [ ] 配置环境变量
- [ ] 数据库迁移脚本
- [ ] 健康检查接口
- [ ] 日志配置
- [ ] 监控配置

## 优先级顺序

### P0 - 核心功能（第一周）

1. 配置模块
2. 公共模块（装饰器、守卫、拦截器、过滤器）
3. 数据库实体
4. 认证模块
5. 用户模块
6. 工作空间模块

### P1 - 主要功能（第二周）

1. 文档模块
2. 块模块
3. 版本控制模块
4. 限流配置
5. 防抖节流实现

### P2 - 辅助功能（第三周）

1. 资产模块
2. 标签模块
3. 收藏模块
4. 评论模块
5. 活动日志模块
6. 搜索模块

### P3 - 优化与完善（第四周）

1. 性能优化
2. 缓存策略
3. API 文档完善
4. 测试编写
5. 部署准备

---

**开始时间:** 2026-01-17  
**预计完成:** 4周后

每完成一项任务，请将 `[ ]` 改为 `[x]`
