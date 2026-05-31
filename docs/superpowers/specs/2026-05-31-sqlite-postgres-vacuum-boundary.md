# SQLite 与 Postgres 的 VACUUM 边界讨论

<!-- cspell:words autovacuum freelist tuples bloat checkpointing -->

> 状态：discussion  
> 日期：2026-05-31  
> 背景：GC 真实清扫后，是否需要提供数据库存储压缩能力

## 1. 问题

在 GC 已经能真实删除 `block_versions` 后，一个自然问题是：

> 还要不要再做一个 storage compact / vacuum 能力？

更具体地说：

> Postgres 也需要像 SQLite 一样由应用暴露 `VACUUM` 接口来缩小数据库文件吗？

结论是：

**SQLite 需要重点考虑应用内显式 compact；Postgres 不应该按 SQLite 的方式处理。**

## 2. 共同点

SQLite 和 Postgres 都有一个共同现实：

> `DELETE` 完成不等于磁盘文件立刻变小。

GC 的 `sweeps/block-versions` 删除 `block_versions` 行，只代表逻辑数据清掉了。数据库文件是否变小，是存储引擎自己的空间管理问题。

所以无论 SQLite 还是 Postgres，前端都不应该把 GC sweep 成功展示成“磁盘空间已释放”。

## 3. SQLite 的语义

SQLite 是单文件数据库。

删除大量数据后，数据库文件里会留下可复用的空闲页。除非配置了合适的 `auto_vacuum`，否则文件通常不会自动缩小。

SQLite 官方对 `VACUUM` 的定义很直接：

- 重建数据库文件
- 把内容重新打包到更小空间
- 删除后留下的 free pages 可以通过 `VACUUM` 回收

这意味着在 SQLite 场景下，应用提供一个显式维护接口是合理的：

```http
POST /admin/gc/storage/compact
```

但它仍然应该是显式维护动作，而不是 GC sweep 的自动后置动作。

原因：

- `VACUUM` 可能阻塞写入
- `VACUUM` 需要额外临时磁盘空间
- WAL 模式下还可能涉及 wal 文件和 checkpointing
- 失败语义和业务 GC 删除完全不同

因此 SQLite 的正确设计是：

1. `GET /admin/gc/storage/status` 先展示 `page_count` / `freelist_count` / 文件大小
2. `POST /admin/gc/storage/compact` 默认 dry-run
3. 真执行必须带显式确认，例如 `VACUUM_SQLITE_DATABASE`
4. 执行前后返回文件大小和 freelist 变化

## 4. Postgres 的语义

Postgres 的情况不同。

Postgres 里普通 `VACUUM` 的核心目的不是“把文件缩小给操作系统”，而是：

- 清理 dead tuples
- 让空间可被后续写入复用
- 更新统计信息
- 维护 visibility map
- 防止 transaction ID wraparound

普通 `VACUUM` 可以和常规读写并行运行，适合由 autovacuum 周期性维护。

但普通 `VACUUM` 通常不会把空间还给操作系统。Postgres 文档明确区分了 standard `VACUUM` 和 `VACUUM FULL`：

- standard `VACUUM`：移除 dead row versions，并把空间标记为可复用
- `VACUUM FULL`：重写表文件，把没有 dead space 的新版本写出来，从而能把空间还给操作系统

这里的关键差异是：

> Postgres 的“空间回收”更多是数据库内部复用；真正缩小文件是重型维护动作。

## 5. 为什么不建议应用执行 Postgres VACUUM FULL

`VACUUM FULL` 更接近 SQLite `VACUUM` 的“压缩文件”效果，但不适合在当前应用后台接口里直接执行。

原因：

1. 它会重写表。
2. 它需要额外磁盘空间。
3. 它会持有更强的锁，影响线上读写。
4. 它是否值得执行，取决于表增长模式、业务低峰窗口、磁盘水位和 DBA 策略。
5. 它通常应该由数据库维护计划处理，而不是由 GC 调试页触发。

如果应用暴露一个 `POST /admin/gc/storage/compact`，并在 Postgres 下执行 `VACUUM FULL block_versions`，风险会比收益大。

特别是本项目的 GC 是按候选批次逐步删除版本行。即使某一批删完后表文件有 bloat，也不代表马上需要 `VACUUM FULL`。如果后续还会继续写入新版本，这些空间可能被 Postgres 复用。

## 6. 所以 Postgres 是否“需要 VACUUM”

答案要拆开说。

### 6.1 需要普通 VACUUM / autovacuum

Postgres 正常运行需要 vacuum 维护。

这通常由 autovacuum 完成。它是数据库运行维护的一部分，不是 GC 模块自己的 compact 动作。

GC 删除大量 `block_versions` 后，Postgres autovacuum 可能需要更积极的参数或单独维护窗口，但这属于数据库运维策略。

### 6.2 不应该由应用做 VACUUM FULL

如果问题是：

> 要不要像 SQLite 那样通过应用接口让数据库文件真的变小？

对 Postgres，第一版答案应该是：

> 不要。返回 managed-by-database / unsupported，让 DBA 或外部维护任务处理。

## 7. 对当前接口设计的影响

`GET /admin/gc/storage/status` 可以同时支持 SQLite 和 Postgres，但语义不同。

### SQLite

返回真实 compact 指标：

- database file bytes
- wal file bytes
- page size
- page count
- freelist count
- estimated free bytes
- free ratio
- recommendation

### Postgres

第一版只返回：

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

不要伪造“可回收多少磁盘”。

如果后续真要展示 bloat 估算，也应该用单独的 Postgres 统计方案，并明确是估算，不是可由应用立即释放的空间。

## 8. 对 `POST /admin/gc/storage/compact` 的影响

### SQLite 行为

支持：

```json
{
  "dryRun": true,
  "mode": "vacuum"
}
```

以及显式确认后的真实执行：

```json
{
  "dryRun": false,
  "mode": "vacuum",
  "confirm": "VACUUM_SQLITE_DATABASE"
}
```

### Postgres 行为

第一版返回：

```json
{
  "driver": "postgres",
  "dryRun": false,
  "mode": "vacuum",
  "status": "unsupported",
  "reason": "postgres_storage_maintenance_managed_by_database"
}
```

即使 `dryRun = true`，也只返回说明，不生成可执行 SQL。

不要返回 `VACUUM FULL` 建议，避免把调试页变成高风险 DBA 工具。

## 9. 文案建议

前端上可以这样表达：

### SQLite

> GC 已完成逻辑清理。SQLite 文件可能仍包含空闲页，可在维护窗口执行 VACUUM 尝试缩小数据库文件。

### Postgres

> GC 已完成逻辑清理。Postgres 会通过 autovacuum / 数据库维护复用或治理空间；应用不会执行 VACUUM FULL。

### 通用

> 删除版本行不等于磁盘空间立即归还给操作系统。

## 10. 最终建议

当前项目应该这样设计：

1. **SQLite**
   - 提供 status
   - 提供 dry-run
   - 提供显式确认后的 `VACUUM`
   - 不自动跟随 GC sweep

2. **Postgres**
   - 提供 status 说明
   - 不提供应用内 compact
   - 不执行 `VACUUM FULL`
   - 交给 autovacuum / DBA / 外部维护任务

3. **前端**
   - 把 SQLite 显示为“可执行维护”
   - 把 Postgres 显示为“数据库托管维护”
   - 不把 GC sweep 成功说成“磁盘已释放”

这不是说 Postgres 不需要 vacuum。

更准确的说法是：

> Postgres 需要 vacuum 作为数据库例行维护；但不需要、也不适合由 GC 模块提供类似 SQLite VACUUM 的应用内文件压缩按钮。

## 11. 参考资料

- PostgreSQL Routine Vacuuming: https://www.postgresql.org/docs/current/routine-vacuuming.html
- PostgreSQL VACUUM command: https://www.postgresql.org/docs/current/sql-vacuum.html
- SQLite VACUUM: https://sqlite.org/lang_vacuum.html
