import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { REDIS } from '../src/infra/redis/redis.module';

/** Talab va taklif: har qanday rol murojaat yuboradi → super admin inbox'ida ko'radi va javob beradi; boshqalar ko'rmaydi. */
describe('Support tickets (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const rnd = () => `+99890${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const api = (p: string) => `/api/v1${p}`;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  let admin: string;
  let customer: string;
  let stranger: string;
  let owner: string;
  let clubId: string;
  let customerTicket: string;
  let ownerTicket: string;

  const otpLogin = async (phone: string) => {
    await app.get<Redis>(REDIS).del(`otp:cooldown:${phone}`);
    await http.post(api('/auth/send-otp')).send({ phone, purpose: 'LOGIN' }).expect(200);
    const res = await http.post(api('/auth/verify-otp')).send({ phone, code: '000000' }).expect(200);
    return res.body.data.access_token as string;
  };

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
    customer = await otpLogin(rnd());
    stranger = await otpLogin(rnd());
    const ownerPhone = rnd();
    owner = await otpLogin(ownerPhone);
    const c = await http.post(api('/clubs')).set(bearer(owner)).send({ name: `E2E Support Club ${Date.now()}`, phone: ownerPhone, owner_password: 'StrongPass#2026' }).expect(201);
    clubId = c.body.data.id;
    owner = await otpLogin(ownerPhone);
  });

  afterAll(async () => {
    for (const id of [customerTicket, ownerTicket].filter(Boolean)) {
      await http.patch(api(`/admin/support/tickets/${id}`)).set(bearer(admin)).send({ status: 'CLOSED' });
    }
    if (clubId) await http.post(api(`/admin/clubs/${clubId}/close`)).set(bearer(admin)).send({ reason: 'e2e cleanup' });
    await app.close();
  });

  it('customer sends a suggestion; only the author sees it', async () => {
    const r = await http.post(api('/support/tickets')).set(bearer(customer)).send({ type: 'SUGGESTION', subject: 'Tungi tarif qo\'shing', body: 'Kechasi arzonroq bo\'lsa yaxshi bo\'lardi' }).expect(201);
    customerTicket = r.body.data.id;
    expect(r.body.data).toMatchObject({ sender_role: 'CUSTOMER', awaiting_reply: true, status: 'OPEN', can_reply: true });
    expect(r.body.data.messages).toHaveLength(1);

    await http.get(api(`/support/tickets/${customerTicket}`)).set(bearer(stranger)).expect(404);
    await http.post(api(`/support/tickets/${customerTicket}/messages`)).set(bearer(stranger)).send({ body: 'salom' }).expect(404);
    const list = await http.get(api('/support/tickets?all=true')).set(bearer(stranger)).expect(200);
    expect(list.body.data.map((t: { id: string }) => t.id)).not.toContain(customerTicket);
  });

  it('club staff sends as STAFF with role snapshot; a customer cannot', async () => {
    const r = await http.post(api('/support/tickets')).set(bearer(owner)).send({ type: 'REQUEST', subject: 'Hisobotga eksport kerak', body: 'PDF eksport qo\'shilsa', as: 'STAFF' }).expect(201);
    ownerTicket = r.body.data.id;
    expect(r.body.data).toMatchObject({ sender_role: 'CLUB_OWNER', club_id: clubId });

    const bad = await http.post(api('/support/tickets')).set(bearer(customer)).send({ type: 'REQUEST', subject: 'Men xodimman', body: 'x', as: 'STAFF' }).expect(403);
    expect(bad.body.error.code).toBe('FORBIDDEN');
  });

  it('platform inbox lists all tickets with sender/awaiting filters', async () => {
    const all = await http.get(api('/support/tickets?all=true&awaiting=true&limit=100')).set(bearer(admin)).expect(200);
    const ids = all.body.data.map((t: { id: string }) => t.id);
    expect(ids).toEqual(expect.arrayContaining([customerTicket, ownerTicket]));
    expect(all.body.data.find((t: { id: string }) => t.id === customerTicket).user).not.toBeNull();

    const staff = await http.get(api('/support/tickets?all=true&sender=STAFF&limit=100')).set(bearer(admin)).expect(200);
    const staffIds = staff.body.data.map((t: { id: string }) => t.id);
    expect(staffIds).toContain(ownerTicket);
    expect(staffIds).not.toContain(customerTicket);

    const stats = await http.get(api('/admin/support/stats')).set(bearer(admin)).expect(200);
    expect(stats.body.data.awaiting).toBeGreaterThanOrEqual(2);
    await http.get(api('/admin/support/stats')).set(bearer(customer)).expect(403);
  });

  it('super admin replies; author is notified and sees the reply', async () => {
    const r = await http.post(api(`/support/tickets/${customerTicket}/messages`)).set(bearer(admin)).send({ body: 'Rahmat, ko\'rib chiqamiz' }).expect(201);
    expect(r.body.data).toMatchObject({ status: 'IN_PROGRESS', awaiting_reply: false });

    const mine = await http.get(api(`/support/tickets/${customerTicket}`)).set(bearer(customer)).expect(200);
    const reply = mine.body.data.messages[1];
    expect(reply).toMatchObject({ is_staff: true, sender_name: null });

    const n = await http.get(api('/notifications?limit=10')).set(bearer(customer)).expect(200);
    expect(n.body.data.some((x: { type: string; data: { ticket_id?: string } }) => x.type === 'TICKET_REPLY' && x.data?.ticket_id === customerTicket)).toBe(true);
  });

  it('club owner cannot reply to someone else\'s ticket', async () => {
    await http.post(api(`/support/tickets/${customerTicket}/messages`)).set(bearer(owner)).send({ body: 'Men javob beraman' }).expect(404);
  });

  it('author reply reopens a resolved ticket; closed ticket rejects messages', async () => {
    await http.patch(api(`/admin/support/tickets/${customerTicket}`)).set(bearer(admin)).send({ status: 'RESOLVED' }).expect(200);
    const reopened = await http.post(api(`/support/tickets/${customerTicket}/messages`)).set(bearer(customer)).send({ body: 'Yana bir savol' }).expect(201);
    expect(reopened.body.data).toMatchObject({ status: 'OPEN', awaiting_reply: true });

    await http.patch(api(`/admin/support/tickets/${customerTicket}`)).set(bearer(admin)).send({ status: 'CLOSED' }).expect(200);
    const closed = await http.post(api(`/support/tickets/${customerTicket}/messages`)).set(bearer(customer)).send({ body: 'Hali ham' }).expect(409);
    expect(closed.body.error.details.reason).toBe('TICKET_CLOSED');
    await http.patch(api(`/admin/support/tickets/${customerTicket}`)).set(bearer(customer)).send({ status: 'OPEN' }).expect(403);
  });
});
