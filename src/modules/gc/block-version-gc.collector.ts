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
  BlockVersionGcCollectorResult,
  BlockVersionGcPolicy,
  BlockVersionGcScope,
} from "./gc.types";

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
  ) {}

  async preview(
    scope: BlockVersionGcScope,
    policy: BlockVersionGcPolicy,
  ): Promise<BlockVersionGcCollectorResult> {
    const documents = await this.findScopedDocuments(scope);
    const docIds = documents.map((document) => document.docId);
    const workspaceByDoc = new Map(documents.map((document) => [document.docId, document.workspaceId]));

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

    const hardRoots = new Set<string>();
    let docSnapshotRootCount = 0;
    let documentDraftRootCount = 0;

    for (const snapshot of snapshots) {
      const keys = snapshotMapToResourceKeys(snapshot.blockVersionMap as Record<string, number>);
      docSnapshotRootCount += keys.size;
      for (const key of keys) hardRoots.add(key);
    }

    for (const draft of drafts) {
      const keys = snapshotMapToResourceKeys(draft.blockVersionMap);
      documentDraftRootCount += keys.size;
      for (const key of keys) hardRoots.add(key);
    }

    const retained = this.calculatePolicyRetained(blockVersions, blocks, policy);
    const candidates: BlockVersionGcCandidate[] = [];
    const candidateReasons: Record<string, number> = {};

    for (const version of blockVersions) {
      const resourceKey = blockVersionResourceKey(version.blockId, version.ver);
      if (hardRoots.has(resourceKey) || retained.has(resourceKey)) continue;

      const reasonCode = "unreferenced_older_than_policy";
      candidateReasons[reasonCode] = (candidateReasons[reasonCode] ?? 0) + 1;
      candidates.push({
        resourceKey,
        resourceRowId: version.id,
        docId: version.docId,
        workspaceId: workspaceByDoc.get(version.docId) ?? null,
        blockId: version.blockId,
        blockVer: version.ver,
        versionCreatedAt: Number(version.createdAt),
        reasonCode,
        reasonDetail: {
          hardRooted: false,
          retainedByPolicy: false,
          gracePeriodMs: policy.gracePeriodMs,
          keepLatestPerBlock: policy.keepLatestPerBlock,
        },
        riskLevel: "medium",
      });
    }

    return {
      summary: {
        blockVersionsScanned: blockVersions.length,
        hardRootedBlockVersions: hardRoots.size,
        policyRetainedBlockVersions: retained.size,
        candidateBlockVersions: candidates.length,
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
        policyRetainedBlockVersions: 0,
        candidateBlockVersions: 0,
        rootSources: {
          docSnapshots: 0,
          documentDrafts: 0,
        },
        candidateReasons: {},
      },
      candidates: [],
    };
  }
}
