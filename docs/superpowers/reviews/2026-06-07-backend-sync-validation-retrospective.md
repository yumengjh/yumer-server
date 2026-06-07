# 后端同步稳定性验证与提交说明

> 日期：2026-06-07
> 仓库：`E:\workspace\yumer-server`
> 基线提交：`c1dac737654b3be074fc5e001cb8adc5276ca2aa`
> 主题：后端同步 hardening 后续验证、可观测性补全、提交准备

## 1. 结论

如果只讨论后端同步链路本身，并把范围限定为：

- 单用户编辑
- 单文档同步
- transport / session / receipt / checkpoint / reconcile 契约
- 开发环境下的可重建数据库

那么这次验证后，可以把后端同步稳定性评估提高到 **90%+**。

这里的 90%+ 不是泛指“整套产品端到端已经 90%+”。

它更准确地表示：

- 后端已识别的关键同步故障链，已经有自动化验证覆盖；
- 常规单用户编辑、重试、保存、会话恢复、接管拒绝这些关键路径，后端行为已可重复证明；
- 仍然没有覆盖的高风险部分，主要转移到了前端真实浏览器体验、多标签页交互时序、极端弱网组合，而不是当前后端 transport 契约本身。

## 2. 本次后端补全了什么

### 2.1 补了关键分支结构化日志

补到：

- `src/modules/documents/documents.service.ts`
- `src/modules/documents/draft-checkpoint.service.ts`

当前已覆盖的日志分支：

- `sync-session acquired`
- `sync-session reacquired`
- `sync-session reused`
- `sync-session renewed`
- `sync-session required`
- `sync-session expired`
- `sync-session mismatch`
- `sync-reconcile replay`
- `sync-reconcile fingerprint-conflict`
- `sync-reconcile draft-revision-mismatch`
- `sync-reconcile no-draft`
- `sync-reconcile applied`
- `draft-checkpoint replay`
- `draft-checkpoint fingerprint-conflict`
- `draft-checkpoint content-hash-mismatch`
- `draft-checkpoint base-version-mismatch`
- `draft-checkpoint draft-revision-mismatch`
- `draft-checkpoint session-mismatch`
- `draft-checkpoint draft-not-found`
- `draft-checkpoint applied`

作用：

- 联调时可以直接从后端日志判断故障落点；
- 不需要重新开大 trace，先看日志就能区分 session、checkpoint、reconcile、ack 屏障问题。

### 2.2 补了 transport 级自动化验证

补到：

- `test/document-sync.e2e-spec.ts`

当前新增并通过的关键 e2e：

1. `late create -> delete tombstone -> reload`
2. `ackedThroughOpSeq -> commit barrier`
3. `sync-reconcile replay`
4. `sync-reconcile fingerprint conflict`
5. `session expired -> acquire -> continue edit`
6. `batch -> checkpoint -> commit`
7. `stale session after takeover -> batch rejected`
8. `checkpoint replay`
9. `checkpoint fingerprint conflict`

### 2.3 补了配套 spec 断言

补到：

- `src/modules/documents/documents.service.spec.ts`
- `src/modules/documents/draft-checkpoint.service.spec.ts`

作用：

- 防止后续改动把这些日志分支或后端判定语义悄悄回退。

## 3. 现在可以明确宣称的后端行为

### 3.1 关于 create / delete / tombstone

- 已 tombstone 的 `syncCreateId` 不会被 late create 复活。
- reload 后内容树保持干净，不会把已删块重新挂回来。

### 3.2 关于保存屏障

- `commitVersion` 会受 `ackedThroughOpSeq` 屏障保护。
- 当前端声称“我已经 ACK 到 X”，但服务端 session 高水位还没到 X 时，提交会被 `SYNC_SESSION_ACK_NOT_REACHED` 拦截。
- ACK 对齐后允许提交。

### 3.3 关于 reconcile

- 相同 `clientBatchId + fingerprint` 会 replay 原 response。
- 复用同一个 reconcile id 但 manifest 内容不同，会返回 `RECONCILE_FINGERPRINT_CONFLICT`。

### 3.4 关于 checkpoint

- 相同 `clientCheckpointId + fingerprint` 会 replay 原 response。
- 复用同一个 checkpoint id 但 payload 不同，会返回 `CHECKPOINT_FINGERPRINT_CONFLICT`。

### 3.5 关于 session

- session 过期后，`renew` 会明确返回 `SYNC_SESSION_EXPIRED`。
- 重新 `acquire` 后可以继续 batch 写入。
- 新 session 接管文档后，旧 session 的 batch 写入会被 `SYNC_SESSION_MISMATCH` 拒绝。

### 3.6 关于保存主链路

- `batch -> draft-checkpoint -> commit` 这条主链路当前已能自动化证明可走通。

## 4. 本次实际验证

已执行：

```powershell
pnpm jest src/modules/documents/documents.service.spec.ts --runInBand
pnpm jest test/document-sync.e2e-spec.ts --config ./test/jest-e2e.json --runInBand
```

结果：

- `documents.service.spec.ts`：43 passed
- `document-sync.e2e-spec.ts`：9 passed

另外已单独验证：

- `CreateSyncReconcileReceipts1783000000000` 在隔离 SQLite `DataSource` 下可执行；
- `sync_reconcile_receipts` 表、索引、唯一约束可正常创建。

## 5. 这次不应该过度宣称什么

当前还不应该直接宣称：

- 前后端整套产品端到端已经 90%+
- 多标签页真实交互体验已经完成验证
- 真实浏览器弱网组合场景已经充分压测
- 上线运行期指标已经证明稳定

原因：

- 目前验证重点仍然是后端契约和 transport 行为；
- 前端真实 UI 时序、浏览器生命周期、弱网组合还没有完整自动化；
- 正式指标和计数器也还没有抽出来。

## 6. 提交范围建议

建议本次提交只包含以下文件：

- `src/modules/documents/documents.service.ts`
- `src/modules/documents/documents.service.spec.ts`
- `src/modules/documents/draft-checkpoint.service.ts`
- `src/modules/documents/draft-checkpoint.service.spec.ts`
- `test/document-sync.e2e-spec.ts`
- `docs/superpowers/reviews/2026-06-07-backend-sync-validation-retrospective.md`
- `docs/superpowers/reviews/2026-06-07-sync-hardening-followup-plan.md`

建议不要包含：

- `docs/session/sync-stability-analysis.md`

原因：

- 该文件当前是旧工作区文档，不作为本轮事实依据；
- 本次提交应该保持“后端验证与说明”边界清晰。

## 7. 提交说明建议

建议提交标题：

```text
test(sync): validate backend sync hardening flows
```

如果你希望强调可观测性，也可以用：

```text
test(sync): cover backend sync hardening and session recovery
```

建议提交说明正文：

```text
Add transport-level sync e2e coverage for tombstone suppression, ack commit barriers,
session expiry recovery, reconcile replay/conflict, checkpoint replay/conflict,
and session takeover rejection.

Add structured backend sync logs for session, reconcile, and checkpoint branches.

Docs:
docs/superpowers/reviews/2026-06-07-backend-sync-validation-retrospective.md
docs/superpowers/reviews/2026-06-07-sync-hardening-followup-plan.md
```

## 8. 提交前最后判断

如果本次提交目标是：

- 给后端同步 hardening 补自动化证明
- 给后端同步关键分支补可观察证据
- 给后续联调和交付补清晰说明

那么当前已经满足提交条件。

如果目标变成：

- 证明前后端整套真实用户体验已经稳定

那还不够，下一阶段应该转去前端多标签页和弱网组合验证。
