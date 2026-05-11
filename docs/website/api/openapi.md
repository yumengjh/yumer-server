# OpenAPI 导出

本项目支持导出标准 **OpenAPI 3.x** 文档，格式包含 JSON 与 YAML，可直接导入 Apifox、Postman 等 API 调试工具。
并支持在 VitePress 静态站中查看接口文档（无需依赖后端 Swagger UI）。

## 导出命令

```bash
pnpm openapi:export
```

导出后会生成以下文件：

- `openapi/openapi.json`
- `openapi/openapi.yaml`
- `docs/website/public/openapi/openapi.json`
- `docs/website/public/openapi/openapi.yaml`

## 构建静态文档（含 OpenAPI）

```bash
pnpm docs:build
```

`docs:build` 会先执行 `openapi:export`，再构建 VitePress 静态站。
构建完成后可通过 `/swagger/` 访问静态 Swagger UI 页面。

## 导入 Apifox

你可以通过两种方式导入：

- 文件导入：选择 `openapi/openapi.json` 或 `openapi/openapi.yaml`
- URL 导入：部署后使用文档站静态地址，例如：
  - `/openapi/openapi.json`
  - `/openapi/openapi.yaml`

## 生产环境建议

- 生产环境可关闭后端 Swagger UI：
  - `SWAGGER_ENABLED=false`
- 文档直接使用 VitePress 静态产物部署，不依赖后端 Swagger 页面。
- 若仅需静态文档，可不暴露 `/api/v1/docs` 路由。

## 相关命令

```bash
# 构建后端
pnpm build

# 导出 OpenAPI
pnpm openapi:export

# 构建静态文档站（自动导出 OpenAPI）
pnpm docs:build

# 仅构建 VitePress（不重新导出 OpenAPI）
pnpm docs:build:raw
```
