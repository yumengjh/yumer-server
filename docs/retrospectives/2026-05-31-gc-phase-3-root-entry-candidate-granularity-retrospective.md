# 2026-05-31 GC Phase 3 root-entry candidate granularity 复盘

## 背景

Phase 2 把真实 sweep 扩到了 revision snapshot，但那一步故意用了保守 gate：

- 只有当相关引用全都落在 `kind=revision && pinned=false`
- 且没有 draft / pinned / 其他 snapshot 混合引用

才允许执行。

这套 gate 当时是合理的，因为旧的 candidate 粒度只有“块版本级”：

- 一个 tombstone version 只会生成一个 `compact_map_entry` candidate
- pool candidate key 只看 `resourceKey + action`
- 同一个 tombstone 被多个 root entry 引用时，会在 pool 中被合并

结果就是 mixed-root 场景下只能整体阻断，不能精确 sweep。

## 这次要解决的核心问题

真正的问题不是 sweep service 不够复杂，而是 candidate 模型太粗。

对 `compact_map_entry` 来说，真正要执行的对象不是：

> 某个 tombstone block version

而是：

> 某个 root entry 对这个 tombstone version 的引用

例如：

- `snapshot:doc_1@snap@4 -> b_1@4`
- `draft:draft_1 -> b_1@4`

这两个引用应该是两个独立 candidate，而不是一个。

## 本次改动

### 1. tombstone compaction candidate 改成 root-entry 级

`BlockVersionGcCollector` 现在对 `compact_map_entry` 不再按块版本只出一条候选，而是：

- 每个 tombstone snapshot root entry 出一条
- 每个 tombstone draft root entry 出一条

也就是说，同一个 `b_1@4` 同时被一个 snapshot 和一个 draft 引用时，会产生两条 candidate。

### 2. root ref 身份进入 `reasonDetail`

这次没有再加新表，也没有先改 schema，而是先把 root ref 身份放进 `reasonDetail`：

- `rootRefType`
- `rootRefId`
- `rootRefKey`

这样当前 run candidate、candidate pool、API 返回结构都能直接带出 root entry 身份，而不需要先跑一轮数据库迁移。

### 3. pool candidate key 不再把多个 root entry 合并

之前 `buildCandidateKey` 只按：

- `resourceKey`
- `action`

构 key。

现在对 `compact_map_entry` 会额外把 `rootRefKey` 纳入 key 计算，并做短 hash，保证：

- 同一个块版本的不同 root entry 不会冲突
- key 长度仍然稳定，不需要先扩表

这一步是整个 Phase 3 真正的关键。没有它，collector 就算产出两条 candidate，也会在 pool 层重新被合并掉。

### 4. sweep 校验改成按 root entry 精确定位

有了 root-entry 粒度后，sweep 不再需要按文档全局扫描相关引用。

#### draft sweep

现在会按 `reasonDetail.rootRefId = draftId` 精确找到目标 draft，然后只校验：

1. 目标 draft 还存在
2. workspace 仍然匹配
3. draft map 里该 `blockId -> blockVer` 仍然存在
4. 对应 version 仍然是 tombstone

#### revision sweep

现在会按 `reasonDetail.rootRefId = snapshotId` 精确找到目标 snapshot，然后只校验：

1. 目标 snapshot 还存在
2. snapshot 对应 document / workspace 仍然匹配
3. snapshot map 里该 `blockId -> blockVer` 仍然存在
4. `kind = revision`
5. `pinned = false`
6. 对应 version 仍然是 tombstone

这里最大的变化是：

> 一个 revision snapshot candidate，不再因为“同一个 tombstone 还被 draft 或 pinned snapshot 引用”而整体 blocked

因为那些引用现在会有自己的 candidate 和自己的 gate。

## 这次没有做什么

### 1. 还没有把 root ref 身份提升成显式列

这次先把 `rootRefType/rootRefId/rootRefKey` 放在 `reasonDetail` 里，主要是为了先把执行语义拉直。

后续如果要做更强的查询能力，例如：

- 按 snapshotId 查 pool
- 按 draftId 查 pool
- 对 root ref 维度做索引或批量恢复

那时再考虑把 root ref 升成显式列更合适。

### 2. 还没有处理已有旧 pool entry 的升级清理

旧的合并型 `compact_map_entry` pool candidate 仍然可能留在历史环境里。

当前实现只保证：

- 新 preview run 会写出新的 root-entry key
- 新 sweep 会消费新的 root-entry candidate

是否需要一次性清洗旧 pool 数据，要等后续运维策略一起定。

## 结果

Phase 3 之后，GC 在 tombstone compaction 这条线上，粒度终于和真实执行对象对齐了：

- preview：看到的是具体 root entry
- pool：晋升的是具体 root entry
- sweep：消费的是具体 root entry
- blocked / swept / resurrected：解释的也是具体 root entry

这让后续 mixed-root 场景不再需要靠“整组阻断”保守兜底。

## 验证结果

执行命令：

```bash
pnpm test -- src/modules/gc/block-version-gc.collector.spec.ts src/modules/gc/gc-run.service.spec.ts src/modules/gc/gc-sweep.service.spec.ts src/modules/gc/gc.controller.spec.ts src/modules/gc/gc.module.spec.ts src/modules/gc/gc-policy.service.spec.ts
pnpm exec eslint src/modules/gc/**/*.ts src/entities/gc-run.entity.ts
pnpm exec tsc --noEmit
```

结果：

- GC 相关测试通过，21/21
- GC 相关 lint 通过
- 全量 typecheck 仍然被仓库既存的 blocks / documents spec 错误挡住
- 本次没有新增新的 GC typecheck 问题

## 下一步

现在更顺手的下一步有两个方向：

1. 把 root ref 身份从 `reasonDetail` 提升成显式列
2. 开始设计 `candidate_block_version` 的真实 physical delete gate

优先级上，我倾向于先做第 2 条。

原因是 tombstone compaction 这条执行链已经够用了，而真正还没进入真实删除阶段的，只剩 `candidate_block_version`。

## 结论

这次改动看起来像是在“细化 candidate key”，但本质上是在修正 GC 的执行单位。

Phase 0 到 Phase 2 做的是：

- 让 GC 能看见
- 让 GC 能晋升
- 让 GC 能真实清理

Phase 3 做的是：

- 让 GC 清理的是正确的对象

这一步补上之后，后面的 delete gate 才有稳定的状态机基础。
