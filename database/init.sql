-- ============================================
-- 数据库初始化脚本
-- ============================================
-- 此脚本用于快速设置开发和测试环境
-- ============================================

-- 创建数据库（如果不存在）
SELECT 'CREATE DATABASE knowledge_base'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'knowledge_base');

-- 连接到数据库
\c knowledge_base;

-- 启用扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 输出信息
\echo '数据库初始化完成'
\echo '下一步: 执行 schema.sql 创建表结构'
