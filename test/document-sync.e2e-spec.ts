import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter";
import { TransformInterceptor } from "../src/common/interceptors/transform.interceptor";

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

  const user = {
    username: `sync_u_${rand()}`,
    email: `sync_e_${rand()}@test.local`,
    password: "TestPass123!",
    displayName: "Sync E2E User",
  };

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
});
