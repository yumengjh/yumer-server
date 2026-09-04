# AI 对话接口测试指南

本文档用于手动测试 AI 对话 V1 的 3 个接口：

- `POST /api/v1/ai/chat`
- `GET /api/v1/ai/conversations`
- `GET /api/v1/ai/conversations/:conversationId`

## 1. 测试前准备

### 1.1 配置环境变量

在 `F:\yumer-server\.env` 中加入或确认以下配置：

```env
AI_OPENAI_BASE_URL=https://api.openai.com/v1
AI_OPENAI_API_KEY=你的 OpenAI 兼容接口 Key
AI_OPENAI_MODEL=gpt-4o-mini
```

如果使用第三方 OpenAI 兼容服务，把 `AI_OPENAI_BASE_URL` 改成对应服务的 `/v1` 地址，例如：

```env
AI_OPENAI_BASE_URL=https://api.example.com/v1
AI_OPENAI_API_KEY=xxx
AI_OPENAI_MODEL=provider-model-name
```

### 1.2 安装依赖并构建

```bash
pnpm install
pnpm build
```

### 1.3 执行数据库迁移

如果当前环境不是 `synchronize: true` 的开发库，需要执行迁移：

```bash
pnpm typeorm:migration:run
```

本功能新增表：

- `ai_conversations`
- `ai_messages`
- `ai_context_snapshots`

### 1.4 启动后端

```bash
pnpm dev
```

默认接口前缀：

```txt
http://localhost:5200/api/v1
```

## 2. 获取登录 Token

AI 接口都需要登录态。先调用登录接口：

```bash
curl.exe -X POST "http://localhost:5200/api/v1/auth/login" ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"你的邮箱\",\"password\":\"你的密码\"}"
```

如果使用 Git Bash，把换行符 `^` 换成 `\`：

```bash
curl -X POST "http://localhost:5200/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"你的邮箱","password":"你的密码"}'
```

从响应中复制 access token，后续示例用：

```txt
<ACCESS_TOKEN>
```

## 3. 测试新建 AI 会话

### Windows PowerShell 中文编码注意

如果请求体里有中文，Windows PowerShell 直接把 JSON 字符串传给 `Invoke-RestMethod` 时，某些环境可能会把中文发送成 `????`。建议显式使用 UTF-8 字节：

```powershell
$base = "http://localhost:5200/api/v1"
$token = "Bearer <ACCESS_TOKEN>"
$headers = @{
  Authorization = $token
  "Content-Type" = "application/json; charset=utf-8"
}
$json = @{ prompt = "请用一句中文介绍 AI 内容生成功能。" } | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
Invoke-RestMethod -Method Post -Uri "$base/ai/chat" -Headers $headers -Body $bytes
```

如果用 `curl.exe` 或 Git Bash，通常不需要额外处理；但如果发现数据库或返回内容里中文变成 `????`，优先检查客户端编码。

### 请求

```bash
curl.exe -X POST "http://localhost:5200/api/v1/ai/chat" ^
  -H "Authorization: Bearer <ACCESS_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"prompt\":\"帮我写一段介绍 SaaS 内容基础设施的短文\"}"
```

Git Bash：

```bash
curl -X POST "http://localhost:5200/api/v1/ai/chat" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"帮我写一段介绍 SaaS 内容基础设施的短文"}'
```

### 预期结果

响应类似：

```json
{
  "conversationId": "aic_...",
  "userMessageId": "aim_...",
  "assistantMessageId": "aim_...",
  "content": "生成内容...",
  "model": "gpt-4o-mini"
}
```

需要检查：

- 返回了 `conversationId`
- 返回了用户消息 ID：`userMessageId`
- 返回了助手消息 ID：`assistantMessageId`
- `content` 有模型生成内容
- 数据库中新增：
  - 1 条 `ai_conversations`
  - 2 条 `ai_messages`
  - 1 条 `ai_context_snapshots`

## 4. 测试继续同一会话

把上一步返回的 `conversationId` 填入请求。

### 请求

```bash
curl.exe -X POST "http://localhost:5200/api/v1/ai/chat" ^
  -H "Authorization: Bearer <ACCESS_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"conversationId\":\"aic_xxx\",\"prompt\":\"把刚才那段改得更适合官网首页\"}"
```

### 预期结果

响应中的 `conversationId` 应该和请求中的一致。

数据库中应该新增：

- 1 条 user 消息
- 1 条 assistant 消息
- 1 条上下文快照

并且本次 `ai_context_snapshots.messages` 应包含：

- system prompt
- 上一轮 user/assistant 历史
- 当前 user prompt

## 5. 测试关联 workspaceId

如果前端在某个工作空间中发起 AI 对话，可以带 `workspaceId`。

### 请求

```bash
curl.exe -X POST "http://localhost:5200/api/v1/ai/chat" ^
  -H "Authorization: Bearer <ACCESS_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"workspaceId\":\"ws_xxx\",\"prompt\":\"帮我生成这个工作空间的内容规划方向\"}"
```

### 预期结果

如果当前用户有该工作空间访问权限：

- 返回正常生成内容
- `ai_conversations.workspaceId` 保存为 `ws_xxx`

如果当前用户无权限：

- 返回 `403` 或 `404`
- 不应创建该工作空间下的 AI 会话

## 6. 测试会话列表

### 请求

```bash
curl.exe -X GET "http://localhost:5200/api/v1/ai/conversations?page=1&pageSize=20" ^
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### 预期结果

响应类似：

```json
{
  "items": [
    {
      "conversationId": "aic_...",
      "userId": "u_...",
      "workspaceId": null,
      "title": "帮我写一段介绍 SaaS 内容基础设施的短文",
      "status": "active",
      "metadata": {},
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

需要检查：

- 只返回当前登录用户自己的会话
- 按 `updatedAt` 倒序
- `page` / `pageSize` 生效

### 按 workspaceId 筛选

```bash
curl.exe -X GET "http://localhost:5200/api/v1/ai/conversations?page=1&pageSize=20&workspaceId=ws_xxx" ^
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

预期：

- 当前用户有该工作空间权限时，返回该工作空间关联的 AI 会话
- 无权限时返回 `403` 或 `404`

## 7. 测试会话详情

### 请求

```bash
curl.exe -X GET "http://localhost:5200/api/v1/ai/conversations/aic_xxx" ^
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### 预期结果

响应包含会话信息和消息列表：

```json
{
  "conversationId": "aic_...",
  "userId": "u_...",
  "workspaceId": null,
  "title": "...",
  "status": "active",
  "metadata": {},
  "createdAt": "...",
  "updatedAt": "...",
  "messages": [
    {
      "role": "user",
      "content": "..."
    },
    {
      "role": "assistant",
      "content": "..."
    }
  ]
}
```

需要检查：

- 当前用户能访问自己的会话详情
- 消息按创建时间正序
- 其他用户访问该 `conversationId` 应返回 `404`

## 8. 错误场景测试

### 8.1 未登录

```bash
curl.exe -X GET "http://localhost:5200/api/v1/ai/conversations"
```

预期：

- 返回 `401`

### 8.2 空 prompt

```bash
curl.exe -X POST "http://localhost:5200/api/v1/ai/chat" ^
  -H "Authorization: Bearer <ACCESS_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"prompt\":\"   \"}"
```

预期：

- 返回 `400`
- 不应调用模型

### 8.3 AI API Key 未配置

临时清空：

```env
AI_OPENAI_API_KEY=
```

重启后端后请求：

```bash
curl.exe -X POST "http://localhost:5200/api/v1/ai/chat" ^
  -H "Authorization: Bearer <ACCESS_TOKEN>" ^
  -H "Content-Type: application/json" ^
  -d "{\"prompt\":\"测试 AI Key 缺失\"}"
```

预期：

- 返回 `503`
- 会保存 user 消息和上下文快照
- 不保存假的 assistant 回复

### 8.4 模型服务不可用

把 `AI_OPENAI_BASE_URL` 改成错误地址，重启后端后请求。

预期：

- 返回 `502`
- 会保存 user 消息和上下文快照
- 不保存假的 assistant 回复

## 9. 数据库检查 SQL

PostgreSQL 示例：

```sql
select "conversationId", "userId", "workspaceId", "title", "status", "createdAt", "updatedAt"
from ai_conversations
order by "updatedAt" desc
limit 10;

select "messageId", "conversationId", "userId", "role", left("content", 80), "createdAt"
from ai_messages
order by "createdAt" desc
limit 20;

select "snapshotId", "conversationId", "requestMessageId", "userId", "model", "metadata", "createdAt"
from ai_context_snapshots
order by "createdAt" desc
limit 10;
```

重点检查：

- `ai_messages.userId` 与当前登录用户一致
- 同一 `conversationId` 下消息连续追加
- `ai_context_snapshots.messages` 保存了实际传给模型的上下文

## 10. 前端联调建议

前端最小联调流程：

1. 用户输入 prompt。
2. 调 `POST /ai/chat`，不传 `conversationId`。
3. 保存响应里的 `conversationId`。
4. 后续同一聊天窗口继续传该 `conversationId`。
5. 页面刷新后用 `GET /ai/conversations/:conversationId` 恢复消息列表。
6. 侧边栏用 `GET /ai/conversations` 展示历史会话。

V1 暂不支持流式输出，所以前端先按普通 HTTP 请求处理 loading 状态即可。
