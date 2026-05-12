import { registerAs } from '@nestjs/config';

const parseBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
};

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '5200', 10),
  env: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  uploadDir: process.env.UPLOAD_DIR || 'uploads',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 默认 10MB
  swaggerEnabled: parseBoolean(process.env.SWAGGER_ENABLED, true),
  swaggerPath: process.env.SWAGGER_PATH || 'docs',
}));
