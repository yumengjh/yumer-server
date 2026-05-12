# 块移动操作指南

本文档详细说明如何使用 `POST /api/v1/blocks/:blockId/move` 接口移动块，以及如何精准控制块的位置。

## 概述

移动块操作可以改变块在文档树中的位置，包括：

- **改变父块**：将块移动到另一个父块下
- **改变顺序**：在同级块中调整块的显示顺序
- **改变缩进**：调整块的缩进级别

## API 接口

```
POST /api/v1/blocks/:blockId/move
```

### 请求参数

| 参数            | 类型    | 必填 | 说明                                |
| --------------- | ------- | ---- | ----------------------------------- |
| `parentId`      | string  | 是   | 目标父块ID（根块ID或父块的blockId） |
| `sortKey`       | string  | 是   | 排序键，用于确定在同级块中的位置    |
| `indent`        | number  | 否   | 缩进级别（默认：0）                 |
| `createVersion` | boolean | 否   | 是否立即创建文档版本（默认：true）  |

### 请求示例

```json
{
  "parentId": "b_1234567890_root",
  "sortKey": "250000",
  "indent": 0,
  "createVersion": true
}
```

## sortKey 详解

### 什么是 sortKey？

`sortKey` 是一个**数字字符串**，用于确定块在同级块中的显示顺序。系统通过数字比较来确定块的顺序：

- 数字越小，位置越靠前
- 数字越大，位置越靠后

### ⚠️ 重要提示

**不要手动传入小的 sortKey 值（如 "0", "1", "2"）！**

原因：

1. **空间不足**：小的值之间没有足够的空间插入新块
2. **排序混乱**：多个块使用相同的 sortKey 会导致排序不稳定
3. **难以维护**：后续移动块时会遇到空间不足的问题

**推荐做法**：

- ✅ **创建块时不传 sortKey**：让系统自动生成（推荐）
- ✅ **移动块时使用大间隔值**：如 "100000", "200000", "300000" 等
- ✅ **基于现有块的 sortKey 计算**：使用工具函数计算合适的值

### sortKey 的取值范围

- **理论范围**：`0` 到 `1000000`（或更大）
- **默认中间值**：`500000`（当没有同级块时使用）
- **推荐范围**：`100000` 到 `900000` 之间，间隔至少 `100000`
- **不推荐**：`0` 到 `10000` 之间的小值

### sortKey 的生成规则

系统使用**分数排序系统**（Fractional Indexing）来生成 `sortKey`：

```typescript
// 生成规则
generateSortKey(prevKey?, nextKey?): string

// 情况1：没有前后元素（第一个块）
generateSortKey() → "500000"

// 情况2：只有前一个元素（插入到最后）
generateSortKey("300000") → "400000"  // prevNum + 100000

// 情况3：只有后一个元素（插入到最前）
generateSortKey(null, "700000") → "600000"  // nextNum - 100000

// 情况4：前后都有元素（插入到中间）
generateSortKey("300000", "700000") → "500000"  // (prevNum + nextNum) / 2
```

**关键点**：

- 系统使用 `100000` 作为默认间隔
- 如果空间不足（差值 <= 1），会计算中间值，但可能导致精度问题
- 建议保持至少 `100000` 的间隔，以便后续插入

## 如何精准控制块的位置

### 步骤1：查询同级块的 sortKey

在移动块之前，需要先查询目标父块下的所有同级块，获取它们的 `sortKey`：

```javascript
// 1. 获取文档内容树
GET /api/v1/documents/:docId/content

// 2. 找到目标父块下的所有子块
// 假设父块ID为 "b_parent_123"
// 返回的树结构中，父块的 children 数组包含所有子块及其 sortKey
```

### 步骤2：确定目标位置

根据你想要的位置，选择合适的 `sortKey`：

#### 场景1：移动到最前面

```javascript
// 如果第一个块的 sortKey 是 "300000"
// 计算比它小的值，保持至少 100000 的间隔
const firstSortKey = parseInt(firstBlock.sortKey);
const targetSortKey = String(Math.max(0, firstSortKey - 100000));
// 结果: "200000"

{
  "parentId": "b_parent_123",
  "sortKey": targetSortKey  // 比第一个块小，保持间隔
}
```

**注意**：如果第一个块的 sortKey 很小（如 "0" 或 "1"），建议先重新分配所有块的 sortKey，或者使用负数（如果系统支持）。

#### 场景2：移动到两个块之间

```javascript
// 假设有两个块：
// - 块A: sortKey = "300000"
// - 块B: sortKey = "700000"
//
// 要插入到A和B之间，计算中间值：
const sortKeyA = parseInt(blockA.sortKey);
const sortKeyB = parseInt(blockB.sortKey);
const targetSortKey = String(Math.floor((sortKeyA + sortKeyB) / 2));
// 结果: "500000"

// 检查空间是否足够（至少 100000）
if (sortKeyB - sortKeyA < 100000) {
  // 空间不足，建议重新分配 sortKey 或使用中间值
  console.warn('空间不足，可能需要重新分配 sortKey');
}

{
  "parentId": "b_parent_123",
  "sortKey": targetSortKey  // A和B的中间值
}
```

#### 场景3：移动到最后面

```javascript
// 如果最后一个块的 sortKey 是 "800000"
// 计算比它大的值，保持至少 100000 的间隔
const lastSortKey = parseInt(lastBlock.sortKey);
const targetSortKey = String(lastSortKey + 100000);
// 结果: "900000"

{
  "parentId": "b_parent_123",
  "sortKey": targetSortKey  // 比最后一个块大，保持间隔
}
```

#### ⚠️ 特殊情况：处理小的 sortKey 值

如果现有块的 sortKey 很小（如 "0", "1", "2"），建议：

1. **方案1：重新分配所有块的 sortKey**（推荐）

   ```javascript
   // 批量移动所有块，使用大间隔的 sortKey
   const blocks = parentBlock.children;
   blocks.forEach((block, index) => {
     const newSortKey = String((index + 1) * 100000); // 100000, 200000, 300000...
     // 移动块到新位置
   });
   ```

2. **方案2：在现有值基础上扩展**
   ```javascript
   // 如果第一个块是 "0"，第二个块是 "1"
   // 移动到最前面：使用负数或很大的值
   // 移动到中间：计算 (0 + 1) / 2 = 0.5，但系统可能不支持小数
   // 建议：先重新分配 sortKey
   ```

### 步骤3：调用移动接口

```javascript
POST /api/v1/blocks/:blockId/move
{
  "parentId": "b_parent_123",
  "sortKey": "500000",
  "indent": 0
}
```

## 实际使用示例

### 示例1：将块移动到根块下的第一个位置

```javascript
// 1. 获取文档内容
const docContent = await fetch("/api/v1/documents/doc_123/content");
const tree = docContent.data.tree;

// 2. 找到根块的第一个子块
const rootBlockId = tree.blockId;
const firstChild = tree.children[0];
const firstChildSortKey = firstChild.sortKey || "500000";

// 3. 计算目标 sortKey（比第一个块小）
const targetSortKey = String(parseInt(firstChildSortKey) - 100000);

// 4. 移动块
await fetch(`/api/v1/blocks/${blockId}/move`, {
  method: "POST",
  body: JSON.stringify({
    parentId: rootBlockId,
    sortKey: targetSortKey,
    indent: 0,
  }),
});
```

### 示例2：将块移动到两个块之间

```javascript
// 1. 获取文档内容
const docContent = await fetch("/api/v1/documents/doc_123/content");

// 2. 找到目标位置的前后块
// 假设要插入到块A和块B之间
const blockA = { blockId: "b_a", sortKey: "300000" };
const blockB = { blockA: "b_b", sortKey: "700000" };

// 3. 计算中间值
const targetSortKey = String(
  Math.floor((parseInt(blockA.sortKey) + parseInt(blockB.sortKey)) / 2),
);
// targetSortKey = "500000"

// 4. 移动块
await fetch(`/api/v1/blocks/${blockId}/move`, {
  method: "POST",
  body: JSON.stringify({
    parentId: blockA.parentId, // 相同的父块
    sortKey: targetSortKey,
    indent: 0,
  }),
});
```

### 示例3：将块移动到另一个父块下

```javascript
// 1. 获取目标父块下的所有子块
const parentBlock = await getBlock(parentId);
const siblings = parentBlock.children;

// 2. 确定插入位置（例如：插入到最后）
let targetSortKey;
if (siblings.length === 0) {
  // 没有子块，使用默认值
  targetSortKey = "500000";
} else {
  // 有子块，获取最后一个的 sortKey
  const lastSibling = siblings[siblings.length - 1];
  const lastSortKey = parseInt(lastSibling.sortKey || "500000");
  // 设置为比最后一个大
  targetSortKey = String(lastSortKey + 100000);
}

// 3. 移动块
await fetch(`/api/v1/blocks/${blockId}/move`, {
  method: "POST",
  body: JSON.stringify({
    parentId: parentId,
    sortKey: targetSortKey,
    indent: 0,
  }),
});
```

## sortKey 计算工具函数

为了方便使用，这里提供一些工具函数：

### JavaScript/TypeScript 工具函数

```typescript
/**
 * 计算插入到两个块之间的 sortKey
 */
function calculateSortKeyBetween(
  prevSortKey: string,
  nextSortKey: string,
): string {
  const prevNum = parseInt(prevSortKey) || 0;
  const nextNum = parseInt(nextSortKey) || 1000000;

  if (nextNum - prevNum <= 1) {
    // 空间不足，返回中间值（可能需要重新分配）
    return String(Math.floor((prevNum + nextNum) / 2));
  }

  return String(Math.floor((prevNum + nextNum) / 2));
}

/**
 * 计算插入到最前面的 sortKey
 */
function calculateSortKeyBefore(firstSortKey: string): string {
  const firstNum = parseInt(firstSortKey) || 500000;
  return String(Math.max(0, firstNum - 100000));
}

/**
 * 计算插入到最后面的 sortKey
 */
function calculateSortKeyAfter(lastSortKey: string): string {
  const lastNum = parseInt(lastSortKey) || 500000;
  return String(lastNum + 100000);
}

/**
 * 计算插入到空列表的 sortKey
 */
function calculateSortKeyForEmpty(): string {
  return "500000";
}
```

### 使用示例

```typescript
// 插入到两个块之间
const sortKey = calculateSortKeyBetween("300000", "700000");
// 结果: "500000"

// 插入到最前面
const sortKey = calculateSortKeyBefore("300000");
// 结果: "200000"

// 插入到最后面
const sortKey = calculateSortKeyAfter("800000");
// 结果: "900000"
```

## 常见问题

### Q1: 可以随便传 sortKey 值吗？

**A:** **不建议！** 应该遵循以下原则：

- ✅ **推荐**：创建块时不传 sortKey，让系统自动生成
- ✅ **推荐**：移动块时使用大间隔值（至少 `100000` 的间隔）
- ✅ **推荐**：基于现有块的 sortKey 计算，使用工具函数
- ❌ **不推荐**：手动传入小的值（如 `"0"`, `"1"`, `"2"`）
- ❌ **不推荐**：使用连续的小整数（会导致空间不足）

**原因**：

- 小的 sortKey 值之间没有足够的空间插入新块
- 多个块使用相同或接近的 sortKey 会导致排序不稳定
- 后续移动块时会遇到空间不足的问题

### Q2: 如果 sortKey 冲突了怎么办？

**A:**

- 系统使用数字比较，如果两个块的 `sortKey` 相同，会按 `blockId` 进行稳定排序
- **但这不是推荐的做法**，会导致排序不稳定
- **解决方案**：重新分配所有块的 sortKey，使用大间隔值（如 `100000`, `200000`, `300000`...）
- 如果很多块的 sortKey 都是小值（如 "0", "1"），建议批量移动它们，使用新的 sortKey

### Q3: 如何确保块移动到准确的位置？

**A:**

1. 先查询目标父块下的所有同级块
2. 获取它们的 `sortKey`
3. 根据目标位置计算合适的 `sortKey`
4. 调用移动接口

### Q4: 移动块会影响子块吗？

**A:** 不会。移动块只会改变块本身的位置，不会影响其子块。子块会跟随父块一起移动（因为它们通过 `parentId` 关联）。

### Q5: 可以移动到已删除的块下吗？

**A:** 不可以。系统会验证父块是否存在且未被删除。如果父块已被删除，会返回 `404` 错误。

### Q6: 移动块会导致循环引用吗？

**A:** 系统会自动检测循环引用。如果移动操作会导致块成为自己的祖先，会返回 `400` 错误："移动操作会导致循环引用"。

## 最佳实践

### 1. 批量移动时使用延迟版本创建

```javascript
// 批量移动多个块
const moves = [
  { blockId: "b1", parentId: "p1", sortKey: "100000" },
  { blockId: "b2", parentId: "p1", sortKey: "200000" },
  { blockId: "b3", parentId: "p1", sortKey: "300000" },
];

for (const move of moves) {
  await fetch(`/api/v1/blocks/${move.blockId}/move`, {
    method: "POST",
    body: JSON.stringify({
      ...move,
      createVersion: false, // 延迟创建版本
    }),
  });
}

// 所有移动完成后，统一创建版本
await fetch(`/api/v1/documents/${docId}/commit`, {
  method: "POST",
  body: JSON.stringify({ message: "批量移动块" }),
});
```

### 2. 使用批量操作接口

对于多个块的移动，建议使用批量操作接口：

```javascript
POST /api/v1/blocks/batch
{
  "docId": "doc_123",
  "operations": [
    {
      "type": "move",
      "blockId": "b1",
      "parentId": "p1",
      "sortKey": "100000"
    },
    {
      "type": "move",
      "blockId": "b2",
      "parentId": "p1",
      "sortKey": "200000"
    }
  ],
  "createVersion": true
}
```

### 3. 预留足够的 sortKey 空间

在计算 `sortKey` 时，**必须**预留足够的空间（至少 `100000`），以便后续插入新块：

```typescript
// ✅ 好的做法：预留足够空间
const sortKey = String(prevSortKey + 100000); // 间隔 100000

// ✅ 更好的做法：使用工具函数
const sortKey = calculateSortKeyAfter(prevSortKey); // 自动计算

// ❌ 不好的做法：空间太小
const sortKey = String(prevSortKey + 1); // 间隔太小，很快会空间不足
const sortKey = String(prevSortKey + 100); // 间隔太小，不推荐
```

### 4. 处理已有的小 sortKey 值

如果文档中已有块的 sortKey 很小（如 "0", "1", "2"），建议：

1. **批量重新分配 sortKey**：

   ```javascript
   // 获取所有同级块
   const siblings = parentBlock.children;

   // 批量移动，使用大间隔的 sortKey
   const operations = siblings.map((block, index) => ({
     type: "move",
     blockId: block.blockId,
     parentId: parentBlock.blockId,
     sortKey: String((index + 1) * 100000), // 100000, 200000, 300000...
   }));

   // 使用批量操作接口
   await fetch("/api/v1/blocks/batch", {
     method: "POST",
     body: JSON.stringify({
       docId: docId,
       operations: operations,
       createVersion: true,
     }),
   });
   ```

2. **逐步迁移**：如果块很多，可以分批处理，每次处理一部分块

## 相关文档

- [文档块工作机制](./block-mechanism.md)：了解块的基本工作机制
- [数据结构设计](./data-structure-design.md)：了解块的数据结构
- [API 文档](../api/blocks.md)：了解块的 API 接口
