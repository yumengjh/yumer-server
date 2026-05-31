# Block Version GC 真清扫设计

<!-- cspell:words explainability freelist autovacuum -->

> 状态：proposal
> 日期：2026-05-31
> 仓库：`E:\workspace\yuweb\back\server`

## 1. 当前现实

当前 GC 模块已经具备三件事：

1. `preview run` 审计：`gc_runs`
2. `candidate` 明细落库：`gc_run_candidates`
3. tombstone root / live root / unreferenced old version 的区分

但它还没有真正执行任何清理：

- `src/modules/gc/gc.controller.ts` 只有 preview / list / health
- `src/modules/gc/gc-run.service.ts` 只写 preview run
- `src/modules/gc/block-version-gc.collector.ts` 只产出候选，不做源表 mutation
- `src/modules/gc/gc-policy.service.ts` 只有 explainability，没有 execution gate

所以现在的系统更准确地说是“GC 观测器”，不是“GC 执行器”。

## 2. 设计目标

真正的 GC 清扫需要同时解决四个问题：

1. 候选不是一次 preview 看见就能删，必须能跨 run 追踪稳定性。
2. sweep 必须和 preview 解耦，不能直接拿某次旧 preview 结果做删除。
3. tombstone map compaction 和 block_version physical delete 风险不同，不能走同一条激进路径。
4. SQLite 和 Postgres 的“逻辑删除完成”与“磁盘空间回收完成”不是一回事。

## 3. 结论先行

### 3.1 是否需要再加一个表

需要。

最小可行方案是新增一张 `gc_candidate_pool`。

原因很直接：`gc_run_candidates` 是“某次 preview 的快照”，不是“候选的当前生命状态”。如果没有一张跨 run 去重、可更新的池子，就做不了：

- 二次生命筛选
- oldest-first 调度
- 候选消失/复活跟踪
- sweep 失败重试
- sweep 前 fresh revalidation

### 3.2 是否需要二次生命筛选

需要，而且应该默认开启。

但它不该只是“候选块池子里最老的先清除”这么简单。更合理的模型是：

1. **发现阶段**：preview 发现 candidate
2. **稳定阶段**：candidate 连续多次被 preview 看到，且仍满足当前 policy
3. **执行阶段**：只从稳定候选里 oldest-first 选批次 sweep

也就是说，“最老优先”应该发生在“稳定候选集合”里，而不是所有 preview candidate 里。

### 3.3 TTL 是否需要可配置

需要，但要分层：

1. 全局默认 policy：用于真实 sweep
2. preview override：只允许 dry-run 调试
3. pool 内冻结的观察字段：用于解释，不作为最终执行依据

不要让 sweep 接口直接传任意 TTL。真正执行时必须服从当前系统 policy，并做 fresh revalidation。

### 3.4 是否马上做 block_versions 物理删除

不建议一步到位。

建议分两期：

1. **Phase 1**：先做 tombstone map compaction 的真执行
2. **Phase 2**：再做普通 `block_versions` 的 physical delete

原因是 Phase 1 只改 root map，风险明显低于 Phase 2；Phase 2 一旦误删，影响 diff / revert / 历史读取。

## 4. 推荐数据模型

### 4.1 保留现有两张表

- `gc_runs`：不可变 run 审计
- `gc_run_candidates`：某次 run 的候选快照

这两张表继续保留，不改职责。

### 4.2 新增 `gc_candidate_pool`

建议字段：

```text
gc_candidate_pool
├─ id
├─ candidateKey              unique, e.g. block_version:b_1@3:candidate_block_version
├─ resourceType              block_version
├─ action                    candidate_block_version | compact_map_entry
├─ source                    doc_snapshots | document_drafts | null
├─ resourceKey               b_1@3
├─ resourceRowId             block_versions.id
├─ workspaceId
├─ docId
├─ blockId
├─ blockVer
├─ firstSeenRunId
├─ lastSeenRunId
├─ firstSeenAt
├─ lastSeenAt
├─ seenCount
├─ stableSeenCount
├─ state                     pending | eligible | sweeping | swept | resurrected | blocked
├─ eligibleAfter
├─ lastSweepAt
├─ lastValidationAt
├─ reasonCode
├─ reasonDetail              json/jsonb
├─ riskLevel
├─ policySnapshot            json/jsonb
├─ lastBlockers              json/jsonb
├─ createdAt
├─ updatedAt
```

核心用途：

- `firstSeenAt` / `stableSeenCount`：支撑二次生命
- `eligibleAfter`：支撑 oldest-first 调度
- `state`：支撑幂等 sweep、失败重试、候选复活
- `policySnapshot`：保留候选进入池子时的解释上下文

### 4.3 是否还要加 sweep 表

短期可以不加，先复用 `gc_runs`。

做法：

- 把 `gc_runs.mode` 扩成 `preview | sweep`
- `gc_runs.summary` 同时容纳 sweep batch 的执行统计

如果后面需要更强的 per-item 执行审计，再补 `gc_sweep_items`。现在先不建议一开始就多加。

## 5. 二次生命筛选

### 5.1 原则

preview candidate != sweep eligible candidate

建议新增两个概念：

- `promotionDelayMs`：候选进入执行队列前的二次观察窗口
- `stableSeenThreshold`：至少连续看到几次才允许 sweep

### 5.2 推荐默认值

按动作分开：

#### `compact_map_entry`

- `stableSeenThreshold = 2`
- `promotionDelayMs = tombstoneGracePeriodMs`

这是低风险动作，可以相对快一些。

#### `candidate_block_version`

- `stableSeenThreshold = 3`
- `promotionDelayMs = max(gracePeriodMs, 24h)`

这是高风险动作，必须更保守。

### 5.3 oldest-first 的正确位置

排序不要直接按 `versionCreatedAt` 对所有候选做。

应该按下面的顺序：

1. 只选 `state = eligible`
2. `eligibleAfter ASC`
3. `firstSeenAt ASC`
4. `versionCreatedAt ASC`

这样能避免“刚过阈值但很老”的脏候选抢跑。

## 6. TTL 设计

不要只保留当前两个 TTL。

建议拆成四类：

```ts
type BlockVersionGcRuntimePolicy = {
  gracePeriodMs: number;
  tombstoneGracePeriodMs: number;
  keepLatestPerBlock: number;
  promotionDelayMs: number;
  stableSeenThreshold: number;
  maxSweepBatchSize: number;
  poolEntryExpireMs: number;
};
```

解释：

- `gracePeriodMs`：普通不可达旧版本最早何时能进 preview candidate
- `tombstoneGracePeriodMs`：tombstone root 最早何时能进 compaction candidate
- `promotionDelayMs`：进入真正 sweep 队列前再等多久
- `stableSeenThreshold`：至少稳定出现几次
- `poolEntryExpireMs`：候选长期不再出现时何时从池子过期

### 6.1 配置来源建议

建议接入 runtime config，而不是长期硬编码在 `GcPolicyService`。

原因：

- 这个仓库已经有 runtime config 模式
- GC policy 明显属于运行期运维策略
- SQLite / Postgres 可能需要不同默认值

但要限制：

- preview 接口可以允许临时 override 做调试
- sweep 接口不允许随请求覆盖真实 policy

## 7. 真 sweep 的动作边界

### 7.1 Phase 1：`compact_map_entry`

建议先只做这类动作，但要继续细分 source：

1. `document_drafts` tombstone compaction
2. `doc_snapshots` tombstone compaction

这两个来源不应该共享同一风险等级。

#### 对 `document_drafts`

可执行，但 sweep 时必须补做：

- 重新读取 draft 当前 `blockVersionMap`
- 确认 map 仍然指向同一个 tombstone version
- 删除 map entry 后重新计算 `changedBlocksCount`
- 写回 `updatedAt` / `updatedBy`

`changedBlocksCount` 是真实业务字段，不能省。

#### 对 `doc_snapshots`

建议再保守一层：

- Phase 1A：先只允许 `kind = revision` 且 `pinned = false`
- Phase 1B：再评估 `publish` / `manual` / `pinned` snapshot

原因不是技术做不到，而是历史快照的“语义不可变性”更强。先碰 draft 和普通 revision snapshot，风险更可控。

### 7.2 Phase 2：`candidate_block_version`

只有满足以下条件才允许物理删除：

1. 最新一次 preview 中仍不可达
2. `gc_candidate_pool` 中达到稳定阈值
3. fresh health check 仍为 `ok`
4. 当前没有 snapshot / draft map 指向它
5. 不在 `keepLatestPerBlock` 保留窗口内
6. 不是 `blocks.latestVer`

真正 delete 时仍要事务内再检查一遍 root 存在性，不能信 preview 落库结果。

## 8. 接口设计

### 8.1 保留现有接口

- `POST /admin/gc/block-versions/runs`
- `GET /admin/gc/block-versions/runs`
- `GET /admin/gc/block-versions/runs/:runId`
- `GET /admin/gc/block-versions/runs/:runId/candidates`
- `GET /admin/gc/block-versions/health`

### 8.2 建议新增接口

#### 候选池

```http
GET /admin/gc/block-versions/pool?state=eligible&action=compact_map_entry&page=1&pageSize=100
```

用途：看当前真正可执行的候选，而不是只看某次 preview 快照。

#### sweep dry-run / plan

```http
POST /admin/gc/block-versions/sweeps/plan
```

请求体建议：

```json
{
  "action": "compact_map_entry",
  "source": "document_drafts",
  "workspaceId": "ws_1",
  "limit": 100
}
```

返回“这次准备 sweep 哪些候选、为什么入选、哪些被 fresh check 挡住”。

#### 真执行

```http
POST /admin/gc/block-versions/sweeps
```

请求体建议：

```json
{
  "action": "compact_map_entry",
  "source": "document_drafts",
  "workspaceId": "ws_1",
  "limit": 100,
  "dryRun": false
}
```

说明：

- 不建议直接传 candidate id 列表作为唯一入口
- 更建议“按策略选批次”，然后服务端自己做 revalidation

#### sweep run 查询

```http
GET /admin/gc/block-versions/sweeps
GET /admin/gc/block-versions/sweeps/:runId
```

如果前期复用 `gc_runs.mode=sweep`，这里只是 query projection。

#### policy 查询与更新

```http
GET /admin/gc/block-versions/policy
PATCH /admin/gc/block-versions/policy
```

建议最终落到 runtime config，而不是继续散落在 `GcPolicyService` 里。

## 9. SQLite 与 Postgres 的差异

### 9.1 逻辑清扫与文件缩小必须分开看

真实 sweep 完成，只代表：

- root map 被压缩了
- 或 block_versions 被删了

这不等于磁盘文件马上变小。

### 9.2 SQLite

SQLite 删除记录后，空闲页通常先回到 freelist；文件是否缩小取决于后续 `VACUUM` / `auto_vacuum` 策略。

所以建议：

1. **GC sweep 不内嵌 `VACUUM`**
2. 单独暴露 storage compaction / maintenance 接口
3. 只在满足阈值时手工触发

建议接口：

```http
POST /admin/gc/storage/compact
```

响应里明确区分：

- `logicalGcDone`
- `storageCompactionDone`

不要把它们混成一个成功状态。

#### SQLite 额外约束

- `VACUUM` 不要放在业务事务里
- `VACUUM` 可能阻塞写入，应做成显式维护操作
- 如果后面启用 `auto_vacuum=INCREMENTAL`，也应单独维护，不要绑在每次 sweep 后

### 9.3 Postgres

Postgres 也不是 delete 完就立刻还磁盘。

但它更适合把“逻辑 GC”和“物理存储回收”交给不同层：

- 逻辑 GC：应用层 sweep
- 空间回收：autovacuum / DBA maintenance

所以接口层建议同样把 storage compaction 独立出来，不要在 block-version sweep 中混入数据库维护语义。

## 10. 实现顺序建议

### Phase 0

- 补 `gc_candidate_pool`
- 把 preview run 与 pool 同步打通
- 加入二次生命字段和状态机

### Phase 1

- 真执行 `compact_map_entry`
- 先只开 `document_drafts`
- 再开 `doc_snapshots(kind=revision, pinned=false)`

### Phase 2

- 加 `candidate_block_version` physical delete
- 增加更强的 fresh revalidation
- 跑更严格的回归测试：diff / revert / version content / draft commit

### Phase 3

- 再讨论 pinned / published snapshot 的 tombstone compaction
- 再讨论 SQLite incremental compaction 和运维面板

## 11. 最终建议

如果现在就开始落地，我建议按下面的边界收敛：

1. **先加一张 `gc_candidate_pool`**
2. **先做二次生命筛选**
3. **先做 `document_drafts` 的 tombstone map compaction**
4. **先不做普通 block_versions 物理删除**
5. **把 SQLite 文件缩小单独做成 maintenance 能力**

这是当前仓库最保守、也最容易闭环的一条路径。

它不追求“一步删干净”，但能把 preview-only 的 GC 变成真正可执行、可审计、可回滚决策的 GC。
