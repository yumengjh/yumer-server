# 个人知识库系统 - 后端 API 设计文档

## 目录

- [系统架构概述](#系统架构概述)
- [技术栈](#技术栈)
- [数据库设计](#数据库设计)
- [NestJS 项目结构](#nestjs-项目结构)
- [API 接口设计](#api-接口设计)
- [认证与权限](#认证与权限)
- [错误处理](#错误处理)
- [性能优化](#性能优化)
- [部署方案](#部署方案)

---

- ​

### 架构层次

```
┌─────────────────────────────────────┐
│         前端 (React + Zustand)       │
├─────────────────────────────────────┤
│      NestJS API Gateway + REST      │
├─────────────────────────────────────┤
│    Controller → Service → Repository │
├─────────────────────────────────────┤
│      TypeORM (Entity & Repository)  │
├─────────────────────────────────────┤
│         PostgreSQL 数据库            │
└─────────────────────────────────────┘
```

---

## 技术栈

### 核心技术

```typescript
// 后端框架
- NestJS 10.x (企业级 Node.js 框架)
- TypeScript 5.x (类型安全)

// 数据库
- PostgreSQL 15+ (关系型数据库)
- TypeORM 0.3.x (ORM 框架)
- Redis 7.x (缓存 + 会话 + 队列)

// 认证与安全
- Passport.js (认证中间件)
- JWT (JSON Web Token)
- bcrypt (密码加密)

// 实时通信
- Socket.IO / WebSocket

// 任务队列
- Bull (基于 Redis 的任务队列)

// 文件存储
- Multer (文件上传)
- AWS S3 / MinIO (对象存储)

// API 文档
- Swagger / OpenAPI 3.0

// 日志与监控
- Winston (日志)
- Prometheus + Grafana (监控)

// 测试
- Jest (单元测试)
- Supertest (集成测试)
```

### 为什么选择 NestJS + PostgreSQL？

**NestJS 优势：**

- 📦 模块化架构，易于维护和扩展
- 🎯 内置依赖注入，代码解耦
- 🔧 与 TypeScript 完美集成
- 🚀 丰富的生态系统和中间件
- 📚 优秀的文档和社区支持
- 🧪 易于测试

**PostgreSQL 优势：**

- 💪 强大的 JSONB 支持，适合存储块结构
- 🔒 ACID 事务保证数据一致性
- 🔍 全文搜索能力（tsvector/tsquery）
- 📊 复杂查询和聚合操作
- 🎨 丰富的数据类型（JSON、数组、枚举等）
- 🔧 成熟的生态和工具链

---

## 数据库设计

### PostgreSQL 表结构设计

#### 1. users (用户表)

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) UNIQUE NOT NULL,          -- 如 "u_abc123"
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  avatar VARCHAR(500),
  display_name VARCHAR(100),
  bio TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_login_at TIMESTAMP WITH TIME ZONE,

  status VARCHAR(20) DEFAULT 'active',           -- active, suspended, deleted
  settings JSONB DEFAULT '{}',                   -- 用户设置

  CONSTRAINT check_status CHECK (status IN ('active', 'suspended', 'deleted'))
);

-- 索引
CREATE INDEX idx_users_user_id ON users(user_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_status ON users(status);

-- TypeORM Entity 示例
@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  userId: string;

  @Column({ unique: true, length: 50 })
  username: string;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ nullable: true })
  avatar: string;

  @Column({ nullable: true, length: 100 })
  displayName: string;

  @Column({ type: 'text', nullable: true })
  bio: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  lastLoginAt: Date;

  @Column({ default: 'active' })
  status: string;

  @Column({ type: 'jsonb', default: {} })
  settings: object;

  // 关联
  @OneToMany(() => Workspace, workspace => workspace.owner)
  ownedWorkspaces: Workspace[];

  @ManyToMany(() => Workspace, workspace => workspace.members)
  workspaces: Workspace[];
}
```

#### 2. workspaces (工作空间表)

```sql
CREATE TABLE workspaces (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) UNIQUE NOT NULL,      -- 如 "ws_xyz123"
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(10),                              -- emoji 图标
  owner_id VARCHAR(50) NOT NULL,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  status VARCHAR(20) DEFAULT 'active',           -- active, archived
  settings JSONB DEFAULT '{}',

  FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT check_workspace_status CHECK (status IN ('active', 'archived'))
);

-- 索引
CREATE INDEX idx_workspaces_workspace_id ON workspaces(workspace_id);
CREATE INDEX idx_workspaces_owner_id ON workspaces(owner_id);
CREATE INDEX idx_workspaces_status ON workspaces(status);

-- TypeORM Entity
@Entity('workspaces')
export class Workspace {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  workspaceId: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ length: 10, nullable: true })
  icon: string;

  @ManyToOne(() => User, user => user.ownedWorkspaces)
  @JoinColumn({ name: 'owner_id', referencedColumnName: 'userId' })
  owner: User;

  @Column()
  ownerId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ default: 'active' })
  status: string;

  @Column({ type: 'jsonb', default: {} })
  settings: object;

  // 关联
  @OneToMany(() => Document, document => document.workspace)
  documents: Document[];

  @OneToMany(() => WorkspaceMember, member => member.workspace)
  members: WorkspaceMember[];
}
```

#### 3. workspace_members (工作空间成员表)

```sql
CREATE TABLE workspace_members (
  id SERIAL PRIMARY KEY,
  workspace_id VARCHAR(50) NOT NULL,
  user_id VARCHAR(50) NOT NULL,
  role VARCHAR(20) NOT NULL,                     -- owner, admin, editor, viewer

  joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  invited_by VARCHAR(50),

  FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(user_id) ON DELETE SET NULL,

  UNIQUE(workspace_id, user_id),
  CONSTRAINT check_role CHECK (role IN ('owner', 'admin', 'editor', 'viewer'))
);

-- 索引
CREATE INDEX idx_workspace_members_workspace_id ON workspace_members(workspace_id);
CREATE INDEX idx_workspace_members_user_id ON workspace_members(user_id);

-- TypeORM Entity
@Entity('workspace_members')
export class WorkspaceMember {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Workspace, workspace => workspace.members)
  @JoinColumn({ name: 'workspace_id', referencedColumnName: 'workspaceId' })
  workspace: Workspace;

  @Column()
  workspaceId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id', referencedColumnName: 'userId' })
  user: User;

  @Column()
  userId: string;

  @Column()
  role: string;

  @CreateDateColumn()
  joinedAt: Date;

  @Column({ nullable: true })
  invitedBy: string;
}
```

#### 4. documents (文档表)

```sql
CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  doc_id VARCHAR(50) UNIQUE NOT NULL,            -- 如 "doc_abc123"
  workspace_id VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  icon VARCHAR(10),
  cover VARCHAR(500),

  -- 版本信息
  head INTEGER DEFAULT 1,                        -- 当前版本号
  published_head INTEGER DEFAULT 0,              -- 已发布版本号
  root_block_id VARCHAR(50) NOT NULL,

  -- 元数据
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(50) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(50) NOT NULL,

  -- 状态
  status VARCHAR(20) DEFAULT 'draft',            -- draft, normal, archived, deleted
  visibility VARCHAR(20) DEFAULT 'private',      -- private, workspace, public

  -- 文档树结构
  parent_id VARCHAR(50),                         -- 父文档ID
  sort_order INTEGER DEFAULT 0,

  -- 统计
  view_count INTEGER DEFAULT 0,
  favorite_count INTEGER DEFAULT 0,

  -- 标签与分类
  tags TEXT[],                                   -- 使用 PostgreSQL 数组类型
  category VARCHAR(50),

  -- 全文搜索字段 (tsvector)
  search_vector tsvector,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (parent_id) REFERENCES documents(doc_id) ON DELETE CASCADE,

  CONSTRAINT check_status CHECK (status IN ('draft', 'normal', 'archived', 'deleted')),
  CONSTRAINT check_visibility CHECK (visibility IN ('private', 'workspace', 'public'))
);

-- 索引
CREATE INDEX idx_documents_doc_id ON documents(doc_id);
CREATE INDEX idx_documents_workspace_id ON documents(workspace_id);
CREATE INDEX idx_documents_created_by ON documents(created_by);
CREATE INDEX idx_documents_parent_id ON documents(parent_id);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_updated_at ON documents(updated_at DESC);
CREATE INDEX idx_documents_tags ON documents USING GIN(tags);  -- GIN 索引用于数组
CREATE INDEX idx_documents_search_vector ON documents USING GIN(search_vector);  -- 全文搜索

-- 自动更新 search_vector 的触发器
CREATE OR REPLACE FUNCTION documents_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.category, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_search_update
BEFORE INSERT OR UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION documents_search_trigger();

-- TypeORM Entity
@Entity('documents')
export class Document {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  docId: string;

  @ManyToOne(() => Workspace, workspace => workspace.documents)
  @JoinColumn({ name: 'workspace_id', referencedColumnName: 'workspaceId' })
  workspace: Workspace;

  @Column()
  workspaceId: string;

  @Column()
  title: string;

  @Column({ nullable: true })
  icon: string;

  @Column({ nullable: true })
  cover: string;

  @Column({ default: 1 })
  head: number;

  @Column({ default: 0 })
  publishedHead: number;

  @Column()
  rootBlockId: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column()
  createdBy: string;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column()
  updatedBy: string;

  @Column({ default: 'draft' })
  status: string;

  @Column({ default: 'private' })
  visibility: string;

  @Column({ nullable: true })
  parentId: string;

  @Column({ default: 0 })
  sortOrder: number;

  @Column({ default: 0 })
  viewCount: number;

  @Column({ default: 0 })
  favoriteCount: number;

  @Column({ type: 'text', array: true, default: [] })
  tags: string[];

  @Column({ nullable: true })
  category: string;

  // 关联
  @OneToMany(() => Block, block => block.document)
  blocks: Block[];

  @OneToMany(() => DocRevision, revision => revision.document)
  revisions: DocRevision[];
}
```

#### 5. blocks (块身份表)

```sql
CREATE TABLE blocks (
  id SERIAL PRIMARY KEY,
  block_id VARCHAR(50) UNIQUE NOT NULL,          -- 如 "b_xyz001"
  doc_id VARCHAR(50) NOT NULL,
  type VARCHAR(50) NOT NULL,                     -- root, paragraph, heading, listItem, code, quote, image

  created_at BIGINT NOT NULL,                    -- Unix 时间戳（毫秒）
  created_by VARCHAR(50) NOT NULL,

  latest_ver INTEGER NOT NULL,
  latest_at BIGINT NOT NULL,
  latest_by VARCHAR(50) NOT NULL,

  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at BIGINT,
  deleted_by VARCHAR(50),

  FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (latest_by) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (deleted_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- 索引
CREATE INDEX idx_blocks_block_id ON blocks(block_id);
CREATE INDEX idx_blocks_doc_id ON blocks(doc_id);
CREATE INDEX idx_blocks_type ON blocks(type);
CREATE INDEX idx_blocks_is_deleted ON blocks(is_deleted);

-- TypeORM Entity
@Entity('blocks')
export class Block {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  blockId: string;

  @ManyToOne(() => Document, document => document.blocks)
  @JoinColumn({ name: 'doc_id', referencedColumnName: 'docId' })
  document: Document;

  @Column()
  docId: string;

  @Column()
  type: string;

  @Column({ type: 'bigint' })
  createdAt: number;

  @Column()
  createdBy: string;

  @Column()
  latestVer: number;

  @Column({ type: 'bigint' })
  latestAt: number;

  @Column()
  latestBy: string;

  @Column({ default: false })
  isDeleted: boolean;

  @Column({ type: 'bigint', nullable: true })
  deletedAt: number;

  @Column({ nullable: true })
  deletedBy: string;

  // 关联
  @OneToMany(() => BlockVersion, version => version.block)
  versions: BlockVersion[];
}
```

#### 6. block_versions (块版本表)

```sql
CREATE TABLE block_versions (
  id SERIAL PRIMARY KEY,
  version_id VARCHAR(100) UNIQUE NOT NULL,       -- "${blockId}@${ver}"
  doc_id VARCHAR(50) NOT NULL,
  block_id VARCHAR(50) NOT NULL,
  ver INTEGER NOT NULL,

  created_at BIGINT NOT NULL,
  created_by VARCHAR(50) NOT NULL,

  -- 结构定位
  parent_id VARCHAR(50) NOT NULL,
  sort_key VARCHAR(50) NOT NULL,                 -- 分数排序键
  indent INTEGER DEFAULT 0,
  collapsed BOOLEAN DEFAULT FALSE,

  -- 内容载荷 (使用 JSONB)
  payload JSONB NOT NULL,

  -- 元数据
  hash VARCHAR(64) NOT NULL,                     -- SHA256 哈希
  plain_text TEXT,                               -- 提取的纯文本
  refs JSONB DEFAULT '[]',                       -- 引用关系数组

  -- 全文搜索
  search_vector tsvector,

  FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE,
  FOREIGN KEY (block_id) REFERENCES blocks(block_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,

  UNIQUE(block_id, ver)
);

-- 索引
CREATE INDEX idx_block_versions_version_id ON block_versions(version_id);
CREATE INDEX idx_block_versions_block_id_ver ON block_versions(block_id, ver);
CREATE INDEX idx_block_versions_doc_id ON block_versions(doc_id);
CREATE INDEX idx_block_versions_hash ON block_versions(hash);
CREATE INDEX idx_block_versions_search_vector ON block_versions USING GIN(search_vector);
CREATE INDEX idx_block_versions_payload ON block_versions USING GIN(payload);  -- JSONB 索引

-- 全文搜索触发器
CREATE OR REPLACE FUNCTION block_versions_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.plain_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER block_versions_search_update
BEFORE INSERT OR UPDATE ON block_versions
FOR EACH ROW EXECUTE FUNCTION block_versions_search_trigger();

-- TypeORM Entity
@Entity('block_versions')
export class BlockVersion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 100 })
  versionId: string;

  @Column()
  docId: string;

  @ManyToOne(() => Block, block => block.versions)
  @JoinColumn({ name: 'block_id', referencedColumnName: 'blockId' })
  block: Block;

  @Column()
  blockId: string;

  @Column()
  ver: number;

  @Column({ type: 'bigint' })
  createdAt: number;

  @Column()
  createdBy: string;

  @Column()
  parentId: string;

  @Column()
  sortKey: string;

  @Column({ default: 0 })
  indent: number;

  @Column({ default: false })
  collapsed: boolean;

  @Column({ type: 'jsonb' })
  payload: object;

  @Column()
  hash: string;

  @Column({ type: 'text', nullable: true })
  plainText: string;

  @Column({ type: 'jsonb', default: [] })
  refs: object[];
}
```

#### 7. doc_revisions (文档修订表)

```sql
CREATE TABLE doc_revisions (
  id SERIAL PRIMARY KEY,
  revision_id VARCHAR(100) UNIQUE NOT NULL,      -- "${docId}@${docVer}"
  doc_id VARCHAR(50) NOT NULL,
  doc_ver INTEGER NOT NULL,

  created_at BIGINT NOT NULL,
  created_by VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,                         -- 提交信息
  branch VARCHAR(20) DEFAULT 'draft',            -- draft, published

  patches JSONB NOT NULL,                        -- 变更集数组
  root_block_id VARCHAR(50) NOT NULL,

  source VARCHAR(20) DEFAULT 'editor',           -- editor, api, import
  op_summary JSONB DEFAULT '{}',                 -- 操作摘要

  FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,

  UNIQUE(doc_id, doc_ver)
);

-- 索引
CREATE INDEX idx_doc_revisions_revision_id ON doc_revisions(revision_id);
CREATE INDEX idx_doc_revisions_doc_id_ver ON doc_revisions(doc_id, doc_ver DESC);
CREATE INDEX idx_doc_revisions_created_at ON doc_revisions(created_at DESC);

-- TypeORM Entity
@Entity('doc_revisions')
export class DocRevision {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 100 })
  revisionId: string;

  @ManyToOne(() => Document, document => document.revisions)
  @JoinColumn({ name: 'doc_id', referencedColumnName: 'docId' })
  document: Document;

  @Column()
  docId: string;

  @Column()
  docVer: number;

  @Column({ type: 'bigint' })
  createdAt: number;

  @Column()
  createdBy: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ default: 'draft' })
  branch: string;

  @Column({ type: 'jsonb' })
  patches: object[];

  @Column()
  rootBlockId: string;

  @Column({ default: 'editor' })
  source: string;

  @Column({ type: 'jsonb', default: {} })
  opSummary: object;
}
```

#### 8. doc_snapshots (文档快照表)

```sql
CREATE TABLE doc_snapshots (
  id SERIAL PRIMARY KEY,
  snapshot_id VARCHAR(150) UNIQUE NOT NULL,      -- "${docId}@snap@${docVer}"
  doc_id VARCHAR(50) NOT NULL,
  doc_ver INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  root_block_id VARCHAR(50) NOT NULL,

  -- 快照数据 (JSONB 存储完整的块版本映射)
  block_version_map JSONB NOT NULL,

  FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX idx_doc_snapshots_snapshot_id ON doc_snapshots(snapshot_id);
CREATE INDEX idx_doc_snapshots_doc_id_ver ON doc_snapshots(doc_id, doc_ver DESC);

-- TypeORM Entity
@Entity('doc_snapshots')
export class DocSnapshot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 150 })
  snapshotId: string;

  @Column()
  docId: string;

  @Column()
  docVer: number;

  @Column({ type: 'bigint' })
  createdAt: number;

  @Column()
  rootBlockId: string;

  @Column({ type: 'jsonb' })
  blockVersionMap: object;
}
```

#### 9. assets (资产表)

```sql
CREATE TABLE assets (
  id SERIAL PRIMARY KEY,
  asset_id VARCHAR(50) UNIQUE NOT NULL,
  workspace_id VARCHAR(50) NOT NULL,
  uploaded_by VARCHAR(50) NOT NULL,

  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size BIGINT NOT NULL,

  -- 存储信息
  storage_provider VARCHAR(20) NOT NULL,         -- local, s3, oss, cos
  storage_path VARCHAR(500) NOT NULL,
  url VARCHAR(500) NOT NULL,

  -- 图片特定字段
  width INTEGER,
  height INTEGER,
  thumbnail VARCHAR(500),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active',

  ref_count INTEGER DEFAULT 0,
  refs JSONB DEFAULT '[]',

  FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(user_id) ON DELETE SET NULL,

  CONSTRAINT check_asset_status CHECK (status IN ('active', 'deleted'))
);

-- 索引
CREATE INDEX idx_assets_asset_id ON assets(asset_id);
CREATE INDEX idx_assets_workspace_id ON assets(workspace_id);
CREATE INDEX idx_assets_uploaded_by ON assets(uploaded_by);
CREATE INDEX idx_assets_mime_type ON assets(mime_type);

-- TypeORM Entity
@Entity('assets')
export class Asset {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  assetId: string;

  @Column()
  workspaceId: string;

  @Column()
  uploadedBy: string;

  @Column()
  filename: string;

  @Column()
  mimeType: string;

  @Column({ type: 'bigint' })
  size: number;

  @Column()
  storageProvider: string;

  @Column()
  storagePath: string;

  @Column()
  url: string;

  @Column({ nullable: true })
  width: number;

  @Column({ nullable: true })
  height: number;

  @Column({ nullable: true })
  thumbnail: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ default: 'active' })
  status: string;

  @Column({ default: 0 })
  refCount: number;

  @Column({ type: 'jsonb', default: [] })
  refs: object[];
}
```

#### 10. tags (标签表)

```sql
CREATE TABLE tags (
  id SERIAL PRIMARY KEY,
  tag_id VARCHAR(50) UNIQUE NOT NULL,
  workspace_id VARCHAR(50) NOT NULL,
  name VARCHAR(50) NOT NULL,
  color VARCHAR(20),

  created_by VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  usage_count INTEGER DEFAULT 0,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,

  UNIQUE(workspace_id, name)
);

-- 索引
CREATE INDEX idx_tags_workspace_id ON tags(workspace_id);
CREATE INDEX idx_tags_name ON tags(name);

-- TypeORM Entity
@Entity('tags')
export class Tag {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  tagId: string;

  @Column()
  workspaceId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  color: string;

  @Column()
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ default: 0 })
  usageCount: number;
}
```

#### 11. favorites (收藏表)

```sql
CREATE TABLE favorites (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,
  doc_id VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE,

  UNIQUE(user_id, doc_id)
);

-- 索引
CREATE INDEX idx_favorites_user_id ON favorites(user_id);
CREATE INDEX idx_favorites_doc_id ON favorites(doc_id);

-- TypeORM Entity
@Entity('favorites')
export class Favorite {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: string;

  @Column()
  docId: string;

  @CreateDateColumn()
  createdAt: Date;
}
```

#### 12. comments (评论表)

```sql
CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  comment_id VARCHAR(50) UNIQUE NOT NULL,
  doc_id VARCHAR(50) NOT NULL,
  block_id VARCHAR(50),

  user_id VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  mentions TEXT[],                               -- @提到的用户ID数组

  parent_comment_id VARCHAR(50),                 -- 回复的评论ID

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  is_deleted BOOLEAN DEFAULT FALSE,

  FOREIGN KEY (doc_id) REFERENCES documents(doc_id) ON DELETE CASCADE,
  FOREIGN KEY (block_id) REFERENCES blocks(block_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (parent_comment_id) REFERENCES comments(comment_id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX idx_comments_doc_id ON comments(doc_id);
CREATE INDEX idx_comments_block_id ON comments(block_id);
CREATE INDEX idx_comments_user_id ON comments(user_id);
CREATE INDEX idx_comments_parent_comment_id ON comments(parent_comment_id);

-- TypeORM Entity
@Entity('comments')
export class Comment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  commentId: string;

  @Column()
  docId: string;

  @Column({ nullable: true })
  blockId: string;

  @Column()
  userId: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text', array: true, default: [] })
  mentions: string[];

  @Column({ nullable: true })
  parentCommentId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ default: false })
  isDeleted: boolean;
}
```

#### 13. activities (活动日志表)

```sql
CREATE TABLE activities (
  id SERIAL PRIMARY KEY,
  activity_id VARCHAR(50) UNIQUE NOT NULL,
  workspace_id VARCHAR(50) NOT NULL,

  action VARCHAR(50) NOT NULL,                   -- create, update, delete, move, share, comment
  entity_type VARCHAR(50) NOT NULL,              -- document, block, workspace
  entity_id VARCHAR(50) NOT NULL,

  user_id VARCHAR(50) NOT NULL,

  details JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  ip_address VARCHAR(45),
  user_agent TEXT,

  FOREIGN KEY (workspace_id) REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX idx_activities_workspace_id ON activities(workspace_id, created_at DESC);
CREATE INDEX idx_activities_user_id ON activities(user_id, created_at DESC);
CREATE INDEX idx_activities_entity ON activities(entity_type, entity_id);
CREATE INDEX idx_activities_created_at ON activities(created_at DESC);

-- TypeORM Entity
@Entity('activities')
export class Activity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  activityId: string;

  @Column()
  workspaceId: string;

  @Column()
  action: string;

  @Column()
  entityType: string;

  @Column()
  entityId: string;

  @Column()
  userId: string;

  @Column({ type: 'jsonb', default: {} })
  details: object;

  @Column({ type: 'jsonb', default: {} })
  metadata: object;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ type: 'text', nullable: true })
  userAgent: string;
}
```

#### 14. sessions (会话表)

```sql
CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(100) UNIQUE NOT NULL,
  user_id VARCHAR(50) NOT NULL,
  token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  device_info JSONB DEFAULT '{}',

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX idx_sessions_session_id ON sessions(session_id);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- 自动清理过期会话的任务
-- 可以通过 PostgreSQL 的 pg_cron 扩展或应用层定时任务实现
-- DELETE FROM sessions WHERE expires_at < NOW();

-- TypeORM Entity
@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 100 })
  sessionId: string;

  @Column()
  userId: string;

  @Column({ type: 'text' })
  token: string;

  @Column({ type: 'text' })
  refreshToken: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column()
  expiresAt: Date;

  @Column({ default: () => 'CURRENT_TIMESTAMP' })
  lastActivityAt: Date;

  @Column({ type: 'jsonb', default: {} })
  deviceInfo: object;
}
```

### 数据库关系图

```
users (1) ───< (n) workspaces (owner)
users (n) ───< (n) workspace_members ───> (1) workspaces
workspaces (1) ───< (n) documents
documents (1) ───< (n) blocks
blocks (1) ───< (n) block_versions
documents (1) ───< (n) doc_revisions
documents (1) ───< (n) doc_snapshots
workspaces (1) ───< (n) assets
users (n) ───< (n) favorites ───> (n) documents
documents (1) ───< (n) comments
```

---

## NestJS 项目结构

```
src/
├── main.ts                          # 应用入口
├── app.module.ts                    # 根模块
│
├── config/                          # 配置模块
│   ├── config.module.ts
│   ├── database.config.ts
│   ├── jwt.config.ts
│   └── redis.config.ts
│
├── common/                          # 公共模块
│   ├── decorators/                  # 装饰器
│   │   ├── current-user.decorator.ts
│   │   ├── roles.decorator.ts
│   │   └── public.decorator.ts
│   ├── filters/                     # 异常过滤器
│   │   ├── http-exception.filter.ts
│   │   └── all-exceptions.filter.ts
│   ├── guards/                      # 守卫
│   │   ├── jwt-auth.guard.ts
│   │   ├── roles.guard.ts
│   │   └── workspace.guard.ts
│   ├── interceptors/                # 拦截器
│   │   ├── logging.interceptor.ts
│   │   ├── timeout.interceptor.ts
│   │   └── transform.interceptor.ts
│   ├── pipes/                       # 管道
│   │   └── validation.pipe.ts
│   ├── dto/                         # 公共 DTO
│   │   ├── pagination.dto.ts
│   │   └── response.dto.ts
│   └── utils/                       # 工具函数
│       ├── id-generator.ts
│       ├── hash.util.ts
│       └── sort-key.util.ts
│
├── entities/                        # TypeORM 实体（已在上面定义）
│   ├── user.entity.ts
│   ├── workspace.entity.ts
│   ├── workspace-member.entity.ts
│   ├── document.entity.ts
│   ├── block.entity.ts
│   ├── block-version.entity.ts
│   ├── doc-revision.entity.ts
│   ├── doc-snapshot.entity.ts
│   ├── asset.entity.ts
│   ├── tag.entity.ts
│   ├── favorite.entity.ts
│   ├── comment.entity.ts
│   ├── activity.entity.ts
│   └── session.entity.ts
│
├── modules/                         # 功能模块
│   │
│   ├── auth/                        # 认证模块
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── strategies/
│   │   │   ├── jwt.strategy.ts
│   │   │   └── local.strategy.ts
│   │   └── dto/
│   │       ├── register.dto.ts
│   │       ├── login.dto.ts
│   │       └── refresh-token.dto.ts
│   │
│   ├── users/                       # 用户模块
│   │   ├── users.module.ts
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   ├── users.repository.ts
│   │   └── dto/
│   │       ├── create-user.dto.ts
│   │       └── update-user.dto.ts
│   │
│   ├── workspaces/                  # 工作空间模块
│   │   ├── workspaces.module.ts
│   │   ├── workspaces.controller.ts
│   │   ├── workspaces.service.ts
│   │   ├── workspaces.repository.ts
│   │   └── dto/
│   │       ├── create-workspace.dto.ts
│   │       ├── update-workspace.dto.ts
│   │       └── invite-member.dto.ts
│   │
│   ├── documents/                   # 文档模块
│   │   ├── documents.module.ts
│   │   ├── documents.controller.ts
│   │   ├── documents.service.ts
│   │   ├── documents.repository.ts
│   │   └── dto/
│   │       ├── create-document.dto.ts
│   │       ├── update-document.dto.ts
│   │       ├── publish-document.dto.ts
│   │       └── move-document.dto.ts
│   │
│   ├── blocks/                      # 块模块
│   │   ├── blocks.module.ts
│   │   ├── blocks.controller.ts
│   │   ├── blocks.service.ts
│   │   ├── blocks.repository.ts
│   │   └── dto/
│   │       ├── create-block.dto.ts
│   │       ├── update-block.dto.ts
│   │       ├── move-block.dto.ts
│   │       └── batch-operations.dto.ts
│   │
│   ├── versions/                    # 版本控制模块
│   │   ├── versions.module.ts
│   │   ├── versions.controller.ts
│   │   ├── versions.service.ts
│   │   └── dto/
│   │       ├── diff-versions.dto.ts
│   │       ├── revert-version.dto.ts
│   │       └── create-snapshot.dto.ts
│   │
│   ├── assets/                      # 资产模块
│   │   ├── assets.module.ts
│   │   ├── assets.controller.ts
│   │   ├── assets.service.ts
│   │   ├── assets.repository.ts
│   │   └── dto/
│   │       └── upload-asset.dto.ts
│   │
│   ├── tags/                        # 标签模块
│   │   ├── tags.module.ts
│   │   ├── tags.controller.ts
│   │   ├── tags.service.ts
│   │   └── dto/
│   │       └── create-tag.dto.ts
│   │
│   ├── favorites/                   # 收藏模块
│   │   ├── favorites.module.ts
│   │   ├── favorites.controller.ts
│   │   └── favorites.service.ts
│   │
│   ├── comments/                    # 评论模块
│   │   ├── comments.module.ts
│   │   ├── comments.controller.ts
│   │   ├── comments.service.ts
│   │   └── dto/
│   │       ├── create-comment.dto.ts
│   │       └── update-comment.dto.ts
│   │
│   ├── activities/                  # 活动日志模块
│   │   ├── activities.module.ts
│   │   ├── activities.controller.ts
│   │   └── activities.service.ts
│   │
│   ├── search/                      # 搜索模块
│   │   ├── search.module.ts
│   │   ├── search.controller.ts
│   │   ├── search.service.ts
│   │   └── dto/
│   │       └── search-query.dto.ts
│   │
│   ├── export/                      # 导出模块
│   │   ├── export.module.ts
│   │   ├── export.controller.ts
│   │   └── export.service.ts
│   │
│   ├── import/                      # 导入模块
│   │   ├── import.module.ts
│   │   ├── import.controller.ts
│   │   └── import.service.ts
│   │
│   └── realtime/                    # 实时协作模块
│       ├── realtime.module.ts
│       ├── realtime.gateway.ts      # WebSocket Gateway
│       └── realtime.service.ts
│
├── engine/                          # 文档引擎（复用前端引擎）
│   ├── document.engine.ts
│   ├── storage.interface.ts
│   ├── storage.service.ts           # PostgreSQL 实现
│   ├── diff.service.ts
│   └── sort-key.util.ts
│
└── database/                        # 数据库相关
    ├── migrations/                  # 迁移文件
    ├── seeds/                       # 种子数据
    └── database.module.ts
```

### 核心模块示例代码

#### main.ts

```typescript
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 全局前缀
  app.setGlobalPrefix("api/v1");

  // 跨域
  app.enableCors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  });

  // 全局管道
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // 全局过滤器
  app.useGlobalFilters(new HttpExceptionFilter());

  // 全局拦截器
  app.useGlobalInterceptors(new TransformInterceptor());

  // Swagger 文档
  const config = new DocumentBuilder()
    .setTitle("知识库 API")
    .setDescription("个人知识库系统 API 文档")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);

  await app.listen(process.env.PORT || 3000);
  console.log(`Application is running on: ${await app.getUrl()}`);
}

bootstrap();
```

#### app.module.ts

```typescript
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CacheModule } from "@nestjs/cache-manager";
import { BullModule } from "@nestjs/bull";
import * as redisStore from "cache-manager-redis-store";

import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { BlocksModule } from "./modules/blocks/blocks.module";
import { VersionsModule } from "./modules/versions/versions.module";
import { AssetsModule } from "./modules/assets/assets.module";
import { TagsModule } from "./modules/tags/tags.module";
import { FavoritesModule } from "./modules/favorites/favorites.module";
import { CommentsModule } from "./modules/comments/comments.module";
import { ActivitiesModule } from "./modules/activities/activities.module";
import { SearchModule } from "./modules/search/search.module";
import { ExportModule } from "./modules/export/export.module";
import { ImportModule } from "./modules/import/import.module";
import { RealtimeModule } from "./modules/realtime/realtime.module";

@Module({
  imports: [
    // 配置模块
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),

    // 数据库模块
    TypeOrmModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT) || 5432,
      username: process.env.DB_USERNAME || "postgres",
      password: process.env.DB_PASSWORD || "postgres",
      database: process.env.DB_DATABASE || "knowledge_base",
      entities: [__dirname + "/**/*.entity{.ts,.js}"],
      synchronize: process.env.NODE_ENV === "development", // 生产环境使用迁移
      logging: process.env.NODE_ENV === "development",
      migrations: [__dirname + "/database/migrations/*{.ts,.js}"],
      migrationsRun: true,
    }),

    // Redis 缓存
    CacheModule.register({
      isGlobal: true,
      store: redisStore,
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT) || 6379,
      ttl: 300, // 默认 5 分钟
    }),

    // Bull 队列
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT) || 6379,
      },
    }),

    // 功能模块
    AuthModule,
    UsersModule,
    WorkspacesModule,
    DocumentsModule,
    BlocksModule,
    VersionsModule,
    AssetsModule,
    TagsModule,
    FavoritesModule,
    CommentsModule,
    ActivitiesModule,
    SearchModule,
    ExportModule,
    ImportModule,
    RealtimeModule,
  ],
})
export class AppModule {}
```

#### documents.controller.ts 示例

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { DocumentsService } from "./documents.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { CreateDocumentDto } from "./dto/create-document.dto";
import { UpdateDocumentDto } from "./dto/update-document.dto";
import { PaginationDto } from "../../common/dto/pagination.dto";

@ApiTags("documents")
@ApiBearerAuth()
@Controller("documents")
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @ApiOperation({ summary: "创建文档" })
  async create(
    @Body() createDocumentDto: CreateDocumentDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.create(createDocumentDto, user.userId);
  }

  @Get()
  @ApiOperation({ summary: "获取文档列表" })
  async findAll(@Query() query: PaginationDto, @CurrentUser() user: any) {
    return this.documentsService.findAll(query, user.userId);
  }

  @Get(":docId")
  @ApiOperation({ summary: "获取文档详情" })
  async findOne(@Param("docId") docId: string, @CurrentUser() user: any) {
    return this.documentsService.findOne(docId, user.userId);
  }

  @Get(":docId/content")
  @ApiOperation({ summary: "获取文档内容（渲染树）" })
  async getContent(
    @Param("docId") docId: string,
    @Query("version") version: number,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.getContent(docId, version, user.userId);
  }

  @Patch(":docId")
  @ApiOperation({ summary: "更新文档元数据" })
  async update(
    @Param("docId") docId: string,
    @Body() updateDocumentDto: UpdateDocumentDto,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.update(docId, updateDocumentDto, user.userId);
  }

  @Post(":docId/publish")
  @ApiOperation({ summary: "发布文档" })
  async publish(@Param("docId") docId: string, @CurrentUser() user: any) {
    return this.documentsService.publish(docId, user.userId);
  }

  @Delete(":docId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "删除文档" })
  async remove(@Param("docId") docId: string, @CurrentUser() user: any) {
    return this.documentsService.remove(docId, user.userId);
  }
}
```

#### documents.service.ts 示例

```typescript
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Document } from "../../entities/document.entity";
import { DocumentEngine } from "../../engine/document.engine";
import { CreateDocumentDto } from "./dto/create-document.dto";
import { UpdateDocumentDto } from "./dto/update-document.dto";

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    private documentEngine: DocumentEngine,
  ) {}

  async create(createDocumentDto: CreateDocumentDto, userId: string) {
    // 检查权限
    await this.checkWorkspacePermission(createDocumentDto.workspaceId, userId);

    // 使用文档引擎创建文档
    const doc = await this.documentEngine.createDocument({
      docId: this.generateDocId(),
      title: createDocumentDto.title,
      createdBy: userId,
      workspaceId: createDocumentDto.workspaceId,
    });

    return doc;
  }

  async findAll(query: any, userId: string) {
    const { workspaceId, page = 1, pageSize = 20 } = query;

    // 检查权限
    await this.checkWorkspacePermission(workspaceId, userId);

    const [items, total] = await this.documentRepository.findAndCount({
      where: { workspaceId, status: "normal" },
      order: { updatedAt: "DESC" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items,
      meta: { total, page, pageSize },
    };
  }

  async findOne(docId: string, userId: string) {
    const doc = await this.documentRepository.findOne({ where: { docId } });

    if (!doc) {
      throw new NotFoundException("文档不存在");
    }

    // 检查权限
    await this.checkDocumentPermission(doc, userId);

    return doc;
  }

  async getContent(docId: string, version: number, userId: string) {
    const doc = await this.findOne(docId, userId);

    // 使用文档引擎获取渲染树
    const tree = await this.documentEngine.getRenderedTree(docId, version);

    return {
      docId: doc.docId,
      docVer: version || doc.head,
      title: doc.title,
      tree,
    };
  }

  async update(docId: string, updateDto: UpdateDocumentDto, userId: string) {
    const doc = await this.findOne(docId, userId);

    // 检查编辑权限
    await this.checkDocumentEditPermission(doc, userId);

    // 使用文档引擎更新元数据
    const updated = await this.documentEngine.updateDocumentMeta(
      docId,
      userId,
      updateDto,
    );

    return updated;
  }

  async publish(docId: string, userId: string) {
    const doc = await this.findOne(docId, userId);

    // 检查发布权限
    await this.checkDocumentPublishPermission(doc, userId);

    const updated = await this.documentEngine.updateDocumentMeta(
      docId,
      userId,
      { publishedHead: doc.head },
    );

    return updated;
  }

  async remove(docId: string, userId: string) {
    const doc = await this.findOne(docId, userId);

    // 检查删除权限
    await this.checkDocumentDeletePermission(doc, userId);

    await this.documentRepository.update(
      { docId },
      { status: "deleted", updatedBy: userId },
    );
  }

  private generateDocId(): string {
    return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  private async checkWorkspacePermission(workspaceId: string, userId: string) {
    // 实现权限检查逻辑
    // ...
  }

  private async checkDocumentPermission(doc: Document, userId: string) {
    // 实现文档权限检查
    // ...
  }

  private async checkDocumentEditPermission(doc: Document, userId: string) {
    // 实现编辑权限检查
    // ...
  }

  private async checkDocumentPublishPermission(doc: Document, userId: string) {
    // 实现发布权限检查
    // ...
  }

  private async checkDocumentDeletePermission(doc: Document, userId: string) {
    // 实现删除权限检查
    // ...
  }
}
```

---

## API 接口设计

### 统一响应格式

```typescript
// 成功响应
interface SuccessResponse<T> {
  success: true;
  data: T;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
  };
}

// 错误响应
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}
```

### API 接口列表

由于接口设计与前面 MongoDB 版本基本相同，这里只列出关键差异：

#### 1. 认证接口 (同前)

- POST /api/v1/auth/register
- POST /api/v1/auth/login
- POST /api/v1/auth/refresh
- POST /api/v1/auth/logout
- GET /api/v1/auth/me

#### 2. 工作空间接口 (同前)

- POST /api/v1/workspaces
- GET /api/v1/workspaces
- GET /api/v1/workspaces/:workspaceId
- PATCH /api/v1/workspaces/:workspaceId
- POST /api/v1/workspaces/:workspaceId/members

#### 3. 文档接口 (同前)

- POST /api/v1/documents
- GET /api/v1/documents
- GET /api/v1/documents/:docId
- GET /api/v1/documents/:docId/content
- PATCH /api/v1/documents/:docId
- POST /api/v1/documents/:docId/publish
- POST /api/v1/documents/:docId/move
- DELETE /api/v1/documents/:docId
- GET /api/v1/documents/search

#### 4. 块接口 (同前)

- POST /api/v1/blocks
- PATCH /api/v1/blocks/:blockId/content
- POST /api/v1/blocks/:blockId/move
- DELETE /api/v1/blocks/:blockId
- GET /api/v1/blocks/:blockId/versions
- POST /api/v1/blocks/batch

#### 5. 版本控制接口 (同前)

- GET /api/v1/documents/:docId/revisions
- GET /api/v1/documents/:docId/diff
- POST /api/v1/documents/:docId/revert
- POST /api/v1/documents/:docId/snapshots

#### 6. 资产接口 (同前)

- POST /api/v1/assets/upload
- GET /api/v1/assets
- DELETE /api/v1/assets/:assetId

#### 7. 其他接口 (同前)

- 标签、收藏、评论、活动日志、导入/导出等接口

### PostgreSQL 特有的搜索接口

```typescript
@Get('search')
@ApiOperation({ summary: '全文搜索文档' })
async search(@Query() query: SearchQueryDto, @CurrentUser() user: any) {
  const { q, workspaceId, page = 1, pageSize = 20 } = query;

  // 使用 PostgreSQL 全文搜索
  const results = await this.documentRepository
    .createQueryBuilder('doc')
    .where('doc.workspaceId = :workspaceId', { workspaceId })
    .andWhere('doc.search_vector @@ plainto_tsquery(:query)', { query: q })
    .orderBy('ts_rank(doc.search_vector, plainto_tsquery(:query))', 'DESC')
    .skip((page - 1) * pageSize)
    .take(pageSize)
    .getManyAndCount();

  return {
    items: results[0],
    meta: { total: results[1], page, pageSize },
  };
}
```

---

## 认证与权限

### JWT 策略

```typescript
// jwt.strategy.ts
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { ConfigService } from "@nestjs/config";
import { UsersService } from "../users/users.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get("JWT_SECRET"),
    });
  }

  async validate(payload: any) {
    const user = await this.usersService.findByUserId(payload.userId);

    if (!user || user.status !== "active") {
      throw new UnauthorizedException("用户不存在或已被禁用");
    }

    return {
      userId: user.userId,
      email: user.email,
      username: user.username,
    };
  }
}
```

### 权限守卫

```typescript
// roles.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WorkspaceMembersService } from '../workspaces/workspace-members.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private workspaceMembersService: WorkspaceMembersService,
  ) {}

  async canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<string[]>(
      'roles',
      context.getHandler(),
    );

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const workspaceId = request.params.workspaceId || request.body.workspaceId;

    const member = await this.workspaceMembersService.findMember(
      workspaceId,
      user.userId,
    );

    if (!member) {
      return false;
    }

    return requiredRoles.includes(member.role);
  }
}

// 使用装饰器
@Roles('owner', 'admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Delete(':docId')
async deleteDocument(@Param('docId') docId: string) {
  // ...
}
```

---

## 错误处理

### 全局异常过滤器

```typescript
// http-exception.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Response } from "express";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let code = "INTERNAL_ERROR";

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === "object") {
        message = (exceptionResponse as any).message || message;
        code = (exceptionResponse as any).code || code;
      } else {
        message = exceptionResponse;
      }
    }

    // 记录错误日志
    console.error({
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      status,
      code,
      message,
      stack: exception instanceof Error ? exception.stack : undefined,
    });

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        ...(process.env.NODE_ENV === "development" && {
          stack: exception instanceof Error ? exception.stack : undefined,
        }),
      },
    });
  }
}
```

### 标准错误码

```typescript
export enum ErrorCode {
  // 认证错误 (1xxx)
  AUTH_FAILED = "AUTH_FAILED",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  TOKEN_INVALID = "TOKEN_INVALID",
  UNAUTHORIZED = "UNAUTHORIZED",

  // 权限错误 (2xxx)
  ACCESS_DENIED = "ACCESS_DENIED",
  PERMISSION_DENIED = "PERMISSION_DENIED",

  // 资源错误 (3xxx)
  NOT_FOUND = "NOT_FOUND",
  ALREADY_EXISTS = "ALREADY_EXISTS",
  RESOURCE_LOCKED = "RESOURCE_LOCKED",

  // 验证错误 (4xxx)
  VALIDATION_ERROR = "VALIDATION_ERROR",
  INVALID_PARAMETER = "INVALID_PARAMETER",
  MISSING_PARAMETER = "MISSING_PARAMETER",

  // 业务逻辑错误 (5xxx)
  VERSION_CONFLICT = "VERSION_CONFLICT",
  QUOTA_EXCEEDED = "QUOTA_EXCEEDED",
  OPERATION_FAILED = "OPERATION_FAILED",

  // 服务器错误 (9xxx)
  INTERNAL_ERROR = "INTERNAL_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
}
```

---

## 性能优化

### 1. 数据库查询优化

```typescript
// 使用 QueryBuilder 进行复杂查询
async findDocumentsWithStats(workspaceId: string) {
  return this.documentRepository
    .createQueryBuilder('doc')
    .leftJoin('doc.blocks', 'block')
    .leftJoin('doc.favorites', 'favorite')
    .select([
      'doc.docId',
      'doc.title',
      'doc.updatedAt',
      'COUNT(DISTINCT block.id) as blockCount',
      'COUNT(DISTINCT favorite.id) as favoriteCount',
    ])
    .where('doc.workspaceId = :workspaceId', { workspaceId })
    .groupBy('doc.id')
    .getRawMany();
}

// 使用索引提示
@Index(['workspaceId', 'status', 'updatedAt'])
@Entity('documents')
export class Document {
  // ...
}
```

### 2. Redis 缓存

```typescript
import { Injectable, Inject } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";

@Injectable()
export class DocumentsService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async getDocument(docId: string) {
    // 尝试从缓存获取
    const cacheKey = `doc:${docId}`;
    const cached = await this.cacheManager.get(cacheKey);

    if (cached) {
      return cached;
    }

    // 从数据库获取
    const doc = await this.documentRepository.findOne({ where: { docId } });

    // 存入缓存（5分钟）
    await this.cacheManager.set(cacheKey, doc, 300);

    return doc;
  }

  async updateDocument(docId: string, data: any) {
    const updated = await this.documentRepository.update({ docId }, data);

    // 清除缓存
    await this.cacheManager.del(`doc:${docId}`);

    return updated;
  }
}
```

### 3. 批量操作优化

```typescript
// 使用事务进行批量操作
async batchCreateBlocks(operations: CreateBlockDto[]) {
  return this.dataSource.transaction(async (manager) => {
    const blocks = [];

    for (const op of operations) {
      const block = manager.create(Block, op);
      blocks.push(block);
    }

    // 批量插入
    await manager.save(blocks);

    return blocks;
  });
}
```

### 4. 连接池配置

```typescript
// app.module.ts
TypeOrmModule.forRoot({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  // 连接池配置
  extra: {
    max: 20,              // 最大连接数
    min: 5,               // 最小连接数
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
  // ...
}),
```

---

## 部署方案

### Docker 部署

#### Dockerfile

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm ci

# 复制源码
COPY . .

# 构建
RUN npm run build

# 生产镜像
FROM node:18-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

EXPOSE 3000

CMD ["node", "dist/main"]
```

#### docker-compose.yml

```yaml
version: "3.8"

services:
  # NestJS 应用
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_USERNAME=postgres
      - DB_PASSWORD=postgres
      - DB_DATABASE=knowledge_base
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - JWT_SECRET=${JWT_SECRET}
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  # PostgreSQL
  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=knowledge_base
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  # Redis
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped

  # PgAdmin (可选)
  pgadmin:
    image: dpage/pgadmin4
    ports:
      - "5050:80"
    environment:
      - PGADMIN_DEFAULT_EMAIL=admin@example.com
      - PGADMIN_DEFAULT_PASSWORD=admin
    volumes:
      - pgadmin_data:/var/lib/pgadmin

volumes:
  postgres_data:
  redis_data:
  pgadmin_data:
```

### 环境变量配置

```bash
# .env
NODE_ENV=production
PORT=3000

# 数据库
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=your-secure-password
DB_DATABASE=knowledge_base

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=24h
REFRESH_TOKEN_EXPIRES_IN=7d

# 文件存储
STORAGE_PROVIDER=s3
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=knowledge-base-assets
AWS_REGION=us-east-1

# CDN
CDN_BASE_URL=https://cdn.example.com

# CORS
CORS_ORIGIN=https://app.example.com

# 日志
LOG_LEVEL=info
```

### 数据库迁移

```bash
# 生成迁移文件
npm run typeorm migration:generate -- -n CreateTables

# 运行迁移
npm run typeorm migration:run

# 回滚迁移
npm run typeorm migration:revert
```

---

## 总结

本设计文档已完全基于 **NestJS + PostgreSQL** 重新设计：

### ✅ 核心改进

1. **数据库层面**
   - 使用 PostgreSQL 替代 MongoDB
   - 利用 JSONB 存储复杂的块结构
   - 使用 tsvector 实现高效全文搜索
   - 强大的事务支持保证数据一致性

2. **框架层面**
   - NestJS 模块化架构
   - TypeORM 作为 ORM
   - 依赖注入和装饰器
   - 完整的 Entity 定义

3. **性能优化**
   - 数据库索引优化
   - Redis 缓存层
   - 连接池配置
   - 批量操作优化

4. **开发体验**
   - TypeScript 全栈类型安全
   - Swagger API 文档
   - 清晰的项目结构
   - 易于测试和维护

### 🚀 实施步骤

**阶段 1：初始化项目**

```bash
# 安装 NestJS CLI
npm i -g @nestjs/cli

# 创建项目
nest new knowledge-base-api

# 安装依赖
npm install @nestjs/typeorm typeorm pg
npm install @nestjs/passport passport passport-jwt
npm install @nestjs/swagger
npm install @nestjs/cache-manager cache-manager
npm install @nestjs/bull bull
```

**阶段 2：数据库设置**

- 创建 PostgreSQL 数据库
- 定义 Entity
- 运行迁移

**阶段 3：核心功能开发**

- 认证模块
- 文档引擎
- API 端点

**阶段 4：测试与部署**

- 单元测试
- 集成测试
- Docker 部署

祝项目开发顺利！🎉
