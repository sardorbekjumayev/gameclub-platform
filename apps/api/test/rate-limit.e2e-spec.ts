import { LOW, restoreRateLimitEnv } from './utils/rate-limit-low.env';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { api, bearer, Harness } from './utils/harness';
import { isolateOtpRateLimit } from './utils/otp-ip';

/**
 * Rate limit (docs/01-API.md §Rate limit): Redis'da, kalit — user id yoki IP.
 * 429 + RATE_LIMITED + Retry-After; boshqa foydalanuvchiga ta'sir qilmaydi; webhook va health hech qachon cheklanmaydi.
 */
describe('Rate limit (e2e)', () => {
  const h = isolateOtpRateLimit(new Harness());
  const fakeIp = () => `172.${16 + Math.floor(Math.random() * 16)}.${Math.floor(Math.random() * 255)}.${1 + Math.floor(Math.random() * 250)}`;

  beforeAll(async () => {
    // Oldingi ishga tushirishdan qolgan loopback kalitlari (admin login — sensitive) tozalanadi
    const redis = new Redis(process.env.REDIS_URL!);
    const keys = (await redis.keys('rl:*')).filter((k) => /ip:(127\.0\.0\.1|::1)(:block)?$/.test(k));
    if (keys.length) await redis.del(...keys);
    await redis.quit();
    await h.start();
  });

  afterAll(async () => {
    await h.stop();
    restoreRateLimitEnv();
  });

  const expect429 = (res: { status: number; body: any; headers: Record<string, string> }) => {
    expect(res.status).toBe(429);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(LOW.WINDOW_S);
    expect(res.body.error.details.retry_after).toBe(retryAfter);
  };

  it('sensitive endpoint (invitations/preview): limitdan keyin 429 + RATE_LIMITED + Retry-After; boshqa IP ta\'sirlanmaydi', async () => {
    const ip = fakeIp();
    const preview = (from: string) => h.http.post(api('/auth/invitations/preview')).set('X-Forwarded-For', from).send({ token: randomUUID() });
    for (let i = 0; i < LOW.SENSITIVE; i++) expect((await preview(ip)).status).not.toBe(429);
    expect429(await preview(ip));
    // Blok davomida ham 429
    expect429(await preview(ip));
    expect((await preview(fakeIp())).status).not.toBe(429);
  });

  it('promo-kod urinishlari foydalanuvchi bo\'yicha: A bloklanadi, B (o\'sha IP) — yo\'q; validate va price-quote umumiy hisob', async () => {
    const a = (await h.customer()).token;
    const b = (await h.customer()).token;
    const branchId = randomUUID();
    const validate = (token: string) =>
      h.http.post(api('/promotions/validate')).set(bearer(token)).send({ code: `GUESS${Math.floor(Math.random() * 1e6)}`, branch_id: branchId, amount: 100_000 });
    const quote = (token: string, promo?: string) =>
      h.http
        .post(api(`/branches/${branchId}/price-quote`))
        .set(bearer(token))
        .send({ start_at: new Date(Date.now() + 3_600_000).toISOString(), duration_minutes: 60, ...(promo ? { promo_code: promo } : {}) });

    for (let i = 0; i < LOW.PROMO - 1; i++) expect((await validate(a)).status).not.toBe(429);
    // Uchinchi urinish boshqa endpoint orqali — bir xil `promo` hisobiga tushadi
    expect((await quote(a, 'GUESS1')).status).not.toBe(429);
    expect429(await validate(a));
    expect429(await quote(a, 'GUESS2'));
    // Promo'siz narx hisoblash promo limitiga kirmaydi
    expect((await quote(a)).status).not.toBe(429);

    // B ham 127.0.0.1 dan — lekin kalit user id, shuning uchun ta'sirlanmaydi
    expect((await validate(b)).status).not.toBe(429);
  });

  it('global limit: bitta foydalanuvchi barcha marshrutlar bo\'yicha', async () => {
    const c = (await h.customer()).token;
    for (let i = 0; i < LOW.GLOBAL; i++) expect((await h.http.get(api('/auth/me')).set(bearer(c))).status).toBe(200);
    expect429(await h.http.get(api('/users/me')).set(bearer(c)));
    // Boshqa foydalanuvchi ishlayveradi
    const d = (await h.customer()).token;
    await h.http.get(api('/auth/me')).set(bearer(d)).expect(200);
  });

  it('to\'lov provayderi va Telegram webhook\'lari hech qachon cheklanmaydi', async () => {
    const ip = fakeIp();
    const paths = ['/webhooks/payments/demo', '/webhooks/payments/payme', '/webhooks/payments/click/prepare', '/webhooks/payments/click/complete', '/telegram/webhook'];
    for (const p of paths) {
      for (let i = 0; i < LOW.GLOBAL + 5; i++) {
        const res = await h.http.post(api(p)).set('X-Forwarded-For', ip).send({});
        expect(res.status).not.toBe(429);
      }
    }
  });

  it('health hech qachon cheklanmaydi', async () => {
    const ip = fakeIp();
    for (let i = 0; i < LOW.GLOBAL + 5; i++) {
      await h.http.get(api('/health')).set('X-Forwarded-For', ip).expect(200);
      await h.http.get(api('/health/ready')).set('X-Forwarded-For', ip).expect(200);
    }
  });
});
