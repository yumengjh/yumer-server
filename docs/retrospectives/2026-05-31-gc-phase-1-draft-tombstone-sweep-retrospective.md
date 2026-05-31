# 2026-05-31 GC Phase 1 draft tombstone sweep 复盘

## 背景

Phase 0 完成后，GC 已经具备两层基础能力：

1. preview run 能识别 tombstone compaction candidate
2. `gc_candidate_pool` 能把 candidate 从单次 run 快照提升为跨 run 状态对象

系统已经能回答：

- 哪些候选连续出现过
- 哪些候选已经进入 `eligible`

但还不能真正执行任何清理。继续停在这里，GC 仍然只是“能看到风险，但不能落地动作”的系统。Phase 1 的目标就是打通第一条真实 sweep 路径。

## 本次目标

这次不是一步做完整 GC，而是故意收敛到最小真实路径：

> 只对 `document_drafts` 上的 `compact_map_entry` 候选做真实执行

明确不做：

- `doc_snapshots` compaction
- `block_versions` physical delete
- 跨 source 混合 sweep
- SQLite / Postgres 存储层空间回收

这次追求的是把真实 sweep 的控制面、校验面、执行面跑通，而不是一次覆盖所有清理面。

## 本次交付

### 1. 新增独立的 sweep service

新增：

- `src/modules/gc/gc-sweep.service.ts`
- `src/modules/gc/gc-sweep.service.spec.ts`

职责边界：

- `GcRunService` 继续负责 preview run
- `GcSweepService` 专门负责真实 sweep

这个拆分是必要的。preview 的目标是观察和解释，sweep 的目标是执行和防误删，两者共享候选池，但不应该继续堆在一个 service 里。

### 2. 新增真实 sweep 入口

新增 DTO：

- `src/modules/gc/dto/create-block-version-gc-sweep.dto.ts`

新增接口：

- `POST /admin/gc/block-versions/sweeps/draft-tombstones`

接口支持：

- `workspaceId`
- `docId`
- `limit`
- `dryRun`

这一步把管理面入口也打通了，不只是停在内部函数。

### 3. 引入真实的 sweep run

`GcRun.mode` 从单一 `preview` 扩展成：

- `preview`
- `sweep`

这样真实 sweep 不需要另起一套审计模型，可以直接复用已有 run 记录结构。

本次 sweep run 会记录：

- 作用 scope
- action / source
- dry-run 标记
- 执行 summary
- 失败信息

真实 sweep 从第一天开始就是可审计的。

### 4. 执行前 fresh revalidation

这是 Phase 1 最关键的边界。

候选即使已经在 `gc_candidate_pool` 里进入 `eligible`，执行前仍然必须重新校验。当前对 `document_drafts` 的校验包括：

1. draft 还存在
2. draft 仍然属于目标 workspace
3. 当前 `blockVersionMap` 里仍然有这个 block
4. 当前 map 指向的仍然是同一个 `blockVer`
5. 对应 `block_versions` 记录仍然存在
6. 对应 version 仍然满足 `payload.attrs.deleted === true`

只要任一步失败，就不执行 compaction，而是把 pool candidate 标成 `blocked`。

这里开始，GC 不再只是读数据，而是在真正写业务表之前加了最后一层防线。

### 5. 真实改写 `document_drafts.blockVersionMap`

当 candidate 通过 fresh check 后，执行逻辑会：

1. 从 draft map 删除对应 `blockId`
2. 重新计算 `changedBlocksCount`
3. 更新 `updatedAt`
4. 更新 `updatedBy`
5. 把 pool entry 标成 `swept`

这里不能只做 `delete map[key] + save`。`changedBlocksCount` 是真实业务字段，GC 路径里也必须保持一致。

### 6. 支持 dry-run sweep

接口支持 `dryRun: true`。

这里的 dry-run 不是重新做 preview，而是：

- 走和真实 sweep 一样的候选选取
- 跑同样的 fresh revalidation
- 只更新 validation 信息，不改 draft map

这样 dry-run 和真实执行之间的差异被压到最小，后续排查 sweep 行为也更直接。

## 为什么只先开 `document_drafts`

### 1. draft 的语义比 snapshot 更适合先落地

`document_drafts` 本质上是工作副本，职责是服务当前编辑态，不是正式历史归档对象。

删除一个已经稳定存在的 tombstone map entry，语义上更接近“清掉已删除块的工作副本残留索引”，风险明显低于直接改历史 snapshot。

### 2. draft 的 revalidation 更简单

draft 只需要关心：

- 当前工作副本还在不在
- 当前 map 指向有没有漂移

而 snapshot 后续还会多出：

- `kind`
- `pinned`
- 发布视图一致性
- 历史版本可回放语义

所以先开 draft，不是偷懒，而是先把真实 sweep 的最短路径打通。

### 3. draft compaction 出错更容易止损

如果 draft compaction 判断错误，主要影响编辑态副本；如果 snapshot compaction 判断错误，影响的是正式版本视图和历史读取。两者不是一个风险级别。

## 本次没有做什么

### 1. 还没做 `doc_snapshots` tombstone compaction

虽然 `GcSweepService` 已经注入了 `DocSnapshot` repository，但这次没有执行 snapshot compaction。

下一阶段要先补齐边界：

- 只允许 `kind = revision`
- 只允许 `pinned = false`
- 仍然要求 fresh revalidation

### 2. 还没做 `block_versions` 物理删除

这次仍然没有删任何 `block_versions` 行。

这是刻意保留的安全边界，因为 physical delete 一旦打开，会影响：

- diff
- revert
- 历史内容读取
- preview 结果解释

### 3. 还没做 retry / batch orchestration

当前 sweep 是单批次执行，还没有做：

- 分批自动续跑
- blocked candidate 自动恢复
- sweep 失败后的 retry policy

这些要等 source 覆盖面扩大后再做，否则调度层优化太早。

## 关键取舍

### 1. 为什么先保留独立 endpoint

这次没有先做通用接口：

- `POST /admin/gc/block-versions/sweeps`

而是先做收敛接口：

- `POST /admin/gc/block-versions/sweeps/draft-tombstones`

好处是：

- route 本身就带边界
- 调试时不需要担心 action / source 混跑
- 接口层语义比在 body 里塞很多 mode 更清楚

等 snapshot sweep 也成熟后，再看是否抽成统一入口。

### 2. 为什么 revalidation 失败直接写回 pool

这次不是只把失败记在 run summary 里，而是直接把 pool state 写成 `blocked`。

这样可以避免同一个已经明显失效的 candidate 被反复当作可执行项拿出来，也让 `gc_candidate_pool` 从“观察池”进一步变成“执行池”。

### 3. 为什么 sweep 后先标 `swept`

`swept` 和“从池子里消失”不是一回事。

保留 `swept` 有两个价值：

1. 后续 preview 如果再次看到同一个 candidate，可以识别为 `resurrected`
2. 执行审计更完整

所以这次保留了 sweep 轨迹，而不是扫完就直接删 pool entry。

## 遇到的问题

### 1. `GcModule` 的 wiring test 不该被 `DataSource` 拖重

引入 `GcSweepService` 后，模块测试需要处理 `DataSource` 注入。

一开始试图在模块测试里补齐完整 provider，但这会把轻量 wiring test 做得过重。最后改成：

- 模块测试里直接 override `GcSweepService`
- 真实行为交给 `gc-sweep.service.spec.ts` 单独覆盖

这个分层更合理。

### 2. 新 spec 不能再增加全量 typecheck 噪音

本次新增 `gc-sweep.service.spec.ts` 时，最初也带进了两条类型问题：

- `DocDraft` mock 类型转换不够干净
- `manager` 类型标注不合适

这两条已经在本次修掉。仓库全量 `tsc --noEmit` 本来就有既存错误，新改动不应该继续叠加。

## 验证结果

本次验证了这些内容：

- eligible draft tombstone candidate 能被真实 compact
- compaction 会改写 `document_drafts.blockVersionMap`
- `changedBlocksCount` 会被重算
- fresh revalidation 失败时会标记 `blocked`
- dry-run 路径不改业务数据
- controller / module wiring 正常

执行命令：

```bash
pnpm test -- src/modules/gc/gc-sweep.service.spec.ts src/modules/gc/gc.controller.spec.ts src/modules/gc/gc.module.spec.ts src/modules/gc/gc-run.service.spec.ts src/modules/gc/gc-policy.service.spec.ts src/modules/gc/block-version-gc.collector.spec.ts
pnpm exec eslint src/modules/gc/**/*.ts src/entities/gc-run.entity.ts
pnpm exec tsc --noEmit
```

结果：

- GC 相关测试通过
- GC 相关 lint 通过
- 全量 typecheck 仍然被仓库既存的 blocks / documents spec 错误挡住
- 本次新增 GC spec 没再引入新的 typecheck 问题

## 下一步

最自然的下一步是：

> 把同样的真实 sweep 路径扩到 `doc_snapshots(kind=revision, pinned=false)`

要求保持一致：

1. 只处理 `kind = revision`
2. 只处理 `pinned = false`
3. 继续要求 fresh revalidation
4. 继续保留 dry-run

做完这一层后，GC 的 tombstone compaction 才算从“编辑态清理”扩展到“正式历史态清理”。

## 结论

这次不是把 GC 一步做成完整清扫器，而是谨慎地把第一条真实执行路径落地了。

它的重要性不在于“扫掉了多少数据”，而在于第一次把这些事情闭环起来：

- pool 中选候选
- 执行前重新校验
- 真实改写源表
- 执行后回写候选状态
- 形成独立的 sweep run 审计

从这里开始，GC 才真正跨过 preview-only 的边界。下一步扩到 snapshot，会比从零做 sweep 简单得多。
