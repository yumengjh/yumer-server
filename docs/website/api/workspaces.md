# 工作空间 API

工作空间模块提供工作空间的创建、管理、成员管理等功能。

## 站点公开访问说明

`GET /api/v1/workspaces/:workspaceId` 支持通过 `@SitePublic()` 开放给指定站点匿名访问。

- 带 `Authorization`：按登录态返回完整工作空间信息
- 不带 token：请求来源必须命中 `PUBLIC_SITE_ORIGINS`
- 站点公开模式下仅允许访问 `status = active` 的工作空间
- 站点公开响应只返回公开安全字段，不包含 `userRole`、`memberCount`、`documentCount`

## 接口列表

| 方法   | 路径                                       | 说明         | 认证           |
| ------ | ------------------------------------------ | ------------ | -------------- |
| POST   | `/workspaces`                              | 创建工作空间 | 是             |
| GET    | `/workspaces`                              | 工作空间列表 | 是             |
| GET    | `/workspaces/:workspaceId`                 | 工作空间详情 | JWT / 站点公开 |
| PATCH  | `/workspaces/:workspaceId`                 | 更新工作空间 | 是             |
| DELETE | `/workspaces/:workspaceId`                 | 删除工作空间 | 是             |
| POST   | `/workspaces/:workspaceId/members`         | 邀请成员     | 是             |
| GET    | `/workspaces/:workspaceId/members`         | 成员列表     | 是             |
| PATCH  | `/workspaces/:workspaceId/members/:userId` | 更新成员角色 | 是             |
| DELETE | `/workspaces/:workspaceId/members/:userId` | 移除成员     | 是             |

## 权限说明

工作空间支持以下角色：

- **owner** - 所有者：拥有所有权限，包括删除工作空间、修改所有者角色
- **admin** - 管理员：可以管理成员、编辑工作空间
- **editor** - 编辑者：可以创建和编辑文档
- **viewer** - 查看者：只能查看内容

**注意：** 邀请成员时，不能将角色设置为 `owner`（只能通过转移所有权实现）。

## 创建工作空间

**接口：** `POST /api/v1/workspaces`

**说明：** 创建新的工作空间，创建者自动成为 `owner`

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**请求体：**

```json
{
  "name": "我的工作空间",
  "description": "这是一个工作空间描述",
  "icon": "📚"
}
```

**字段说明：**

| 字段          | 类型   | 必填 | 说明                                |
| ------------- | ------ | ---- | ----------------------------------- |
| `name`        | string | ✅   | 工作空间名称，1-100个字符           |
| `description` | string | ❌   | 工作空间描述，最多500个字符         |
| `icon`        | string | ❌   | 工作空间图标（emoji），最多10个字符 |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "workspaceId": "ws_1705123456789_abc123",
    "name": "我的工作空间",
    "description": "这是一个工作空间描述",
    "icon": "📚",
    "userRole": "owner",
    "memberCount": 1,
    "documentCount": 0,
    "status": "active",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**状态码：**

- `201 Created` - 创建成功
- `400 Bad Request` - 请求参数错误

## 获取工作空间列表

**接口：** `GET /api/v1/workspaces`

**说明：** 获取当前用户有权限访问的工作空间列表

**请求头：**

- 登录态：`Authorization: Bearer <your-access-token>`
- 站点公开：可不带 token，但请求来源必须命中 `PUBLIC_SITE_ORIGINS`

**查询参数：**

| 参数       | 类型   | 必填 | 说明              |
| ---------- | ------ | ---- | ----------------- |
| `page`     | number | ❌   | 页码，默认 1      |
| `pageSize` | number | ❌   | 每页数量，默认 20 |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "workspaceId": "ws_1705123456789_abc123",
        "name": "我的工作空间",
        "description": "这是一个工作空间描述",
        "icon": "📚",
        "userRole": "owner",
        "memberCount": 3,
        "documentCount": 10,
        "status": "active"
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20
  }
}
```

**状态码：**

- `200 OK` - 获取成功

## 获取工作空间详情

**接口：** `GET /api/v1/workspaces/:workspaceId`

**说明：** 获取指定工作空间的详细信息

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数          | 类型   | 说明       |
| ------------- | ------ | ---------- |
| `workspaceId` | string | 工作空间ID |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "workspaceId": "ws_1705123456789_abc123",
    "name": "我的工作空间",
    "description": "这是一个工作空间描述",
    "icon": "📚",
    "userRole": "owner",
    "memberCount": 3,
    "documentCount": 10,
    "status": "active",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**站点公开响应示例：**

```json
{
  "success": true,
  "data": {
    "workspaceId": "ws_1705123456789_abc123",
    "name": "我的工作空间",
    "description": "这是一个工作空间描述",
    "icon": "📚",
    "ownerId": "u_1705123456789_owner001",
    "status": "active",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**状态码：**

- `200 OK` - 获取成功
- `403 Forbidden` - 没有权限访问或站点公开请求来源不被允许
- `404 Not Found` - 工作空间不存在，或工作空间不可公开访问

## 更新工作空间

**接口：** `PATCH /api/v1/workspaces/:workspaceId`

**说明：** 更新工作空间的名称、描述、图标等信息

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**路径参数：**

| 参数          | 类型   | 说明       |
| ------------- | ------ | ---------- |
| `workspaceId` | string | 工作空间ID |

**请求体：**

```json
{
  "name": "更新后的工作空间名称",
  "description": "更新后的描述",
  "icon": "📁"
}
```

**字段说明：**

| 字段          | 类型   | 必填 | 说明                                |
| ------------- | ------ | ---- | ----------------------------------- |
| `name`        | string | ❌   | 工作空间名称，1-100个字符           |
| `description` | string | ❌   | 工作空间描述，最多500个字符         |
| `icon`        | string | ❌   | 工作空间图标（emoji），最多10个字符 |

**权限要求：** owner 或 admin

**响应示例：**

```json
{
  "success": true,
  "data": {
    "workspaceId": "ws_1705123456789_abc123",
    "name": "更新后的工作空间名称",
    "description": "更新后的描述",
    "icon": "📁",
    ...
  }
}
```

**状态码：**

- `200 OK` - 更新成功
- `404 Not Found` - 工作空间不存在
- `403 Forbidden` - 没有权限

## 删除工作空间

**接口：** `DELETE /api/v1/workspaces/:workspaceId`

**说明：** 删除工作空间（**软删除**），只有所有者可以删除

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数          | 类型   | 说明       |
| ------------- | ------ | ---------- |
| `workspaceId` | string | 工作空间ID |

**权限要求：** owner

**响应示例：**

```json
{
  "success": true,
  "data": {
    "message": "工作空间已删除"
  }
}
```

**状态码：**

- `200 OK` - 删除成功
- `404 Not Found` - 工作空间不存在
- `403 Forbidden` - 只有所有者可以删除

## 邀请成员

**接口：** `POST /api/v1/workspaces/:workspaceId/members`

**说明：** 邀请用户加入工作空间

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**路径参数：**

| 参数          | 类型   | 说明       |
| ------------- | ------ | ---------- |
| `workspaceId` | string | 工作空间ID |

**请求体：**

```json
{
  "email": "user@example.com",
  "role": "editor"
}
```

**字段说明：**

| 字段    | 类型   | 必填 | 说明                                                        |
| ------- | ------ | ---- | ----------------------------------------------------------- |
| `email` | string | ✅   | 用户邮箱地址                                                |
| `role`  | string | ✅   | 成员角色：`admin`、`editor`、`viewer`（不能设置为 `owner`） |

**权限要求：** owner 或 admin

**响应示例：**

```json
{
  "success": true,
  "data": {
    "workspaceId": "ws_1705123456789_abc123",
    "userId": "u_1705123456789_xyz456",
    "role": "editor",
    "joinedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

**状态码：**

- `201 Created` - 邀请成功
- `404 Not Found` - 工作空间或用户不存在
- `403 Forbidden` - 没有权限
- `409 Conflict` - 用户已经是成员

## 获取成员列表

**接口：** `GET /api/v1/workspaces/:workspaceId/members`

**说明：** 获取工作空间的所有成员列表

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数          | 类型   | 说明       |
| ------------- | ------ | ---------- |
| `workspaceId` | string | 工作空间ID |

**响应示例：**

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "userId": "u_1705123456789_abc123",
        "username": "john_doe",
        "email": "john@example.com",
        "displayName": "John Doe",
        "role": "owner",
        "joinedAt": "2024-01-15T10:30:00.000Z"
      },
      {
        "userId": "u_1705123456789_xyz456",
        "username": "jane_smith",
        "email": "jane@example.com",
        "displayName": "Jane Smith",
        "role": "editor",
        "joinedAt": "2024-01-15T11:00:00.000Z"
      }
    ],
    "total": 2
  }
}
```

**状态码：**

- `200 OK` - 获取成功
- `404 Not Found` - 工作空间不存在
- `403 Forbidden` - 没有权限访问

## 更新成员角色

**接口：** `PATCH /api/v1/workspaces/:workspaceId/members/:userId`

**说明：** 更新工作空间成员的角色

**请求头：**

```
Authorization: Bearer <your-access-token>
Content-Type: application/json
```

**路径参数：**

| 参数          | 类型   | 说明       |
| ------------- | ------ | ---------- |
| `workspaceId` | string | 工作空间ID |
| `userId`      | string | 用户ID     |

**请求体：**

```json
{
  "role": "admin"
}
```

**字段说明：**

| 字段   | 类型   | 必填 | 说明                                |
| ------ | ------ | ---- | ----------------------------------- |
| `role` | string | ✅   | 新角色：`admin`、`editor`、`viewer` |

**权限要求：** owner 或 admin

**限制：**

- 不能修改所有者的角色
- 不能将角色设置为 `owner`（只能通过转移所有权实现）

**响应示例：**

```json
{
  "success": true,
  "data": {
    "workspaceId": "ws_1705123456789_abc123",
    "userId": "u_1705123456789_xyz456",
    "role": "admin",
    "updatedAt": "2024-01-15T12:00:00.000Z"
  }
}
```

**状态码：**

- `200 OK` - 更新成功
- `404 Not Found` - 工作空间或成员不存在
- `403 Forbidden` - 没有权限
- `400 Bad Request` - 不能修改所有者角色

## 移除成员

**接口：** `DELETE /api/v1/workspaces/:workspaceId/members/:userId`

**说明：** 从工作空间中移除成员

**请求头：**

```
Authorization: Bearer <your-access-token>
```

**路径参数：**

| 参数          | 类型   | 说明       |
| ------------- | ------ | ---------- |
| `workspaceId` | string | 工作空间ID |
| `userId`      | string | 用户ID     |

**权限要求：** owner 或 admin

**限制：** 不能移除所有者

**响应示例：**

```json
{
  "success": true,
  "data": {
    "message": "成员已移除"
  }
}
```

**状态码：**

- `200 OK` - 移除成功
- `404 Not Found` - 工作空间不存在
- `403 Forbidden` - 没有权限
- `400 Bad Request` - 不能移除所有者

## 代码示例

### JavaScript / TypeScript

```typescript
// 创建工作空间
async function createWorkspace() {
  const response = await fetch("http://localhost:5200/api/v1/workspaces", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      name: "我的工作空间",
      description: "这是一个工作空间描述",
      icon: "📚",
    }),
  });
  return await response.json();
}

// 获取工作空间列表
async function getWorkspaces() {
  const response = await fetch(
    "http://localhost:5200/api/v1/workspaces?page=1&pageSize=20",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  return await response.json();
}

// 邀请成员
async function inviteMember(workspaceId: string, email: string, role: string) {
  const response = await fetch(
    `http://localhost:5200/api/v1/workspaces/${workspaceId}/members`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ email, role }),
    },
  );
  return await response.json();
}
```
