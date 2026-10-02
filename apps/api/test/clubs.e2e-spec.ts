import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { REDIS } from '../src/infra/redis/redis.module';

/** Phase 2 acceptance: owner klub ochadi, filiallar, xodim biriktiradi; boshqa klub ma'lumotini ko'ra olmaydi. */
describe('Clubs & Branches (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const rnd = () => `+99890${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const api = (p: string) => `/api/v1${p}`;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let ownerA: string;
  let ownerB: string;
  let clubA: string;
  let clubB: string;
  let branchA1: string;
  let branchA2: string;

  const otpLogin = async (phone: string) => {
    await app.get<Redis>(REDIS).del(`otp:cooldown:${phone}`);
    await http.post(api('/auth/send-otp')).send({ phone, purpose: 'LOGIN' }).expect(200);
    const res = await http.post(api('/auth/verify-otp')).send({ phone, code: '000000' }).expect(200);
    return res.body.data.access_token as string;
  };

  const refresh = async (phone: string) => otpLogin(phone);

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
  });

  // Dev bazada test klublari ommaviy katalogda qolmasin — yopib qo'yamiz
  afterAll(async () => {
    for (const id of [clubA, clubB].filter(Boolean)) {
      await http.post(api(`/admin/clubs/${id}/close`)).set(bearer(admin)).send({ reason: 'e2e cleanup' });
    }
    await app.close();
  });

  const phoneA = rnd();
  const phoneB = rnd();

  it('owner creates club (DRAFT), adds branches, submits; super admin approves', async () => {
    ownerA = await otpLogin(phoneA);
    const c = await http.post(api('/clubs')).set(bearer(ownerA)).send({ name: `E2E Club A ${Date.now()}`, phone: phoneA, owner_password: 'StrongPass#2026' }).expect(201);
    clubA = c.body.data.id;
    expect(c.body.data.status).toBe('DRAFT');
    ownerA = await refresh(phoneA); // yangi CLUB_OWNER grant tokenga emas, keshga bog'liq — baribir yangilaymiz

    // Filialsiz yuborib bo'lmaydi
    const incomplete = await http.post(api(`/clubs/${clubA}/submit`)).set(bearer(ownerA)).expect(422);
    expect(incomplete.body.error.code).toBe('VALIDATION_ERROR');

    const b1 = await http.post(api(`/clubs/${clubA}/branches`)).set(bearer(ownerA)).send({ name: 'Chilonzor', address: 'Toshkent, Chilonzor 1', latitude: 41.28, longitude: 69.2 }).expect(201);
    branchA1 = b1.body.data.id;
    const b2 = await http.post(api(`/clubs/${clubA}/branches`)).set(bearer(ownerA)).send({ name: 'Yunusobod', address: 'Toshkent, Yunusobod 4', latitude: 41.36, longitude: 69.28 });
    // Tarif rejasi bitta filialga cheklagan bo'lishi mumkin
    if (b2.status === 201) branchA2 = b2.body.data.id;
    else expect(b2.body.error.code).toBe('PLAN_LIMIT_REACHED');

    await http.post(api(`/branches/${branchA1}/rooms`)).set(bearer(ownerA)).send({ name: 'VIP', type: 'VIP', capacity: 5 }).expect(201);

    await http.post(api(`/clubs/${clubA}/submit`)).set(bearer(ownerA)).expect(201);
    const queue = await http.get(api('/admin/clubs?status=PENDING_APPROVAL')).set(bearer(admin)).expect(200);
    expect(queue.body.data.some((x: { id: string }) => x.id === clubA)).toBe(true);
    const approved = await http.post(api(`/admin/clubs/${clubA}/approve`)).set(bearer(admin)).expect(201);
    expect(approved.body.data.status).toBe('ACTIVE');
  });

  it('owner cannot approve own club', async () => {
    await http.post(api(`/admin/clubs/${clubA}/approve`)).set(bearer(ownerA)).expect(403);
  });

  it('club B owner cannot see or modify club A resources (scope)', async () => {
    ownerB = await otpLogin(phoneB);
    const c = await http.post(api('/clubs')).set(bearer(ownerB)).send({ name: `E2E Club B ${Date.now()}`, phone: phoneB, owner_password: 'StrongPass#2026' }).expect(201);
    clubB = c.body.data.id;
    ownerB = await refresh(phoneB);

    for (const path of [`/clubs/${clubA}`, `/clubs/${clubA}/staff`, `/clubs/${clubA}/settings`, `/clubs/${clubA}/customers`, `/branches/${branchA1}/rooms`, `/clubs/${clubA}/staff/invitations`]) {
      const res = await http.get(api(path)).set(bearer(ownerB));
      expect([403, 404]).toContain(res.status);
    }
    const patch = await http.patch(api(`/branches/${branchA1}`)).set(bearer(ownerB)).send({ name: 'Hacked' });
    expect([403, 404]).toContain(patch.status);
    const inv = await http.post(api(`/clubs/${clubA}/staff/invitations`)).set(bearer(ownerB)).send({ phone: rnd(), role: 'CLUB_ADMIN' });
    expect([403, 404]).toContain(inv.status);

    const mine = await http.get(api('/clubs/mine')).set(bearer(ownerB)).expect(200);
    expect(mine.body.data.map((x: { id: string }) => x.id)).not.toContain(clubA);
    expect(clubB).toBeDefined();
  });

  it('invitation: operator invited to branch, accepts, sees only own branch', async () => {
    const opPhone = rnd();
    const inv = await http.post(api(`/clubs/${clubA}/staff/invitations`)).set(bearer(ownerA)).set('Idempotency-Key', `inv-${opPhone}`)
      .send({ phone: opPhone, role: 'OPERATOR', branch_id: branchA1 }).expect(201);
    expect(inv.body.data).not.toHaveProperty('token_hash');
    const token = inv.body.data.token as string;

    // Idempotent takror — xuddi shu javob
    const again = await http.post(api(`/clubs/${clubA}/staff/invitations`)).set(bearer(ownerA)).set('Idempotency-Key', `inv-${opPhone}`)
      .send({ phone: opPhone, role: 'OPERATOR', branch_id: branchA1 }).expect(201);
    expect(again.body.data.id).toBe(inv.body.data.id);

    // OPERATOR uchun branch_id majburiy
    await http.post(api(`/clubs/${clubA}/staff/invitations`)).set(bearer(ownerA)).send({ phone: rnd(), role: 'OPERATOR' }).expect(422);

    const preview = await http.post(api('/auth/invitations/preview')).send({ token }).expect(200);
    expect(preview.body.data.role).toBe('OPERATOR');
    expect(preview.body.data.has_account).toBe(false);

    const acc = await http.post(api('/auth/invitations/accept')).send({ token, password: 'OperatorPass#1', first_name: 'Op' }).expect(200);
    const op = acc.body.data.access_token as string;
    expect(acc.body.data.user.roles.some((r: { role: string; branch_id: string }) => r.role === 'OPERATOR' && r.branch_id === branchA1)).toBe(true);

    // Qayta ishlatib bo'lmaydi
    await http.post(api('/auth/invitations/accept')).send({ token, password: 'OperatorPass#1' }).expect(404);

    await http.get(api(`/branches/${branchA1}/devices`)).set(bearer(op)).expect(200);
    // OPERATOR'da rooms.view yo'q
    await http.get(api(`/branches/${branchA1}/rooms`)).set(bearer(op)).expect(403);
    if (branchA2) {
      const other = await http.get(api(`/branches/${branchA2}/devices`)).set(bearer(op));
      expect([403, 404]).toContain(other.status);
    }
    // Operator xodim qo'sha olmaydi
    const esc = await http.post(api(`/clubs/${clubA}/staff/invitations`)).set(bearer(op)).send({ phone: rnd(), role: 'OPERATOR', branch_id: branchA1 });
    expect([403, 404]).toContain(esc.status);

    const list = await http.get(api(`/clubs/${clubA}/staff/invitations`)).set(bearer(ownerA)).expect(200);
    expect(list.body.data.find((x: { id: string }) => x.id === inv.body.data.id).status).toBe('ACCEPTED');
  });

  it('revoked invitation cannot be accepted', async () => {
    const inv = await http.post(api(`/clubs/${clubA}/staff/invitations`)).set(bearer(ownerA)).send({ phone: rnd(), role: 'CLUB_ADMIN' }).expect(201);
    await http.delete(api(`/clubs/${clubA}/staff/invitations/${inv.body.data.id}`)).set(bearer(ownerA)).expect(200);
    await http.post(api('/auth/invitations/accept')).send({ token: inv.body.data.token, password: 'Whatever#123' }).expect(404);
  });
});
