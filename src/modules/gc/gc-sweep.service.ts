// cspell:words tombstone
import { Injectable } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, FindOptionsWhere, Repository } from "typeorm";
import { BlockVersion } from "../../entities/block-version.entity";
import { DocDraft } from "../../entities/doc-draft.entity";
import { DocSnapshot } from "../../entities/doc-snapshot.entity";
import { GcCandidatePool } from "../../entities/gc-candidate-pool.entity";
import { GcRun } from "../../entities/gc-run.entity";
import { GcPolicyService } from "./gc-policy.service";

export type CreateDraftTombstoneSweepInput = {
  workspaceId?: string;
  docId?: string;
  limit?: number;
  dryRun?: boolean;
};

type DraftSweepBlocker =
  | "draft_missing"
  | "draft_workspace_mismatch"
  | "draft_map_entry_missing"
  | "draft_map_entry_changed"
  | "block_version_missing"
  | "block_version_not_tombstone";

@Injectable()
export class GcSweepService {
  constructor(
    @InjectRepository(GcRun)
    private readonly gcRunRepository: Repository<GcRun>,
    @InjectRepository(GcCandidatePool)
    private readonly gcCandidatePoolRepository: Repository<GcCandidatePool>,
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
      const candidates = await this.findEligibleDraftTombstoneCandidates(input, limit);
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

  private async findEligibleDraftTombstoneCandidates(
    input: CreateDraftTombstoneSweepInput,
    limit: number,
  ) {
    const where: FindOptionsWhere<GcCandidatePool> = {
      resourceType: "block_version",
      state: "eligible",
      action: "compact_map_entry",
      source: "document_drafts",
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
}
