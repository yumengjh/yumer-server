import type { ConfigService } from "@nestjs/config";
import type { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";

const DEFAULT_MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;

export const getMaxImageFileSize = (configService: ConfigService): number =>
  configService.get<number>("app.maxImageFileSize") ||
  configService.get<number>("app.maxFileSize") ||
  DEFAULT_MAX_IMAGE_FILE_SIZE;

export const createImageMulterOptions = (configService: ConfigService): MulterOptions => ({
  limits: {
    fileSize: getMaxImageFileSize(configService),
  },
});
