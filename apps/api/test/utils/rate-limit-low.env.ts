/**
 * `rate-limit.e2e-spec.ts` uchun past limitlar. AppModule (ConfigModule.forRoot) import qilinishidan
 * OLDIN yuklanishi kerak — spec'da birinchi import. afterAll'da `restoreRateLimitEnv()`.
 */
const RATE_LIMIT_ENV_KEYS = ['RATE_LIMIT_GLOBAL', 'RATE_LIMIT_PUBLIC', 'RATE_LIMIT_WRITE', 'RATE_LIMIT_SENSITIVE', 'RATE_LIMIT_PROMO'];
export const LOW = { GLOBAL: 40, PUBLIC: 30, WRITE: 30, SENSITIVE: 3, PROMO: 3, WINDOW_S: 60 } as const;

const previous: Record<string, string | undefined> = {};
for (const k of RATE_LIMIT_ENV_KEYS) previous[k] = process.env[k];
process.env.RATE_LIMIT_GLOBAL = `${LOW.GLOBAL}/${LOW.WINDOW_S}`;
process.env.RATE_LIMIT_PUBLIC = `${LOW.PUBLIC}/${LOW.WINDOW_S}`;
process.env.RATE_LIMIT_WRITE = `${LOW.WRITE}/${LOW.WINDOW_S}`;
process.env.RATE_LIMIT_SENSITIVE = `${LOW.SENSITIVE}/${LOW.WINDOW_S}`;
process.env.RATE_LIMIT_PROMO = `${LOW.PROMO}/${LOW.WINDOW_S}`;

export function restoreRateLimitEnv() {
  for (const [k, v] of Object.entries(previous)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
