# Doc Snapshots GC 前置工程实施计划

> **给后续执行者：** 实施时必须按任务逐项执行。建议使用 `subagent-driven-development` 或 `executing-plans`。每个步骤使用 checkbox 跟踪。

**目标：** 先把 `doc_snapshots` 建成“文档版本的权威块版本映射表”，让每个文档版本、发布版本都能明确引用一组 `block_versions`，为后续块 GC 提供可靠引用图。

**架构思路：** 新增一个聚焦的 `DocumentSnapshotService`，负责创建、读取、回填文档快照。所有创建 `DocRevision` 的路径，都必须在同一事务内创建对应 `DocSnapshot`。历史内容读取、版本对比、回滚、公开发布读取都优先使用 `doc_snapshots.blockVersionMap`，旧的时间点反推逻辑只作为旧数据回退路径。

**技术栈：** NestJS 11、TypeORM 0.3、TypeScript、当前 SQLite 开发库，同时兼容 PostgreSQL、Jest、ts-node。

---

## 一、范围

### 本计划包含

1. 每个新的 `doc_revisions(docId, docVer)` 都必须有一个对应的 `doc_snapshots(docId, docVer)`。
2. 发布内容绑定到一个确定的文档版本快照，而不是仅依赖时间反推。
3. 为已有历史版本提供 `doc_snapshots` 回填脚本。
4. 保持现有 API 形态基本兼容。

### 本计划不包含

1. 块 GC 的候选标记、软删除、物理删除、管理接口。
2. delta snapshot 或压缩存储。
3. 对整个版本控制系统的大重构。

---

## 二、当前问题

当前后端已经有这些表：

- `documents`：保存 `head`、`publishedHead`、`rootBlockId`。
- `doc_revisions`：保存文档版本元信息。
- `doc_snapshots`：已经存在，但没有成为版本系统的核心依赖。
- `block_versions`：保存每个块的历史版本。

现在历史版本内容主要靠下面逻辑反推：

```text
根据 DocRevision.createdAt：
  找出该时间点前每个 block 的最大 ver
```

这个模型早期可以跑，但对后续 GC 不够安全：

1. GC 需要确定“哪些 block_version 被引用”，不能靠时间猜。
2. 发布版本也应该是不可变的确定快照。
3. 回滚、diff、历史读取都应该读取同一套版本映射。
4. 后续如果做 delta，必须先有稳定的 snapshot 引用图。

目标不变量：

```text
每条 doc_revisions 记录，都必须存在同 docId + docVer 的 doc_snapshots 记录。
```

---

## 三、目标语义

### 1. 创建文档版本

一次文档版本提交应该变成：

```text
1. 必要时更新 documents.head
2. 插入 doc_revisions
3. 插入 doc_snapshots
```

新版本的快照映射来自当前未删除块：

```text
SELECT blockId, latestVer
FROM blocks
WHERE docId = :docId
  AND isDeleted = false
```

最终得到：

```json
{
  "rootBlockId": 1,
  "blockA": 3,
  "blockB": 2
}
```

### 2. 读取历史版本

读取指定文档版本时：

```text
1. 优先读取 doc_snapshots(docId, docVer)
2. 如果存在，直接使用 blockVersionMap
3. 如果不存在，才使用旧的 createdAt 时间点反推逻辑
```

### 3. 发布内容

发布不只是：

```text
documents.publishedHead = document.head
```

而应该是：

```text
documents.publishedHead = targetDocVer
documents.publishedSnapshotId = snapshotId
```

公开站点读取时，只能读取发布快照。匿名访问不允许通过 `?version=` 任意读取草稿历史版本。

---

## 四、涉及文件

### 新增文件

- `F:\yuweb\back\server\src\modules\documents\services\document-snapshot.service.ts`
- `F:\yuweb\back\server\src\modules\documents\services\document-snapshot.service.spec.ts`
- `F:\yuweb\back\server\scripts\backfill-doc-snapshots.ts`
- `F:\yuweb\back\server\src\database\migrations\1779400000000-StrengthenDocSnapshotsForGc.ts`

### 修改文件

- `F:\yuweb\back\server\src\entities\doc-snapshot.entity.ts`
- `F:\yuweb\back\server\src\entities\document.entity.ts`
- `F:\yuweb\back\server\src\modules\documents\documents.module.ts`
- `F:\yuweb\back\server\src\modules\documents\documents.service.ts`
- `F:\yuweb\back\server\src\modules\documents\services\version-control.service.ts`
- `F:\yuweb\back\server\src\modules\blocks\blocks.service.ts`
- `F:\yuweb\back\server\package.json`
- `F:\yuweb\back\server\docs\API_USAGE.md`
- `F:\yuweb\back\server\docs\website\api\documents.md`

---

## 五、任务 1：增强快照和文档实体

**文件：**

- 修改：`F:\yuweb\back\server\src\entities\doc-snapshot.entity.ts`
- 修改：`F:\yuweb\back\server\src\entities\document.entity.ts`
- 新增：`F:\yuweb\back\server\src\database\migrations\1779400000000-StrengthenDocSnapshotsForGc.ts`

### 步骤

- [ ] 给 `DocSnapshot` 增加字段：

```ts
@Column({ default: 'revision' })
kind: string; // revision | manual | publish | gc_checkpoint

@Column({ default: false })
pinned: boolean;

@Column({ type: 'bigint', nullable: true })
retainUntil: number | null;

@Column({
  type: isSqlite() ? 'simple-json' : 'jsonb',
  default: () => (isSqlite() ? "'{}'" : "'{}'"),
})
metadata: object;
```

- [ ] 给 `Document` 增加字段：

```ts
@Column({ nullable: true })
publishedSnapshotId: string | null;
```

- [ ] 新增迁移，负责添加：

```text
documents.publishedSnapshotId
doc_snapshots.kind
doc_snapshots.pinned
doc_snapshots.retainUntil
doc_snapshots.metadata
```

迁移需要兼容 SQLite / PostgreSQL。SQLite 下如果不支持 `jsonb`，`metadata` 使用 `TEXT`。

- [ ] 验证：

```bash
pnpm build
```

---

## 六、任务 2：新增 DocumentSnapshotService

**文件：**

- 新增：`F:\yuweb\back\server\src\modules\documents\services\document-snapshot.service.ts`
- 新增：`F:\yuweb\back\server\src\modules\documents\services\document-snapshot.service.spec.ts`
- 修改：`F:\yuweb\back\server\src\modules\documents\documents.module.ts`

### 服务职责

新增 `DocumentSnapshotService`，只负责文档快照，不掺杂文档权限、发布、块编辑逻辑。

核心方法：

```ts
async createSnapshotForRevision(
  docId: string,
  docVer: number,
  manager: EntityManager,
  options?: {
    kind?: string;
    pinned?: boolean;
    retainUntil?: number | null;
    metadata?: Record<string, unknown>;
  },
): Promise<DocSnapshot>
```

行为：

1. 使用传入的 `manager`，保证可以被外层事务包住。
2. 如果同 `docId + docVer` 的快照已存在，直接返回。
3. 查询当前未删除块。
4. 用 `{ blockId: latestVer }` 生成 `blockVersionMap`。
5. 创建 `DocSnapshot`。

读取方法：

```ts
async getSnapshotMapForVersion(
  docId: string,
  docVer: number,
): Promise<{
  map: Record<string, number>;
  rootBlockId: string;
  snapshot: DocSnapshot | null;
}>
```

### 测试

先写失败测试，覆盖：

1. 能从当前 live blocks 创建快照。
2. 同版本重复创建时幂等。
3. 能读取已有快照 map。
4. 不存在快照时返回 `snapshot: null`。

运行：

```bash
pnpm test -- --runInBand document-snapshot.service.spec.ts
```

### 模块注册

在 `documents.module.ts` 中加入：

```ts
providers: [DocumentsService, VersionControlService, DocumentSnapshotService],
exports: [DocumentsService, VersionControlService, DocumentSnapshotService],
```

---

## 七、任务 3：所有新文档版本都创建快照

**文件：**

- 修改：`F:\yuweb\back\server\src\modules\documents\documents.service.ts`
- 修改：`F:\yuweb\back\server\src\modules\documents\services\version-control.service.ts`
- 修改：`F:\yuweb\back\server\src\modules\blocks\blocks.service.ts`
- 修改相关测试

### 需要覆盖的路径

1. 创建文档时的初始版本 `docVer=1`。
2. `VersionControlService.createVersion()` 创建的手动提交版本。
3. `BlocksService.incrementDocumentHead()` 创建的即时版本。
4. `DocumentsService.revert()` 创建的回滚版本。

### 实现要求

每次保存 `DocRevision` 后，立刻在同一个事务中调用：

```ts
await this.documentSnapshotService.createSnapshotForRevision(
  docId,
  document.head,
  manager,
  {
    kind: "revision",
    pinned: false,
    metadata: { source: "..." },
  },
);
```

`metadata.source` 建议：

- `initial`
- `commit`
- `immediate-block-operation`
- `revert`

### 测试要求

新增或修改测试，断言：

```ts
expect(documentSnapshotService.createSnapshotForRevision).toHaveBeenCalledWith(
  "doc_1",
  2,
  expect.anything(),
  expect.objectContaining({ kind: "revision", pinned: false }),
);
```

验证：

```bash
pnpm test -- --runInBand document-snapshot.service.spec.ts version-control.service.spec.ts documents.service.spec.ts
pnpm build
```

---

## 八、任务 4：历史版本读取优先走快照

**文件：**

- 修改：`F:\yuweb\back\server\src\modules\documents\documents.service.ts`
- 修改：`F:\yuweb\back\server\src\modules\documents\documents.service.spec.ts`

### 实现

在 `getBlockVersionMapForVersion(docId, docVer)` 开头加入：

```ts
const snapshotResult =
  await this.documentSnapshotService.getSnapshotMapForVersion(docId, docVer);
if (snapshotResult.snapshot) {
  const revision = await this.docRevisionRepository.findOne({
    where: { docId, docVer },
  });
  return {
    map: snapshotResult.map,
    createdAt: revision?.createdAt ?? snapshotResult.snapshot.createdAt,
  };
}
```

保留现有 createdAt 时间点反推逻辑，作为旧数据 fallback。

### 影响范围

以下方法会自动受益，因为它们都依赖版本 map：

- `getContent()`
- `getContentSitePublic()`
- `getDiff()`
- `revert()`

### 验证

```bash
pnpm test -- --runInBand documents.service.spec.ts document-snapshot.service.spec.ts
```

---

## 九、任务 5：发布绑定具体快照

**文件：**

- 修改：`F:\yuweb\back\server\src\modules\documents\documents.service.ts`
- 修改：`F:\yuweb\back\server\src\modules\documents\documents.service.spec.ts`

### 实现

`publish()` 中需要：

1. 确保当前 `head` 对应快照存在。
2. 设置 `publishedHead`。
3. 设置 `publishedSnapshotId`。

核心逻辑：

```ts
const ensuredSnapshot =
  await this.documentSnapshotService.createSnapshotForRevision(
    docId,
    lockedDocument.head,
    manager,
    {
      kind: "publish",
      pinned: true,
      metadata: { source: "publish" },
    },
  );

lockedDocument.publishedHead = lockedDocument.head;
lockedDocument.publishedSnapshotId = ensuredSnapshot.snapshotId;
lockedDocument.updatedBy = userId;
await docRepo.save(lockedDocument);
```

### 公开读取要求

`getContentSitePublic()` 必须固定使用：

```ts
const docVer = publicDocument.publishedHead;
```

匿名访问不能通过 `?version=` 覆盖发布版本。

### 验证

```bash
pnpm test -- --runInBand documents.service.spec.ts
pnpm build
```

---

## 十、任务 6：回填已有文档版本快照

**文件：**

- 新增：`F:\yuweb\back\server\scripts\backfill-doc-snapshots.ts`
- 修改：`F:\yuweb\back\server\package.json`

### 脚本行为

脚本 `backfill-doc-snapshots.ts`：

1. 初始化 TypeORM。
2. 遍历所有 `doc_revisions`。
3. 如果同 `docId + docVer` 快照已存在，则跳过。
4. 如果不存在，使用旧的 createdAt 时间点反推逻辑生成 `blockVersionMap`。
5. 插入 `DocSnapshot`：

```text
kind = revision
pinned = false
metadata.source = backfill
```

6. 输出：

```json
{
  "scanned": 20,
  "created": 20,
  "skipped": 0
}
```

### package script

在 `package.json` 添加：

```json
"snapshots:backfill": "ts-node -r tsconfig-paths/register scripts/backfill-doc-snapshots.ts"
```

### 验证

运行两次：

```bash
pnpm snapshots:backfill
pnpm snapshots:backfill
```

第二次应显示 `created: 0`。

再运行不变量检查：

```bash
node -e "const Database=require('better-sqlite3');const db=new Database('./data/app-v2.db');const missing=db.prepare('select count(*) c from doc_revisions r left join doc_snapshots s on s.docId=r.docId and s.docVer=r.docVer where s.id is null').get().c;console.log({missing});db.close();process.exit(missing===0?0:1);"
```

期望：

```json
{ "missing": 0 }
```

---

## 十一、任务 7：手动快照语义和文档更新

**文件：**

- 修改：`F:\yuweb\back\server\src\modules\documents\documents.service.ts`
- 修改：`F:\yuweb\back\server\docs\API_USAGE.md`
- 修改：`F:\yuweb\back\server\docs\website\api\documents.md`

### 手动快照

现有接口：

```http
POST /documents/:docId/snapshots
```

应改成：

```ts
{
  kind: 'manual',
  pinned: true,
  metadata: { source: 'manual-api' },
}
```

注意当前 `doc_snapshots` 是 `docId + docVer` 唯一，所以如果 revision snapshot 已存在，不要重复插入，而是把已有 snapshot 升级为：

```text
kind = manual
pinned = true
```

### 文档说明

更新 API 文档，说明：

```text
每个文档版本都有对应 doc_snapshot。
snapshot 存储精确的 { blockId: blockVersion } 映射。
历史内容、diff、revert、发布内容优先通过该映射重建。
发布文档发布的是具体版本快照。
匿名公开读取永远只返回 published snapshot。
```

### 验证

```bash
pnpm test -- --runInBand documents.service.spec.ts document-snapshot.service.spec.ts
pnpm build
```

---

## 十二、任务 8：进入 GC 前的最终验证

### 1. 全量测试

```bash
pnpm test -- --runInBand
```

期望：通过。

### 2. 构建

```bash
pnpm build
```

期望：通过。

### 3. 回填幂等性

```bash
pnpm snapshots:backfill
pnpm snapshots:backfill
```

期望：第二次没有新增快照。

### 4. 数据库不变量

```bash
node -e "const Database=require('better-sqlite3');const db=new Database('./data/app-v2.db');const revisions=db.prepare('select count(*) c from doc_revisions').get().c;const missing=db.prepare('select count(*) c from doc_revisions r left join doc_snapshots s on s.docId=r.docId and s.docVer=r.docVer where s.id is null').get().c;console.log({revisions,missing});db.close();process.exit(missing===0?0:1);"
```

期望：

```json
{ "missing": 0 }
```

---

## 十三、验收标准

前置工程完成时，必须满足：

1. 每个新 `doc_revisions` 都在同事务内创建对应 `doc_snapshots`。
2. 已有历史版本可以通过脚本幂等回填。
3. 历史读取优先使用 `doc_snapshots.blockVersionMap`。
4. `getDiff()`、`revert()` 通过统一 map 查询逻辑使用快照。
5. `publish()` 同时设置 `publishedHead` 和 `publishedSnapshotId`。
6. 匿名公开读取只能读取发布快照。
7. `pnpm test -- --runInBand` 通过。
8. `pnpm build` 通过。
9. 数据库检查显示没有缺失快照的文档版本。

---

## 十四、风险和保护措施

1. **构造函数注入变更：** 现有单测有手动 new service 的地方，新增依赖后要同步更新 mock 参数。
2. **SQLite / PostgreSQL 差异：** migration 中 `metadata` 字段要兼容 SQLite。
3. **快照唯一约束：** 手动快照不能重复插入同版本快照，应升级已有快照为 pinned。
4. **旧数据兼容：** 在所有环境完成 backfill 前，保留时间点反推 fallback。
5. **GC 前置要求：** 未完成 `missing=0` 的数据库，不允许进入块版本删除类 GC。

---

## Review Gate

请先 review 这份计划。确认后再开始业务代码开发。这个前置工程完成并通过验证后，再继续设计和实现块 GC 系统。
