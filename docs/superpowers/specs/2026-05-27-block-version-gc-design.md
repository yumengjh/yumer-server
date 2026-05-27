# 块版本 GC 设计

<!-- cspell:words varchar timestamptz -->

> 状态：待用户评审
> 日期：2026-05-27
> 仓库：E:\workspace\yuweb\back\server

## 1. 背景与问题

当前系统已经把文档正式版本和草稿工作副本都建模成块版本映射：

- `doc_snapshots.blockVersionMap`：正式文档版本读取哪些 `block_versions`。
- `document_drafts.blockVersionMap`：当前草稿读取哪些 `block_versions`。
- `block_versions`：统一的块内容版本池。

这给版本块 GC 提供了明确的引用图。问题是，如果直接按时间或 `Block.isDeleted` 删除旧块版本，很容易误删仍被历史版本、发布版本或草稿引用的数据。第一版 GC 因此必须是温和的、可观测的、不可破坏的。

## 2. 目标

第一版只实现块版本 GC 的统计和预览能力：

1. 新增独立 `GcModule`，不侵入 `DocumentsService` 和 `BlocksService` 的写入链路。
2. 支持扫描 `block_versions`，判断哪些版本被正式快照或草稿引用。
3. 暴露内部 API，返回 root 覆盖情况、候选数量、候选原因、运行记录。
4. 记录每次 GC preview 的 run 和可选 candidate 明细，便于持续观察数据膨胀趋势。
5. 保持 dry-run-only，第一版不提供任何删除、软删除、归档、压缩或 sweep API。
6. 把 GC 框架做成可扩展结构，后续可以接入草稿、文档、图片、资源、HTML 缓存等 collector。

## 3. 非目标

第一版明确不做：

1. 不物理删除 `block_versions`。
2. 不修改 `blocks`、`documents`、`doc_snapshots`、`document_drafts` 的业务写入语义。
3. 不引入定时任务、队列、后台 worker。
4. 不做文档 GC、草稿 GC、图片 GC、资源 GC、HTML 缓存 GC。
5. 不基于 `DocRevision.createdAt` 反推引用关系。
6. 不把 `documents.head` 或 `Block.isDeleted` 当成块版本可达性的事实来源。

## 4. 已确认原则

1. **v1 只做统计和预览。** 没有任何删除路径，接口层和 service 层都不暴露 sweep。
2. **引用图必须显式。** 块版本是否可达，只看 `doc_snapshots.blockVersionMap` 和 `document_drafts.blockVersionMap` 这类明确引用。
3. **草稿是正式 GC root。** 只要 `document_drafts` 行存在，其 `blockVersionMap` 引用的块版本就绝不能被候选化。
4. **保守保留近期数据。** 即使某块版本未被显式 root 引用，只要它足够新，或属于某个 block 最近的若干个版本，也不进入候选区。
5. **缺快照覆盖则阻断。** 如果 `doc_revisions` 和 `doc_snapshots` 的不变量不满足，GC preview 应返回 blocked/degraded 状态，不输出可执行候选。
6. **运行可审计。** 每次 preview 都记录 policy snapshot、scope、summary、health 和候选原因。

## 5. 数据事实与引用边界

### 5.1 当前事实来源

| 表                | 在 GC v1 中的角色                                         |
| ----------------- | --------------------------------------------------------- |
| `block_versions`  | 被分析的资源，resource key 为 `versionId = blockId@ver`   |
| `doc_snapshots`   | 正式版本 root 来源，读取 `blockVersionMap`                |
| `document_drafts` | 草稿 root 来源，读取 `blockVersionMap`                    |
| `documents`       | 只用于 scope 过滤、发布快照一致性健康检查                 |
| `blocks`          | 只用于识别当前 latest version 和每个 block 的近期版本保留 |
| `doc_revisions`   | 只用于检查 snapshot 覆盖不变量                            |

### 5.2 不作为 root 的字段

- `documents.head` 不直接作为 root。它必须通过 `doc_snapshots(docId, docVer=head)` 表达引用关系。
- `documents.publishedHead` 不直接作为 root。发布内容必须通过 `publishedSnapshotId` 指向的快照表达引用关系。
- `Block.isDeleted` 不直接决定 `block_versions` 是否可删除。它只是当前块状态，不是历史引用图。

## 6. 总体架构

新增 `GcModule`，作为独立后端模块：

```text
GcModule
├─ GcController
├─ GcRunService
├─ GcPolicyService
├─ GcHealthService
├─ collectors/
│  └─ BlockVersionGcCollector
└─ shared/
   ├─ GcCollector interface
   ├─ GcScope / GcPolicy / GcSummary types
   └─ resource key helpers
```

### 6.1 分层职责

| 单元                      | 职责                                                                   |
| ------------------------- | ---------------------------------------------------------------------- |
| `GcController`            | 暴露内部 API，使用 `SystemAdminTokenGuard`                             |
| `GcRunService`            | 创建 run、调用 collector、写入 run summary 和 candidate 明细           |
| `GcPolicyService`         | 给出 block version GC 默认策略，并把策略快照写入 run                   |
| `GcHealthService`         | 检查快照覆盖、发布快照指针、root 引用缺失                              |
| `BlockVersionGcCollector` | 计算 `block_versions` 的 hard roots、policy retained set 和 candidates |

### 6.2 Collector 接口

第一版只有 `block_version` collector，但接口需要支持后续资源扩展：

```ts
interface GcCollector {
  readonly resourceType: string;
  preview(scope: GcScope, policy: GcPolicy): Promise<GcCollectorResult>;
}
```

后续 `document_draft`、`asset`、`block_render_cache` 等 collector 只需要实现同一接口，共用 run/audit/API 基础设施。

## 7. 数据模型

新增两张通用 GC 表。

### 7.1 `gc_runs`

用于记录一次 GC preview 的元信息和统计摘要。

```text
gc_runs
├─ id
├─ runId                  unique string
├─ resourceType            block_version | future resource types
├─ mode                    preview
├─ status                  running | completed | blocked | failed
├─ scope                   json/jsonb
├─ policySnapshot          json/jsonb
├─ health                  json/jsonb
├─ summary                 json/jsonb
├─ candidateDetailsStored  boolean
├─ candidateDetailsTruncated boolean
├─ triggeredBy             varchar
├─ startedAt               datetime/timestamptz
├─ finishedAt              datetime/timestamptz nullable
├─ errorMessage            text nullable
└─ createdAt               datetime/timestamptz
```

`scope` 示例：

```json
{
  "workspaceId": "ws_1",
  "docId": null
}
```

`summary` 示例：

```json
{
  "blockVersionsScanned": 12000,
  "hardRootedBlockVersions": 9800,
  "policyRetainedBlockVersions": 1600,
  "candidateBlockVersions": 600,
  "rootSources": {
    "docSnapshots": 420,
    "documentDrafts": 18
  },
  "candidateReasons": {
    "unreferenced_older_than_policy": 600
  }
}
```

### 7.2 `gc_run_candidates`

用于按 run 保存候选明细。为避免 GC 表自身膨胀，候选明细可以按 policy 限制最大保存数量；超出时 `gc_runs.candidateDetailsTruncated = true`。

```text
gc_run_candidates
├─ id
├─ runId
├─ resourceType            block_version
├─ resourceKey             versionId, e.g. b_xxx@3
├─ resourceRowId           block_versions.id
├─ docId
├─ workspaceId
├─ blockId
├─ blockVer
├─ versionCreatedAt
├─ reasonCode
├─ reasonDetail            json/jsonb
├─ riskLevel               low | medium | high
└─ createdAt
```

第一版候选只用于统计，不代表可以删除。`riskLevel` 默认应为 `medium`，只有未来引入更完整 sweep gate 后才允许转为低风险删除。

## 8. 可达性与保留策略

### 8.1 Canonical key

块版本统一使用 `versionId = blockId@ver` 作为 GC 资源 key。内部可以额外保存 `block_versions.id` 作为行级定位字段，但跨表统计、root set、candidate set 都使用 `versionId`。

### 8.2 Hard roots

必须保留的显式引用：

1. 所有 `doc_snapshots.blockVersionMap` 中的 `blockId + ver`。
2. 所有 `document_drafts.blockVersionMap` 中的 `blockId + ver`。

只要一个 `versionId` 出现在 hard roots 中，就不可能成为 candidate。

### 8.3 Policy retained set

为了第一版温和，除了 hard roots，还额外保留：

1. `gracePeriodDays = 30`：创建时间在 30 天内的块版本。
2. `keepLatestPerBlock = 5`：每个 `blockId` 最近 5 个版本。
3. `Block.latestVer` 指向的当前最新版本，即使它不在 snapshot 中，也必须保留。

这些值由 `GcPolicyService` 提供，并写入每次 run 的 `policySnapshot`。后续可以把来源切换为 `runtime_configs`，collector 不应依赖策略来源。

### 8.4 Candidate 定义

一个 `block_versions` 行同时满足以下条件时，才进入候选统计：

1. 在当前 scope 内。
2. 不在 hard roots 中。
3. 不在 policy retained set 中。
4. 对应 root coverage 健康检查没有阻断。

第一版候选只是“如果未来允许删除，可能优先观察的对象”，不执行删除。

## 9. 内部 API

所有 API 都使用 `SystemAdminTokenGuard`，请求必须带 `x-system-admin-token`。可选 `x-operator-id` 用于写入 `triggeredBy`；未提供时使用请求 IP 或 `system_admin`。

### 9.1 创建 preview run

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

规则：

- `workspaceId` 和 `docId` 都可选。
- 两者都传时，`docId` 必须属于该 workspace，否则返回 400。
- `includeCandidates` 控制是否保存 candidate 明细；summary 总是保存。
- v1 只允许 preview mode，不接受 sweep/delete 参数。

响应：

```json
{
  "runId": "gc_run_20260527_xxx",
  "resourceType": "block_version",
  "mode": "preview",
  "status": "completed",
  "scope": {
    "workspaceId": "ws_1",
    "docId": "doc_1"
  },
  "policySnapshot": {
    "gracePeriodDays": 30,
    "keepLatestPerBlock": 5,
    "rootSources": ["doc_snapshots", "document_drafts"]
  },
  "health": {
    "status": "ok",
    "missingRevisionSnapshots": 0,
    "missingPublishedSnapshots": 0,
    "missingRootBlockVersions": 0
  },
  "summary": {
    "blockVersionsScanned": 120,
    "hardRootedBlockVersions": 96,
    "policyRetainedBlockVersions": 20,
    "candidateBlockVersions": 4
  }
}
```

### 9.2 查询 run 列表

```http
GET /admin/gc/block-versions/runs?page=1&pageSize=20&status=completed
```

返回最近 preview run，支持按 `workspaceId`、`docId`、`status` 过滤。

### 9.3 查询 run 详情

```http
GET /admin/gc/block-versions/runs/:runId
```

返回 `gc_runs` 的完整详情，包括 `scope`、`policySnapshot`、`health`、`summary`、错误信息。

### 9.4 查询候选明细

```http
GET /admin/gc/block-versions/runs/:runId/candidates?page=1&pageSize=100
```

只返回该 run 已保存的 candidate 明细。如果 run 没有保存候选明细，返回空列表并标记 `candidateDetailsStored=false`。

### 9.5 查询当前健康状态

```http
GET /admin/gc/block-versions/health?workspaceId=ws_1&docId=doc_1
```

返回当前 scope 下是否满足 GC preview 的前置条件：

- `doc_revisions` 是否都有对应 `doc_snapshots`
- `documents.publishedSnapshotId` 是否能找到对应 snapshot
- snapshot/draft 引用的 `versionId` 是否能在 `block_versions` 中找到

## 10. Preview 运行流程

1. Controller 校验内部 token 和 scope。
2. `GcRunService` 创建 `gc_runs` 记录，状态为 `running`。
3. `GcPolicyService` 生成 policy snapshot。
4. `GcHealthService` 执行 coverage 检查。
5. 如果健康检查出现 blocker，run 状态改为 `blocked`，写入 health 和 summary，不生成 candidates。
6. `BlockVersionGcCollector` 读取 hard roots。
7. Collector 读取 policy retained set。
8. Collector 扫描 scope 内 `block_versions`，计算候选统计和可选候选明细。
9. `GcRunService` 写入 summary、candidate 明细、finishedAt，状态改为 `completed`。
10. API 返回 run detail。

## 11. 错误处理与保护措施

1. **缺快照不继续候选化。** 只要发现 `doc_revisions` 缺对应 snapshot，run 状态为 `blocked`。
2. **root 引用缺失不吞掉。** 如果 snapshot/draft map 指向不存在的 `block_versions`，run 状态为 `blocked`，health 中记录数量和样例。
3. **候选明细可截断。** summary 仍保留真实数量，明细超过上限时标记 `candidateDetailsTruncated=true`。
4. **并发写入不阻塞编辑。** v1 是统计工具，不加业务写锁，不影响编辑、发布、草稿提交。
5. **不做任何源表 mutation。** v1 只写 `gc_runs` 和 `gc_run_candidates`。
6. **未来 sweep 需要二次确认。** 如果后续加入删除能力，必须重新读取 roots 并二次确认候选仍不可达，不能直接复用旧 preview 结果删除。

## 12. 与现有模块边界

GC 模块不调用以下业务服务：

- `DocumentsService`
- `BlocksService`
- `DocumentDraftService`

原因是这些服务包含权限、写入、渲染、活动日志等业务副作用。GC 只需要稳定的数据投影，应直接通过 repository 读取实体，并把引用图计算逻辑保持为纯读。

GC 模块可以复用实体和小工具函数，例如 `generateVersionId(blockId, ver)`，但不能把 GC 判断逻辑反向塞回文档或块写路径。

## 13. 后续扩展路线

同一套 run/audit/safety 框架后续可以挂更多 collector：

1. `block_render_cache`：清理可重建的 HTML 缓存，策略可以更激进。
2. `document_draft`：引入 draft status 后，清理 discarded/expired 草稿。
3. `asset` / `image`：基于块 payload refs、`assets.refCount`、对象存储状态做两阶段清理。
4. `doc_snapshot`：在块版本 GC 稳定后，再讨论旧快照压缩或快照保留策略。
5. `block_version_sweep`：在 preview 数据连续稳定后，增加受保护的物理删除流程。

## 14. 验收标准

第一版实现完成时应满足：

1. 存在独立 `GcModule`。
2. 可以创建 block version GC preview run。
3. Preview run 不修改任何业务源表。
4. `doc_snapshots` 和 `document_drafts` 都被纳入 hard root。
5. 缺快照、缺发布快照、root 指向缺失块版本时，run 返回 blocked。
6. run summary 能统计 scanned、hard rooted、policy retained、candidate 数量。
7. 候选明细能按 run 分页查询，且明确标记是否被截断。
8. 内部 API 受 `x-system-admin-token` 保护。
9. 单元测试覆盖 root 计算、policy retained、blocked health、run 持久化和 API 鉴权。
10. `pnpm test` 和 `pnpm build` 通过。
