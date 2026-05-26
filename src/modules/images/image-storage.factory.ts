import { Logger, Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ImageStorage } from "./image-storage.interface";
import { LocalImageStorageService } from "./local-image-storage.service";
import { S3ImageStorageService } from "./s3-image-storage.service";
import { IMAGE_STORAGE } from "./image-storage.types";

const logger = new Logger("ImageStorageFactory");

export const createImageStorage = async (configService: ConfigService): Promise<ImageStorage> => {
  const provider = configService.get<string>("app.imageStorageProvider");

  if (provider !== "s3") {
    logger.log("Image storage provider: local");
    return new LocalImageStorageService(configService);
  }

  try {
    const s3Storage = new S3ImageStorageService(configService);
    await s3Storage.checkHealth();
    logger.log("Image storage provider: s3");
    logger.log("S3 bucket health check: ok");
    return s3Storage;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`S3 image storage unavailable: ${reason}`);
  }
};

export const imageStorageProvider: Provider = {
  provide: IMAGE_STORAGE,
  inject: [ConfigService],
  useFactory: createImageStorage,
};
