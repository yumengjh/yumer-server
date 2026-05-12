---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "个人知识库"
  text: "后端系统"
  tagline: 基于 NestJS 构建的现代化知识库管理系统后端 API
  image:
    # src:
    alt: 个人知识库后端
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 查看 API 文档
      link: /api/overview

features:
  - icon: 🔐
    title: 用户认证
    details: JWT Token 认证，支持刷新令牌机制，安全可靠
  - icon: 🏢
    title: 工作空间管理
    details: 多工作空间支持，成员权限管理，灵活的组织架构
  - icon: 📄
    title: 文档管理
    details: 文档树结构，支持父子关系、标签分类，强大的文档组织能力
  - icon: 🧩
    title: 块级编辑
    details: 块（Block）作为文档内容的基础单元，支持丰富的块类型
  - icon: 📚
    title: 版本控制
    details: 块版本历史，文档版本管理，完整的变更追踪
  - icon: 🔍
    title: 全文搜索
    details: 基于 PostgreSQL tsvector 的全文搜索，快速定位内容
  - icon: 🛡️
    title: 权限控制
    details: 细粒度的权限管理（owner、admin、editor、viewer）
  - icon: 📖
    title: API 文档
    details: 集成 Swagger/OpenAPI 自动生成 API 文档
---
