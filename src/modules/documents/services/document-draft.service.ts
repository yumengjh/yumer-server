import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { DocDraft } from "../../../entities/doc-draft.entity";
import { Document } from "../../../entities/document.entity";
import { DocRevision } from "../../../entities/doc-revision.entity";
import { DocSnapshot } from "../../../entities/doc-snapshot.entity";

@Injectable()
export class DocumentDraftService {
  constructor(
    @InjectRepository(DocDraft)
    private readonly docDraftRepository: Repository<DocDraft>,
    @InjectRepository(Document)
    private readonly documentRepository: Repository<Document>,
    @InjectRepository(DocRevision)
    private readonly docRevisionRepository: Repository<DocRevision>,
    @InjectRepository(DocSnapshot)
    private readonly docSnapshotRepository: Repository<DocSnapshot>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findByDocId(docId: string): Promise<DocDraft | null> {
    return this.docDraftRepository.findOne({ where: { docId } });
  }

  async discardDraft(docId: string) {
    await this.docDraftRepository.delete({ docId });
    return {
      docId,
      discarded: true,
      fallbackSource: "head" as const,
    };
  }

  async commitDraft(docId: string, userId: string, message?: string) {
    const draft = await this.docDraftRepository.findOne({ where: { docId } });
    if (!draft) {
      throw new BadRequestException("没有可提交的草稿");
    }

    return this.dataSource.transaction(async (manager) => {
      const document = await manager.findOne(Document, { where: { docId } });
      if (!document) {
        throw new NotFoundException(`文档 ${docId} 不存在`);
      }

      const newVersion = document.head + 1;
      document.head = newVersion;
      document.updatedBy = userId;
      await manager.save(Document, document);

      const revision = manager.getRepository(DocRevision).create({
        revisionId: `${docId}@${newVersion}`,
        docId,
        docVer: newVersion,
        createdAt: Date.now(),
        createdBy: userId,
        message: message || "Document updated from draft",
        branch: "draft",
        patches: [],
        rootBlockId: document.rootBlockId,
        source: "editor",
        opSummary: {
          source: "draft-commit",
          baseDocVer: draft.baseDocVer,
          changedBlocksCount: draft.changedBlocksCount,
          draftId: draft.draftId,
        },
      });
      await manager.save(DocRevision, revision);

      const snapshot = manager.getRepository(DocSnapshot).create({
        snapshotId: `${docId}@snap@${newVersion}`,
        docId,
        docVer: newVersion,
        createdAt: Date.now(),
        rootBlockId: draft.rootBlockId,
        blockVersionMap: draft.blockVersionMap,
        kind: "revision",
        pinned: false,
        retainUntil: null,
        metadata: {
          source: "draft-commit",
          baseDocVer: draft.baseDocVer,
          changedBlocksCount: draft.changedBlocksCount,
          draftId: draft.draftId,
        },
      });
      await manager.save(DocSnapshot, snapshot);
      await manager.delete(DocDraft, { docId });

      return {
        docId,
        version: newVersion,
        committed: true,
        draftRemoved: true,
      };
    });
  }
}
