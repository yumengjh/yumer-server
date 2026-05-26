import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createReadStream, existsSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { dirname, isAbsolute, join } from "path";
import { ImageStorage } from "./image-storage.interface";
import {
  ImageReadTarget,
  SaveImageInput,
  SaveImageResult,
  StoredImageDescriptor,
} from "./image-storage.types";

@Injectable()
export class LocalImageStorageService implements ImageStorage {
  constructor(private readonly configService: ConfigService) {}

  async saveImage(input: SaveImageInput): Promise<SaveImageResult> {
    const sanitizedFilename = this.sanitizeFilename(input.originalFilename);
    const storagePath = [
      "workspaces",
      input.workspaceId,
      "images",
      `${input.imageId}_${sanitizedFilename}`,
    ].join("/");
    const fullPath = this.toFullPath(storagePath);

    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, input.buffer);

    return {
      storageProvider: "local",
      storagePath,
      url: this.buildPublicUrl(input.imageId),
    };
  }

  async deleteImage(image: StoredImageDescriptor): Promise<void> {
    await rm(this.toFullPath(image.storagePath), { force: true });
  }

  async resolveReadTarget(image: StoredImageDescriptor): Promise<ImageReadTarget> {
    const fullPath = this.toFullPath(image.storagePath);
    if (!existsSync(fullPath)) {
      throw new NotFoundException("图片文件不存在");
    }

    return {
      type: "stream",
      stream: createReadStream(fullPath),
      mimeType: image.mimeType,
      filename: image.filename,
    };
  }

  buildPublicUrl(imageId: string): string {
    return this.toAbsoluteUrl(`/${this.getApiPrefix()}/public/images/${imageId}/file`);
  }

  private sanitizeFilename(filename: string): string {
    return (filename || "image").replace(/[/\\]/g, "_");
  }

  private toFullPath(storagePath: string): string {
    return join(this.getUploadRoot(), ...storagePath.split("/"));
  }

  private getUploadRoot(): string {
    const uploadDir = this.configService.get<string>("app.uploadDir") || "uploads";
    return isAbsolute(uploadDir) ? uploadDir : join(process.cwd(), uploadDir);
  }

  private getApiPrefix(): string {
    return this.configService.get<string>("app.apiPrefix") || "api/v1";
  }

  private toAbsoluteUrl(path: string): string {
    const baseUrl =
      this.configService.get<string>("app.publicBaseUrl") ||
      `http://localhost:${this.configService.get<number>("app.port") || 5200}`;
    return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  }
}
