# 高频编辑导致块版本冲突的完整问题与优化方案

## 问题背景

在前端编辑器中高频输入、回删、重新输入时，`PATCH /api/v1/blocks/:blockId/content` 会被短时间连续触发，存在并发写入同一 `blockId` 的情况。
该问题在测试阶段已经出现，属于高频编辑场景下的后端并发一致性问题。

## 复现请求

```javascript
fetch("http://localhost:5200/api/v1/blocks/b_1770797336694_9d03a42d/content", {
  headers: {
    accept: "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,zh-HK;q=0.7",
    authorization: "Bearer <token>",
    "cache-control": "no-cache",
    "content-type": "application/json",
    pragma: "no-cache",
    "sec-ch-ua":
      '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    Referer: "http://localhost:5173/",
  },
  body: '{"payload":{"text":"继续测试一下，感觉还行，复制大量的内容shiyix"},"plainText":"继续测试一下，感觉还行，复制大量的内容shiyix","createVersion":false}',
  method: "PATCH",
});
```

## 原始记录完整示例（来自 FIX_ERROR.md）

```javascript
fetch("http://localhost:5200/api/v1/blocks/b_1770797336694_9d03a42d/content", {
  headers: {
    accept: "application/json, text/plain, */*",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,zh-HK;q=0.7",
    authorization:
      "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1XzE3Njg3MjA5NDM1NjdfYjc0OTJmZGYiLCJpYXQiOjE3NzA3NzI5OTQsImV4cCI6MTc3MDg1OTM5NH0.42F9DjcVQQG8o95zwkiLYM841DGkBJD2Y81qAoU4mqM",
    "cache-control": "no-cache",
    "content-type": "application/json",
    pragma: "no-cache",
    "sec-ch-ua":
      '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    Referer: "http://localhost:5173/",
  },
  body: '{"payload":{"text":"继续测试一下，感觉还行，复制大量的内容shiyix"},"plainText":"继续测试一下，感觉还行，复制大量的内容shiyix","createVersion":false}',
  method: "PATCH",
});
```

```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Internal server error",
    "stack": "QueryFailedError: duplicate key value violates unique constraint \"UQ_519cf9571ca939a56b8d74a60ea\"\n    at PostgresQueryRunner.query (F:\\doc-back\\app\\node_modules\\.pnpm\\typeorm@0.3.28_pg@8.17.1_ts_1cb54d7704b7955a9825a90cfdec47c1\\node_modules\\typeorm\\driver\\src\\driver\\postgres\\PostgresQueryRunner.ts:325:19)\n    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)\n    at async InsertQueryBuilder.execute (F:\\doc-back\\app\\node_modules\\.pnpm\\typeorm@0.3.28_pg@8.17.1_ts_1cb54d7704b7955a9825a90cfdec47c1\\node_modules\\typeorm\\query-builder\\src\\query-builder\\InsertQueryBuilder.ts:164:33)\n    at async SubjectExecutor.executeInsertOperations (F:\\doc-back\\app\\node_modules\\.pnpm\\typeorm@0.3.28_pg@8.17.1_ts_1cb54d7704b7955a9825a90cfdec47c1\\node_modules\\typeorm\\persistence\\src\\persistence\\SubjectExecutor.ts:435:42)\n    at async SubjectExecutor.execute (F:\\doc-back\\app\\node_modules\\.pnpm\\typeorm@0.3.28_pg@8.17.1_ts_1cb54d7704b7955a9825a90cfdec47c1\\node_modules\\typeorm\\persistence\\src\\persistence\\SubjectExecutor.ts:137:9)\n    at async EntityPersistExecutor.execute (F:\\doc-back\\app\\node_modules\\.pnpm\\typeorm@0.3.28_pg@8.17.1_ts_1cb54d7704b7955a9825a90cfdec47c1\\node_modules\\typeorm\\persistence\\src\\persistence\\EntityPersistExecutor.ts:182:21)\n    at async <anonymous> (F:\\doc-back\\app\\src\\modules\\blocks\\blocks.service.ts:232:7)\n    at async EntityManager.transaction (F:\\doc-back\\app\\node_modules\\.pnpm\\typeorm@0.3.28_pg@8.17.1_ts_1cb54d7704b7955a9825a90cfdec47c1\\node_modules\\typeorm\\entity-manager\\src\\entity-manager\\EntityManager.ts:156:28)\n    at async BlocksService.updateContent (F:\\doc-back\\app\\src\\modules\\blocks\\blocks.service.ts:180:20)"
  }
}
```

## 历史报错现象

- 错误类型：`QueryFailedError`
- 数据库错误码：`23505`（唯一约束冲突）
- 典型报错：`duplicate key value violates unique constraint "UQ_519cf9571ca939a56b8d74a60ea"`
- 调用栈落点：`src/modules/blocks/blocks.service.ts` 的 `updateContent` 事务中

## 典型错误响应（修复前）

```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Internal server error",
    "stack": "QueryFailedError: duplicate key value violates unique constraint \"UQ_519cf9571ca939a56b8d74a60ea\" ..."
  }
}
```

## 根因分析

- 同一 `blockId` 并发写入时，多个请求可能基于同一个 `latestVer` 同时计算 `newVer = latestVer + 1`，导致版本号或版本ID冲突。
- `updateContent` 代码中存在重复保存同一 `BlockVersion` 的行为，会放大冲突风险。
- 高频编辑（快速输入+删除+重输）会显著提高并发概率。

## 已完成的全局错误语义修正

全局过滤器已识别 `QueryFailedError` 并对 `23505` 做映射：

- HTTP 状态码：`409 Conflict`
- 业务错误码：`DUPLICATE_KEY`
- 错误信息：明确提示唯一约束冲突，并带约束名
- 可选细节：`dbCode`、`constraint`
  这让前端可以识别为冲突类错误，而不是系统不可恢复错误。

## 后端优化方案

- 修复 `updateContent` 中重复 `save(BlockVersion)` 的问题，避免同事务重复插入。
- 在事务内对目标 `block` 使用行级写锁（`FOR UPDATE`），串行化同一块的写入流程。
- 锁内重新读取最新版本并计算新版本号，避免并发竞争同一 `newVer`。
- 保留并强化内容哈希去重，内容未变化时直接返回当前版本，减少无效版本写入。
- 增加短重试机制（仅针对冲突类可重试错误，如 `23505`），采用小退避重试提升成功率。
- 增加结构化日志字段（`blockId`、重试次数、dbCode、constraint），方便追踪热点冲突。

## 验收与测试建议

- 并发 2~5 个更新请求同一 `blockId`，确认版本链不冲突且成功率可接受。
- 同内容重复提交，确认不会生成重复版本。
- 高频编辑场景下观察 409 比例是否显著下降。
- 验证 `createVersion=false` 流程不被破坏。

## 乐观锁与事务锁两种方案

- **乐观锁方案**
  - 前端请求携带期望版本（如 `expectedVer`），后端更新时校验当前版本是否一致。
  - 不一致直接返回 `409`，由前端处理冲突和重提。
  - 优点：吞吐高、数据库锁开销低。
  - 缺点：前端复杂度上升，冲突处理逻辑需前端承担。
- **事务锁方案（当前建议）**
  - 后端在事务中对 block 行加写锁，强制同一块写入串行执行。
  - 优点：后端即可兜底，前端改动小，适合快速稳定线上编辑体验。
  - 缺点：热点块会排队，极端并发下吞吐下降。

## 总结

该问题本质是高频编辑触发的并发写入冲突，不是单纯前端“请求太快”导致的无效错误。正确做法是后端增强并发控制与冲突语义，先用事务锁+重试稳住一致性，再视流量与体验需求评估是否升级为乐观锁协同方案。
