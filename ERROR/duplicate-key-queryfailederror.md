# QueryFailedError（23505 唯一约束冲突）说明

## 1. 背景

在测试 `PATCH /api/v1/blocks/:blockId/content` 时，出现：

- `QueryFailedError: duplicate key value violates unique constraint ...`
- 过去被全局过滤器包装为 `INTERNAL_ERROR`（500）

这类错误本质是**数据库唯一键冲突**，通常应返回 `409 Conflict`，而不是泛化为 500。

---

## 2. 复现请求（来自测试日志，完整示例）

```js
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

---

## 3. 历史响应（修复前）

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

问题：客户端无法直接识别是“可预期冲突”（409）还是“系统故障”（500）。

---

## 4. 修复后的返回语义

全局过滤器现已识别 TypeORM 的 `QueryFailedError`，并针对 PostgreSQL `23505`（唯一约束冲突）返回：

- HTTP Status: `409 Conflict`
- `error.code`: `DUPLICATE_KEY`
- `error.message`: 含约束名的冲突说明
- `error.details`: `dbCode` 与 `constraint`

示例：

```json
{
  "success": false,
  "error": {
    "code": "DUPLICATE_KEY",
    "message": "数据写入冲突（唯一约束：UQ_519cf9571ca939a56b8d74a60ea）",
    "details": {
      "dbCode": "23505",
      "constraint": "UQ_519cf9571ca939a56b8d74a60ea"
    }
  }
}
```

> 非生产环境仍会附带 `stack`，生产环境不返回 `stack`。

---

## 5. 这类冲突通常由什么触发

1. **并发写入竞争**  
   例如前端短时间并发触发两个内容更新请求，后端都基于同一版本号计算新版本，导致冲突。

2. **同一逻辑内重复插入**  
   例如事务里重复 `save` 同一条应唯一的数据，也会触发重复键冲突。

---

## 6. 当前结论

- 这是**可识别的业务冲突类数据库错误**，不是“未知内部错误”。
- 通过全局过滤器映射后，前端可根据 `409 + DUPLICATE_KEY` 做重试、串行化或提示“保存冲突”。
