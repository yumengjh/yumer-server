# Block Version GC 修复：区分 live root 与 deleted tombstone root

## 问题背景

当前块系统采用“删除块 = 追加一个 `deleted:true` 的块版本”这一设计。

这意味着 `doc_snapshots.blockVersionMap` 和 `document_drafts.blockVersionMap` 里，可能仍然引用某个块的删除版本，例如：

```json
{
  "b_1779866674652_41c74936": 4
}
```

如果 `b_...@4` 的 `payload.attrs.deleted === true`，它在内容层面表示“这个块已经被删除”，但在版本映射层面，它仍然是一个有效引用。

问题在于，GC v1 最初实现里把 `blockVersionMap` 中的所有引用都粗暴地当成 `hard root`，没有区分：

1. 指向可见内容的 live root
2. 指向删除 tombstone 的 root

这会带来两个问题：

1. 删除 tombstone 会被错误地视为普通存活版本
2. `keepLatestPerBlock` 会继续保护这类 tombstone，使它长期看起来像“正常 live 数据”

这不是普通 orphan 判断错误，而是 root 语义过粗。

## 修复目标

这次修复不改变“删除块就是创建删除版本”的建模方式，只修正 GC 对 root 的理解：

- `map + deleted !== true`：属于 live root
- `map + deleted === true`：属于 tombstone root
- `不在 map 中`：才可能是普通不可达候选

同时增加一类新的 preview 候选：

- `compact_map_entry`

它的含义不是“删除 block_version”，而是“这个 map 上保留的 tombstone 引用已经足够旧，后续可以考虑把这条 map entry 压缩掉”。

## 修复内容

### 1. root 分类从单一 hard root 改为双轨

在扫描以下来源时：

- `doc_snapshots.blockVersionMap`
- `document_drafts.blockVersionMap`

GC 现在会先读取对应的 `block_versions`，再按 `payload.attrs.deleted` 分类：

- `liveRoots`
- `tombstoneRoots`

两者都会计入 root，但语义不同。

### 2. tombstone root 不再进入普通 block version candidate

如果某个块版本仍然被 map 引用，且该版本是 `deleted:true`：

- 不会进入普通 `unreferenced_older_than_policy` 候选
- 不会被误判成可直接回收的普通块版本

### 3. 增加 tombstone compaction preview

策略新增：

- `tombstoneGracePeriodMs`

当某个 tombstone root 超过这个时间窗口后，会生成新的 preview 候选：

- `reasonCode = deleted_tombstone_map_entry`
- `reasonDetail.action = compact_map_entry`

注意：

- 这只是 preview 信号
- 当前版本不会真的改写 `blockVersionMap`
- 也不会删除对应 `block_version`

### 4. summary 增加更细的统计字段

新增：

- `liveRootedBlockVersions`
- `tombstoneRootedBlockVersions`
- `softDeletedMapEntries`
- `tombstoneCompactionCandidates`

这样调试面板可以区分：

- 当前被正常内容引用的版本数
- 当前仅作为删除 tombstone 挂在 map 上的版本数
- 可进一步做 map compaction 的 tombstone 数量

### 5. reasonDetail 增加 root/tombstone 语义

candidate 的 `reasonDetail` 现在会附带这些字段：

- `rootKind: live | tombstone | none`
- `deleted: boolean`
- `source: doc_snapshots | document_drafts | null`
- `action: keep | compact_map_entry | candidate_block_version`

其中当前 preview 实际会出现的 action 主要是：

- `compact_map_entry`
- `candidate_block_version`

`keep` 只是语义预留，便于后续扩展。

## 当前策略位置

硬编码策略位于：

- `src/modules/gc/gc-policy.service.ts`

当前可直接调的关键字段：

- `gracePeriodMs`
- `tombstoneGracePeriodMs`
- `keepLatestPerBlock`
- `maxCandidatesToStore`

这次修复后，`tombstoneGracePeriodMs` 专门控制 tombstone root 何时出现在 compaction preview 中，不再和普通不可达版本共用一套语义。

## 当前版本的重要边界

本次仍然是 GC v1 preview-only：

- 不会删 `block_versions`
- 不会改 `doc_snapshots.blockVersionMap`
- 不会改 `document_drafts.blockVersionMap`

所以现在看到 `compact_map_entry` 候选，只表示：

> 这条删除 tombstone 的 map 引用已经足够旧，后续如果要做 map compaction，可以从这里开始。

真正实现 `compact_map_entry` 时，必须先验证以下不变量：

1. 移除该 `blockId` 前后，`GET /content` 结果不变
2. 移除该 `blockId` 前后，`GET /edit-content` 结果不变
3. 不能先删 `block_versions`，否则会制造 `missingRootBlockVersions`

## 测试覆盖

这次新增/更新的测试重点覆盖了以下场景：

1. `blockVersionMap` 引用正常版本时，进入 `liveRoots`，不进 candidate
2. `blockVersionMap` 引用 `deleted:true` 版本时，进入 `tombstoneRoots`
3. tombstone root 未超过 `tombstoneGracePeriodMs` 时，不进入 compaction candidate
4. tombstone root 超过 `tombstoneGracePeriodMs` 后，进入 `deleted_tombstone_map_entry`
5. tombstone compaction candidate 的 `action` 必须是 `compact_map_entry`，而不是删除块版本

相关文件：

- `src/modules/gc/block-version-gc.collector.spec.ts`
- `src/modules/gc/gc-policy.service.spec.ts`
- `src/modules/gc/gc-run.service.spec.ts`

## 影响范围

本次修改只收敛在 GC 模块内：

- `src/modules/gc/block-version-gc.collector.ts`
- `src/modules/gc/gc.types.ts`
- `src/modules/gc/gc-policy.service.ts`
- `src/modules/gc/gc-run.service.ts`

不涉及：

- blocks 删除写入逻辑
- documents 内容读取逻辑
- draft / snapshot 生成链路

所以它修的是“GC 如何理解 root”，不是“块如何删除”。
