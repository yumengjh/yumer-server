# Render Cache GC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a render-cache GC module that keeps only current published-snapshot-reachable render caches and deletes unused derived caches without TTL.

**Architecture:** Implement a lightweight GC service under `src/modules/gc/modules/render-cache` that computes per-document keep sets from `documents.publishedSnapshotId -> doc_snapshots.blockVersionMap -> block_versions.id`. Expose admin status/sweep APIs, register the submodule, best-effort hook publish/unpublish, and delete render caches when block versions are physically swept.

**Tech Stack:** NestJS, TypeORM repositories, Jest, existing `gc_runs` audit model.

---

### Task 1: Render-cache GC service and controller

**Files:**

- Create: `src/modules/gc/modules/render-cache/gc-render-cache.service.spec.ts`
- Create: `src/modules/gc/modules/render-cache/gc-render-cache.service.ts`
- Create: `src/modules/gc/modules/render-cache/gc-render-cache.controller.spec.ts`
- Create: `src/modules/gc/modules/render-cache/gc-render-cache.controller.ts`
- Create: `src/modules/gc/modules/render-cache/dto/create-render-cache-gc-sweep.dto.ts`
- Create: `src/modules/gc/modules/render-cache/dto/query-render-cache-gc-status.dto.ts`
- Create: `src/modules/gc/modules/render-cache/gc-render-cache.module.ts`
- Create: `src/modules/gc/modules/render-cache/gc-render-cache.submodule.ts`
- Modify: `src/modules/gc/gc.module.ts`
- Modify: `src/modules/gc/gc-registry.service.ts`

- [ ] Write failing service tests for unpublished docs, current published keep set, stale render versions, missing snapshots, dry-run, real sweep confirmation, and document clear.
- [ ] Implement service minimally with repository/data-source access.
- [ ] Write failing controller/module registry tests.
- [ ] Implement controller/module/submodule and registry wiring.
- [ ] Run targeted Jest tests.

### Task 2: Publish/unpublish and block-version GC integration

**Files:**

- Modify: `src/modules/documents/documents.module.ts`
- Modify: `src/modules/documents/documents.service.ts`
- Modify: `src/modules/documents/documents.service.spec.ts`
- Modify: `src/modules/gc/modules/block-version/block-version-gc.module.ts`
- Modify: `src/modules/gc/modules/block-version/gc-sweep.service.ts`
- Modify: `src/modules/gc/modules/block-version/gc-sweep.service.spec.ts`

- [ ] Write failing tests that publish best-effort sweeps one document and unpublish clears one document without failing publish/unpublish on GC errors.
- [ ] Implement optional injection and best-effort calls after publish/unpublish transactions.
- [ ] Write failing test that physical block-version sweep deletes matching `block_render_caches`.
- [ ] Implement auxiliary render-cache delete inside real block-version delete transaction.
- [ ] Run targeted Jest tests.

### Task 3: Verification and commit

**Files:**

- All touched files.

- [ ] Run targeted render-cache, documents, block-version, registry tests.
- [ ] Run lint/build if feasible.
- [ ] Inspect git diff for unrelated changes.
- [ ] Commit implementation.
