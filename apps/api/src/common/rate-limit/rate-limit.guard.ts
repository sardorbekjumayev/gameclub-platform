import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { normalizeIp, ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppException } from '../errors';
import { clientIp } from '../utils/request';
import { RATE_LIMIT_SKIP, RATE_LIMIT_TIERS, RateTier, RouteTier } from './rate-limit.decorators';

const reflector = new Reflector();

const routeTiers = (ctx: ExecutionContext) =>
  reflector.getAllAndOverride<RouteTier[] | undefined>(RATE_LIMIT_TIERS, [ctx.getHandler(), ctx.getClass()]) ?? [];

/** Promo urinishi: body'da bo'sh bo'lmagan `promo_code` (bron, price-quote) yoki `code` (promotions/validate). */
export const hasPromoCode = (body: unknown) => {
  const b = (body ?? {}) as { promo_code?: unknown; code?: unknown };
  return [b.promo_code, b.code].some((v) => typeof v === 'string' && v.trim() !== '');
};

/** Daraja shu so'rovga tegishlimi (`global` — har doim). */
export function tierApplies(ctx: ExecutionContext, tier: RateTier) {
  if (tier === 'global') return true;
  if (!routeTiers(ctx).includes(tier)) return false;
  if (tier === 'promo') return hasPromoCode(ctx.switchToHttp().getRequest<Request>().body);
  return true;
}

/** Kalit: autentifikatsiya qilingan foydalanuvchi id'si, aks holda klient IP (`trust proxy` orqali). */
export function rateLimitTracker(req: Request & { user?: { id: string } }) {
  if (req.user?.id) return `u:${req.user.id}`;
  const ip = clientIp(req) ?? 'unknown';
  return `ip:${normalizeIp(ip)}`;
}

/** `global` va `promo` — marshrutdan qat'i nazar bitta hisob; qolganlari marshrut bo'yicha. */
export function rateLimitKey(ctx: ExecutionContext, tracker: string, tier: string) {
  if (tier === 'global' || tier === 'promo') return `${tier}:${tracker}`;
  return `${tier}:${ctx.getClass().name}.${ctx.getHandler().name}:${tracker}`;
}

/**
 * Global guard (AuthModule'da JwtAuthGuard'dan keyin — `req.user` tayyor bo'lishi uchun).
 * WebSocket gateway va `@NoRateLimit()` marshrutlar o'tkazib yuboriladi.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected async shouldSkip(ctx: ExecutionContext) {
    if (ctx.getType() !== 'http') return true;
    return !!reflector.getAllAndOverride<boolean>(RATE_LIMIT_SKIP, [ctx.getHandler(), ctx.getClass()]);
  }

  protected async getTracker(req: Record<string, any>) {
    return rateLimitTracker(req as Request);
  }

  protected generateKey(ctx: ExecutionContext, tracker: string, name: string) {
    return rateLimitKey(ctx, tracker, name);
  }

  protected async throwThrottlingException(ctx: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    const retryAfter = Math.max(1, detail.timeToBlockExpire || detail.timeToExpire);
    ctx.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(retryAfter));
    throw new AppException('RATE_LIMITED', 'Too many requests', { retry_after: retryAfter });
  }
}
