# Admin Auth 模块设计与实现

## 背景

项目原有两套独立系统：

- **front-end (next.js)** + **back/server** — 面向普通用户的个人知识库
- **back/admin (vue pure-admin)** — 面向管理员的后台管理面板，原先对接 **back/server-old**

目标：将 admin 前端迁移到新的 **back/server** 后端，实现 admin 登录功能，同时保持两套用户系统完全隔离。

## 设计决策

### 1. 独立的 admins 表（而非共用 users 表）

**原因：**
- admin 面板和普通用户系统职责不同，未来 admin 会走 RBAC 权限分层
- admin 令牌不应能访问普通用户功能（创建文档、修改块等）
- 两套系统的字段需求不同（admin 需要 `role`、`permissions`，user 需要 `email`、`bio` 等）

**方案：** 新建 `admins` 实体/表，与 `users` 表完全独立。

### 2. 独立的 JWT 密钥

**原因：**
- 如果共用同一个 JWT_SECRET，即使 payload 不同，理论上令牌可以互相通过验证
- 使用不同密钥从密码学层面保证互斥

**方案：**
- 普通用户：`JWT_SECRET` + `REFRESH_TOKEN_SECRET`
- 管理员：`ADMIN_JWT_SECRET` + `ADMIN_REFRESH_TOKEN_SECRET`（默认回退到 `ADMIN_JWT_SECRET`）

### 3. 独立的 Passport 策略名称

- 普通用户策略：`jwt`（默认名称）
- 管理员策略：`admin-jwt`（自定义名称）

各自使用 `AuthGuard('jwt')` 和 `AuthGuard('admin-jwt')`，Passport 按策略名称路由到对应的验证逻辑。

### 4. RBAC 预留设计

`admins` 表包含两个权限字段：
- `role`（varchar）— 角色标识，如 `super_admin`、`admin`、`editor`、`viewer`
- `permissions`（JSON 数组）— 细粒度权限，如 `["guestbook:read", "guestbook:write", "users:manage"]`

默认管理员角色为 `super_admin`，权限为 `["*"]`（通配符，表示全部权限）。

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│                   back/server                        │
│                                                      │
│  ┌──────────────┐          ┌──────────────────┐     │
│  │  AuthModule   │          │  AdminAuthModule  │     │
│  │              │          │                  │     │
│  │  users 表    │          │  admins 表       │     │
│  │  JWT_SECRET  │          │  ADMIN_JWT_SECRET│     │
│  │  策略: jwt   │          │  策略: admin-jwt │     │
│  └──────┬───────┘          └────────┬─────────┘     │
│         │                           │                │
│  ┌──────┴───────┐          ┌────────┴─────────┐     │
│  │ JwtAuthGuard  │          │ AdminJwtAuthGuard │     │
│  │ (AuthGuard   │          │ (AuthGuard       │     │
│  │  ('jwt'))    │          │  ('admin-jwt'))  │     │
│  └──────────────┘          └──────────────────┘     │
│                                                      │
│  Token 验证流程：                                     │
│  admin 令牌 → AdminJwtAuthGuard → ADMIN_JWT_SECRET   │
│                                   → 查 admins 表     │
│                                   → request.user =   │
│                                     { adminId, role } │
│                                                      │
│  user 令牌 → JwtAuthGuard → JWT_SECRET               │
│                              → 查 users 表           │
│                              → request.user =        │
│                                { userId, email }     │
└─────────────────────────────────────────────────────┘
```

## 数据库设计

### admins 表结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | integer PK | 自增主键 |
| `adminId` | varchar(50) UNIQUE | 业务 ID，格式 `adm_{timestamp}_{uuid}` |
| `username` | varchar(50) UNIQUE | 登录用户名 |
| `passwordHash` | varchar | bcrypt 加密密码 |
| `displayName` | varchar(100) | 显示名称 |
| `avatar` | varchar | 头像 URL |
| `status` | varchar, default 'active' | 状态：active / disabled |
| `role` | varchar, default 'admin' | 角色标识（RBAC） |
| `permissions` | JSON, default '["*"]' | 细粒度权限数组（RBAC） |
| `createdAt` | datetime | 创建时间 |
| `updatedAt` | datetime | 更新时间 |
| `lastLoginAt` | datetime | 最后登录时间 |

### RBAC 扩展预留

当前 `role` 为单字符串，`permissions` 为 JSON 数组。后续可扩展为：

```
role: 'super_admin' | 'admin' | 'editor' | 'viewer'
permissions: ['guestbook:read', 'guestbook:write', 'users:manage', ...]
```

权限校验逻辑可后续在守卫或装饰器中实现，当前仅存储不做校验。

## API 端点

所有端点挂载在 `/api/v1/admin/` 路径下。

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/v1/admin/login` | 无 | 管理员登录 |
| POST | `/api/v1/admin/refresh-token` | 无 | 刷新令牌 |
| GET | `/api/v1/admin/get-async-routes` | Admin JWT | 获取动态路由（当前返回空数组） |

### 登录请求

```
POST /api/v1/admin/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123"
}
```

### 登录响应

```json
{
  "success": true,
  "data": {
    "avatar": "",
    "username": "admin",
    "nickname": "管理员",
    "roles": ["super_admin"],
    "permissions": ["*"],
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expires": "2026/5/11 22:20:48"
  }
}
```

### 刷新令牌请求

```
POST /api/v1/admin/refresh-token
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

### 刷新令牌响应

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "expires": "2026/5/11 22:20:48"
  }
}
```

## 文件清单

### 新建文件

```
src/entities/admin.entity.ts                          # Admin 实体
src/modules/admin-auth/admin-auth.module.ts            # 模块定义
src/modules/admin-auth/admin-auth.controller.ts        # 控制器（3 个端点）
src/modules/admin-auth/admin-auth.service.ts           # 服务（登录、刷新、种子用户）
src/modules/admin-auth/dto/admin-login.dto.ts          # 登录 DTO
src/modules/admin-auth/strategies/admin-jwt.strategy.ts # JWT 策略（admin-jwt）
src/modules/admin-auth/guards/admin-jwt.guard.ts       # JWT 守卫
```

### 修改文件

```
src/app.module.ts                  # 注册 Admin 实体 + AdminAuthModule
src/config/jwt.config.ts           # 添加 adminSecret / adminExpiresIn 等配置
src/common/utils/id-generator.util.ts  # 添加 generateAdminId()
.env                               # 添加 ADMIN_JWT_SECRET 等环境变量
.env.example                       # 同步添加
```

### Admin 前端修改

```
back/admin/.env.development        # VITE_API_BASE_URL → http://localhost:5200/api/v1/admin
back/admin/src/api/user.ts         # 路径去掉 /api 前缀
back/admin/src/api/routes.ts       # 同上
back/admin/src/api/request.ts      # 白名单同步更新
```

## 隔离验证

```bash
# 1. 获取 admin 令牌
curl -s 'http://localhost:5200/api/v1/admin/login' \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'

# 2. 用 admin 令牌访问 user 端点 → 401 Unauthorized
curl -s 'http://localhost:5200/api/v1/auth/me' \
  -H "Authorization: Bearer <admin-token>"
# → {"success":false,"error":{"code":"INTERNAL_ERROR","message":"Unauthorized"}}
```

两套 JWT 使用不同密钥 + 不同 payload（`adminId` vs `userId`），从密码学和业务逻辑两个层面保证完全互斥。

## 后续扩展方向

1. **RBAC 权限校验** — 在守卫或装饰器中基于 `role` 和 `permissions` 做细粒度鉴权
2. **管理员 CRUD** — 添加管理员的增删改查接口（仅 super_admin 可操作）
3. **操作审计** — 记录管理员操作日志
4. **留言管理** — 对接 guestbook 模块的管理端 API
