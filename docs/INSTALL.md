# 安装指南

## 前置要求

- Node.js 18+
- PostgreSQL 15+
- npm 或 pnpm

## 安装步骤

### 1. 安装依赖

```bash
npm install
# 或
pnpm install
```

### 2. 配置环境变量

复制 `.env.example` 创建 `.env` 文件，并根据实际情况修改配置：

```bash
cp .env.example .env
```

### 3. 配置数据库

确保 PostgreSQL 已启动，并创建数据库：

```sql
CREATE DATABASE knowledge_base;
```

### 4. 运行数据库迁移（可选）

如果使用迁移文件：

```bash
npm run typeorm:migration:run
```

### 5. 启动开发服务器

```bash
npm run start:dev
```

服务器将在 `http://localhost:5200` 启动。

### 6. 访问 API 文档

启动后访问 Swagger 文档：

- http://localhost:5200/api/docs

## 已实现的功能

✅ 配置模块
✅ 公共模块（装饰器、守卫、拦截器、过滤器、DTO、工具类）
✅ 数据库实体（所有 14 个实体）
✅ 认证模块（注册、登录、刷新令牌、登出、获取当前用户）

## 下一步

根据 TODO.md 继续实现：

- 用户模块
- 工作空间模块
- 文档模块
- 块模块
- 版本控制模块
- 其他功能模块
