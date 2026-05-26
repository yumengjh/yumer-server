import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Asset } from "../../entities/asset.entity";
import { generateAssetId } from "../../common/utils/id-generator.util";
import { WorkspacesService } from "../workspaces/workspaces.service";
import type { ImageStorage } from "./image-storage.interface";
import { IMAGE_STORAGE, ImageReadTarget } from "./image-storage.types";
import { isAllowedImageMimeType, readImageMetadata } from "./image-metadata.util";
import { getMaxImageFileSize } from "./image-upload-limits.util";

export interface UploadedImageResponse {
  imageId: string;
  url: string;
  publicUrl: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
}

@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    @InjectRepository(Asset)
    private readonly assetRepository: Repository<Asset>,
    private readonly configService: ConfigService,
    private readonly workspacesService: WorkspacesService,
    @Inject(IMAGE_STORAGE)
    private readonly imageStorage: ImageStorage,
  ) {}

  async upload(
    workspaceId: string,
    file: Express.Multer.File,
    userId: string,
  ): Promise<UploadedImageResponse> {
    await this.workspacesService.checkAccess(workspaceId, userId);

    if (!file?.buffer) {
      throw new BadRequestException("请选择要上传的图片");
    }
    if (!isAllowedImageMimeType(file.mimetype)) {
      throw new BadRequestException("仅支持 PNG、JPEG、WebP、GIF 图片");
    }

    const maxSize = getMaxImageFileSize(this.configService);
    if (file.size > maxSize) {
      throw new BadRequestException(`图片大小不能超过 ${Math.round(maxSize / 1024 / 1024)}MB`);
    }

    const imageId = generateAssetId();
    const metadata = readImageMetadata(file.buffer, file.mimetype);
    const storedImage = await this.imageStorage.saveImage({
      imageId,
      workspaceId,
      originalFilename: file.originalname || "image",
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
    asset.storageProvider = storedImage.storageProvider;
    asset.storagePath = storedImage.storagePath;
    asset.url = storedImage.url;
    asset.width = metadata.width;
    asset.height = metadata.height;
    asset.status = "active";
    asset.refCount = 0;
    asset.refs = [];

    try {
      const saved = await this.assetRepository.save(asset);
      return this.toResponse(saved);
    } catch (error) {
      try {
        await this.imageStorage.deleteImage({
          storagePath: storedImage.storagePath,
          mimeType: file.mimetype,
          filename: file.originalname || "image",
        });
      } catch (cleanupError) {
        this.logger.error(
          `Failed to delete uploaded image after asset save failed: ${storedImage.storagePath}`,
          cleanupError instanceof Error ? cleanupError.stack : String(cleanupError),
        );
      }
      throw error;
    }
  }

  async getFileReadTarget(imageId: string, userId: string): Promise<ImageReadTarget> {
    const image = await this.findActiveImage(imageId);
    await this.workspacesService.checkAccess(image.workspaceId, userId);
    return this.resolveReadTarget(image);
  }

  async getPublicFileReadTarget(imageId: string): Promise<ImageReadTarget> {
    const image = await this.findActiveImage(imageId);
    return this.resolveReadTarget(image);
  }

  private async findActiveImage(imageId: string): Promise<Asset> {
    const image = await this.assetRepository.findOne({ where: { assetId: imageId } });
    if (!image || image.status !== "active" || !isAllowedImageMimeType(image.mimeType)) {
      throw new NotFoundException("图片不存在");
    }
    return image;
  }

  private resolveReadTarget(image: Asset): Promise<ImageReadTarget> {
    return this.imageStorage.resolveReadTarget({
      storagePath: image.storagePath,
      mimeType: image.mimeType,
      filename: image.filename,
    });
  }

  private toResponse(asset: Asset): UploadedImageResponse {
    return {
      imageId: asset.assetId,
      url: asset.url,
      publicUrl: asset.url,
      filename: asset.filename,
      mimeType: asset.mimeType,
      size: Number(asset.size),
      width: asset.width ?? null,
      height: asset.height ?? null,
      createdAt: asset.createdAt,
    };
  }
}
