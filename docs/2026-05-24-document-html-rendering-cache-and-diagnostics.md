# 文档内容后端 HTML 渲染、块级缓存、内容模式分层与发布后主动失效说明

## 1. 文档定位

这份文档用于说明 2026-05-24 这一轮后端公开文档能力增强的完整设计与实现，覆盖以下主题：

- 文档内容接口的三种内容模式：`json / html / all`
- 服务端 HTML 渲染与块级缓存
- 渲染诊断响应头
- 发布后的主动缓存失效回调
- 与前端公开文档页的协作方式

它既是实现说明，也是后续维护文档。

---

## 2. 背景

后端最初主要承担“编辑器数据存储与版本管理”的职责，公开文档页面虽然可以展示内容，但更多依赖前端把 Tiptap JSON 再渲染成 HTML。

随着公开阅读场景增强，系统出现了新的需求：

1. 后端需要直接提供更适合公开阅读的内容形态
2. 同一篇文档的公开访问应该尽量复用服务端渲染结果
3. 页面要能区分“缓存命中”“首次渲染”“混合渲染”“完全回退 JSON”
4. 发布完成后，公开页缓存要尽快失效
5. 实时调试路径仍然要保留

因此，后端从“只返回结构化内容”演进到了“返回结构化内容 + 服务端渲染能力 + 缓存观察能力 + 发布驱动缓存刷新能力”。

---

## 3. 总体架构

### 3.1 三层职责划分

#### 第一层：文档数据层
由 `DocumentsService` 与版本快照体系负责：

- 读取文档元数据
- 读取指定版本/发布版本对应的 block tree
- 处理公开访问权限

#### 第二层：块级渲染层
由 `DocumentRenderService` 与 `DocumentHtmlRendererService` 负责：

- 判断哪些块适合服务端渲染
- 优先命中块级 HTML 缓存
- 缓存未命中时现场渲染
- 记录渲染诊断信息

#### 第三层：对外响应整形层
仍由 `DocumentsService` 负责：

- 根据 `mode=json | html | all` 决定最终返回形态
- 对外隐藏内部字段，如 `blockVersionId`
- 在 `mode=html` 下移除已成功渲染块的 `payload`

### 3.2 发布后缓存失效层

在 `publish()` 成功后，后端通过 HTTP 最佳努力回调前端：

- 自动计算公开 `slug`
- 调前端 revalidate API
- 回调失败只记录日志，不影响 publish 成功

---

## 4. 内容接口设计

接口入口：

```txt
GET /api/v1/documents/:docId/content
```

通过查询参数 `mode` 区分返回语义。

### 4.1 `mode=json`

- 只返回原始 block tree
- 不做服务端 HTML 渲染
- 适合编辑器、调试和结构化消费方

### 4.2 `mode=html`

- 返回适合公开阅读的轻量混合树
- 已成功服务端渲染的块：保留 `html`，删除 `payload`
- 前端仍需处理的块（如 `codeBlock`）：保留 `payload`
- 服务端渲染失败的块：保留 `payload`

这是公开文档详情页默认使用的模式。

### 4.3 `mode=all`

- 返回富信息混合树
- 已渲染块保留 `html + payload`
- 前端处理块仍保留 JSON

该模式更适合调试、兼容和迁移观察。

---

## 5. 块级 HTML 渲染与缓存

### 5.1 为什么缓存粒度是“块版本”

因为：

- 同一个 `blockId` 会随着内容变化产生多个版本
- HTML 是对具体 Tiptap JSON 的派生产物
- 历史版本、发布版本和草稿版本不能共享同一份渲染结果

所以缓存绑定的是：

```txt
blockVersionId + renderVersion
```

### 5.2 `block_render_caches` 的职责

缓存表负责记录某个块版本在某个渲染规则版本下的渲染结果：

- 成功时保存 `html`
- 失败时保存失败状态和错误信息

这样既能命中缓存，也能避免对持续失败的块无限重复渲染。

### 5.3 当前不参与服务端渲染的块

当前明确保留给前端处理的类型：

```ts
codeBlock
```

原因：

- 代码块仍依赖前端高亮和交互增强
- 主题和展示行为更适合放在客户端

后续如有更多动态块，也可以继续纳入同类策略。

---

## 6. `mode=html` 与 `mode=all` 的关键差异

### 6.1 旧问题

过去的实现里：

- `mode=html` 与 `mode=all` 返回差异很小
- 已渲染块依然保留完整 `payload`
- 公开页没有真正得到更轻量的返回体

### 6.2 新语义

现在：

- `mode=all`
  - 保留完整混合树
  - 已渲染块保留 `html + payload`

- `mode=html`
  - 对已有 `html` 的块删除 `payload`
  - 对没有 `html` 的块保留 `payload`

因此 `mode=html` 才真正成为“默认公开阅读模式”。

---

## 7. 渲染诊断头设计

内容接口会返回一组 `X-Yuediter-*` 响应头，用于帮助前端和开发者理解当前响应的来源。

### 7.1 主要响应头

```txt
X-Yuediter-Content-Mode
X-Yuediter-Render-Mode
X-Yuediter-Render-Cache
X-Yuediter-Render-Blocks
X-Yuediter-Render-Version
```

### 7.2 含义

#### `X-Yuediter-Content-Mode`
表示本次请求传入的内容模式：

- `json`
- `html`
- `all`

#### `X-Yuediter-Render-Mode`
表示最终渲染结果形态：

- `json`
- `fresh`
- `cache`
- `cache-fresh`
- `mixed`
- `client-json`

#### `X-Yuediter-Render-Cache`
表示缓存命中状态：

- `hit`
- `miss`
- `mixed`
- `none`

#### `X-Yuediter-Render-Blocks`
表示块级统计，例如：

```txt
total=3;renderable=2;cached=1;fresh=1;client=1;failed=0
```

#### `X-Yuediter-Render-Version`
表示当前渲染规则版本，例如：

```txt
tiptap-static-v1
```

---

## 8. 发布后主动失效设计

### 8.1 目标

让公开文档详情页默认走缓存，但在发布后缓存能够被及时打掉，而不是只依赖长 TTL 自然过期。

### 8.2 实现方式

在 `DocumentsService.publish()` 成功后，增加：

```ts
await this.revalidatePublicDocumentPath(document)
```

### 8.3 执行条件

只有同时满足以下条件时才会触发回调：

1. 文档可见性是 `public`
2. 配置了：
   - `PUBLIC_SITE_REVALIDATE_URL`
   - `PUBLIC_SITE_REVALIDATE_SECRET`

### 8.4 回调流程

1. 使用 `docId` 计算公开页对应 `slug`
2. 发起：

```txt
POST <PUBLIC_SITE_REVALIDATE_URL>
```

3. Header 带：

```txt
x-revalidate-secret
```

4. Body 带：

```json
{ "slug": "xxx" }
```

### 8.5 为什么失败不让 publish 失败

因为：

- publish 成功意味着内容事实已经成立
- revalidate 失败只意味着缓存刷新未完成

如果把缓存失效失败等价成发布失败，会让业务语义变乱。

因此当前策略是：

- **发布事务优先成功**
- **缓存失效 best effort**
- **失败只记日志**

### 8.6 调试兜底

即使回调失败，仍然可以通过 `/blog/:slug/latest` 强制读取实时内容，因此系统仍然保留了可靠的调试与验收通道。

---

## 9. 环境变量与使用说明

### 9.1 后端新增环境变量

```env
PUBLIC_SITE_REVALIDATE_URL=http://your-frontend-host/api/revalidate-doc
PUBLIC_SITE_REVALIDATE_SECRET=your-secret
```

### 9.2 配置要求

- URL 必须可从后端访问前端实例
- secret 必须与前端 `REVALIDATE_SECRET` 一致
- 若不配置这两个变量，发布流程不会触发前端主动失效

### 9.3 使用场景

#### 场景一：普通公开访问

- 前端默认访问 `/blog/:slug`
- 前端内容请求默认使用 `mode=html`
- 页面默认命中缓存

#### 场景二：发布后刷新

- 后端 publish 成功
- 自动请求前端 revalidate API
- 前端清掉对应 `/doc/:slug` 的缓存

#### 场景三：排查缓存问题

- 直接访问 `/blog/:slug/latest`
- 强制穿透缓存
- 用于对比缓存页和实时页

---

## 10. 测试与验证

### 10.1 后端单测覆盖

已覆盖：

- `mode=html` 删除已渲染块 `payload`
- `mode=html` 保留 `codeBlock` JSON
- `mode=all` 保留 `payload`
- 发布成功后会调用前端失效接口
- 前端失效失败不会影响发布成功
- 渲染器缓存命中、未命中、混合模式与失败回退
- controller 正确写出诊断响应头

### 10.2 构建验证

已通过：

```bash
pnpm test -- src/modules/documents/documents.controller.spec.ts src/modules/documents/documents.service.spec.ts src/modules/documents/services/document-render.service.spec.ts
pnpm build
```

---

## 11. 已知边界与后续建议

### 11.1 当前只失效详情页

当前回调只失效：

```txt
/doc/:slug
```

没有同时失效 `/blog` 列表页。原因是当前列表页仍然是 `no-store`，还没进入近 SSG 化路径。

### 11.2 可以继续演进的方向

1. 列表页缓存化后，再在发布时补 `revalidatePath('/blog')`
2. 把 revalidate 回调抽成独立 service
3. 为失败告警增加统计与重试策略
4. 将来若访问规模继续提升，再评估发布态 HTML snapshot / CDN 化

---

## 12. 总结

这轮后端增强完成了三件关键事情：

1. **把内容模式真正分层**
   - `html` 用于轻量公开阅读
   - `all` 用于调试与兼容

2. **把渲染链路变成可缓存、可诊断、可回退**
   - 服务端渲染可以复用块级缓存
   - 单块失败不会拖垮整页
   - 诊断头可以解释当前响应来源

3. **把公开缓存刷新变成发布驱动**
   - 发布后主动通知前端失效
   - 普通访问更接近静态页体验
   - `/latest` 仍保留实时兜底通道

这使后端从“文档编辑系统服务端”进一步演化为“公开阅读与发布基础设施的一部分”。
