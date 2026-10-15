import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { REDIS } from '../src/infra/redis/redis.module';

/**
 * VIP / ochiq vaqt: operator sessiyani tugash vaqtisiz ochadi → qurilma operator yopguncha ilovadan bron qilinmaydi;
 * yakunda haqiqiy vaqt (minimal 30 daq, 5 daq qadam) bo'yicha hisoblanadi; oldindan qilingan bron chegarani belgilaydi.
 */
describe('Open (VIP) sessions (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const rnd = () => `+99890${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const api = (p: string) => `/api/v1${p}`;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const PRICE = 1_200_000; // 12 000 so'm/soat (tiyin)

  let admin: string;
  let owner: string;
  let customer: string;
  let clubId: string;
  let branchId: string;
  let pc: string[];
  let vip1: string;

  const otpLogin = async (phone: string) => {
    await app.get<Redis>(REDIS).del(`otp:cooldown:${phone}`);
    await http.post(api('/auth/send-otp')).send({ phone, purpose: 'LOGIN' }).expect(200);
    return (await http.post(api('/auth/verify-otp')).send({ phone, code: '000000' }).expect(200)).body.data.access_token as string;
  };
  /** Mijoz bron qilishi mumkin bo'lgan (30 daq slotga tekislangan) vaqt. */
  const slot = (minutesAhead: number) => {
    const d = new Date(Date.now() + minutesAhead * 60_000);
    d.setUTCMinutes(Math.ceil(d.getUTCMinutes() / 30) * 30, 0, 0);
    return d.toISOString();
  };
  const walkInOpen = (deviceId: string) => http.post(api('/bookings/walk-in')).set(bearer(owner)).send({ branch_id: branchId, device_ids: [deviceId], open: true, payment_method: 'LATER', guest_name: 'VIP mehmon' });
  const liveSession = async (deviceId: string) => {
    const live = await http.get(api(`/branches/${branchId}/live`)).set(bearer(owner)).expect(200);
    return live.body.data.devices.find((d: { id: string }) => d.id === deviceId).session;
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
    admin = (await http.post(api('/auth/login')).send({ login: process.env.SUPER_ADMIN_EMAIL, password: process.env.SUPER_ADMIN_PASSWORD }).expect(200)).body.data.access_token;
    customer = await otpLogin(rnd());

    const ownerPhone = rnd();
    owner = await otpLogin(ownerPhone);
    clubId = (await http.post(api('/clubs')).set(bearer(owner)).send({ name: `E2E VIP Club ${Date.now()}`, phone: ownerPhone, owner_password: 'StrongPass#2026' }).expect(201)).body.data.id;
    owner = await otpLogin(ownerPhone);
    branchId = (
      await http
        .post(api(`/clubs/${clubId}/branches`))
        .set(bearer(owner))
        .send({ name: 'VIP zal', address: 'Toshkent, Chilonzor 9', latitude: 41.28, longitude: 69.2, working_hours: { always_open: true }, booking_settings: { open_min_minutes: 30, open_round_minutes: 5 } })
        .expect(201)
    ).body.data.id;
    await http.post(api(`/branches/${branchId}/devices/bulk`)).set(bearer(owner)).send({ prefix: 'VIP-', from: 1, to: 3, type: 'PC' }).expect(201);
    const devices = await http.get(api(`/branches/${branchId}/devices`)).set(bearer(owner)).expect(200);
    pc = devices.body.data.map((d: { id: string; name: string }) => d).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)).map((d: { id: string }) => d.id);
    await http.post(api(`/branches/${branchId}/tariffs`)).set(bearer(owner)).send({ name: 'Standart', price_per_hour: PRICE, device_type: 'PC' }).expect(201);
    await http.post(api(`/clubs/${clubId}/submit`)).set(bearer(owner)).expect(201);
    await http.post(api(`/admin/clubs/${clubId}/approve`)).set(bearer(admin)).expect(201);
  });

  afterAll(async () => {
    const shift = await http.get(api('/shifts/current')).set(bearer(owner));
    if (shift.body?.data?.id) await http.post(api(`/shifts/${shift.body.data.id}/close`)).set(bearer(owner)).send({ counted_cash: 0 });
    if (clubId) await http.post(api(`/admin/clubs/${clubId}/close`)).set(bearer(admin)).send({ reason: 'e2e cleanup' });
    await app.close();
  });

  it('operator opens a VIP session without an end time', async () => {
    const r = await walkInOpen(pc[0]).expect(201);
    expect(r.body.data).toMatchObject({ is_open: true, total_amount: 0, source: 'WALK_IN' });
    const s = await liveSession(pc[0]);
    vip1 = s.id;
    expect(s).toMatchObject({ is_open: true, expected_end_at: null, must_end_by: null, remaining_seconds: null });
    // Minimal 30 daqiqa darhol hisoblanadi
    expect(Number(s.accrued_amount)).toBe(PRICE / 2);
  });

  it('a VIP PC cannot be booked from the app until it is closed — even far ahead', async () => {
    for (const ahead of [120, 24 * 60]) {
      const r = await http.post(api('/bookings')).set(bearer(customer)).send({ branch_id: branchId, start_at: slot(ahead), duration_minutes: 60, items: [{ device_id: pc[0] }] });
      expect(r.status).toBe(409);
    }
  });

  it('VIP has no end time to extend', async () => {
    const r = await http.post(api(`/sessions/${vip1}/extend`)).set(bearer(owner)).send({ minutes: 30 }).expect(409);
    expect(r.body.error.details.reason).toBe('OPEN_SESSION');
  });

  it('an earlier app booking limits the VIP session; a booking starting soon blocks it', async () => {
    const start = slot(120);
    await http.post(api('/bookings')).set(bearer(customer)).send({ branch_id: branchId, start_at: start, duration_minutes: 60, items: [{ device_id: pc[1] }] }).expect(201);
    await walkInOpen(pc[1]).expect(201);
    const s = await liveSession(pc[1]);
    expect(new Date(s.must_end_by).toISOString()).toBe(start);

    // Telefon orqali (xodim) 10 daqiqadan keyinga bron → VIP ochib bo'lmaydi
    await http
      .post(api('/bookings'))
      .set(bearer(owner))
      .send({ branch_id: branchId, start_at: new Date(Date.now() + 10 * 60_000).toISOString(), duration_minutes: 60, items: [{ device_id: pc[2] }], source: 'PHONE', guest_name: 'Telefon' })
      .expect(201);
    const soon = await walkInOpen(pc[2]).expect(409);
    expect(soon.body.error.details.reason).toBe('NEXT_BOOKING_SOON');
  });

  it('operator closes VIP: billed by actual time, paid in cash, PC is bookable again', async () => {
    await http.post(api('/shifts/open')).set(bearer(owner)).send({ branch_id: branchId, opening_cash: 0 }).expect(201);
    const r = await http.post(api(`/sessions/${vip1}/stop`)).set(bearer(owner)).send({ payment_method: 'CASH' }).expect(201);
    expect(r.body.data).toMatchObject({ status: 'COMPLETED', open_minutes: 30 });
    expect(Number(r.body.data.open_amount)).toBe(PRICE / 2);
    expect(Number(r.body.data.paid_amount)).toBe(PRICE / 2);
    expect(Number(r.body.data.booking.total_amount)).toBe(PRICE / 2);
    expect(Number(r.body.data.booking.paid_amount)).toBe(PRICE / 2);
    expect(r.body.data.booking.status).toBe('COMPLETED');

    await http.post(api('/bookings')).set(bearer(customer)).send({ branch_id: branchId, start_at: slot(180), duration_minutes: 60, items: [{ device_id: pc[0] }] }).expect(201);
  });
});
