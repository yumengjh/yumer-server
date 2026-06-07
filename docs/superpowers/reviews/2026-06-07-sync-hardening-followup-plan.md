# 同步链路后续跟进计划

> 日期：2026-06-07
> 后端仓库：`E:\workspace\yumer-server`
> 前端仓库：`E:\workspace\editor-demo\app`
> 当前后端基线提交：`c1dac737654b3be074fc5e001cb8adc5276ca2aa`
> 当前后端基线主题：`fix(sync): harden backend sync consistency`

## 1. 当前基线

本计划只基于当前代码和提交状态整理，不以工作区中的旧分析文档为依据。

当前已经确认的后端基线：

- `sync-reconcile` 已引入服务端 receipt。
- `draft-checkpoint` 已补文档级写锁。
- checkpoint endpoint 已走统一权限校验。
- checkpoint 已校验请求体 `contentHash`。
- `acquireSyncSession()` 已作为会话恢复入口存在于后端接口层。
- 仓库当前具备 `typeorm:migration:run`、`test:e2e`、`playwright` 依赖，可承接后续验证工作。

当前已经确认的前端基线：

- 已存在会话过期后的自动 acquire 恢复路径。
- 已存在 `beforeunload` 基础保护。
- `sync-reconcile` 已发送 `clientBatchId`。
- 前端当前没有现成浏览器级 E2E harness，主要验证能力仍是 `vitest` 源码测试。

## 2. 计划目标

下一阶段不再重复“提交本轮 hardening”，而是验证这轮 hardening 在真实链路中的稳定性，并补齐运行期可观测性。

当前执行前提已调整：

- 当前仍处于开发阶段。
- 当前数据库可丢弃并重建。
- 因此不再优先修复历史 migration 链，也不把双库全链迁移验证作为当前阶段门槛。

本阶段目标：

1. 验证后端迁移和新表行为在 SQLite / PostgreSQL 下可用。
2. 验证关键弱网与重试场景不会绕过本轮 hardening。
3. 给后端补最小必要的结构化日志和指标点。
4. 单独定义下一阶段的协议级演进范围，避免和当前稳定性验证混做。

## 3. 第一步：关键链路验证

目标：验证本轮 hardening 覆盖到的真实故障链，而不是只看单测通过。

优先场景：

1. `late create -> delete -> reload`
2. `save during inflight batch`
3. `reconcile replay with same clientBatchId`
4. `session expired -> auto acquire -> continue edit`
5. `checkpoint contentHash mismatch`

建议承载方式：

- 后端接口与幂等语义优先放在 `yumer-server` 的 `test:e2e` 或新增集成测试里。
- 涉及浏览器状态机、`beforeunload`、session 恢复联动的部分，需要在前端单独补一层浏览器级 harness；因为 `editor-demo` 当前只有 `vitest`，没有现成 E2E 测试框架入口。

验收标准：

- 所有重试路径都能返回可复用结果，而不是写出第二份状态。
- 任何冲突返回都带正确的 reload / conflict 语义。
- session 过期恢复后不会把前端状态机卡死在 `lease-lost`。

## 4. 第二步：后端可观测性补点

目标：让后续联调和线上观察能快速判断这轮 hardening 是否真正生效。

建议先补最小集合：

- `checkpoint_replay_count`
- `reconcile_replay_count`
- `reconcile_fingerprint_conflict_count`
- `checkpoint_content_hash_mismatch_count`
- `draft_revision_mismatch_count`
- `sync_session_required_count`
- `sync_session_expired_count`
- `sync_session_mismatch_count`
- `tombstone_written_count`

日志要求：

- 记录 `docId`
- 记录 `clientBatchId` / `clientCheckpointId`
- 记录 session 信息是否存在
- 记录是否 replay、是否 conflict、是否 needsReload

验收标准：

- 同一个异常链路可以通过日志和计数器被明确还原。
- 不需要重新开大规模 trace，就能判断问题落在 batch、reconcile、checkpoint 还是 session。

## 5. 第三步：下一阶段协议演进范围

这一部分需要现在写清楚，但不在本轮稳定性验证里直接实现。

本阶段只做方案收口，不做大改落地。

建议列为独立专题的内容：

1. `fractional indexing`
2. `sync-reconcile` 的 full / partial coverage 协议
3. 多标签页 session takeover 体验
4. 页面关闭前的轻量 checkpoint / beacon 策略

原因：

- 这些问题都是真实存在的，但都会跨前后端协议、排序语义、历史数据兼容和测试体系。
- 如果和当前迁移验证、弱网验证、日志补点混在一起，变更面会明显失控。

这一阶段输出物建议是单独设计文档，至少回答：

- 是否兼容现有 `sortKey`
- 是否需要数据迁移
- 是否允许局部加载下继续使用 full checkpoint
- 多标签页冲突是保守失败还是自动接管

## 6. 建议执行顺序

1. 先补关键链路验证。
2. 再补后端可观测性。
3. 最后单独起草协议演进设计，不混入当前 hardening 验证批次。

## 7. 当前执行结果

### 7.1 已完成验证

已在 2026-06-07 本地执行以下验证：

- `pnpm jest src/modules/documents/draft-checkpoint.service.spec.ts src/modules/documents/documents.service.spec.ts --runInBand`
- `pnpm jest test/document-sync.e2e-spec.ts --config ./test/jest-e2e.json --runInBand`
- 通过隔离 `DataSource` 单独运行 `1783000000000-CreateSyncReconcileReceipts`
- 已补 `sync-reconcile` 与 `draft-checkpoint` 关键分支结构化日志，并补对应 spec 断言
- 已补两条真实同步链路 e2e：
  - `late create -> delete tombstone -> reload`
  - `batch ack watermark -> commit barrier`
- 已补三条后续真实链路 e2e：
  - `reconcile replay -> same receipt replay`
  - `reconcile reused id -> fingerprint conflict`
  - `session expired -> acquire -> continue edit`
- 已补一条更接近手动保存链路的 e2e：
  - `batch draft -> checkpoint -> commit`
- 已补两条接管/checkpoint transport 级 e2e：
  - `stale session after takeover -> batch rejected with session mismatch`
  - `checkpoint replay -> same response replay / changed payload -> fingerprint conflict`
- 已补 `sync-session` acquire / reuse / renew / required / expired / mismatch / reacquired 结构化日志

当前结果：

- `draft-checkpoint.service.spec.ts` 和 `documents.service.spec.ts` 均通过，共 51 个测试通过。
- `documents.service.spec.ts` 当前通过，共 43 个测试通过。
- `document-sync.e2e-spec.ts` 当前通过，共 9 个 e2e tests 通过。
- `CreateSyncReconcileReceipts1783000000000` 单独在 SQLite 下可执行。
- SQLite 下已确认 `sync_reconcile_receipts` 表、`docId` / `checkedAt` 索引、`docId + clientBatchId` 唯一约束都能正常创建和生效。
- 当前已补日志覆盖：
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
- 当前已确认两条关键行为：
- 当前已确认保存与恢复关键行为：
  - 已 tombstone 的 `syncCreateId` 会压制 late create，reload 后内容树保持干净。
  - `commitVersion` 会以 `ackedThroughOpSeq` 作为保存屏障，超前 ACK 会被 `SYNC_SESSION_ACK_NOT_REACHED` 拦截，对齐后允许提交。
  - `sync-reconcile` 对相同 `clientBatchId + fingerprint` 会 replay 原 response；复用同一 id 但 manifest 不同会返回 `RECONCILE_FINGERPRINT_CONFLICT`。
  - session 过期后，`renew` 会明确返回 `SYNC_SESSION_EXPIRED`，重新 `acquire` 后可以继续 batch 写入。
  - 手动保存链路可以走 `batch -> draft-checkpoint -> commit` 成功提交。
  - 同一文档在新 session 接管后，旧 session 的 batch 写入会被 `SYNC_SESSION_MISMATCH` 拒绝。
  - `draft-checkpoint` 对相同 `clientCheckpointId + fingerprint` 会 replay 原 response；复用同一 checkpoint id 但 payload 不同会返回 `CHECKPOINT_FINGERPRINT_CONFLICT`。

### 7.2 已降级处理项

以下问题已确认存在，但在当前开发阶段不作为本轮优先项：

1. `package.json` 中的 `typeorm:migration:run` 目前缺少 `-d/--dataSource` 参数，按当前配置不能直接运行。
2. SQLite 全链 migration 不是被 `1783000000000` 阻塞，而是被更早的 migration 阻塞：
   - `1760000000000-CreateSettingsProfilesTable.ts`
   - `1761000000000-CreateRuntimeConfigsTable.ts`

这两条 migration 仍包含 PostgreSQL 专用定义，例如：

- `bigserial`
- `jsonb`
- `timestamptz`
- `default: "'{}'::jsonb"`
- `NOW()`
- `::text`
- `ON CONFLICT ... DO UPDATE`

因此当前结论不是“新同步迁移在 SQLite 下失败”，而是：

- 新同步迁移本身可在 SQLite 下运行；
- 但仓库当前的 SQLite 全链 migration 基线并不成立；
- 由于当前数据库可以直接重建，这一项暂不优先处理。

### 7.3 PostgreSQL 状态

本机按默认参数探测 PostgreSQL 时，没有拿到可用连接结果，因此本轮尚未完成 PostgreSQL 实库迁移验证。

当前不以这项作为后续同步计划的阻塞条件。

## 8. 下一步收敛

基于当前执行结果，建议把后续动作收敛为：

1. 继续补同步场景验证，优先补 `late create/delete/reload` 与 `save during inflight`。
2. 视需要再把当前结构化日志抽成正式指标或计数器。
3. 如果还要继续压边界，下一层就是更复杂的多标签页真实前端体验和弱网时序组合，不再是单纯后端 transport 契约。
4. 最后再起草协议演进设计。

## 9. 明确暂不做

当前计划中不直接推进以下实现：

- 修复旧 migration 链兼容性
- 为当前阶段补正式 TypeORM CLI migration 入口
- 直接改造为 fractional indexing
- 直接扩展 `sync-reconcile` 为 authoritative full coverage
- 直接加入页面关闭时的大 payload beacon
- 把前端所有同步测试一次性升级为完整 E2E 体系

这些都应该在验证本轮 hardening 稳定之后，再作为独立阶段进入。
