# 文档版本结构详解

本文档详细说明文档、块、版本之间的关系，以及如何理解"文档由块组成，块由版本组成"这一核心概念。

## 你的理解检查

### ✅ 正确的部分

1. **一个文档（Document）由多个块（Block）组成** - ✅ 正确
2. **每个块都有很多版本（BlockVersion），至少有一个** - ✅ 正确
3. **默认情况下块指向当前块的最新版本（latestVer）** - ✅ 正确
4. **可能因为其他操作改变指向，可能指向其他版本** - ✅ 正确（如回滚操作）
5. **每个版本块都装载了内容（payload）** - ✅ 正确

### ⚠️ 需要澄清的部分

6. **一个文档就是由多个块中的最新版本块的内容组成** - ⚠️ **部分正确，但有重要细节**

**关键点：**

- **获取最新版本（head）时**：确实是由所有块的 `latestVer` 组成
- **获取历史版本时**：**不是**使用 `latestVer`，而是根据时间点计算该版本下每个块应该使用的版本号

---

## 数据结构关系图

```
Document (文档)
├── docId: "doc_123"
├── head: 5                    ← 当前文档版本号
├── publishedHead: 3           ← 已发布的版本号
└── rootBlockId: "b_root"
    │
    ├── Block A (blockId: "b_a")
    │   ├── latestVer: 3       ← 指向最新版本（版本3）
    │   └── BlockVersion
    │       ├── ver: 1, payload: { text: "初始内容" }
    │       ├── ver: 2, payload: { text: "第一次修改" }
    │       └── ver: 3, payload: { text: "第二次修改" } ← latestVer 指向这里
    │
    ├── Block B (blockId: "b_b")
    │   ├── latestVer: 2       ← 指向最新版本（版本2）
    │   └── BlockVersion
    │       ├── ver: 1, payload: { text: "块B内容" }
    │       └── ver: 2, payload: { text: "块B更新" } ← latestVer 指向这里
    │
    └── Block C (blockId: "b_c")
        ├── latestVer: 1       ← 指向最新版本（版本1，从未修改）
        └── BlockVersion
            └── ver: 1, payload: { text: "块C内容" } ← latestVer 指向这里
```

---

## 核心机制：两种获取文档内容的方式

### 方式 1：获取最新版本（使用 latestVer）

**场景：** 获取当前文档内容（`head` 版本）

```http
GET /api/v1/documents/:docId/content
```

**逻辑：**

1. 获取文档的 `head`（如 `5`）
2. 找到所有块的 `latestVer`
3. 使用这些 `latestVer` 获取每个块的内容
4. 组装成文档内容树

**示例：**

```
文档 head = 5
├── Block A: latestVer = 3 → 使用 BlockVersion ver=3
├── Block B: latestVer = 2 → 使用 BlockVersion ver=2
└── Block C: latestVer = 1 → 使用 BlockVersion ver=1
```

**结果：** 文档内容 = 块A的版本3 + 块B的版本2 + 块C的版本1

✅ **你的理解在这里是正确的：文档由多个块的最新版本组成**

---

### 方式 2：获取历史版本（使用 blockVersionMap）

**场景：** 获取历史版本内容（如版本 3）

```http
GET /api/v1/documents/:docId/content?version=3
```

**逻辑：**

1. 找到文档版本 3 对应的 `DocRevision`（记录创建时间 `createdAt`）
2. 计算 `blockVersionMap`：查找在 `createdAt` 时间点之前，每个块的最新版本
3. 使用 `blockVersionMap` 获取每个块在该版本下的内容
4. 组装成文档内容树

**关键：** 这里**不使用** `latestVer`，而是根据时间点计算！

**示例：**

假设文档版本演进如下：

```
时间线：
10:00:00 - 创建文档，head=1
  ├── Block A: 创建 ver=1
  └── Block B: 创建 ver=1

10:01:00 - 更新块A，head=2
  ├── Block A: 更新 ver=2
  └── Block B: 不变 ver=1

10:02:00 - 创建块C，head=3
  ├── Block A: 不变 ver=2
  ├── Block B: 不变 ver=1
  └── Block C: 创建 ver=1

10:03:00 - 更新块A，head=4
  ├── Block A: 更新 ver=3
  ├── Block B: 不变 ver=1
  └── Block C: 不变 ver=1

10:04:00 - 更新块B，head=5
  ├── Block A: 不变 ver=3
  ├── Block B: 更新 ver=2
  └── Block C: 不变 ver=1
```

**当前状态（head=5）：**

```
Block A: latestVer = 3
Block B: latestVer = 2
Block C: latestVer = 1
```

**获取版本 3 的内容：**

1. 找到 `DocRevision`（docVer=3, createdAt=10:02:00）
2. 计算 `blockVersionMap`：
   - Block A：在 10:02:00 之前的最新版本是 ver=2（不是 ver=3！）
   - Block B：在 10:02:00 之前的最新版本是 ver=1
   - Block C：在 10:02:00 之前的最新版本是 ver=1（块C在版本3时已存在）
3. 使用 `blockVersionMap`：
   ```
   {
     "b_a": 2,  ← 不是 latestVer=3，而是版本3时的版本2
     "b_b": 1,
     "b_c": 1
   }
   ```

**结果：** 文档版本3的内容 = 块A的版本2 + 块B的版本1 + 块C的版本1

⚠️ **这里不是使用 latestVer，而是根据时间点计算！**

---

## 完整示例：理解版本演进

### 初始状态（head=1）

```
Document: head=1
├── Block A: latestVer=1
│   └── BlockVersion ver=1: { text: "初始A" }
└── Block B: latestVer=1
    └── BlockVersion ver=1: { text: "初始B" }
```

**获取 head=1 的内容：**

- 使用 Block A 的 ver=1（latestVer）
- 使用 Block B 的 ver=1（latestVer）
- ✅ 结果：由最新版本组成

---

### 更新块A后（head=2）

```
Document: head=2
├── Block A: latestVer=2  ← 更新了
│   ├── BlockVersion ver=1: { text: "初始A" }
│   └── BlockVersion ver=2: { text: "更新A" } ← latestVer 指向这里
└── Block B: latestVer=1  ← 未变化
    └── BlockVersion ver=1: { text: "初始B" }
```

**获取 head=2 的内容：**

- 使用 Block A 的 ver=2（latestVer）
- 使用 Block B 的 ver=1（latestVer）
- ✅ 结果：由最新版本组成

**获取 head=1 的内容（历史版本）：**

- 找到 DocRevision（docVer=1, createdAt=10:00:00）
- 计算 blockVersionMap：
  - Block A：在 10:00:00 之前的最新版本是 ver=1
  - Block B：在 10:00:00 之前的最新版本是 ver=1
- 使用 Block A 的 ver=1（不是 latestVer=2！）
- 使用 Block B 的 ver=1（latestVer）
- ⚠️ 结果：由历史版本组成（不是 latestVer）

---

### 回滚到版本1后（head=3）

```
Document: head=3  ← 回滚后创建新版本
├── Block A: latestVer=1  ← 回滚后指向版本1
│   ├── BlockVersion ver=1: { text: "初始A" } ← latestVer 指向这里
│   └── BlockVersion ver=2: { text: "更新A" } ← 历史版本，不再使用
└── Block B: latestVer=1
    └── BlockVersion ver=1: { text: "初始B" }
```

**获取 head=3 的内容：**

- 使用 Block A 的 ver=1（latestVer，回滚后已更新）
- 使用 Block B 的 ver=1（latestVer）
- ✅ 结果：由最新版本组成（但 latestVer 已被回滚操作修改）

**关键点：** 回滚操作会**修改**所有块的 `latestVer`，使其指向目标版本的版本号。

---

## 总结：你的理解 vs 实际情况

### ✅ 你的理解（部分正确）

> "一个文档就是由多个块中的最新版本块的内容组成"

**正确场景：**

- ✅ 获取最新版本（`head`）时：确实由所有块的 `latestVer` 组成
- ✅ 回滚后的最新版本：`latestVer` 已被修改，指向回滚目标版本

**不准确场景：**

- ⚠️ 获取历史版本时：**不是**使用 `latestVer`，而是根据时间点计算 `blockVersionMap`

### 📝 更准确的表述

**文档内容的组成方式：**

1. **获取最新版本（head）**：

   ```
   文档内容 = 所有块的 latestVer 对应的 BlockVersion
   ```

2. **获取历史版本（docVer < head）**：

   ```
   文档内容 = 根据 DocRevision.createdAt 计算 blockVersionMap
            = 每个块在该时间点之前的最新版本对应的 BlockVersion
   ```

3. **回滚后**：
   ```
   所有块的 latestVer 被修改为目标版本的版本号
   文档内容 = 所有块的 latestVer（已被修改）对应的 BlockVersion
   ```

---

## 关键数据结构

### Block.latestVer 的作用

- **作用1**：指向该块的最新版本号（用于获取最新内容）
- **作用2**：可以被回滚操作修改（指向历史版本）
- **作用3**：**不用于**获取历史版本内容（历史版本使用 `blockVersionMap`）

### blockVersionMap 的作用

- **作用**：记录文档某个版本下，每个块应该使用的版本号
- **计算方式**：根据 `DocRevision.createdAt` 时间点，查找该时间点之前每个块的最新版本
- **使用场景**：获取历史版本内容、版本对比、版本回滚

---

## 代码实现参考

### 获取最新版本（简化版）

```typescript
// 伪代码
async getContent(docId, undefined, userId) {
  const doc = await findDocument(docId);
  const docVer = doc.head; // 使用最新版本

  // 方式1：直接使用 latestVer（当前实现可能不完整）
  const blocks = await findBlocks(docId);
  const content = blocks.map(block =>
    getBlockVersion(block.blockId, block.latestVer)
  );

  return buildTree(content);
}
```

### 获取历史版本

```typescript
// 伪代码
async getContent(docId, version, userId) {
  const doc = await findDocument(docId);
  const docVer = version; // 使用指定版本

  // 方式2：计算 blockVersionMap
  const revision = await findDocRevision(docId, docVer);
  const blockVersionMap = await calculateBlockVersionMap(
    docId,
    revision.createdAt // 根据时间点计算
  );

  // 使用 blockVersionMap，而不是 latestVer
  const content = Object.entries(blockVersionMap).map(([blockId, ver]) =>
    getBlockVersion(blockId, ver) // 使用计算出的版本号
  );

  return buildTree(content);
}
```

---

## 常见问题

### Q1: 为什么获取历史版本不使用 latestVer？

**A:** 因为 `latestVer` 可能已经被后续操作修改（如回滚），不能代表历史版本的状态。

**示例：**

- 版本3时：Block A 的 latestVer=2
- 版本5时：回滚到版本1，Block A 的 latestVer=1
- 获取版本3的内容：如果使用 latestVer=1，会得到错误的内容

### Q2: blockVersionMap 是如何计算的？

**A:** 根据 `DocRevision.createdAt` 时间点，查找该时间点之前每个块的最新版本。

**SQL 逻辑（简化）：**

```sql
SELECT blockId, MAX(ver) as maxVer
FROM block_versions
WHERE docId = :docId
  AND createdAt <= :revisionCreatedAt
GROUP BY blockId
```

### Q3: 回滚操作会做什么？

**A:**

1. 计算目标版本的 `blockVersionMap`
2. 将所有块的 `latestVer` 修改为目标版本映射中的版本号
3. 软删除目标版本中不存在的块
4. 创建新的 `DocRevision`（`head` 递增）

---

## 相关文档

- [文档操作流程指南](./DOCUMENT_WORKFLOW.md) - 包含版本控制机制的详细说明
- [API 使用文档](./API_USAGE.md) - API 接口说明
