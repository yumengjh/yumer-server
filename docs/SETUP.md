# 个人知识库系统 - 后端设置指南

基于 NestJS + PostgreSQL 的个人知识库系统后端。

## 📋 目录

- [系统要求](#系统要求)
- [快速开始](#快速开始)
- [详细安装步骤](#详细安装步骤)
- [配置说明](#配置说明)
- [开发指南](#开发指南)
- [部署指南](#部署指南)
- [故障排查](#故障排查)

## 🔧 系统要求

### 必需

- **Node.js** >= 18.x
- **PostgreSQL** >= 15.x
- **Redis** >= 7.x (可选，用于缓存和队列)
- **npm** 或 **pnpm** 或 **yarn**

### 推荐配置

- 内存: 4GB+
- 磁盘空间: 10GB+
- 操作系统: Windows 10+, macOS 12+, Ubuntu 20.04+

## 🚀 快速开始

### 1. 克隆项目

```bash
cd doc-back/app
```

### 2. 安装依赖

```bash
npm install
# 或
pnpm install
# 或
yarn install
```

### 3. 配置环境变量

```bash
# 复制环境变量示例文件
cp .env.example .env

# 编辑 .env 文件，配置数据库等信息
# 至少需要配置:
# - DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_DATABASE
# - JWT_SECRET, REFRESH_TOKEN_SECRET
```

### 4. 设置数据库

#### 方式一：使用自动化脚本（推荐）

**Linux/macOS:**

```bash
chmod +x scripts/setup-database.sh
./scripts/setup-database.sh
```

**Windows:**

```cmd
scripts\setup-database.bat
```

#### 方式二：手动执行 SQL

```bash
# 创建数据库
psql -U postgres -c "CREATE DATABASE knowledge_base;"

# 执行表结构
psql -U postgres -d knowledge_base -f database/schema.sql

# (可选) 插入测试数据
psql -U postgres -d knowledge_base -f database/seed.sql
```

### 5. 启动应用

```bash
# 开发模式
npm run start:dev

# 生产模式
npm run build
npm run start:prod
```

### 6. 验证安装

访问以下地址验证安装：

- API 服务: http://localhost:3000
- Swagger 文档: http://localhost:3000/api/docs
- 健康检查: http://localhost:3000/health

## 📝 详细安装步骤

### 步骤 1: 安装 PostgreSQL

#### macOS

```bash
# 使用 Homebrew
brew install postgresql@15

# 启动服务
brew services start postgresql@15

# 验证安装
psql --version
```

#### Ubuntu/Debian

```bash
# 添加 PostgreSQL 仓库
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -

# 安装
sudo apt-get update
sudo apt-get install postgresql-15

# 启动服务
sudo systemctl start postgresql
sudo systemctl enable postgresql

# 验证安装
psql --version
```

#### Windows

1. 下载安装包: https://www.postgresql.org/download/windows/
2. 运行安装程序
3. 记住设置的密码
4. 验证安装: 打开 pgAdmin 或在命令行运行 `psql --version`

### 步骤 2: 安装 Redis (可选但推荐)

#### macOS

```bash
brew install redis
brew services start redis
```

#### Ubuntu/Debian

```bash
sudo apt-get install redis-server
sudo systemctl start redis
sudo systemctl enable redis
```

#### Windows

1. 下载 Redis for Windows: https://github.com/microsoftarchive/redis/releases
2. 解压并运行 `redis-server.exe`

或使用 Docker:

```bash
docker run -d -p 6379:6379 redis:7-alpine
```

### 步骤 3: 配置数据库

#### 创建数据库用户（可选）

```sql
-- 连接到 PostgreSQL
psql -U postgres

-- 创建用户
CREATE USER kb_user WITH PASSWORD 'your_secure_password';

-- 创建数据库
CREATE DATABASE knowledge_base OWNER kb_user;

-- 授予权限
GRANT ALL PRIVILEGES ON DATABASE knowledge_base TO kb_user;

-- 退出
\q
```

#### 执行数据库脚本

```bash
# 执行表结构
psql -U postgres -d knowledge_base -f database/schema.sql

# 验证表创建
psql -U postgres -d knowledge_base -c "\dt"
```

## ⚙️ 配置说明

### 环境变量配置

所有配置都在 `.env` 文件中，主要配置项：

#### 应用配置

```env
NODE_ENV=development          # 环境: development, production, test
PORT=3000                     # 应用端口
CORS_ORIGIN=http://localhost:3000  # 允许的跨域源
```

#### 数据库配置

```env
DB_HOST=localhost             # 数据库主机
DB_PORT=5432                  # 数据库端口
DB_USERNAME=postgres          # 数据库用户名
DB_PASSWORD=postgres          # 数据库密码
DB_DATABASE=knowledge_base    # 数据库名称
DB_SYNCHRONIZE=true           # 是否自动同步表结构（生产环境必须为false）
```

#### JWT 配置

```env
JWT_SECRET=your-secret-key-min-32-chars     # JWT 密钥（必须修改）
JWT_EXPIRES_IN=24h                          # JWT 过期时间
REFRESH_TOKEN_SECRET=your-refresh-secret    # Refresh Token 密钥（必须修改）
REFRESH_TOKEN_EXPIRES_IN=7d                 # Refresh Token 过期时间
```

⚠️ **安全警告**: 生产环境必须使用强密钥！

生成安全密钥：

```bash
# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# OpenSSL
openssl rand -hex 32
```

#### 文件存储配置

```env
STORAGE_PROVIDER=local        # 存储方式: local, s3, oss, cos
STORAGE_LOCAL_PATH=./uploads  # 本地存储路径
MAX_FILE_SIZE=10485760        # 最大文件大小（字节）
```

### 数据库配置文件

如果使用 TypeORM CLI，可以创建 `ormconfig.json`:

```json
{
  "type": "postgres",
  "host": "localhost",
  "port": 5432,
  "username": "postgres",
  "password": "postgres",
  "database": "knowledge_base",
  "entities": ["dist/**/*.entity.js"],
  "migrations": ["dist/database/migrations/*.js"],
  "cli": {
    "migrationsDir": "src/database/migrations"
  }
}
```

## 👨‍💻 开发指南

### 项目结构

```
app/
├── src/
│   ├── main.ts                 # 应用入口
│   ├── app.module.ts           # 根模块
│   ├── common/                 # 公共模块
│   │   ├── decorators/         # 装饰器
│   │   ├── filters/            # 过滤器
│   │   ├── guards/             # 守卫
│   │   ├── interceptors/       # 拦截器
│   │   └── pipes/              # 管道
│   ├── config/                 # 配置
│   ├── entities/               # 数据库实体
│   ├── modules/                # 功能模块
│   │   ├── auth/               # 认证模块
│   │   ├── users/              # 用户模块
│   │   ├── workspaces/         # 工作空间模块
│   │   ├── documents/          # 文档模块
│   │   └── ...
│   └── engine/                 # 文档引擎
├── database/                   # 数据库脚本
│   ├── schema.sql              # 表结构
│   ├── seed.sql                # 测试数据
│   └── migrations/             # 迁移文件
├── scripts/                    # 工具脚本
├── test/                       # 测试文件
├── .env                        # 环境变量
├── .env.example                # 环境变量示例
└── package.json                # 项目配置
```

### 常用命令

```bash
# 开发
npm run start:dev              # 启动开发服务器（热重载）
npm run start:debug            # 启动调试模式

# 构建
npm run build                  # 构建生产版本
npm run start:prod             # 运行生产版本

# 测试
npm run test                   # 运行单元测试
npm run test:watch             # 监听模式运行测试
npm run test:cov               # 生成测试覆盖率报告
npm run test:e2e               # 运行端到端测试

# 代码质量
npm run lint                   # 代码检查
npm run format                 # 代码格式化

# TypeORM
npm run typeorm migration:generate -- -n MigrationName  # 生成迁移
npm run typeorm migration:run                           # 运行迁移
npm run typeorm migration:revert                        # 回滚迁移
```

### 创建新模块

```bash
# 使用 NestJS CLI
nest generate module modules/feature-name
nest generate controller modules/feature-name
nest generate service modules/feature-name
nest generate entity entities/entity-name

# 简写
nest g mo modules/feature-name
nest g co modules/feature-name
nest g s modules/feature-name
```

### 数据库迁移

```bash
# 生成迁移文件
npm run typeorm migration:generate -- -n CreateUsersTable

# 运行迁移
npm run typeorm migration:run

# 回滚迁移
npm run typeorm migration:revert
```

### API 文档

开发模式下访问 Swagger 文档：

http://localhost:3000/api/docs

## 🚢 部署指南

### Docker 部署

#### 1. 构建镜像

```bash
docker build -t knowledge-base-api .
```

#### 2. 使用 Docker Compose

```bash
# 启动所有服务
docker-compose up -d

# 查看日志
docker-compose logs -f api

# 停止服务
docker-compose down

# 重启服务
docker-compose restart api
```

### 生产环境部署清单

- [ ] 修改所有默认密钥和密码
- [ ] 设置 `NODE_ENV=production`
- [ ] 设置 `DB_SYNCHRONIZE=false`
- [ ] 配置 SSL/TLS
- [ ] 设置防火墙规则
- [ ] 配置反向代理（Nginx）
- [ ] 启用日志收集
- [ ] 配置监控（Prometheus/Grafana）
- [ ] 设置自动备份
- [ ] 配置 CDN（如果使用）
- [ ] 压力测试
- [ ] 安全审计

### Nginx 反向代理配置

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### PM2 进程管理

```bash
# 安装 PM2
npm install -g pm2

# 启动应用
pm2 start dist/main.js --name knowledge-base-api

# 查看状态
pm2 status

# 查看日志
pm2 logs knowledge-base-api

# 重启
pm2 restart knowledge-base-api

# 停止
pm2 stop knowledge-base-api

# 开机自启
pm2 startup
pm2 save
```

## 🔍 故障排查

### 数据库连接失败

**问题**: `Error: connect ECONNREFUSED 127.0.0.1:5432`

**解决方案**:

1. 检查 PostgreSQL 是否运行: `pg_isready`
2. 检查连接配置是否正确
3. 检查防火墙设置
4. 查看 PostgreSQL 日志

### 端口被占用

**问题**: `Error: listen EADDRINUSE: address already in use :::3000`

**解决方案**:

```bash
# 查找占用端口的进程
# Linux/macOS
lsof -i :3000

# Windows
netstat -ano | findstr :3000

# 终止进程或更改端口
```

### JWT Token 验证失败

**问题**: `401 Unauthorized`

**解决方案**:

1. 检查 JWT_SECRET 配置
2. 确认 token 未过期
3. 检查 token 格式: `Bearer <token>`

### TypeORM 同步失败

**问题**: 表结构未自动创建

**解决方案**:

1. 确认 `DB_SYNCHRONIZE=true` (仅开发环境)
2. 手动执行 `schema.sql`
3. 使用迁移管理表结构

### 内存溢出

**问题**: `JavaScript heap out of memory`

**解决方案**:

```bash
# 增加 Node.js 内存限制
NODE_OPTIONS=--max_old_space_size=4096 npm run start
```

## 📚 相关资源

- [NestJS 官方文档](https://docs.nestjs.com/)
- [PostgreSQL 文档](https://www.postgresql.org/docs/)
- [TypeORM 文档](https://typeorm.io/)
- [API 设计文档](./API_DESIGN.md)
- [数据库文档](./database/README.md)

## 🆘 获取帮助

- 查看项目 Issues
- 阅读完整的 API_DESIGN.md
- 查看 Swagger API 文档

## 📄 许可证

MIT License

---

开始构建你的知识库系统吧！ 🚀
