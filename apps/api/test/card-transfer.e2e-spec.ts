import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { REDIS } from '../src/infra/redis/redis.module';

/**
 * Kartaga o'tkazma: mijoz "pul o'tkazdim" (faqat karta oxirgi 4 raqami) → bron darhol CONFIRMED, to'lov PROCESSING;
 * operator tasdiqlasa → PAID + mijozga TRANSFER_CONFIRMED; rad etsa → bron saqlanadi, qayta yuborish mumkin; klublararo scope.
 */
describe('Card transfer (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const rnd = () => `+99890${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const api = (p: string) => `/api/v1${p}`;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const PRICE = 1_200_000;

  let admin: string;
  let owner: string;
  let otherOwner: string;
  const clubIds: string[] = [];
  let branchId: string;
  let pc: string[];

  const otpLogin = async (phone: string) => {
    await app.get<Redis>(REDIS).del(`otp:cooldown:${phone}`);
    await http.post(api('/auth/send-otp')).send({ phone, purpose: 'LOGIN' }).expect(200);
    return (await http.post(api('/auth/verify-otp')).send({ phone, code: '000000' }).expect(200)).body.data.access_token as string;
  };
  const slot = (minutesAhead: number) => {
    const d = new Date(Date.now() + minutesAhead * 60_000);
    d.setUTCMinutes(Math.ceil(d.getUTCMinutes() / 30) * 30, 0, 0);
    return d.toISOString();
  };
  const makeClub = async (name: string) => {
    const phone = rnd();
    let token = await otpLogin(phone);
    const clubId = (await http.post(api('/clubs')).set(bearer(token)).send({ name: `${name} ${Date.now()}`, phone, owner_password: 'StrongPass#2026' }).expect(201)).body.data.id;
    clubIds.push(clubId);
    token = await otpLogin(phone);
    const branch = (
      await http
        .post(api(`/clubs/${clubId}/branches`))
        .set(bearer(token))
        .send({ name: 'Zal', address: 'Toshkent, Chilonzor 1', latitude: 41.28, longitude: 69.2, working_hours: { always_open: true } })
        .expect(201)
    ).body.data.id;
    await http.post(api(`/branches/${branch}/devices/bulk`)).set(bearer(token)).send({ prefix: 'PC-', from: 1, to: 3, type: 'PC' }).expect(201);
    await http.post(api(`/branches/${branch}/tariffs`)).set(bearer(token)).send({ name: 'Standart', price_per_hour: PRICE, device_type: 'PC' }).expect(201);
    return { token, clubId, branch };
  };
  const book = async (customer: string, device: string, minutesAhead: number) =>
    (await http.post(api('/bookings')).set(bearer(customer)).send({ branch_id: branchId, start_at: slot(minutesAhead), duration_minutes: 60, items: [{ device_id: device }] }).expect(201)).body.data;
  const notifTypes = async (token: string) => (await http.get(api('/notifications')).set(bearer(token)).expect(200)).body.data.map((n: { type: string }) => n.type) as string[];

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

    const a = await makeClub('E2E Transfer Club');
    owner = a.token;
    branchId = a.branch;
    await http.patch(api(`/clubs/${a.clubId}/settings`)).set(bearer(owner)).send({ transfer_card: { number: '8600123412345678', holder: 'Test Owner' } }).expect(200);
    await http.post(api(`/clubs/${a.clubId}/submit`)).set(bearer(owner)).expect(201);
    await http.post(api(`/admin/clubs/${a.clubId}/approve`)).set(bearer(admin)).expect(201);
    const devices = await http.get(api(`/branches/${branchId}/devices`)).set(bearer(owner)).expect(200);
    pc = devices.body.data.sort((x: { name: string }, y: { name: string }) => x.name.localeCompare(y.name)).map((d: { id: string }) => d.id);

    otherOwner = (await makeClub('E2E Transfer Other')).token;
  });

  afterAll(async () => {
    for (const id of clubIds) await http.post(api(`/admin/clubs/${id}/close`)).set(bearer(admin)).send({ reason: 'e2e cleanup' });
    await app.close();
  });

  it('submitting a transfer (last 4 digits only) confirms the booking at once; operator confirm notifies the customer', async () => {
    const customer = await otpLogin(rnd());
    const b = await book(customer, pc[0], 120);
    expect(b.status).toBe('PENDING_PAYMENT');

    const t = await http.post(api('/payments/transfer')).set(bearer(customer)).send({ booking_id: b.id, payer_card_last4: '4321' }).expect(201);
    expect(t.body.data).toMatchObject({ status: 'PROCESSING', method: 'CARD_TRANSFER', booking_status: 'CONFIRMED' });
    const paymentId = t.body.data.id;

    // Chipta darhol faol: CONFIRMED + QR, to'lov esa tekshirilmoqda
    const d = (await http.get(api(`/bookings/${b.id}`)).set(bearer(customer)).expect(200)).body.data;
    expect(d.status).toBe('CONFIRMED');
    expect(d.hold_expires_at).toBeNull();
    expect(d.transfer.pending).toMatchObject({ id: paymentId });
    await http.get(api(`/bookings/${b.id}/qr`)).set(bearer(customer)).expect(200);
    expect(await notifTypes(customer)).toContain('BOOKING_CONFIRMED');

    // Ikkinchi marta yuborib bo'lmaydi
    const dup = await http.post(api('/payments/transfer')).set(bearer(customer)).send({ booking_id: b.id, payer_card_last4: '4321' }).expect(409);
    expect(dup.body.error.details.reason).toBe('TRANSFER_PENDING');

    // Boshqa klub egasi bu o'tkazmani ko'rmaydi va tasdiqlay olmaydi
    await http.post(api(`/payments/${paymentId}/transfer/confirm`)).set(bearer(otherOwner)).expect(404);

    await http.post(api(`/payments/${paymentId}/transfer/confirm`)).set(bearer(owner)).expect(201);
    const after = (await http.get(api(`/bookings/${b.id}`)).set(bearer(customer)).expect(200)).body.data;
    expect(after.status).toBe('CONFIRMED');
    expect(after.payment_status).toBe('PAID');
    expect(after.transfer).toBeNull();
    const types = await notifTypes(customer);
    expect(types).toContain('TRANSFER_CONFIRMED');
    // Bron tasdiqlash xabari takrorlanmaydi
    expect(types.filter((x) => x === 'BOOKING_CONFIRMED')).toHaveLength(1);
  });

  it('rejected transfer keeps the booking; the customer can resubmit', async () => {
    const customer = await otpLogin(rnd());
    const b = await book(customer, pc[1], 180);
    const t = await http.post(api('/payments/transfer')).set(bearer(customer)).send({ booking_id: b.id, payer_card_last4: '1111' }).expect(201);
    await http.post(api(`/payments/${t.body.data.id}/transfer/reject`)).set(bearer(owner)).send({ reason: 'Summa tushmadi' }).expect(201);

    const d = (await http.get(api(`/bookings/${b.id}`)).set(bearer(customer)).expect(200)).body.data;
    expect(d.status).toBe('CONFIRMED');
    expect(d.payment_status).toBe('UNPAID');
    expect(d.transfer).toMatchObject({ pending: null, rejected: { failed_reason: 'Summa tushmadi' } });
    expect(await notifTypes(customer)).toContain('TRANSFER_REJECTED');

    const again = await http.post(api('/payments/transfer')).set(bearer(customer)).send({ booking_id: b.id, payer_card_last4: '1111' }).expect(201);
    expect(again.body.data.booking_status).toBe('CONFIRMED');
  });

  it('customer cannot cancel while the transfer is being checked', async () => {
    const customer = await otpLogin(rnd());
    const b = await book(customer, pc[2], 240);
    await http.post(api('/payments/transfer')).set(bearer(customer)).send({ booking_id: b.id, payer_card_last4: '2222' }).expect(201);
    const r = await http.post(api(`/bookings/${b.id}/cancel`)).set(bearer(customer)).send({}).expect(409);
    expect(r.body.error.details.reason).toBe('TRANSFER_PENDING');
  });
});
