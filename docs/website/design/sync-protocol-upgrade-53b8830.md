# 同步机制升级说明（提交 `53b8830`）

## 背景

旧链路下，前端自动保存常采用“整文档读取 + 前端 diff + 批量写回”，在大文档或高频编辑时存在：

- 链路长、延迟高；
- 缺少可对账的批次确认结构；
- 冲突与重载信号不明确；
- 前端难以稳定实现 local-first 同步体验。

为支撑同步引擎改造，后端在提交 `53b8830fa2f35b111b7013d143ba7b8a203f6d59` 完成协议级升级。

---

## 设计目标

1. 让 `POST /blocks/batch` 从“业务批处理接口”升级为“同步协议主通道”；  
2. 在不重写版本体系的前提下，提供最小可用冲突检测；  
3. 增加轻量同步状态查询接口，避免自动保存依赖重路径。

---

## 工作机制

## 1) 批次写入（`/blocks/batch`）

客户端以批次发送 block 级操作（create/update/delete/move），请求可携带：

- `baseVersion`
- `clientBatchId`
- `source`（`autosync | manual-save`）
- create 操作可附带 `clientId`

服务端在事务中执行：

1. 权限与文档归属校验  
2. 基线版本冲突校验（必要时返回冲突）  
3. 执行批次操作并记录结果  
4. 返回结构化 ack（供前端 inflight 对账）

## 2) 状态查询（`/documents/:docId/sync-state`）

返回：

- `docId`
- `head`
- `publishedHead`
- `pendingCount`
- `hasPendingDraft`
- `updatedAt`

该接口不重建内容树，适合作为同步探针和状态对齐依据。

---

## 协议

## 请求扩展（Batch）

- `baseVersion?: number`
- `clientBatchId?: string`
- `source?: 'autosync' | 'manual-save'`

## Ack 返回

- `acceptedBatchId`
- `appliedAt`
- `serverHead`
- `needsReload`
- `conflicts[]`
- `results[]`（逐操作结果，可带 `clientId/blockId/version/error`）

---

## 关键点

1. **事务内冲突检查**：避免事务外检查导致 TOCTOU。  
2. **跨文档安全边界**：update/delete/move 绑定 `docId`。  
3. **无副作用权限校验**：避免高频同步误增浏览计数。  
4. **版本推进语义修正**：仅在有效成功操作时推进版本。  
5. **create ack 回填能力**：支持 `clientId -> blockId` 对齐。

---

## 与前端联动建议

1. 自动保存路径使用 `/blocks/batch` 且 `createVersion: false`；  
2. 手动保存采用“flush barrier + commit”流程；  
3. 收到 `needsReload=true` 时执行局部/整文档重载；  
4. create 成功后用 `results` 回填本地 `blockId`；  
5. 定期或关键节点调用 `/sync-state` 对齐 `head/pendingCount`。

---

## 边界

- 本次不是 OT/CRDT 实时协同实现；  
- 不处理复杂多人冲突自动合并；  
- 不引入离线持久队列。

该升级目标是：**先把单人编辑的同步协议打稳，确保可观测、可对账、可恢复。**

