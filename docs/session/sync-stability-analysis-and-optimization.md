# 内容同步稳定性分析与优化建议

> 分析日期：2026-06-05  
> 分析范围：后端增量块级同步全链路（batch API、sync session、tombstone、reconcile、draft 并发控制）

---

## 1. 同步架构总览

### 1.1 核心协议

当前同步采用 **客户端差异驱动 + 服务端批次确认** 的模型：

```text
前端编辑器
  → diff(snapshotRef, editorContent)
  → generate operations [create / update / delete / move]
  → POST /blocks/batch (BatchBlockDto)
  → 服务端事务内串行执行
  → SyncBatchResponseDto (ACK)
  → 前端 reducer 应用 ACK 补丁
```

### 1.2 关键数据模型

| 模型 | 职责 |
|---|---|
| `Document.draftRevision` | 文档级单调递增修订号，草稿并发控制核心 |
| `Document.head` | 已提交版本号，自动同步不推进 |
| `DocDraft.blockVersionMap` | 草稿态块版本映射 |
| `SyncBatchReceipt` | 批次幂等回执，防重放 |
| `DocumentSyncSession` | 编辑会话租约，多标签页互斥 |
| `SyncCreateTombstone` | 删除意图墓碑，抑制 late create |
| `BlockVersion` (attrs) | 携带 `clientId`/`syncCreateId`/`clientBatchId` 身份属性 |

### 1.3 防线体系

经过多轮迭代，当前已形成五层防线：

```text
① BatchReceipt 幂等层 — 同一 clientBatchId 不重复执行
② baseVersion + draftRevision 并发层 — 拒绝过期草稿写入
③ SyncSession 会话层 — 租约过期或 session 不匹配时拒绝
④ SyncCreateTombstone 意图层 — delete 先到时抑制后续 create
⑤ Manifest Reconcile 兜底层 — 空闲时按最终态对齐 draft
```

---

## 2. 当前稳定性评估

### 2.1 已解决的高危问题

以下问题已通过多轮复盘修复并验证（详见 `docs/retrospectives/`）：

| 问题 | 根因 | 修复方案 | 风险等级 |
|---|---|---|---|
| 块复活（已删除块刷新后重现） | ACK 处理吞掉请求飞行期间的删除 | 前端 ACK 前先 captureContentSnapshot | 🔴 已修复 |
| 旧标签页覆盖新草稿 | 自动同步只校验 head，不校验 draftRevision | 引入 Document.draftRevision | 🔴 已修复 |
| GC 修改 draft map 后旧客户端继续写入 | GC 不推进 draftRevision | GC compact 时推进 revision | 🟡 已修复 |
| 外部内容被误判为 ACK 身份补丁 | ACK patch 与完整加载共用入口 | 拆分为不同语义入口 | 🟡 已修复 |
| delete tombstone ACK 无法关联客户端 entry | 响应缺少 clientId 回显 | delete result 回显 clientId | 🟡 已修复 |
| 排序锚点索引错误 | 查找下一锚点用 clientId 而非 matchKey | 统一使用 matchKey | 🟢 已修复 |
| sortKey 冲突导致服务端重分配 | reserveUniqueSortKey 碰撞 | 批次内 reservedSortKeysByParent 去重 | 🟢 已修复 |

### 2.2 当前稳定性评分

| 维度 | 评分 | 说明 |
|---|---|---|
| 幂等安全 | ⭐⭐⭐⭐⭐ | receipt + fingerprint 双重保障，同 batchId 安全重放 |
| 并发控制 | ⭐⭐⭐⭐ | draftRevision + pessimistic lock，SQLite 下仍有序列化缺口 |
| 删除一致性 | ⭐⭐⭐⭐ | tombstone + reconcile 兜底，但 reconcile 覆盖面有限 |
| 会话管理 | ⭐⭐⭐⭐ | session epoch + lease，缺少主动续约定时器 |
| 可观测性 | ⭐⭐⭐ | 有 create-delete compensation 日志，缺少结构化指标 |
| 错误恢复 | ⭐⭐⭐ | needsReload 提示客户端刷新，但无自动恢复策略 |

**综合稳定性：中高** — 核心数据一致性防线已基本到位，但在边缘场景、可观测性和自动恢复方面仍有提升空间。

---

## 3. 残余风险与隐蔽 BUG 分析

### 3.1 🔴 SQLite 开发环境下事务串行化不足

**位置**：`BlocksService.batch()` 事务入口

```typescript
// blocks.service.ts L1108-1111
const dbType = this.dataSource.options.type;
if (dbType !== "sqlite" && dbType !== "better-sqlite3") {
  docQuery.setLock("pessimistic_write");
}
```

**问题**：开发环境使用 SQLite/better-sqlite3 时，跳过了悲观锁。虽然 SQLite 本身是串行写入，但在 `WAL` 模式下仍可能出现：
- 读事务看到旧快照
- 两个并发 batch 都通过 draftRevision 检查后依次写入

**影响**：开发阶段可能漏掉并发 bug，到生产 PostgreSQL 环境才暴露。

**建议**：开发环境补充 `PRAGMA journal_mode=WAL` + `BEGIN IMMEDIATE` 语义，或在 CI 中使用 PostgreSQL 跑集成测试。

### 3.2 🔴 Batch 部分失败时 draftRevision 仍推进

**位置**：`BlocksService.batch()` 事务内

```typescript
// blocks.service.ts L1514
} else if (!shouldCreateVersion && draftMutations.length > 0) {
  // ... 推进 draftRevision
  docInTx.draftRevision = serverDraftRevision + 1;
```

**问题**：当 batch 中部分操作失败（如 update 找不到 block），但仍有成功操作时：
- `hasFailures = true`
- `draftMutations` 不为空
- `draftRevision` 仍然推进

此时客户端收到 `needsReload: false` + 部分失败结果，但 draftRevision 已经变了。下一批请求必须使用新 revision，否则会被拒绝。

**风险**：如果客户端没有正确处理部分失败（比如只重试失败的操作），新 batch 的 draftRevision 可能与服务端不一致，导致整个批次被拒绝。

**建议**：
- 部分失败时考虑不推进 draftRevision，或
- 在 response 中显式标注 `partialSuccess: true`，引导客户端完整刷新

### 3.3 🟡 SyncCreateTombstone TTL 过期后的 Late Create 回流

**位置**：`BlocksService.findActiveSyncCreateTombstone()`

```typescript
// blocks.service.ts L1849
.andWhere("t.expiresAt > :now", { now: Date.now() });
```

**问题**：Tombstone 默认 TTL 为 30 分钟。如果网络极端延迟或客户端离线超过 30 分钟后恢复：
- tombstone 已过期被清理
- 客户端重发 create 请求
- 服务端找不到 tombstone，创建了一个已被用户删除的块

**影响**：弱网环境下可能再次出现块复活。

**建议**：
- 将 tombstone TTL 与 sync session lease 绑定，session 存活则 tombstone 存活
- 或在前端离线恢复后强制 full reload，不继续增量同步

### 3.4 🟡 Reconcile 只处理带同步身份的块

**位置**：`DocumentsService.tombstoneMissingSyncManifestBlocks()`

```typescript
// documents.service.ts L2290-2300
if (!clientId && !syncCreateId) {
  continue; // 跳过没有同步身份的块
}
```

**问题**：Reconcile 只清理带 `clientId` 或 `syncCreateId` 的块。历史遗留的、没有同步身份的块（如通过非 sync API 创建的块）不会被 reconcile 处理。

**影响**：如果前端 manifest 不包含这些块（因为分页或局部加载），它们可能永远残留在 draft 中。

**建议**：
- 前端 manifest 增加 `coverage: "full" | "partial"` 标记
- `coverage=full` 时允许 reconcile 处理所有 draft 块
- 需要端到端测试证明不是局部视图

### 3.5 🟡 Sync Session Lease 续期依赖前端主动调用

**位置**：`DocumentsController.renewSyncSession()`

**问题**：Sync session lease 默认 5 分钟，续期依赖前端调用 `POST /documents/:docId/sync-session/renew` 或在 batch 中自动刷新。如果前端定时器失效或网络中断：
- lease 过期
- 后续所有 batch 被拒绝（`SYNC_SESSION_EXPIRED`）
- 用户被迫刷新页面

**影响**：用户体验下降，但不会导致数据不一致。

**建议**：
- 前端增加 lease 剩余时间告警（< 60s 时主动 renew）
- 后端考虑在 batch 成功时自动延长 lease（当前已实现）
- 增加 `grace period`：lease 过期后 30s 内仍接受请求但返回 warning

### 3.6 🟡 BatchReceipt 无 TTL，长期积累影响查询性能

**位置**：`SyncBatchReceipt` 实体

**问题**：BatchReceipt 表没有 TTL 或清理机制。每次 batch 都会写入一条 receipt，长期运行后表会无限增长。

**影响**：
- `findStoredBatchReceipt()` 查询变慢
- 数据库存储膨胀

**建议**：
- 增加 `expiresAt` 字段，默认 24h TTL
- 定期清理过期 receipt（可复用 GC 管线的调度器）
- 或在前端 ACK 确认后标记为 `acknowledged`，异步清理

### 3.7 🟢 Update 操作未校验 expectedBlockVersion

**位置**：`BlocksService.handleBatchUpdate()`

```typescript
// blocks.service.ts L1909-1915
const block = await manager.findOne(Block, {
  where: { blockId: operation.blockId, docId, isDeleted: false },
});
```

**问题**：update 只检查块存在且未删除，不校验客户端基于的 block version 是否与服务端一致。如果两个客户端同时 update 同一个块：
- 都基于 version=5
- 客户端 A 写入 version=6
- 客户端 B 也写入 version=6（覆盖 A 的修改）

**影响**：最后一写胜出，但不会导致数据损坏（draftRevision 会拒绝整个旧 batch）。

**建议**：
- 后续可增加 `expectedBlockVersion` 字段，实现块级乐观锁
- 当前依赖 draftRevision 的批次级保护已足够

### 3.8 🟢 Delete 后 Block 物理行仍保留

**位置**：`BlocksService.handleBatchDelete()`

**问题**：`createVersion=false` 的 delete 只是创建了一个 `attrs.deleted=true` 的新 BlockVersion，`Block.isDeleted` 保持 `false`。块的实际删除依赖后续 GC 或 reconcile。

**影响**：
- `blocks` 表中 `isDeleted=false` 的行数持续增长
- 需要依赖 GC tombstone compaction 同步状态

**建议**：
- 确认 GC tombstone compaction 的触发条件和频率
- 增加监控指标：`isDeleted=false` 但最新 version 为 tombstone 的块数量

---

## 4. 性能瓶颈分析

### 4.1 单事务内串行执行所有操作

**现状**：一个 batch 中的所有 create/update/delete/move 在同一个数据库事务内串行执行。

**影响**：
- 大批量操作（如粘贴 100 个块）会长时间持有事务锁
- 其他并发 batch 需要等待

**建议**：
- 考虑将大批次拆分为子批次（每批 20-50 操作）
- 或使用 advisory lock 替代行锁，减少锁等待

### 4.2 每个操作独立查询 Block 和 BlockVersion

**现状**：`handleBatchUpdate`、`handleBatchDelete`、`handleBatchMove` 都独立查询 `Block` 和 `BlockVersion`。

**影响**：N 个操作的 batch 需要 2N+ 次数据库查询。

**建议**：
- 在 batch 开始时批量查询所有涉及的 block 和 version
- 使用 `Map<blockId, Block>` 缓存，减少重复查询

### 4.3 reserveUniqueSortKey 多次查询

**现状**：每个 create/move 操作都调用 `listSiblingSortKeys` 查询同级块的 sortKey。

**影响**：同一父块下的多个 create 会重复查询相同的 sibling 列表。

**建议**：
- 在 batch 开始时按 parentId 批量加载 sibling sortKey
- 使用 `reservedSortKeysByParent` 缓存（已有部分实现）

---

## 5. 可观测性缺口

### 5.1 当前已有的观测能力

| 指标 | 来源 | 覆盖范围 |
|---|---|---|
| sync batch 日志 | `BlocksService` Logger | 每次成功 batch |
| create-delete compensation 警告 | `BlocksService` Logger | 短时间 create→delete |
| conflict 响应 | HTTP response | needsReload 场景 |

### 5.2 缺失的关键指标

| 指标 | 重要性 | 建议实现方式 |
|---|---|---|
| DRAFT_REVISION_MISMATCH 频率 | 🔴 高 | 结构化日志 + Prometheus counter |
| SYNC_SESSION_EXPIRED 频率 | 🟡 中 | 结构化日志 |
| batch 操作数量分布 | 🟡 中 | histogram |
| tombstone 命中/未命中比 | 🟡 中 | counter |
| reconcile tombstoned 数量 | 🟡 中 | gauge |
| batch 事务耗时 | 🟡 中 | histogram |
| receipt 表行数 | 🟢 低 | periodic query |
| draft map 中 tombstone 块比例 | 🟢 低 | periodic query |

### 5.3 建议的监控仪表盘

```text
┌─────────────────────────────────────────────┐
│              Sync Health Dashboard           │
├─────────────────────────────────────────────┤
│ Batch 成功率: 99.2%                          │
│ Conflict 率: 0.8%                            │
│   ├─ DRAFT_REVISION_MISMATCH: 0.5%           │
│   ├─ BASE_VERSION_MISMATCH: 0.2%             │
│   └─ SYNC_SESSION_EXPIRED: 0.1%              │
│                                              │
│ Avg batch 耗时: 45ms                         │
│ P99 batch 耗时: 320ms                        │
│                                              │
│ Create-delete compensation (last 1h): 12     │
│ Reconcile tombstoned (last 1h): 3            │
│                                              │
│ Receipt 表行数: 15,234                       │
│ Tombstone 表行数: 89                         │
└─────────────────────────────────────────────┘
```

---

## 6. 优化路线图

### 6.1 短期（1-2 周）— 可观测性 + 低风险修复

| 任务 | 优先级 | 复杂度 |
|---|---|---|
| 增加 DRAFT_REVISION_MISMATCH 结构化日志 | P0 | 低 |
| 增加 batch 事务耗时 histogram | P0 | 低 |
| BatchReceipt 增加 TTL 字段 | P1 | 中 |
| SyncCreateTombstone TTL 与 session lease 联动 | P1 | 中 |
| 部分失败时显式标注 partialSuccess | P1 | 低 |

### 6.2 中期（2-4 周）— 协议增强

| 任务 | 优先级 | 复杂度 |
|---|---|---|
| update/delete/move 增加 expectedBlockVersion | P1 | 中 |
| 显式 clientOpId，替代下标推断 | P2 | 中 |
| manifest coverage 标记（full/partial） | P2 | 中 |
| SQLite 开发环境事务隔离增强 | P2 | 低 |
| batch 内 block/version 查询批量化 | P2 | 中 |

### 6.3 长期（1-2 月）— 架构演进

| 任务 | 优先级 | 复杂度 |
|---|---|---|
| 服务端 draft 摘要 API（live blockId 集合） | P2 | 中 |
| 客户端定期核对服务端事实 | P2 | 高 |
| 自动冲突合并（而非直接拒绝） | P3 | 高 |
| 显式 restore 操作（区分撤销与旧 update） | P3 | 中 |
| CRDT 或 OT 融合（多用户协作场景） | P3 | 极高 |

---

## 7. 测试覆盖评估

### 7.1 已有测试

| 测试文件 | 覆盖范围 |
|---|---|
| `blocks-sync-idempotency.spec.ts` | receipt 幂等、session 校验、tombstone、revision |
| `blocks.service.draft.spec.ts` | draftRevision 推进、stale revision 拒绝 |
| `documents.service.spec.ts` | reconcile、sync session、discard/commit |
| `document-draft.service.spec.ts` | draft 锁、revision 生命周期 |
| `gc-sweep.service.spec.ts` | tombstone compaction、block state sync |

### 7.2 缺失的测试场景

| 场景 | 重要性 | 说明 |
|---|---|---|
| 部分失败 batch 的 draftRevision 行为 | 🔴 高 | 当前没有专门测试 |
| tombstone TTL 过期后的 late create | 🟡 中 | 需要时间模拟 |
| 大批量 batch（100+ 操作）的事务性能 | 🟡 中 | 需要性能基准测试 |
| 并发 batch 在相同 draftRevision 下的竞争 | 🟡 中 | 需要并发测试框架 |
| reconcile 与正在进行的 batch 交错 | 🟡 中 | 需要时序测试 |

---

## 8. 与前端协同建议

### 8.1 前端应实现的防御

1. **lease 续约定时器**：每 3 分钟调用 `POST /sync-session/renew`
2. **needsReload 自动处理**：收到 `needsReload: true` 时自动 full reload，不等待用户操作
3. **partialSuccess 处理**：如果后端引入此字段，前端应完整刷新而非重试失败操作
4. **离线恢复策略**：离线超过 tombstone TTL 后，恢复时强制 full reload

### 8.2 协议变更通知

- `draftRevision` 已是必填字段（旧客户端默认 0，逐步淘汰）
- 后续可能增加 `clientOpId`、`expectedBlockVersion`、`partialSuccess`
- 建议在 OpenAPI spec 中标注版本兼容性

---

## 9. 结论

当前内容同步系统已经具备了一套相对完整的防线体系，核心数据一致性问题（块复活、草稿覆盖）已通过多轮迭代基本解决。主要残余风险集中在：

1. **边缘时序场景**：tombstone TTL 过期、部分失败、SQLite 开发环境
2. **可观测性不足**：缺少结构化指标，难以在线上快速定位问题
3. **性能瓶颈**：单事务串行 + N+1 查询，大批量操作时可能成为瓶颈

建议按路线图分阶段推进，优先补齐可观测性，再逐步增强协议和性能。

