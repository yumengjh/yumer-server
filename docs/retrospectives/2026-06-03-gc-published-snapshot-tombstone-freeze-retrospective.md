# 2026-06-03 GC 发布快照冻结 tombstone compaction 复盘

## 背景

这次在 GC 调试页排查 tombstone sweep 时，出现了一个容易让人误解的现象：

- draft tombstone / revision tombstone sweep 看起来“还有很多候选没清掉”
- Candidate Pool 里大量候选被标成 `blocked`
- 阻断原因主要是：
  - `snapshot_non_revision_ref_present`
  - `snapshot_pinned_ref_present`

一开始很容易把问题理解成“limit 不够大”或“执行批次没放开”，但继续排查后发现，真正卡住的并不只是批次大小，而是 **发布/保护快照会把 tombstone 引用冻结住**。

## 本次确认的事实

### 1. `doc_revisions` 和 `doc_snapshots` 不是一回事

- `doc_revisions`：版本历史元信息（版本号、创建人、创建时间、message）
- `doc_snapshots`：该版本对应的精确 `{ blockId -> blockVersion }` 映射

系统当前要求：

> 每个正式文档版本都应该有一条对应的 `doc_snapshots(docId, docVer)`。

### 2. 普通保存和回退后生成的新版本，本质上都属于 `revision`

无论是：

- 用户正常点击保存
- 用户回退到旧版本后，系统再创建一个新的当前版本

最终都会创建：

- 一条新的 `doc_revisions`
- 一条对应的 `doc_snapshots`

并且这条 snapshot 默认是：

- `kind = revision`
- `pinned = false`

### 3. 发布或手动保留会把同版本 snapshot 升级成更强保护语义

当前 `doc_snapshots` 是 `docId + docVer` 唯一，不会为同一个版本无限新增多条不同 snapshot。

如果某个版本后续被：

- 发布
- 手动创建快照

那么系统会直接更新这条已有 snapshot 的语义，例如：

- `kind = publish`
- `kind = manual`
- `pinned = true`

也就是说：

> “保存出来的普通 revision snapshot” 可能在后续被升级成“发布/手动保护 snapshot”。

## 为什么会挡住 tombstone compaction

当前 revision tombstone sweep 的可执行边界被故意收得很保守：

> 只处理 `doc_snapshots(kind=revision, pinned=false)`。

对应到阻断原因：

### `snapshot_non_revision_ref_present`

表示这条 tombstone 还被某个 snapshot 引用着，但该 snapshot 的 `kind !== revision`。

常见含义：

- 它不是普通 revision snapshot
- 很可能已经是 `publish` 或 `manual`

### `snapshot_pinned_ref_present`

表示这条 tombstone 还被某个 `pinned = true` 的 snapshot 引用着。

常见含义：

- 这个版本已经被发布保护
- 或者被手动保留

## 这是不是“展示正确性”问题

从展示角度看，墓碑块理论上不应该在公开页面里正常显示出来，因此“发布快照里还挂着 tombstone version”并不一定会直接导致公开内容错误。

但当前 GC 并不是只按“最终渲染是否正确”来决定是否能动快照，而是优先遵守以下原则：

1. 发布/保护快照的语义不可变
2. GC 不修改受保护历史快照
3. 宁可少清，也不接受误伤历史版本、diff、revert 或公开发布读取

所以现在的实现实际上表达的是：

> 即使 tombstone 对公开渲染未必有害，只要它仍然被 publish / pinned snapshot 引用，GC 也一律不动。

## 当前设计缺陷

这次排查暴露出的缺陷不是“GC 判错了”，而是：

> 系统没有在“发布前”提供一条稳定、明确的 tombstone 清洁收口路径。

结果就是：

1. 用户先保存，生成普通 revision snapshot
2. 用户再发布，该 snapshot 被升级成 `publish/pinned`
3. 如果发布前没有先把可压缩 tombstone 引用清掉
4. 那这些 tombstone 会随着发布保护一起被冻结
5. 后续当前策略下就再也不能通过 revision tombstone sweep 清它们

换句话说：

> tombstone 是否“理论上可删”，和它是否“还允许删”，在当前实现里是两回事。

一旦发布保护上身，后者优先级更高。

## 当前可行的操作规程

在不改 GC 语义边界的前提下，当前最稳妥的流程应当是：

1. **先保存**
   - 生成新的 `doc_revision`
   - 生成对应 `kind=revision, pinned=false` 的 snapshot
2. **再做 GC tombstone compaction**
   - draft tombstone sweep
   - revision tombstone sweep
3. **确认没有需要清理但又会被发布冻结的 tombstone 引用**
4. **最后再发布**

一句话总结：

> **先保存，后 GC，最后发布。**

不是“发布后再慢慢清”，因为发布后这批 snapshot 很可能已经进入当前 GC 不可写的保护区。

## 这次顺手修掉的调试障碍

为了避免继续被“批次太小”误导，这次还补了两类改动：

### 后端

- sweep DTO `limit` 最大值从 `500` 提到 `10000`
- GC policy `maxSweepBatchSize` 从 `1000` 提到 `10000`

### 前端

- GC 调试页默认 sweep limit 从 `100` 提到 `10000`
- 服务层 sweep 默认传参从 `100` 提到 `10000`
- sweep 成功提示中明确提示：
  - 若有 `blockedCandidates`
  - 去 Candidate Pool 筛选 `blocked` 查看原因
- 面板直接展示 `Sweep 上限`

这些改动解决的是“看不清 / 批次太小”的问题，不改变 publish/pinned snapshot 的保护语义。

## 后续建议

### 方案 A：保持当前保守语义，只优化操作路径

可以考虑：

- 在发布前增加一次 tombstone 预检查
- 或提供“发布前清理 tombstone”引导

优点：

- 风险低
- 不改历史快照不可变语义

缺点：

- 依赖操作时机
- 已经发布过的脏 snapshot 仍然无法后补清理

### 方案 B：允许对 publish / pinned snapshot 做受限 tombstone compaction

这相当于放宽当前 GC 边界，只删除那些“对版本重建和公开渲染都确定无害”的 tombstone map entry。

优点：

- 能清掉已经冻结的历史垃圾引用

缺点：

- 语义风险明显更高
- 需要重新定义“发布快照不可变”与“GC 可安全重写快照”之间的边界
- 必须补更严格的回归测试（history / diff / revert / public read / publish）

### 方案 C：引入更明确的发布前收口流程

例如：

- 保存后自动检测可压缩 tombstone
- 发布前阻断或警告
- 先跑 compaction 再允许发布

这会把“操作纪律”逐步升级成“系统流程保证”。

## 结论

这次问题的核心不是 tombstone sweep 本身，而是：

> 当前系统允许“带 tombstone 引用的普通 revision snapshot”被直接升级成“受保护的 publish/pinned snapshot”。

一旦升级完成，当前 GC 策略就不会再碰这批快照，哪怕这些 tombstone 从展示上看未必有害。

因此，在现阶段不调整 GC 安全边界的前提下，推荐操作规程就是：

> **先保存，后 GC，最后发布。**
