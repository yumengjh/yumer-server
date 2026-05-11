# 数据结构设计

本文档详细说明文档和块的数据结构，帮助理解系统的核心数据模型。

## 文档结构概述

每个文档（Document）由以下部分组成：

1. **文档元数据**：标题、标签、可见性等
2. **根块（Root Block）**：文档树的根节点
3. **内容块（Content Blocks）**：文档的实际内容，以树形结构组织

## 根块（Root Block）

### 基本概念

- 每个文档**有且仅有一个根块**
- 根块的 `type` 为 `"root"`
- 根块的 `blockId` 存储在 `Document.rootBlockId` 字段中
- 创建文档时，系统会自动创建根块

### 根块结构

```json
{
  "blockId": "b_1768729164714_cf9551dd",
  "type": "root",
  "payload": {
    "type": "root",
    "children": [],
    "text": ""
  },
  "children": []
}
```

**重要说明：**

- `payload.children` 是根块 payload 的内部结构，**不是实际的子块**
- 实际的子块关系通过**外层的 `children` 数组**维护
- 根块的 `payload.children` 通常为空数组，仅用于标识这是根块

## 块（Block）结构

### 基本结构

每个块包含以下字段：

```json
{
  "blockId": "b_1768730672350_f3bc0fc4",
  "type": "paragraph",
  "payload": {
    "text": "这是第一段内容006"
  },
  "children": [
    {
      "blockId": "b_1768730671453_a952c319",
      "type": "paragraph",
      "payload": {
        "text": "这是第一段内容001"
      },
      "children": []
    }
  ]
}
```

### 字段说明

| 字段       | 类型   | 说明                                                 |
| ---------- | ------ | ---------------------------------------------------- |
| `blockId`  | string | 块的唯一标识符，格式如 `b_<timestamp>_<random>`      |
| `type`     | string | 块类型，如 `root`、`paragraph`、`heading`、`list` 等 |
| `payload`  | object | 块的实际内容，JSON 格式，根据块类型不同而不同        |
| `children` | array  | **子块数组**，包含所有直接子块，形成树形结构         |

### Payload 结构

**根块的 payload：**

```json
{
  "type": "root",
  "children": [],
  "text": ""
}
```

**普通块的 payload：**

```json
{
  "text": "块的实际内容"
}
```

**重要区别：**

- ✅ **根块**的 `payload` 包含 `type: "root"` 和 `children: []`
- ❌ **普通块**的 `payload` **不包含** `children` 字段
- ✅ 所有块的**子块关系**都通过**外层的 `children` 数组**维护

## 树形结构

### 父子关系

文档内容以**树形结构**组织：

```
根块 (root)
├── 段落块 1 (paragraph)
│   └── 段落块 1.1 (paragraph)  ← 嵌套子块
├── 段落块 2 (paragraph)
└── 段落块 3 (paragraph)
```

### 实际数据结构示例

```json
{
  "blockId": "b_1768729164714_cf9551dd",
  "type": "root",
  "payload": {
    "type": "root",
    "children": []
  },
  "children": [
    {
      "blockId": "b_1768730672350_f3bc0fc4",
      "type": "paragraph",
      "payload": {
        "text": "这是第一段内容006"
      },
      "children": [
        {
          "blockId": "b_1768730671453_a952c319",
          "type": "paragraph",
          "payload": {
            "text": "这是第一段内容001"
          },
          "children": []
        }
      ]
    },
    {
      "blockId": "b_1768730831216_a7e49f45",
      "type": "paragraph",
      "payload": {
        "text": "这是第一段内容006"
      },
      "children": []
    }
  ]
}
```

### 关键理解

1. **一个块只能有一个父块**
   - 通过 `parentId` 字段维护父子关系
   - 根块没有父块（`parentId` 指向自身或为空）

2. **子块存储在 `children` 数组中**
   - 不是存储在 `payload.children` 中
   - `payload` 只存储块的实际内容

3. **树形结构通过递归 `children` 数组构建**
   - 每个块都可以有子块
   - 子块又可以有自己的子块，形成无限嵌套

## 真实文档示例

下面通过一个真实的文档示例，展示 Markdown 视图与 JSON 数据结构的对应关系。

### Markdown 视图（用户看到的样子）

```markdown
# 项目介绍

这是一个知识库管理系统，提供了完整的文档编辑功能。

## 核心功能

### 块级编辑

- 支持多种块类型
  - 段落块
  - 标题块
  - 列表块
- 支持嵌套结构

### 版本控制

系统会自动记录每次修改，支持版本回滚。

## 技术栈

- NestJS：后端框架
- PostgreSQL：数据库
- VitePress：文档生成
```

### JSON 数据结构（系统存储的样子）

```json
{
  "blockId": "b_1768729164714_cf9551dd",
  "type": "root",
  "payload": {
    "type": "root",
    "children": [],
    "text": ""
  },
  "children": [
    {
      "blockId": "b_1768730672350_f3bc0fc4",
      "type": "heading",
      "payload": {
        "text": "项目介绍",
        "level": 1
      },
      "children": []
    },
    {
      "blockId": "b_1768730831216_a7e49f45",
      "type": "paragraph",
      "payload": {
        "text": "这是一个知识库管理系统，提供了完整的文档编辑功能。"
      },
      "children": []
    },
    {
      "blockId": "b_1768730900000_abc123",
      "type": "heading",
      "payload": {
        "text": "核心功能",
        "level": 2
      },
      "children": [
        {
          "blockId": "b_1768731000000_def456",
          "type": "heading",
          "payload": {
            "text": "块级编辑",
            "level": 3
          },
          "children": [
            {
              "blockId": "b_1768731100000_ghi789",
              "type": "list",
              "payload": {
                "type": "unordered",
                "items": [
                  {
                    "text": "支持多种块类型",
                    "children": [
                      {
                        "text": "段落块"
                      },
                      {
                        "text": "标题块"
                      },
                      {
                        "text": "列表块"
                      }
                    ]
                  },
                  {
                    "text": "支持嵌套结构"
                  }
                ]
              },
              "children": []
            }
          ]
        },
        {
          "blockId": "b_1768731200000_jkl012",
          "type": "heading",
          "payload": {
            "text": "版本控制",
            "level": 3
          },
          "children": [
            {
              "blockId": "b_1768731300000_mno345",
              "type": "paragraph",
              "payload": {
                "text": "系统会自动记录每次修改，支持版本回滚。"
              },
              "children": []
            }
          ]
        }
      ]
    },
    {
      "blockId": "b_1768731400000_pqr678",
      "type": "heading",
      "payload": {
        "text": "技术栈",
        "level": 2
      },
      "children": [
        {
          "blockId": "b_1768731500000_stu901",
          "type": "list",
          "payload": {
            "type": "unordered",
            "items": [
              { "text": "NestJS：后端框架" },
              { "text": "PostgreSQL：数据库" },
              { "text": "VitePress：文档生成" }
            ]
          },
          "children": []
        }
      ]
    }
  ]
}
```

### 对应关系说明

| Markdown 元素 | JSON 块类型                | 说明                             |
| ------------- | -------------------------- | -------------------------------- |
| `# 标题`      | `heading` (level: 1)       | 一级标题                         |
| `## 标题`     | `heading` (level: 2)       | 二级标题                         |
| `### 标题`    | `heading` (level: 3)       | 三级标题                         |
| 普通段落      | `paragraph`                | 段落块                           |
| `- 列表项`    | `list` (type: "unordered") | 无序列表                         |
| 缩进列表项    | 嵌套在父块的 `children` 中 | 通过 `indent` 和 `parentId` 实现 |

### 关键观察

1. **层级关系**：Markdown 中的缩进对应 JSON 中的 `children` 嵌套
   - 一级标题下的内容 → 一级标题块的 `children`
   - 二级标题下的内容 → 二级标题块的 `children`

2. **块类型映射**：
   - Markdown 标题 → `heading` 块（`level` 字段表示层级）
   - Markdown 段落 → `paragraph` 块
   - Markdown 列表 → `list` 块（`type` 字段区分有序/无序）

3. **嵌套结构**：
   - Markdown 中的嵌套列表在 JSON 中通过 `children` 数组实现
   - 每个子块都是父块 `children` 数组中的一个元素

## 插入块时的行为

### 指定 parentId

当创建块时指定 `parentId`：

```json
{
  "docId": "doc_xxx",
  "type": "paragraph",
  "payload": { "text": "新内容" },
  "parentId": "b_1768730672350_f3bc0fc4" // 指定父块ID
}
```

**结果：** 新块会被插入到指定块的 `children` 数组中。

### 不指定 parentId

当创建块时不指定 `parentId` 或 `parentId` 为空：

```json
{
  "docId": "doc_xxx",
  "type": "paragraph",
  "payload": { "text": "新内容" }
  // 不指定 parentId
}
```

**结果：** 新块会被插入到**根块的 `children` 数组中**。

### 示例对比

**插入前：**

```json
{
  "type": "root",
  "children": [{ "blockId": "b_1", "type": "paragraph", "children": [] }]
}
```

**插入到根块（不指定 parentId）：**

```json
{
  "type": "root",
  "children": [
    { "blockId": "b_1", "type": "paragraph", "children": [] },
    { "blockId": "b_2", "type": "paragraph", "children": [] } // 新插入
  ]
}
```

**插入到 b_1（指定 parentId: "b_1"）：**

```json
{
  "type": "root",
  "children": [
    {
      "blockId": "b_1",
      "type": "paragraph",
      "children": [
        { "blockId": "b_2", "type": "paragraph", "children": [] } // 新插入
      ]
    }
  ]
}
```

## 数据库存储

### BlockVersion 表

在数据库中，块的父子关系存储在 `block_versions` 表的 `parent_id` 字段：

```sql
CREATE TABLE block_versions (
  block_id VARCHAR(50),
  parent_id VARCHAR(50),  -- 父块ID
  sort_key VARCHAR(50),  -- 排序键（分数排序系统）
  payload JSONB,          -- 块内容
  ...
);
```

### 排序键（sortKey）机制

**分数排序系统：**

- `sortKey` 使用数字字符串（如 `"500000"`, `"600000"`）
- 支持在任意位置插入新元素，无需重新排序所有块
- 默认值：`"500000"`（中间值）
- 插入到末尾：前一个 `sortKey + 100000`
- 插入到中间：计算前后两个 `sortKey` 的中间值

**排序规则：**

- 使用**数字比较**而非字符串比较
- 确保 `"10" > "2"`（而不是字符串比较的 `"10" < "2"`）

**更新块时的行为：**

- ✅ 更新块内容时，`sortKey` **保持不变**
- ✅ 只有移动块（`move`）操作才会改变 `sortKey`
- ✅ 如果更新后块位置发生变化，可能是排序比较方式的问题

### 构建树形结构

系统在返回文档内容时，会根据 `parent_id` 字段构建树形结构：

1. 查找所有块的版本记录
2. 根据 `parent_id` 分组
3. 按 `sort_key` **数字排序**（不是字符串排序）
4. 递归构建 `children` 数组

## 常见问题

### Q1: 为什么根块的 payload 有 children 字段？

**A:** 这是根块 payload 的内部结构标识，用于区分根块和普通块。实际的子块关系通过外层的 `children` 数组维护。

### Q2: 一个块可以有多个父块吗？

**A:** 不可以。每个块只能有一个父块，通过 `parent_id` 字段维护。这是树形结构的基本要求。

### Q3: payload.children 和 children 数组有什么区别？

**A:**

- `payload.children`：仅根块有，用于标识根块类型，不是实际的子块
- `children` 数组：所有块都有，存储实际的子块，形成树形结构

### Q4: 如何判断一个块是根块？

**A:**

- 检查 `type === "root"`
- 或者检查 `blockId === Document.rootBlockId`

### Q5: 如何获取一个块的所有子块？

**A:** 直接访问 `children` 数组即可。如果需要递归获取所有后代块，需要递归遍历 `children` 数组。

## 总结

1. **文档结构**：文档 → 根块 → 内容块（树形结构）
2. **根块特殊性**：每个文档有且仅有一个根块，类型为 `"root"`
3. **块结构**：`blockId` + `type` + `payload` + `children`
4. **父子关系**：通过 `parentId` 和 `children` 数组维护
5. **插入位置**：指定 `parentId` 插入到指定块，否则插入到根块
6. **payload vs children**：`payload` 存储内容，`children` 存储子块关系
