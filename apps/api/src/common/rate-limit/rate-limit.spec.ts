import { ExecutionContext } from '@nestjs/common';
import { envSchema } from '../../config/env';
import { AppException } from '../errors';
import { NoRateLimit, RateLimit } from './rate-limit.decorators';
import { hasPromoCode, RateLimitGuard, rateLimitKey, rateLimitTracker, tierApplies } from './rate-limit.guard';
import { RedisThrottlerStorage } from './redis-throttler.storage';

class Demo {
  @RateLimit('public', 'promo') quote() {}
  @RateLimit('sensitive') login() {}
  plain() {}
  @NoRateLimit() webhook() {}
}

const ctx = (handler: keyof Demo, body: unknown = {}, res: Record<string, unknown> = {}, type = 'http') =>
  ({
    getType: () => type,
    getHandler: () => Demo.prototype[handler],
    getClass: () => Demo,
    switchToHttp: () => ({ getRequest: () => ({ body }), getResponse: () => res }),
  }) as unknown as ExecutionContext;

const baseEnv = {
  DATABASE_URL: 'postgresql://x:y@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  QR_HMAC_SECRET: 'c'.repeat(32),
};

describe('rate limit env', () => {
  it('standart qiymatlar va `<limit>/<oyna>` formati', () => {
    const env = envSchema.parse({ ...baseEnv, RATE_LIMIT_PROMO: '5/900', RATE_LIMIT_PUBLIC: '' });
    expect(env.RATE_LIMIT_GLOBAL).toEqual({ limit: 300, window_s: 60 });
    expect(env.RATE_LIMIT_PUBLIC).toEqual({ limit: 120, window_s: 60 });
    expect(env.RATE_LIMIT_PROMO).toEqual({ limit: 5, window_s: 900 });
  });

  it.each(['abc', '10', '0/60', '10/0', '-1/60', '10/60s'])('noto\'g\'ri qiymat rad etiladi: %s', (v) => {
    expect(envSchema.safeParse({ ...baseEnv, RATE_LIMIT_WRITE: v }).success).toBe(false);
  });
});

describe('rate limit darajalari', () => {
  it('global har doim; qolganlari faqat dekorator bilan', () => {
    expect(tierApplies(ctx('plain'), 'global')).toBe(true);
    expect(tierApplies(ctx('plain'), 'public')).toBe(false);
    expect(tierApplies(ctx('quote'), 'public')).toBe(true);
    expect(tierApplies(ctx('login'), 'sensitive')).toBe(true);
    expect(tierApplies(ctx('login'), 'write')).toBe(false);
  });

  it('promo faqat body\'da kod bo\'lsa hisoblanadi', () => {
    expect(tierApplies(ctx('quote', {}), 'promo')).toBe(false);
    expect(tierApplies(ctx('quote', { promo_code: '  ' }), 'promo')).toBe(false);
    expect(tierApplies(ctx('quote', { promo_code: 'SUMMER' }), 'promo')).toBe(true);
    expect(hasPromoCode({ code: 'X1' })).toBe(true);
    expect(hasPromoCode(undefined)).toBe(false);
  });

  it('kalit: user id, aks holda IP; global/promo marshrutdan qat\'i nazar', () => {
    expect(rateLimitTracker({ user: { id: 'u1' }, ip: '1.2.3.4' } as never)).toBe('u:u1');
    expect(rateLimitTracker({ ip: '::ffff:10.0.0.7' } as never)).toBe('ip:10.0.0.7');
    expect(rateLimitKey(ctx('quote'), 'u:u1', 'global')).toBe('global:u:u1');
    expect(rateLimitKey(ctx('login'), 'u:u1', 'promo')).toBe('promo:u:u1');
    expect(rateLimitKey(ctx('login'), 'ip:1.2.3.4', 'sensitive')).toBe('sensitive:Demo.login:ip:1.2.3.4');
  });
});

describe('RateLimitGuard', () => {
  const guard = new RateLimitGuard({ throttlers: [] }, { increment: jest.fn() } as never, null as never) as unknown as {
    shouldSkip(c: ExecutionContext): Promise<boolean>;
    throwThrottlingException(c: ExecutionContext, d: unknown): Promise<void>;
  };

  it('@NoRateLimit va websocket o\'tkazib yuboriladi', async () => {
    expect(await guard.shouldSkip(ctx('webhook'))).toBe(true);
    expect(await guard.shouldSkip(ctx('plain', {}, {}, 'ws'))).toBe(true);
    expect(await guard.shouldSkip(ctx('plain'))).toBe(false);
  });

  it('429: RATE_LIMITED, Retry-After header va details.retry_after', async () => {
    const setHeader = jest.fn();
    const err = await guard.throwThrottlingException(ctx('login', {}, { setHeader }), { timeToBlockExpire: 42, timeToExpire: 10 }).catch((e) => e);
    expect(err).toBeInstanceOf(AppException);
    expect(err.getStatus()).toBe(429);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.details).toEqual({ retry_after: 42 });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '42');
  });
});

describe('RedisThrottlerStorage', () => {
  it('Lua natijasini soniyalarga aylantiradi va prefiks qo\'shadi', async () => {
    const evalFn = jest.fn().mockResolvedValueOnce([2, 59_001, 0]).mockResolvedValueOnce([11, 60_000, 60_000]);
    const storage = new RedisThrottlerStorage({ eval: evalFn } as never);
    expect(await storage.increment('k', 60_000, 10, 60_000)).toEqual({ totalHits: 2, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 });
    expect(evalFn).toHaveBeenCalledWith(expect.any(String), 2, 'rl:k', 'rl:k:block', 60_000, 10, 60_000);
    expect(await storage.increment('k', 60_000, 10, 60_000)).toEqual({ totalHits: 11, timeToExpire: 60, isBlocked: true, timeToBlockExpire: 60 });
  });
});
