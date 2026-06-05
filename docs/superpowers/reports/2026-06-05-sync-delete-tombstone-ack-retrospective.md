# delete tombstone ACK 队列残留修复复盘

## 背景

本轮修复承接内容同步稳定性改造。后端已经具备 batch receipt、sync session、ackedThroughOpSeq 和 `sync_create_tombstones`，可以在 “delete 先到、create 后到” 的弱网场景下保存删除意图并抑制 late create。

但前端仍可能在 delete tombstone ACK 后保留 dirty entry，表现为重复发送同一 delete、保存状态无法稳定回到已同步。

## 触发路径

1. 前端发送 create，服务端可能已经收到，但前端还没有拿到 server `blockId`。
2. 用户立刻删除该块。
3. 前端发送 delete，只有 `clientId/syncCreateId`，没有 `blockId`。
4. 后端找不到活动块，写入 `sync_create_tombstones`。
5. 后端返回成功结果，包含 `matchBy=not_found`、`diagnosticCode=DELETE_TARGET_NOT_FOUND_BY_CLIENT_IDENTITY`、`tombstoned=true`。

旧响应没有稳定回显 `clientId`，而返回的 `blockId` 是诊断值，不是一个真实 server blockId。

## 根因

后端语义是正确的：删除意图已经被持久化，后续 late create 会被 tombstone 抑制。

不稳定来自 ACK 可关联性不足：

- 前端需要知道这个 delete tombstone 结果对应哪个本地队列 entry；
- 仅靠诊断型 `blockId` 不足以做稳定关联；
- 服务端响应 DTO 文档也仍把 `clientId` 描述成 create 回填字段，容易让 delete ack 漏掉身份回显。

## 修复

后端做了协议增强：

- batch delete 成功结果回显 `operation.clientId`；
- batch delete 失败结果也尽量回显 `operation.clientId`；
- `SyncOperationResultDto.clientId` 描述更新为 create/delete ack 回填；
- idempotency 测试补充断言 tombstone delete ACK 带回 `clientId`。

前端也做了兼容：

- 对旧后端或诊断型响应，若 inflight entry 是 delete，结果也是 delete，并且 `tombstoned=true` 或 `matchBy=not_found`，则允许按批次位置清除 entry。

## 验证

后端已执行：

```bash
pnpm jest src/modules/blocks/blocks-sync-idempotency.spec.ts --runInBand
```

前端已执行：

```bash
pnpm vitest run src/services/sync/__tests__/reducer.test.ts src/services/sync/__tests__/api.test.ts src/services/sync/__tests__/snapshot.test.ts src/services/sync/__tests__/engine-order.test.ts
```

## 结论

这次问题说明 tombstone 机制不能只保证服务端最终态，还必须保证 ACK 能让客户端状态机收敛。后续所有 batch result 都应满足：

- 能表达服务端是否接受该操作；
- 能说明命中方式和诊断码；
- 能稳定映射回客户端 entry。

如果继续推进同步协议，建议增加显式 `clientOpId`，让每个 batch result 不再依赖下标或操作类型推断。
