# 文档草稿工作副本设计

> 状态：待用户评审
> ç¨æ·è¯å®¡
> ç¨æ·è¯å®¡
> 日期：2026-05-26
> 仓库：F:\yuweb\back\server

## 1. 背景与问题

当前系统中，编辑器未点击“保存”时，修改虽然可能已经通过块级同步写入后端，但重新进入文档时默认仍读取正式版本 `head`，导致用户看到旧内容。只有手动保存后，草稿才会进入新的版本历史并在下次进入时体现出来。

这带来几个核心问题：

1. 未提交修改无法自然恢复，编辑体验不连续。
2. “草稿”没有被建模为正式的一等数据对象。
3. 当前 pending draft 更偏向内存状态或隐式状态，不适合长期演进。
4. 后续若要支持取消草稿、恢复草稿、单人编辑锁，现有模型扩展成本较高。

## 2. 已确认的产品原则

以下原则已确认：

1. 重新进入文档后，默认应直接打开未提交草稿，而不是旧的正式版本。
2. 一篇文档只保留一份共享草稿，而不是每个用户各自一份草稿。
3. 当前阶段不实现“同时仅允许一人编辑”的完整机制，但需要在数据结构中预留未来悲观锁所需字段。
4. 新增 `document_drafts` 表是必要的，草稿需要成为正式的数据模型。

## 3. 内容读取边界

已确认不能直接增强现有正式内容接口：

- 现有接口：`GET /api/v1/documents/:docId/content?mode=html|json|all`
- 该接口应继续保持“正式内容读取接口”的语义纯度。
- 其中 `html` / `all` 模式服务于渲染、展示、发布内容链路，不应引入草稿概念。
- 草稿内容只面向编辑器，因此只应提供 `json` 表达，不应支持 `html` 和 `all`。

## 4. 超大文档与分段加载要求

已确认新的编辑态内容读取能力不能退化，必须继承现有大文档能力：

- `maxDepth`
- `startBlockId`
- `limit`

虽然当前前端可能尚未完全用到这些参数，但它们是面向超大文档的必要能力，因此新的草稿读取方案必须完整支持，而不是做一个只能全量返回的小接口。

## 5. 方案对比

### 方案 A：在现有内容体系上打补丁

做法：

- 继续用当前 `documents / doc_revisions / doc_snapshots / block_versions`
- 新增 `document_drafts`，但只存少量元数据
- 草稿真实内容仍混在当前 block 最新状态里
- 新增编辑接口时临时拼装草稿视图

优点：

- 改动小
- 短期能跑

缺点：

- 正式内容和草稿内容仍然纠缠
- 取消草稿需要回滚 block 当前态，脆弱
- 未来加锁、冲突处理、恢复草稿都容易复杂化
- 大文档分页时很难保证草稿视图与正式视图一致可靠

结论：不推荐。

### 方案 B：独立 working copy 草稿模型

做法：

- 新增 `document_drafts`
- 一篇文档只有一条共享草稿
- 草稿保存完整的 draft `blockVersionMap`
- 正式内容接口 `/content` 完全不变
- 新增 `/edit-content`，专门给编辑器读取：
  - 只支持 `json`
  - 支持 `maxDepth / startBlockId / limit`
  - 自动优先 draft，没有 draft 再回退 head

优点：

- 内容边界清楚：`/content` 负责正式内容，`/edit-content` 负责编辑态内容
- 取消草稿干净：直接删 draft
- 保存版本清楚：把 draft 提交成新 revision / snapshot
- 最适合未来加悲观锁
- 超大文档分段加载可沿用现有能力

缺点：

- 改动比方案 A 大
- 需要把“编辑写入目标”从隐式 block 当前态改成明确写 draft working copy

结论：推荐，作为正式方案。

### 方案 C：草稿操作日志模型

做法：

- `document_drafts` 不存当前草稿快照
- 只存一串未提交操作
- 打开编辑器时用 head + 操作日志回放出草稿

优点：

- 理论上存储更轻
- 有利于审计

缺点：

- 回放复杂
- 大文档和长时间编辑容易积累脏状态
- 分页、续拉、取消草稿、恢复一致性都麻烦
- 维护成本高

结论：不建议。

## 6. 当前推荐方案

正式采用方案 B：`document_drafts` 独立 working copy + `edit-content` 编辑专用读取通道。

### 正式内容接口

保留：

`GET /api/v1/documents/:docId/content?mode=json|html|all`

职责：

- 读取正式内容
- 支持历史版本
- 服务渲染与展示
- 不参与草稿读取

### 编辑器内容接口

新增：

`GET /api/v1/documents/:docId/edit-content`

职责：

- 只返回 `json`
- 支持 `maxDepth / startBlockId / limit`
- 自动优先返回 draft
- 无 draft 时回退到 head
- 只服务编辑器，不服务渲染链路

> 说明：本文档已收敛为当前轮设计结论，后续若有修改将在此基础上增补。
> è¯´æï¼æ¬ææ¡£å·²æ¶æä¸ºå½åè½®è®¾è®¡ç»è®ºï¼åç»­è¥æä¿®æ¹å°å¨æ­¤åºç¡ä¸å¢è¡¥ã
> è¯´æï¼æ¬ææ¡£å·²æ¶æä¸ºå½åè½®è®¾è®¡ç»è®ºï¼åç»­è¥æä¿®æ¹å°å¨æ­¤åºç¡ä¸å¢è¡¥ã

## 7. 草稿内容存储策略（已确认）

已确认草稿内容不单独复制到新的块版本表中，而是继续复用现有 `block_versions`。

### 7.1 核心原则

- 块内容版本仍然统一存储在 `block_versions`
- `document_drafts` 本身不保存整份块内容，而是保存当前草稿视图对应的 `blockVersionMap`
- 编辑器读取草稿时，最终内容由 `document_drafts.blockVersionMap` 解释和构造出来

也就是说：

- `block_versions` = 原始块版本存储层
- `document_drafts.blockVersionMap` = 草稿视图层

正式版本和草稿版本都共享同一套底层块版本存储，只是“哪些块版本组成当前视图”由不同的 map 决定。

### 7.2 为什么这样更合理

该方案已被认为比额外新增 `draft_block_versions` 更合理，原因包括：

1. 现有块版本存储体系可以复用，不引入双轨块版本表。
2. 未来接入版本块 GC（垃圾回收）系统时，更适合在统一块版本池上做可达性分析。
3. 草稿和正式版本只是“引用关系”不同，而不是必须物理分库存储。
4. 创建、修改、移动、删除块时，不需要维护两套块版本写入链路。

### 7.3 对未来 GC 的直接影响

由于草稿也会引用 `block_versions`，因此未来块版本 GC 必须把 `document_drafts.blockVersionMap` 视作正式的可达性根（GC root）之一。

也就是说，GC 过程中至少要从以下对象集合做可达分析：

1. `doc_snapshots.blockVersionMap` 中被正式版本引用的块版本
2. `document_drafts.blockVersionMap` 中被当前草稿引用的块版本
3. 其他未来可能存在的保留根（如 pinned snapshot、保留窗口、审计保留策略等）

结论：

- 某个块版本即使尚未进入正式 revision，只要仍被 `document_drafts.blockVersionMap` 引用，就绝不能被 GC 回收。
- 只有当一个块版本既不被正式 snapshot 引用，也不被 draft 引用时，才有资格进入后续 GC 判定。

### 7.4 当前设计约束

因此本设计当前约束为：

- 不新增 `draft_block_versions` 表
- 继续复用 `block_versions`
- draft 通过 `blockVersionMap` 表达“当前草稿内容集合”
- 后续块版本 GC 设计必须显式纳入 `document_drafts` 引用关系

## 8. 编辑器内容读取接口设计（已确认）

新增编辑器专用接口：

`GET /api/v1/documents/:docId/edit-content`

### 8.1 设计目标

该接口只服务编辑器，不服务正式内容展示、公开渲染或版本对外读取。它的职责是：

1. 为编辑器返回当前应继续编辑的内容
2. 自动在 draft 与正式 head 之间做优先级判断
3. 保持与现有大文档分段加载协议一致
4. 只返回 `json` 语义，不支持 `html` / `all`

### 8.2 内容来源规则

接口内部按以下顺序决定内容来源：

1. 若 `document_drafts` 中存在该文档的草稿，则返回草稿内容
2. 若不存在草稿，则返回 `document.head` 对应的正式内容

因此编辑器无需先额外探测“是否存在草稿”再切换调用不同内容接口，而是统一通过 `edit-content` 获取当前编辑入口内容。

### 8.3 支持的查询参数

该接口应完整继承现有大文档分页 / 分段加载能力，支持：

- `maxDepth`
- `startBlockId`
- `limit`

含义应与现有 `/documents/:docId/content` 保持一致，以便前端和后端都复用既有的树裁剪与续拉逻辑。

### 8.4 明确不支持的参数

该接口不应支持以下能力：

- `mode=html`
- `mode=all`
- 历史正式版本读取参数 `version`

原因是：

- `edit-content` 只面向当前编辑入口
- 渲染与公开展示仍由正式内容接口负责
- 草稿读取不应混入正式内容渲染语义

### 8.5 推荐响应结构

建议响应结构包含以下信息：

- `docId`
- `source: "draft" | "head"`
- `head`
- `publishedHead`
- `draft` 元信息
- `lock` 元信息（即使当前未启用，也可返回空值结构）
- `tree`
- `pagination`

示意结构：

```json
{
  "docId": "doc_xxx",
  "source": "draft",
  "head": 12,
  "publishedHead": 10,
  "draft": {
    "exists": true,
    "draftId": "draft_xxx",
    "baseDocVer": 12,
    "updatedAt": "2026-05-26T10:00:00.000Z",
    "updatedBy": "user_xxx"
  },
  "lock": {
    "locked": false,
    "lockOwnerUserId": null,
    "lockExpiresAt": null
  },
  "tree": {},
  "pagination": {
    "totalBlocks": 1000,
    "returnedBlocks": 200,
    "hasMore": true,
    "nextStartBlockId": "b_xxx"
  }
}
```

### 8.6 与正式内容接口的职责分离

边界最终收敛为：

- `/documents/:docId/content`
  - 正式内容接口
  - 支持 `json | html | all`
  - 支持历史版本
  - 不读取 draft

- `/documents/:docId/edit-content`
  - 编辑器专用接口
  - 只返回 `json`
  - 自动优先 draft
  - 支持分段加载
  - 不承担渲染职责

## 9. 草稿操作接口与状态流转（已确认）

在 `edit-content` 之外，草稿至少需要两类核心操作接口：

1. 取消草稿
2. 将草稿保存为正式版本

### 9.1 取消草稿

接口建议：

`DELETE /api/v1/documents/:docId/draft`

#### 语义

- 放弃当前草稿 working copy
- 不创建新的正式版本
- 删除当前文档对应的 `document_drafts` 记录
- 删除后，编辑器再次读取 `edit-content` 时应自动回退到 `head`

#### 推荐返回

```json
{
  "docId": "doc_xxx",
  "discarded": true,
  "fallbackSource": "head"
}
```

#### 行为要求

- 若文档不存在：返回 404
- 若用户无编辑权限：返回 403
- 若草稿不存在：可有两种策略
  - 返回 404
  - 或返回幂等成功

当前更推荐返回幂等成功，以简化前端处理：

```json
{
  "docId": "doc_xxx",
  "discarded": true,
  "fallbackSource": "head"
}
```

即使草稿已不存在，也视为“当前状态已经达到目标状态”。

### 9.2 保存草稿为正式版本

接口建议：

`POST /api/v1/documents/:docId/commit`

#### 语义

- 将当前 `document_drafts` 表示的 working copy 提交为新的正式版本
- 创建新的 `doc_revision`
- 创建新的正式 `doc_snapshot`
- 更新 `documents.head`
- 删除当前 `document_drafts`

#### 请求体建议

```json
{
  "message": "手动保存"
}
```

#### 推荐返回

```json
{
  "docId": "doc_xxx",
  "version": 13,
  "committed": true,
  "draftRemoved": true
}
```

### 9.3 commit 的后端处理步骤

建议处理步骤如下：

1. 校验文档存在且用户有编辑权限
2. 读取当前 `document_drafts`
3. 若草稿不存在，返回 400（因为没有可提交的草稿）
4. 计算新版本号：`documents.head + 1`
5. 创建新的 `doc_revisions` 记录
6. 基于 `document_drafts.blockVersionMap` 创建新的正式 `doc_snapshots`
7. 更新 `documents.head`
8. 更新 `documents.updatedBy / updatedAt`
9. 删除 `document_drafts`
10. 返回新的版本号与成功结果

### 9.4 discard 的后端处理步骤

建议处理步骤如下：

1. 校验文档存在且用户有编辑权限
2. 删除该文档对应的 `document_drafts`
3. 不修改 `documents.head`
4. 不创建新的 `doc_revisions`
5. 返回成功结果

### 9.5 状态流转

#### 初始状态

- 无 draft
- 编辑器读取 `edit-content` 时返回 `source = head`

#### 用户开始编辑

- 首次草稿写入时，创建 `document_drafts`
- 后续未提交修改持续更新同一条 draft
- 编辑器读取 `edit-content` 时返回 `source = draft`

#### 用户点击“保存”

- draft 提交为新的正式版本
- `documents.head` 增加
- draft 删除
- 后续 `edit-content` 若无新的未提交修改，应回到 `source = head`

#### 用户点击“取消草稿”

- draft 删除
- 正式版本不变
- 后续 `edit-content` 回到 `source = head`

### 9.6 与现有“保存”按钮的语义调整

当前前端“保存”按钮的含义需要重新定义为：

- 不是“把最新修改写进后端”
- 而是“把当前 draft 提交为新的正式版本”

而普通编辑过程中的自动同步，应被定义为：

- 持续更新 draft
- 但不推进正式 `head`

## 10. 旧接口兼容与废弃策略（已确认方向）

引入 `document_drafts` 后，需要重新审视两个现有接口：

- `POST /api/v1/documents/:docId/commit`
- `GET /api/v1/documents/:docId/pending-versions`

### 10.1 关于 `POST /documents/:docId/commit`

该接口当前已经承载“手动保存/提交版本”的语义，因此在引入草稿模型后，更推荐：

- **保留现有接口路径不变**
- **将其语义重定义为：提交当前 draft 为新的正式版本**

也就是说，不一定需要再额外公开一个新的：
????????????? `/draft/commit` ????????????????????????????

虽然从命名上看新接口更直观，但公开两个语义几乎完全相同的提交接口，会造成：

1. 重复 API
2. 文档复杂度上升
3. 前后端迁移时需要额外判断该用哪个路径

因此更推荐：

- 外部公开接口继续使用 `POST /documents/:docId/commit`
- 内部实现改为“提交当前 draft”
- 如确有需要，可在服务内部抽象出 `commitDraft()` 之类的方法，但不一定要暴露第二个 public endpoint

#### 新语义下的行为

`POST /documents/:docId/commit`：

1. 若存在 draft：提交 draft，生成新的正式版本
2. 若不存在 draft：返回 400，提示当前没有可提交的草稿

这样可最大限度保持前端兼容，尤其当前前端保存按钮已经在调用该接口。

### 10.2 关于 `GET /documents/:docId/pending-versions`

该接口当前语义是：

- 查询文档当前有多少“待创建的版本”

但在引入独立 draft 模型后，这个概念会明显弱化，原因如下：

1. 新模型中不再以“累计了多少次待提交操作”来表达编辑状态
2. 用户真正关心的是“是否存在草稿”“草稿何时更新”“草稿是否被锁定”
3. `pendingCount` 在 draft 模型下不再是核心产品概念

因此推荐：

- **该接口进入废弃状态（deprecated）**
- 前端不再依赖它做主要交互判断
- 编辑器状态统一从 `edit-content` 返回的 `source / draft / lock` 信息中获取

### 10.3 兼容策略建议

考虑到可能存在旧客户端或过渡期调用，建议分阶段处理：

#### 阶段一：兼容保留

暂时保留 `GET /documents/:docId/pending-versions`，但仅作为兼容接口。

可选兼容返回策略：

```json
{
  "docId": "doc_xxx",
  "pendingCount": 1,
  "hasPending": true
}
```

映射规则：

- draft 存在 → `hasPending = true`
- draft 不存在 → `hasPending = false`
- `pendingCount` 仅作为兼容值，可固定为 `0/1`，而不再表达真实操作数量

注意：这只是兼容映射，不再代表原有精确语义。

#### 阶段二：前端切换完成后

当前端已完全切换到：

- `edit-content`
- draft 元信息
- 新的保存/取消草稿流程

则可将 `pending-versions`：

- 标记 deprecated
- 从文档中移除主推荐用法
- 视版本规划决定未来删除

### 10.4 最终建议

最终建议如下：2. **不强制新增公开的 `/documents/:docId/draft/commit`**

1. **保留 `POST /documents/:docId/commit`，并将其重定义为“提交当前 draft”**
2. **ä¸å¼ºå¶æ°å¢å
   ¬å¼ç `/documents/:docId/draft/commit`**
3. **`GET /documents/:docId/pending-versions` 进入废弃流程**
4. **编辑器以后不再依赖 `pending-versions`，而依赖 `edit-content` 返回的 draft 元信息**

## 11. 块编辑写入链路改造（已确认方向）

引入 `document_drafts` 后，块编辑写入链路需要从“隐式影响正式内容当前态”改造成“显式写入 draft working copy”。

### 11.1 总体原则

- `block_versions` 仍是统一块版本存储层
- `createVersion = false` 不再意味着“只是不推进 `documents.head`”
- 而应意味着：
  - 生成必要的 `block_versions`
  - 同时更新 `document_drafts.blockVersionMap`
  - 将本次变更纳入当前 draft 视图

换句话说：

- 正式提交（commit）负责推进 `head`
- 日常编辑同步负责推进 `draft`

### 11.2 首次编辑时如何创建 draft

当某篇文档当前不存在 `document_drafts`，但编辑器发生第一次未提交修改时，应自动创建 draft。

推荐流程：

1. 读取当前 `documents.head`
2. 找到该 `head` 对应的正式 snapshot
3. 复制其 `blockVersionMap` 作为 draft 初始 map
4. 创建 `document_drafts` 记录：
   - `docId`
   - `workspaceId`
   - `rootBlockId`
   - `baseDocVer = documents.head`
   - `baseSnapshotId = 当前 head 对应 snapshotId`
   - `blockVersionMap = 正式 snapshot 的 map`
   - `createdBy / updatedBy`
5. 再把本次编辑变更应用到该 draft map

这样可以保证：

- draft 总是从一个明确的正式版本起步
- 后续取消草稿时，天然回到 `head`
- 后续提交草稿时，也有明确的 base version 语义

### 11.3 update/create/move/delete 的统一处理思路

对于以下块级操作：

- create
- update content
- move
- delete
- batch

当它们处于“非立即创建正式版本”的模式时，应统一视为“编辑 draft”。

也就是说，这些操作的核心流程应变成：

1. 确保当前 draft 存在（若不存在则基于 head 初始化）
2. 按操作类型创建或更新必要的 `block_versions`
3. 修改 `document_drafts.blockVersionMap`
4. 更新 `document_drafts.updatedAt / updatedBy`
5. 必要时更新 `changedBlocksCount`

### 11.4 各类操作如何影响 draft map

#### update

- 为该 block 生成新的 `block_versions` 记录
- 将 draft map 中该 `blockId` 指向新的 `ver`

#### create

- 创建新的 block 与初始 `block_version`
- 将新 `blockId` 写入 draft map
- 父子关系、排序信息仍通过 block version 本身的 `parentId / sortKey / indent` 表达

#### move

- 为该 block 生成新的 `block_version`
- 新 version 中写入新的 `parentId / sortKey / indent`
- draft map 中该 `blockId` 指向新 version

#### delete

删除操作在当前设计中已确认采用“删除态 block version”方案：

- 为该 block 生成新的删除态 `block_version`
- draft map 中该 `blockId` 指向这个删除态 version
- 构树时过滤删除态 version 对应的 block

这保证未提交删除只影响 draft 视图，不直接污染正式内容当前态；当 draft 被 commit 时，删除态 version 再随新的正式 snapshot 一并固化。

#### batch

- batch 本质上是上述 create/update/move/delete 的组合
- 在 `createVersion = false` 下，整体事务应以“更新 draft”为目标
- 成功后只更新 draft，不推进正式 `head`

### 11.5 为什么不能继续沿用当前“仅记录 pending version 计数”模式

因为在新的 draft 模型下，系统关心的不再是：

- 发生了多少次待提交操作

而是：

- 当前 draft 的最终内容是什么
- 它相对正式 head 的可见结果是什么

因此：

- `pendingVersions` 的内存计数模式不再适合作为核心机制
- draft 必须成为真正的内容状态，而不是操作次数状态

### 11.6 当前阶段最重要的内部边界

本次设计当前已经收敛出一个关键内部边界：

- **编辑操作写入的是 draft 视图，不是正式版本链**
- **正式版本链只在 commit 时推进**

这是后续后端实现时最需要守住的边界。

## 12. draft 删除语义设计（已确认）

对于“块删除”在 draft 中如何表达，当前已确认采用如下方案：

- **删除也通过新的 block version 表达**
- `document_drafts` 仍主要维护一份 `blockVersionMap`
- 不额外引入单独的 `deletedBlockIds` 集合作为主表达方式

### 12.1 设计原则

目标是让 draft 视图尽量保持统一：

- create → 新建 block version 并写入 draft map
- update → 新建 block version 并写入 draft map
- move → 新建 block version 并写入 draft map
- delete → 也通过新建“删除态 block version”并写入 draft map

这样所有编辑行为都能统一收敛为：

1. 写入 `block_versions`
2. 更新 `document_drafts.blockVersionMap`

### 12.2 为什么不优先采用独立删除集合

未采用 `deletedBlockIds` 主模型的原因：

1. 会让 draft 视图变成“map + 额外删除状态”的双通道结构
2. 后续 diff、commit、GC、调试时都要额外理解第二套删除表达
3. 删除如果能版本化，则所有变更类型都统一走版本模型，更利于长期维护

### 12.3 删除态 version 的语义

这里的关键不是立即把正式块删除掉，而是：

- 为该 block 生成一个新的 block version
- 该 version 表示“在当前 draft 中，这个 block 已处于删除态”
- draft map 将该 `blockId` 指向这个删除态 version
- 构树时，遇到删除态 version 的 block，应在当前视图中排除

这意味着：

- 正式版本链尚未提交前，正式内容仍不受影响
- 取消草稿时，只需删除 `document_drafts`
- 提交草稿时，删除态 version 会随 draft map 一起进入正式 snapshot

### 12.4 对现有删除实现的影响

当前系统中删除较多依赖 `Block.isDeleted` 这类即时软删除语义。引入 draft 后，需要逐步把“未提交删除”从即时正式态修改中剥离出来。

更理想的目标语义是：

- **未 commit 的删除 = draft 视图删除**
- **commit 后的删除 = 正式版本删除**

因此后续实现时，需谨慎处理：

- 哪些场景仍保留 `Block.isDeleted`
- 哪些场景改为删除态 version
- 如何保证旧逻辑兼容迁移

### 12.5 对 GC 和可达性的影响

由于删除也会形成新的 block version，因此 GC 判定仍然统一：

- 只要某删除态 version 被 `document_drafts.blockVersionMap` 或正式 `doc_snapshots.blockVersionMap` 引用，它就仍然是可达版本，不能回收。

### 12.6 当前结论

当前正式结论为：

- draft 删除操作优先采用“删除态 block version”表达
- 不把 `deletedBlockIds` 作为主模型
- draft 仍然尽量维持“通过 blockVersionMap 解释最终内容”的统一设计

## 13. draft 变更摘要字段策略（已确认）

对于 `document_drafts` 是否需要额外保存变更摘要，当前已确认采用轻量策略：

- 不维护细粒度冗余集合，如：
  - `createdBlockIds`
  - `deletedBlockIds`
  - `updatedBlockIds`
- 仅保留必要的轻量聚合字段，例如：
  - `changedBlocksCount`

### 13.1 选择该策略的原因

1. `blockVersionMap` 仍应是 draft 最核心、最可信的单一真相源。
2. 若保存过多细粒度摘要集合，会增加一致性维护成本。
3. 当前阶段 UI 和调试层面对“草稿改动规模”的需求，用 `changedBlocksCount` 已基本足够。
4. 后续如果需要更精细的差异展示，可以在运行时基于 `baseDocVer/baseSnapshotId` 与当前 draft map 做 diff，而不必一开始就固化过多冗余字段。

### 13.2 当前结论

当前推荐：

- `document_drafts` 保留 `changedBlocksCount` 作为轻量统计字段
- 不引入更细粒度的 blockId 冗余集合
- 运行时需要更详细差异时，再从正式版本快照与 draft map 动态计算

## 14. draft 创建时机（已确认）

当前已确认 `document_drafts` 采用懒创建策略。

### 14.1 规则

- 仅打开文档时，不创建 draft
- 只有在第一次实际编辑发生时，才基于当前 `head` 初始化 draft

### 14.2 为什么采用懒创建

1. 避免仅浏览或短暂进入编辑器时产生无意义草稿。
2. draft 的存在本身就能明确表达“这篇文档存在未提交编辑”。
3. 对后续状态判断、锁机制、GC 可达性分析都更干净。
4. 能减少无效写入和多余记录。

### 14.3 与编辑器读取接口的关系

这意味着：

- `GET /documents/:docId/edit-content` 只是一个读取入口，不会隐式创建 draft。
- `source = head` 并不意味着系统异常，而只是说明当前尚无未提交草稿。
- 只有在真正发生 create/update/move/delete/batch 等编辑写入时，系统才会自动创建 `document_drafts`。

## 15. draft 提交后的生命周期（已确认）

当前已确认：当草稿成功提交为新的正式版本后，应立即删除 `document_drafts` 记录。

### 15.1 规则

当 `POST /documents/:docId/commit` 成功后：

1. 创建新的正式 `doc_revision`
2. 创建新的正式 `doc_snapshot`
3. 更新 `documents.head`
4. **立即删除当前 `document_drafts`**

### 15.2 为什么不保留 draft

不采用“commit 后保留一份等同于 head 的 draft”的原因：

1. 语义会变脏：既然已经提交成正式版本，就不应再保留“未提交草稿”记录。
2. 会导致 `edit-content` 的来源判断出现歧义。
3. 会让后续 UI 状态判断复杂化，例如“明明刚保存，为什么仍显示 draft 存在”。
4. 会给未来锁、GC、状态统计增加不必要负担。

### 15.3 提交后的编辑器状态

因此提交成功后：

- 若用户不继续编辑，则 `edit-content` 应回到 `source = head`
- 若用户随后继续修改，则再次触发 draft 懒创建

这使整个生命周期保持清晰：

- 未编辑：无 draft
- 编辑中：有 draft
- 已提交：draft 删除，回到正式态
