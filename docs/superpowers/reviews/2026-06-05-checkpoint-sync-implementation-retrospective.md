# Checkpoint Sync 本地更改复盘

> 日期：2026-06-05  
> 前端仓库：`F:\yuediter`  
> 后端仓库：`F:\yumer-server`  
> 原设计稿：`docs/superpowers/specs/2026-06-05-checkpoint-sync-design.md`  
> 实施 TODO：`docs/superpowers/plans/2026-06-05-checkpoint-sync-implementation-todo.md`  
> 目标：在当前单用户编辑场景下，用“最终态 checkpoint”兜住保存前、弱网和批量同步失败导致的草稿不一致问题，同时保留未来多人协作演进空间。

## 1. 本地更改提交范围

### 1.1 前端本地更改范围

前端主分支当前已经合入本次实现。

本次前端相关本地更改范围为：

- 设计文档提交：`b9bff9bc docs(sync): design checkpoint sync`
- TODO 文档提交：`0a7c6768 docs(sync): add checkpoint implementation todo`
- 实现分支合并提交：`e31c5fa2 merge: checkpoint sync frontend`

如果只看前端实现代码，范围是：

- 从：`ec974ba1 test(sync): specify checkpoint builder`
- 到：`1390b9d7 fix(sync): type checkpoint ack attrs`
- 合并点：`e31c5fa2 merge: checkpoint sync frontend`

前端实现分支包含以下提交：

```text
ec974ba1 test(sync): specify checkpoint builder
c32943e6 feat(sync): build draft checkpoint payloads
c516d8ce test(sync): specify checkpoint api client
5003a046 feat(sync): add draft checkpoint api client
380bff5e test(sync): require checkpoint before commit
83a1b2ea feat(sync): checkpoint before manual commit
6164f764 test(sync): require checkpoint fallback after batch failures
97d28976 feat(sync): recover repeated batch failures with checkpoint
1390b9d7 fix(sync): type checkpoint ack attrs
e31c5fa2 merge: checkpoint sync frontend
```

前端合并提交变更统计：

```text
src/hooks/useDocumentSync.source.test.ts       |  25 ++++
src/hooks/useDocumentSync.ts                   | 126 ++++++++++++++++-
src/services/sync/__tests__/api.test.ts        |  44 +++++-
src/services/sync/__tests__/checkpoint.test.ts |  88 ++++++++++++
src/services/sync/api.ts                       |  27 ++++
src/services/sync/checkpoint.ts                | 189 +++++++++++++++++++++++++
6 files changed, 495 insertions(+), 4 deletions(-)
```

### 1.2 后端本地更改范围

后端主分支当前已经合入本次实现。

本次后端相关本地更改范围为：

- 从：`6960010 feat(sync): add draft checkpoint dto`
- 到：`8750bd8 feat(sync): expose draft checkpoint endpoint`
- 合并点：`0eec7ac merge: checkpoint sync backend`

后端实现分支包含以下提交：

```text
6960010 feat(sync): add draft checkpoint dto
206005e feat(sync): persist checkpoint receipts
468d2f9 test(sync): specify checkpoint service behavior
4f392d6 feat(sync): reconcile draft checkpoints transactionally
8750bd8 feat(sync): expose draft checkpoint endpoint
0eec7ac merge: checkpoint sync backend
```

后端合并提交变更统计：

```text
src/app.module.ts                                  |   2 +
src/database/migrations/1782900000000-CreateSyncCheckpointReceipts.ts  |  51 +++
src/entities/sync-checkpoint-receipt.entity.ts     |  54 +++
src/modules/documents/documents.controller.ts      |  18 +
src/modules/documents/documents.module.ts          |   8 +
src/modules/documents/draft-checkpoint.service.spec.ts     | 437 ++++++++++++++++++
src/modules/documents/draft-checkpoint.service.ts  | 510 +++++++++++++++++++++
src/modules/documents/dto/draft-checkpoint.dto.ts  | 145 ++++++
8 files changed, 1225 insertions(+)
```

## 2. 原设计稿核心目标回顾

原设计稿采用 C2.5 方向：

1. 保留现有增量同步 `/blocks/batch`。
2. 新增 authoritative final-state 通道：`POST /documents/:docId/draft-checkpoint`。
3. 当前阶段只解决单用户编辑稳定性，不直接引入 Yjs/Automerge/CRDT runtime。
4. 通过完整最终态 checkpoint，降低 create/update/delete/move 增量链路在大批量编辑、弱网、刷新关闭场景中的不确定性。
5. 接口预留多人协作扩展字段，例如 `actorId`、`documentClock`、`parentCheckpointId`、`mode`。
6. 引入协议层 `orderKey` 概念，先兼容现有 `sortKey` 落库，后续再升级 fractional indexing。

设计稿里对当前阶段的关键要求是：

- 保存前必须确保服务端 draft 等于编辑器最终态，或明确失败并阻止 commit。
- 后端 checkpoint 必须事务化写入。
- checkpoint 必须具备幂等 receipt。
- checkpoint 成功后，前端必须用服务端返回的 blockId/orderKey mappings 修补编辑器 identity。
- 当前增量同步仍然保留，用于普通小编辑。

## 3. 已经完成的内容

### 3.1 前端：Checkpoint request/response 类型与构建器

新增文件：

- `src/services/sync/checkpoint.ts`
- `src/services/sync/__tests__/checkpoint.test.ts`

实现内容：

1. 定义 `DraftCheckpointBlock`。
2. 定义 `DraftCheckpointRequest`。
3. 定义 `DraftCheckpointMapping`。
4. 定义 `BuildDraftCheckpointInput`。
5. 实现 `buildDraftCheckpoint()`。
6. 实现 `applyCheckpointAck()`。

`buildDraftCheckpoint()` 当前从 TipTap doc 的 top-level blocks 构建 full coverage checkpoint：

- `mode: "checkpoint"`
- `coverage: "full"`
- `clientCheckpointId`
- `clientId`
- `baseVersion`
- `draftRevision`
- `sessionId`
- `sessionEpoch`
- `contentHash`
- `generatedAt`
- `actorId?`
- `documentClock?`
- `parentCheckpointId?`
- `rootBlockId`
- `blocks`

每个 block 会携带：

- `clientId`
- `blockId?`
- `syncCreateId?`
- `type`
- `parentId?`
- `orderKey`
- `payload`
- `plainText?`

实现细节：

- 优先从已有 attrs 读取 `blockId`、`clientId`、`syncCreateId`、`sortKey/orderKey`。
- 如果没有稳定 clientId，则生成 `checkpoint:${clientCheckpointId}:${index}`。
- 如果没有 orderKey，则使用视觉顺序生成字符串序号。
- `payload.attrs` 会清理 transient sync attrs，避免把临时同步状态写进服务端正文。
- `contentHash` 使用 `sha256:` 前缀；浏览器环境优先用 `crypto.subtle`，不可用时使用 fallback hash。
- `applyCheckpointAck()` 会把服务端返回的 `blockId`、`orderKey/sortKey` patch 回编辑器节点 attrs，并删除 `syncCreateId`、`clientBatchId`、`data-sync-create-id` 等临时字段。

### 3.2 前端：Checkpoint API client

修改文件：

- `src/services/sync/api.ts`
- `src/services/sync/__tests__/api.test.ts`

新增：

```ts
postDraftCheckpoint(docId, request)
```

请求地址：

```text
POST /documents/:docId/draft-checkpoint
```

响应类型 `DraftCheckpointResponse` 包含：

- `acceptedCheckpointId`
- `appliedAt`
- `serverHead`
- `draftRevision`
- `needsReload`
- `conflicts`
- `contentHash`
- `mappings`
- `tombstoned`

### 3.3 前端：保存前 checkpoint barrier

修改文件：

- `src/hooks/useDocumentSync.ts`
- `src/hooks/useDocumentSync.source.test.ts`

实现内容：

1. 新增 `runDraftCheckpoint()`。
2. 在 `flushAndCommitBarrier()` 中，`commitAction()` 之前强制执行 checkpoint。
3. checkpoint 成功后才允许 commit。
4. checkpoint 失败时返回 `false`，阻止保存/提交版本。

当前保存链路顺序是：

```text
capture latest content
mark pending commit
flush("manual-save")
runDraftCheckpoint(latestContent)
commitAction()
clear pending commit
```

这对应设计稿中的“保存前 authoritative final-state 通道”。

### 3.4 前端：连续 batch 失败 fallback checkpoint

修改文件：

- `src/hooks/useDocumentSync.ts`
- `src/hooks/useDocumentSync.source.test.ts`

新增状态：

```ts
const batchFailureCountRef = useRef(0);
const MAX_BATCH_FAILURES_BEFORE_CHECKPOINT = 2;
```

行为：

- 普通 batch 成功且没有 batchFailure 时，重置失败计数。
- batch response 中存在失败摘要时，失败计数 +1。
- `postSyncBatch()` 网络/接口异常 catch 后，失败计数 +1。
- 连续失败达到阈值后，执行：

```ts
await runDraftCheckpoint(latestContentRef.current)
```

- checkpoint recovery 成功后，失败计数归零。

这完成了设计稿 Phase 5 中“连续 batch 失败 fallback”的部分。

### 3.5 后端：DraftCheckpoint DTO

新增文件：

- `src/modules/documents/dto/draft-checkpoint.dto.ts`

实现内容：

- `DraftCheckpointBlockDto`
- `DraftCheckpointDto`
- `DraftCheckpointResponseDto`

DTO 覆盖设计稿中的核心字段：

- `mode`
- `coverage`
- `clientCheckpointId`
- `clientId`
- `baseVersion`
- `draftRevision`
- `sessionId`
- `sessionEpoch`
- `contentHash`
- `generatedAt`
- `actorId?`
- `documentClock?`
- `parentCheckpointId?`
- `rootBlockId`
- `blocks`

### 3.6 后端：Checkpoint receipt 与迁移

新增文件：

- `src/entities/sync-checkpoint-receipt.entity.ts`
- `src/database/migrations/1782900000000-CreateSyncCheckpointReceipts.ts`

修改文件：

- `src/app.module.ts`

新增表：

```text
sync_checkpoint_receipts
```

核心字段：

- `docId`
- `clientCheckpointId`
- `requestFingerprint`
- `acceptedCheckpointId`
- `appliedAt`
- `serverHead`
- `draftRevision`
- `needsReload`
- `conflicts`
- `contentHash`
- `mappings`
- `tombstoned`
- `createdBy`
- `createdAt`
- `updatedAt`

语义：

- 同一个 `docId + clientCheckpointId` 且 request fingerprint 一致时，返回已保存 response。
- 同一个 `docId + clientCheckpointId` 但 fingerprint 不一致时，返回 conflict。
- 避免“请求成功但响应丢失后重试造成重复写”。

### 3.7 后端：事务型 checkpoint reconcile service

新增文件：

- `src/modules/documents/draft-checkpoint.service.ts`
- `src/modules/documents/draft-checkpoint.service.spec.ts`

核心入口：

```ts
DraftCheckpointService.applyDraftCheckpoint(docId, userId, dto)
```

服务内部通过 `DataSource.transaction()` 包裹，事务内执行：

1. 标准化 `clientCheckpointId`。
2. 构建 request fingerprint。
3. 查询 existing receipt。
4. 校验 mode/coverage。
5. 校验文档存在性。
6. 校验 `baseVersion`。
7. 校验 `draftRevision`。
8. 校验 sync session：`sessionId/sessionEpoch/leaseExpiresAt`。
9. 加载当前 draft 可见 block。
10. 根据 `blockId`、`syncCreateId`、`clientId` 尝试匹配既有 block。
11. checkpoint 中存在的 block：create 或 update/move。
12. checkpoint 中缺失但当前 draft 可见的 block：标记 deleted。
13. 对删除项写 tombstone，防止 late create 回流。
14. 更新 `DocDraft.blockVersionMap`。
15. 递增 `Document.draftRevision`。
16. 保存 checkpoint receipt。
17. 返回 response。

后端单元测试覆盖了：

- 新建 block。
- 更新既有 block。
- reorder。
- 删除 checkpoint 中缺失 block。
- tombstone。
- receipt replay 幂等。
- fingerprint conflict。
- draftRevision mismatch。
- session mismatch。

### 3.8 后端：Controller endpoint

修改文件：

- `src/modules/documents/documents.controller.ts`
- `src/modules/documents/documents.module.ts`

新增接口：

```text
POST /documents/:docId/draft-checkpoint
```

controller 调用：

```ts
this.draftCheckpointService.applyDraftCheckpoint(docId, user.userId, checkpointDto)
```

module 中注册：

- `DraftCheckpointService`
- `SyncCheckpointReceipt`
- `DocumentSyncSession`
- `SyncCreateTombstone`

## 4. 当前状态

### 4.1 已合并状态

当前已经合入主分支：

- 前端 main：`e31c5fa2 merge: checkpoint sync frontend`
- 后端 main：`0eec7ac merge: checkpoint sync backend`

临时 feature 分支已删除：

- `feature/checkpoint-sync-front`
- `feature/checkpoint-sync-back`

后端临时 worktree 已清理。

前端临时 worktree 目录 `F:\yuediter\.worktrees\checkpoint-sync-front` 在清理时还残留一个 Next SWC 原生模块文件被 Windows 文件锁占用；该目录已不再是 Git 注册 worktree。等停止相关 node/Next 进程后可以删除。

### 4.2 验证状态

合并到 main 后已执行验证。

前端验证命令：

```powershell
pnpm vitest run src/services/sync/__tests__/checkpoint.test.ts src/hooks/useDocumentSync.source.test.ts src/services/sync/__tests__/api.test.ts src/services/sync/__tests__/engine-order.test.ts
pnpm build
```

结果：

- 4 个 test files passed。
- 28 个 tests passed。
- Next build 通过。
- TypeScript 通过。

后端验证命令：

```powershell
pnpm jest src/modules/documents/draft-checkpoint.service.spec.ts src/modules/blocks/blocks-sync-idempotency.spec.ts --runInBand
pnpm build
```

结果：

- 2 个 test suites passed。
- 26 个 tests passed。
- Nest build 通过。
- TSC 0 issues。

### 4.3 当前主分支仍存在的非本次实现未跟踪文件

前端：

```text
?? docs/2026-06-05-frontend-sync-stability-analysis.md
```

后端：

```text
?? analyse.txt
?? docs/session/sync-stability-analysis-and-optimization.md
```

这些文件是合并前已经存在或用户侧分析文件，本次实现未纳入处理。

## 5. 和原设计稿相比：已完成 / 未完成 / 偏差

### 5.1 已完成

| 设计项 | 当前状态 |
| --- | --- |
| 新增 `POST /documents/:docId/draft-checkpoint` | 已完成 |
| 前端 `buildDraftCheckpoint()` | 已完成 |
| 前端 `postDraftCheckpoint()` | 已完成 |
| 前端 `applyCheckpointAck()` | 已完成 |
| 后端 DTO | 已完成 |
| 后端 checkpoint receipt | 已完成 |
| 后端事务型 reconcile | 已完成 |
| 保存前 checkpoint barrier | 已完成 |
| 连续 batch 失败 fallback | 已完成 |
| session 校验 | 已完成 |
| draftRevision mismatch conflict | 已完成 |
| fingerprint conflict | 已完成 |
| tombstone 抑制 late create | 已完成 |
| 保留 actor/clock/parentCheckpointId | 已完成 |
| 增量同步 `/blocks/batch` 保留 | 已完成 |

### 5.2 部分完成

| 设计项 | 当前状态 | 说明 |
| --- | --- | --- |
| `orderKey` | 部分完成 | 协议层已使用 `orderKey`，但落库仍写现有 `sortKey`。 |
| 高风险自动 checkpoint | 部分完成 | 已做连续 batch 失败 fallback；大 diff 阈值、全量替换迹象尚未做。 |
| checkpoint 状态机 | 部分完成 | 目前复用现有 `syncState`，没有独立 `CheckpointState`。 |
| 刷新后最终态一致 | 部分完成 | 保存前和失败 fallback 可保障；未做 beforeunload/sendBeacon。 |

### 5.3 尚未完成

| 设计项 | 状态 |
| --- | --- |
| 大 diff 阈值触发 checkpoint | 未完成 |
| 全量替换迹象触发 checkpoint | 未完成 |
| 刷新/关闭前 checkpoint 或 beforeunload 提醒 | 未完成 |
| sortKey/orderKey corruption fallback | 未完成 |
| fractional indexing orderKey 算法 | 未完成 |
| orderKey 存储迁移 | 未完成 |
| E2E 测试：paste 200 -> delete all -> paste 150 -> reload | 未完成 |
| E2E 测试：弱网 partial batch success -> checkpoint retry -> reload | 未完成 |
| E2E 测试：manual save during inflight -> reload | 未完成 |
| 多人协作 merge / CRDT / oplog | 按设计暂不做 |

### 5.4 主要偏差与原因

1. **没有实现大 diff 阈值触发**
   - 原设计稿建议初期实现“手动保存前 + 批量变化阈值 + batch 连续失败后”。
   - 当前实际完成了“手动保存前 + batch 连续失败后”。
   - 大 diff 阈值需要更深入介入 snapshot diff/capture 流程，避免误判导致频繁全量 checkpoint，因此暂未做。

2. **没有独立 CheckpointState**
   - 原设计稿建议新增 checkpoint 状态，不继续挤压 batch reducer。
   - 当前为了降低侵入性，先复用 `syncState` 的 `idle/error/conflicted` 等状态。
   - 后续如果 checkpoint retry、beforeunload、后台恢复增多，应补独立状态机。

3. **orderKey 只是协议层落地**
   - 当前 response/request 使用 `orderKey`。
   - 但实体层仍兼容写入 `BlockVersion.sortKey`。
   - fractional indexing 和存储迁移仍是后续 Phase 6。

4. **没有真实 E2E 验证**
   - 当前完成的是单元测试与 build 验证。
   - “刷新后服务端内容等于最终态”最好还需要浏览器或集成测试验证。

## 6. 关键实现细节

### 6.1 为什么 checkpoint 成功后要清空前端 dirty/inflight

checkpoint 的语义是 authoritative final-state。成功后服务端 draft 已经被调整为当前编辑器最终态，因此旧的 dirty queue/inflight batch 已经不再能继续作为事实源。

当前前端在 checkpoint 成功后更新 reducer state：

- `baseVersion = response.serverHead`
- `draftRevision = response.draftRevision`
- `entries = {}`
- `dirtyOrder = []`
- `inflightBatchId = null`
- `inflightEntryIds = []`
- `inflightEntryRevisions = {}`
- `syncState = "idle"`
- `lastError = null`

这样做的目的是让 checkpoint 之后的后续编辑从新的服务端 head/draftRevision 开始，不再被旧 batch 状态拖回。

### 6.2 为什么 checkpoint ACK 要 patch editor identity

大量粘贴新块时，前端可能只有 client identity，没有服务端 blockId。checkpoint 后服务端会创建或匹配 block，并返回 mappings。

如果不 patch editor identity：

- 后续 update/delete 可能仍然拿不到稳定 blockId。
- late batch ACK 可能继续根据旧 clientId 干扰当前内容。
- 刷新前后的 identity 关系不稳定。

因此 `applyCheckpointAck()` 会把：

- `blockId`
- `data-block-id`
- `sortKey`
- `data-sort-key`

写回节点 attrs，并移除 transient identity。

### 6.3 为什么后端要做 receipt

弱网场景下最危险的是：

```text
客户端发送 checkpoint
服务端成功写入
响应丢失
客户端重试同一个 checkpoint
```

如果没有 receipt，重试可能导致：

- draftRevision 重复递增。
- blockVersion 重复追加。
- tombstone 重复写。
- 返回 mappings 不一致。

receipt 解决方式：

- 同一个 `docId + clientCheckpointId + requestFingerprint`：返回第一次 response。
- 同一个 `docId + clientCheckpointId` 但 fingerprint 不同：返回 conflict。

### 6.4 为什么后端同时按 blockId / syncCreateId / clientId 匹配

不同阶段的块 identity 可能不同：

1. 已有服务端块：有 `blockId`。
2. 刚 create 但 ACK 未回来：可能只有 `syncCreateId`。
3. 前端临时块：可能只有 `clientId`。

checkpoint 是最终态通道，因此不能只依赖 blockId。否则 create inflight 后删除/重贴等场景会非常容易产生残留块。

当前后端 reconcile 会尽量通过这些 identity 命中既有 block，命中则 update/move，未命中则 create。

### 6.5 为什么缺失块按删除处理

当前 checkpoint 请求声明：

```text
coverage: "full"
```

它表示请求中的 blocks 是当前 top-level draft 的完整最终态。因此当前 draft 中存在、但 checkpoint 中不存在的可见 block，应视为用户最终态删除。

注意：这个语义只适合 full coverage。未来如果做局部加载或分页编辑，必须引入 `coverage: "partial"`，否则会误删未加载区域。

### 6.6 当前实现对多人协作的保留点

当前没有做多人 merge，但保留了以下接口/数据模型扩展点：

- `actorId`
- `documentClock`
- `parentCheckpointId`
- `mode`
- checkpoint receipt
- server draftRevision
- contentHash

未来可以在同一路由族或邻近路由中扩展：

```ts
mode: "checkpoint" | "oplog" | "crdt-update"
```

当前 checkpoint 可作为未来协作系统的 compacted snapshot 层。

## 7. 风险与注意事项

### 7.1 权限校验需要再次审视

设计稿流程第一步是“校验文档访问权限和编辑权限”。当前 controller 使用现有鉴权上下文拿到 `user.userId`，service 内部执行文档/session 校验，但权限校验是否完全等同于现有提交草稿链路，需要后续对照项目现有权限模型再审一次。

建议后续验收时重点确认：

- 用户是否只能 checkpoint 自己有编辑权限的 doc。
- workspace 成员权限是否正确。
- 文档所有者/协作者权限是否正确。

### 7.2 beforeunload 尚未兜底

当前已经解决“手动保存前”的强一致问题，但用户直接关闭页面、刷新页面时，如果还有 dirty/inflight/error，尚未实现 sendBeacon/checkpoint 或 beforeunload 提醒。

短期建议：

- 至少在 dirty/inflight/error 时提示用户不要关闭。
- 后续再尝试轻量 checkpoint beacon。

### 7.3 大文档 payload 压力

checkpoint 是 full coverage，文档很大时 payload 会变大。

当前触发条件较保守：

- 手动保存前。
- 连续 batch 失败后。

后续如果加大 diff 阈值自动 checkpoint，需要加节流、压缩或 payload 大小监控。

### 7.4 旧 batch ACK 与 checkpoint 交错

当前 checkpoint 成功后会清空前端 dirty/inflight 状态，并更新 draftRevision/baseVersion。理论上旧 batch 基于旧 draftRevision 应被服务端拒绝或被前端状态消化。

但真实弱网里仍建议做 E2E 验证：

- create inflight。
- delete all。
- checkpoint 成功。
- 旧 create ACK 晚到。
- reload 后无旧块残留。

### 7.5 orderKey 仍未解决根问题

协议层已经引入 `orderKey`，但实际排序仍主要兼容原 `sortKey`。

如果后续继续出现 sortKey gap 耗尽、重复、超过上限，需要推进 Phase 6：

- fractional indexing。
- 前后端共享算法或服务端 canonical。
- 可选新增数据库 `orderKey` 列。

## 8. 建议后续 TODO

优先级建议：

### P0：人工验收场景

1. 打开编辑器。
2. 粘贴大量块。
3. 全选删除。
4. 再粘贴新内容。
5. 手动保存。
6. 刷新。
7. 确认服务端 draft 与编辑器最终态一致。

### P0：权限校验复核

对照现有提交草稿/编辑接口，确认 checkpoint endpoint 的权限模型完全一致。

### P1：beforeunload 提醒

当存在 dirty/inflight/error/checkpoint-needed 时，刷新或关闭页面前提示用户。

### P1：大 diff 阈值 checkpoint

在 snapshot diff 或 sync enqueue 阶段检测：

- create/delete/move 总量超过阈值。
- 短时间内大量 delete + create。

触发 checkpoint-needed 或直接 checkpoint。

### P1：E2E 测试

增加真实链路测试：

- paste 200 -> delete all -> paste 150 -> save -> reload。
- partial batch success -> network fail -> checkpoint retry -> reload。
- manual save during autosync inflight -> reload。

### P2：独立 checkpoint 状态机

避免 checkpoint retry、error、checkpoint-needed 等状态继续塞进 batch reducer。

### P2：fractional orderKey

实现真正不依赖整数间距的 orderKey。

## 9. 结论

本次更改已经完成原设计稿的核心主干：

- 建立了 authoritative final-state checkpoint 通道。
- 实现了后端事务型 reconcile。
- 实现了 checkpoint receipt 幂等。
- 前端保存前会强制 checkpoint。
- 前端连续 batch 失败会 fallback checkpoint。
- checkpoint 成功后会 patch editor identity 并清空旧 dirty/inflight 状态。

因此，当前成果可以视为：

```text
Checkpoint Sync Phase 1-4 完成，Phase 5 部分完成，Phase 6 未开始。
```

它已经能用于验证“单用户保存前最终态一致性”这个核心问题，但还不是完整的多人协作方案，也还没有覆盖所有高风险自动触发和刷新关闭兜底场景。
