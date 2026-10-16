import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { REDIS } from '../src/infra/redis/redis.module';

/** zonup.uz → "Klub ochish" formasi: akkauntsiz ariza → super admin bildirishnoma oladi va panelda ko'radi. */
describe('Club applications (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const api = (p: string) => `/api/v1${p}`;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const rnd = () => `${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  let admin: string;
  let customer: string;
  const phone = `+99893${rnd()}`;
  const clubName = `Arena ${rnd()}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    http = request(app.getHttpServer());
    const redis = app.get<Redis>(REDIS);
    for (const pattern of ['login:*', 'otp:ip:*', 'rl:*']) {
      const keys = await redis.keys(pattern);
      if (keys.length) await redis.del(...keys);
    }
    admin = (await http.post(api('/auth/login')).send({ login: process.env.SUPER_ADMIN_EMAIL, password: process.env.SUPER_ADMIN_PASSWORD }).expect(200)).body.data.access_token;
    const cphone = `+99890${rnd()}`;
    await redis.del(`otp:cooldown:${cphone}`);
    await http.post(api('/auth/send-otp')).send({ phone: cphone, purpose: 'LOGIN' }).expect(200);
    customer = (await http.post(api('/auth/verify-otp')).send({ phone: cphone, code: '000000' }).expect(200)).body.data.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  const form = () => ({ full_name: '  Aziz Karimov ', phone, club_name: clubName, city: 'Toshkent', devices_count: 25, telegram: '', comment: 'Ertaga qo\'ng\'iroq qiling' });
  let id: string;

  it('validates the form', async () => {
    await http.post(api('/club-applications')).send({ ...form(), phone: '901234567' }).expect(422);
    await http.post(api('/club-applications')).send({ ...form(), club_name: '' }).expect(422);
    await http.post(api('/club-applications')).send({ ...form(), devices_count: 0 }).expect(422);
  });

  it('anyone can apply without an account; repeated submit does not duplicate', async () => {
    const r = await http.post(api('/club-applications')).send(form()).expect(201);
    expect(r.body.data).toEqual({ id: expect.any(String), status: 'NEW' });
    id = r.body.data.id;
    const again = await http.post(api('/club-applications')).send(form()).expect(201);
    expect(again.body.data.id).toBe(id);
  });

  it('super admin is notified', async () => {
    const r = await http.get(api('/notifications?limit=50')).set(bearer(admin)).expect(200);
    const n = (r.body.data as { type: string; data: { club_application_id?: string } }[]).filter((x) => x.type === 'CLUB_APPLICATION_NEW' && x.data?.club_application_id === id);
    expect(n).toHaveLength(1);
  });

  it('only platform staff can see applications', async () => {
    await http.get(api('/admin/club-applications')).expect(401);
    await http.get(api('/admin/club-applications')).set(bearer(customer)).expect(403);
    await http.get(api(`/admin/club-applications/${id}`)).set(bearer(customer)).expect(403);
    await http.patch(api(`/admin/club-applications/${id}`)).set(bearer(customer)).send({ status: 'APPROVED' }).expect(403);
  });

  it('super admin lists, searches and opens an application', async () => {
    const stats = await http.get(api('/admin/club-applications/stats')).set(bearer(admin)).expect(200);
    expect(stats.body.data.new).toBeGreaterThanOrEqual(1);
    const list = await http.get(api(`/admin/club-applications?status=NEW&q=${encodeURIComponent(clubName)}`)).set(bearer(admin)).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ id, full_name: 'Aziz Karimov', phone, city: 'Toshkent', devices_count: 25, telegram: null });
    const byPhone = await http.get(api(`/admin/club-applications?q=${encodeURIComponent(phone)}`)).set(bearer(admin)).expect(200);
    expect(byPhone.body.data.map((x: { id: string }) => x.id)).toContain(id);
    await http.get(api(`/admin/club-applications/${id}`)).set(bearer(admin)).expect(200);
  });

  it('super admin changes status and note (audited); a new application can follow a closed one', async () => {
    const r = await http.patch(api(`/admin/club-applications/${id}`)).set(bearer(admin)).send({ status: 'CONTACTED', admin_note: 'Qo\'ng\'iroq qilindi' }).expect(200);
    expect(r.body.data).toMatchObject({ status: 'CONTACTED', admin_note: 'Qo\'ng\'iroq qilindi', handled_at: expect.any(String) });
    expect(r.body.data.handler).toBeTruthy();
    await http.patch(api(`/admin/club-applications/${id}`)).set(bearer(admin)).send({ status: 'DONE' }).expect(422);
    await http.patch(api(`/admin/club-applications/${id}`)).set(bearer(admin)).send({ status: 'REJECTED' }).expect(200);
    const next = await http.post(api('/club-applications')).send(form()).expect(201);
    expect(next.body.data.id).not.toBe(id);
  });
});
