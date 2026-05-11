# 环境设置

## 开发环境配置

### 1. 代码格式化

项目使用 Prettier 进行代码格式化：

```bash
pnpm run format
```

### 2. 代码检查

使用 ESLint 进行代码检查：

```bash
pnpm run lint
```

### 3. 运行测试

```bash
# 运行所有测试
pnpm run test

# 监听模式
pnpm run test:watch

# 覆盖率
pnpm run test:cov

# E2E 测试
pnpm run test:e2e
```

## 数据库迁移

### 生成迁移

```bash
pnpm run typeorm:migration:generate -- -n MigrationName
```

### 运行迁移

```bash
pnpm run typeorm:migration:run
```

### 回滚迁移

```bash
pnpm run typeorm:migration:revert
```

## 项目结构

```
app/
├── src/
│   ├── common/              # 公共模块
│   │   ├── decorators/      # 装饰器（@CurrentUser 等）
│   │   ├── guards/          # 守卫（JWT 认证等）
│   │   ├── interceptors/    # 拦截器（响应格式化）
│   │   ├── filters/         # 过滤器（异常处理）
│   │   ├── dto/             # 公共 DTO
│   │   └── utils/           # 工具类
│   ├── config/              # 配置模块
│   ├── entities/            # 数据库实体
│   ├── modules/             # 业务模块
│   │   ├── auth/            # 认证模块
│   │   ├── workspaces/      # 工作空间模块
│   │   ├── documents/       # 文档模块
│   │   └── blocks/          # 块模块
│   ├── app.module.ts        # 主模块
│   └── main.ts              # 应用入口
├── docs/                    # 项目文档
└── package.json
```

## 编译配置

项目使用 **SWC** 进行快速编译，配置文件：`.swcrc`

- 编译速度比 tsc 快 10-20 倍
- 支持 TypeScript 装饰器和元数据
- 已解决循环依赖问题

## IDE 配置

### VS Code

推荐安装以下扩展：

- ESLint
- Prettier
- TypeScript Vue Plugin (Volar)

### 编辑器配置

项目包含 `.editorconfig` 文件，确保编辑器使用一致的代码风格。
