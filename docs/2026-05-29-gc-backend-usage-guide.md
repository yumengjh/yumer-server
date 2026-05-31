<!-- cspell:words explainability -->

# GC 后端使用说明

> 日期：2026-05-31  
> 适用仓库：`E:\workspace\yuweb\back\server`  
> 适用范围：块版本 GC preview + candidate pool + real sweep

## 1. 当前 GC 到了哪一步

现在的 GC 已经不是单纯的 preview-only 统计接口了，当前包含四层能力：

1. `health`：判断当前 scope 是否适合做 GC 分析
2. `preview run`：生成一次候选扫描结果
3. `candidate pool`：把候选跨 run 持久化，并做稳定性晋升
4. `sweep`：对部分 `compact_map_entry` 候选做真实执行

当前已经支持的真实 sweep：

- `document_drafts` tombstone map compaction
- `doc_snapshots(kind=revision, pinned=false)` tombstone map compaction
- `candidate_block_version` 的 `block_versions` 物理删除

当前还没有做的真实删除：

- SQLite / Postgres 的物理存储文件收缩

## 2. 这套接口主要服务什么场景

当前 GC 接口的主要消费方不是普通业务页面，而是：

- 运维排查
- 数据治理
- GC 调试页
- sweep 前的人工复核

前端如果要做 GC 调试页，应该把它理解成一个“诊断 + 候选池 + 执行入口”的后台工具，而不是普通用户功能。

## 3. 关键概念

### 3.1 Health

`health` 用来回答：

- 当前 workspace / doc 是否缺少 revision snapshot
- published snapshot 是否缺失
- root 指向的 block version 是否丢失

如果 `health.status = blocked`，说明 preview 本身都不可靠，前端不应该继续推动 sweep。

### 3.2 Preview Run

`preview run` 是一次只读分析。

它会保存：

- `scope`
- `policySnapshot`
- `health`
- `summary`
- 可选的 `gc_run_candidates`

`mode = preview`。

### 3.3 Candidate Pool

`gc_candidate_pool` 是跨 run 的候选池，不再是单次 preview 的快照。

它会持续追踪：

- 候选第一次出现和最后一次出现
- 连续稳定出现次数
- 是否已经进入 `eligible`
- 是否已经 `blocked` / `swept` / `resurrected`

### 3.4 Sweep Run

真实 sweep 也会落到 `gc_runs`，只是 `mode = sweep`。

这意味着前端在“最近运行记录”里，不应该只把 run 当成 preview。现在 run 列表里会同时出现：

- preview run
- sweep run

### 3.5 Root-entry 粒度

这是最近最重要的变化之一。

对 `compact_map_entry` 来说，候选已经不是“某个 tombstone block version”这么粗，而是“某个 root entry 对 tombstone version 的引用”。

例如下面两条现在是两个独立候选：

- `snapshot:doc_1@snap@4 -> b_1@4`
- `draft:draft_1 -> b_1@4`

前端不能再假设同一个 `resourceKey` 只会有一条 `compact_map_entry` candidate。

## 4. 统一鉴权方式

控制器前缀：

```text
/admin/gc/block-versions
```

必须带：

```http
x-system-admin-token: <token>
```

可选但推荐带：

```http
x-operator-id: <operator-id>
```

`x-operator-id` 会进入 run 审计字段，前端调试页应该尽量传。

## 5. 当前可用接口

### 5.1 健康检查

```http
GET /admin/gc/block-versions/health?workspaceId=ws_1&docId=doc_1
```

用途：

- 进入页面先看 scope 是否允许 preview
- 显示 blocker 样本

### 5.2 查询当前 policy

```http
GET /admin/gc/block-versions/policy
```

用途：

- 查看当前 GC policy 默认值
- 给前端 sweep 表单提供默认 `limit`
- 展示二次生命筛选参数，例如 `promotionDelayMs`、`stableSeenThreshold`

当前接口只读。真实 sweep 仍使用服务端当前 policy，不接受请求体覆盖 TTL。

### 5.3 创建 preview run

```http
POST /admin/gc/block-versions/runs
Content-Type: application/json
```

请求体：

```json
{
  "workspaceId": "ws_1",
  "docId": "doc_1",
  "includeCandidates": true
}
```

用途：

- 重新扫描当前 scope
- 更新 summary
- 可选保存 run candidate 明细
- 同步刷新 candidate pool

### 5.4 查询 run 列表

```http
GET /admin/gc/block-versions/runs?page=1&pageSize=20&mode=sweep&workspaceId=ws_1&docId=doc_1
```

支持参数：

- `page`
- `pageSize`
- `mode`: `preview` / `sweep`
- `status`
- `workspaceId`
- `docId`

scope 过滤会先于分页生效，返回的 `total` 是当前过滤条件下的总数。返回项里包含 `mode`，前端应区分：

- `preview`
- `sweep`

### 5.5 查询单个 run

```http
GET /admin/gc/block-versions/runs/:runId
```

用途：

- 展示 `policySnapshot`
- 展示 `health`
- 展示 `summary`
- 判断 `candidateDetailsStored`
- 判断 `candidateDetailsTruncated`

### 5.6 查询某次 run 的 candidates

```http
GET /admin/gc/block-versions/runs/:runId/candidates?page=1&pageSize=100
```

用途：

- 查看这次 preview 持久化的候选列表
- 查看 explainability 字段

### 5.7 查询 candidate pool

```http
GET /admin/gc/block-versions/pool?page=1&pageSize=100&state=eligible&action=compact_map_entry
```

支持参数：

- `page`
- `pageSize`
- `state`
- `action`
- `workspaceId`
- `docId`

当前 `state`：

- `pending`
- `eligible`
- `sweeping`
- `swept`
- `resurrected`
- `blocked`

当前 `action`：

- `candidate_block_version`
- `compact_map_entry`

### 5.8 执行 draft tombstone sweep

```http
POST /admin/gc/block-versions/sweeps/draft-tombstones
Content-Type: application/json
```

请求体：

```json
{
  "workspaceId": "ws_1",
  "docId": "doc_1",
  "limit": 100,
  "dryRun": true
}
```

用途：

- 只处理 `source = document_drafts`
- 只处理 `action = compact_map_entry`
- 先 fresh revalidation，再决定是否真的改写 `document_drafts.blockVersionMap`

### 5.9 执行 revision tombstone sweep

```http
POST /admin/gc/block-versions/sweeps/revision-tombstones
Content-Type: application/json
```

请求体和 draft sweep 相同：

```json
{
  "workspaceId": "ws_1",
  "docId": "doc_1",
  "limit": 100,
  "dryRun": true
}
```

用途：

- 只处理 `source = doc_snapshots`
- 只处理 `kind = revision && pinned = false`
- 按 root-entry 精确定位目标 snapshot entry

### 5.10 执行 block version sweep

```http
POST /admin/gc/block-versions/sweeps/block-versions
Content-Type: application/json
```

请求体：

```json
{
  "workspaceId": "ws_1",
  "docId": "doc_1",
  "limit": 100,
  "dryRun": true
}
```

用途：

- 从 `gc_candidate_pool` 里选择 `state = eligible` 且 `action = candidate_block_version` 的候选
- 按 `eligibleAfter ASC, firstSeenAt ASC, versionCreatedAt ASC` oldest-first 处理
- `dryRun = true` 时只做 fresh revalidation，不删除 `block_versions`
- `dryRun = false` 时在事务内再次 revalidation，然后删除对应 `block_versions` 行

fresh revalidation 会检查：

- `block_versions` 行仍存在
- 不是 `blocks.latestVer`
- 未命中 `keepLatestPerBlock`
- 仍然超过 `gracePeriodMs`
- 没有任何 `doc_snapshots.blockVersionMap` 指向它
- 没有任何 `document_drafts.blockVersionMap` 指向它
- workspace / doc scope 仍一致

注意：这个接口只表示逻辑删除版本行，不表示 SQLite 数据库文件会立即变小。

## 6. 前端最该关注的返回字段

### 6.1 Run 级

- `runId`
- `mode`
- `status`
- `scope`
- `policySnapshot`
- `health`
- `summary`
- `candidateDetailsStored`
- `candidateDetailsTruncated`
- `triggeredBy`
- `startedAt`
- `finishedAt`

### 6.2 Candidate / Pool 级

基础字段：

- `candidateKey`
- `resourceKey`
- `resourceRowId`
- `docId`
- `workspaceId`
- `blockId`
- `blockVer`
- `reasonCode`
- `riskLevel`

执行相关字段：

- `action`
- `source`
- `state`
- `eligibleAfter`
- `lastSweepAt`
- `lastValidationAt`
- `lastBlockers`

### 6.3 `reasonDetail`

前端调试页建议重点展示：

- `rootKind`
- `deleted`
- `source`
- `action`
- `rootRefType`
- `rootRefId`
- `rootRefKey`
- `hardRooted`
- `retainedByPolicy`
- `ageMs`
- `ageBucket`
- `rootSourceCount`
- `distanceFromLatestVer`
- `decisionPath`

其中最近新增、最关键的是：

- `rootRefType`
- `rootRefId`
- `rootRefKey`

这三个字段决定了前端能否把 `compact_map_entry` candidate 正确展示为 root-entry 级对象。

### 6.4 Explainability 投影字段

无论来自 run candidates 还是 pool，当前都会附带 explainability 字段：

- `riskAssessment`
- `plannedAction`
- `requiredChecks`
- `readiness`

#### `riskAssessment`

结构大致如下：

```json
{
  "level": "low",
  "score": 16,
  "reasons": ["tombstone root is old enough to compact"],
  "factors": [
    {
      "code": "tombstone_age_stable",
      "weight": -20,
      "detail": {
        "ageMs": 86400000,
        "graceWindowMs": 10000
      }
    }
  ]
}
```

#### `plannedAction`

当前只有两类：

- `candidate_block_version`
- `compact_map_entry`

#### `requiredChecks`

常见值：

- `verify_root_stability`
- `verify_source_consistency`
- `verify_policy_overlap`
- `verify_no_recent_write_dependency`
- `verify_content_read_paths`

#### `readiness`

当前值：

- `ready_for_manual_review`
- `needs_more_validation`

## 7. Sweep 的真实边界

### 7.1 `dryRun = true`

`dryRun` 不是重新做 preview，而是：

- 走和真实 sweep 相同的候选选取
- 走相同的 fresh revalidation
- 不改业务表

前端应把它作为“执行前复核”按钮，而不是“统计按钮”。

### 7.2 当前 sweep 不会做什么

当前真实 sweep 仍然不会：

- 删除 `block_versions`
- 做 SQLite `VACUUM`
- 做 Postgres `VACUUM`
- 自动恢复旧的 blocked candidate

### 7.3 SQLite / Postgres 语义

逻辑 sweep 成功，只表示：

- root map 被压缩
- 或未来某天支持的物理删除被执行

不表示数据库文件会立刻变小。

SQLite 的文件缩小仍然应视为独立 maintenance 行为，不应被前端误展示成“GC 已完成磁盘回收”。

## 8. 推荐的页面使用顺序

推荐顺序：

1. 先调 `/health`
2. 再拉 `/runs`
3. 用户触发新的 `/runs` preview
4. 选中某个 run 后查看 `/runs/:runId`
5. 如果 `candidateDetailsStored = true`，再拉 `/runs/:runId/candidates`
6. 用 `/pool` 观察跨 run 晋升状态
7. 对 `eligible + compact_map_entry` 做 `dryRun`
8. 人工确认后再做真实 sweep

## 9. 不要误解的地方

### 9.1 `riskAssessment.level = low` 不等于可以自动删

这只是“更适合人工 review”，不是自动放行。

### 9.2 `plannedAction = compact_map_entry` 不等于删除版本数据

它只表示：

> 这个 root entry 对 tombstone version 的引用可以考虑压缩

### 9.3 同一个 `resourceKey` 现在可能出现多条 candidate

特别是 `compact_map_entry`。

前端不能用 `resourceKey` 当唯一行 key，应该优先用：

- `candidateKey`

## 10. 相关实现位置

- [gc.controller.ts](/E:/workspace/yuweb/back/server/src/modules/gc/gc.controller.ts:1)
- [gc-run.service.ts](/E:/workspace/yuweb/back/server/src/modules/gc/gc-run.service.ts:1)
- [gc-sweep.service.ts](/E:/workspace/yuweb/back/server/src/modules/gc/gc-sweep.service.ts:1)
- [gc-policy.service.ts](/E:/workspace/yuweb/back/server/src/modules/gc/gc-policy.service.ts:1)
- [gc.types.ts](/E:/workspace/yuweb/back/server/src/modules/gc/gc.types.ts:1)

## 11. 一句话总结

现在这套 GC 后端接口，已经足够支撑一个真正可用的调试页：

- 能看 health
- 能做 preview
- 能看单次 run 和跨 run pool
- 能区分 root-entry 级候选
- 能 dry-run 和真实 sweep tombstone compaction
