# 同步协议改造说明（`/blocks/batch` + `sync-state`）

日期：2026-05-19  
范围：`back/server`  
目标：把块批处理接口升级为前端同步引擎可消费的“协议通道”，并补齐冲突与状态查询能力。

---

## 1. 背景

在旧链路中，前端自动保存依赖“先拉整文档再做 diff”，导致：

- 自动保存链路长、延迟高；
- 缺少可确认的 batch ack 结构，前端难以稳定消费；
- 无轻量 `sync-state` 接口，前端常需走重路径查询。

本次后端改造目标是：**不改版本体系核心语义的前提下，补齐同步协议能力**。

---

## 2. 设计目标与边界

### 2.1 目标

1. `POST /blocks/batch` 返回结构化 ack（可用于前端 inflight 对账）。  
2. 支持基础冲突检测（`baseVersion` 与 `serverHead` 不一致时返回冲突信号）。  
3. 提供 `GET /documents/:docId/sync-state` 轻接口。  
4. 保持 `commit/publish/revert` 等既有版本能力不破坏。

### 2.2 边界

- 不引入 OT/CRDT；  
- 不实现多人实时协同；  
- 不在本次改造中重写版本控制体系。

---

## 3. 协议层改造

## 3.1 Batch 请求扩展

在 `BatchBlockDto` 中新增：

- `baseVersion?: number`
- `clientBatchId?: string`
- `source?: 'autosync' | 'manual-save'`

并在 create 操作中支持：

- `clientId?: string`（用于 create ack 回填）

对应文件：

- `src/modules/blocks/dto/batch-block.dto.ts`

## 3.2 Batch Ack 返回结构

新增 `SyncBatchResponseDto`，核心字段：

- `acceptedBatchId`
- `appliedAt`
- `serverHead`
- `needsReload`
- `conflicts[]`
- `results[]`（逐操作结果，含 `clientId/blockId/version/error`）

对应文件：

- `src/modules/blocks/dto/sync-batch-response.dto.ts`

## 3.3 sync-state 轻接口

新增：

- `GET /documents/:docId/sync-state`

返回：

- `docId`
- `head`
- `publishedHead`
- `hasPendingDraft`
- `pendingCount`
- `updatedAt`

对应文件：

- `src/modules/documents/dto/sync-state-response.dto.ts`
- `src/modules/documents/documents.controller.ts`
- `src/modules/documents/documents.service.ts`

---

## 4. 一致性与安全性修正

在 batch 实现中补齐以下关键点：

1. **去副作用权限校验**  
   - 避免通过会增加 `viewCount` 的读取方法做高频同步校验。  

2. **事务内版本冲突检测**  
   - 避免事务外检查导致 TOCTOU。  

3. **跨文档防护**  
   - `update/delete/move` 查询绑定 `docId`，防止误操作其他文档块。  

4. **结构合法性校验**  
   - create/move 校验父块存在、同文档、无非法环。  

5. **版本推进条件修正**  
   - 仅在“有成功操作且需要创建版本”时推进 head。

对应文件：

- `src/modules/blocks/blocks.service.ts`
- `src/modules/documents/documents.service.ts`
- `src/modules/documents/services/version-control.service.ts`

---

## 5. 测试与验证

新增与补充：

- `test/document-sync.e2e-spec.ts`
  - 验证 batch ack 元数据；
  - 验证 `sync-state` 返回结构。
- `src/modules/documents/services/version-control.service.spec.ts`
  - 保证版本控制服务关键行为可回归。

---

## 6. 结果与后续建议

### 6.1 本次结果

- 后端已具备前端同步引擎所需的基础协议能力；
- 冲突信号和轻状态查询能力已就位；
- 批处理一致性与安全边界较改造前更稳健。

### 6.2 后续建议

1. 为 `results[]` 增加更稳定的客户端映射策略（例如统一返回操作索引）；  
2. 增加协议层可观测字段（batch 大小、耗时、冲突率）；  
3. 与前端同步引擎对齐“delete-not-found 幂等语义”。

