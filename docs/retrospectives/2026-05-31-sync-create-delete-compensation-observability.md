# 2026-05-31 同步 create-delete 补偿观测增强复盘

## 背景

前端同步链路曾出现一种同步语义层的多余块：

1. 前端发出 create；
2. create 请求仍在 inflight 时，用户继续编辑或删除，使对应 `clientId` 从当前本地快照消失；
3. 服务端按协议成功创建块并返回 create ack；
4. 前端收到 ack 后确认该块已不属于当前本地语义，因此补发 delete；
5. 服务端随后删除刚创建的块。

这类块和数据库引用层孤儿块不同。它们在短时间内是合法创建、合法挂载、再合法删除的同步补偿行为，不应由后端 GC 推断并主动清理。

## 本次后端处理

本次后端只做可观测性增强，不改变同步协议语义，也不改变 GC 策略。

实现要点：

- 保持 batch response 的 ack 字段稳定，不向前端返回内部观测字段；
- 在 batch delete 中读取被删块的最新版本 payload attrs；
- 当被删块满足以下条件时记录统计日志：
  - 块创建时间距离删除时间在 60 秒窗口内；
  - 最新版本 attrs 中存在 `clientBatchId`、`clientId` 或 `syncCreateId`；
  - 删除来自当前 batch；
- 日志记录 `docId`、delete batch、命中数量、窗口大小，以及最多 5 个示例；
- 同时覆盖 `createVersion=true` 的软删除路径和 `createVersion=false` 的草稿删除版本路径。

## 为什么不做自动清理

后端不能可靠知道前端当前编辑器 snapshot 中是否仍需要某个块。

如果 GC 或 create ack 阶段主动删除“服务端可达但前端本地没有”的块，会把用户编辑语义解释权从同步层转移到后端清理层，容易误删仍然有效的并发编辑结果。

因此职责边界保持为：

- 前端同步层负责表达当前用户语义，包括 create ack 后发现本地已删除时补发 delete；
- 后端 batch API 负责幂等执行 create/update/delete/move，并稳定返回 ack；
- 后端 GC 负责数据引用层异常清理，不解释用户编辑语义；
- 后端观测日志负责暴露 create-delete 抖动，辅助后续调参和排查。

## 影响范围

对外 API 行为不变：

- `SyncBatchResponseDto.results` 仍只返回原有 ack 字段；
- delete ack 不包含 `createDeleteCompensation`；
- create ack 中 `clientId`、`blockId`、`sortKey`、`operation`、`success` 保持稳定；
- GC 候选和清理策略未调整。

内部行为新增：

- `BlocksService` 会在短时间同步 create-delete 补偿发生时打印 warn 日志；
- 日志可用于和前端 `sync.log` 按 `docId`、`clientBatchId`、`clientId`、`syncCreateId` 对齐排查。

## 验证

本次验证包括：

- 新增单测覆盖 create 后短时间 delete 时会记录补偿日志；
- 单测确认 delete ack shape 没有被内部观测字段污染；
- 同步幂等相关测试通过；
- 后端构建通过。

执行命令：

```bash
pnpm test -- blocks-sync-idempotency.spec.ts --runInBand
pnpm run build
```

## 后续建议

如果后续需要更强的排查能力，可以在不改变同步语义的前提下继续增强：

- 将 warn 日志沉淀为结构化指标；
- 按 `docId`、`clientBatchId`、`syncCreateId` 提供调试查询；
- 在 GC 报告中继续区分引用层异常和同步补偿现象；
- 结合前端补偿 delete 数量评估 debounce 和 batch 合并策略。

## 结论

这次后端增强遵循“观测优先，不越权清理”的原则。同步语义层的多余块仍由前端补偿 delete 表达，后端负责可靠执行并暴露短时间 create-delete 抖动，便于后续定位和优化。
