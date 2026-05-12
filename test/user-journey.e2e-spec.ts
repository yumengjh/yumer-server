/**
 * 用户完整行为 e2e 测试：从注册到各类文档相关操作
 *
 * 模拟流程：注册 → 登录 → 工作空间 → 文档 → 块(创建/更新/移动/批量) →
 * 标签 → 收藏 → 评论 → 发布 → 搜索 → 活动日志 → 登出
 *
 * 运行前：需启动数据库，可使用 pnpm run test:e2e
 * 说明：使用随机用户名/邮箱避免重复；会写入真实数据，可在测试后自行清理。
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';

const PREFIX = 'api/v1';

function rand(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

describe('用户完整行为 (e2e)', () => {
  let app: INestApplication;
  let accessToken: string;
  let workspaceId: string;
  let docId: string;
  let rootBlockId: string;
  let blockId: string;
  let tagId: string;
  let commentId: string;

  const user = {
    username: `u_${rand()}`,
    email: `e_${rand()}@test.local`,
    password: 'TestPass123!',
    displayName: 'E2E User',
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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. 认证', () => {
    it('POST /auth/register 注册', async () => {
      const res = await request(app.getHttpServer())
        .post(`/${PREFIX}/auth/register`)
        .send({
          username: user.username,
          email: user.email,
          password: user.password,
          displayName: user.displayName,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.user?.username).toBe(user.username);
      accessToken = res.body.data.accessToken;
    });

    it('POST /auth/login 登录', async () => {
      const res = await request(app.getHttpServer())
        .post(`/${PREFIX}/auth/login`)
        .send({ emailOrUsername: user.email, password: user.password })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      accessToken = res.body.data.accessToken;
    });

    it('GET /auth/me 当前用户', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${PREFIX}/auth/me`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.username).toBe(user.username);
    });
  });

  describe('2. 工作空间', () => {
    it('POST /workspaces 创建工作空间', async () => {
      const res = await request(app.getHttpServer())
        .post(`/${PREFIX}/workspaces`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name: 'E2E 工作空间', description: 'e2e', icon: '📁' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.workspaceId).toBeDefined();
      workspaceId = res.body.data.workspaceId;
    });

    it('GET /workspaces 工作空间列表', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${PREFIX}/workspaces`)
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ page: 1, pageSize: 10 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data?.items)).toBe(true);
      expect(res.body.data.items.some((w: any) => w.workspaceId === workspaceId)).toBe(true);
    });

    it('GET /workspaces/:id 工作空间详情', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${PREFIX}/workspaces/${workspaceId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.workspaceId).toBe(workspaceId);
    });
  });

  describe('3. 文档', () => {
    it('POST /documents 创建文档', async () => {
      const res = await request(app.getHttpServer())
        .post(`/${PREFIX}/documents`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          workspaceId,
          title: 'E2E 测试文档',
          visibility: 'workspace',
          tags: ['e2e', 'test'],
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.docId).toBeDefined();
      expect(res.body.data.rootBlockId).toBeDefined();
      docId = res.body.data.docId;
      rootBlockId = res.body.data.rootBlockId;
    });

    it('GET /documents 文档列表', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${PREFIX}/documents`)
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ workspaceId, page: 1, pageSize: 10 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data?.items)).toBe(true);
      expect(res.body.data.items.some((d: any) => d.docId === docId)).toBe(true);
    });

    it('GET /documents/:id 文档详情', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${PREFIX}/documents/${docId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.docId).toBe(docId);
      expect(res.body.data.rootBlockId).toBe(rootBlockId);
    });

    it('GET /documents/:id/content 文档内容', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${PREFIX}/documents/${docId}/content`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.tree).toBeDefined();
    });

    it('PATCH /documents/:id 更新文档', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/${PREFIX}/documents/${docId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'E2E 测试文档（已更新）', tags: ['e2e', 'test', 'updated'] })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toContain('已更新');
    });
  });

  describe('4. 块', () => {
    it('POST /blocks 创建块', async () => {
      const res = await request(app.getHttpServer())
        .post(`/${PREFIX}/blocks`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          docId,
          type: 'paragraph',
          payload: { text: '第一段内容' },
          parentId: rootBlockId,
          sortKey: '1',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.blockId).toBeDefined();
      blockId = res.body.data.blockId;
    });

    it('PATCH /blocks/:id/content 更新块内容', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/${PREFIX}/blocks/${blockId}/content`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ payload: { text: '第一段内容（已编辑）' } })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.payload).toBeDefined();
    });

    it('POST /blocks/:id/move 移动块', async () => {
      const res = await request(app.getHttpServer())
        .post(`/${PREFIX}/blocks/${blockId}/move`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ parentId: rootBlockId, sortKey: '0.5' })
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it('POST /blocks/batch 批量操作块', async () => {
      const res = await request(app.getHttpServer())
        .post(`/${PREFIX}/blocks/batch`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          docId,
          operations: [
            {
              type: 'create',
              data: {
                docId,
                type: 'paragraph',
                payload: { text: '批量创建的块' },
                parentId: rootBlockId,
                sortKey: '2',
              },
            },
          ],
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.results).toBeDefined();
      expect(Array.isArray(res.body.data.results)).toBe(true);
    });
  });

  describe('5. 标签', () => {
    it('POST /tags 创建标签', async () => {
      const res = await request(app.getHttpServer())
        .post(`/${PREFIX}/tags`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ workspaceId, name: 'e2e-tag', color: '#1890ff' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.tagId).toBeDefined();
      tagId = res.body.data.tagId;
    });

    it('GET /tags 标签列表', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${PREFIX}/tags`)
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ workspaceId, page: 1, pageSize: 10 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data?.items)).toBe(true);
    });

    it('PATCH /tags/:id 更新标签', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/${PREFIX}/tags/${tagId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ color: '#ff4d4f' })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe('6. 收藏', () => {
    it('POST /favorites 添加收藏', async () => {
      const res = await request(app.getHttpServer())
        .post(`/${PREFIX}/favorites`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ docId })
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it('GET /favorites 收藏列表', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${PREFIX}/favorites`)
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ page: 1, pageSize: 10 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data?.items)).toBe(true);
    });
  });

  describe('7. 评论', () => {
    it('POST /comments 创建评论', async () => {
      const res = await request(app.getHttpServer())
        .post(`/${PREFIX}/comments`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ docId, content: 'E2E 测试评论' })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.commentId).toBeDefined();
      commentId = res.body.data.commentId;
    });

    it('GET /comments 评论列表', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${PREFIX}/comments`)
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ docId, page: 1, pageSize: 10 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data?.items)).toBe(true);
    });
  });

  describe('8. 发布与搜索', () => {
    it('POST /documents/:id/publish 发布文档', async () => {
      const res = await request(app.getHttpServer())
        .post(`/${PREFIX}/documents/${docId}/publish`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);

      expect(res.body.success).toBe(true);
    });

    it('GET /search 全局搜索', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${PREFIX}/search`)
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ query: 'E2E', workspaceId, type: 'all', page: 1, pageSize: 10 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('POST /search/advanced 高级搜索', async () => {
      const res = await request(app.getHttpServer())
        .post(`/${PREFIX}/search/advanced`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ query: 'E2E', workspaceId, page: 1, pageSize: 10 })
        .expect(200);

      expect(res.body.success).toBe(true);
    });
  });

  describe('9. 活动日志', () => {
    it('GET /activities 活动列表', async () => {
      const res = await request(app.getHttpServer())
        .get(`/${PREFIX}/activities`)
        .set('Authorization', `Bearer ${accessToken}`)
        .query({ workspaceId, page: 1, pageSize: 20 })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toBeDefined();
      expect(Array.isArray(res.body.data.items)).toBe(true);
    });
  });

  describe('10. 收尾与登出', () => {
    it('DELETE /favorites/:docId 取消收藏', async () => {
      await request(app.getHttpServer())
        .delete(`/${PREFIX}/favorites/${docId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('DELETE /comments/:id 删除评论', async () => {
      await request(app.getHttpServer())
        .delete(`/${PREFIX}/comments/${commentId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });

    it('POST /auth/logout 登出', async () => {
      await request(app.getHttpServer())
        .post(`/${PREFIX}/auth/logout`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ token: accessToken })
        .expect(204);
    });
  });
});
