// cspell:words tombstone
import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, FindOptionsWhere, Repository } from "typeorm";
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

type DraftSweepBlocker =
  | "draft_missing"
  | "draft_workspace_mismatch"
  | "draft_map_entry_missing"
  | "draft_map_entry_changed"
  | "block_version_missing"
  | "block_version_not_tombstone";

type RevisionSweepBlocker =
  | "snapshot_document_missing"
  | "snapshot_workspace_mismatch"
  | "snapshot_ref_missing"
  | "snapshot_non_revision_ref_present"
  | "snapshot_pinned_ref_present"
  | "draft_ref_present"
  | "block_version_missing"
  | "block_version_not_tombstone";

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
          summary.wouldCompactSnapshots += validation.matchingSnapshots.length;
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

  private async validateDraftTombstoneCandidate(
    candidate: GcCandidatePool,
    workspaceId?: string,
  ): Promise<DraftSweepBlocker[]> {
    const blockers: DraftSweepBlocker[] = [];
    const draft = await this.docDraftRepository.findOne({
      where: { docId: candidate.docId ?? "" },
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
    matchingSnapshots: DocSnapshot[];
  }> {
    const blockers: RevisionSweepBlocker[] = [];
    const document = await this.documentRepository.findOne({
      where: { docId: candidate.docId ?? "" },
    });

    if (!document) {
      blockers.push("snapshot_document_missing");
      return { blockers, matchingSnapshots: [] };
    }

    if (
      (workspaceId && document.workspaceId !== workspaceId) ||
      (candidate.workspaceId && document.workspaceId !== candidate.workspaceId)
    ) {
      blockers.push("snapshot_workspace_mismatch");
    }

    const snapshots = await this.docSnapshotRepository.find({
      where: { docId: candidate.docId ?? "" },
    });
    const matchingSnapshots = snapshots.filter((snapshot) =>
      this.hasCandidateMapEntry(snapshot.blockVersionMap, candidate.blockId, candidate.blockVer),
    );

    if (matchingSnapshots.length === 0) {
      blockers.push("snapshot_ref_missing");
    }

    if (matchingSnapshots.some((snapshot) => snapshot.kind !== "revision")) {
      blockers.push("snapshot_non_revision_ref_present");
    }

    if (matchingSnapshots.some((snapshot) => snapshot.pinned === true)) {
      blockers.push("snapshot_pinned_ref_present");
    }

    const draft = await this.docDraftRepository.findOne({
      where: { docId: candidate.docId ?? "" },
    });
    if (
      draft &&
      this.hasCandidateMapEntry(draft.blockVersionMap, candidate.blockId, candidate.blockVer)
    ) {
      blockers.push("draft_ref_present");
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
      return { blockers, matchingSnapshots };
    }

    if (!this.isDeletedTombstone(version)) {
      blockers.push("block_version_not_tombstone");
    }

    return {
      blockers,
      matchingSnapshots: matchingSnapshots.filter(
        (snapshot) => snapshot.kind === "revision" && snapshot.pinned !== true,
      ),
    };
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

      const draft = await draftRepository.findOne({
        where: { docId: candidate.docId ?? "" },
      });

      if (!draft) {
        throw new Error(`Draft ${candidate.docId} disappeared before compaction`);
      }

      const currentVer = draft.blockVersionMap?.[candidate.blockId];
      if (currentVer !== candidate.blockVer) {
        throw new Error(`Draft ${candidate.docId} map moved before compaction`);
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
      const snapshots = await snapshotRepository.find({
        where: { docId: candidate.docId ?? "" },
      });
      const matchingSnapshots = snapshots.filter((snapshot) =>
        this.hasCandidateMapEntry(snapshot.blockVersionMap, candidate.blockId, candidate.blockVer),
      );

      if (matchingSnapshots.length === 0) {
        throw new Error(
          `Snapshot refs for ${candidate.candidateKey} disappeared before compaction`,
        );
      }

      if (matchingSnapshots.some((snapshot) => snapshot.kind !== "revision")) {
        throw new Error(`Snapshot refs for ${candidate.candidateKey} are no longer revision-only`);
      }

      if (matchingSnapshots.some((snapshot) => snapshot.pinned === true)) {
        throw new Error(
          `Snapshot refs for ${candidate.candidateKey} became pinned before compaction`,
        );
      }

      for (const snapshot of matchingSnapshots) {
        const nextMap = {
          ...((snapshot.blockVersionMap ?? {}) as Record<string, number>),
        };
        delete nextMap[candidate.blockId];
        snapshot.blockVersionMap = nextMap;
        await snapshotRepository.save(snapshot);
      }

      await poolRepository.save({
        ...candidate,
        state: "swept",
        lastSweepAt: now,
        lastValidationAt: now,
        lastBlockers: [],
      });

      return {
        compactedSnapshots: matchingSnapshots.length,
        compactedEntries: matchingSnapshots.length,
      };
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
}
