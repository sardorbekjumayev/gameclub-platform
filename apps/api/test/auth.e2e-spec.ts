import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { REDIS } from '../src/infra/redis/redis.module';

describe('Auth & RBAC (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const phone = `+99890${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    const redis = app.get<Redis>(REDIS);
    const keys = await redis.keys('login:*');
    if (keys.length) await redis.del(...keys);
    const ipKeys = await redis.keys('otp:ip:*');
    if (ipKeys.length) await redis.del(...ipKeys);
  });

  afterAll(() => app.close());

  const otpLogin = async () => {
    await http.post('/api/v1/auth/send-otp').send({ phone, purpose: 'LOGIN' });
    const res = await http.post('/api/v1/auth/verify-otp').send({ phone, code: '000000' }).expect(200);
    return res.body.data;
  };

  it('rejects non-UZ phone and bad payload with VALIDATION_ERROR', async () => {
    const res = await http.post('/api/v1/auth/send-otp').send({ phone: '+15551234567', purpose: 'LOGIN' }).expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('OTP: wrong code -> OTP_INVALID; correct -> creates customer', async () => {
    await http.post('/api/v1/auth/send-otp').send({ phone, purpose: 'LOGIN' }).expect(200);
    const bad = await http.post('/api/v1/auth/verify-otp').send({ phone, code: '123456' }).expect(400);
    expect(bad.body.error.code).toBe('OTP_INVALID');

    const ok = await http.post('/api/v1/auth/verify-otp').send({ phone, code: '000000' }).expect(200);
    expect(ok.body.data.is_new).toBe(true);
    expect(ok.body.data.user.type).toBe('CUSTOMER');
    expect(ok.body.data.user.roles[0].role).toBe('CUSTOMER');
    expect(ok.body.data.user).not.toHaveProperty('password_hash');

    // resend cooldown
    const again = await http.post('/api/v1/auth/send-otp').send({ phone, purpose: 'LOGIN' }).expect(429);
    expect(again.body.error.code).toBe('RATE_LIMITED');
  });

  it('/auth/me requires token; customer cannot access admin endpoints', async () => {
    await http.get('/api/v1/auth/me').expect(401);
    const redis = app.get<Redis>(REDIS);
    await redis.del(`otp:cooldown:${phone}`);
    const { access_token } = await otpLogin();
    const me = await http.get('/api/v1/auth/me').set('Authorization', `Bearer ${access_token}`).expect(200);
    expect(me.body.data.phone).toBe(phone);
    const forbidden = await http.get('/api/v1/admin/users').set('Authorization', `Bearer ${access_token}`).expect(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
  });

  it('refresh rotation; reusing old token revokes whole family', async () => {
    const redis = app.get<Redis>(REDIS);
    await redis.del(`otp:cooldown:${phone}`);
    const first = await otpLogin();
    const r1 = await http.post('/api/v1/auth/refresh').send({ refresh_token: first.refresh_token }).expect(200);
    const second = r1.body.data;
    expect(second.refresh_token).not.toBe(first.refresh_token);

    // eski tokenni qayta ishlatish -> reuse
    await http.post('/api/v1/auth/refresh').send({ refresh_token: first.refresh_token }).expect(401);
    // butun oila bekor: yangi token ham ishlamaydi
    await http.post('/api/v1/auth/refresh').send({ refresh_token: second.refresh_token }).expect(401);
  });

  it('super admin logs in with password and lists users', async () => {
    const bad = await http.post('/api/v1/auth/login').send({ login: process.env.SUPER_ADMIN_EMAIL, password: 'wrong-pass' }).expect(401);
    expect(bad.body.error.code).toBe('UNAUTHORIZED');
    const res = await http
      .post('/api/v1/auth/login')
      .send({ login: process.env.SUPER_ADMIN_EMAIL, password: process.env.SUPER_ADMIN_PASSWORD })
      .expect(200);
    const token = res.body.data.access_token;
    expect(res.body.data.user.permissions).toContain('platform.users.view');
    const list = await http.get('/api/v1/admin/users?limit=5').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.meta.limit).toBe(5);
    expect(list.body.data.length).toBeGreaterThan(0);
  });
});
