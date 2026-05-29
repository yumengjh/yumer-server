import type { ObjectLiteral, Repository } from "typeorm";
import { BlockVersion } from "../../entities/block-version.entity";
import { DocDraft } from "../../entities/doc-draft.entity";
import { DocRevision } from "../../entities/doc-revision.entity";
import { DocSnapshot } from "../../entities/doc-snapshot.entity";
import { Document } from "../../entities/document.entity";
import { GcHealthService } from "./gc-health.service";

function repository<T extends ObjectLiteral>(
  overrides: Partial<Record<keyof Repository<T>, jest.Mock>>,
) {
  return overrides as unknown as Repository<T>;
}

describe("GcHealthService", () => {
  it("blocks preview when a revision is missing its snapshot", async () => {
    const service = new GcHealthService(
      repository<Document>({
        findOne: jest.fn().mockResolvedValue({ docId: "doc_1" }),
        find: jest.fn().mockResolvedValue([{ docId: "doc_1" }]),
      }),
      repository<DocRevision>({
        find: jest.fn().mockResolvedValue([{ docId: "doc_1", docVer: 2 }]),
      }),
      repository<DocSnapshot>({ find: jest.fn().mockResolvedValue([]) }),
      repository<DocDraft>({ find: jest.fn().mockResolvedValue([]) }),
      repository<BlockVersion>({ find: jest.fn().mockResolvedValue([]) }),
    );

    await expect(service.checkBlockVersionGcHealth({ docId: "doc_1" })).resolves.toMatchObject({
      status: "blocked",
      missingRevisionSnapshots: 1,
      samples: {
        missingRevisionSnapshots: [{ docId: "doc_1", docVer: 2 }],
      },
    });
  });

  it("blocks preview when a published document points to a missing snapshot", async () => {
    const service = new GcHealthService(
      repository<Document>({
        findOne: jest.fn().mockResolvedValue({
          docId: "doc_1",
          publishedHead: 5,
          publishedSnapshotId: "doc_1@snap@5",
        }),
        find: jest.fn().mockResolvedValue([
          {
            docId: "doc_1",
            publishedHead: 5,
            publishedSnapshotId: "doc_1@snap@5",
          },
        ]),
      }),
      repository<DocRevision>({ find: jest.fn().mockResolvedValue([]) }),
      repository<DocSnapshot>({ find: jest.fn().mockResolvedValue([]) }),
      repository<DocDraft>({ find: jest.fn().mockResolvedValue([]) }),
      repository<BlockVersion>({ find: jest.fn().mockResolvedValue([]) }),
    );

    await expect(service.checkBlockVersionGcHealth({ docId: "doc_1" })).resolves.toMatchObject({
      status: "blocked",
      missingPublishedSnapshots: 1,
      samples: {
        missingPublishedSnapshots: [{ docId: "doc_1", publishedSnapshotId: "doc_1@snap@5" }],
      },
    });
  });

  it("blocks preview when a snapshot references a missing block version", async () => {
    const service = new GcHealthService(
      repository<Document>({
        findOne: jest.fn().mockResolvedValue({ docId: "doc_1" }),
        find: jest.fn().mockResolvedValue([{ docId: "doc_1" }]),
      }),
      repository<DocRevision>({ find: jest.fn().mockResolvedValue([]) }),
      repository<DocSnapshot>({
        find: jest.fn().mockResolvedValue([
          {
            docId: "doc_1",
            docVer: 1,
            snapshotId: "doc_1@snap@1",
            blockVersionMap: { b_1: 2 },
          },
        ]),
      }),
      repository<DocDraft>({ find: jest.fn().mockResolvedValue([]) }),
      repository<BlockVersion>({ find: jest.fn().mockResolvedValue([]) }),
    );

    await expect(service.checkBlockVersionGcHealth({ docId: "doc_1" })).resolves.toMatchObject({
      status: "blocked",
      missingRootBlockVersions: 1,
      samples: {
        missingRootBlockVersions: [
          { source: "doc_snapshots", docId: "doc_1", resourceKey: "b_1@2" },
        ],
      },
    });
  });

  it("returns ok when revision snapshots and root references are complete", async () => {
    const service = new GcHealthService(
      repository<Document>({
        findOne: jest.fn().mockResolvedValue({ docId: "doc_1" }),
        find: jest.fn().mockResolvedValue([{ docId: "doc_1" }]),
      }),
      repository<DocRevision>({
        find: jest.fn().mockResolvedValue([{ docId: "doc_1", docVer: 1 }]),
      }),
      repository<DocSnapshot>({
        find: jest.fn().mockResolvedValue([
          { docId: "doc_1", docVer: 1, snapshotId: "doc_1@snap@1", blockVersionMap: { b_1: 1 } },
        ]),
      }),
      repository<DocDraft>({ find: jest.fn().mockResolvedValue([]) }),
      repository<BlockVersion>({
        find: jest.fn().mockResolvedValue([{ blockId: "b_1", ver: 1 }]),
      }),
    );

    await expect(service.checkBlockVersionGcHealth({ docId: "doc_1" })).resolves.toMatchObject({
      status: "ok",
      missingRevisionSnapshots: 0,
      missingPublishedSnapshots: 0,
      missingRootBlockVersions: 0,
    });
  });
});
