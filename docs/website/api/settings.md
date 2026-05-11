# 设置 API <Badge type="tip" text="new" />

设置模块用于管理阅读/编辑体验参数，支持：

- 用户设置（跨工作空间）
- 工作空间覆盖设置（团队统一）
- 生效设置计算（含来源映射）

## 站点公开访问说明

`GET /api/v1/workspaces/:workspaceId/settings` 支持通过 `@SitePublic()` 开放给指定站点匿名访问。

- 带 `Authorization`：按登录态校验工作空间权限
- 不带 token：请求来源必须命中 `PUBLIC_SITE_ORIGINS`
- 站点公开模式下仅允许读取可公开访问工作空间的原始覆盖设置
- 返回结构保持不变，仍为 `{ settings: ... }`

## 接口列表

| 方法   | 路径                                | 说明                                | 认证           |
| ------ | ----------------------------------- | ----------------------------------- | -------------- |
| GET    | `/settings/me`                      | 获取当前用户设置（含默认值）        | 是             |
| PATCH  | `/settings/me`                      | 更新当前用户设置（部分更新）        | 是             |
| GET    | `/settings/effective`               | 获取生效设置（可选 workspaceId）    | 是             |
| GET    | `/workspaces/:workspaceId/settings` | 获取工作空间覆盖设置（原始覆盖）    | JWT / 站点公开 |
| PATCH  | `/workspaces/:workspaceId/settings` | 更新工作空间覆盖设置（owner/admin） | 是             |
| DELETE | `/workspaces/:workspaceId/settings` | 清空工作空间覆盖设置（owner/admin） | 是             |

---

## 数据规则

### 默认值

```json
{
  "reader": { "contentWidth": 800, "fontSize": 16 },
  "editor": { "contentWidth": 800, "fontSize": 16 },
  "advanced": {
    "compactList": true,
    "codeFontFamily": "SFMono-Regular, Consolas, \"Liberation Mono\", Menlo, Courier, monospace"
  }
}
```

### 校验范围

- `reader.contentWidth` / `editor.contentWidth`: `680 ~ 1200`
- `reader.fontSize` / `editor.fontSize`: `13 ~ 22`
- `advanced.codeFontFamily`: `1 ~ 500` 字符
- `advanced.compactList`: boolean
- 未知字段：拒绝（400）

### PATCH 语义

- 采用深合并（deep merge）
- 显式传 `null` 表示删除该字段（回退默认值或上层覆盖）

---

## 获取当前用户设置

**接口：** `GET /api/v1/settings/me`

**说明：** 返回用户设置并补齐默认值。

**状态码：**

- `200 OK`
- `401 Unauthorized`

---

## 更新当前用户设置

**接口：** `PATCH /api/v1/settings/me`

**请求体示例：**

```json
{
  "settings": {
    "reader": { "contentWidth": 920 },
    "advanced": { "codeFontFamily": null }
  }
}
```

**说明：**

- `codeFontFamily: null` 表示删除该字段
- 更新后会返回补齐默认值后的用户设置

**状态码：**

- `200 OK`
- `400 Bad Request`
- `401 Unauthorized`

---

## 获取工作空间覆盖设置

**接口：** `GET /api/v1/workspaces/:workspaceId/settings`

**说明：**

- 返回 workspace 原始覆盖设置
- 不与用户设置合并
- 站点公开访问时，前提是请求来源命中 `PUBLIC_SITE_ORIGINS`

**状态码：**

- `200 OK`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`

---

## 更新工作空间覆盖设置

**接口：** `PATCH /api/v1/workspaces/:workspaceId/settings`

**请求体示例：**

```json
{
  "settings": {
    "editor": { "contentWidth": 900, "fontSize": 16 },
    "advanced": { "compactList": false }
  }
}
```

**权限：** 仅 `owner` / `admin`

**状态码：**

- `200 OK`
- `400 Bad Request`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`

---

## 清空工作空间覆盖设置

**接口：** `DELETE /api/v1/workspaces/:workspaceId/settings`

**说明：** 将工作空间覆盖设置重置为 `{}`。

**响应示例：**

```json
{
  "success": true,
  "data": {
    "message": "工作空间设置已清空"
  }
}
```

**状态码：**

- `200 OK`
- `401 Unauthorized`
- `403 Forbidden`
- `404 Not Found`

---

## 获取生效设置

**接口：** `GET /api/v1/settings/effective?workspaceId=ws_xxx`

**说明：**

- 不传 `workspaceId`：只计算用户维度生效值
- 传 `workspaceId`：按 `workspace > user > default` 计算生效值
- 返回三段数据：`userSettings` / `workspaceSettings` / `effectiveSettings`
- 附加 `sources` 字段，标记每个叶子字段来源（`default` / `user` / `workspace`）

**响应示例：**

```json
{
  "success": true,
  "data": {
    "userSettings": {
      "reader": { "contentWidth": 800, "fontSize": 16 },
      "editor": { "contentWidth": 800, "fontSize": 16 },
      "advanced": {
        "compactList": true,
        "codeFontFamily": "SFMono-Regular, Consolas, \"Liberation Mono\", Menlo, Courier, monospace"
      }
    },
    "workspaceSettings": {
      "reader": { "contentWidth": 860 }
    },
    "effectiveSettings": {
      "reader": { "contentWidth": 860, "fontSize": 16 },
      "editor": { "contentWidth": 800, "fontSize": 16 },
      "advanced": {
        "compactList": true,
        "codeFontFamily": "SFMono-Regular, Consolas, \"Liberation Mono\", Menlo, Courier, monospace"
      }
    },
    "sources": {
      "reader.contentWidth": "workspace",
      "reader.fontSize": "user",
      "editor.contentWidth": "default",
      "editor.fontSize": "default",
      "advanced.compactList": "user",
      "advanced.codeFontFamily": "default"
    }
  }
}
```

**状态码：**

- `200 OK`
- `401 Unauthorized`
- `403 Forbidden`（传 workspaceId 且无权限）
- `404 Not Found`（传 workspaceId 且工作空间不存在）

---

## 审计与日志

- `audit_logs`（仅高危操作）：
  - `PATCH /workspaces/:workspaceId/settings`
  - `DELETE /workspaces/:workspaceId/settings`
- `activities`：
  - `settings.workspace.update`
  - `settings.workspace.clear`

> 当前用户设置更新（`PATCH /settings/me`）不写入 `audit_logs`，仅作为普通配置更新处理。
