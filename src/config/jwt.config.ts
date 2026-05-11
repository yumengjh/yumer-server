import { registerAs } from '@nestjs/config';

export default registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
  expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  refreshSecret: process.env.REFRESH_TOKEN_SECRET || 'your-refresh-token-secret',
  refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  adminSecret: process.env.ADMIN_JWT_SECRET || 'admin-secret-key-change-in-production',
  adminExpiresIn: process.env.ADMIN_JWT_EXPIRES_IN || '24h',
  adminRefreshSecret: process.env.ADMIN_REFRESH_TOKEN_SECRET || process.env.ADMIN_JWT_SECRET || 'admin-refresh-secret',
  adminRefreshExpiresIn: process.env.ADMIN_REFRESH_TOKEN_EXPIRES_IN || '7d',
}));
