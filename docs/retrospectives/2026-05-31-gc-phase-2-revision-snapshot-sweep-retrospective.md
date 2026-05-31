# 2026-05-31 GC Phase 2 revision snapshot sweep 复盘

## 背景

Phase 1 已经把真实 sweep 路径打通到了 `document_drafts`，但 `doc_snapshots` 仍然停留在 preview-only。

这会留下一个明显缺口：

- preview 已经能持续产出 `source = doc_snapshots` 的 tombstone compaction candidate
- 真实 sweep 却还不能处理正式 revision snapshot 上的 map 残留

因此 Phase 2 的目标不是继续扩展删除范围，而是把同一类 `compact_map_entry` 动作补到正式历史态，但仍然保持最保守边界。

## 本次目标

本次只新增一条真实执行路径：

> `doc_snapshots(kind=revision, pinned=false)` tombstone map compaction

继续明确不做：

- `block_versions` physical delete
- pinned snapshot compaction
- 非 revision snapshot compaction
- draft / snapshot 混合根场景下的部分执行

这次的重点不是追求更大覆盖面，而是把 snapshot sweep 的可执行边界收窄到足够清晰。

## 为什么这一步不能直接照搬 draft sweep

`document_drafts` 每个文档只有一份工作副本，candidate 和源对象几乎是一一对应的。

`doc_snapshots` 不一样：

- 一个文档会有多条 snapshot
- 同一个 tombstone version 可能同时出现在多条 revision snapshot 中
- 还可能和 pinned / manual snapshot 混在一起
- 甚至可能和 draft 同时引用同一个 tombstone version

这意味着当前 `gc_candidate_pool` 的粒度还不够表达“哪一条 snapshot map entry 要被删”。如果贸然按单 candidate 执行，很容易把“部分可清理”误判成“整体可清理”。

## 本次取舍

### 1. 采用保守的整组校验

本次没有先改 candidate 粒度，而是加了一层更严格的 fresh revalidation：

1. 文档仍然存在
2. workspace 仍然匹配
3. 当前仍有 snapshot 引用这个 `blockId -> blockVer`
4. 所有匹配到的 snapshot 都必须是 `kind = revision`
5. 所有匹配到的 snapshot 都必须是 `pinned = false`
6. 当前不能再有 draft 引用同一个 tombstone version
7. 对应 `block_version` 仍然存在且 `deleted = true`

只要任一条件不满足，这个 candidate 就直接 `blocked`。

这意味着 Phase 2 只接受“当前所有相关 snapshot 引用都可被同一策略处理”的场景，不接受部分执行。

### 2. 故意阻断 mixed-root 场景

如果同一个 tombstone version 还同时被 draft 引用，或者还被 pinned snapshot 引用，本次直接不执行。

原因很简单：当前 pool candidate 还是“按块版本”聚合的，而不是“按具体 map entry”聚合。继续做局部 compaction 会带来两个问题：

- `swept` 状态和真实剩余引用不一致
- 后续 preview 会把同一个 candidate 再次抬起来，语义会变得含混

所以这次宁可少做，也不接受状态解释变脏。

### 3. 一次 compact 所有匹配的 revision snapshot

当 candidate 通过校验后，本次会在一个事务里：

1. 找出当前所有匹配 `blockId -> blockVer` 的 revision snapshot
2. 从每条 snapshot 的 `blockVersionMap` 删除该 `blockId`
3. 保存更新后的 snapshot
4. 把 pool candidate 标成 `swept`

这里没有做“只删一条 snapshot”，因为在当前保守前提下，这组 revision snapshot 本来就被视为同一批可执行对象。

## 本次交付

### 1. 新增 revision tombstone sweep 入口

新增接口：

- `POST /admin/gc/block-versions/sweeps/revision-tombstones`

接口参数继续复用现有 sweep DTO：

- `workspaceId`
- `docId`
- `limit`
- `dryRun`

### 2. `GcSweepService` 新增 snapshot sweep 路径

新增能力：

- `sweepRevisionTombstones`
- snapshot 专用 fresh revalidation
- snapshot 批量 compaction 执行

同时补充了 `Document` repository 注入，用于 fresh 校验 workspace 归属。

### 3. 补充了控制器和模块测试

这次新增测试覆盖：

- revision snapshot 成功 compact
- pinned snapshot 引用存在时直接 blocked
- controller 新接口的 operator 透传

## 为什么这次还不碰 candidate 粒度

真正彻底的做法，是把 tombstone compaction candidate 从“块版本级别”下钻到“具体 root entry 级别”，例如：

- `draft:docId:blockId`
- `snapshot:snapshotId:blockId`

这样 future sweep 才能天然支持：

- 部分 snapshot 可清理
- pinned / manual / draft 混合引用
- 更精确的 `swept` / `blocked` / `resurrected`

但这已经不再是 Phase 2 的范围。现在先用严格 gate 把真实 snapshot sweep 路径跑通，再决定是否值得升级 candidate 模型。

## 验证结果

执行命令：

```bash
pnpm test -- src/modules/gc/gc-sweep.service.spec.ts src/modules/gc/gc.controller.spec.ts src/modules/gc/gc.module.spec.ts src/modules/gc/gc-run.service.spec.ts src/modules/gc/gc-policy.service.spec.ts src/modules/gc/block-version-gc.collector.spec.ts
pnpm exec eslint src/modules/gc/**/*.ts src/entities/gc-run.entity.ts
pnpm exec tsc --noEmit
```

结果：

- GC 相关测试通过，20/20
- GC 相关 lint 通过
- 全量 typecheck 仍然被仓库既存的 blocks / documents spec 错误挡住
- 本次 snapshot sweep 没再引入新的 GC 类型错误

## 下一步

下一步有两条路，但优先级不同：

1. 先补 candidate 粒度，从“块版本级”提升到“root entry 级”
2. 再考虑 `block_versions` physical delete gate

当前更合理的是先做第 1 条。否则后面的 sweep 状态机会一直被 mixed-root 场景拖住。

## 结论

这次不是简单把 draft sweep 复制到 snapshot，而是明确承认了 snapshot 引用图更复杂，然后用保守 gate 换来可解释的真实执行。

它的价值在于两点：

- 正式历史态第一次具备了真实 tombstone compaction 能力
- 同时也把当前 candidate 粒度的边界暴露清楚了

这让后续要不要升级到 root-entry 级候选，不再是抽象讨论，而是已经有真实执行压力支撑的工程决策。
