import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { REDIS } from '../src/infra/redis/redis.module';

/**
 * Paket narxlar: oddiy 1 soat 12 000, paket 3 soat 30 000 — qat'iy davomiylik va narx, bron snapshot'i,
 * vaqt oynasi, ko'chirish, walk-in va klublararo scope.
 */
describe('Tariff packages (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const rnd = () => `+99890${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const api = (p: string) => `/api/v1${p}`;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const PRICE = 1_200_000; // 12 000 so'm/soat (tiyin)
  const PKG = 3_000_000; // 3 soat — 30 000 so'm

  let admin: string;
  let owner: string;
  let otherOwner: string;
  const clubIds: string[] = [];
  let branchId: string;
  let otherBranchId: string;
  let pc: string[];
  let tariffId: string;
  let pkg3h: string;
  let pkgWindow: string;
  let otherPkg: string;
  let bookingId: string;

  const otpLogin = async (phone: string) => {
    await app.get<Redis>(REDIS).del(`otp:cooldown:${phone}`);
    await http.post(api('/auth/send-otp')).send({ phone, purpose: 'LOGIN' }).expect(200);
    return (await http.post(api('/auth/verify-otp')).send({ phone, code: '000000' }).expect(200)).body.data.access_token as string;
  };
  const slot = (minutesAhead: number) => {
    const d = new Date(Date.now() + minutesAhead * 60_000);
    d.setUTCMinutes(Math.ceil(d.getUTCMinutes() / 30) * 30, 0, 0);
    return d;
  };
  /** Toshkent (UTC+5) bo'yicha soat. */
  const tashkentHour = (d: Date) => (d.getUTCHours() + 5) % 24;
  const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;

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
        .send({ name: 'Zal', address: 'Toshkent, Yunusobod 4', latitude: 41.36, longitude: 69.28, working_hours: { always_open: true } })
        .expect(201)
    ).body.data.id;
    await http.post(api(`/branches/${branch}/devices/bulk`)).set(bearer(token)).send({ prefix: 'PC-', from: 1, to: 3, type: 'PC' }).expect(201);
    return { token, clubId, branch };
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

    const a = await makeClub('E2E Paket Club');
    owner = a.token;
    branchId = a.branch;
    const devices = await http.get(api(`/branches/${branchId}/devices`)).set(bearer(owner)).expect(200);
    pc = devices.body.data.sort((x: { name: string }, y: { name: string }) => x.name.localeCompare(y.name)).map((d: { id: string }) => d.id);

    // Oyna: target vaqtni (slot(120)) qamramaydigan 2 soatlik oyna — PACKAGE_TIME ni aniq sinash uchun
    const h = tashkentHour(slot(120));
    const t = await http
      .post(api(`/branches/${branchId}/tariffs`))
      .set(bearer(owner))
      .send({
        name: 'Standart', price_per_hour: PRICE, device_type: 'PC',
        packages: [
          { name: '3 soat', duration_minutes: 180, price: PKG },
          { name: 'Oyna paket', duration_minutes: 120, price: 2_000_000, start_time: hh(h + 3), end_time: hh(h + 5) },
        ],
      })
      .expect(201);
    tariffId = t.body.data.id;
    expect(t.body.data.packages).toHaveLength(2);
    pkg3h = t.body.data.packages.find((p: { name: string }) => p.name === '3 soat').id;
    pkgWindow = t.body.data.packages.find((p: { name: string }) => p.name === 'Oyna paket').id;
    await http.post(api(`/clubs/${a.clubId}/submit`)).set(bearer(owner)).expect(201);
    await http.post(api(`/admin/clubs/${a.clubId}/approve`)).set(bearer(admin)).expect(201);

    const b = await makeClub('E2E Boshqa Club');
    otherOwner = b.token;
    otherBranchId = b.branch;
    const ot = await http
      .post(api(`/branches/${otherBranchId}/tariffs`))
      .set(bearer(otherOwner))
      .send({ name: 'Boshqa', price_per_hour: PRICE, packages: [{ name: '2 soat', duration_minutes: 120, price: 1_000_000 }] })
      .expect(201);
    otherPkg = ot.body.data.packages[0].id;
  });

  afterAll(async () => {
    const shift = await http.get(api('/shifts/current')).set(bearer(owner));
    if (shift.body?.data?.id) await http.post(api(`/shifts/${shift.body.data.id}/close`)).set(bearer(owner)).send({ counted_cash: 0 });
    for (const id of clubIds) await http.post(api(`/admin/clubs/${id}/close`)).set(bearer(admin)).send({ reason: 'e2e cleanup' });
    await app.close();
  });

  it('public package list shows price and regular amount for savings', async () => {
    const r = await http.get(api(`/branches/${branchId}/packages`)).expect(200);
    const p = r.body.data.find((x: { id: string }) => x.id === pkg3h);
    expect(p).toMatchObject({ name: '3 soat', duration_minutes: 180, tariff: { id: tariffId } });
    expect(Number(p.price)).toBe(PKG);
    expect(Number(p.regular_amount)).toBe(3 * PRICE);
  });

  it('booking with a package: fixed duration and price, snapshot saved', async () => {
    const customer = await otpLogin(rnd());
    const start = slot(120).toISOString();
    const q = await http.get(api(`/branches/${branchId}/availability`)).query({ start_at: start, duration: 60, package_id: pkg3h }).expect(200);
    const dev = q.body.data.devices.find((d: { id: string }) => d.id === pc[0]);
    expect(Number(dev.price_quote.amount)).toBe(PKG);
    expect(Number(dev.price_quote.regular_amount)).toBe(3 * PRICE);
    expect(new Date(q.body.data.end_at).getTime() - new Date(start).getTime()).toBe(180 * 60_000);

    // duration_minutes paketnikiga tenglanadi
    const r = await http.post(api('/bookings')).set(bearer(customer)).send({ branch_id: branchId, start_at: start, duration_minutes: 60, package_id: pkg3h, items: [{ device_id: pc[0] }] }).expect(201);
    bookingId = r.body.data.id;
    expect(r.body.data).toMatchObject({ duration_minutes: 180, package: { id: pkg3h, name: '3 soat', duration_minutes: 180, price: PKG } });
    expect(Number(r.body.data.total_amount)).toBe(PKG);
    expect(r.body.data.items[0].price_breakdown.segments[0]).toMatchObject({ rule: 'PACKAGE', package_id: pkg3h, minutes: 180 });
  });

  it('package outside its time window is rejected; slots respect the window', async () => {
    const customer = await otpLogin(rnd());
    const r = await http.post(api('/bookings')).set(bearer(customer)).send({ branch_id: branchId, start_at: slot(120).toISOString(), duration_minutes: 120, package_id: pkgWindow, items: [{ device_id: pc[1] }] }).expect(422);
    expect(r.body.error.details.reason).toBe('PACKAGE_TIME');

    const day = slot(24 * 60);
    const date = new Date(day.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
    const s = await http.get(api(`/branches/${branchId}/slots`)).query({ date, duration: 60, package_id: pkgWindow }).expect(200);
    expect(s.body.data.slots.length).toBeGreaterThan(0);
    const from = tashkentHour(slot(120)) + 3;
    for (const x of s.body.data.slots) expect([from % 24, (from + 1) % 24]).toContain(tashkentHour(new Date(x.start_at)));
  });

  it('a package from another club cannot be used here', async () => {
    const customer = await otpLogin(rnd());
    const r = await http.post(api('/bookings')).set(bearer(customer)).send({ branch_id: branchId, start_at: slot(300).toISOString(), duration_minutes: 120, package_id: otherPkg, items: [{ device_id: pc[1] }] }).expect(422);
    expect(r.body.error.details.reason).toBe('PACKAGE_NOT_FOUND');
  });

  it("another club's owner cannot see or change this tariff's packages", async () => {
    await http.get(api(`/branches/${branchId}/tariffs/manage`)).set(bearer(otherOwner)).expect((res) => expect([403, 404]).toContain(res.status));
    await http.patch(api(`/tariffs/${tariffId}`)).set(bearer(otherOwner)).send({ packages: [] }).expect((res) => expect([403, 404]).toContain(res.status));
    // O'z tarifiga begona paket id'sini ulab bo'lmaydi
    const own = (await http.get(api(`/branches/${otherBranchId}/tariffs/manage`)).set(bearer(otherOwner)).expect(200)).body.data[0];
    const r = await http.patch(api(`/tariffs/${own.id}`)).set(bearer(otherOwner)).send({ packages: [{ id: pkg3h, name: 'X', duration_minutes: 60, price: 1 }] }).expect(422);
    expect(r.body.error.details.reason).toBe('PACKAGE_NOT_FOUND');
  });

  it('removing a package keeps existing bookings at the snapshot price; reschedule keeps the package', async () => {
    await http
      .patch(api(`/tariffs/${tariffId}`))
      .set(bearer(owner))
      .send({ packages: [{ id: pkgWindow, name: 'Oyna paket', duration_minutes: 120, price: 2_000_000, start_time: hh(0), end_time: hh(0) }] })
      .expect(200);
    const list = await http.get(api(`/branches/${branchId}/packages`)).expect(200);
    expect(list.body.data.map((p: { id: string }) => p.id)).toEqual([pkgWindow]);

    const customer = await otpLogin(rnd());
    const gone = await http.post(api('/bookings')).set(bearer(customer)).send({ branch_id: branchId, start_at: slot(600).toISOString(), duration_minutes: 180, package_id: pkg3h, items: [{ device_id: pc[2] }] }).expect(422);
    expect(gone.body.error.details.reason).toBe('PACKAGE_NOT_FOUND');

    const dur = await http.post(api(`/bookings/${bookingId}/reschedule`)).set(bearer(owner)).send({ start_at: slot(480).toISOString(), duration_minutes: 60 }).expect(422);
    expect(dur.body.error.details.reason).toBe('PACKAGE_DURATION');
    const moved = await http.post(api(`/bookings/${bookingId}/reschedule`)).set(bearer(owner)).send({ start_at: slot(480).toISOString() }).expect(201);
    expect(moved.body.data.duration_minutes).toBe(180);
    expect(Number(moved.body.data.total_amount)).toBe(PKG);
  });

  it('operator sells a package as a walk-in; package cannot be combined with VIP', async () => {
    await http.post(api('/shifts/open')).set(bearer(owner)).send({ branch_id: branchId, opening_cash: 0 }).expect(201);
    const r = await http.post(api('/bookings/walk-in')).set(bearer(owner)).send({ branch_id: branchId, device_ids: [pc[1]], package_id: pkgWindow, payment_method: 'CASH' }).expect(201);
    expect(r.body.data).toMatchObject({ duration_minutes: 120, source: 'WALK_IN', package: { id: pkgWindow } });
    expect(Number(r.body.data.total_amount)).toBe(2_000_000);
    expect(Number(r.body.data.paid_amount)).toBe(2_000_000);

    const vip = await http.post(api('/bookings/walk-in')).set(bearer(owner)).send({ branch_id: branchId, device_ids: [pc[2]], package_id: pkgWindow, open: true, payment_method: 'LATER' }).expect(422);
    expect(vip.body.error.details.reason).toBe('PACKAGE_OPEN');
  });
});
