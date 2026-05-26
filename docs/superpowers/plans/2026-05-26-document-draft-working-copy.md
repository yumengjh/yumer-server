# Document Draft Working Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted shared draft working-copy model so the editor reopens unpublished changes by default, supports discard, and only creates formal revisions on commit.

**Architecture:** Keep `block_versions` as the single block-version store, add `document_drafts` as a per-document working snapshot with its own `blockVersionMap`, and split read paths into formal `/content` versus editor-only `/edit-content`. Update block writes with `createVersion = false` to mutate the draft map instead of the formal head, then keep `POST /documents/:docId/commit` as the public “commit current draft” endpoint.

**Tech Stack:** NestJS 11, TypeORM, PostgreSQL/SQLite compatibility layer, Vitest/Jest-style backend specs in-repo, Next.js/React frontend in `F:\yuediter`, pnpm, Ant Design.

---

## File structure map

### Backend
- Create: `src/entities/doc-draft.entity.ts`
  - Persist one shared draft per document, including `blockVersionMap`, `baseDocVer`, lock placeholders, and `changedBlocksCount`.
- Create: `src/database/migrations/1781200000000-CreateDocumentDrafts.ts`
  - Create the `document_drafts` table and indexes.
- Create: `src/modules/documents/dto/query-edit-content.dto.ts`
  - Validate `maxDepth`, `startBlockId`, `limit` for `/edit-content`.
- Create: `src/modules/documents/dto/edit-content-response.dto.ts`
  - Document the editor-only response shape.
- Create: `src/modules/documents/services/document-draft.service.ts`
  - Centralize draft creation, loading, mutation, discard, and commit.
- Create: `src/modules/documents/services/document-draft.service.spec.ts`
  - Unit coverage for lazy draft creation, commit, discard, and compatibility mapping.
- Modify: `src/modules/documents/documents.module.ts`
  - Register `DocDraft` entity/service.
- Modify: `src/modules/documents/documents.controller.ts`
  - Add `GET /:docId/edit-content`, `DELETE /:docId/draft`; keep `POST /:docId/commit` public and retarget it to draft commit semantics.
- Modify: `src/modules/documents/documents.controller.spec.ts`
  - Cover new routes and old route compatibility.
- Modify: `src/modules/documents/documents.service.ts`
  - Reuse tree-building logic for `/edit-content`; deprecate pending-version semantics.
- Modify: `src/modules/documents/documents.service.spec.ts`
  - Cover draft-preferred reads, discard, commit, and pending-version compatibility behavior.
- Modify: `src/modules/documents/services/version-control.service.ts`
  - Remove in-memory pending-version responsibility or downgrade it to compatibility shim only.
- Modify: `src/modules/documents/services/version-control.service.spec.ts`
  - Replace counter-based assertions with draft-compatibility assertions.
- Modify: `src/modules/blocks/blocks.module.ts`
  - Inject draft service dependencies.
- Modify: `src/modules/blocks/blocks.service.ts`
  - Route `createVersion = false` writes through draft mutation helpers.
- Create: `src/modules/blocks/blocks.service.draft.spec.ts`
  - Cover create/update/move/delete/batch draft mutations and lazy draft creation.

### Frontend (`F:\yuediter`)
- Modify: `src/services/document.ts`
  - Add `getEditContent`, `discardDraft`, editor-only response types, and keep `commitVersion()` pointed at `/documents/:docId/commit`.
- Create: `src/services/__tests__/document-edit-content.test.ts`
  - Cover `edit-content`, `discardDraft`, and commit request wiring.
- Modify: `src/contexts/DocumentContext.tsx`
  - Load editor content from `edit-content`; expose draft source metadata.
- Modify: `src/components/EditorPage.tsx`
  - Use draft source metadata, discard flow, and commit-after-flush semantics.
- Modify: `src/components/DocumentHeader.tsx`
  - Show draft-aware status and a discard button.
- Modify: `src/components/DocumentHeader.css`
  - Style the discard action and draft source indicator.
- Create: `src/components/__tests__/document-header-draft-actions.test.tsx`
  - Verify discard CTA visibility and status text.

### Docs
- Modify: `docs/superpowers/specs/2026-05-26-document-draft-design.md`
  - Update if implementation choices diverge.

---

### Task 1: Add persisted draft storage and registration

**Files:**
- Create: `src/entities/doc-draft.entity.ts`
- Create: `src/database/migrations/1781200000000-CreateDocumentDrafts.ts`
- Modify: `src/modules/documents/documents.module.ts`
- Test: `src/modules/documents/services/document-draft.service.spec.ts`

- [ ] **Step 1: Write the failing backend storage test**

```ts
import { DocDraft } from "../../../entities/doc-draft.entity";

describe("DocDraft entity wiring", () => {
  it("stores one shared draft per document", async () => {
    const draft = new DocDraft();
    draft.docId = "doc_1";
    draft.workspaceId = "ws_1";
    draft.rootBlockId = "root_1";
    draft.baseDocVer = 3;
    draft.blockVersionMap = { root_1: 1, b_1: 4 };
    draft.changedBlocksCount = 1;

    expect(draft.docId).toBe("doc_1");
    expect(draft.blockVersionMap).toEqual({ root_1: 1, b_1: 4 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test -- src/modules/documents/services/document-draft.service.spec.ts
```

Expected: FAIL with missing `DocDraft` entity/service or unresolved import.

- [ ] **Step 3: Write the minimal persistence layer**

```ts
// src/entities/doc-draft.entity.ts
@Entity("document_drafts")
@Index(["docId"], { unique: true })
export class DocDraft {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 100 })
  draftId: string;

  @Column()
  docId: string;

  @Column()
  workspaceId: string;

  @Column()
  rootBlockId: string;

  @Column()
  baseDocVer: number;

  @Column({ nullable: true, length: 150 })
  baseSnapshotId: string | null;

  @Column({ type: isSqlite() ? "simple-json" : "jsonb" })
  blockVersionMap: Record<string, number>;

  @Column({ default: 0 })
  changedBlocksCount: number;

  @Column()
  createdBy: string;

  @Column()
  updatedBy: string;

  @Column({ type: "bigint" })
  createdAt: number;

  @Column({ type: "bigint" })
  updatedAt: number;

  @Column({ nullable: true })
  lockOwnerUserId: string | null;

  @Column({ type: "bigint", nullable: true })
  lockAcquiredAt: number | null;

  @Column({ type: "bigint", nullable: true })
  lockHeartbeatAt: number | null;

  @Column({ type: "bigint", nullable: true })
  lockExpiresAt: number | null;

  @Column({ nullable: true, length: 100 })
  lockToken: string | null;
}
```

```ts
// src/modules/documents/documents.module.ts
TypeOrmModule.forFeature([
  Document,
  Block,
  BlockVersion,
  BlockRenderCache,
  DocRevision,
  DocSnapshot,
  DocDraft,
  Tag,
  User,
]);
```

- [ ] **Step 4: Run the focused backend test plus migration smoke check**

Run:

```bash
pnpm test -- src/modules/documents/services/document-draft.service.spec.ts
pnpm typecheck
```

Expected: PASS for the focused test, typecheck succeeds with the new entity registered.

- [ ] **Step 5: Commit**

```bash
git add src/entities/doc-draft.entity.ts src/database/migrations/1781200000000-CreateDocumentDrafts.ts src/modules/documents/documents.module.ts src/modules/documents/services/document-draft.service.spec.ts
git commit -m "✨ feat(documents): add persisted document draft storage"
```

### Task 2: Add `DocumentDraftService` plus editor-only read/discard routes

**Files:**
- Create: `src/modules/documents/services/document-draft.service.ts`
- Create: `src/modules/documents/dto/query-edit-content.dto.ts`
- Create: `src/modules/documents/dto/edit-content-response.dto.ts`
- Modify: `src/modules/documents/documents.controller.ts`
- Modify: `src/modules/documents/documents.controller.spec.ts`
- Modify: `src/modules/documents/documents.service.ts`
- Modify: `src/modules/documents/documents.service.spec.ts`
- Test: `src/modules/documents/services/document-draft.service.spec.ts`

- [ ] **Step 1: Write failing tests for `GET /edit-content` and `DELETE /draft`**

```ts
it("returns draft-backed edit content when a draft exists", async () => {
  jest.spyOn(service, "getEditContent").mockResolvedValue({
    docId: "doc_1",
    source: "draft",
    head: 3,
    publishedHead: 2,
    draft: { exists: true, draftId: "draft_1", baseDocVer: 3 },
    lock: { locked: false, lockOwnerUserId: null, lockExpiresAt: null },
    tree: { blockId: "root_1", type: "root", children: [] },
    pagination: { totalBlocks: 1, returnedBlocks: 1, hasMore: false },
  });

  await expect(controller.getEditContent("doc_1", {}, { userId: "user_1" })).resolves.toMatchObject({
    source: "draft",
  });
});

it("discards a draft idempotently", async () => {
  jest.spyOn(service, "discardDraft").mockResolvedValue({
    docId: "doc_1",
    discarded: true,
    fallbackSource: "head",
  });

  await expect(controller.discardDraft("doc_1", { userId: "user_1" })).resolves.toEqual({
    docId: "doc_1",
    discarded: true,
    fallbackSource: "head",
  });
});
```

- [ ] **Step 2: Run the controller/service tests to verify they fail**

Run:

```bash
pnpm test -- src/modules/documents/documents.controller.spec.ts
pnpm test -- src/modules/documents/documents.service.spec.ts
```

Expected: FAIL because `getEditContent`/`discardDraft` do not exist yet.

- [ ] **Step 3: Implement the editor-only read path and discard route**

```ts
// src/modules/documents/documents.controller.ts
@Get(":docId/edit-content")
async getEditContent(
  @Param("docId") docId: string,
  @Query() queryDto: QueryEditContentDto,
  @CurrentUser() user: any,
) {
  return this.documentsService.getEditContent(
    docId,
    user.userId,
    queryDto.maxDepth,
    queryDto.startBlockId,
    queryDto.limit,
  );
}

@Delete(":docId/draft")
async discardDraft(@Param("docId") docId: string, @CurrentUser() user: any) {
  return this.documentsService.discardDraft(docId, user.userId);
}
```

```ts
// src/modules/documents/documents.service.ts
async getEditContent(docId: string, userId: string, maxDepth?: number, startBlockId?: string, limit?: number) {
  const document = await this.findOne(docId, userId);
  const draft = await this.documentDraftService.findByDocId(docId);
  if (draft) {
    return this.documentDraftService.buildEditContentResponse(document, draft, maxDepth, startBlockId, limit);
  }
  return this.documentDraftService.buildHeadBackedEditContentResponse(document, maxDepth, startBlockId, limit);
}

async discardDraft(docId: string, userId: string) {
  const document = await this.findOne(docId, userId);
  await this.checkDocumentEditPermission(document, userId);
  return this.documentDraftService.discardDraft(docId);
}
```

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
pnpm test -- src/modules/documents/documents.controller.spec.ts
pnpm test -- src/modules/documents/documents.service.spec.ts
pnpm typecheck
```

Expected: PASS; `/content` tests still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/modules/documents/dto/query-edit-content.dto.ts src/modules/documents/dto/edit-content-response.dto.ts src/modules/documents/services/document-draft.service.ts src/modules/documents/documents.controller.ts src/modules/documents/documents.controller.spec.ts src/modules/documents/documents.service.ts src/modules/documents/documents.service.spec.ts
git commit -m "✨ feat(documents): add draft-backed edit content routes"
```

### Task 3: Retarget commit/pending compatibility to the draft model

**Files:**
- Modify: `src/modules/documents/documents.service.ts`
- Modify: `src/modules/documents/services/version-control.service.ts`
- Modify: `src/modules/documents/services/version-control.service.spec.ts`
- Modify: `src/modules/documents/documents.controller.ts`
- Modify: `src/modules/documents/documents.service.spec.ts`
- Test: `src/modules/documents/documents.controller.spec.ts`

- [ ] **Step 1: Write failing tests for draft commit and deprecated pending compatibility**

```ts
it("commits the current draft through POST /documents/:docId/commit", async () => {
  await expect(service.commitVersion("doc_1", "manual save", "user_1")).resolves.toMatchObject({
    docId: "doc_1",
    committed: true,
    version: 4,
  });
});

it("maps pending-versions to draft existence for compatibility", async () => {
  await expect(service.getPendingVersions("doc_1", "user_1")).resolves.toEqual({
    docId: "doc_1",
    pendingCount: 1,
    hasPending: true,
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm test -- src/modules/documents/documents.service.spec.ts
pnpm test -- src/modules/documents/services/version-control.service.spec.ts
```

Expected: FAIL because commit still reads in-memory counters and pending compatibility is not draft-backed.

- [ ] **Step 3: Implement draft commit and compatibility shim**

```ts
// src/modules/documents/documents.service.ts
async commitVersion(docId: string, message: string | undefined, userId: string) {
  const document = await this.findOne(docId, userId);
  await this.checkDocumentEditPermission(document, userId);
  return this.documentDraftService.commitDraft(docId, userId, message);
}

async getPendingVersions(docId: string, userId: string) {
  await this.findOne(docId, userId);
  const draft = await this.documentDraftService.findByDocId(docId);
  return {
    docId,
    pendingCount: draft ? 1 : 0,
    hasPending: !!draft,
  };
}
```

```ts
// src/modules/documents/services/version-control.service.ts
getPendingDraftStateFromDraft(draftExists: boolean) {
  return {
    pendingCount: draftExists ? 1 : 0,
    hasPendingDraft: draftExists,
  };
}
```

- [ ] **Step 4: Run focused tests plus regression on commit path**

Run:

```bash
pnpm test -- src/modules/documents/documents.service.spec.ts
pnpm test -- src/modules/documents/services/version-control.service.spec.ts
pnpm test -- src/modules/documents/documents.controller.spec.ts
```

Expected: PASS with `/commit` preserved publicly and `pending-versions` documented as compatibility only.

- [ ] **Step 5: Commit**

```bash
git add src/modules/documents/documents.service.ts src/modules/documents/services/version-control.service.ts src/modules/documents/services/version-control.service.spec.ts src/modules/documents/documents.controller.ts src/modules/documents/documents.service.spec.ts src/modules/documents/documents.controller.spec.ts
git commit -m "✨ feat(documents): commit persisted drafts and deprecate pending counters"
```

### Task 4: Move block mutations onto the draft map

**Files:**
- Modify: `src/modules/blocks/blocks.module.ts`
- Modify: `src/modules/blocks/blocks.service.ts`
- Create: `src/modules/blocks/blocks.service.draft.spec.ts`
- Modify: `src/modules/documents/services/document-draft.service.ts`
- Test: `src/modules/documents/services/document-draft.service.spec.ts`

- [ ] **Step 1: Write failing tests for lazy draft creation and `createVersion = false` mutations**

```ts
it("creates a draft from head on the first updateContent(createVersion=false)", async () => {
  await service.updateContent("block_1", { payload: { type: "paragraph" }, createVersion: false }, "user_1");

  expect(documentDraftService.ensureDraftForMutation).toHaveBeenCalledWith("doc_1", "user_1");
  expect(documentDraftService.pointBlockToVersion).toHaveBeenCalled();
});

it("records delete as a deleted-state block version inside the draft map", async () => {
  await service.removeFromDraft("block_1", "user_1");
  expect(documentDraftService.pointBlockToDeletedVersion).toHaveBeenCalledWith("doc_1", "block_1", expect.any(Number), "user_1");
});
```

- [ ] **Step 2: Run the failing block tests**

Run:

```bash
pnpm test -- src/modules/blocks/blocks.service.draft.spec.ts
```

Expected: FAIL because the draft helpers and delete-state versions do not exist yet.

- [ ] **Step 3: Implement draft-aware mutation helpers**

```ts
// src/modules/blocks/blocks.service.ts
if (updateBlockDto.createVersion === false) {
  const draft = await this.documentDraftService.ensureDraftForMutation(docId, userId, manager);
  await this.documentDraftService.pointBlockToVersion(draft.docId, blockId, newVer, userId, manager);
  return { blockId, version: newVer, payload: updateBlockDto.payload };
}

// delete path
const deletedPayload = {
  ...(latestVersion.payload as Record<string, unknown>),
  attrs: {
    ...(((latestVersion.payload as Record<string, unknown>).attrs as Record<string, unknown>) ?? {}),
    deleted: true,
  },
};
```

```ts
// src/modules/documents/services/document-draft.service.ts
async ensureDraftForMutation(docId: string, userId: string, manager: EntityManager) {
  const existing = await manager.findOne(DocDraft, { where: { docId } });
  if (existing) return existing;
  return this.createDraftFromHeadSnapshot(docId, userId, manager);
}
```

- [ ] **Step 4: Run backend draft mutation coverage**

Run:

```bash
pnpm test -- src/modules/blocks/blocks.service.draft.spec.ts
pnpm test -- src/modules/documents/services/document-draft.service.spec.ts
pnpm test -- src/modules/blocks/blocks-sync-idempotency.spec.ts
```

Expected: PASS; no regression in batch idempotency.

- [ ] **Step 5: Commit**

```bash
git add src/modules/blocks/blocks.module.ts src/modules/blocks/blocks.service.ts src/modules/blocks/blocks.service.draft.spec.ts src/modules/documents/services/document-draft.service.ts src/modules/documents/services/document-draft.service.spec.ts
git commit -m "✨ feat(blocks): route deferred block writes through document drafts"
```

### Task 5: Switch the frontend editor to `edit-content` and expose discard UX

**Files:**
- Modify: `F:\yuediter\src\services\document.ts`
- Create: `F:\yuediter\src\services\__tests__\document-edit-content.test.ts`
- Modify: `F:\yuediter\src\contexts\DocumentContext.tsx`
- Modify: `F:\yuediter\src\components\EditorPage.tsx`
- Modify: `F:\yuediter\src\components\DocumentHeader.tsx`
- Modify: `F:\yuediter\src\components\DocumentHeader.css`
- Create: `F:\yuediter\src\components\__tests__\document-header-draft-actions.test.tsx`

- [ ] **Step 1: Write failing frontend tests for edit-content loading and discard UI**

```ts
it("loads editor state from /documents/:docId/edit-content", async () => {
  const response = await getEditContent("doc_1");
  expect(response.source).toBe("draft");
  expect(response.draft.exists).toBe(true);
});

it("shows the discard draft action when the current editor source is draft", () => {
  render(<DocumentHeader onSave={vi.fn()} onDiscardDraft={vi.fn()} />);
  expect(screen.getByRole("button", { name: "取消草稿" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the frontend tests to verify they fail**

Run:

```bash
pnpm --dir F:\yuediter test -- src/services/__tests__/document-edit-content.test.ts
pnpm --dir F:\yuediter test -- src/components/__tests__/document-header-draft-actions.test.tsx
```

Expected: FAIL because the API helper, props, and status wiring do not exist yet.

- [ ] **Step 3: Implement the editor-only client flow**

```ts
// F:\yuediter\src\services\document.ts
export interface EditContentResponse {
  docId: string;
  source: "draft" | "head";
  head: number;
  publishedHead: number;
  draft: { exists: boolean; draftId?: string; baseDocVer?: number; updatedAt?: string; updatedBy?: string };
  lock: { locked: boolean; lockOwnerUserId: string | null; lockExpiresAt: string | null };
  tree: Block;
  pagination: { totalBlocks: number; returnedBlocks: number; hasMore: boolean; nextStartBlockId?: string };
}

export async function getEditContent(docId: string): Promise<EditContentResponse> {
  return apiGet<EditContentResponse>(`/documents/${docId}/edit-content`);
}

export async function discardDraft(docId: string): Promise<void> {
  await apiDelete(`/documents/${docId}/draft`);
}
```

```tsx
// F:\yuediter\src\contexts\DocumentContext.tsx
const loadContent = useCallback(async (docId: string) => {
  const response = await getEditContent(docId);
  setCurrentDocVersion(response.head);
  setCurrentContentSource(response.source);
  setCurrentDraftMeta(response.draft);
  const flatBlocks = flattenBlockTreeInDocumentOrder(response.tree).filter((b) => b.type !== "root");
  return { content: blocksToTiptapJson(flatBlocks), docVer: response.head };
}, []);
```

- [ ] **Step 4: Run the frontend tests and a typecheck**

Run:

```bash
pnpm --dir F:\yuediter test -- src/services/__tests__/document-edit-content.test.ts
pnpm --dir F:\yuediter test -- src/components/__tests__/document-header-draft-actions.test.tsx
pnpm --dir F:\yuediter typecheck
```

Expected: PASS; editor loads from draft when available and surfaces a discard action.

- [ ] **Step 5: Commit**

```bash
git add F:\yuediter\src\services\document.ts F:\yuediter\src\services\__tests__\document-edit-content.test.ts F:\yuediter\src\contexts\DocumentContext.tsx F:\yuediter\src\components\EditorPage.tsx F:\yuediter\src\components\DocumentHeader.tsx F:\yuediter\src\components\DocumentHeader.css F:\yuediter\src\components\__tests__\document-header-draft-actions.test.tsx
git commit -m "✨ feat(editor): load and discard persisted document drafts"
```

### Task 6: End-to-end verification, docs sync, and cleanup

**Files:**
- Modify: `docs/superpowers/specs/2026-05-26-document-draft-design.md` (only if implementation drift appears)
- Modify: `src/modules/documents/documents.service.spec.ts`
- Modify: `F:\yuediter\src\components\EditorPage.tsx`
- Test: backend + frontend focused suites

- [ ] **Step 1: Add a final regression checklist test case**

```ts
it("reopens draft content after navigating away and back, then falls back to head after discard", async () => {
  const first = await backend.getEditContent("doc_1", "user_1");
  expect(first.source).toBe("draft");

  await backend.discardDraft("doc_1", "user_1");

  const second = await backend.getEditContent("doc_1", "user_1");
  expect(second.source).toBe("head");
});
```

- [ ] **Step 2: Run the full focused verification suite**

Run:

```bash
pnpm test -- src/modules/documents/documents.controller.spec.ts
pnpm test -- src/modules/documents/documents.service.spec.ts
pnpm test -- src/modules/documents/services/document-draft.service.spec.ts
pnpm test -- src/modules/blocks/blocks.service.draft.spec.ts
pnpm --dir F:\yuediter test -- src/services/__tests__/document-edit-content.test.ts
pnpm --dir F:\yuediter test -- src/components/__tests__/document-header-draft-actions.test.tsx
```

Expected: PASS across draft read/write/commit/discard flows.

- [ ] **Step 3: Run cross-repo quality gates**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm --dir F:\yuediter lint
pnpm --dir F:\yuediter typecheck
```

Expected: PASS; no new lint or type errors.

- [ ] **Step 4: Sync the design doc if the implementation diverged**

```md
- Update endpoint names if the implementation kept only `POST /documents/:docId/commit`
- Update delete semantics if the deleted-state payload shape changed
- Record any migration-safe compatibility decisions for `pending-versions`
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-26-document-draft-design.md src/modules/documents/documents.service.spec.ts F:\yuediter\src\components\EditorPage.tsx
git commit -m "📚 docs(docs): finalize document draft rollout notes"
```

---

## Self-review checklist

- Spec coverage: covers persisted draft storage, editor-only read path, commit/discard semantics, block write redirection, compatibility handling, and frontend UX.
- Placeholder scan: no `TODO` / `TBD` / “similar to above” shortcuts remain; each task includes files, commands, and concrete snippets.
- Type consistency: uses `document_drafts.blockVersionMap`, `GET /documents/:docId/edit-content`, `DELETE /documents/:docId/draft`, and public `POST /documents/:docId/commit` consistently.
