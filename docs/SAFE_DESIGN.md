# 安全与日志系统设计文档

<!-- 代办 -->

## 目录

- [日志系统设计](#日志系统设计)
- [安全机制设计](#安全机制设计)
- [监控与审计](#监控与审计)
- [错误处理](#错误处理)
- [TODO 清单](#todo-清单)

---

## 日志系统设计

### 1. 日志分类

#### 1.1 应用日志 (Application Logs)

**日志级别：**

- `ERROR` - 错误，需要立即关注
- `WARN` - 警告，可能存在问题
- `INFO` - 信息，重要的业务流程
- `DEBUG` - 调试，详细的执行信息
- `VERBOSE` - 详细，最详细的日志

**日志内容：**

```typescript
{
  timestamp: '2026-01-17T10:30:00.123Z',
  level: 'INFO',
  context: 'DocumentsService',
  message: 'Document created successfully',
  metadata: {
    userId: 'u_user001',
    docId: 'doc_abc123',
    workspaceId: 'ws_xyz123',
    duration: 45, // ms
  },
  trace: 'trace-id-uuid',
}
```

#### 1.2 访问日志 (Access Logs)

记录所有 HTTP 请求：

```typescript
{
  timestamp: '2026-01-17T10:30:00.123Z',
  method: 'POST',
  url: '/api/v1/documents',
  statusCode: 201,
  responseTime: 123, // ms
  ip: '192.168.1.100',
  userAgent: 'Mozilla/5.0...',
  userId: 'u_user001',
  requestId: 'req-uuid-123',
  requestBody: { /* 敏感字段已脱敏 */ },
  responseBody: { /* 响应摘要 */ },
}
```

#### 1.3 安全日志 (Security Logs)

记录安全相关事件：

```typescript
{
  timestamp: '2026-01-17T10:30:00.123Z',
  event: 'LOGIN_FAILED',
  level: 'WARN',
  userId: 'u_user001',
  email: 'user@example.com',
  ip: '192.168.1.100',
  reason: 'Invalid password',
  attempts: 3,
  blocked: false,
}
```

**安全事件类型：**

- `LOGIN_SUCCESS` - 登录成功
- `LOGIN_FAILED` - 登录失败
- `LOGOUT` - 登出
- `PASSWORD_CHANGED` - 密码修改
- `TOKEN_EXPIRED` - Token 过期
- `UNAUTHORIZED_ACCESS` - 未授权访问
- `PERMISSION_DENIED` - 权限拒绝
- `RATE_LIMIT_EXCEEDED` - 超过限流
- `SUSPICIOUS_ACTIVITY` - 可疑活动

#### 1.4 审计日志 (Audit Logs)

存储在数据库中，记录重要的业务操作：

```sql
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  log_id VARCHAR(50) UNIQUE NOT NULL,

  -- 基本信息
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  user_id VARCHAR(50),
  username VARCHAR(50),

  -- 操作信息
  action VARCHAR(50) NOT NULL,          -- CREATE, UPDATE, DELETE, PUBLISH, etc.
  resource_type VARCHAR(50) NOT NULL,   -- document, block, workspace, user
  resource_id VARCHAR(50) NOT NULL,

  -- 详细信息
  changes JSONB,                        -- 变更内容 (before/after)
  metadata JSONB DEFAULT '{}',

  -- 请求信息
  ip_address VARCHAR(45),
  user_agent TEXT,
  request_id VARCHAR(50),

  -- 结果
  status VARCHAR(20),                   -- success, failed
  error_message TEXT,

  -- 索引
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- 索引
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id, timestamp DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
```

#### 1.5 性能日志 (Performance Logs)

```typescript
{
  timestamp: '2026-01-17T10:30:00.123Z',
  type: 'SLOW_QUERY',
  query: 'SELECT * FROM documents WHERE...',
  duration: 5234, // ms
  threshold: 1000, // ms
  context: 'DocumentsService.findAll',
}
```

#### 1.6 错误日志 (Error Logs)

```typescript
{
  timestamp: '2026-01-17T10:30:00.123Z',
  level: 'ERROR',
  message: 'Database connection failed',
  stack: 'Error: Connection timeout\n  at...',
  context: 'DatabaseModule',
  metadata: {
    host: 'localhost',
    port: 5432,
    database: 'knowledge_base',
  },
  requestId: 'req-uuid-123',
  userId: 'u_user001',
}
```

### 2. 日志存储策略

#### 2.1 文件存储

```
logs/
├── application/
│   ├── app-2026-01-17.log          # 应用日志（按天滚动）
│   ├── app-2026-01-16.log
│   └── app-2026-01-15.log
├── access/
│   ├── access-2026-01-17.log       # 访问日志
│   └── access-2026-01-16.log
├── error/
│   ├── error-2026-01-17.log        # 错误日志
│   └── error-2026-01-16.log
└── security/
    ├── security-2026-01-17.log     # 安全日志
    └── security-2026-01-16.log
```

**配置：**

```typescript
// src/config/logger.config.ts
import { WinstonModuleOptions } from "nest-winston";
import * as winston from "winston";
import "winston-daily-rotate-file";

export const loggerConfig: WinstonModuleOptions = {
  transports: [
    // 应用日志
    new winston.transports.DailyRotateFile({
      dirname: "logs/application",
      filename: "app-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "30d",
      level: "info",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
    }),

    // 错误日志
    new winston.transports.DailyRotateFile({
      dirname: "logs/error",
      filename: "error-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "90d",
      level: "error",
    }),

    // 控制台输出（开发环境）
    new winston.transports.Console({
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.printf(
          ({ timestamp, level, message, context, ...meta }) => {
            return `${timestamp} [${context}] ${level}: ${message} ${
              Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ""
            }`;
          },
        ),
      ),
    }),
  ],
};
```

#### 2.2 数据库存储

重要的业务日志存储在数据库中：

- **审计日志** - `audit_logs` 表
- **活动日志** - `activities` 表（已存在）
- **安全日志** - `security_logs` 表

```sql
-- 安全日志表
CREATE TABLE security_logs (
  id SERIAL PRIMARY KEY,
  log_id VARCHAR(50) UNIQUE NOT NULL,

  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  event_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL,      -- low, medium, high, critical

  user_id VARCHAR(50),
  email VARCHAR(100),
  ip_address VARCHAR(45) NOT NULL,
  user_agent TEXT,

  details JSONB DEFAULT '{}',

  -- 威胁信息
  threat_level VARCHAR(20),           -- none, low, medium, high
  blocked BOOLEAN DEFAULT FALSE,

  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX idx_security_logs_timestamp ON security_logs(timestamp DESC);
CREATE INDEX idx_security_logs_event_type ON security_logs(event_type);
CREATE INDEX idx_security_logs_user_id ON security_logs(user_id);
CREATE INDEX idx_security_logs_ip ON security_logs(ip_address);
CREATE INDEX idx_security_logs_severity ON security_logs(severity);
```

### 3. 日志实现

#### 3.1 自定义 Logger Service

```typescript
// src/common/logger/logger.service.ts
import { Injectable, LoggerService as NestLoggerService } from "@nestjs/common";
import { createLogger, Logger as WinstonLogger, format } from "winston";
import * as DailyRotateFile from "winston-daily-rotate-file";

@Injectable()
export class LoggerService implements NestLoggerService {
  private logger: WinstonLogger;
  private context?: string;

  constructor(context?: string) {
    this.context = context;
    this.logger = createLogger({
      level: process.env.LOG_LEVEL || "info",
      format: format.combine(
        format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        format.errors({ stack: true }),
        format.json(),
      ),
      defaultMeta: { service: "knowledge-base-api" },
      transports: [
        // 应用日志
        new DailyRotateFile({
          dirname: "logs/application",
          filename: "app-%DATE%.log",
          datePattern: "YYYY-MM-DD",
          maxSize: "20m",
          maxFiles: "30d",
        }),
        // 错误日志
        new DailyRotateFile({
          dirname: "logs/error",
          filename: "error-%DATE%.log",
          datePattern: "YYYY-MM-DD",
          maxSize: "20m",
          maxFiles: "90d",
          level: "error",
        }),
        // 控制台
        new (require("winston").transports.Console)({
          format: format.combine(
            format.colorize(),
            format.printf(({ timestamp, level, message, context, ...meta }) => {
              const ctx = context || this.context || "Application";
              const metaStr = Object.keys(meta).length
                ? JSON.stringify(meta)
                : "";
              return `${timestamp} [${ctx}] ${level}: ${message} ${metaStr}`;
            }),
          ),
        }),
      ],
    });
  }

  log(message: string, context?: string) {
    this.logger.info(message, { context: context || this.context });
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error(message, { trace, context: context || this.context });
  }

  warn(message: string, context?: string) {
    this.logger.warn(message, { context: context || this.context });
  }

  debug(message: string, context?: string) {
    this.logger.debug(message, { context: context || this.context });
  }

  verbose(message: string, context?: string) {
    this.logger.verbose(message, { context: context || this.context });
  }

  // 自定义方法
  logWithMetadata(
    level: string,
    message: string,
    metadata: Record<string, any>,
  ) {
    this.logger.log(level, message, { ...metadata, context: this.context });
  }
}
```

#### 3.2 访问日志拦截器

```typescript
// src/common/interceptors/logging.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { LoggerService } from "../logger/logger.service";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, headers, ip } = request;
    const userAgent = headers["user-agent"] || "";
    const userId = request.user?.userId || "anonymous";

    const now = Date.now();
    const requestId = this.generateRequestId();

    // 请求日志
    this.logger.log(`Incoming Request: ${method} ${url}`, "HTTP");

    return next.handle().pipe(
      tap({
        next: (data) => {
          const response = context.switchToHttp().getResponse();
          const { statusCode } = response;
          const responseTime = Date.now() - now;

          // 访问日志
          this.logger.logWithMetadata("info", "Request completed", {
            requestId,
            method,
            url,
            statusCode,
            responseTime,
            ip,
            userAgent,
            userId,
            // 脱敏处理
            body: this.sanitizeBody(body),
          });

          // 慢查询警告
          if (responseTime > 1000) {
            this.logger.warn(
              `Slow request detected: ${method} ${url} took ${responseTime}ms`,
              "Performance",
            );
          }
        },
        error: (error) => {
          const responseTime = Date.now() - now;
          this.logger.error(
            `Request failed: ${method} ${url}`,
            error.stack,
            "HTTP",
          );
        },
      }),
    );
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private sanitizeBody(body: any): any {
    if (!body) return body;

    const sanitized = { ...body };
    const sensitiveFields = ["password", "token", "refreshToken", "secret"];

    sensitiveFields.forEach((field) => {
      if (sanitized[field]) {
        sanitized[field] = "***REDACTED***";
      }
    });

    return sanitized;
  }
}
```

#### 3.3 审计日志装饰器

```typescript
// src/common/decorators/audit-log.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const AUDIT_LOG_KEY = 'audit_log';

export interface AuditLogOptions {
  action: string;
  resourceType: string;
}

export const AuditLog = (options: AuditLogOptions) =>
  SetMetadata(AUDIT_LOG_KEY, options);

// 使用示例
@Post()
@AuditLog({ action: 'CREATE', resourceType: 'document' })
async createDocument(@Body() dto: CreateDocumentDto) {
  // ...
}
```

#### 3.4 审计日志拦截器

```typescript
// src/common/interceptors/audit-log.interceptor.ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuditLog } from "../../entities/audit-log.entity";
import { AUDIT_LOG_KEY } from "../decorators/audit-log.decorator";

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditOptions = this.reflector.get(
      AUDIT_LOG_KEY,
      context.getHandler(),
    );

    if (!auditOptions) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const { user, ip, headers, body } = request;
    const userAgent = headers["user-agent"];

    return next.handle().pipe(
      tap({
        next: async (data) => {
          const auditLog = this.auditLogRepository.create({
            logId: this.generateLogId(),
            userId: user?.userId,
            username: user?.username,
            action: auditOptions.action,
            resourceType: auditOptions.resourceType,
            resourceId: data?.id || data?.docId || body?.id,
            changes: this.extractChanges(body, data),
            metadata: {
              method: request.method,
              url: request.url,
            },
            ipAddress: ip,
            userAgent,
            status: "success",
          });

          await this.auditLogRepository.save(auditLog);
        },
        error: async (error) => {
          const auditLog = this.auditLogRepository.create({
            logId: this.generateLogId(),
            userId: user?.userId,
            username: user?.username,
            action: auditOptions.action,
            resourceType: auditOptions.resourceType,
            resourceId: body?.id,
            ipAddress: ip,
            userAgent,
            status: "failed",
            errorMessage: error.message,
          });

          await this.auditLogRepository.save(auditLog);
        },
      }),
    );
  }

  private generateLogId(): string {
    return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private extractChanges(before: any, after: any): any {
    return {
      before: this.sanitize(before),
      after: this.sanitize(after),
    };
  }

  private sanitize(obj: any): any {
    if (!obj) return obj;
    const sanitized = { ...obj };
    delete sanitized.password;
    delete sanitized.token;
    return sanitized;
  }
}
```

### 4. 控制台输出设计

#### 4.1 开发环境控制台

```typescript
// 彩色输出，详细信息
[2026-01-17 10:30:00] [DocumentsService] INFO: Document created successfully {
  userId: "u_user001",
  docId: "doc_abc123",
  duration: 45
}

[2026-01-17 10:30:05] [AuthService] ERROR: Login failed {
  email: "user@example.com",
  reason: "Invalid password",
  attempts: 3
}

[2026-01-17 10:30:10] [HTTP] WARN: Slow request detected: POST /api/v1/documents took 1234ms
```

#### 4.2 生产环境控制台

```typescript
// JSON 格式，便于日志收集
{"timestamp":"2026-01-17T10:30:00.123Z","level":"info","message":"Document created successfully","context":"DocumentsService","metadata":{"userId":"u_user001","docId":"doc_abc123"}}

{"timestamp":"2026-01-17T10:30:05.456Z","level":"error","message":"Login failed","context":"AuthService","metadata":{"email":"user@example.com","reason":"Invalid password"}}
```

#### 4.3 启动信息

```typescript
// src/main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new LoggerService("Bootstrap"),
  });

  const logger = app.get(LoggerService);

  // 应用配置
  app.setGlobalPrefix("api/v1");
  app.enableCors();

  // 启动应用
  const port = process.env.PORT || 3000;
  await app.listen(port);

  // 启动日志
  logger.log(
    `
  ╔════════════════════════════════════════════════╗
  ║   Knowledge Base API Server Started            ║
  ╠════════════════════════════════════════════════╣
  ║   Environment: ${process.env.NODE_ENV}
  ║   Port: ${port}
  ║   API URL: http://localhost:${port}/api/v1
  ║   API Docs: http://localhost:${port}/api/docs
  ║   Database: ${process.env.DB_HOST}:${process.env.DB_PORT}
  ╚════════════════════════════════════════════════╝
  `,
    "Bootstrap",
  );
}
```

---

## 安全机制设计

### 1. 认证与授权

#### 1.1 JWT 认证

**Token 结构：**

```typescript
{
  // Payload
  userId: 'u_user001',
  email: 'user@example.com',
  username: 'john',
  iat: 1705449600,  // 签发时间
  exp: 1705536000,  // 过期时间
}
```

**Token 配置：**

```typescript
// .env
JWT_SECRET=your-super-secret-key-min-32-chars
JWT_EXPIRES_IN=24h
REFRESH_TOKEN_SECRET=your-refresh-token-secret
REFRESH_TOKEN_EXPIRES_IN=7d
```

**安全措施：**

- ✅ 使用强密钥（至少 32 字符）
- ✅ Access Token 短期有效（1-24小时）
- ✅ Refresh Token 长期有效（7-30天）
- ✅ Token 存储在 HTTP-only Cookie（可选）
- ✅ Token 黑名单机制（登出后失效）

#### 1.2 密码安全

```typescript
// src/common/utils/hash.util.ts
import * as bcrypt from "bcrypt";

export class HashUtil {
  private static readonly SALT_ROUNDS = 10;

  // 加密密码
  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  // 验证密码
  static async comparePassword(
    password: string,
    hash: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  // 内容哈希（用于块去重）
  static hashContent(content: string): string {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(content).digest("hex");
  }
}
```

**密码策略：**

```typescript
// src/modules/auth/dto/register.dto.ts
import { IsString, IsEmail, MinLength, Matches } from "class-validator";

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: "密码至少需要 8 个字符" })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/, {
    message: "密码必须包含大小写字母和数字",
  })
  password: string;

  @IsString()
  @MinLength(3)
  username: string;
}
```

#### 1.3 会话管理

```typescript
// src/modules/auth/auth.service.ts
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
    private jwtService: JwtService,
  ) {}

  async login(user: User, deviceInfo: any) {
    const payload = {
      userId: user.userId,
      email: user.email,
      username: user.username,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.REFRESH_TOKEN_SECRET,
      expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN,
    });

    // 创建会话
    const session = this.sessionRepository.create({
      sessionId: this.generateSessionId(),
      userId: user.userId,
      token: accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      deviceInfo,
    });

    await this.sessionRepository.save(session);

    return {
      accessToken,
      refreshToken,
      expiresIn: 86400,
    };
  }

  async logout(token: string) {
    // 删除会话
    await this.sessionRepository.delete({ token });

    // 可选：加入黑名单
    // await this.redisService.set(`blacklist:${token}`, '1', 'EX', 86400);
  }

  async validateToken(token: string): Promise<boolean> {
    // 检查是否在黑名单
    // const isBlacklisted = await this.redisService.get(`blacklist:${token}`);
    // if (isBlacklisted) return false;

    const session = await this.sessionRepository.findOne({ where: { token } });
    return !!session && new Date() < session.expiresAt;
  }
}
```

### 2. 权限控制

#### 2.1 角色定义

```typescript
// src/common/enums/role.enum.ts
export enum Role {
  OWNER = "owner", // 工作空间所有者
  ADMIN = "admin", // 管理员
  EDITOR = "editor", // 编辑者
  VIEWER = "viewer", // 查看者
}

export const RolePermissions = {
  [Role.OWNER]: [
    "workspace:delete",
    "workspace:update",
    "workspace:invite",
    "workspace:remove_member",
    "document:*",
    "block:*",
  ],
  [Role.ADMIN]: [
    "workspace:update",
    "workspace:invite",
    "document:*",
    "block:*",
  ],
  [Role.EDITOR]: [
    "document:create",
    "document:update",
    "document:delete",
    "block:*",
  ],
  [Role.VIEWER]: ["document:read", "block:read"],
};
```

#### 2.2 权限守卫

```typescript
// src/common/guards/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { Role } from "../enums/role.enum";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private workspaceMembersService: WorkspaceMembersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const workspaceId = request.params.workspaceId || request.body.workspaceId;

    if (!workspaceId) {
      return false;
    }

    const member = await this.workspaceMembersService.findMember(
      workspaceId,
      user.userId,
    );

    if (!member) {
      return false;
    }

    return requiredRoles.some((role) => member.role === role);
  }
}
```

#### 2.3 资源级权限

```typescript
// src/common/guards/document-permission.guard.ts
@Injectable()
export class DocumentPermissionGuard implements CanActivate {
  constructor(
    private documentsService: DocumentsService,
    private workspaceMembersService: WorkspaceMembersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const docId = request.params.docId;

    // 获取文档
    const document = await this.documentsService.findOne(docId);
    if (!document) {
      throw new NotFoundException("Document not found");
    }

    // 检查工作空间权限
    const member = await this.workspaceMembersService.findMember(
      document.workspaceId,
      user.userId,
    );

    if (!member) {
      return false;
    }

    // 检查文档可见性
    if (
      document.visibility === "private" &&
      document.createdBy !== user.userId
    ) {
      return false;
    }

    // 检查操作权限
    const method = request.method;
    if (method === "GET") {
      return true; // 有工作空间权限即可读取
    }

    if (method === "PATCH" || method === "DELETE") {
      return ["owner", "admin", "editor"].includes(member.role);
    }

    return true;
  }
}
```

### 3. 限流保护

#### 3.1 全局限流

```typescript
// app.module.ts
import { ThrottlerModule } from "@nestjs/throttler";

@Module({
  imports: [
    ThrottlerModule.forRoot({
      ttl: 60, // 时间窗口：60秒
      limit: 100, // 最大请求数：100次
    }),
  ],
})
export class AppModule {}
```

#### 3.2 自定义限流

```typescript
// src/common/guards/custom-throttler.guard.ts
import { ThrottlerGuard } from "@nestjs/throttler";
import { Injectable } from "@nestjs/common";

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // 使用用户ID + IP 作为限流标识
    const userId = req.user?.userId || "anonymous";
    const ip = req.ip;
    return `${userId}-${ip}`;
  }

  protected async handleRequest(
    context: ExecutionContext,
    limit: number,
    ttl: number,
  ): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const key = await this.getTracker(request);

    // 特殊接口限流
    const url = request.url;
    if (url.includes("/auth/login")) {
      limit = 5; // 登录接口：5次/分钟
      ttl = 60;
    } else if (url.includes("/auth/register")) {
      limit = 3; // 注册接口：3次/小时
      ttl = 3600;
    } else if (url.includes("/assets/upload")) {
      limit = 10; // 上传接口：10次/小时
      ttl = 3600;
    }

    return super.handleRequest(context, limit, ttl);
  }
}
```

#### 3.3 限流装饰器

```typescript
// src/common/decorators/throttle.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const THROTTLE_KEY = 'throttle';

export const Throttle = (limit: number, ttl: number) =>
  SetMetadata(THROTTLE_KEY, { limit, ttl });

// 使用示例
@Post('login')
@Throttle(5, 60)  // 5次/分钟
async login(@Body() dto: LoginDto) {
  // ...
}
```

### 4. 输入验证

#### 4.1 DTO 验证

```typescript
// src/modules/documents/dto/create-document.dto.ts
import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  IsOptional,
  IsArray,
  ArrayMaxSize,
} from "class-validator";

export class CreateDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @IsString()
  @IsNotEmpty()
  workspaceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  icon?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  tags?: string[];
}
```

#### 4.2 自定义验证器

```typescript
// src/common/validators/is-valid-id.validator.ts
import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";

@ValidatorConstraint({ async: false })
export class IsValidIdConstraint implements ValidatorConstraintInterface {
  validate(id: string) {
    // 验证 ID 格式：prefix_timestamp_random
    const pattern = /^(u|ws|doc|b)_\d+_[a-z0-9]{7}$/;
    return pattern.test(id);
  }

  defaultMessage() {
    return "Invalid ID format";
  }
}

export function IsValidId(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsValidIdConstraint,
    });
  };
}
```

#### 4.3 全局验证管道

```typescript
// main.ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true, // 自动删除非白名单属性
    forbidNonWhitelisted: true, // 如果有非白名单属性，抛出错误
    transform: true, // 自动类型转换
    transformOptions: {
      enableImplicitConversion: true,
    },
    exceptionFactory: (errors) => {
      // 自定义错误格式
      const messages = errors.map((error) => ({
        field: error.property,
        errors: Object.values(error.constraints || {}),
      }));
      return new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: messages,
      });
    },
  }),
);
```

### 5. SQL 注入防护

```typescript
// ✅ 正确：使用参数化查询
const documents = await this.documentRepository
  .createQueryBuilder("doc")
  .where("doc.workspaceId = :workspaceId", { workspaceId })
  .andWhere("doc.title LIKE :title", { title: `%${searchTerm}%` })
  .getMany();

// ❌ 错误：字符串拼接
const documents = await this.documentRepository.query(
  `SELECT * FROM documents WHERE workspace_id = '${workspaceId}'`,
);
```

### 6. XSS 防护

```typescript
// src/common/pipes/sanitize.pipe.ts
import { PipeTransform, Injectable } from "@nestjs/common";
import * as sanitizeHtml from "sanitize-html";

@Injectable()
export class SanitizePipe implements PipeTransform {
  transform(value: any) {
    if (typeof value === "string") {
      return sanitizeHtml(value, {
        allowedTags: [],
        allowedAttributes: {},
      });
    }

    if (typeof value === "object") {
      Object.keys(value).forEach((key) => {
        value[key] = this.transform(value[key]);
      });
    }

    return value;
  }
}
```

### 7. CSRF 防护

```typescript
// app.module.ts
import * as csurf from "csurf";

// main.ts
app.use(csurf({ cookie: true }));
```

### 8. CORS 配置

```typescript
// main.ts
app.enableCors({
  origin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:3000"],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  exposedHeaders: ["X-Total-Count", "X-Page-Size"],
  maxAge: 3600,
});
```

### 9. 敏感数据加密

```typescript
// src/common/utils/encryption.util.ts
import * as crypto from "crypto";

export class EncryptionUtil {
  private static readonly ALGORITHM = "aes-256-gcm";
  private static readonly KEY = Buffer.from(process.env.ENCRYPTION_KEY, "hex");

  static encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.ALGORITHM, this.KEY, iv);

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    const authTag = cipher.getAuthTag();

    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
  }

  static decrypt(encryptedData: string): string {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(":");

    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = crypto.createDecipheriv(this.ALGORITHM, this.KEY, iv);

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }
}
```

### 10. 安全响应头

```typescript
// main.ts
import helmet from "helmet";

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    noSniff: true,
    xssFilter: true,
    hidePoweredBy: true,
  }),
);
```

---

## 监控与审计

### 1. 健康检查

```typescript
// src/health/health.controller.ts
import { Controller, Get } from "@nestjs/common";
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from "@nestjs/terminus";

@Controller("health")
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.db.pingCheck("database")]);
  }

  @Get("ready")
  @HealthCheck()
  ready() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  }
}
```

### 2. 性能监控

```typescript
// src/common/interceptors/performance.interceptor.ts
@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  constructor(private logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const now = Date.now();
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - now;

        // 记录性能指标
        if (duration > 1000) {
          this.logger.warn(
            `Slow request: ${method} ${url} took ${duration}ms`,
            "Performance",
          );
        }

        // 可以发送到监控服务
        // this.metricsService.recordRequestDuration(method, url, duration);
      }),
    );
  }
}
```

### 3. 错误追踪

```typescript
// src/common/filters/sentry.filter.ts
import * as Sentry from "@sentry/node";

@Catch()
export class SentryFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    // 发送到 Sentry
    Sentry.captureException(exception);

    // 继续正常的错误处理
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception.getStatus?.() || 500;

    response.status(status).json({
      success: false,
      error: {
        code: exception.code || "INTERNAL_ERROR",
        message: exception.message,
      },
    });
  }
}
```

### 4. 审计查询

```typescript
// src/modules/audit/audit.service.ts
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
  ) {}

  // 查询用户操作历史
  async findUserActivities(userId: string, options: QueryOptions) {
    return this.auditLogRepository.find({
      where: { userId },
      order: { timestamp: "DESC" },
      skip: options.offset,
      take: options.limit,
    });
  }

  // 查询资源操作历史
  async findResourceHistory(resourceType: string, resourceId: string) {
    return this.auditLogRepository.find({
      where: { resourceType, resourceId },
      order: { timestamp: "DESC" },
    });
  }

  // 查询敏感操作
  async findSensitiveActions(startDate: Date, endDate: Date) {
    const sensitiveActions = ["DELETE", "UPDATE_PERMISSION", "REMOVE_MEMBER"];

    return this.auditLogRepository.find({
      where: {
        action: In(sensitiveActions),
        timestamp: Between(startDate, endDate),
      },
      order: { timestamp: "DESC" },
    });
  }
}
```

---

## 错误处理

### 1. 错误代码规范

```typescript
// src/common/errors/error-codes.ts
export enum ErrorCode {
  // 认证错误 (1000-1999)
  AUTH_FAILED = "AUTH_1001",
  TOKEN_EXPIRED = "AUTH_1002",
  TOKEN_INVALID = "AUTH_1003",
  UNAUTHORIZED = "AUTH_1004",
  SESSION_EXPIRED = "AUTH_1005",

  // 权限错误 (2000-2999)
  ACCESS_DENIED = "PERM_2001",
  PERMISSION_DENIED = "PERM_2002",
  ROLE_REQUIRED = "PERM_2003",

  // 资源错误 (3000-3999)
  NOT_FOUND = "RES_3001",
  ALREADY_EXISTS = "RES_3002",
  RESOURCE_LOCKED = "RES_3003",

  // 验证错误 (4000-4999)
  VALIDATION_ERROR = "VAL_4001",
  INVALID_PARAMETER = "VAL_4002",
  MISSING_PARAMETER = "VAL_4003",

  // 业务错误 (5000-5999)
  VERSION_CONFLICT = "BIZ_5001",
  QUOTA_EXCEEDED = "BIZ_5002",
  OPERATION_FAILED = "BIZ_5003",

  // 限流错误 (6000-6999)
  RATE_LIMIT_EXCEEDED = "RATE_6001",
  TOO_MANY_REQUESTS = "RATE_6002",

  // 服务器错误 (9000-9999)
  INTERNAL_ERROR = "SYS_9001",
  DATABASE_ERROR = "SYS_9002",
  SERVICE_UNAVAILABLE = "SYS_9003",
}
```

### 2. 自定义异常

```typescript
// src/common/exceptions/business.exception.ts
import { HttpException, HttpStatus } from "@nestjs/common";
import { ErrorCode } from "../errors/error-codes";

export class BusinessException extends HttpException {
  constructor(
    code: ErrorCode,
    message: string,
    details?: any,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(
      {
        success: false,
        error: {
          code,
          message,
          details,
        },
      },
      statusCode,
    );
  }
}

// 使用示例
throw new BusinessException(
  ErrorCode.QUOTA_EXCEEDED,
  "Workspace document limit exceeded",
  { limit: 1000, current: 1000 },
);
```

### 3. 全局异常过滤器

```typescript
// src/common/filters/all-exceptions.filter.ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = ErrorCode.INTERNAL_ERROR;
    let message = "Internal server error";
    let details = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse() as any;
      code = exceptionResponse.error?.code || code;
      message = exceptionResponse.error?.message || exception.message;
      details = exceptionResponse.error?.details;
    }

    // 记录错误日志
    this.logger.error(
      `${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
      "ExceptionFilter",
    );

    // 返回错误响应
    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        ...(details && { details }),
        ...(process.env.NODE_ENV === "development" && {
          stack: exception instanceof Error ? exception.stack : undefined,
        }),
      },
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
```

---

## TODO 清单

### 📝 日志系统

- [ ] **安装日志依赖**

  ```bash
  npm install winston winston-daily-rotate-file nest-winston
  ```

- [ ] **创建 Logger 模块**
  - [ ] `src/common/logger/logger.module.ts`
  - [ ] `src/common/logger/logger.service.ts`
  - [ ] `src/config/logger.config.ts`

- [ ] **创建日志拦截器**
  - [ ] `src/common/interceptors/logging.interceptor.ts` - 访问日志
  - [ ] `src/common/interceptors/audit-log.interceptor.ts` - 审计日志
  - [ ] `src/common/interceptors/performance.interceptor.ts` - 性能日志

- [ ] **创建日志装饰器**
  - [ ] `src/common/decorators/audit-log.decorator.ts`

- [ ] **数据库日志表**
  - [ ] 创建 `audit_logs` 表（执行 SQL）
  - [ ] 创建 `security_logs` 表（执行 SQL）
  - [ ] 创建对应的 Entity
  - [ ] 创建 Repository

- [ ] **配置日志存储**
  - [ ] 创建 `logs/` 目录结构
  - [ ] 配置日志滚动策略
  - [ ] 配置日志保留期限

- [ ] **控制台输出优化**
  - [ ] 配置开发环境彩色输出
  - [ ] 配置生产环境 JSON 输出
  - [ ] 添加启动信息横幅

### 🔐 安全机制

- [ ] **认证系统**
  - [ ] 安装依赖
    ```bash
    npm install @nestjs/passport passport @nestjs/jwt passport-jwt bcrypt
    npm install @types/passport-jwt @types/bcrypt -D
    ```
  - [ ] 创建 JWT 策略
  - [ ] 创建 Local 策略
  - [ ] 实现 JWT 守卫
  - [ ] 实现会话管理
  - [ ] 实现 Token 黑名单（可选）

- [ ] **密码安全**
  - [ ] 创建 `src/common/utils/hash.util.ts`
  - [ ] 配置 bcrypt 加密轮数
  - [ ] 实现密码强度验证
  - [ ] 实现密码重置功能

- [ ] **权限控制**
  - [ ] 创建角色枚举 `src/common/enums/role.enum.ts`
  - [ ] 创建角色装饰器 `src/common/decorators/roles.decorator.ts`
  - [ ] 创建角色守卫 `src/common/guards/roles.guard.ts`
  - [ ] 创建资源权限守卫
    - [ ] `src/common/guards/workspace.guard.ts`
    - [ ] `src/common/guards/document-permission.guard.ts`

- [ ] **限流保护**
  - [ ] 安装依赖
    ```bash
    npm install @nestjs/throttler
    ```
  - [ ] 配置全局限流
  - [ ] 创建自定义限流守卫 `src/common/guards/custom-throttler.guard.ts`
  - [ ] 为特定接口配置限流策略
    - [ ] 登录接口：5次/分钟
    - [ ] 注册接口：3次/小时
    - [ ] 文件上传：10次/小时

- [ ] **输入验证**
  - [ ] 配置全局验证管道
  - [ ] 为所有 DTO 添加验证装饰器
  - [ ] 创建自定义验证器
    - [ ] `src/common/validators/is-valid-id.validator.ts`
  - [ ] 创建清洗管道
    - [ ] `src/common/pipes/sanitize.pipe.ts`

- [ ] **SQL 注入防护**
  - [ ] 审查所有数据库查询
  - [ ] 确保使用参数化查询
  - [ ] 禁止字符串拼接 SQL

- [ ] **XSS 防护**
  - [ ] 安装依赖
    ```bash
    npm install sanitize-html
    ```
  - [ ] 实现内容清洗
  - [ ] 配置 CSP 头

- [ ] **CSRF 防护**
  - [ ] 安装依赖
    ```bash
    npm install csurf
    ```
  - [ ] 配置 CSRF 中间件

- [ ] **CORS 配置**
  - [ ] 配置允许的源
  - [ ] 配置允许的方法和头
  - [ ] 配置凭证支持

- [ ] **安全响应头**
  - [ ] 安装依赖
    ```bash
    npm install helmet
    ```
  - [ ] 配置 Helmet 中间件
  - [ ] 配置 CSP
  - [ ] 配置 HSTS

- [ ] **敏感数据加密**
  - [ ] 创建 `src/common/utils/encryption.util.ts`
  - [ ] 配置加密密钥
  - [ ] 实现敏感字段加密

### 📊 监控与审计

- [ ] **健康检查**
  - [ ] 安装依赖
    ```bash
    npm install @nestjs/terminus
    ```
  - [ ] 创建健康检查控制器
  - [ ] 添加数据库健康检查
  - [ ] 添加内存健康检查

- [ ] **性能监控**
  - [ ] 创建性能监控拦截器
  - [ ] 配置慢查询阈值
  - [ ] 记录性能指标

- [ ] **错误追踪**
  - [ ] 安装 Sentry（可选）
    ```bash
    npm install @sentry/node
    ```
  - [ ] 配置 Sentry
  - [ ] 创建 Sentry 过滤器

- [ ] **审计功能**
  - [ ] 创建审计查询接口
  - [ ] 实现用户操作历史查询
  - [ ] 实现资源操作历史查询
  - [ ] 实现敏感操作查询

### ⚠️ 错误处理

- [ ] **错误代码规范**
  - [ ] 创建 `src/common/errors/error-codes.ts`
  - [ ] 定义所有错误代码

- [ ] **自定义异常**
  - [ ] 创建 `src/common/exceptions/business.exception.ts`
  - [ ] 创建其他业务异常类

- [ ] **全局异常过滤器**
  - [ ] 创建 `src/common/filters/all-exceptions.filter.ts`
  - [ ] 创建 `src/common/filters/http-exception.filter.ts`
  - [ ] 注册全局过滤器

### 🔧 配置与环境

- [ ] **环境变量**
  - [ ] 添加日志配置到 `.env`
    ```env
    LOG_LEVEL=info
    LOG_DIR=./logs
    LOG_MAX_FILES=30d
    LOG_MAX_SIZE=20m
    ```
  - [ ] 添加安全配置到 `.env`
    ```env
    JWT_SECRET=your-secret-key
    JWT_EXPIRES_IN=24h
    REFRESH_TOKEN_SECRET=your-refresh-secret
    REFRESH_TOKEN_EXPIRES_IN=7d
    ENCRYPTION_KEY=your-encryption-key-hex
    BCRYPT_ROUNDS=10
    ```
  - [ ] 添加限流配置到 `.env`
    ```env
    THROTTLE_TTL=60
    THROTTLE_LIMIT=100
    ```

- [ ] **配置模块**
  - [ ] 创建 `src/config/security.config.ts`
  - [ ] 创建 `src/config/throttle.config.ts`

### 📚 文档与测试

- [ ] **API 文档**
  - [ ] 为安全相关接口添加文档
  - [ ] 添加错误代码说明
  - [ ] 添加认证示例

- [ ] **测试**
  - [ ] 认证流程测试
  - [ ] 权限控制测试
  - [ ] 限流功能测试
  - [ ] 输入验证测试

### 🚀 部署准备

- [ ] **生产环境配置**
  - [ ] 配置 HTTPS
  - [ ] 配置防火墙规则
  - [ ] 配置反向代理（Nginx）
  - [ ] 配置日志收集
  - [ ] 配置监控告警

- [ ] **安全检查清单**
  - [ ] 所有默认密码已修改
  - [ ] JWT 密钥已更换为强密钥
  - [ ] 敏感数据已加密
  - [ ] 限流已启用
  - [ ] HTTPS 已启用
  - [ ] 安全响应头已配置
  - [ ] 日志审计已启用

---

## 优先级

### P0 - 核心安全（第 1 周）

1. JWT 认证系统
2. 密码加密
3. 基础日志（应用日志、错误日志）
4. 全局异常处理
5. 输入验证

### P1 - 权限与审计（第 2 周）

1. 角色权限系统
2. 资源级权限控制
3. 审计日志
4. 访问日志
5. 安全日志

### P2 - 防护与监控（第 3 周）

1. 限流保护
2. XSS/CSRF 防护
3. 安全响应头
4. 健康检查
5. 性能监控

### P3 - 优化与完善（第 4 周）

1. 敏感数据加密
2. 错误追踪（Sentry）
3. 审计查询功能
4. 日志分析工具
5. 安全文档完善

---

**开始日期:** 2026-01-17  
**预计完成:** 4 周

记得在完成每项任务后将 `[ ]` 改为 `[x]` ✅
