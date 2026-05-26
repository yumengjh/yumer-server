import { registerAs } from "@nestjs/config";

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
};

export default registerAs("app", () => ({
  port: parseInt(process.env.PORT || "5200", 10),
  env: process.env.NODE_ENV || "development",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:3000",
  publicBaseUrl:
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_PUBLIC_BASE_URL ||
    `http://localhost:${process.env.PORT || "5200"}`,
  apiPrefix: process.env.API_PREFIX || "api/v1",
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  imageStorageProvider: process.env.IMAGE_STORAGE_PROVIDER || "local",
  s3Endpoint: process.env.S3_ENDPOINT || "",
  s3Region: process.env.S3_REGION || "",
  s3Bucket: process.env.S3_BUCKET || "",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
  s3PublicBaseUrl: process.env.S3_PUBLIC_BASE_URL || "",
  s3ForcePathStyle: parseBoolean(process.env.S3_FORCE_PATH_STYLE, false),
  // IMAGE_MAX_FILE_SIZE 优先，MAX_FILE_SIZE 仍作为通用上传兼容回退。
  maxImageFileSize: parseInt(
    process.env.IMAGE_MAX_FILE_SIZE || process.env.MAX_FILE_SIZE || "10485760",
    10,
  ),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || "10485760", 10), // 默认 10MB
  swaggerEnabled: parseBoolean(process.env.SWAGGER_ENABLED, true),
  swaggerPath: process.env.SWAGGER_PATH || "docs",
}));
