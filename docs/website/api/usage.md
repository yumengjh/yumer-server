# API 使用指南

本文档提供 API 使用的详细说明，包括认证流程、错误处理、示例代码等。

## 基础信息

### 基础 URL

```
开发环境: http://localhost:5200
API 前缀: /api/v1
```

### 完整 API 地址示例

```
http://localhost:5200/api/v1/auth/register
```

### 响应格式

所有成功响应统一格式：

```json
{
  "success": true,
  "data": {}
}
```

错误响应格式：

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述"
  }
}
```

### 认证方式

除注册、登录、刷新令牌外，其余接口均需 JWT 认证：

```
Authorization: Bearer <your-access-token>
```

## 认证流程

### 1. 用户注册

```typescript
const response = await fetch("http://localhost:5200/api/v1/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    username: "john_doe",
    email: "john@example.com",
    password: "SecurePass123!",
    displayName: "John Doe",
  }),
});

const data = await response.json();
if (data.success) {
  // 保存 Token
  localStorage.setItem("accessToken", data.data.accessToken);
  localStorage.setItem("refreshToken", data.data.refreshToken);
}
```

### 2. 用户登录

```typescript
const response = await fetch("http://localhost:5200/api/v1/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    emailOrUsername: "john@example.com",
    password: "SecurePass123!",
  }),
});

const data = await response.json();
if (data.success) {
  localStorage.setItem("accessToken", data.data.accessToken);
  localStorage.setItem("refreshToken", data.data.refreshToken);
}
```

### 3. 使用 Token 访问接口

```typescript
const token = localStorage.getItem("accessToken");
const response = await fetch("http://localhost:5200/api/v1/auth/me", {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

## 完整工作流示例

### 创建工作空间和文档

```typescript
// 1. 登录获取 Token
const loginRes = await fetch("http://localhost:5200/api/v1/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    emailOrUsername: "john@example.com",
    password: "SecurePass123!",
  }),
});
const loginData = await loginRes.json();
const accessToken = loginData.data.accessToken;

// 2. 创建工作空间
const workspaceRes = await fetch("http://localhost:5200/api/v1/workspaces", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    name: "我的工作空间",
    description: "示例工作空间",
    icon: "📁",
  }),
});
const workspaceData = await workspaceRes.json();
const workspaceId = workspaceData.data.workspaceId;

// 3. 创建文档
const docRes = await fetch("http://localhost:5200/api/v1/documents", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    workspaceId,
    title: "我的第一篇文档",
    visibility: "workspace",
    tags: ["示例"],
  }),
});
const docData = await docRes.json();
const docId = docData.data.docId;
const rootBlockId = docData.data.rootBlockId;

// 4. 创建块
const blockRes = await fetch("http://localhost:5200/api/v1/blocks", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    docId,
    type: "paragraph",
    payload: { text: "这是第一段内容" },
    parentId: rootBlockId,
    sortKey: "1",
    createVersion: false, // 延迟创建版本
  }),
});

// 5. 手动提交版本
const commitRes = await fetch(
  `http://localhost:5200/api/v1/documents/${docId}/commit`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      message: "完成编辑",
    }),
  },
);
```

## 错误处理

### 常见错误码

| HTTP 状态码 | 错误码             | 说明                         |
| ----------- | ------------------ | ---------------------------- |
| 400         | `VALIDATION_ERROR` | 请求参数验证失败             |
| 401         | `UNAUTHORIZED`     | 未授权（Token 无效或已过期） |
| 403         | `FORBIDDEN`        | 没有权限                     |
| 404         | `NOT_FOUND`        | 资源不存在                   |
| 409         | `CONFLICT`         | 资源冲突（如用户名已存在）   |
| 429         | `RATE_6001`        | 请求过于频繁（触发限流）     |
| 500         | `INTERNAL_ERROR`   | 服务器内部错误               |

### 错误处理示例

```typescript
async function apiCall(url: string, options: RequestInit) {
  try {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      // 处理错误
      if (response.status === 401) {
        // Token 过期，尝试刷新
        await refreshToken();
        // 重试请求
        return apiCall(url, options);
      }
      throw new Error(data.error?.message || "请求失败");
    }

    return data;
  } catch (error) {
    console.error("API 调用失败:", error);
    throw error;
  }
}
```

## Token 管理

### Token 刷新策略

```typescript
// 检查 Token 是否即将过期
function shouldRefreshToken(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const exp = payload.exp * 1000;
    const now = Date.now();
    const timeLeft = exp - now;

    // 如果剩余时间少于 1 小时，需要刷新
    return timeLeft < 60 * 60 * 1000;
  } catch {
    return true; // 解析失败，需要刷新
  }
}

// 刷新 Token
async function refreshToken() {
  const refreshToken = localStorage.getItem("refreshToken");
  const response = await fetch("http://localhost:5200/api/v1/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  const data = await response.json();
  if (data.success) {
    localStorage.setItem("accessToken", data.data.accessToken);
    localStorage.setItem("refreshToken", data.data.refreshToken);
  } else {
    // 刷新失败，需要重新登录
    window.location.href = "/login";
  }
}
```

## 限流说明

系统实施了全局限流机制：

- **限制：** 60 秒内最多 100 次请求
- **超出限制：** 返回 `429 Too Many Requests`
- **建议：** 合理控制请求频率，避免触发限流
- **运行时调优：** 支持通过 `/runtime-configs/rate-limit` 在线调整 `enabled/ttlMs/limit`
