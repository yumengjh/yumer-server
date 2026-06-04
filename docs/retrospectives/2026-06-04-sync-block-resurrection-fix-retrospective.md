# 2026-06-04 内容同步“块复活”问题修复复盘

## 1. 背景

这轮修复起因于内容同步链路持续出现隐蔽、低频但破坏性很强的数据异常：

- 编辑器中已经删除或替换的块，刷新页面后重新出现；
- 编辑过程中看起来保存成功，但服务端草稿仍保留客户端已不可见的旧块；
- 清空并重建内容后，偶尔残留一个空块或一批旧内容；
- 多个同步批次全部返回成功，刷新后仍发现客户端和服务端文档不一致；
- 同一个问题很难稳定复现，容易被误判为 GC、sortKey 或网络抖动。

这类问题统一表现为“块复活”，但调查后确认它不是单一故障，而是多个同步缺陷叠加后的结果。

本轮最终修复了四条会直接制造或放大内容复活的链路：

1. 前端 ACK 处理吞掉请求飞行期间发生的删除或编辑；
2. 后端自动同步没有草稿级并发控制，旧页面可以继续写入新草稿；
3. 外部完整内容加载被错误当成 ACK 身份补丁，导致编辑器保留旧内容；
4. 前端排序规划使用错误索引键，可能制造 sortKey 冲突和后续同步震荡。

此外，本轮还统一了后端所有草稿修改路径的事务顺序，使批量同步、普通草稿写入、丢弃、提交和 GC 压缩都通过同一条文档行锁串行执行。

## 2. 影响范围

### 用户可见影响

- 删除的内容刷新后重新出现；
- 清空文档后刷新，旧段落或空段落残留；
- 取消草稿、版本回退或重新加载后，下一次输入又把旧内容写回服务端；
- 多标签页同时编辑时，一个旧标签页可以覆盖或复活另一个标签页已经删除的内容；
- 块顺序偶尔发生震荡，服务端重新分配 sortKey，增加后续身份和排序错乱概率。

### 数据层影响

调查中的典型文档表现为：

- 多出的块在服务端仍为 `isDeleted=false`；
- 多出的块没有 tombstone，也没有成功删除生命周期；
- 服务端 draft map 仍然引用这些块；
- 客户端后续同步请求中根本没有对应 delete 操作；
- 自动同步长期保持相同 `document.head`，旧客户端无法感知草稿已经变化。

因此，典型案例不是“块已经删除，后来被 GC 恢复”，而是“删除差异从客户端同步基线中消失，服务端从未收到删除请求”。

## 3. 调查过程

### 3.1 初始怀疑

最初主要怀疑以下方向：

1. 模块化重构后同步逻辑发生行为变化；
2. 服务端重新分配 sortKey 后，客户端身份跟踪失效；
3. tombstone 被 GC 压缩后错误恢复；
4. 删除请求返回 `Block not found` 后触发异常重试；
5. 客户端 ACK 没有正确写回 blockId 或 sortKey。

历史 `bug001`、`bug002` 分析也显示：

- 服务端曾重新分配客户端请求的 sortKey；
- 部分块反复被删除，服务端返回 `Block not found`；
- 部分残留块创建后从未再收到 delete；
- 问题常发生在清空、重建、批量粘贴和高频编辑之后。

这些证据说明 sortKey 和身份映射确实会放大问题，但仍不足以解释“为什么某些服务端可见块完全没有 delete 请求”。

### 3.2 日志生命周期核对

对同步日志按 block 生命周期进行核对后，发现典型案例中的多余块具有相同特征：

```text
CREATE 成功
→ 后续没有 DELETE
→ 刷新后继续可见
```

这与“先删除、后被 GC 复活”的生命周期不同：

```text
CREATE
→ DELETE / tombstone
→ GC compact
→ 错误恢复
```

数据库状态进一步确认：

- 多余块仍然是 live block；
- 最新版本没有 `deleted` 标记；
- draft map 仍直接引用这些版本；
- 没有证据表明 GC 恢复了它们。

由此排除 GC 是本次典型案例的直接触发器。

### 3.3 定位前端 ACK 基线竞态

前端同步使用 `snapshotRef` 保存上一次已接受的同步基线，通过当前编辑器内容与基线的差异生成 create、update、delete、move。

旧 ACK 路径存在以下时序：

```text
T0：snapshotRef 中存在块 A
T1：客户端发送包含 A 的同步批次
T2：请求仍在飞行，用户删除 A
T3：服务端返回 ACK
T4：ACK 使用旧 snapshotRef 检查 orphan create，认为 A 仍存在
T5：ACK 回调读取编辑器最新内容，此时 A 已不存在
T6：代码把编辑器最新内容直接设为新的 snapshotRef 基线
T7：A 的删除没有经过差异计算，delete 操作永久丢失
T8：刷新页面，服务端仍有 A，用户看到“块复活”
```

关键问题不是请求失败，而是把“尚未同步的最新编辑器内容”直接接受为“已经同步成功的基线”。

这可以完整解释日志中的现象：

- 服务端创建成功；
- 客户端稍后删除；
- 后续请求没有 delete；
- 刷新后服务端块重新出现。

### 3.4 定位后端草稿并发控制缺失

自动同步请求使用：

```text
createVersion=false
```

这意味着自动同步只修改 `DocDraft`，不会推进 `Document.head`。

旧后端只校验：

```text
client.baseVersion === document.head
```

因此以下请求都会被接受：

```text
标签页 A 加载 head=3
标签页 B 加载 head=3
标签页 A 删除块并同步，head 仍为 3
标签页 B 使用旧内容更新同一块，baseVersion 仍为 3
后端认为版本一致，接受旧更新
```

这使旧标签页、延迟请求和旧页面可以静默写入已经变化的草稿。

更严重的是，旧更新写入 tombstone 块时可能移除删除标记，从而真正复活块。

### 3.5 定位外部内容误判为 ACK

`MarkdownEditor` 接收外部 `content` 时，旧逻辑先尝试执行身份补丁：

```text
只要新旧内容存在相同 clientId
→ 认为这是 ACK 身份回填
→ 跳过 editor.commands.setContent
```

但外部 `content` 不仅来自 ACK，还可能来自：

- 重新加载文档；
- 丢弃草稿；
- 版本回退；
- 切换文档；
- 服务端冲突后刷新。

如果新旧内容拥有相同 `clientId`，但正文不同，旧逻辑仍可能阻止完整内容加载。

结果是 React 状态和编辑器内部状态分裂：

```text
React content：服务端新内容
编辑器内部：旧内容
用户下一次输入
→ 旧内容再次进入同步链路
```

### 3.6 定位排序锚点索引错误

排序规划中的 `prevIndexed` 对已有块使用 `matchKey` 建索引，通常对应 `blockId`。

旧代码查找下一锚点时却使用：

```ts
prevIndexed[orderedNextNodes[index].clientId]
```

已有块的 `clientId` 与 `matchKey/blockId` 并不保证相同，因此可能无法找到下一锚点，生成错误或冲突的 sortKey。

服务端随后重新分配 sortKey，增加了 ACK 写回、顺序震荡和身份跟踪的复杂度。

## 4. 根因总结

### 4.1 直接根因

本次典型块复活的直接根因是：

> ACK 返回后，前端把包含未同步删除的最新编辑器内容直接覆盖成同步基线，导致删除差异永久消失。

### 4.2 结构性放大因素

后端没有草稿级并发修订号，只校验不会被自动同步推进的 `document.head`。

因此即使前端没有吞删除，多标签页或旧请求仍然可能写入已经变化的草稿。

### 4.3 独立复活入口

外部完整内容加载与 ACK 身份补丁共用入口，可能导致编辑器拒绝加载服务端内容，并在下一次输入时把旧内容重新写回。

### 4.4 排序震荡因素

排序锚点错误会制造不必要的 sortKey 冲突和服务端重新分配，增加同步状态失配概率，但它不是本次典型日志中漏发 delete 的直接根因。

## 5. 最终修复方案

## 5.1 前端：ACK 前先捕获请求期间的新变化

涉及文件：

- `src/hooks/useDocumentSync.ts`

修复后的 ACK 顺序：

```text
1. 服务端返回成功 ACK
2. reducer 接受服务端 head 和 draftRevision
3. 使用最新编辑器内容执行 captureContentSnapshot
4. 将请求期间产生的删除、更新和移动加入 dirty entries
5. 再检查孤儿 create
6. 将服务端 blockId/sortKey ACK 补丁写入 snapshot
7. 如果补丁写回编辑器，再次通过 captureContentSnapshot 接受结果
```

核心原则：

> 任何最新编辑器内容都必须经过 `advanceSyncSnapshot/captureContentSnapshot` 计算差异，不能直接覆盖同步基线。

这样，请求飞行期间发生的删除不会被 ACK 吞掉，而会成为下一批同步操作。

## 5.2 前端：拆分 ACK 身份补丁与外部完整内容加载

涉及文件：

- `src/modules/editor-kit/editorIdentity.ts`
- `src/modules/editor-kit/MarkdownEditor.tsx`

新增严格入口：

- `patchEditorBlockIdentityFromMatchingDoc`

该入口只在以下条件全部满足时把外部内容视为身份补丁：

- 块数量一致；
- 块类型一致；
- 忽略身份字段后，正文和属性内容一致；
- 相同位置的 clientId 不冲突。

用途区分：

- 显式 ACK 回调继续允许按 `clientId` 给正在编辑的块补 blockId/sortKey；
- 普通外部 `content` 只有在内容真正一致时才执行身份补丁；
- 外部内容不同则执行完整 `setContent`。

这避免了丢弃草稿、版本回退或重新加载被旧编辑器内容拦截。

## 5.3 前端：修复排序锚点查找

涉及文件：

- `src/services/sync/engine.ts`

修复内容：

```ts
// 修复前
prevIndexed[orderedNextNodes[index].clientId]

// 修复后
prevIndexed[orderedNextNodes[index].matchKey]
```

排序规划现在使用与索引构建一致的身份键查找下一锚点，减少错误 sortKey 和服务端重新分配。

## 5.4 前后端协议：引入 draftRevision

前端涉及文件：

- `src/components/EditorPage.tsx`
- `src/hooks/useDocumentSync.ts`
- `src/services/document.ts`
- `src/services/sync/api.ts`
- `src/services/sync/reducer.ts`
- `src/services/sync/types.ts`

后端涉及文件：

- `src/entities/document.entity.ts`
- `src/modules/blocks/blocks.service.ts`
- `src/modules/blocks/dto/batch-block.dto.ts`
- `src/modules/blocks/dto/sync-batch-response.dto.ts`
- `src/modules/documents/documents.service.ts`
- `src/modules/documents/dto/edit-content-response.dto.ts`
- `src/modules/documents/dto/sync-state-response.dto.ts`
- `src/modules/documents/services/document-draft.service.ts`
- `src/modules/gc/modules/block-version/gc-sweep.service.ts`

协议新增：

```text
客户端请求：
draftRevision: 客户端当前草稿修订号

服务端响应：
draftRevision: 服务端成功应用批次后的草稿修订号
```

后端校验：

```text
createVersion=false
且 clientDraftRevision !== document.draftRevision
→ 拒绝整个批次
→ needsReload=true
→ conflict.code=DRAFT_REVISION_MISMATCH
```

前端成功收到 ACK 后，会把服务端返回的 `draftRevision` 写入同步 reducer，作为下一批请求的基线。

## 5.5 后端：draftRevision 存储在 Document，而不是 DocDraft

最终设计把单调修订号放在：

```text
Document.draftRevision
```

而不是：

```text
DocDraft.draftRevision
```

原因是 `DocDraft` 会在以下操作中被删除：

- 丢弃草稿；
- 提交草稿；
- 某些版本工作流。

如果修订号存在 `DocDraft`，删除草稿后修订号会重置为 0：

```text
旧客户端 revision=0
→ 草稿被创建、修改、丢弃
→ 新草稿 revision 又从 0 开始
→ 旧客户端 revision=0 再次被错误接受
```

放在 `Document` 后，修订号在整个文档生命周期中保持单调，不随草稿删除而重置。

## 5.6 后端：每个成功批次只推进一次 revision

批量同步可能包含多个 create、update、delete、move。

本轮采用：

```text
一个成功的 batch 事务
→ draftRevision 只增加 1
```

而不是每个块操作增加一次。

原因：

- 客户端并发控制关注的是批次顺序，而不是批次中的块数量；
- 每批增加一次更容易推理和测试；
- 同一批次中部分操作失败时，仍能清晰表示服务端草稿发生过一次状态转换。

普通非 batch 草稿写入每次成功事务增加一次 revision。

## 5.7 后端：统一文档行锁和事务顺序

新增并统一使用：

- `DocumentDraftService.lockDocumentForDraftMutation`

在 PostgreSQL 等支持行锁的数据库中，草稿修改会先获取：

```text
Document pessimistic_write lock
```

统一顺序：

```text
锁定 Document
→ 检查或读取 draftRevision
→ 修改 DocDraft / draft map
→ 推进 draftRevision 或 document.head
→ 提交事务
```

覆盖路径：

- 批量自动同步；
- 非 batch create/update/move 草稿写入；
- 创建或更新 DocDraft；
- 丢弃草稿；
- 提交草稿；
- GC draft tombstone 压缩。

这样可以避免以下交错：

```text
批量同步读取 revision=7
GC 同时修改 draft map 并推进 revision
批量同步继续基于旧 map 写入
```

SQLite 不支持相同的行锁模式，因此保持事务串行语义，不请求 `pessimistic_write`。

## 5.8 后端：GC 修改草稿映射时推进 revision

GC draft tombstone 压缩会直接修改 `DocDraft.blockVersionMap`。

如果 GC 修改映射但不推进 revision，客户端仍会认为自己的草稿基线有效。

本轮修复后，GC 压缩会：

```text
锁定 Document
→ 修改 draft map
→ 推进 Document.draftRevision
```

任何基于旧草稿的客户端请求都会被拒绝并要求刷新。

## 5.9 数据库迁移

新增后端迁移：

- `src/database/migrations/1782400000000-AddDraftRevision.ts`

迁移内容：

```sql
ALTER TABLE "documents"
ADD COLUMN "draftRevision" integer NOT NULL DEFAULT (0);
```

生产环境部署时必须先执行数据库迁移，不能依赖 `synchronize: true`。

## 6. 尝试复现与验证步骤

下面的步骤既用于复现修复前故障，也可用于验证修复后的行为。

## 6.1 复现一：ACK 飞行期间删除，刷新后块复活

这是最接近本次典型日志的复现方式。

### 准备

1. 启用前端同步引擎；
2. 打开浏览器开发者工具；
3. 将网络设置为 Slow 3G，或在 `/blocks/batch` 响应处设置断点；
4. 打开一个测试文档。

### 操作

1. 输入或粘贴多个新段落，触发 create batch；
2. 确认 `/blocks/batch` 请求已经发出但响应尚未处理；
3. 在响应返回前，立即删除刚创建的部分段落，或清空并替换整个文档；
4. 释放网络或断点，让 create ACK 返回；
5. 等待后续自动同步完成；
6. 检查后续 `/blocks/batch` 是否包含刚删除块的 delete；
7. 刷新页面。

### 修复前预期

- ACK 后把最新编辑器内容直接设为基线；
- 删除差异被吞掉；
- 后续请求没有 delete；
- 刷新后被删除块重新出现。

### 修复后预期

- ACK 处理先捕获请求期间的删除；
- 下一批请求包含对应 delete；
- 刷新后块不会重新出现。

### 自动化覆盖

- `src/components/__tests__/manual-save-base-version.source.test.ts`

测试约束 ACK 处理顺序必须为：

```text
resolve success
→ capture latest editor content
→ orphan check
→ apply ACK baseline
→ capture editor-applied ACK
```

## 6.2 复现二：两个标签页用相同 head 修改草稿

用于验证后端草稿级并发控制。

### 准备

1. 在两个浏览器标签页打开同一文档；
2. 确认两个标签页加载到相同 `head` 和 `draftRevision`；
3. 保持标签页 B 不操作。

### 操作

1. 标签页 A 删除块 X，并等待同步成功；
2. 标签页 A 收到新的 `draftRevision`；
3. 标签页 B 保持旧内容，对块 X 继续输入或移动；
4. 标签页 B 使用旧 `draftRevision` 发送 batch。

### 修复前预期

- 因为 `document.head` 没有变化，标签页 B 请求被接受；
- 旧 update 可能移除删除标记并复活块 X。

### 修复后预期

- 标签页 B 请求被整体拒绝；
- 响应包含：

```json
{
  "needsReload": true,
  "conflicts": [
    {
      "code": "DRAFT_REVISION_MISMATCH"
    }
  ]
}
```

- 服务端不会创建新的块版本，也不会复活 X。

### 自动化覆盖

- 后端 `src/modules/blocks/blocks.service.draft.spec.ts`
  - `rejects an update based on the stale revision from before a draft delete`
- 后端 `src/modules/blocks/blocks-sync-idempotency.spec.ts`
  - 旧批次或旧 syncCreateId 重放会因 revision 过期而被拒绝；
  - 不会重复创建块。

## 6.3 复现三：丢弃草稿后旧 revision 再次写入

用于验证为什么 revision 必须放在 `Document`。

### 操作

1. 客户端 A 加载文档，记录 `draftRevision=R`；
2. 客户端 B 修改草稿，使 revision 变为 `R+1`；
3. 客户端 B 丢弃草稿；
4. 服务端不再存在 `DocDraft`；
5. 客户端 A 使用旧 revision `R` 再次提交。

### 错误设计预期

如果 revision 存在 `DocDraft`：

- 草稿删除后 revision 重置；
- 新草稿可能重新从 0 开始；
- 旧客户端可能再次被接受。

### 当前修复预期

- 丢弃草稿会推进 `Document.draftRevision`；
- 即使当前没有草稿，编辑内容和 sync-state API 仍返回文档级 revision；
- 客户端 A 的旧请求被拒绝。

### 自动化覆盖

- 后端 `src/modules/documents/services/document-draft.service.spec.ts`
  - 验证丢弃草稿后推进文档修订号；
- 后端 `src/modules/documents/documents.service.spec.ts`
  - 验证无草稿时仍返回保留下来的文档级 revision。

## 6.4 复现四：外部内容拥有相同 clientId，但正文不同

用于验证外部 reload 不再被误当成 ACK。

### 操作

1. 编辑器当前内容为：

```text
clientId=client-shared
正文=editor old content
```

2. 从服务端、版本回退或丢弃草稿流程加载：

```text
clientId=client-shared
正文=externally loaded content
```

3. 把外部内容传给 `MarkdownEditor`。

### 修复前预期

- 因为 clientId 相同，身份补丁返回成功；
- `setContent` 被跳过；
- 编辑器仍显示旧正文。

### 修复后预期

- 严格匹配发现正文不同；
- 不执行身份补丁；
- 继续执行完整 `setContent`。

### 自动化覆盖

- `src/modules/editor-kit/__tests__/identity-selection.test.ts`
  - `does not treat external content with matching clientId as an identity-only patch`

## 6.5 复现五：已有块 clientId 与 blockId 不同的重排

用于验证排序锚点索引修复。

### 操作

1. 创建多个已有块，确保每个块同时具有不同的 `blockId` 和 `clientId`；
2. 调整块顺序；
3. 运行 `deriveSyncEntries`；
4. 检查生成的 move sortKey。

### 修复前预期

- 下一锚点使用 clientId 查询按 blockId 建立的索引；
- 查询失败，可能分配到错误或碰撞的 sortKey。

### 修复后预期

- 使用 `matchKey` 查找下一锚点；
- move sortKey 落在正确相邻锚点之间。

### 自动化覆盖

- `src/services/sync/__tests__/engine-order.test.ts`
- `src/services/sync/__tests__/snapshot.test.ts`

## 6.6 基于历史日志确认是否为“漏删”

对于线上或测试环境再次出现的块复活，可按以下顺序判断：

1. 获取刷新后多出的 blockId；
2. 在同步日志中检索该 blockId；
3. 按时间整理 CREATE、UPDATE、DELETE 生命周期；
4. 检查是否存在成功 DELETE；
5. 查询数据库中的：
   - `blocks.isDeleted`
   - `blocks.latestVer`
   - 最新 `block_versions.payload.attrs.deleted`
   - `document_drafts.blockVersionMap`
6. 判断：

```text
只有 CREATE，没有 DELETE
→ 优先排查客户端漏发删除或基线丢失

存在 DELETE/tombstone，后续重新可见
→ 排查旧 update、显式 restore、GC 或草稿 map 修改
```

本次典型案例属于第一类。

## 7. 测试与验证结果

## 7.1 前端聚焦测试

执行：

```bash
npm run test:unit -- \
  src/services/sync/__tests__/reducer.test.ts \
  src/services/sync/__tests__/snapshot.test.ts \
  src/services/sync/__tests__/engine-order.test.ts \
  src/modules/editor-kit/__tests__/identity-selection.test.ts \
  src/components/__tests__/manual-save-base-version.source.test.ts
```

结果：

```text
5 个测试文件通过
43 个测试通过
```

## 7.2 前端 ESLint

对本轮相关前端实现文件执行直接 ESLint 检查，结果通过。

## 7.3 前端完整单测

为避免并发 worker 内存不足，使用单进程执行：

```bash
npm run test:unit -- --maxWorkers=1 --minWorkers=1
```

结果：

```text
82 个测试文件通过，2 个失败
305 个测试通过，3 个失败
```

剩余 3 个失败是本轮修复前已存在、且与同步修改无关的 CSS 源契约测试：

- `src/modules/editor-kit/TaskItemView.source.test.ts`
  - 兼容 CSS 文件中缺少测试直接查找的 `li[data-list-font-size]::marker`；
- `src/modules/editor-kit/code/CodeBlockView.source.test.ts`
  - 兼容 CSS 文件中缺少测试直接查找的代码块状态选择器，共 2 项。

本轮没有修改这些 CSS 文件或对应组件。

## 7.4 后端相关测试

执行覆盖：

- documents service；
- document draft service；
- blocks 全部测试；
- GC draft tombstone sweep。

结果：

```text
5 个测试套件通过
56 个测试通过
```

覆盖的关键行为：

- stale draftRevision 被拒绝；
- 删除后的旧 update 不会复活块；
- 同一个成功 batch 只推进一次 revision；
- 普通草稿写入推进 revision；
- 丢弃草稿推进 revision；
- 无草稿时仍返回文档级 revision；
- GC 修改 draft map 时推进 revision；
- GC 和草稿修改使用文档锁串行。

## 7.5 后端构建

执行：

```bash
npm run build
```

结果：

```text
TSC Found 0 issues
Nest/SWC 构建成功
```

## 7.6 差异检查

前后端均执行：

```bash
git diff --check
```

结果通过。

## 8. 部署与上线注意事项

### 8.1 必须执行数据库迁移

生产部署前必须运行新增迁移：

```text
1782400000000-AddDraftRevision.ts
```

未执行迁移时，后端读取或写入 `documents.draftRevision` 会失败。

### 8.2 前后端必须一起发布

建议同一发布窗口部署前后端：

- 新前端会发送 `draftRevision`；
- 新后端会返回并校验 `draftRevision`；
- 新后端对未携带 revision 的旧客户端会按默认 0 处理。

当线上已有文档 revision 仍为 0 时旧客户端暂时可能成功；一旦草稿发生修改，revision 推进后旧客户端会收到冲突并需要刷新。

### 8.3 冲突行为变化

修复后，多标签页和延迟请求不再静默覆盖，而会显式进入冲突状态并要求刷新。

这属于预期行为：

```text
宁可拒绝旧请求并提示刷新
也不能接受旧内容并静默复活块
```

### 8.4 观察指标

上线后建议重点观察：

- `DRAFT_REVISION_MISMATCH` 数量；
- `needsReload=true` 的批次比例；
- 同一文档短时间内 revision 推进频率；
- CREATE 后长期无 UPDATE/DELETE 的孤儿块；
- draft map 中 live block 与 tombstone 数量；
- GC 压缩后客户端冲突数量。

冲突数量可能在上线初期上升，因为以前被静默接受的旧请求现在会被正确拒绝。

## 9. 本轮没有处理的事项

本轮聚焦阻断块复活和草稿并发覆盖，没有扩展为完整同步协议重构。

尚未实现：

1. 每个 update/delete/move 携带 `expectedBlockVersion`；
2. 显式 `restore` 操作，彻底区分用户撤销删除与旧 update；
3. 服务端返回完整 draft 摘要或 live blockId 集合摘要；
4. 客户端成功 ACK 后定期核对服务端事实；
5. 自动冲突合并；
6. 自动刷新冲突页面；
7. 清理历史 draft map 中已经积累的异常条目；
8. 修复与本轮无关的 3 个前端 CSS 源契约测试。

这些事项仍值得后续推进，但不应阻塞本轮根因修复上线。

## 10. 经验与反思

### 10.1 “请求成功”不等于“文档一致”

本次所有批次都可能返回成功，但客户端已经丢失了服务端块的删除差异。

同步系统需要区分：

- 操作请求成功；
- 客户端状态机正确推进；
- 客户端完整文档与服务端草稿最终一致。

当前修复解决了已知基线竞态和并发覆盖，但长期仍应增加服务端事实摘要核对。

### 10.2 同步基线只能由已确认状态推进

不能把编辑器“当前看起来是什么”直接当成“服务端已经确认是什么”。

请求期间发生的任何变化都必须重新进入差异计算。

### 10.3 并发版本必须覆盖真实写入层

`document.head` 只代表保存版本，不代表草稿状态。

既然自动同步修改的是草稿，就必须为草稿提供独立、单调、可校验的 revision。

### 10.4 修订号的生命周期必须长于被保护对象

如果 revision 存在会被删除的 `DocDraft` 上，它就无法阻止草稿删除后的旧请求。

并发令牌必须存放在生命周期更长的 `Document` 上。

### 10.5 所有草稿修改者都必须参与并发协议

不仅编辑器会改草稿：

- 丢弃草稿会改变草稿状态；
- 提交会删除草稿并推进 head；
- GC 会直接修改 draft map。

任何绕过 revision 和文档锁的路径，都会重新制造不可见并发写入。

### 10.6 ACK 补丁与完整加载必须是不同语义

ACK 只补身份字段，允许保留请求期间继续输入的正文；
完整加载必须以服务端内容为准，不能因为存在相同 clientId 就跳过。

复用同一个“尽量 patch”入口看起来简洁，但会把完全不同的状态转换混在一起。

## 11. 最终结论

这轮确实属于一次较大的前后端联合修复，但改动围绕同一个目标展开：

> 不允许客户端静默丢失删除差异，也不允许旧草稿写入静默覆盖新草稿。

最终形成了以下防线：

```text
前端 ACK 捕获请求期间变化
→ 删除不会被吞

外部内容严格区分 ACK patch 与完整 reload
→ 旧编辑器内容不会拦截服务端事实

排序锚点使用一致身份键
→ 减少 sortKey 冲突和同步震荡

Document.draftRevision
→ 旧草稿请求可被识别

统一 Document 行锁与事务顺序
→ 批量同步、普通写入、丢弃、提交、GC 串行修改草稿
```

本轮修复后，典型块复活路径已经被阻断；以后出现同类问题时，也可以通过 block 生命周期、draftRevision 和冲突响应更快判断是客户端漏发删除、旧请求写入，还是其他独立数据问题。
