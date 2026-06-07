import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { createHash } from "crypto";
import request from "supertest";
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter";
import { TransformInterceptor } from "../src/common/interceptors/transform.interceptor";
import { DocumentSyncSession } from "../src/entities/document-sync-session.entity";

// cspell:ignore autosync
const PREFIX = "api/v1";

function rand(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

describe("document sync transport (e2e)", () => {
  let app: INestApplication;
  let accessToken: string;
  let workspaceId: string;
  let docId: string;
  let rootBlockId: string;
  let head: number;
  let dataSource: DataSource;

  const user = {
    username: `sync_u_${rand()}`,
    email: `sync_e_${rand()}@test.local`,
    password: "TestPass123!",
    displayName: "Sync E2E User",
  };

  async function createDocumentForTest(title: string) {
    const docRes = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        workspaceId,
        title,
        visibility: "workspace",
      })
      .expect(201);

    return {
      docId: docRes.body.data.docId as string,
      rootBlockId: docRes.body.data.rootBlockId as string,
      head: docRes.body.data.head as number,
    };
  }

  async function acquireSyncSession(targetDocId: string) {
    const res = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents/${targetDocId}/sync-session/acquire`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({})
      .expect(200);

    return res.body.data as {
      sessionId: string;
      sessionEpoch: number;
      leaseExpiresAt?: string | null;
      lastAckedOpSeq?: number | null;
    };
  }

  async function getEditContent(targetDocId: string) {
    const res = await request(app.getHttpServer())
      .get(`/${PREFIX}/documents/${targetDocId}/edit-content`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    return res.body.data as {
      head: number;
      tree: Record<string, unknown> | null;
      draft: {
        exists: boolean;
        draftRevision: number;
      };
      syncSession?: {
        sessionId: string;
        sessionEpoch: number;
        lastAckedOpSeq?: number | null;
      } | null;
    };
  }

  async function expireSyncSession(targetDocId: string) {
    await dataSource.getRepository(DocumentSyncSession).update(
      { docId: targetDocId },
      {
        leaseExpiresAt: Date.now() - 1,
        updatedAt: Date.now() - 1,
      },
    );
  }

  function buildCheckpointContentHash(input: {
    docId: string;
    rootBlockId: string;
    blocks: Array<Record<string, unknown>>;
  }) {
    const canonical = JSON.stringify({
      docId: input.docId,
      rootBlockId: input.rootBlockId,
      blocks: input.blocks,
    });
    return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
  }

  function buildCheckpointRequest(input: {
    docId: string;
    rootBlockId: string;
    baseVersion: number;
    draftRevision: number;
    sessionId: string;
    sessionEpoch: number;
    clientCheckpointId: string;
    blocks: Array<Record<string, unknown>>;
  }) {
    return {
      mode: "checkpoint",
      coverage: "full",
      clientCheckpointId: input.clientCheckpointId,
      clientId: "e2e-client",
      baseVersion: input.baseVersion,
      draftRevision: input.draftRevision,
      sessionId: input.sessionId,
      sessionEpoch: input.sessionEpoch,
      contentHash: buildCheckpointContentHash({
        docId: input.docId,
        rootBlockId: input.rootBlockId,
        blocks: input.blocks,
      }),
      generatedAt: Date.now(),
      rootBlockId: input.rootBlockId,
      blocks: input.blocks,
    };
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(PREFIX);
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());

    await app.init();
    dataSource = app.get(DataSource);

    const registerRes = await request(app.getHttpServer())
      .post(`/${PREFIX}/auth/register`)
      .send(user)
      .expect(201);

    accessToken = registerRes.body.data.accessToken;

    const workspaceRes = await request(app.getHttpServer())
      .post(`/${PREFIX}/workspaces`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: `Sync WS ${rand()}` })
      .expect(201);

    workspaceId = workspaceRes.body.data.workspaceId;

    const docRes = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        workspaceId,
        title: "Sync Transport Doc",
        visibility: "workspace",
      })
      .expect(201);

    docId = docRes.body.data.docId;
    rootBlockId = docRes.body.data.rootBlockId;
    head = docRes.body.data.head;
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /api/v1/blocks/batch returns autosync ack metadata", async () => {
    const clientBatchId = `batch_${rand()}`;
    const clientId = `cid_${rand()}`;

    const res = await request(app.getHttpServer())
      .post(`/${PREFIX}/blocks/batch`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        docId,
        baseVersion: head,
        createVersion: false,
        source: "autosync",
        clientBatchId,
        operations: [
          {
            type: "create",
            clientId,
            data: {
              docId,
              type: "paragraph",
              payload: { text: "sync create block" },
              parentId: rootBlockId,
              sortKey: "1000",
            },
          },
        ],
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.acceptedBatchId).toBe(clientBatchId);
    expect(typeof res.body.data.serverHead).toBe("number");
    expect(Array.isArray(res.body.data.results)).toBe(true);
    expect(res.body.data.results[0].clientId).toBe(clientId);
    expect(typeof res.body.data.results[0].blockId).toBe("string");
  });

  it("GET /api/v1/documents/:docId/sync-state returns sync state", async () => {
    const res = await request(app.getHttpServer())
      .get(`/${PREFIX}/documents/${docId}/sync-state`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.docId).toBe(docId);
    expect(typeof res.body.data.head).toBe("number");
    expect(typeof res.body.data.publishedHead).toBe("number");
    expect(typeof res.body.data.pendingCount).toBe("number");
    expect(typeof res.body.data.hasPendingDraft).toBe("boolean");
    expect(typeof res.body.data.updatedAt).toBe("string");
    expect(Number.isNaN(Date.parse(res.body.data.updatedAt))).toBe(false);
  });

  it("suppresses a late create after a tombstoning delete and keeps reload content clean", async () => {
    const isolated = await createDocumentForTest("Late Create Tombstone Doc");
    const syncSession = await acquireSyncSession(isolated.docId);
    const editContent = await getEditContent(isolated.docId);

    const deleted = await request(app.getHttpServer())
      .post(`/${PREFIX}/blocks/batch`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        docId: isolated.docId,
        baseVersion: isolated.head,
        draftRevision: editContent.draft.draftRevision,
        createVersion: false,
        source: "autosync",
        clientBatchId: `batch_delete_${rand()}`,
        sessionId: syncSession.sessionId,
        sessionEpoch: syncSession.sessionEpoch,
        operations: [
          {
            type: "delete",
            clientId: "client_late_create_e2e",
            syncCreateId: "sync-create:client_late_create_e2e",
          },
        ],
      })
      .expect(200);

    expect(deleted.body.success).toBe(true);
    expect(deleted.body.data.results[0]).toMatchObject({
      operation: "delete",
      success: true,
      clientId: "client_late_create_e2e",
      tombstoned: true,
      diagnosticCode: "DELETE_TARGET_NOT_FOUND_BY_CLIENT_IDENTITY",
    });

    const lateCreate = await request(app.getHttpServer())
      .post(`/${PREFIX}/blocks/batch`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        docId: isolated.docId,
        baseVersion: isolated.head,
        draftRevision: deleted.body.data.draftRevision,
        createVersion: false,
        source: "autosync",
        clientBatchId: `batch_late_create_${rand()}`,
        sessionId: syncSession.sessionId,
        sessionEpoch: syncSession.sessionEpoch,
        operations: [
          {
            type: "create",
            clientId: "client_late_create_e2e",
            syncCreateId: "sync-create:client_late_create_e2e",
            data: {
              docId: isolated.docId,
              type: "paragraph",
              parentId: isolated.rootBlockId,
              sortKey: "001000",
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_late_create_e2e" },
                content: [{ type: "text", text: "should be suppressed" }],
              },
            },
          },
        ],
      })
      .expect(200);

    expect(lateCreate.body.success).toBe(true);
    expect(lateCreate.body.data.results[0]).toMatchObject({
      operation: "create",
      success: true,
      clientId: "client_late_create_e2e",
      tombstoned: true,
      diagnosticCode: "CREATE_SUPPRESSED_BY_TOMBSTONE",
    });
    expect(lateCreate.body.data.results[0].blockId).toBeUndefined();

    const reloaded = await getEditContent(isolated.docId);
    const rootChildren = Array.isArray((reloaded.tree as { children?: unknown[] } | null)?.children)
      ? ((reloaded.tree as { children?: unknown[] }).children ?? [])
      : [];
    expect(rootChildren).toHaveLength(0);
  });

  it("blocks commit when ackedThroughOpSeq is ahead of the server watermark and allows commit once aligned", async () => {
    const isolated = await createDocumentForTest("Commit Ack Barrier Doc");
    const syncSession = await acquireSyncSession(isolated.docId);
    const editContent = await getEditContent(isolated.docId);

    const batchRes = await request(app.getHttpServer())
      .post(`/${PREFIX}/blocks/batch`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        docId: isolated.docId,
        baseVersion: isolated.head,
        draftRevision: editContent.draft.draftRevision,
        createVersion: false,
        source: "autosync",
        clientBatchId: `batch_ack_${rand()}`,
        sessionId: syncSession.sessionId,
        sessionEpoch: syncSession.sessionEpoch,
        ackedThroughOpSeq: 7,
        operations: [
          {
            type: "create",
            clientId: "client_commit_barrier",
            data: {
              docId: isolated.docId,
              type: "paragraph",
              parentId: isolated.rootBlockId,
              sortKey: "001000",
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_commit_barrier" },
                content: [{ type: "text", text: "pending draft block" }],
              },
            },
          },
        ],
      })
      .expect(200);

    expect(batchRes.body.success).toBe(true);
    expect(batchRes.body.data.ackedThroughOpSeq).toBe(7);

    const blockedCommit = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents/${isolated.docId}/commit`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        message: "manual save during inflight",
        sessionId: syncSession.sessionId,
        sessionEpoch: syncSession.sessionEpoch,
        ackedThroughOpSeq: 8,
      })
      .expect(400);

    expect(blockedCommit.body.success).toBe(false);
    expect(blockedCommit.body.error).toMatchObject({
      message: "SYNC_SESSION_ACK_NOT_REACHED",
    });

    const committed = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents/${isolated.docId}/commit`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        message: "manual save after ack",
        sessionId: syncSession.sessionId,
        sessionEpoch: syncSession.sessionEpoch,
        ackedThroughOpSeq: 7,
      })
      .expect(200);

    expect(committed.body.success).toBe(true);
    expect(committed.body.data).toMatchObject({
      docId: isolated.docId,
      committed: true,
    });
    expect(committed.body.data.version).toBe(isolated.head + 1);
  });

  it("replays sync-reconcile receipts and rejects reused ids with different manifests", async () => {
    const isolated = await createDocumentForTest("Reconcile Replay Doc");
    const syncSession = await acquireSyncSession(isolated.docId);
    const editContent = await getEditContent(isolated.docId);

    const batchRes = await request(app.getHttpServer())
      .post(`/${PREFIX}/blocks/batch`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        docId: isolated.docId,
        baseVersion: isolated.head,
        draftRevision: editContent.draft.draftRevision,
        createVersion: false,
        source: "autosync",
        clientBatchId: `batch_reconcile_${rand()}`,
        sessionId: syncSession.sessionId,
        sessionEpoch: syncSession.sessionEpoch,
        operations: [
          {
            type: "create",
            clientId: "client_reconcile_live",
            data: {
              docId: isolated.docId,
              type: "paragraph",
              parentId: isolated.rootBlockId,
              sortKey: "001000",
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_reconcile_live" },
                content: [{ type: "text", text: "manifest live block" }],
              },
            },
          },
        ],
      })
      .expect(200);

    const createdBlockId = batchRes.body.data.results[0].blockId as string;
    const requestBody = {
      draftRevision: batchRes.body.data.draftRevision,
      sessionId: syncSession.sessionId,
      sessionEpoch: syncSession.sessionEpoch,
      clientBatchId: "reconcile_replay_e2e",
      manifest: [
        {
          blockId: createdBlockId,
          clientId: "client_reconcile_live",
        },
      ],
    };

    const first = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents/${isolated.docId}/sync-reconcile`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(requestBody)
      .expect(200);

    const second = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents/${isolated.docId}/sync-reconcile`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(requestBody)
      .expect(200);

    expect(first.body.success).toBe(true);
    expect(second.body.success).toBe(true);
    expect(second.body.data).toEqual(first.body.data);

    const fingerprintConflict = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents/${isolated.docId}/sync-reconcile`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        ...requestBody,
        manifest: [],
      })
      .expect(200);

    expect(fingerprintConflict.body.success).toBe(true);
    expect(fingerprintConflict.body.data.needsReload).toBe(true);
    expect(fingerprintConflict.body.data.conflicts[0].code).toBe(
      "RECONCILE_FINGERPRINT_CONFLICT",
    );
  });

  it("recovers from an expired sync session by re-acquiring and continuing batch writes", async () => {
    const isolated = await createDocumentForTest("Expired Session Recovery Doc");
    const syncSession = await acquireSyncSession(isolated.docId);

    await expireSyncSession(isolated.docId);

    const renew = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents/${isolated.docId}/sync-session/renew`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        sessionId: syncSession.sessionId,
        sessionEpoch: syncSession.sessionEpoch,
      })
      .expect(400);

    expect(renew.body.success).toBe(false);
    expect(renew.body.error).toMatchObject({
      message: "SYNC_SESSION_EXPIRED",
    });

    const recovered = await acquireSyncSession(isolated.docId);
    expect(recovered.sessionEpoch).toBeGreaterThan(syncSession.sessionEpoch);

    const editContent = await getEditContent(isolated.docId);
    expect(editContent.syncSession?.sessionId).toBe(recovered.sessionId);
    expect(editContent.syncSession?.sessionEpoch).toBe(recovered.sessionEpoch);

    const batchRes = await request(app.getHttpServer())
      .post(`/${PREFIX}/blocks/batch`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        docId: isolated.docId,
        baseVersion: isolated.head,
        draftRevision: editContent.draft.draftRevision,
        createVersion: false,
        source: "autosync",
        clientBatchId: `batch_recovered_${rand()}`,
        sessionId: recovered.sessionId,
        sessionEpoch: recovered.sessionEpoch,
        operations: [
          {
            type: "create",
            clientId: "client_recovered_session",
            data: {
              docId: isolated.docId,
              type: "paragraph",
              parentId: isolated.rootBlockId,
              sortKey: "001000",
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_recovered_session" },
                content: [{ type: "text", text: "recovered session write" }],
              },
            },
          },
        ],
      })
      .expect(200);

    expect(batchRes.body.success).toBe(true);
    expect(batchRes.body.data.results[0]).toMatchObject({
      operation: "create",
      success: true,
      clientId: "client_recovered_session",
    });
  });

  it("saves a drafted block through checkpoint and commit once the ack watermark is aligned", async () => {
    const isolated = await createDocumentForTest("Checkpoint Commit Flow Doc");
    const syncSession = await acquireSyncSession(isolated.docId);
    const editContent = await getEditContent(isolated.docId);

    const batchRes = await request(app.getHttpServer())
      .post(`/${PREFIX}/blocks/batch`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        docId: isolated.docId,
        baseVersion: isolated.head,
        draftRevision: editContent.draft.draftRevision,
        createVersion: false,
        source: "autosync",
        clientBatchId: `batch_checkpoint_${rand()}`,
        sessionId: syncSession.sessionId,
        sessionEpoch: syncSession.sessionEpoch,
        ackedThroughOpSeq: 5,
        operations: [
          {
            type: "create",
            clientId: "client_checkpoint_flow",
            data: {
              docId: isolated.docId,
              type: "paragraph",
              parentId: isolated.rootBlockId,
              sortKey: "001000",
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_checkpoint_flow" },
                content: [{ type: "text", text: "checkpointed block" }],
              },
            },
          },
        ],
      })
      .expect(200);

    const checkpointBlocks = [
      {
        clientId: "client_checkpoint_flow",
        blockId: batchRes.body.data.results[0].blockId,
        type: "paragraph",
        parentId: isolated.rootBlockId,
        orderKey: "001000",
        payload: {
          type: "paragraph",
          attrs: { clientId: "client_checkpoint_flow" },
          content: [{ type: "text", text: "checkpointed block" }],
        },
        plainText: "checkpointed block",
      },
    ];
    const checkpointRes = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents/${isolated.docId}/draft-checkpoint`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(
        buildCheckpointRequest({
          docId: isolated.docId,
          rootBlockId: isolated.rootBlockId,
          baseVersion: isolated.head,
          draftRevision: batchRes.body.data.draftRevision,
          sessionId: syncSession.sessionId,
          sessionEpoch: syncSession.sessionEpoch,
          clientCheckpointId: `checkpoint_${rand()}`,
          blocks: checkpointBlocks,
        }),
      )
      .expect(200);

    expect(checkpointRes.body.success).toBe(true);
    expect(checkpointRes.body.data).toMatchObject({
      acceptedCheckpointId: expect.any(String),
      needsReload: false,
    });

    const committed = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents/${isolated.docId}/commit`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        message: "checkpoint save commit",
        sessionId: syncSession.sessionId,
        sessionEpoch: syncSession.sessionEpoch,
        ackedThroughOpSeq: 5,
      })
      .expect(200);

    expect(committed.body.success).toBe(true);
    expect(committed.body.data).toMatchObject({
      docId: isolated.docId,
      committed: true,
      version: isolated.head + 1,
    });
  });

  it("rejects stale batch writes after a newer sync session takes over the document", async () => {
    const isolated = await createDocumentForTest("Session Takeover Doc");
    const firstSession = await acquireSyncSession(isolated.docId);
    await expireSyncSession(isolated.docId);
    const secondSession = await acquireSyncSession(isolated.docId);

    expect(secondSession.sessionEpoch).toBeGreaterThan(firstSession.sessionEpoch);

    const editContent = await getEditContent(isolated.docId);

    const staleWrite = await request(app.getHttpServer())
      .post(`/${PREFIX}/blocks/batch`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        docId: isolated.docId,
        baseVersion: isolated.head,
        draftRevision: editContent.draft.draftRevision,
        createVersion: false,
        source: "autosync",
        clientBatchId: `batch_stale_takeover_${rand()}`,
        sessionId: firstSession.sessionId,
        sessionEpoch: firstSession.sessionEpoch,
        operations: [
          {
            type: "create",
            clientId: "client_stale_takeover",
            data: {
              docId: isolated.docId,
              type: "paragraph",
              parentId: isolated.rootBlockId,
              sortKey: "001000",
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_stale_takeover" },
                content: [{ type: "text", text: "stale takeover write" }],
              },
            },
          },
        ],
      })
      .expect(200);

    expect(staleWrite.body.success).toBe(true);
    expect(staleWrite.body.data.needsReload).toBe(true);
    expect(staleWrite.body.data.conflicts[0]).toMatchObject({
      code: "SYNC_SESSION_MISMATCH",
    });

    const activeWrite = await request(app.getHttpServer())
      .post(`/${PREFIX}/blocks/batch`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        docId: isolated.docId,
        baseVersion: isolated.head,
        draftRevision: editContent.draft.draftRevision,
        createVersion: false,
        source: "autosync",
        clientBatchId: `batch_active_takeover_${rand()}`,
        sessionId: secondSession.sessionId,
        sessionEpoch: secondSession.sessionEpoch,
        operations: [
          {
            type: "create",
            clientId: "client_active_takeover",
            data: {
              docId: isolated.docId,
              type: "paragraph",
              parentId: isolated.rootBlockId,
              sortKey: "001000",
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_active_takeover" },
                content: [{ type: "text", text: "active takeover write" }],
              },
            },
          },
        ],
      })
      .expect(200);

    expect(activeWrite.body.success).toBe(true);
    expect(activeWrite.body.data.results[0]).toMatchObject({
      operation: "create",
      success: true,
      clientId: "client_active_takeover",
    });
  });

  it("replays checkpoint responses and rejects reused checkpoint ids with different content", async () => {
    const isolated = await createDocumentForTest("Checkpoint Replay Doc");
    const syncSession = await acquireSyncSession(isolated.docId);
    const editContent = await getEditContent(isolated.docId);
    const batchRes = await request(app.getHttpServer())
      .post(`/${PREFIX}/blocks/batch`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        docId: isolated.docId,
        baseVersion: isolated.head,
        draftRevision: editContent.draft.draftRevision,
        createVersion: false,
        source: "autosync",
        clientBatchId: `batch_checkpoint_replay_${rand()}`,
        sessionId: syncSession.sessionId,
        sessionEpoch: syncSession.sessionEpoch,
        operations: [
          {
            type: "create",
            clientId: "client_checkpoint_replay",
            data: {
              docId: isolated.docId,
              type: "paragraph",
              parentId: isolated.rootBlockId,
              sortKey: "001000",
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_checkpoint_replay" },
                content: [{ type: "text", text: "checkpoint replay" }],
              },
            },
          },
        ],
      })
      .expect(200);
    const blocks = [
      {
        clientId: "client_checkpoint_replay",
        blockId: batchRes.body.data.results[0].blockId,
        type: "paragraph",
        parentId: isolated.rootBlockId,
        orderKey: "001000",
        payload: {
          type: "paragraph",
          attrs: { clientId: "client_checkpoint_replay" },
          content: [{ type: "text", text: "checkpoint replay" }],
        },
        plainText: "checkpoint replay",
      },
    ];
    const requestBody = buildCheckpointRequest({
      docId: isolated.docId,
      rootBlockId: isolated.rootBlockId,
      baseVersion: isolated.head,
      draftRevision: batchRes.body.data.draftRevision,
      sessionId: syncSession.sessionId,
      sessionEpoch: syncSession.sessionEpoch,
      clientCheckpointId: "checkpoint_replay_e2e",
      blocks,
    });

    const first = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents/${isolated.docId}/draft-checkpoint`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(requestBody)
      .expect(200);

    const second = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents/${isolated.docId}/draft-checkpoint`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(requestBody)
      .expect(200);

    expect(first.body.success).toBe(true);
    expect(second.body.success).toBe(true);
    expect(second.body.data).toEqual(first.body.data);

    const conflicting = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents/${isolated.docId}/draft-checkpoint`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send(
        buildCheckpointRequest({
          docId: isolated.docId,
          rootBlockId: isolated.rootBlockId,
          baseVersion: isolated.head,
          draftRevision: batchRes.body.data.draftRevision,
          sessionId: syncSession.sessionId,
          sessionEpoch: syncSession.sessionEpoch,
          clientCheckpointId: "checkpoint_replay_e2e",
          blocks: [
            {
              ...blocks[0],
              payload: {
                type: "paragraph",
                attrs: { clientId: "client_checkpoint_replay" },
                content: [{ type: "text", text: "checkpoint changed" }],
              },
              plainText: "checkpoint changed",
            },
          ],
        }),
      )
      .expect(200);

    expect(conflicting.body.success).toBe(true);
    expect(conflicting.body.data.needsReload).toBe(true);
    expect(conflicting.body.data.conflicts[0].code).toBe(
      "CHECKPOINT_FINGERPRINT_CONFLICT",
    );
  });
});
