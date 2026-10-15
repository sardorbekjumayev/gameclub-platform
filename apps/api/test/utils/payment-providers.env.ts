/**
 * Payme/Click merchant webhooklarini sinash uchun test kalitlari. AppModule (ConfigModule.forRoot) import
 * qilinishidan OLDIN yuklanishi kerak — shuning uchun spec'da harness'dan oldin import qilinadi.
 * CLICK_MERCHANT_USER_ID atayin bo'sh: refund haqiqiy Click API'ga so'rov yubormasin.
 */
export const PROVIDER_ENV = {
  PAYME_MERCHANT_ID: 'e2e-payme-merchant',
  PAYME_KEY: 'e2e-payme-key-0123456789',
  PAYME_TEST: 'true',
  CLICK_SERVICE_ID: '90001',
  CLICK_MERCHANT_ID: '90002',
  CLICK_SECRET_KEY: 'e2e-click-secret-0123456789',
  CLICK_MERCHANT_USER_ID: '',
} as const;

const previous: Record<string, string | undefined> = {};
for (const [k, v] of Object.entries(PROVIDER_ENV)) {
  previous[k] = process.env[k];
  process.env[k] = v;
}

/** afterAll'da chaqiriladi — bir worker'dagi keyingi spec'larga kalitlar o'tmasin. */
export function restoreProviderEnv() {
  for (const [k, v] of Object.entries(previous)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
