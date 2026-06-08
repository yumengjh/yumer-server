# 文档生命周期系统后端复盘

> 日期：2026-06-08
> 仓库：`E:\workspace\yumer-server`
> 基线提交：`81252211f392e7f9c609e104eb63f2ee30dd5338`
> 主题：文档回收站生命周期、恢复、永久删除、自动删除倒计时契约

## 1. 结论

本轮后端把“删除文档”从单一步骤改成了完整生命周期：

```text
active document -> trash -> restore
active document -> trash -> permanent delete
```

当前可以明确宣称：

- 普通 `DELETE /documents/:docId` 已不再直接物理删除文档，而是把文档子树移动到回收站；
- 回收站列表可通过 `GET /documents?status=deleted` 获取；
- 回收站文档会返回自动删除倒计时字段；
- `POST /documents/:docId/restore` 可恢复文档子树；
- `DELETE /documents/:docId/permanent` 可对回收站文档执行真删除；
- 真删除会递归清理文档子树和相关派生数据；
- 文档渲染缓存 GC 模块继续作为派生缓存清理的一部分参与生命周期。

本轮不是只改一个接口，而是把后端语义从“删除动作”升级成“生命周期状态机”。

## 2. Review 结果

本轮提交前做了针对性 review，重点检查：

- 软删除是否会误伤未删除文档；
- 恢复是否会把子树关系恢复到不合法父级；
- 真删除是否允许绕过回收站；
- 真删除是否先清派生表再删主表；
- 回收站列表是否默认隔离活跃文档；
- 前端需要的倒计时字段是否由后端统一计算；
- 数据库迁移是否覆盖新增生命周期列；
- e2e 是否走真实 HTTP 和 SQLite schema。

Review 结论：

- 没有发现阻断提交的数据安全问题；
- 永久删除限定 `status = deleted`，不能直接绕过回收站；
- 删除顺序从派生数据到 blocks / block_versions / documents，符合外键和业务依赖方向；
- 标签计数在软删除时减少、恢复时增加，真删除不再二次调整，避免重复扣减；
- 已删除文档默认不会出现在普通列表、详情、更新、内容读取链路中；
- 全量 `tsc --noEmit` 仍受既有 spec 类型债影响，不能作为本轮后端最终通过口径。

## 3. 后端设计

### 3.1 状态机设计

文档状态新增一个受控状态：

```text
deleted
```

它不是普通编辑状态，不允许通过 `PATCH /documents/:docId` 直接设置。

原因：

- 删除需要递归处理子文档；
- 删除要维护标签 usage；
- 删除要清理发布渲染缓存；
- 删除要触发公开页面 revalidation；
- 删除要写入生命周期审计字段。

因此，`status = deleted` 必须通过文档删除端点进入。

### 3.2 生命周期字段

实体新增字段：

- `deletedFromStatus`
- `deletedAt`
- `deletedBy`
- `restoredAt`
- `restoredBy`

字段含义：

- `deletedFromStatus`：恢复时还原原状态，不把所有文档都粗暴恢复成 `normal`；
- `deletedAt`：回收站排序、倒计时、未来自动清理的时间基准；
- `deletedBy`：审计谁移入回收站；
- `restoredAt` / `restoredBy`：审计谁恢复了文档。

迁移文件：

- `src/database/migrations/1783100000000-AddDocumentLifecycleFields.ts`

迁移同时增加索引：

```text
workspaceId + status + deletedAt
```

这个索引服务于最常见的回收站查询：

```text
GET /documents?workspaceId=...&status=deleted&sortBy=deletedAt
```

### 3.3 回收站保留期

后端统一计算：

- `trashRetentionDays`
- `trashExpiresAt`
- `trashDaysRemaining`

默认保留期：

```text
30 days
```

可通过环境变量覆盖：

```text
DOCUMENT_TRASH_RETENTION_DAYS
```

这里选择后端计算，而不是让前端自己加 30 天，原因是：

- 保留期是服务端策略，不是 UI 假设；
- 多端客户端应看到同一套倒计时；
- 将来自动清理服务只需要复用同一策略；
- 修改保留期不需要发前端。

### 3.4 软删除设计

`remove(docId, userId)` 当前语义：

1. 查找文档；
2. 拒绝已删除文档；
3. 检查工作区管理权限；
4. 在事务内收集活跃文档子树；
5. 对每个文档：
   - 扣减标签 usage；
   - 写入 `status = deleted`；
   - 写入删除生命周期字段；
   - 清空恢复字段；
6. 事务后记录活动；
7. 清理发布渲染缓存；
8. 对公开文档触发 revalidation；
9. 返回删除时间、影响数量和倒计时字段。

只收集活跃子树的原因：

- 已经在回收站里的子文档不应重复写生命周期；
- 可避免重复扣减标签 usage；
- 可让恢复逻辑根据 deleted 子树独立工作。

### 3.5 恢复设计

`restore(docId, userId)` 当前语义：

1. 只接受 `status = deleted` 的文档；
2. 检查工作区管理权限；
3. 在事务内收集已删除文档子树；
4. 对每个文档：
   - 如果父级不在恢复集合，且父级不存在或仍删除，则移动到根；
   - 恢复标签 usage；
   - 使用 `deletedFromStatus` 恢复原状态；
   - 清空删除字段；
   - 写入恢复字段；
5. 记录 `doc.restore` 活动；
6. 返回恢复后的文档详情。

父级校验是关键保护：

- 子文档可以独立恢复；
- 如果原父级仍在回收站，不能让恢复后的活跃文档挂在已删除父级下面；
- 最保守的恢复目标是根目录。

### 3.6 真删除设计

新增端点：

```text
DELETE /documents/:docId/permanent
```

约束：

- 目标文档必须存在；
- 目标文档必须 `status = deleted`；
- 需要工作区管理权限；
- 会递归清理 deleted 子树。

清理范围：

- `block_render_caches`
- `comments`
- `favorites`
- `document_drafts`
- `document_sync_sessions`
- `sync_create_tombstones`
- `sync_batch_receipts`
- `sync_checkpoint_receipts`
- `sync_reconcile_receipts`
- `doc_snapshots`
- `doc_revisions`
- `block_versions`
- `blocks`
- `documents`

删除顺序的原则：

```text
cache / UI / sync receipts / snapshots / revisions -> block versions -> blocks -> documents
```

这样做的原因：

- 派生缓存不应阻挡主数据删除；
- 版本、快照和草稿都依赖 docId；
- blocks 和 block_versions 是文档内容主体；
- documents 必须最后删除。

真删除返回：

- `status: "purged"`
- `permanentlyDeletedAt`
- `affectedCount`
- `deletedDocIds`
- `deletedCounts`

`deletedCounts` 不是给普通 UI 展示用，主要用于调试和运维确认清理是否完整。

## 4. 与渲染缓存 GC 的关系

81252211 引入了 render cache published reachability GC。

本轮生命周期系统和渲染缓存之间的边界是：

- 软删除：调用现有 render cache 清理服务，确保发布态派生 HTML 不继续保留；
- 真删除：直接删除 `block_render_caches` 中相关 docId 的缓存行；
- GC 模块：仍负责跨文档、跨发布状态的后台可达性清理。

换句话说：

- 生命周期删除是“文档主动变更”触发的清理；
- GC 是“派生缓存长期收敛”触发的清理；
- 两者互补，不互相替代。

## 5. API 契约

### 5.1 查询回收站

```text
GET /documents?workspaceId=:workspaceId&status=deleted&sortBy=deletedAt&sortOrder=DESC
```

返回 item 包含：

```ts
{
  status: "deleted",
  deletedFromStatus: string | null,
  deletedAt: string | null,
  deletedBy: string | null,
  trashRetentionDays: number,
  trashExpiresAt: string | null,
  trashDaysRemaining: number | null
}
```

### 5.2 移入回收站

```text
DELETE /documents/:docId
```

返回：

```ts
{
  docId: string,
  status: "deleted",
  deletedAt: string,
  trashRetentionDays: number,
  trashExpiresAt: string | null,
  trashDaysRemaining: number | null,
  affectedCount: number
}
```

### 5.3 恢复

```text
POST /documents/:docId/restore
```

返回恢复后的文档详情。

### 5.4 真删除

```text
DELETE /documents/:docId/permanent
```

返回：

```ts
{
  docId: string,
  status: "purged",
  permanentlyDeletedAt: string,
  affectedCount: number,
  deletedDocIds: string[],
  deletedCounts: Record<string, number>
}
```

## 6. 实践细节

### 6.1 为什么不直接数据库 cascade

本轮没有依赖 `ON DELETE CASCADE`。

原因：

- 当前实体关系并没有统一声明 cascade；
- sync receipts、render caches、drafts 这类表是业务关联，不一定都有数据库外键；
- 显式删除能让测试验证每一类派生数据都被覆盖；
- 返回 `deletedCounts` 能帮助后续发现遗漏表。

### 6.2 为什么真删除必须先软删

如果允许活跃文档直接永久删除，会绕过：

- 标签 usage 扣减；
- 公开缓存失效；
- 回收站审计字段；
- 用户误操作恢复窗口；
- 前端明确的二次确认流程。

因此真删除只接受已在回收站的文档。

### 6.3 为什么默认列表排除 deleted

普通文档列表、详情、编辑、内容读取都不应该看到回收站文档。

这不是 UI 层过滤，而是后端默认契约：

```text
未传 status -> status != deleted
```

好处：

- 防止旧客户端误打开已删除文档；
- 防止搜索、侧边栏、编辑器加载路径混入回收站数据；
- 回收站必须显式查询。

### 6.4 为什么恢复要检查父级

子树恢复和单文档恢复都要支持。

如果单独恢复一个子文档，而父文档仍删除，原 `parentId` 已经不合法。此时恢复到根目录比保留坏父级更安全。

## 7. 本轮测试

已执行：

```powershell
pnpm exec jest src/modules/documents/documents.service.spec.ts --runInBand
pnpm exec jest --config ./test/jest-e2e.json test/document-lifecycle.e2e-spec.ts --runInBand
pnpm run build
```

结果：

- `documents.service.spec.ts`：50 passed
- `document-lifecycle.e2e-spec.ts`：2 passed
- `nest build`：通过，TSC 0 issues

另外执行过：

```powershell
pnpm exec tsc --noEmit --pretty false
```

结果：

- 未通过；
- 失败点集中在既有 spec 类型债，包括 blocks spec、document controller spec、document service spec 旧 mock 类型、render cache spec 泛型等；
- 本轮新增的生产源码通过 `pnpm run build`；
- 本轮新增生命周期 e2e 已通过真实 HTTP + SQLite schema 验证。

## 8. 已知边界

当前还没有实现：

- 定时自动清理任务；
- 管理端批量 purge expired trash；
- 回收站按操作者过滤；
- 回收站搜索专用索引；
- 真删除前导出或审计快照；
- 多租户维度的自动清理运行报告。

本轮只完成“生命周期系统的后端契约和手动真删除能力”，没有把自动调度器一起推进。

## 9. 后续建议

下一步可以推进：

1. 增加 `DocumentTrashCleanupService`，按 `deletedAt + retentionDays` 定时 purge；
2. 给自动清理增加 dry-run / sweep 两阶段；
3. 将自动清理纳入 GC registry，和 render-cache/block-version/storage GC 形成统一运维入口；
4. 增加 purge run 表或活动明细，记录自动清理的影响范围；
5. 前端在回收站增加按“即将自动删除”排序或筛选；
6. 对真删除增加 workspace-level 二次确认策略。

## 10. 建议提交范围

本次后端提交建议包含：

- `src/entities/document.entity.ts`
- `src/modules/activities/constants/activity-actions.ts`
- `src/modules/documents/documents.controller.ts`
- `src/modules/documents/documents.service.ts`
- `src/modules/documents/documents.service.spec.ts`
- `src/modules/documents/dto/query-documents.dto.ts`
- `src/modules/documents/dto/search-query.dto.ts`
- `src/database/migrations/1783100000000-AddDocumentLifecycleFields.ts`
- `test/document-lifecycle.e2e-spec.ts`
- `docs/superpowers/reviews/2026-06-08-document-lifecycle-retrospective.md`

不建议包含：

- `docs/session/sync-stability-analysis.md`

原因：

- 它是已有 session 草稿，不属于本轮文档生命周期交付边界。

## 11. 提交建议

建议提交标题：

```text
feat(documents): add document lifecycle trash flow
```

建议提交正文说明：

```text
Add document soft-delete lifecycle metadata, trash listing, restore, and permanent delete cleanup.

Return trash retention fields for deleted documents so clients can show auto-delete deadlines.
Clean related document data explicitly during permanent delete, including blocks, versions, snapshots, drafts, sync receipts, comments, favorites, and render caches.

Docs:
docs/superpowers/reviews/2026-06-08-document-lifecycle-retrospective.md
```
