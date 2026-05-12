# 安装配置

## 安装依赖

```bash
pnpm install
```

或使用 npm：

```bash
npm install
```

## 环境配置

创建 `.env` 文件（参考 `.env.example`）：

```txt
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

## 数据库设置

1. 确保 PostgreSQL 服务正在运行
2. 创建数据库：

```sql
CREATE DATABASE doc_back;
```

3. 运行数据库迁移：

```bash
pnpm run typeorm:migration:run
```

## 运行项目

### 开发模式（支持热重载）

```bash
pnpm run start:dev
```

### 生产模式

```bash
# 构建项目
pnpm run build

# 运行生产版本
pnpm run start:prod
```

## 验证安装

启动成功后：

- API 服务：http://localhost:5200
- Swagger 文档：http://localhost:5200/api/v1/docs

访问 Swagger 文档页面，如果能看到 API 文档界面，说明安装成功！

## 常见问题

### 端口被占用

如果 5200 端口被占用，可以在 `.env` 文件中修改 `APP_PORT`。

### 数据库连接失败

检查：

1. PostgreSQL 服务是否运行
2. 数据库配置是否正确
3. 数据库用户是否有足够权限
