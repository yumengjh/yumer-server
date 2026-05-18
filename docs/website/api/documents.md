# 文档 API

文档模块提供文档的创建、编辑、版本控制、发布等功能。

## 站点公开访问说明

以下只读接口支持通过 `@SitePublic()` 开放给指定站点匿名访问：

- `GET /api/v1/documents`
- `GET /api/v1/documents/:docId`
- `GET /api/v1/documents/:docId/content`

访问规则：

- 带 `Authorization` 时，仍按 JWT 鉴权处理
- 不带 token 时，请求来源必须命中 `PUBLIC_SITE_ORIGINS`
- 站点公开模式下只返回 **已发布文档**（`publishedHead > 0`）
- `GET /documents` 在站点公开模式下必须传 `workspaceId`
- `GET /documents/:docId/content` 在站点公开模式下固定返回 `publishedHead` 对应内容，不支持匿名读取草稿或任意历史版本

## 接口列表

| 方法   | 路径                                 | 说明               | 认证           |
| ------ | ------------------------------------ | ------------------ | -------------- |
| POST   | `/documents`                         | 创建文档           | 是             |
| GET    | `/documents`                         | 文档列表           | JWT / 站点公开 |
| GET    | `/documents/search`                  | 搜索文档           | 是             |
| GET    | `/documents/:docId`                  | 文档详情           | JWT / 站点公开 |
| GET    | `/documents/:docId/content`          | 文档内容/渲染树    | JWT / 站点公开 |
| PATCH  | `/documents/:docId`                  | 更新文档元数据     | 是             |
| POST   | `/documents/:docId/publish`          | 发布文档           | 是             |
| POST   | `/documents/:docId/move`             | 移动文档           | 是             |
| DELETE | `/documents/:docId`                  | 删除文档           | 是             |
| GET    | `/documents/:docId/revisions`        | 修订历史           | 是             |
| GET    | `/documents/:docId/diff`             | 版本对比           | 是             |
| POST   | `/documents/:docId/revert`           | 回滚到指定版本     | 是             |
| POST   | `/documents/:docId/snapshots`        | 创建快照           | 是             |
| POST   | `/documents/:docId/commit`           | 手动触发创建版本   | 是             |
| GET    | `/documents/:docId/pending-versions` | 获取待创建版本数量 | 是             |

## 创建文档

**接口：** `POST /api/v1/documents`

**说明：** 创建新文档，系统会自动创建根块和初始版本

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**请求体：**

```json
{
  "workspaceId": "ws_1705123456789_abc123",
  "title": "我的第一篇文档",
  "icon": "📄",
  "cover": "https://example.com/cover.jpg",
  "visibility": "workspace",
  "parentId": null,
  "tags": ["tag_1234567890_abc123", "tag_1234567890_def456"],
  "category": "技术文档"
}
```

**字段说明：**

| 字段          | 类型     | 必填 | 说明                                                              |
| ------------- | -------- | ---- | ----------------------------------------------------------------- |
| `workspaceId` | string   | ✅   | 工作空间ID                                                        |
| `title`       | string   | ✅   | 文档标题，1-255个字符                                             |
| `icon`        | string   | ❌   | 文档图标（emoji），最多10个字符                                   |
| `cover`       | string   | ❌   | 文档封面URL，最多500个字符                                        |
| `visibility`  | string   | ❌   | 可见性：`private`（默认）、`workspace`、`public`                  |
| `parentId`    | string   | ❌   | 父文档ID（用于文档树结构）                                        |
| `tags`        | string[] | ❌   | 标签ID列表（tagId数组），系统会自动校验标签是否存在并更新使用统计 |
| `category`    | string   | ❌   | 分类，最多50个字符                                                |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "docId": "doc_1705123456789_xyz456",
    "workspaceId": "ws_1705123456789_abc123",
    "title": "我的第一篇文档",
    "icon": "📄",
    "rootBlockId": "b_1705123456789_root789",
    "head": 1,
    "publishedHead": 0,
    "status": "draft",
    "visibility": "workspace",
    "tags": ["tag_1234567890_abc123", "tag_1234567890_def456"],
    "category": "技术文档",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**重要说明：**

- 创建文档时会**自动创建根块**（`rootBlockId`），无需手动创建
- 创建文档时会**自动创建初始版本**（`head = 1`）
- 如果指定了 `parentId`，父文档必须属于同一工作空间
- **标签字段**：`tags` 字段应传入**标签ID**（tagId）数组，不是标签名称
  - 系统会自动校验标签ID是否存在，不存在会返回错误
  - 标签的 `usageCount` 会自动更新（+1）

**状态码：**

- `201 Created` - 创建成功
- `400 Bad Request` - 请求参数错误
- `403 Forbidden` - 没有权限访问工作空间

## 获取文档列表

**接口：** `GET /api/v1/documents`

**说明：** 获取文档列表，支持多种过滤条件

**请求头：**

- 登录态：`Authorization: Bearer <your-access-token>`
- 站点公开：可不带 token，但请求来源必须命中 `PUBLIC_SITE_ORIGINS`

**查询参数：**

| 参数          | 类型     | 必填 | 说明                                                |
| ------------- | -------- | ---- | --------------------------------------------------- |
| `workspaceId` | string   | ❌   | 工作空间ID（登录态可不传；站点公开访问时必传）      |
| `status`      | string   | ❌   | 文档状态：`draft`、`normal`、`archived`             |
| `visibility`  | string   | ❌   | 可见性：`private`、`workspace`、`public`            |
| `parentId`    | string   | ❌   | 父文档ID（用于查询子文档）                          |
| `tags`        | string[] | ❌   | 标签ID过滤（tagId数组），查询包含指定标签的文档     |
| `category`    | string   | ❌   | 分类过滤                                            |
| `sortBy`      | string   | ❌   | 排序字段：`updatedAt`（默认）、`createdAt`、`title` |
| `sortOrder`   | string   | ❌   | 排序顺序：`DESC`（默认）、`ASC`                     |
| `page`        | number   | ❌   | 页码，默认 1                                        |
| `pageSize`    | number   | ❌   | 每页数量，默认 20                                   |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "docId": "doc_1705123456789_xyz456",
        "title": "我的第一篇文档",
        "icon": "📄",
        "status": "draft",
        "visibility": "workspace",
        "updatedAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20
  }
}
```

**站点公开模式补充说明：**

- 返回结果只包含 `publishedHead > 0` 的文档
- 列表项会返回公开安全字段，如 `docId`、`workspaceId`、`title`、`icon`、`cover`、`createdBy`、`status`、`visibility`、`tags`、`category`、`publishedHead`、`viewCount`、`favoriteCount`、`createdAt`、`updatedAt`

**状态码：**

- `200 OK` - 获取成功
- `400 Bad Request` - 站点公开访问缺少 `workspaceId`
- `403 Forbidden` - 站点公开请求来源不被允许
- `404 Not Found` - 工作空间不存在或不可公开访问

## 搜索文档

**接口：** `GET /api/v1/documents/search`

**说明：** 搜索文档，支持全文搜索

**请求头：**

- 登录态：`Authorization: Bearer <your-access-token>`
- 站点公开：可不带 token，但请求来源必须命中 `PUBLIC_SITE_ORIGINS`

**查询参数：**

| 参数          | 类型     | 必填 | 说明                                            |
| ------------- | -------- | ---- | ----------------------------------------------- |
| `query`       | string   | ✅   | 搜索关键词                                      |
| `workspaceId` | string   | ❌   | 工作空间ID                                      |
| `status`      | string   | ❌   | 文档状态：`draft`、`normal`、`archived`         |
| `tags`        | string[] | ❌   | 标签ID过滤（tagId数组），搜索包含指定标签的文档 |
| `page`        | number   | ❌   | 页码，默认 1                                    |
| `pageSize`    | number   | ❌   | 每页数量，默认 20                               |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "docId": "doc_1705123456789_xyz456",
        "title": "我的第一篇文档",
        "icon": "📄",
        "status": "draft",
        "updatedAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20
  }
}
```

**搜索说明：**

- 使用 PostgreSQL 的 `tsvector` 进行全文搜索
- 搜索文档标题和内容
- 支持中文搜索

**状态码：**

- `200 OK` - 搜索成功

## 获取文档详情

**接口：** `GET /api/v1/documents/:docId`

**说明：** 获取文档的详细信息

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数    | 类型   | 说明   |
| ------- | ------ | ------ |
| `docId` | string | 文档ID |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "docId": "doc_1705123456789_xyz456",
    "workspaceId": "ws_1705123456789_abc123",
    "title": "我的第一篇文档",
    "icon": "📄",
    "cover": "https://example.com/cover.jpg",
    "rootBlockId": "b_1705123456789_root789",
    "head": 5,
    "publishedHead": 3,
    "status": "normal",
    "visibility": "workspace",
    "tags": ["tag_1234567890_abc123", "tag_1234567890_def456"],
    "category": "技术文档",
    "viewCount": 10,
    "favoriteCount": 2,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T12:00:00.000Z"
  }
}
```

**站点公开响应说明：**

- 仅当文档已发布时可访问；未发布文档会返回 `404 Not Found`
- 公开响应不返回 `head`、`rootBlockId` 等编辑态字段
- 公开响应会返回 `publishedHead`，用于标识当前公开版本

**状态码：**

- `200 OK` - 获取成功
- `403 Forbidden` - 没有权限访问或站点公开请求来源不被允许
- `404 Not Found` - 文档不存在，或文档未发布

## 获取文档内容

**接口：** `GET /api/v1/documents/:docId/content`

**说明：** 获取文档的内容树（渲染树），支持分页加载，适用于超大型文档

**请求头：**

- 登录态：`Authorization: Bearer <your-access-token>`
- 站点公开：可不带 token，但请求来源必须命中 `PUBLIC_SITE_ORIGINS`

**路径参数：**

| 参数    | 类型   | 说明   |
| ------- | ------ | ------ |
| `docId` | string | 文档ID |

**查询参数：**

| 参数           | 类型   | 必填 | 说明                                                                                                |
| -------------- | ------ | ---- | --------------------------------------------------------------------------------------------------- |
| `version`      | number | ❌   | 文档版本号（登录态不传则使用最新版本 `head`；站点公开访问时会忽略该参数并固定返回 `publishedHead`） |
| `maxDepth`     | number | ❌   | 最大层级深度（从根块开始计算，0=只返回根块，1=根块+第一层，默认返回所有层级）                       |
| `startBlockId` | string | ❌   | 起始块ID（用于分页，返回该块及其后续兄弟块）                                                        |
| `limit`        | number | ❌   | 每页返回的最大块数量（默认1000，最大10000）                                                         |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "docId": "doc_1705123456789_xyz456",
    "docVer": 5,
    "title": "我的第一篇文档",
    "tree": {
      "blockId": "b_1705123456789_root789",
      "type": "root",
      "payload": {
        "type": "root",
        "children": []
      },
      "parentId": "",
      "sortKey": "0",
      "indent": 0,
      "collapsed": false,
      "children": [
        {
          "blockId": "b_1705123456790_block001",
          "type": "paragraph",
          "payload": {
            "text": "这是第一段内容"
          },
          "parentId": "b_1705123456789_root789",
          "sortKey": "1000000",
          "indent": 0,
          "collapsed": false,
          "children": []
        }
      ]
    },
    "pagination": {
      "totalBlocks": 1500,
      "returnedBlocks": 1000,
      "hasMore": true,
      "nextStartBlockId": "b_1705123456800_block1000"
    }
  }
}
```

**字段说明：**

| 字段                          | 类型    | 说明                                        |
| ----------------------------- | ------- | ------------------------------------------- |
| `tree`                        | object  | 文档内容树（根块及其子块）                  |
| `pagination.totalBlocks`      | number  | 文档中的总块数                              |
| `pagination.returnedBlocks`   | number  | 本次返回的块数量                            |
| `pagination.hasMore`          | boolean | 是否还有更多块未返回                        |
| `pagination.nextStartBlockId` | string  | 下次请求的起始块ID（当 hasMore 为 true 时） |

**分页使用说明：**

- **按需加载**：对于超大型文档，建议使用 `maxDepth` 和 `limit` 参数控制返回的数据量
- **层级加载**：使用 `maxDepth=0` 只获取根块，然后按需加载子块
- **分页加载**：当 `hasMore=true` 时，使用 `nextStartBlockId` 作为 `startBlockId` 参数继续获取后续内容
- **性能优化**：默认 `limit=1000`，可根据前端渲染能力调整（建议不超过5000）

**使用示例：**

```typescript
// 1. 首次加载：只加载前2层，最多100个块
GET /api/v1/documents/doc_123/content?maxDepth=1&limit=100

// 2. 继续加载：从指定块开始加载后续内容
GET /api/v1/documents/doc_123/content?startBlockId=b_xxx&limit=100

// 3. 加载完整文档（不推荐用于超大型文档）
GET /api/v1/documents/doc_123/content
```

**说明：**

- `tree` 包含根块及其子块的树形结构
- 如果不指定 `version`，返回最新版本（`head`）的内容
- 如果指定 `version`，返回该版本的内容（基于时间点计算）
- **分页功能**：系统针对超大型文档优化，支持按层级和数量分页，避免一次性返回过多数据
- 站点公开访问时，始终基于 `publishedHead` 返回内容，不支持匿名读取草稿内容

**状态码：**

- `200 OK` - 获取成功
- `403 Forbidden` - 没有权限访问或站点公开请求来源不被允许
- `404 Not Found` - 文档不存在、文档未发布，或指定版本不存在

## 更新文档元数据

**接口：** `PATCH /api/v1/documents/:docId`

**说明：** 更新文档的标题、图标、标签等元数据。更新标签时会自动校验标签ID并更新使用统计。

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**路径参数：**

| 参数    | 类型   | 说明   |
| ------- | ------ | ------ |
| `docId` | string | 文档ID |

**请求体：**

```json
{
  "title": "更新后的标题",
  "icon": "📝",
  "tags": ["tag_1234567890_abc123", "tag_1234567890_def456"],
  "visibility": "public"
}
```

**字段说明：**

| 字段         | 类型     | 必填 | 说明                                                              |
| ------------ | -------- | ---- | ----------------------------------------------------------------- |
| `title`      | string   | ❌   | 文档标题，1-255个字符                                             |
| `icon`       | string   | ❌   | 文档图标（emoji），最多10个字符                                   |
| `cover`      | string   | ❌   | 文档封面URL，最多500个字符                                        |
| `visibility` | string   | ❌   | 可见性：`private`、`workspace`、`public`                          |
| `tags`       | string[] | ❌   | 标签ID列表（tagId数组），系统会自动校验标签是否存在并更新使用统计 |
| `category`   | string   | ❌   | 分类，最多50个字符                                                |
| `status`     | string   | ❌   | 文档状态：`draft`、`normal`、`archived`                           |

**权限要求：** owner、admin 或 editor

**响应示例：**

```json
{
  "success": true,
  "data": {
    "docId": "doc_1705123456789_xyz456",
    "title": "更新后的标题",
    "icon": "📝",
    ...
  }
}
```

**状态码：**

- `200 OK` - 更新成功
- `404 Not Found` - 文档不存在
- `403 Forbidden` - 没有权限

## 发布文档

**接口：** `POST /api/v1/documents/:docId/publish`

**说明：** 发布文档，将 `publishedHead` 设置为当前 `head`

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数    | 类型   | 说明   |
| ------- | ------ | ------ |
| `docId` | string | 文档ID |

**权限要求：** owner、admin 或 editor

**响应示例：**

```json
{
  "success": true,
  "data": {
    "docId": "doc_1705123456789_xyz456",
    "publishedHead": 5,
    "head": 5,
    ...
  }
}
```

**说明：**

- 发布后，`publishedHead` 指向当前 `head`
- 已发布的版本内容不会因后续编辑而改变
- 可以通过 `GET /documents/:docId/content?version=<publishedHead>` 获取已发布版本

**状态码：**

- `201 Created` - 发布成功
- `404 Not Found` - 文档不存在
- `403 Forbidden` - 没有权限

## 移动文档

**接口：** `POST /api/v1/documents/:docId/move`

**说明：** 移动文档到新的位置（改变父文档或排序）

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**路径参数：**

| 参数    | 类型   | 说明   |
| ------- | ------ | ------ |
| `docId` | string | 文档ID |

**请求体：**

```json
{
  "parentId": "doc_parent_123",
  "sortOrder": 1
}
```

**字段说明：**

| 字段        | 类型   | 必填 | 说明                               |
| ----------- | ------ | ---- | ---------------------------------- |
| `parentId`  | string | ❌   | 新的父文档ID（不传则移动到根目录） |
| `sortOrder` | number | ❌   | 新的排序顺序                       |

**权限要求：** owner、admin 或 editor

**限制：**

- 不能移动到自身或形成循环引用

**响应示例：**

```json
{
  "success": true,
  "data": {
    "docId": "doc_1705123456789_xyz456",
    "parentId": "doc_parent_123",
    "sortOrder": 1,
    ...
  }
}
```

**状态码：**

- `200 OK` - 移动成功
- `404 Not Found` - 文档不存在
- `403 Forbidden` - 没有权限
- `400 Bad Request` - 移动操作无效（如循环引用）

## 删除文档

**接口：** `DELETE /api/v1/documents/:docId`

**说明：** 删除文档（软删除）

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数    | 类型   | 说明   |
| ------- | ------ | ------ |
| `docId` | string | 文档ID |

**权限要求：** owner 或 admin

**响应示例：**

```json
{
  "success": true,
  "data": {
    "message": "文档已删除"
  }
}
```

**说明：**

- 删除是软删除，文档不会被物理删除
- 删除文档会级联删除其所有子文档

**状态码：**

- `200 OK` - 删除成功
- `404 Not Found` - 文档不存在
- `403 Forbidden` - 没有权限

## 版本控制相关接口

### 获取修订历史

**接口：** `GET /api/v1/documents/:docId/revisions`

**说明：** 获取文档的版本修订历史

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**查询参数：**

| 参数       | 类型   | 必填 | 说明              |
| ---------- | ------ | ---- | ----------------- |
| `page`     | number | ❌   | 页码，默认 1      |
| `pageSize` | number | ❌   | 每页数量，默认 20 |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "revisionId": "doc_123@5",
        "docVer": 5,
        "message": "Document updated",
        "createdAt": "2024-01-15T12:00:00.000Z",
        "createdBy": "u_1705123456789_abc123"
      }
    ],
    "total": 5,
    "page": 1,
    "pageSize": 20
  }
}
```

### 版本对比

**接口：** `GET /api/v1/documents/:docId/diff`

**说明：** 对比两个版本之间的块级差异，返回变更列表和统计摘要，同时附带两个版本的完整内容树

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**查询参数：**

| 参数      | 类型   | 必填 | 说明       |
| --------- | ------ | ---- | ---------- |
| `fromVer` | number | ✅   | 起始版本号 |
| `toVer`   | number | ✅   | 目标版本号 |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "docId": "doc_1705123456789_xyz456",
    "fromVer": 3,
    "toVer": 5,
    "summary": {
      "added": 2,
      "deleted": 1,
      "modified": 3,
      "moved": 1,
      "reordered": 0,
      "indentChanged": 0,
      "unchanged": 15
    },
    "changes": [
      {
        "type": "deleted",
        "blockId": "b_001",
        "from": {
          "ver": 1,
          "type": "paragraph",
          "payload": { "text": "被删除的内容" },
          "parentId": "b_root",
          "sortKey": "100000",
          "indent": 0,
          "hash": "abc123"
        }
      },
      {
        "type": "modified",
        "blockId": "b_002",
        "from": {
          "ver": 1,
          "type": "paragraph",
          "payload": { "text": "旧内容" },
          "parentId": "b_root",
          "sortKey": "300000",
          "indent": 0,
          "hash": "def456"
        },
        "to": {
          "ver": 2,
          "type": "paragraph",
          "payload": { "text": "新内容" },
          "parentId": "b_root",
          "sortKey": "300000",
          "indent": 0,
          "hash": "ghi789"
        }
      },
      {
        "type": "moved",
        "blockId": "b_003",
        "from": {
          "ver": 1,
          "type": "paragraph",
          "payload": { "text": "被移动的块" },
          "parentId": "b_root",
          "sortKey": "500000",
          "indent": 0,
          "hash": "jkl012"
        },
        "to": {
          "ver": 2,
          "type": "paragraph",
          "payload": { "text": "被移动的块" },
          "parentId": "b_parent_new",
          "sortKey": "100000",
          "indent": 1,
          "hash": "jkl012"
        }
      },
      {
        "type": "added",
        "blockId": "b_004",
        "to": {
          "ver": 1,
          "type": "paragraph",
          "payload": { "text": "新增的块" },
          "parentId": "b_root",
          "sortKey": "700000",
          "indent": 0,
          "hash": "mno345"
        }
      }
    ],
    "fromContent": { "tree": { "...": "..." }, "totalBlocks": 16, "returnedBlocks": 16, "hasMore": false },
    "toContent": { "tree": { "...": "..." }, "totalBlocks": 20, "returnedBlocks": 20, "hasMore": false }
  }
}
```

**变更类型说明：**

| 类型             | 说明                     | `from` | `to` |
| ---------------- | ------------------------ | ------ | ---- |
| `added`          | 新增的块                 |        | ✅   |
| `deleted`        | 删除的块                 | ✅     |      |
| `modified`       | 内容（payload）发生变化   | ✅     | ✅   |
| `moved`          | 父块（parentId）发生变化 | ✅     | ✅   |
| `reordered`      | 同级排序（sortKey）变化   | ✅     | ✅   |
| `indent-changed` | 缩进层级变化             | ✅     | ✅   |

**变更类型优先级：** 当一个块同时发生多种变化时，按 `moved > modified > reordered > indent-changed` 的优先级归类。

**summary 字段说明：**

| 字段            | 类型   | 说明                             |
| --------------- | ------ | -------------------------------- |
| `added`         | number | 新增块数量                       |
| `deleted`       | number | 删除块数量                       |
| `modified`      | number | 内容变更块数量                   |
| `moved`         | number | 移动块数量                       |
| `reordered`     | number | 重排块数量                       |
| `indentChanged` | number | 缩进变更块数量                   |
| `unchanged`     | number | 未变更块数量（不包含在 changes） |

**BlockSnapshot 字段说明：**

| 字段      | 类型   | 说明                        |
| --------- | ------ | --------------------------- |
| `ver`     | number | 块在该版本中的版本号        |
| `type`    | string | 块类型（从 payload.type 提取） |
| `payload` | object | 块的完整内容（JSON）        |
| `parentId`| string | 父块 ID                     |
| `sortKey` | string | 排序键                      |
| `indent`  | number | 缩进层级                    |
| `hash`    | string | 内容哈希（用于快速比较）    |

**状态码：**

- `200 OK` - 获取成功
- `400 Bad Request` - 参数错误（fromVer > toVer 或版本号超出范围）
- `404 Not Found` - 文档或版本不存在
- `403 Forbidden` - 没有权限

### 回滚到指定版本

**接口：** `POST /api/v1/documents/:docId/revert`

**说明：** 将文档回滚到指定版本

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**请求体：**

```json
{
  "version": 3
}
```

**字段说明：**

| 字段      | 类型   | 必填 | 说明             |
| --------- | ------ | ---- | ---------------- |
| `version` | number | ✅   | 要回滚到的版本号 |

**权限要求：** owner、admin 或 editor

**说明：**

- 回滚会创建新版本（`head` 递增），不会覆盖历史版本
- 回滚后可以再次回滚到更早的版本

**响应示例：**

```json
{
  "success": true,
  "data": {
    "docId": "doc_1705123456789_xyz456",
    "head": 6,
    ...
  }
}
```

### 创建快照

**接口：** `POST /api/v1/documents/:docId/snapshots`

**说明：** 创建文档快照，保存当前版本的完整块版本映射

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**权限要求：** owner、admin 或 editor

**响应示例：**

```json
{
  "success": true,
  "data": {
    "snapshotId": "doc_123@snap@5",
    "docId": "doc_1705123456789_xyz456",
    "docVer": 5,
    "blockVersionMap": {
      "b_root": 1,
      "b_block_001": 3,
      "b_block_002": 2
    },
    "createdAt": "2024-01-15T12:00:00.000Z"
  }
}
```

**说明：**

- 快照是幂等的：如果已存在相同 `docVer` 的快照，直接返回
- 快照保存的是当前 `head` 的完整状态，可用于快速恢复

### 手动触发创建版本

**接口：** `POST /api/v1/documents/:docId/commit`

**说明：** 手动触发创建文档版本，将所有待创建的操作合并为一个版本

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**请求体：**

```json
{
  "message": "完成编辑"
}
```

**字段说明：**

| 字段      | 类型   | 必填 | 说明                    |
| --------- | ------ | ---- | ----------------------- |
| `message` | string | ❌   | 版本消息，最多500个字符 |

**权限要求：** owner、admin 或 editor

**响应示例：**

```json
{
  "success": true,
  "data": {
    "docId": "doc_1705123456789_xyz456",
    "version": 5,
    "pendingOperations": 3,
    "message": "完成编辑"
  }
}
```

**说明：**

- 如果文档没有待创建的版本（`pendingCount = 0`），会返回 `400 Bad Request`
- 创建的版本会包含所有待处理操作的数量信息
- 创建版本后，待创建版本计数会被清除

**状态码：**

- `200 OK` - 版本创建成功
- `400 Bad Request` - 没有待创建的版本
- `404 Not Found` - 文档不存在
- `403 Forbidden` - 没有权限

### 获取待创建版本数量

**接口：** `GET /api/v1/documents/:docId/pending-versions`

**说明：** 查询文档当前有多少待创建的版本

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**响应示例：**

```json
{
  "success": true,
  "data": {
    "docId": "doc_1705123456789_xyz456",
    "pendingCount": 3,
    "hasPending": true
  }
}
```

**字段说明：**

| 字段           | 类型    | 说明               |
| -------------- | ------- | ------------------ |
| `pendingCount` | number  | 待创建版本的数量   |
| `hasPending`   | boolean | 是否有待创建的版本 |

**状态码：**

- `200 OK` - 获取成功
- `404 Not Found` - 文档不存在
- `403 Forbidden` - 没有权限访问
