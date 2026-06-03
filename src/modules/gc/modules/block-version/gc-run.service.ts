import { createHash } from "crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsWhere, In, Repository } from "typeorm";
import { GcCandidatePool } from "../../../../entities/gc-candidate-pool.entity";
import { GcRun } from "../../../../entities/gc-run.entity";
import { GcRunCandidate } from "../../../../entities/gc-run-candidate.entity";
import { BlockVersionGcCollector } from "./block-version-gc.collector";
import { GcHealthService } from "./gc-health.service";
import { GcPolicyService } from "./gc-policy.service";
import type {
  BlockVersionGcCandidate,
  BlockVersionGcCandidatePoolEntry,
  BlockVersionGcPersistedCandidate,
  BlockVersionGcPolicy,
  BlockVersionGcScope,
} from "./gc.types";

export type CreateBlockVersionGcRunInput = BlockVersionGcScope & {
  includeCandidates?: boolean;
};

@Injectable()
export class GcRunService {
  constructor(
    @InjectRepository(GcRun)
    private readonly gcRunRepository: Repository<GcRun>,
    @InjectRepository(GcRunCandidate)
    private readonly gcRunCandidateRepository: Repository<GcRunCandidate>,
    @InjectRepository(GcCandidatePool)
    private readonly gcCandidatePoolRepository: Repository<GcCandidatePool>,
    private readonly gcPolicyService: GcPolicyService,
    private readonly gcHealthService: GcHealthService,
    private readonly blockVersionGcCollector: BlockVersionGcCollector,
  ) {}

  async previewBlockVersions(input: CreateBlockVersionGcRunInput, triggeredBy: string) {
    const run = this.gcRunRepository.create({
      runId: this.generateRunId(),
      resourceType: "block_version",
      mode: "preview",
      status: "running",
      scope: this.normalizeScope(input),
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
      const health = await this.gcHealthService.checkBlockVersionGcHealth(input);
      run.policySnapshot = policy;
      run.health = health as unknown as Record<string, unknown>;

      if (health.status === "blocked") {
        run.status = "blocked";
        run.summary = this.emptySummary();
        run.finishedAt = new Date();
        return this.gcRunRepository.save(run);
      }

      const collectorResult = await this.blockVersionGcCollector.preview(input, policy);
      run.summary = collectorResult.summary as unknown as Record<string, unknown>;
      await this.syncCandidatePool(run, collectorResult.candidates, policy);

      if (input.includeCandidates === true) {
        const candidatesToStore = collectorResult.candidates.slice(0, policy.maxCandidatesToStore);
        const candidateEntities = candidatesToStore.map((candidate) =>
          this.gcRunCandidateRepository.create({
            runId: run.runId,
            resourceType: "block_version",
            resourceKey: candidate.resourceKey,
            resourceRowId: candidate.resourceRowId,
            docId: candidate.docId,
            workspaceId: candidate.workspaceId,
            blockId: candidate.blockId,
            blockVer: candidate.blockVer,
            versionCreatedAt: candidate.versionCreatedAt,
            reasonCode: candidate.reasonCode,
            reasonDetail: candidate.reasonDetail,
          }),
        );
        if (candidateEntities.length > 0) {
          await this.gcRunCandidateRepository.save(candidateEntities);
        }
        run.candidateDetailsStored = true;
        run.candidateDetailsTruncated =
          collectorResult.candidates.length > policy.maxCandidatesToStore;
      }

      run.status = "completed";
      run.finishedAt = new Date();
      return this.gcRunRepository.save(run);
    } catch (error) {
      run.status = "failed";
      run.errorMessage = error instanceof Error ? error.message : String(error);
      run.finishedAt = new Date();
      return this.gcRunRepository.save(run);
    }
  }

  async findRuns(query: {
    page?: number;
    pageSize?: number;
    mode?: string;
    status?: string;
    workspaceId?: string;
    docId?: string;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: FindOptionsWhere<GcRun> = { resourceType: "block_version" };
    if (query.mode) where.mode = query.mode as GcRun["mode"];
    if (query.status) where.status = query.status as GcRun["status"];

    if (!query.workspaceId && !query.docId) {
      const [items, total] = await this.gcRunRepository.findAndCount({
        where,
        order: { createdAt: "DESC" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items, total, page, pageSize };
    }

    const runs = await this.gcRunRepository.find({
      where,
      order: { createdAt: "DESC" },
    });

    const filtered = runs.filter((run) => {
      if (query.mode && run.mode !== query.mode) return false;
      if (query.status && run.status !== query.status) return false;
      const scope = run.scope as { workspaceId?: string | null; docId?: string | null };
      if (query.workspaceId && scope.workspaceId !== query.workspaceId) return false;
      if (query.docId && scope.docId !== query.docId) return false;
      return true;
    });
    const total = filtered.length;
    const items = filtered.slice((page - 1) * pageSize, page * pageSize);

    return { items, total, page, pageSize };
  }

  async findRun(runId: string) {
    const run = await this.gcRunRepository.findOne({
      where: { runId, resourceType: "block_version" },
    });
    if (!run) {
      throw new NotFoundException(`GC run ${runId} not found`);
    }
    return run;
  }

  async findCandidates(runId: string, query: { page?: number; pageSize?: number }) {
    const run = await this.findRun(runId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await this.gcRunCandidateRepository.findAndCount({
      where: { runId, resourceType: "block_version" },
      order: { id: "ASC" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const policy = this.normalizePolicySnapshot(run.policySnapshot);
    return {
      items: items.map((candidate) =>
        this.withDecisionFields(candidate as unknown as BlockVersionGcPersistedCandidate, policy),
      ),
      total,
      page,
      pageSize,
    };
  }

  async findPool(query: {
    page?: number;
    pageSize?: number;
    state?: string;
    action?: string;
    workspaceId?: string;
    docId?: string;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: FindOptionsWhere<GcCandidatePool> = {
      resourceType: "block_version",
    };

    if (query.state) where.state = query.state as GcCandidatePool["state"];
    if (query.action) where.action = query.action;
    if (query.workspaceId) where.workspaceId = query.workspaceId;
    if (query.docId) where.docId = query.docId;

    const [items, total] = await this.gcCandidatePoolRepository.findAndCount({
      where,
      order: {
        state: "ASC",
        eligibleAfter: "ASC",
        firstSeenAt: "ASC",
        versionCreatedAt: "ASC",
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      items: items.map((candidate) =>
        this.withDecisionFields(
          candidate as unknown as BlockVersionGcPersistedCandidate,
          this.normalizePolicySnapshot(candidate.policySnapshot),
        ),
      ),
      total,
      page,
      pageSize,
    };
  }

  private normalizeScope(input: BlockVersionGcScope): Record<string, unknown> {
    return {
      workspaceId: input.workspaceId ?? null,
      docId: input.docId ?? null,
    };
  }

  private withDecisionFields(
    candidate: BlockVersionGcPersistedCandidate,
    policy: BlockVersionGcPolicy,
  ) {
    const { riskLevel: _riskLevel, ...plainCandidate } = candidate as BlockVersionGcPersistedCandidate & {
      riskLevel?: unknown;
    };
    void _riskLevel;

    return {
      ...plainCandidate,
      ...this.gcPolicyService.explainPersistedBlockVersionCandidate(candidate, policy),
    };
  }

  private emptySummary() {
    return {
      blockVersionsScanned: 0,
      hardRootedBlockVersions: 0,
      liveRootedBlockVersions: 0,
      tombstoneRootedBlockVersions: 0,
      policyRetainedBlockVersions: 0,
      softDeletedMapEntries: 0,
      candidateBlockVersions: 0,
      tombstoneCompactionCandidates: 0,
      rootSources: {
        docSnapshots: 0,
        documentDrafts: 0,
      },
      candidateReasons: {},
    };
  }

  private generateRunId(): string {
    return `gc_run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private normalizePolicySnapshot(snapshot: Record<string, unknown>): BlockVersionGcPolicy {
    const defaults = this.gcPolicyService.getBlockVersionPolicy();
    return {
      ...defaults,
      ...snapshot,
    } as BlockVersionGcPolicy;
  }

  private async syncCandidatePool(
    run: GcRun,
    candidates: BlockVersionGcCandidate[],
    policy: BlockVersionGcPolicy,
  ): Promise<void> {
    if (candidates.length === 0) {
      return;
    }

    const seenAt = run.finishedAt ?? new Date();
    const candidateKeys = candidates.map((candidate) => this.buildCandidateKey(candidate));
    const existingItems = await this.gcCandidatePoolRepository.find({
      where: { candidateKey: In(candidateKeys) },
    });
    const existingByKey = new Map(existingItems.map((item) => [item.candidateKey, item]));

    const entities = candidates.map((candidate) => {
      const candidateKey = this.buildCandidateKey(candidate);
      const existing = existingByKey.get(candidateKey);
      const stableSeenCount =
        existing &&
        existing.reasonCode === candidate.reasonCode &&
        existing.resourceRowId === candidate.resourceRowId
          ? existing.stableSeenCount + 1
          : 1;
      const seenCount = existing ? existing.seenCount + 1 : 1;
      const firstSeenAt = existing?.firstSeenAt ?? seenAt;
      const eligibleAfter =
        existing?.eligibleAfter ?? new Date(firstSeenAt.getTime() + policy.promotionDelayMs);
      const shouldBeEligible =
        stableSeenCount >= policy.stableSeenThreshold &&
        seenAt.getTime() >= eligibleAfter.getTime();
      const nextState =
        existing?.state === "swept" ? "resurrected" : shouldBeEligible ? "eligible" : "pending";

      const entity = this.gcCandidatePoolRepository.create({
        id: existing?.id,
        candidateKey,
        resourceType: "block_version",
        action: candidate.reasonDetail.action,
        source: candidate.reasonDetail.source,
        resourceKey: candidate.resourceKey,
        resourceRowId: candidate.resourceRowId,
        docId: candidate.docId,
        workspaceId: candidate.workspaceId,
        blockId: candidate.blockId,
        blockVer: candidate.blockVer,
        versionCreatedAt: candidate.versionCreatedAt,
        firstSeenRunId: existing?.firstSeenRunId ?? run.runId,
        lastSeenRunId: run.runId,
        firstSeenAt,
        lastSeenAt: seenAt,
        seenCount,
        stableSeenCount,
        state: nextState,
        eligibleAfter,
        lastSweepAt: existing?.lastSweepAt ?? null,
        lastValidationAt: seenAt,
        reasonCode: candidate.reasonCode,
        reasonDetail: candidate.reasonDetail,
        policySnapshot: policy as unknown as Record<string, unknown>,
        lastBlockers: existing?.lastBlockers ?? [],
      });

      return entity;
    });

    if (entities.length > 0) {
      await this.gcCandidatePoolRepository.save(entities);
    }
  }

  private buildCandidateKey(candidate: BlockVersionGcCandidate | BlockVersionGcCandidatePoolEntry) {
    const reasonDetail = candidate.reasonDetail;
    const action = "action" in candidate ? candidate.action : reasonDetail.action;
    const rootRefKey = reasonDetail.rootRefKey;

    if (action === "compact_map_entry" && typeof rootRefKey === "string" && rootRefKey.length > 0) {
      const digest = createHash("sha1").update(rootRefKey).digest("hex").slice(0, 16);
      return `block_version:${candidate.resourceRowId}:${action}:${digest}`;
    }

    return `block_version:${candidate.resourceKey}:${action}`;
  }
}
