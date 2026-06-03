import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { BlockVersion } from "../../../../entities/block-version.entity";
import { DocDraft } from "../../../../entities/doc-draft.entity";
import { DocRevision } from "../../../../entities/doc-revision.entity";
import { DocSnapshot } from "../../../../entities/doc-snapshot.entity";
import { Document } from "../../../../entities/document.entity";
import { snapshotMapToResourceKeys } from "./gc-resource-key.util";
import type { BlockVersionGcHealth, BlockVersionGcScope } from "./gc.types";

const SAMPLE_LIMIT = 10;

@Injectable()
export class GcHealthService {
  constructor(
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(DocRevision)
    private readonly docRevisionRepository: Repository<DocRevision>,
    @InjectRepository(DocSnapshot)
    private readonly docSnapshotRepository: Repository<DocSnapshot>,
    @InjectRepository(DocDraft)
    private readonly docDraftRepository: Repository<DocDraft>,
    @InjectRepository(BlockVersion)
    private readonly blockVersionRepository: Repository<BlockVersion>,
  ) {}

  async checkBlockVersionGcHealth(scope: BlockVersionGcScope): Promise<BlockVersionGcHealth> {
    const documents = await this.findScopedDocuments(scope);
    const docIds = documents.map((document) => document.docId);

    if (docIds.length === 0) {
      return this.emptyHealth("ok");
    }

    const [revisions, snapshots, drafts, existingVersions] = await Promise.all([
      this.docRevisionRepository.find({ where: { docId: In(docIds) } }),
      this.docSnapshotRepository.find({ where: { docId: In(docIds) } }),
      this.docDraftRepository.find({ where: { docId: In(docIds) } }),
      this.blockVersionRepository.find({
        where: { docId: In(docIds) },
        select: ["blockId", "ver"],
      }),
    ]);

    const snapshotByRevision = new Set(snapshots.map((snapshot) => `${snapshot.docId}@${snapshot.docVer}`));
    const snapshotIds = new Set(snapshots.map((snapshot) => snapshot.snapshotId));
    const existingVersionKeys = new Set(
      existingVersions.map((version) => `${version.blockId}@${version.ver}`),
    );

    const missingRevisionSnapshots = revisions
      .filter((revision) => !snapshotByRevision.has(`${revision.docId}@${revision.docVer}`))
      .map((revision) => ({ docId: revision.docId, docVer: revision.docVer }));

    const missingPublishedSnapshots = documents
      .filter((document) => document.publishedHead > 0)
      .filter(
        (document) =>
          !document.publishedSnapshotId || !snapshotIds.has(document.publishedSnapshotId),
      )
      .map((document) => ({
        docId: document.docId,
        publishedSnapshotId: document.publishedSnapshotId ?? null,
      }));

    const missingRootBlockVersions: Array<{ source: string; docId: string; resourceKey: string }> =
      [];

    for (const snapshot of snapshots) {
      for (const resourceKey of snapshotMapToResourceKeys(
        snapshot.blockVersionMap as Record<string, number>,
      )) {
        if (!existingVersionKeys.has(resourceKey)) {
          missingRootBlockVersions.push({
            source: "doc_snapshots",
            docId: snapshot.docId,
            resourceKey,
          });
        }
      }
    }

    for (const draft of drafts) {
      for (const resourceKey of snapshotMapToResourceKeys(draft.blockVersionMap)) {
        if (!existingVersionKeys.has(resourceKey)) {
          missingRootBlockVersions.push({
            source: "document_drafts",
            docId: draft.docId,
            resourceKey,
          });
        }
      }
    }

    const blocked =
      missingRevisionSnapshots.length > 0 ||
      missingPublishedSnapshots.length > 0 ||
      missingRootBlockVersions.length > 0;

    return {
      status: blocked ? "blocked" : "ok",
      missingRevisionSnapshots: missingRevisionSnapshots.length,
      missingPublishedSnapshots: missingPublishedSnapshots.length,
      missingRootBlockVersions: missingRootBlockVersions.length,
      samples: {
        missingRevisionSnapshots: missingRevisionSnapshots.slice(0, SAMPLE_LIMIT),
        missingPublishedSnapshots: missingPublishedSnapshots.slice(0, SAMPLE_LIMIT),
        missingRootBlockVersions: missingRootBlockVersions.slice(0, SAMPLE_LIMIT),
      },
    };
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

  private emptyHealth(status: "ok" | "blocked"): BlockVersionGcHealth {
    return {
      status,
      missingRevisionSnapshots: 0,
      missingPublishedSnapshots: 0,
      missingRootBlockVersions: 0,
      samples: {
        missingRevisionSnapshots: [],
        missingPublishedSnapshots: [],
        missingRootBlockVersions: [],
      },
    };
  }
}
