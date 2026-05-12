# 快速开始

欢迎使用个人知识库后端系统！本文档将帮助您快速了解和使用本系统。

## 项目简介

个人知识库后端系统是一个基于 **NestJS** 构建的现代化知识库管理系统后端，提供工作空间、文档、块等核心功能的 RESTful API。

### 核心特性

- **用户认证** - JWT Token 认证，支持刷新令牌机制
- **工作空间管理** - 多工作空间支持，成员权限管理
- **文档管理** - 文档树结构，支持父子关系、标签分类
- **块级编辑** - 块（Block）作为文档内容的基础单元
- **版本控制** - 块版本历史，文档版本管理
- **全文搜索** - 基于 PostgreSQL tsvector 的全文搜索
- **权限控制** - 细粒度的权限管理（owner、admin、editor、viewer）
- **API 文档** - 集成 Swagger/OpenAPI 自动生成 API 文档

## 技术栈

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

## 环境要求

- Node.js >= 18.x
- PostgreSQL >= 15
- pnpm >= 8.x（推荐）或 npm/yarn
