import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { REDIS } from '../src/infra/redis/redis.module';

/** Super admin ijtimoiy tarmoq havolalarini sozlaydi → mijozlar ommaviy `GET /social` orqali ko'radi. */
describe('Social links (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const api = (p: string) => `/api/v1${p}`;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  let admin: string;
  let customer: string;
  let original: unknown;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    const redis = app.get<Redis>(REDIS);
    for (const pattern of ['login:*', 'otp:ip:*']) {
      const keys = await redis.keys(pattern);
      if (keys.length) await redis.del(...keys);
    }
    const res = await http.post(api('/auth/login')).send({ login: process.env.SUPER_ADMIN_EMAIL, password: process.env.SUPER_ADMIN_PASSWORD }).expect(200);
    admin = res.body.data.access_token;
    const phone = `+99890${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
    await redis.del(`otp:cooldown:${phone}`);
    await http.post(api('/auth/send-otp')).send({ phone, purpose: 'LOGIN' }).expect(200);
    customer = (await http.post(api('/auth/verify-otp')).send({ phone, code: '000000' }).expect(200)).body.data.access_token;
    original = (await http.get(api('/admin/settings/social')).set(bearer(admin)).expect(200)).body.data;
  });

  // Dev bazadagi haqiqiy sozlamani tiklaymiz
  afterAll(async () => {
    if (original) await http.put(api('/admin/settings/social')).set(bearer(admin)).send(original);
    await app.close();
  });

  it('only platform staff can change links', async () => {
    await http.put(api('/admin/settings/social')).set(bearer(customer)).send({ links: {}, promo_enabled: false }).expect(403);
    await http.get(api('/admin/settings/social')).set(bearer(customer)).expect(403);
  });

  it('rejects non-https and links to the wrong site', async () => {
    await http.put(api('/admin/settings/social')).set(bearer(admin)).send({ links: { instagram: 'http://instagram.com/x' }, promo_enabled: true }).expect(422);
    const wrong = await http.put(api('/admin/settings/social')).set(bearer(admin)).send({ links: { instagram: 'https://evil.example/x' }, promo_enabled: true }).expect(422);
    expect(wrong.body.error.details).toMatchObject({ field: 'links.instagram', reason: 'SOCIAL_HOST' });
  });

  it('saves links; anyone (even anonymous) reads them', async () => {
    await http
      .put(api('/admin/settings/social'))
      .set(bearer(admin))
      .send({ links: { instagram: 'https://www.instagram.com/zonup.uz', telegram: 'https://t.me/zonup_uz', tiktok: '' }, promo_enabled: true })
      .expect(200);
    const pub = await http.get(api('/social')).expect(200);
    expect(pub.body.data).toEqual({ links: { instagram: 'https://www.instagram.com/zonup.uz', telegram: 'https://t.me/zonup_uz' }, promo_enabled: true });
  });

  it('promo is off when there are no links', async () => {
    const r = await http.put(api('/admin/settings/social')).set(bearer(admin)).send({ links: {}, promo_enabled: true }).expect(200);
    expect(r.body.data).toEqual({ links: {}, promo_enabled: false });
  });
});
