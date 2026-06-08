# 2026-06-08 API 响应体收缩与契约保护设计

> 状态：草案，可直接作为后续接口优化约束
> 适用仓库：`E:\workspace\yumer-server`
> 关联前端：`E:\workspace\editor-demo\app`

## 1. 背景

当前后端已经进入“可以开始优化载荷与响应体”的阶段，但这类优化不能再按“看起来像内部字段就删”的方式推进。

这次实际回归已经证明：

1. `Document` 实体里确实混有不该直接暴露给前端的数据库内部字段和服务端管理字段。
2. 但同一份响应里也包含前端编辑/同步链路仍然依赖的协议字段。
3. 如果不先区分“数据库内部标识”和“跨端业务标识”，响应体收缩很容易把同步链路一起打断。

本次事故的直接表现是：

- 后端把文档详情响应里的 `rootBlockId` 收掉后；
- 前端编辑页仍然在保存路径里使用 `currentDoc.rootBlockId`；
- 结果内容保存/同步直接失效。

前端当前真实依赖点已经确认至少包括：

- `src/contexts/DocumentContext.tsx`
- `src/components/EditorPage.tsx`
- `src/services/document.ts`

其中 `EditorPage.tsx` 仍然调用：

```ts
saveDocumentContentV2(currentDoc.docId, nextContent, currentDoc.rootBlockId)
```

这说明 `rootBlockId` 当前不是“可随意隐藏的内部实现”，而是内容树协议的一部分。

## 2. 目标

后续响应体优化需要同时满足四个目标：

1. 不暴露数据库内部主键、内部管理字段、无意义冗余字段。
2. 不破坏前后端已经建立的编辑、同步、发布、回收站等链路。
3. 让“列表响应”“详情响应”“编辑/同步响应”各自有稳定边界。
4. 让后续优化有可执行的检查清单，而不是靠记忆。

## 3. 先分清三类字段

### 3.1 A 类：绝不直接暴露的数据库内部字段

这类字段是数据库存储细节，不应该作为公开 API 契约：

- 自增主键：`id`
- 仅供库内关联或后台维护的内部快照/回执键
- 不面向客户端的存储实现字段

以当前文档模型为例，默认不应从通用业务响应直接暴露：

- `Document.id`
- `DocRevision.id`
- `DocRevision.revisionId`
- `Document.publishedSnapshotId`
- `BlockVersion.id`

注意：这不等于“凡是像 id 的都不能暴露”。

### 3.2 B 类：协议层业务标识，可暴露但要明确边界

这类字段虽然也是“标识”，但它们不是数据库内部主键，而是跨端协议的一部分：

- `docId`
- `blockId`
- `rootBlockId`
- `workspaceId`

其中：

- `docId` 是文档业务 ID，不是数据库自增主键。
- `blockId` / `rootBlockId` 是内容树和同步协议里的业务标识。
- `workspaceId` 是前端上下文切换、权限域、标签查询等流程依赖的业务标识。

这类字段能不能暴露，取决于接口用途，而不是取决于字段名里有没有 `id`。

### 3.3 C 类：服务端内部管理字段，是否暴露取决于具体场景

例如：

- `head`
- `draftRevision`
- `publishedHead`
- `deletedFromStatus`
- `deletedBy`
- `restoredBy`
- `createdBy`
- `updatedBy`

这类字段不能一刀切：

- `head` / `draftRevision` 在编辑和同步链路里是必要协议字段。
- `createdBy` / `updatedBy` 对外通常应该被 `creator` / `updater` 摘要替代。
- `deletedFromStatus` 这类回收站恢复内部状态，通常不应暴露给通用前端页面。

## 4. 当前文档接口的响应分层

后续文档接口至少拆成三层，不再复用“一个 Document 响应形状走天下”。

### 4.1 列表响应

用于文档列表、搜索结果、侧边栏、回收站卡片。

建议只保留：

- `docId`
- `workspaceId`
- `title`
- `icon`
- `cover`
- `status`
- `visibility`
- `parentId`
- `sortOrder`
- `tags`
- `category`
- `publishedHead`
- `viewCount`
- `favoriteCount`
- `createdAt`
- `updatedAt`
- 仅在回收站场景需要的生命周期补充字段

默认不应包含：

- `id`
- `rootBlockId`
- `createdBy`
- `updatedBy`
- `publishedSnapshotId`
- `draftRevision`

### 4.2 详情响应

用于当前文档上下文初始化、页面切换、文档元信息编辑。

当前阶段应保留：

- 列表层字段
- `rootBlockId`
- `head`
- `draftRevision`
- `creator`
- `updater`

当前阶段不应返回：

- `id`
- `createdBy`
- `updatedBy`
- `publishedSnapshotId`

原因很简单：前端当前详情流仍依赖 `rootBlockId`、`head`、`draftRevision`。

### 4.3 编辑/同步专用响应

例如：

- `GET /documents/:docId/edit-content`
- `GET /documents/:docId/sync-state`
- `POST /blocks/batch`
- `POST /documents/:docId/sync-reconcile`
- `POST /documents/:docId/draft-checkpoint`

这一层必须优先保证协议稳定，禁止从“简化响应体”的角度随意改字段。

这类接口里的关键字段包括：

- `head`
- `draftRevision`
- `publishedHead`
- `source`
- `syncSession`
- `pagination`
- `tree`
- `conflicts`
- `results`
- `acceptedBatchId`
- `serverHead`

它们不是展示层字段，而是同步协议的一部分。

## 5. 这次事故给出的硬规则

### 5.1 不要把“内部主键”和“业务标识”混成一类

错误做法：

- “`rootBlockId` 看起来也是 id，所以跟 `Document.id` 一样都不返回。”

正确做法：

- `Document.id` 是数据库内部主键。
- `rootBlockId` 是前后端共享的内容树根标识。
- 两者语义完全不同，不能因为名字都像标识就一起删。

### 5.2 任何响应体收缩，都必须先查前端真实消费点

至少检查：

- `src/services/document.ts`
- `src/services/sync/*`
- `src/contexts/DocumentContext.tsx`
- `src/components/EditorPage.tsx`
- `src/components/DocumentHeader.tsx`

如果字段出现在这些位置，就不能只从后端视角判断“是不是冗余”。

### 5.3 同步相关字段优先看协议，不优先看安全美观

对同步主链路来说：

- `draftRevision`
- `head`
- `rootBlockId`
- `blockId`
- `clientId`

都应该先问“是不是协议字段”，再问“能不能隐藏”。

### 5.4 `createdBy` / `updatedBy` 优先替换成摘要对象

对面向页面的数据，优先提供：

- `creator: { displayName, avatar }`
- `updater: { displayName, avatar }`

而不是继续泄露：

- `createdBy`
- `updatedBy`

但如果前端当前仍有真实依赖，需要先迁移前端消费点，再删旧字段。

## 6. 后续优化的标准流程

### Step 1：先分类字段

对目标接口里的每个字段标记为：

- `DB_INTERNAL`
- `PROTOCOL_REQUIRED`
- `VIEW_REQUIRED`
- `OPTIONAL_COMPAT`
- `REMOVE_CANDIDATE`

没有分类就不要改响应。

### Step 2：先搜前端消费点

对每个候选删除字段执行：

```powershell
rg -n "<fieldName>" E:\workspace\editor-demo\app\src
```

至少确认：

1. 是否只在展示层使用；
2. 是否进入了保存/同步/恢复/发布链路；
3. 是否只是类型声明还是真实运行时依赖。

### Step 3：先做 presenter，不直接改 service 内部实体语义

正确方向是：

- service 内部继续处理 entity / domain object；
- controller 出口统一走 presenter / response mapper；
- 在 presenter 层决定这个接口该暴露哪些字段。

不要把“为了裁剪响应体”变成“把 service 内部对象本身改残”。

### Step 4：先补契约测试，再删字段

后端至少补两类测试：

1. response projection 测试
   断言不该暴露的字段确实不在响应里。

2. contract safety 测试
   断言保留字段里，前端依赖的关键协议字段仍存在。

对文档详情，当前至少应断言：

- 有 `docId`
- 有 `workspaceId`
- 有 `rootBlockId`
- 有 `head`
- 有 `draftRevision`
- 没有 `id`
- 没有 `publishedSnapshotId`
- 没有原始 `createdBy/updatedBy`

### Step 5：做前后端联动验证

单后端单测通过不够。

每次响应收缩后，至少做一轮真实链路验证：

1. 打开文档
2. 编辑内容
3. 触发自动保存或手动保存
4. 刷新页面确认内容仍在
5. 如涉及发布/回收站，再补对应链路

## 7. 当前不建议现在就做的事

### 7.1 现在不要急着给 `docId` 再套一层可逆加密

原因：

1. `docId` 目前本身就是业务 ID，不是数据库自增主键。
2. 前后端路由、公开页 slug、同步链路已经围绕它建立了协议。
3. 如果现在再做一层可逆转码，影响面不只是响应体，还包括：
   - 路由参数
   - 搜索结果跳转
   - 公开文档 slug
   - 调试日志
   - 跨服务引用

这不是“响应收缩的小改动”，而是“全链路标识策略升级”。

可以做，但要单独立项。

### 7.2 不要把 DTO 白名单通过，误当成响应契约安全

DTO 白名单只能保证“输入面声明了哪些字段”。

它不能保证：

- 输出字段合理；
- 同步协议没被破坏；
- 前端关键字段还在。

输入安全和输出契约是两件事。

## 8. 建议的文档与实现边界

后续建议把文档接口响应分成明确的几组类型：

- `DocumentListItemResponse`
- `DocumentDetailResponse`
- `PublicDocumentDetailResponse`
- `DocumentRevisionListItemResponse`
- `EditContentResponse`
- `SyncStateResponse`

并且明确规定：

1. 列表响应不能偷偷长成详情响应。
2. 编辑/同步响应不能为了“简洁”丢掉协议字段。
3. 公开响应不能暴露管理态字段。

## 9. 最小检查清单

以后任何“精简响应体”提交，合并前至少回答完下面 8 个问题：

1. 我删的是数据库内部字段，还是协议业务标识？
2. 这个字段有没有被 `editor-demo` 真实消费？
3. 它是不是进入了保存、同步、发布、恢复链路？
4. 我是不是只改了 presenter，而没污染 service 内部逻辑？
5. 后端测试有没有断言“删掉了什么”和“保留了什么”？
6. 前端真实联调有没有覆盖打开、编辑、保存、刷新？
7. 如果是公开接口，是否额外检查了公开页依赖？
8. 如果字段看起来像 `id`，我有没有先区分它到底是内部主键还是业务标识？

任何一个问题答不上来，都不应该直接收缩响应。

## 10. 当前结论

当前仓库已经可以开始做响应体治理，但顺序必须是：

1. 先按接口用途分层；
2. 再用 presenter 收口；
3. 先迁移前端依赖，再删兼容字段；
4. 同步链路字段单独看，不跟普通展示字段一起裁。

这次回归的核心教训不是“不要优化响应体”，而是：

**响应体优化本质上是契约变更。只要是契约变更，就必须按跨端协议来做，而不能只按后端实体美观来做。**
