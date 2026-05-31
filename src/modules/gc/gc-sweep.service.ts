// cspell:words tombstone
import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, FindOptionsWhere, Repository } from "typeorm";
import { Block } from "../../entities/block.entity";
import { BlockVersion } from "../../entities/block-version.entity";
import { DocDraft } from "../../entities/doc-draft.entity";
import { DocSnapshot } from "../../entities/doc-snapshot.entity";
import { Document } from "../../entities/document.entity";
import { GcCandidatePool } from "../../entities/gc-candidate-pool.entity";
import { GcRun } from "../../entities/gc-run.entity";
import { GcPolicyService } from "./gc-policy.service";

export type CreateDraftTombstoneSweepInput = {
  workspaceId?: string;
  docId?: string;
  limit?: number;
  dryRun?: boolean;
};

export type CreateRevisionTombstoneSweepInput = CreateDraftTombstoneSweepInput;
export type CreateBlockVersionSweepInput = CreateDraftTombstoneSweepInput;

type DraftSweepBlocker =
  | "draft_root_ref_invalid"
  | "draft_missing"
  | "draft_workspace_mismatch"
  | "draft_map_entry_missing"
  | "draft_map_entry_changed"
  | "block_version_missing"
  | "block_version_not_tombstone";

type RevisionSweepBlocker =
  | "snapshot_root_ref_invalid"
  | "snapshot_document_missing"
  | "snapshot_workspace_mismatch"
  | "snapshot_ref_missing"
  | "snapshot_non_revision_ref_present"
  | "snapshot_pinned_ref_present"
  | "block_version_missing"
  | "block_version_not_tombstone";

type BlockVersionSweepBlocker =
  | "candidate_action_invalid"
  | "document_missing"
  | "document_workspace_mismatch"
  | "block_missing"
  | "block_version_missing"
  | "block_latest_version"
  | "block_version_too_recent"
  | "block_version_policy_retained"
  | "snapshot_root_present"
  | "draft_root_present";

@Injectable()
export class GcSweepService {
  constructor(
    @InjectRepository(GcRun)
    private readonly gcRunRepository: Repository<GcRun>,
    @InjectRepository(GcCandidatePool)
    private readonly gcCandidatePoolRepository: Repository<GcCandidatePool>,
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(DocDraft)
    private readonly docDraftRepository: Repository<DocDraft>,
    @InjectRepository(DocSnapshot)
    private readonly docSnapshotRepository: Repository<DocSnapshot>,
    @InjectRepository(BlockVersion)
    private readonly blockVersionRepository: Repository<BlockVersion>,
    private readonly gcPolicyService: GcPolicyService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async sweepDraftTombstones(input: CreateDraftTombstoneSweepInput, triggeredBy: string) {
    const run = this.gcRunRepository.create({
      runId: this.generateRunId("gc_sweep"),
      resourceType: "block_version",
      mode: "sweep",
      status: "running",
      scope: {
        workspaceId: input.workspaceId ?? null,
        docId: input.docId ?? null,
        action: "compact_map_entry",
        source: "document_drafts",
        dryRun: input.dryRun === true,
      },
      policySnapshot: {},
      health: {},
      summary: {},
      candidateDetailsStored: false,
      candidateDetailsTruncated: false,
      triggeredBy,
      startedAt: new Date(),
      finishedAt: null,
      errorMessage: null,
    });
    await this.gcRunRepository.save(run);

    try {
      const policy = this.gcPolicyService.getBlockVersionPolicy();
      run.policySnapshot = policy;

      const limit = Math.min(input.limit ?? policy.maxSweepBatchSize, policy.maxSweepBatchSize);
      const candidates = await this.findEligibleTombstoneCandidates(
        input,
        limit,
        "document_drafts",
      );
      const summary = {
        dryRun: input.dryRun === true,
        selectedCandidates: candidates.length,
        processedCandidates: 0,
        compactedDraftEntries: 0,
        blockedCandidates: 0,
        wouldCompactCandidates: 0,
      };

      for (const candidate of candidates) {
        const blockers = await this.validateDraftTombstoneCandidate(candidate, input.workspaceId);
        const now = new Date();

        if (blockers.length > 0) {
          summary.processedCandidates += 1;
          summary.blockedCandidates += 1;
          await this.gcCandidatePoolRepository.save({
            ...candidate,
            state: "blocked",
            lastValidationAt: now,
            lastBlockers: blockers,
          });
          continue;
        }

        if (input.dryRun === true) {
          summary.processedCandidates += 1;
          summary.wouldCompactCandidates += 1;
          await this.gcCandidatePoolRepository.save({
            ...candidate,
            lastValidationAt: now,
            lastBlockers: [],
          });
          continue;
        }

        await this.compactDraftCandidate(candidate, triggeredBy, now);
        summary.processedCandidates += 1;
        summary.compactedDraftEntries += 1;
      }

      run.status = "completed";
      run.summary = summary;
      run.finishedAt = new Date();
      return this.gcRunRepository.save(run);
    } catch (error) {
      run.status = "failed";
      run.errorMessage = error instanceof Error ? error.message : String(error);
      run.finishedAt = new Date();
      return this.gcRunRepository.save(run);
    }
  }

  async sweepRevisionTombstones(input: CreateRevisionTombstoneSweepInput, triggeredBy: string) {
    const run = this.gcRunRepository.create({
      runId: this.generateRunId("gc_sweep"),
      resourceType: "block_version",
      mode: "sweep",
      status: "running",
      scope: {
        workspaceId: input.workspaceId ?? null,
        docId: input.docId ?? null,
        action: "compact_map_entry",
        source: "doc_snapshots",
        dryRun: input.dryRun === true,
      },
      policySnapshot: {},
      health: {},
      summary: {},
      candidateDetailsStored: false,
      candidateDetailsTruncated: false,
      triggeredBy,
      startedAt: new Date(),
      finishedAt: null,
      errorMessage: null,
    });
    await this.gcRunRepository.save(run);

    try {
      const policy = this.gcPolicyService.getBlockVersionPolicy();
      run.policySnapshot = policy;

      const limit = Math.min(input.limit ?? policy.maxSweepBatchSize, policy.maxSweepBatchSize);
      const candidates = await this.findEligibleTombstoneCandidates(input, limit, "doc_snapshots");
      const summary = {
        dryRun: input.dryRun === true,
        selectedCandidates: candidates.length,
        processedCandidates: 0,
        compactedSnapshots: 0,
        compactedSnapshotEntries: 0,
        blockedCandidates: 0,
        wouldCompactCandidates: 0,
        wouldCompactSnapshots: 0,
      };

      for (const candidate of candidates) {
        const validation = await this.validateRevisionTombstoneCandidate(
          candidate,
          input.workspaceId,
        );
        const now = new Date();

        if (validation.blockers.length > 0) {
          summary.processedCandidates += 1;
          summary.blockedCandidates += 1;
          await this.gcCandidatePoolRepository.save({
            ...candidate,
            state: "blocked",
            lastValidationAt: now,
            lastBlockers: validation.blockers,
          });
          continue;
        }

        if (input.dryRun === true) {
          summary.processedCandidates += 1;
          summary.wouldCompactCandidates += 1;
          summary.wouldCompactSnapshots += 1;
          await this.gcCandidatePoolRepository.save({
            ...candidate,
            lastValidationAt: now,
            lastBlockers: [],
          });
          continue;
        }

        const result = await this.compactRevisionCandidate(candidate, now);
        summary.processedCandidates += 1;
        summary.compactedSnapshots += result.compactedSnapshots;
        summary.compactedSnapshotEntries += result.compactedEntries;
      }

      run.status = "completed";
      run.summary = summary;
      run.finishedAt = new Date();
      return this.gcRunRepository.save(run);
    } catch (error) {
      run.status = "failed";
      run.errorMessage = error instanceof Error ? error.message : String(error);
      run.finishedAt = new Date();
      return this.gcRunRepository.save(run);
    }
  }

  async sweepBlockVersions(input: CreateBlockVersionSweepInput, triggeredBy: string) {
    const run = this.gcRunRepository.create({
      runId: this.generateRunId("gc_sweep"),
      resourceType: "block_version",
      mode: "sweep",
      status: "running",
      scope: {
        workspaceId: input.workspaceId ?? null,
        docId: input.docId ?? null,
        action: "candidate_block_version",
        dryRun: input.dryRun !== false,
      },
      policySnapshot: {},
      health: {},
      summary: {},
      candidateDetailsStored: false,
      candidateDetailsTruncated: false,
      triggeredBy,
      startedAt: new Date(),
      finishedAt: null,
      errorMessage: null,
    });
    await this.gcRunRepository.save(run);

    try {
      const policy = this.gcPolicyService.getBlockVersionPolicy();
      run.policySnapshot = policy;

      const limit = Math.min(input.limit ?? policy.maxSweepBatchSize, policy.maxSweepBatchSize);
      const candidates = await this.findEligibleBlockVersionCandidates(input, limit);
      const dryRun = input.dryRun !== false;
      const summary = {
        dryRun,
        selectedCandidates: candidates.length,
        processedCandidates: 0,
        deletedBlockVersions: 0,
        blockedCandidates: 0,
        wouldDeleteCandidates: 0,
      };

      for (const candidate of candidates) {
        const blockers = await this.validateBlockVersionCandidate(candidate, input, policy);
        const now = new Date();

        if (blockers.length > 0) {
          summary.processedCandidates += 1;
          summary.blockedCandidates += 1;
          await this.gcCandidatePoolRepository.save({
            ...candidate,
            state: "blocked",
            lastValidationAt: now,
            lastBlockers: blockers,
          });
          continue;
        }

        if (dryRun) {
          summary.processedCandidates += 1;
          summary.wouldDeleteCandidates += 1;
          await this.gcCandidatePoolRepository.save({
            ...candidate,
            lastValidationAt: now,
            lastBlockers: [],
          });
          continue;
        }

        const result = await this.deleteBlockVersionCandidate(
          candidate,
          input,
          policy,
          triggeredBy,
          now,
        );
        summary.processedCandidates += 1;
        if (result === "deleted") {
          summary.deletedBlockVersions += 1;
        } else {
          summary.blockedCandidates += 1;
        }
      }

      run.status = "completed";
      run.summary = summary;
      run.finishedAt = new Date();
      return this.gcRunRepository.save(run);
    } catch (error) {
      run.status = "failed";
      run.errorMessage = error instanceof Error ? error.message : String(error);
      run.finishedAt = new Date();
      return this.gcRunRepository.save(run);
    }
  }

  private async findEligibleTombstoneCandidates(
    input: CreateDraftTombstoneSweepInput,
    limit: number,
    source: "document_drafts" | "doc_snapshots",
  ) {
    const where: FindOptionsWhere<GcCandidatePool> = {
      resourceType: "block_version",
      state: "eligible",
      action: "compact_map_entry",
      source,
    };

    if (input.workspaceId) where.workspaceId = input.workspaceId;
    if (input.docId) where.docId = input.docId;

    return this.gcCandidatePoolRepository.find({
      where,
      order: {
        eligibleAfter: "ASC",
        firstSeenAt: "ASC",
        versionCreatedAt: "ASC",
      },
      take: limit,
    });
  }

  private async findEligibleBlockVersionCandidates(
    input: CreateBlockVersionSweepInput,
    limit: number,
  ) {
    const where: FindOptionsWhere<GcCandidatePool> = {
      resourceType: "block_version",
      state: "eligible",
      action: "candidate_block_version",
    };

    if (input.workspaceId) where.workspaceId = input.workspaceId;
    if (input.docId) where.docId = input.docId;

    return this.gcCandidatePoolRepository.find({
      where,
      order: {
        eligibleAfter: "ASC",
        firstSeenAt: "ASC",
        versionCreatedAt: "ASC",
      },
      take: limit,
    });
  }

  private async validateDraftTombstoneCandidate(
    candidate: GcCandidatePool,
    workspaceId?: string,
  ): Promise<DraftSweepBlocker[]> {
    const blockers: DraftSweepBlocker[] = [];
    const rootRef = this.readRootRef(candidate);

    if (rootRef.rootRefType !== "draft" || !rootRef.rootRefId) {
      blockers.push("draft_root_ref_invalid");
      return blockers;
    }

    const draft = await this.docDraftRepository.findOne({
      where: { draftId: rootRef.rootRefId },
    });

    if (!draft) {
      blockers.push("draft_missing");
      return blockers;
    }

    if (workspaceId && draft.workspaceId !== workspaceId) {
      blockers.push("draft_workspace_mismatch");
    }

    const currentVer = draft.blockVersionMap?.[candidate.blockId];
    if (currentVer === undefined) {
      blockers.push("draft_map_entry_missing");
    } else if (currentVer !== candidate.blockVer) {
      blockers.push("draft_map_entry_changed");
    }

    const version = await this.blockVersionRepository.findOne({
      where: {
        id: candidate.resourceRowId,
        docId: candidate.docId ?? "",
        blockId: candidate.blockId,
        ver: candidate.blockVer,
      },
    });

    if (!version) {
      blockers.push("block_version_missing");
      return blockers;
    }

    const payload = (version.payload ?? {}) as Record<string, unknown>;
    const attrs = (payload.attrs ?? {}) as Record<string, unknown>;
    if (attrs.deleted !== true) {
      blockers.push("block_version_not_tombstone");
    }

    return blockers;
  }

  private async validateRevisionTombstoneCandidate(
    candidate: GcCandidatePool,
    workspaceId?: string,
  ): Promise<{
    blockers: RevisionSweepBlocker[];
    matchingSnapshot: DocSnapshot | null;
  }> {
    const blockers: RevisionSweepBlocker[] = [];
    const rootRef = this.readRootRef(candidate);

    if (rootRef.rootRefType !== "snapshot" || !rootRef.rootRefId) {
      blockers.push("snapshot_root_ref_invalid");
      return { blockers, matchingSnapshot: null };
    }

    const snapshot = await this.docSnapshotRepository.findOne({
      where: { snapshotId: rootRef.rootRefId },
    });

    if (!snapshot) {
      blockers.push("snapshot_ref_missing");
      return { blockers, matchingSnapshot: null };
    }

    const document = await this.documentRepository.findOne({
      where: { docId: snapshot.docId },
    });

    if (!document) {
      blockers.push("snapshot_document_missing");
      return { blockers, matchingSnapshot: snapshot };
    }

    if (
      (workspaceId && document.workspaceId !== workspaceId) ||
      (candidate.workspaceId && document.workspaceId !== candidate.workspaceId)
    ) {
      blockers.push("snapshot_workspace_mismatch");
    }

    if (
      !this.hasCandidateMapEntry(snapshot.blockVersionMap, candidate.blockId, candidate.blockVer)
    ) {
      blockers.push("snapshot_ref_missing");
    }

    if (snapshot.kind !== "revision") {
      blockers.push("snapshot_non_revision_ref_present");
    }

    if (snapshot.pinned === true) {
      blockers.push("snapshot_pinned_ref_present");
    }

    const version = await this.blockVersionRepository.findOne({
      where: {
        id: candidate.resourceRowId,
        docId: snapshot.docId,
        blockId: candidate.blockId,
        ver: candidate.blockVer,
      },
    });

    if (!version) {
      blockers.push("block_version_missing");
      return { blockers, matchingSnapshot: snapshot };
    }

    if (!this.isDeletedTombstone(version)) {
      blockers.push("block_version_not_tombstone");
    }

    return {
      blockers,
      matchingSnapshot: snapshot,
    };
  }

  private async validateBlockVersionCandidate(
    candidate: GcCandidatePool,
    input: CreateBlockVersionSweepInput,
    policy: ReturnType<GcPolicyService["getBlockVersionPolicy"]>,
  ): Promise<BlockVersionSweepBlocker[]> {
    return this.validateBlockVersionCandidateWithRepositories(candidate, input, policy, {
      documentRepository: this.documentRepository,
      blockRepository: this.dataSource.getRepository(Block),
      blockVersionRepository: this.blockVersionRepository,
      docSnapshotRepository: this.docSnapshotRepository,
      docDraftRepository: this.docDraftRepository,
    });
  }

  private async validateBlockVersionCandidateWithRepositories(
    candidate: GcCandidatePool,
    input: CreateBlockVersionSweepInput,
    policy: ReturnType<GcPolicyService["getBlockVersionPolicy"]>,
    repositories: {
      documentRepository: Repository<Document>;
      blockRepository: Repository<Block>;
      blockVersionRepository: Repository<BlockVersion>;
      docSnapshotRepository: Repository<DocSnapshot>;
      docDraftRepository: Repository<DocDraft>;
    },
  ): Promise<BlockVersionSweepBlocker[]> {
    const blockers: BlockVersionSweepBlocker[] = [];

    if (candidate.action !== "candidate_block_version") {
      blockers.push("candidate_action_invalid");
      return blockers;
    }

    const document = await repositories.documentRepository.findOne({
      where: { docId: candidate.docId ?? "" },
    });

    if (!document) {
      blockers.push("document_missing");
      return blockers;
    }

    if (
      (input.workspaceId && document.workspaceId !== input.workspaceId) ||
      (candidate.workspaceId && document.workspaceId !== candidate.workspaceId)
    ) {
      blockers.push("document_workspace_mismatch");
    }

    const version = await repositories.blockVersionRepository.findOne({
      where: {
        id: candidate.resourceRowId,
        docId: candidate.docId ?? "",
        blockId: candidate.blockId,
        ver: candidate.blockVer,
      },
    });

    if (!version) {
      blockers.push("block_version_missing");
      return blockers;
    }

    const block = await repositories.blockRepository.findOne({
      where: { blockId: candidate.blockId, docId: candidate.docId ?? "" },
    });

    if (!block) {
      blockers.push("block_missing");
    } else if (block.latestVer === candidate.blockVer) {
      blockers.push("block_latest_version");
    }

    if (Date.now() - Number(version.createdAt) < policy.gracePeriodMs) {
      blockers.push("block_version_too_recent");
    }

    if (await this.isRetainedByKeepLatest(candidate, policy, repositories.blockVersionRepository)) {
      blockers.push("block_version_policy_retained");
    }

    const snapshots = await repositories.docSnapshotRepository.find({
      where: { docId: candidate.docId ?? "" },
    });
    if (
      snapshots.some((snapshot) =>
        this.hasCandidateMapEntry(snapshot.blockVersionMap, candidate.blockId, candidate.blockVer),
      )
    ) {
      blockers.push("snapshot_root_present");
    }

    const drafts = await repositories.docDraftRepository.find({
      where: { docId: candidate.docId ?? "" },
    });
    if (
      drafts.some((draft) =>
        this.hasCandidateMapEntry(draft.blockVersionMap, candidate.blockId, candidate.blockVer),
      )
    ) {
      blockers.push("draft_root_present");
    }

    return blockers;
  }

  private async compactDraftCandidate(
    candidate: GcCandidatePool,
    triggeredBy: string,
    now: Date,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const draftRepository = manager.getRepository(DocDraft);
      const snapshotRepository = manager.getRepository(DocSnapshot);
      const poolRepository = manager.getRepository(GcCandidatePool);
      const rootRef = this.readRootRef(candidate);

      if (rootRef.rootRefType !== "draft" || !rootRef.rootRefId) {
        throw new Error(`Draft root ref is missing for ${candidate.candidateKey}`);
      }

      const draft = await draftRepository.findOne({
        where: { draftId: rootRef.rootRefId },
      });

      if (!draft) {
        throw new Error(`Draft ${rootRef.rootRefId} disappeared before compaction`);
      }

      const currentVer = draft.blockVersionMap?.[candidate.blockId];
      if (currentVer !== candidate.blockVer) {
        throw new Error(`Draft ${rootRef.rootRefId} map moved before compaction`);
      }

      const nextMap = { ...(draft.blockVersionMap ?? {}) };
      delete nextMap[candidate.blockId];

      draft.blockVersionMap = nextMap;
      draft.changedBlocksCount = await this.calculateChangedBlocksCount(
        draft,
        nextMap,
        snapshotRepository,
      );
      draft.updatedAt = now.getTime();
      draft.updatedBy = triggeredBy;
      await draftRepository.save(draft);

      await poolRepository.save({
        ...candidate,
        state: "swept",
        lastSweepAt: now,
        lastValidationAt: now,
        lastBlockers: [],
      });
    });
  }

  private async compactRevisionCandidate(
    candidate: GcCandidatePool,
    now: Date,
  ): Promise<{ compactedSnapshots: number; compactedEntries: number }> {
    return this.dataSource.transaction(async (manager) => {
      const snapshotRepository = manager.getRepository(DocSnapshot);
      const poolRepository = manager.getRepository(GcCandidatePool);
      const rootRef = this.readRootRef(candidate);

      if (rootRef.rootRefType !== "snapshot" || !rootRef.rootRefId) {
        throw new Error(`Snapshot root ref is missing for ${candidate.candidateKey}`);
      }

      const snapshot = await snapshotRepository.findOne({
        where: { snapshotId: rootRef.rootRefId },
      });

      if (!snapshot) {
        throw new Error(`Snapshot ${rootRef.rootRefId} disappeared before compaction`);
      }

      if (
        !this.hasCandidateMapEntry(snapshot.blockVersionMap, candidate.blockId, candidate.blockVer)
      ) {
        throw new Error(`Snapshot ${rootRef.rootRefId} map moved before compaction`);
      }

      if (snapshot.kind !== "revision") {
        throw new Error(`Snapshot ${rootRef.rootRefId} is no longer a revision snapshot`);
      }

      if (snapshot.pinned === true) {
        throw new Error(`Snapshot ${rootRef.rootRefId} became pinned before compaction`);
      }

      const nextMap = {
        ...((snapshot.blockVersionMap ?? {}) as Record<string, number>),
      };
      delete nextMap[candidate.blockId];
      snapshot.blockVersionMap = nextMap;
      await snapshotRepository.save(snapshot);

      await poolRepository.save({
        ...candidate,
        state: "swept",
        lastSweepAt: now,
        lastValidationAt: now,
        lastBlockers: [],
      });

      return {
        compactedSnapshots: 1,
        compactedEntries: 1,
      };
    });
  }

  private async deleteBlockVersionCandidate(
    candidate: GcCandidatePool,
    input: CreateBlockVersionSweepInput,
    policy: ReturnType<GcPolicyService["getBlockVersionPolicy"]>,
    triggeredBy: string,
    now: Date,
  ): Promise<"deleted" | "blocked"> {
    return this.dataSource.transaction(async (manager) => {
      const documentRepository = manager.getRepository(Document);
      const blockRepository = manager.getRepository(Block);
      const blockVersionRepository = manager.getRepository(BlockVersion);
      const snapshotRepository = manager.getRepository(DocSnapshot);
      const draftRepository = manager.getRepository(DocDraft);
      const poolRepository = manager.getRepository(GcCandidatePool);

      const blockers = await this.validateBlockVersionCandidateWithRepositories(
        candidate,
        input,
        policy,
        {
          documentRepository,
          blockRepository,
          blockVersionRepository,
          docSnapshotRepository: snapshotRepository,
          docDraftRepository: draftRepository,
        },
      );

      if (blockers.length > 0) {
        await poolRepository.save({
          ...candidate,
          state: "blocked",
          lastValidationAt: now,
          lastBlockers: blockers,
        });
        return "blocked";
      }

      await blockVersionRepository.delete({
        id: candidate.resourceRowId,
        docId: candidate.docId ?? "",
        blockId: candidate.blockId,
        ver: candidate.blockVer,
      });
      await poolRepository.save({
        ...candidate,
        state: "swept",
        lastSweepAt: now,
        lastValidationAt: now,
        lastBlockers: [],
        policySnapshot: {
          ...candidate.policySnapshot,
          lastSweptBy: triggeredBy,
        },
      });
      return "deleted";
    });
  }

  private async calculateChangedBlocksCount(
    draft: DocDraft,
    currentMap: Record<string, number>,
    snapshotRepository: Repository<DocSnapshot>,
  ): Promise<number> {
    const snapshot =
      (draft.baseSnapshotId
        ? await snapshotRepository.findOne({
            where: { snapshotId: draft.baseSnapshotId },
          })
        : await snapshotRepository.findOne({
            where: { docId: draft.docId, docVer: draft.baseDocVer },
          })) ?? null;

    const baseMap = ((snapshot?.blockVersionMap ?? {}) as Record<string, number>) ?? {};
    const blockIds = new Set([...Object.keys(baseMap), ...Object.keys(currentMap)]);
    let changed = 0;

    for (const blockId of blockIds) {
      if (baseMap[blockId] !== currentMap[blockId]) {
        changed += 1;
      }
    }

    return changed;
  }

  private async isRetainedByKeepLatest(
    candidate: GcCandidatePool,
    policy: ReturnType<GcPolicyService["getBlockVersionPolicy"]>,
    blockVersionRepository: Repository<BlockVersion>,
  ): Promise<boolean> {
    if (policy.keepLatestPerBlock <= 0) {
      return false;
    }

    const versions = await blockVersionRepository.find({
      where: {
        docId: candidate.docId ?? "",
        blockId: candidate.blockId,
      },
      order: { ver: "DESC" },
      take: policy.keepLatestPerBlock,
    });

    return versions.some((version) => version.ver === candidate.blockVer);
  }

  private generateRunId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private hasCandidateMapEntry(map: unknown, blockId: string, blockVer: number): boolean {
    return ((map ?? {}) as Record<string, number>)[blockId] === blockVer;
  }

  private isDeletedTombstone(version: BlockVersion): boolean {
    const payload = (version.payload ?? {}) as Record<string, unknown>;
    const attrs = (payload.attrs ?? {}) as Record<string, unknown>;
    return attrs.deleted === true;
  }

  private readRootRef(candidate: GcCandidatePool): {
    rootRefType: string | null;
    rootRefId: string | null;
    rootRefKey: string | null;
  } {
    const reasonDetail = (candidate.reasonDetail ?? {}) as Record<string, unknown>;

    return {
      rootRefType: typeof reasonDetail.rootRefType === "string" ? reasonDetail.rootRefType : null,
      rootRefId: typeof reasonDetail.rootRefId === "string" ? reasonDetail.rootRefId : null,
      rootRefKey: typeof reasonDetail.rootRefKey === "string" ? reasonDetail.rootRefKey : null,
    };
  }
}
