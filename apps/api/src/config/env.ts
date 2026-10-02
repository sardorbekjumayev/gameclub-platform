import { z } from 'zod';

/** `.env` dagi bo'sh qiymat (`KEY=`) — berilmagan deb hisoblanadi. */
const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4700),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  QR_HMAC_SECRET: z.string().min(32),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  APP_TIMEZONE_DEFAULT: z.string().default('Asia/Tashkent'),
  ADMIN_APP_URL: z.string().url().default('http://localhost:4720'),
  // Telegram bot — login kodi (OTP) shu bot orqali yuboriladi. Token bo'lmasa dev'da qat'iy kod 000000.
  TELEGRAM_BOT_TOKEN: optional(z.string()),
  TELEGRAM_BOT_USERNAME: optional(z.string()),
  TELEGRAM_MODE: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['polling', 'webhook']).default('polling')),
  TELEGRAM_WEBHOOK_URL: optional(z.string().url()),
  TELEGRAM_WEBHOOK_SECRET: optional(z.string().min(16)),
  // To'lov provayderlari — kalitlar berilmasa provayder o'chiq (faqat DEMO)
  PUBLIC_API_URL: z.string().url().default('http://localhost:4700/api/v1'),
  PAYME_MERCHANT_ID: optional(z.string()),
  PAYME_KEY: optional(z.string()),
  PAYME_TEST: z.preprocess((v) => v === 'true' || v === '1', z.boolean()).default(true),
  CLICK_SERVICE_ID: optional(z.string()),
  CLICK_MERCHANT_ID: optional(z.string()),
  CLICK_SECRET_KEY: optional(z.string()),
  CLICK_MERCHANT_USER_ID: optional(z.string()),
  // Push (FCM HTTP v1) — service account JSON (bir qatorda yoki base64)
  FCM_SERVICE_ACCOUNT: optional(z.string()),
  SUPER_ADMIN_EMAIL: z.string().email().optional(),
  SUPER_ADMIN_PASSWORD: z.string().min(8).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    // Faqat kalit nomlari chiqariladi — qiymatlar (sirlar) log'ga tushmaydi.
    const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment variables: ${keys}`);
  }
  return parsed.data;
}
