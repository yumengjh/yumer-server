# 认证 API

认证模块提供用户注册、登录、令牌管理等功能。

## 认证与站点公开说明

除 `@Public()` 标记的注册、登录、刷新令牌接口外，认证模块默认走 JWT。

其中 `GET /api/v1/auth/users/:userId` 额外支持站点公开访问：

- 带 `Authorization`：按登录态返回完整资料
- 不带 token：仅允许来自 `PUBLIC_SITE_ORIGINS` 的站点请求匿名访问
- 站点公开响应会裁剪敏感字段，不返回 `email`、`status`
- 请求来源未命中白名单时返回 `403 Forbidden`

## 接口列表

| 方法  | 路径                  | 说明                     | 认证           |
| ----- | --------------------- | ------------------------ | -------------- |
| POST  | `/auth/register`      | 用户注册                 | 否             |
| POST  | `/auth/login`         | 用户登录                 | 否             |
| POST  | `/auth/refresh`       | 刷新令牌                 | 否             |
| POST  | `/auth/logout`        | 用户登出                 | 是             |
| GET   | `/auth/me`            | 获取当前用户             | 是             |
| PATCH | `/auth/me`            | 更新当前用户信息         | 是             |
| GET   | `/auth/users/:userId` | 根据 userId 获取用户信息 | JWT / 站点公开 |

## 用户注册

**接口：** `POST /api/v1/auth/register`

**说明：** 创建新用户账户

**请求体：**

```json
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "displayName": "John Doe"
}
```

**字段说明：**

| 字段          | 类型   | 必填 | 说明                                           |
| ------------- | ------ | ---- | ---------------------------------------------- |
| `username`    | string | ✅   | 用户名，3-50个字符，只能包含字母、数字和下划线 |
| `email`       | string | ✅   | 邮箱地址，必须符合邮箱格式                     |
| `password`    | string | ✅   | 密码，至少8位，必须包含大小写字母和数字        |
| `displayName` | string | ❌   | 显示名称（可选），最多100个字符                |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "user": {
      "userId": "u_1705123456789_abc123",
      "username": "john_doe",
      "email": "john@example.com",
      "displayName": "John Doe",
      "avatar": null
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**状态码：**

- `201 Created` - 注册成功
- `400 Bad Request` - 请求参数错误（如用户名已存在、邮箱格式错误等）
- `409 Conflict` - 用户名或邮箱已存在

## 用户登录

**接口：** `POST /api/v1/auth/login`

**说明：** 用户登录，获取访问令牌

**请求体：**

```json
{
  "emailOrUsername": "john@example.com",
  "password": "SecurePass123!"
}
```

**字段说明：**

| 字段              | 类型   | 必填 | 说明         |
| ----------------- | ------ | ---- | ------------ |
| `emailOrUsername` | string | ✅   | 邮箱或用户名 |
| `password`        | string | ✅   | 密码         |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "user": {
      "userId": "u_1705123456789_abc123",
      "username": "john_doe",
      "email": "john@example.com",
      "displayName": "John Doe",
      "avatar": null
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**状态码：**

- `200 OK` - 登录成功
- `401 Unauthorized` - 用户名/密码错误

## 刷新令牌

**接口：** `POST /api/v1/auth/refresh`

**说明：** 当 Access Token 过期时，使用 Refresh Token 获取新的 Access Token

**请求体：**

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**字段说明：**

| 字段           | 类型   | 必填 | 说明     |
| -------------- | ------ | ---- | -------- |
| `refreshToken` | string | ✅   | 刷新令牌 |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**状态码：**

- `200 OK` - 刷新成功
- `401 Unauthorized` - Refresh Token 无效或已过期

## 获取当前用户

**接口：** `GET /api/v1/auth/me`

**说明：** 获取当前登录用户的详细信息

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**响应示例：**

```json
{
  "success": true,
  "data": {
    "userId": "u_1705123456789_abc123",
    "username": "john_doe",
    "email": "john@example.com",
    "displayName": "John Doe",
    "avatar": null,
    "bio": null,
    "settings": {},
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**状态码：**

- `200 OK` - 获取成功
- `401 Unauthorized` - Token 无效或已过期

## 更新当前用户信息

**接口：** `PATCH /api/v1/auth/me`

**说明：** 更新当前登录用户资料，支持部分更新。

**返回字段：** `displayName`、`avatar`、`bio`

**返回体说明：** 返回当前用户信息，但不包含 `settings` 字段，包含 `updatedAt`。

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**请求体（可选字段）：**

```json
{
  "displayName": "John Doe",
  "avatar": "https://example.com/avatar.jpg",
  "bio": "这是我的简介"
}
```

> 说明：传 `null` 会被忽略，不会清空字段。

**响应示例：**

```json
{
  "success": true,
  "data": {
    "userId": "u_1705123456789_abc123",
    "username": "john_doe",
    "email": "john@example.com",
    "displayName": "John Doe",
    "avatar": "https://example.com/avatar.jpg",
    "bio": "这是我的简介",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2026-02-11T14:20:00.000Z"
  }
}
```

**状态码：**

- `200 OK` - 更新成功
- `400 Bad Request` - 请求参数错误
- `401 Unauthorized` - Token 无效或已过期

## 根据 userId 获取用户信息

**接口：** `GET /api/v1/auth/users/:userId`

**说明：** 根据用户 ID 查询用户基础信息。该接口支持登录态访问，也支持受允许站点的匿名公开访问。

**返回字段：**

- 登录态：`userId`、`username`、`displayName`、`email`、`avatar`、`bio`、`status`、`updatedAt`
- 站点公开：`userId`、`username`、`displayName`、`avatar`、`bio`、`updatedAt`

**请求方式（二选一）：**

- 登录态：`Authorization: Bearer <your-access-token>`
- 站点公开：不带 token，但请求来源必须命中 `PUBLIC_SITE_ORIGINS`

**路径参数：**

| 参数     | 类型   | 必填 | 说明    |
| -------- | ------ | ---- | ------- |
| `userId` | string | ✅   | 用户 ID |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "username": "john_doe",
    "displayName": "John Doe",
    "email": "john@example.com",
    "avatar": "https://example.com/avatar.jpg",
    "bio": "这是我的简介",
    "status": "active",
    "updatedAt": "2026-02-11T03:30:00.000Z"
  }
}
```

**站点公开响应示例：**

```json
{
  "success": true,
  "data": {
    "userId": "u_1705123456789_abc123",
    "username": "john_doe",
    "displayName": "John Doe",
    "avatar": "https://example.com/avatar.jpg",
    "bio": "这是我的简介",
    "updatedAt": "2026-02-11T03:30:00.000Z"
  }
}
```

**状态码：**

- `200 OK` - 获取成功
- `401 Unauthorized` - Token 无效或已过期
- `403 Forbidden` - 站点公开请求来源不被允许
- `404 Not Found` - 用户不存在

## 用户登出

**接口：** `POST /api/v1/auth/logout`

**说明：** 用户登出，使令牌失效

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**请求体：**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**字段说明：**

| 字段    | 类型   | 必填 | 说明                                |
| ------- | ------ | ---- | ----------------------------------- |
| `token` | string | ✅   | 要失效的令牌（通常是 refreshToken） |

**响应：**

- 状态码：`204 No Content`
- 无响应体

**状态码：**

- `204 No Content` - 登出成功
- `401 Unauthorized` - Token 无效

## Token 说明

### Access Token

- **用途：** 访问受保护接口
- **有效期：** 默认约 24 小时
- **使用方式：** 在请求头中添加 `Authorization: Bearer <accessToken>`

### Refresh Token

- **用途：** 刷新 Access Token
- **有效期：** 默认约 7 天
- **使用方式：** 通过 `/auth/refresh` 接口刷新

### Token 刷新策略

建议在 Access Token 过期前（如剩余时间 < 1 小时）自动刷新：

```typescript
// 检查 Token 是否即将过期
function shouldRefreshToken(token: string): boolean {
  const payload = JSON.parse(atob(token.split(".")[1]));
  const exp = payload.exp * 1000; // 转换为毫秒
  const now = Date.now();
  const timeLeft = exp - now;

  // 如果剩余时间少于 1 小时，需要刷新
  return timeLeft < 60 * 60 * 1000;
}
```

## 代码示例

### JavaScript / TypeScript

```typescript
// 注册用户
async function register() {
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
}

// 用户登录
async function login() {
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
}

// 获取当前用户
async function getCurrentUser() {
  const token = localStorage.getItem("accessToken");
  const response = await fetch("http://localhost:5200/api/v1/auth/me", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return await response.json();
}
```

### cURL

```bash
# 注册
curl -X POST http://localhost:5200/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "john_doe",
    "email": "john@example.com",
    "password": "SecurePass123!",
    "displayName": "John Doe"
  }'

# 登录
curl -X POST http://localhost:5200/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "emailOrUsername": "john@example.com",
    "password": "SecurePass123!"
  }'

# 获取当前用户
curl -X GET http://localhost:5200/api/v1/auth/me \
  -H "Authorization: Bearer <your-access-token>"
```
