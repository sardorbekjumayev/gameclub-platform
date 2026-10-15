import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../src/database/prisma.service';
import { api, bearer, Harness, rndPhone } from './utils/harness';
import { newClub, newCustomer } from './utils/flows';

/**
 * Autentifikatsiya chuqur (docs/01-API.md §4): refresh rotation va reuse (oilalar alohida), logout / logout-all,
 * sessiyalar ro'yxati va bekor qilish, parol, OTP urinishlar va limitlar, login brute-force, profil (PATCH /users/me).
 * auth.e2e-spec.ts dagi asosiy holatlar takrorlanmaydi.
 */
describe('Auth sessions, OTP limits & profile (e2e)', () => {
  const h = new Harness();
  let prisma: PrismaService;
  const fakeIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(1 + Math.random() * 250)}`;

  /** Bitta telefon bilan yangi qurilmadan login (alohida refresh oilasi). */
  const login = async (phone: string, device: Record<string, unknown> = { platform: 'android' }) => {
    await h.redis.del(`otp:cooldown:${phone}`);
    const ip = fakeIp();
    await h.http.post(api('/auth/send-otp')).set('X-Forwarded-For', ip).send({ phone, purpose: 'LOGIN' }).expect(200);
    const r = await h.http.post(api('/auth/verify-otp')).set('X-Forwarded-For', ip).send({ phone, code: '000000', device }).expect(200);
    return r.body.data as { access_token: string; refresh_token: string; session_id: string; user: Record<string, unknown> };
  };
  const refresh = (token: string) => h.http.post(api('/auth/refresh')).send({ refresh_token: token });

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
  }, 60_000);

  afterAll(() => h.stop());

  describe('OTP', () => {
    it('send-otp never returns the code; verify response has no secrets', async () => {
      const phone = rndPhone();
      const s = await h.http.post(api('/auth/send-otp')).set('X-Forwarded-For', fakeIp()).send({ phone, purpose: 'LOGIN' }).expect(200);
      expect(s.body.data).toMatchObject({ channel: 'DEV', delivered: true, expires_in: 120, resend_in: 60 });
      expect(JSON.stringify(s.body)).not.toContain('000000');
      expect(s.body.data).not.toHaveProperty('code');
      const raw = await h.redis.get(`otp:code:${phone}`);
      expect(raw).not.toContain('000000'); // Redis'da faqat hash
      const v = await h.http.post(api('/auth/verify-otp')).send({ phone, code: '000000' }).expect(200);
      expect(v.body.data.user).not.toHaveProperty('password_hash');
      expect(v.body.data.refresh_token).toMatch(/^[\w-]{20,}$/);
      const row = await prisma.refresh_tokens.findUniqueOrThrow({ where: { id: v.body.data.session_id } });
      expect(row.token_hash).not.toBe(v.body.data.refresh_token); // DB'da hash
      // Kod bir martalik
      expect((await h.http.post(api('/auth/verify-otp')).send({ phone, code: '000000' }).expect(400)).body.error.code).toBe('OTP_EXPIRED');
    });

    it('wrong code: attempts_left counts down; after 5 wrong attempts even the right code is rejected', async () => {
      const phone = rndPhone();
      await h.http.post(api('/auth/send-otp')).set('X-Forwarded-For', fakeIp()).send({ phone, purpose: 'LOGIN' }).expect(200);
      for (let left = 4; left >= 0; left--) {
        const r = await h.http.post(api('/auth/verify-otp')).send({ phone, code: '111111' }).expect(400);
        expect(r.body.error).toMatchObject({ code: 'OTP_INVALID', details: { attempts_left: left } });
      }
      const blocked = await h.http.post(api('/auth/verify-otp')).send({ phone, code: '000000' });
      expect(blocked.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
      expect(blocked.status).toBeGreaterThanOrEqual(400);
      // Kod o'chirildi — yangi kod so'rash kerak
      expect((await h.http.post(api('/auth/verify-otp')).send({ phone, code: '000000' })).body.error.code).toBe('OTP_EXPIRED');
      expect(await prisma.users.findUnique({ where: { phone } })).toBeNull();
    });

    it('verify without a sent code → OTP_EXPIRED; malformed code → 422', async () => {
      const phone = rndPhone();
      expect((await h.http.post(api('/auth/verify-otp')).send({ phone, code: '000000' }).expect(400)).body.error.code).toBe('OTP_EXPIRED');
      await h.http.post(api('/auth/verify-otp')).send({ phone, code: '12345' }).expect(422);
      await h.http.post(api('/auth/verify-otp')).send({ phone, code: 'abcdef' }).expect(422);
      await h.http.post(api('/auth/send-otp')).send({ phone, purpose: 'HACK' }).expect(422);
    });

    it('resend cooldown returns retry_after; daily limit per phone', async () => {
      const phone = rndPhone();
      await h.http.post(api('/auth/send-otp')).set('X-Forwarded-For', fakeIp()).send({ phone, purpose: 'LOGIN' }).expect(200);
      const again = await h.http.post(api('/auth/send-otp')).set('X-Forwarded-For', fakeIp()).send({ phone, purpose: 'LOGIN' }).expect(429);
      expect(again.body.error.details.retry_after).toBeGreaterThan(0);
      expect(again.body.error.details.retry_after).toBeLessThanOrEqual(60);

      await h.redis.del(`otp:cooldown:${phone}`);
      await h.redis.set(`otp:daily:${phone}`, '10', 'EX', 600);
      const daily = await h.http.post(api('/auth/send-otp')).set('X-Forwarded-For', fakeIp()).send({ phone, purpose: 'LOGIN' }).expect(429);
      expect(daily.body.error.code).toBe('RATE_LIMITED');
      await h.redis.del(`otp:daily:${phone}`);
    });

    it('per-IP hourly limit (10) across different phones', async () => {
      // Parallel e2e jarayonlar (harness.start) `otp:ip:*` ni tozalashi mumkin — shunda qayta urinamiz
      let ip = '';
      let r: { status: number; body: { error: { code: string } } } | undefined;
      for (let round = 0; round < 3 && r?.status !== 429; round++) {
        ip = fakeIp();
        for (let i = 0; i < 10; i++) await h.http.post(api('/auth/send-otp')).set('X-Forwarded-For', ip).send({ phone: rndPhone(), purpose: 'LOGIN' }).expect(200);
        r = await h.http.post(api('/auth/send-otp')).set('X-Forwarded-For', ip).send({ phone: rndPhone(), purpose: 'LOGIN' });
      }
      expect(r!.status).toBe(429);
      expect(r!.body.error.code).toBe('RATE_LIMITED');
      // Boshqa IP ta'sirlanmaydi
      await h.http.post(api('/auth/send-otp')).set('X-Forwarded-For', fakeIp()).send({ phone: rndPhone(), purpose: 'LOGIN' }).expect(200);
      await h.redis.del(`otp:ip:${ip}`);
    });
  });

  describe('refresh tokens & sessions', () => {
    let phone: string;

    beforeAll(() => {
      phone = rndPhone();
    });

    it('rotation issues a working access token; reuse in one family does not kill other devices', async () => {
      const phoneDev = await login(phone, { platform: 'android', model: 'Pixel' });
      const laptop = await login(phone, { platform: 'web' });

      const r1 = await refresh(phoneDev.refresh_token).expect(200);
      expect(r1.body.data.refresh_token).not.toBe(phoneDev.refresh_token);
      expect(r1.body.data.session_id).not.toBe(phoneDev.session_id);
      await h.http.get(api('/auth/me')).set(bearer(r1.body.data.access_token)).expect(200);
      const rows = await prisma.refresh_tokens.findMany({ where: { id: { in: [phoneDev.session_id, r1.body.data.session_id] } } });
      expect(new Set(rows.map((r) => r.family_id)).size).toBe(1);
      expect(rows.find((r) => r.id === phoneDev.session_id)?.replaced_by_id).toBe(r1.body.data.session_id);

      // Eski token qayta ishlatildi → shu oila bekor, reuse_detected_at qo'yiladi
      const reuse = await refresh(phoneDev.refresh_token).expect(401);
      expect(reuse.body.error.code).toBe('UNAUTHORIZED');
      await refresh(r1.body.data.refresh_token).expect(401);
      const fam = await prisma.refresh_tokens.findUniqueOrThrow({ where: { id: r1.body.data.session_id } });
      expect(fam.reuse_detected_at).toBeTruthy();

      // Boshqa qurilma (boshqa oila) ishlashda davom etadi
      await refresh(laptop.refresh_token).expect(200);
    });

    it('parallel refresh with the same token: exactly one wins', async () => {
      const s = await login(phone);
      const res = await Promise.all([refresh(s.refresh_token), refresh(s.refresh_token), refresh(s.refresh_token)]);
      expect(res.filter((r) => r.status === 200)).toHaveLength(1);
      expect(res.filter((r) => r.status === 401)).toHaveLength(2);
    });

    it('refresh validation & garbage tokens', async () => {
      await refresh('short').expect(422);
      expect((await refresh('x'.repeat(40)).expect(401)).body.error.code).toBe('UNAUTHORIZED');
    });

    it('sessions list shows only own active sessions without secrets; revoke one', async () => {
      const other = rndPhone();
      const a = await login(other, { platform: 'ios', model: 'iPhone' });
      const b = await login(other, { platform: 'web' });
      const list = await h.http.get(api('/auth/sessions')).set(bearer(a.access_token)).expect(200);
      const ids = list.body.data.map((s: { id: string }) => s.id);
      expect(ids).toEqual(expect.arrayContaining([a.session_id, b.session_id]));
      expect(ids).toHaveLength(2);
      for (const s of list.body.data) {
        expect(s).not.toHaveProperty('token_hash');
        expect(s).not.toHaveProperty('refresh_token');
        expect(s).toHaveProperty('device_info');
      }
      expect(list.body.data.find((s: { id: string }) => s.id === a.session_id).device_info).toMatchObject({ platform: 'ios', model: 'iPhone' });

      // Boshqa foydalanuvchi sessiyasini bekor qilib bo'lmaydi
      const stranger = await login(rndPhone());
      await h.http.delete(api(`/auth/sessions/${b.session_id}`)).set(bearer(stranger.access_token)).expect(404);
      await refresh(b.refresh_token).expect(200).then(async (r) => {
        b.refresh_token = r.body.data.refresh_token;
        b.session_id = r.body.data.session_id;
      });

      await h.http.delete(api(`/auth/sessions/${b.session_id}`)).set(bearer(a.access_token)).expect(200);
      await refresh(b.refresh_token).expect(401);
      await h.http.delete(api(`/auth/sessions/${b.session_id}`)).set(bearer(a.access_token)).expect(404);
      const after = await h.http.get(api('/auth/sessions')).set(bearer(a.access_token)).expect(200);
      expect(after.body.data.map((s: { id: string }) => s.id)).toEqual([a.session_id]);
      await refresh(a.refresh_token).expect(200);
    });

    it("logout revokes the given refresh token only for its owner", async () => {
      const p = rndPhone();
      const a = await login(p);
      const stranger = await login(rndPhone());
      // Begona refresh token bilan logout — ta'sir qilmaydi
      await h.http.post(api('/auth/logout')).set(bearer(stranger.access_token)).send({ refresh_token: a.refresh_token }).expect(200);
      const r = await refresh(a.refresh_token).expect(200);
      await h.http.post(api('/auth/logout')).set(bearer(a.access_token)).send({ refresh_token: r.body.data.refresh_token }).expect(200);
      await refresh(r.body.data.refresh_token).expect(401);
      await h.http.post(api('/auth/logout')).send({ refresh_token: r.body.data.refresh_token }).expect(401);
    });

    it('logout-all revokes every session of the user', async () => {
      const p = rndPhone();
      const a = await login(p);
      const b = await login(p);
      const c = await login(p);
      await h.http.post(api('/auth/logout-all')).set(bearer(a.access_token)).expect(200);
      for (const s of [a, b, c]) await refresh(s.refresh_token).expect(401);
      expect((await h.http.get(api('/auth/sessions')).set(bearer(a.access_token)).expect(200)).body.data).toEqual([]);
    });

    it('expired / forged access tokens are rejected; refresh token is not a bearer token', async () => {
      const jwt = h.get<JwtService>(JwtService);
      const s = await login(rndPhone());
      const me = await h.http.get(api('/auth/me')).set(bearer(s.access_token)).expect(200);
      const expired = await jwt.signAsync({ sub: me.body.data.id, type: 'CUSTOMER', jti: 'x' }, { expiresIn: -10 });
      expect((await h.http.get(api('/auth/me')).set(bearer(expired)).expect(401)).body.error.code).toBe('TOKEN_EXPIRED');
      const forged = new JwtService({ secret: 'not-the-real-secret' }).sign({ sub: me.body.data.id, type: 'PLATFORM', jti: 'y' });
      expect((await h.http.get(api('/auth/me')).set(bearer(forged)).expect(401)).body.error.code).toBe('UNAUTHORIZED');
      await h.http.get(api('/auth/me')).set(bearer(s.refresh_token)).expect(401);
    });

    it('blocked user cannot refresh or log in', async () => {
      const p = rndPhone();
      const s = await login(p);
      await prisma.users.update({ where: { phone: p }, data: { status: 'BLOCKED' } });
      expect((await refresh(s.refresh_token).expect(403)).body.error.code).toBe('FORBIDDEN');
      await h.redis.del(`otp:cooldown:${p}`);
      await h.http.post(api('/auth/send-otp')).set('X-Forwarded-For', fakeIp()).send({ phone: p, purpose: 'LOGIN' }).expect(200);
      expect((await h.http.post(api('/auth/verify-otp')).send({ phone: p, code: '000000' }).expect(403)).body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('password', () => {
    it('set/change password: policy, login by phone, old password stops working, never echoed', async () => {
      const p = rndPhone();
      const s = await login(p);
      expect((await h.http.get(api('/auth/me')).set(bearer(s.access_token)).expect(200)).body.data.has_password).toBe(false);
      await h.http.post(api('/auth/password')).set(bearer(s.access_token)).send({ password: 'short' }).expect(422);
      const weak = await h.http.post(api('/auth/password')).set(bearer(s.access_token)).send({ password: 'Password1' }).expect(422);
      expect(weak.body.error.code).toBe('VALIDATION_ERROR');
      await h.http.post(api('/auth/password')).send({ password: 'Uzun#Parol2026' }).expect(401);

      const set = await h.http.post(api('/auth/password')).set(bearer(s.access_token)).send({ password: 'Uzun#Parol2026' }).expect(200);
      expect(JSON.stringify(set.body)).not.toContain('Uzun#Parol2026');
      const me = await h.http.get(api('/auth/me')).set(bearer(s.access_token)).expect(200);
      expect(me.body.data.has_password).toBe(true);
      expect(me.body.data).not.toHaveProperty('password_hash');
      const hash = (await prisma.users.findUniqueOrThrow({ where: { phone: p } })).password_hash!;
      expect(hash.startsWith('$argon2id$')).toBe(true);

      const ok = await h.http.post(api('/auth/login')).send({ login: p, password: 'Uzun#Parol2026' }).expect(200);
      expect(ok.body.data.user).not.toHaveProperty('password_hash');
      await h.http.post(api('/auth/password')).set(bearer(s.access_token)).send({ password: 'Yangi#Parol2027' }).expect(200);
      await h.http.post(api('/auth/login')).send({ login: p, password: 'Uzun#Parol2026' }).expect(401);
      await h.http.post(api('/auth/login')).send({ login: p, password: 'Yangi#Parol2027' }).expect(200);
    });

    it('login brute-force: 10 attempts per ip+login, then RATE_LIMITED even with the right password; failures audited', async () => {
      const p = rndPhone();
      const s = await login(p);
      await h.http.post(api('/auth/password')).set(bearer(s.access_token)).send({ password: 'Kuchli#Parol2026' }).expect(200);
      // Boshqa parallel e2e jarayonlar `login:*` kalitlarini tozalashi mumkin — ketma-ketlik shunda qayta boshlanadi
      let ip = '';
      let limited: { status: number; body: { error: { code: string } } } | undefined;
      for (let round = 0; round < 3 && limited?.status !== 429; round++) {
        ip = fakeIp();
        for (let i = 0; i < 10; i++) {
          const r = await h.http.post(api('/auth/login')).set('X-Forwarded-For', ip).send({ login: p, password: `wrong-${i}` }).expect(401);
          expect(r.body.error.code).toBe('UNAUTHORIZED');
        }
        limited = await h.http.post(api('/auth/login')).set('X-Forwarded-For', ip).send({ login: p, password: 'Kuchli#Parol2026' });
      }
      expect(limited!.status).toBe(429);
      expect(limited!.body.error.code).toBe('RATE_LIMITED');
      // Boshqa IP'dan to'g'ri parol ishlaydi (kalit ip+login)
      await h.http.post(api('/auth/login')).set('X-Forwarded-For', fakeIp()).send({ login: p, password: 'Kuchli#Parol2026' }).expect(200);
      const user = await prisma.users.findUniqueOrThrow({ where: { phone: p } });
      expect(await prisma.audit_logs.count({ where: { action: 'auth.login_failed', target_id: user.id } })).toBeGreaterThanOrEqual(10);
      await h.redis.del(`login:${ip}:${p}`);
    });

    it('unknown login and wrong password give the same error', async () => {
      const a = await h.http.post(api('/auth/login')).set('X-Forwarded-For', fakeIp()).send({ login: `nobody-${Date.now()}@example.com`, password: 'whatever1' }).expect(401);
      const b = await h.http.post(api('/auth/login')).set('X-Forwarded-For', fakeIp()).send({ login: process.env.SUPER_ADMIN_EMAIL, password: 'whatever1' }).expect(401);
      expect(a.body.error.code).toBe(b.body.error.code);
      expect(a.body.message).toBe(b.body.message);
    });
  });

  describe('profile (users/me)', () => {
    it('PATCH updates allowed fields only; email normalized and unique (case-insensitive)', async () => {
      const a = await newCustomer(h);
      const b = await newCustomer(h);
      const email = `E2E.${Date.now()}@Example.com`;
      const u = await h.http.patch(api('/users/me')).set(bearer(a.token)).send({ first_name: 'Ali', last_name: 'Valiyev', language: 'ru', email }).expect(200);
      expect(u.body.data).toMatchObject({ first_name: 'Ali', last_name: 'Valiyev', language: 'ru', email: email.toLowerCase(), phone: a.phone });
      expect(u.body.data).not.toHaveProperty('password_hash');
      const me = await h.http.get(api('/users/me')).set(bearer(a.token)).expect(200);
      expect(me.body.data.email).toBe(email.toLowerCase());

      await h.http.patch(api('/users/me')).set(bearer(a.token)).send({ language: 'de' }).expect(422);
      await h.http.patch(api('/users/me')).set(bearer(a.token)).send({ email: 'not-an-email' }).expect(422);
      await h.http.patch(api('/users/me')).set(bearer(a.token)).send({ type: 'PLATFORM' }).expect(422);
      await h.http.patch(api('/users/me')).set(bearer(a.token)).send({ status: 'ACTIVE', phone: '+998901111111' }).expect(422);

      const dup = await h.http.patch(api('/users/me')).set(bearer(b.token)).send({ email: email.toLowerCase() }).expect(409);
      expect(dup.body.error.code).toBe('CONFLICT');
      const dupCase = await h.http.patch(api('/users/me')).set(bearer(b.token)).send({ email: email.toUpperCase() }).expect(409);
      expect(dupCase.body.error.code).toBe('CONFLICT');
      // O'z email'ini qayta yozish — mumkin
      await h.http.patch(api('/users/me')).set(bearer(a.token)).send({ email: email.toUpperCase() }).expect(200);
      const cleared = await h.http.patch(api('/users/me')).set(bearer(a.token)).send({ email: null }).expect(200);
      expect(cleared.body.data.email).toBeNull();
      await h.http.patch(api('/users/me')).send({ first_name: 'X' }).expect(401);
    });
  });

  describe('admin/users', () => {
    it('requires platform.users.view; never exposes password hashes', async () => {
      const c = await newCustomer(h);
      const club = await newClub(h, { devices: 0, pricePerHour: null, approve: false });
      await h.http.get(api('/admin/users')).set(bearer(c.token)).expect(403);
      await h.http.get(api('/admin/users')).set(bearer(club.owner)).expect(403);
      await h.http.get(api('/admin/users')).expect(401);
      const r = await h.http.get(api(`/admin/users?q=${encodeURIComponent(c.phone)}`)).set(bearer(h.admin)).expect(200);
      expect(r.body.data).toHaveLength(1);
      expect(r.body.data[0]).toMatchObject({ phone: c.phone, type: 'CUSTOMER' });
      expect(r.body.data[0]).not.toHaveProperty('password_hash');
      const typed = await h.http.get(api('/admin/users?type=PLATFORM&limit=100')).set(bearer(h.admin)).expect(200);
      expect(typed.body.data.every((u: { type: string }) => u.type === 'PLATFORM')).toBe(true);
      await h.http.get(api('/admin/users?limit=500')).set(bearer(h.admin)).expect(422);
    });
  });
});
