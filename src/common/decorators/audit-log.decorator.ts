import { SetMetadata } from '@nestjs/common';

export const AUDIT_LOG_KEY = 'audit_log';

export interface AuditLogOptions {
  action: string;
  resourceType: string;
  /** 从响应/params/body 中取 resourceId 的字段名，如 'docId'、'workspaceId'；不传则自动推断 */
  resourceIdKey?: string;
}

export const AuditLog = (options: AuditLogOptions) => SetMetadata(AUDIT_LOG_KEY, options);
