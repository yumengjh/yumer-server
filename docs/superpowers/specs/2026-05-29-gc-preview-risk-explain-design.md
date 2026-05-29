# GC Preview Risk Explainability Design

> 状态：已评审  
> 日期：2026-05-29  
> 仓库：E:\workspace\yuweb\back\server

## 目标

当前 GC Preview v2 已能识别 `live root`、`deleted tombstone root` 和普通不可达旧版本。下一步要把每个 candidate 从“看起来可清理”升级为“可解释、可验证、可执行前置检查明确”的状态。

本次只做增强，不改现有删除语义，不新增 sweep/delete 路径，不破坏已有返回字段。

## 问题

现在的 candidate 只有 `reasonCode`、`reasonDetail` 和粗粒度 `riskLevel`。这会带来三个问题：

1. 调试时只能看到“它是候选”，看不到“为什么是这个风险等级”。
2. `medium / low` 太粗，无法表达候选距离阈值的远近、root 语义是否单一、执行前还缺哪些验证。
3. 调试接口返回的是落库实体视图，缺少面向排障的解释层。

## 方案

### 1. 保留事实层

现有 `reasonDetail` 继续作为事实层，只放观测结果，不承载最终决策语义。

保留并继续使用的字段包括：

- `rootKind`
- `deleted`
- `source`
- `action`
- `hardRooted`
- `retainedByPolicy`
- `gracePeriodMs`
- `tombstoneGracePeriodMs`
- `keepLatestPerBlock`

其中 `keepLatestPerBlock` 只用于给未命中 root 的版本增加保守保留；设为 `0` 时表示关闭这层额外保留。
`blocks.latestVer` 仍然单独保留，不依赖这个参数。

可新增的事实字段包括：

- `ageMs`
- `ageBucket`
- `rootSourceCount`
- `decisionPath`

### 2. 新增解释层

每个 candidate 额外投影以下字段，用于调试接口：

- `riskAssessment`
  - `level`
  - `score`
  - `reasons`
  - `factors`
- `plannedAction`
  - 例如 `candidate_block_version`、`compact_map_entry`
- `requiredChecks`
  - 例如 `verify_root_stability`、`verify_no_recent_write_dependency`
- `readiness`
  - 例如 `ready_for_manual_review`、`needs_more_validation`

### 3. 风险评分规则

`riskLevel` 仍然保留 `low | medium | high`，但不再写死，而是由策略计算。

建议规则：

- `deleted_tombstone_map_entry`
  - 默认偏低风险，因为动作是压缩 map 引用，不是直接删除内容
  - 如果 tombstone 很新、来源不单一，或刚跨过阈值，则提升为 `medium`
- `unreferenced_older_than_policy`
  - 默认 `medium`
  - 如果离 `gracePeriodMs` 很远、没有 root 歧义、并且不是最近历史边界附近，可降到 `low`
  - 如果只刚刚超过阈值、版本年龄接近边界、或 root 语义不够稳定，则保持 `medium` 或升到 `high`

评分不需要过度复杂，但必须可解释。每个 `riskAssessment.reasons` 要能对应到具体规则项。

### 4. 策略配置位置

策略继续集中在 `src/modules/gc/gc-policy.service.ts`。

建议新增少量规则参数，而不是把所有解释项都配置化：

- `riskWindows.unreferencedFreshMs`
- `riskWindows.tombstoneFreshMs`
- `riskModifiers.latestVersionPenalty`
- `riskModifiers.sourceAmbiguityPenalty`
- `riskModifiers.oldEnoughBonus`

### 5. 接口兼容策略

不修改现有数据库表结构，不新增 migration。

调试接口保持旧字段不变，只在每个 candidate 上新增解释层字段。旧调用方仍可只读取 `reasonCode`、`reasonDetail` 和 `riskLevel`。

## 影响文件

- `src/modules/gc/gc-policy.service.ts`
- `src/modules/gc/gc.types.ts`
- `src/modules/gc/block-version-gc.collector.ts`
- `src/modules/gc/gc-run.service.ts`
- `src/modules/gc/gc.controller.ts`
- `src/modules/gc/gc-run.service.spec.ts`
- `src/modules/gc/block-version-gc.collector.spec.ts`
- `src/modules/gc/gc-policy.service.spec.ts`

## 验收标准

1. 现有 GC Preview 行为不回退，旧字段保持可用。
2. 每个 candidate 都能说明它为什么是候选、风险为什么是这个等级、预期动作是什么、执行前还缺什么验证。
3. `GET /admin/gc/block-versions/runs/:runId/candidates` 返回的对象只增不减。
4. 不新增数据库列，不改变现有落库兼容性。
5. 新增单测覆盖风险解释和接口投影。
