# Images S3 Storage Implementation Plan

<!-- cspell:words agentic originalname Streamable -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为当前后端图片上传模块增加 S3 兼容对象存储支持，在 S3 模式下上传后返回公开直链，同时保持本地存储与旧图片读取接口兼容。

**Architecture:** 在 `images` 模块内新增轻量存储抽象层，由 `ImagesService` 负责业务校验与数据库落库，由本地/S3 两种存储实现负责保存文件、生成 URL 和解析读取目标。读取接口继续保留，但对于 S3 图片改为返回重定向目标而不是代理文件流。

**Tech Stack:** NestJS 11、TypeORM、Jest、@nestjs/config、@aws-sdk/client-s3

---

## File Structure

### New files

- `src/modules/images/image-storage.types.ts`
  - 定义图片存储结果、读取结果、存储接口 token、provider 类型。
- `src/modules/images/image-storage.interface.ts`
  - 定义 `ImageStorage` 接口。
- `src/modules/images/local-image-storage.service.ts`
  - 本地磁盘存储实现。
- `src/modules/images/s3-image-storage.service.ts`
  - S3 兼容对象存储实现。
- `src/modules/images/image-storage.factory.ts`
  - 根据配置返回当前实际使用的图片存储实现。
- `src/modules/images/images.service.spec.ts`
  - `ImagesService` 上传、本地读取、S3 读取重定向、补偿删除等单测。
- `src/modules/images/images.controller.spec.ts`
  - controller 对 stream / redirect 两种读取结果的响应单测。

### Modified files

- `package.json`
  - 增加 S3 SDK 依赖。
- `src/config/app.config.ts`
  - 增加图片存储类型与 S3 相关配置。
- `src/modules/images/images.module.ts`
  - 注册本地/S3 存储实现与工厂 provider。
- `src/modules/images/images.service.ts`
  - 改造为依赖存储抽象，不再直接写磁盘或拼接最终 URL。
- `src/modules/images/images.controller.ts`
  - 读取接口支持根据服务层结果返回文件流或 302 重定向。

---

### Task 1: 增加配置与依赖

**Files:**

- Modify: `package.json`
- Modify: `src/config/app.config.ts`
- Test: `src/modules/images/images.service.spec.ts`

- [ ] **Step 1: 为 S3 支持写一个失败测试，锁定缺失配置时的行为**

```ts
it("当 storage provider 为 s3 且缺少 bucket 配置时抛出明确错误", async () => {
  const configService = {
    get: jest.fn((key: string) => {
      const map: Record<string, unknown> = {
        "app.imageStorageProvider": "s3",
        "app.s3Endpoint": "https://s3.example.com",
        "app.s3Region": "auto",
        "app.s3Bucket": "",
        "app.s3AccessKeyId": "ak",
        "app.s3SecretAccessKey": "sk",
        "app.s3PublicBaseUrl": "https://cdn.example.com",
      };
      return map[key];
    }),
  };

  expect(() => new S3ImageStorageService(configService as any)).toThrow(
    "S3_BUCKET 未配置",
  );
});
```

- [ ] **Step 2: 运行单测确认失败**

Run:

```powershell
pnpm test -- src/modules/images/images.service.spec.ts -t "当 storage provider 为 s3 且缺少 bucket 配置时抛出明确错误"
```

Expected: FAIL，提示 `S3ImageStorageService` 或相关配置校验尚不存在。

- [ ] **Step 3: 增加依赖与配置项**

`package.json` 增加：

```json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.883.0"
  }
}
```

`src/config/app.config.ts` 在返回对象中增加：

```ts
  imageStorageProvider: process.env.IMAGE_STORAGE_PROVIDER || "local",
  s3Endpoint: process.env.S3_ENDPOINT || "",
  s3Region: process.env.S3_REGION || "",
  s3Bucket: process.env.S3_BUCKET || "",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  s3PublicBaseUrl: process.env.S3_PUBLIC_BASE_URL || "",
  s3ForcePathStyle: parseBoolean(process.env.S3_FORCE_PATH_STYLE, false),
```

- [ ] **Step 4: 运行相关测试确认通过或进入下一步失败点**

Run:

```powershell
pnpm test -- src/modules/images/images.service.spec.ts
```

Expected: 仍可能失败，但错误从“缺少配置结构”推进到“缺少存储实现”。

- [ ] **Step 5: 提交检查点（本任务完成时再执行）**

```bash
git add package.json src/config/app.config.ts src/modules/images/images.service.spec.ts
git commit -m "🏗️ build(images): add s3 image storage config"
```

---

### Task 2: 建立图片存储抽象与本地/S3 实现

**Files:**

- Create: `src/modules/images/image-storage.types.ts`
- Create: `src/modules/images/image-storage.interface.ts`
- Create: `src/modules/images/local-image-storage.service.ts`
- Create: `src/modules/images/s3-image-storage.service.ts`
- Create: `src/modules/images/image-storage.factory.ts`
- Modify: `src/modules/images/images.module.ts`
- Test: `src/modules/images/images.service.spec.ts`

- [ ] **Step 1: 写失败测试，定义本地/远程读取结果的形状**

```ts
it("本地存储返回 stream 读取结果，S3 存储返回 redirect 读取结果", async () => {
  const localStorage = {
    resolveReadTarget: jest.fn().mockResolvedValue({
      kind: "stream",
      stream: {} as NodeJS.ReadableStream,
      mimeType: "image/png",
      filename: "demo.png",
    }),
  };
  const s3Storage = {
    resolveReadTarget: jest.fn().mockResolvedValue({
      kind: "redirect",
      url: "https://cdn.example.com/workspaces/ws_1/images/img_1_demo.png",
    }),
  };

  await expect(
    localStorage.resolveReadTarget({} as any),
  ).resolves.toMatchObject({ kind: "stream" });
  await expect(s3Storage.resolveReadTarget({} as any)).resolves.toMatchObject({
    kind: "redirect",
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm test -- src/modules/images/images.service.spec.ts -t "本地存储返回 stream 读取结果，S3 存储返回 redirect 读取结果"
```

Expected: FAIL，因为存储类型文件尚未创建。

- [ ] **Step 3: 创建存储类型与接口**

`src/modules/images/image-storage.types.ts`

```ts
import type { Asset } from "../../entities/asset.entity";

export type ImageStorageProvider = "local" | "s3";

export interface SaveImageInput {
  workspaceId: string;
  imageId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface SaveImageResult {
  storageProvider: ImageStorageProvider;
  storagePath: string;
  url: string;
}

export type ImageReadTarget =
  | {
      kind: "stream";
      stream: NodeJS.ReadableStream;
      mimeType: string;
      filename: string;
    }
  | {
      kind: "redirect";
      url: string;
    };

export const IMAGE_STORAGE = Symbol("IMAGE_STORAGE");

export interface ImageReadableAsset extends Pick<
  Asset,
  "filename" | "mimeType" | "storagePath" | "url"
> {
  storageProvider: string;
}
```

`src/modules/images/image-storage.interface.ts`

```ts
import type {
  ImageReadableAsset,
  ImageReadTarget,
  SaveImageInput,
  SaveImageResult,
} from "./image-storage.types";

export interface ImageStorage {
  saveImage(input: SaveImageInput): Promise<SaveImageResult>;
  deleteImage(storagePath: string): Promise<void>;
  resolveReadTarget(asset: ImageReadableAsset): Promise<ImageReadTarget>;
}
```

- [ ] **Step 4: 实现本地与 S3 存储服务，以及工厂 provider**

`src/modules/images/local-image-storage.service.ts`

```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createReadStream, existsSync } from "fs";
import { mkdir, writeFile, unlink } from "fs/promises";
import { join } from "path";
import type { ImageStorage } from "./image-storage.interface";
import type {
  ImageReadableAsset,
  ImageReadTarget,
  SaveImageInput,
  SaveImageResult,
} from "./image-storage.types";

@Injectable()
export class LocalImageStorageService implements ImageStorage {
  constructor(private readonly configService: ConfigService) {}

  async saveImage(input: SaveImageInput): Promise<SaveImageResult> {
    const storagePath = join(
      "workspaces",
      input.workspaceId,
      "images",
      input.filename,
    );
    const uploadDir =
      this.configService.get<string>("app.uploadDir") || "uploads";
    const workspaceDir = join(
      process.cwd(),
      uploadDir,
      "workspaces",
      input.workspaceId,
      "images",
    );
    const fullPath = join(process.cwd(), uploadDir, storagePath);
    const apiPrefix =
      this.configService.get<string>("app.apiPrefix") || "api/v1";
    const publicBaseUrl =
      this.configService.get<string>("app.publicBaseUrl") ||
      `http://localhost:${this.configService.get<number>("app.port") || 5200}`;

    await mkdir(workspaceDir, { recursive: true });
    await writeFile(fullPath, input.buffer);

    return {
      storageProvider: "local",
      storagePath,
      url: `${publicBaseUrl.replace(/\/+$/, "")}/${apiPrefix}/public/images/${input.imageId}/file`,
    };
  }

  async deleteImage(storagePath: string): Promise<void> {
    const uploadDir =
      this.configService.get<string>("app.uploadDir") || "uploads";
    const fullPath = join(process.cwd(), uploadDir, storagePath);
    if (existsSync(fullPath)) {
      await unlink(fullPath);
    }
  }

  async resolveReadTarget(asset: ImageReadableAsset): Promise<ImageReadTarget> {
    const uploadDir =
      this.configService.get<string>("app.uploadDir") || "uploads";
    const fullPath = join(process.cwd(), uploadDir, asset.storagePath);
    if (!existsSync(fullPath)) {
      throw new NotFoundException("图片文件不存在");
    }

    return {
      kind: "stream",
      stream: createReadStream(fullPath),
      mimeType: asset.mimeType,
      filename: asset.filename,
    };
  }
}
```

`src/modules/images/s3-image-storage.service.ts`

```ts
import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ImageStorage } from "./image-storage.interface";
import type {
  ImageReadableAsset,
  ImageReadTarget,
  SaveImageInput,
  SaveImageResult,
} from "./image-storage.types";

@Injectable()
export class S3ImageStorageService implements ImageStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.require("app.s3Bucket", "S3_BUCKET 未配置");
    this.publicBaseUrl = this.require(
      "app.s3PublicBaseUrl",
      "S3_PUBLIC_BASE_URL 未配置",
    );

    this.client = new S3Client({
      endpoint: this.require("app.s3Endpoint", "S3_ENDPOINT 未配置"),
      region: this.require("app.s3Region", "S3_REGION 未配置"),
      forcePathStyle:
        this.configService.get<boolean>("app.s3ForcePathStyle") ?? false,
      credentials: {
        accessKeyId: this.require(
          "app.s3AccessKeyId",
          "S3_ACCESS_KEY_ID 未配置",
        ),
        secretAccessKey: this.require(
          "app.s3SecretAccessKey",
          "S3_SECRET_ACCESS_KEY 未配置",
        ),
      },
    });
  }

  async saveImage(input: SaveImageInput): Promise<SaveImageResult> {
    const storagePath = `workspaces/${input.workspaceId}/images/${input.filename}`;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: storagePath,
          Body: input.buffer,
          ContentType: input.mimeType,
          ACL: "public-read",
        }),
      );
    } catch {
      throw new InternalServerErrorException("图片上传失败");
    }

    return {
      storageProvider: "s3",
      storagePath,
      url: `${this.publicBaseUrl.replace(/\/+$/, "")}/${storagePath.replace(/^\/+/, "")}`,
    };
  }

  async deleteImage(storagePath: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: storagePath }),
    );
  }

  async resolveReadTarget(asset: ImageReadableAsset): Promise<ImageReadTarget> {
    return {
      kind: "redirect",
      url: asset.url,
    };
  }

  private require(key: string, message: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(message);
    }
    return value;
  }
}
```

`src/modules/images/image-storage.factory.ts`

```ts
import type { ImageStorage } from "./image-storage.interface";
import { LocalImageStorageService } from "./local-image-storage.service";
import { S3ImageStorageService } from "./s3-image-storage.service";

export const createImageStorageProvider = (
  provider: string,
  localStorage: LocalImageStorageService,
  s3Storage: S3ImageStorageService,
): ImageStorage => {
  return provider === "s3" ? s3Storage : localStorage;
};
```

`src/modules/images/images.module.ts`

```ts
import { ConfigService } from "@nestjs/config";
import { IMAGE_STORAGE } from "./image-storage.types";
import { LocalImageStorageService } from "./local-image-storage.service";
import { S3ImageStorageService } from "./s3-image-storage.service";
import { createImageStorageProvider } from "./image-storage.factory";

providers: [
  ImagesService,
  LocalImageStorageService,
  S3ImageStorageService,
  {
    provide: IMAGE_STORAGE,
    inject: [ConfigService, LocalImageStorageService, S3ImageStorageService],
    useFactory: (
      configService: ConfigService,
      localStorage: LocalImageStorageService,
      s3Storage: S3ImageStorageService,
    ) =>
      createImageStorageProvider(
        configService.get<string>("app.imageStorageProvider") || "local",
        localStorage,
        s3Storage,
      ),
  },
],
```

- [ ] **Step 5: 运行单测确认接口和实现落地**

Run:

```powershell
pnpm test -- src/modules/images/images.service.spec.ts
```

Expected: 失败点推进到 `ImagesService` 仍依赖旧本地实现，说明抽象层已经就位。

- [ ] **Step 6: 提交检查点（本任务完成时再执行）**

```bash
git add src/modules/images/image-storage.types.ts src/modules/images/image-storage.interface.ts src/modules/images/local-image-storage.service.ts src/modules/images/s3-image-storage.service.ts src/modules/images/image-storage.factory.ts src/modules/images/images.module.ts src/modules/images/images.service.spec.ts
git commit -m "✨ feat(images): add image storage abstraction"
```

---

### Task 3: 改造 ImagesService 上传流程与补偿删除

**Files:**

- Modify: `src/modules/images/images.service.ts`
- Test: `src/modules/images/images.service.spec.ts`

- [ ] **Step 1: 写失败测试，锁定 S3 上传落库与补偿删除**

```ts
it("S3 模式上传成功后保存公开直链，并在数据库保存失败时删除对象", async () => {
  const storage = {
    saveImage: jest.fn().mockResolvedValue({
      storageProvider: "s3",
      storagePath: "workspaces/ws_1/images/img_1_demo.png",
      url: "https://cdn.example.com/workspaces/ws_1/images/img_1_demo.png",
    }),
    deleteImage: jest.fn().mockResolvedValue(undefined),
  };
  const assetRepository = {
    save: jest.fn().mockRejectedValue(new Error("db failed")),
  };
  const service = new ImagesService(
    assetRepository as any,
    {} as any,
    { checkAccess: jest.fn().mockResolvedValue(undefined) } as any,
    storage as any,
  );

  await expect(
    service.upload(
      "ws_1",
      {
        originalname: "demo.png",
        mimetype: "image/png",
        size: 128,
        buffer: Buffer.from("png"),
      } as Express.Multer.File,
      "user_1",
    ),
  ).rejects.toThrow("db failed");

  expect(storage.deleteImage).toHaveBeenCalledWith(
    "workspaces/ws_1/images/img_1_demo.png",
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm test -- src/modules/images/images.service.spec.ts -t "S3 模式上传成功后保存公开直链，并在数据库保存失败时删除对象"
```

Expected: FAIL，因为 `ImagesService` 构造函数与上传逻辑尚未支持存储抽象。

- [ ] **Step 3: 改造 `ImagesService` 依赖与上传逻辑**

将构造函数改为注入 `IMAGE_STORAGE`：

```ts
constructor(
  @InjectRepository(Asset)
  private readonly assetRepository: Repository<Asset>,
  private readonly configService: ConfigService,
  private readonly workspacesService: WorkspacesService,
  @Inject(IMAGE_STORAGE)
  private readonly imageStorage: ImageStorage,
) {}
```

上传逻辑核心替换为：

```ts
const imageId = generateAssetId();
const sanitized = (file.originalname || "image").replace(/[/\\]/g, "_");
const filename = `${imageId}_${sanitized}`;
const metadata = readImageMetadata(file.buffer, file.mimetype);

const stored = await this.imageStorage.saveImage({
  workspaceId,
  imageId,
  filename,
  mimeType: file.mimetype,
  buffer: file.buffer,
});

const asset = new Asset();
asset.assetId = imageId;
asset.workspaceId = workspaceId;
asset.uploadedBy = userId;
asset.filename = file.originalname || "image";
asset.mimeType = file.mimetype;
asset.size = file.size;
asset.storageProvider = stored.storageProvider;
asset.storagePath = stored.storagePath;
asset.url = stored.url;
asset.width = metadata.width;
asset.height = metadata.height;
asset.status = "active";
asset.refCount = 0;
asset.refs = [];

try {
  const saved = await this.assetRepository.save(asset);
  return this.toResponse(saved, stored.url);
} catch (error) {
  await this.imageStorage
    .deleteImage(stored.storagePath)
    .catch(() => undefined);
  throw error;
}
```

删除 `openImageStream()`、`toAbsoluteUrl()` 中对最终 URL 的依赖，读取改为委托给存储实现。

- [ ] **Step 4: 补充并运行服务单测**

`src/modules/images/images.service.spec.ts` 至少覆盖：

```ts
it("local 模式上传时保存 local provider 与本地 URL", async () => {
  // mock imageStorage.saveImage -> { storageProvider: "local", storagePath: "workspaces/ws_1/images/img_1_demo.png", url: "http://api.example.com/api/v1/public/images/img_1/file" }
});

it("S3 模式上传时返回公开直链", async () => {
  // assert result.url === https://cdn.example.com/...
});

it("文件类型非法时返回 400", async () => {
  // assert BadRequestException
});
```

Run:

```powershell
pnpm test -- src/modules/images/images.service.spec.ts
```

Expected: PASS。

- [ ] **Step 5: 提交检查点（本任务完成时再执行）**

```bash
git add src/modules/images/images.service.ts src/modules/images/images.service.spec.ts
git commit -m "✨ feat(images): support s3 upload in images service"
```

---

### Task 4: 改造读取接口支持 stream / redirect

**Files:**

- Modify: `src/modules/images/images.service.ts`
- Modify: `src/modules/images/images.controller.ts`
- Create: `src/modules/images/images.controller.spec.ts`
- Test: `src/modules/images/images.service.spec.ts`

- [ ] **Step 1: 写失败测试，先定义 controller 在 S3 模式下返回 302**

```ts
it("公开读取 S3 图片时返回 302 重定向", async () => {
  const redirect = jest.fn();
  const controller = new ImagesController({
    getPublicFileTarget: jest.fn().mockResolvedValue({
      kind: "redirect",
      url: "https://cdn.example.com/workspaces/ws_1/images/img_1_demo.png",
    }),
  } as any);

  await controller.getPublicFile("img_1", { redirect } as any);

  expect(redirect).toHaveBeenCalledWith(
    302,
    "https://cdn.example.com/workspaces/ws_1/images/img_1_demo.png",
  );
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm test -- src/modules/images/images.controller.spec.ts -t "公开读取 S3 图片时返回 302 重定向"
```

Expected: FAIL，因为 controller 目前只返回 `StreamableFile`。

- [ ] **Step 3: 改造 service/controller 读取逻辑**

`ImagesService` 增加统一读取方法：

```ts
async getPublicFileTarget(imageId: string) {
  const image = await this.findActiveImage(imageId);
  return this.imageStorage.resolveReadTarget(image);
}
```

`src/modules/images/images.controller.ts` 改为：

```ts
import { Res } from "@nestjs/common";
import type { Response } from "express";

@Get("public/images/:imageId/file")
async getPublicFile(@Param("imageId") imageId: string, @Res({ passthrough: true }) res: Response) {
  const target = await this.imagesService.getPublicFileTarget(imageId);
  if (target.kind === "redirect") {
    res.redirect(302, target.url);
    return;
  }

  return new StreamableFile(target.stream, {
    type: target.mimeType,
    disposition: `inline; filename="${encodeURIComponent(target.filename)}"`,
  });
}
```

`GET /images/:imageId/file` 同步复用相同逻辑，避免两处漂移。

- [ ] **Step 4: 写 controller/service 通过测试**

`src/modules/images/images.controller.spec.ts` 至少包含：

```ts
it("公开读取本地图片时返回 StreamableFile", async () => {
  // mock kind: "stream"
});

it("公开读取 S3 图片时返回 302 重定向", async () => {
  // mock kind: "redirect"
});
```

`src/modules/images/images.service.spec.ts` 增加：

```ts
it("读取本地图片时委托 storage 返回 stream", async () => {
  // expect resolveReadTarget called with asset
});

it("读取 S3 图片时委托 storage 返回 redirect", async () => {
  // expect kind === "redirect"
});
```

Run:

```powershell
pnpm test -- src/modules/images/images.controller.spec.ts
pnpm test -- src/modules/images/images.service.spec.ts
```

Expected: PASS。

- [ ] **Step 5: 提交检查点（本任务完成时再执行）**

```bash
git add src/modules/images/images.controller.ts src/modules/images/images.controller.spec.ts src/modules/images/images.service.ts src/modules/images/images.service.spec.ts
git commit -m "✨ feat(images): preserve image read routes with s3 redirect"
```

---

### Task 5: 清理旧 URL 拼接逻辑并完成回归测试

**Files:**

- Modify: `src/modules/images/images.service.ts`
- Test: `src/modules/images/images.service.spec.ts`
- Test: `src/modules/images/images.controller.spec.ts`

- [ ] **Step 1: 写失败测试，锁定 S3 模式不再返回 localhost 回退地址**

```ts
it("S3 模式上传返回的 url 不依赖 PUBLIC_BASE_URL 或 localhost 回退", async () => {
  const service = createServiceWithStorage({
    saveImage: jest.fn().mockResolvedValue({
      storageProvider: "s3",
      storagePath: "workspaces/ws_1/images/img_1_demo.png",
      url: "https://cdn.example.com/workspaces/ws_1/images/img_1_demo.png",
    }),
  });

  const result = await service.upload(
    "ws_1",
    {
      originalname: "demo.png",
      mimetype: "image/png",
      size: 128,
      buffer: Buffer.from("png"),
    } as Express.Multer.File,
    "user_1",
  );

  expect(result.url).toBe(
    "https://cdn.example.com/workspaces/ws_1/images/img_1_demo.png",
  );
  expect(result.url).not.toContain("localhost:5200");
});
```

- [ ] **Step 2: 运行测试确认失败或红灯定位明确**

Run:

```powershell
pnpm test -- src/modules/images/images.service.spec.ts -t "S3 模式上传返回的 url 不依赖 PUBLIC_BASE_URL 或 localhost 回退"
```

Expected: 若旧 `toAbsoluteUrl()` 尚存则 FAIL；否则进入通过状态。

- [ ] **Step 3: 删除服务层 URL 拼接与无用辅助方法**

从 `src/modules/images/images.service.ts` 删除：

```ts
private getApiPrefix(): string {
  return this.configService.get<string>("app.apiPrefix") || "api/v1";
}

private toAbsoluteUrl(path: string): string {
  const baseUrl =
    this.configService.get<string>("app.publicBaseUrl") ||
    `http://localhost:${this.configService.get<number>("app.port") || 5200}`;
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
```

并保证响应改为：

```ts
private toResponse(asset: Asset, publicUrl: string): UploadedImageResponse {
  return {
    imageId: asset.assetId,
    url: asset.url,
    publicUrl,
    filename: asset.filename,
    mimeType: asset.mimeType,
    size: Number(asset.size),
    width: asset.width ?? null,
    height: asset.height ?? null,
    createdAt: asset.createdAt,
  };
}
```

其中 `publicUrl` 在当前设计下可与 `asset.url` 相同。

- [ ] **Step 4: 运行完整图片相关测试与最小回归**

Run:

```powershell
pnpm test -- src/modules/images/image-metadata.util.spec.ts
pnpm test -- src/modules/images/images.service.spec.ts
pnpm test -- src/modules/images/images.controller.spec.ts
```

Expected: PASS。

- [ ] **Step 5: 提交检查点（本任务完成时再执行）**

```bash
git add src/modules/images/images.service.ts src/modules/images/images.service.spec.ts src/modules/images/images.controller.spec.ts
git commit -m "🐛 fix(images): remove localhost fallback from image urls"
```

---

### Task 6: 安装依赖并做最终验证

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Test: `src/modules/images/*.spec.ts`

- [ ] **Step 1: 安装新增依赖**

Run:

```powershell
pnpm add @aws-sdk/client-s3
```

Expected: `package.json` 和 `pnpm-lock.yaml` 更新成功。

- [ ] **Step 2: 运行图片模块相关测试**

Run:

```powershell
pnpm test -- src/modules/images/image-metadata.util.spec.ts src/modules/images/images.service.spec.ts src/modules/images/images.controller.spec.ts
```

Expected: PASS。

- [ ] **Step 3: 运行最小 lint / typecheck 验证**

Run:

```powershell
pnpm build
```

Expected: Nest build 成功，无 TypeScript 错误。

- [ ] **Step 4: 手工验证建议**

```text
1. 在 .env 中设置 IMAGE_STORAGE_PROVIDER=local，上传一张 PNG，确认返回 /public/images/:id/file 对应的本地域名地址。
2. 在 .env 中设置 IMAGE_STORAGE_PROVIDER=s3，并填充 S3_* 配置，上传一张 PNG，确认响应 url/publicUrl 为 https://cdn... 直链。
3. 使用浏览器访问旧接口 /api/v1/public/images/:id/file：
   - local 图片返回 200 并展示图片
   - s3 图片返回 302，Location 指向 CDN/S3 直链
```

- [ ] **Step 5: 提交检查点（本任务完成时再执行）**

```bash
git add package.json pnpm-lock.yaml src/config/app.config.ts src/modules/images
git commit -m "✨ feat(images): add s3 compatible image storage"
```
