# 2026-06-05 内容同步最终态 manifest 收敛复盘

## 背景

全选删除场景中，前端曾出现空闲后继续重复发送同一组删除请求的问题。前一轮修复已经解决了 delete ack 被当作 create ack、导致 orphan create delete 循环的问题，但后端仍缺少“前端队列清空后，按最终可见内容再对齐 draft”的兜底。

本次按 2026-06-04 内容同步稳定性设计继续推进最终态收敛：前端在 autosync 队列为空时上报当前编辑器可见块身份 manifest；后端在同一 sync session 和 draftRevision 下检查 draft 中带同步身份、但已经不在前端最终 manifest 里的块，并追加 deleted 版本。

## 变更

- 新增 `SyncReconcileDto` 和 `POST /documents/:docId/sync-reconcile`。
- `DocumentsService.reconcileSyncManifest` 复用文档访问、编辑权限、sync session 校验和 draft 锁。
- draftRevision 不匹配时返回 `needsReload: true` 和 `DRAFT_REVISION_MISMATCH`，不写入任何数据。
- 对缺失 manifest 的同步身份块追加 `attrs.deleted = true` 的新 `BlockVersion`，更新 `Block.latestVer`，再把 `DocDraft.blockVersionMap` 指向删除版本。
- 同步写入 `sync_create_tombstones`，防止旧 create 请求在 reconcile 后再次回流。

## 稳定性边界

- 该兜底只处理带 `clientId` 或 `syncCreateId` 的 draft 块，避免局部加载 manifest 误删历史块。
- 每次 reconcile 在文档 draft 锁内执行，且只在前端传入的 draftRevision 与服务端一致时写入。
- tombstone 是追加版本，不物理删除块；历史版本仍可追溯。

## 验证

- `pnpm jest modules/documents/documents.service.spec.ts --runInBand`
- `pnpm build`

## 后续

- 增加 reconcile 日志或指标：manifest node count、candidate count、tombstoned count、draftRevision。
- 若未来要覆盖没有同步身份的历史块删除，必须先让前端 manifest 携带 coverage/full-load 标记，并补端到端测试证明不是分页/局部视图。
