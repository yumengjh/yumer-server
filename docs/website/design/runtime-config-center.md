# 运行时配置中心设计（以限流热更新为首个落地）

## 背景与目标

在实际运维中，后端经常需要在**不中断服务**的前提下调整系统行为，例如：

- 临时放宽限流阈值应对突发流量
- 在批量导入期间关闭限流
- 逐步收紧风控参数进行灰度

此前全局限流逻辑在 `AppModule` 中被注释，虽然能解决临时导入问题，但带来两个风险：

1. 安全防护“整体失效”
2. 需要改代码 + 重启服务才能恢复

因此我们引入独立的 **Runtime Config Center（运行时配置中心）**，第一阶段只承载 `rate_limit` 配置，并确保后续可以平滑扩展更多系统级动态配置。

## 设计原则

### 职责分离

- `SettingsModule`：面向用户/工作空间偏好（产品体验层）
- `RuntimeConfigModule`：面向系统运行参数（运维控制层）

两者隔离，避免把“用户偏好设置”与“系统控制开关”混在同一语义域中。

### 热更新优先

配置修改后：

- 当前实例立即生效
- 其他实例通过短轮询快速同步（默认 5 秒）

### 安全最小暴露

运行时配置接口使用独立令牌：`x-system-admin-token`

不复用普通 JWT 用户权限，降低误用风险。

### 扩展优先

第一阶段只实现 `rate_limit`，但模型、模块、API 结构按“多配置键”设计。

## 架构总览

```text
┌────────────────────────────────────────────────────┐
│                  RuntimeConfigModule               │
│                                                    │
│  ┌────────────────────┐   ┌─────────────────────┐  │
│  │ RuntimeConfigCtrl  │──▶│ RuntimeConfigService│──┼─▶ DB(runtime_configs)
│  └────────────────────┘   └─────────────────────┘  │
│                                 ▲                  │
└─────────────────────────────────┼──────────────────┘
                                  │
                                  │（每请求读取缓存快照）
                       ┌──────────────────────────────┐
                       │ ThrottlerModule + Guard      │
                       │ ttl/limit/skipIf 动态函数    │
                       └──────────────────────────────┘
```

## 数据模型设计

## 表结构：`runtime_configs`

| 字段           | 类型           | 说明                                 |
| -------------- | -------------- | ------------------------------------ |
| `id`           | `bigserial`    | 主键                                 |
| `config_key`   | `varchar(100)` | 配置键（唯一），例如 `rate_limit`    |
| `config_value` | `jsonb`        | 配置值（结构化 JSON）                |
| `updated_by`   | `varchar(64)`  | 最近修改人（可来自 `x-operator-id`） |
| `created_at`   | `timestamptz`  | 创建时间                             |
| `updated_at`   | `timestamptz`  | 更新时间                             |

唯一索引：`IDX_runtime_configs_config_key`

### 为什么使用 `jsonb`

1. 支持不同配置键的异构结构
2. 后续新增配置无需频繁改表
3. 与 TypeORM + PostgreSQL 配合成熟

## 关键模块与代码职责

## `RuntimeConfigService`

核心职责：

1. 启动时加载 DB 配置到内存缓存
2. 不存在时写入默认配置（bootstrap）
3. 提供限流配置读写能力
4. 提供短轮询跨实例同步
5. 给 `ThrottlerModule` 提供低开销快照读取接口

核心接口（语义）：

- `getRateLimitConfigSnapshot()`：同步读缓存（供 Guard 高频调用）
- `getRateLimitConfig()`：强一致读取（先轮询刷新，再返回）
- `updateRateLimitConfig()`：合并补丁 + 落库 + 刷新缓存
- `resetRateLimitConfig()`：回到 env 默认值

## `SystemAdminTokenGuard`

职责：

- 校验 `x-system-admin-token`
- 拒绝未配置或错误令牌请求（403）

## `RuntimeConfigController`

职责：

- 暴露运行时配置 API（读取、更新、重置）
- 统一从 `x-operator-id` 或 IP 推导操作者标识

## `AppModule` 中限流恢复方式

通过 `ThrottlerModule.forRootAsync` 动态读取配置：

- `ttl` -> `runtimeConfigService.getRateLimitConfigForGuard().ttlMs`
- `limit` -> `...limit`
- `skipIf` -> `!enabled`

这使得“是否限流 + 限流参数”都可在线调整。

## 生命周期与数据流

## 启动流程

1. Nest 启动 `RuntimeConfigModule`
2. `RuntimeConfigService.onModuleInit()`
3. 从 `runtime_configs` 读取所有配置到内存
4. 若缺少 `rate_limit`，写入默认值（来自环境变量）
5. 启动轮询任务（`RUNTIME_CONFIG_POLL_INTERVAL_MS`）

## 请求限流判定流程

1. 请求进入 `ThrottlerGuard`
2. Guard 调用配置函数获取 `enabled/ttlMs/limit`
3. `enabled=false` 时直接跳过
4. `enabled=true` 时按当前参数执行限流

## 配置更新流程

1. 管理请求进入 `RuntimeConfigController`
2. `SystemAdminTokenGuard` 校验通过
3. DTO 参数校验
4. Service 合并当前值 + patch，做边界收敛
5. 落库（upsert）并更新本实例缓存
6. 其他实例在轮询窗口内同步

## 一致性策略与多实例行为

本阶段采用“**最终一致 + 快速收敛**”：

- 写入实例：立即生效（本地缓存即时更新）
- 其他实例：轮询读取 DB（默认 5 秒）

### 优势

- 实现简单
- 对现有架构侵入小
- 无需额外中间件（如 Redis Pub/Sub）

### 代价

- 多实例下存在秒级传播延迟

### 后续可升级方案

- 方案 A：Redis Pub/Sub 事件通知（低延迟）
- 方案 B：CDC + 消费总线
- 方案 C：管理接口写库后主动广播刷新

## 配置校验与边界收敛

限流配置约束：

- `ttlMs`: `1000 ~ 86400000`
- `limit`: `1 ~ 100000`
- `enabled`: boolean

策略：

- API 入参先走 `class-validator`
- Service 内部再做归一化兜底（防止脏数据进入）

这样即使有人绕过 API 直接写 DB，服务侧也能最大限度自恢复。

## 错误处理设计

在全局异常过滤器中，对 HTTP `429` 统一映射：

`code = RATE_6001`（`ErrorCode.RATE_LIMIT_EXCEEDED`）

目标：

1. 前端可稳定识别限流错误码
2. 降低 `ThrottlerException` 原始文本差异带来的兼容问题

## 安全设计细节

## 为什么不用 JWT 权限体系

JWT 体系主要表达“用户业务权限”，而运行时配置是“系统运维权限”，边界不同。

若复用 JWT，可能出现：

- 某个管理员账号被盗导致系统参数被恶意修改
- 业务权限模型复杂化（workspace admin 与系统 admin 混淆）

独立令牌机制可把权限平面隔离：

- 应用层用户权限（JWT）
- 运维层系统权限（SYSTEM_ADMIN_TOKEN）

## 推荐生产实践

1. `SYSTEM_ADMIN_TOKEN` 使用高熵随机串（>= 32 字符）
2. 通过密钥平台注入，不写入代码库
3. 反向代理层限制来源网段
4. 结合 WAF/堡垒机控制访问入口
5. 配置修改动作接入审计（可在后续版本补齐独立审计表）

## API 使用手册（运维视角）

## 读取当前配置

```bash
curl -X GET "http://localhost:5200/api/v1/runtime-configs/rate-limit" \
  -H "x-system-admin-token: <SYSTEM_ADMIN_TOKEN>"
```

## 批量导入前关闭限流

```bash
curl -X PATCH "http://localhost:5200/api/v1/runtime-configs/rate-limit" \
  -H "Content-Type: application/json" \
  -H "x-system-admin-token: <SYSTEM_ADMIN_TOKEN>" \
  -H "x-operator-id: import_pipeline" \
  -d '{"enabled": false}'
```

## 导入后恢复限流

```bash
curl -X PATCH "http://localhost:5200/api/v1/runtime-configs/rate-limit" \
  -H "Content-Type: application/json" \
  -H "x-system-admin-token: <SYSTEM_ADMIN_TOKEN>" \
  -d '{"enabled": true, "ttlMs": 60000, "limit": 100}'
```

## 一键重置默认值

```bash
curl -X POST "http://localhost:5200/api/v1/runtime-configs/rate-limit/reset" \
  -H "x-system-admin-token: <SYSTEM_ADMIN_TOKEN>"
```

## 环境变量说明

| 变量                              | 默认值  | 说明                                                                                                           |
| --------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `RATE_LIMIT_ENABLED`              | `true`  | 默认是否启用限流                                                                                               |
| `RATE_LIMIT_TTL`                  | `60000` | 默认时间窗口（毫秒）                                                                                           |
| `RATE_LIMIT_MAX`                  | `100`   | 默认窗口内请求上限                                                                                             |
| `RUNTIME_CONFIG_POLL_INTERVAL_MS` | `5000`  | 多实例同步轮询间隔                                                                                             |
| `SYSTEM_ADMIN_TOKEN`              | 空      | 运行时配置管理令牌                                                                                             |
| `PUBLIC_SITE_ORIGINS`             | 空      | publish 站点白名单；支持精确 origin、`*`、`https://*.example.com`；当前仍为静态环境变量，不纳入 runtime center |
| `PUBLIC_SITE_ALLOW_NO_ORIGIN`     | `false` | 是否允许无 `Origin` / `Referer` 的匿名请求访问 `@SitePublic()` 接口                                            |

> 说明：`PUBLIC_SITE_ORIGINS` 目前只在应用启动时读取，用于 `@SitePublic()` 请求来源校验和 CORS 白名单合并；后续如需在线调整，再纳入运行时配置中心。
>
> `PUBLIC_SITE_ALLOW_NO_ORIGIN` 也仅在启动时读取，且只影响 `@SitePublic()` 接口的匿名访问判定。

## 兼容性与回滚策略

## 与历史行为兼容

- 旧行为：限流在代码里写死/注释
- 新行为：限流始终启用框架能力，配置由 runtime center 控制

对业务方来说，接口保持不变，差异只体现在限流是否生效和阈值变化。

## 回滚策略

如需紧急回滚：

1. 先用 API 将 `enabled=false`（立即止损）
2. 回退服务版本
3. 保留 `runtime_configs` 数据（不影响旧版本）

## 可观测性建议

建议在后续迭代新增：

1. 配置变更审计日志（谁在何时改了什么）
2. 配置版本号（用于快速对比）
3. `/runtime-configs/health` 用于巡检缓存与 DB 一致性
4. 指标埋点（配置读取命中率、轮询耗时、同步延迟）

## 演进路线（Roadmap）

第二阶段可纳入以下配置键：

- `upload_limits`：上传大小、类型、并发控制
- `auth_policy`：登录失败锁定策略、token 续签策略
- `search_limits`：搜索分页上限、并发查询阈值
- `feature_switches`：高风险功能开关

演进建议：

1. 引入配置注册表（schema + 默认值 + 校验器）
2. 抽象通用 CRUD + 版本管理
3. 增加批量更新与事务语义
4. 提供变更订阅能力（事件总线）

## 测试建议清单

## 单元测试

- `normalizeRateLimitRuntimeConfig` 边界值测试
- `SystemAdminTokenGuard` 的通过/拒绝路径
- reset 逻辑回退到 env 默认值

## 集成测试

- 更新配置后，同实例限流行为立即变化
- 错误令牌访问返回 403
- 限流触发时返回 429 + `RATE_6001`

## 多实例测试

- A 实例修改后 B 在轮询窗口内生效
- 网络抖动场景下轮询失败可自恢复

## 总结

本次改造把“注释代码临时开关”升级为“正式运行时配置能力”，实现了：

1. 限流能力恢复
2. 在线可控（无需重启）
3. 多实例可同步
4. 权限边界清晰
5. 为后续更多动态配置提供统一基础设施
