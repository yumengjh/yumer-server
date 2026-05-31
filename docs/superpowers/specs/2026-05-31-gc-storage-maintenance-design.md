# GC Storage Maintenance 设计

<!-- cspell:words freelist autovacuum checkpointing incremental pragmas WAL wal busytimeout -->

> 状态：proposal  
> 日期：2026-05-31  
> 仓库：`E:\workspace\yuweb\back\server`

## 1. 背景

Block version GC 现在已经具备真实逻辑清理能力：

- tombstone map compaction
- revision tombstone compaction
- `block_versions` 行级删除

但逻辑删除和数据库文件变小不是一回事。

尤其 SQLite：

- 删除行后，空闲页通常进入 freelist
- 数据库文件大小通常不会立刻下降
- 真正缩小文件通常需要 `VACUUM`
- 如果开启 WAL，还要考虑 wal 文件和 checkpointing

Postgres 也类似：

- `DELETE` 不等于数据文件立刻缩小
- 空间回收通常交给 autovacuum
- `VACUUM FULL` 会锁表，不适合从应用接口随手触发

所以 storage maintenance 必须从 GC sweep 中拆出来。

## 2. 结论

建议做一个独立 service，但先放在 GC 模块下：

```text
src/modules/gc/
├─ gc-sweep.service.ts
├─ gc-storage-maintenance.service.ts
├─ gc-storage-maintenance.service.spec.ts
├─ gc.controller.ts
```

不建议一开始做顶级 `StorageMaintenanceModule`。

原因：

1. 当前消费方主要还是 GC 调试页和后台运维面板。
2. 维护能力需要借用 GC 的 admin guard 和审计语义。
3. 但 service 必须独立，避免 `GcSweepService` 直接跑 `VACUUM`。

边界一句话：

> `GcSweepService` 负责逻辑清理；`GcStorageMaintenanceService` 负责存储层维护；两者不互相调用。

## 3. 不应该做什么

### 3.1 不要在 sweep 后自动 VACUUM

即使 `sweeps/block-versions` 删除了很多行，也不应该自动触发 SQLite `VACUUM`。

原因：

- `VACUUM` 可能耗时较长
- 可能阻塞写入
- 需要额外临时磁盘空间
- 失败后的恢复语义和 GC sweep 完全不同

GC sweep summary 可以提示“可能存在 storage maintenance 机会”，但不能直接执行维护。

### 3.2 不要把 SQLite 和 Postgres 混成同一个成功语义

SQLite 可以由应用显式执行 `VACUUM`。

Postgres 第一版不应该由应用执行 `VACUUM FULL`。最多返回：

- 当前 driver
- maintenance 由 autovacuum / DBA 管理
- 应用不支持压缩执行

### 3.3 不要在事务内执行存储维护

SQLite `VACUUM` 不能放进业务事务。

即使未来支持 `PRAGMA incremental_vacuum`，也应该作为独立维护操作，而不是嵌入 block version delete 事务。

## 4. 接口设计

接口前缀建议：

```text
/admin/gc/storage
```

继续复用 `SystemAdminTokenGuard`。

### 4.1 状态查询

```http
GET /admin/gc/storage/status
```

SQLite 返回示例：

```json
{
  "driver": "sqlite",
  "storageCompactionSupported": true,
  "storageCompactionMode": "vacuum",
  "logicalGcSupported": true,
  "sqlite": {
    "databasePath": "./data/app.db",
    "databaseFileBytes": 49152000,
    "walFileBytes": 1048576,
    "shmFileBytes": 32768,
    "pageSize": 4096,
    "pageCount": 12000,
    "freelistCount": 3200,
    "estimatedFreeBytes": 13107200,
    "freeRatio": 0.2667,
    "journalMode": "wal",
    "autoVacuum": "none",
    "busyTimeoutMs": 5000
  },
  "recommendation": {
    "shouldCompact": true,
    "reason": "freelist_ratio_above_threshold",
    "thresholds": {
      "minFreeBytes": 104857600,
      "minFreeRatio": 0.2
    }
  }
}
```

Postgres 返回示例：

```json
{
  "driver": "postgres",
  "storageCompactionSupported": false,
  "storageCompactionMode": "managed_by_database",
  "logicalGcSupported": true,
  "postgres": {
    "maintenanceOwner": "autovacuum_or_dba"
  },
  "recommendation": {
    "shouldCompact": false,
    "reason": "application_compaction_not_supported"
  }
}
```

### 4.2 压缩计划

第一版可以让 `POST /compact` 的 `dryRun = true` 等价于 plan。

```http
POST /admin/gc/storage/compact
Content-Type: application/json
```

请求：

```json
{
  "dryRun": true,
  "mode": "vacuum"
}
```

返回：

```json
{
  "driver": "sqlite",
  "dryRun": true,
  "mode": "vacuum",
  "supported": true,
  "wouldRun": true,
  "before": {
    "databaseFileBytes": 49152000,
    "freelistCount": 3200,
    "estimatedFreeBytes": 13107200,
    "freeRatio": 0.2667
  },
  "warnings": [
    "vacuum_may_block_writes",
    "vacuum_requires_temporary_disk_space"
  ]
}
```

### 4.3 真实压缩

真实执行必须要求显式确认：

```json
{
  "dryRun": false,
  "mode": "vacuum",
  "confirm": "VACUUM_SQLITE_DATABASE"
}
```

返回：

```json
{
  "driver": "sqlite",
  "dryRun": false,
  "mode": "vacuum",
  "status": "completed",
  "startedAt": "2026-05-31T10:00:00.000Z",
  "finishedAt": "2026-05-31T10:00:08.000Z",
  "durationMs": 8000,
  "before": {
    "databaseFileBytes": 49152000,
    "freelistCount": 3200,
    "estimatedFreeBytes": 13107200
  },
  "after": {
    "databaseFileBytes": 35651584,
    "freelistCount": 0,
    "estimatedFreeBytes": 0
  }
}
```

Postgres 第一版：

```json
{
  "driver": "postgres",
  "dryRun": false,
  "mode": "vacuum",
  "status": "unsupported",
  "reason": "postgres_storage_maintenance_managed_by_database"
}
```

## 5. SQLite 实现细节

### 5.1 读取状态

需要读取：

```sql
PRAGMA page_size;
PRAGMA page_count;
PRAGMA freelist_count;
PRAGMA journal_mode;
PRAGMA auto_vacuum;
PRAGMA busy_timeout;
```

计算：

```text
estimatedFreeBytes = page_size * freelist_count
databaseLogicalBytes = page_size * page_count
freeRatio = freelist_count / page_count
```

文件大小：

- 主库文件：`DB_SQLITE_PATH`
- WAL：`${DB_SQLITE_PATH}-wal`
- SHM：`${DB_SQLITE_PATH}-shm`

文件不存在时返回 `0`，不要抛错。

### 5.2 执行 VACUUM

执行前检查：

- 当前 driver 必须是 SQLite
- `dryRun = false` 必须带 `confirm = VACUUM_SQLITE_DATABASE`
- 不在 TypeORM transaction 内执行
- 建议先设置或读取 `busy_timeout`

执行：

```sql
VACUUM;
```

执行后重新读取 status。

### 5.3 WAL 处理

SQLite WAL 模式下，即使主库 `VACUUM` 完成，wal 文件也可能仍存在。

第一版建议只在 status 中展示 `walFileBytes`，不要自动 checkpoint。

后续可以增加：

```json
{
  "mode": "wal_checkpoint_truncate"
}
```

对应：

```sql
PRAGMA wal_checkpoint(TRUNCATE);
```

但这应该是独立 mode，不要和 `VACUUM` 混在一起。

### 5.4 incremental vacuum

如果未来启用：

```sql
PRAGMA auto_vacuum = INCREMENTAL;
```

可以支持：

```json
{
  "mode": "incremental_vacuum",
  "pages": 1000
}
```

对应：

```sql
PRAGMA incremental_vacuum(1000);
```

第一版不建议做。原因是当前 schema / 初始化流程没有统一管理 `auto_vacuum`，贸然暴露 incremental mode 容易产生误导。

## 6. Postgres 实现边界

Postgres 第一版只做 status，不做 compact。

原因：

- 普通 `VACUUM` 不保证文件缩小
- `VACUUM FULL` 会重写表并持有强锁
- 应用层没有足够上下文判断是否该执行
- 生产环境更应该由 autovacuum / DBA 维护

后续如果真要支持，也应该是：

- 只允许 dry-run 展示建议 SQL
- 不由应用自动执行 `VACUUM FULL`
- 或者只暴露“维护建议”，由外部运维系统执行

## 7. DTO 建议

```ts
export class CreateStorageCompactDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsIn(["vacuum", "wal_checkpoint_truncate", "incremental_vacuum"])
  mode?: string;

  @IsOptional()
  @IsString()
  confirm?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  pages?: number;
}
```

第一版实际只开放：

- `mode = vacuum`
- `dryRun = true | false`
- `confirm = VACUUM_SQLITE_DATABASE`

`wal_checkpoint_truncate` 和 `incremental_vacuum` 先写进类型设计，不急着实现。

## 8. Service 设计

建议新增：

```ts
class GcStorageMaintenanceService {
  getStatus(): Promise<GcStorageStatus>;
  compact(
    input: CreateStorageCompactInput,
    operator: string,
  ): Promise<GcStorageCompactResult>;
}
```

依赖：

- `DataSource`
- `ConfigService`
- Node `fs/promises`

注意：

- `operator` 第一版可以只进 result，不落表
- 如果后续需要审计，再新增 `gc_storage_maintenance_runs`
- 不建议复用 `gc_runs`，因为它不属于 block version resource sweep

## 9. 是否需要新表

第一版不需要。

原因：

- status 可以实时查询
- compact 是显式维护动作
- 结果可以直接返回给前端

后续如果要满足审计要求，再考虑新增：

```text
gc_storage_maintenance_runs
├─ id
├─ runId
├─ driver
├─ mode
├─ status
├─ dryRun
├─ beforeStats
├─ afterStats
├─ triggeredBy
├─ startedAt
├─ finishedAt
├─ errorMessage
```

不建议现在就加。GC 已经有多张表，storage maintenance 先保持轻。

## 10. 前端展示建议

GC 调试页可以加一个独立面板：

### Storage Status

展示：

- driver
- database file size
- WAL file size
- page count
- freelist count
- estimated free bytes
- free ratio
- recommendation

### Storage Compact

按钮：

- `Plan Vacuum`
- `Run Vacuum`

交互：

- 默认只允许 dry-run
- real-run 前要求确认弹窗
- 文案明确“可能阻塞写入”
- Postgres 显示“由数据库 autovacuum / DBA 管理”

## 11. 实现顺序

### Phase A：status

- 新增 `GcStorageMaintenanceService`
- 新增 `GET /admin/gc/storage/status`
- SQLite 读取 PRAGMA 和文件大小
- Postgres 返回 managed-by-database
- 补 service/controller 测试

### Phase B：SQLite dry-run compact

- 新增 `POST /admin/gc/storage/compact`
- 支持 `dryRun = true`
- 返回 before stats 和 warnings

### Phase C：SQLite real VACUUM

- 支持 `dryRun = false`
- 要求 confirm
- 执行 `VACUUM`
- 返回 before / after stats
- 不落表

### Phase D：审计与 checkpoint

根据前端使用情况再决定：

- 是否新增 maintenance runs 表
- 是否支持 WAL checkpoint truncate
- 是否支持 incremental vacuum

## 12. 结论

应该单独做 storage maintenance service，但先放在 GC 模块下。

第一版只做：

1. `GET /admin/gc/storage/status`
2. `POST /admin/gc/storage/compact`
3. SQLite 支持 `dryRun` 和显式确认后的 `VACUUM`
4. Postgres 返回 unsupported / managed-by-database

不要把它接到 GC sweep 自动链路里。

这样前端 GC 调试页能完整表达三层状态：

1. preview / pool：能不能删
2. sweep：逻辑上删了什么
3. storage maintenance：数据库文件是否值得维护
