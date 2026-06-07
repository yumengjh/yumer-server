# 2026-06-07 弃稿接口 sync session 兼容字段修复复盘

## 1. 问题现象

调用弃稿接口时，服务端返回：

```json
{
  "message": [
    "property leaseExpiresAt should not exist",
    "property lastAckedOpSeq should not exist"
  ]
}
```

这会让前端在携带完整 `syncSession` 对象回传时，无法完成弃稿。

## 2. 根因

`DELETE /documents/:docId/draft` 和 `POST /documents/:docId/sync-session/renew` 共用 `DiscardDraftDto`。

该 DTO 之前只声明了：

- `sessionId`
- `sessionEpoch`

但前端回传的是完整同步会话镜像，额外包含：

- `leaseExpiresAt`
- `lastAckedOpSeq`

在全局 `whitelist: true` 且 `forbidNonWhitelisted: true` 的校验配置下，请求会在进入 service 之前被 DTO 白名单拒绝。

## 3. 修复

本次修复没有改动弃稿和续租的业务判定逻辑，只补齐 DTO 的兼容输入面：

- 在 `DiscardDraftDto` 中增加 `leaseExpiresAt?: string | null`
- 在 `DiscardDraftDto` 中增加 `lastAckedOpSeq?: number | null`

这两个字段仅用于通过白名单校验，服务端实际仍只依赖：

- `sessionId`
- `sessionEpoch`

## 4. 验证

新增 DTO 校验测试，覆盖：

1. 带 `leaseExpiresAt` 和 `lastAckedOpSeq` 的请求体可通过白名单校验
2. `lastAckedOpSeq: null` 也可通过白名单校验

并回归执行：

```bash
pnpm exec jest src/modules/documents/dto/discard-draft.dto.spec.ts --runInBand
pnpm exec jest src/modules/documents/documents.controller.spec.ts src/modules/documents/documents.service.spec.ts --runInBand
```

结果：全部通过。

## 5. 后续约束

这类接口如果复用 session DTO，需要明确两件事：

1. 服务端实际用于鉴权/会话校验的字段
2. 前端可能原样回传的镜像字段

否则只要前端复用完整会话对象，就会再次触发 DTO 白名单拒绝，而业务逻辑本身其实并没有问题。
