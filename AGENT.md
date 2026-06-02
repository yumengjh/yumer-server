# AGENT.md — AI 开发指南

## 检查清单（每次开发前必须过一遍）

- [ ] 你是谁：AI 代码助手，不是架构师
- [ ] 风格：简洁实用，中文注释
- [ ] 必做：读代码、改最少代码、别改架构
- [ ] 禁止：架构重构、花哨模式、英文注释（除非已有）、删代码先问
- [ ] 提交：`git diff --cached` → 改动合理性 → 规范提交

## 核心原则

### 你是谁
- AI 代码助手，不是架构师
- 目标：解决问题，不是展示设计模式

### 风格要求
- 代码风格：简洁、实用、可维护
- 注释：中文（除非已有英文注释）
- 命名：有意义的变量名，避免缩写
- 提交：规范的 git commit message

## 必须做

### 1. 先读代码
- **修改前必须读相关文件**，别凭感觉写
- 理解现有逻辑再动手

### 2. 改最少代码
- 只改必须改的，别顺手"优化"
- 改完检查有没有语法错误

### 3. 考虑影响
- 改公共方法要想想其他调用者
- 改类型要想想类型检查
- 改实体要想想迁移文件

### 4. 代码风格一致
- 跟着项目现有风格走
- 别引入新的设计模式

## 绝对禁止

### 1. 别改架构
- 别重构，别改项目结构
- 保持现有的模块组织

### 2. 别加复杂设计模式
- 保持简单直接
- 别过度设计
- 别引入 Redis、消息队列等重型依赖（除非明确要求）

### 3. 别改注释风格
- 中文就中文，英文就英文
- 别统一，别翻译

### 4. 别删代码
- 不确定就问，别自作主张删除

### 5. 别创建新文件
- 优先在现有文件里改
- 必须新建时放在合理位置

### 6. 别用花哨技术
- 别搞花哨的抽象和封装
- 保持简单直接

## 开发流程

### 开始前
1. `git pull` 拉最新代码
2. 读要改的文件，理解现有逻辑
3. 确认要改什么

### 开发中
1. 小步提交，每步都能跑
2. 改完检查语法错误
3. 想想有没有影响其他功能

### 提交前
1. `git diff --cached` 检查改动
2. 问自己：这些改动都必要吗？
3. 提交信息要说清楚改了什么

## 提交规范

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型
- `feat`: 新功能
- `fix`: 修复 bug
- `docs`: 文档更新
- `style`: 代码格式（不影响逻辑）
- `refactor`: 重构（不是新功能也不是修 bug）
- `perf`: 性能优化
- `test`: 测试相关
- `chore`: 构建、工具等杂项

### Scope 常用值
- `auth` `admin-auth` `blocks` `documents` `gc` `images` `search`
- `tags` `comments` `favorites` `reactions` `settings` `workspaces`
- `guestbook` `security` `runtime-config` `assets` `activities`

### 示例
```
fix(blocks): 修复批量同步时重复创建块的问题

- 在 batchSync 中增加幂等性检查
- 添加 createSyncDeleteCompensation 补偿逻辑

Closes #45
```

## 代码审查清单

### 改动合理性
- [ ] 每个改动都有明确目的
- [ ] 没有"顺手"改的东西
- [ ] 没有引入不必要的复杂性

### 代码质量
- [ ] 没有语法错误
- [ ] 没有明显的逻辑错误
- [ ] 考虑了边界情况

### 影响范围
- [ ] 没有破坏现有功能
- [ ] 没有影响其他模块
- [ ] 类型检查能过
- [ ] 实体改动有对应迁移

## 项目架构概览

```
NestJS 11 + TypeORM + PostgreSQL/SQLite
├── 认证层: JWT 双令牌 + 独立 Admin JWT
├── 业务层: 18 个功能模块
├── 数据层: 28 个实体 + 三层版本控制
├── 存储层: Local/S3/OSS/COS 多后端
└── 渲染层: 块级 HTML 懒缓存 + 导出管线
```

### 模块职责速查

| 模块 | 职责 | 关键文件 |
|------|------|---------|
| `auth` | 用户登录/注册/刷新令牌 | `auth.service.ts` `jwt.strategy.ts` |
| `admin-auth` | 管理员认证（独立 JWT 密钥） | `admin-auth.service.ts` `admin-jwt.strategy.ts` |
| `documents` | 文档 CRUD + 版本 + 导出 + 渲染 | `documents.service.ts` + `services/` 子目录 |
| `blocks` | 块级编辑 + 批量同步 | `blocks.service.ts` |
| `gc` | 垃圾回收 5 阶段管线 | `gc.module.ts` + collector/sweep/policy |
| `images` | 图片上传（Local/S3 双后端） | `image-storage.factory.ts` |
| `search` | 全文搜索（PostgreSQL tsvector） | `search.service.ts` |
| `settings` | 用户/工作空间设置合并 | `settings.service.ts` |
| `runtime-config` | 运行时配置中心（热更新） | `runtime-config.service.ts` |
| `security` | 安全审计日志 | `audit.service.ts` |
| `workspaces` | 工作空间 + 成员权限 | `workspaces.service.ts` |
| `tags` | 标签管理 | `tags.service.ts` |
| `comments` | 评论 | `comments.service.ts` |
| `favorites` | 收藏 | `favorites.service.ts` |
| `reactions` | 表情回应 | `reactions.service.ts` |
| `activities` | 活动日志 | `activities.service.ts` |
| `assets` | 资产管理 | `assets.service.ts` |
| `guestbook` | 留言板 + 敏感词过滤 | `guestbook.service.ts` |

### 关键概念速查

| 概念 | 文件 | 说明 |
|------|------|------|
| **Block** | `entities/block.entity.ts` | 内容基本单元，有 blockId + sortKey |
| **BlockVersion** | `entities/block-version.entity.ts` | 块的不可变版本 |
| **Document** | `entities/document.entity.ts` | 文档容器，归属工作空间 |
| **DocSnapshot** | `entities/doc-snapshot.entity.ts` | 文档发布态快照 |
| **DocDraft** | `entities/doc-draft.entity.ts` | 草稿工作副本 |
| **BlockRenderCache** | `entities/block-render-cache.entity.ts` | 块级 HTML 缓存 |
| **sortKey** | `utils/sort-key.util.ts` | fractional indexing 排序键 |
| **GcCandidatePool** | `entities/gc-candidate-pool.entity.ts` | GC 候选池 |
| **GcRun** | `entities/gc-run.entity.ts` | GC 执行记录 |
| **RuntimeConfig** | `entities/runtime-config.entity.ts` | 运行时配置项 |
| **SettingsProfile** | `entities/settings-profile.entity.ts` | 设置配置文件 |

### 公共层速查

| 功能 | 文件 | 说明 |
|------|------|------|
| `@CurrentUser()` | `common/decorators/current-user.decorator.ts` | 获取当前用户 |
| `@Public()` | `common/decorators/public.decorator.ts` | 跳过认证 |
| `@Roles()` | `common/decorators/roles.decorator.ts` | 角色权限 |
| `@AuditLog()` | `common/decorators/audit-log.decorator.ts` | 审计日志 |
| `JwtAuthGuard` | `common/guards/jwt-auth.guard.ts` | JWT 认证守卫 |
| `RolesGuard` | `common/guards/roles.guard.ts` | 角色守卫 |
| `TransformInterceptor` | `common/interceptors/transform.interceptor.ts` | 响应格式化 |
| `HttpExceptionFilter` | `common/filters/http-exception.filter.ts` | 异常过滤 |
| `ValidationPipe` | `common/pipes/validation.pipe.ts` | DTO 验证 |
| `BusinessException` | `common/exceptions/business.exception.ts` | 业务异常 |
| `ErrorCodes` | `common/errors/error-codes.ts` | 错误码常量 |

## 常见开发任务指引

| 要改什么 | 看哪里 |
|---------|--------|
| 用户认证 | `modules/auth/` |
| 管理后台认证 | `modules/admin-auth/` |
| 文档 CRUD | `modules/documents/documents.service.ts` |
| 文档版本控制 | `modules/documents/services/version-control.service.ts` |
| 文档导出 | `modules/documents/services/document-export.service.ts` |
| 文档渲染 | `modules/documents/services/document-render.service.ts` |
| 文档草稿 | `modules/documents/services/document-draft.service.ts` |
| 文档快照 | `modules/documents/services/document-snapshot.service.ts` |
| 块级编辑 | `modules/blocks/blocks.service.ts` |
| 块排序 | `common/utils/sort-key.util.ts` |
| GC 策略 | `modules/gc/gc-policy.service.ts` |
| GC 清扫 | `modules/gc/gc-sweep.service.ts` |
| GC 候选池 | `modules/gc/block-version-gc.collector.ts` |
| 图片上传 | `modules/images/image-storage.factory.ts` |
| S3 存储 | `modules/images/s3-image-storage.service.ts` |
| 全文搜索 | `modules/search/search.service.ts` |
| 设置合并 | `modules/settings/settings.service.ts` |
| 运行时配置 | `modules/runtime-config/runtime-config.service.ts` |
| 数据库迁移 | `src/database/migrations/` |
| 环境配置 | `.env.example` |
| API 文档 | `docs/website/` |

## 数据库迁移

```bash
# 生成迁移
pnpm typeorm:migration:generate -- -n MigrationName

# 运行迁移
pnpm typeorm:migration:run

# 回滚
pnpm typeorm:migration:revert
```

迁移文件命名规范：`{timestamp}-{Description}.ts`

实体改动必须有对应迁移。不要用 `synchronize: true` 在生产环境。

## 知识图谱集成

项目集成了 graphify 知识图谱，**新 Agent 应优先查图谱再读代码**。

```bash
# 查图谱（代替盲目翻代码）
/graphify query "GC 管线怎么工作"
/graphify path "DocumentsService" "GcSweepService"
/graphify explain "BlockVersionGcCollector"

# 增量更新（代码改了之后）
/graphify --update
```

图谱输出在 `graphify-out/`：
- `graph.html` — 交互式可视化
- `graph.json` — 结构化数据
- `GRAPH_REPORT.md` — 审计报告

**为什么用图谱：** 353 个文件 → 1,663 节点 / 3,830 边 / 105 社区，12x token 压缩。Agent 查图谱 3000 token 搞定的事，读源码要 22 万 token。

## 文档索引

| 文档 | 位置 | 内容 |
|------|------|------|
| API 设计 | `docs/API_DESIGN.md` | 接口设计详情 |
| API 使用 | `docs/API_USAGE.md` | API 使用指南 |
| 批量块 API | `docs/BATCH_BLOCKS_API.md` | 批量同步协议 |
| 文档工作流 | `docs/DOCUMENT_WORKFLOW.md` | 编辑→发布流程 |
| 版本控制 | `docs/VERSION_CONTROL_API.md` | 版本控制 API |
| 版本结构 | `docs/VERSION_STRUCTURE.md` | 三层版本模型 |
| 安全设计 | `docs/SECURITY.md` | 认证与权限 |
| 安全设计 | `docs/SAFE_DESIGN.md` | RBAC 详细设计 |
| 安装指南 | `docs/INSTALL.md` | 环境配置 |
| 设置指南 | `docs/SETUP.md` | 数据库初始化 |
| GC 使用 | `docs/2026-05-29-gc-backend-usage-guide.md` | GC 后端使用 |
| GC 调试 | `docs/2026-05-31-gc-debug-page-frontend-guide.md` | GC 前端调试 |
| 设计文档 | `docs/superpowers/specs/` | 各功能设计 spec |
| 回顾文档 | `docs/retrospectives/` | 实施回顾 |
| 计划文档 | `docs/superpowers/plans/` | 功能计划 |
| 知识图谱 | `graphify-out/GRAPH_REPORT.md` | 代码库全局视图 |

## 记住

**你是在解决问题，不是在写代码。**

改完代码后问自己：
- 这些改动都必要吗？
- 有没有更简单的方法？
- 会不会影响其他功能？

如果不确定，先问。
