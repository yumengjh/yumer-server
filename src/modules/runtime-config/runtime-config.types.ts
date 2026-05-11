export const RUNTIME_CONFIG_KEYS = {
  RATE_LIMIT: 'rate_limit',
} as const;

export type RuntimeConfigKey = (typeof RUNTIME_CONFIG_KEYS)[keyof typeof RUNTIME_CONFIG_KEYS];

export interface RateLimitRuntimeConfig extends Record<string, unknown> {
  enabled: boolean;
  ttlMs: number;
  limit: number;
}

export interface RuntimeConfigSnapshot<TValue> {
  key: RuntimeConfigKey;
  value: TValue;
  updatedAt: Date | null;
}
