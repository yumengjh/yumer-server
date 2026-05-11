# 运行时配置 API <Badge type="tip" text="new" />

运行时配置模块用于**在线调整后端系统级行为**，无需重启服务。  
第一阶段已支持全局限流配置热更新。

> 说明：该模块与用户偏好设置（`/settings/*`）解耦，属于运维级配置中心。
>
> 当前 publish 站点白名单 `PUBLIC_SITE_ORIGINS` **还不在运行时配置中心内管理**，仍通过环境变量静态加载，并同时用于 `@SitePublic()` 守卫与 CORS 白名单。
>
> 同时可通过 `PUBLIC_SITE_ALLOW_NO_ORIGIN` 控制是否允许不带 `Origin` / `Referer` 的匿名请求访问 `@SitePublic()` 接口；该开关不影响普通 JWT 保护接口。

## 鉴权方式

运行时配置接口不使用 JWT，而是使用独立管理员令牌：

```http
x-system-admin-token: <SYSTEM_ADMIN_TOKEN>
```

可选传入操作人标识（用于审计）：

```http
x-operator-id: ops_user_001
```

## 接口列表

| 方法  | 路径                                | 说明                     |
| ----- | ----------------------------------- | ------------------------ |
| GET   | `/runtime-configs/rate-limit`       | 读取当前限流配置         |
| PATCH | `/runtime-configs/rate-limit`       | 更新限流配置（部分更新） |
| POST  | `/runtime-configs/rate-limit/reset` | 重置为环境变量默认值     |

## 读取限流配置

**接口：** `GET /api/v1/runtime-configs/rate-limit`

### 响应示例

```json
{
  "success": true,
  "data": {
    "key": "rate_limit",
    "value": {
      "enabled": true,
      "ttlMs": 60000,
      "limit": 100
    },
    "updatedAt": "2026-02-14T09:36:18.271Z"
  }
}
```

## 更新限流配置

**接口：** `PATCH /api/v1/runtime-configs/rate-limit`

### 请求体（可部分更新）

```json
{
  "enabled": true,
  "ttlMs": 60000,
  "limit": 100
}
```

### 字段说明

| 字段      | 类型    | 必填 | 约束              | 说明                 |
| --------- | ------- | ---- | ----------------- | -------------------- |
| `enabled` | boolean | 否   | -                 | 是否启用全局限流     |
| `ttlMs`   | number  | 否   | `1000 ~ 86400000` | 时间窗口（毫秒）     |
| `limit`   | number  | 否   | `1 ~ 100000`      | 时间窗口内最大请求数 |

### 响应示例

```json
{
  "success": true,
  "data": {
    "key": "rate_limit",
    "value": {
      "enabled": true,
      "ttlMs": 30000,
      "limit": 50
    },
    "updatedAt": "2026-02-14T09:40:52.681Z"
  }
}
```

## 重置限流配置

**接口：** `POST /api/v1/runtime-configs/rate-limit/reset`

该接口将配置重置为环境变量默认值：

- `RATE_LIMIT_ENABLED`
- `RATE_LIMIT_TTL`
- `RATE_LIMIT_MAX`

### 响应示例

```json
{
  "success": true,
  "data": {
    "key": "rate_limit",
    "value": {
      "enabled": true,
      "ttlMs": 60000,
      "limit": 100
    },
    "updatedAt": "2026-02-14T09:41:10.263Z"
  }
}
```

## 常见操作示例

### 临时关闭限流（批处理导入）

```bash
curl -X PATCH "http://localhost:5200/api/v1/runtime-configs/rate-limit" \
  -H "Content-Type: application/json" \
  -H "x-system-admin-token: <SYSTEM_ADMIN_TOKEN>" \
  -H "x-operator-id: batch_import_bot" \
  -d '{"enabled": false}'
```

### 导入结束后恢复并收紧

```bash
curl -X PATCH "http://localhost:5200/api/v1/runtime-configs/rate-limit" \
  -H "Content-Type: application/json" \
  -H "x-system-admin-token: <SYSTEM_ADMIN_TOKEN>" \
  -d '{"enabled": true, "ttlMs": 60000, "limit": 80}'
```

## 错误码建议

| HTTP 状态 | 场景                           | 建议处理               |
| --------- | ------------------------------ | ---------------------- |
| `400`     | 参数格式/范围不合法            | 修正参数后重试         |
| `403`     | 管理员令牌缺失或无效           | 校验请求头与服务端配置 |
| `429`     | 业务请求触发限流（非配置接口） | 客户端退避重试         |
