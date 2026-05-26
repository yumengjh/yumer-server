# 文档草稿工作副本功能复盘

> 日期：2026-05-27
> 范围：内容基础设施后端 + 编辑器前端的草稿工作副本改造

## 1. 背景

这次改造的起点不是“加一个取消草稿按钮”，而是编辑器的内容保存语义本身不合理：用户在编辑时如果没有点击保存，重新进入文档仍然看到旧内容；只有保存后，草稿才会进入新版本历史，下一次访问才会看到更新。这会导致几个直接后果：

1. 编辑过程缺少连续性，用户会误以为内容丢失。
2. “未提交修改”只是一个隐式状态，没有成为一等数据对象。
3. 保存按钮同时承担“同步草稿”和“提交版本”两种职责，语义混乱。
4. 大文档场景下，本该支持的分段加载、分页续拉、草稿恢复与版本提交没有清晰边界。

因此这次的目标不是修一个点，而是把“草稿”正式建模出来，让它成为可恢复、可丢弃、可提交、可后续加锁的工作副本。

## 2. 设计目标

本次设计的关键目标有四个：

- **默认进入草稿**：再次打开文档时，优先看到未提交草稿。
- **单文档单草稿**：一篇文档只有一个共享草稿，适配单人编辑，后续可扩展锁。
- **正式内容与草稿严格分流**：正式阅读接口继续保持纯净，草稿只服务编辑器。
- **保留超大文档能力**：草稿读取也必须支持 `maxDepth / startBlockId / limit`，不能因为分流而退化。

## 3. 最终设计

### 3.1 数据模型

最终落地为三层数据语义：

- `block_versions`：统一块版本池，所有块内容版本都在这里。
- `doc_snapshots`：正式版本的快照，表达“某个正式版本该看哪些 block version”。
- `document_drafts`：草稿工作副本，表达“当前编辑态该看哪些 block version”。

其中，草稿并不复制一份块内容，而是复用 `block_versions`，只保存自己的 `blockVersionMap`。这让草稿与正式版本在本质上同构，只是引用视图不同。

### 3.2 读取边界

保留原有正式内容接口：

- `GET /api/v1/documents/:docId/content?mode=json|html|all`

职责不变：

- `json`：正式树
- `html` / `all`：渲染诊断与公开展示链路
- 支持历史版本
- **不读取草稿**

新增编辑器专用接口：

- `GET /api/v1/documents/:docId/edit-content`

职责：

- 自动优先返回草稿
- 没有草稿则回退到 head
- 只返回 `json`
- 继续支持 `maxDepth / startBlockId / limit`

### 3.3 写入边界

旧的自动同步/增量编辑不再只是“不要推进 head”，而是：

- 创建或更新块版本
- 同步更新 `document_drafts.blockVersionMap`
- 将本次写入视为草稿的一部分

真正的正式版本提交则由：

- `POST /api/v1/documents/:docId/commit`

来完成。这个接口保留路径，但语义从“提交待创建版本计数”重定义为“提交当前 draft”。

草稿取消则由：

- `DELETE /api/v1/documents/:docId/draft`

负责。

## 4. 前后端协调

这次不是单后端改造，而是前后端一起改协议。

### 4.1 后端提供的契约

后端新增了编辑器侧所需的响应结构：

- `source: "draft" | "head"`
- `draft.exists / baseDocVer / updatedAt / updatedBy`
- `lock` 预留字段
- `pagination` 继续沿用大文档协议

这让前端无需再“先问有没有草稿，再决定调用哪个接口”，而是直接统一走 `edit-content`。

### 4.2 前端的行为变化

前端的关键变化有三处：

1. `loadDocumentContentV2()` 改为调用 `edit-content`
2. `DocumentContext` 记录当前内容来源与草稿元信息
3. `DocumentHeader` 在草稿态展示“取消草稿”

保存按钮的语义也被重新定义：

- **自动同步**：更新草稿
- **手动保存**：提交草稿为正式版本

取消草稿后，编辑器会重新加载 head，用户不需要再手动做额外恢复操作。

## 5. break change 与废弃 API

这次改造里最重要的 break change 不是“新增接口”，而是**重定义旧接口语义**。

### 5.1 `POST /documents/:docId/commit`

这是保留并重定义的接口。以前它表达的是“把待创建操作数提交成新版本”，现在它表达的是“把当前 draft 提交为新版本”。

这样做的好处是：

- 前端保存按钮不需要换路径
- 对外 API 稳定
- 迁移期最短

### 5.2 `GET /documents/:docId/pending-versions`

这个接口进入废弃流程。原因是新模型里，“待创建版本数”不再是核心产品概念，用户真正关心的是草稿是否存在、更新时间、锁状态，而不是 pending count。

兼容策略：

- 仍保留接口
- 但只作为兼容层
- 返回值退化为 `draft.exists ? 1 : 0`
- 前端不再依赖它做主流程判断

### 5.3 `GET /documents/:docId/content?mode=html|all`

这个接口没有废弃，但边界被明确锁死：

- 只能服务正式内容
- 不能读草稿
- 不能变成编辑器入口

这是这次设计中非常重要的边界保护，防止草稿语义污染展示/发布链路。

## 6. 实践过程

### 6.1 使用 worktree 做隔离

这次改造使用了独立 worktree 来隔离实施，避免把大改动直接压在主分支上：

- 后端 worktree：`feature/document-draft-working-copy`
- 基线分支：`wip/night-sync`

这样做的好处是：

- 可以在不影响主线的情况下做大改造
- 可以分阶段提交
- 回滚时粒度更小

### 6.2 TDD 与增量推进

这次实施遵守了“先测试、后实现”的节奏：

- 先写 `document-draft.service.spec.ts`
- 再写 `documents.controller.spec.ts` / `documents.service.spec.ts`
- 再补 `blocks.service.draft.spec.ts`
- 最后落到前端 `document-edit-content.test.ts` 和 `document-header-draft-actions.test.ts`

每一步都先看红灯，再补最小实现，再验证绿色。

### 6.3 分阶段提交

为了便于回溯，整体被拆成了多个可验证的提交：

- `add persisted document draft storage`
- `add draft-backed edit content routes`
- `commit persisted drafts and deprecate pending counters`
- `route deferred block writes through document drafts`
- `load and discard persisted document drafts`

这种拆分的价值在于：

- 每个提交都可以单独审查
- 出问题时能快速二分定位
- 便于后续对照设计文档检查覆盖率

## 7. 过程中的关键问题与修复

### 7.1 TypeORM 元数据未注册

最初运行时出现：

- `EntityMetadataNotFoundError: No metadata for "DocDraft" was found`

根因不是实体文件没写，而是后端根模块 `app.module.ts` 的 `databaseEntities` 是手工维护的，`DocDraft` 只注册在模块 `forFeature` 里还不够，必须加入根连接实体列表。

修复方式：

- 在 `src/app.module.ts` 的 `databaseEntities` 中显式加入 `DocDraft`

### 7.2 SQLite 类型反射问题

随后又遇到：

- `DataTypeNotSupportedError: Data type "Object" in "DocDraft.baseSnapshotId" is not supported by "better-sqlite3" database`

根因是 TypeORM 在 `string | null` 这类字段上，通过反射把设计类型推成了 `Object`，SQLite 不接受隐式类型。

修复方式：

- 给 nullable string 字段显式写 `type: "varchar"`
- 包括 `baseSnapshotId / lockOwnerUserId / lockToken`

这个问题并不影响 PostgreSQL，Postgres 侧仍然兼容。

## 8. 版本块 GC 的设计预留

这次改造没有直接实现版本块 GC，但它已经成为后续必须接入的设计约束。

原因是草稿也引用 `block_versions`。因此未来做 GC 时，`document_drafts.blockVersionMap` 必须被当成正式的 GC root 之一，否则会误删仍在草稿中被引用的块版本。

这意味着未来 GC 至少要从这些根做可达分析：

- 正式 snapshot 的 `blockVersionMap`
- 草稿 `document_drafts.blockVersionMap`
- pinned snapshot / 保留窗口 / 审计保留等扩展根

## 9. 验证结果

后端验证：

- `pnpm test`：通过
- 聚焦测试：`documents.controller.spec.ts` / `documents.service.spec.ts` / `version-control.service.spec.ts` / `blocks.service.draft.spec.ts`：通过

前端验证：

- `document-edit-content.test.ts`：通过
- `document-header-draft-actions.test.ts`：通过

## 10. 经验总结

### 10.1 最重要的经验

草稿功能的难点不在 UI，而在**语义切分**：

- 哪些接口是正式内容
- 哪些接口是编辑态
- 哪些接口只是兼容层
- 哪些状态必须持久化

只要边界划清，前后端实现都能比较自然。

### 10.2 兼容比重构更重要

这次没有把旧 `/content` 接口废掉，而是把新编辑器入口单独切出来。这样保住了发布/展示链路的稳定性，也避免了把草稿逻辑塞进公开内容接口里导致后续越来越乱。

### 10.3 worktree 对大改造很有价值

大改造如果直接压在主分支上，很容易把验证、回滚、审查都搞乱。worktree 让“实现、验证、合并”分层清晰，尤其适合这种前后端联动的协议级改造。

## 11. 后续建议

1. 正式把 `pending-versions` 的兼容层标记为 deprecated，并在文档中注明淘汰时间。
2. 后续做单编辑者锁时，先复用 `document_drafts` 上预留的 lock 字段。
3. 后续做版本块 GC 时，务必把 draft map 纳入根引用。
4. 如果未来还要支持多草稿态（例如多人协作），最好在这个模型基础上扩展，不要再回到“隐式 pending 状态”的写法。
