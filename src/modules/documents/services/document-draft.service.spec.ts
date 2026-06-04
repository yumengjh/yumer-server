import { DocDraft } from "../../../entities/doc-draft.entity";
import { Document } from "../../../entities/document.entity";
import { DocumentDraftService } from "./document-draft.service";

describe("DocDraft entity wiring", () => {
  it("stores one shared draft per document", () => {
    const draft = new DocDraft();
    draft.docId = "doc_1";
    draft.workspaceId = "ws_1";
    draft.rootBlockId = "root_1";
    draft.baseDocVer = 3;
    draft.blockVersionMap = { root_1: 1, b_1: 4 };
    draft.changedBlocksCount = 1;

    expect(draft.docId).toBe("doc_1");
    expect(draft.blockVersionMap).toEqual({ root_1: 1, b_1: 4 });
  });

  it("stores the monotonic draft revision on the document", () => {
    const document = new Document();
    document.docId = "doc_1";
    document.draftRevision = 7;

    expect(document.draftRevision).toBe(7);
  });

  it("increments the document revision when a draft is discarded", async () => {
    const deleteDraft = jest.fn().mockResolvedValue(undefined);
    const incrementDraftRevision = jest.fn().mockResolvedValue(undefined);
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === DocDraft) {
          return {
            findOne: jest.fn().mockResolvedValue({ docId: "doc_1", draftId: "draft_1" }),
            delete: deleteDraft,
          };
        }
        if (entity === Document) {
          return {
            increment: incrementDraftRevision,
            findOne: jest.fn().mockResolvedValue({ docId: "doc_1", draftRevision: 8 }),
          };
        }
        throw new Error(`Unexpected repository: ${String(entity)}`);
      }),
    };
    const dataSource = {
      options: { type: "better-sqlite3" },
      transaction: jest.fn(async (callback: (txManager: typeof manager) => Promise<unknown>) =>
        callback(manager),
      ),
    };
    const service = new (DocumentDraftService as any)(
      {},
      {},
      {},
      {},
      {},
      {},
      dataSource,
    ) as DocumentDraftService;

    await expect(service.discardDraft("doc_1")).resolves.toMatchObject({
      docId: "doc_1",
      discarded: true,
      fallbackSource: "head",
    });
    expect(deleteDraft).toHaveBeenCalledWith({ docId: "doc_1" });
    expect(incrementDraftRevision).toHaveBeenCalledWith({ docId: "doc_1" }, "draftRevision", 1);
    expect(deleteDraft.mock.invocationCallOrder[0]).toBeLessThan(
      incrementDraftRevision.mock.invocationCallOrder[0],
    );
  });

  it("does not increment the document revision when no draft exists", async () => {
    const deleteDraft = jest.fn().mockResolvedValue(undefined);
    const incrementDraftRevision = jest.fn().mockResolvedValue(undefined);
    const findDraft = jest.fn().mockResolvedValue(null);
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === DocDraft) {
          return {
            findOne: findDraft,
            delete: deleteDraft,
          };
        }
        if (entity === Document) {
          return {
            increment: incrementDraftRevision,
            findOne: jest.fn().mockResolvedValue({ docId: "doc_1", draftRevision: 8 }),
          };
        }
        throw new Error(`Unexpected repository: ${String(entity)}`);
      }),
    };
    const dataSource = {
      options: { type: "better-sqlite3" },
      transaction: jest.fn(async (callback: (txManager: typeof manager) => Promise<unknown>) =>
        callback(manager),
      ),
    };
    const service = new (DocumentDraftService as any)(
      {},
      {},
      {},
      {},
      {},
      {},
      dataSource,
    ) as DocumentDraftService;

    await expect(service.discardDraft("doc_1")).resolves.toMatchObject({
      docId: "doc_1",
      discarded: true,
      fallbackSource: "head",
    });
    expect(findDraft).toHaveBeenCalledWith({ where: { docId: "doc_1" } });
    expect(incrementDraftRevision).not.toHaveBeenCalled();
  });

  it("returns the document revision when a draft is committed", async () => {
    const document = {
      docId: "doc_1",
      workspaceId: "ws_1",
      rootBlockId: "root_1",
      head: 3,
      draftRevision: 12,
      updatedBy: "user_1",
    };
    const draft = {
      docId: "doc_1",
      draftId: "draft_1",
      rootBlockId: "root_1",
      baseDocVer: 3,
      baseSnapshotId: null,
      blockVersionMap: { root_1: 1 },
      changedBlocksCount: 1,
    };
    const deleteDraft = jest.fn().mockResolvedValue(undefined);
    const save = jest.fn().mockImplementation(async (_entity: unknown, value: unknown) => value);
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Document) {
          return { findOne: jest.fn().mockResolvedValue(document) };
        }
        if (entity === DocDraft) {
          return {
            findOne: jest.fn().mockResolvedValue(draft),
            delete: deleteDraft,
          };
        }
        return {
          create: jest.fn((value) => value),
        };
      }),
      save,
    };
    const dataSource = {
      options: { type: "better-sqlite3" },
    };
    const service = new (DocumentDraftService as any)(
      {},
      {},
      {},
      {},
      {},
      {},
      dataSource,
    ) as DocumentDraftService;

    await expect(
      service.commitDraftWithManager("doc_1", "user_1", "manual save", manager as any),
    ).resolves.toMatchObject({
      docId: "doc_1",
      version: 4,
      draftRevision: 12,
      committed: true,
      draftRemoved: true,
    });
    expect(deleteDraft).toHaveBeenCalledWith({ docId: "doc_1" });
  });
});
