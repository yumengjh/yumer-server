import { registerAs } from '@nestjs/config';
import { parseSiteOriginPatterns } from '../common/utils/site-origin.util';

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

const parseIntWithDefault = (
  value: string | undefined,
  defaultValue: number,
  min: number,
): number => {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return defaultValue;
  }
  return Math.max(parsed, min);
};

export default registerAs('runtime', () => ({
  pollIntervalMs: parseIntWithDefault(process.env.RUNTIME_CONFIG_POLL_INTERVAL_MS, 5000, 1000),
  systemAdminToken: process.env.SYSTEM_ADMIN_TOKEN || '',
  publicSiteOrigins: parseSiteOriginPatterns(process.env.PUBLIC_SITE_ORIGINS),
  publicSiteAllowNoOrigin: parseBoolean(process.env.PUBLIC_SITE_ALLOW_NO_ORIGIN, false),
  rateLimit: {
    enabled: parseBoolean(process.env.RATE_LIMIT_ENABLED, true),
    ttlMs: parseIntWithDefault(process.env.RATE_LIMIT_TTL, 60000, 1000),
    limit: parseIntWithDefault(process.env.RATE_LIMIT_MAX, 100, 1),
  },
}));
