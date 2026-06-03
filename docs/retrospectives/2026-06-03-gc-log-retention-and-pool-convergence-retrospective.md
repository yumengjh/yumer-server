# 2026-06-03 GC 日志保留与候选池收敛复盘

## 背景

在补完 tombstone compaction 和 block version physical sweep 之后，GC 的执行链路已经能工作，但新的瓶颈开始出现：

- `gc_runs` 持续增长
- `gc_run_candidates` 以 run 为单位重复追加
- `gc_candidate_pool` 只增不减

在单文档反复调试的场景下，真实占空间最多的已经不再是 `block_versions`，而是 GC 自己的审计和调试数据。

这说明当前的数据分层虽然能支撑功能，但没有收敛策略：

1. run 摘要是长期审计
2. run candidate 明细其实只是短期调试快照
3. candidate pool 理论上应是当前工作集，却被实现成了历史堆积表

## 暴露出来的问题

### 1. `gc_run_candidates` 是无界追加

当前 preview 只要 `includeCandidates = true`，就会把本次候选明细整批插入 `gc_run_candidates`。

即使两次 preview 的候选完全一样，也会存两份。

这张表更像“每次扫描的全量截屏”，而不是最小必要日志。

### 2. `gc_candidate_pool` 只会 upsert seen candidate

旧实现的 `syncCandidatePool()` 只处理：

- 这次 preview 看到的候选如何落入 pool

但没有处理：

- 上一次看到、这一次已经消失的候选怎么办

结果就是：

- 旧 pool entry 即使已经失效，也会一直留着
- `pending` / `eligible` / `blocked` / `swept` 混在一起堆积

这让 pool 偏离了“当前工作集”的本意。

### 3. `gc_runs` 没有保留期边界

`gc_runs` 本身是轻量摘要，体量比另外两张表小很多，但如果没有 TTL，也会持续膨胀。

preview run 尤其不适合作为永久历史数据全部保留。

## 设计判断

这次先采用最小改动方案，不改表结构，只改收敛行为。

判断标准是：

1. **保住当前 API 形状**
2. **不引入 migration**
3. **优先把增长曲线压平**
4. **先把 pool 恢复成当前视图，再考虑更细的历史语义**

## 本次方案

### 1. `gc_candidate_pool` 改成当前 scope 的活跃工作集

在 preview 完成后的 `syncCandidatePool()` 中：

- 当前 preview 看到的 candidate 正常 upsert
- 同一 scope 下，这次没有再出现的旧 pool entry 直接删除

scope 规则：

- 若 run 带 `docId`，则只收敛该文档下的 pool
- 否则若 run 带 `workspaceId`，则收敛该 workspace 下的 pool
- 否则收敛全局 block version pool

这样 pool 的语义变成：

> 当前这组 scope 最近一次 preview 之后，系统仍认为有效的候选集合。

这比“永远保留历史尸体”更符合 sweep 工作队列的定位。

### 2. 启用 `poolEntryExpireMs`

之前 `poolEntryExpireMs` 只是 policy 字段，没有真的用于清理。

这次把它真正接入：

- 对 `lastSeenAt` 早于保留期窗口的 pool entry 自动清理

这是一层兜底：

- 即使 scope 收敛没有覆盖到某些历史数据
- TTL 也会在后续 preview 中把它们逐步清掉

### 3. 给 `gc_run_candidates` 增加短期保留期

这张表保留最近 3 天：

- 它仍然保留“短期排障快照”的价值
- 但不再承担长期历史档案馆职责

这符合它的实际使用方式：

- 用来解释最近某次 preview 的候选细节
- 不需要无限期留存

### 4. 给 preview 类型 `gc_runs` 增加保留期

preview run 保留最近 14 天。

同时清理旧 preview run 时，会顺带删除对应的 `gc_run_candidates`。

这样可以避免：

- run 表还在
- 但明细表早已被清掉

造成的悬空感。

## 为什么这次不做更重的设计

理论上还可以继续做：

- `resolved` 状态
- `missedRunCount`
- `resolvedAt`
- sweep run 独立保留期
- `policySnapshot` 压缩成 hash
- `gc_run_candidates` 抽样而不是全量落库

但这次刻意没有一步走太远。

原因是当前最紧急的问题不是“历史模型不够优雅”，而是：

> 现有实现已经在真实调试中明显反向吞噬数据库空间。

先止血，再升级模型，风险更低。

## 本次改动

主要修改在：

- `src/modules/gc/modules/block-version/gc-run.service.ts`
- `src/modules/gc/modules/block-version/gc-run.service.spec.ts`

新增的核心行为：

1. preview 完成后执行历史清理
2. pool 同步后执行 scope 收敛
3. 超过 TTL 的 pool / run / run candidate 自动删除

## 验证

本次补了针对性测试，验证：

1. recurring candidate 仍能正常晋升为 `eligible`
2. 后续 preview 中已经消失的 pool 项会被清理

并回归通过以下测试：

```bash
pnpm.cmd test -- src/modules/gc/modules/block-version/gc-policy.service.spec.ts
pnpm.cmd test -- src/modules/gc/modules/block-version/block-version-gc.collector.spec.ts
pnpm.cmd test -- src/modules/gc/modules/block-version/gc-run.service.spec.ts
pnpm.cmd test -- src/modules/gc/modules/block-version/gc-sweep.service.spec.ts
```

## 经验总结

这次复盘的核心结论是：

> 任何“观测型中间表”只要参与持续调试链路，都必须在设计之初就带上收敛策略。

否则系统会从“清理业务垃圾”逐渐变成“制造调试垃圾”。

更具体地说：

- `gc_runs` 适合做轻量审计摘要
- `gc_run_candidates` 适合做短期调试快照
- `gc_candidate_pool` 适合做当前候选工作集

三者职责不同，保留策略也必须不同。

## 后续建议

1. 把 run / candidate / pool 的 TTL 提升为显式配置，而不是代码常量。
2. 视需要把 `gc_run_candidates` 进一步降级为抽样存储，而不是每次全量明细。
3. 如果后续要支持自动 GC 调度，再考虑引入 `resolved` / `missedRunCount` 这类更细的池状态机。
