import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUDIT_LOG_KEY, AuditLogOptions } from '../../../common/decorators/audit-log.decorator';
import { AuditService } from '../audit.service';

const SENSITIVE_KEYS = ['password', 'token', 'refreshToken', 'secret', 'passwordHash'];

function sanitize(obj: unknown): unknown {
  if (obj == null) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) {
      out[k] = '***REDACTED***';
    } else {
      out[k] = sanitize(v);
    }
  }
  return out;
}

function getResourceId(
  opts: AuditLogOptions,
  data: unknown,
  params: Record<string, string>,
  body: unknown,
): string {
  if (opts.resourceIdKey) {
    const v =
      (data as Record<string, string>)?.[opts.resourceIdKey] ??
      params?.[opts.resourceIdKey] ??
      (body as Record<string, string>)?.[opts.resourceIdKey];
    if (v) return String(v);
  }
  const d = data as Record<string, string> | undefined;
  const id =
    d?.docId ??
    d?.workspaceId ??
    d?.assetId ??
    d?.blockId ??
    d?.id ??
    params?.docId ??
    params?.workspaceId ??
    params?.assetId ??
    params?.blockId ??
    params?.id ??
    (body as Record<string, string> | undefined)?.docId ??
    (body as Record<string, string> | undefined)?.workspaceId;
  return id ?? 'unknown';
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    private auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const opts = this.reflector.get<AuditLogOptions>(AUDIT_LOG_KEY, context.getHandler());
    if (!opts) return next.handle();

    const request = context.switchToHttp().getRequest();
    const { user, ip, body = {}, params = {} } = request;
    const userAgent = request.headers?.['user-agent'];

    return next.handle().pipe(
      tap({
        next: async (data: unknown) => {
          const resourceId = getResourceId(opts, data, params, body);
          await this.auditService.record({
            userId: user?.userId,
            username: user?.username,
            action: opts.action,
            resourceType: opts.resourceType,
            resourceId,
            changes: { before: sanitize(body), after: sanitize(data) },
            metadata: { method: request.method, url: request.url },
            ipAddress: ip || request.socket?.remoteAddress,
            userAgent,
            status: 'success',
          });
        },
        error: async (err: Error) => {
          const resourceId = getResourceId(opts, null, params, body);
          await this.auditService.record({
            userId: user?.userId,
            username: user?.username,
            action: opts.action,
            resourceType: opts.resourceType,
            resourceId,
            changes: { before: sanitize(body) },
            metadata: { method: request.method, url: request.url },
            ipAddress: ip || request.socket?.remoteAddress,
            userAgent,
            status: 'failed',
            errorMessage: err?.message,
          });
        },
      }),
    );
  }
}
