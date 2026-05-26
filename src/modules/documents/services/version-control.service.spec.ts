import type { DataSource, Repository } from "typeorm";
import type { Document } from "../../../entities/document.entity";
import type { DocRevision } from "../../../entities/doc-revision.entity";
import type { DocumentSnapshotService } from "./document-snapshot.service";
import { VersionControlService } from "./version-control.service";

describe("VersionControlService", () => {
  let service: VersionControlService;
  let dataSource: DataSource;
  let documentSnapshotService: jest.Mocked<
    Pick<DocumentSnapshotService, "createSnapshotForRevision">
  >;

  beforeEach(() => {
    const documentRepository = {} as Repository<Document>;
    const docRevisionRepository = {} as Repository<DocRevision>;
    dataSource = {
      transaction: jest.fn(),
    } as unknown as DataSource;
    documentSnapshotService = {
      createSnapshotForRevision: jest.fn().mockResolvedValue({ snapshotId: "doc_1@snap@2" }),
    };

    service = new VersionControlService(
      documentRepository,
      docRevisionRepository,
      dataSource,
      documentSnapshotService as DocumentSnapshotService,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it("returns pending draft state from in-memory counter", () => {
    service.recordPendingVersion("doc_1");
    service.recordPendingVersion("doc_1");

    expect(service.getPendingDraftState("doc_1")).toEqual({
      pendingCount: 2,
      hasPendingDraft: true,
    });
  });

  it("returns empty draft state for unknown doc", () => {
    expect(service.getPendingDraftState("missing_doc")).toEqual({
      pendingCount: 0,
      hasPendingDraft: false,
    });
  });

  it("maps draft existence to compatibility pending state", () => {
    expect((service as any).getPendingDraftStateFromDraft(true)).toEqual({
      pendingCount: 1,
      hasPendingDraft: true,
    });
    expect((service as any).getPendingDraftStateFromDraft(false)).toEqual({
      pendingCount: 0,
      hasPendingDraft: false,
    });
  });

  it("creates a matching snapshot when committing a pending document version", async () => {
    service.recordPendingVersion("doc_1");

    const document = {
      docId: "doc_1",
      head: 1,
      rootBlockId: "root_1",
      updatedBy: "user_1",
    } as Document;
    const revisionRepo = {
      create: jest.fn((value) => value),
      save: jest.fn().mockImplementation(async (value) => value),
    };
    const manager = {
      findOne: jest.fn().mockResolvedValue(document),
      save: jest.fn().mockImplementation(async (value) => value),
      getRepository: jest.fn().mockReturnValue(revisionRepo),
    };
    jest
      .mocked(dataSource.transaction)
      .mockImplementation(async (callback: any) => callback(manager));

    await expect(service.createVersion("doc_1", "user_1", "manual save")).resolves.toBe(2);

    expect(revisionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        revisionId: "doc_1@2",
        docId: "doc_1",
        docVer: 2,
        message: "manual save",
      }),
    );
    expect(documentSnapshotService.createSnapshotForRevision).toHaveBeenCalledWith(
      "doc_1",
      2,
      manager,
      expect.objectContaining({
        kind: "revision",
        pinned: false,
        metadata: expect.objectContaining({
          source: "commit",
          pendingOperations: 1,
        }),
      }),
    );
  });
});
