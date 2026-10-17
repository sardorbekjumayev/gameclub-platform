import { PrismaService } from '../src/database/prisma.service';
import { Harness, api, bearer } from './utils/harness';

/**
 * Platforma sozlamalari: super admin GET/PATCH (oq ro'yxat, audit), texnik xizmat rejimi
 * (PLATFORM va @AllowDuringMaintenance'dan boshqa hamma bloklanadi) va mobil majburiy yangilanish.
 */
describe('Platform settings, maintenance & min-version (e2e)', () => {
  const h = new Harness();
  let prisma: PrismaService;
  let customer: string;
  const TOUCHED = ['maintenance_mode', 'app.min_version.android', 'app.min_version.ios', 'commission.default_bps'];
  const original = new Map<string, unknown>();

  beforeAll(async () => {
    await h.start();
    prisma = h.get<PrismaService>(PrismaService);
    const rows = await prisma.platform_settings.findMany({ where: { key: { in: TOUCHED } } });
    for (const r of rows) original.set(r.key, r.value);
    customer = (await h.customer()).token;
  });

  // Keyingi e2e spec'larga ta'sir qilmasligi uchun sozlamalarni aniq tiklaymiz (ayniqsa maintenance_mode!)
  afterAll(async () => {
    for (const key of TOUCHED) {
      if (original.has(key)) await prisma.platform_settings.update({ where: { key }, data: { value: original.get(key) as object } }).catch(() => undefined);
      else await prisma.platform_settings.deleteMany({ where: { key } });
    }
    await h.stop();
  });

  it('GET requires platform.settings.manage (admin 200, customer 403, anon 401)', async () => {
    const r = await h.http.get(api('/admin/settings')).set(bearer(h.admin)).expect(200);
    expect(r.body.data).toMatchObject({ maintenance_mode: expect.any(Boolean), 'commission.default_bps': expect.any(Number) });
    await h.http.get(api('/admin/settings')).set(bearer(customer)).expect(403);
    await h.http.get(api('/admin/settings')).expect(401);
  });

  it('PATCH validates and persists whitelisted keys, writes audit', async () => {
    await h.http.patch(api('/admin/settings')).set(bearer(h.admin)).send({}).expect(422); // bo'sh
    await h.http.patch(api('/admin/settings')).set(bearer(h.admin)).send({ min_version_android: '1.2' }).expect(422); // semver emas
    await h.http.patch(api('/admin/settings')).set(bearer(h.admin)).send({ commission_default_bps: 20000 }).expect(422); // chegaradan tashqari
    await h.http.patch(api('/admin/settings')).set(bearer(h.admin)).send({ unknown_key: 1 }).expect(422); // oq ro'yxatda yo'q
    await h.http.patch(api('/admin/settings')).set(bearer(customer)).send({ maintenance_mode: true }).expect(403);

    const since = new Date();
    const r = await h.http.patch(api('/admin/settings')).set(bearer(h.admin)).send({ commission_default_bps: 750, min_version_android: '1.4.0' }).expect(200);
    expect(r.body.data['commission.default_bps']).toBe(750);
    expect(r.body.data['app.min_version.android']).toBe('1.4.0');
    const audit = await prisma.audit_logs.findFirst({ where: { action: 'admin.settings.update', at: { gte: new Date(since.getTime() - 1000) } }, orderBy: { at: 'desc' } });
    expect(audit!.new_value).toMatchObject({ 'commission.default_bps': 750, 'app.min_version.android': '1.4.0' });
  });

  it('min-version: old mobile build gets 426, current/absent passes', async () => {
    await h.http.patch(api('/admin/settings')).set(bearer(h.admin)).send({ min_version_android: '2.0.0', min_version_ios: '2.0.0' }).expect(200);
    const old = await h.http.get(api('/users/me')).set(bearer(customer)).set('X-App-Platform', 'android').set('X-App-Version', '1.9.9').expect(426);
    expect(old.body.error.code).toBe('APP_UPDATE_REQUIRED');
    expect(old.body.error.details).toMatchObject({ platform: 'android', min_version: '2.0.0' });
    // Joriy versiya — o'tadi
    await h.http.get(api('/users/me')).set(bearer(customer)).set('X-App-Platform', 'android').set('X-App-Version', '2.0.0').expect(200);
    // Sarlavhasiz (web/admin) — o'tadi
    await h.http.get(api('/users/me')).set(bearer(customer)).expect(200);
    // Noto'g'ri formatli versiya — bloklamaydi
    await h.http.get(api('/users/me')).set(bearer(customer)).set('X-App-Platform', 'android').set('X-App-Version', 'dev').expect(200);
  });

  it('maintenance mode blocks non-platform users; platform, health & auth stay open', async () => {
    await h.http.patch(api('/admin/settings')).set(bearer(h.admin)).send({ maintenance_mode: true }).expect(200);
    try {
      const blocked = await h.http.get(api('/users/me')).set(bearer(customer)).expect(503);
      expect(blocked.body.error.code).toBe('MAINTENANCE_MODE');
      await h.http.get(api('/admin/settings')).set(bearer(h.admin)).expect(200); // PLATFORM xodim ishlaydi
      await h.http.get(api('/health')).expect(200); // @AllowDuringMaintenance
      await h.http.post(api('/auth/send-otp')).set('X-Forwarded-For', '203.0.113.9').send({ phone: '+998901112233', purpose: 'LOGIN' }).expect(200); // kirish ochiq
    } finally {
      await h.http.patch(api('/admin/settings')).set(bearer(h.admin)).send({ maintenance_mode: false }).expect(200);
    }
    await h.http.get(api('/users/me')).set(bearer(customer)).expect(200); // tiklandi
  });
});
