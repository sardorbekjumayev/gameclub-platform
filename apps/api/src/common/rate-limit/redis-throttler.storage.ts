import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type Redis from 'ioredis';

/**
 * Atomar fixed-window hisoblagich + blok kaliti (bir nechta API instansiyasi uchun umumiy).
 * KEYS[1] — hisob, KEYS[2] — blok; ARGV: ttl_ms, limit, block_ms. Qaytaradi: {hits, ttl_ms, block_ms}.
 * Blok davomida hisob oshirilmaydi; blok tugagach yangi oyna boshlanadi.
 */
const SCRIPT = `
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then
  return {tonumber(ARGV[2]) + 1, blocked, blocked}
end
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return {hits, tonumber(ARGV[3]), tonumber(ARGV[3])}
end
return {hits, ttl, 0}
`;

export const RATE_LIMIT_PREFIX = 'rl:';

/** `@nestjs/throttler` uchun mavjud ioredis klienti ustidagi storage (yangi bog'liqliksiz). */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number): Promise<ThrottlerStorageRecord> {
    const k = `${RATE_LIMIT_PREFIX}${key}`;
    const [hits, ttlMs, blockMs] = (await this.redis.eval(SCRIPT, 2, k, `${k}:block`, ttl, limit, blockDuration || ttl)) as number[];
    return {
      totalHits: hits,
      // throttler soniyalarda kutadi
      timeToExpire: Math.ceil(ttlMs / 1000),
      isBlocked: blockMs > 0,
      timeToBlockExpire: Math.ceil(blockMs / 1000),
    };
  }
}
