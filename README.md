# 个人知识库系统 - 后端 API

一个基于 NestJS 构建的现代化知识库管理系统后端，提供工作空间、文档、块等核心功能的 RESTful API。

## 📋 项目简介

本项目是一个个人知识库系统的后端服务，采用模块化设计，支持多工作空间、文档树结构管理、块级版本控制等核心功能。系统使用 TypeScript 编写，提供类型安全的 API 接口。

### 核心特性

- ✅ **用户认证** - JWT Token 认证，支持刷新令牌机制
- ✅ **工作空间管理** - 多工作空间支持，成员权限管理
- ✅ **文档管理** - 文档树结构，支持父子关系、标签分类
- ✅ **块级编辑** - 块（Block）作为文档内容的基础单元
- ✅ **版本控制** - 块版本历史，文档版本管理
- ✅ **全文搜索** - 基于 PostgreSQL tsvector 的全文搜索
- ✅ **权限控制** - 细粒度的权限管理（owner、admin、editor、viewer）
- ✅ **API 文档** - 集成 Swagger/OpenAPI 自动生成 API 文档

## 🚀 技术栈

### 核心框架

- **NestJS 11.x** - 企业级 Node.js 框架
- **TypeScript 5.x** - 类型安全的 JavaScript
- **SWC** - 快速编译工具（替代 tsc）

### 数据库

- **PostgreSQL** - 关系型数据库
- **TypeORM 0.3.x** - ORM 框架

### 认证与安全

- **Passport.js** - 认证中间件
- **JWT** - JSON Web Token 认证
- **bcryptjs** - 密码加密

### 工具库

- **class-validator** - DTO 验证
- **class-transformer** - 数据转换
- **Swagger/OpenAPI** - API 文档生成

## 📦 项目结构

```
app/
├── src/
│   ├── common/              # 公共模块
│   │   ├── decorators/      # 装饰器（@CurrentUser 等）
│   │   ├── guards/          # 守卫（JWT 认证等）
│   │   ├── interceptors/    # 拦截器（响应格式化）
│   │   ├── filters/         # 过滤器（异常处理）
│   │   ├── dto/             # 公共 DTO
│   │   └── utils/           # 工具类
│   ├── config/              # 配置模块
│   ├── entities/            # 数据库实体（14个）
│   ├── modules/             # 业务模块
│   │   ├── auth/            # 认证模块
│   │   ├── workspaces/      # 工作空间模块
│   │   ├── documents/       # 文档模块
│   │   └── blocks/          # 块模块
│   ├── app.module.ts        # 主模块
│   └── main.ts              # 应用入口
├── docs/                    # 项目文档
│   ├── API_DESIGN.md        # API 设计文档
│   ├── CURRENT_PROGRESS.md  # 当前进度
│   └── SETUP.md             # 设置文档
└── package.json
```

## 🛠️ 快速开始

### 环境要求

- Node.js >= 18.x
- PostgreSQL >= 15
- pnpm >= 8.x（推荐）或 npm/yarn

### 安装依赖

```bash
pnpm install
```

### 环境配置

创建 `.env` 文件（参考 `.env.example`）：

```env
# 应用配置
APP_PORT=5200
APP_API_PREFIX=api/v1
APP_CORS_ORIGIN=http://localhost:3000

# 数据库配置
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your_password
DB_DATABASE=doc_back

# JWT 配置
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your_refresh_secret_key
JWT_REFRESH_EXPIRES_IN=30d
```

### 运行项目

```bash
# 开发模式（支持热重载）
pnpm run start:dev

# 生产模式
pnpm run build
pnpm run start:prod
```

启动成功后：

- API 服务：http://localhost:5200
- Swagger 文档：http://localhost:5200/api/docs

## 📚 API 文档

### Swagger UI

启动项目后，访问 http://localhost:5200/api/docs 查看完整的 API 文档。

### API 前缀

所有 API 接口使用统一前缀：`/api/v1`

### 主要接口

#### 认证模块

- `POST /api/v1/auth/register` - 用户注册
- `POST /api/v1/auth/login` - 用户登录
- `POST /api/v1/auth/refresh` - 刷新令牌
- `POST /api/v1/auth/logout` - 用户登出
- `GET /api/v1/auth/me` - 获取当前用户信息

#### 工作空间模块

- `POST /api/v1/workspaces` - 创建工作空间
- `GET /api/v1/workspaces` - 获取工作空间列表
- `GET /api/v1/workspaces/:workspaceId` - 获取工作空间详情
- `PATCH /api/v1/workspaces/:workspaceId` - 更新工作空间
- `DELETE /api/v1/workspaces/:workspaceId` - 删除工作空间
- `POST /api/v1/workspaces/:workspaceId/members` - 邀请成员
- `GET /api/v1/workspaces/:workspaceId/members` - 获取成员列表
- `PATCH /api/v1/workspaces/:workspaceId/members/:userId` - 更新成员角色
- `DELETE /api/v1/workspaces/:workspaceId/members/:userId` - 移除成员

#### 文档模块

- `POST /api/v1/documents` - 创建文档
- `GET /api/v1/documents` - 获取文档列表
- `GET /api/v1/documents/:docId` - 获取文档详情
- `GET /api/v1/documents/:docId/content` - 获取文档内容
- `PATCH /api/v1/documents/:docId` - 更新文档
- `POST /api/v1/documents/:docId/publish` - 发布文档
- `POST /api/v1/documents/:docId/move` - 移动文档
- `DELETE /api/v1/documents/:docId` - 删除文档
- `GET /api/v1/documents/search` - 搜索文档

#### 块模块

- `POST /api/v1/blocks` - 创建块
- `PATCH /api/v1/blocks/:blockId/content` - 更新块内容
- `POST /api/v1/blocks/:blockId/move` - 移动块
- `DELETE /api/v1/blocks/:blockId` - 删除块
- `GET /api/v1/blocks/:blockId/versions` - 获取块版本历史
- `POST /api/v1/blocks/batch` - 批量操作块

## 🔧 开发说明

### 编译配置

项目使用 **SWC** 进行快速编译，配置文件：`.swcrc`

- 编译速度比 tsc 快 10-20 倍
- 支持 TypeScript 装饰器和元数据
- 已解决循环依赖问题

### 代码规范

```bash
# 代码格式化
pnpm run format

# 代码检查
pnpm run lint
```

### 数据库迁移

```bash
# 生成迁移文件
pnpm run typeorm:migration:generate -- -n MigrationName

# 运行迁移
pnpm run typeorm:migration:run

# 回滚迁移
pnpm run typeorm:migration:revert
```

### 测试

```bash
# 单元测试
pnpm run test

# 测试覆盖率
pnpm run test:cov

# E2E 测试
pnpm run test:e2e
```

## 📊 项目进度

当前完成度：**50%**

### ✅ 已完成

- 基础架构和配置
- 认证模块（JWT、刷新令牌）
- 工作空间模块（CRUD、成员管理）
- 文档模块（CRUD、搜索、版本控制）
- 块模块（CRUD、版本控制、批量操作）

### 🚧 进行中

- 版本控制模块（文档修订历史）
- 资产模块（文件上传）

### 📝 待开发

- 标签模块
- 收藏模块
- 评论模块
- 活动日志模块

详细进度请查看：[CURRENT_PROGRESS.md](./docs/CURRENT_PROGRESS.md)

## 📖 相关文档

- [API 设计文档](./docs/API_DESIGN.md) - 详细的 API 接口设计
- [当前进度](./docs/CURRENT_PROGRESS.md) - 功能实现进度
- [设置文档](./docs/SETUP.md) - 环境配置说明

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

本项目采用 MIT 许可证。

---

**注意**：本项目仍在积极开发中，API 可能会有变更。建议在生产环境使用前仔细测试。
