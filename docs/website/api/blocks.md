# 块 API

块模块提供文档块（内容单元）的创建、更新、移动、删除等功能。

## 接口列表

| 方法   | 路径                        | 说明       | 认证 |
| ------ | --------------------------- | ---------- | ---- |
| POST   | `/blocks`                   | 创建块     | 是   |
| PATCH  | `/blocks/:blockId/content`  | 更新块内容 | 是   |
| POST   | `/blocks/:blockId/move`     | 移动块     | 是   |
| DELETE | `/blocks/:blockId`          | 删除块     | 是   |
| GET    | `/blocks/:blockId/versions` | 块版本历史 | 是   |
| POST   | `/blocks/batch`             | 批量操作   | 是   |

## 创建块

**接口：** `POST /api/v1/blocks`

**说明：** 创建新的块

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**请求体：**

```json
{
  "docId": "doc_1705123456789_xyz456",
  "type": "paragraph",
  "payload": {
    "text": "这是第一段内容"
  },
  "parentId": "b_root_123",
  "sortKey": "500000",
  "indent": 0,
  "collapsed": false,
  "createVersion": true
}
```

**字段说明：**

| 字段            | 类型    | 必填 | 说明                                          |
| --------------- | ------- | ---- | --------------------------------------------- |
| `docId`         | string  | ✅   | 文档ID                                        |
| `type`          | string  | ✅   | 块类型，如 `paragraph`、`heading`、`list` 等  |
| `payload`       | object  | ✅   | 块的实际内容，JSON 格式，根据块类型不同而不同 |
| `parentId`      | string  | ❌   | 父块ID，不传或为空字符串时，块会挂到根块下    |
| `sortKey`       | string  | ❌   | 排序键，用于块的位置排序（详见下方说明）      |
| `indent`        | number  | ❌   | 缩进级别，默认 0                              |
| `collapsed`     | boolean | ❌   | 是否折叠，默认 false                          |
| `createVersion` | boolean | ❌   | 是否立即创建文档版本，默认 `true`             |

### sortKey 字段详解

`sortKey` 是一个**数字字符串**，用于确定块在同级块中的显示顺序。系统通过数字比较来确定块的顺序：

- 数字越小，位置越靠前
- 数字越大，位置越靠后

#### ⚠️ 重要提示

**强烈建议：创建块时不要手动传入 `sortKey`！**

**原因：**

1. **自动生成更可靠**：系统会根据同级块的位置自动生成合适的 `sortKey`，确保新块出现在最后
2. **避免冲突**：手动传入小的值（如 `"0"`, `"1"`, `"2"`）容易导致多个块使用相同的 `sortKey`
3. **空间不足**：小的 `sortKey` 值之间没有足够的空间，后续插入新块时会遇到问题
4. **排序不稳定**：多个块使用相同或接近的 `sortKey` 会导致排序不稳定

#### sortKey 的取值范围

- **推荐范围**：`100000` 到 `900000` 之间，间隔至少 `100000`
- **默认值**：如果不传 `sortKey`，系统会自动生成（通常为 `500000` 或基于同级块计算）
- **不推荐**：`0` 到 `10000` 之间的小值（如 `"0"`, `"1"`, `"2"`）

#### 自动生成规则

如果不传 `sortKey`，系统会：

1. 查询同级块（相同 `parentId`）的最新版本
2. 按 `sortKey` 排序，获取最后一个同级块的 `sortKey`
3. 生成比最后一个更大的 `sortKey`（增加 `100000`），确保新块出现在最后

**示例：**

```javascript
// ✅ 推荐：不传 sortKey，让系统自动生成
{
  "docId": "doc_123",
  "type": "paragraph",
  "payload": { "text": "新段落" }
  // 不传 sortKey，系统会自动生成
}

// ✅ 可以：传入大间隔的值（如果需要精确控制位置）
{
  "docId": "doc_123",
  "type": "paragraph",
  "payload": { "text": "新段落" },
  "sortKey": "500000"  // 大间隔值，可以
}

// ❌ 不推荐：传入小的值
{
  "docId": "doc_123",
  "type": "paragraph",
  "payload": { "text": "新段落" },
  "sortKey": "1"  // 太小，不推荐
}

// ❌ 错误：多个块使用相同的 sortKey
// 块1: sortKey = "1"
// 块2: sortKey = "1"  // 相同值，会导致排序不稳定
```

#### 最佳实践

1. **创建块时**：
   - ✅ **不传 `sortKey`**：让系统自动生成（推荐）
   - ✅ **不传 `parentId`**：让块自动挂到根块下
   - ❌ **不要传小的 `sortKey` 值**（如 `"0"`, `"1"`, `"2"`）
   - ❌ **不要多个块使用相同的 `sortKey`**

2. **批量创建块时**：

   ```javascript
   // ✅ 好的做法：不传 sortKey，让系统自动生成
   const blocks = [
     { type: "paragraph", payload: { text: "段落1" } },
     { type: "paragraph", payload: { text: "段落2" } },
     { type: "paragraph", payload: { text: "段落3" } },
   ];

   // 每个块都会自动获得合适的 sortKey
   ```

3. **如果需要精确控制位置**：
   - 先获取文档内容，查看现有块的 `sortKey`
   - 使用大间隔的值（至少 `100000` 的间隔）
   - 或者使用移动接口（`POST /api/v1/blocks/:blockId/move`）来调整位置

**响应示例：**

```json
{
  "success": true,
  "data": {
    "blockId": "b_1705123456790_block001",
    "docId": "doc_1705123456789_xyz456",
    "type": "paragraph",
    "version": 1,
    "payload": {
      "text": "这是第一段内容"
    }
  }
}
```

**重要说明：**

- 如果 `parentId` 不传或为空字符串，块会挂到根块（`rootBlockId`）下
- **强烈建议不传 `sortKey`**，让系统自动生成，避免排序问题
- `createVersion` 默认为 `true`，设置为 `false` 时不会立即创建文档版本（用于批量操作或快速输入场景）

**状态码：**

- `201 Created` - 创建成功
- `400 Bad Request` - 请求参数错误
- `403 Forbidden` - 没有权限访问文档
- `404 Not Found` - 父块不存在

## 更新块内容

**接口：** `PATCH /api/v1/blocks/:blockId/content`

**说明：** 更新块的内容

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**路径参数：**

| 参数      | 类型   | 说明 |
| --------- | ------ | ---- |
| `blockId` | string | 块ID |

**请求体：**

```json
{
  "payload": {
    "text": "更新后的内容"
  },
  "plainText": "更新后的内容",
  "createVersion": true
}
```

**字段说明：**

| 字段            | 类型    | 必填 | 说明                                                  |
| --------------- | ------- | ---- | ----------------------------------------------------- |
| `payload`       | object  | ✅   | 新的块内容，JSON 格式                                 |
| `plainText`     | string  | ❌   | 纯文本内容，如果不提供，系统会自动从 `payload` 中提取 |
| `createVersion` | boolean | ❌   | 是否立即创建文档版本，默认 `true`                     |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "blockId": "b_1705123456790_block001",
    "version": 2,
    "payload": {
      "text": "更新后的内容"
    }
  }
}
```

**说明：**

- 更新操作会创建新的块版本（`BlockVersion`），版本号自动递增
- 如果新内容的 hash 与当前版本相同，不会创建新版本（避免重复版本）
- `createVersion` 默认为 `true`，设置为 `false` 时不会立即创建文档版本

**状态码：**

- `200 OK` - 更新成功
- `404 Not Found` - 块不存在
- `403 Forbidden` - 没有权限

## 移动块

**接口：** `POST /api/v1/blocks/:blockId/move`

**说明：** 移动块到新的位置（改变父块或排序）

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**路径参数：**

| 参数      | 类型   | 说明 |
| --------- | ------ | ---- |
| `blockId` | string | 块ID |

**请求体：**

```json
{
  "parentId": "b_root_123",
  "sortKey": "0.5",
  "indent": 1,
  "createVersion": true
}
```

**字段说明：**

| 字段            | 类型    | 必填 | 说明                              |
| --------------- | ------- | ---- | --------------------------------- |
| `parentId`      | string  | ✅   | 目标父块ID，必须属于同一文档      |
| `sortKey`       | string  | ✅   | 新的排序键，用于在新位置排序      |
| `indent`        | number  | ❌   | 新的缩进级别，默认保持原值        |
| `createVersion` | boolean | ❌   | 是否立即创建文档版本，默认 `true` |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "blockId": "b_1705123456790_block001",
    "version": 3,
    "parentId": "b_root_123",
    "sortKey": "0.5"
  }
}
```

**说明：**

- 移动操作会创建新的块版本，记录新的位置信息
- 不能移动到自身或形成循环引用（如 A 是 B 的父，B 不能成为 A 的父）
- `parentId` 必须属于同一文档

**状态码：**

- `200 OK` - 移动成功
- `404 Not Found` - 块不存在
- `403 Forbidden` - 没有权限
- `400 Bad Request` - 移动操作无效（如循环引用）

## 删除块

**接口：** `DELETE /api/v1/blocks/:blockId`

**说明：** 删除块（软删除），**总是立即创建文档版本**（重要操作）

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数      | 类型   | 说明 |
| --------- | ------ | ---- |
| `blockId` | string | 块ID |

**权限要求：** owner、admin 或 editor

**响应示例：**

```json
{
  "success": true,
  "data": {
    "message": "块已删除"
  }
}
```

**说明：**

- 删除是软删除，块不会被物理删除，只是标记为 `isDeleted = true`
- 删除块会级联删除其所有子块（递归软删除）
- 删除操作**总是立即创建文档版本**，不支持延迟创建

**状态码：**

- `200 OK` - 删除成功
- `404 Not Found` - 块不存在
- `403 Forbidden` - 没有权限

## 获取块版本历史

**接口：** `GET /api/v1/blocks/:blockId/versions`

**说明：** 获取块的所有版本历史

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数      | 类型   | 说明 |
| --------- | ------ | ---- |
| `blockId` | string | 块ID |

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
        "versionId": "b_001@3",
        "blockId": "b_1705123456790_block001",
        "ver": 3,
        "payload": {
          "text": "更新后的内容"
        },
        "createdAt": "2024-01-15T12:00:00.000Z",
        "createdBy": "u_1705123456789_abc123"
      },
      {
        "versionId": "b_001@2",
        "blockId": "b_1705123456790_block001",
        "ver": 2,
        "payload": {
          "text": "第一次修改"
        },
        "createdAt": "2024-01-15T11:00:00.000Z",
        "createdBy": "u_1705123456789_abc123"
      }
    ],
    "total": 3,
    "page": 1,
    "pageSize": 20
  }
}
```

**状态码：**

- `200 OK` - 获取成功
- `404 Not Found` - 块不存在
- `403 Forbidden` - 没有权限

## 批量操作块

**接口：** `POST /api/v1/blocks/batch`

**说明：** 在一个事务中执行多个块操作（创建、更新、删除、移动），只创建一次文档版本

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**请求体：**

```json
{
  "docId": "doc_1705123456789_xyz456",
  "createVersion": true,
  "operations": [
    {
      "type": "create",
      "data": {
        "docId": "doc_1705123456789_xyz456",
        "type": "paragraph",
        "payload": { "text": "新段落" }
        // 不传 parentId 和 sortKey，系统会自动处理
      }
    },
    {
      "type": "update",
      "blockId": "b_existing_001",
      "data": {
        "payload": { "text": "更新内容" }
      }
    },
    {
      "type": "delete",
      "blockId": "b_old_002"
    },
    {
      "type": "move",
      "blockId": "b_existing_003",
      "parentId": "b_root_123",
      "sortKey": "0.5",
      "indent": 0
    }
  ]
}
```

**字段说明：**

| 字段            | 类型    | 必填 | 说明                              |
| --------------- | ------- | ---- | --------------------------------- |
| `docId`         | string  | ✅   | 文档ID                            |
| `createVersion` | boolean | ❌   | 是否立即创建文档版本，默认 `true` |
| `operations`    | Array   | ✅   | 操作列表，至少包含一个操作        |

**操作类型：**

1. **create** - 创建块

   ```json
   {
     "type": "create",
     "data": {
       "docId": "...",
       "type": "paragraph",
       "payload": { ... }
       // 不传 parentId 和 sortKey，系统会自动处理
     }
   }
   ```

2. **update** - 更新块

   ```json
   {
     "type": "update",
     "blockId": "b_...",
     "data": {
       "payload": { ... }
     }
   }
   ```

3. **delete** - 删除块

   ```json
   {
     "type": "delete",
     "blockId": "b_..."
   }
   ```

4. **move** - 移动块
   ```json
   {
     "type": "move",
     "blockId": "b_...",
     "parentId": "...",
     "sortKey": "0.5",
     "indent": 0
   }
   ```

**响应示例：**

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
        "blockId": "b_new_001",
        "version": 1
      },
      {
        "success": true,
        "operation": "update",
        "blockId": "b_existing_001",
        "version": 2
      },
      {
        "success": true,
        "operation": "delete"
      },
      {
        "success": true,
        "operation": "move",
        "blockId": "b_existing_003",
        "version": 2
      }
    ]
  }
}
```

**核心特性：**

- 所有操作在一个事务中执行，保证数据一致性
- 无论包含多少个操作，只创建一次文档版本（如果 `createVersion` 为 `true`）
- 操作按数组顺序执行
- 单个操作失败不会影响其他操作，但会在结果中标记失败

**状态码：**

- `200 OK` - 批量操作完成
- `400 Bad Request` - 请求参数错误
- `403 Forbidden` - 没有权限访问文档

## 版本控制参数说明

### createVersion 参数

所有块操作接口（除删除外）都支持 `createVersion` 参数：

- **默认值：** `true`（立即创建文档版本）
- **设置为 `false`：** 不立即创建文档版本，操作会记录到待创建版本计数中
- **手动触发：** 使用 `POST /api/v1/documents/:docId/commit` 手动创建版本

**使用场景：**

- 快速输入时，避免每次操作都创建版本
- 批量编辑时，多个操作完成后统一创建版本
- 前端实现"保存"功能，用户点击保存时才创建版本

**示例：**

```typescript
// 快速输入，不立即创建版本
await updateBlock(blockId, {
  payload: { text: "新内容" },
  createVersion: false, // 延迟创建版本
});

// 用户点击保存时，手动创建版本
await commitVersion(docId, { message: "保存编辑" });
```

## 代码示例

### JavaScript / TypeScript

```typescript
// 创建块
async function createBlock(docId: string) {
  const response = await fetch("http://localhost:5200/api/v1/blocks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      docId,
      type: "paragraph",
      payload: { text: "新段落" },
      // 不传 parentId，块会自动挂到根块下
      // 不传 sortKey，系统会自动生成合适的值
    }),
  });
  return await response.json();
}

// 更新块内容
async function updateBlock(blockId: string, content: string) {
  const response = await fetch(
    `http://localhost:5200/api/v1/blocks/${blockId}/content`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        payload: { text: content },
        createVersion: false, // 延迟创建版本
      }),
    },
  );
  return await response.json();
}

// 批量操作
async function batchUpdateBlocks(docId: string, operations: any[]) {
  const response = await fetch("http://localhost:5200/api/v1/blocks/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      docId,
      createVersion: false, // 延迟创建版本
      operations,
    }),
  });
  return await response.json();
}
```
