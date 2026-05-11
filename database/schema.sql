-- ============================================
-- 个人知识库系统 - PostgreSQL 数据库架构
-- ============================================
-- 创建日期: 2026-01-17
-- 数据库版本: PostgreSQL 15+
-- ============================================

-- 创建数据库（可选，根据实际情况决定是否执行）
-- CREATE DATABASE knowledge_base;
-- \c knowledge_base;

-- 启用必要的扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- 用于模糊搜索

-- ============================================
-- 1. 用户表 (users)
-- ============================================
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
  
  CONSTRAINT check_users_status CHECK (status IN ('active', 'suspended', 'deleted'))
);

-- 索引
CREATE INDEX idx_users_user_id ON users(user_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_status ON users(status);

-- 注释
COMMENT ON TABLE users IS '用户表';
COMMENT ON COLUMN users.user_id IS '用户唯一标识符';
COMMENT ON COLUMN users.status IS '用户状态: active-活跃, suspended-暂停, deleted-已删除';
COMMENT ON COLUMN users.settings IS '用户设置(JSON)';

-- ============================================
-- 2. 工作空间表 (workspaces)
-- ============================================
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
  CONSTRAINT check_workspaces_status CHECK (status IN ('active', 'archived'))
);

-- 索引
CREATE INDEX idx_workspaces_workspace_id ON workspaces(workspace_id);
CREATE INDEX idx_workspaces_owner_id ON workspaces(owner_id);
CREATE INDEX idx_workspaces_status ON workspaces(status);

-- 注释
COMMENT ON TABLE workspaces IS '工作空间表';
COMMENT ON COLUMN workspaces.status IS '工作空间状态: active-活跃, archived-已归档';

-- ============================================
-- 3. 工作空间成员表 (workspace_members)
-- ============================================
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
  CONSTRAINT check_workspace_members_role CHECK (role IN ('owner', 'admin', 'editor', 'viewer'))
);

-- 索引
CREATE INDEX idx_workspace_members_workspace_id ON workspace_members(workspace_id);
CREATE INDEX idx_workspace_members_user_id ON workspace_members(user_id);

-- 注释
COMMENT ON TABLE workspace_members IS '工作空间成员表';
COMMENT ON COLUMN workspace_members.role IS '成员角色: owner-所有者, admin-管理员, editor-编辑者, viewer-查看者';

-- ============================================
-- 4. 文档表 (documents)
-- ============================================
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
  
  CONSTRAINT check_documents_status CHECK (status IN ('draft', 'normal', 'archived', 'deleted')),
  CONSTRAINT check_documents_visibility CHECK (visibility IN ('private', 'workspace', 'public'))
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

-- 注释
COMMENT ON TABLE documents IS '文档表';
COMMENT ON COLUMN documents.head IS '当前最新版本号';
COMMENT ON COLUMN documents.published_head IS '已发布版本号';
COMMENT ON COLUMN documents.status IS '文档状态: draft-草稿, normal-正常, archived-已归档, deleted-已删除';
COMMENT ON COLUMN documents.visibility IS '可见性: private-私有, workspace-工作空间, public-公开';

-- ============================================
-- 5. 块身份表 (blocks)
-- ============================================
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

-- 注释
COMMENT ON TABLE blocks IS '块身份表';
COMMENT ON COLUMN blocks.type IS '块类型: root, paragraph, heading, listItem, code, quote, image 等';
COMMENT ON COLUMN blocks.created_at IS '创建时间(Unix毫秒时间戳)';
COMMENT ON COLUMN blocks.latest_ver IS '最新版本号';

-- ============================================
-- 6. 块版本表 (block_versions)
-- ============================================
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

-- 注释
COMMENT ON TABLE block_versions IS '块版本表';
COMMENT ON COLUMN block_versions.version_id IS '版本唯一标识: blockId@ver';
COMMENT ON COLUMN block_versions.sort_key IS '排序键，用于块的位置排序';
COMMENT ON COLUMN block_versions.payload IS '块内容载荷(JSON)';
COMMENT ON COLUMN block_versions.hash IS '内容哈希值，用于去重';

-- ============================================
-- 7. 文档修订表 (doc_revisions)
-- ============================================
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

-- 注释
COMMENT ON TABLE doc_revisions IS '文档修订表，类似Git提交';
COMMENT ON COLUMN doc_revisions.message IS '修订提交信息';
COMMENT ON COLUMN doc_revisions.branch IS '分支: draft-草稿, published-已发布';
COMMENT ON COLUMN doc_revisions.patches IS '变更集数组(JSON)';

-- ============================================
-- 8. 文档快照表 (doc_snapshots)
-- ============================================
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

-- 注释
COMMENT ON TABLE doc_snapshots IS '文档快照表，存储文档某个版本的完整状态';
COMMENT ON COLUMN doc_snapshots.block_version_map IS '块版本映射(JSON): {blockId: version}';

-- ============================================
-- 9. 资产表 (assets)
-- ============================================
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
  
  CONSTRAINT check_assets_status CHECK (status IN ('active', 'deleted')),
  CONSTRAINT check_assets_storage_provider CHECK (storage_provider IN ('local', 's3', 'oss', 'cos'))
);

-- 索引
CREATE INDEX idx_assets_asset_id ON assets(asset_id);
CREATE INDEX idx_assets_workspace_id ON assets(workspace_id);
CREATE INDEX idx_assets_uploaded_by ON assets(uploaded_by);
CREATE INDEX idx_assets_mime_type ON assets(mime_type);

-- 注释
COMMENT ON TABLE assets IS '资产表，存储图片、文件等';
COMMENT ON COLUMN assets.storage_provider IS '存储提供商: local-本地, s3-AWS S3, oss-阿里云OSS, cos-腾讯云COS';
COMMENT ON COLUMN assets.ref_count IS '引用计数';

-- ============================================
-- 10. 标签表 (tags)
-- ============================================
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

-- 注释
COMMENT ON TABLE tags IS '标签表';
COMMENT ON COLUMN tags.usage_count IS '标签使用次数';

-- ============================================
-- 11. 收藏表 (favorites)
-- ============================================
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

-- 注释
COMMENT ON TABLE favorites IS '收藏表';

-- ============================================
-- 12. 评论表 (comments)
-- ============================================
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

-- 注释
COMMENT ON TABLE comments IS '评论表';
COMMENT ON COLUMN comments.mentions IS '提到的用户ID数组';
COMMENT ON COLUMN comments.parent_comment_id IS '父评论ID，用于评论回复';

-- ============================================
-- 13. 活动日志表 (activities)
-- ============================================
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

-- 注释
COMMENT ON TABLE activities IS '活动日志表';
COMMENT ON COLUMN activities.action IS '操作类型: create, update, delete, move, share, comment 等';
COMMENT ON COLUMN activities.entity_type IS '实体类型: document, block, workspace 等';

-- ============================================
-- 14. 会话表 (sessions)
-- ============================================
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

-- 注释
COMMENT ON TABLE sessions IS '用户会话表';
COMMENT ON COLUMN sessions.device_info IS '设备信息(JSON)';

-- ============================================
-- 清理过期会话的函数（可选）
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_expired_sessions() RETURNS void AS $$
BEGIN
  DELETE FROM sessions WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- 可以配合 pg_cron 扩展定期执行
-- SELECT cron.schedule('cleanup-sessions', '0 * * * *', 'SELECT cleanup_expired_sessions();');

-- ============================================
-- 自动更新 updated_at 字段的触发器函数
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 为需要的表添加触发器
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON workspaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_comments_updated_at BEFORE UPDATE ON comments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 视图：用户工作空间权限
-- ============================================
CREATE OR REPLACE VIEW user_workspace_permissions AS
SELECT 
    wm.user_id,
    wm.workspace_id,
    w.name AS workspace_name,
    wm.role,
    w.owner_id = wm.user_id AS is_owner
FROM workspace_members wm
JOIN workspaces w ON wm.workspace_id = w.workspace_id;

COMMENT ON VIEW user_workspace_permissions IS '用户工作空间权限视图';

-- ============================================
-- 视图：文档统计
-- ============================================
CREATE OR REPLACE VIEW document_statistics AS
SELECT 
    d.doc_id,
    d.title,
    d.workspace_id,
    d.created_by,
    d.updated_at,
    COUNT(DISTINCT b.id) AS block_count,
    COUNT(DISTINCT f.id) AS favorite_count,
    COUNT(DISTINCT c.id) AS comment_count
FROM documents d
LEFT JOIN blocks b ON d.doc_id = b.doc_id AND b.is_deleted = FALSE
LEFT JOIN favorites f ON d.doc_id = f.doc_id
LEFT JOIN comments c ON d.doc_id = c.doc_id AND c.is_deleted = FALSE
WHERE d.status != 'deleted'
GROUP BY d.id, d.doc_id, d.title, d.workspace_id, d.created_by, d.updated_at;

COMMENT ON VIEW document_statistics IS '文档统计视图';

-- ============================================
-- 结束
-- ============================================
-- 数据库架构创建完成
