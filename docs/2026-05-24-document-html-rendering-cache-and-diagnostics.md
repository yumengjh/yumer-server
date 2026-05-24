# 文档内容后端 HTML 渲染、块级缓存与诊断响应头实施记录

## 背景

这次增强把文档系统从“只返回编辑器数据”推进到“内容基础设施可直接输出阅读态内容”。

原先公开文档页面主要依赖前端运行 Tiptap 渲染逻辑，将后端返回的块数据或 Tiptap JSON 转成 HTML。这个方案在浏览器环境中可行，但在 Serverless、SSR、静态发布、搜索引擎抓取、导出和未来 CDN 缓存场景下存在几个问题：

- 前端渲染逻辑依赖浏览器或类浏览器环境，运行位置受限。
- 公开访问每次都要重复执行 JSON 到 HTML 的转换。
- 后端无法知道某篇文档实际是使用缓存 HTML、现场渲染 HTML，还是前端 JSON 回退。
- 代码块等特殊块暂时仍适合由前端处理，但系统缺少“服务端渲染 + 前端处理”的混合模式表达。
- 文档内容接口没有明确区分 `json`、`html`、`all` 这三类消费方式。

本次实现的核心目标是：在不破坏编辑态数据模型的前提下，让后端内容接口具备 HTML 渲染能力、块级懒缓存能力、回退能力和可观测能力。

## 总体设计

### 入口选择

本次没有新增一个独立的公开 HTML 接口，而是增强现有内容接口：

```txt
GET /documents/:docId/content?mode=json
GET /documents/:docId/content?mode=html
GET /documents/:docId/content?mode=all
```

选择增强现有接口的原因：

- 前端已经依赖该接口读取文档块树。
- 文档内容分页、版本号、公开访问校验等能力已经在该接口上存在。
- 在块对象上附加 `html` 字段可以保持数据结构连续，不需要前端重写读取链路。
- `mode=json` 仍保持原有语义，可作为兼容和回退基础。

### 返回模式

`mode=json`：

- 返回原始公开块树。
- 不触发后端 HTML 渲染。
- 不附加块级 `html`。
- 用于编辑器、调试或需要原始 Tiptap JSON 的客户端。

`mode=html`：

- 后端尝试为可渲染块附加 `html` 字段。
- 如果整套渲染服务不可用或发生服务级异常，回退到原始 JSON 块树。
- 当前响应体仍保留 JSON 字段，避免前端对 codeBlock 等特殊块失去处理能力。

`mode=all`：

- 当前公开阅读页使用该模式。
- 每个块优先消费后端返回的 `html`。
- 没有 `html` 的块继续使用原始 Tiptap JSON 由前端本地静态渲染。
- 适合“后端渲染 + 前端回退”的混合展示。

### 渲染单位

渲染单位选择“块版本”，不是文档，也不是当前块 ID。

原因：

- 同一个 `blockId` 在内容更新后会产生新的版本。
- HTML 是 Tiptap JSON 的派生产物，必须绑定到具体内容版本。
- 旧版本文档、发布快照和历史 diff 不能被最新块内容污染。
- 渲染规则变更时可以通过 `renderVersion` 让旧缓存自动失效。

### 缓存表

新增 `block_render_caches` 表，用于保存块版本的 HTML 渲染结果。

核心字段：

```txt
id                主键
blockVersionId    块版本表内部 ID
docId             文档 ID
blockId           块 ID
blockVer          块版本号
renderVersion     渲染规则版本
html              安全处理后的 HTML
status            success | failed
error             渲染失败原因
renderedAt        渲染时间戳
createdAt         创建时间
updatedAt         更新时间
```

唯一约束：

```txt
blockVersionId + renderVersion
```

这个约束保证同一个块版本在同一套渲染规则下只保存一份缓存。

### 渲染版本

当前渲染版本常量：

```txt
tiptap-static-v1
```

当以下内容发生变化时，应修改渲染版本：

- Tiptap 扩展 schema。
- JSON 到 HTML 的序列化规则。
- sanitize 白名单。
- 自定义节点或 mark 的 HTML 输出。
- 影响最终 HTML 结构或安全策略的规则。

修改 `renderVersion` 后，旧缓存不会命中，新请求会重新生成缓存。

## 后端实现细节

### DTO

`QueryContentDto` 新增：

```ts
export type ContentRenderMode = "json" | "html" | "all";
mode?: ContentRenderMode;
```

校验规则：

```ts
@IsOptional()
@IsIn(["json", "html", "all"])
mode?: ContentRenderMode;
```

默认值在 service 层处理为 `json`。

### Controller

`DocumentsController.getContent()` 继续支持登录用户和站点公开匿名用户两条路径。

新增点：

- 将 `queryDto.mode` 传入 service。
- 使用 `@Res({ passthrough: true })` 写响应头，不接管 Nest 的响应流程。
- 从 service 返回值中读取内部 `renderDiagnostics`。
- 将诊断信息写入响应头。
- 从响应体中移除 `renderDiagnostics`，避免改变公开 JSON body 合约。

### Service

`DocumentsService.getContent()` 和 `getContentSitePublic()` 都新增 `mode` 参数。

核心处理函数：

```txt
getContentByDocument()
  -> buildContentTreeFromStartBlock() 或 buildContentTreeFromVersionMap()
  -> withOptionalRenderedHtml()
```

`withOptionalRenderedHtml()` 负责判断模式：

- `json`：不调用渲染服务，直接返回剥离内部元数据后的块树。
- `html/all` 且渲染服务存在：调用 `DocumentRenderService.renderTree()`。
- 渲染服务不存在：回退 JSON。
- 渲染服务抛出服务级异常：记录 warn 日志并回退 JSON。

### 内部元数据

为了让渲染缓存绑定到块版本，构建内容树时内部节点会携带：

```txt
blockVersionId
docId
ver
```

这些字段只给后端渲染服务使用。返回给客户端前会通过 `stripRenderMetadata()` 移除。

因此客户端仍看到稳定的块对象：

```json
{
  "blockId": "b_1",
  "type": "paragraph",
  "payload": {},
  "children": [],
  "html": "<p>...</p>"
}
```

不会看到：

```json
{
  "blockVersionId": 123,
  "ver": 4
}
```

### HTML 渲染服务

新增 `DocumentHtmlRendererService`：

- 使用 `@tiptap/static-renderer/pm/html-string`。
- 与前端编辑器尽量保持一致的 Tiptap extensions。
- 将单个块 payload 包装为 Tiptap doc 后渲染：

```ts
{
  type: "doc",
  content: [block.payload]
}
```

渲染后经过 `sanitize-html` 安全处理，再写入缓存或返回给内容接口。

### Tiptap 扩展同步

后端新增 `tiptap-serialization.extensions.ts`，用于复刻前端阅读态所需的序列化能力。

覆盖内容包括：

- StarterKit。
- CodeBlock、Code、Bold、Italic、Strike、Underline。
- HorizontalRule。
- TaskList、TaskItem。
- Link。
- TextStyle、Color、Highlight、TextAlign。
- Table、TableRow、TableCell、TableHeader。
- 自定义 fontSize。
- 自定义 orderedListStyle。
- 自定义 lineHeight。
- 自定义 highlightBlock。
- 自定义 indent。
- BlockIdAttribute。

StarterKit 中会禁用已经单独注册的扩展，避免重复 extension 名称导致行为不稳定。

### 块级缓存服务

新增 `DocumentRenderService`，职责是：

- 遍历块树，找出可服务端渲染的块。
- 批量查询这些块版本的缓存。
- 命中 success 缓存时直接附加 `html`。
- 未命中或命中 failed 缓存时现场渲染。
- 渲染成功后写 success 缓存。
- 单块渲染失败时写 failed 缓存，并保留原 JSON 块。
- 缓存回填失败时仅记录日志，不影响本次响应。

### 不参与服务端渲染的块

当前使用硬编码对象维护：

```ts
export const CLIENT_RENDERED_BLOCK_TYPES: Record<string, true> = {
  codeBlock: true,
};
```

`codeBlock` 暂时不进入后端 HTML 缓存，由前端自己处理。这样可以继续复用前端代码高亮能力，也避免后端高亮主题和前端不一致。

未来如果有更多动态块，也可以先加入这个对象，例如：

```ts
embed: true
aiGenerated: true
liveData: true
```

### 单块失败策略

单个块渲染失败时：

- 不让整篇文档失败。
- 不给该块附加 `html`。
- 原始 `payload` 保留给前端。
- 记录 `renderFailures`。
- 写入 failed 缓存行，保留失败原因。

这样前端仍可使用 JSON 渲染该块。

### 服务级失败策略

如果整个渲染服务不可用或抛出异常：

- service 记录 warn 日志。
- 响应体回退到旧 JSON 形态。
- 响应头标记为 `json` / `none`。

这保证 `mode=html` 和 `mode=all` 不会因为服务端渲染失败而破坏已有读取流程。

## 响应头诊断设计

### 设计目标

用户访问公开文档页面时，需要知道本次内容来源：

- 是后端第一次渲染。
- 是块级缓存命中。
- 是部分缓存命中、部分首次渲染。
- 是否存在 codeBlock 这类前端处理块。
- 是否回退到了 JSON。

仅看页面 HTML 或接口 body 不够直接，所以在内容接口上增加诊断响应头。

### 响应头列表

内容接口返回：

```txt
X-Yuediter-Content-Mode: all
X-Yuediter-Render-Mode: fresh | cache | cache-fresh | mixed | client-json | json
X-Yuediter-Render-Cache: hit | miss | mixed | none
X-Yuediter-Render-Blocks: total=3;renderable=2;cached=1;fresh=1;client=1;failed=0
X-Yuediter-Render-Version: tiptap-static-v1
```

### 字段含义

`X-Yuediter-Content-Mode`：

- 客户端请求的内容模式。
- 当前为 `json`、`html` 或 `all`。

`X-Yuediter-Render-Mode`：

- 本次最终渲染状态。

取值：

```txt
json          未执行 HTML 渲染，或回退 JSON
fresh         所有可服务端渲染块都是本次现场渲染
cache         所有可服务端渲染块都来自缓存
cache-fresh   同时存在缓存命中和现场渲染，但没有前端处理块
mixed         同时存在后端 HTML 和前端处理块
client-json   全部内容块都由前端处理，后端没有生成 HTML
```

`X-Yuediter-Render-Cache`：

- 缓存命中概况。

取值：

```txt
hit     可服务端渲染块全部缓存命中
miss    存在现场渲染或渲染失败
mixed   同时存在缓存命中和现场渲染
none    没有可服务端渲染块，或未执行 HTML 渲染
```

`X-Yuediter-Render-Blocks`：

- 块数量统计。

示例：

```txt
total=3;renderable=2;cached=1;fresh=1;client=1;failed=0
```

含义：

```txt
total       非 root 块总数
renderable  可由后端渲染的块数
cached      本次缓存命中的块数
fresh       本次现场渲染的块数
client      交给前端处理的块数，例如 codeBlock
failed      后端单块渲染失败的块数
```

`X-Yuediter-Render-Version`：

- 当前渲染规则版本。
- 可用于判断缓存是否由最新规则生成。

### 为什么响应头在后端内容接口上

`/blog/:slug` 是前端 Next 页面，当前通过 rewrite 到 `app/doc/[slug]/page.tsx`。这个 Server Component 可以读取后端内容接口的 headers，但不能直接给最终 HTML 文档响应动态设置这些 headers。

如果强行在 `/blog/:slug` 页面响应上声明动态渲染信息，需要使用 route handler 或 middleware 二次请求内容接口。这会导致：

- 多一次内容请求。
- 可能提前触发首次渲染并污染“是否缓存命中”的判断。
- 页面和 metadata 的请求时序更复杂。

因此准确的诊断源放在后端内容接口。

前端公开页读取这些 headers 后，会把它们挂到 `.doc-content` 的 DOM 属性中，方便在浏览器 Elements 面板查看：

```html
<div
  class="doc-content tiptap-editor"
  data-yuediter-content-mode="all"
  data-yuediter-render-mode="mixed"
  data-yuediter-render-cache="mixed"
  data-yuediter-render-blocks="total=3;renderable=2;cached=1;fresh=1;client=1;failed=0"
  data-yuediter-render-version="tiptap-static-v1"
>
</div>
```

## 前端展示页配合

虽然主要改动在后端，但为了完整支持混合展示，前端公开文档页也做了对应调整。

### 请求模式

公开文档详情页从：

```txt
/documents/:docId/content
```

改为：

```txt
/documents/:docId/content?mode=all
```

这样后端会尽量给每个可渲染块附加 `html`。

### 渲染优先级

前端 `renderBlockTreeToHtml()` 的逐块优先级：

```txt
block.html
↓
payload.html
↓
Tiptap JSON 本地静态渲染
```

这保证：

- 后端缓存命中的块直接使用后端 HTML。
- 旧格式 `payload.html` 仍兼容。
- codeBlock 或后端渲染失败的块仍可以由前端 JSON 渲染。
- 一篇文档可以同时包含后端 HTML 和前端 JSON 回退结果。

### metadata 避免预热缓存

此前 `generateMetadata()` 复用了 `getDocContent()`，这会在页面真正渲染前先请求一次 `content?mode=all`。

这会导致一个判断问题：

```txt
metadata 请求先触发首次渲染
↓
页面请求看到缓存命中
↓
用户误以为第一次访问就是 cache hit
```

现在 `generateMetadata()` 改为只请求文档详情接口：

```txt
GET /documents/:docId
```

它不再触发 HTML 渲染，也不会提前热缓存。

## 模拟流程

### 纯首次渲染

前提：

- 文档有 paragraph、heading。
- `block_render_caches` 没有对应 `blockVersionId + renderVersion`。

请求：

```bash
curl -i "http://localhost:5200/api/v1/documents/doc_x/content?mode=all"
```

预期：

```txt
X-Yuediter-Render-Mode: fresh
X-Yuediter-Render-Cache: miss
X-Yuediter-Render-Blocks: total=2;renderable=2;cached=0;fresh=2;client=0;failed=0
```

响应体：

```json
{
  "tree": {
    "children": [
      {
        "type": "paragraph",
        "payload": {},
        "html": "<p>...</p>"
      }
    ]
  }
}
```

数据库：

```txt
block_render_caches 新增 2 条 success 记录
```

### 缓存命中

第二次请求同一文档同一版本：

```bash
curl -i "http://localhost:5200/api/v1/documents/doc_x/content?mode=all"
```

预期：

```txt
X-Yuediter-Render-Mode: cache
X-Yuediter-Render-Cache: hit
X-Yuediter-Render-Blocks: total=2;renderable=2;cached=2;fresh=0;client=0;failed=0
```

数据库：

```txt
不新增重复缓存行
```

### 混合渲染

前提：

- 文档包含 paragraph、heading、codeBlock。
- paragraph 已有缓存。
- heading 没有缓存。
- codeBlock 在 `CLIENT_RENDERED_BLOCK_TYPES` 中。

请求：

```bash
curl -i "http://localhost:5200/api/v1/documents/doc_x/content?mode=all"
```

预期：

```txt
X-Yuediter-Render-Mode: mixed
X-Yuediter-Render-Cache: mixed
X-Yuediter-Render-Blocks: total=3;renderable=2;cached=1;fresh=1;client=1;failed=0
```

响应体：

```json
{
  "children": [
    { "type": "paragraph", "html": "<p>cached</p>" },
    { "type": "heading", "html": "<h2>fresh</h2>" },
    { "type": "codeBlock", "payload": { "type": "codeBlock" } }
  ]
}
```

前端最终展示：

```txt
paragraph 使用后端缓存 HTML
heading 使用后端新渲染 HTML
codeBlock 使用前端 JSON 渲染和高亮能力
```

### 单块渲染失败

前提：

- 某个块 payload 不符合当前 Tiptap schema。
- 其他块可正常渲染。

预期：

```txt
失败块不附加 html
响应体保留失败块 payload
renderFailures 记录失败块
block_render_caches 写 failed 状态
X-Yuediter-Render-Blocks 中 failed 增加
```

整篇文档仍可返回。

### 服务级失败

前提：

- 渲染服务初始化失败。
- 或 `DocumentRenderService.renderTree()` 抛出未捕获异常。

预期：

```txt
响应体回退 JSON
X-Yuediter-Render-Mode: json
X-Yuediter-Render-Cache: none
X-Yuediter-Render-Version: none
```

## 测试流程

### 后端单元测试

`DocumentRenderService` 覆盖：

- 命中块版本 HTML 缓存时不重新渲染。
- 缓存未命中时现场渲染并回填 `block_render_caches`。
- `codeBlock` 不参与后端渲染和缓存。
- 单个块渲染失败时保留 JSON，并写 failed 缓存。
- 同一棵树中缓存命中、现场渲染、前端处理块并存时，诊断为 `mixed`。

`DocumentsService` 覆盖：

- HTML 渲染失败时内容接口回退到原 JSON tree。
- HTML 渲染成功时内容接口携带内部 `renderDiagnostics`，供 controller 写响应头。

`DocumentsController` 覆盖：

- 将 `renderDiagnostics` 转成 `X-Yuediter-*` 响应头。
- 响应体中移除 `renderDiagnostics`。
- 登录态和站点公开匿名访问都能写诊断响应头。

`BlockRenderCache` entity 覆盖：

- `status` 字段显式使用 varchar，避免 SQLite 下 TypeORM 把联合类型推断成 Object。

### 前端测试

公开文档 SSR 渲染契约测试覆盖：

- 页面不依赖 jsdom 型 runtime sanitizer/renderer。
- 页面请求 `content?mode=all`。
- `generateMetadata()` 不请求内容接口，避免提前热 HTML 缓存。
- 常见 Tiptap JSON 块可渲染为 HTML。
- 同一棵 block tree 中优先使用后端 `block.html`，缺失时回退本地 JSON 渲染。

### 已执行验证命令

后端：

```bash
pnpm test -- document-render.service.spec.ts documents.service.spec.ts documents.controller.spec.ts
pnpm build
git diff --check
```

前端：

```bash
pnpm test:unit -- src/services/__tests__/doc-page-ssr-rendering.test.ts
pnpm exec tsc --noEmit
pnpm exec eslint -- "app/doc/[slug]/page.tsx" "src/services/generate-block-html.ts" "src/services/tiptap-extensions.ts" "src/services/__tests__/doc-page-ssr-rendering.test.ts"
pnpm build
git diff --check
```

说明：

- 前端 `pnpm lint` 和全量 `pnpm test:unit` 曾在当前环境跑满 120 秒超时，因此使用目标文件 lint、目标测试、类型检查和构建作为本次验证链路。
- 前端 lint 会输出项目现有的 `eslint.config.js` ESM module type warning，不影响目标文件 lint 结果。
- `next build` 会自动改写 `next-env.d.ts` 中 `.next/dev/types` 与 `.next/types` 引用，构建后已恢复该生成文件，避免无关提交。

## 手工端到端验证流程

本次曾用本地 SQLite 临时库做过一次真实接口流程验证：

1. 启动后端服务。
2. 注册并登录测试用户 `john_doe`。
3. 创建 workspace。
4. 创建 public document。
5. 创建 heading、paragraph、codeBlock 三类块。
6. 请求 `content?mode=json`，确认没有块级 `html`。
7. 请求 `content?mode=all`，确认 heading 和 paragraph 有 `html`，codeBlock 没有 `html`。
8. 发布文档。
9. 匿名请求 `content?mode=html`，确认公开路径可返回 HTML。
10. 再次请求 `content?mode=all`，确认 paragraph HTML 与首次一致。
11. 查询 `block_render_caches`，确认只为 heading 和 paragraph 生成 success 缓存，codeBlock 没有缓存。

这个流程验证了：

- 登录态可用。
- 公开态可用。
- `json`、`html`、`all` 模式可用。
- codeBlock 被前端处理对象正确跳过。
- 块级缓存可以复用。

## 如何排查一个公开页面的渲染来源

假设公开页面是：

```txt
http://localhost:3001/blog/mpj5tloy-d03937ac
```

页面本身会通过 rewrite 渲染到 `app/doc/[slug]/page.tsx`。为了看准确来源，应查看后端内容接口响应头。

如果知道 docId：

```bash
curl -i "http://localhost:5200/api/v1/documents/<docId>/content?mode=all"
```

重点看：

```txt
X-Yuediter-Render-Mode
X-Yuediter-Render-Cache
X-Yuediter-Render-Blocks
```

如果只在浏览器看公开页：

1. 打开 DevTools。
2. 进入 Elements。
3. 选中 `.doc-content.tiptap-editor`。
4. 查看 `data-yuediter-*` 属性。

示例：

```txt
data-yuediter-render-mode="mixed"
data-yuediter-render-cache="mixed"
data-yuediter-render-blocks="total=3;renderable=2;cached=1;fresh=1;client=1;failed=0"
```

说明这篇文档同时使用了：

- 缓存 HTML。
- 本次新渲染 HTML。
- 前端 JSON 处理块。

## 风险与边界

### HTML 安全边界

所有后端渲染 HTML 都需要经过 sanitize。

缓存表中保存的是 sanitize 后的 HTML，而不是原始渲染产物。

### 编辑态边界

HTML 缓存不是事实来源。

事实来源仍然是块版本中的 Tiptap JSON。

缓存可以删除、失效、重建，不应影响文档编辑态内容。

### 前端混合边界

当前 `html` 和 `all` 都保留 JSON 字段，并在块上附加 `html`。

这样做是有意的：

- codeBlock 需要 JSON 回退。
- 单块失败需要 JSON 回退。
- 前端可以逐块选择最合适的渲染方式。

### 文档级缓存尚未实现

本次只实现块级 HTML 缓存。

整篇文档 HTML 缓存、CDN 缓存、页面级静态化不在本次范围。

### 并发首次渲染

当前使用唯一索引避免重复缓存行。

并发请求同一个未缓存块版本时，可能都执行渲染，其中一个写入成功，另一个会被唯一约束或保存逻辑处理。当前策略是缓存回填失败不影响主响应。

后续如需优化，可加入 upsert 或后台预热队列。

## 后续可扩展方向

- 将 `CLIENT_RENDERED_BLOCK_TYPES` 从硬编码迁移到配置。
- 增加文档级 HTML 缓存。
- 增加发布时预热块级 HTML 缓存。
- 增加后台重建缓存任务。
- 在 OpenAPI 文档中补充响应头说明。
- 对 `renderFailures` 增加更结构化的错误码。
- 支持多主题渲染版本，例如 light/dark/code-theme。
- 支持导出 Markdown、PDF 或纯 HTML 包。
- 接入 CDN，并用 `X-Yuediter-Render-*` 作为观察和调试依据。

## 总结

这次增强建立了一个稳定的后端内容渲染出口：

- 内容接口支持 `json`、`html`、`all` 三种模式。
- 后端使用 Tiptap 静态渲染器生成 HTML。
- 块级 HTML 缓存绑定到块版本和渲染版本。
- codeBlock 等特殊块由前端继续处理。
- 单块失败和服务级失败都有 JSON 回退。
- 响应头可以精确说明缓存命中、首次渲染和混合渲染状态。
- 前端公开页支持逐块优先后端 HTML，并自动回退 JSON。

这让文档系统从“编辑器后端”进一步具备了“内容发布基础设施”的能力。
