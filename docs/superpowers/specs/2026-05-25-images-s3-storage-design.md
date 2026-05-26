# 图片模块 S3 兼容存储设计

<!-- cspell:words yueditor -->

## 背景

当前 `src/modules/images/images.service.ts` 直接将图片写入本地磁盘，并在上传成功后拼接后端访问地址返回。现状存在两个问题：

1. 图片模块只能使用本地文件系统，无法接入 S3 兼容对象存储。
2. 图片 URL 由服务层自行拼接，生产环境未配置 `PUBLIC_BASE_URL` 时会回退到 `http://localhost:5200`，导致返回错误地址。

本次仅增强图片模块，使其支持在保持本地存储兼容的前提下，新增 S3 兼容存储能力，并在 S3 模式下返回对象存储或 CDN 的公开直链。

## 目标

- 仅为 `images` 模块增加 S3 兼容存储支持。
- 保持现有本地存储能力作为默认值；显式配置 S3 时不自动回退本地。
- S3 模式下上传成功后返回公开可访问的直链。
- 保留现有图片读取接口，兼容已有客户端与旧数据。
- 不修改现有 `Asset` 表结构。
- 将图片 URL 生成职责从 `ImagesService` 中抽离，避免再次出现生产环境返回 `localhost` 的问题。

## 非目标

- 不重构 `assets` 模块的上传/下载逻辑。
- 不将所有文件存储统一抽象成全局存储层。
- 不引入私有桶 + 预签名 URL 机制。
- 不在本次实现中做历史数据迁移；旧数据按现状兼容读取。

## 用户确认的约束

- 范围：仅图片模块支持 S3。
- 上传返回：返回 S3/CDN 公开直链。
- 读取接口：继续保留，兼容老图片与现有调用方。
- 存储权限：S3 对象默认公开可读。

## 现状概览

### 当前上传流程

`ImagesService.upload()` 目前负责：

- 校验工作区权限
- 校验图片类型与大小
- 生成 `imageId` 与本地文件路径
- 将文件写入 `uploads/workspaces/<workspaceId>/images/...`
- 生成 `url` / `publicUrl`
- 创建并保存 `Asset`

### 当前关键耦合点

- 文件写入逻辑直接耦合在 `ImagesService` 中。
- `toAbsoluteUrl()` 负责拼接绝对地址，依赖 `app.publicBaseUrl`，未配置时会回退 `localhost`。
- 读取逻辑假定 `storagePath` 一定是本地磁盘路径。

## 方案概述

为图片模块引入轻量的存储适配层，仅在 `images` 模块内部使用，不扩散到 `assets` 模块。

### 核心思路

- 保留 `ImagesService` 作为图片上传与读取的业务入口。
- 新增图片存储接口，例如 `ImageStorageService` 或等价命名。
- 提供两个实现：
  - `LocalImageStorageService`
  - `S3ImageStorageService`
- `ImagesService` 根据配置选择具体存储实现。
- 存储实现负责：
  - 保存图片二进制内容
  - 生成最终公开访问 URL
  - 在需要时打开本地流或提供重定向目标
- `ImagesService` 不再自行拼接图片最终访问地址。

## 架构设计

### 模块边界

#### `ImagesService`

职责：

- 校验权限、类型、大小
- 生成图片 ID、规范化文件名、构造对象 key
- 调用存储服务保存文件
- 保存 `Asset` 记录
- 为 controller 提供“读取方式”（本地流或跳转地址）

不再负责：

- 直接写磁盘
- 直接上传 S3
- 自行拼接最终对外 URL

#### `LocalImageStorageService`

职责：

- 按现有目录规则写入本地磁盘
- 返回 `storageProvider=local`
- 返回 `storagePath` 为本地相对路径
- 返回本地模式下使用的图片访问 URL
- 读取时根据 `storagePath` 打开本地文件流

#### `S3ImageStorageService`

职责：

- 将图片上传到 S3 兼容对象存储
- 返回 `storageProvider=s3`
- 返回 `storagePath` 为对象 key
- 基于 `S3_PUBLIC_BASE_URL` 生成公开直链
- 对读取接口提供“重定向到公开 URL”的能力
- 在数据库写入失败时支持删除已上传对象的补偿操作

### 存储接口建议

建议为图片模块定义一个最小接口，避免过早抽象到全局文件系统层。

建议接口能力包括：

- `saveImage(...)`：保存文件并返回存储结果
- `deleteImage(...)`：补偿删除
- `resolveReadTarget(...)`：为读取接口提供本地流或重定向 URL

存储结果至少包含：

- `storageProvider`
- `storagePath`
- `url`

读取结果建议区分为：

- `stream` 模式：本地图片，返回文件流、`mimeType`、`filename`
- `redirect` 模式：S3 图片，返回目标 URL

## 配置设计

新增或扩展以下配置项：

- `IMAGE_STORAGE_PROVIDER=local|s3`
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_PUBLIC_BASE_URL`
- `S3_FORCE_PATH_STYLE=true|false`

### 配置约定

- 默认 `IMAGE_STORAGE_PROVIDER=local`，确保旧环境无感升级。
- 仅当 `IMAGE_STORAGE_PROVIDER=s3` 时校验 S3 必填配置。
- 显式配置 `IMAGE_STORAGE_PROVIDER=s3` 时，S3 配置异常或健康检查失败直接失败，不自动回退本地，避免生产混合存储。
- `S3_PUBLIC_BASE_URL` 用于生成公开直链，不依赖 `PUBLIC_BASE_URL`。
- 若对象存储厂商要求 path-style 访问，则通过 `S3_FORCE_PATH_STYLE` 控制 SDK 行为。

### 推荐配置示例

```env
IMAGE_STORAGE_PROVIDER=s3
S3_ENDPOINT=https://s3.example.com
S3_REGION=auto
S3_BUCKET=yueditor-images
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_PUBLIC_BASE_URL=https://cdn.example.com
S3_FORCE_PATH_STYLE=false
```

## 数据模型约定

继续复用现有 `Asset` 实体，不新增字段。

### 字段使用方式

- `storageProvider`
  - `local`：本地磁盘
  - `s3`：S3 兼容对象存储
- `storagePath`
  - `local`：磁盘相对路径
  - `s3`：对象 key
- `url`
  - `local`：现有本地访问地址或统一图片访问地址
  - `s3`：对象公开直链
- `mimeType`、`size`、`width`、`height`
  - 保持当前语义不变

### 对象 key 规则

S3 对象 key 延续当前本地目录规则：

```text
workspaces/<workspaceId>/images/<imageId>_<sanitizedFilename>
```

这样可以：

- 维持现有按工作区分目录的语义
- 让本地与 S3 的 `storagePath` 结构一致
- 降低后续统一资产存储时的迁移成本

## 上传流程设计

### Local 模式

1. 校验工作区访问权限。
2. 校验文件存在、图片 MIME 类型、大小限制。
3. 生成 `imageId`、规范化文件名与 `storagePath`。
4. 调用 `LocalImageStorageService.saveImage()` 写入磁盘。
5. 得到 `storageProvider=local`、`storagePath`、`url`。
6. 创建并保存 `Asset`。
7. 返回图片响应。

### S3 模式

1. 校验工作区访问权限。
2. 校验文件存在、图片 MIME 类型、大小限制。
3. 生成 `imageId`、规范化文件名与对象 key。
4. 调用 `S3ImageStorageService.saveImage()` 上传对象。
5. 得到 `storageProvider=s3`、`storagePath`、`url`（公开直链）。
6. 创建并保存 `Asset`。
7. 若数据库保存失败，调用 `deleteImage()` 删除刚上传的对象。
8. 返回图片响应，`url` / `publicUrl` 都使用可公开访问的直链。

## 读取接口兼容设计

保留现有接口：

- `GET /images/:id/file`
- `GET /public/images/:id/file`

### 兼容行为

#### 当 `storageProvider=local`

- 继续按当前逻辑打开本地文件流。
- 对客户端保持原有行为不变。

#### 当 `storageProvider=s3`

- 不由后端代理文件内容。
- controller 根据服务层返回结果执行 `302` 重定向到 `asset.url`。
- 客户端仍可继续调用旧接口，但最终流量直接落到对象存储或 CDN。

### 这样设计的原因

- 对老图片完全兼容。
- 对已接入旧读取接口的前端兼容。
- 新图片不再经过后端转发，避免额外带宽与延迟。
- 与“上传返回直链”的目标保持一致。

## URL 生成策略

### 本地模式

本地模式仍可保留现有图片访问接口地址，但其生成责任应从 `ImagesService.toAbsoluteUrl()` 下沉到本地存储实现中，统一收口。

### S3 模式

S3 模式的 URL 由：

- `S3_PUBLIC_BASE_URL`
- `storagePath`（对象 key）

共同拼接。

### 原则

- `ImagesService` 不再感知 `PUBLIC_BASE_URL` 或 `localhost` 回退细节。
- 图片最终访问地址由存储实现决定。
- 生产环境的错误 URL 风险被限制在配置层，而不是业务层。

## 错误处理设计

### 上传阶段

- 文件不存在：返回 400
- 图片类型不支持：返回 400
- 文件超限：返回 400
- S3 配置缺失或健康检查失败：启动期校验失败，不回退本地
- S3 上传失败：返回上传失败错误
- 数据库保存失败：触发 S3 补偿删除，若补偿失败则记录日志

### 读取阶段

- 图片记录不存在：返回 404
- 图片状态非 `active`：返回 404
- 本地文件不存在：返回 404
- S3 记录存在但对象不可访问：通过重定向后由对象存储返回 404；如果需要更强一致性，可后续再扩展 HEAD 检查，但本次不做

## 测试设计

至少补充以下测试：

1. 本地模式上传成功，正确写入本地存储结果。
2. S3 模式上传成功，正确保存对象 key 与公开直链。
3. S3 模式响应中返回直链，不再返回 `localhost` 回退地址。
4. 本地模式读取仍返回文件流。
5. S3 模式读取返回重定向目标。
6. S3 上传失败时返回异常。
7. 数据库保存失败时触发 S3 补偿删除。
8. 缺少 S3 必填配置时返回明确错误。
9. S3 健康检查失败时直接失败，不回退本地。

测试方式以单元测试为主，优先 mock S3 client 与 repository；读取 controller 的重定向行为可以补充轻量集成测试或 controller 单测。

## 实施范围

### 预计新增/修改类别

- `images` 模块 service/controller/module
- 新增图片存储抽象与本地/S3 实现
- 配置模块增加图片存储/S3 配置
- 相关测试文件

### 明确不改动

- `assets.service.ts` 的上传与下载逻辑
- 资产列表接口语义
- 现有数据库表结构
- 前端接口契约中的基础字段名

## 风险与缓解

### 风险 1：S3 URL 规则与供应商差异

缓解：

- 强制通过 `S3_PUBLIC_BASE_URL` 生成公开 URL
- 不依赖 SDK 自动推导公网地址

### 风险 2：旧读取接口与新直链行为并存

缓解：

- 在服务层明确区分 stream / redirect 两种读取结果
- controller 层只负责按结果类型输出响应

### 风险 3：上传成功但数据库保存失败

缓解：

- 增加补偿删除逻辑
- 记录异常日志，避免孤儿对象长期积累

## 验收标准

满足以下条件即视为完成：

- 在 `IMAGE_STORAGE_PROVIDER=local` 下，图片上传与读取行为与当前一致。
- 在 `IMAGE_STORAGE_PROVIDER=s3` 下，图片可上传到 S3 兼容存储。
- S3 模式上传响应返回公开直链。
- S3 模式配置或健康检查失败时直接失败，不落入本地存储。
- S3 模式下旧读取接口仍可访问，并通过重定向工作。
- 数据库存储 `storageProvider=s3`、`storagePath=<object key>`、`url=<public url>`。
- 图片模块不再由 `ImagesService` 直接拼接最终公开 URL。
- 不影响 `assets` 模块现有行为。

## 后续可选演进（不纳入本次）

- 将 `assets` 模块复用同一套存储抽象。
- 支持私有桶 + 预签名 URL。
- 支持对象删除、对象 HEAD 校验与健康检查。
- 增加历史 `localhost` URL 数据修复脚本。
