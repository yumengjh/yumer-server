// cspell:words explainability
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Block } from "../../entities/block.entity";
import { BlockVersion } from "../../entities/block-version.entity";
import { DocDraft } from "../../entities/doc-draft.entity";
import { DocSnapshot } from "../../entities/doc-snapshot.entity";
import { Document } from "../../entities/document.entity";
import { blockVersionResourceKey, snapshotMapToResourceKeys } from "./gc-resource-key.util";
import type {
  BlockVersionGcCandidate,
  BlockVersionGcCandidateAgeBucket,
  BlockVersionGcCollectorResult,
  BlockVersionGcCandidateReasonDetail,
  BlockVersionGcPolicy,
  BlockVersionGcScope,
} from "./gc.types";
import { GcPolicyService } from "./gc-policy.service";

type RootSource = "doc_snapshots" | "document_drafts";
type RootKind = "live" | "tombstone";

type RootEntry = {
  source: RootSource;
  kind: RootKind;
};

@Injectable()
export class BlockVersionGcCollector {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(Block)
    private readonly blockRepository: Repository<Block>,
    @InjectRepository(BlockVersion)
    private readonly blockVersionRepository: Repository<BlockVersion>,
    @InjectRepository(DocSnapshot)
    private readonly docSnapshotRepository: Repository<DocSnapshot>,
    @InjectRepository(DocDraft)
    private readonly docDraftRepository: Repository<DocDraft>,
    private readonly gcPolicyService: GcPolicyService,
  ) {}

  async preview(
    scope: BlockVersionGcScope,
    policy: BlockVersionGcPolicy,
  ): Promise<BlockVersionGcCollectorResult> {
    const documents = await this.findScopedDocuments(scope);
    const docIds = documents.map((document) => document.docId);
    const workspaceByDoc = new Map(
      documents.map((document) => [document.docId, document.workspaceId]),
    );

    if (docIds.length === 0) {
      return this.emptyResult();
    }

    const [blockVersions, blocks, snapshots, drafts] = await Promise.all([
      this.blockVersionRepository.find({ where: { docId: In(docIds) } }),
      this.blockRepository.find({
        where: { docId: In(docIds) },
        select: ["docId", "blockId", "latestVer"],
      }),
      this.docSnapshotRepository.find({ where: { docId: In(docIds) } }),
      this.docDraftRepository.find({ where: { docId: In(docIds) } }),
    ]);

    const versionByResourceKey = new Map(
      blockVersions.map((version) => [
        blockVersionResourceKey(version.blockId, version.ver),
        version,
      ]),
    );
    const liveRoots = new Set<string>();
    const tombstoneRoots = new Set<string>();
    const rootEntriesByResourceKey = new Map<string, RootEntry[]>();
    let docSnapshotRootCount = 0;
    let documentDraftRootCount = 0;
    let softDeletedMapEntries = 0;

    for (const snapshot of snapshots) {
      const keys = snapshotMapToResourceKeys(snapshot.blockVersionMap as Record<string, number>);
      docSnapshotRootCount += keys.size;
      for (const key of keys) {
        const rootEntry = this.classifyRootEntry(versionByResourceKey.get(key), "doc_snapshots");
        if (!rootEntry) continue;

        if (rootEntry.kind === "tombstone") {
          softDeletedMapEntries += 1;
          tombstoneRoots.add(key);
        } else {
          liveRoots.add(key);
        }

        const entries = rootEntriesByResourceKey.get(key) ?? [];
        entries.push(rootEntry);
        rootEntriesByResourceKey.set(key, entries);
      }
    }

    for (const draft of drafts) {
      const keys = snapshotMapToResourceKeys(draft.blockVersionMap);
      documentDraftRootCount += keys.size;
      for (const key of keys) {
        const rootEntry = this.classifyRootEntry(versionByResourceKey.get(key), "document_drafts");
        if (!rootEntry) continue;

        if (rootEntry.kind === "tombstone") {
          softDeletedMapEntries += 1;
          tombstoneRoots.add(key);
        } else {
          liveRoots.add(key);
        }

        const entries = rootEntriesByResourceKey.get(key) ?? [];
        entries.push(rootEntry);
        rootEntriesByResourceKey.set(key, entries);
      }
    }

    const retained = this.calculatePolicyRetained(blockVersions, blocks, policy);
    const latestVerByBlock = new Map(blocks.map((block) => [block.blockId, block.latestVer]));
    const nowMs = Date.now();
    const candidates: BlockVersionGcCandidate[] = [];
    const candidateReasons: Record<string, number> = {};
    let candidateBlockVersions = 0;
    let tombstoneCompactionCandidates = 0;

    for (const version of blockVersions) {
      const resourceKey = blockVersionResourceKey(version.blockId, version.ver);
      const rootEntries = rootEntriesByResourceKey.get(resourceKey) ?? [];
      const rootKind = liveRoots.has(resourceKey)
        ? "live"
        : tombstoneRoots.has(resourceKey)
          ? "tombstone"
          : "none";
      const primarySource = rootEntries[0]?.source ?? null;
      const deleted = this.isDeletedTombstone(version);

      if (rootKind === "live") continue;

      if (rootKind === "tombstone") {
        if (!this.isOlderThan(version.createdAt, policy.tombstoneGracePeriodMs)) continue;

        const reasonCode = "deleted_tombstone_map_entry";
        const reasonDetail = this.buildReasonDetail({
          rootKind,
          deleted,
          source: primarySource,
          action: "compact_map_entry",
          hardRooted: true,
          retainedByPolicy: retained.has(resourceKey),
          ageMs: nowMs - Number(version.createdAt),
          ageBucket: this.deriveAgeBucket(
            nowMs - Number(version.createdAt),
            policy.tombstoneGracePeriodMs,
          ),
          rootSourceCount: rootEntries.length,
          distanceFromLatestVer:
            (latestVerByBlock.get(version.blockId) ?? version.ver) - version.ver,
          gracePeriodMs: policy.gracePeriodMs,
          tombstoneGracePeriodMs: policy.tombstoneGracePeriodMs,
          keepLatestPerBlock: policy.keepLatestPerBlock,
          decisionPath: ["tombstone_root", "old_enough_for_compaction"],
        });
        const explainability = this.gcPolicyService.assessBlockVersionCandidate({
          reasonCode,
          rootKind: reasonDetail.rootKind,
          deleted: reasonDetail.deleted,
          source: reasonDetail.source,
          action: reasonDetail.action,
          hardRooted: reasonDetail.hardRooted,
          retainedByPolicy: reasonDetail.retainedByPolicy,
          versionCreatedAt: Number(version.createdAt),
          ageMs: reasonDetail.ageMs,
          ageBucket: reasonDetail.ageBucket,
          rootSourceCount: reasonDetail.rootSourceCount,
          distanceFromLatestVer: reasonDetail.distanceFromLatestVer,
          gracePeriodMs: reasonDetail.gracePeriodMs ?? policy.gracePeriodMs,
          tombstoneGracePeriodMs:
            reasonDetail.tombstoneGracePeriodMs ?? policy.tombstoneGracePeriodMs,
          keepLatestPerBlock: reasonDetail.keepLatestPerBlock ?? policy.keepLatestPerBlock,
          decisionPath: reasonDetail.decisionPath,
        });
        candidateReasons[reasonCode] = (candidateReasons[reasonCode] ?? 0) + 1;
        tombstoneCompactionCandidates += 1;
        candidates.push({
          resourceKey,
          resourceRowId: version.id,
          docId: version.docId,
          workspaceId: workspaceByDoc.get(version.docId) ?? null,
          blockId: version.blockId,
          blockVer: version.ver,
          versionCreatedAt: Number(version.createdAt),
          reasonCode,
          reasonDetail,
          riskLevel: explainability.riskAssessment.level,
          ...explainability,
        });
        continue;
      }

      if (retained.has(resourceKey)) continue;

      const reasonCode = "unreferenced_older_than_policy";
      const reasonDetail = this.buildReasonDetail({
        rootKind,
        deleted,
        source: primarySource,
        action: "candidate_block_version",
        hardRooted: false,
        retainedByPolicy: false,
        ageMs: nowMs - Number(version.createdAt),
        ageBucket: this.deriveAgeBucket(nowMs - Number(version.createdAt), policy.gracePeriodMs),
        rootSourceCount: rootEntries.length,
        distanceFromLatestVer: (latestVerByBlock.get(version.blockId) ?? version.ver) - version.ver,
        gracePeriodMs: policy.gracePeriodMs,
        tombstoneGracePeriodMs: policy.tombstoneGracePeriodMs,
        keepLatestPerBlock: policy.keepLatestPerBlock,
        decisionPath: ["unreferenced", "older_than_policy"],
      });
      const explainability = this.gcPolicyService.assessBlockVersionCandidate({
        reasonCode,
        rootKind: reasonDetail.rootKind,
        deleted: reasonDetail.deleted,
        source: reasonDetail.source,
        action: reasonDetail.action,
        hardRooted: reasonDetail.hardRooted,
        retainedByPolicy: reasonDetail.retainedByPolicy,
        versionCreatedAt: Number(version.createdAt),
        ageMs: reasonDetail.ageMs,
        ageBucket: reasonDetail.ageBucket,
        rootSourceCount: reasonDetail.rootSourceCount,
        distanceFromLatestVer: reasonDetail.distanceFromLatestVer,
        gracePeriodMs: reasonDetail.gracePeriodMs ?? policy.gracePeriodMs,
        tombstoneGracePeriodMs:
          reasonDetail.tombstoneGracePeriodMs ?? policy.tombstoneGracePeriodMs,
        keepLatestPerBlock: reasonDetail.keepLatestPerBlock ?? policy.keepLatestPerBlock,
        decisionPath: reasonDetail.decisionPath,
      });
      candidateReasons[reasonCode] = (candidateReasons[reasonCode] ?? 0) + 1;
      candidateBlockVersions += 1;
      candidates.push({
        resourceKey,
        resourceRowId: version.id,
        docId: version.docId,
        workspaceId: workspaceByDoc.get(version.docId) ?? null,
        blockId: version.blockId,
        blockVer: version.ver,
        versionCreatedAt: Number(version.createdAt),
        reasonCode,
        reasonDetail,
        riskLevel: explainability.riskAssessment.level,
        ...explainability,
      });
    }

    return {
      summary: {
        blockVersionsScanned: blockVersions.length,
        hardRootedBlockVersions: liveRoots.size + tombstoneRoots.size,
        liveRootedBlockVersions: liveRoots.size,
        tombstoneRootedBlockVersions: tombstoneRoots.size,
        policyRetainedBlockVersions: retained.size,
        softDeletedMapEntries,
        candidateBlockVersions,
        tombstoneCompactionCandidates,
        rootSources: {
          docSnapshots: docSnapshotRootCount,
          documentDrafts: documentDraftRootCount,
        },
        candidateReasons,
      },
      candidates,
    };
  }

  private calculatePolicyRetained(
    blockVersions: BlockVersion[],
    blocks: Pick<Block, "blockId" | "latestVer">[],
    policy: BlockVersionGcPolicy,
  ): Set<string> {
    const retained = new Set<string>();
    const cutoff = Date.now() - policy.gracePeriodMs;

    for (const version of blockVersions) {
      if (Number(version.createdAt) >= cutoff) {
        retained.add(blockVersionResourceKey(version.blockId, version.ver));
      }
    }

    for (const block of blocks) {
      // `latestVer` 是块级别的单独保留，不走 keepLatestPerBlock 的候选逻辑。
      retained.add(blockVersionResourceKey(block.blockId, block.latestVer));
    }

    const versionsByBlock = new Map<string, BlockVersion[]>();
    for (const version of blockVersions) {
      const list = versionsByBlock.get(version.blockId) ?? [];
      list.push(version);
      versionsByBlock.set(version.blockId, list);
    }

    for (const versions of versionsByBlock.values()) {
      versions
        .sort((a, b) => b.ver - a.ver)
        .slice(0, policy.keepLatestPerBlock)
        .forEach((version) => retained.add(blockVersionResourceKey(version.blockId, version.ver)));
    }

    return retained;
  }

  private async findScopedDocuments(scope: BlockVersionGcScope): Promise<Document[]> {
    if (scope.docId) {
      const document = await this.documentRepository.findOne({ where: { docId: scope.docId } });
      if (!document) return [];
      if (scope.workspaceId && document.workspaceId !== scope.workspaceId) return [];
      return [document];
    }

    if (scope.workspaceId) {
      return this.documentRepository.find({ where: { workspaceId: scope.workspaceId } });
    }

    return this.documentRepository.find();
  }

  private emptyResult(): BlockVersionGcCollectorResult {
    return {
      summary: {
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
      },
      candidates: [],
    };
  }

  private classifyRootEntry(
    version: BlockVersion | undefined,
    source: RootSource,
  ): RootEntry | null {
    if (!version) return null;

    return {
      source,
      kind: this.isDeletedTombstone(version) ? "tombstone" : "live",
    };
  }

  private isDeletedTombstone(version: BlockVersion): boolean {
    const payload = (version.payload ?? {}) as Record<string, unknown>;
    const attrs = (payload.attrs ?? {}) as Record<string, unknown>;
    return attrs.deleted === true;
  }

  private isOlderThan(createdAt: number, gracePeriodMs: number): boolean {
    return Number(createdAt) < Date.now() - gracePeriodMs;
  }

  private buildReasonDetail(
    input: BlockVersionGcCandidateReasonDetail,
  ): BlockVersionGcCandidateReasonDetail {
    return input;
  }

  private deriveAgeBucket(ageMs: number, graceWindowMs: number): BlockVersionGcCandidateAgeBucket {
    if (ageMs < graceWindowMs * 2) return "fresh";
    if (ageMs < graceWindowMs * 8) return "recent";
    return "stable";
  }
}
