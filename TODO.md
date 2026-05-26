# TODO

## 审核处理状态

- 已修复：恢复 `BlockRenderCache` 根实体注册，并增加回归测试。
- 已修复：图片上传大小限制改为 controller/multer 与 service 共用 `app.maxImageFileSize` / `app.maxFileSize` 配置来源，并增加回归测试。
- 已确认：协作文档允许进入最终提交，提交顺序拆分为“设计协作文档”与“代码实现”。
- 已修复：S3 模式下配置异常或健康检查失败时直接失败，不再自动回退本地，避免生产混合存储。

## 当前工作区提交前待处理问题

### 1. 恢复 `BlockRenderCache` 的 TypeORM 根实体注册

- 文件：`src/app.module.ts`
- 问题：`TypeOrmModule.forRootAsync()` 的 `entities` 列表里移除了 `BlockRenderCache`
- 现状：`src/modules/documents/documents.module.ts` 里仍然在注册并使用 `BlockRenderCache`
- 风险：应用完整启动或文档渲染相关仓储访问时，可能出现 `No metadata for BlockRenderCache` 一类错误
- 建议：确认这次移除是否为误删；如果图片功能并不涉及它，应恢复到根实体列表

### 2. 统一图片上传大小限制来源

- 文件：
  - `src/modules/images/images.controller.ts`
  - `src/modules/images/images.service.ts`
  - `src/config/app.config.ts`
- 问题：controller 里 `FileInterceptor` 的 `fileSize` 仍写死为 `20MB`
- 现状：service 又使用 `app.maxImageFileSize` / `app.maxFileSize` 做二次校验
- 风险：
  - 当配置值大于 `20MB` 时，请求会被 controller 提前拦截
  - 当配置值小于 `20MB` 时，请求会先通过 controller，再在 service 层报错
- 建议：让 controller 与 service 共用同一份图片大小配置

### 3. 确认本次是否要提交协作文档和未跟踪文件

- 当前相关文件：
  - `GOAL.md`
  - `docs/superpowers/plans/2026-05-25-images-s3-storage.md`
  - `docs/superpowers/specs/2026-05-25-images-s3-storage-design.md`
  - `src/modules/images/` 下新增文件
- 问题：当前提交范围里混有规划文档、目标文档和功能代码
- 风险：提交内容边界不清，后续回滚、审查、合并都不够干净
- 建议：提交前确认哪些文档需要入库，哪些只应保留在本地；必要时拆分提交

### 4. 重新确认 S3 不可用时自动回退本地的策略

- 文件：`src/modules/images/image-storage.factory.ts`
- 问题：当前逻辑是在 S3 配置异常或健康检查失败时，自动回退到本地存储
- 风险：生产环境可能出现同一套图片能力“部分走 S3、部分落本地”的混合状态，后续排障和数据治理会比较困难
- 建议：确认这是否为预期策略；如果不是，考虑在 S3 模式下直接启动失败并显式报错
- 结论：不采用自动回退。显式配置 `IMAGE_STORAGE_PROVIDER=s3` 时，S3 配置异常或健康检查失败直接失败。
