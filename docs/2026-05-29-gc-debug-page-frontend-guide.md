# GC 调试页前端改版说明

> 日期：2026-05-29  
> 适用范围：块版本 GC 调试页  
> 目标：让前端根据新的后端判定模型重构调试页面

## 1. 这次改了什么

后端这次已经把 GC 调试结果收敛成了更直接的判定模型，前端不需要再把重点放在旧的风险评分上。

现在 candidate 的主展示字段应该是：

- `decision`
- `candidateClass`
- `decisionReasons`
- `reasonDetail`

兼容保留但不建议再作为主展示字段的是：

- `riskAssessment`
- `plannedAction`
- `requiredChecks`
- `readiness`
- `riskLevel`

另外新增了“本轮扫描过哪些块”的分页接口，适合做对账和排查。

## 2. 页面建议结构

建议把 GC 调试页拆成 4 个区块：

1. 健康检查
2. 最近运行
3. 当前 run 详情
4. 候选块 / 扫描块分页列表

### 2.1 健康检查

接口：

```http
GET /admin/gc/block-versions/health?workspaceId=ws_1&docId=doc_1
```

建议展示：

- `status`
- `missingRevisionSnapshots`
- `missingPublishedSnapshots`
- `missingRootBlockVersions`
- `samples`

### 2.2 创建 preview run

接口：

```http
POST /admin/gc/block-versions/runs
```

请求体：

```json
{
  "workspaceId": "ws_1",
  "docId": "doc_1",
  "includeCandidates": true
}
```

建议：

- 默认勾选 `includeCandidates`
- 触发后刷新 run 列表和当前 run 详情

### 2.3 最近运行

接口：

```http
GET /admin/gc/block-versions/runs?page=1&pageSize=20
```

建议展示列：

- `runId`
- `status`
- `summary.candidateBlockVersions`
- `summary.blocksScanned`
- `startedAt`

### 2.4 当前 run 详情

接口：

```http
GET /admin/gc/block-versions/runs/:runId
```

建议展示：

- `scope`
- `policySnapshot`
- `health`
- `summary`
- `candidateDetailsStored`
- `candidateDetailsTruncated`

## 3. Candidate 列表怎么改

接口：

```http
GET /admin/gc/block-versions/runs/:runId/candidates?page=1&pageSize=20
```

### 3.1 主展示字段

建议 candidate 列表主要显示这些字段：

- `resourceKey`
- `candidateClass`
- `decisionReasons`
- `reasonDetail.rootKind`
- `reasonDetail.ageMs`
- `reasonDetail.ageBucket`
- `reasonDetail.source`
- `reasonDetail.distanceFromLatestVer`

### 3.2 新字段含义

#### `decision`

当前候选项基本都会是 `candidate`。  
它只是告诉你“这条记录已经进入候选态”。

#### `candidateClass`

当前主要有两个值：

- `unreferenced_block_version`
- `deleted_tombstone_map_entry`

这个字段比旧 `riskLevel` 更适合作为列表主标签。

#### `decisionReasons`

这是直接给人看的原因文案，建议直接渲染成 tag 或 tooltip。

### 3.3 旧字段怎么处理

旧字段仍然存在，但建议只做兼容兜底，不再作为页面主逻辑：

- `riskLevel`
- `riskAssessment`
- `plannedAction`
- `requiredChecks`
- `readiness`

如果前端已经接入过上一版增强，请把它们降级为辅助信息，不要继续围着它们渲染。

## 4. 扫描块分页怎么接

新增接口：

```http
GET /admin/gc/block-versions/runs/:runId/scanned-blocks?page=1&pageSize=20
```

这个接口返回的是“这一轮扫描过哪些块”的聚合信息，不是每个 block_version 的明细。

### 4.1 推荐展示列

- `blockId`
- `docId`
- `workspaceId`
- `latestVer`
- `scannedVersionCount`
- `oldestVersionCreatedAt`
- `newestVersionCreatedAt`

### 4.2 适合的用途

- 对账编辑次数
- 解释为什么这一轮 candidate 突然变多
- 排查某个文档或块为什么总是被扫到
- 给调试页补一个“本轮扫描范围”视图

## 5. 推荐交互流程

建议页面按这个顺序拉取：

1. 调 `/health`
2. 调 `/runs`
3. 选择一个 `runId`
4. 调 `/runs/:runId`
5. 如果 `candidateDetailsStored === true`，调 `/runs/:runId/candidates`
6. 再调 `/runs/:runId/scanned-blocks`

## 6. 现在的语义怎么理解

### 6.1 `keepLatestPerBlock`

它只表示：

> 对未命中 root 的版本，额外保留每个 `blockId` 最近 N 个版本。

`0` 表示关闭这层额外保留。  
`blocks.latestVer` 是独立保护，不受这个参数影响。

### 6.2 tombstone 候选

`deleted_tombstone_map_entry` 不是“这个块会被立即删掉”，而是：

> 这个 tombstone 引用已经足够老了，后面可以进入 map compaction 的正式流程。

## 7. 前端建议

### 7.1 候选列表

建议直接做三列核心信息：

- `Version`
- `Candidate Class`
- `Decision Reasons`

再加两列辅助信息：

- `Root Kind`
- `Age`

### 7.2 详情抽屉

建议详情抽屉分成四块：

1. 基本信息
2. 判定原因
3. 兼容字段
4. 扫描范围

### 7.3 不建议继续主用的字段

下面这些字段现在已经不是主语义了：

- `riskAssessment.score`
- `plannedAction`
- `requiredChecks`
- `readiness`

它们可以保留在详情里做兼容显示，但不要再作为页面核心逻辑。

## 8. 一句话结论

这次 GC 调试页的核心变化是：

> 从“看风险分”改成“看判定结果、判定原因和扫描范围”。
