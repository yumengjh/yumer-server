# 内容同步链路当前状态与下一步计划

> 日期：2026-06-05  
> 前端仓库：`E:\workspace\editor-demo\app`  
> 后端仓库：`E:\workspace\yumer-server`  
> 目标：内容同步链路向 99.99% 稳定推进，核心要求是不丢数据、不乱数据、不请求风暴。

## 1. 当前结论

当前前后端内容同步链路已经从“容易在弱网、全选删除、create/delete 交错时失控”的状态，推进到具备以下保护的同步模型：

1. 单文档活跃 sync session。
2. `baseVersion + draftRevision` 写入线性化校验。
3. `clientBatchId` batch 幂等回执。
4. create 使用 `clientId + syncCreateId` 稳定身份。
5. delete 支持 `blockId` 删除，也支持未回填 blockId 的 create tombstone 删除。
6. late create 通过 `sync_create_tombstones` 抑制回流。
7. 前端 delete ack 与 create ack 已隔离，避免删除确认被错误纳入 create 映射。
8. 前端 idle 后增加最终态 manifest reconcile，服务端可按最终可见状态补 tombstone。
9. 前端 idle reconcile 有运行锁和 manifest key 去重，避免空闲请求风暴。

但当前仍不能宣称已经达到 99.99% 稳定。原因是还缺少弱网端到端压测、服务端 reconcile receipt 幂等、线上指标、异常恢复体验、多标签页策略和更强 manifest coverage 证明。

## 2. 已完成工作

### 2.1 前端已完成

相关提交：

- `32a2cde fix(sync): reconcile idle manifest`
- `9427c5d fix(sync): separate delete acks from create acks`
- `41ec7a5 fix(sync): stop repeated delete retries`
- `f2d2252 fix(sync): clear delete tombstone acks`
- `db61f2f fix(sync): stabilize weak-network large document recovery`
- `12660f2 fix(sync): send delete tombstones for pending creates`

已经完成的能力：

1. `useDocumentSync` 维护同步状态：
   - `baseVersion`
   - `draftRevision`
   - `sessionId`
   - `sessionEpoch`
   - `lastAckedOpSeq`
   - `entries`
   - `dirtyOrder`
   - `inflightBatchId`
   - `inflightEntryIds`
   - `syncState`

2. 前端同步主通道统一走 `postSyncBatch()`：
   - 路径：`POST /blocks/batch`
   - 默认 `createVersion: false`
   - 也就是 autosync 写入服务端 draft，而不是立即提交正式版本。

3. 前端批次 payload 已携带关键线性化字段：
   - `baseVersion`
   - `draftRevision`
   - `clientBatchId`
   - `sessionId`
   - `sessionEpoch`
   - `ackedThroughOpSeq`

4. create 操作携带稳定身份：
   - `clientId`
   - `syncCreateId`
   - payload attrs 中保留 `clientId`
   - 不再依赖不稳定的临时 batch 身份作为唯一 create 识别来源。

5. delete 操作支持两类路径：
   - 已有 `blockId`：按服务端块删除。
   - 尚未 ack create 的临时块：按 `clientId/syncCreateId` 发送 delete tombstone。

6. create ack 与 delete ack 已隔离：
   - 只有 `result.operation === "create"` 才进入 `createMappings`。
   - delete ack 不再触发 `collectOrphanedCreateDeletes()`。
   - delete ack 不再通过 `applyServerAck()` 把已删除块补回编辑器快照。

7. idle manifest reconcile 已接入：
   - 当 `dirtyOrder.length === 0` 且无 inflight batch 时，前端构造当前编辑器 top-level manifest。
   - manifest 只包含 `blockId/clientId/syncCreateId`。
   - 调用 `POST /documents/:docId/sync-reconcile`。
   - 响应中的 `draftRevision` 会写回前端同步状态。

8. idle reconcile 防重入和去重已接入：
   - `reconcileRunningRef` 防止并发 reconcile。
   - `lastReconciledManifestKeyRef` 防止同一个 final state 反复请求。
   - key 包含 `docId/baseVersion/draftRevision/sessionId/sessionEpoch/manifest`。

9. 前端 trace 已覆盖关键点：
   - `snapshot:advance`
   - `queue:before-select`
   - `flush:dispatch`
   - `flush:response`
   - `orphaned-create:delete-enqueued`
   - `ack:patch`
   - `idle:manifest`
   - `manifest:reconcile`
   - `manifest:reconcile-response`

### 2.2 后端已完成

相关提交：

- `1b41fd0 fix(sync): add manifest reconcile endpoint`
- `e50c125 fix(sync): echo client ids for delete acks`
- `a0e655d fix(sync): suppress late creates with tombstones`
- `de1a20b fix(sync): support tombstone deletes by client identity`
- `423dba5 feat(sync): harden document sync protocol`
- `254a0b8 fix(documents): 提交草稿时返回修订号`
- `b631050 fix(sync): 增加草稿修订号并阻断旧写入`

已经完成的能力：

1. `Document.draftRevision` 已作为 draft 写入线性化版本号。

2. `DocumentSyncSession` 已作为单活跃编辑会话基础：
   - `sessionId`
   - `sessionEpoch`
   - `holderUserId`
   - `leaseExpiresAt`
   - `lastAckedOpSeq`

3. `POST /blocks/batch` 已收紧协议：
   - 要求 `baseVersion`
   - draft 写入校验 `draftRevision`
   - 校验当前 sync session
   - 续租 session
   - 成功后可推进 `lastAckedOpSeq`
   - 通过 `clientBatchId` 保存和回放 batch response

4. batch 幂等已具备请求指纹保护：
   - 同一 `docId + clientBatchId` 重放相同请求，返回原始 response。
   - 同一 `clientBatchId` 但请求内容不同，返回冲突。

5. create 幂等支持：
   - 优先按 `syncCreateId` 查找已有 create。
   - 兼容按 `clientBatchId + clientId` 查找旧 create。

6. delete 支持按客户端身份删除：
   - 如果 delete 没有 `blockId`，可以通过 `clientId/syncCreateId` 找 active block。
   - delete ack 会 echo `clientId`，前端可清理 tombstone。

7. late create 抑制：
   - delete 未 ack create 时，后端写 `sync_create_tombstones`。
   - 后续 create 如果命中 tombstone，返回 suppressed/tombstoned，避免已删除块重新出现。

8. 新增最终态 manifest reconcile：
   - DTO：`SyncReconcileDto`
   - 路径：`POST /documents/:docId/sync-reconcile`
   - 校验访问权限、编辑权限、sync session。
   - 在文档 draft 锁内比较 `draftRevision`。
   - 若 `draftRevision` 不匹配，返回 `needsReload: true`，不写入。
   - 遍历 draft 中带同步身份、但不在 manifest 中的块。
   - 追加 `attrs.deleted = true` 的新 `BlockVersion`。
   - 更新 `Block.latestVer`。
   - 更新 `DocDraft.blockVersionMap` 指向删除版本。
   - 同时写 `sync_create_tombstones`，防止旧 create 回流。

## 3. 当前同步链路原理

### 3.1 真相源分层

当前链路的事实源按优先级分层：

1. 服务端正式版本：
   - `Document.head`
   - `DocRevision`
   - `DocSnapshot`
   - 代表已经提交的可追溯版本。

2. 服务端 draft：
   - `DocDraft.blockVersionMap`
   - `Document.draftRevision`
   - 代表编辑中的远端事实源。

3. 服务端 sync session：
   - `DocumentSyncSession`
   - 代表当前谁持有编辑租约，以及服务端确认到哪个操作序号。

4. 前端同步状态：
   - `SyncReducerState`
   - 代表本地待同步、同步中、已确认、冲突/错误状态。

5. 编辑器当前内容：
   - TipTap JSON
   - 是用户看到和编辑的视图，也是前端生成增量和最终态 manifest 的来源。

### 3.2 打开文档流程

编辑页加载时：

1. 前端请求文档 edit content。
2. 后端读取 head 或 draft 内容。
3. 后端 acquire 或 renew sync session。
4. 后端返回：
   - document content
   - `baseVersion`
   - `draftRevision`
   - `rootBlockId`
   - `syncSession`
5. 前端调用 `createInitialSyncState()` 初始化 reducer：
   - 设置 `baseVersion`
   - 设置 `draftRevision`
   - 设置 `sessionId/sessionEpoch`
   - 设置初始快照 `snapshotRef`

### 3.3 本地编辑到 dirty queue

用户编辑后：

1. `captureContentSnapshot()` 比较上一次快照和当前 TipTap doc。
2. `advanceSyncSnapshot()` 生成或更新 `SyncEntry`。
3. `enqueueChange()` 写入 reducer：
   - 按 `clientId` 合并同一块上的连续变化。
   - create 后 update 可合并为 create payload。
   - update 后 delete 可压缩成 delete。
   - create 未 inflight 又立即 delete，可直接从本地 entries 移除。
   - create inflight 后 delete，会保留 delete tombstone，等待服务端 ack。
4. `dirtyOrder` 记录需要 flush 的 entry 顺序。

### 3.4 autosync flush 流程

autosync 或手动保存屏障触发 `flush()`：

1. 若已经有 `flushRunningRef`，直接返回。
2. 若 `inflightBatchId` 存在，直接返回。
3. 若 `dirtyOrder` 为空：
   - 记录 `idle:manifest`。
   - 尝试 `reconcileIdleManifest()`。
   - 返回。
4. 若存在 dirty entry：
   - 根据当前 snapshot 重新校正 pending create 的 sortKey。
   - `selectSyncBatchOperations()` 选出本批次 operations。
   - 生成 `clientBatchId`。
   - `markBatchInflight()` 记录本批次 inflight entries。
   - 调用 `postSyncBatch()`。

### 3.5 batch 请求协议

前端发送到 `POST /blocks/batch` 的核心字段：

```json
{
  "docId": "doc_1",
  "baseVersion": 3,
  "draftRevision": 7,
  "clientBatchId": "batch_...",
  "source": "autosync",
  "sessionId": "sync_...",
  "sessionEpoch": 2,
  "ackedThroughOpSeq": 42,
  "createVersion": false,
  "operations": []
}
```

operation 类型：

1. `create`
   - `clientId`
   - `syncCreateId`
   - `data.type`
   - `data.payload`
   - `data.parentId`
   - `data.sortKey`

2. `update`
   - `blockId`
   - `data.payload`
   - `data.plainText`

3. `move`
   - `blockId`
   - `parentId`
   - `sortKey`

4. `delete`
   - `blockId` 可选
   - `clientId`
   - `syncCreateId` 可选

### 3.6 后端 batch 处理流程

后端 `BlocksService.batch()` 当前核心流程：

1. 校验文档访问权限。
2. 标准化 `clientBatchId`。
3. 计算 request fingerprint。
4. 开启事务并锁定目标 Document。
5. 读取服务端 `head` 和 `draftRevision`。
6. 检查 batch receipt：
   - 已存在且 fingerprint 一致，返回旧 response。
   - 已存在但 fingerprint 不一致，返回 conflict。
7. 校验 `baseVersion`。
8. draft 写入时校验 `draftRevision`。
9. 校验 sync session：
   - 缺失 session，返回 `SYNC_SESSION_REQUIRED`。
   - session 不匹配，返回 `SYNC_SESSION_MISMATCH`。
   - session 过期，返回 `SYNC_SESSION_EXPIRED`。
   - 成功则刷新 lease。
10. 逐条执行 operation。
11. 如果 `createVersion: false`：
   - 确保 draft 存在。
   - 更新 `DocDraft.blockVersionMap`。
   - `Document.draftRevision += 1`。
12. 构造 response 并保存 batch receipt。
13. 成功时推进 `lastAckedOpSeq`。

### 3.7 前端 ack 处理

前端收到 batch response：

1. 若 `needsReload`：
   - session 类冲突进入 `lease-lost`。
   - 版本类冲突进入 `conflicted`。
   - 不继续处理 ack。

2. 成功时调用 `resolveBatchSuccess()`：
   - 清理已确认 entries。
   - 更新 `baseVersion`。
   - 更新 `draftRevision`。
   - 更新 `lastAckedOpSeq`。
   - dirty 为空则进入 `idle`，否则继续 `dirty`。

3. create ack 处理：
   - 只有 `operation === "create"` 且 success 才进入 `createMappings`。
   - `collectOrphanedCreateDeletes()` 检查 create ack 回来的 block 是否已经不在当前快照。
   - 如果已不在，则 enqueue delete tombstone。

4. server ack patch：
   - delete ack 不进入 `serverAckMappings`。
   - create/update/move ack 可用于把服务端 `blockId/sortKey` patch 回本地 snapshot。

### 3.8 delete tombstone 原理

问题场景：

1. 用户创建一批块。
2. create batch 已发出，但 ack 尚未回来。
3. 用户马上全选删除。
4. 此时前端没有服务端 `blockId`，只能按本地身份删除。

当前机制：

1. create 使用稳定 `syncCreateId`。
2. delete 如果没有 `blockId`，发送：

```json
{
  "type": "delete",
  "clientId": "client_1",
  "syncCreateId": "sync-create:client_1"
}
```

3. 后端 delete 先找 active block。
4. 如果 create 尚未落库，后端写 `sync_create_tombstones`。
5. 后续 create 如果晚到，先查 tombstone。
6. 命中 tombstone 时，create 被 suppressed，不再创建可见块。
7. delete ack echo `clientId/syncCreateId`，前端据此清理 pending delete。

### 3.9 idle manifest reconcile 原理

目的：

解决“前端队列已经空了，但服务端 draft 仍残留前端最终态不可见的同步创建块”的兜底收敛问题。

前端触发条件：

1. `dirtyOrder.length === 0`
2. 无 `inflightBatchId`
3. 存在有效 `sessionId/sessionEpoch`
4. 当前 manifest key 未 reconcile 过
5. 当前没有 reconcile 正在运行

前端请求：

```json
{
  "draftRevision": 8,
  "clientBatchId": "reconcile_...",
  "sessionId": "sync_...",
  "sessionEpoch": 2,
  "manifest": [
    {
      "blockId": "block_1",
      "clientId": "client_1",
      "syncCreateId": "sync-create:client_1"
    }
  ]
}
```

后端处理：

1. 校验文档访问和编辑权限。
2. 校验 sync session。
3. 在事务中锁 Document。
4. 比较客户端 `draftRevision` 和服务端 `draftRevision`。
5. 不匹配则返回 `needsReload: true`，不写入。
6. 读取 `DocDraft.blockVersionMap`。
7. 只检查带 `clientId` 或 `syncCreateId` 的 draft 块。
8. 如果 draft 块不在 manifest，且其同步身份也不在 manifest：
   - 追加 deleted `BlockVersion`。
   - 更新 `Block.latestVer`。
   - 更新 draft map。
   - 写 create tombstone。
9. 如果有写入，`draftRevision += 1`。
10. 返回 tombstoned 列表和新 `draftRevision`。

保守边界：

- 当前不自动 tombstone 没有同步身份的历史块。
- 原因是 manifest 当前只代表前端当前加载/渲染的 top-level 内容，尚未携带 full coverage 证明。
- 这样可以避免分页、局部加载或未来虚拟滚动时误删历史内容。

## 4. 当前风险与不足

### 4.1 还没有弱网端到端证据

已有单元测试和构建验证，但还缺：

1. 网络延迟。
2. 请求超时。
3. 请求重放。
4. 响应乱序。
5. 页面刷新。
6. 大文档。
7. 连续全选删除。
8. create/delete/update/move 混合操作。

没有这些测试，不能证明 99.99% 稳定。

### 4.2 reconcile 没有服务端 receipt

前端已经对 manifest key 去重，但服务端 `sync-reconcile` 还没有像 batch 一样保存 receipt。

风险：

- 前端请求超时后如果重发，服务端可能再次进入处理流程。
- 当前 draftRevision 通常能挡住重复写，但它不是完整幂等回执。
- 对于“请求成功但响应丢失”的场景，前端无法拿到第一次 response，只能依赖下一次状态变化。

### 4.3 manifest coverage 语义不足

当前 manifest 表示“前端当前可见 top-level 内容身份”，不表示“整个文档完整内容集合”。

风险：

- 如果未来引入分页、局部加载、虚拟滚动或折叠懒加载，manifest 缺失不一定代表删除。

当前规避：

- 后端只 tombstone 带同步身份的 draft 块。

后续需要：

- manifest 增加 `coverage: "full" | "partial"`。
- 或增加 `rootBlockId + visibleRange + totalKnownBlocks`。
- 在 full coverage 之前，不扩大自动删除范围。

### 4.4 多标签页体验不完整

当前 session 能阻止旧会话继续写，但用户体验还不完整：

1. 另一个标签页接管后，本标签页如何提示。
2. 本标签页是否进入只读。
3. 是否自动 reload。
4. 本地未同步内容如何导出或恢复。

### 4.5 观测能力不足

前端 trace 已有基础，但后端缺少系统化指标：

1. batch request count。
2. batch replay count。
3. batch fingerprint conflict count。
4. draftRevision mismatch count。
5. session mismatch/expired count。
6. tombstone create suppressed count。
7. delete by client identity count。
8. reconcile manifest node count。
9. reconcile candidate count。
10. reconcile tombstoned count。
11. per-doc abnormal request rate。

没有指标，线上稳定性只能靠用户反馈。

## 5. 下一步详细计划

### 阶段 1：弱网端到端压测

目标：

用自动化证明当前链路在弱网和高频操作下不会丢数据、乱数据、请求风暴。

前端任务：

1. 建立 Playwright 场景测试。
2. 对编辑页注入网络条件：
   - 延迟 200ms / 1000ms / 3000ms。
   - 随机 abort。
   - 随机响应延迟。
   - 同一请求重放。
3. 构造测试文档：
   - 10 块。
   - 100 块。
   - 1000 块。
4. 操作脚本：
   - 连续输入。
   - 批量粘贴。
   - 全选删除。
   - 创建后立即删除。
   - 删除后继续输入。
   - 快速撤销/重做。
   - 保存时同时 autosync。
   - autosync inflight 时刷新页面。
5. 测试结束后重新加载文档，比较：
   - 编辑器最终文本。
   - block 数量。
   - manifest 身份集合。
   - 服务端 draftRevision 是否合理递增。

后端任务：

1. 准备测试接口或测试辅助脚本读取 draft 当前 block map。
2. 提供测试环境数据库清理能力。
3. 记录 batch 和 reconcile 的请求日志，便于失败定位。

验收标准：

1. 100 次连续全选删除压测无请求风暴。
2. 100 次 create 后立即 delete 无残留块。
3. 弱网刷新后无空白文档，除非用户最终态就是空文档。
4. 所有测试结束后前端最终 manifest 与服务端 draft 可见块一致。

### 阶段 2：后端 reconcile receipt 幂等

目标：

让 `POST /documents/:docId/sync-reconcile` 像 `POST /blocks/batch` 一样具备服务端幂等回执。

后端任务：

1. 新增表或复用统一 receipt 模型：
   - `docId`
   - `clientBatchId`
   - `requestFingerprint`
   - `response`
   - `createdBy`
   - `createdAt`
2. `docId + clientBatchId` 唯一。
3. reconcile 开始前先查 receipt。
4. fingerprint 一致返回旧 response。
5. fingerprint 不一致返回 conflict。
6. 首次执行成功或冲突 response 都保存 receipt。

前端任务：

1. 保持 `clientBatchId` 为每次 reconcile 唯一生成。
2. 请求超时策略明确：
   - 可重试同一 `clientBatchId`。
   - 不因为 timeout 立即进入永久 error。
3. trace 中记录 reconcile replay response。

验收标准：

1. 同一 reconcile 请求重放 10 次，服务端只写一次 deleted version。
2. 同一 `clientBatchId` 换 manifest，返回 fingerprint conflict。
3. 请求成功但响应丢失后，重试能拿回第一次 response。

### 阶段 3：后端同步指标与异常告警

目标：

让同步稳定性可观测，不依赖用户口头反馈。

后端任务：

1. 增加结构化日志：
   - `docId`
   - `userId`
   - `sessionId`
   - `sessionEpoch`
   - `clientBatchId`
   - `baseVersion`
   - `draftRevision`
   - operation count
   - result count
   - conflict code
2. 增加 reconcile 日志：
   - manifest count
   - candidate count
   - tombstoned count
   - nextDraftRevision
3. 增加异常频率检测：
   - 同一文档短时间大量 batch。
   - 同一文档大量 delete。
   - 同一 session 频繁 draftRevision mismatch。
   - tombstone suppressed count 异常升高。

前端任务：

1. SyncTraceLog 增加导出入口或复制诊断包。
2. trace 中加入 request frequency summary。
3. UI 层错误提示带诊断码。

验收标准：

1. 出现请求风暴时能在后端日志中看到具体 doc/session/batch。
2. 出现 draftRevision mismatch 时能定位前端基于哪个 revision 发出请求。
3. 用户反馈问题时能导出前端 trace 和后端日志对齐。

### 阶段 4：manifest coverage 语义升级

目标：

把 manifest 从“当前可见身份列表”升级成“可证明覆盖范围的最终态描述”。

前端任务：

1. manifest 增加：
   - `coverage`
   - `rootBlockId`
   - `nodeCount`
   - `contentHash`
   - `generatedAt`
2. 当前全量加载文档时发送 `coverage: "full"`。
3. 如果未来是分页/局部加载，则发送 `coverage: "partial"`，并携带 range 信息。
4. 生成 manifest hash，用于去重和服务端 receipt fingerprint。

后端任务：

1. 对 `coverage: "full"` 才允许更严格收敛。
2. 对 `coverage: "partial"` 只允许同步身份块保守 tombstone。
3. 校验 `rootBlockId` 与文档一致。
4. 可选：服务端返回当前 draft 可见 manifest summary，供前端对比。

验收标准：

1. full coverage 模式下，服务端 draft 最终可见块集合与前端 manifest 完全一致。
2. partial coverage 模式下，不误删未加载历史块。
3. coverage 错误或缺失时，服务端走保守策略。

### 阶段 5：多标签页与 session 恢复体验

目标：

session 已经能阻止旧写入，下一步要让用户体验可控。

前端任务：

1. 检测 `lease-lost` 后进入明确状态：
   - 停止 autosync。
   - 禁止继续写入。
   - 提供刷新/复制本地内容/重新接管入口。
2. 同一浏览器多标签页可用 BroadcastChannel 协调：
   - 新标签页打开同文档时通知旧标签。
   - 旧标签进入只读或提示。
3. commit/save 前确认 session 仍有效。

后端任务：

1. session acquire 策略明确：
   - 同用户续租。
   - 同用户新标签接管。
   - 不同用户是否允许接管。
2. 返回更明确的 session conflict reason。

验收标准：

1. 两个标签页同时编辑同一文档，不出现双写。
2. 失去 session 的标签页不会继续发 batch。
3. 用户能明确知道当前内容是否已同步。

### 阶段 6：提交屏障强化

目标：

手动保存必须提交到明确的本地操作边界。

前端任务：

1. `flushAndCommitBarrier()` 保存前冻结 autosync。
2. flush 到 `dirtyOrder` 为空。
3. 等待 reconcile 完成或明确跳过。
4. commit 请求携带：
   - `sessionId`
   - `sessionEpoch`
   - `ackedThroughOpSeq`
   - 当前 `draftRevision`
5. commit 成功后刷新本地 baseVersion/draftRevision。

后端任务：

1. commit 校验 session。
2. commit 校验 `ackedThroughOpSeq <= lastAckedOpSeq`。
3. commit 返回新 head 和 draftRevision。
4. commit 成功后清理或更新 session 状态。

验收标准：

1. 保存按钮不会提交缺失 autosync 的 draft。
2. autosync inflight 时点击保存，不会出现旧内容版本。
3. 保存成功后刷新页面内容一致。

## 6. 推荐优先级

建议按以下顺序推进：

1. 阶段 1：弱网端到端压测。
2. 阶段 2：后端 reconcile receipt 幂等。
3. 阶段 3：同步指标与异常日志。
4. 阶段 4：manifest coverage 语义升级。
5. 阶段 5：多标签页与 session 恢复体验。
6. 阶段 6：提交屏障强化。

理由：

- 没有阶段 1，就无法证明当前修复真的覆盖高风险场景。
- 没有阶段 2，reconcile 仍不是完整服务端幂等。
- 没有阶段 3，线上问题无法快速定位。
- 阶段 4-6 是把当前保守模型继续升级到更接近强一致体验。

## 7. 当前验证命令

前端：

```bash
pnpm vitest run src/hooks/useDocumentSync.source.test.ts src/services/sync/__tests__/api.test.ts src/services/sync/__tests__/reducer.test.ts src/services/sync/__tests__/snapshot.test.ts src/services/sync/__tests__/engine-order.test.ts
pnpm build
```

后端：

```bash
pnpm jest modules/documents/documents.service.spec.ts --runInBand
pnpm build
```

## 8. 关键文件索引

前端：

- `src/hooks/useDocumentSync.ts`
- `src/services/sync/api.ts`
- `src/services/sync/reducer.ts`
- `src/services/sync/snapshot.ts`
- `src/services/sync/orphaned-create.ts`
- `src/services/sync/debug-log.ts`
- `src/services/sync/__tests__/api.test.ts`
- `src/hooks/useDocumentSync.source.test.ts`

后端：

- `src/modules/blocks/blocks.service.ts`
- `src/modules/blocks/dto/batch-block.dto.ts`
- `src/modules/documents/documents.service.ts`
- `src/modules/documents/documents.controller.ts`
- `src/modules/documents/dto/sync-reconcile.dto.ts`
- `src/modules/documents/services/document-draft.service.ts`
- `src/entities/document-sync-session.entity.ts`
- `src/entities/sync-create-tombstone.entity.ts`
- `src/entities/doc-draft.entity.ts`

## 9. 下一次开工建议

下一次不要直接继续改同步逻辑，建议先做阶段 1 的弱网端到端测试。当前链路已经有足够多保护，继续加逻辑前需要用自动化把最危险路径固定下来，否则会继续靠手工复现追 bug。

第一批推荐测试场景：

1. `create 100 blocks -> immediately select all delete -> wait idle -> reload`。
2. `create 100 blocks -> network delay create ack -> delete all -> old create response returns -> reload`。
3. `paste 1000 blocks -> partial ack -> refresh -> continue edit -> save`。
4. `delete all -> continue typing one paragraph -> wait idle -> reload`。
5. `two tabs same doc -> tab A inflight -> tab B opens/acquires -> tab A continues typing`。
