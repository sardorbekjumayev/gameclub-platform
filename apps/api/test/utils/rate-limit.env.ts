/**
 * e2e muhit: barcha spec'lar bitta IP (127.0.0.1) va ko'p so'rov bilan ishlaydi — rate limit
 * o'chirilmaydi, faqat juda yuqori qilib qo'yiladi (jest-e2e.json `setupFiles`, dotenv'dan keyin).
 * Past limitlar faqat `rate-limit.e2e-spec.ts` da (`rate-limit-low.env.ts`).
 */
const RATE_LIMIT_ENV_KEYS = ['RATE_LIMIT_GLOBAL', 'RATE_LIMIT_PUBLIC', 'RATE_LIMIT_WRITE', 'RATE_LIMIT_SENSITIVE', 'RATE_LIMIT_PROMO'] as const;

for (const k of RATE_LIMIT_ENV_KEYS) process.env[k] = '100000/60';
