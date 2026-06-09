# 响应体优化复盘：同步与文档接口字段收缩

日期：2026-06-08
涉及仓库：

- 后端：`F:\yumer-server`
- 前端：`F:\yuediter`

## 1. 背景

本次优化承接提交 `91173f9b93154b616c868cf12a341743dd423a52` 中未完成的“响应体优化”计划。核心问题是：后端多个接口返回了大量前端运行时并不消费的字段，包括内部存储字段、诊断字段、幂等回放字段和默认值字段。

本次没有盲目删字段，而是先从前端真实消费点出发，逐个确认字段用途，再做最小安全收缩。重点检查了：

- `blocks/batch`
- `documents/:docId/sync-reconcile`
- `documents/:docId/sync-session/renew`
- 文档详情/公开详情/快照/版本列表等 document projection 响应

## 2. 总体设计原则

### 2.1 只保留前端运行时真正需要的字段

字段是否保留以实际消费为准，而不是以后端实体、数据库表或历史 DTO 为准。

### 2.2 内部字段不穿透 API

例如数据库主键、snapshotId、rootBlockId、blockVersionMap、metadata、sessionId/sessionEpoch 等，如果只是后端内部或请求身份字段，不在响应中继续暴露。

### 2.3 默认值字段允许省略

对于语义明确的默认值，本次采用“缺省即默认”的响应契约：

- `needsReload` 缺省表示 `false`
- `conflicts` 缺省表示 `[]`
- `results` 缺省表示 `[]`
- `results[*].success` 缺省表示 `true`
- `success:false` 必须返回

前端在接口入口做归一化，业务代码继续拿完整结构，避免到处判空。

### 2.4 错误/冲突路径保留必要信息

成功路径可以省略默认值，但冲突、失败、reload 等路径仍需保留：

- `needsReload:true`
- 非空 `conflicts`
- `success:false`
- `error`
- `diagnosticCode`
- `matchBy`
- `tombstoned:true`

## 3. 接口级变更明细

## 3.1 `POST /blocks/batch`

### 原响应形态

成功 create ack 原来大致为：

```json
{
  "acceptedBatchId": "batch_xxx",
  "appliedAt": 1780920000000,
  "serverHead": 1,
  "draftRevision": 1,
  "ackedThroughOpSeq": 42,
  "needsReload": false,
  "conflicts": [],
  "results": [
    {
      "operation": "create",
      "success": true,
      "clientId": "client_1",
      "blockId": "block_1",
      "sortKey": "001500",
      "version": 2
    }
  ]
}
```

### 当前响应形态

成功 create ack 现在大致为：

```json
{
  "serverHead": 1,
  "draftRevision": 1,
  "ackedThroughOpSeq": 42,
  "results": [
    {
      "operation": "create",
      "clientId": "client_1",
      "blockId": "block_1",
      "sortKey": "001500"
    }
  ]
}
```

如果没有 `ackedThroughOpSeq`，该字段也继续省略。

### 字段变更表

| 字段 | 原来 | 现在 | 原因 |
|---|---|---|---|
| `acceptedBatchId` | 总是返回 | 删除 | 前端只用于日志/trace；请求侧已有 `clientBatchId`，响应回显无运行时价值 |
| `appliedAt` | 总是返回 | 删除 | 前端未使用；后端 receipt 仍内部记录时间，但不暴露给 API |
| `serverHead` | 返回 | 保留 | 前端用于推进 `baseVersion` |
| `draftRevision` | 返回 | 保留 | 前端用于推进草稿修订号 |
| `ackedThroughOpSeq` | 有时返回 | 保留，有值才返回 | 前端用于推进 session ack 高水位 |
| `needsReload:false` | 显式返回 | 省略 | 缺省即 `false`，减少成功路径体积 |
| `needsReload:true` | 显式返回 | 保留 | reload/冲突路径必须明确表达 |
| `conflicts:[]` | 显式返回 | 省略 | 缺省即空数组 |
| 非空 `conflicts` | 返回 | 保留 | 前端需要判断 session lost / version conflict |
| `results:[]` | 显式返回 | 省略 | 缺省即空数组；非空批次正常仍会返回 results |
| `results[*].success:true` | 显式返回 | 省略 | 缺省即成功 |
| `results[*].success:false` | 显式返回 | 保留 | 失败必须明确表达 |
| `results[*].version` | 返回 | 删除 | 前端运行时不依赖；只是历史诊断字段 |
| `results[*].operation` | 返回 | 保留 | 前端 reducer、failure summary、ack mapping 依赖 |
| `results[*].clientId` | 按需返回 | 保留 | create/delete ack 和前端映射依赖 |
| `results[*].blockId` | 按需返回 | 保留 | create ack、服务端 blockId 回填依赖 |
| `results[*].sortKey` | 按需返回 | 保留 | 服务端最终排序键回填依赖 |
| `results[*].error` | 失败时返回 | 保留 | failure summary 依赖 |
| `results[*].diagnosticCode` | 按需返回 | 保留 | create/delete tombstone 诊断依赖 |
| `results[*].matchBy` | 按需返回 | 保留 | delete 命中方式诊断依赖 |
| `results[*].tombstoned:true` | 按需返回 | 保留 | create/delete tombstone 补偿逻辑依赖 |
| `results[*].tombstoned:false` | 可能显式/undefined | 省略 | 缺省即 false |

### 后端实现

主要改动：

- `src/modules/blocks/dto/sync-batch-response.dto.ts`
  - 删除 `acceptedBatchId`
  - 删除 `appliedAt`
  - 删除 `version`
  - 将 `needsReload/conflicts/results/success` 改为可选语义
- `src/modules/blocks/blocks.service.ts`
  - `buildBatchResponse()` 统一做响应瘦身
  - `success:true` 过滤掉
  - `needsReload:false` 过滤掉
  - 空数组 `conflicts/results` 过滤掉
  - `undefined` 字段过滤掉
  - receipt 入库仍保留内部所需字段：`acceptedBatchId/appliedAt/conflicts/results/needsReload`
  - replay 时按新响应契约重新 map

### 前端实现

主要改动：

- `F:\yuediter\src\services\sync\api.ts`
  - 删除 `SyncBatchResponse.acceptedBatchId/appliedAt`
  - 新增 `RawSyncBatchResponse` / `RawSyncBatchResult`
  - 新增 `normalizeSyncBatchResponse()`：
    - `needsReload ?? false`
    - `conflicts ?? []`
    - `results ?? []`
    - `result.success ?? true`
- `F:\yuediter\src\hooks\useDocumentSync.ts`
  - trace/log 不再读取 `response.acceptedBatchId`
  - 改用本地 `clientBatchId`
  - trace 不再记录 `result.version`
- `F:\yuediter\src\services\sync\types.ts`
  - 删除 `SyncBatchResult.version`
- `F:\yuediter\src\services\sync\debug-log.ts`
  - batch response 摘要不再记录 `acceptedBatchId/version`
- `F:\yuediter\src\services\sync\__tests__\debug-log.test.ts`
  - 测试样例同步删除 `acceptedBatchId/appliedAt`

### 是否有影响

对前端业务逻辑无预期影响，因为：

1. 运行时依赖字段仍保留。
2. 被删除的字段要么只用于日志，要么完全未消费。
3. 默认值字段在前端 API 层统一补齐，业务层仍看到完整语义。

需要注意：如果外部第三方直接调用 `/blocks/batch` 并依赖 `acceptedBatchId/appliedAt/success:true/version`，会受到响应契约变化影响。当前项目内前端已同步适配。

## 3.2 `POST /documents/:docId/sync-reconcile`

### 原响应形态

```json
{
  "docId": "doc_1",
  "checkedAt": 1780920000000,
  "draftRevision": 8,
  "needsReload": false,
  "conflicts": [],
  "tombstoned": []
}
```

### 当前响应形态

```json
{
  "draftRevision": 8,
  "needsReload": false,
  "conflicts": [],
  "tombstoned": []
}
```

### 字段变更表

| 字段 | 原来 | 现在 | 原因 |
|---|---|---|---|
| `docId` | 返回 | 删除 | URL 已包含 docId，前端运行时不消费响应中的 docId |
| `checkedAt` | 返回 | 删除 | 前端运行时不消费；后端 receipt 内部仍保存 |
| `draftRevision` | 返回 | 保留 | 前端用于更新本地 draftRevision |
| `needsReload` | 返回 | 保留 | 前端冲突/reload 判断依赖 |
| `conflicts` | 返回 | 保留 | session lost / stale revision 判断依赖 |
| `tombstoned` | 返回 | 保留 | manifest reconcile tombstone watcher 依赖 |

### 后端实现

- `src/modules/documents/documents.service.ts`
  - `SyncReconcileResponse` 删除 `docId/checkedAt`
  - `saveSyncReconcileReceipt()` 改为通过参数 `checkedAt` 入库，不再从 response 读取
  - replay response 同样不再返回 `docId/checkedAt`

### 前端实现

- `F:\yuediter\src\services\sync\api.ts`
  - `SyncManifestReconcileResponse` 删除 `docId/checkedAt`

### 是否有影响

对项目内前端无预期影响。前端只消费：

- `draftRevision`
- `needsReload`
- `conflicts`
- `tombstoned`

## 3.3 `POST /documents/:docId/sync-session/renew`

### 原响应形态

```json
{
  "sessionId": "session_1",
  "sessionEpoch": 1,
  "leaseExpiresAt": "2026-06-08T14:00:00.000Z",
  "lastAckedOpSeq": 7
}
```

### 当前响应形态

```json
{
  "leaseExpiresAt": "2026-06-08T14:00:00.000Z",
  "lastAckedOpSeq": 7
}
```

### 字段变更表

| 字段 | 原来 | 现在 | 原因 |
|---|---|---|---|
| `sessionId` | 返回 | 删除 | 请求中已带身份；续租不需要回显 |
| `sessionEpoch` | 返回 | 删除 | 请求中已带身份；续租不需要回显 |
| `leaseExpiresAt` | 返回 | 保留 | 前端续租状态需要更新时间 |
| `lastAckedOpSeq` | 返回 | 保留 | 前端需要恢复/更新 ack 高水位 |

### 后端实现

- `src/modules/documents/documents.service.ts`
  - 新增 `buildSyncSessionRenewResponse()`
  - `renewSyncSession()` 返回 `leaseExpiresAt/lastAckedOpSeq`

### 前端实现

- `F:\yuediter\src\services\document.ts`
  - 新增 `RenewSyncSessionResponse`
  - `renewSyncSession()` 返回类型改为 `Promise<RenewSyncSessionResponse>`

### 是否有影响

对前端无预期影响。前端续租时原本只消费：

- `leaseExpiresAt`
- `lastAckedOpSeq`

## 3.4 文档公开详情响应

### 原响应问题

公开详情沿用内部 document detail projection，可能带出编辑协议/内部字段，例如：

- `workspaceId`
- `rootBlockId`
- `head`
- `draftRevision`
- `publishedSnapshotId`
- `createdBy`
- `updatedBy`

### 当前响应

公开详情只返回公开文档元信息和公开 actor 摘要：

- `docId`
- `title/icon/cover`
- `status/visibility`
- `parentId/sortOrder/tags/category`
- `publishedHead/viewCount/favoriteCount`
- `createdAt/updatedAt`
- `creator/updater`

### 影响

公开页面不需要编辑协议字段，删除后降低公开 API 暴露面。若有外部消费者依赖公开接口中的编辑字段，会受影响；项目内前端已按公开信息使用。

## 3.5 文档快照创建响应

### 原响应问题

创建 snapshot 后直接返回过多存储内部字段，例如：

- `id`
- `snapshotId`
- `rootBlockId`
- `blockVersionMap`
- `metadata`

### 当前响应

只返回快照摘要：

```json
{
  "docId": "doc_1",
  "docVer": 4,
  "createdAt": 1700000000000,
  "kind": "manual",
  "pinned": true,
  "retainUntil": null
}
```

### 影响

前端创建快照后只需要展示/确认摘要，不需要存储内部结构。删除内部字段可降低响应体积和数据暴露面。

## 3.6 文档版本列表响应

本次将版本列表、文档详情等 projection 从 service 内部临时类型迁移为正式 DTO：

- `DocumentListItemResponse`
- `DocumentDetailResponse`
- `PublicDocumentDetailResponse`
- `DocumentRevisionListItemResponse`
- `DocumentSnapshotResponse`
- `DocumentActorSummaryResponse`

目的：让响应契约显式化，避免 controller/service 直接返回 entity 或临时交叉类型。

## 4. 为什么要这样优化

### 4.1 降低同步高频接口成本

`blocks/batch` 是高频接口，autosync 场景下可能频繁请求。每次少返回：

- 顶层默认字段
- 每个 result 的 `success:true`
- 未使用的 `version`
- 回显型 `acceptedBatchId`
- 时间戳 `appliedAt`

可以减少网络体积、日志体积和调试包体积。

### 4.2 减少 API 暴露面

公开文档、快照等接口不应泄露存储内部字段。响应越接近前端真实需要，越不容易形成错误依赖。

### 4.3 提高契约稳定性

正式 DTO 替代临时类型后，哪些字段是 API 契约更清楚。后续扩展/删除字段可以围绕 DTO 和测试做。

## 5. 兼容性与风险

### 5.1 项目内前端

项目内前端已同步适配：

- `blocks/batch` 在 API 层归一化 raw response
- `sync-reconcile` 类型删除 `docId/checkedAt`
- `sync-session/renew` 类型只保留续租实际字段
- trace/debug log 使用本地 `clientBatchId`

因此项目内运行时无预期影响。

### 5.2 外部调用方

如果有外部调用方依赖旧字段，则会受影响，尤其是：

- `blocks/batch.acceptedBatchId`
- `blocks/batch.appliedAt`
- `blocks/batch.results[*].success === true`
- `blocks/batch.results[*].version`
- `sync-reconcile.docId`
- `sync-reconcile.checkedAt`
- `sync-session/renew.sessionId/sessionEpoch`

建议如果存在外部 API 消费方，需要提前公告或加版本策略。

### 5.3 默认值省略策略的注意事项

默认值省略必须满足两个条件：

1. 语义明确，不会产生歧义。
2. 前端入口统一归一化，业务层不直接消费 raw response。

目前 `blocks/batch` 已满足。

## 6. 验证记录

后端：

```bash
pnpm build
```

结果：通过。

```bash
pnpm test -- --runTestsByPath src/modules/blocks/blocks-sync-idempotency.spec.ts src/modules/documents/documents.service.spec.ts src/modules/documents/documents.controller.spec.ts --runInBand
```

结果：通过，`88 passed`。

前端：

```bash
pnpm test:unit -- src/services/sync/__tests__/debug-log.test.ts
```

结果：通过，`4 passed`。

另外对本次涉及的前端 sync 文件执行 TypeScript 过滤检查，未发现这些文件的新增类型错误。完整 `tsc --noEmit` 仍受既有 `@tiptap/extension-document`、`@tiptap/extension-paragraph`、`@tiptap/extension-text` 缺失影响，这不是本次改动引入。

## 7. 后续建议

1. 可以继续把 `sync-reconcile` 也改成默认值省略：例如 `needsReload:false`、`conflicts:[]`、`tombstoned:[]`，前端同样在入口归一化。
2. 可以继续检查 `draft-checkpoint`，它也有 `appliedAt/needsReload/conflicts/mappings/tombstoned` 这类可按默认值策略优化的字段。
3. 如果 API 有外部消费者，建议把这次变更写入 API changelog。
4. 可以为“默认值省略响应”抽一个统一 helper，避免不同接口各自手写过滤规则。

## 8. 本次结论

本次优化不是单纯删字段，而是把高频同步接口和文档 projection 响应从“后端实体/内部过程输出”调整为“前端运行时契约输出”。

最明显的收益在 `blocks/batch`：成功路径响应变短，且每个成功 result 不再重复传 `success:true`。同时通过前端入口归一化，保留业务层代码的稳定性。
