import { v4 as uuidv4 } from "uuid";
// cspell:words uuidv

/**
 * 生成用户ID (u_xxx)
 */
export function generateUserId(): string {
  return `u_${Date.now()}_${uuidv4().split("-")[0]}`;
}

/**
 * 生成工作空间ID (ws_xxx)
 */
export function generateWorkspaceId(): string {
  return `ws_${Date.now()}_${uuidv4().split("-")[0]}`;
}

/**
 * 生成文档ID (doc_xxx)
 */
export function generateDocId(): string {
  return `doc_${Date.now()}_${uuidv4().split("-")[0]}`;
}

/**
 * 生成块ID (b_xxx)
 */
export function generateBlockId(): string {
  return `b_${Date.now()}_${uuidv4().split("-")[0]}`;
}

/**
 * 生成资产ID (asset_xxx)
 */
export function generateAssetId(): string {
  return `asset_${uuidv4().replace(/-/g, "")}`;
}

/**
 * 生成标签ID (tag_xxx)
 */
export function generateTagId(): string {
  return `tag_${Date.now()}_${uuidv4().split("-")[0]}`;
}

/**
 * 生成评论ID (comment_xxx)
 */
export function generateCommentId(): string {
  return `comment_${Date.now()}_${uuidv4().split("-")[0]}`;
}

/**
 * 生成活动ID (activity_xxx)
 */
export function generateActivityId(): string {
  return `activity_${Date.now()}_${uuidv4().split("-")[0]}`;
}

/**
 * 生成会话ID (session_xxx)
 */
export function generateSessionId(): string {
  return `session_${Date.now()}_${uuidv4().split("-")[0]}`;
}

/**
 * 生成管理员ID (adm_xxx)
 */
export function generateAdminId(): string {
  return `adm_${Date.now()}_${uuidv4().split("-")[0]}`;
}

/**
 * 生成版本ID (blockId@ver)
 */
export function generateVersionId(blockId: string, ver: number): string {
  return `${blockId}@${ver}`;
}

/**
 * 生成修订ID (docId@docVer)
 */
export function generateRevisionId(docId: string, docVer: number): string {
  return `${docId}@${docVer}`;
}

/**
 * 生成快照ID (docId@snap@docVer)
 */
export function generateSnapshotId(docId: string, docVer: number): string {
  return `${docId}@snap@${docVer}`;
}

/**
 * 生成日志 ID (log_xxx)，用于 audit_logs、security_logs
 */
export function generateLogId(): string {
  return `log_${Date.now()}_${uuidv4().split("-")[0]}`;
}

/**
 * 生成设置配置 ID (sp_xxx)，用于 settings_profiles
 */
export function generateSettingsProfileId(): string {
  return `sp_${Date.now()}_${uuidv4().split("-")[0]}`;
}

/**
 * 生成 AI 会话 ID (aic_xxx)
 */
export function generateAiConversationId(): string {
  return `aic_${Date.now()}_${uuidv4().split("-")[0]}`;
}

/**
 * 生成 AI 消息 ID (aim_xxx)
 */
export function generateAiMessageId(): string {
  return `aim_${Date.now()}_${uuidv4().split("-")[0]}`;
}

/**
 * 生成 AI 上下文快照 ID (aics_xxx)
 */
export function generateAiContextSnapshotId(): string {
  return `aics_${Date.now()}_${uuidv4().split("-")[0]}`;
}
