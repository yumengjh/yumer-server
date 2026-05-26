# 文档导出功能设计

<!-- cspell:words Streamable -->

## 背景

当前编辑器已经具备：

- 文档版本 `head`
- 文档修订历史 `doc_revisions`
- 文档快照 `doc_snapshots`
- 块级 HTML 渲染能力
- `GET /api/v1/documents/:docId/pending-versions`
- `GET /api/v1/documents/:docId/sync-state`

现在希望增加导出能力，支持：

- Markdown
- HTML 压缩包
- PDF

导出的目标版本不是草稿态，而是“最近一次已提交的文档版本”。

## 目标

- 支持导出当前文档最近一次已提交版本。
- 支持 `md`、`html`、`pdf` 三种格式。
- HTML 导出直接返回 zip 包。
- 导出时不把 `pending` 草稿当作版本来源。
- 导出接口不增加文档浏览数。
- 复用现有版本树、HTML 渲染和权限校验逻辑。
- 富文本先做降级输出，后续再做更细的自定义语法转换。

## 非目标

- 不支持选择任意历史版本导出。
- 不做导出任务队列。
- 不做异步离线生成。
- 不做图片二进制重打包进 HTML zip。
- 不解决多实例下 `pending` 内存计数的一致性问题。

## 已确认语义

### 导出的版本来源

导出默认只使用 `document.head` 对应的 `DocRevision`。

### `pending-versions` 的真实含义

`GET /api/v1/documents/:docId/pending-versions` 现在反映的是 `VersionControlService` 里按 `docId` 维护的内存计数。

它表示：

- 当前进程里，这个文档有多少次 `createVersion: false` 的成功写入被延迟提交
- 不是数据库里的版本数
- 不是导出版本来源

### `pending` 和导出的关系

`pending` 只用于 UI 提示：

- 当前有 pending draft 时，提醒用户“先保存再导出”或“导出最近保存版本”
- 不自动把 pending 当成可导出的版本

### 侧效应修正

导出门禁统一使用 `GET /documents/:docId/sync-state`，因为它已经返回 `pendingCount` 和 `hasPendingDraft`，且没有浏览数副作用。

`GET /pending-versions` 只保留给兼容调用方使用；如果继续暴露这个接口，它的访问校验也应改成无浏览增量校验，避免误增 `viewCount`。

## 方案概述

新增一个文档导出入口，后端生成文件流，前端只负责触发下载。

### 后端

- 在 `DocumentsController` 增加导出路由
- 新增 `DocumentExportService`
- 复用文档版本读取逻辑，拿到完整的导出源数据
- 按格式输出 `StreamableFile`

### 前端

- 在文档头部增加“导出”下拉入口
- 先读 `sync-state`
- 如果有 pending draft，给出保存/直接导出两个动作
- 下载逻辑单独封装成二进制下载函数

## 后端设计

### 接口

```http
GET /api/v1/documents/:docId/export?format=md|html|pdf
```

### 行为

- 需要登录
- 需要文档访问权限
- 不增加 `viewCount`
- 默认导出当前 `head`
- 返回 `StreamableFile`
- 使用 `Content-Disposition: attachment`

### 响应头

- `Content-Type`
  - `text/markdown; charset=utf-8`
  - `application/zip`
  - `application/pdf`
- `Content-Disposition`
  - 文件名包含文档标题和版本号
- `Cache-Control: no-store`

### 服务划分

#### `DocumentsController`

职责：

- 接收导出请求
- 解析 `format`
- 返回文件流

#### `DocumentExportService`

职责：

- 校验导出格式
- 获取导出源数据
- 调用对应格式生成器
- 组装文件名和响应元数据

#### 文档版本源读取

导出需要“完整版本树”，不能用分页接口。

建议在 `DocumentsService` 中抽出一个导出专用方法，返回：

- `Document`
- `DocRevision`
- 完整块树

这样导出服务不会去复制现有 `getContentByDocument()` 的私有逻辑。

### 版本来源规则

导出时读取：

- `document.head`
- `doc_revisions.docVer = document.head`

不读取：

- `pending-versions`
- `sync-state` 的 `pendingCount` 作为版本来源

## 格式设计

### Markdown

第一版采用“结构化降级”策略，不做完整富文本语义保真。

规则：

- 标题映射为 `# / ## / ###`
- 段落映射为普通文本段
- 列表映射为 `-` 或 `1.`
- 任务列表映射为 `- [ ]` / `- [x]`
- 代码块映射为 fenced code block
- 引用映射为 `>`
- 链接保留为 Markdown 链接
- 表格优先输出 GFM 表格，无法转换时降级为纯文本
- 图片输出为 `![](<url>)`
- 字体颜色、背景色、字号、行高等样式直接丢弃

建议实现上以块树为主，必要时借助 HTML 中间态做最后一级降级。

### HTML zip

HTML 不直接返回单文件，而是返回 zip 包。

zip 内容建议如下：

- `index.html`
- `style.css`

规则：

- `index.html` 是完整 HTML 文档，不是片段
- `style.css` 只包含导出阅读需要的基础样式
- 图片保留原始可访问 URL，不下载图片二进制
- 代码块、表格、列表、标题等使用现有渲染语义
- 富文本样式先按可读性输出，复杂样式允许降级

### PDF

PDF 以导出 HTML 作为中间输入，再由浏览器引擎打印成 PDF。

建议使用 `playwright` 的 headless Chromium：

- 复用同一份导出 HTML
- 设置纸张、边距、背景打印
- 输出标准 `application/pdf`

这样 HTML 与 PDF 的内容一致性最好，避免两套渲染逻辑分叉。

## 前端设计

### 入口

在 `DocumentHeader` 右侧主操作区增加“导出”下拉按钮。

选项：

- Markdown
- HTML
- PDF

### 交互流程

1. 点击导出选项。
2. 调 `GET /documents/:docId/sync-state`。
3. 如果 `hasPendingDraft=false`，直接下载。
4. 如果 `hasPendingDraft=true`，弹窗提示：
   - 导出最近保存版本
   - 先保存再导出
5. 选择先保存时，复用现有手动保存流程，保存成功后再触发导出。

### 下载实现

新增一个二进制下载 helper，不走现有 JSON `apiGet/apiPost` 包装。

职责：

- 发起 `fetch`
- 读取 blob
- 从 `Content-Disposition` 解析文件名
- 创建临时 `a` 标签触发下载

### 状态控制

- 保存中禁止导出
- 导出中禁用重复点击
- 导出失败给出明确错误

## 错误处理

### 后端

- 格式不支持 -> `400`
- 文档不存在 -> `404`
- 无权限 -> `403`
- 导出树构建失败 -> `500`
- PDF 引擎不可用 -> `500`

### 前端

- 保存失败后不继续导出
- 下载请求返回非 2xx 时提示错误
- 文件名缺失时使用兜底文件名

## 测试设计

### 后端单测

- 导出默认使用 `document.head`
- `md/html/pdf` 分别返回对应 `Content-Type`
- HTML 导出返回 zip 文件流
- `pending-versions` 查询不应再增加浏览数
- 无权限时导出失败
- 富文本降级输出符合预期

### 后端集成/控制器测试

- 导出接口返回 `StreamableFile`
- `Content-Disposition` 文件名正确
- HTML zip 包含 `index.html` 和 `style.css`

### 前端单测

- pending draft 时能进入保存/直接导出分支
- 二进制下载 helper 能解析文件名
- 导出按钮状态与 loading 状态正确

## 风险与约束

### 风险 1：`pending` 是内存计数

这个功能沿用现有机制，不解决多实例一致性问题。当前导出只把它作为 UI 提示，不作为版本计算依据。

### 风险 2：PDF 运行时依赖

`playwright` 会增加后端体积和运行时依赖，但可以保证 PDF 结果稳定，且与 HTML 共享同一份渲染输入。

### 风险 3：HTML zip 的资源完整性

第一版不打包图片资源，因此离线打开时外链图片是否可见取决于原始 URL 可达性。这个约束是有意接受的。

## 验收标准

- 用户能从编辑器中导出 Markdown、HTML zip、PDF。
- 导出的内容对应最近一次已提交版本。
- pending 草稿不会被误当成导出版本。
- HTML 导出返回 zip 包，内部包含 `index.html` 和 `style.css`。
- PDF 可正常下载并打开。
- 导出过程不增加浏览数。
- 现有保存、发布、版本历史、同步流程不被破坏。
