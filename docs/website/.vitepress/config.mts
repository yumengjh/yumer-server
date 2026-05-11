import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "个人知识库后端",
  description: "基于 NestJS 构建的现代化知识库管理系统后端 API 文档",
  lang: "zh-CN",
  base: "/",
  ignoreDeadLinks: [/^http:\/\/localhost/, /^https?:\/\/localhost/],

  themeConfig: {
    returnToTopLabel: "返回顶部",
    sidebarMenuLabel: "菜单",
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "首页", link: "/" },
      { text: "快速开始", link: "/guide/getting-started" },
      { text: "API 文档", link: "/api/overview" },
      // { text: '工作流', link: '/workflow/document-workflow' },
      { text: "设计文档", link: "/design" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "快速开始",
          items: [
            { text: "介绍", link: "/guide/getting-started" },
            { text: "安装配置", link: "/guide/installation" },
            { text: "环境设置", link: "/guide/setup" },
          ],
        },
      ],
      "/api/": [
        {
          text: "API 概览",
          items: [
            { text: "API 总览", link: "/api/overview" },
            { text: "API 使用指南", link: "/api/usage" },
            { text: "OpenAPI 导出", link: "/api/openapi" },
          ],
        },
        {
          text: "核心功能",
          items: [
            { text: "认证 (Auth)", link: "/api/auth" },
            { text: "工作空间 (Workspaces)", link: "/api/workspaces" },
            { text: "文档 (Documents)", link: "/api/documents" },
            { text: "块 (Blocks)", link: "/api/blocks" },
          ],
        },
        {
          text: "增强功能",
          items: [
            { text: "标签 (Tags)", link: "/api/tags" },
            { text: "收藏 (Favorites)", link: "/api/favorites" },
            { text: "评论 (Comments)", link: "/api/comments" },
            { text: "搜索 (Search)", link: "/api/search" },
          ],
        },
        {
          text: "系统功能",
          items: [
            { text: "设置 (Settings)", link: "/api/settings" },
            { text: "活动日志 (Activities)", link: "/api/activities" },
            { text: "资产 (Assets)", link: "/api/assets" },
            { text: "运行时配置 (Runtime Configs)", link: "/api/runtime-configs" },
            { text: "安全 (Security)", link: "/api/security" },
          ],
        },
      ],
      "/workflow/": [
        {
          text: "工作流程",
          items: [
            // { text: '文档操作流程', link: '/workflow/' },
            // { text: '端到端用户旅程', link: '/workflow/' }
          ],
        },
      ],
      "/design/": [
        {
          text: "设计文档",
          items: [
            { text: "运行时配置中心设计", link: "/design/runtime-config-center" },
            { text: "数据结构设计", link: "/design/data-structure-design" },
            { text: "文档块工作机制", link: "/design/block-mechanism" },
            { text: "块移动操作指南", link: "/design/block-movement-guide" },
            { text: "块树构建算法", link: "/design/document-content-pagination" },
          ],
        },
      ],
      "/": [
        {
          text: "文档",
          items: [
            { text: "快速开始", link: "/guide/getting-started" },
            { text: "API 总览", link: "/api/overview" },
            { text: "文档工作流", link: "/workflow/document-workflow" },
          ],
        },
      ],
    },

    socialLinks: [{ icon: "github", link: "https://github.com/yumengjh/notescape-server" }],

    search: {
      provider: "local",
      options: {
        locales: {
          zh: {
            translations: {
              button: {
                buttonText: "搜索文档",
                buttonAriaLabel: "搜索文档",
              },
              modal: {
                noResultsText: "无法找到相关结果",
                resetButtonTitle: "清除查询条件",
                footer: {
                  selectText: "选择",
                  navigateText: "切换",
                },
              },
            },
          },
        },
      },
    },

    footer: {
      message: "基于 NestJS 构建的个人知识库后端系统",
      copyright: "Copyright © 2026 yumengjh",
    },

    editLink: {
      pattern: "https://github.com/yumengjh/notescape-server/edit/main/docs/website/:path",
      text: "在 GitHub 上编辑此页",
    },

    lastUpdated: {
      text: "最后更新于",
      formatOptions: {
        dateStyle: "short",
        timeStyle: "medium",
      },
    },

    docFooter: {
      prev: "上一页",
      next: "下一页",
    },

    outline: {
      label: "页面导航",
      level: "deep",
    },
  },
});
