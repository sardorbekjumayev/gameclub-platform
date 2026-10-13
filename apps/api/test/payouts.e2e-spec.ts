import { randomUUID } from 'crypto';
import { PrismaService } from '../src/database/prisma.service';
import { api, bearer, Harness, slot, TestClub } from './utils/harness';
import { isolateOtpRateLimit } from './utils/otp-ip';

/**
 * Klub payout'lari (docs/01-API.md §6.18, V1): davr bo'yicha online tushum − komissiya − refundlar.
 * Naqd payout'ga kirmaydi; takroriy davr o'tkazib yuboriladi; mark-paid/cancel; klub faqat o'zini ko'radi.
 * Hisoblash har doim `club_id` bilan — umumiy bazadagi boshqa klublarga payout yaratmaslik uchun.
 */
describe('Payouts (e2e)', () => {
  const h = isolateOtpRateLimit(new Harness());
  let prisma: PrismaService;
  let P: TestClub;
  let Q: TestClub;
  let R: TestClub;
  let periodStart: string;
  let periodEnd: string;
  let minutes = 120;
  const PRICE = 1_200_000;
  const expected = { gross: 0, commission: 0, refunds: 0 };

  const bookIn = async (c: TestClub, idx: number) => {
    const customer = await h.customer();
    const r = await h.http
      .post(api('/bookings'))
      .set(bearer(customer.token))
      .send({ branch_id: c.branchId, start_at: slot((minutes += 90)), duration_minutes: 60, items: [{ device_id: c.devices[idx % c.devices.length] }] })
      .expect(201);
    return { customer: customer.token, bookingId: r.body.data.id as string };
  };
  const payOnline = async (c: TestClub, idx: number) => {
    const { customer, bookingId } = await bookIn(c, idx);
    const co = (await h.http.post(api('/payments')).set(bearer(customer)).send({ booking_id: bookingId, provider: 'DEMO' }).expect(201)).body.data;
    await h.http.post(api(`/payments/${co.payment_id}/demo/confirm`)).set(bearer(customer)).send({ success: true }).expect(201);
    return (await h.http.get(api(`/payments/${co.payment_id}`)).set(bearer(c.owner)).expect(200)).body.data as { id: string; amount: number; commission_amount: number };
  };
  const calculate = (body: Record<string, unknown>, token = h.admin, key?: string) => {
    const req = h.http.post(api('/admin/payouts/calculate')).set(bearer(token));
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const activePayouts = (clubId: string) => prisma.club_payouts.count({ where: { club_id: clubId, status: { not: 'CANCELLED' } } });

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    [P, Q, R] = await Promise.all([h.club({ devices: 3, pricePerHour: PRICE }), h.club({ devices: 1, pricePerHour: PRICE }), h.club({ devices: 1, pricePerHour: PRICE })]);
    periodStart = new Date(Date.now() - 1000).toISOString();

    // P: ikki online to'lov, bittasi qisman qaytarilgan, bitta naqd (payout'ga kirmaydi)
    for (let i = 0; i < 2; i++) {
      const p = await payOnline(P, i);
      expected.gross += p.amount;
      expected.commission += p.commission_amount;
      if (i === 0) {
        await h.http.post(api(`/payments/${p.id}/refund`)).set(bearer(P.owner)).send({ amount: 200_000, reason: 'payout test' }).expect(201);
        expected.refunds += 200_000;
      }
    }
    await h.openShift(P.owner, P.branchId);
    const cashBooking = await bookIn(P, 2);
    await h.http.post(api('/payments/cash')).set(bearer(P.owner)).send({ booking_id: cashBooking.bookingId, method: 'CASH' }).expect(201);
    // Q: bitta online to'lov; R: faqat naqd
    await payOnline(Q, 0);
    await h.openShift(R.owner, R.branchId);
    const rb = await bookIn(R, 0);
    await h.http.post(api('/payments/cash')).set(bearer(R.owner)).send({ booking_id: rb.bookingId, method: 'CASH' }).expect(201);

    periodEnd = new Date().toISOString();
  });

  afterAll(() => h.stop());

  it('calculates net = gross − commission − refunds from online payments only (integer tiyin)', async () => {
    const r = await calculate({ period_start: periodStart, period_end: periodEnd, club_id: P.clubId }).expect(201);
    expect(r.body.data.created).toBe(1);
    expect(r.body.data.skipped).toEqual([]);
    const item = r.body.data.items.find((x: { club_id: string }) => x.club_id === P.clubId);
    expect(item).toMatchObject({
      status: 'PENDING', club_name: expect.any(String),
      gross_amount: expected.gross, commission_amount: expected.commission, refunds_amount: expected.refunds,
      net_amount: expected.gross - expected.commission - expected.refunds,
      period_start: periodStart, period_end: periodEnd,
    });
    expect(expected.gross).toBe(2 * PRICE);
    for (const k of ['gross_amount', 'commission_amount', 'refunds_amount', 'net_amount']) expect(Number.isInteger(item[k])).toBe(true);
    expect(await prisma.audit_logs.count({ where: { action: 'admin.payouts.calculate', new_value: { path: ['club_id'], equals: P.clubId } } })).toBeGreaterThanOrEqual(1);
  });

  it('repeating the same (or an overlapping) period is skipped', async () => {
    const again = await calculate({ period_start: periodStart, period_end: periodEnd, club_id: P.clubId }).expect(201);
    expect(again.body.data).toMatchObject({ created: 0, items: [], skipped: [{ club_id: P.clubId, reason: 'OVERLAPPING_PAYOUT' }] });
    const mid = new Date((new Date(periodStart).getTime() + new Date(periodEnd).getTime()) / 2).toISOString();
    const overlap = await calculate({ period_start: mid, period_end: new Date().toISOString(), club_id: P.clubId }).expect(201);
    expect(overlap.body.data.created).toBe(0);
    expect(await activePayouts(P.clubId)).toBe(1);
  });

  it('cash-only club gets no payout', async () => {
    const r = await calculate({ period_start: periodStart, period_end: periodEnd, club_id: R.clubId }).expect(201);
    expect(r.body.data).toMatchObject({ created: 0, items: [], skipped: [] });
    expect(await prisma.club_payouts.count({ where: { club_id: R.clubId } })).toBe(0);
  });

  it('validates the period', async () => {
    await calculate({ period_start: periodEnd, period_end: periodStart, club_id: P.clubId }).expect(422);
    await calculate({ period_start: periodStart, period_end: periodStart, club_id: P.clubId }).expect(422);
    await calculate({ period_start: periodStart, period_end: new Date(Date.now() + 3600_000).toISOString(), club_id: P.clubId }).expect(422);
    await calculate({ period_start: 'yesterday', period_end: periodEnd }).expect(422);
    await calculate({ period_start: periodStart, period_end: periodEnd, club_id: 'not-a-uuid' }).expect(422);
  });

  it('club sees only its own payouts; other clubs and non-platform users are forbidden', async () => {
    const own = await h.http.get(api(`/clubs/${P.clubId}/payouts`)).set(bearer(P.owner)).expect(200);
    expect(own.body.data.length).toBeGreaterThanOrEqual(1);
    expect(own.body.data.every((x: { club_id: string }) => x.club_id === P.clubId)).toBe(true);
    expect(Number.isInteger(own.body.meta.summary.pending)).toBe(true);
    expect(own.body.meta.summary.pending).toBe(expected.gross - expected.commission - expected.refunds);

    await h.http.get(api(`/clubs/${P.clubId}/payouts`)).set(bearer(Q.owner)).expect(403);
    // query club_id marshrutdagi klubni almashtira olmaydi
    const sneaky = await h.http.get(api(`/clubs/${Q.clubId}/payouts`)).query({ club_id: P.clubId }).set(bearer(Q.owner)).expect(200);
    expect(sneaky.body.data.every((x: { club_id: string }) => x.club_id === Q.clubId)).toBe(true);

    const customer = await h.customer();
    for (const token of [P.owner, customer.token]) {
      await h.http.get(api('/admin/payouts')).set(bearer(token)).expect(403);
      await calculate({ period_start: periodStart, period_end: periodEnd, club_id: P.clubId }, token).expect(403);
      await h.http.post(api(`/admin/payouts/${randomUUID()}/mark-paid`)).set(bearer(token)).send({ reference: 'x' }).expect(403);
      await h.http.post(api(`/admin/payouts/${randomUUID()}/cancel`)).set(bearer(token)).expect(403);
    }
    await h.http.get(api(`/clubs/${P.clubId}/payouts`)).set(bearer(customer.token)).expect(403);

    const adminList = await h.http.get(api('/admin/payouts')).query({ club_id: P.clubId }).set(bearer(h.admin)).expect(200);
    expect(adminList.body.data.length).toBeGreaterThanOrEqual(1);
    expect(adminList.body.data.every((x: { club_id: string }) => x.club_id === P.clubId)).toBe(true);
  });

  it('mark-paid once; paid payout cannot be cancelled or paid again', async () => {
    const payout = await prisma.club_payouts.findFirstOrThrow({ where: { club_id: P.clubId, status: 'PENDING' } });
    const r = await h.http.post(api(`/admin/payouts/${payout.id}/mark-paid`)).set(bearer(h.admin)).send({ reference: 'PP-2026-001' }).expect(201);
    expect(r.body.data).toMatchObject({ status: 'PAID', reference: 'PP-2026-001' });
    expect(r.body.data.paid_at).toBeTruthy();
    await h.http.post(api(`/admin/payouts/${payout.id}/mark-paid`)).set(bearer(h.admin)).send({ reference: 'again' }).expect(409);
    await h.http.post(api(`/admin/payouts/${payout.id}/cancel`)).set(bearer(h.admin)).expect(409);
    await h.http.post(api(`/admin/payouts/${randomUUID()}/mark-paid`)).set(bearer(h.admin)).send({ reference: 'x' }).expect(404);
    await h.http.post(api(`/admin/payouts/${payout.id}/mark-paid`)).set(bearer(h.admin)).send({}).expect(422);
    expect(await prisma.audit_logs.count({ where: { action: 'admin.payout.paid', target_id: payout.id } })).toBe(1);

    const list = await h.http.get(api(`/clubs/${P.clubId}/payouts`)).query({ status: 'PAID' }).set(bearer(P.owner)).expect(200);
    expect(list.body.data.map((x: { id: string }) => x.id)).toContain(payout.id);
    expect(list.body.meta.summary.paid).toBe(Number(payout.net_amount));
  });

  it('cancel frees the period for recalculation; Idempotency-Key replays the same result', async () => {
    const first = await calculate({ period_start: periodStart, period_end: periodEnd, club_id: Q.clubId }).expect(201);
    expect(first.body.data.created).toBe(1);
    const id = first.body.data.items[0].id;
    const c = await h.http.post(api(`/admin/payouts/${id}/cancel`)).set(bearer(h.admin)).expect(201);
    expect(c.body.data.status).toBe('CANCELLED');
    await h.http.post(api(`/admin/payouts/${id}/cancel`)).set(bearer(h.admin)).expect(409);
    await h.http.post(api(`/admin/payouts/${id}/mark-paid`)).set(bearer(h.admin)).send({ reference: 'x' }).expect(409);

    const key = randomUUID();
    const body = { period_start: periodStart, period_end: periodEnd, club_id: Q.clubId };
    const a = await calculate(body, h.admin, key).expect(201);
    expect(a.body.data.created).toBe(1);
    const b = await calculate(body, h.admin, key).expect(201);
    expect(b.body.data).toEqual(a.body.data);
    expect(await activePayouts(Q.clubId)).toBe(1);
    expect(a.body.data.items[0]).toMatchObject({ club_id: Q.clubId, gross_amount: PRICE, refunds_amount: 0 });
    expect(a.body.data.items[0].net_amount).toBe(PRICE - a.body.data.items[0].commission_amount);
  });
});
