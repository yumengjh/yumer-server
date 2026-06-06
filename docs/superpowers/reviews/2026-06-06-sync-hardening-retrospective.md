# 同步链路加固复盘

> 日期：2026-06-06  
> 后端仓库：`E:\workspace\yumer-server`  
> 前端仓库：`E:\workspace\editor-demo\app`  
> 前端同步提交：`b56a2be fix(sync): harden frontend sync recovery`  
> 后端状态：本轮加固代码已实现并验证，当前尚未提交。  
> 目标：补齐 checkpoint / reconcile / 前端恢复链路中已经识别出的稳定性缺口，降低弱网、刷新关闭、重复请求和 sortKey 腐蚀导致的草稿不一致风险。

## 1. 背景

本轮工作基于两份材料继续推进：

- `docs/superpowers/reviews/2026-06-05-checkpoint-sync-implementation-retrospective.md`
- `docs/session/sync-stability-analysis.md`

上一轮 checkpoint sync 已经完成主干：

1. 前端保存前执行 full checkpoint。
2. 连续 batch 失败后 fallback checkpoint。
3. 后端 `draft-checkpoint` 支持 full coverage reconcile。
4. checkpoint / batch 已有 receipt 幂等。
5. create/delete/tombstone 机制已经能压住 late create 回流。

但审查后仍有几个缺口：

1. `draft-checkpoint` 缺少文档级写锁。
2. checkpoint 匹配既有 draft block 存在 N+1 查询。
3. checkpoint endpoint 缺少和其他编辑接口一致的权限校验。
4. `sync-reconcile` 没有服务端 receipt。
5. checkpoint `contentHash` 只存储，未校验请求体完整性。
6. 前端 beforeunload 只看 `hasUnsavedChanges`，没有看底层 sync pending/error。
7. session lease 丢失后缺少轻量自动恢复。
8. sortKey 腐蚀还没有实际修复路径。

本轮目标不是重做同步架构，而是在现有三通道模型上补齐这些已确认的边界。

## 2. 本轮已完成

### 2.1 后端：Checkpoint 事务写锁

修改文件：

- `src/modules/documents/draft-checkpoint.service.ts`
- `src/modules/documents/draft-checkpoint.service.spec.ts`

完成内容：

1. `DraftCheckpointService` 注入 `DocumentDraftService`。
2. `applyDraftCheckpointInTransaction()` 在事务开头调用：

```ts
this.documentDraftService.lockDocumentForDraftMutation(docId, manager)
```

3. checkpoint 现在和 batch / sync-reconcile 共享“先锁 Document，再读写 draft map”的写边界。
4. 同一文档上的 batch、checkpoint、reconcile 不再靠前端串行假设避免 lost update。

当前语义：

- PostgreSQL / 非 SQLite 环境通过 `pessimistic_write` 锁住 `Document` 行。
- SQLite 仍沿用现有兼容策略，不额外引入复杂锁抽象。

### 2.2 后端：Checkpoint 候选块批量加载

修改文件：

- `src/modules/documents/draft-checkpoint.service.ts`
- `src/modules/documents/draft-checkpoint.service.spec.ts`

完成内容：

1. 将原来每个 checkpoint block 调一次 `findDraftBlock()`、每次遍历整个 `blockVersionMap` 的逻辑改为：

```text
loadDraftCandidates() 一次性加载当前 draft map 中的 Block / BlockVersion
→ 主循环中纯内存匹配 blockId / syncCreateId / clientId
```

2. `Block` 查询按 `In(blockIds)` 分块加载。
3. `BlockVersion` 查询按 `(docId, blockId, ver)` OR 条件分块加载。
4. tombstone 缺失块时复用已加载候选，减少事务内重复查询。

效果：

- 大文档 checkpoint 的 DB 查询量从近似 `checkpointBlocks * draftBlocks * 2` 降为按 draft map 分块查询。
- 加锁后事务持锁时间更短，降低并发阻塞和超时风险。

### 2.3 后端：Checkpoint blockId 生成器统一

修改文件：

- `src/modules/documents/draft-checkpoint.service.ts`
- `src/modules/documents/draft-checkpoint.service.spec.ts`

完成内容：

1. 移除 checkpoint service 内部的：

```ts
block_${Date.now()}_${counter}
```

2. 改用现有统一工具：

```ts
generateBlockId()
```

3. checkpoint 新建 block 的 ID 格式和其他写链路保持一致。

修复的问题：

- 服务重启后计数器归零导致极端情况下 blockId 冲突的风险。
- checkpoint 和 batch create 的 ID 生成策略不一致。

### 2.4 后端：Checkpoint endpoint 权限校验

修改文件：

- `src/modules/documents/documents.controller.ts`
- `src/modules/documents/documents.service.ts`
- `src/modules/documents/documents.service.spec.ts`

完成内容：

1. controller 不再直接调用 `DraftCheckpointService`。
2. 新增：

```ts
DocumentsService.applyDraftCheckpoint(docId, userId, dto)
```

3. 写入前执行：

```text
assertAccessWithoutViewIncrement()
checkDocumentEditPermission()
```

4. 校验通过后再委托 `DraftCheckpointService.applyDraftCheckpoint()`。

当前语义：

- checkpoint endpoint 和 `sync-reconcile` / `commitVersion` 使用一致的访问权限与编辑权限边界。
- session 校验仍保留在 `DraftCheckpointService` 内部，作为同步会话层保护。

### 2.5 后端：sync-reconcile receipt 幂等

新增文件：

- `src/entities/sync-reconcile-receipt.entity.ts`
- `src/database/migrations/1783000000000-CreateSyncReconcileReceipts.ts`

修改文件：

- `src/app.module.ts`
- `src/modules/documents/documents.module.ts`
- `src/modules/documents/documents.service.ts`
- `src/modules/documents/documents.service.spec.ts`
- `src/modules/documents/dto/sync-reconcile.dto.ts`

完成内容：

1. 新增表：

```text
sync_reconcile_receipts
```

2. 唯一键：

```text
docId + clientBatchId
```

3. 存储字段：

- `docId`
- `clientBatchId`
- `requestFingerprint`
- `checkedAt`
- `draftRevision`
- `needsReload`
- `conflicts`
- `tombstoned`
- `createdBy`
- `createdAt`
- `updatedAt`

4. `SyncReconcileDto.clientBatchId` 从 optional 收紧为必填。
5. `reconcileSyncManifest()` 在事务内、锁文档后先查 receipt：
   - fingerprint 一致：回放原 response。
   - fingerprint 不一致：返回 `RECONCILE_FINGERPRINT_CONFLICT`，不覆盖旧 receipt。
   - 首次执行：正常 reconcile，最终 response 写入 receipt。

修复的问题：

- “服务端 reconcile 成功，响应丢失，前端重试同一个请求”时，现在能拿回第一次 response。
- 同一个 `clientBatchId` 被错误复用为不同 manifest 时，现在显式冲突。

### 2.6 后端：Checkpoint contentHash 请求体校验

修改文件：

- `src/modules/documents/draft-checkpoint.service.ts`
- `src/modules/documents/draft-checkpoint.service.spec.ts`

完成内容：

1. 后端按前端构建 checkpoint 时的 canonical body 重新计算：

```json
{
  "docId": "...",
  "rootBlockId": "...",
  "blocks": [...]
}
```

2. 支持标准 `sha256:<hex>` 校验。
3. 兼容前端 fallback hash 格式：

```text
sha256:fallback-<hash>
```

4. hash 不匹配时返回：

```text
CONTENT_HASH_MISMATCH
```

并阻止写入。

当前边界：

- 已校验“请求声称的 contentHash 是否匹配收到的请求体”。
- 尚未实现“服务端落库后再按服务端 draft 重建完整内容并二次 hash 对比”。

### 2.7 前端：Session lease 自动恢复

修改文件：

- `src/services/document.ts`
- `src/contexts/DocumentContext.tsx`
- `src/hooks/useDocumentSync.ts`
- `src/components/EditorPage.tsx`

后端配套修改：

- `DocumentsService.acquireSyncSession()`
- `POST /documents/:docId/sync-session/acquire`

完成内容：

1. 前端新增：

```ts
acquireSyncSession(docId)
```

2. `useDocumentSync` 在续租失败时，如果错误包含：

```text
SYNC_SESSION_EXPIRED
SYNC_SESSION_REQUIRED
```

会尝试重新 acquire sync session。

3. acquire 成功后：
   - 更新 reducer 内的 `sessionId/sessionEpoch/leaseExpiresAt/lastAckedOpSeq`。
   - 清理 `lastError`。
   - 根据 dirty queue 恢复为 `dirty` 或 `idle`。
   - 通过 `onSessionRecovered` 回写 `DocumentContext.currentSyncSession`。

刻意没有做的内容：

- 遇到 `SYNC_SESSION_MISMATCH` 不自动抢回 session。

原因：

- mismatch 更可能代表另一个标签页或未来另一个协作者已经接管，自动抢回会造成多标签页来回争抢。

### 2.8 前端：beforeunload 同步状态兜底

修改文件：

- `src/hooks/useDocumentSync.ts`
- `src/components/EditorPage.tsx`

完成内容：

1. `useDocumentSync` 新增返回：

```ts
hasPendingSync
```

2. 判定条件包括：

- `dirtyOrder.length > 0`
- `inflightBatchId` 非空
- `syncState === "flushing"`
- `syncState === "dirty"`
- `syncState === "error"`
- `syncState === "conflicted"`
- `syncState === "lease-lost"`

3. `EditorPage` 的 beforeunload guard 从只看：

```text
hasUnsavedChanges
```

扩展为：

```text
hasUnsavedChanges || sync.hasPendingSync
```

当前效果：

- 用户在 dirty / inflight / error / lease-lost 等同步未稳定状态关闭或刷新页面时，会触发浏览器离开确认。

### 2.9 前端：Checkpoint canonical orderKey

修改文件：

- `src/services/sync/checkpoint.ts`
- `src/services/sync/__tests__/checkpoint.test.ts`

完成内容：

1. checkpoint 不再沿用节点 attrs 中可能已经腐蚀的 `sortKey`。
2. checkpoint blocks 按编辑器当前视觉顺序重新生成：

```text
001000, 002000, 003000, ...
```

3. payload attrs 内的 `sortKey` 同步更新为 canonical orderKey。

修复的问题：

- 如果前端当前文档存在重复、非单调、间距耗尽的 sortKey，保存前 checkpoint 或失败 fallback 会用最终视觉顺序冲刷服务端 draft。

当前边界：

- 这是低风险修复，不是完整 fractional indexing。
- 常规 batch move/create 仍沿用现有整数 sortKey 算法。

### 2.10 前端提交

前端同步相关改动已单独提交：

```text
b56a2be fix(sync): harden frontend sync recovery
```

该提交包含：

- `src/components/EditorPage.tsx`
- `src/contexts/DocumentContext.tsx`
- `src/hooks/useDocumentSync.ts`
- `src/services/document.ts`
- `src/services/sync/checkpoint.ts`
- `src/services/sync/__tests__/checkpoint.test.ts`

提交时已避开当时工作区中无关的 UI / Zen Mode 改动。

## 3. 本轮验证

### 3.1 后端验证

已执行：

```powershell
pnpm jest src/modules/documents/draft-checkpoint.service.spec.ts src/modules/documents/documents.service.spec.ts src/modules/blocks/blocks-sync-idempotency.spec.ts --runInBand
pnpm build
```

结果：

- 3 个后端 test suites passed。
- 69 个 tests passed。
- Nest build 通过。
- TSC 0 issues。

### 3.2 前端验证

已执行：

```powershell
pnpm vitest run src/services/sync/__tests__/checkpoint.test.ts src/hooks/useDocumentSync.source.test.ts src/components/__tests__/editor-before-unload.source.test.ts src/components/__tests__/sync-session-plumbing.source.test.ts src/services/__tests__/document-commit-api.test.ts
pnpm build
```

结果：

- 5 个前端 test files passed。
- 14 个 tests passed。
- Next build 通过。
- TypeScript 通过。

### 3.3 编码修复

前端 `useDocumentSync.ts` 中原有两处乱码 fallback 文案已修复：

- `同步会话续租失败`
- `同步失败`

并重新运行了前端 targeted tests。

## 4. 当前状态

### 4.1 后端状态

后端本轮加固代码已实现并通过验证，但当前尚未提交。

当前涉及文件：

- `src/app.module.ts`
- `src/entities/sync-reconcile-receipt.entity.ts`
- `src/database/migrations/1783000000000-CreateSyncReconcileReceipts.ts`
- `src/modules/documents/documents.controller.ts`
- `src/modules/documents/documents.module.ts`
- `src/modules/documents/documents.service.ts`
- `src/modules/documents/documents.service.spec.ts`
- `src/modules/documents/draft-checkpoint.service.ts`
- `src/modules/documents/draft-checkpoint.service.spec.ts`
- `src/modules/documents/dto/sync-reconcile.dto.ts`
- `docs/superpowers/reviews/2026-06-06-sync-hardening-retrospective.md`

另有用户侧未跟踪文档：

- `docs/session/sync-stability-analysis.md`

本轮未修改该文件。

### 4.2 前端状态

同步相关改动已提交：

```text
b56a2be fix(sync): harden frontend sync recovery
```

前端后续还有独立 UI 提交：

```text
65ba947 feat(ui): 添加沉浸式模式（Zen Mode）
```

当前前端工作区仍有其他 UI 相关未提交改动，本轮同步提交没有包含这些内容。

## 5. 已解决的问题对照

| 问题 | 当前状态 | 说明 |
| --- | --- | --- |
| Checkpoint 缺少文档级锁 | 已完成 | 事务入口调用 `lockDocumentForDraftMutation()`。 |
| Checkpoint N+1 查询 | 已完成 | 改为一次性批量加载 candidates。 |
| Checkpoint 自造 blockId | 已完成 | 改用 `generateBlockId()`。 |
| Checkpoint endpoint 权限校验 | 已完成 | 通过 `DocumentsService.applyDraftCheckpoint()` 统一访问/编辑权限校验。 |
| sync-reconcile 无 receipt | 已完成 | 新增 `sync_reconcile_receipts`。 |
| checkpoint contentHash 未校验 | 已完成 | 校验请求体 canonical hash。 |
| beforeunload 未看 sync 状态 | 已完成 | `hasUnsavedChanges || sync.hasPendingSync`。 |
| lease-lost 无恢复 | 部分完成 | expired / required 自动 acquire；mismatch 不自动抢回。 |
| sortKey 腐蚀 | 部分完成 | checkpoint canonical orderKey 可修复保存/失败 fallback；未做 fractional indexing。 |

## 6. 尚未完成

### 6.1 完整 fractional indexing

当前仍未把排序系统升级为真正的 fractional indexing。

原因：

- 需要同时调整前端 `order.ts`、后端 `sort-key.util.ts`、`compareSortKey()`、数据库查询排序、历史 sortKey 兼容和大量测试。
- 直接混入本轮一致性修复会扩大风险。

当前替代方案：

- checkpoint 按视觉顺序 canonicalize `orderKey`，作为保存前和失败恢复的修复通道。

### 6.2 beforeunload sendBeacon / checkpoint beacon

当前只做了浏览器离开确认，没有实现关闭页面前用 `sendBeacon` 或 keepalive fetch 发送 checkpoint。

未做原因：

- full checkpoint payload 可能较大，不适合直接走 beacon。
- beacon 的响应不可可靠消费，和 checkpoint receipt / ACK patch 语义不完全匹配。

后续可以考虑：

- 仅在小文档、小 payload、dirty 队列为空但 inflight/error 时尝试轻量 checkpoint beacon。

### 6.3 弱网 E2E 压测

本轮仍是单元测试、源码测试和 build 验证。

尚未完成真实浏览器 E2E：

- create 100 blocks -> immediately delete all -> reload。
- create ack 延迟 -> delete all -> old create response returns -> reload。
- paste 1000 blocks -> partial ack -> refresh。
- save during autosync inflight。
- two tabs session takeover。

### 6.4 sync-reconcile server-side full coverage 语义升级

`sync-reconcile` 仍是 idle manifest 的保守清理通道。

当前没有升级为：

- `coverage: "full" | "partial"`
- `rootBlockId`
- `nodeCount`
- `contentHash`
- range / pagination coverage

原因：

- 当前 full authoritative 语义已经由 `draft-checkpoint` 承担。
- `sync-reconcile` 继续保持保守 identity manifest，避免未来分页/局部加载误删。

### 6.5 后端同步指标与告警

本轮没有增加系统化指标。

仍建议后续补：

- batch replay count。
- checkpoint replay count。
- reconcile replay count。
- fingerprint conflict count。
- draftRevision mismatch count。
- session mismatch / expired count。
- tombstone suppressed count。
- per-doc abnormal request rate。

## 7. 风险与注意事项

### 7.1 sync-reconcile clientBatchId 变为必填

`SyncReconcileDto.clientBatchId` 已收紧为必填。

当前前端 `postSyncManifestReconcile()` 已经一直发送 `clientBatchId`，因此主链路兼容。

潜在风险：

- 如果还有旧客户端或测试脚本直接调用 `/documents/:docId/sync-reconcile` 且不传 `clientBatchId`，会被 DTO 拒绝。

这是预期收紧。

### 7.2 自动 acquire session 只处理 expired / required

前端只在续租失败包含：

```text
SYNC_SESSION_EXPIRED
SYNC_SESSION_REQUIRED
```

时自动 acquire。

遇到：

```text
SYNC_SESSION_MISMATCH
```

仍进入 `lease-lost`。

这是刻意保守设计，避免多标签页抢 session。

### 7.3 checkpoint contentHash 校验边界

当前校验的是请求体完整性，不是服务端落库后重建内容 hash。

如果未来要做更强校验，需要定义服务端 canonical draft content hash，并确保和前端 TipTap JSON canonicalization 完全一致。

### 7.4 checkpoint canonical orderKey 会覆盖历史 sortKey

checkpoint 现在按视觉顺序重新分配：

```text
001000, 002000, 003000...
```

这是预期行为。

影响：

- 保存前 checkpoint 会把服务端 draft 排序键修复到当前编辑器视觉顺序。
- 如果未来存在局部加载，不能使用 full checkpoint 语义覆盖未加载区域。

## 8. 建议后续顺序

1. 提交后端本轮加固代码。
2. 跑数据库迁移验证，确认 `sync_reconcile_receipts` 在 SQLite / PostgreSQL 下均正常创建。
3. 做第一批弱网 E2E：
   - create -> delete -> late ack -> reload。
   - manual save during inflight。
   - repeated reconcile replay。
4. 增加后端同步结构化日志和指标。
5. 单独设计 fractional indexing，不和其他同步安全修复混在一起。

## 9. 结论

本轮已经把当前同步链路中最直接的数据一致性缺口补齐：

- checkpoint 有锁。
- checkpoint 查询不再 N+1。
- checkpoint endpoint 有权限校验。
- reconcile 有服务端 receipt。
- checkpoint hash 会校验。
- 前端会话过期可轻量恢复。
- 页面离开会看底层 sync pending/error。
- checkpoint 会修复腐蚀 sortKey。

当前状态可以认为三通道模型的“常规单用户编辑 + 弱网恢复 + 手动保存前最终态一致性”比上一轮更稳，但还不能宣称 99.99%。

真正的 99.99% 仍依赖：

- 弱网 E2E 压测；
- 线上指标；
- 多标签页体验；
- full/partial coverage 协议；
- fractional indexing；
- 更完整的异常恢复 UI。
