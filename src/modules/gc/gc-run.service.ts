import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsWhere, Repository } from "typeorm";
import { GcRun } from "../../entities/gc-run.entity";
import { GcRunCandidate } from "../../entities/gc-run-candidate.entity";
import { BlockVersionGcCollector } from "./block-version-gc.collector";
import { GcHealthService } from "./gc-health.service";
import { GcPolicyService } from "./gc-policy.service";
import type { BlockVersionGcScope } from "./gc.types";

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
            riskLevel: candidate.riskLevel,
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
    status?: string;
    workspaceId?: string;
    docId?: string;
  }) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: FindOptionsWhere<GcRun> = { resourceType: "block_version" };
    if (query.status) where.status = query.status as GcRun["status"];

    const [items, total] = await this.gcRunRepository.findAndCount({
      where,
      order: { createdAt: "DESC" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const filtered = items.filter((run) => {
      const scope = run.scope as { workspaceId?: string | null; docId?: string | null };
      if (query.workspaceId && scope.workspaceId !== query.workspaceId) return false;
      if (query.docId && scope.docId !== query.docId) return false;
      return true;
    });

    return { items: filtered, total, page, pageSize };
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
    await this.findRun(runId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await this.gcRunCandidateRepository.findAndCount({
      where: { runId, resourceType: "block_version" },
      order: { id: "ASC" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  private normalizeScope(input: BlockVersionGcScope): Record<string, unknown> {
    return {
      workspaceId: input.workspaceId ?? null,
      docId: input.docId ?? null,
    };
  }

  private emptySummary() {
    return {
      blockVersionsScanned: 0,
      hardRootedBlockVersions: 0,
      policyRetainedBlockVersions: 0,
      candidateBlockVersions: 0,
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
}
