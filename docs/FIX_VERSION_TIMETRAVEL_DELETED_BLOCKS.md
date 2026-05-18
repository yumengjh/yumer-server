# 修复：历史版本重建受全局 isDeleted 标志影响导致发布内容丢失

## 问题描述

当文档发布后继续编辑（删除旧块、写入新内容），已发布版本的内容会变成空白。

**复现步骤：**

1. 编辑文档内容，版本推进到 v10
2. 点击发布 → `publishedHead = 10`
3. 继续编辑：删除全部旧块，写入新内容 → 版本推进到 v11+
4. 访问发布版本（v10）→ 内容为空

**预期行为：** 发布版本 v10 应保留发布时的完整内容，不受后续编辑影响。

## 根因分析

系统采用 append-only 时间旅行模型重建历史版本：通过 `DocRevision.createdAt` 时间戳查询对应时刻的 `BlockVersion` 快照。

但所有历史版本查询都使用了 `Block.isDeleted = false`（全局标志）过滤：

```sql
-- 修复前（错误）
INNER JOIN blocks b ON bv.blockId = b.blockId AND b.isDeleted = false
```

`Block.isDeleted` 是当前状态，不区分版本。一旦块在当前被标记为删除，**所有历史版本查询都会排除该块**，包括已发布的版本。

### 涉及的查询位置

| 方法 | 行号（修复前） | 作用 |
|------|---------------|------|
| `getBlockVersionMapForVersion()` | ~1153 | 构建版本的块映射 |
| `buildContentTreeFromVersionMap()` | ~1653 | 过滤有效块 |
| `buildContentTreeFromStartBlock()` | ~1247, ~1308 | 分页查询起始块及兄弟块 |
| `getChildrenBlocks()` | ~1507 | 递归查询子块 |
| `getBlockVersionAtTime()` | ~1476 | 查询单个块的时间点版本 |

## 修复方案

将全局 `isDeleted` 过滤改为基于 `deletedAt` 时间戳的时间感知过滤：

```sql
-- 修复后（正确）
INNER JOIN blocks b ON bv.blockId = b.blockId
  AND (b."deletedAt" IS NULL OR b."deletedAt" > :revisionCreatedAt)
```

**语义变化：**
- 修复前：排除所有当前已删除的块
- 修复后：只排除在目标版本创建时间点**之前**就已删除的块

### 具体修改（`documents.service.ts`）

1. **`getBlockVersionMapForVersion()`**：join 条件改为时间感知；返回值从 `Record<string, number>` 改为 `{ map, createdAt }`；根块 fallback 的 `isDeleted` 检查加入 `deletedAt` 时间判断
2. **`buildContentTreeFromVersionMap()`**：新增 `revisionCreatedAt` 参数；移除 `isDeleted: false` 过滤，改用 `deletedAt` 时间判断
3. **`buildContentTreeFromStartBlock()`**：两处 join 条件改为时间感知
4. **`getChildrenBlocks()`**：join 条件改为时间感知
5. **`getBlockVersionAtTime()`**：join 条件改为时间感知
6. **`getDiff()`**：传递 `createdAt` 给 `buildContentTreeFromVersionMap`
7. **新增导入**：`Or`, `MoreThan`, `IsNull`（TypeORM）

### 边界情况

| 场景 | 行为 |
|------|------|
| 块在 v10 存在，v11 删除，查询 v10 | 块显示（`deletedAt > v10.createdAt`） |
| 块在 v2 删除，查询 v5 | 块不显示（`deletedAt <= v5.createdAt`） |
| 块从未删除 | 块显示（`deletedAt IS NULL`） |
| 块在目标版本之后才创建 | 不显示（`bv.createdAt > revision.createdAt`） |

## 测试验证

- TypeScript 编译：通过
- 现有测试套件（15 项）：全部通过
- 手动测试：删除块后，发布版本 v65 仍正确显示 38 个子块；最新版本正确反映删除状态

## 修改文件

- `src/modules/documents/documents.service.ts`
