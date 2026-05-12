# 搜索 API <Badge type="warning" text="beta" />

搜索模块提供全局搜索和高级搜索功能。

## 接口列表

| 方法 | 路径               | 说明     | 认证 |
| ---- | ------------------ | -------- | ---- |
| GET  | `/search`          | 全局搜索 | 是   |
| POST | `/search/advanced` | 高级搜索 | 是   |

---

## 全局搜索

**接口：** `GET /api/v1/search`

**说明：** 全局搜索文档和块内容

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**查询参数：**

| 参数          | 类型   | 必填 | 说明                                                        |
| ------------- | ------ | ---- | ----------------------------------------------------------- |
| `query`       | string | ✅   | 搜索关键词                                                  |
| `workspaceId` | string | ❌   | 工作空间ID（不传则搜索所有有权限的工作空间）                |
| `type`        | string | ❌   | 搜索类型：`doc`（文档）、`block`（块）、`all`（全部，默认） |
| `page`        | number | ❌   | 页码，默认 1                                                |
| `pageSize`    | number | ❌   | 每页数量，默认 20                                           |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "type": "document",
        "docId": "doc_1705123456789_xyz456",
        "title": "我的第一篇文档",
        "icon": "📄",
        "workspaceId": "ws_1705123456789_abc123",
        "rank": 0.95
      },
      {
        "type": "block",
        "blockId": "b_1705123456790_block001",
        "docId": "doc_1705123456789_xyz456",
        "docTitle": "我的第一篇文档",
        "content": "这是第一段内容",
        "rank": 0.85
      }
    ],
    "total": 2,
    "page": 1,
    "pageSize": 20
  }
}
```

**搜索说明：**

- **文档搜索**：搜索文档标题，使用 PostgreSQL 的 `tsvector` 全文搜索或 `ILIKE` 模糊匹配
- **块搜索**：搜索块内容（`BlockVersion.plainText`），仅搜索最新版本（`b.latestVer = bv.ver`）
- **权限过滤**：只返回用户有权限访问的文档和块
- **排序**：按相关性（`rank`）排序

**状态码：**

- `200 OK` - 搜索成功
- `400 Bad Request` - 缺少 query 参数

## 高级搜索

**接口：** `POST /api/v1/search/advanced`

**说明：** 高级搜索，支持更多过滤条件和排序选项

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**请求体：**

```json
{
  "query": "搜索关键词",
  "workspaceId": "ws_1705123456789_abc123",
  "tags": ["重要", "测试"],
  "startDate": "2024-01-01T00:00:00.000Z",
  "endDate": "2024-12-31T23:59:59.999Z",
  "createdBy": "u_1705123456789_abc123",
  "sortBy": "rank",
  "sortOrder": "DESC",
  "page": 1,
  "pageSize": 20
}
```

**字段说明：**

| 字段          | 类型     | 必填 | 说明                                                       |
| ------------- | -------- | ---- | ---------------------------------------------------------- |
| `query`       | string   | ✅   | 搜索关键词                                                 |
| `workspaceId` | string   | ❌   | 工作空间ID                                                 |
| `tags`        | string[] | ❌   | 标签过滤（数组，使用 `AND` 逻辑，文档必须包含所有标签）    |
| `startDate`   | string   | ❌   | 开始日期（ISO 8601 格式）                                  |
| `endDate`     | string   | ❌   | 结束日期（ISO 8601 格式）                                  |
| `createdBy`   | string   | ❌   | 创建者用户ID                                               |
| `sortBy`      | string   | ❌   | 排序字段：`rank`（相关性，默认）、`updatedAt`、`createdAt` |
| `sortOrder`   | string   | ❌   | 排序顺序：`DESC`（默认）、`ASC`                            |
| `page`        | number   | ❌   | 页码，默认 1                                               |
| `pageSize`    | number   | ❌   | 每页数量，默认 20                                          |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "type": "document",
        "docId": "doc_1705123456789_xyz456",
        "title": "我的第一篇文档",
        "icon": "📄",
        "workspaceId": "ws_1705123456789_abc123",
        "tags": ["重要", "测试"],
        "updatedAt": "2024-01-15T10:30:00.000Z",
        "rank": 0.95
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20
  }
}
```

**高级搜索特性：**

- **标签过滤**：使用 `AND` 逻辑，文档必须包含所有指定的标签
- **时间范围**：根据文档的 `updatedAt` 过滤
- **创建者过滤**：只搜索指定用户创建的文档
- **多种排序**：支持按相关性、更新时间、创建时间排序

**状态码：**

- `200 OK` - 搜索成功
- `400 Bad Request` - 请求参数错误

## 代码示例

### JavaScript / TypeScript

```typescript
// 全局搜索
async function globalSearch(query: string, workspaceId?: string) {
  const url = new URL("http://localhost:5200/api/v1/search");
  url.searchParams.set("query", query);
  if (workspaceId) {
    url.searchParams.set("workspaceId", workspaceId);
  }
  url.searchParams.set("type", "all");
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", "20");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return await response.json();
}

// 高级搜索
async function advancedSearch(filters: any) {
  const response = await fetch("http://localhost:5200/api/v1/search/advanced", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query: filters.query,
      workspaceId: filters.workspaceId,
      tags: filters.tags,
      startDate: filters.startDate,
      endDate: filters.endDate,
      createdBy: filters.createdBy,
      sortBy: filters.sortBy || "rank",
      sortOrder: filters.sortOrder || "DESC",
      page: filters.page || 1,
      pageSize: filters.pageSize || 20,
    }),
  });
  return await response.json();
}
```
