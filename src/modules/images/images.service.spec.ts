import { Readable } from "stream";
// cspell:words IHDR
import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Repository } from "typeorm";
import { Asset } from "../../entities/asset.entity";
import { ImagesService } from "./images.service";
import type { ImageStorage } from "./image-storage.interface";
import type { ImageReadTarget } from "./image-storage.types";
import { WorkspacesService } from "../workspaces/workspaces.service";

jest.mock("../../common/utils/id-generator.util", () => ({
  generateAssetId: jest.fn(() => "img_test_123"),
}));

describe("ImagesService", () => {
  const assetRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
  } as unknown as Repository<Asset>;
  const configService = {
    get: jest.fn((key: string) => {
      if (key === "app.maxImageFileSize") return 5 * 1024 * 1024;
      if (key === "app.maxFileSize") return undefined;
      return undefined;
    }),
  } as unknown as ConfigService;
  const workspacesService = {
    checkAccess: jest.fn(),
  } as unknown as WorkspacesService;
  const imageStorage = {
    saveImage: jest.fn(),
    deleteImage: jest.fn(),
    resolveReadTarget: jest.fn(),
  } as unknown as ImageStorage;

  let service: ImagesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ImagesService(assetRepository, configService, workspacesService, imageStorage);
    jest.mocked(workspacesService.checkAccess).mockResolvedValue(undefined);
  });

  it("不再暴露旧的 stream 兼容接口", () => {
    const methodNames = Object.getOwnPropertyNames(ImagesService.prototype);

    expect(methodNames).not.toContain("getFileStream");
    expect(methodNames).not.toContain("getPublicFileStream");
    expect(methodNames).not.toContain("expectStreamTarget");
  });

  it("用 local 风格存储结果落库并回包", async () => {
    const createdAt = new Date("2026-05-25T08:00:00.000Z");
    const buffer = createPngBuffer(320, 180);
    const file = createFile({
      originalname: "cover/test.png",
      mimetype: "image/png",
      buffer,
    });

    jest.mocked(imageStorage.saveImage).mockResolvedValue({
      storageProvider: "local",
      storagePath: "workspaces/ws_1/images/img_test_123_cover_test.png",
      url: "https://app.example.com/api/v1/public/images/img_test_123/file",
    });
    jest.mocked(assetRepository.save).mockImplementation(async (asset: Asset) => {
      asset.createdAt = createdAt;
      return asset;
    });

    const result = await service.upload("ws_1", file, "user_1");

    expect(workspacesService.checkAccess).toHaveBeenCalledWith("ws_1", "user_1");
    expect(imageStorage.saveImage).toHaveBeenCalledWith({
      imageId: "img_test_123",
      workspaceId: "ws_1",
      originalFilename: "cover/test.png",
      mimeType: "image/png",
      buffer,
    });
    expect(assetRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "img_test_123",
        workspaceId: "ws_1",
        uploadedBy: "user_1",
        filename: "cover/test.png",
        mimeType: "image/png",
        size: buffer.length,
        storageProvider: "local",
        storagePath: "workspaces/ws_1/images/img_test_123_cover_test.png",
        url: "https://app.example.com/api/v1/public/images/img_test_123/file",
        width: 320,
        height: 180,
        status: "active",
        refCount: 0,
        refs: [],
      }),
    );
    expect(result).toEqual({
      imageId: "img_test_123",
      url: "https://app.example.com/api/v1/public/images/img_test_123/file",
      publicUrl: "https://app.example.com/api/v1/public/images/img_test_123/file",
      filename: "cover/test.png",
      mimeType: "image/png",
      size: buffer.length,
      width: 320,
      height: 180,
      createdAt,
    });
  });

  it("用 s3 风格存储结果落库并回包直链", async () => {
    const createdAt = new Date("2026-05-25T09:00:00.000Z");
    const buffer = createPngBuffer(640, 360);
    const file = createFile({
      originalname: "banner.webp",
      mimetype: "image/webp",
      buffer,
    });

    jest.mocked(imageStorage.saveImage).mockResolvedValue({
      storageProvider: "s3",
      storagePath: "workspaces/ws_2/images/img_test_123_banner.webp",
      url: "https://cdn.example.com/workspaces/ws_2/images/img_test_123_banner.webp",
    });
    jest.mocked(assetRepository.save).mockImplementation(async (asset: Asset) => {
      asset.createdAt = createdAt;
      return asset;
    });

    const result = await service.upload("ws_2", file, "user_2");

    expect(assetRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        storageProvider: "s3",
        storagePath: "workspaces/ws_2/images/img_test_123_banner.webp",
        url: "https://cdn.example.com/workspaces/ws_2/images/img_test_123_banner.webp",
      }),
    );
    expect(result).toEqual({
      imageId: "img_test_123",
      url: "https://cdn.example.com/workspaces/ws_2/images/img_test_123_banner.webp",
      publicUrl: "https://cdn.example.com/workspaces/ws_2/images/img_test_123_banner.webp",
      filename: "banner.webp",
      mimeType: "image/webp",
      size: buffer.length,
      width: null,
      height: null,
      createdAt,
    });
  });

  it("repository.save 失败时触发补偿删除", async () => {
    const buffer = createPngBuffer(100, 50);
    const file = createFile({
      originalname: "cleanup.png",
      mimetype: "image/png",
      buffer,
    });
    const saveError = new Error("save failed");

    jest.mocked(imageStorage.saveImage).mockResolvedValue({
      storageProvider: "local",
      storagePath: "workspaces/ws_3/images/img_test_123_cleanup.png",
      url: "https://app.example.com/api/v1/public/images/img_test_123/file",
    });
    jest.mocked(assetRepository.save).mockRejectedValue(saveError);
    jest.mocked(imageStorage.deleteImage).mockResolvedValue(undefined);

    await expect(service.upload("ws_3", file, "user_3")).rejects.toThrow(saveError);

    expect(imageStorage.deleteImage).toHaveBeenCalledWith({
      storagePath: "workspaces/ws_3/images/img_test_123_cleanup.png",
      mimeType: "image/png",
      filename: "cleanup.png",
    });
  });

  it("补偿删除失败也不覆盖原始 save 错误，并记录日志", async () => {
    const buffer = createPngBuffer(120, 60);
    const file = createFile({
      originalname: "cleanup-fail.png",
      mimetype: "image/png",
      buffer,
    });
    const saveError = new Error("db write failed");
    const deleteError = new Error("delete failed");
    const loggerErrorSpy = jest
      .spyOn(
        (service as unknown as { logger: { error: (...args: unknown[]) => void } }).logger,
        "error",
      )
      .mockImplementation();

    jest.mocked(imageStorage.saveImage).mockResolvedValue({
      storageProvider: "local",
      storagePath: "workspaces/ws_4/images/img_test_123_cleanup-fail.png",
      url: "https://app.example.com/api/v1/public/images/img_test_123/file",
    });
    jest.mocked(assetRepository.save).mockRejectedValue(saveError);
    jest.mocked(imageStorage.deleteImage).mockRejectedValue(deleteError);

    await expect(service.upload("ws_4", file, "user_4")).rejects.toThrow(saveError);
    expect(imageStorage.deleteImage).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it("非法 mime 仍按原逻辑报错", async () => {
    const file = createFile({
      originalname: "bad.txt",
      mimetype: "text/plain",
      buffer: Buffer.from("bad"),
    });

    await expect(service.upload("ws_5", file, "user_5")).rejects.toThrow(BadRequestException);
    await expect(service.upload("ws_5", file, "user_5")).rejects.toThrow(
      "仅支持 PNG、JPEG、WebP、GIF 图片",
    );
    expect(imageStorage.saveImage).not.toHaveBeenCalled();
    expect(assetRepository.save).not.toHaveBeenCalled();
  });

  it("超限仍按原逻辑报错", async () => {
    jest.mocked(configService.get).mockImplementation((key: string) => {
      if (key === "app.maxImageFileSize") return 10;
      if (key === "app.maxFileSize") return undefined;
      return undefined;
    });
    const buffer = createPngBuffer(20, 20);
    const file = createFile({
      originalname: "too-large.png",
      mimetype: "image/png",
      buffer,
      size: 11,
    });

    await expect(service.upload("ws_6", file, "user_6")).rejects.toThrow(BadRequestException);
    await expect(service.upload("ws_6", file, "user_6")).rejects.toThrow("图片大小不能超过 0MB");
    expect(imageStorage.saveImage).not.toHaveBeenCalled();
    expect(assetRepository.save).not.toHaveBeenCalled();
  });

  it("读取请求会委托给 imageStorage.resolveReadTarget", async () => {
    const readTarget: ImageReadTarget = {
      type: "redirect",
      redirectStrategy: "public-url",
      url: "https://cdn.example.com/workspaces/ws_7/images/img_test_123_read.png",
    };
    jest.mocked(assetRepository.findOne).mockResolvedValue({
      assetId: "img_test_123",
      workspaceId: "ws_7",
      filename: "read.png",
      mimeType: "image/png",
      storagePath: "workspaces/ws_7/images/img_test_123_read.png",
      status: "active",
    } as Asset);
    jest.mocked(imageStorage.resolveReadTarget).mockResolvedValue(readTarget);

    const result = await service.getPublicFileReadTarget("img_test_123");

    expect(imageStorage.resolveReadTarget).toHaveBeenCalledWith({
      storagePath: "workspaces/ws_7/images/img_test_123_read.png",
      mimeType: "image/png",
      filename: "read.png",
    });
    expect(result).toEqual(readTarget);
  });

  it("redirect 读取目标不会再被误判成 404", async () => {
    const readTarget: ImageReadTarget = {
      type: "redirect",
      redirectStrategy: "public-url",
      url: "https://cdn.example.com/workspaces/ws_8/images/img_test_123_read.png",
    };
    jest.mocked(assetRepository.findOne).mockResolvedValue({
      assetId: "img_test_123",
      workspaceId: "ws_8",
      filename: "read.png",
      mimeType: "image/png",
      storagePath: "workspaces/ws_8/images/img_test_123_read.png",
      status: "active",
    } as Asset);
    jest.mocked(imageStorage.resolveReadTarget).mockResolvedValue(readTarget);

    await expect(service.getPublicFileReadTarget("img_test_123")).resolves.toEqual(readTarget);
  });
});

function createFile({
  originalname,
  mimetype,
  buffer,
  size,
}: {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size?: number;
}): Express.Multer.File {
  return {
    fieldname: "file",
    originalname,
    encoding: "7bit",
    mimetype,
    size: size ?? buffer.length,
    buffer,
    stream: Readable.from(buffer),
    destination: "",
    filename: "",
    path: "",
  } as Express.Multer.File;
}

function createPngBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}
