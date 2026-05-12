# 批量块操作 API 文档

本文档详细说明批量块操作接口的使用方式，包括接口说明、请求格式、操作类型、使用场景和最佳实践。

---

## 目录

- [接口概述](#接口概述)
- [请求格式](#请求格式)
- [操作类型详解](#操作类型详解)
- [使用示例](#使用示例)
- [响应格式](#响应格式)
- [错误处理](#错误处理)
- [最佳实践](#最佳实践)
- [常见问题](#常见问题)

---

## 接口概述

### 基本信息

- **接口路径：** `POST /api/v1/blocks/batch`
- **认证方式：** JWT Bearer Token（必填）
- **Content-Type：** `application/json`
- **功能：** 在一个事务中执行多个块操作（创建、更新、删除、移动）

### 核心特性

1. **事务执行**：所有操作在一个数据库事务中执行，保证数据一致性
2. **单次版本创建**：无论包含多少个操作，只创建一次文档版本（`DocRevision`）
3. **顺序执行**：按照 `operations` 数组的顺序依次执行每个操作
4. **错误隔离**：单个操作失败不会影响其他操作，但会在结果中标记失败

### 适用场景

- ✅ 初始化文档时批量创建多个块
- ✅ 复制粘贴多个块
- ✅ 批量更新多个块的内容
- ✅ 重构文档结构（移动、删除多个块）
- ✅ 需要保证多个操作原子性的场景

### 不适用场景

- ❌ 单个简单操作（建议使用单个操作接口）
- ❌ 需要实时反馈的交互操作（批量操作是异步的）
- ❌ 操作之间有复杂依赖关系（建议分步执行）

---

## 请求格式

### 基本结构

请求体是一个 JSON 对象，包含以下字段：

```json
{
  "docId": "string", // 文档ID（必填）
  "operations": [
    // 操作列表（必填，至少包含一个操作）
    // ... 操作对象
  ]
}
```

### 字段说明

| 字段         | 类型   | 必填 | 说明                                              |
| ------------ | ------ | ---- | ------------------------------------------------- |
| `docId`      | string | ✅   | 文档的唯一标识符，所有操作必须属于同一个文档      |
| `operations` | Array  | ✅   | 操作数组，至少包含一个操作，最多建议不超过 100 个 |

### 请求头

```http
POST /api/v1/blocks/batch HTTP/1.1
Host: localhost:5200
Authorization: Bearer <your-jwt-token>
Content-Type: application/json
```

### 操作类型

`operations` 数组中的每个元素必须包含 `type` 字段，用于标识操作类型：

- `create` - 创建新块
- `update` - 更新块内容
- `delete` - 删除块
- `move` - 移动块位置

每种操作类型都有不同的数据结构，详见下一节。

---

## 操作类型详解

### 1. 创建块 (create)

创建一个新的块。

**操作结构：**

```json
{
  "type": "create",
  "data": {
    "docId": "string", // 文档ID（必填）
    "type": "string", // 块类型，如 "paragraph", "heading"（必填）
    "payload": {}, // 块内容，JSON 对象（必填）
    "parentId": "string", // 父块ID，不传或为空则挂到根块（可选）
    "sortKey": "string", // 排序键，用于排序（可选）
    "indent": 0, // 缩进级别，默认 0（可选）
    "collapsed": false // 是否折叠，默认 false（可选）
  }
}
```

**字段说明：**

| 字段             | 类型    | 必填 | 说明                                               |
| ---------------- | ------- | ---- | -------------------------------------------------- |
| `type`           | string  | ✅   | 固定值 `"create"`                                  |
| `data.docId`     | string  | ✅   | 文档ID，必须与请求体中的 `docId` 一致              |
| `data.type`      | string  | ✅   | 块类型，如 `"paragraph"`, `"heading"`, `"list"` 等 |
| `data.payload`   | object  | ✅   | 块的实际内容，JSON 格式，根据块类型不同而不同      |
| `data.parentId`  | string  | ❌   | 父块ID，不传或为空字符串时，块会挂到根块下         |
| `data.sortKey`   | string  | ❌   | 排序键，用于块的位置排序，如 `"1"`, `"2"`, `"0.5"` |
| `data.indent`    | number  | ❌   | 缩进级别，默认 0                                   |
| `data.collapsed` | boolean | ❌   | 是否折叠，默认 false                               |

**示例：**

```json
{
  "type": "create",
  "data": {
    "docId": "doc_1234567890_abc123",
    "type": "paragraph",
    "payload": {
      "text": "这是第一段内容"
    },
    "parentId": "b_root_123",
    "sortKey": "1"
  }
}
```

### 2. 更新块 (update)

更新已存在块的内容。

**操作结构：**

```json
{
  "type": "update",
  "blockId": "string", // 块ID（必填）
  "data": {
    "payload": {}, // 新的块内容，JSON 对象（必填）
    "plainText": "string" // 纯文本内容，用于搜索（可选）
  }
}
```

**字段说明：**

| 字段             | 类型   | 必填 | 说明                                                  |
| ---------------- | ------ | ---- | ----------------------------------------------------- |
| `type`           | string | ✅   | 固定值 `"update"`                                     |
| `blockId`        | string | ✅   | 要更新的块的唯一标识符                                |
| `data.payload`   | object | ✅   | 新的块内容，JSON 格式                                 |
| `data.plainText` | string | ❌   | 纯文本内容，如果不提供，系统会自动从 `payload` 中提取 |

**示例：**

```json
{
  "type": "update",
  "blockId": "b_1234567890_xyz456",
  "data": {
    "payload": {
      "text": "更新后的内容"
    },
    "plainText": "更新后的内容"
  }
}
```

**注意：**

- 更新操作会创建新的块版本（`BlockVersion`），版本号自动递增
- 如果新内容的 hash 与当前版本相同，不会创建新版本（避免重复版本）

### 3. 删除块 (delete)

删除指定的块（软删除）。

**操作结构：**

```json
{
  "type": "delete",
  "blockId": "string" // 块ID（必填）
}
```

**字段说明：**

| 字段      | 类型   | 必填 | 说明                   |
| --------- | ------ | ---- | ---------------------- |
| `type`    | string | ✅   | 固定值 `"delete"`      |
| `blockId` | string | ✅   | 要删除的块的唯一标识符 |

**示例：**

```json
{
  "type": "delete",
  "blockId": "b_1234567890_xyz456"
}
```

**注意：**

- 删除是软删除，块不会被物理删除，只是标记为 `isDeleted = true`
- 删除块会级联删除其所有子块（递归软删除）
- 删除操作会创建新的块版本，用于记录删除状态

### 4. 移动块 (move)

移动块到新的位置（改变父块或排序）。

**操作结构：**

```json
{
  "type": "move",
  "blockId": "string", // 块ID（必填）
  "parentId": "string", // 目标父块ID（必填）
  "sortKey": "string", // 新的排序键（必填）
  "indent": 0 // 新的缩进级别（可选）
}
```

**字段说明：**

| 字段       | 类型   | 必填 | 说明                         |
| ---------- | ------ | ---- | ---------------------------- |
| `type`     | string | ✅   | 固定值 `"move"`              |
| `blockId`  | string | ✅   | 要移动的块的唯一标识符       |
| `parentId` | string | ✅   | 目标父块ID，必须属于同一文档 |
| `sortKey`  | string | ✅   | 新的排序键，用于在新位置排序 |
| `indent`   | number | ❌   | 新的缩进级别，默认保持原值   |

**示例：**

```json
{
  "type": "move",
  "blockId": "b_1234567890_xyz456",
  "parentId": "b_root_123",
  "sortKey": "0.5",
  "indent": 1
}
```

**注意：**

- 移动操作会创建新的块版本，记录新的位置信息
- 不能移动到自身或形成循环引用（如 A 是 B 的父，B 不能成为 A 的父）
- `parentId` 必须属于同一文档

---

## 使用示例

### 示例 1：批量创建多个块

场景：初始化文档时，一次性创建多个块。

**请求：**

```http
POST /api/v1/blocks/batch
Authorization: Bearer <your-token>
Content-Type: application/json

{
  "docId": "doc_1234567890_abc123",
  "operations": [
    {
      "type": "create",
      "data": {
        "docId": "doc_1234567890_abc123",
        "type": "heading",
        "payload": {
          "text": "第一章：介绍",
          "level": 1
        },
        "parentId": "b_root_123",
        "sortKey": "1"
      }
    },
    {
      "type": "create",
      "data": {
        "docId": "doc_1234567890_abc123",
        "type": "paragraph",
        "payload": {
          "text": "这是第一章的内容..."
        },
        "parentId": "b_root_123",
        "sortKey": "2"
      }
    },
    {
      "type": "create",
      "data": {
        "docId": "doc_1234567890_abc123",
        "type": "heading",
        "payload": {
          "text": "第二章：详细说明",
          "level": 1
        },
        "parentId": "b_root_123",
        "sortKey": "3"
      }
    }
  ]
}
```

**说明：**

- 所有操作都在同一个事务中执行
- 只创建一次文档版本（`head` 递增 1）
- 如果任何一个操作失败，整个事务会回滚

### 示例 2：混合操作（创建、更新、删除、移动）

场景：重构文档结构，同时进行多种操作。

**请求：**

```http
POST /api/v1/blocks/batch
Authorization: Bearer <your-token>
Content-Type: application/json

{
  "docId": "doc_1234567890_abc123",
  "operations": [
    {
      "type": "create",
      "data": {
        "docId": "doc_1234567890_abc123",
        "type": "paragraph",
        "payload": {
          "text": "新增的段落"
        },
        "parentId": "b_root_123",
        "sortKey": "1"
      }
    },
    {
      "type": "update",
      "blockId": "b_existing_001",
      "data": {
        "payload": {
          "text": "更新后的内容"
        },
        "plainText": "更新后的内容"
      }
    },
    {
      "type": "move",
      "blockId": "b_existing_002",
      "parentId": "b_root_123",
      "sortKey": "0.5",
      "indent": 0
    },
    {
      "type": "delete",
      "blockId": "b_old_003"
    }
  ]
}
```

**说明：**

- 操作按数组顺序执行
- 每个操作独立处理，单个失败不影响其他操作
- 所有操作完成后，只创建一次文档版本

### 示例 3：TypeScript/JavaScript 代码示例

**使用 Fetch API：**

```typescript
async function batchUpdateBlocks() {
  const response = await fetch("http://localhost:5200/api/v1/blocks/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      docId: "doc_1234567890_abc123",
      operations: [
        {
          type: "create",
          data: {
            docId: "doc_1234567890_abc123",
            type: "paragraph",
            payload: { text: "新段落" },
            parentId: "b_root_123",
            sortKey: "1",
          },
        },
        {
          type: "update",
          blockId: "b_existing_001",
          data: {
            payload: { text: "更新内容" },
            plainText: "更新内容",
          },
        },
      ],
    }),
  });

  const result = await response.json();
  if (result.success) {
    console.log(`成功: ${result.data.success}/${result.data.total}`);
    result.data.results.forEach((r: any) => {
      if (r.success) {
        console.log(`操作 ${r.operation} 成功`, r);
      } else {
        console.error(`操作 ${r.operation} 失败:`, r.error);
      }
    });
  }
}
```

**使用 Axios：**

```typescript
import axios from "axios";

async function batchUpdateBlocks() {
  try {
    const response = await axios.post(
      "http://localhost:5200/api/v1/blocks/batch",
      {
        docId: "doc_1234567890_abc123",
        operations: [
          {
            type: "create",
            data: {
              docId: "doc_1234567890_abc123",
              type: "paragraph",
              payload: { text: "新段落" },
              parentId: "b_root_123",
              sortKey: "1",
            },
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    console.log("批量操作结果:", response.data);
  } catch (error) {
    console.error("批量操作失败:", error);
  }
}
```

**使用 cURL：**

```bash
curl -X POST http://localhost:5200/api/v1/blocks/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-token>" \
  -d '{
    "docId": "doc_1234567890_abc123",
    "operations": [
      {
        "type": "create",
        "data": {
          "docId": "doc_1234567890_abc123",
          "type": "paragraph",
          "payload": {"text": "新段落"},
          "parentId": "b_root_123",
          "sortKey": "1"
        }
      }
    ]
  }'
```

---

## 响应格式

### 成功响应

**HTTP 状态码：** `200 OK`

**响应体结构：**

```json
{
  "success": true,
  "data": {
    "total": 5, // 总操作数
    "success": 4, // 成功数
    "failed": 1, // 失败数
    "results": [
      // 每个操作的详细结果
      {
        "success": true,
        "operation": "create",
        "blockId": "b_new_block_001",
        "version": 1
      },
      {
        "success": true,
        "operation": "update",
        "blockId": "b_existing_001",
        "version": 2
      },
      {
        "success": false,
        "operation": "delete",
        "error": "块不存在"
      }
    ]
  }
}
```

### 响应字段说明

| 字段           | 类型    | 说明                       |
| -------------- | ------- | -------------------------- |
| `success`      | boolean | 请求是否成功（true/false） |
| `data.total`   | number  | 总操作数                   |
| `data.success` | number  | 成功执行的操作数           |
| `data.failed`  | number  | 失败的操作数               |
| `data.results` | Array   | 每个操作的详细结果数组     |

### 操作结果结构

每个 `results` 数组中的元素结构：

**成功结果：**

```json
{
  "success": true,
  "operation": "create|update|delete|move",
  "blockId": "string", // 块ID（create/update/move 操作返回）
  "version": 1 // 块版本号（create/update/move 操作返回）
}
```

**失败结果：**

```json
{
  "success": false,
  "operation": "create|update|delete|move",
  "error": "错误信息"
}
```

### 错误响应

**HTTP 状态码：** `400 Bad Request` 或 `403 Forbidden` 等

**响应体结构：**

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述信息"
  }
}
```

**常见错误：**

- `400` - 请求参数错误（如 `docId` 不匹配、操作格式错误）
- `403` - 没有权限访问该文档
- `404` - 文档不存在

---

## 错误处理

### 事务回滚机制

批量操作在一个数据库事务中执行，但**单个操作失败不会导致整个事务回滚**。系统会：

1. 继续执行后续操作
2. 在结果中标记失败的操作
3. 所有操作完成后，创建一次文档版本

**示例：**

```json
{
  "total": 3,
  "success": 2,
  "failed": 1,
  "results": [
    {
      "success": true,
      "operation": "create",
      "blockId": "b_001",
      "version": 1
    },
    { "success": false, "operation": "update", "error": "块不存在" },
    { "success": true, "operation": "create", "blockId": "b_002", "version": 1 }
  ]
}
```

在这个例子中：

- 第一个创建操作成功
- 第二个更新操作失败（块不存在）
- 第三个创建操作仍然成功执行
- 最终文档版本只创建一次

### 常见错误及处理

#### 1. 块不存在

**错误信息：** `"块不存在"`

**原因：** 在 `update`、`delete` 或 `move` 操作中，指定的 `blockId` 不存在或已被删除

**处理建议：**

- 检查 `blockId` 是否正确
- 确认块未被删除（软删除的块无法操作）
- 在批量操作前，先验证所有块是否存在

#### 2. 文档ID不匹配

**错误信息：** `"父块必须属于同一文档"` 或类似

**原因：** 操作中的 `docId` 与请求体中的 `docId` 不一致，或 `parentId` 不属于同一文档

**处理建议：**

- 确保所有操作中的 `docId` 与请求体中的 `docId` 一致
- 验证 `parentId` 属于同一文档

#### 3. 循环引用

**错误信息：** `"移动操作会导致循环引用"`

**原因：** 移动操作会导致块之间的父子关系形成循环

**处理建议：**

- 检查移动操作的目标 `parentId`
- 确保不会将块移动到其子块下

#### 4. 权限不足

**错误信息：** `"没有权限"` 或 `403 Forbidden`

**原因：** 用户没有编辑该文档的权限

**处理建议：**

- 检查用户的工作空间权限
- 确认用户是文档所在工作空间的成员
- 验证 JWT Token 是否有效

### 错误处理最佳实践

1. **批量操作前验证**

   ```typescript
   // 先验证所有块是否存在
   const blockIds = operations
     .filter((op) => op.type !== "create")
     .map((op) => op.blockId);

   const existingBlocks = await checkBlocksExist(blockIds);
   if (existingBlocks.length !== blockIds.length) {
     // 处理缺失的块
   }
   ```

2. **处理部分失败**

   ```typescript
   const result = await batchUpdateBlocks();
   if (result.data.failed > 0) {
     // 记录失败的操作
     const failedOps = result.data.results.filter((r) => !r.success);
     console.error("失败的操作:", failedOps);

     // 可以选择重试失败的操作
     await retryFailedOperations(failedOps);
   }
   ```

3. **限制操作数量**
   ```typescript
   // 建议单次批量操作不超过 100 个
   if (operations.length > 100) {
     // 分批处理
     const batches = chunk(operations, 100);
     for (const batch of batches) {
       await batchUpdateBlocks(batch);
     }
   }
   ```

---

## 最佳实践

### 1. 操作顺序

批量操作按数组顺序执行，需要注意操作之间的依赖关系：

**✅ 正确示例：**

```json
{
  "operations": [
    {
      "type": "create",
      "data": { "blockId": "b_parent" }
    },
    {
      "type": "create",
      "data": { "parentId": "b_parent" } // 依赖上面的创建操作
    }
  ]
}
```

**❌ 错误示例：**

```json
{
  "operations": [
    {
      "type": "create",
      "data": { "parentId": "b_parent" } // 错误：b_parent 还未创建
    },
    {
      "type": "create",
      "data": { "blockId": "b_parent" }
    }
  ]
}
```

### 2. 性能优化

- **限制操作数量**：建议单次批量操作不超过 100 个操作
- **分批处理**：如果操作数量很大，可以分批处理
- **避免重复操作**：不要在批量操作中包含重复的操作

### 3. 版本控制

批量操作只创建一次文档版本，适合以下场景：

- ✅ 初始化文档结构
- ✅ 批量重构文档
- ✅ 复制粘贴操作
- ✅ 需要保证原子性的操作

如果需要每个操作都创建版本，应该使用单个操作接口。

### 4. 数据一致性

批量操作在事务中执行，但单个操作失败不会回滚整个事务。如果需要严格的原子性：

- 在批量操作前验证所有数据
- 处理部分失败的情况
- 考虑使用单个操作接口，逐个执行并处理错误

---

## 常见问题

### Q1: 批量操作和单个操作有什么区别？

**A:** 主要区别：

| 特性         | 单个操作         | 批量操作                 |
| ------------ | ---------------- | ------------------------ |
| 文档版本创建 | 每次操作都创建   | 所有操作完成后只创建一次 |
| 事务         | 每个操作独立事务 | 所有操作在同一事务       |
| 性能         | 多次数据库操作   | 一次数据库操作           |
| 适用场景     | 单个操作         | 多个相关操作             |

### Q2: 批量操作中，如果某个操作失败，其他操作会继续执行吗？

**A:** 会的。批量操作采用"错误隔离"机制：

- 单个操作失败不会影响其他操作
- 所有操作都会执行完成
- 失败的操作会在结果中标记
- 最终只创建一次文档版本

### Q3: 批量操作会创建多少个文档版本？

**A:** 只创建**一个**文档版本，无论包含多少个操作。这是批量操作的核心优势之一。

**示例：**

- 单个操作：5 个操作 = 5 个文档版本
- 批量操作：5 个操作 = 1 个文档版本

### Q4: 批量操作有数量限制吗？

**A:** 没有硬性限制，但建议：

- 单次批量操作不超过 100 个操作
- 如果操作数量很大，建议分批处理
- 过大的批量操作可能影响性能和响应时间

### Q5: 批量操作中的操作顺序重要吗？

**A:** 是的，操作按数组顺序执行。需要注意：

- 创建操作必须在依赖它的操作之前
- 删除操作会级联删除子块，需要注意顺序
- 移动操作不能形成循环引用

### Q6: 批量操作和单个操作，哪个性能更好？

**A:** 批量操作性能更好，因为：

- 只创建一次文档版本（减少数据库操作）
- 所有操作在同一事务中（减少事务开销）
- 减少网络请求次数

**建议：**

- 多个相关操作 → 使用批量操作
- 单个简单操作 → 使用单个操作接口

### Q7: 批量操作失败后，如何重试？

**A:** 可以这样处理：

```typescript
async function batchWithRetry(operations: any[], maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const result = await batchUpdateBlocks(operations);

    if (result.data.failed === 0) {
      return result; // 全部成功
    }

    // 提取失败的操作，准备重试
    const failedOps = result.data.results
      .filter((r) => !r.success)
      .map((r, idx) => operations[idx]);

    if (i < maxRetries - 1) {
      operations = failedOps; // 只重试失败的操作
    } else {
      throw new Error("重试次数用尽");
    }
  }
}
```

### Q8: 批量操作可以包含不同类型的操作吗？

**A:** 可以。批量操作支持混合不同类型的操作：

- 可以在一次批量操作中同时包含 `create`、`update`、`delete`、`move` 操作
- 操作按数组顺序执行
- 每个操作独立处理，互不影响

### Q9: 批量操作会触发活动日志吗？

**A:** 会的。批量操作会记录一条活动日志，包含操作总数：

```json
{
  "action": "block.batch",
  "entityType": "block",
  "details": {
    "count": 5 // 操作总数
  }
}
```

### Q10: 批量操作和文档版本的关系是什么？

**A:**

- 批量操作完成后，文档的 `head` 会递增 1
- 创建一个新的 `DocRevision` 记录
- 该 `DocRevision` 记录了批量操作完成时的时间点
- 可以通过该版本号获取批量操作后的文档状态

---

## 相关文档

- [API 使用文档](./API_USAGE.md) - 完整的 API 接口说明
- [文档操作流程指南](./DOCUMENT_WORKFLOW.md) - 从注册到创建文档、块的完整流程
- [版本控制机制说明](./VERSION_STRUCTURE.md) - 文档版本结构详解
- Swagger 文档: http://localhost:5200/api/docs

---

## 更新日志

- 2026-01-17 - 初始版本，包含完整的批量操作接口说明
