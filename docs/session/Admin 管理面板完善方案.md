# Admin 管理面板完善方案

## Context

后端 guestbook + reactions 模块已完成。现在需要在 `back/admin` 前端构建完整的管理界面，包括：
1. 留言管理（增强：置顶、批量审核、点赞数展示）
2. 敏感词管理（CRUD）
3. 表情管理（CRUD）
4. 表情回应记录管理（列表、删除）

## 约定

- `VITE_API_BASE_URL = http://localhost:5200/api/v1/admin`，所有 API 路径相对于此
- 现有 guestbook API 路径需要修正（去掉 `/api/admin` 前缀）
- 使用 Element Plus 组件 + i18n
- 路由模块化（每个管理功能一个 router module）

## 文件清单

### 1. API 层（src/api/）

**修改 `guestbook.ts`：**
- 修正路径：`/api/admin/guestbook` → `guestbook`
- GuestbookItem 新增 `isPinned`, `likeCount`, `replyCount` 字段
- 新增 `batchUpdateStatus(ids, status)` 方法
- 新增 `updateGuestbook(id, data)` 方法（支持置顶等）

**新建 `sensitive-words.ts`：**
- `getSensitiveWords()` → `GET sensitive-words`
- `createSensitiveWord(data)` → `POST sensitive-words`
- `updateSensitiveWord(id, data)` → `PATCH sensitive-words/:id`
- `deleteSensitiveWord(id)` → `DELETE sensitive-words/:id`

**新建 `reactions.ts`：**
- `getEmojis()` → `GET reactions/emojis`
- `createEmoji(data)` → `POST reactions/emojis`
- `updateEmoji(id, data)` → `PATCH reactions/emojis/:id`
- `deleteEmoji(id)` → `DELETE reactions/emojis/:id`
- `getReactionRecords(params)` → `GET reactions/records`
- `deleteReactionRecord(id)` → `DELETE reactions/records/:id`

### 2. 路由（src/router/modules/）

**修改 `guestbook.ts`：** 扩展子路由，添加敏感词管理、表情管理、回应记录子页面

```
/guestbook
  /guestbook/list          — 留言列表（已有，增强）
  /guestbook/sensitive     — 敏感词管理（新建）
  /guestbook/emojis        — 表情管理（新建）
  /guestbook/reactions     — 回应记录（新建）
```

### 3. 页面（src/views/）

**修改 `guestbook/index.vue`：**
- 新增列：置顶标识、点赞数、回复数
- 新增操作：置顶/取消置顶
- 新增批量操作栏：批量通过/拒绝

**新建 `guestbook/sensitive.vue`：**
- 表格展示敏感词列表（word, replacement, isActive）
- 新增/编辑弹窗（el-dialog + el-form）
- 删除确认

**新建 `guestbook/emojis.vue`：**
- 表格展示表情列表（code, name, icon 预览, isActive, sortOrder）
- 新增/编辑弹窗
- 删除确认

**新建 `guestbook/reactions.vue`：**
- 表格展示回应记录（targetType, targetId, emoji, ip, time）
- 支持 targetType 筛选
- 删除操作

### 4. 国际化（locales/）

**修改 `zh-CN.yaml` 和 `en.yaml`：**
- menus 新增：pureGuestbookSensitive, pureGuestbookEmojis, pureGuestbookReactions
- guestbook 段新增：置顶、批量操作、点赞、回复数等翻译
- 新增 sensitiveWords 段：敏感词管理翻译
- 新增 emojis 段：表情管理翻译
- 新增 reactions 段：回应记录翻译

## 实施顺序

1. 修正 `api/guestbook.ts` 路径 + 新增接口
2. 新建 `api/sensitive-words.ts`
3. 新建 `api/reactions.ts`
4. 更新国际化文件（zh-CN.yaml + en.yaml）
5. 增强 `views/guestbook/index.vue`
6. 新建 `views/guestbook/sensitive.vue`
7. 新建 `views/guestbook/emojis.vue`
8. 新建 `views/guestbook/reactions.vue`
9. 更新 `router/modules/guestbook.ts` 路由
10. 编译验证
