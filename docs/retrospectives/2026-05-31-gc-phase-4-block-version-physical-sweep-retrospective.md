<!-- cspell:words freelist autovacuum -->

# 2026-05-31 GC Phase 4 block version physical sweep 复盘

## 背景

Phase 0 到 Phase 3 已经把 GC 从 preview-only 推到了 tombstone map compaction：

1. 候选可以进入 `gc_candidate_pool`
2. tombstone compaction 可以 dry-run / real sweep
3. draft 和 revision snapshot 都有了 root-entry 级执行对象
4. sweep run 已经能落审计记录

但还有一个核心缺口没有跨过去：

> `candidate_block_version` 仍然只停留在候选状态，没有真正删除 `block_versions` 行。

这一步比 tombstone compaction 风险更高。tombstone compaction 只是从 root map 里移除 tombstone 引用，而 block version physical sweep 会删除真实版本数据，可能影响：

- 历史内容读取
- diff
- revert
- 版本树解释
- 搜索或引用路径

所以 Phase 4 的重点不是“把删除按钮接上”，而是把删除前的 gate 做到足够窄、足够可审计。

## 本次目标

本次新增一条真实执行路径：

> 对 `gc_candidate_pool` 中 `state = eligible && action = candidate_block_version` 的候选执行 block version physical sweep。

接口同时支持：

- `dryRun = true`：只做 fresh revalidation，不删除数据
- `dryRun = false`：事务内再次 revalidation，通过后删除 `block_versions`

这次仍然明确不做：

- 删除 `blocks` 主表
- 删除 latest version
- 删除仍被 snapshot / draft root 引用的 version
- 删除还在 `keepLatestPerBlock` 保留窗口内的 version
- SQLite / Postgres 物理存储空间回收

## 本次交付

### 1. 新增 block version sweep 入口

新增接口：

```http
POST /admin/gc/block-versions/sweeps/block-versions
```

请求体复用现有 sweep DTO：

```json
{
  "workspaceId": "ws_1",
  "docId": "doc_1",
  "limit": 100,
  "dryRun": true
}
```

默认语义上，前端应该先走 `dryRun = true`，再由人工确认是否执行 `dryRun = false`。

### 2. 只从稳定候选池中 oldest-first 选取

这次不直接从某次 preview run 的 candidate 明细里删。

候选必须已经进入 pool，且满足：

- `resourceType = block_version`
- `state = eligible`
- `action = candidate_block_version`
- scope 匹配 `workspaceId` / `docId`

排序顺序是：

1. `eligibleAfter ASC`
2. `firstSeenAt ASC`
3. `versionCreatedAt ASC`

这保证真实删除消费的是二次生命筛选后的稳定候选，而不是一次 preview 中刚出现的瞬时结果。

### 3. dry-run 和 real-run 共享同一套 revalidation

dry-run 不是重新做 preview，也不是只看 pool 状态。

它会重新读取当前业务表并检查：

1. document 仍存在
2. workspace / doc scope 仍一致
3. `block_versions` 行仍存在
4. 对应 `blocks` 行仍存在
5. 候选不是 `blocks.latestVer`
6. 候选仍然超过当前 `gracePeriodMs`
7. 候选未命中当前 `keepLatestPerBlock`
8. 没有任何 `doc_snapshots.blockVersionMap` 指向它
9. 没有任何 `document_drafts.blockVersionMap` 指向它

只有这些校验全部通过，dry-run 才会计入 `wouldDeleteCandidates`。

### 4. real-run 在事务内再次校验

真实删除前，服务层已经做过一轮 fresh revalidation。

但真正进入 `delete` 前，事务内会再跑一遍同样的校验。原因是 sweep 过程中 root map 或 latest version 可能已经被其他写入改动。

事务内如果发现候选失效，不会删除版本行，而是：

- 把 pool candidate 标记为 `blocked`
- 写入 `lastBlockers`
- 外层 summary 计入 `blockedCandidates`
- 不计入 `deletedBlockVersions`

这个细节很重要。它避免了“事务内挡住了删除，但 run summary 仍显示删除成功”的审计污染。

### 5. 删除完成后保留 pool 轨迹

删除成功后不会移除 pool entry，而是标记：

- `state = swept`
- `lastSweepAt`
- `lastValidationAt`
- `lastBlockers = []`

保留 `swept` 的原因和前几期一致：

1. 后续 preview 如果再次看到同一个 candidate，可以识别为异常复活
2. 运维面板能看到已经执行过哪些清理
3. sweep run 和 pool 状态能互相解释

## Blockers 设计

本次 block version sweep 使用独立 blocker 集合：

- `candidate_action_invalid`
- `document_missing`
- `document_workspace_mismatch`
- `block_missing`
- `block_version_missing`
- `block_latest_version`
- `block_version_too_recent`
- `block_version_policy_retained`
- `snapshot_root_present`
- `draft_root_present`

这里最关键的是后三类：

### `block_latest_version`

即使 preview 或 pool 中出现异常，latest version 也不能被 physical delete。

`blocks.latestVer` 是块当前版本的硬保护线，不依赖 `keepLatestPerBlock`。

### `snapshot_root_present` / `draft_root_present`

只要当前任何 root map 还指向这个 version，就不能删。

这一步是 physical delete 和 tombstone compaction 的本质差异：

- tombstone compaction 删除的是 root map entry
- block version sweep 删除的是版本行本身

只要 root 还在，版本行就仍然是可读路径的一部分。

### `block_version_policy_retained`

即使当前没有 root 指向，候选也可能仍在 `keepLatestPerBlock` 保留窗口内。

这层校验使用当前 policy 和当前版本列表重新计算，不信候选入池时的旧 `policySnapshot`。

## Summary 字段

本次 sweep run summary 的核心字段：

- `dryRun`
- `selectedCandidates`
- `processedCandidates`
- `wouldDeleteCandidates`
- `deletedBlockVersions`
- `blockedCandidates`

前端调试页可以按下面方式解释：

- `dryRun = true` 时，看 `wouldDeleteCandidates` 和 `blockedCandidates`
- `dryRun = false` 时，看 `deletedBlockVersions` 和 `blockedCandidates`
- `selectedCandidates > processedCandidates` 通常表示执行中断或异常

不要把 `selectedCandidates` 当成真实删除数量。

## SQLite / Postgres 存储边界

这次打开了 `block_versions` 行级删除，但仍然没有做数据库文件收缩。

这点需要在前端和文档里持续强调：

> GC sweep 完成，只代表逻辑清理完成，不代表磁盘空间已经返还给操作系统。

### SQLite

SQLite 删除行后，空闲页通常进入 freelist。数据库文件是否变小取决于：

- `VACUUM`
- `auto_vacuum`
- `incremental_vacuum`

这些都不应该绑在每次 GC sweep 后自动执行，因为它们可能阻塞写入，也可能带来明显 I/O 抖动。

### Postgres

Postgres 删除行后，也不等于立刻缩小数据文件。实际空间治理更适合交给：

- autovacuum
- DBA maintenance
- 后续独立 storage maintenance 接口

因此 Phase 4 的结果只能称为：

> block version logical physical delete 已经可执行。

不能称为：

> 存储空间已经压缩完成。

## 前端调试页影响

前端现在应该把 sweep console 扩成三类动作：

1. Draft Tombstones
2. Revision Tombstones
3. Block Versions

对 Block Versions：

- 默认勾选 `dryRun`
- real-run 前必须有二次确认
- pool 列表应支持 `action = candidate_block_version`
- summary 中突出显示 `wouldDeleteCandidates` / `deletedBlockVersions` / `blockedCandidates`
- 对 `snapshot_root_present`、`draft_root_present`、`block_latest_version` 做醒目文案

文案上不要说“释放磁盘空间”，应该说“删除版本行”或“完成逻辑清理”。

## 这次没有做什么

### 1. 没有删除 `blocks`

`blocks` 是块当前身份表，不属于本次 GC 删除范围。

即使某个 block 的旧版本被删，block 本身也仍然要保留。

### 2. 没有引入自动调度

当前仍然是管理接口手动触发。

后续如果要做自动 GC，至少还需要：

- 全局并发控制
- 批次续跑
- blocked 恢复策略
- 运行窗口限制
- 失败告警

### 3. 没有做 storage compaction 接口

SQLite `VACUUM` / Postgres maintenance 应单独设计。

建议后续再做：

```http
POST /admin/gc/storage/compact
```

但它应该是维护操作，不应该混入 block version sweep。

## 验证结果

执行命令：

```bash
pnpm test -- src/modules/gc/gc-sweep.service.spec.ts src/modules/gc/gc.controller.spec.ts src/modules/gc/gc.module.spec.ts src/modules/gc/gc-run.service.spec.ts
pnpm exec eslint src/modules/gc/gc-sweep.service.ts src/modules/gc/gc-sweep.service.spec.ts src/modules/gc/gc.controller.ts src/modules/gc/gc.controller.spec.ts src/modules/gc/dto/create-block-version-gc-sweep.dto.ts
pnpm build
```

结果：

- GC 相关定向测试通过，21/21
- GC 相关 lint 通过
- `pnpm build` 通过，TSC 0 issues
- lint 仍会打印仓库既有的 Next pages 提示，不影响本次检查结果

## 下一步

下一步更适合做两件事：

1. 把前端 GC 调试页接上 `sweeps/block-versions`
2. 单独设计 storage maintenance，明确 SQLite / Postgres 的空间回收边界

如果继续沿着真实 GC 能力推进，我建议先做前端调试页。

原因是现在后端已经具备真实删除能力，下一步最需要的是让 operator 能清楚看到：

- 准备删什么
- 为什么能删
- 为什么被挡
- 真实删了多少
- 哪些只是逻辑删除，不是磁盘回收

## 结论

Phase 4 是 GC 模块第一次真正删除 `block_versions` 行。

这一步的关键不在于新增了一个 delete 调用，而在于把真实删除约束在了一个很窄的执行模型里：

- 只消费稳定 pool candidate
- dry-run 和 real-run 共用 revalidation
- 事务内再次校验
- root 引用存在时绝不删除
- latest / policy retained 绝不删除
- 删除结果继续回写 pool 状态和 run summary

从这个阶段开始，GC 不再只是 tombstone map compaction，而是具备了真正的版本数据清扫能力。
