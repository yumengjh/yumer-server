# 2026-06-08 API 响应体优化误伤同步链路复盘

## 1. 问题现象

本轮原计划是收缩 `documents` 模块的响应体，减少数据库内部字段、原始用户标识和冗余信息的外露。

第一次改动后，后端单测通过，但前端在 `E:\workspace\editor-demo\app` 联调时出现了实质性回归：

- 文档仍可打开；
- 但编辑后内容不同步；
- 旧保存路径无法正常写回内容。

这说明问题不在输入 DTO，也不在同步主接口 `/blocks/batch`，而在文档详情响应契约被破坏后，前端失去了继续发起保存所需的关键字段。

## 2. 直接原因

本次响应体收缩中，把文档详情响应里的 `rootBlockId` 去掉了。

但前端当前仍明确依赖这个字段。例如：

- `src/contexts/DocumentContext.tsx`
- `src/components/EditorPage.tsx`
- `src/services/document.ts`

其中 `EditorPage.tsx` 仍存在：

```ts
saveDocumentContentV2(currentDoc.docId, nextContent, currentDoc.rootBlockId)
```

当 `rootBlockId` 从详情响应中消失后，前端旧保存路径无法再为 create / delete / diff 计算提供根块定位，最终表现为内容无法同步。

## 3. 根因

这次问题的根因不是“代码改漏了某个字段”，而是**字段分类方法错了**。

当时把以下两类字段混为了一类：

1. 数据库内部主键 / 存储实现字段
   例如：
   - `Document.id`
   - `DocRevision.id`
   - `Document.publishedSnapshotId`

2. 跨端协议层业务标识
   例如：
   - `docId`
   - `workspaceId`
   - `rootBlockId`
   - `blockId`

`rootBlockId` 虽然名字上像“内部 id”，但语义上并不是数据库内部主键，而是前后端共享的内容树根标识。它当前属于编辑和保存链路的一部分，不能和 `Document.id` 一起按“内部字段”处理掉。

## 4. 为什么后端单测没挡住

第一次改动后，后端相关测试是通过的，原因有两个：

1. 当时新增的 response projection 测试主要验证了“不再暴露内部字段”，但没有把“前端仍依赖的协议字段必须保留”作为硬断言。
2. 后端局部单测并不能替代真实跨仓联调。响应体优化本质上是契约变更，只看 `yumer-server` 自身测试不够。

这次回归再次说明：

- DTO 校验通过，不代表响应契约安全；
- 后端单测通过，不代表前端链路没断。

## 5. 已完成修复

### 5.1 代码侧

本轮已经完成的修复与收敛包括：

1. 为 `documents` 响应引入 presenter / response mapper 方向，避免 controller 继续直接吐 entity 形状。
2. 对文档详情、列表、公开详情、修订列表做了更明确的响应投影。
3. 保留当前前端仍然依赖的关键字段：
   - `docId`
   - `workspaceId`
   - `rootBlockId`
   - `head`
   - `draftRevision`
4. 去掉当前不应继续直出的字段：
   - `id`
   - 原始 `createdBy`
   - 原始 `updatedBy`
   - `publishedSnapshotId`
5. 用 `creator` / `updater` 摘要替代直接暴露原始用户 ID。

### 5.2 文档侧

新增设计约束文档：

- `docs/superpowers/specs/2026-06-08-api-response-contract-design.md`

该文档明确区分了：

- 数据库内部字段
- 协议层业务标识
- 视图层字段
- 同步/编辑专用字段

并补充了后续响应体收缩的最小检查清单。

## 6. 本轮验证

本轮已经执行并通过：

```bash
pnpm test -- --runTestsByPath src/modules/documents/documents.service.spec.ts
pnpm test -- --runTestsByPath src/modules/documents/documents.controller.spec.ts
```

同时已完成真实联调确认：

- 前端恢复正常；
- 内容同步恢复；
- `rootBlockId` 回补后，保存路径重新可用。

未纳入本轮结论的校验：

```bash
pnpm exec tsc --noEmit
```

该命令在当前仓库有既有无关失败，不能作为本次变更是否安全的唯一基线。

## 7. 本轮结论

本轮最重要的结论有四条：

1. 响应体优化不是纯后端清理，而是跨端契约变更。
2. 不能按字段名猜语义，必须区分“数据库内部主键”和“协议层业务标识”。
3. `documents` 模块不能再复用一个“万能 Document 形状”覆盖列表、详情、编辑和同步场景。
4. 任何响应收缩都必须先查前端真实消费点，再删字段。

## 8. 后续约束

后续继续优化接口时，必须遵守以下规则：

### 8.1 先分类，再改响应

每个字段先标注为：

- `DB_INTERNAL`
- `PROTOCOL_REQUIRED`
- `VIEW_REQUIRED`
- `OPTIONAL_COMPAT`
- `REMOVE_CANDIDATE`

没有分类，不允许直接删字段。

### 8.2 先搜前端消费点

对于候选删除字段，至少执行：

```bash
rg -n "<fieldName>" E:\workspace\editor-demo\app\src
```

重点检查：

- `src/services/document.ts`
- `src/services/sync/*`
- `src/contexts/DocumentContext.tsx`
- `src/components/EditorPage.tsx`
- `src/components/DocumentHeader.tsx`

### 8.3 presenter 层收口，不直接拿 entity 当响应

后续方向应该是：

- service 内部继续操作 entity / domain object；
- controller 出口统一走 presenter；
- 在 presenter 层按接口用途决定暴露哪些字段。

### 8.4 先补双向契约测试

后续响应体优化必须同时补两类测试：

1. 不该暴露的字段确实被去掉；
2. 当前前端依赖的关键字段仍然存在。

对文档详情，当前至少应继续保证：

- 保留：`docId`、`workspaceId`、`rootBlockId`、`head`、`draftRevision`
- 去掉：`id`、`publishedSnapshotId`、原始 `createdBy/updatedBy`

### 8.5 后端测试之后，必须做前端真实链路验证

至少执行一轮：

1. 打开文档
2. 编辑内容
3. 保存或等待自动保存
4. 刷新页面确认内容仍在

只跑后端测试，不足以证明响应体优化安全。

## 9. 后续工作建议

后续建议分两步推进：

### 第一步：完成 `documents` 模块响应类型拆分

建议拆成独立类型：

- `DocumentListItemResponse`
- `DocumentDetailResponse`
- `PublicDocumentDetailResponse`
- `DocumentRevisionListItemResponse`
- `EditContentResponse`
- `SyncStateResponse`

### 第二步：再逐步迁移其他模块

后续再处理：

- `comments`
- `favorites`
- `search`

这些模块也应该从“直接吐实体”转为“明确 response projection”。

## 10. 最终结论

这次问题不是因为“接口不能优化”，而是因为**响应体治理必须按协议治理来做**。

本轮已经把错误方向纠正回来，并补齐了设计文档。之后如果继续沿着 presenter 分层、字段分类、前后端联调这条路径推进，响应体可以继续收缩，但不会再靠猜字段语义冒险。
