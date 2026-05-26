import {
  DeleteObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ClientConfig,
} from "@aws-sdk/client-s3";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ImageStorage } from "./image-storage.interface";
import {
  ImageReadTarget,
  SaveImageInput,
  SaveImageResult,
  StoredImageDescriptor,
} from "./image-storage.types";

interface S3ClientLike {
  send(command: PutObjectCommand | DeleteObjectCommand | HeadBucketCommand): Promise<unknown>;
}

interface RequiredS3Config {
  bucket: string;
  publicBaseUrl: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

@Injectable()
export class S3ImageStorageService implements ImageStorage {
  private readonly config: RequiredS3Config;

  private readonly clientOptions: S3ClientConfig;

  private client: S3ClientLike;

  constructor(private readonly configService: ConfigService) {
    this.config = this.loadRequiredConfig();
    this.clientOptions = {
      endpoint: this.config.endpoint,
      region: this.config.region,
      forcePathStyle: this.config.forcePathStyle,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
    };
    this.client = new S3Client(this.clientOptions);
  }

  async saveImage(input: SaveImageInput): Promise<SaveImageResult> {
    const key = this.buildObjectKey(input.imageId, input.workspaceId, input.originalFilename);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: input.buffer,
        ContentType: input.mimeType,
      }),
    );

    return {
      storageProvider: "s3",
      storagePath: key,
      url: this.buildPublicUrl(key),
    };
  }

  async deleteImage(image: StoredImageDescriptor): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: image.storagePath,
      }),
    );
  }

  async resolveReadTarget(image: StoredImageDescriptor): Promise<ImageReadTarget> {
    return {
      type: "redirect",
      redirectStrategy: "public-url",
      url: this.buildPublicUrl(image.storagePath),
    };
  }

  async checkHealth(): Promise<void> {
    await this.client.send(
      new HeadBucketCommand({
        Bucket: this.config.bucket,
      }),
    );
  }

  private buildObjectKey(imageId: string, workspaceId: string, originalFilename: string): string {
    const sanitizedFilename = (originalFilename || "image").replace(/[/\\]/g, "_");
    return ["workspaces", workspaceId, "images", `${imageId}_${sanitizedFilename}`].join("/");
  }

  private buildPublicUrl(key: string): string {
    return `${this.config.publicBaseUrl.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
  }

  private loadRequiredConfig(): RequiredS3Config {
    return {
      bucket: this.requireConfig("app.s3Bucket"),
      publicBaseUrl: this.requireUrlConfig("app.s3PublicBaseUrl"),
      endpoint: this.requireUrlConfig("app.s3Endpoint"),
      region: this.requireConfig("app.s3Region"),
      accessKeyId: this.requireConfig("app.s3AccessKeyId"),
      secretAccessKey: this.requireConfig("app.s3SecretAccessKey"),
      forcePathStyle: this.configService.get<boolean>("app.s3ForcePathStyle") || false,
    };
  }

  private requireConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value || !value.trim()) {
      throw new Error(`S3 image storage requires ${key} when app.imageStorageProvider is s3`);
    }
    return value.trim();
  }

  private requireUrlConfig(key: string): string {
    const value = this.requireConfig(key);

    try {
      new URL(value);
    } catch {
      throw new Error(
        `S3 image storage requires ${key} to be a valid URL when app.imageStorageProvider is s3`,
      );
    }

    return value;
  }
}
