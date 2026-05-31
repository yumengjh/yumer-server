# GC 调试页前端接入指南

> 目标：基于当前 GC 新接口，把前端 GC 调试页补成一个可诊断、可复核、可执行的管理工具。

## 1. 页面目标

这页不该只是“列个 preview candidates 表格”，而应该覆盖四个动作：

1. 看当前 scope 是否健康
2. 触发 preview 并查看结果
3. 观察 candidate pool 的晋升与阻断
4. 对可执行候选做 dry-run / real sweep

## 2. 推荐页面结构

推荐拆成五块：

### 2.1 Scope + Health

输入：

- `workspaceId`
- `docId`

动作：

- `检查健康`
- `创建 preview`

展示：

- `status`
- `missingRevisionSnapshots`
- `missingPublishedSnapshots`
- `missingRootBlockVersions`
- 样本列表

### 2.2 Recent Runs

数据源：

```http
GET /admin/gc/block-versions/runs
```

列表列建议：

- `runId`
- `mode`
- `status`
- `workspaceId`
- `docId`
- `triggeredBy`
- `startedAt`
- `finishedAt`

注意：

- 这里现在会混有 `preview` 和 `sweep`
- 前端不要把 run 列表写死成 preview 历史

### 2.3 Run Detail + Candidates

数据源：

- `GET /admin/gc/block-versions/runs/:runId`
- `GET /admin/gc/block-versions/runs/:runId/candidates`

详情页建议拆成三段：

1. `policySnapshot`
2. `health`
3. `summary`

如果 `candidateDetailsStored = false`，前端应明确提示“本次 run 没保存 candidates 明细”。

如果 `candidateDetailsTruncated = true`，前端应明确提示“本次 candidates 明细被截断，完整候选请去 pool 看”。

### 2.4 Candidate Pool Explorer

数据源：

```http
GET /admin/gc/block-versions/pool
```

最常用过滤：

- `state=eligible&action=compact_map_entry`
- `state=blocked`
- `state=swept`
- `action=candidate_block_version`

列表列建议：

- `candidateKey`
- `resourceKey`
- `action`
- `source`
- `state`
- `rootRefType`
- `rootRefId`
- `readiness`
- `riskAssessment.level`
- `eligibleAfter`
- `lastSweepAt`

### 2.5 Sweep Console

动作按钮建议分成两组：

- `Dry-run Draft Tombstones`
- `Run Draft Tombstones`
- `Dry-run Revision Tombstones`
- `Run Revision Tombstones`

分别对应：

- `POST /admin/gc/block-versions/sweeps/draft-tombstones`
- `POST /admin/gc/block-versions/sweeps/revision-tombstones`

## 3. 推荐调用顺序

### 3.1 页面初始化

1. 拉一次 `/runs?page=1&pageSize=20`
2. 用户填写 scope
3. 点击“检查健康”时调用 `/health`

### 3.2 用户触发 preview

1. `POST /runs`
2. 成功后刷新 `/runs`
3. 自动选中刚创建的 run
4. 拉 `/runs/:runId`
5. 如果保存了 candidates 明细，再拉 `/runs/:runId/candidates`
6. 同步刷新 `/pool`

### 3.3 用户触发 sweep

1. 先在 `/pool?state=eligible&action=compact_map_entry` 上确认候选
2. 先点 `dryRun`
3. 看 sweep run 的 `summary`
4. 再点真实执行
5. 执行后刷新：
   - `/runs`
   - `/pool`

## 4. 前端字段消费建议

### 4.1 行唯一 key

对 `compact_map_entry`，不要再用 `resourceKey` 作为唯一 key。

必须使用：

- `candidateKey`

原因：

- 同一个 `b_1@4` 现在可能同时对应多个 root-entry candidate

### 4.2 `reasonDetail` 渲染重点

前端应重点展示：

- `source`
- `rootKind`
- `rootRefType`
- `rootRefId`
- `ageBucket`
- `rootSourceCount`
- `distanceFromLatestVer`

建议展示文案：

- `source=doc_snapshots` -> `正式快照`
- `source=document_drafts` -> `草稿副本`
- `rootRefType=snapshot` -> `Snapshot`
- `rootRefType=draft` -> `Draft`

### 4.3 `riskAssessment` 渲染

列表上只展示：

- `riskAssessment.level`
- `riskAssessment.score`

详情里展开：

- `riskAssessment.reasons`
- `riskAssessment.factors`

### 4.4 `requiredChecks` 渲染

建议做 code -> 中文文案映射：

- `verify_root_stability` -> `确认 root 仍稳定`
- `verify_source_consistency` -> `确认多来源状态一致`
- `verify_policy_overlap` -> `确认未与保留策略冲突`
- `verify_no_recent_write_dependency` -> `确认无最近写入依赖`
- `verify_content_read_paths` -> `确认内容读取路径不受影响`

### 4.5 `state` 渲染

建议颜色：

- `pending` -> 中性灰
- `eligible` -> 蓝色
- `blocked` -> 红色
- `swept` -> 绿色
- `resurrected` -> 橙色

## 5. Sweep 表单建议

请求体统一支持：

```json
{
  "workspaceId": "ws_1",
  "docId": "doc_1",
  "limit": 100,
  "dryRun": true
}
```

前端表单建议：

- `workspaceId`
- `docId`
- `limit`
- `dryRun`

其中：

- `limit` 默认值建议跟后端策略一致，先给 `100`
- `dryRun` 在 UI 上应默认勾选

## 6. 页面上应该显式提示的边界

### 6.1 Health blocked 时

应禁止用户继续做 preview/sweep，并提示原因。

### 6.2 Draft / Revision sweep 的差异

前端要把两条 sweep 路径分开展示，不要混成一个通用按钮。

原因：

- 目标 source 不同
- fresh revalidation 边界不同
- 失败 blocker 也不同

### 6.3 SQLite 文件不会自动缩小

即使 sweep 成功，页面也不要展示“磁盘已回收”。

当前 sweep 只表示逻辑清理完成，不表示数据库文件立刻变小。

## 7. 最小可用版本建议

如果前端要分阶段上线，最小可用版本建议顺序：

### Phase A

- Scope 输入
- Health 面板
- Recent Runs
- Run Detail

### Phase B

- Run Candidates 表格
- Pool Explorer
- 解释字段展示

### Phase C

- Dry-run Draft Tombstones
- Dry-run Revision Tombstones

### Phase D

- Real sweep 按钮
- sweep run 审计展示

## 8. 相关后端文档

- [GC 后端使用说明](/E:/workspace/yuweb/back/server/docs/2026-05-29-gc-backend-usage-guide.md:1)
- [GC Phase 1 复盘](/E:/workspace/yuweb/back/server/docs/retrospectives/2026-05-31-gc-phase-1-draft-tombstone-sweep-retrospective.md:1)
- [GC Phase 2 复盘](/E:/workspace/yuweb/back/server/docs/retrospectives/2026-05-31-gc-phase-2-revision-snapshot-sweep-retrospective.md:1)
- [GC Phase 3 复盘](/E:/workspace/yuweb/back/server/docs/retrospectives/2026-05-31-gc-phase-3-root-entry-candidate-granularity-retrospective.md:1)
