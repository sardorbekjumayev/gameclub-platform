import { DateTime } from 'luxon';
import { PrismaService } from '../src/database/prisma.service';
import { api, bearer, Harness, rndPhone, TestClub } from './utils/harness';

/**
 * Double-booking himoyasi (docs/02-DATABASE.md §4.1, docs/01-API.md §13 "Concurrency testlar"):
 * bir qurilma/vaqtga parallel so'rovlar → aynan bitta muvaffaqiyat, qolganlari 409 (DB exclusion constraint).
 */
jest.setTimeout(60_000);

describe('Bookings concurrency (e2e)', () => {
  const h = new Harness();
  const TZ = 'Asia/Tashkent';
  let prisma: PrismaService;
  let C: TestClub;
  let categoryId: string;
  let catDevices: string[];

  const at = (days: number, hour: number, minute = 0) =>
    DateTime.now().setZone(TZ).plus({ days }).set({ hour, minute, second: 0, millisecond: 0 }).toUTC().toISO()!;

  const login = async () => {
    const phone = rndPhone();
    const ip = `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
    await h.redis.del(`otp:cooldown:${phone}`);
    await h.http.post(api('/auth/send-otp')).set('X-Forwarded-For', ip).send({ phone, purpose: 'LOGIN' }).expect(200);
    const r = await h.http.post(api('/auth/verify-otp')).set('X-Forwarded-For', ip).send({ phone, code: '000000' }).expect(200);
    return r.body.data.access_token as string;
  };
  const customers = async (n: number) => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(await login());
    return out;
  };
  const book = (token: string, body: Record<string, unknown>) => h.http.post(api('/bookings')).set(bearer(token)).send(body);
  /** Qurilmaning oraliqdagi faol itemlari soni (DB — haqiqat manbai). */
  const activeItems = (deviceId: string, start: string, end: string) =>
    prisma.booking_items.count({ where: { device_id: deviceId, active: true, start_at: { lt: new Date(end) }, end_at: { gt: new Date(start) } } });

  beforeAll(async () => {
    await h.start();
    prisma = h.get<PrismaService>(PrismaService);
    C = await h.club({ devices: 2 });
    const cat = await h.http.post(api(`/branches/${C.branchId}/device-categories`)).set(bearer(C.owner)).send({ name: 'Arena', device_type: 'PC' }).expect(201);
    categoryId = cat.body.data.id;
    await h.http.post(api(`/branches/${C.branchId}/devices/bulk`)).set(bearer(C.owner)).send({ prefix: 'ARENA-', from: 1, to: 3, type: 'PC', category_id: categoryId }).expect(201);
    const list = await h.http.get(api(`/branches/${C.branchId}/devices`)).set(bearer(C.owner)).expect(200);
    catDevices = (list.body.data as { id: string; category_id: string | null }[]).filter((d) => d.category_id === categoryId).map((d) => d.id);
    expect(catDevices).toHaveLength(3);
  }, 120_000);

  afterAll(async () => {
    await h.stop();
  });

  it('N parallel POST /bookings for the same device and time → exactly one 201, the rest 409', async () => {
    const N = 20;
    const tokens = await customers(N);
    const start = at(2, 12);
    const body = { branch_id: C.branchId, start_at: start, duration_minutes: 60, items: [{ device_id: C.devices[0] }] };
    const res = await Promise.all(tokens.map((t) => book(t, body)));
    const statuses = res.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(N - 1);
    for (const r of res.filter((x) => x.status === 409)) expect(r.body.error.code).toBe('BOOKING_SLOT_TAKEN');
    expect(await activeItems(C.devices[0], start, at(2, 13))).toBe(1);
    const winner = res.find((r) => r.status === 201)!.body.data;
    expect(winner).toMatchObject({ status: 'PENDING_PAYMENT', start_at: start });
  });

  it('parallel partially-overlapping ranges on one device never produce overlapping bookings', async () => {
    const tokens = await customers(9);
    // 30 daqiqaga siljigan 90 daqiqalik oraliqlar — har biri qo'shnilari bilan kesishadi
    const base = new Date(at(3, 10)).getTime();
    const res = await Promise.all(
      tokens.map((t, i) => book(t, { branch_id: C.branchId, start_at: new Date(base + i * 30 * 60_000).toISOString(), duration_minutes: 90, items: [{ device_id: C.devices[1] }], payment_mode: 'AT_CLUB' })),
    );
    for (const r of res) expect([201, 409]).toContain(r.status);
    const won = res.filter((r) => r.status === 201).map((r) => [new Date(r.body.data.start_at).getTime(), new Date(r.body.data.end_at).getTime()] as const);
    expect(won.length).toBeGreaterThanOrEqual(1);
    const rows = await prisma.booking_items.findMany({ where: { device_id: C.devices[1], active: true, start_at: { gte: new Date(base) } }, orderBy: { start_at: 'asc' } });
    expect(rows).toHaveLength(won.length);
    for (let i = 1; i < rows.length; i++) expect(rows[i].start_at.getTime()).toBeGreaterThanOrEqual(rows[i - 1].end_at.getTime());
  });

  it('category booking: N devices, N+k parallel requests → exactly N bookings on distinct devices', async () => {
    const tokens = await customers(6);
    const body = { branch_id: C.branchId, start_at: at(4, 18), duration_minutes: 60, items: [{ category_id: categoryId }], payment_mode: 'AT_CLUB' };
    const res = await Promise.all(tokens.map((t) => book(t, body)));
    const ok = res.filter((r) => r.status === 201);
    expect(ok).toHaveLength(3);
    for (const r of res.filter((x) => x.status !== 201)) expect({ status: r.status, code: r.body.error.code }).toEqual({ status: 409, code: 'BOOKING_SLOT_TAKEN' });
    const devices = ok.map((r) => r.body.data.items[0].device_id);
    expect(new Set(devices).size).toBe(3);
    expect(devices.sort()).toEqual([...catDevices].sort());
  });

  it('one customer, parallel category bookings without Idempotency-Key (double tap, web + app) → one booking, the rest 409 OVERLAP', async () => {
    const [t] = await customers(1);
    const start = at(8, 15);
    const body = { branch_id: C.branchId, start_at: start, duration_minutes: 60, items: [{ category_id: categoryId }], payment_mode: 'AT_CLUB' };
    const res = await Promise.all([1, 2, 3, 4].map(() => book(t, body)));
    const ok = res.filter((r) => r.status === 201);
    expect(ok).toHaveLength(1);
    for (const r of res.filter((x) => x.status !== 201)) expect({ status: r.status, code: r.body.error.code, reason: r.body.error.details?.reason }).toEqual({ status: 409, code: 'CONFLICT', reason: 'OVERLAP' });
    const customerId = ok[0].body.data.customer_id as string;
    expect(await prisma.bookings.count({ where: { customer_id: customerId, status: { not: 'CANCELLED' } } })).toBe(1);
    // Kategoriyaning boshqa qurilmalari shu vaqtda bo'sh qoldi
    const busy = await Promise.all(catDevices.map((d) => activeItems(d, start, at(8, 16))));
    expect(busy.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('one customer, parallel bookings on different specific devices at the same time → one booking', async () => {
    const [t] = await customers(1);
    const start = at(8, 19);
    const res = await Promise.all(C.devices.map((d) => book(t, { branch_id: C.branchId, start_at: start, duration_minutes: 60, items: [{ device_id: d }], payment_mode: 'AT_CLUB' })));
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of res.filter((x) => x.status !== 201)) expect({ status: r.status, reason: r.body.error.details?.reason }).toEqual({ status: 409, reason: 'OVERLAP' });
  });

  it('an expired hold is released exactly once under a race; one newcomer wins', async () => {
    const [holder, ...others] = await customers(9);
    const start = at(5, 12);
    const body = { branch_id: C.branchId, start_at: start, duration_minutes: 60, items: [{ device_id: C.devices[0] }] };
    const held = await book(holder, body).expect(201);
    await prisma.bookings.update({ where: { id: held.body.data.id }, data: { hold_expires_at: new Date(Date.now() - 1000) } });
    const res = await Promise.all(others.map((t) => book(t, body)));
    expect(res.filter((r) => r.status === 201)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(others.length - 1);
    const old = await prisma.bookings.findUniqueOrThrow({ where: { id: held.body.data.id } });
    expect(old.status).toBe('EXPIRED');
    expect(await prisma.booking_events.count({ where: { booking_id: old.id, type: 'EXPIRED' } })).toBe(1);
    expect(await activeItems(C.devices[0], start, at(5, 13))).toBe(1);
  });

  it('two bookings rescheduled into the same free slot in parallel → one 201, one 409', async () => {
    const [t1, t2] = await customers(2);
    const b1 = await book(t1, { branch_id: C.branchId, start_at: at(6, 10), duration_minutes: 60, items: [{ device_id: C.devices[1] }], payment_mode: 'AT_CLUB' }).expect(201);
    const b2 = await book(t2, { branch_id: C.branchId, start_at: at(6, 14), duration_minutes: 60, items: [{ device_id: C.devices[1] }], payment_mode: 'AT_CLUB' }).expect(201);
    const target = at(6, 12);
    const res = await Promise.all([
      h.http.post(api(`/bookings/${b1.body.data.id}/reschedule`)).set(bearer(t1)).send({ start_at: target }),
      h.http.post(api(`/bookings/${b2.body.data.id}/reschedule`)).set(bearer(t2)).send({ start_at: target }),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(res.find((r) => r.status === 409)!.body.error.code).toBe('BOOKING_SLOT_TAKEN');
    expect(await activeItems(C.devices[1], target, at(6, 13))).toBe(1);
    // Yutqazgan bron o'z joyida qolgan
    const loser = res[0].status === 409 ? b1 : b2;
    const d = await prisma.bookings.findUniqueOrThrow({ where: { id: loser.body.data.id } });
    expect(d.start_at.toISOString()).toBe(loser.body.data.start_at);
    expect(d.reschedule_count).toBe(0);
  });

  it('parallel retries with the same Idempotency-Key create exactly one booking', async () => {
    const [t] = await customers(1);
    const key = crypto.randomUUID();
    const body = { branch_id: C.branchId, start_at: at(7, 12), duration_minutes: 60, items: [{ device_id: C.devices[0] }] };
    const res = await Promise.all([1, 2, 3, 4, 5].map(() => h.http.post(api('/bookings')).set(bearer(t)).set('Idempotency-Key', key).send(body)));
    const ok = res.filter((r) => r.status === 201);
    expect(ok).toHaveLength(1);
    for (const r of res.filter((x) => x.status !== 201)) expect({ status: r.status, code: r.body.error.code }).toEqual({ status: 409, code: 'CONFLICT' });
    expect(await prisma.bookings.count({ where: { idempotency_key: key } })).toBe(1);
    expect(await prisma.bookings.count({ where: { customer_id: ok[0].body.data.customer_id } })).toBe(1);
  });
});
