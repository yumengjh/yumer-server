# Yumer Server — 个人知识库后端

基于 NestJS 11 的个人知识库系统后端服务，提供文档、块级编辑、版本控制、垃圾回收等核心能力。

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | NestJS 11.x + Express |
| 语言 | TypeScript 5.x + SWC |
| 数据库 | PostgreSQL（主）/ SQLite（开发） |
| ORM | TypeORM 0.3.x |
| 认证 | Passport.js + JWT（双令牌） |
| 存储 | Local / S3 / OSS / COS |
| 文档 | Swagger/OpenAPI + VitePress |

## 快速开始

### 环境要求

- Node.js >= 18
- PostgreSQL >= 15（或 SQLite 用于开发）
- pnpm >= 8

### 安装

```bash
pnpm install
```

### 配置

```bash
cp .env.example .env
# 编辑 .env，至少配置数据库和 JWT 密钥
```

关键配置项：

```env
PORT=5200
DB_TYPE=postgres          # 或 sqlite
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_DATABASE=yumer
JWT_SECRET=your_jwt_secret
JWT_EXPIRES_IN=7d
REFRESH_TOKEN_SECRET=your_refresh_secret
REFRESH_TOKEN_EXPIRES_IN=30d
```

完整配置参考 `.env.example`（294 行）。

### 运行

```bash
# 开发模式（热重载）
pnpm dev

# 生产构建
pnpm build
pnpm start:prod
```

启动后：

- API: http://localhost:5200/api/v1
- Swagger: http://localhost:5200/api/v1/docs

## 项目结构

```
src/
├── common/                    # 公共层
│   ├── decorators/            # @CurrentUser @AuditLog @Roles @Public
│   ├── guards/                # JWT 守卫、角色守卫
│   ├── interceptors/          # 响应格式化
│   ├── filters/               # 异常过滤
│   ├── dto/                   # 通用 DTO
│   ├── errors/                # 错误码
│   ├── exceptions/            # 业务异常
│   ├── pipes/                 # 验证管道
│   └── utils/                 # 工具函数
├── config/                    # 配置模块
│   ├── app.config.ts
│   ├── database.config.ts
│   ├── jwt.config.ts
│   └── runtime.config.ts
├── entities/                  # TypeORM 实体（28 个）
├── database/migrations/       # 数据库迁移
├── modules/                   # 业务模块（18 个）
│   ├── auth/                  # 用户认证
│   ├── admin-auth/            # 管理员认证（独立 JWT）
│   ├── workspaces/            # 工作空间管理
│   ├── documents/             # 文档 CRUD + 版本控制
│   │   └── services/          # 子服务：导出、快照、草稿、渲染、版本控制
│   ├── blocks/                # 块级编辑 + 批量同步
│   ├── gc/                    # 垃圾回收（5 阶段管线）
│   ├── images/                # 图片上传（Local/S3）
│   ├── search/                # 全文搜索
│   ├── tags/                  # 标签管理
│   ├── comments/              # 评论
│   ├── favorites/             # 收藏
│   ├── reactions/             # 表情回应
│   ├── activities/            # 活动日志
│   ├── assets/                # 资产管理
│   ├── guestbook/             # 留言板 + 敏感词过滤
│   ├── settings/              # 用户/工作空间设置
│   ├── runtime-config/        # 运行时配置中心
│   └── security/              # 安全审计日志
├── app.module.ts              # 根模块
└── main.ts                    # 启动入口
```

## 核心架构

### 三层版本控制

```
Document → Block → BlockVersion
```

- **Document**: 文档容器，归属工作空间
- **Block**: 内容基本单元，使用 fractional indexing 排序
- **BlockVersion**: 块的不可变版本，支持时间旅行回溯

### 垃圾回收（GC）

5 阶段管线，清理孤立数据：

1. **Phase 0** — 候选池构建（candidate pool 状态机）
2. **Phase 1** — 草稿墓碑清扫
3. **Phase 2** — 修订快照清扫
4. **Phase 3** — 根条目粒度裁剪
5. **Phase 4** — 块版本物理删除

### 文档草稿模型

三层数据模型实现编辑态与发布态分离：

- `block_versions` — 块版本数据
- `doc_snapshots` — 文档快照
- `document_drafts` — 草稿工作副本

### 渲染管线

发布态内容通过统一渲染出口生成 HTML：

- 块级 HTML 懒缓存（`BlockRenderCache`）
- 渲染版本控制（规则变更时自动失效）
- 支持 Markdown / HTML Zip / PDF 导出

## API 概览

所有接口前缀：`/api/v1`

| 模块 | 主要端点 |
|------|---------|
| 认证 | `POST /auth/login` `POST /auth/register` `POST /auth/refresh` |
| 工作空间 | `CRUD /workspaces` + 成员管理 |
| 文档 | `CRUD /documents` + `GET /documents/:id/content` + 版本操作 |
| 块 | `POST /blocks/batch` + `PATCH /blocks/:id/content` + 移动/删除 |
| 搜索 | `GET /search` 全文搜索 |
| 图片 | `POST /images/upload` + 公开访问 |
| 设置 | `GET/PUT /settings` 用户与工作空间设置 |
| GC | 管理端 GC 预览、清扫、存储维护 |

完整 API 文档启动后访问 Swagger UI。

## 开发命令

```bash
pnpm dev                    # 开发模式
pnpm build                  # 生产构建
pnpm test                   # 单元测试
pnpm test:cov               # 测试覆盖率
pnpm test:e2e               # E2E 测试
pnpm lint                   # 代码检查
pnpm format                 # 代码格式化

# 数据库迁移
pnpm typeorm:migration:generate -- -n MigrationName
pnpm typeorm:migration:run
pnpm typeorm:migration:revert

# 文档站
pnpm docs:dev               # 开发预览
pnpm docs:build             # 构建文档站

# 工具脚本
pnpm openapi:export         # 导出 OpenAPI spec
pnpm snapshots:backfill     # 回填文档快照
pnpm batch-insert-blocks    # 批量插入测试块
```

## 文档

| 文档 | 内容 |
|------|------|
| [docs/API_DESIGN.md](docs/API_DESIGN.md) | API 接口设计 |
| [docs/DOCUMENT_WORKFLOW.md](docs/DOCUMENT_WORKFLOW.md) | 文档工作流 |
| [docs/VERSION_CONTROL_API.md](docs/VERSION_CONTROL_API.md) | 版本控制 API |
| [docs/SECURITY.md](docs/SECURITY.md) | 安全设计 |
| [docs/INSTALL.md](docs/INSTALL.md) | 安装指南 |
| [docs/website/](docs/website/) | VitePress 文档站源码 |
| [graphify-out/GRAPH_REPORT.md](graphify-out/GRAPH_REPORT.md) | 知识图谱报告 |

## 许可证

MIT
