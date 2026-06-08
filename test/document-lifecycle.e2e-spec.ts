import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import fs from "fs/promises";
import path from "path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter";
import { TransformInterceptor } from "../src/common/interceptors/transform.interceptor";

const PREFIX = "api/v1";
const DB_PATH = path.join(process.cwd(), "data", "document-lifecycle.e2e.sqlite");

function rand(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

describe("document lifecycle (e2e)", () => {
  let app: INestApplication;
  let accessToken: string;
  let workspaceId: string;

  async function createDocument(title: string, parentId?: string) {
    const res = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        workspaceId,
        title,
        visibility: "workspace",
        parentId,
      })
      .expect(201);

    return res.body.data as {
      docId: string;
      rootBlockId: string;
      head: number;
      status: string;
    };
  }

  beforeAll(async () => {
    process.env.DB_TYPE = "sqlite";
    process.env.DB_SQLITE_PATH = DB_PATH;
    process.env.NODE_ENV = "development";
    await fs.rm(DB_PATH, { force: true });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(PREFIX);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    const registerRes = await request(app.getHttpServer())
      .post(`/${PREFIX}/auth/register`)
      .send({
        username: `life_u_${rand()}`,
        email: `life_e_${rand()}@test.local`,
        password: "TestPass123!",
        displayName: "Lifecycle E2E User",
      })
      .expect(201);

    accessToken = registerRes.body.data.accessToken;

    const workspaceRes = await request(app.getHttpServer())
      .post(`/${PREFIX}/workspaces`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ name: `Lifecycle WS ${rand()}` })
      .expect(201);

    workspaceId = workspaceRes.body.data.workspaceId;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await fs.rm(DB_PATH, { force: true });
  });

  it("moves a document subtree to trash and restores it back", async () => {
    const parent = await createDocument("Lifecycle Parent");
    const child = await createDocument("Lifecycle Child", parent.docId);

    const deleted = await request(app.getHttpServer())
      .delete(`/${PREFIX}/documents/${parent.docId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(deleted.body.success).toBe(true);
    expect(deleted.body.data.status).toBe("deleted");
    expect(deleted.body.data.affectedCount).toBe(2);
    expect(typeof deleted.body.data.deletedAt).toBe("string");
    expect(deleted.body.data.trashRetentionDays).toBe(30);
    expect(typeof deleted.body.data.trashExpiresAt).toBe("string");
    expect(typeof deleted.body.data.trashDaysRemaining).toBe("number");

    await request(app.getHttpServer())
      .get(`/${PREFIX}/documents/${parent.docId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/${PREFIX}/documents/${child.docId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(404);

    const trashRes = await request(app.getHttpServer())
      .get(`/${PREFIX}/documents`)
      .query({ workspaceId, status: "deleted" })
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(trashRes.body.data.total).toBe(2);
    expect(
      trashRes.body.data.items.map((item: { docId: string }) => item.docId),
    ).toEqual(expect.arrayContaining([parent.docId, child.docId]));
    expect(
      trashRes.body.data.items.find(
        (item: { docId: string }) => item.docId === parent.docId,
      ),
    ).toMatchObject({
      trashRetentionDays: 30,
      trashExpiresAt: expect.any(String),
      trashDaysRemaining: expect.any(Number),
    });

    const restored = await request(app.getHttpServer())
      .post(`/${PREFIX}/documents/${parent.docId}/restore`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(restored.body.success).toBe(true);
    expect(restored.body.data.docId).toBe(parent.docId);
    expect(restored.body.data.status).toBe("draft");

    const restoredParent = await request(app.getHttpServer())
      .get(`/${PREFIX}/documents/${parent.docId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    const restoredChild = await request(app.getHttpServer())
      .get(`/${PREFIX}/documents/${child.docId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(restoredParent.body.data.status).toBe("draft");
    expect(restoredChild.body.data.parentId).toBe(parent.docId);
  });

  it("permanently deletes a trashed document subtree", async () => {
    const parent = await createDocument("Lifecycle Purge Parent");
    const child = await createDocument("Lifecycle Purge Child", parent.docId);

    await request(app.getHttpServer())
      .delete(`/${PREFIX}/documents/${parent.docId}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    const purged = await request(app.getHttpServer())
      .delete(`/${PREFIX}/documents/${parent.docId}/permanent`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(purged.body.success).toBe(true);
    expect(purged.body.data).toMatchObject({
      docId: parent.docId,
      status: "purged",
      affectedCount: 2,
      deletedDocIds: expect.arrayContaining([parent.docId, child.docId]),
      deletedCounts: expect.objectContaining({
        documents: 2,
      }),
    });

    await request(app.getHttpServer())
      .post(`/${PREFIX}/documents/${parent.docId}/restore`)
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(404);

    const trashRes = await request(app.getHttpServer())
      .get(`/${PREFIX}/documents`)
      .query({ workspaceId, status: "deleted" })
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);

    expect(
      trashRes.body.data.items.map((item: { docId: string }) => item.docId),
    ).not.toEqual(expect.arrayContaining([parent.docId, child.docId]));
  });
});
