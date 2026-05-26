const mockSend = jest.fn();

// cspell:words myqcloud

jest.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    constructor(public readonly input: unknown) {}
  }

  class DeleteObjectCommand {
    constructor(public readonly input: unknown) {}
  }

  class HeadBucketCommand {
    constructor(public readonly input: unknown) {}
  }

  class S3Client {
    constructor(public readonly config: unknown) {}

    send = mockSend;
  }

  return {
    PutObjectCommand,
    DeleteObjectCommand,
    HeadBucketCommand,
    S3Client,
  };
});

import { ConfigService } from "@nestjs/config";
import { createImageStorage } from "./image-storage.factory";
import { LocalImageStorageService } from "./local-image-storage.service";
import { S3ImageStorageService } from "./s3-image-storage.service";

const createConfigService = (values: Record<string, unknown>): ConfigService =>
  ({
    get: jest.fn((key: string) => values[key]),
  }) as unknown as ConfigService;

describe("createImageStorage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
  });

  it("local 模式下不会要求 S3 配置", async () => {
    const configService = createConfigService({
      "app.imageStorageProvider": "local",
      "app.uploadDir": "uploads",
      "app.apiPrefix": "api/v1",
      "app.publicBaseUrl": "https://api.example.com",
    });

    await expect(createImageStorage(configService)).resolves.toBeInstanceOf(
      LocalImageStorageService,
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("s3 健康检查成功时使用 S3 存储", async () => {
    const configService = createConfigService({
      "app.imageStorageProvider": "s3",
      "app.s3Bucket": "images-bucket",
      "app.s3PublicBaseUrl": "https://cdn.example.com",
      "app.s3Endpoint": "https://s3.example.com",
      "app.s3Region": "ap-guangzhou",
      "app.s3AccessKeyId": "key-id",
      "app.s3SecretAccessKey": "secret-key",
      "app.s3ForcePathStyle": false,
    });

    await expect(createImageStorage(configService)).resolves.toBeInstanceOf(S3ImageStorageService);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("s3 endpoint 非法时直接失败，避免静默回退到 local", async () => {
    const configService = createConfigService({
      "app.imageStorageProvider": "s3",
      "app.s3Bucket": "images-bucket",
      "app.s3PublicBaseUrl": "https://cdn.example.com",
      "app.s3Endpoint": "img-1371211511.cos.ap-guangzhou.myqcloud.com",
      "app.s3Region": "ap-guangzhou",
      "app.s3AccessKeyId": "key-id",
      "app.s3SecretAccessKey": "secret-key",
      "app.s3ForcePathStyle": false,
      "app.uploadDir": "uploads",
      "app.apiPrefix": "api/v1",
      "app.publicBaseUrl": "https://api.example.com",
    });

    await expect(createImageStorage(configService)).rejects.toThrow(
      "S3 image storage requires app.s3Endpoint to be a valid URL",
    );
  });

  it("s3 健康检查失败时直接失败，避免生产出现混合存储", async () => {
    mockSend.mockRejectedValueOnce(new Error("HeadBucket failed"));
    const configService = createConfigService({
      "app.imageStorageProvider": "s3",
      "app.s3Bucket": "images-bucket",
      "app.s3PublicBaseUrl": "https://cdn.example.com",
      "app.s3Endpoint": "https://s3.example.com",
      "app.s3Region": "ap-guangzhou",
      "app.s3AccessKeyId": "key-id",
      "app.s3SecretAccessKey": "secret-key",
      "app.s3ForcePathStyle": false,
      "app.uploadDir": "uploads",
      "app.apiPrefix": "api/v1",
      "app.publicBaseUrl": "https://api.example.com",
    });

    await expect(createImageStorage(configService)).rejects.toThrow(
      "S3 image storage unavailable: HeadBucket failed",
    );
  });
});
