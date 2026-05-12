/** 操作类型：文档 */
export const DOC_ACTIONS = {
  CREATE: 'doc.create',
  UPDATE: 'doc.update',
  DELETE: 'doc.delete',
  MOVE: 'doc.move',
  PUBLISH: 'doc.publish',
} as const;

/** 操作类型：块 */
export const BLOCK_ACTIONS = {
  CREATE: 'block.create',
  UPDATE: 'block.update',
  DELETE: 'block.delete',
  MOVE: 'block.move',
  BATCH: 'block.batch',
} as const;

/** 操作类型：工作空间 */
export const WORKSPACE_ACTIONS = {
  CREATE: 'workspace.create',
  UPDATE: 'workspace.update',
  DELETE: 'workspace.delete',
} as const;

/** 操作类型：成员 */
export const MEMBER_ACTIONS = {
  INVITE: 'member.invite',
  ROLE: 'member.role',
  REMOVE: 'member.remove',
} as const;

/** 操作类型：收藏 */
export const FAVORITE_ACTIONS = {
  CREATE: 'favorite.create',
  REMOVE: 'favorite.remove',
} as const;

/** 操作类型：评论 */
export const COMMENT_ACTIONS = {
  CREATE: 'comment.create',
  UPDATE: 'comment.update',
  DELETE: 'comment.delete',
} as const;

/** 操作类型：标签 */
export const TAG_ACTIONS = {
  CREATE: 'tag.create',
  UPDATE: 'tag.update',
  DELETE: 'tag.delete',
} as const;

/** 操作类型：设置 */
export const SETTINGS_ACTIONS = {
  USER_UPDATE: 'settings.user.update',
  WORKSPACE_UPDATE: 'settings.workspace.update',
  WORKSPACE_CLEAR: 'settings.workspace.clear',
} as const;

/** 实体类型 */
export const ENTITY_TYPES = {
  DOCUMENT: 'document',
  BLOCK: 'block',
  WORKSPACE: 'workspace',
  MEMBER: 'member',
  FAVORITE: 'favorite',
  COMMENT: 'comment',
  TAG: 'tag',
  SETTINGS: 'settings',
} as const;
