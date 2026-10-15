import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerModuleOptions } from '@nestjs/throttler';
import type Redis from 'ioredis';
import type { RateLimitRule } from '../../config/env';
import { REDIS } from '../../infra/redis/redis.module';
import { RATE_TIERS } from './rate-limit.decorators';
import { tierApplies } from './rate-limit.guard';
import { RedisThrottlerStorage } from './redis-throttler.storage';

const ENV_KEY = {
  global: 'RATE_LIMIT_GLOBAL',
  public: 'RATE_LIMIT_PUBLIC',
  write: 'RATE_LIMIT_WRITE',
  sensitive: 'RATE_LIMIT_SENSITIVE',
  promo: 'RATE_LIMIT_PROMO',
} as const;

export function throttlerOptions(config: ConfigService, redis: Redis): ThrottlerModuleOptions {
  return {
    storage: new RedisThrottlerStorage(redis),
    // Retry-After guard'da o'zimiz qo'yamiz (throttler `Retry-After-<nom>` qo'yardi)
    setHeaders: false,
    throttlers: RATE_TIERS.map((name) => {
      const rule = config.getOrThrow<RateLimitRule>(ENV_KEY[name]);
      return { name, limit: rule.limit, ttl: rule.window_s * 1000, skipIf: (ctx) => !tierApplies(ctx, name) };
    }),
  };
}

/** Redis'dagi rate limit sozlamasi; guard o'zi AuthModule'da (JWT guard'dan keyin) ro'yxatdan o'tadi. */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, REDIS],
      useFactory: throttlerOptions,
    }),
  ],
})
export class RateLimitModule {}
