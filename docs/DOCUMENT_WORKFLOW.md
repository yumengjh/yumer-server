# 文档操作流程指南

本文档说明从注册到创建、编辑文档与块的完整操作流程，包括接口调用顺序、前置条件与获取必要资源的方法。

## 目录

- [快速流程概览](#快速流程概览)
- [详细步骤说明](#详细步骤说明)
- [版本控制机制说明](#版本控制机制说明)
- [获取必要资源](#获取必要资源)
- [完整示例代码](#完整示例代码)
- [常见场景](#常见场景)
- [注意事项](#注意事项)

---

## 快速流程概览

```
1. 注册/登录 → 获取 accessToken
2. 创建工作空间 → 获取 workspaceId
3. 创建文档 → 获取 docId 和 rootBlockId
4. 创建块（可选 parentId，不传则挂到根块）→ 获取 blockId
5. 更新块内容 → 使用 blockId
6. 移动块 → 使用 blockId
7. 发布文档 → 使用 docId
8. 获取文档内容/渲染树 → 使用 docId
```

**关键点：**

- 创建文档时会**自动创建根块**（`rootBlockId`），无需手动创建
- 创建块时，`parentId` 不传或为空字符串时，块会挂到根块下
- 所有操作都需要 `accessToken`（除注册/登录外）

---

## 详细步骤说明

### 步骤 1: 用户认证

#### 1.1 注册用户

**接口：** `POST /api/v1/auth/register`

**请求：**

```json
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "displayName": "John Doe"
}
```

**响应：**

```json
{
  "success": true,
  "data": {
    "user": { "userId": "u_...", "username": "john_doe", ... },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**需要保存：** `accessToken`、`refreshToken`（用于后续请求）

#### 1.2 用户登录（如已注册）

**接口：** `POST /api/v1/auth/login`

**请求：**

```json
{
  "emailOrUsername": "john@example.com",
  "password": "SecurePass123!"
}
```

**响应：** 同注册，返回 `accessToken` 和 `refreshToken`

---

### 步骤 2: 创建工作空间

**前置条件：** 已登录，有 `accessToken`

**接口：** `POST /api/v1/workspaces`

**请求头：**

```
Authorization: Bearer <accessToken>
```

**请求：**

```json
{
  "name": "我的工作空间",
  "description": "用于文档管理",
  "icon": "📁"
}
```

**响应：**

```json
{
  "success": true,
  "data": {
    "workspaceId": "ws_1705123456789_abc123",
    "name": "我的工作空间",
    "description": "用于文档管理",
    "icon": "📁",
    "userRole": "owner",
    ...
  }
}
```

**需要保存：** `workspaceId`（用于创建文档）

**说明：**

- 创建者自动成为 `owner`
- 可通过 `GET /api/v1/workspaces` 获取工作空间列表

---

### 步骤 3: 创建文档

**前置条件：** 有 `workspaceId` 和 `accessToken`

**接口：** `POST /api/v1/documents`

**请求头：**

```
Authorization: Bearer <accessToken>
```

**请求：**

```json
{
  "workspaceId": "ws_1705123456789_abc123",
  "title": "我的第一篇文档",
  "icon": "📄",
  "visibility": "workspace",
  "tags": ["示例", "测试"],
  "category": "技术文档"
}
```

**响应：**

```json
{
  "success": true,
  "data": {
    "docId": "doc_1705123456789_xyz456",
    "workspaceId": "ws_1705123456789_abc123",
    "title": "我的第一篇文档",
    "rootBlockId": "b_1705123456789_root789",
    "head": 1,
    "status": "draft",
    ...
  }
}
```

**需要保存：** `docId`、`rootBlockId`

**重要说明：**

- 创建文档时，系统会**自动创建根块**（`rootBlockId`）
- 根块类型为 `root`，初始 `payload` 为 `{ type: 'root', children: [] }`
- 后续创建的子块，如果不指定 `parentId` 或传空字符串，会挂到根块下

---

### 步骤 4: 创建块

**前置条件：** 有 `docId`、`rootBlockId`（可选，用于指定父块）和 `accessToken`

**接口：** `POST /api/v1/blocks`

**请求头：**

```
Authorization: Bearer <accessToken>
```

**请求（挂到根块下）：**

```json
{
  "docId": "doc_1705123456789_xyz456",
  "type": "paragraph",
  "payload": { "text": "这是第一段内容" },
  "parentId": "b_1705123456789_root789",
  "sortKey": "1"
}
```

**请求（不指定 parentId，默认挂到根块）：**

```json
{
  "docId": "doc_1705123456789_xyz456",
  "type": "paragraph",
  "payload": { "text": "这也是第一段内容" },
  "sortKey": "1"
}
```

**响应：**

```json
{
  "success": true,
  "data": {
    "blockId": "b_1705123456790_block001",
    "docId": "doc_1705123456789_xyz456",
    "type": "paragraph",
    "version": 1,
    "payload": { "text": "这是第一段内容" }
  }
}
```

**需要保存：** `blockId`（用于后续更新、移动、删除）

**说明：**

- `parentId` 可选：不传或为空时，块会挂到根块（`rootBlockId`）下
- `sortKey` 用于排序，如 `"0"`、`"1"`、`"0.5"` 等
- `type` 可以是 `paragraph`、`heading`、`list` 等
- `payload` 是 JSON 对象，内容根据 `type` 而定

---

### 步骤 5: 更新块内容

**前置条件：** 有 `blockId` 和 `accessToken`

**接口：** `PATCH /api/v1/blocks/:blockId/content`

**请求头：**

```
Authorization: Bearer <accessToken>
```

**请求：**

```json
{
  "payload": { "text": "这是更新后的内容" },
  "plainText": "这是更新后的内容"
}
```

**响应：**

```json
{
  "success": true,
  "data": {
    "blockId": "b_1705123456790_block001",
    "version": 2,
    "payload": { "text": "这是更新后的内容" }
  }
}
```

**说明：**

- 每次更新会创建新版本（`version` 递增）
- 如果 `payload` 的 hash 未变化，不会创建新版本，返回当前版本

---

### 步骤 6: 移动块

**前置条件：** 有 `blockId`、目标 `parentId`（可选，不传则仍在原父块下，仅调整排序）和 `accessToken`

**接口：** `POST /api/v1/blocks/:blockId/move`

**请求：**

```json
{
  "parentId": "b_1705123456789_root789",
  "sortKey": "0.5",
  "indent": 0
}
```

**响应：**

```json
{
  "success": true,
  "data": {
    "blockId": "b_1705123456790_block001",
    "version": 3,
    "parentId": "b_1705123456789_root789",
    "sortKey": "0.5"
  }
}
```

**说明：**

- 移动操作会创建新版本
- `parentId` 必须属于同一文档
- 不能移动到自身或形成循环引用

---

### 步骤 7: 批量操作块

**前置条件：** 有 `docId` 和 `accessToken`

**接口：** `POST /api/v1/blocks/batch`

**请求：**

```json
{
  "docId": "doc_1705123456789_xyz456",
  "operations": [
    {
      "type": "create",
      "data": {
        "docId": "doc_1705123456789_xyz456",
        "type": "paragraph",
        "payload": { "text": "批量创建的块1" },
        "parentId": "b_1705123456789_root789",
        "sortKey": "2"
      }
    },
    {
      "type": "update",
      "blockId": "b_1705123456790_block001",
      "data": {
        "payload": { "text": "批量更新的内容" }
      }
    },
    {
      "type": "delete",
      "blockId": "b_1705123456790_block002"
    },
    {
      "type": "move",
      "blockId": "b_1705123456790_block003",
      "parentId": "b_1705123456789_root789",
      "sortKey": "1.5",
      "indent": 1
    }
  ]
}
```

**响应：**

```json
{
  "success": true,
  "data": {
    "total": 4,
    "success": 4,
    "failed": 0,
    "results": [
      {
        "success": true,
        "operation": "create",
        "blockId": "...",
        "version": 1
      },
      {
        "success": true,
        "operation": "update",
        "blockId": "...",
        "version": 2
      },
      { "success": true, "operation": "delete" },
      { "success": true, "operation": "move", "blockId": "...", "version": 2 }
    ]
  }
}
```

---

### 步骤 8: 获取文档内容（渲染树）

**前置条件：** 有 `docId` 和 `accessToken`

**接口：** `GET /api/v1/documents/:docId/content?version=<可选>`

**请求头：**

```
Authorization: Bearer <accessToken>
```

**响应：**

```json
{
  "success": true,
  "data": {
    "docId": "doc_1705123456789_xyz456",
    "docVer": 1,
    "title": "我的第一篇文档",
    "tree": {
      "blockId": "b_1705123456789_root789",
      "type": "root",
      "payload": { "type": "root", "children": [] },
      "children": [
        {
          "blockId": "b_1705123456790_block001",
          "type": "paragraph",
          "payload": { "text": "这是第一段内容" },
          "version": 1
        }
      ]
    }
  }
}
```

**说明：**

- `version` 查询参数可选，不传则使用最新版本（`head`）
- `tree` 包含根块及其子块的树形结构

---

### 步骤 9: 发布文档

**前置条件：** 有 `docId` 和 `accessToken`

**接口：** `POST /api/v1/documents/:docId/publish`

**请求头：**

```
Authorization: Bearer <accessToken>
```

**响应：**

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

- 将 `publishedHead` 设置为当前 `head`
- 已发布的版本可通过 `GET /api/v1/documents/:docId/content?version=<publishedHead>` 获取

---

### 步骤 10: 更新文档元数据

**前置条件：** 有 `docId` 和 `accessToken`

**接口：** `PATCH /api/v1/documents/:docId`

**请求：**

```json
{
  "title": "更新后的标题",
  "tags": ["新标签1", "新标签2"],
  "visibility": "public"
}
```

**响应：** 返回更新后的文档详情

---

## 版本控制机制说明

### 数据结构层次

文档系统采用**三层版本控制结构**：

```
Document（文档）
  ├── head: 当前文档版本号（每次块操作递增）
  ├── publishedHead: 已发布的版本号
  └── rootBlockId: 根块ID
      │
      └── Block（块）
            ├── blockId: 块唯一标识
            ├── latestVer: 该块的最新版本号
            ├── isDeleted: 是否已删除（软删除）
            └── BlockVersion（块版本）
                  ├── ver: 版本号（1, 2, 3...）
                  ├── payload: 块内容（JSON）
                  ├── parentId: 父块ID
                  ├── sortKey: 排序键
                  ├── indent: 缩进级别
                  └── collapsed: 是否折叠
```

**关键概念：**

1. **Document（文档）**
   - 文档本身不存储内容，只存储元数据（标题、标签、可见性等）
   - `head`：当前文档版本号，每次块操作（创建/更新/删除/移动）会递增
   - `publishedHead`：已发布的版本号，用于区分草稿和已发布版本

2. **Block（块）**
   - 文档由多个块组成，形成树形结构（根块 → 子块 → 孙块...）
   - 每个块有唯一的 `blockId`
   - `latestVer`：指向该块的最新版本号
   - 支持软删除（`isDeleted = true`）

3. **BlockVersion（块版本）**
   - 每次更新块内容时，会创建新的 `BlockVersion`，版本号递增
   - 每个版本记录：
     - `payload`：块的实际内容（JSON格式，如 `{ text: "内容" }`）
     - `parentId`、`sortKey`、`indent`、`collapsed`：块在树中的位置信息
   - 如果 `payload` 的 hash 未变化，不会创建新版本（避免重复版本）

4. **DocRevision（文档修订）**
   - 记录文档的每个版本（`docVer`）
   - 每次块操作时自动创建新的 `DocRevision`
   - 通过时间点（`createdAt`）计算该版本下每个块使用的版本号

### 版本映射机制

**核心问题：** 文档的某个版本（如 `head=5`）下，每个块应该使用哪个版本？

**解决方案：** `blockVersionMap`（块版本映射）

```typescript
// blockVersionMap 示例
{
  "b_root_123": 1,        // 根块使用版本 1
  "b_block_001": 3,       // 块001使用版本 3
  "b_block_002": 2,       // 块002使用版本 2
  "b_block_003": 1        // 块003使用版本 1
}
```

**计算方式：**

- 根据 `DocRevision.createdAt` 时间点，查找该时间点之前每个块的最新版本
- 例如：文档版本 5 的 `createdAt` 是 `2026-01-17 10:00:00`
  - 块001在 `10:00:00` 之前有版本 1、2、3，则使用版本 3
  - 块002在 `10:00:00` 之前有版本 1、2，则使用版本 2

### 获取文档内容的流程

**获取最新版本（默认）：**

```http
GET /api/v1/documents/:docId/content
```

**流程：**

1. 获取文档信息，得到 `head`（当前版本号，如 `5`）
2. 找到 `docVer = 5` 的 `DocRevision`
3. 根据 `DocRevision.createdAt` 计算 `blockVersionMap`
4. 根据 `blockVersionMap` 获取每个块的 `BlockVersion`
5. 构建树形结构（根据 `parentId` 和 `sortKey` 排序）

**获取指定版本：**

```http
GET /api/v1/documents/:docId/content?version=3
```

**流程：**

1. 找到 `docVer = 3` 的 `DocRevision`
2. 根据 `DocRevision.createdAt` 计算 `blockVersionMap`
3. 根据 `blockVersionMap` 获取每个块的 `BlockVersion`
4. 构建树形结构

### 版本操作示例

#### 示例：文档版本演进

假设文档初始状态：

```
Document: head = 1
  Block A (blockId: "b_a"): latestVer = 1
    BlockVersion A-v1: { text: "初始内容" }
```

**操作 1：更新块 A 的内容**

```
POST /api/v1/blocks/b_a/content
{ payload: { text: "更新后的内容" } }
```

结果：

```
Document: head = 2  (递增)
  Block A: latestVer = 2  (递增)
    BlockVersion A-v1: { text: "初始内容" }
    BlockVersion A-v2: { text: "更新后的内容" }  (新增)
  DocRevision v2: { docVer: 2, createdAt: "2026-01-17 10:01:00" }
```

**操作 2：创建新块 B**

```
POST /api/v1/blocks
{ docId: "...", type: "paragraph", payload: { text: "新块" } }
```

结果：

```
Document: head = 3  (递增)
  Block A: latestVer = 2
  Block B (blockId: "b_b"): latestVer = 1  (新块)
    BlockVersion B-v1: { text: "新块" }
  DocRevision v3: { docVer: 3, createdAt: "2026-01-17 10:02:00" }
```

**获取版本 2 的内容：**

```
GET /api/v1/documents/:docId/content?version=2
```

系统会：

1. 找到 `DocRevision v2`（`createdAt = "2026-01-17 10:01:00"`）
2. 计算 `blockVersionMap`：
   ```json
   {
     "b_root": 1,
     "b_a": 2 // 在 10:01:00 之前，块A的最新版本是 2
     // 块B在 10:01:00 时还不存在，所以不在映射中
   }
   ```
3. 返回块A的版本2内容（`{ text: "更新后的内容" }`），不包含块B

### 版本对比与回滚

#### 版本对比

**接口：** `GET /api/v1/documents/:docId/diff?fromVer=2&toVer=3`

**原理：**

- 分别计算两个版本的 `blockVersionMap`
- 构建两个版本的内容树
- 返回差异（新增、删除、修改的块）

#### 版本回滚

**接口：** `POST /api/v1/documents/:docId/revert`

```json
{ "version": 2 }
```

**流程：**

1. 计算目标版本（版本2）的 `blockVersionMap`
2. 将所有块的 `latestVer` 恢复为目标版本映射中的版本号
3. 软删除目标版本中不存在的块（如块B在版本2时不存在，则删除）
4. 创建新的 `DocRevision`（`head` 递增，如从 3 变为 4）

**结果：**

```
Document: head = 4  (递增)
  Block A: latestVer = 2  (恢复为版本2)
  Block B: isDeleted = true  (软删除，因为版本2中不存在)
  DocRevision v4: { docVer: 4, message: "Revert to version 2" }
```

### 快照机制

**接口：** `POST /api/v1/documents/:docId/snapshots`

**用途：** 保存当前版本的完整 `blockVersionMap`，用于快速恢复

**存储：** `DocSnapshot` 表

```typescript
{
  snapshotId: "doc_123@snap@5",
  docId: "doc_123",
  docVer: 5,
  blockVersionMap: {
    "b_root": 1,
    "b_a": 2,
    "b_b": 1
  }
}
```

**说明：**

- 快照是幂等的：如果已存在相同 `docVer` 的快照，直接返回
- 快照保存的是当前 `head` 的完整状态，可用于快速回滚

### 版本控制最佳实践

1. **获取文档内容时指定版本**
   - 默认获取最新版本（`head`）
   - 查看历史版本时，使用 `?version=<docVer>` 参数

2. **发布文档**
   - 发布时，`publishedHead` 设置为当前 `head`
   - 已发布版本的内容不会因后续编辑而改变

3. **版本回滚**
   - 回滚会创建新版本（`head` 递增），不会覆盖历史版本
   - 回滚后可以再次回滚到更早的版本

4. **块版本管理**
   - 每次更新块内容都会创建新版本
   - 如果内容未变化（hash相同），不会创建新版本
   - 删除块是软删除，可以通过版本回滚恢复

5. **性能考虑**
   - 获取历史版本需要计算 `blockVersionMap`，可能较慢
   - 快照可以加速特定版本的访问
   - 建议定期创建快照，用于重要版本

---

## 获取必要资源

### 如何获取 workspaceId？

**方法 1：** 创建时获取（见步骤 2）

**方法 2：** 从工作空间列表获取

```http
GET /api/v1/workspaces?page=1&pageSize=20
Authorization: Bearer <accessToken>
```

响应中的 `data.items[].workspaceId`

**方法 3：** 从工作空间详情获取

```http
GET /api/v1/workspaces/:workspaceId
Authorization: Bearer <accessToken>
```

---

### 如何获取 docId 和 rootBlockId？

**方法 1：** 创建时获取（见步骤 3）

**方法 2：** 从文档列表获取

```http
GET /api/v1/documents?workspaceId=<workspaceId>&page=1&pageSize=20
Authorization: Bearer <accessToken>
```

响应中的 `data.items[].docId`、`data.items[].rootBlockId`

**方法 3：** 从文档详情获取

```http
GET /api/v1/documents/:docId
Authorization: Bearer <accessToken>
```

响应中的 `data.docId`、`data.rootBlockId`

---

### 如何获取 blockId？

**方法 1：** 创建时获取（见步骤 4）

**方法 2：** 从文档内容树获取

```http
GET /api/v1/documents/:docId/content
Authorization: Bearer <accessToken>
```

遍历 `data.tree` 及其 `children`，提取 `blockId`

**方法 3：** 从块版本历史获取（如果已知块存在）

```http
GET /api/v1/blocks/:blockId/versions?page=1&pageSize=20
Authorization: Bearer <accessToken>
```

---

### 如何获取根块 ID（rootBlockId）？

**方法 1：** 创建文档时返回（见步骤 3）

**方法 2：** 从文档详情获取

```http
GET /api/v1/documents/:docId
Authorization: Bearer <accessToken>
```

响应中的 `data.rootBlockId`

**方法 3：** 从文档内容树获取

```http
GET /api/v1/documents/:docId/content
Authorization: Bearer <accessToken>
```

响应中的 `data.tree.blockId` 即为根块 ID

---

## 完整示例代码

### TypeScript / JavaScript (Fetch API)

```typescript
const BASE_URL = "http://localhost:5200/api/v1";

// 存储必要的 ID
let accessToken: string;
let workspaceId: string;
let docId: string;
let rootBlockId: string;
let blockId: string;

// 1. 登录
async function login() {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      emailOrUsername: "john@example.com",
      password: "SecurePass123!",
    }),
  });
  const data = await res.json();
  if (data.success) {
    accessToken = data.data.accessToken;
    console.log("登录成功，accessToken:", accessToken);
  }
}

// 2. 创建工作空间
async function createWorkspace() {
  const res = await fetch(`${BASE_URL}/workspaces`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      name: "我的工作空间",
      description: "示例",
      icon: "📁",
    }),
  });
  const data = await res.json();
  if (data.success) {
    workspaceId = data.data.workspaceId;
    console.log("工作空间创建成功，workspaceId:", workspaceId);
  }
}

// 3. 创建文档
async function createDocument() {
  const res = await fetch(`${BASE_URL}/documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      workspaceId,
      title: "我的第一篇文档",
      visibility: "workspace",
      tags: ["示例"],
    }),
  });
  const data = await res.json();
  if (data.success) {
    docId = data.data.docId;
    rootBlockId = data.data.rootBlockId;
    console.log("文档创建成功，docId:", docId, "rootBlockId:", rootBlockId);
  }
}

// 4. 创建块（挂到根块下）
async function createBlock() {
  const res = await fetch(`${BASE_URL}/blocks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      docId,
      type: "paragraph",
      payload: { text: "这是第一段内容" },
      parentId: rootBlockId, // 或省略，默认挂到根块
      sortKey: "1",
    }),
  });
  const data = await res.json();
  if (data.success) {
    blockId = data.data.blockId;
    console.log("块创建成功，blockId:", blockId);
  }
}

// 5. 更新块内容
async function updateBlock() {
  const res = await fetch(`${BASE_URL}/blocks/${blockId}/content`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      payload: { text: "更新后的内容" },
      plainText: "更新后的内容",
    }),
  });
  const data = await res.json();
  if (data.success) {
    console.log("块更新成功，新版本:", data.data.version);
  }
}

// 6. 获取文档内容树
async function getDocumentContent() {
  const res = await fetch(`${BASE_URL}/documents/${docId}/content`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await res.json();
  if (data.success) {
    console.log("文档内容树:", data.data.tree);
    // tree 包含根块和所有子块的树形结构
  }
}

// 7. 发布文档
async function publishDocument() {
  const res = await fetch(`${BASE_URL}/documents/${docId}/publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await res.json();
  if (data.success) {
    console.log("文档已发布，publishedHead:", data.data.publishedHead);
  }
}

// 执行完整流程
async function fullWorkflow() {
  await login();
  await createWorkspace();
  await createDocument();
  await createBlock();
  await updateBlock();
  await getDocumentContent();
  await publishDocument();
}

// 运行
fullWorkflow().catch(console.error);
```

### cURL 示例

```bash
# 1. 登录
TOKEN=$(curl -X POST http://localhost:5200/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"emailOrUsername":"john@example.com","password":"SecurePass123!"}' \
  | jq -r '.data.accessToken')

# 2. 创建工作空间
WORKSPACE_ID=$(curl -X POST http://localhost:5200/api/v1/workspaces \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"我的工作空间","description":"示例","icon":"📁"}' \
  | jq -r '.data.workspaceId')

# 3. 创建文档
DOC_RESPONSE=$(curl -X POST http://localhost:5200/api/v1/documents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"workspaceId\":\"$WORKSPACE_ID\",\"title\":\"我的文档\",\"visibility\":\"workspace\"}")

DOC_ID=$(echo $DOC_RESPONSE | jq -r '.data.docId')
ROOT_BLOCK_ID=$(echo $DOC_RESPONSE | jq -r '.data.rootBlockId')

# 4. 创建块
BLOCK_ID=$(curl -X POST http://localhost:5200/api/v1/blocks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"docId\":\"$DOC_ID\",\"type\":\"paragraph\",\"payload\":{\"text\":\"内容\"},\"parentId\":\"$ROOT_BLOCK_ID\",\"sortKey\":\"1\"}" \
  | jq -r '.data.blockId')

# 5. 获取文档内容
curl -X GET "http://localhost:5200/api/v1/documents/$DOC_ID/content" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## 常见场景

### 场景 1: 创建文档并添加多个块

```typescript
// 1-3. 登录、创建工作空间、创建文档（获取 docId, rootBlockId）

// 4. 批量创建多个块
const blocks = [
  { type: "heading", payload: { text: "标题1", level: 1 }, sortKey: "1" },
  { type: "paragraph", payload: { text: "段落1" }, sortKey: "2" },
  { type: "paragraph", payload: { text: "段落2" }, sortKey: "3" },
];

for (const block of blocks) {
  await fetch(`${BASE_URL}/blocks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      docId,
      ...block,
      parentId: rootBlockId, // 都挂到根块下
    }),
  });
}
```

### 场景 2: 创建嵌套块（子块）

```typescript
// 先创建父块
const parentRes = await fetch(`${BASE_URL}/blocks`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    docId,
    type: "list",
    payload: { type: "unordered", items: [] },
    parentId: rootBlockId,
    sortKey: "1",
  }),
});
const parentData = await parentRes.json();
const parentBlockId = parentData.data.blockId;

// 再创建子块（挂到父块下）
await fetch(`${BASE_URL}/blocks`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    docId,
    type: "list-item",
    payload: { text: "列表项1" },
    parentId: parentBlockId, // 挂到父块
    sortKey: "1",
    indent: 1,
  }),
});
```

### 场景 3: 获取文档完整内容并渲染

```typescript
async function getFullDocument(docId: string) {
  // 获取文档详情
  const docRes = await fetch(`${BASE_URL}/documents/${docId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const doc = await docRes.json();

  // 获取文档内容树
  const contentRes = await fetch(`${BASE_URL}/documents/${docId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const content = await contentRes.json();

  return {
    meta: doc.data, // 文档元数据（标题、标签等）
    tree: content.data.tree, // 块树结构
  };
}

// 递归渲染块树
function renderBlockTree(node: any): string {
  if (!node) return "";

  let html = "";
  switch (node.type) {
    case "paragraph":
      html = `<p>${node.payload.text}</p>`;
      break;
    case "heading":
      html = `<h${node.payload.level}>${node.payload.text}</h${node.payload.level}>`;
      break;
    // ... 其他类型
  }

  if (node.children && node.children.length > 0) {
    html += node.children.map(renderBlockTree).join("");
  }

  return html;
}
```

### 场景 4: 更新文档并添加标签

```typescript
// 先创建标签（可选）
const tagRes = await fetch(`${BASE_URL}/tags`, {
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
const tagId = tagRes.json().then((d) => d.data.tagId);

// 更新文档，添加标签
await fetch(`${BASE_URL}/documents/${docId}`, {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    tags: ["示例", "重要"], // 标签名数组
  }),
});
```

---

## 注意事项

### 1. 根块的特殊性

- **自动创建**：创建文档时自动创建，类型为 `root`，无需手动创建
- **作为父块**：创建子块时，`parentId` 不传或为空时，默认挂到根块下
- **不可删除**：根块不能删除，删除文档时会级联删除

### 2. 块的父子关系

- **同一文档**：`parentId` 必须属于同一文档
- **循环引用**：不能将块移动到自身或形成循环（如 A 是 B 的父，B 不能成为 A 的父）
- **空 parentId**：不传或为空字符串时，挂到根块下

### 3. 版本控制

- **文档版本（head）**：每次块操作（创建/更新/删除/移动）会递增文档的 `head`
- **块版本（latestVer）**：每次更新块内容会创建新版本，`version` 递增；如果内容未变化（hash相同），不会创建新版本
- **发布版本（publishedHead）**：`publishedHead` 是已发布的文档版本号，发布后不会因后续编辑而改变
- **版本映射（blockVersionMap）**：文档的每个版本通过 `blockVersionMap` 记录该版本下每个块使用的版本号，基于时间点计算
- **获取历史版本**：使用 `GET /documents/:docId/content?version=<docVer>` 获取指定版本的内容
- **版本回滚**：回滚会创建新版本（`head` 递增），不会覆盖历史版本，可以多次回滚
- **性能考虑**：获取历史版本需要计算 `blockVersionMap`，可能较慢；建议对重要版本创建快照

### 4. 权限要求

- **工作空间权限**：创建文档需要工作空间访问权限
- **编辑权限**：更新文档/块需要工作空间编辑权限（owner/admin/editor）
- **管理权限**：删除文档需要工作空间管理权限（owner/admin）

### 5. 批量操作

- **事务性**：`POST /blocks/batch` 在事务中执行，部分失败会回滚
- **操作顺序**：`operations` 数组按顺序执行
- **结果**：返回 `{ total, success, failed, results }`，`results` 包含每个操作的结果

### 6. 获取资源的最佳实践

- **创建时保存**：创建后立即保存返回的 ID（`workspaceId`、`docId`、`rootBlockId`、`blockId`）
- **列表查询**：需要查找已有资源时，使用列表接口（带分页）
- **详情查询**：需要完整信息时，使用详情接口

### 7. 错误处理

- **404**：资源不存在（如 `docId` 错误）
- **403**：权限不足（如非工作空间成员）
- **400**：参数错误（如 `parentId` 不属于同一文档）
- **409**：冲突（如标签名重复）

---

## 相关文档

- [API 使用文档](./API_USAGE.md) - 完整的 API 接口说明
- [用户行为 E2E 测试](./E2E_USER_JOURNEY.md) - 完整的测试流程示例
- [API 设计文档](./API_DESIGN.md) - 详细的数据结构与设计
- Swagger 文档: http://localhost:5200/api/docs
