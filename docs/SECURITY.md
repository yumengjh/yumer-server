# 项目安全机制说明

> 本文档描述当前项目已实现的安全机制，便于开发与审计。详细设计与待办见 [SAFE_DESIGN.md](./SAFE_DESIGN.md)。

---

## 目录

- [一、概述](#一概述)
- [二、认证](#二认证)
- [三、授权与权限](#三授权与权限)
- [四、限流](#四限流)
- [五、输入验证](#五输入验证)
- [六、安全与审计日志](#六安全与审计日志)
- [七、错误处理](#七错误处理)
- [八、CORS 与请求配置](#八cors-与请求配置)
- [九、已实现清单与待加强](#九已实现清单与待加强)

---

## 一、概述

项目采用 **NestJS + PostgreSQL**，在以下方面已落实安全机制：

| 领域        | 机制概要                                                              |
| ----------- | --------------------------------------------------------------------- |
| 认证        | JWT Access/Refresh、bcrypt 密码、会话表、`@Public` 放行登录/注册/刷新 |
| 授权        | JwtAuthGuard 默认、RolesGuard、工作空间/文档/资产级 checkAccess 等    |
| 限流        | Throttler 全局限流（60s/100 次）                                      |
| 输入验证    | 全局 ValidationPipe（whitelist、forbidNonWhitelisted、transform）     |
| 安全 / 审计 | security_logs、audit_logs、@AuditLog、请求/响应脱敏                   |
| 错误与规范  | 全局 HttpExceptionFilter、ErrorCode、BusinessException                |
| 网络与请求  | CORS 可配置、统一 `/api/v1` 前缀                                      |

---

## 二、认证

### 2.1 JWT

- **Access Token**：`jwt.secret`、`jwt.expiresIn`（默认 24h），用于接口鉴权。
- **Refresh Token**：`jwt.refreshSecret`、`jwt.refreshExpiresIn`（默认 7d），仅用于刷新，不访问业务接口。
- 配置来自 `src/config/jwt.config.ts`，可通过 `.env` 覆盖；**生产必须替换默认 secret**。

### 2.2 密码

- **存储**：bcrypt，`SALT_ROUNDS = 10`（`src/common/utils/hash.util.ts`）。
- **注册 / 登录**：仅保存/校验 `passwordHash`，不明文存储或日志输出。

### 2.3 会话

- 登录成功后写入 `sessions` 表：`userId`、`token`、`refreshToken`、`expiresAt`。
- 登出时按 `userId` + `token` 删除对应会话；Refresh 时校验 `refreshToken` 与 `sessions` 一致且未过期。

### 2.4 公开路由

- 使用 `@Public()` 标记不需要 JWT 的接口（注册、登录、刷新）。
- `JwtAuthGuard` 通过 `IS_PUBLIC_KEY` 识别后直接放行，不校验 Token。

**代码位置：**

- `src/common/guards/jwt-auth.guard.ts`
- `src/common/decorators/public.decorator.ts`
- `src/modules/auth/`

---

## 三、授权与权限

### 3.1 守卫层次

1. **ThrottlerGuard**（全局）：先做限流，再进入业务。
2. **JwtAuthGuard**：除 `@Public()` 外，所有接口需有效 JWT；解析后 `request.user` 含 `userId` 等。
3. **RolesGuard**：按 `@Roles(...)` 校验 `user.role`，未配置则放行。当前实现为通用框架，实际角色多来自工作空间成员表。

### 3.2 工作空间级

- `WorkspacesService.checkAccess(workspaceId, userId)`：必须为工作空间成员，否则 `ForbiddenException`。
- `checkEditPermission`：需 `owner` / `admin` / `editor`。
- `checkAdminPermission`：需 `owner` / `admin`（如删除文档、移除成员）。

文档、块、资产等均先通过工作空间权限再细查。

### 3.3 文档级

- `checkDocumentAccess`：在工作空间有权的前提下，再根据 `visibility`：
  - `private`：仅创建者。
  - `workspace`：成员即可。
  - `public`：在 workspace 权限通过后放行。

### 3.4 资产级

- 上传、列表、文件流、删除均先 `checkAccess(workspaceId, userId)`，再按业务逻辑执行。

**代码位置：**

- `src/common/guards/roles.guard.ts`、`src/common/decorators/roles.decorator.ts`
- `src/modules/workspaces/workspaces.service.ts`（`checkAccess`、`checkEditPermission`、`checkAdminPermission`）
- `src/modules/documents/documents.service.ts`（`checkDocumentAccess`、`checkDocumentEditPermission`、`checkDocumentDeletePermission`）
- `src/modules/assets/assets.service.ts`

---

## 四、限流

- **ThrottlerModule**：`ttl: 60000` ms，`limit: 100`，即每 60 秒每客户端最多 100 次请求。
- **ThrottlerGuard**：通过 `APP_GUARD` 全局启用；追踪键默认按 IP 等，具体见 `@nestjs/throttler` 文档。
- 可按路由使用 `@Throttle(limit, ttl)` 收紧、`@SkipThrottle()` 放行（如健康检查、内部回调）。

**代码位置：**

- `src/app.module.ts`（`ThrottlerModule.forRoot`、`APP_GUARD` + `ThrottlerGuard`）

---

## 五、输入验证

- **ValidationPipe（全局）**：
  - `whitelist: true`：丢弃 DTO 未声明字段。
  - `forbidNonWhitelisted: true`：若存在未声明字段，直接 400。
  - `transform: true`：按 DTO 类型自动转换（如字符串 → 数字、布尔）。

- 各接口通过 **class-validator** 在 DTO 上声明 `@IsString()`、`@IsNotEmpty()`、`@MinLength()`、`@MaxLength()`、`@IsOptional()` 等，从源头约束类型与格式。

- 数据库访问统一 **TypeORM 参数化查询**（`createQueryBuilder`、`where :param`），避免拼接 SQL，降低注入风险。

**代码位置：**

- `src/main.ts`（`useGlobalPipes(ValidationPipe(...))`）
- 各模块 `dto/*.dto.ts`

---

## 六、安全与审计日志

### 6.1 安全日志（security_logs）

- **用途**：记录登录、登出、登录失败等安全事件，便于事后审计与风控。
- **写入方**：`SecurityService`。
  - `logLoginSuccess`、`logLoginFailed`、`logLogout`：由 Auth 在登录成功/失败、登出时调用，并写入 `ipAddress`、`userAgent`。
  - `logEvent`、`logUnauthorizedAccess`、`logPermissionDenied`、`logRateLimitExceeded` 等：供守卫、拦截器或业务按需调用。

- **字段**：`logId`、`eventType`、`severity`、`userId`、`email`、`ipAddress`、`userAgent`、`details`、`threatLevel`、`blocked` 等。

- **查询**：`GET /api/v1/security/events`（需 JWT），支持 `eventType`、`userId`、`ip`、`startDate`、`endDate`、分页。

### 6.2 审计日志（audit_logs）

- **用途**：记录重要业务操作（创建、删除、发布等），便于追溯“谁在何时对何资源做了何事”。
- **写入方式**：
  - 在需要审计的接口上使用 `@AuditLog({ action, resourceType, resourceIdKey? })`。
  - 全局 **AuditLogInterceptor** 在成功/失败时调用 `AuditService.record`，写入 `userId`、`username`、`action`、`resourceType`、`resourceId`、`changes`（before/after）、`ipAddress`、`userAgent`、`status`、`errorMessage` 等。

- **脱敏**：`changes` 中的 `password`、`token`、`refreshToken`、`secret`、`passwordHash` 等键会替换为 `***REDACTED***`，避免明文进入审计库。

- **查询**：`GET /api/v1/security/audit`（需 JWT），支持 `userId`、`action`、`resourceType`、`resourceId`、`startDate`、`endDate`、分页。

### 6.3 已挂载 @AuditLog 的接口（示例）

- 文档：`POST /documents`（CREATE）、`DELETE /documents/:docId`（DELETE）。

其他接口可按同样方式挂载 `@AuditLog`。

**代码位置：**

- `src/modules/security/`（`SecurityService`、`AuditService`、`SecurityController`、`AuditLogInterceptor`）
- `src/common/decorators/audit-log.decorator.ts`
- `src/entities/security-log.entity.ts`、`src/entities/audit-log.entity.ts`

---

## 七、错误处理

### 7.1 全局异常过滤器

- **HttpExceptionFilter**：捕获所有未处理异常，统一输出 `{ success: false, error: { code, message, ... } }`。
- 开发环境下可附带 `stack`；生产不暴露堆栈，仅记录到日志（当前为 `console.error`，可按 SAFE_DESIGN 接入文件/第三方日志）。

### 7.2 错误码与业务异常

- **ErrorCode**（`src/common/errors/error-codes.ts`）：按认证、权限、资源、验证、业务、限流、系统等分段，如 `AUTH_1001`、`PERM_2001`、`RATE_6001`。
- **BusinessException**：`new BusinessException(ErrorCode.xxx, message, details?, statusCode)`，便于在过滤器中统一识别 `code` 与 `message`。

可按需在业务中替换 `BadRequestException`、`ForbiddenException` 等为 `BusinessException`，以统一错误形态。

**代码位置：**

- `src/common/filters/http-exception.filter.ts`
- `src/common/errors/error-codes.ts`
- `src/common/exceptions/business.exception.ts`

---

## 八、CORS 与请求配置

- **CORS**：`app.enableCors({ origin, credentials: true, methods, allowedHeaders: ['Content-Type', 'Authorization'] })`，`origin` 来自配置（如 `app.corsOrigin`），生产应限定为前端域名。
- **全局前缀**：`/api/v1`，便于与静态资源、文档路径区分。
- **Swagger**：`/api/docs`，Bearer 认证已在 DocumentBuilder 中配置，便于在文档内带 Token 调试。

**代码位置：**

- `src/main.ts`

---

## 九、已实现清单与待加强

### 9.1 已实现

- [x] JWT 双 Token、会话表、登出删会话
- [x] bcrypt 密码、salt 轮数 10
- [x] @Public、JwtAuthGuard、RolesGuard 框架
- [x] 工作空间 checkAccess / checkEdit / checkAdmin，文档 visibility，资产依 workspace 鉴权
- [x] 全局限流（Throttler 60s/100 次）
- [x] 全局 ValidationPipe（whitelist、forbidNonWhitelisted、transform）
- [x] security_logs、audit_logs 实体与表
- [x] SecurityService 安全事件、AuditService 审计与查询
- [x] @AuditLog + AuditLogInterceptor、敏感字段脱敏
- [x] Auth 登录成功/失败/登出写 security_logs（含 ip、userAgent）
- [x] GET /security/events、GET /security/audit 查询接口（需 JWT）
- [x] ErrorCode、BusinessException
- [x] 全局 HttpExceptionFilter、CORS、API 前缀

### 9.2 待加强（参考 SAFE_DESIGN）

- [ ] **JWT**：生产环境强 secret、Token 黑名单（如 Redis）
- [ ] **密码**：更强策略（长度、大小写+数字+符号）、密码重置与过期
- [ ] **RolesGuard**：与 `WorkspaceMember.role` 打通，按路由细粒度控制
- [ ] **限流**：登录/注册/上传等按路径单独收紧（如 5 次/分钟、3 次/小时）
- [ ] **审计**：为更多敏感操作（移除成员、改权限、发布等）挂 @AuditLog
- [ ] **安全日志**：UNAUTHORIZED_ACCESS、PERMISSION_DENIED、RATE_LIMIT_EXCEEDED 在守卫/拦截器中自动写入
- [ ] **日志系统**：Winston + 按天滚动、访问/错误/安全分文件，生产 JSON 输出
- [ ] **XSS/CSRF**：内容清洗管道、CSRF 中间件（若采用 Cookie 方案）
- [ ] **安全响应头**：Helmet（CSP、HSTS、XSS 等）
- [ ] **敏感数据**：对部分字段加密存储与解密
- [ ] **安全/审计查询**：按角色或工作空间限制可见范围，避免普通用户看全量

---

## 相关文档

- [SAFE_DESIGN.md](./SAFE_DESIGN.md) — 安全与日志的详细设计与 TODO
- [API_DESIGN.md](./API_DESIGN.md) — 接口与数据模型
- [CURRENT_PROGRESS.md](./CURRENT_PROGRESS.md) — 功能与模块完成度
