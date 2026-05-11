# 安全 API <Badge type="warning" text="beta" />

安全模块提供安全日志和审计日志查询功能。

## 接口列表

| 方法 | 路径               | 说明         | 认证 |
| ---- | ------------------ | ------------ | ---- |
| GET  | `/security/events` | 安全日志列表 | 是   |
| GET  | `/security/audit`  | 审计日志列表 | 是   |

## 获取安全日志

**接口：** `GET /api/v1/security/events`

**说明：** 查询安全日志，记录登录、登出、权限拒绝等安全事件

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**查询参数：**

| 参数        | 类型   | 必填 | 说明                                                                                                        |
| ----------- | ------ | ---- | ----------------------------------------------------------------------------------------------------------- |
| `eventType` | string | ❌   | 事件类型（如 `login.success`、`login.failed`、`logout`、`unauthorized`、`permission_denied`、`rate_limit`） |
| `userId`    | string | ❌   | 用户ID                                                                                                      |
| `ip`        | string | ❌   | IP 地址                                                                                                     |
| `startDate` | string | ❌   | 开始日期（ISO 8601 格式）                                                                                   |
| `endDate`   | string | ❌   | 结束日期（ISO 8601 格式）                                                                                   |
| `page`      | number | ❌   | 页码，默认 1                                                                                                |
| `pageSize`  | number | ❌   | 每页数量，默认 20                                                                                           |

**事件类型（eventType）：**

- `login.success` - 登录成功
- `login.failed` - 登录失败
- `logout` - 登出
- `unauthorized` - 未授权访问
- `permission_denied` - 权限拒绝
- `rate_limit` - 限流触发

**响应示例：**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "logId": "log_1705123456789_abc123",
        "eventType": "login.success",
        "userId": "u_1705123456789_abc123",
        "ipAddress": "192.168.1.1",
        "userAgent": "Mozilla/5.0...",
        "details": {},
        "createdAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20
  }
}
```

**状态码：**

- `200 OK` - 获取成功

## 获取审计日志

**接口：** `GET /api/v1/security/audit`

**说明：** 查询审计日志，记录敏感操作和资源变更

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**查询参数：**

| 参数           | 类型   | 必填 | 说明                                           |
| -------------- | ------ | ---- | ---------------------------------------------- |
| `action`       | string | ❌   | 操作类型（如 `CREATE`、`UPDATE`、`DELETE`）    |
| `resourceType` | string | ❌   | 资源类型（如 `document`、`workspace`、`user`） |
| `resourceId`   | string | ❌   | 资源ID                                         |
| `userId`       | string | ❌   | 用户ID（操作者）                               |
| `startDate`    | string | ❌   | 开始日期（ISO 8601 格式）                      |
| `endDate`      | string | ❌   | 结束日期（ISO 8601 格式）                      |
| `page`         | number | ❌   | 页码，默认 1                                   |
| `pageSize`     | number | ❌   | 每页数量，默认 20                              |

**操作类型（action）：**

- `CREATE` - 创建资源
- `UPDATE` - 更新资源
- `DELETE` - 删除资源
- `READ` - 读取资源（敏感资源）

**资源类型（resourceType）：**

- `document` - 文档
- `workspace` - 工作空间
- `user` - 用户
- `asset` - 资产
- 等其他资源类型

**响应示例：**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "auditId": "audit_1705123456789_abc123",
        "action": "CREATE",
        "resourceType": "document",
        "resourceId": "doc_1705123456789_xyz456",
        "userId": "u_1705123456789_abc123",
        "changes": {
          "title": "我的第一篇文档"
        },
        "ipAddress": "192.168.1.1",
        "userAgent": "Mozilla/5.0...",
        "createdAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20
  }
}
```

**说明：**

- 审计日志通过 `@AuditLog` 装饰器自动记录
- 敏感字段会自动脱敏
- 用于合规审计和操作追踪

**状态码：**

- `200 OK` - 获取成功

## 代码示例

### JavaScript / TypeScript

```typescript
// 获取安全日志
async function getSecurityLogs(filters?: any) {
  const url = new URL("http://localhost:5200/api/v1/security/events");
  if (filters?.eventType) {
    url.searchParams.set("eventType", filters.eventType);
  }
  if (filters?.userId) {
    url.searchParams.set("userId", filters.userId);
  }
  if (filters?.ip) {
    url.searchParams.set("ip", filters.ip);
  }
  if (filters?.startDate) {
    url.searchParams.set("startDate", filters.startDate);
  }
  if (filters?.endDate) {
    url.searchParams.set("endDate", filters.endDate);
  }
  url.searchParams.set("page", String(filters?.page || 1));
  url.searchParams.set("pageSize", String(filters?.pageSize || 20));

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return await response.json();
}

// 获取审计日志
async function getAuditLogs(filters?: any) {
  const url = new URL("http://localhost:5200/api/v1/security/audit");
  if (filters?.action) {
    url.searchParams.set("action", filters.action);
  }
  if (filters?.resourceType) {
    url.searchParams.set("resourceType", filters.resourceType);
  }
  if (filters?.resourceId) {
    url.searchParams.set("resourceId", filters.resourceId);
  }
  if (filters?.userId) {
    url.searchParams.set("userId", filters.userId);
  }
  if (filters?.startDate) {
    url.searchParams.set("startDate", filters.startDate);
  }
  if (filters?.endDate) {
    url.searchParams.set("endDate", filters.endDate);
  }
  url.searchParams.set("page", String(filters?.page || 1));
  url.searchParams.set("pageSize", String(filters?.pageSize || 20));

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return await response.json();
}
```
