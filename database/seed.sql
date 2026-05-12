-- ============================================
-- 种子数据脚本（开发/测试用）
-- ============================================
-- 警告: 此脚本会清空现有数据！
-- 仅用于开发和测试环境
-- ============================================

-- 清空现有数据（按照外键依赖顺序）
TRUNCATE TABLE 
  activities,
  comments,
  favorites,
  tags,
  assets,
  doc_snapshots,
  doc_revisions,
  block_versions,
  blocks,
  documents,
  workspace_members,
  workspaces,
  sessions,
  users
CASCADE;

-- 重置序列
ALTER SEQUENCE users_id_seq RESTART WITH 1;
ALTER SEQUENCE workspaces_id_seq RESTART WITH 1;
ALTER SEQUENCE workspace_members_id_seq RESTART WITH 1;
ALTER SEQUENCE documents_id_seq RESTART WITH 1;
ALTER SEQUENCE blocks_id_seq RESTART WITH 1;
ALTER SEQUENCE block_versions_id_seq RESTART WITH 1;
ALTER SEQUENCE doc_revisions_id_seq RESTART WITH 1;
ALTER SEQUENCE doc_snapshots_id_seq RESTART WITH 1;
ALTER SEQUENCE assets_id_seq RESTART WITH 1;
ALTER SEQUENCE tags_id_seq RESTART WITH 1;
ALTER SEQUENCE favorites_id_seq RESTART WITH 1;
ALTER SEQUENCE comments_id_seq RESTART WITH 1;
ALTER SEQUENCE activities_id_seq RESTART WITH 1;
ALTER SEQUENCE sessions_id_seq RESTART WITH 1;

-- ============================================
-- 插入测试用户
-- ============================================
-- 密码: "password123" 的 bcrypt 哈希值 (10 rounds)
-- 在实际使用时应该通过应用程序生成
INSERT INTO users (user_id, username, email, password_hash, display_name, bio, status, settings) VALUES
('u_admin001', 'admin', 'admin@example.com', '$2b$10$rKvVLZ5L4u5Z5Z5Z5Z5Z5u5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5u', 'System Admin', '系统管理员账户', 'active', '{"theme": "dark", "language": "zh-CN"}'),
('u_user001', 'john', 'john@example.com', '$2b$10$rKvVLZ5L4u5Z5Z5Z5Z5Z5u5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5u', 'John Doe', '软件工程师，喜欢记录技术笔记', 'active', '{"theme": "light", "language": "en"}'),
('u_user002', 'jane', 'jane@example.com', '$2b$10$rKvVLZ5L4u5Z5Z5Z5Z5Z5u5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5u', 'Jane Smith', '产品经理，热爱知识管理', 'active', '{"theme": "light", "language": "zh-CN"}'),
('u_user003', 'bob', 'bob@example.com', '$2b$10$rKvVLZ5L4u5Z5Z5Z5Z5Z5u5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5Z5u', 'Bob Wilson', 'UI/UX设计师', 'active', '{}');

-- ============================================
-- 插入工作空间
-- ============================================
INSERT INTO workspaces (workspace_id, name, description, icon, owner_id, status, settings) VALUES
('ws_personal001', 'John的个人空间', '个人知识库和笔记', '📚', 'u_user001', 'active', '{"defaultPermission": "private"}'),
('ws_team001', '技术团队空间', '团队协作和文档共享', '💼', 'u_admin001', 'active', '{"defaultPermission": "workspace"}'),
('ws_personal002', 'Jane的个人空间', '产品设计和研究', '🎨', 'u_user002', 'active', '{}');

-- ============================================
-- 插入工作空间成员
-- ============================================
INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES
-- John 的空间
('ws_personal001', 'u_user001', 'owner', NULL),

-- 团队空间
('ws_team001', 'u_admin001', 'owner', NULL),
('ws_team001', 'u_user001', 'editor', 'u_admin001'),
('ws_team001', 'u_user002', 'editor', 'u_admin001'),
('ws_team001', 'u_user003', 'viewer', 'u_admin001'),

-- Jane 的空间
('ws_personal002', 'u_user002', 'owner', NULL);

-- ============================================
-- 插入文档
-- ============================================
INSERT INTO documents (
  doc_id, workspace_id, title, icon, cover,
  head, published_head, root_block_id,
  created_by, updated_by,
  status, visibility,
  parent_id, sort_order,
  tags, category
) VALUES
-- John 的文档
(
  'doc_tech001', 'ws_personal001', 'JavaScript 学习笔记', '📝', NULL,
  1, 0, 'b_root001',
  'u_user001', 'u_user001',
  'normal', 'private',
  NULL, 0,
  ARRAY['JavaScript', '前端开发', '学习笔记'], 'programming'
),
(
  'doc_tech002', 'ws_personal001', 'NestJS 最佳实践', '🚀', NULL,
  1, 1, 'b_root002',
  'u_user001', 'u_user001',
  'normal', 'workspace',
  NULL, 1,
  ARRAY['NestJS', 'Node.js', '后端开发'], 'programming'
),

-- 团队文档
(
  'doc_team001', 'ws_team001', '项目技术方案', '📋', NULL,
  2, 1, 'b_root003',
  'u_admin001', 'u_user001',
  'normal', 'workspace',
  NULL, 0,
  ARRAY['技术方案', '架构设计'], 'project'
),
(
  'doc_team002', 'ws_team001', 'API 接口文档', '🔌', NULL,
  1, 1, 'b_root004',
  'u_user001', 'u_user001',
  'normal', 'workspace',
  NULL, 1,
  ARRAY['API', '接口文档'], 'documentation'
),

-- Jane 的文档
(
  'doc_design001', 'ws_personal002', '用户体验设计指南', '🎨', NULL,
  1, 0, 'b_root005',
  'u_user002', 'u_user002',
  'draft', 'private',
  NULL, 0,
  ARRAY['UX', '设计', '指南'], 'design'
);

-- ============================================
-- 插入块（简化示例）
-- ============================================
INSERT INTO blocks (
  block_id, doc_id, type,
  created_at, created_by,
  latest_ver, latest_at, latest_by,
  is_deleted
) VALUES
-- 文档根块
('b_root001', 'doc_tech001', 'root', 1705449600000, 'u_user001', 1, 1705449600000, 'u_user001', false),
('b_root002', 'doc_tech002', 'root', 1705449600000, 'u_user001', 1, 1705449600000, 'u_user001', false),
('b_root003', 'doc_team001', 'root', 1705449600000, 'u_admin001', 1, 1705449600000, 'u_admin001', false),
('b_root004', 'doc_team002', 'root', 1705449600000, 'u_user001', 1, 1705449600000, 'u_user001', false),
('b_root005', 'doc_design001', 'root', 1705449600000, 'u_user002', 1, 1705449600000, 'u_user002', false),

-- 内容块示例
('b_para001', 'doc_tech001', 'paragraph', 1705449600000, 'u_user001', 1, 1705449600000, 'u_user001', false),
('b_head001', 'doc_tech001', 'heading', 1705449600000, 'u_user001', 1, 1705449600000, 'u_user001', false),
('b_code001', 'doc_tech001', 'code', 1705449600000, 'u_user001', 1, 1705449600000, 'u_user001', false);

-- ============================================
-- 插入块版本
-- ============================================
INSERT INTO block_versions (
  version_id, doc_id, block_id, ver,
  created_at, created_by,
  parent_id, sort_key, indent, collapsed,
  payload, hash, plain_text, refs
) VALUES
-- 根块版本
(
  'b_root001@1', 'doc_tech001', 'b_root001', 1,
  1705449600000, 'u_user001',
  'ROOT', 'a0', 0, false,
  '{"type": "root", "children": ["b_head001", "b_para001", "b_code001"]}',
  'hash_root001',
  '',
  '[]'
),

-- 标题块
(
  'b_head001@1', 'doc_tech001', 'b_head001', 1,
  1705449600000, 'u_user001',
  'b_root001', 'a0', 0, false,
  '{"type": "heading", "level": 1, "text": [{"text": "JavaScript 基础"}]}',
  'hash_head001',
  'JavaScript 基础',
  '[]'
),

-- 段落块
(
  'b_para001@1', 'doc_tech001', 'b_para001', 1,
  1705449600000, 'u_user001',
  'b_root001', 'a1', 0, false,
  '{"type": "paragraph", "text": [{"text": "JavaScript 是一门强大的编程语言，主要用于 Web 开发。"}]}',
  'hash_para001',
  'JavaScript 是一门强大的编程语言，主要用于 Web 开发。',
  '[]'
),

-- 代码块
(
  'b_code001@1', 'doc_tech001', 'b_code001', 1,
  1705449600000, 'u_user001',
  'b_root001', 'a2', 0, false,
  '{"type": "code", "language": "javascript", "code": "console.log(''Hello, World!'');"}',
  'hash_code001',
  'console.log(''Hello, World!'');',
  '[]'
);

-- ============================================
-- 插入文档修订
-- ============================================
INSERT INTO doc_revisions (
  revision_id, doc_id, doc_ver,
  created_at, created_by, message, branch,
  patches, root_block_id,
  source, op_summary
) VALUES
(
  'doc_tech001@1', 'doc_tech001', 1,
  1705449600000, 'u_user001', '初始化文档', 'draft',
  '[{"op": "create", "blockId": "b_root001", "version": 1}]',
  'b_root001',
  'editor',
  '{"created": 4, "updated": 0, "deleted": 0}'
);

-- ============================================
-- 插入标签
-- ============================================
INSERT INTO tags (
  tag_id, workspace_id, name, color,
  created_by, usage_count
) VALUES
('tag_001', 'ws_personal001', 'JavaScript', '#F7DF1E', 'u_user001', 1),
('tag_002', 'ws_personal001', '前端开发', '#61DAFB', 'u_user001', 1),
('tag_003', 'ws_team001', '技术方案', '#3178C6', 'u_admin001', 1),
('tag_004', 'ws_team001', 'API', '#68A063', 'u_user001', 1),
('tag_005', 'ws_personal002', 'UX', '#FF6B6B', 'u_user002', 1);

-- ============================================
-- 插入收藏
-- ============================================
INSERT INTO favorites (user_id, doc_id) VALUES
('u_user001', 'doc_tech002'),
('u_user002', 'doc_team001'),
('u_admin001', 'doc_team002');

-- ============================================
-- 插入评论
-- ============================================
INSERT INTO comments (
  comment_id, doc_id, block_id,
  user_id, content, mentions,
  parent_comment_id, is_deleted
) VALUES
(
  'cmt_001', 'doc_team001', 'b_root003',
  'u_user001', '这个技术方案很详细，我有一些建议。',
  ARRAY['u_admin001'],
  NULL, false
),
(
  'cmt_002', 'doc_team001', 'b_root003',
  'u_admin001', '好的，欢迎提出你的建议！',
  ARRAY['u_user001'],
  'cmt_001', false
);

-- ============================================
-- 插入活动日志
-- ============================================
INSERT INTO activities (
  activity_id, workspace_id,
  action, entity_type, entity_id,
  user_id, details, metadata
) VALUES
(
  'act_001', 'ws_personal001',
  'create', 'document', 'doc_tech001',
  'u_user001',
  '{"title": "JavaScript 学习笔记"}',
  '{"source": "web"}'
),
(
  'act_002', 'ws_team001',
  'update', 'document', 'doc_team001',
  'u_user001',
  '{"changes": ["content"]}',
  '{"source": "web"}'
),
(
  'act_003', 'ws_team001',
  'comment', 'document', 'doc_team001',
  'u_user001',
  '{"commentId": "cmt_001"}',
  '{"source": "web"}'
);

-- ============================================
-- 完成
-- ============================================
\echo '种子数据插入完成'
\echo ''
\echo '测试账户:'
\echo '  管理员: admin@example.com / password123'
\echo '  用户1:  john@example.com / password123'
\echo '  用户2:  jane@example.com / password123'
\echo '  用户3:  bob@example.com / password123'
\echo ''
\echo '注意: 密码哈希仅为示例，实际部署时请通过应用程序生成'
