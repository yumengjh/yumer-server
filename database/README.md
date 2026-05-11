# 数据库配置和初始化

本目录包含了个人知识库系统的数据库架构和初始化脚本。

## 📁 文件说明

- **schema.sql** - 完整的数据库表结构定义
- **init.sql** - 数据库初始化脚本
- **seed.sql** - 测试种子数据
- **README.md** - 本文档

## 🚀 快速开始

### 1. 安装 PostgreSQL

确保已安装 PostgreSQL 15 或更高版本：

```bash
# macOS
brew install postgresql@15

# Ubuntu/Debian
sudo apt-get install postgresql-15

# Windows
# 从官网下载安装包: https://www.postgresql.org/download/
```

### 2. 启动 PostgreSQL 服务

```bash
# macOS
brew services start postgresql@15

# Ubuntu/Debian
sudo systemctl start postgresql

# Windows
# 服务会自动启动，或通过服务管理器启动
```

### 3. 创建数据库

#### 方式一：使用 psql 命令行

```bash
# 连接到 PostgreSQL
psql -U postgres

# 创建数据库
CREATE DATABASE knowledge_base;

# 连接到数据库
\c knowledge_base;

# 启用扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

# 退出
\q
```

#### 方式二：使用初始化脚本

```bash
psql -U postgres -f database/init.sql
```

### 4. 创建表结构

```bash
# 执行 schema.sql
psql -U postgres -d knowledge_base -f database/schema.sql
```

### 5. 插入测试数据（可选）

⚠️ **警告：此操作会清空现有数据！仅用于开发环境！**

```bash
# 执行 seed.sql
psql -U postgres -d knowledge_base -f database/seed.sql
```

### 6. 配置环境变量

复制 `.env.example` 为 `.env` 并修改数据库配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your-password
DB_DATABASE=knowledge_base
```

## 🐳 使用 Docker

### 使用 docker-compose 快速启动

```bash
# 启动所有服务（PostgreSQL + Redis + API）
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down

# 停止并删除所有数据
docker-compose down -v
```

### 仅启动数据库服务

```yaml
# docker-compose-db.yml
version: "3.8"

services:
  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: knowledge_base
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/schema.sql:/docker-entrypoint-initdb.d/01-schema.sql
      - ./database/seed.sql:/docker-entrypoint-initdb.d/02-seed.sql

volumes:
  postgres_data:
```

```bash
docker-compose -f docker-compose-db.yml up -d
```

## 📊 数据库结构概览

### 核心表

| 表名                | 说明           | 主要字段                                |
| ------------------- | -------------- | --------------------------------------- |
| `users`             | 用户表         | user_id, username, email, password_hash |
| `workspaces`        | 工作空间表     | workspace_id, name, owner_id            |
| `workspace_members` | 工作空间成员表 | workspace_id, user_id, role             |
| `documents`         | 文档表         | doc_id, workspace_id, title, head       |
| `blocks`            | 块身份表       | block_id, doc_id, type, latest_ver      |
| `block_versions`    | 块版本表       | version_id, block_id, ver, payload      |
| `doc_revisions`     | 文档修订表     | revision_id, doc_id, doc_ver, patches   |
| `doc_snapshots`     | 文档快照表     | snapshot_id, doc_id, block_version_map  |

### 辅助表

| 表名         | 说明       |
| ------------ | ---------- |
| `assets`     | 资产文件表 |
| `tags`       | 标签表     |
| `favorites`  | 收藏表     |
| `comments`   | 评论表     |
| `activities` | 活动日志表 |
| `sessions`   | 会话表     |

## 🔍 常用 SQL 查询

### 查看所有表

```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public';
```

### 查看表结构

```sql
\d+ users
```

### 查看表数据量

```sql
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
    pg_total_relation_size(schemaname||'.'||tablename) AS size_bytes
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### 查看索引

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'documents';
```

### 全文搜索示例

```sql
-- 搜索文档标题
SELECT doc_id, title, ts_rank(search_vector, query) AS rank
FROM documents, plainto_tsquery('english', 'javascript') query
WHERE search_vector @@ query
ORDER BY rank DESC;

-- 搜索块内容
SELECT block_id, plain_text, ts_rank(search_vector, query) AS rank
FROM block_versions, plainto_tsquery('english', 'nestjs') query
WHERE search_vector @@ query
ORDER BY rank DESC
LIMIT 10;
```

### 查看文档统计

```sql
SELECT * FROM document_statistics
ORDER BY updated_at DESC
LIMIT 10;
```

## 🔧 维护操作

### 备份数据库

```bash
# 备份整个数据库
pg_dump -U postgres knowledge_base > backup.sql

# 仅备份数据（不含表结构）
pg_dump -U postgres --data-only knowledge_base > data_backup.sql

# 仅备份表结构
pg_dump -U postgres --schema-only knowledge_base > schema_backup.sql
```

### 恢复数据库

```bash
# 恢复完整备份
psql -U postgres knowledge_base < backup.sql

# 恢复数据
psql -U postgres knowledge_base < data_backup.sql
```

### 清理过期会话

```sql
-- 手动清理
DELETE FROM sessions WHERE expires_at < NOW();

-- 或使用函数
SELECT cleanup_expired_sessions();
```

### 重建索引

```sql
-- 重建全文搜索索引
REINDEX INDEX idx_documents_search_vector;
REINDEX INDEX idx_block_versions_search_vector;

-- 重建所有索引
REINDEX DATABASE knowledge_base;
```

### 分析和优化

```sql
-- 更新统计信息
ANALYZE;

-- 分析特定表
ANALYZE documents;

-- 清理和优化
VACUUM FULL;
```

## 📈 性能优化建议

### 1. 连接池配置

在应用程序中配置合适的连接池：

```typescript
// app.module.ts
TypeOrmModule.forRoot({
  // ...
  extra: {
    max: 20,              // 最大连接数
    min: 5,               // 最小连接数
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
}),
```

### 2. 索引优化

根据查询模式创建合适的索引：

```sql
-- 复合索引示例
CREATE INDEX idx_documents_workspace_status_updated
ON documents(workspace_id, status, updated_at DESC);

-- 部分索引（仅索引活跃文档）
CREATE INDEX idx_documents_active
ON documents(workspace_id, updated_at)
WHERE status = 'normal';
```

### 3. 查询优化

```sql
-- 使用 EXPLAIN ANALYZE 分析查询
EXPLAIN ANALYZE
SELECT * FROM documents
WHERE workspace_id = 'ws_team001'
AND status = 'normal';

-- 使用物化视图缓存复杂查询
CREATE MATERIALIZED VIEW workspace_stats AS
SELECT
    w.workspace_id,
    w.name,
    COUNT(DISTINCT d.id) AS doc_count,
    COUNT(DISTINCT wm.id) AS member_count
FROM workspaces w
LEFT JOIN documents d ON w.workspace_id = d.workspace_id
LEFT JOIN workspace_members wm ON w.workspace_id = wm.workspace_id
GROUP BY w.workspace_id, w.name;

-- 刷新物化视图
REFRESH MATERIALIZED VIEW workspace_stats;
```

### 4. 分区表（大数据量时）

```sql
-- 按时间分区活动日志表
CREATE TABLE activities_2024_01 PARTITION OF activities
FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE activities_2024_02 PARTITION OF activities
FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');
```

## 🐛 故障排查

### 连接失败

```bash
# 检查 PostgreSQL 是否运行
pg_isready -h localhost -p 5432

# 查看 PostgreSQL 日志
tail -f /usr/local/var/log/postgresql@15.log  # macOS
tail -f /var/log/postgresql/postgresql-15-main.log  # Ubuntu
```

### 权限问题

```sql
-- 授予权限
GRANT ALL PRIVILEGES ON DATABASE knowledge_base TO your_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO your_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO your_user;
```

### 查看活跃连接

```sql
SELECT * FROM pg_stat_activity
WHERE datname = 'knowledge_base';
```

### 终止连接

```sql
-- 终止特定连接
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'knowledge_base' AND pid <> pg_backend_pid();
```

## 📚 相关资源

- [PostgreSQL 官方文档](https://www.postgresql.org/docs/)
- [TypeORM 文档](https://typeorm.io/)
- [NestJS 数据库文档](https://docs.nestjs.com/techniques/database)

## ⚠️ 注意事项

1. **生产环境**：
   - 不要使用 `DB_SYNCHRONIZE=true`
   - 使用 TypeORM migrations 管理表结构变更
   - 定期备份数据库
   - 配置合适的连接池大小
   - 启用 SSL 连接

2. **安全性**：
   - 使用强密码
   - 限制数据库访问 IP
   - 定期更新 PostgreSQL 版本
   - 审计数据库访问日志

3. **性能**：
   - 定期运行 VACUUM 和 ANALYZE
   - 监控慢查询
   - 适当增加 shared_buffers 和 work_mem
   - 考虑使用读写分离

## 🤝 贡献

如果发现数据库设计问题或有优化建议，欢迎提交 Issue 或 Pull Request。
