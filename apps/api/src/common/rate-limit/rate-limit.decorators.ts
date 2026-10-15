import { SetMetadata } from '@nestjs/common';

/**
 * Rate limit darajalari (docs/01-API.md §Rate limit). Sonlar env'dan (`RATE_LIMIT_*`).
 * - `global`    — har bir marshrut, kalit bo'yicha umumiy hisob (marshrutdan qat'i nazar);
 * - `public`    — ommaviy o'qish (filial sahifasi, bo'sh joylar, slotlar, xarita, qidiruv), marshrut bo'yicha;
 * - `write`     — yozish/suiiste'mol (bron, arenda, o'tkazma, sharh, murojaat, sevimlilar), marshrut bo'yicha;
 * - `sensitive` — brute-force (login, OTP, parol, taklif, bron kodi/QR), marshrut bo'yicha;
 * - `promo`     — promo-kod urinishi (validate, price-quote, bron), barcha marshrutlar uchun bitta hisob.
 */
export const RATE_TIERS = ['global', 'public', 'write', 'sensitive', 'promo'] as const;
export type RateTier = (typeof RATE_TIERS)[number];
/** `global` hamma joyda avtomatik; dekorator bilan qo'shimcha darajalar beriladi. */
export type RouteTier = Exclude<RateTier, 'global'>;

export const RATE_LIMIT_TIERS = 'rateLimitTiers';
export const RATE_LIMIT_SKIP = 'rateLimitSkip';

/** Marshrutga qo'shimcha daraja(lar): `@RateLimit('write', 'promo')`. */
export const RateLimit = (...tiers: RouteTier[]) => SetMetadata(RATE_LIMIT_TIERS, tiers);

/**
 * Umuman cheklanmaydi: health, to'lov provayderi webhook'lari (o'zlari autentifikatsiya qiladi),
 * Telegram webhook. Provayder qayta urinishlari hech qachon 429 olmasligi kerak.
 */
export const NoRateLimit = () => SetMetadata(RATE_LIMIT_SKIP, true);
