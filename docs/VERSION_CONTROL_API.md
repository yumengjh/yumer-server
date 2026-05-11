# 文档版本控制 API 文档

本文档说明如何控制文档版本的创建时机，包括延迟创建版本和手动触发版本创建的机制。

---

## 功能概述

### 核心功能

1. **延迟版本创建**：块操作时可以通过 `createVersion` 参数控制是否立即创建文档版本
2. **手动触发版本创建**：通过专门的接口手动触发文档版本创建
3. **文档隔离**：不同文档的版本控制状态完全隔离，互不影响

### 使用场景

- ✅ 用户快速输入时，避免每次操作都创建版本
- ✅ 批量编辑时，多个操作完成后统一创建版本
- ✅ 前端实现"保存"功能，用户点击保存时才创建版本
- ✅ 定时自动保存，定期创建版本

---

## 接口说明

### 1. 块操作接口（支持延迟版本创建）

所有块操作接口都支持 `createVersion` 参数：

#### 创建块

**接口：** `POST /api/v1/blocks`

**请求示例（延迟创建版本）：**

```json
{
  "docId": "doc_1234567890_abc123",
  "type": "paragraph",
  "payload": { "text": "内容" },
  "createVersion": false // 不立即创建版本
}
```

#### 更新块内容

**接口：** `PATCH /api/v1/blocks/:blockId/content`

**请求示例（延迟创建版本）：**

```json
{
  "payload": { "text": "更新后的内容" },
  "createVersion": false // 不立即创建版本
}
```

#### 移动块

**接口：** `POST /api/v1/blocks/:blockId/move`

**请求示例（延迟创建版本）：**

```json
{
  "parentId": "b_root_123",
  "sortKey": "0.5",
  "createVersion": false // 不立即创建版本
}
```

#### 批量操作

**接口：** `POST /api/v1/blocks/batch`

**请求示例（延迟创建版本）：**

```json
{
  "docId": "doc_1234567890_abc123",
  "createVersion": false,  // 不立即创建版本
  "operations": [
    {
      "type": "create",
      "data": { ... }
    },
    {
      "type": "update",
      "blockId": "...",
      "data": { ... }
    }
  ]
}
```

**注意：**

- `createVersion` 默认为 `true`（立即创建版本）
- 设置为 `false` 时，操作会记录到待创建版本计数中，但不立即创建版本
- 删除操作（`DELETE /api/v1/blocks/:blockId`）**总是立即创建版本**（重要操作）

---

### 2. 手动触发版本创建

**接口：** `POST /api/v1/documents/:docId/commit`

**功能：** 手动触发创建文档版本，将所有待创建的操作合并为一个版本

**请求头：**

```
Authorization: Bearer <your-token>
Content-Type: application/json
```

**请求体：**

```json
{
  "message": "完成编辑" // 可选，版本消息
}
```

**响应：**

```json
{
  "success": true,
  "data": {
    "docId": "doc_1234567890_abc123",
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

---

### 3. 获取待创建版本数量

**接口：** `GET /api/v1/documents/:docId/pending-versions`

**功能：** 查询文档当前有多少待创建的版本

**请求头：**

```
Authorization: Bearer <your-token>
```

**响应：**

```json
{
  "success": true,
  "data": {
    "docId": "doc_1234567890_abc123",
    "pendingCount": 3,
    "hasPending": true
  }
}
```

**说明：**

- `pendingCount`：待创建版本的数量（即有多少个块操作设置了 `createVersion: false`）
- `hasPending`：是否有待创建的版本（`pendingCount > 0`）

---

## 使用示例

### 示例 1：快速输入时延迟创建版本

**场景：** 用户快速输入，避免每次按键都创建版本

```typescript
// 用户输入时，设置 createVersion: false
async function updateBlockContent(blockId: string, content: string) {
  await fetch(`/api/v1/blocks/${blockId}/content`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      payload: { text: content },
      createVersion: false, // 延迟创建版本
    }),
  });
}

// 用户停止输入 2 秒后，或点击保存按钮时，手动创建版本
async function saveDocument(docId: string) {
  const response = await fetch(`/api/v1/documents/${docId}/commit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      message: "保存编辑",
    }),
  });
  return response.json();
}
```

### 示例 2：批量操作后统一创建版本

**场景：** 批量创建多个块，完成后统一创建版本

```typescript
// 批量创建块，不立即创建版本
async function batchCreateBlocks(docId: string, blocks: any[]) {
  await fetch("/api/v1/blocks/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      docId,
      createVersion: false, // 延迟创建版本
      operations: blocks.map((block) => ({
        type: "create",
        data: block,
      })),
    }),
  });
}

// 完成后手动创建版本
async function commitChanges(docId: string) {
  await fetch(`/api/v1/documents/${docId}/commit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      message: "批量创建完成",
    }),
  });
}
```

### 示例 3：定时自动保存

**场景：** 每 30 秒自动保存一次

```typescript
let autoSaveTimer: NodeJS.Timeout;

function startAutoSave(docId: string) {
  autoSaveTimer = setInterval(async () => {
    // 检查是否有待创建的版本
    const pendingRes = await fetch(
      `/api/v1/documents/${docId}/pending-versions`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const pending = await pendingRes.json();

    if (pending.data.hasPending) {
      // 有待创建的版本，自动保存
      await fetch(`/api/v1/documents/${docId}/commit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: "自动保存",
        }),
      });
      console.log("自动保存成功");
    }
  }, 30000); // 30 秒
}

function stopAutoSave() {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
  }
}
```

---

## 文档隔离机制

### 隔离保证

**重要：** 不同文档的版本控制状态完全隔离，互不影响。

**实现方式：**

- 使用 `Map<docId, { count, lastUpdate }>` 存储待创建版本计数
- 每个文档的 `docId` 作为唯一键
- 操作时只影响当前文档的计数

**示例：**

```
文档 A (doc_a): pendingCount = 3
文档 B (doc_b): pendingCount = 5
文档 C (doc_c): pendingCount = 0

操作文档 A 的块 → 只影响 doc_a 的计数
操作文档 B 的块 → 只影响 doc_b 的计数
提交文档 A 的版本 → 只清除 doc_a 的计数，不影响 doc_b
```

### 数据清理

- 系统会定期清理过期的待创建版本记录（超过 1 小时未更新）
- 手动提交版本时会清除该文档的计数
- 如果文档被删除，相关计数会在清理时自动清除

---

## 注意事项

### 1. 默认行为

- **默认 `createVersion: true`**：如果不指定 `createVersion` 参数，会立即创建版本（保持向后兼容）
- **删除操作总是立即创建版本**：删除是重要操作，不允许延迟

### 2. 事务安全

- 块操作在事务中执行
- 如果事务失败，待创建版本计数**不会**被记录（因为记录在事务成功后）
- 如果事务成功但后续记录失败，计数可能会丢失，但不影响数据一致性

### 3. 并发安全

- 使用内存 Map 存储，单实例部署时是线程安全的
- 多实例部署时，每个实例维护自己的计数（建议使用 Redis 实现分布式版本控制）

### 4. 性能考虑

- 待创建版本计数存储在内存中，不会影响数据库性能
- 定期清理机制避免内存泄漏
- 建议单次批量操作不超过 100 个操作

### 5. 错误处理

- 如果调用 `commit` 接口时没有待创建的版本，会返回 `400 Bad Request`
- 建议在提交前先调用 `GET /documents/:docId/pending-versions` 检查

---

## 相关文档

- [批量块操作 API 文档](./BATCH_BLOCKS_API.md) - 批量操作接口详细说明
- [文档操作流程指南](./DOCUMENT_WORKFLOW.md) - 完整的操作流程
- [版本控制机制说明](./VERSION_STRUCTURE.md) - 版本结构详解

---

## 更新日志

- 2026-01-17 - 初始版本，实现延迟版本创建和手动触发机制
