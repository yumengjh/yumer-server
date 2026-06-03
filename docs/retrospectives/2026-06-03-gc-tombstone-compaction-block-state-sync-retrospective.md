# 2026-06-03 GC tombstone 压实后块删除状态同步复盘

对应提交：`a50bcc914cc90dde93dcb61973e98b7aa73f6f93`

## 背景

在这次问题暴露前，block version GC 已经具备两段能力：

1. 识别 draft / revision snapshot 里的 tombstone root
2. 对 tombstone root 做 `compact_map_entry` sweep，把 `blockVersionMap` 中的墓碑引用移除

但线上调试时出现了一个反直觉现象：

- 某些 tombstone 版本已经不再出现在 `document_drafts.blockVersionMap`
- 再次执行 GC preview 时，这些版本仍然扫不出来
- `summary.policyRetentionBreakdown.activeLatestVersion` 很高

这说明问题不在 preview 候选判断，而在 preview 之前的业务状态同步链路。

## 现象

本次定位到的具体症状是：

1. `liveRootedBlockVersions` 已经下降，说明 root map 引用确实被压掉了
2. `policyRetentionBreakdown.withinGracePeriod = 0`
3. `policyRetentionBreakdown.keepLatestPerBlock = 0`
4. `policyRetentionBreakdown.activeLatestVersion` 仍然命中

进一步查库后可以确认：

- 对应 `block_versions` 行已经不再被 draft / snapshot root 引用
- 但 `blocks.latestVer` 仍指向这些 tombstone 版本
- `blocks.isDeleted` 仍然是 `false`

于是 GC 仍把这些版本当成“活跃块当前最新版本”保留。

## 根因

系统当前并不是“纯引用可达性 GC”，而是三层混合判定：

1. `doc_snapshots` / `document_drafts` 的 root 可达性
2. `gracePeriodMs` / `keepLatestPerBlock` 这类时间与版本策略
3. `blocks.isDeleted = false` 对应的 `blocks.latestVer` 强保留

问题出在第三层和前两层没有同步收口。

原实现里：

- tombstone compaction 只会改 root map
- 不会在 compaction 完成后检查这个 tombstone 是否已经彻底失去所有 root 引用
- 也不会在这种情况下把 `blocks.isDeleted` 同步成 `true`

这导致出现一种中间态：

> map 中已经没有这个块，但 `blocks` 表仍把它当作正文活块。

在这种中间态下，GC 会继续保护 `blocks.latestVer`，于是 preview 永远扫不到这些版本。

## 修复思路

本次修复没有把逻辑改成“draft 删除即立刻标记 `blocks.isDeleted = true`”，因为那会破坏草稿态可恢复的编辑语义。

采用的是更窄的收口点：

> 只有在 tombstone compaction 执行完成后，如果该 tombstone 已经没有任何 draft / snapshot root 引用，并且它仍然是该 block 的 `latestVer`，才把 `blocks.isDeleted` 同步成 `true`。

这个位置有几个好处：

1. 不影响 draft 编辑中的“先删后改回”
2. 只在 operator 已经执行了 tombstone 压实后才生效
3. 和 GC 的语义边界一致
4. 能直接消除 `activeLatestVersion` 误保留

## 本次改动

本次主要修改在：

- `src/modules/gc/modules/block-version/gc-sweep.service.ts`
- `src/modules/gc/modules/block-version/gc-sweep.service.spec.ts`

具体做了两件事：

### 1. draft tombstone compaction 后同步块删除状态

在 draft tombstone sweep 成功改写 `document_drafts.blockVersionMap` 后：

- 查询对应 `Block`
- 查询对应 `BlockVersion`
- 再次检查该 tombstone 是否仍被任何 draft / snapshot root 引用
- 若已经彻底失去 root 且仍是 `latestVer`，则把：
  - `blocks.isDeleted = true`
  - `deletedAt`
  - `deletedBy`
  一并更新

### 2. revision tombstone compaction 共享同一套收口逻辑

revision snapshot compaction 也接入了同一套状态同步逻辑。

但这里保留了一个重要 gate：

- 如果同一个 tombstone 仍然被 draft root 引用
- 即使某个 revision snapshot 已经把它压掉
- 也不能提前把 `blocks.isDeleted` 设为 `true`

## 验证

本次补了两类回归：

1. draft tombstone 压实后若已无剩余 root，会同步把 block 标记删除
2. revision tombstone 压实时若还有其他 root（例如 draft root），不会误标删除

验证命令：

```bash
pnpm.cmd test -- src/modules/gc/modules/block-version/gc-policy.service.spec.ts
pnpm.cmd test -- src/modules/gc/modules/block-version/block-version-gc.collector.spec.ts
pnpm.cmd test -- src/modules/gc/modules/block-version/gc-run.service.spec.ts
pnpm.cmd test -- src/modules/gc/modules/block-version/gc-sweep.service.spec.ts
```

## 经验总结

这次问题的关键教训不是“GC 判错了”，而是：

> 当一个系统同时依赖“root map 可达性”和“块主表状态”两套真值时，任何一处 sweep / compaction 只改一侧，都会制造长期中间态。

GC 最后表现出来的是“明明没引用却扫不到”，但本质上是业务状态机没有完成闭环。

后续凡是涉及：

- root map 压缩
- draft / snapshot 回写
- block 最新版本切换

都要警惕这种“双真值不同步”的问题。

## 后续建议

1. 把 `activeLatestVersion` 的调试信息长期保留在 summary 中，方便第一时间定位类似问题。
2. 对 `blocks.isDeleted = false` 但不在任何 root map 中的 block 增加健康检查或诊断脚本。
3. 后续如果继续推进纯可达性 GC，需要先明确是否还保留 `blocks.latestVer` 作为强保护语义。
