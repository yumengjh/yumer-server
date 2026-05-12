# 设置系统接口设计（可插拔模块版，与 `/api/v1` 统一范式）

本文档定义“阅读/编辑体验设置”的后端接口与存储设计，面向可插拔复用场景（可迁移到其他项目）。

- 前缀：`/api/v1`
- 成功响应：`{ "success": true, "data": ... }`
- 失败响应：`{ "success": false, "error": { "code": "...", "message": "..." } }`
- 鉴权：除特别说明外均需 `Authorization: Bearer <accessToken>`

---

## 1. 设计目标

支持两层配置：

1. 用户级默认偏好（跨工作空间）
2. 工作空间级覆盖（团队统一）

最终生效值：

```txt
effective = deepMerge(userSettingsWithDefaults, workspaceSettings)
```

首期字段：

- `reader.contentWidth`：阅读区域宽度（px）
- `reader.fontSize`：阅读字体大小（px）
- `editor.contentWidth`：编辑区域宽度（px）
- `editor.fontSize`：编辑字体大小（px）
- `advanced.compactList`：列表是否紧凑
- `advanced.codeFontFamily`：代码字体栈

---

## 2. 已确认的架构决策（评审基线）

1. 使用**独立设置表**，不再以 `users.settings` / `workspaces.settings` 作为运行时主数据源。
2. 采用**单表多作用域**模型（`scopeType + scopeId`）。
3. 表与业务表**不建外键**（仅索引），保证可插拔迁移能力。
4. 旧字段数据执行**一次性迁移**到新表，迁移后仅读写新表。
5. 默认值与字段校验规则由 `settings` 模块内部维护，并支持模块注册时覆写。
6. 不做 settings 版本历史表（仅保留当前值，变更追踪靠 activities/audit）。
7. PATCH 语义：`null` 表示删除该字段（回退默认值或上层覆盖）。
8. 未知字段采用严格模式：**直接 400 拒绝**。
9. `GET /settings/effective` 返回三段 + `sources`（来源映射）。
10. 审计策略：仅高危写操作进 `audit_logs`（见第 8 节）。

---

## 3. 数据模型（新增独立表）

## 3.1 表：`settings_profiles`

建议结构：

| 字段         | 类型               | 说明                                  |
| ------------ | ------------------ | ------------------------------------- |
| `id`         | bigint PK          | 自增主键                              |
| `profile_id` | varchar(64) unique | 业务ID（如 `sp_xxx`）                 |
| `scope_type` | varchar(20)        | 作用域：`user` / `workspace`          |
| `scope_id`   | varchar(64)        | 作用域实体ID（userId 或 workspaceId） |
| `settings`   | jsonb              | 设置内容，默认 `{}`                   |
| `created_at` | timestamptz        | 创建时间                              |
| `updated_at` | timestamptz        | 更新时间                              |

建议约束与索引：

- `UNIQUE(scope_type, scope_id)`
- `INDEX(scope_type)`
- `INDEX(scope_id)`
- （可选）`GIN(settings)`

> 说明：不建立 users/workspaces 外键，存在性与权限由服务层校验。

## 3.2 历史字段策略

- `users.settings`、`workspaces.settings` 仅用于一次性迁移来源。
- 迁移完成后，运行时不再读取这两列。

---

## 4. 默认值与校验规则

默认值（模块内常量，读取时补齐，不强制写库）：

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

校验约束：

- `contentWidth`：`680 ~ 1200`
- `fontSize`：`13 ~ 22`
- `codeFontFamily`：`1 ~ 500` 字符
- `compactList`：boolean
- 未知字段：拒绝（400）

---

## 5. 合并与覆盖规则

## 5.1 PATCH 更新规则

- 输入仅接受 `{ settings: { ... } }`
- 深合并（deep merge）
- 任意字段显式传 `null`：删除该字段
- 合并后进行完整白名单/范围校验

## 5.2 生效设置规则

- 不传 `workspaceId`：
  - `userSettings = deepMerge(defaults, userRaw)`
  - `workspaceSettings = {}`
  - `effectiveSettings = userSettings`
- 传 `workspaceId`：
  - 先校验工作空间访问权限
  - `effectiveSettings = deepMerge(userSettings, workspaceRaw)`

---

## 6. 接口列表

| 方法   | 路径                                | 说明                             | 权限         |
| ------ | ----------------------------------- | -------------------------------- | ------------ |
| GET    | `/settings/me`                      | 获取当前用户设置                 | 登录用户     |
| PATCH  | `/settings/me`                      | 更新当前用户设置（部分更新）     | 登录用户     |
| GET    | `/workspaces/:workspaceId/settings` | 获取工作空间覆盖设置             | 工作空间成员 |
| PATCH  | `/workspaces/:workspaceId/settings` | 更新工作空间覆盖设置（部分更新） | owner/admin  |
| DELETE | `/workspaces/:workspaceId/settings` | 清空工作空间覆盖设置             | owner/admin  |
| GET    | `/settings/effective`               | 获取生效设置（可带 workspaceId） | 登录用户     |

---

## 7. 接口详细定义

## 7.1 `GET /api/v1/settings/me`

说明：返回用户层完整设置（默认值已补齐）。

响应：

```json
{
  "success": true,
  "data": {
    "settings": {
      "reader": { "contentWidth": 800, "fontSize": 16 },
      "editor": { "contentWidth": 800, "fontSize": 16 },
      "advanced": {
        "compactList": true,
        "codeFontFamily": "SFMono-Regular, Consolas, \"Liberation Mono\", Menlo, Courier, monospace"
      }
    }
  }
}
```

状态码：`200 / 401`

## 7.2 `PATCH /api/v1/settings/me`

说明：部分更新，服务端深合并后写入 `settings_profiles(scope_type=user)`。

请求体：

```json
{
  "settings": {
    "reader": { "contentWidth": 920 },
    "advanced": { "codeFontFamily": null }
  }
}
```

> 上例中 `codeFontFamily: null` 表示删除该字段，最终回退到默认值。

状态码：`200 / 400 / 401`

## 7.3 `GET /api/v1/workspaces/:workspaceId/settings`

说明：返回 workspace 覆盖设置（原始覆盖，不与用户设置合并）。

状态码：`200 / 401 / 403 / 404`

## 7.4 `PATCH /api/v1/workspaces/:workspaceId/settings`

说明：owner/admin 可更新，深合并写入 `settings_profiles(scope_type=workspace)`。

状态码：`200 / 400 / 401 / 403 / 404`

## 7.5 `DELETE /api/v1/workspaces/:workspaceId/settings`

说明：将工作空间覆盖设置清空为 `{}`。

响应：

```json
{
  "success": true,
  "data": {
    "message": "工作空间设置已清空"
  }
}
```

状态码：`200 / 401 / 403 / 404`

## 7.6 `GET /api/v1/settings/effective?workspaceId=ws_xxx`

说明：

- 返回统一三段结构：`userSettings` / `workspaceSettings` / `effectiveSettings`
- 仅该接口增加 `sources` 顶层来源映射（default/user/workspace）

响应示例：

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

状态码：`200 / 401 / 403 / 404`

---

## 8. 审计与活动日志策略（确认版）

## 8.1 审计表 `audit_logs`（仅高危）

仅以下高危写操作使用 `@AuditLog` 进入审计表：

- `PATCH /workspaces/:workspaceId/settings`
- `DELETE /workspaces/:workspaceId/settings`

建议资源类型：`workspace_settings`

## 8.2 活动日志 `activities`

写操作记录 activities（不记录 GET）：

- `settings.workspace.update`
- `settings.workspace.clear`

> 说明：`PATCH /settings/me` 不写入 activities（当前 activities 模型要求绑定 workspaceId）。

建议 details：`{ before, patch, after }`（必要时脱敏）

---

## 9. 错误码建议

- `SETTINGS_INVALID_WIDTH`
- `SETTINGS_INVALID_FONT_SIZE`
- `SETTINGS_INVALID_CODE_FONT`
- `SETTINGS_FORBIDDEN`
- `SETTINGS_WORKSPACE_NOT_FOUND`
- `SETTINGS_VALIDATION_FAILED`

错误示例：

```json
{
  "success": false,
  "error": {
    "code": "SETTINGS_INVALID_WIDTH",
    "message": "reader.contentWidth 超出允许范围(680~1200)"
  }
}
```

---

## 10. 迁移与兼容策略

1. 发布 migration 创建 `settings_profiles`。
2. 一次性迁移：
   - `users.settings -> scope_type=user`
   - `workspaces.settings -> scope_type=workspace`
3. 迁移后运行时仅读写 `settings_profiles`。
4. 保留旧字段一段时间用于回滚，后续可清理。

---

## 11. 验收要点（实现前评审清单）

- [ ] 单表多作用域模型落地
- [ ] 严格白名单校验与范围校验
- [ ] PATCH `null` 删除语义落地
- [ ] `/settings/effective` 返回 `sources`
- [ ] 仅高危 workspace 写操作进入 `audit_logs`
- [ ] 数据迁移脚本与回滚策略明确

---

## 12. 与 Swagger 注释对齐清单（逐条）

| 接口                                       | 文档状态码            | Swagger 状态码        | 对齐结果 |
| ------------------------------------------ | --------------------- | --------------------- | -------- |
| `GET /settings/me`                         | `200/401`             | `200/401`             | ✅       |
| `PATCH /settings/me`                       | `200/400/401`         | `200/400/401`         | ✅       |
| `GET /workspaces/:workspaceId/settings`    | `200/401/403/404`     | `200/401/403/404`     | ✅       |
| `PATCH /workspaces/:workspaceId/settings`  | `200/400/401/403/404` | `200/400/401/403/404` | ✅       |
| `DELETE /workspaces/:workspaceId/settings` | `200/401/403/404`     | `200/401/403/404`     | ✅       |
| `GET /settings/effective`                  | `200/401/403/404`     | `200/401/403/404`     | ✅       |

补充对齐点：

- `GET /settings/effective` 的 Swagger 描述已明确返回 `userSettings / workspaceSettings / effectiveSettings / sources`。
- 高危审计接口（workspace PATCH/DELETE）已通过 `@AuditLog` 标注，与第 8.1 节一致。
