# 用户完整行为 E2E 测试说明

## 1. 概述

`test/user-journey.e2e-spec.ts` 是一条**端到端（e2e）**测试，模拟真实用户从注册到登出的完整操作链，用于验证主要 API 在串联调用下的正确性。

**目标：**

- 在**不启动 HTTP 服务**的前提下，对 `api/v1` 下认证、工作空间、文档、块、标签、收藏、评论、搜索、活动日志等接口做集成验证
- 及早发现接口语义错误、鉴权缺失、DTO 与全局管道/拦截器不兼容等问题

**流程概要：**

```
注册 → 登录 → 工作空间(创建/列表/详情) → 文档(创建/列表/详情/内容/更新)
  → 块(创建/更新内容/移动/批量) → 标签(创建/列表/更新) → 收藏(添加/列表)
  → 评论(创建/列表) → 发布 → 搜索(全局/高级) → 活动日志
  → 取消收藏、删除评论 → 登出
```

共 **29 个用例**，顺序执行，后置步骤依赖前置步骤产生的 `accessToken`、`workspaceId`、`docId`、`rootBlockId`、`blockId`、`tagId`、`commentId`。

---

## 2. 运行方式

### 2.1 命令

```bash
pnpm run test:e2e -- test/user-journey.e2e-spec.ts --runInBand --testTimeout=60000
```

- `test/user-journey.e2e-spec.ts`：只跑该文件
- `--runInBand`：串行执行，避免并发写库冲突
- `--testTimeout=60000`：单用例超时 60 秒（连库、多次请求时够用）

### 2.2 环境要求

| 条件             | 说明                                                                                |
| ---------------- | ----------------------------------------------------------------------------------- |
| **数据库**       | PostgreSQL 需已启动，且 `src/config` 中配置的库可连（一般与 `pnpm run start` 相同） |
| **无需先启服务** | 测试通过 Supertest 直连 Nest 内存 HTTP 适配器，不绑定端口，见下文 3.1               |

---

## 3. 技术架构

### 3.1 为何不启动服务也能测？

测试使用 **Supertest** 对 **Nest 应用内部的 HTTP 适配器**发请求，而不是对 `http://localhost:5200` 发请求：

```
┌─────────────────────────────────────────────────────────────────┐
│  Test.createTestingModule({ imports: [AppModule] })              │
│       ↓                                                          │
│  createNestApplication() → app.init()   （不调用 app.listen）    │
│       ↓                                                          │
│  得到：完整路由、中间件、管道、拦截器、守卫、TypeORM 连接 等      │
│       ↓                                                          │
│  app.getHttpServer()  →  Supertest 对该 Server 发 HTTP 请求     │
│       ↓                                                          │
│  请求在 同一 Node 进程内 完成，不经过端口、不经过网络             │
└─────────────────────────────────────────────────────────────────┘
```

因此：

- **不需要** 先执行 `pnpm run start`
- **需要** 数据库可用，因为 Service 会真实访问 TypeORM / PostgreSQL

### 3.2 与主应用的一致性

在 `beforeAll` 中显式对齐 `main.ts` 的配置，保证 e2e 与生产/开发行为一致：

- **全局前缀：** `api/v1`
- **ValidationPipe：** `whitelist: true`, `transform: true`, `forbidNonWhitelisted: true`
- **HttpExceptionFilter**
- **TransformInterceptor**

```ts
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
```

### 3.3 依赖与配置

- **Jest 配置：** `test/jest-e2e.json`（`testRegex: ".e2e-spec.ts$"`）
- **Supertest：** 对 `app.getHttpServer()` 发 `get/post/patch/delete`，带 `Authorization: Bearer <accessToken>`
- **响应格式：** 统一为 `{ success: true, data }`（由 `TransformInterceptor` 包装），断言 `res.body.success`、`res.body.data.*`

---

## 4. 测试阶段与接口清单

| 阶段               | 用例     | 方法   | 路径                     | 说明                                               |
| ------------------ | -------- | ------ | ------------------------ | -------------------------------------------------- |
| **1. 认证**        | 注册     | POST   | `/auth/register`         | 取 `accessToken`、`user`                           |
|                    | 登录     | POST   | `/auth/login`            | 覆盖 `accessToken`                                 |
|                    | 当前用户 | GET    | `/auth/me`               | Bearer                                             |
| **2. 工作空间**    | 创建     | POST   | `/workspaces`            | 取 `workspaceId`                                   |
|                    | 列表     | GET    | `/workspaces`            | `page`, `pageSize`                                 |
|                    | 详情     | GET    | `/workspaces/:id`        |                                                    |
| **3. 文档**        | 创建     | POST   | `/documents`             | 取 `docId`, `rootBlockId`                          |
|                    | 列表     | GET    | `/documents`             | `workspaceId`, `page`, `pageSize`                  |
|                    | 详情     | GET    | `/documents/:id`         |                                                    |
|                    | 内容     | GET    | `/documents/:id/content` | `tree`                                             |
|                    | 更新     | PATCH  | `/documents/:id`         | `title`, `tags`                                    |
| **4. 块**          | 创建     | POST   | `/blocks`                | 取 `blockId`，`parentId=rootBlockId`               |
|                    | 更新内容 | PATCH  | `/blocks/:id/content`    | `payload`                                          |
|                    | 移动     | POST   | `/blocks/:id/move`       | `parentId`, `sortKey`                              |
|                    | 批量     | POST   | `/blocks/batch`          | `operations: [{ type: 'create', data }]`           |
| **5. 标签**        | 创建     | POST   | `/tags`                  | 取 `tagId`                                         |
|                    | 列表     | GET    | `/tags`                  | `workspaceId`, `page`, `pageSize`                  |
|                    | 更新     | PATCH  | `/tags/:id`              | `color`                                            |
| **6. 收藏**        | 添加     | POST   | `/favorites`             | `docId`                                            |
|                    | 列表     | GET    | `/favorites`             | `page`, `pageSize`                                 |
| **7. 评论**        | 创建     | POST   | `/comments`              | 取 `commentId`，`docId`, `content`                 |
|                    | 列表     | GET    | `/comments`              | `docId`, `page`, `pageSize`                        |
| **8. 发布与搜索**  | 发布     | POST   | `/documents/:id/publish` |                                                    |
|                    | 全局搜索 | GET    | `/search`                | `query`, `workspaceId`, `type`, `page`, `pageSize` |
|                    | 高级搜索 | POST   | `/search/advanced`       | `query`, `workspaceId`, `page`, `pageSize`         |
| **9. 活动日志**    | 列表     | GET    | `/activities`            | `workspaceId`, `page`, `pageSize`                  |
| **10. 收尾与登出** | 取消收藏 | DELETE | `/favorites/:docId`      |                                                    |
|                    | 删除评论 | DELETE | `/comments/:id`          |                                                    |
|                    | 登出     | POST   | `/auth/logout`           | Body: `{ token: accessToken }`，204                |

---

## 5. 数据与副作用

- **用户：** 每轮用 `rand()` 生成 `username`、`email`，避免「用户已存在」类冲突
- **库表：** 会写入真实数据（users、workspaces、documents、blocks、tags、favorites、comments、activities 等）
- **清理：** 测试**不**做自动回滚或 truncate；若需干净环境，可在测试库做定期清理或使用独立 schema/database

---

## 6. 响应断言约定

- **状态码：** 按接口语义 `expect(200|201|204)`
- **结构：** `res.body.success === true`，业务数据在 `res.body.data`
- **列表：** `res.body.data.items` 为数组，且包含刚创建的资源（如 `workspaceId`、`docId`）
- **登出：** `expect(204)`，不解析 body

---

## 7. 扩展与维护

- **新增接口：** 在对应 `describe` 中追加 `it`，按阶段顺序插入；若依赖新资源 ID，在 `let` 中声明并在前置用例中赋值
- **只跑本文件：** `pnpm run test:e2e -- test/user-journey.e2e-spec.ts`
- **跑全部 e2e：** `pnpm run test:e2e`（会包含 `test/app.e2e-spec.ts` 等）
- **调试：** 可加 `--testNamePattern="POST /blocks/batch"` 只跑单个用例；或使用 `pnpm run test:debug`（见 `package.json`）

---

## 8. 相关文件

| 文件                                               | 说明                                              |
| -------------------------------------------------- | ------------------------------------------------- |
| `test/user-journey.e2e-spec.ts`                    | 本测试实现                                        |
| `test/jest-e2e.json`                               | e2e 的 Jest 配置                                  |
| `src/main.ts`                                      | 生产/开发启动；e2e 中管道、过滤器、拦截器与其对齐 |
| `src/common/interceptors/transform.interceptor.ts` | 统一 `{ success, data }` 格式                     |
| `src/common/filters/http-exception.filter.ts`      | 4xx/5xx 时日志与返回结构                          |
