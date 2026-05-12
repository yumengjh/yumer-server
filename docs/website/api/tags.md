# 标签 API

标签模块提供标签的创建、管理、使用统计等功能。

## 站点公开访问说明

`GET /api/v1/tags` 支持通过 `@SitePublic()` 开放给指定站点匿名访问。

- 带 `Authorization`：按登录态校验工作空间权限
- 不带 token：请求来源必须命中 `PUBLIC_SITE_ORIGINS`
- 站点公开模式下仍然要求传 `workspaceId`
- 只有可公开访问的工作空间才能被匿名读取标签列表

## 标签系统概述

### 标签和文档的关联方式

标签系统采用**标签ID关联**的方式：

1. **标签定义**：在 `tags` 表中存储标签的定义信息（tagId、名称、颜色等）
2. **文档关联**：文档的 `tags` 字段是一个**字符串数组**，存储的是**标签ID**（tagId），不是标签名称
3. **关联匹配**：通过标签ID匹配文档和标签
4. **自动校验**：创建或更新文档时，系统会自动校验标签ID是否存在，不存在会返回错误
5. **自动统计**：标签的 `usageCount` 字段会自动维护，记录有多少文档使用了该标签

**示例：**

```json
// 标签表（tags）
{
  "tagId": "tag_123",
  "name": "重要",
  "color": "#ff4d4f",
  "usageCount": 5  // 自动维护：有5个文档使用了该标签
}

// 文档表（documents）
{
  "docId": "doc_456",
  "title": "我的文档",
  "tags": ["tag_123", "tag_456"]  // 存储的是标签ID（tagId），不是标签名称
}
```

### 工作流程

1. **创建标签**：在工作空间中创建标签（定义名称和颜色），获得 `tagId`
2. **使用标签**：创建或更新文档时，在 `tags` 数组中传入**标签ID**（tagId）
3. **自动校验**：系统会自动校验标签ID是否存在，不存在会返回错误
4. **自动统计**：标签的 `usageCount` 会自动更新：
   - 文档添加标签时，`usageCount` +1，文档ID添加到 `documentIds` 数组
   - 文档移除标签时，`usageCount` -1，文档ID从 `documentIds` 数组移除
   - 文档删除时，所有标签的 `usageCount` 相应减少，文档ID从 `documentIds` 数组移除
5. **标签管理**：
   - 更新标签名称或颜色：只更新标签表，不影响文档（文档中存储的是 tagId）
   - 删除标签时：使用软删除机制，更新 `isDeleted` 和 `deletedAt` 字段，同时从所有使用该标签的文档中移除该标签ID

### 重要说明

- ✅ **文档使用 tagId**：文档的 `tags` 字段存储的是标签ID（tagId），不是标签名称
- ✅ **自动校验**：创建或更新文档时，系统会自动校验标签ID是否存在
- ✅ **自动统计**：标签的 `usageCount` 字段会自动维护，无需手动更新
- ✅ **软删除机制**：删除标签时使用软删除，更新 `isDeleted` 和 `deletedAt` 字段，不真正删除记录，保留所有数据
- ✅ **自动移除**：删除标签时，系统会自动从所有使用该标签的文档中移除该标签ID
- ✅ **高效实现**：优先使用 `documentIds` 字段直接定位需要更新的文档，避免全表查询
- ✅ **数据保留**：软删除后，标签的 `usageCount`、`documentIds` 等数据都会保留，便于恢复和追溯
- ✅ **查询过滤**：已删除的标签不会出现在标签列表中，也无法通过 API 查询到
- ✅ **标签名称可修改**：更新标签名称时，不影响文档（文档中存储的是 tagId）
- ✅ **标签颜色**：标签颜色只存储在标签表中，文档中不存储颜色信息，前端需要查询标签表获取

## 接口列表

| 方法   | 路径                 | 说明         | 认证           |
| ------ | -------------------- | ------------ | -------------- |
| POST   | `/tags`              | 创建标签     | 是             |
| GET    | `/tags`              | 标签列表     | JWT / 站点公开 |
| GET    | `/tags/:tagId`       | 标签详情     | 是             |
| GET    | `/tags/:tagId/usage` | 标签使用统计 | 是             |
| PATCH  | `/tags/:tagId`       | 更新标签     | 是             |
| DELETE | `/tags/:tagId`       | 删除标签     | 是             |

## 创建标签

**接口：** `POST /api/v1/tags`

**说明：** 在工作空间中创建新标签

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**请求体：**

```json
{
  "workspaceId": "ws_1705123456789_abc123",
  "name": "重要",
  "color": "#ff4d4f"
}
```

**字段说明：**

| 字段          | 类型   | 必填 | 说明                               |
| ------------- | ------ | ---- | ---------------------------------- |
| `workspaceId` | string | ✅   | 工作空间ID                         |
| `name`        | string | ✅   | 标签名称，1-50个字符               |
| `color`       | string | ❌   | 标签颜色（十六进制），默认随机生成 |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "tagId": "tag_1705123456789_xyz456",
    "workspaceId": "ws_1705123456789_abc123",
    "name": "重要",
    "color": "#ff4d4f",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**状态码：**

- `201 Created` - 创建成功
- `400 Bad Request` - 请求参数错误
- `403 Forbidden` - 没有权限访问工作空间
- `409 Conflict` - 标签名已存在

## 获取标签列表

**接口：** `GET /api/v1/tags`

**说明：** 获取工作空间的标签列表

**请求头：**

- 登录态：`Authorization: Bearer <your-access-token>`
- 站点公开：可不带 token，但请求来源必须命中 `PUBLIC_SITE_ORIGINS`

**查询参数：**

| 参数          | 类型   | 必填 | 说明              |
| ------------- | ------ | ---- | ----------------- |
| `workspaceId` | string | ✅   | 工作空间ID        |
| `page`        | number | ❌   | 页码，默认 1      |
| `pageSize`    | number | ❌   | 每页数量，默认 20 |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "tagId": "tag_1705123456789_xyz456",
        "workspaceId": "ws_1705123456789_abc123",
        "name": "重要",
        "color": "#ff4d4f",
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
- `400 Bad Request` - 缺少 workspaceId 参数
- `403 Forbidden` - 站点公开请求来源不被允许
- `404 Not Found` - 工作空间不存在，或工作空间不可公开访问

## 获取标签详情

**接口：** `GET /api/v1/tags/:tagId`

**说明：** 获取标签的详细信息

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数    | 类型   | 说明   |
| ------- | ------ | ------ |
| `tagId` | string | 标签ID |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "tagId": "tag_1705123456789_xyz456",
    "workspaceId": "ws_1705123456789_abc123",
    "name": "重要",
    "color": "#ff4d4f",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**状态码：**

- `200 OK` - 获取成功
- `404 Not Found` - 标签不存在
- `403 Forbidden` - 没有权限访问

## 获取标签使用统计

**接口：** `GET /api/v1/tags/:tagId/usage`

**说明：** 获取标签的使用统计信息（使用该标签的文档数量）

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数    | 类型   | 说明   |
| ------- | ------ | ------ |
| `tagId` | string | 标签ID |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "tagId": "tag_1705123456789_xyz456",
    "name": "重要",
    "usage": 5
  }
}
```

**字段说明：**

- `usage`：使用该标签的文档数量（实时计算，不包括已删除的文档）

**状态码：**

- `200 OK` - 获取成功
- `404 Not Found` - 标签不存在
- `403 Forbidden` - 没有权限访问

## 更新标签

**接口：** `PATCH /api/v1/tags/:tagId`

**说明：** 更新标签的名称和颜色，更新名称时会同步更新所有使用该标签的文档

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**路径参数：**

| 参数    | 类型   | 说明   |
| ------- | ------ | ------ |
| `tagId` | string | 标签ID |

**请求体：**

```json
{
  "name": "更新后的标签名",
  "color": "#52c41a"
}
```

**字段说明：**

| 字段    | 类型   | 必填 | 说明                 |
| ------- | ------ | ---- | -------------------- |
| `name`  | string | ❌   | 标签名称，1-50个字符 |
| `color` | string | ❌   | 标签颜色（十六进制） |

**权限要求：** owner、admin 或 editor

**响应示例：**

```json
{
  "success": true,
  "data": {
    "tagId": "tag_1705123456789_xyz456",
    "name": "更新后的标签名",
    "color": "#52c41a",
    ...
  }
}
```

**说明：**

- **更新标签名称**：只更新标签表中的名称，**不影响文档**（文档中存储的是 tagId，不是标签名称）
- **更新标签颜色**：只更新标签表中的颜色，不影响文档（文档中不存储颜色信息）
- **标签信息获取**：前端在显示文档时，需要通过标签ID查询标签表获取名称和颜色
- **使用统计**：标签的 `usageCount` 字段会自动维护，无需手动更新

**状态码：**

- `200 OK` - 更新成功
- `404 Not Found` - 标签不存在
- `403 Forbidden` - 没有权限
- `409 Conflict` - 新标签名已存在

## 删除标签

**接口：** `DELETE /api/v1/tags/:tagId`

**说明：** 软删除标签（标记为已删除），并从所有使用该标签的文档中移除该标签ID

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数    | 类型   | 说明   |
| ------- | ------ | ------ |
| `tagId` | string | 标签ID |

**权限要求：** owner、admin 或 editor

**响应示例：**

```json
{
  "success": true,
  "data": {
    "message": "标签已删除",
    "removedFromDocuments": 5
  }
}
```

**字段说明：**

| 字段                   | 类型   | 说明                       |
| ---------------------- | ------ | -------------------------- |
| `message`              | string | 操作结果消息               |
| `removedFromDocuments` | number | 从多少个文档中移除了该标签 |

**说明：**

- **软删除机制**：删除标签时，系统使用软删除方式，只更新标签的 `isDeleted` 和 `deletedAt` 字段，不会真正删除标签记录
- **自动移除文档中的标签**：删除标签时，系统会**自动从所有使用该标签的文档的 `tags` 数组中移除该标签ID**
- **高效实现**：系统优先使用标签表中的 `documentIds` 字段直接定位需要更新的文档，避免了全表查询，大幅提高删除效率
- **回退机制**：为了兼容旧数据，当 `documentIds` 为空但 `usageCount > 0` 时，系统会自动回退到查询方式，通过查询文档表来找到所有使用该标签的文档
- **空间隔离**：只更新属于同一工作空间的文档，确保数据安全
- **查询过滤**：已删除的标签不会出现在标签列表中，也无法通过 API 查询到
- **数据保留**：软删除后，标签的所有数据（包括 `usageCount`、`documentIds` 等）都会保留，便于后续恢复或数据分析

**软删除的优势：**

- ✅ **数据安全**：避免误删导致的数据丢失
- ✅ **可恢复性**：可以通过恢复功能重新启用标签
- ✅ **历史追溯**：保留标签的使用历史和数据统计
- ✅ **事务保证**：删除操作在事务中执行，确保数据一致性

**状态码：**

- `200 OK` - 删除成功
- `404 Not Found` - 标签不存在
- `403 Forbidden` - 没有权限

## 使用示例

### 完整工作流程

#### 1. 创建标签

```typescript
// 在工作空间中创建标签
async function createTag(workspaceId: string) {
  const response = await fetch("http://localhost:5200/api/v1/tags", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      workspaceId,
      name: "重要",
      color: "#ff4d4f",
    }),
  });
  return await response.json();
}
```

#### 2. 获取标签列表（用于文档编辑时选择标签）

```typescript
// 获取工作空间的所有标签，供用户选择
async function getTags(workspaceId: string) {
  const response = await fetch(
    `http://localhost:5200/api/v1/tags?workspaceId=${workspaceId}&page=1&pageSize=100`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  return await response.json();
}
```

#### 3. 创建文档时使用标签

```typescript
// 创建文档时，传入标签ID（tagId），不是标签名称
async function createDocument(workspaceId: string, tagIds: string[]) {
  const response = await fetch("http://localhost:5200/api/v1/documents", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      workspaceId,
      title: "我的文档",
      tags: tagIds, // 使用标签ID（tagId），例如：['tag_123', 'tag_456']
    }),
  });
  return await response.json();
}

// 如果标签不存在，会返回错误：
// {
//   "success": false,
//   "error": {
//     "message": "以下标签不存在或不属于该工作空间: tag_999"
//   }
// }
```

#### 4. 更新文档标签

```typescript
// 更新文档的标签（使用标签ID）
async function updateDocumentTags(docId: string, tagIds: string[]) {
  const response = await fetch(
    `http://localhost:5200/api/v1/documents/${docId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        tags: tagIds, // 标签ID数组，例如：['tag_123', 'tag_456']
      }),
    },
  );
  return await response.json();
  // 注意：系统会自动更新相关标签的 usageCount
  // - 新增的标签：usageCount +1
  // - 移除的标签：usageCount -1
}
```

#### 5. 显示文档时获取标签信息

```typescript
// 文档返回的 tags 是标签ID数组，需要查询标签表获取名称和颜色
async function getDocumentWithTagInfo(docId: string) {
  // 1. 获取文档
  const docResponse = await fetch(
    `http://localhost:5200/api/v1/documents/${docId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const doc = await docResponse.json();

  // 2. 获取工作空间的所有标签（包含名称和颜色信息）
  const tagsResponse = await fetch(
    `http://localhost:5200/api/v1/tags?workspaceId=${doc.data.workspaceId}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const tagsData = await tagsResponse.json();

  // 3. 构建标签ID到标签信息的映射
  const tagInfoMap = new Map(
    tagsData.data.items.map((tag: any) => [
      tag.tagId,
      { name: tag.name, color: tag.color || "#999999" },
    ]),
  );

  // 4. 为文档的标签添加名称和颜色信息
  const tagsWithInfo = doc.data.tags
    .map((tagId: string) => {
      const tagInfo = tagInfoMap.get(tagId);
      return tagInfo ? { tagId, ...tagInfo } : null;
    })
    .filter(Boolean);

  return {
    ...doc.data,
    tagsWithInfo,
  };
}
```

#### 6. 更新标签名称或颜色

```typescript
// 更新标签名称或颜色（不影响文档，因为文档中存储的是 tagId）
async function updateTag(tagId: string, name?: string, color?: string) {
  const response = await fetch(`http://localhost:5200/api/v1/tags/${tagId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name, color }),
  });
  return await response.json();
  // 注意：更新标签名称或颜色不会影响文档，因为文档中存储的是 tagId
  // 前端显示时需要重新查询标签表获取最新的名称和颜色
}
```

#### 7. 查询标签使用统计

```typescript
// 查询有多少文档使用了该标签（返回标签的 usageCount）
async function getTagUsage(tagId: string) {
  const response = await fetch(
    `http://localhost:5200/api/v1/tags/${tagId}/usage`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  return await response.json();
  // 返回: { tagId, name, usage: 5 }
  // usage 是标签的 usageCount 字段，自动维护，表示使用该标签的文档数量
}
```

### 最佳实践

1. **创建标签**：
   - 在工作空间中先创建标签，定义名称和颜色
   - 标签名称在同一工作空间内必须唯一

2. **使用标签**：
   - 创建或更新文档时，传入标签名称（字符串数组）
   - 不需要传入 tagId，只需要传入标签名称

3. **显示标签**：
   - 文档的 `tags` 字段只包含标签名称
   - 需要显示颜色时，查询标签表获取颜色信息
   - 建议前端缓存标签列表，避免频繁查询

4. **标签管理**：
   - 更新标签名称时，所有文档会自动同步（无需手动更新文档）
   - 删除标签时，所有文档中的该标签会自动移除
   - 使用 `GET /api/v1/tags/:tagId/usage` 查询标签使用情况

5. **标签选择器实现**：

   ```typescript
   // 前端实现标签选择器
   // 1. 获取标签列表
   const tags = await getTags(workspaceId);

   // 2. 用户选择标签（显示标签名称和颜色）
   // 3. 创建/更新文档时，传入选中的标签ID数组
   const selectedTagIds = selectedTags.map((tag) => tag.tagId);
   await createDocument({ ...docData, tags: selectedTagIds });

   // 4. 如果用户输入新标签名称，先创建标签再使用
   async function createTagIfNotExists(workspaceId: string, tagName: string) {
     // 先查询是否已存在同名标签
     const tags = await getTags(workspaceId);
     const existing = tags.data.items.find((t) => t.name === tagName);
     if (existing) {
       return existing.tagId;
     }
     // 不存在则创建
     const newTag = await createTag(workspaceId, tagName);
     return newTag.data.tagId;
   }
   ```
