# 多端实时增量同步后端复盘

日期：2026-06-11
范围：`E:\workspace\yumer-server`

## 背景

现有同步链路已经通过 `/blocks/batch`、`baseVersion`、`draftRevision`、`clientBatchId` 和 sync session 保护客户端到服务端的增量写入。本次后端改动没有改变写入入口，而是在 batch 成功提交后发布文档级 SSE 事件，让其他在线端可以低延迟接收服务端确认后的 canonical operations。

## 本次改动

1. 新增 `RealtimeModule`、`RealtimeController` 和 `DocumentRealtimeService`。
2. 新增 `GET /realtime/documents/:docId/events`，订阅前复用 JWT 鉴权和 `DocumentsService.assertAccessWithoutViewIncrement`。
3. `BatchBlockDto` 增加 `originClientId` / `originTabId`，仅用于事件去重和调试，不参与权限判断。
4. `BlocksService.batch()` 在事务提交后构造 `document_remote_ops`：
   - create 广播服务端最终 `blockId` / `sortKey`；
   - update 广播已接受 payload；
   - delete 必须解析出明确 `blockId`；
   - move 广播最终 `sortKey`。
5. batch partial failure 且已有草稿 mutation 时广播 `document_reload_required`，避免其他端静默错过状态变化。
6. 全局 `TransformInterceptor` 对 `text/event-stream` 放行，避免 SSE 数据被 JSON 包装。
7. `DocumentRealtimeService` 增加模块销毁清理，防止 heartbeat timer 泄漏。

## 关键约束

- SSE 只广播事务提交后的事件，不在事务内提前推送。
- 幂等重放 batch 不再次广播，避免其他端重复 apply。
- 无法安全重放的操作不伪造成增量事件，改用 reload required。
- `originClientId` / `originTabId` 不是安全凭据，后端不能据此做鉴权。

## 已验证

- `pnpm.cmd exec jest modules/realtime/document-realtime.service.spec.ts --runInBand`
- 本次后端改动文件的 `tsc --noEmit` 筛查无匹配错误。
- 手测：用户反馈多端同步功能正常。

## 已知边界

- 全量后端 `tsc --noEmit` 仍受既有 spec 类型债影响。
- 当前没有持久化 realtime event log，不支持 `Last-Event-ID` 补发；客户端通过 `draftRevision` 连续性判断 fallback reload。
- 目前只在 `/blocks/batch` 成功后发布实时事件；后台管理、GC 或其他直接改 draft 的路径如果未来需要实时通知，应复用 `document_reload_required`。

## 后续建议

1. 给 `BlocksService.batch()` 增加广播层测试，覆盖 create/update/delete/move、partial failure、replayed batch。
2. 后续如需要事件补发，可在 `DocumentRealtimeService` 增加 per-doc ring buffer。
3. 将 realtime 连接数限制和指标接入 runtime config 或 admin diagnostics。
