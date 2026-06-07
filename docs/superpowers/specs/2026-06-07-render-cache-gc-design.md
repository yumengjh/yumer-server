# Render Cache GC 设计

> 状态：proposal  
> 日期：2026-06-07  
> 范围：后端 GC 系统中的块级 HTML 渲染缓存清理  
> 相关目录：`src/modules/gc/modules/*`、`src/modules/documents/services/document-render.service.ts`

## 1. 背景

当前后端已经有块级 HTML 渲染缓存表：

```text
block_render_caches
├─ blockVersionId
├─ docId
├─ blockId
├─ blockVer
├─ renderVersion
├─ html
├─ status
├─ error
└─ renderedAt
```

它的主要目的不是保存历史内容，也不是做长期归档，而是保护公开/发布文档内容接口：

> 公开文档被访问时，不要每次都把发布快照中的块内容重新渲染成 HTML。

缓存是 `blockVersionId + renderVersion` 的派生产物。只要底层块版本仍在，缓存缺失时系统可以重新渲染并回填。因此渲染缓存 GC 不需要像版本块 GC 一样保守，也不需要 TTL 驱动。

本设计采用“发布可达性”作为唯一核心保留规则：

> 只保留当前发布快照可达的、当前渲染器版本生成的缓存；其他缓存都可以清理。

## 2. 设计目标

1. **保护公开文档接口性能**：保留当前发布版本真正会被公开访问读取的缓存。
2. **积极清理派生物**：未发布文档、旧发布版本、草稿版本、历史修订版本、旧渲染器版本的缓存都可删除。
3. **无 TTL 策略**：不用“过期时间”判断缓存是否保留；有用就留，没用就删。
4. **缺失可恢复**：如果缓存被删但后续又需要，内容接口自动重新渲染并回填。
5. **独立 GC 模块**：渲染缓存有自己的 GC 模块和运维接口，不混入 storage maintenance。
6. **与发布流程协同**：发布和取消发布后可触发轻量即时清理，但仍保留后台 GC 兜底扫描。

## 3. 非目标

- 不引入 TTL、LRU、访问时间热度统计。
- 不把渲染缓存写入 `gc_candidate_pool`。
- 不为每一条缓存建立复杂候选生命周期。
- 不把渲染缓存 GC 放入 `storage_gc`。
- 不把渲染缓存作为历史快照或审计记录保留。

## 4. 核心保留规则

一条 `block_render_caches` 记录只有同时满足以下条件才应该保留：

```text
1. 对应 document 当前处于已发布状态
2. document.publishedSnapshotId 非空
3. publishedSnapshot.blockVersionMap 中包含该缓存对应的块版本
4. cache.blockVersionId 等于发布快照中 blockId + blockVer 对应的 block_versions.id
5. cache.renderVersion 等于当前 DOCUMENT_RENDER_VERSION
```

除此之外全部可以清理。

### 4.1 未发布文档

文档满足任一条件时，视为没有当前发布态：

```text
document.publishedHead <= 0
document.publishedSnapshotId is null
document.status = "deleted"
```

此时该文档所有渲染缓存都可以删除：

```sql
DELETE FROM block_render_caches
WHERE docId = :docId;
```

### 4.2 已发布文档

已发布文档的保留集合来自：

```text
documents.publishedSnapshotId
  -> doc_snapshots.snapshotId
  -> doc_snapshots.blockVersionMap
  -> block_versions.id
```

`doc_snapshots.blockVersionMap` 形如：

```json
{
  "block_a": 3,
  "block_b": 7
}
```

需要将其中每个 `(docId, blockId, ver)` 解析为 `block_versions.id`，得到：

```text
publishedBlockVersionIds = Set<number>
```

然后只保留：

```text
cache.docId = docId
AND cache.blockVersionId IN publishedBlockVersionIds
AND cache.renderVersion = DOCUMENT_RENDER_VERSION
```

其他同文档缓存都可删除。

## 5. 模块结构

建议新增独立子模块：

```text
src/modules/gc/modules/render-cache/
├─ dto/
│  ├─ create-render-cache-gc-sweep.dto.ts
│  └─ query-render-cache-gc-status.dto.ts
├─ gc-render-cache.controller.ts
├─ gc-render-cache.module.ts
├─ gc-render-cache.service.ts
├─ gc-render-cache.submodule.ts
└─ *.spec.ts
```

GC 注册树建议：

```text
GC
├─ block_version_gc
├─ render_cache_gc
└─ storage_gc
```

`render_cache_gc` 是独立 root submodule，而不是 `storage_gc` 的子模块。它可以在能力描述里标注依赖：

```ts
{
  key: "render_cache_gc",
  displayName: "Render Cache GC",
  parentKey: null,
  routePrefix: "/admin/gc/render-cache",
  capabilities: {
    sweep: true,
    dryRun: true,
    publishedReachability: true
  }
}
```

## 6. API 设计

所有接口继续复用 `SystemAdminTokenGuard`。

### 6.1 状态查询

```http
GET /admin/gc/render-cache/status
```

可选查询：

```text
workspaceId?: string
docId?: string
```

返回示例：

```json
{
  "renderVersion": "tiptap-static-v1",
  "scope": {
    "workspaceId": null,
    "docId": null
  },
  "summary": {
    "totalCaches": 1840,
    "publishedReachableCaches": 520,
    "deletableCaches": 1320,
    "publishedDocsWithCaches": 8,
    "unpublishedDocsWithCaches": 4,
    "missingPublishedSnapshots": 0
  },
  "deleteReasons": {
    "doc_unpublished": 700,
    "not_in_current_published_snapshot": 500,
    "stale_render_version": 120,
    "published_snapshot_missing": 0,
    "block_version_missing": 0
  }
}
```

### 6.2 清理预演/执行

```http
POST /admin/gc/render-cache/sweep
Content-Type: application/json
```

请求：

```json
{
  "dryRun": true,
  "workspaceId": "ws_1",
  "docId": "doc_1",
  "limit": 1000,
  "confirm": "SWEEP_RENDER_CACHE"
}
```

字段说明：

- `dryRun`：默认 `true`。
- `workspaceId`：可选，限制工作区。
- `docId`：可选，限制单文档。
- `limit`：单次最多删除/预览的缓存行数。
- `confirm`：`dryRun=false` 时必须为 `SWEEP_RENDER_CACHE`。

返回示例：

```json
{
  "runId": "render_cache_gc_1780000000000_abcd1234",
  "resourceType": "block_render_cache",
  "mode": "published_reachability",
  "dryRun": true,
  "status": "completed",
  "summary": {
    "scannedDocs": 12,
    "selectedCaches": 1000,
    "wouldDeleteCaches": 820,
    "deletedCaches": 0,
    "wouldKeepCaches": 180
  },
  "deleteReasons": {
    "doc_unpublished": 400,
    "not_in_current_published_snapshot": 320,
    "stale_render_version": 100
  }
}
```

## 7. Service 行为

建议 service 暴露：

```ts
class GcRenderCacheService {
  getStatus(input: QueryRenderCacheGcStatusInput): Promise<RenderCacheGcStatus>;

  sweepPublishedReachability(
    input: CreateRenderCacheGcSweepInput,
    triggeredBy: string,
  ): Promise<GcRun>;

  sweepDocumentPublishedReachability(
    docId: string,
    triggeredBy: string,
  ): Promise<RenderCacheDocumentSweepResult>;

  clearDocumentRenderCaches(
    docId: string,
    triggeredBy: string,
  ): Promise<RenderCacheDocumentClearResult>;
}
```

### 7.1 `getStatus`

`getStatus` 只统计，不删除。

它需要回答：

- 当前缓存总量。
- 其中多少是当前发布快照可达。
- 多少可以删除。
- 可删除原因分布。

### 7.2 `sweepPublishedReachability`

这是后台 GC 主入口。

流程：

1. 按 scope 找出有缓存的 `docId`。
2. 查询对应 `Document`。
3. 对每个文档计算保留集合。
4. 找出可删除缓存，受 `limit` 限制。
5. `dryRun=true` 时只返回统计。
6. `dryRun=false` 时要求确认字符串并执行删除。
7. 写入 `gc_runs`。

### 7.3 `sweepDocumentPublishedReachability`

这是发布流程可调用的轻量入口。

它只处理单文档：

- 如果文档未发布：删除该文档全部缓存。
- 如果文档已发布：只保留当前发布快照可达且当前 renderVersion 的缓存。

发布流程调用失败不应该影响 publish 成功。

### 7.4 `clearDocumentRenderCaches`

这是取消发布流程可调用的入口。

取消发布后没有当前公开可读版本，因此直接删除：

```text
docId 下全部 block_render_caches
```

取消发布流程调用失败不应该影响 unpublish 成功。

## 8. 与发布流程协同

### 8.1 发布成功后

`DocumentsService.publishVersion()` 完成事务并更新：

```text
documents.publishedHead
documents.publishedSnapshotId
```

之后可以 best-effort 调用：

```ts
await this.renderCacheGcService
  ?.sweepDocumentPublishedReachability(docId, userId)
  .catch((error) => this.logger.warn(...));
```

该调用不应放在发布事务内。

原因：

- 发布事务只负责发布状态一致性。
- 渲染缓存是派生物，清理失败可以由后台 GC 兜底。
- 不应让缓存清理影响发布成功。

### 8.2 取消发布成功后

`DocumentsService.unpublish()` 完成事务并清空：

```text
documents.publishedHead = 0
documents.publishedSnapshotId = null
```

之后 best-effort 调用：

```ts
await this.renderCacheGcService
  ?.clearDocumentRenderCaches(docId, userId)
  .catch((error) => this.logger.warn(...));
```

### 8.3 后台兜底

即使发布/取消发布时有即时清理，仍需要后台接口：

```http
POST /admin/gc/render-cache/sweep
```

原因：

- 历史缓存已经存在。
- 发布流程中的 best-effort 清理可能失败。
- 运维面板需要 dry-run 和全局扫描能力。

## 9. 与 block version GC 的协同

版本块物理删除时，可以顺手删除对应渲染缓存：

```sql
DELETE FROM block_render_caches
WHERE blockVersionId = :deletedBlockVersionId;
```

这应该作为 `block_version_gc` 的辅助清理，而不是 render cache GC 的主机制。

主机制仍然是发布可达性：

```text
当前发布快照需要的缓存保留，不需要的缓存删除。
```

## 10. 删除原因分类

建议统一使用以下 delete reason：

```ts
type RenderCacheDeleteReason =
  | "doc_unpublished"
  | "document_missing"
  | "document_deleted"
  | "published_snapshot_missing"
  | "not_in_current_published_snapshot"
  | "stale_render_version"
  | "block_version_missing";
```

优先级建议：

1. `document_missing`
2. `document_deleted`
3. `doc_unpublished`
4. `published_snapshot_missing`
5. `stale_render_version`
6. `block_version_missing`
7. `not_in_current_published_snapshot`

同一条缓存只记录一个主原因，便于统计稳定。

## 11. 数据一致性与事务边界

### 11.1 不要求强一致

渲染缓存是可重建派生物。GC 与公开访问并发时可能发生：

- GC 删除缓存。
- 公开接口发现缓存缺失。
- 公开接口重新渲染并回填。

这是可接受行为。

### 11.2 删除操作可以分批

`limit` 应限制单次处理量，避免一次删除过多行。

### 11.3 不进入 candidate pool

渲染缓存不需要候选池原因：

- 无业务引用价值。
- 删除风险低。
- 缺失可自动恢复。
- 发布可达性可以实时计算。

## 12. gc_runs 记录

建议复用 `gc_runs`，但不复用 `gc_candidate_pool`。

字段建议：

```text
resourceType = "block_render_cache"
mode = "sweep"
scope = {
  mode: "published_reachability",
  workspaceId,
  docId,
  dryRun
}
summary = {
  scannedDocs,
  selectedCaches,
  wouldDeleteCaches,
  deletedCaches,
  wouldKeepCaches,
  deleteReasons
}
```

这样 GC 调试页可以统一展示 run 历史，同时避免为派生缓存设计过重的候选状态机。

## 13. 测试计划

### 13.1 Service 单测

覆盖：

1. 未发布文档：删除/预览该文档全部缓存。
2. 已发布文档：只保留发布快照 map 中对应的 `blockVersionId`。
3. 旧发布版本缓存：被标记为 `not_in_current_published_snapshot`。
4. 旧 `renderVersion`：被标记为 `stale_render_version`。
5. 发布快照缺失：该文档缓存可删除，原因 `published_snapshot_missing`。
6. block version 缺失：缓存可删除，原因 `block_version_missing`。
7. `dryRun=true` 不执行删除。
8. `dryRun=false` 无确认字符串时拒绝。

### 13.2 Controller 单测

覆盖：

1. operator 从 `x-operator-id` 读取。
2. 无 operator 时使用 request ip。
3. status/sweep 参数透传。

### 13.3 发布流程协同测试

覆盖：

1. `publishVersion()` 成功后 best-effort 调用单文档清理。
2. 清理失败不影响发布结果。
3. `unpublish()` 成功后 best-effort 清理整篇文档缓存。
4. 清理失败不影响取消发布结果。

### 13.4 block version GC 协同测试

覆盖：

1. 物理删除 block version 时删除同 `blockVersionId` 的 render cache。
2. dry-run 不删除 render cache。

## 14. 实现顺序

### Phase A：独立模块与状态查询

1. 新增 `render-cache` GC 模块。
2. 注册 `GcRenderCacheSubmodule`。
3. 实现 `GET /admin/gc/render-cache/status`。
4. 单测状态统计。

### Phase B：发布可达性 sweep

1. 实现 `POST /admin/gc/render-cache/sweep`。
2. 支持 `dryRun`、`limit`、`workspaceId`、`docId`。
3. 复用 `gc_runs` 记录结果。
4. 单测 dry-run 和真实删除。

### Phase C：发布/取消发布协同

1. `publishVersion()` 成功后 best-effort 调用单文档可达性清理。
2. `unpublish()` 成功后 best-effort 删除该文档全部缓存。
3. 清理失败只记录日志。

### Phase D：block version GC 辅助清理

1. `deleteBlockVersionCandidate()` 真实删除版本块时，同步删除对应 render cache。
2. dry-run 不删除。
3. 补充单测。

## 15. 最终原则

渲染缓存 GC 的原则可以简化为：

> 发布接口当前可能用到的缓存保留；其他缓存删除。  
> 如果以后又需要，公开内容接口会重新渲染并回填。  
> 因此不需要 TTL。

