# 同步链路后端加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收紧块级同步后端的一致性边界，优先修复版本推进、文档锁顺序、主同步入口版本校验和空草稿丢弃行为。

**Architecture:** 保留现有 `BlocksService` / `DocumentDraftService` 结构，不做架构重构。通过“先补失败测试、再最小实现”的方式，把正式版本推进统一到文档级锁保护下，并把 batch 主入口收紧为必须带版本语义。

**Tech Stack:** NestJS 11、TypeORM、Jest、TypeScript

---

### Task 1: 收紧 batch 正式版本推进与版本参数契约

**Files:**
- Modify: `src/modules/blocks/blocks-sync-idempotency.spec.ts`
- Modify: `src/modules/blocks/dto/batch-block.dto.ts`
- Modify: `src/modules/blocks/blocks.service.ts`

- [ ] **Step 1: 写 batch 缺少 `baseVersion` 时拒绝写入的失败测试**

在 `src/modules/blocks/blocks-sync-idempotency.spec.ts` 的 `describe("BlocksService sync idempotency", ...)` 里新增一个测试，名称使用：

```ts
it("rejects batch writes when baseVersion is missing", async () => {
  const { service, blocks } = createBlocksServiceWithInMemoryRepositories();

  const response = await service.batch(
    {
      docId: "doc_1",
      clientBatchId: "batch_missing_base_version",
      source: BatchSourceType.AUTOSYNC,
      createVersion: false,
      operations: [
        {
          type: BatchOperationType.CREATE,
          clientId: "client_missing_base",
          data: {
            docId: "doc_1",
            type: "paragraph",
            parentId: "root_1",
            sortKey: "001500",
            payload: {
              type: "paragraph",
            },
          },
        } satisfies BatchCreateOperation,
      ],
    } as any,
    "user_1",
  );

  expect(response.needsReload).toBe(true);
  expect(response.conflicts).toEqual([
    expect.objectContaining({ code: "BASE_VERSION_REQUIRED" }),
  ]);
  expect(blocks.filter((block) => block.type === "paragraph")).toHaveLength(0);
});
```

- [ ] **Step 2: 运行单测并确认它以正确原因失败**

运行：

```bash
pnpm test -- src/modules/blocks/blocks-sync-idempotency.spec.ts -t "rejects batch writes when baseVersion is missing"
```

预期：

- FAIL
- 失败原因是当前实现没有返回 `BASE_VERSION_REQUIRED`

- [ ] **Step 3: 写 batch 部分失败时不推进 `head` 的失败测试**

继续在 `src/modules/blocks/blocks-sync-idempotency.spec.ts` 新增测试：

```ts
it("does not advance head when a versioned batch contains failures", async () => {
  const { service } = createBlocksServiceWithInMemoryRepositories();

  const response = await service.batch(
    {
      docId: "doc_1",
      baseVersion: 1,
      clientBatchId: "batch_partial_failure",
      source: BatchSourceType.AUTOSYNC,
      createVersion: true,
      operations: [
        {
          type: BatchOperationType.CREATE,
          clientId: "client_ok",
          data: {
            docId: "doc_1",
            type: "paragraph",
            parentId: "root_1",
            sortKey: "001500",
            payload: { type: "paragraph" },
          },
        } satisfies BatchCreateOperation,
        {
          type: BatchOperationType.UPDATE,
          blockId: "missing_block",
          data: {
            payload: {
              type: "paragraph",
              content: [{ type: "text", text: "broken" }],
            },
          },
        },
      ],
    } as any,
    "user_1",
  );

  expect(response.results).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ operation: BatchOperationType.CREATE, success: true }),
      expect.objectContaining({ operation: BatchOperationType.UPDATE, success: false }),
    ]),
  );
  expect(response.serverHead).toBe(1);
});
```

- [ ] **Step 4: 运行单测并确认它以正确原因失败**

运行：

```bash
pnpm test -- src/modules/blocks/blocks-sync-idempotency.spec.ts -t "does not advance head when a versioned batch contains failures"
```

预期：

- FAIL
- 失败原因是当前实现会把 `serverHead` 推进到 `2`

- [ ] **Step 5: 以最小改动实现 batch 契约收紧**

修改 `src/modules/blocks/dto/batch-block.dto.ts`：

- 去掉 `baseVersion` 的 `@IsOptional()`
- 保留 `@IsNumber()`
- 让 DTO 明确表达主同步入口必须携带 `baseVersion`

修改 `src/modules/blocks/blocks.service.ts`：

- 在 `batch()` 的事务开始位置，先显式判断 `typeof batchBlockDto.baseVersion !== "number"`，返回：

```ts
{
  results: [],
  serverHead: docInTx.head,
  successCount: 0,
  needsReload: true,
  draftRevision: serverDraftRevision,
  createDeleteCompensations: [],
  conflicts: [
    {
      code: "BASE_VERSION_REQUIRED",
      message: "baseVersion is required for sync batch writes",
      serverHead: docInTx.head,
    },
  ],
}
```

- 把：

```ts
if (shouldCreateVersion && successCount > 0) {
```

改成：

```ts
const hasFailures = results.some((item) => !item.success);
if (shouldCreateVersion && successCount > 0 && !hasFailures) {
```

- [ ] **Step 6: 运行 blocks 同步单测并确认全部通过**

运行：

```bash
pnpm test -- src/modules/blocks/blocks-sync-idempotency.spec.ts
```

预期：

- PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/blocks/blocks-sync-idempotency.spec.ts src/modules/blocks/dto/batch-block.dto.ts src/modules/blocks/blocks.service.ts
git commit -m "fix(blocks): 收紧 batch 版本参数与版本推进规则"
```

### Task 2: 修复空草稿丢弃时的伪 `draftRevision` 递增

**Files:**
- Modify: `src/modules/documents/services/document-draft.service.spec.ts`
- Modify: `src/modules/documents/services/document-draft.service.ts`

- [ ] **Step 1: 写“无草稿时 discard 不递增 draftRevision”的失败测试**

在 `src/modules/documents/services/document-draft.service.spec.ts` 中新增测试，直接实例化 `DocumentDraftService` 所需最小 mock，测试：

```ts
it("does not increment draftRevision when no draft exists", async () => {
  const manager = {
    getRepository: jest.fn((entity) => {
      if ((entity as any).name === "Document") {
        return {
          findOne: jest.fn().mockResolvedValue({ docId: "doc_1", draftRevision: 5 }),
          increment: jest.fn(),
        };
      }
      if ((entity as any).name === "DocDraft") {
        return {
          findOne: jest.fn().mockResolvedValue(null),
          delete: jest.fn(),
        };
      }
      return {};
    }),
  } as any;
});
```

测试断言重点：

- `discardDraftWithManager("doc_1", manager)` 返回 `discarded: true`
- `Document.increment` **没有被调用**

- [ ] **Step 2: 运行单测并确认它失败**

运行：

```bash
pnpm test -- src/modules/documents/services/document-draft.service.spec.ts -t "does not increment the document revision when no draft exists"
```

预期：

- FAIL
- 失败原因是当前实现总会递增 `draftRevision`

- [ ] **Step 3: 最小实现修复**

修改 `src/modules/documents/services/document-draft.service.ts` 的 `discardDraftWithManager()`：

- 先在锁内读取 `DocDraft`
- 仅当 draft 存在时才执行：
  - `deleteDraft`
  - `incrementDraftRevision`
- draft 不存在时直接返回：

```ts
{
  docId,
  discarded: true,
  fallbackSource: "head" as const,
}
```

- [ ] **Step 4: 运行文档相关单测并确认通过**

运行：

```bash
pnpm test -- src/modules/documents/services/document-draft.service.spec.ts
```

预期：

- PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/documents/services/document-draft.service.spec.ts src/modules/documents/services/document-draft.service.ts
git commit -m "fix(documents): 避免空草稿丢弃推进修订号"
```

### Task 3: 统一单块写路径的文档锁顺序

**Files:**
- Modify: `src/modules/blocks/blocks.service.draft.spec.ts`
- Modify: `src/modules/blocks/blocks.service.ts`

- [ ] **Step 1: 写 create 正式写路径先锁文档的失败测试**

在 `src/modules/blocks/blocks.service.draft.spec.ts` 中新增测试：

```ts
it("locks the document before a versioned create write", async () => {
  const { service, documentDraftService } = createDraftAwareBlocksService();

  await service.create(
    {
      docId: "doc_1",
      type: "paragraph",
      payload: { type: "paragraph" },
      parentId: "root_1",
      sortKey: "002000",
      createVersion: true,
    },
    "user_1",
  );

  expect(documentDraftService.lockDocumentForDraftMutation).toHaveBeenCalledWith(
    "doc_1",
    expect.any(Object),
  );
});
```

- [ ] **Step 2: 写 update 正式写路径先锁文档的失败测试**

继续新增：

```ts
it("locks the document before a versioned update write", async () => {
  const { service, documentDraftService } = createDraftAwareBlocksService();

  await service.updateContent(
    "block_1",
    {
      payload: {
        type: "paragraph",
        content: [{ type: "text", text: "updated" }],
      },
      createVersion: true,
    },
    "user_1",
  );

  expect(documentDraftService.lockDocumentForDraftMutation).toHaveBeenCalledWith(
    "doc_1",
    expect.any(Object),
  );
});
```

- [ ] **Step 3: 写 move 正式写路径先锁文档的失败测试**

继续新增：

```ts
it("locks the document before a versioned move write", async () => {
  const { service, documentDraftService } = createDraftAwareBlocksService();

  await service.move(
    "block_1",
    {
      parentId: "root_1",
      sortKey: "003000",
      indent: 1,
      createVersion: true,
    },
    "user_1",
  );

  expect(documentDraftService.lockDocumentForDraftMutation).toHaveBeenCalledWith(
    "doc_1",
    expect.any(Object),
  );
});
```

- [ ] **Step 4: 运行单测并确认它们失败**

运行：

```bash
pnpm test -- src/modules/blocks/blocks.service.draft.spec.ts -t "locks the document before a versioned"
```

预期：

- FAIL
- 失败原因是当前正式写路径没有调用文档锁

- [ ] **Step 5: 最小实现统一锁顺序**

修改 `src/modules/blocks/blocks.service.ts`：

- 在 `create()` 事务中把：

```ts
if (createBlockDto.createVersion === false) {
  await this.documentDraftService.lockDocumentForDraftMutation(...)
}
```

改成无条件先锁文档：

```ts
await this.documentDraftService.lockDocumentForDraftMutation(createBlockDto.docId, manager);
```

- 在 `updateContent()` 事务中把：

```ts
if (updateBlockDto.createVersion === false) {
  await this.documentDraftService.lockDocumentForDraftMutation(docId, manager);
}
```

改成无条件先锁文档，再获取 block 行锁。

- 在 `move()` 事务中同样改成无条件先锁文档。

- 在 `remove()` 事务中新增无条件先锁文档，再软删除 block。

这一步不改接口，不新增模块，只统一锁调用顺序。

- [ ] **Step 6: 运行 blocks 草稿/写路径单测并确认通过**

运行：

```bash
pnpm test -- src/modules/blocks/blocks.service.draft.spec.ts
```

预期：

- PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/blocks/blocks.service.draft.spec.ts src/modules/blocks/blocks.service.ts
git commit -m "fix(blocks): 统一单块写路径的文档锁顺序"
```

### Task 4: 全量回归本轮相关测试

**Files:**
- Modify: `docs/superpowers/specs/2026-06-04-sync-backend-hardening-design.md`
- Modify: `docs/superpowers/plans/2026-06-04-sync-backend-hardening-plan.md`

- [ ] **Step 1: 运行本轮所有定向测试**

运行：

```bash
pnpm test -- src/modules/blocks/blocks-sync-idempotency.spec.ts
pnpm test -- src/modules/blocks/blocks.service.draft.spec.ts
pnpm test -- src/modules/documents/services/document-draft.service.spec.ts
```

预期：

- 全部 PASS

- [ ] **Step 2: 复核代码改动是否只覆盖设计范围**

检查：

```bash
git diff -- src/modules/blocks/blocks.service.ts src/modules/blocks/dto/batch-block.dto.ts src/modules/blocks/blocks-sync-idempotency.spec.ts src/modules/blocks/blocks.service.draft.spec.ts src/modules/documents/services/document-draft.service.ts src/modules/documents/services/document-draft.service.spec.ts
```

预期：

- 只有本轮设计中的文件被修改
- 没有顺手重构

- [ ] **Step 3: 更新设计文档状态**

把 `docs/superpowers/specs/2026-06-04-sync-backend-hardening-design.md` 顶部状态从：

```md
> 状态：待用户评审
```

改为：

```md
> 状态：实现中
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-04-sync-backend-hardening-design.md docs/superpowers/plans/2026-06-04-sync-backend-hardening-plan.md
git commit -m "docs(blocks): 补充同步链路后端加固方案与实施计划"
```

### Task 5: 为 `clientBatchId` 落地真正的批次幂等回执

**Files:**
- Create: `src/entities/sync-batch-receipt.entity.ts`
- Create: `src/database/migrations/1782500000000-CreateSyncBatchReceipts.ts`
- Modify: `src/app.module.ts`
- Modify: `src/modules/blocks/dto/batch-block.dto.ts`
- Modify: `src/modules/blocks/blocks.service.ts`
- Modify: `src/modules/blocks/blocks-sync-idempotency.spec.ts`
- Modify: `src/modules/blocks/blocks.service.draft.spec.ts`

- [ ] **Step 1: 写“同一 clientBatchId 重放返回第一次响应”的失败测试**

在 `src/modules/blocks/blocks-sync-idempotency.spec.ts` 中新增测试，验证：

1. 第一次 `createVersion: true` 的 batch 成功执行并把 `serverHead` 推到 `2`
2. 第二次使用**相同** `clientBatchId` 和**相同**请求体重放时：
   - 返回与第一次相同的 `acceptedBatchId`
   - 返回与第一次相同的 `serverHead`
   - 不再创建第二个块
   - 不再把 `head` 推到 `3`

- [ ] **Step 2: 运行单测并确认它失败**

运行：

```bash
pnpm test -- src/modules/blocks/blocks-sync-idempotency.spec.ts -t "replays the stored response for the same clientBatchId"
```

预期：

- FAIL
- 失败原因是当前实现会重复执行 batch

- [ ] **Step 3: 写“同一 clientBatchId 复用不同请求体返回冲突”的失败测试**

继续在 `src/modules/blocks/blocks-sync-idempotency.spec.ts` 中新增测试，验证：

1. 第一次 batch 成功写入
2. 第二次复用同一个 `clientBatchId`，但操作内容不同
3. 服务端返回：

```ts
expect(response.needsReload).toBe(true);
expect(response.conflicts).toEqual([
  expect.objectContaining({ code: "CLIENT_BATCH_ID_REUSED" }),
]);
```

- [ ] **Step 4: 运行单测并确认它失败**

运行：

```bash
pnpm test -- src/modules/blocks/blocks-sync-idempotency.spec.ts -t "rejects reused clientBatchId with a different request fingerprint"
```

预期：

- FAIL
- 失败原因是当前实现没有真正的批次回执机制

- [ ] **Step 5: 新增批次回执实体与迁移**

创建 `src/entities/sync-batch-receipt.entity.ts`：

- 表名：`sync_batch_receipts`
- 唯一键：`docId + clientBatchId`
- 字段至少包括：
  - `docId`
  - `clientBatchId`
  - `requestFingerprint`
  - `acceptedBatchId`
  - `appliedAt`
  - `serverHead`
  - `draftRevision`
  - `needsReload`
  - `conflicts`
  - `results`

创建 `src/database/migrations/1782500000000-CreateSyncBatchReceipts.ts`：

- PostgreSQL 用 `jsonb`
- SQLite 用 `text`
- 建唯一索引 `docId + clientBatchId`

同时更新 `src/app.module.ts` 的 `databaseEntities`

- [ ] **Step 6: 收紧 clientBatchId 契约并接入回执读写**

修改 `src/modules/blocks/dto/batch-block.dto.ts`：

- 把 `clientBatchId` 改成必填语义

修改 `src/modules/blocks/blocks.service.ts`：

1. `batch()` 开头构造请求指纹
2. 在文档锁内先查 `sync_batch_receipts`
3. 命中相同指纹时直接回放第一次响应
4. 命中不同指纹时返回 `CLIENT_BATCH_ID_REUSED`
5. 首次请求执行完成后，把最终响应写入回执表
6. 回放请求不重复记录 activities

- [ ] **Step 7: 运行定向测试并确认通过**

运行：

```bash
pnpm test -- src/modules/blocks/blocks-sync-idempotency.spec.ts
pnpm test -- src/modules/blocks/blocks.service.draft.spec.ts
```

预期：

- PASS

- [ ] **Step 8: Commit**

```bash
git add src/entities/sync-batch-receipt.entity.ts src/database/migrations/1782500000000-CreateSyncBatchReceipts.ts src/app.module.ts src/modules/blocks/dto/batch-block.dto.ts src/modules/blocks/blocks.service.ts src/modules/blocks/blocks-sync-idempotency.spec.ts src/modules/blocks/blocks.service.draft.spec.ts docs/superpowers/specs/2026-06-04-sync-backend-hardening-design.md docs/superpowers/plans/2026-06-04-sync-backend-hardening-plan.md
git commit -m "fix(blocks): 为批量同步增加批次幂等回执"
```

### Task 6: 收紧版本号与 create 去重查询

**Files:**
- Modify: `src/modules/blocks/blocks.service.ts`
- Modify: `src/modules/blocks/blocks-sync-idempotency.spec.ts`
- Modify: `src/modules/blocks/blocks.service.draft.spec.ts`
- Modify: `docs/superpowers/specs/2026-06-04-sync-backend-hardening-design.md`
- Modify: `docs/superpowers/plans/2026-06-04-sync-backend-hardening-plan.md`

- [ ] **Step 1: 写“历史最大版本号不依赖全量扫描”的失败测试**

在 `src/modules/blocks/blocks.service.draft.spec.ts` 中新增测试：

- 禁止 `manager.find(BlockVersion, ...)`
- 仍要求 `updateContent(..., createVersion: false)` 在存在历史版本 `ver=5` 且 `latestVer=1` 的情况下产出 `ver=6`

- [ ] **Step 2: 运行单测并确认它失败**

运行：

```bash
pnpm test -- src/modules/blocks/blocks.service.draft.spec.ts -t "does not require a full version scan"
```

预期：

- FAIL
- 失败原因是当前实现会全量读取历史版本

- [ ] **Step 3: 写“syncCreateId 去重不依赖 latest versions 全量扫描”的失败测试**

在 `src/modules/blocks/blocks-sync-idempotency.spec.ts` 中新增测试：

- 禁止 `findExistingCreateByClientIdentity()` 背后的 `getMany()` 全量扫描
- 首次 create 成功后，用不同 `clientBatchId` + 相同 `syncCreateId` 重试
- 断言第二次返回同一个 `blockId`

- [ ] **Step 4: 运行单测并确认它失败**

运行：

```bash
pnpm test -- src/modules/blocks/blocks-sync-idempotency.spec.ts -t "reuses syncCreateId without relying on a latest-version full scan"
```

预期：

- FAIL
- 失败原因是当前实现依赖 `getMany()` 全量扫描

- [ ] **Step 5: 最小实现查询收敛**

修改 `src/modules/blocks/blocks.service.ts`：

1. `getNextBlockVersionNumber()` 改成 `MAX(bv.ver)` 聚合查询
2. `findExistingCreateByClientIdentity()` 改成：
   - 先按 `syncCreateId` 定向查
   - 再按 `clientBatchId + clientId` 定向查
3. PostgreSQL 用 `payload->'attrs'->>'key'`
4. SQLite 用 `json_extract(payload, '$.attrs.key')`

- [ ] **Step 6: 运行定向回归**

运行：

```bash
pnpm test -- src/modules/blocks/blocks-sync-idempotency.spec.ts
pnpm test -- src/modules/blocks/blocks.service.draft.spec.ts
pnpm test -- src/modules/documents/services/document-draft.service.spec.ts
```

预期：

- PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/blocks/blocks.service.ts src/modules/blocks/blocks-sync-idempotency.spec.ts src/modules/blocks/blocks.service.draft.spec.ts docs/superpowers/specs/2026-06-04-sync-backend-hardening-design.md docs/superpowers/plans/2026-06-04-sync-backend-hardening-plan.md
git commit -m "perf(blocks): 收紧版本号与 create 去重查询"
```
