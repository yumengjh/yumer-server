# 2026-05-31 GC Phase 0 候选池落地复盘

## 背景

在这次改动之前，GC 模块已经能做三件事：

1. 跑 block version preview
2. 把某次 preview 的 run 摘要写进 `gc_runs`
3. 把某次 preview 的 candidate 明细写进 `gc_run_candidates`

这套能力足够做“观测”，但不够做“执行”。

问题不在于 preview 不准，而在于当前的数据模型只有“某一次 run 看到了什么”，没有“一个候选在最近一段时间里是否持续稳定存在”。缺这层状态，就做不了：

- 二次生命筛选
- oldest-first 调度
- sweep 前重新校验
- sweep 后候选复活跟踪

换句话说，之前的 GC 更像审计面板，不像真正可执行的清扫系统。

## 本次目标

这次 Phase 0 不做真实删除，也不碰 `doc_snapshots` / `document_drafts` / `block_versions` 的业务写路径。

目标只收敛在一件事上：

> 把 preview candidate 从“单次 run 快照”提升为“跨 run 可累积状态的候选池”。

为后续真实 sweep 准备最小但必要的数据基础。

## 本次交付

### 1. 新增 `gc_candidate_pool`

本次新增了独立候选池表和实体：

- `src/entities/gc-candidate-pool.entity.ts`
- `src/database/migrations/1782300000000-CreateGcCandidatePool.ts`

这张表解决的是“候选的当前生命状态”问题，而不是“某次 run 的历史回放”问题。

它额外记录了这些关键字段：

- `candidateKey`
- `firstSeenRunId` / `lastSeenRunId`
- `firstSeenAt` / `lastSeenAt`
- `seenCount`
- `stableSeenCount`
- `state`
- `eligibleAfter`
- `policySnapshot`
- `lastValidationAt`

这样后面即使不看某一条具体 run，也能回答：

- 这个候选第一次什么时候出现
- 最近有没有持续出现
- 它现在只是 pending，还是已经 eligible
- 它的资格是在哪套 policy 下得出的

### 2. preview run 自动同步候选池

本次没有引入新的后台任务，而是在现有 preview 执行链路里直接补了一步：

- `GcRunService.previewBlockVersions()` 完成 collector 后
- 立即把 candidate 同步进 `gc_candidate_pool`

这样做的好处是：

- 没有额外调度器
- 不改现有 preview API 语义
- 候选池天然和 run 审计保持一致

### 3. 引入最小的候选状态机

当前先实现了最小状态机：

- `pending`
- `eligible`
- `sweeping`
- `swept`
- `resurrected`
- `blocked`

本次真正用到的是前三类语义中的前两类：

- 第一次看到 candidate：进入 `pending`
- 连续看到达到阈值，且过了 promotion delay：进入 `eligible`
- 如果以后已经 `swept` 的候选再次出现：进入 `resurrected`

这已经足够支撑下一步的真实 sweep gate。

### 4. 补齐了二次生命所需的 policy 字段

之前的 policy 更偏 preview 观察视角。本次补进了后续 sweep 会直接依赖的字段：

- `promotionDelayMs`
- `stableSeenThreshold`
- `maxSweepBatchSize`
- `poolEntryExpireMs`

目前还是集中在 `GcPolicyService` 里硬编码，先求边界闭合，暂时不引入 runtime config 改造。

### 5. 增加候选池查询接口

新增接口：

- `GET /admin/gc/block-versions/pool`

它的意义不是替代 run candidate 查询，而是提供另一种视角：

- `runs/:runId/candidates` 看“某次 preview 看见了什么”
- `pool` 看“当前系统认为哪些候选已经积累成稳定对象”

这两个视图后续会长期并存。

## 这次没有做什么

本次刻意没做下面这些事：

### 1. 没有做真实 sweep

还没有任何 source table mutation。

这意味着：

- 不会改 `document_drafts.blockVersionMap`
- 不会改 `doc_snapshots.blockVersionMap`
- 不会删 `block_versions`

### 2. 没有做候选失活清理

虽然加了 `poolEntryExpireMs`，但这次还没有做“某个 candidate 长期不再出现就自动过期”的逻辑。

原因是当前更重要的是先把“候选持续出现”的正向路径打通；失活和池子瘦身可以在下一轮补。

### 3. 没有接 runtime config

这次 policy 仍然留在 `GcPolicyService`。

原因不是 runtime config 不重要，而是现在先需要把 sweep 基础状态和状态机做出来。否则过早接配置中心，会把调试面和行为面同时放大，增加变量。

### 4. 没有做 SQLite 文件收缩

这次只是在逻辑层准备候选池，没有碰任何 SQLite `VACUUM`、`auto_vacuum`、`incremental_vacuum` 的维护动作。

这是有意保持边界：

- 逻辑 GC
- 存储空间回收

仍然是两件事。

## 关键取舍

### 1. 为什么不直接复用 `gc_run_candidates`

因为 `gc_run_candidates` 的建模方向是 immutable run snapshot。

它适合回答：

- 第 17 次 preview 当时的候选有哪些

但它不适合回答：

- 这个 candidate 最近连续出现了几次
- 它现在能不能进入 sweep
- 它是不是已经被清过又复活了

硬把这些状态塞回 `gc_run_candidates`，会把历史快照和当前状态混在一起，后面一定会难维护。

### 2. 为什么先做候选池，不直接做 sweep

因为没有候选池，真实 sweep 只能依赖“刚跑出来的一次 preview”。

这会有两个问题：

1. 太激进，没有观察窗口
2. 没法表达“稳定候选”和“偶发候选”的差异

所以候选池不是锦上添花，而是 sweep 的前置条件。

### 3. 为什么先把 `eligible` 算法做进来

如果这次只落表、不落状态推进逻辑，那么候选池就只是另一张日志表。

这次把：

- `stableSeenThreshold`
- `promotionDelayMs`
- `eligibleAfter`

一起接进来，候选池才真正具备“二次生命”的最小语义。

## 遇到的问题

### 1. candidate key 不能取错 action 来源

实现时出现过一个问题：candidate key 一开始取了顶层 `action`，但 preview candidate 的 action 实际在 `reasonDetail.action` 里。

结果会生成：

- `block_version:b_1@1:undefined`

这个问题最后通过统一 `buildCandidateKey()` 的来源修掉了。

这也说明当前 preview candidate 和 persisted candidate 的投影结构还不够统一，后面如果继续扩 sweep，最好把 action 提升成稳定顶层字段。

### 2. `tsc --noEmit` 不是这次改动能完全拉平的

本次 GC 相关单测通过了，局部 lint 也通过了。

但仓库整体 `tsc --noEmit` 仍然失败，报错集中在几个已有的 spec 文件：

- `src/modules/blocks/blocks-sync-idempotency.spec.ts`
- `src/modules/blocks/blocks.service.draft.spec.ts`
- `src/modules/documents/documents.service.spec.ts`
- `src/modules/documents/services/document-render.service.spec.ts`
- `src/modules/documents/services/version-control.service.spec.ts`

这些不是这次候选池改动引入的，但它们说明仓库当前的“全量 typecheck 绿灯”不是一个稳定前提。

## 验证结果

本次直接验证了这些内容：

- `GcRunService` 会把 preview candidate 同步进 pool
- 重复出现的 candidate 会从 `pending` 提升到 `eligible`
- `GcController` 能查询候选池
- `GcModule` 依赖注入完整

执行命令：

```bash
pnpm test -- src/modules/gc/block-version-gc.collector.spec.ts src/modules/gc/gc-policy.service.spec.ts src/modules/gc/gc-run.service.spec.ts src/modules/gc/gc.controller.spec.ts src/modules/gc/gc.module.spec.ts
pnpm exec eslint src/modules/gc/**/*.ts src/entities/gc-candidate-pool.entity.ts src/database/migrations/1782300000000-CreateGcCandidatePool.ts
pnpm exec tsc --noEmit
```

结果：

- GC 相关测试通过
- 相关文件 lint 通过
- 全量 typecheck 仍有仓库既存错误，未由本次改动引入

## 下一步

Phase 0 完成后，最自然的下一步就是 Phase 1：

> 只做 `document_drafts` 上 tombstone `compact_map_entry` 的真执行。

原因很明确：

- 风险比直接删 `block_versions` 小
- 已经有 candidate pool 可做二次生命筛选
- 执行成功后能立刻验证“候选消失”与“候选复活”行为

建议 Phase 1 的边界继续保持保守：

1. 只允许 `action = compact_map_entry`
2. 只允许 `source = document_drafts`
3. sweep 前 fresh revalidation
4. sweep 后重新跑 preview 验证候选是否消失

## 结论

这次改动没有让 GC 立刻变成“会删数据”的模块，但它把最关键的一层状态补上了：

> candidate 不再只是某次 preview 里短暂出现的一条记录，而是一个可以连续观察、稳定晋升、后续执行和复活跟踪的对象。

这一步不刺激，但是必须的。

没有这一步，后面的真 sweep 只能靠一次 preview 硬推；有了这一步，后面的 sweep 才有资格谈保守、可审计和可回滚决策。
