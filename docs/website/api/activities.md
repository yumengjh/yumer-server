# 活动日志 API <Badge type="warning" text="beta" />

活动日志模块提供用户活动日志查询功能。

## 接口列表

| 方法 | 路径          | 说明         | 认证 |
| ---- | ------------- | ------------ | ---- |
| GET  | `/activities` | 活动日志列表 | 是   |

## 获取活动日志列表

**接口：** `GET /api/v1/activities`

**说明：** 获取工作空间的活动日志，支持多种过滤条件

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**查询参数：**

| 参数          | 类型   | 必填 | 说明                                               |
| ------------- | ------ | ---- | -------------------------------------------------- |
| `workspaceId` | string | ✅   | 工作空间ID                                         |
| `userId`      | string | ❌   | 用户ID（过滤特定用户的活动）                       |
| `action`      | string | ❌   | 操作类型（如 `doc.create`、`block.update` 等）     |
| `entityType`  | string | ❌   | 实体类型（如 `document`、`block`、`workspace` 等） |
| `startDate`   | string | ❌   | 开始日期（ISO 8601 格式）                          |
| `endDate`     | string | ❌   | 结束日期（ISO 8601 格式）                          |
| `page`        | number | ❌   | 页码，默认 1                                       |
| `pageSize`    | number | ❌   | 每页数量，默认 20                                  |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "activityId": "act_1705123456789_abc123",
        "workspaceId": "ws_1705123456789_abc123",
        "userId": "u_1705123456789_xyz456",
        "action": "doc.create",
        "entityType": "document",
        "entityId": "doc_1705123456789_xyz456",
        "details": {
          "title": "我的第一篇文档"
        },
        "metadata": {},
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

**操作类型（action）示例：**

- **工作空间**：`workspace.create`、`workspace.update`、`workspace.delete`
- **成员管理**：`workspace.invite`、`workspace.role`、`workspace.remove`
- **文档**：`doc.create`、`doc.update`、`doc.publish`、`doc.move`、`doc.delete`
- **块**：`block.create`、`block.updateContent`、`block.move`、`block.remove`、`block.batch`
- **收藏**：`favorite.create`、`favorite.remove`
- **评论**：`comment.create`、`comment.delete`
- **标签**：`tag.create`、`tag.update`、`tag.delete`

**实体类型（entityType）示例：**

- `workspace` - 工作空间
- `document` - 文档
- `block` - 块
- `favorite` - 收藏
- `comment` - 评论
- `tag` - 标签

**状态码：**

- `200 OK` - 获取成功
- `400 Bad Request` - 缺少 workspaceId 参数

## 代码示例

### JavaScript / TypeScript

```typescript
// 获取活动日志
async function getActivities(workspaceId: string, filters?: any) {
  const url = new URL("http://localhost:5200/api/v1/activities");
  url.searchParams.set("workspaceId", workspaceId);
  if (filters?.userId) {
    url.searchParams.set("userId", filters.userId);
  }
  if (filters?.action) {
    url.searchParams.set("action", filters.action);
  }
  if (filters?.entityType) {
    url.searchParams.set("entityType", filters.entityType);
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

// 获取特定用户的活动
async function getUserActivities(workspaceId: string, userId: string) {
  return getActivities(workspaceId, { userId });
}

// 获取特定操作类型的活动
async function getDocumentActivities(workspaceId: string) {
  return getActivities(workspaceId, { entityType: "document" });
}
```
