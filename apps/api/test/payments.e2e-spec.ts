import { randomUUID } from 'crypto';
import { PrismaService } from '../src/database/prisma.service';
import { api, bearer, Harness, slot, TestClub } from './utils/harness';
import { isolateOtpRateLimit } from './utils/otp-ip';

/**
 * To'lovlar (docs/01-API.md §6.10): naqd/terminal (smena), qisman/ortiqcha to'lov, refund (to'liq/qisman, limit),
 * refund ro'yxati/yakunlash, Idempotency-Key, parallel refund, klub/mijoz scope, pul doim butun tiyin.
 */
describe('Payments (e2e)', () => {
  const h = isolateOtpRateLimit(new Harness());
  let prisma: PrismaService;
  let A: TestClub;
  let B: TestClub;
  let operator: string;
  let minutes = 120;
  let deviceIdx = 0;
  const PRICE = 1_200_000;

  const book = async (customerToken?: string) => {
    const token = customerToken ?? (await h.customer()).token;
    const device = A.devices[deviceIdx++ % A.devices.length];
    if (deviceIdx % A.devices.length === 0) minutes += 90;
    const r = await h.http
      .post(api('/bookings'))
      .set(bearer(token))
      .send({ branch_id: A.branchId, start_at: slot(minutes), duration_minutes: 60, items: [{ device_id: device }] })
      .expect(201);
    return { customer: token, booking: r.body.data as { id: string; total_amount: number; status: string } };
  };
  const bookingOf = async (id: string) => (await h.http.get(api(`/bookings/${id}`)).set(bearer(A.owner)).expect(200)).body.data;
  const paymentOf = async (id: string, token = A.owner) => (await h.http.get(api(`/payments/${id}`)).set(bearer(token)).expect(200)).body.data;
  /** Onlayn (DEMO) to'langan bron. */
  const paidOnline = async () => {
    const { customer, booking } = await book();
    const co = (await h.http.post(api('/payments')).set(bearer(customer)).send({ booking_id: booking.id, provider: 'DEMO' }).expect(201)).body.data;
    await h.http.post(api(`/payments/${co.payment_id}/demo/confirm`)).set(bearer(customer)).send({ success: true }).expect(201);
    return { customer, booking, paymentId: co.payment_id as string, amount: co.amount as number };
  };
  const cash = (token: string, body: Record<string, unknown>, key?: string) => {
    const req = h.http.post(api('/payments/cash')).set(bearer(token));
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const refund = (paymentId: string, body: Record<string, unknown>, token = A.owner, key?: string) => {
    const req = h.http.post(api(`/payments/${paymentId}/refund`)).set(bearer(token));
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const expectIntegers = (o: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) if (o[k] !== null && o[k] !== undefined) expect(Number.isInteger(o[k])).toBe(true);
  };

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    [A, B] = await Promise.all([h.club({ devices: 6, pricePerHour: PRICE }), h.club({ devices: 1, pricePerHour: PRICE })]);
    operator = (await h.staff(A, 'OPERATOR', A.branchId)).token;
    await h.openShift(A.owner, A.branchId, 100_000);
    await h.openShift(B.owner, B.branchId);
  });

  afterAll(async () => {
    const cur = await h.http.get(api('/shifts/current')).set(bearer(operator));
    if (cur.body?.data?.id) await h.http.post(api(`/shifts/${cur.body.data.id}/close`)).set(bearer(operator)).send({ counted_cash: 0 });
    await h.stop();
  });

  describe('cash / terminal', () => {
    it('requires an open shift', async () => {
      const { booking } = await book();
      const r = await cash(operator, { booking_id: booking.id, method: 'CASH' }).expect(409);
      expect(r.body.error.details.reason).toBe('SHIFT_REQUIRED');
      expect((await bookingOf(booking.id)).paid_amount).toBe(0);

      await h.openShift(operator, A.branchId);
      const ok = await cash(operator, { booking_id: booking.id, method: 'TERMINAL' }).expect(201);
      expect(ok.body.data).toMatchObject({ status: 'PAID', method: 'TERMINAL', provider: 'MANUAL', amount: booking.total_amount, commission_amount: 0, club_amount: booking.total_amount });
    });

    it('partial payment keeps the hold; paying the rest confirms the booking', async () => {
      const { booking } = await book();
      const part = await cash(A.owner, { booking_id: booking.id, method: 'CASH', amount: 500_000 }).expect(201);
      expect(part.body.data).toMatchObject({ amount: 500_000, status: 'PAID' });
      expect(await bookingOf(booking.id)).toMatchObject({ status: 'PENDING_PAYMENT', payment_status: 'PARTIAL', paid_amount: 500_000 });

      const rest = await cash(A.owner, { booking_id: booking.id, method: 'CASH' }).expect(201);
      expect(rest.body.data.amount).toBe(booking.total_amount - 500_000);
      const b = await bookingOf(booking.id);
      expect(b).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID', paid_amount: booking.total_amount, hold_expires_at: null });
      expectIntegers(b, ['paid_amount', 'total_amount']);
    });

    it('rejects over-payment and paying an already paid booking', async () => {
      const { booking } = await book();
      await cash(A.owner, { booking_id: booking.id, method: 'CASH', amount: booking.total_amount + 1 }).expect(422);
      await cash(A.owner, { booking_id: booking.id, method: 'CASH', amount: 200_000 }).expect(201);
      // Qolgan qarzdan ko'p — rad etiladi
      await cash(A.owner, { booking_id: booking.id, method: 'CASH', amount: booking.total_amount }).expect(422);
      await cash(A.owner, { booking_id: booking.id, method: 'CASH' }).expect(201);
      const paid = await cash(A.owner, { booking_id: booking.id, method: 'CASH' }).expect(409);
      expect(paid.body.error.code).toBe('PAYMENT_ALREADY_PAID');
      await cash(A.owner, { booking_id: booking.id, method: 'CASH', amount: 1 }).expect(409);
      expect((await bookingOf(booking.id)).paid_amount).toBe(booking.total_amount);
      expect(await prisma.payments.count({ where: { booking_id: booking.id, status: 'PAID' } })).toBe(2);
    });

    it('parallel cash payments for the same booking never exceed the amount due', async () => {
      const { booking } = await book();
      const results = await Promise.all(Array.from({ length: 4 }, () => cash(A.owner, { booking_id: booking.id, method: 'CASH' })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      for (const r of results.filter((x) => x.status !== 201)) expect(r.body.error.code).toBe('PAYMENT_ALREADY_PAID');
      expect(await bookingOf(booking.id)).toMatchObject({ paid_amount: booking.total_amount, payment_status: 'PAID' });
      expect(await prisma.payments.count({ where: { booking_id: booking.id } })).toBe(1);
    });

    it('money must be a positive integer number of tiyin', async () => {
      const { booking } = await book();
      for (const amount of [100.5, 0, -100, 'abc']) await cash(A.owner, { booking_id: booking.id, method: 'CASH', amount }).expect(422);
      await cash(A.owner, { booking_id: booking.id, method: 'CARD' }).expect(422);
      await cash(A.owner, { method: 'CASH' }).expect(422);
      expect(await prisma.payments.count({ where: { booking_id: booking.id } })).toBe(0);
    });

    it('cannot take payment for a cancelled booking', async () => {
      const { customer, booking } = await book();
      await h.http.post(api(`/bookings/${booking.id}/cancel`)).set(bearer(customer)).send({}).expect(201);
      await cash(A.owner, { booking_id: booking.id, method: 'CASH' }).expect(409);
    });

    it('Idempotency-Key: same key → same payment, no duplicate money; other body → IDEMPOTENCY_CONFLICT', async () => {
      const { booking } = await book();
      const key = randomUUID();
      const body = { booking_id: booking.id, method: 'CASH', amount: 300_000 };
      const first = await cash(A.owner, body, key).expect(201);
      const second = await cash(A.owner, body, key).expect(201);
      expect(second.body.data.id).toBe(first.body.data.id);
      expect(second.body.data.amount).toBe(300_000);
      const conflict = await cash(A.owner, { ...body, amount: 400_000 }, key).expect(409);
      expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(await prisma.payments.count({ where: { booking_id: booking.id } })).toBe(1);
      expect((await bookingOf(booking.id)).paid_amount).toBe(300_000);
      // Boshqa key — yangi to'lov
      await cash(A.owner, body, randomUUID()).expect(201);
      expect((await bookingOf(booking.id)).paid_amount).toBe(600_000);
    });

    it('shift report: expected cash = opening + cash in − cash refunds', async () => {
      const { booking } = await book();
      const before = (await h.http.get(api('/shifts/current')).set(bearer(A.owner)).expect(200)).body.data;
      const p = (await cash(A.owner, { booking_id: booking.id, method: 'CASH' }).expect(201)).body.data;
      await refund(p.id, { amount: 200_000, reason: 'qisman' }).expect(201);
      const after = (await h.http.get(api('/shifts/current')).set(bearer(A.owner)).expect(200)).body.data;
      expect(after.totals.cash_in - before.totals.cash_in).toBe(booking.total_amount);
      expect(after.totals.cash_refunds - before.totals.cash_refunds).toBe(200_000);
      expect(after.totals.expected_cash).toBe(after.opening_cash + after.totals.cash_in - after.totals.cash_refunds);
      expectIntegers(after.totals, ['cash_in', 'terminal_in', 'cash_refunds', 'expected_cash']);
    });
  });

  describe('refunds', () => {
    it('full refund of an online payment', async () => {
      const { booking, paymentId, amount } = await paidOnline();
      const r = await refund(paymentId, { reason: 'Mijoz so\'radi' }).expect(201);
      expect(r.body.data).toMatchObject({ status: 'COMPLETED', amount, payment_id: paymentId, booking_id: booking.id });
      expect(await paymentOf(paymentId)).toMatchObject({ status: 'REFUNDED', refunded_amount: amount });
      expect(await bookingOf(booking.id)).toMatchObject({ payment_status: 'REFUNDED', paid_amount: 0, refund_amount: amount });
      const again = await refund(paymentId, { reason: 'yana' }).expect(409);
      expect(again.body.error).toMatchObject({ code: 'REFUND_NOT_ALLOWED', details: { refundable: 0 } });
    });

    it('partial refunds cannot exceed what was paid', async () => {
      const { booking, paymentId, amount } = await paidOnline();
      await refund(paymentId, { amount: 300_000, reason: 'qisman' }).expect(201);
      expect(await paymentOf(paymentId)).toMatchObject({ status: 'PARTIALLY_REFUNDED', refunded_amount: 300_000 });
      expect(await bookingOf(booking.id)).toMatchObject({ payment_status: 'PARTIALLY_REFUNDED', paid_amount: amount - 300_000 });

      const over = await refund(paymentId, { amount: amount, reason: 'ko\'p' }).expect(409);
      expect(over.body.error).toMatchObject({ code: 'REFUND_NOT_ALLOWED', details: { refundable: amount - 300_000 } });
      await refund(paymentId, { amount: 1.5, reason: 'kasr' }).expect(422);
      await refund(paymentId, { amount: 0, reason: 'nol' }).expect(422);
      await refund(paymentId, { amount: -1, reason: 'manfiy' }).expect(422);

      await refund(paymentId, { amount: amount - 300_000, reason: 'qolgani' }).expect(201);
      const p = await paymentOf(paymentId);
      expect(p).toMatchObject({ status: 'REFUNDED', refunded_amount: amount });
      expect(p.refunds.map((x: { amount: number }) => x.amount).sort()).toEqual([300_000, amount - 300_000].sort());
      expect(await bookingOf(booking.id)).toMatchObject({ payment_status: 'REFUNDED', paid_amount: 0 });
    });

    it('unpaid (pending checkout) payment cannot be refunded', async () => {
      const { customer, booking } = await book();
      const co = (await h.http.post(api('/payments')).set(bearer(customer)).send({ booking_id: booking.id, provider: 'DEMO' }).expect(201)).body.data;
      await refund(co.payment_id, { reason: 'x' }).expect(409);
      await refund(randomUUID(), { reason: 'x' }).expect(404);
    });

    it('Idempotency-Key on refund: same key → same refund, money returned once', async () => {
      const { paymentId } = await paidOnline();
      const key = randomUUID();
      const body = { amount: 250_000, reason: 'idem' };
      const a = await refund(paymentId, body, A.owner, key).expect(201);
      const b = await refund(paymentId, body, A.owner, key).expect(201);
      expect(b.body.data.id).toBe(a.body.data.id);
      expect((await refund(paymentId, { ...body, amount: 1 }, A.owner, key).expect(409)).body.error.code).toBe('IDEMPOTENCY_CONFLICT');
      const p = await paymentOf(paymentId);
      expect(p.refunded_amount).toBe(250_000);
      expect(p.refunds).toHaveLength(1);
    });

    it('parallel partial refunds never exceed the paid amount', async () => {
      const { booking, paymentId, amount } = await paidOnline();
      const part = 400_000;
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) => refund(paymentId, { amount: part, reason: `parallel ${i}` })));
      const ok = results.filter((r) => r.status === 201);
      expect(ok).toHaveLength(Math.floor(amount / part));
      for (const r of results.filter((x) => x.status !== 201)) expect(r.body.error.code).toBe('REFUND_NOT_ALLOWED');
      const p = await paymentOf(paymentId);
      expect(p.refunded_amount).toBe(ok.length * part);
      expect(p.refunds.reduce((s: number, r: { amount: number }) => s + r.amount, 0)).toBe(p.refunded_amount);
      expect(p.refunded_amount).toBeLessThanOrEqual(amount);
      const b = await bookingOf(booking.id);
      expect(b.paid_amount).toBe(amount - p.refunded_amount);
    });

    it('parallel full refunds: exactly one succeeds', async () => {
      const { paymentId, amount } = await paidOnline();
      const results = await Promise.all(Array.from({ length: 4 }, () => refund(paymentId, { reason: 'full parallel' })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      const p = await paymentOf(paymentId);
      expect(p).toMatchObject({ status: 'REFUNDED', refunded_amount: amount });
      expect(p.refunds).toHaveLength(1);
      // Ledger: mijozga qaytarilgan jami = to'langan summa
      const refundIds = p.refunds.map((r: { id: string }) => r.id);
      const credit = await prisma.ledger_entries.aggregate({ where: { ref_type: 'refund', ref_id: { in: refundIds }, account: 'CUSTOMER', direction: 'CREDIT' }, _sum: { amount: true } });
      expect(Number(credit._sum.amount)).toBe(amount);
    });

    it('operator (no payments.refund) cannot refund or list refunds', async () => {
      const { paymentId } = await paidOnline();
      await refund(paymentId, { reason: 'x' }, operator).expect(403);
      await h.http.get(api('/refunds')).set(bearer(operator)).expect(403);
    });

    it('card-transfer refund is PENDING: listed for the club, completed once, invisible to other clubs', async () => {
      await h.http.patch(api(`/clubs/${A.clubId}/settings`)).set(bearer(A.owner)).send({ transfer_card: { number: '8600123412345678', holder: 'Test Owner' } }).expect(200);
      const { customer, booking } = await book();
      const t = await h.http.post(api('/payments/transfer')).set(bearer(customer)).send({ booking_id: booking.id, payer_card_last4: '4321' }).expect(201);
      await h.http.post(api(`/payments/${t.body.data.id}/transfer/confirm`)).set(bearer(A.owner)).expect(201);
      const rf = (await refund(t.body.data.id, { amount: 400_000, reason: 'qaytarish' }).expect(201)).body.data;
      expect(rf).toMatchObject({ status: 'PENDING', amount: 400_000, completed_at: null });

      const list = await h.http.get(api('/refunds')).query({ status: 'PENDING', club_id: A.clubId, limit: 100 }).set(bearer(A.owner)).expect(200);
      const row = list.body.data.find((r: { id: string }) => r.id === rf.id);
      expect(row).toMatchObject({ payment: { id: t.body.data.id, method: 'CARD_TRANSFER' }, booking: { id: booking.id } });
      expect(row.customer).toBeTruthy();
      expect(list.body.data.every((r: { club_id: string; status: string }) => r.club_id === A.clubId && r.status === 'PENDING')).toBe(true);

      const other = await h.http.get(api('/refunds')).query({ limit: 100 }).set(bearer(B.owner)).expect(200);
      expect(other.body.data.some((r: { id: string }) => r.id === rf.id)).toBe(false);
      // club_id filtri bilan ham begona klub ko'rinmaydi
      const sneaky = await h.http.get(api('/refunds')).query({ club_id: A.clubId, limit: 100 }).set(bearer(B.owner)).expect(200);
      expect(sneaky.body.data).toHaveLength(0);
      await h.http.post(api(`/refunds/${rf.id}/complete`)).set(bearer(B.owner)).send({}).expect(404);

      const done = await h.http.post(api(`/refunds/${rf.id}/complete`)).set(bearer(A.owner)).send({ reference: 'CHK-1' }).expect(201);
      expect(done.body.data).toMatchObject({ status: 'COMPLETED', provider_refund_id: 'CHK-1' });
      expect(done.body.data.completed_at).toBeTruthy();
      await h.http.post(api(`/refunds/${rf.id}/complete`)).set(bearer(A.owner)).send({}).expect(409);
      await h.http.post(api(`/refunds/${randomUUID()}/complete`)).set(bearer(A.owner)).send({}).expect(404);
      const completed = await h.http.get(api('/refunds')).query({ status: 'COMPLETED', club_id: A.clubId, limit: 100 }).set(bearer(A.owner)).expect(200);
      expect(completed.body.data.some((r: { id: string }) => r.id === rf.id)).toBe(true);
    });
  });

  describe('scope', () => {
    it('club B staff cannot view, refund or take cash for club A payments', async () => {
      const { booking, paymentId } = await paidOnline();
      await h.http.get(api(`/payments/${paymentId}`)).set(bearer(B.owner)).expect(404);
      await refund(paymentId, { amount: 1, reason: 'x' }, B.owner).expect(404);
      await cash(B.owner, { booking_id: booking.id, method: 'CASH' }).expect(404);

      const list = await h.http.get(api('/payments')).query({ limit: 100 }).set(bearer(B.owner)).expect(200);
      expect(list.body.data.every((p: { club_id: string }) => p.club_id === B.clubId)).toBe(true);
      const filtered = await h.http.get(api('/payments')).query({ club_id: A.clubId }).set(bearer(B.owner)).expect(200);
      expect(filtered.body.meta.total).toBe(0);
      expect(filtered.body.meta.summary).toEqual({ collected: 0, refunded: 0, commission: 0 });
      expect((await paymentOf(paymentId)).refunded_amount).toBe(0);
    });

    it('club A staff list shows only club A with integer summary', async () => {
      const { paymentId } = await paidOnline();
      const list = await h.http.get(api('/payments')).query({ club_id: A.clubId, limit: 100 }).set(bearer(A.owner)).expect(200);
      expect(list.body.data.some((p: { id: string }) => p.id === paymentId)).toBe(true);
      expect(list.body.data.every((p: { club_id: string }) => p.club_id === A.clubId)).toBe(true);
      for (const v of Object.values(list.body.meta.summary)) expect(Number.isInteger(v)).toBe(true);
      for (const p of list.body.data) expectIntegers(p, ['amount', 'refunded_amount', 'commission_amount', 'club_amount']);
      // Filial operatori ham o'z filiali to'lovini ko'radi
      await h.http.get(api(`/payments/${paymentId}`)).set(bearer(operator)).expect(200);
    });

    it('customer sees only own payments', async () => {
      const { customer, paymentId } = await paidOnline();
      const own = await paymentOf(paymentId, customer);
      expect(own).toMatchObject({ id: paymentId, status: 'PAID' });
      expect(own.booking).toBeTruthy();
      const stranger = await h.customer();
      await h.http.get(api(`/payments/${paymentId}`)).set(bearer(stranger.token)).expect(404);
      await h.http.get(api('/payments')).set(bearer(customer)).expect(403);
      await refund(paymentId, { reason: 'o\'zim' }, customer).expect(403);
      await cash(customer, { booking_id: own.booking.id, method: 'CASH' }).expect(403);
    });
  });
});
