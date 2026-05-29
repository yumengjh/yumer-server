# GC 后端使用说明

> 日期：2026-05-29  
> 适用仓库：`E:\workspace\yuweb\back\server`  
> 适用范围：块版本 GC Preview v2 + candidate 风险解释增强版

## 1. 这套后端 GC 现在是什么

当前 GC 还不是“自动删除数据”的系统，而是一个：

- 预览系统
- 诊断系统
- 候选识别系统
- 风险解释系统

它现在回答的问题是：

1. 哪些 `block_versions` 仍然被正式内容引用。
2. 哪些 `block_versions` 仍然被草稿引用。
3. 哪些 `block_versions` 理论上已经不可达。
4. 哪些不可达版本已经足够老，可以进入 candidate。
5. 每个 candidate 为什么被判为候选。
6. 每个 candidate 未来想执行什么动作。
7. 真正执行前还缺哪些验证。

当前版本仍然是 `preview-only`：

- 不删除 `block_versions`
- 不修改 `doc_snapshots.blockVersionMap`
- 不修改 `document_drafts.blockVersionMap`
- 不执行 sweep

## 2. 当前模型怎么理解

### 2.1 被分析的核心表

#### `block_versions`

GC 的分析对象。  
每条记录都可以理解为一个块内容版本，canonical key 是：

```text
blockId@ver
```

例如：

```text
b_1001@4
```

#### `doc_snapshots`

正式文档版本的 root 来源。  
`blockVersionMap` 里的每一项都表示“这个正式版本仍然依赖哪个块版本”。

#### `document_drafts`

草稿版本的 root 来源。  
只要一个块版本仍在草稿 map 里，它就不能成为普通 candidate。

#### `gc_runs`

每次 preview 的运行记录。  
保存 scope、policy snapshot、health、summary、状态和审计信息。

#### `gc_run_candidates`

某次 preview run 保存下来的候选明细。  
这里保存的是“候选事实”，不是“已经删除”。

### 2.2 当前 root 语义

当前 GC 只认两类 root 来源：

- `doc_snapshots`
- `document_drafts`

但 root 自身又分两种语义：

1. `live root`
2. `deleted tombstone root`

#### `live root`

表示 map 仍然引用一个正常内容版本。  
这类版本绝不能进入 candidate。

#### `deleted tombstone root`

表示 map 仍然引用一个 `payload.attrs.deleted === true` 的删除版本。  
这类版本不再被当作普通内容候选，但可能在超过宽限期后变成：

- `deleted_tombstone_map_entry`

它的含义不是“删除这个 block_version”，而是：

> 这个 tombstone map entry 已经足够老，后续可以考虑做 map compaction。

### 2.3 普通旧版本 candidate

普通 candidate 的基本语义是：

1. 不在 `live root`
2. 不在 `tombstone root`
3. 不在策略保留集合里
4. 超过 `gracePeriodMs`

当前对应 reason code：

- `unreferenced_older_than_policy`

## 3. 当前策略位置

策略集中在：

- [src/modules/gc/gc-policy.service.ts](/E:/workspace/yuweb/.worktrees/gc-preview-risk-explain/back/server/src/modules/gc/gc-policy.service.ts:1)

当前核心策略字段：

- `gracePeriodMs`
- `tombstoneGracePeriodMs`
- `keepLatestPerBlock`
- `maxCandidatesToStore`
- `rootSources`

`keepLatestPerBlock` 的含义是：对未被 root 命中的版本，额外保留每个 `blockId` 最近 N 个版本；设为 `0` 时表示关闭这层保守保留。
`blocks.latestVer` 是另一层独立保护，不受这个参数影响。

当前风险解释也在这个 service 里统一计算，避免 collector 和调试接口各写一套判断。

## 4. 对外接口怎么用

控制器入口：

- [src/modules/gc/gc.controller.ts](/E:/workspace/yuweb/.worktrees/gc-preview-risk-explain/back/server/src/modules/gc/gc.controller.ts:1)

统一前缀：

```text
/admin/gc/block-versions
```

统一鉴权头：

```http
x-system-admin-token: <token>
```

可选审计头：

```http
x-operator-id: <operator>
```

### 4.1 查询当前健康状态

```http
GET /admin/gc/block-versions/health?workspaceId=ws_1&docId=doc_1
```

用途：

- 判断当前 scope 是否适合做 preview
- 看 `missingRevisionSnapshots`
- 看 `missingPublishedSnapshots`
- 看 `missingRootBlockVersions`

### 4.2 创建一次 preview run

```http
POST /admin/gc/block-versions/runs
Content-Type: application/json
```

请求体示例：

```json
{
  "workspaceId": "ws_1",
  "docId": "doc_1",
  "includeCandidates": true
}
```

用途：

- 触发一次新的 GC preview
- 重新计算 health / summary / candidates
- 选择是否把 candidate 明细写入 `gc_run_candidates`

### 4.3 查询 run 列表

```http
GET /admin/gc/block-versions/runs?page=1&pageSize=20&workspaceId=ws_1&docId=doc_1
```

用途：

- 拉最近 run 历史
- 做 Recent Runs 面板

### 4.4 查询某次 run 详情

```http
GET /admin/gc/block-versions/runs/:runId
```

用途：

- 获取 `policySnapshot`
- 获取当次 `health`
- 获取 `summary`
- 获取 `candidateDetailsStored` / `candidateDetailsTruncated`

### 4.5 查询某次 run 的 candidates

```http
GET /admin/gc/block-versions/runs/:runId/candidates?page=1&pageSize=100
```

用途：

- 获取已保存 candidate 列表
- 当前“风险解释增强字段”主要从这个接口给前端

## 5. Candidate 返回结构怎么理解

当前 candidate 返回可以分成两层：

1. 事实层
2. 解释层

### 5.1 事实层

这些字段是兼容保留的基础字段：

- `resourceKey`
- `resourceRowId`
- `docId`
- `workspaceId`
- `blockId`
- `blockVer`
- `versionCreatedAt`
- `reasonCode`
- `reasonDetail`
- `riskLevel`

其中 `reasonDetail` 现在已经增强，典型字段包括：

- `rootKind`
- `deleted`
- `source`
- `action`
- `hardRooted`
- `retainedByPolicy`
- `gracePeriodMs`
- `tombstoneGracePeriodMs`
- `keepLatestPerBlock`
- `ageMs`
- `ageBucket`
- `rootSourceCount`
- `distanceFromLatestVer`
- `decisionPath`

这些字段回答的是：

> 系统看到了什么事实，才把它放进 candidate。

### 5.2 解释层

这是本次新增的调试增强字段：

- `riskAssessment`
- `plannedAction`
- `requiredChecks`
- `readiness`

#### `riskAssessment`

结构大致如下：

```json
{
  "level": "low",
  "score": 12,
  "reasons": [
    "tombstone root is old enough to compact"
  ],
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

含义：

- `level`：对外展示的风险等级
- `score`：更细粒度的内部风险分
- `reasons`：人可以直接读的解释语句
- `factors`：结构化因子，方便前端拆成 tag 或 tooltip

#### `plannedAction`

当前主要有两个值：

- `candidate_block_version`
- `compact_map_entry`

含义：

- `candidate_block_version`：普通旧版本候选，后续如果进入 sweep，目标会更接近“清理版本”
- `compact_map_entry`：只表示后续可考虑压缩 map entry，不表示删除版本数据

#### `requiredChecks`

这是执行前置检查清单。当前可能出现：

- `verify_root_stability`
- `verify_source_consistency`
- `verify_policy_overlap`
- `verify_no_recent_write_dependency`
- `verify_content_read_paths`

它回答的问题是：

> 这个 candidate 真要做动作之前，系统认为还必须补哪些验证。

#### `readiness`

当前有两个值：

- `ready_for_manual_review`
- `needs_more_validation`

它不是风险等级的替代，而是执行准备度：

- 风险低，不代表可以自动删
- 只是表示它更接近“可以进入人工 review”

## 6. 前端应该怎么消费这些新字段

这次接口增强是“只增不改”：

- 老字段不删除
- 老字段不重命名
- 数据库存储结构不变
- 新字段只在返回层增强

所以前端可以分阶段接入。

### 6.1 第一阶段：保持旧面板能跑

只用旧字段：

- `reasonCode`
- `reasonDetail`
- `riskLevel`

这样旧 UI 不需要立刻重构。

### 6.2 第二阶段：逐步展示解释层

推荐前端增加这些显示位：

#### Candidate 列表列

- `Version` -> `resourceKey`
- `Reason` -> `reasonCode`
- `Risk` -> `riskAssessment.level`，保留回退到 `riskLevel`
- `Action` -> `plannedAction`
- `Readiness` -> `readiness`

#### Candidate 详情抽屉

推荐拆成四块：

1. 基本信息
   - `resourceKey`
   - `blockId`
   - `blockVer`
   - `versionCreatedAt`

2. 候选事实
   - `reasonCode`
   - `reasonDetail.rootKind`
   - `reasonDetail.deleted`
   - `reasonDetail.source`
   - `reasonDetail.ageMs`
   - `reasonDetail.ageBucket`
   - `reasonDetail.distanceFromLatestVer`

3. 风险解释
   - `riskAssessment.level`
   - `riskAssessment.score`
   - `riskAssessment.reasons`
   - `riskAssessment.factors`

4. 后续动作与检查
   - `plannedAction`
   - `requiredChecks`
   - `readiness`

### 6.3 第三阶段：做配置化展示

如果前端想配置式渲染，可以按下面思路：

#### 风险颜色

- `low` -> 绿色
- `medium` -> 黄色
- `high` -> 红色

#### 动作标签

- `candidate_block_version` -> “候选旧版本”
- `compact_map_entry` -> “可压缩 tombstone 引用”

#### readiness 标签

- `ready_for_manual_review` -> “可人工复核”
- `needs_more_validation` -> “仍需补验证”

#### requiredChecks 标签

建议做 code -> 中文文案映射：

- `verify_root_stability` -> “复查 root 是否稳定”
- `verify_source_consistency` -> “复查多来源 root 是否一致”
- `verify_policy_overlap` -> “复查是否仍命中保留策略”
- `verify_no_recent_write_dependency` -> “复查最近写入依赖”
- `verify_content_read_paths` -> “复查内容读取链路”

#### risk factor tooltip

`riskAssessment.factors` 非常适合做 tooltip 或折叠面板。  
建议展示：

- `code`
- `weight`
- `detail`

这样前端调试时不需要再猜后端为什么打这个分。

## 7. 推荐的前端拉取顺序

如果要做调试面板，推荐顺序如下：

1. 先调 `/health`
2. 再调 `/runs`
3. 取第一条 run 的 `runId`
4. 调 `/runs/:runId`
5. 如果 `candidateDetailsStored === true`
6. 再调 `/runs/:runId/candidates`

这样能避免前端一开始就盲拉 candidates。

## 8. 当前边界和不要误解的地方

### 8.1 `riskLevel = low` 不等于可自动删除

当前仍然只是 preview。  
`low` 只表示：

> 这个 candidate 的风险解释更清晰，更接近人工 review 阶段。

### 8.2 `plannedAction = compact_map_entry` 不等于马上改 map

当前系统不会改 `blockVersionMap`。  
它只是告诉你：

> 如果未来做 tombstone compaction，这一项是合理起点。

### 8.3 `requiredChecks` 不是历史记录，而是执行前建议

它不是“已经验证过了什么”，而是：

> 还应该验证什么。

### 8.4 这次增强没有改数据库结构

目前没有新增 `gc_run_candidates` 列，也没有改 migration。  
解释层是运行时投影出来的，事实层仍然落在 `reasonDetail` 里。

## 9. 后端实现落点

如果后续继续推进，主要看这几个文件：

- [src/modules/gc/gc-policy.service.ts](/E:/workspace/yuweb/.worktrees/gc-preview-risk-explain/back/server/src/modules/gc/gc-policy.service.ts:1)
- [src/modules/gc/block-version-gc.collector.ts](/E:/workspace/yuweb/.worktrees/gc-preview-risk-explain/back/server/src/modules/gc/block-version-gc.collector.ts:1)
- [src/modules/gc/gc-run.service.ts](/E:/workspace/yuweb/.worktrees/gc-preview-risk-explain/back/server/src/modules/gc/gc-run.service.ts:1)
- [src/modules/gc/gc.types.ts](/E:/workspace/yuweb/.worktrees/gc-preview-risk-explain/back/server/src/modules/gc/gc.types.ts:1)

可以粗略理解成：

- `GcPolicyService`：风险解释规则中心
- `BlockVersionGcCollector`：候选识别和事实生成
- `GcRunService`：run 持久化和调试接口投影
- `gc.types.ts`：字段契约

## 10. 一句话总结

现在的后端 GC 已经不是“只会给一个 `medium / low` 标签”的预览系统了，而是：

> 能识别候选、解释原因、给出预期动作、列出执行前检查，并且保持接口向后兼容的 GC 预览与诊断系统。
