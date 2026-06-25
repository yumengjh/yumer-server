# AI Chat V1 设计文档

## 背景

当前后端是 NestJS 11 + TypeORM 的内容基础设施，业务模块集中在 `src/modules/*`。本次新增 AI 功能第一版只实现最简单的“给定提示词生成内容/对话”能力，但需要为后续复杂内容 Agent 工作流预留空间，例如自动选题理解、信息调研、内容结构生成、初稿生成、内容优化、审查等。

## 目标

1. 新增独立 `AiModule`，核心逻辑放在后端。
2. 支持 OpenAI 兼容接口，V1 使用 LangChain.js 的 `ChatOpenAI` 调用模型。
3. 保存会话历史，并保存同一会话每次请求实际使用的上下文内容。
4. SaaS 多用户场景下做好用户隔离；支持可选关联 `workspaceId`。
5. 参数先硬编码在后端，减少前端和 API 复杂度。
6. 保持 V1 简单，不引入 LangGraph checkpoint、复杂工作流调度、计费等重型能力。
7. 后续可在同一模块内混用 LangChain 和 LangGraph，不推倒 V1 数据模型。

## 非目标

1. V1 不做流式输出。
2. V1 不做工具调用。
3. V1 不做多 Agent 编排。
4. V1 不做 RAG、联网调研、文档读取。
5. V1 不开放 temperature、max tokens、system prompt 等高级参数给前端。
6. V1 不实现用量计费，只预留元数据字段保存模型名、token 用量等信息。

## 总体方案

新增 `src/modules/ai/`：

```txt
src/modules/ai/
  ai.module.ts
  ai.controller.ts
  ai-conversation.service.ts
  ai-model.service.ts
  ai-prompt-builder.ts
  dto/
    create-ai-chat.dto.ts
    list-ai-conversations.dto.ts
  types/
    ai-message-role.ts
```

新增实体：

```txt
src/entities/ai-conversation.entity.ts
src/entities/ai-message.entity.ts
src/entities/ai-context-snapshot.entity.ts
```

职责划分：

- `AiController`：API 层，统一使用 JWT，负责接收 prompt/conversationId/workspaceId。
- `AiConversationService`：业务编排，负责会话创建、权限校验、消息保存、上下文快照保存、调用模型。
- `AiModelService`：模型调用适配层。V1 内部使用 LangChain `ChatOpenAI`，业务层不暴露 LangChain 类型。
- `AiPromptBuilder`：组装 system prompt、历史消息、当前用户消息，产出本次模型调用上下文。

## API 设计

### 发送消息/生成内容

`POST /ai/chat`

请求：

```json
{
  "prompt": "帮我生成一段关于 SaaS 内容基础设施的产品介绍",
  "conversationId": "aic_xxx",
  "workspaceId": "ws_xxx"
}
```

字段说明：

- `prompt`：必填，当前用户输入。
- `conversationId`：可选。不传则创建新会话；传入则追加到已有会话。
- `workspaceId`：可选。传入时需要校验当前用户有该工作空间访问权限。

响应：

```json
{
  "conversationId": "aic_xxx",
  "userMessageId": "aim_xxx",
  "assistantMessageId": "aim_xxx",
  "content": "生成内容...",
  "model": "gpt-4o-mini"
}
```

### 会话列表

`GET /ai/conversations?page=1&pageSize=20&workspaceId=ws_xxx`

返回当前用户自己的 AI 会话。`workspaceId` 可选，传入时只筛选该工作空间关联的会话。

### 会话详情

`GET /ai/conversations/:conversationId`

返回会话基础信息和消息列表。只能访问当前用户自己的会话。

## 数据模型

### AiConversation

表名：`ai_conversations`

字段：

- `id`：数据库主键。
- `conversationId`：业务 ID，形如 `aic_xxx`。
- `userId`：会话归属用户，隔离边界。
- `workspaceId`：可选关联工作空间。
- `title`：会话标题，V1 用用户第一条 prompt 截断生成。
- `status`：`active` / `archived`。
- `metadata`：JSON，预留模型、场景、工作流信息。
- `createdAt` / `updatedAt`。

索引：

- `conversationId` 唯一。
- `userId + updatedAt`。
- `userId + workspaceId + updatedAt`。

### AiMessage

表名：`ai_messages`

字段：

- `id`：数据库主键。
- `messageId`：业务 ID，形如 `aim_xxx`。
- `conversationId`：所属会话。
- `userId`：冗余保存用户 ID，便于隔离查询。
- `role`：`system` / `user` / `assistant`。
- `content`：消息正文。
- `metadata`：JSON，保存模型名、token usage、错误信息等。
- `createdAt`。

索引：

- `messageId` 唯一。
- `conversationId + createdAt`。
- `userId + createdAt`。

### AiContextSnapshot

表名：`ai_context_snapshots`

字段：

- `id`：数据库主键。
- `snapshotId`：业务 ID，形如 `aics_xxx`。
- `conversationId`：所属会话。
- `requestMessageId`：本次用户消息 ID。
- `userId`：归属用户。
- `messages`：JSON，保存本次实际传给模型的 messages，包括 system prompt、历史消息、当前消息。
- `model`：本次使用的模型。
- `metadata`：JSON，保存 temperature、max tokens、上下文条数等。
- `createdAt`。

用途：

- 审计：知道模型到底收到了什么上下文。
- 调试：复现生成结果。
- 后续 Agent：能区分业务消息历史和工作流执行上下文。

## 上下文策略

V1 不做复杂摘要和 token 预算器，只做简单、可控的上下文窗口：

1. 固定 system prompt：
   - 说明模型是内容生成助手。
   - 要求输出中文，除非用户明确要求其他语言。
   - 不要伪造事实；不确定时说明不确定。
2. 读取同一会话最近 N 条消息，默认 N=20。
3. 拼接当前用户 prompt。
4. 保存完整上下文快照。
5. 调用模型。
6. 保存 assistant 回复。

V1 默认不把 workspace 文档内容注入上下文，只把 `workspaceId` 作为隔离和后续扩展关联。

## 配置

`.env.example` 新增：

```env
AI_OPENAI_BASE_URL=https://api.openai.com/v1
AI_OPENAI_API_KEY=
AI_OPENAI_MODEL=gpt-4o-mini
```

模型参数 V1 硬编码在 `AiModelService`：

- `temperature = 0.7`
- `maxTokens = 1200`
- `historyLimit = 20`

如果缺少 `AI_OPENAI_API_KEY`，调用接口时返回明确错误，不在启动阶段阻断整个服务。

## OpenAI 兼容接口和 LangChain

V1 使用 LangChain.js：

```ts
import { ChatOpenAI } from '@langchain/openai';

new ChatOpenAI({
  apiKey,
  model,
  temperature,
  maxTokens,
  configuration: { baseURL },
});
```

业务层只调用自定义接口：

```ts
interface AiModelGenerateInput {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

interface AiModelGenerateResult {
  content: string;
  model: string;
  usage?: Record<string, unknown>;
}
```

这样未来可以：

- 继续用 LangChain 的 chat model。
- 在复杂场景引入 LangGraph `StateGraph`。
- 把 `conversationId` 映射到 LangGraph 的 `thread_id`。
- 单独引入 LangGraph checkpointer/store，而不影响 V1 API。

## 权限和隔离

1. 所有 AI API 默认需要 `JwtAuthGuard`。
2. 查询会话时必须带当前 `userId` 条件。
3. 访问 `conversationId` 时必须校验 `conversation.userId === currentUser.userId`。
4. 请求带 `workspaceId` 时调用 `WorkspacesService.checkAccess(workspaceId, userId)`。
5. 如果传入的 `conversationId` 已绑定 `workspaceId`，后续请求不允许换成另一个 `workspaceId`。

## 错误处理

- prompt 为空：400。
- conversation 不存在或不属于当前用户：404。
- workspace 无权限：沿用 `WorkspacesService.checkAccess` 的 403/404。
- AI API key 未配置：503。
- 模型调用失败：502，保存用户消息和上下文快照，assistant 消息不保存或保存为 error metadata 由实现阶段决定；V1 推荐不保存 assistant 错误消息，避免前端误展示。

## 测试策略

使用 TDD。优先单元测试服务层，不直接调用真实模型。

关键测试：

1. 不传 `conversationId` 时创建新会话并保存 user/assistant 消息。
2. 传入已有会话时追加消息，且只允许会话 owner 访问。
3. 传 `workspaceId` 时调用 `checkAccess`。
4. 同一会话保存上下文快照，快照包含 system、历史消息、当前 prompt。
5. prompt 为空时报错。
6. AI key 缺失时报错。
7. 模型调用失败时错误向上抛出，且不保存伪造 assistant 回复。

## 后续扩展路线

### 第二阶段：内容工作流雏形

新增 `AiWorkflowService`，但仍复用当前会话和消息表。可以增加消息 metadata：

```json
{
  "workflow": "content-draft",
  "step": "outline"
}
```

### 第三阶段：LangGraph

新增：

```txt
src/modules/ai/workflows/
  content-agent.graph.ts
  nodes/
  tools/
```

`conversationId` 对应 LangGraph `thread_id`。LangGraph checkpoint/store 单独建表或使用官方 Postgres checkpointer，不替代业务层 `AiMessage` 和 `AiContextSnapshot`。

### 第四阶段：上下文治理

- 会话摘要。
- token 预算。
- workspace 文档检索。
- 工具调用审计。
- 生成内容直接写入文档草稿。

## 验收标准

1. `POST /ai/chat` 能创建新会话并返回 AI 生成内容。
2. `POST /ai/chat` 能基于已有 `conversationId` 继续对话。
3. 用户只能访问自己的 AI 会话和消息。
4. 可选 `workspaceId` 校验生效。
5. 每次模型调用都保存上下文快照。
6. `.env.example` 包含 AI 配置项。
7. 单元测试覆盖核心隔离、上下文、错误处理。
8. `pnpm test` 和 `pnpm build` 通过。
