# 弱网大文档同步残留问题复盘（未解决）

日期：2026-06-05

## 结论

本轮同步链路重构和两次补丁仍未解决一个核心线上场景：在弱网（例如 Slow 3G）和大文档场景下，一次性粘贴大量块后，趁同步尚未完成马上全删并输入新内容，等待同步完成后刷新，仍可能看到部分第一次粘贴的旧内容残留在新内容附近或下方。

因此当前同步链路不能被认为已经达到稳定 MVP。已完成的 session、ACK、幂等、tombstone delete 等改动提高了部分路径的确定性，但没有覆盖真实编辑器、网络队列、批次提交和服务端草稿落库之间的全部竞态。

## 用户复现路径

1. 打开编辑器并进入某篇文档。
2. 将网络切换到弱网，例如 Slow 3G。
3. 一次性粘贴大量内容，生成大量块级 create 操作。
4. 在同步尚未完成时，马上全选删除这些内容。
5. 立即输入新的内容。
6. 等待页面显示同步完成。
7. 刷新页面。
8. 结果：新内容存在，但仍有部分第一次粘贴的旧内容残留。

用户连续复测后确认：问题仍存在，并且表现为“貌似某一部分残留下来了”。

## 已经做过但未完全解决的修复

### 第一轮：同步协议硬化

后端已增加：

- `sync_batch_receipts` 批次幂等回执。
- `document_sync_sessions` 活跃会话租约。
- `ackedThroughOpSeq` ACK 游标。
- commit 不允许越过服务端确认游标。
- batch DTO 强制 `baseVersion` 和 `clientBatchId`。
- create 幂等按 `syncCreateId/clientId` 定向查询。

前端已增加：

- sync session 接入。
- batch 请求携带 `sessionId/sessionEpoch/ackedThroughOpSeq`。
- flush + commit barrier。
- 空 ACK 保护。
- delete/update/move 合并保护。
- ACK 回填嵌套节点。

这些改动解决了一批“乱序提交、空 ACK、旧 session、commit 越界”的问题，但没有消除弱网大文档粘贴后立即删除的残留。

### 第二轮：取消未发送 / inflight create

前端增加了：

- 未发送 create 被删除时直接取消。
- inflight create 被删除时，在 create ACK 回来后转成 follow-up delete。
- `sync-session/renew` 只发送 `sessionId/sessionEpoch`，修复 `leaseExpiresAt/lastAckedOpSeq should not exist`。

这覆盖了“前端仍然持有 create entry，且能收到 create ACK”的路径，但用户复测仍失败。

### 第三轮：client identity tombstone delete

前端增加：

- 没有 `blockId` 的 delete 也发送 `clientId/syncCreateId` tombstone。
- inflight create 转 delete 时保留 `syncCreateId`。

后端增加：

- delete 操作支持通过 `syncCreateId` 或 `clientId` 定位刚创建的块。
- 新增后端回归测试：create 后在没有 blockId 的情况下按 client identity 删除。

这覆盖了“服务端已创建旧块，但前端没有可靠 blockId”的一个兜底路径，但用户复测后仍失败，说明还有未覆盖的路径。

## 当前最可能的未覆盖根因

以下是基于代码和现象的推断，尚未被真实弱网录制数据证明。

### 1. 编辑器快照不一定捕获了最终全量删除

当前前端依赖 `content` state 变化触发 `advanceSyncSnapshot(previousSnapshot, currentContent)`。在大文档 + Slow 3G + 快速全删重输场景下，可能出现：

- 编辑器内部已经发生多次 transaction；
- React state / effect 只捕获到部分中间态；
- `snapshotRef.current` 被 ACK patch 或后续 capture 覆盖；
- 最终 delete diff 没有覆盖所有旧 pasted clientId。

这可以解释“不是全部残留，而是某一部分残留”。

### 2. 批次选择和 dirtyOrder 可能导致旧 create 继续分批发送

`selectSyncBatchOperations` 每次最多选 100 条。大量粘贴会拆成多批。在删除和新输入穿插期间，可能出现：

- 第 1 批 create 已发；
- 第 2/N 批 create 还在 dirty queue；
- 删除 diff 只取消了 snapshot 中能匹配到的部分 clientId；
- 剩余 dirty create 继续 flush 到后端。

如果 dirty queue 中残留的是尚未被 delete tombstone 覆盖的 create，就会刷新后出现部分旧内容。

### 3. ACK patch 后的 snapshot 重建可能把已删除旧块重新带入 diff 基线

收到 create ACK 后，前端会调用 `applyServerAck` 和 `onContentPatched`。如果 ACK 对应的节点已经被用户删除，但 snapshot 或 editor patch 路径仍保留了部分旧节点身份，则后续 diff 可能把这些旧节点当作仍存在或新建。

这类问题需要记录每次 ACK 前后的：

- editor JSON；
- `snapshotRef.current`；
- `state.entries`；
- `dirtyOrder`；
- ACK mappings；
- orphaned create deletes。

### 4. 只记录顶层节点可能漏掉复杂粘贴结构

当前 sync engine 主要围绕 top-level block diff。大量粘贴可能包含 list、table、nested listItem/taskItem 等结构。若某些节点身份在 normalize/patch 中被重写，可能导致：

- delete diff 匹配不到原 clientId；
- create tombstone 缺少 syncCreateId；
- 后端无法按 client identity 删除已创建块。

### 5. UI 显示“同步完成”不等于队列真正收敛

当前保存状态主要来自 reducer 状态。如果存在以下情况，UI 可能误判：

- 一些旧 create 被从前端状态错误清掉，但后端已持久化；
- delete tombstone 被认为 idempotent success，但实际上没有命中已创建块；
- 后端 batch 部分失败后前端状态没有强制 reload；
- 前端本地 snapshot 与服务端 draft 内容已经分叉。

## 为什么前两次修复没有成功

主要问题是修复基于局部 reducer/API 假设，而不是基于完整弱网录制数据。

已补的测试覆盖了人工构造的状态机路径：

- create 后 delete；
- inflight create 后 delete；
- 无 blockId delete tombstone；
- 后端按 client identity 删除。

但真实场景包含更多变量：

- 大批量、多批次、限流；
- React state/effect 延迟；
- Tiptap transaction 合并；
- ACK patch 与用户删除并发；
- 服务端 draftRevision 推进；
- 刷新后从服务端 draft 重建内容。

缺少对这些边界的端到端日志和可重复测试，是本轮失败的根本原因。

## 下一步建议

### P0：先加同步黑匣子诊断，而不是继续猜补丁

需要在前端为每个文档会话记录一个 bounded debug trace：

- `sessionId/sessionEpoch`
- 每次 editor update 的 content hash、top-level clientId/blockId 列表、节点数量
- 每次 `advanceSyncSnapshot` 生成的 entries
- 每次 flush selected operations
- 每次 response results / ACK mappings
- 每次 orphaned create delete / tombstone delete
- 每次进入 idle 时的 entries、dirtyOrder、snapshot 节点列表

后端记录：

- batchId、operation index、operation type
- create 的 `clientId/syncCreateId/blockId/sortKey`
- delete 的 `blockId/clientId/syncCreateId` 以及实际命中方式
- draftRevision 前后值
- delete 未命中时不要静默，仅返回明确诊断码

目标：复现一次后能回答“残留旧块的 clientId/syncCreateId 是哪一批 create 创建的，以及为什么没有对应 delete”。

### P1：增加真实弱网端到端测试

应使用 Playwright 或浏览器自动化模拟：

1. throttle 网络；
2. 粘贴 300+ blocks；
3. 不等同步完成，立即全删；
4. 输入 final marker；
5. 等待同步 idle；
6. 刷新；
7. 断言页面只包含 final marker，不包含 paste marker。

这个测试应当成为后续任何同步改动的准入测试。

### P2：考虑快照型最终态同步作为兜底

仅靠 op-log 在弱网大文档快速替换场景下复杂度很高。可以考虑引入最终态校验：

- 每次进入 idle 时，前端发送当前 top-level block identity manifest。
- 后端比较草稿 manifest。
- 若服务端存在前端 manifest 中不存在、且属于当前 session 创建的块，服务端自动 tombstone。

这相当于给 op-log 增加“最终态收敛兜底”，比继续只修单个竞态更稳。

### P3：更激进方案

对单会话编辑，可以将大文档弱网同步改为“操作批次 + 最终快照提交”双轨：

- 平时仍走增量 op-log。
- 当检测到大量 create 后短时间内大量 delete，进入 replace-wave 模式。
- replace-wave 模式以最终 editor JSON 为准，后端按 manifest 收敛草稿。

这为未来多人协作保留空间：单人编辑走最终态收敛，多人协作时再切换 CRDT/OT 或基于版本向量的冲突合并。

## 当前提交状态

截至本复盘文档创建时：

后端最近同步相关提交：

- `de1a20b fix(sync): support tombstone deletes by client identity`
- `423dba5 feat(sync): harden document sync protocol`

前端最近同步相关提交：

- `12660f2d fix(sync): send delete tombstones for pending creates`
- `607113f5 fix(sync): cancel deleted unsynced creates`
- `dd3395f0 feat(sync): stabilize editor sync sessions`

这些提交不应被视为最终修复，只能视为部分防护和诊断前置。

## 明确风险

当前版本在弱网 + 大文档 + 快速替换输入场景下仍可能产生服务端草稿残留旧块。上线或继续测试时，应避免把“同步完成”作为数据强一致保证。下一步必须先补充可导出的 trace 和端到端复现测试，再继续做架构修复。
