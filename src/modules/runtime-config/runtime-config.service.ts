import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RuntimeConfig } from '../../entities/runtime-config.entity';
import {
  RateLimitRuntimeConfig,
  RUNTIME_CONFIG_KEYS,
  RuntimeConfigSnapshot,
} from './runtime-config.types';
import { UpdateRateLimitConfigDto } from './dto/update-rate-limit-config.dto';

const RATE_LIMIT_TTL_MIN = 1000;
const RATE_LIMIT_TTL_MAX = 86_400_000;
const RATE_LIMIT_LIMIT_MIN = 1;
const RATE_LIMIT_LIMIT_MAX = 100_000;

@Injectable()
export class RuntimeConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeConfigService.name);

  private readonly cache = new Map<string, unknown>();
  private readonly updatedAtCache = new Map<string, Date | null>();
  private pollingTimer?: NodeJS.Timeout;
  private pollingInProgress = false;

  constructor(
    @InjectRepository(RuntimeConfig)
    private readonly runtimeConfigRepository: Repository<RuntimeConfig>,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    try {
      await this.loadRuntimeConfigs();
      await this.ensureDefaults();
    } catch (error) {
      this.logger.error(
        `初始化运行时配置失败，将使用内存默认值: ${error instanceof Error ? error.message : String(error)}`,
      );
      const defaults = this.getDefaultRateLimitConfig();
      this.cache.set(RUNTIME_CONFIG_KEYS.RATE_LIMIT, defaults);
      this.updatedAtCache.set(RUNTIME_CONFIG_KEYS.RATE_LIMIT, null);
    }
    this.startPolling();
  }

  onModuleDestroy() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  getRateLimitConfigSnapshot(): RuntimeConfigSnapshot<RateLimitRuntimeConfig> {
    const cached = this.cache.get(RUNTIME_CONFIG_KEYS.RATE_LIMIT);
    if (this.isRateLimitRuntimeConfig(cached)) {
      return {
        key: RUNTIME_CONFIG_KEYS.RATE_LIMIT,
        value: cached,
        updatedAt: this.updatedAtCache.get(RUNTIME_CONFIG_KEYS.RATE_LIMIT) ?? null,
      };
    }

    const fallback = this.getDefaultRateLimitConfig();
    return {
      key: RUNTIME_CONFIG_KEYS.RATE_LIMIT,
      value: fallback,
      updatedAt: null,
    };
  }

  getRateLimitConfigForGuard(): RateLimitRuntimeConfig {
    return this.getRateLimitConfigSnapshot().value;
  }

  async getRateLimitConfig(): Promise<RuntimeConfigSnapshot<RateLimitRuntimeConfig>> {
    await this.pollFromDatabase();
    return this.getRateLimitConfigSnapshot();
  }

  async updateRateLimitConfig(
    patch: UpdateRateLimitConfigDto,
    updatedBy: string,
  ): Promise<RuntimeConfigSnapshot<RateLimitRuntimeConfig>> {
    const current = this.getRateLimitConfigSnapshot().value;
    const merged = this.normalizeRateLimitRuntimeConfig({
      ...current,
      ...patch,
    });

    const saved = await this.saveRuntimeConfig(RUNTIME_CONFIG_KEYS.RATE_LIMIT, merged, updatedBy);
    return this.toRateLimitSnapshot(saved);
  }

  async resetRateLimitConfig(
    updatedBy: string,
  ): Promise<RuntimeConfigSnapshot<RateLimitRuntimeConfig>> {
    const defaults = this.getDefaultRateLimitConfig();
    const saved = await this.saveRuntimeConfig(RUNTIME_CONFIG_KEYS.RATE_LIMIT, defaults, updatedBy);
    return this.toRateLimitSnapshot(saved);
  }

  private startPolling() {
    const interval = this.configService.get<number>('runtime.pollIntervalMs') ?? 5000;
    if (interval < 1000) {
      this.logger.warn(`runtime.pollIntervalMs=${interval} 过小，已强制提升为 1000ms`);
    }

    const finalInterval = Math.max(interval, 1000);
    this.pollingTimer = setInterval(() => {
      void this.pollFromDatabase();
    }, finalInterval);
    this.pollingTimer.unref?.();
  }

  private async ensureDefaults() {
    if (!this.cache.has(RUNTIME_CONFIG_KEYS.RATE_LIMIT)) {
      const defaults = this.getDefaultRateLimitConfig();
      const saved = await this.saveRuntimeConfig(
        RUNTIME_CONFIG_KEYS.RATE_LIMIT,
        defaults,
        'system_bootstrap',
      );
      this.cache.set(saved.configKey, defaults);
      this.updatedAtCache.set(saved.configKey, saved.updatedAt ?? null);
    }
  }

  private async loadRuntimeConfigs() {
    const records = await this.runtimeConfigRepository.find();

    for (const record of records) {
      if (record.configKey === RUNTIME_CONFIG_KEYS.RATE_LIMIT) {
        const normalized = this.normalizeRateLimitRuntimeConfig(record.configValue);
        this.cache.set(record.configKey, normalized);
        this.updatedAtCache.set(record.configKey, record.updatedAt ?? null);
      }
    }
  }

  private async pollFromDatabase() {
    if (this.pollingInProgress) {
      return;
    }

    this.pollingInProgress = true;
    try {
      await this.loadRuntimeConfigs();
    } catch (error) {
      this.logger.warn(
        `轮询运行时配置失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.pollingInProgress = false;
    }
  }

  private async saveRuntimeConfig(
    configKey: string,
    configValue: Record<string, unknown>,
    updatedBy: string,
  ): Promise<RuntimeConfig> {
    const existing = await this.runtimeConfigRepository.findOne({
      where: { configKey },
    });

    if (existing) {
      existing.configValue = configValue;
      existing.updatedBy = updatedBy;
      const saved = await this.runtimeConfigRepository.save(existing);
      this.cache.set(configKey, configValue);
      this.updatedAtCache.set(configKey, saved.updatedAt ?? null);
      return saved;
    }

    const created = this.runtimeConfigRepository.create({
      configKey,
      configValue,
      updatedBy,
    });
    const saved = await this.runtimeConfigRepository.save(created);
    this.cache.set(configKey, configValue);
    this.updatedAtCache.set(configKey, saved.updatedAt ?? null);
    return saved;
  }

  private toRateLimitSnapshot(
    runtimeConfig: RuntimeConfig,
  ): RuntimeConfigSnapshot<RateLimitRuntimeConfig> {
    const normalized = this.normalizeRateLimitRuntimeConfig(runtimeConfig.configValue);
    this.cache.set(runtimeConfig.configKey, normalized);
    this.updatedAtCache.set(runtimeConfig.configKey, runtimeConfig.updatedAt ?? null);

    return {
      key: RUNTIME_CONFIG_KEYS.RATE_LIMIT,
      value: normalized,
      updatedAt: runtimeConfig.updatedAt ?? null,
    };
  }

  private getDefaultRateLimitConfig(): RateLimitRuntimeConfig {
    return {
      enabled: this.configService.get<boolean>('runtime.rateLimit.enabled') ?? true,
      ttlMs: this.normalizeInteger(
        this.configService.get<number>('runtime.rateLimit.ttlMs'),
        60000,
        RATE_LIMIT_TTL_MIN,
        RATE_LIMIT_TTL_MAX,
      ),
      limit: this.normalizeInteger(
        this.configService.get<number>('runtime.rateLimit.limit'),
        100,
        RATE_LIMIT_LIMIT_MIN,
        RATE_LIMIT_LIMIT_MAX,
      ),
    };
  }

  private normalizeRateLimitRuntimeConfig(value: unknown): RateLimitRuntimeConfig {
    const defaults = this.getDefaultRateLimitConfig();
    const plain = this.isPlainObject(value) ? value : {};

    return {
      enabled: typeof plain.enabled === 'boolean' ? plain.enabled : defaults.enabled,
      ttlMs: this.normalizeInteger(
        plain.ttlMs,
        defaults.ttlMs,
        RATE_LIMIT_TTL_MIN,
        RATE_LIMIT_TTL_MAX,
      ),
      limit: this.normalizeInteger(
        plain.limit,
        defaults.limit,
        RATE_LIMIT_LIMIT_MIN,
        RATE_LIMIT_LIMIT_MAX,
      ),
    };
  }

  private normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fallback;
    }

    const integer = Math.trunc(value);
    if (integer < min) return min;
    if (integer > max) return max;
    return integer;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private isRateLimitRuntimeConfig(value: unknown): value is RateLimitRuntimeConfig {
    if (!this.isPlainObject(value)) {
      return false;
    }

    return (
      typeof value.enabled === 'boolean' &&
      typeof value.ttlMs === 'number' &&
      typeof value.limit === 'number'
    );
  }
}
