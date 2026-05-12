# 评论 API

评论模块提供文档和块的评论功能。

## 接口列表

| 方法   | 路径                   | 说明     | 认证 |
| ------ | ---------------------- | -------- | ---- |
| POST   | `/comments`            | 创建评论 | 是   |
| GET    | `/comments`            | 评论列表 | 是   |
| GET    | `/comments/:commentId` | 评论详情 | 是   |
| PATCH  | `/comments/:commentId` | 更新评论 | 是   |
| DELETE | `/comments/:commentId` | 删除评论 | 是   |

---

## 创建评论

**接口：** `POST /api/v1/comments`

**说明：** 创建评论或回复

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**请求体：**

```json
{
  "docId": "doc_1705123456789_xyz456",
  "blockId": "b_1705123456790_block001",
  "content": "这是一条评论",
  "mentions": ["u_1705123456789_abc123"],
  "parentCommentId": null
}
```

**字段说明：**

| 字段              | 类型     | 必填 | 说明                                   |
| ----------------- | -------- | ---- | -------------------------------------- |
| `docId`           | string   | ✅   | 文档ID                                 |
| `blockId`         | string   | ❌   | 块ID（可选，不传则为文档级评论）       |
| `content`         | string   | ✅   | 评论内容                               |
| `mentions`        | string[] | ❌   | 提及的用户ID列表                       |
| `parentCommentId` | string   | ❌   | 父评论ID（用于回复，不传则为顶级评论） |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "commentId": "comment_1705123456789_abc123",
    "docId": "doc_1705123456789_xyz456",
    "blockId": "b_1705123456790_block001",
    "content": "这是一条评论",
    "mentions": ["u_1705123456789_abc123"],
    "parentCommentId": null,
    "createdBy": "u_1705123456789_xyz456",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**说明：**

- 如果提供了 `blockId`，系统会验证：
  - 块是否存在
  - 块是否属于该文档
  - 块是否已被删除（已删除的块无法添加评论）
- 如果提供了 `parentCommentId`，系统会验证：
  - 父评论是否存在
  - 父评论是否属于该文档

**状态码：**

- `201 Created` - 创建成功
- `400 Bad Request` - 请求参数错误（块不属于该文档、块已被删除、父评论不属于该文档）
- `403 Forbidden` - 没有权限访问文档
- `404 Not Found` - 文档、块或父评论不存在

## 获取评论列表

**接口：** `GET /api/v1/comments`

**说明：** 获取文档或块的评论列表

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**查询参数：**

| 参数       | 类型   | 必填 | 说明                               |
| ---------- | ------ | ---- | ---------------------------------- |
| `docId`    | string | ✅   | 文档ID                             |
| `blockId`  | string | ❌   | 块ID（可选，不传则获取文档级评论） |
| `page`     | number | ❌   | 页码，默认 1                       |
| `pageSize` | number | ❌   | 每页数量，默认 20                  |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "commentId": "comment_1705123456789_abc123",
        "docId": "doc_1705123456789_xyz456",
        "blockId": "b_1705123456790_block001",
        "content": "这是一条评论",
        "mentions": ["u_1705123456789_abc123"],
        "parentCommentId": null,
        "createdBy": "u_1705123456789_xyz456",
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
- `400 Bad Request` - 缺少 docId 参数

## 获取评论详情

**接口：** `GET /api/v1/comments/:commentId`

**说明：** 获取评论的详细信息

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数        | 类型   | 说明   |
| ----------- | ------ | ------ |
| `commentId` | string | 评论ID |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "commentId": "comment_1705123456789_abc123",
    "docId": "doc_1705123456789_xyz456",
    "blockId": "b_1705123456790_block001",
    "content": "这是一条评论",
    "mentions": ["u_1705123456789_abc123"],
    "parentCommentId": null,
    "createdBy": "u_1705123456789_xyz456",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**状态码：**

- `200 OK` - 获取成功
- `404 Not Found` - 评论不存在
- `403 Forbidden` - 没有权限访问

## 更新评论

**接口：** `PATCH /api/v1/comments/:commentId`

**说明：** 更新评论内容（仅本人可以更新）

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**路径参数：**

| 参数        | 类型   | 说明   |
| ----------- | ------ | ------ |
| `commentId` | string | 评论ID |

**请求体：**

```json
{
  "content": "更新后的评论内容"
}
```

**字段说明：**

| 字段      | 类型   | 必填 | 说明         |
| --------- | ------ | ---- | ------------ |
| `content` | string | ✅   | 新的评论内容 |

**权限要求：** 仅评论创建者可以更新

**响应示例：**

```json
{
  "success": true,
  "data": {
    "commentId": "comment_1705123456789_abc123",
    "content": "更新后的评论内容",
    "updatedAt": "2024-01-15T12:00:00.000Z"
  }
}
```

**状态码：**

- `200 OK` - 更新成功
- `404 Not Found` - 评论不存在
- `403 Forbidden` - 没有权限（非评论创建者）

## 删除评论

**接口：** `DELETE /api/v1/comments/:commentId`

**说明：** 删除评论（软删除，仅本人可以删除）

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数        | 类型   | 说明   |
| ----------- | ------ | ------ |
| `commentId` | string | 评论ID |

**权限要求：** 仅评论创建者可以删除

**响应示例：**

```json
{
  "success": true,
  "data": {
    "message": "评论已删除"
  }
}
```

**说明：**

- 删除是软删除，评论不会被物理删除

**状态码：**

- `200 OK` - 删除成功
- `404 Not Found` - 评论不存在
- `403 Forbidden` - 没有权限（非评论创建者）

## 代码示例

### JavaScript / TypeScript

```typescript
// 创建评论
async function createComment(docId: string, content: string) {
  const response = await fetch("http://localhost:5200/api/v1/comments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      docId,
      content,
    }),
  });
  return await response.json();
}

// 回复评论
async function replyComment(
  docId: string,
  parentCommentId: string,
  content: string,
) {
  const response = await fetch("http://localhost:5200/api/v1/comments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      docId,
      parentCommentId,
      content,
    }),
  });
  return await response.json();
}

// 获取评论列表
async function getComments(docId: string, blockId?: string) {
  const url = new URL("http://localhost:5200/api/v1/comments");
  url.searchParams.set("docId", docId);
  if (blockId) {
    url.searchParams.set("blockId", blockId);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return await response.json();
}
```
