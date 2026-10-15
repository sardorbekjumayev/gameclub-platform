import { PROVIDER_ENV, restoreProviderEnv } from './utils/payment-providers.env';
import { createHash, createHmac, randomUUID } from 'crypto';
import { PrismaService } from '../src/database/prisma.service';
import { api, bearer, Harness, slot, TestClub } from './utils/harness';
import { isolateOtpRateLimit } from './utils/otp-ip';

/**
 * Online to'lov webhooklari (docs/01-API.md §6.10): DEMO (X-Signature HMAC), Payme JSON-RPC, Click prepare/complete.
 * Imzo/auth tekshiruvi, bron tasdiqlanishi, takroriy webhook ikki marta pul yozmasligi, payment-after-expiry.
 */
describe('Payment webhooks (e2e)', () => {
  const h = isolateOtpRateLimit(new Harness());
  let prisma: PrismaService;
  let club: TestClub;
  let otherClub: TestClub;
  let minutes = 120;
  let deviceIdx = 0;

  const PRICE = 1_200_000;

  /** Har chaqiriqda yangi mijoz va takrorlanmaydigan (qurilma, vaqt) — hold limitiga va bandlikka urilmaslik uchun. */
  const book = async (c: TestClub = club) => {
    const customer = await h.customer();
    const device = c.devices[deviceIdx++ % c.devices.length];
    if (deviceIdx % c.devices.length === 0) minutes += 90;
    const r = await h.http
      .post(api('/bookings'))
      .set(bearer(customer.token))
      .send({ branch_id: c.branchId, start_at: slot(minutes), duration_minutes: 60, items: [{ device_id: device }] })
      .expect(201);
    expect(r.body.data.status).toBe('PENDING_PAYMENT');
    return { customer: customer.token, booking: r.body.data as { id: string; total_amount: number; start_at: string }, device };
  };
  const checkout = async (token: string, bookingId: string, provider: 'DEMO' | 'PAYME' | 'CLICK') =>
    (await h.http.post(api('/payments')).set(bearer(token)).send({ booking_id: bookingId, provider }).expect(201)).body.data as { payment_id: string; amount: number; checkout_url: string };
  const bookingOf = async (token: string, id: string) => (await h.http.get(api(`/bookings/${id}`)).set(bearer(token)).expect(200)).body.data;
  const paymentOf = async (token: string, id: string) => (await h.http.get(api(`/payments/${id}`)).set(bearer(token)).expect(200)).body.data;
  const ledgerCount = (paymentId: string) => prisma.ledger_entries.count({ where: { ref_type: 'payment', ref_id: paymentId } });

  // ---------- DEMO ----------
  const demoSign = (raw: string) => createHmac('sha256', process.env.QR_HMAC_SECRET!).update(`demo:${raw}`).digest('hex');
  const demoHook = (body: Record<string, unknown>, sig?: string) => {
    const raw = JSON.stringify(body);
    const req = h.http.post(api('/webhooks/payments/demo')).set('Content-Type', 'application/json');
    if (sig !== '') req.set('X-Signature', sig ?? demoSign(raw));
    return req.send(raw);
  };

  // ---------- Payme ----------
  const paymeAuth = `Basic ${Buffer.from(`Paycom:${PROVIDER_ENV.PAYME_KEY}`).toString('base64')}`;
  const payme = async (method: string, params: Record<string, unknown>, auth: string | null = paymeAuth) => {
    const req = h.http.post(api('/webhooks/payments/payme'));
    if (auth) req.set('Authorization', auth);
    const r = await req.send({ jsonrpc: '2.0', id: 1, method, params }).expect(200);
    return r.body as { result?: Record<string, unknown>; error?: { code: number; data?: string } };
  };
  const paymeTxId = () => randomUUID().replace(/-/g, '').slice(0, 24);

  // ---------- Click ----------
  const md5 = (s: string) => createHash('md5').update(s).digest('hex');
  const clickForm = (action: '0' | '1', paymentId: string, amountSom: string, extra: Record<string, string> = {}) => {
    const f: Record<string, string> = {
      click_trans_id: extra.click_trans_id ?? clickTxId(),
      service_id: PROVIDER_ENV.CLICK_SERVICE_ID, click_paydoc_id: '777001', merchant_trans_id: paymentId, amount: amountSom, action, error: '0', error_note: 'Success', sign_time: '2026-10-13 12:00:00',
      ...extra,
    };
    f.sign_string = extra.sign_string ?? md5(`${f.click_trans_id}${f.service_id}${PROVIDER_ENV.CLICK_SECRET_KEY}${f.merchant_trans_id}${action === '1' ? f.merchant_prepare_id ?? '' : ''}${f.amount}${f.action}${f.sign_time}`);
    return f;
  };
  const clickTxId = () => String(Date.now() * 1000 + Math.floor(Math.random() * 1000));
  const click = async (path: 'prepare' | 'complete', f: Record<string, string>) =>
    (await h.http.post(api(`/webhooks/payments/click/${path}`)).type('form').send(f).expect(200)).body as Record<string, unknown> & { error: number };

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    [club, otherClub] = await Promise.all([h.club({ devices: 4, pricePerHour: PRICE }), h.club({ devices: 1, pricePerHour: PRICE })]);
  });

  afterAll(async () => {
    await h.stop();
    restoreProviderEnv();
  });

  it('lists enabled providers (DEMO, PAYME, CLICK with test keys)', async () => {
    const r = await h.http.get(api('/payments/providers')).expect(200);
    expect(r.body.data.map((p: { code: string }) => p.code).sort()).toEqual(['CLICK', 'DEMO', 'PAYME']);
  });

  describe('DEMO provider', () => {
    it('checkout → signed webhook confirms the booking; amounts are integer tiyin', async () => {
      const { customer, booking } = await book();
      const co = await checkout(customer, booking.id, 'DEMO');
      expect(co.amount).toBe(booking.total_amount);
      expect(co.checkout_url).toBe(`/pay/demo/${co.payment_id}`);
      // Ochiq checkout qayta ishlatiladi
      expect((await checkout(customer, booking.id, 'DEMO')).payment_id).toBe(co.payment_id);

      // (provider, provider_transaction_id) unique — har ishga tushishda yangi
      const txId = `demo-tx-${randomUUID()}`;
      const r = await demoHook({ event_id: `ev-${randomUUID()}`, payment_id: co.payment_id, status: 'PAID', transaction_id: txId }).expect(201);
      expect(r.body.data).toMatchObject({ processed: true, status: 'PAID', booking_status: 'CONFIRMED' });

      const b = await bookingOf(customer, booking.id);
      expect(b).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID', paid_amount: booking.total_amount, hold_expires_at: null });
      const p = await paymentOf(customer, co.payment_id);
      expect(p).toMatchObject({ status: 'PAID', provider: 'DEMO', method: 'ONLINE_CARD', provider_transaction_id: txId });
      for (const k of ['amount', 'commission_amount', 'club_amount', 'refunded_amount']) expect(Number.isInteger(p[k])).toBe(true);
      expect(p.commission_amount + p.club_amount).toBe(p.amount);
      expect(p.commission_amount).toBe(Math.floor((p.amount * p.commission_bps) / 10_000));
      expect(await ledgerCount(co.payment_id)).toBeGreaterThanOrEqual(2);
    });

    it('invalid / missing / tampered signature is rejected and changes nothing', async () => {
      const { customer, booking } = await book();
      const co = await checkout(customer, booking.id, 'DEMO');
      const body = { event_id: `ev-${randomUUID()}`, payment_id: co.payment_id, status: 'PAID' };
      await demoHook(body, 'deadbeef').expect(401);
      await demoHook(body, '').expect(401);
      await demoHook(body, demoSign(JSON.stringify({ ...body, status: 'FAILED' }))).expect(401);
      const wrongSecret = createHmac('sha256', 'not-the-secret').update(`demo:${JSON.stringify(body)}`).digest('hex');
      await demoHook(body, wrongSecret).expect(401);

      expect((await paymentOf(customer, co.payment_id)).status).toBe('PENDING');
      expect((await bookingOf(customer, booking.id)).status).toBe('PENDING_PAYMENT');
      expect(await prisma.payment_events.count({ where: { provider: 'DEMO', event_id: body.event_id } })).toBe(0);
    });

    it('replayed webhook (same event_id) and late duplicates do not double-credit', async () => {
      const { customer, booking } = await book();
      const co = await checkout(customer, booking.id, 'DEMO');
      const body = { event_id: `ev-${randomUUID()}`, payment_id: co.payment_id, status: 'PAID' };
      await demoHook(body).expect(201);
      const ledger = await ledgerCount(co.payment_id);

      const replay = await demoHook(body).expect(201);
      expect(replay.body.data).toMatchObject({ processed: false, duplicate: true });
      // Boshqa event_id bilan kelgan takroriy PAID ham ta'sirsiz
      const again = await demoHook({ ...body, event_id: `ev-${randomUUID()}` }).expect(201);
      expect(again.body.data).toMatchObject({ processed: false, duplicate: true });
      // Kechikkan FAILED ham to'langan to'lovni buzmaydi
      await demoHook({ ...body, event_id: `ev-${randomUUID()}`, status: 'FAILED' }).expect(201);

      expect(await ledgerCount(co.payment_id)).toBe(ledger);
      expect(await prisma.payment_events.count({ where: { provider: 'DEMO', event_id: body.event_id } })).toBe(1);
      const b = await bookingOf(customer, booking.id);
      expect(b.paid_amount).toBe(booking.total_amount);
      expect((await paymentOf(customer, co.payment_id)).status).toBe('PAID');
    });

    it('parallel PAID webhooks for the same payment credit it exactly once', async () => {
      const { customer, booking } = await book();
      const co = await checkout(customer, booking.id, 'DEMO');
      const results = await Promise.all(Array.from({ length: 5 }, () => demoHook({ event_id: `ev-${randomUUID()}`, payment_id: co.payment_id, status: 'PAID' })));
      for (const r of results) expect(r.status).toBe(201);
      expect(results.filter((r) => r.body.data.processed === true)).toHaveLength(1);
      const ledger = await prisma.ledger_entries.findMany({ where: { ref_type: 'payment', ref_id: co.payment_id } });
      expect(ledger.filter((l) => l.account === 'CUSTOMER')).toHaveLength(1);
      expect(await prisma.booking_events.count({ where: { booking_id: booking.id, type: 'CONFIRMED' } })).toBe(1);
      expect((await bookingOf(customer, booking.id)).paid_amount).toBe(booking.total_amount);
    });

    it('a PAID webhook after a full refund does not resurrect the payment', async () => {
      const { customer, booking } = await book();
      const co = await checkout(customer, booking.id, 'DEMO');
      await demoHook({ event_id: `ev-${randomUUID()}`, payment_id: co.payment_id, status: 'PAID' }).expect(201);
      await h.http.post(api(`/payments/${co.payment_id}/refund`)).set(bearer(club.owner)).send({ reason: 'test' }).expect(201);
      const ledger = await ledgerCount(co.payment_id);

      const r = await demoHook({ event_id: `ev-${randomUUID()}`, payment_id: co.payment_id, status: 'PAID' }).expect(201);
      expect(r.body.data.processed).toBe(false);
      await demoHook({ event_id: `ev-${randomUUID()}`, payment_id: co.payment_id, status: 'FAILED' }).expect(201);
      const p = await paymentOf(customer, co.payment_id);
      expect(p).toMatchObject({ status: 'REFUNDED', refunded_amount: co.amount });
      expect(await ledgerCount(co.payment_id)).toBe(ledger);
      expect(await bookingOf(customer, booking.id)).toMatchObject({ payment_status: 'REFUNDED', paid_amount: 0 });
    });

    it('FAILED webhook keeps the hold; a new checkout can then be paid', async () => {
      const { customer, booking } = await book();
      const co = await checkout(customer, booking.id, 'DEMO');
      await demoHook({ event_id: `ev-${randomUUID()}`, payment_id: co.payment_id, status: 'FAILED' }).expect(201);
      expect((await paymentOf(customer, co.payment_id)).status).toBe('FAILED');
      expect((await bookingOf(customer, booking.id)).status).toBe('PENDING_PAYMENT');

      const co2 = await checkout(customer, booking.id, 'DEMO');
      expect(co2.payment_id).not.toBe(co.payment_id);
      await h.http.post(api(`/payments/${co2.payment_id}/demo/confirm`)).set(bearer(customer)).send({ success: true }).expect(201);
      expect((await bookingOf(customer, booking.id)).status).toBe('CONFIRMED');
    });

    it('unknown payment id → 404; demo confirm only by the payer', async () => {
      await demoHook({ event_id: `ev-${randomUUID()}`, payment_id: randomUUID(), status: 'PAID' }).expect(404);
      const { customer, booking } = await book();
      const co = await checkout(customer, booking.id, 'DEMO');
      const stranger = await h.customer();
      await h.http.post(api(`/payments/${co.payment_id}/demo/confirm`)).set(bearer(stranger.token)).send({ success: true }).expect(404);
      // Begona mijoz checkout ham qila olmaydi
      await h.http.post(api('/payments')).set(bearer(stranger.token)).send({ booking_id: booking.id, provider: 'DEMO' }).expect(404);
      expect((await paymentOf(customer, co.payment_id)).status).toBe('PENDING');
    });

    it('payment after hold expiry: free slot → re-booked; taken slot → automatic refund', async () => {
      const expire = async (bookingId: string) => {
        await prisma.bookings.update({ where: { id: bookingId }, data: { status: 'EXPIRED', hold_expires_at: new Date(Date.now() - 60_000) } });
        await prisma.booking_items.updateMany({ where: { booking_id: bookingId }, data: { active: false } });
      };
      // 1) slot bo'sh
      const a = await book();
      const coA = await checkout(a.customer, a.booking.id, 'DEMO');
      await expire(a.booking.id);
      const ra = await demoHook({ event_id: `ev-${randomUUID()}`, payment_id: coA.payment_id, status: 'PAID' }).expect(201);
      expect(ra.body.data.booking_status).toBe('CONFIRMED');
      expect(await prisma.booking_events.count({ where: { booking_id: a.booking.id, type: 'CONFIRMED_AFTER_EXPIRY' } })).toBe(1);

      // 2) slot boshqa mijozga ketgan
      const b = await book();
      const coB = await checkout(b.customer, b.booking.id, 'DEMO');
      await expire(b.booking.id);
      const thief = await h.customer();
      await h.http
        .post(api('/bookings'))
        .set(bearer(thief.token))
        .send({ branch_id: club.branchId, start_at: b.booking.start_at, duration_minutes: 60, items: [{ device_id: b.device }] })
        .expect(201);
      const rb = await demoHook({ event_id: `ev-${randomUUID()}`, payment_id: coB.payment_id, status: 'PAID' }).expect(201);
      expect(rb.body.data.booking_status).toBe('EXPIRED');
      const p = await paymentOf(b.customer, coB.payment_id);
      expect(p).toMatchObject({ status: 'REFUNDED', refunded_amount: coB.amount });
      expect(p.refunds).toHaveLength(1);
      expect(p.refunds[0]).toMatchObject({ status: 'COMPLETED', amount: coB.amount });
      expect(await bookingOf(b.customer, b.booking.id)).toMatchObject({ status: 'EXPIRED', payment_status: 'REFUNDED', paid_amount: 0 });
    });
  });

  describe('Payme merchant API', () => {
    const order = async () => {
      const { customer, booking } = await book();
      const co = await checkout(customer, booking.id, 'PAYME');
      return { customer, booking, co, account: { payment_id: co.payment_id } };
    };

    it('checkout url is base64 Payme params with tiyin amount', async () => {
      const { co } = await order();
      const url = new URL(co.checkout_url);
      expect(url.host).toBe('checkout.test.paycom.uz');
      const params = Buffer.from(url.pathname.slice(1), 'base64').toString();
      expect(params).toBe(`m=${PROVIDER_ENV.PAYME_MERCHANT_ID};ac.payment_id=${co.payment_id};a=${co.amount}`);
    });

    it('auth failure → -32504 (no / wrong credentials) without side effects', async () => {
      const { co, account } = await order();
      expect((await payme('CheckPerformTransaction', { amount: co.amount, account }, null)).error?.code).toBe(-32504);
      expect((await payme('CheckPerformTransaction', { amount: co.amount, account }, `Basic ${Buffer.from('Paycom:wrong').toString('base64')}`)).error?.code).toBe(-32504);
      expect((await payme('CreateTransaction', { id: paymeTxId(), time: Date.now(), amount: co.amount, account }, 'Bearer x')).error?.code).toBe(-32504);
      expect((await prisma.payments.findUniqueOrThrow({ where: { id: co.payment_id } })).status).toBe('PENDING');
    });

    it('CheckPerformTransaction: ok / wrong amount -31001 / unknown account -31050', async () => {
      const { co, account } = await order();
      expect((await payme('CheckPerformTransaction', { amount: co.amount, account })).result).toEqual({ allow: true });
      expect((await payme('CheckPerformTransaction', { amount: co.amount - 1, account })).error?.code).toBe(-31001);
      expect((await payme('CheckPerformTransaction', { amount: co.amount / 100, account })).error?.code).toBe(-31001);
      expect((await payme('CheckPerformTransaction', { amount: co.amount, account: { payment_id: randomUUID() } })).error).toMatchObject({ code: -31050, data: 'payment_id' });
      expect((await payme('CheckPerformTransaction', { amount: co.amount, account: { payment_id: 'x' } })).error?.code).toBe(-31050);
    });

    it('a DEMO payment id is not payable through Payme', async () => {
      const { customer, booking } = await book();
      const co = await checkout(customer, booking.id, 'DEMO');
      expect((await payme('CheckPerformTransaction', { amount: co.amount, account: { payment_id: co.payment_id } })).error?.code).toBe(-31050);
    });

    it('Create (idempotent) → Perform confirms booking → Check → Statement; repeats are safe', async () => {
      const { customer, booking, co, account } = await order();
      const id = paymeTxId();
      const time = Date.now();
      const c1 = await payme('CreateTransaction', { id, time, amount: co.amount, account });
      expect(c1.result).toMatchObject({ transaction: co.payment_id, state: 1 });
      const c2 = await payme('CreateTransaction', { id, time, amount: co.amount, account });
      expect(c2.result).toEqual(c1.result);
      // Boshqa Payme tranzaksiyasi shu to'lov uchun — band
      expect((await payme('CreateTransaction', { id: paymeTxId(), time, amount: co.amount, account })).error?.code).toBe(-31051);

      const p1 = await payme('PerformTransaction', { id });
      expect(p1.result).toMatchObject({ transaction: co.payment_id, state: 2 });
      expect(await bookingOf(customer, booking.id)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID', paid_amount: co.amount });
      const ledger = await ledgerCount(co.payment_id);
      const p2 = await payme('PerformTransaction', { id });
      expect(p2.result).toEqual(p1.result);
      expect(await ledgerCount(co.payment_id)).toBe(ledger);

      const chk = await payme('CheckTransaction', { id });
      expect(chk.result).toMatchObject({ transaction: co.payment_id, state: 2, create_time: c1.result!.create_time, perform_time: p1.result!.perform_time, cancel_time: 0, reason: null });

      const st = await payme('GetStatement', { from: time - 1, to: time + 1 });
      const mine = (st.result!.transactions as { id: string; amount: number; account: { payment_id: string } }[]).find((t) => t.id === id);
      expect(mine).toMatchObject({ amount: co.amount, account: { payment_id: co.payment_id }, state: 2 });
      // CheckPerform endi ruxsat bermaydi
      expect((await payme('CheckPerformTransaction', { amount: co.amount, account })).error?.code).toBe(-31008);
    });

    it('CancelTransaction before perform → state -1, payment FAILED, booking keeps hold', async () => {
      const { customer, booking, co, account } = await order();
      const id = paymeTxId();
      await payme('CreateTransaction', { id, time: Date.now(), amount: co.amount, account });
      const c = await payme('CancelTransaction', { id, reason: 3 });
      expect(c.result).toMatchObject({ transaction: co.payment_id, state: -1 });
      expect((await payme('CancelTransaction', { id, reason: 3 })).result).toEqual(c.result);
      expect((await payme('PerformTransaction', { id })).error?.code).toBe(-31008);
      expect((await paymentOf(customer, co.payment_id)).status).toBe('FAILED');
      expect((await bookingOf(customer, booking.id)).status).toBe('PENDING_PAYMENT');
      expect((await payme('CheckTransaction', { id })).result).toMatchObject({ state: -1, reason: 3 });
    });

    it('refund from the club is PENDING until Payme sends CancelTransaction (state -2 → COMPLETED)', async () => {
      const { customer, booking, co, account } = await order();
      const id = paymeTxId();
      await payme('CreateTransaction', { id, time: Date.now(), amount: co.amount, account });
      await payme('PerformTransaction', { id });

      const rf = await h.http.post(api(`/payments/${co.payment_id}/refund`)).set(bearer(club.owner)).send({ reason: 'Mijoz so\'radi' }).expect(201);
      expect(rf.body.data).toMatchObject({ status: 'PENDING', amount: co.amount });

      const c = await payme('CancelTransaction', { id, reason: 5 });
      expect(c.result).toMatchObject({ state: -2 });
      const p = await paymentOf(customer, co.payment_id);
      expect(p).toMatchObject({ status: 'REFUNDED', refunded_amount: co.amount });
      // Kutilayotgan refund yopildi, ikkinchi refund yaratilmadi
      expect(p.refunds).toHaveLength(1);
      expect(p.refunds[0]).toMatchObject({ status: 'COMPLETED', provider_refund_id: `payme-${id}` });
      expect((await bookingOf(customer, booking.id)).payment_status).toBe('REFUNDED');
      // Takror cancel — o'zgarishsiz
      expect((await payme('CancelTransaction', { id, reason: 5 })).result).toEqual(c.result);
      expect((await paymentOf(customer, co.payment_id)).refunds).toHaveLength(1);
    });

    it('Payme-initiated cancel after perform refunds the full amount', async () => {
      const { customer, co, account } = await order();
      const id = paymeTxId();
      await payme('CreateTransaction', { id, time: Date.now(), amount: co.amount, account });
      await payme('PerformTransaction', { id });
      expect((await payme('CancelTransaction', { id, reason: 1 })).result).toMatchObject({ state: -2 });
      const p = await paymentOf(customer, co.payment_id);
      expect(p).toMatchObject({ status: 'REFUNDED', refunded_amount: co.amount });
      expect(p.refunds).toEqual([expect.objectContaining({ status: 'COMPLETED', amount: co.amount })]);
    });

    it('unknown transaction / method', async () => {
      expect((await payme('CheckTransaction', { id: paymeTxId() })).error?.code).toBe(-31003);
      expect((await payme('PerformTransaction', { id: paymeTxId() })).error?.code).toBe(-31003);
      expect((await payme('Nope', {})).error?.code).toBe(-32601);
    });
  });

  describe('Click SHOP API', () => {
    const order = async () => {
      const { customer, booking } = await book();
      const co = await checkout(customer, booking.id, 'CLICK');
      return { customer, booking, co, som: (co.amount / 100).toFixed(2) };
    };

    it('checkout url carries so\'m amount', async () => {
      const { co, som } = await order();
      const url = new URL(co.checkout_url);
      expect(url.searchParams.get('amount')).toBe(som);
      expect(url.searchParams.get('transaction_param')).toBe(co.payment_id);
    });

    it('prepare → complete confirms booking; replayed complete → -4 without double credit', async () => {
      const { customer, booking, co, som } = await order();
      const ct = clickTxId();
      const prep = await click('prepare', clickForm('0', co.payment_id, som, { click_trans_id: ct }));
      expect(prep).toMatchObject({ error: 0, click_trans_id: ct, merchant_trans_id: co.payment_id });
      expect((await paymentOf(customer, co.payment_id)).status).toBe('PROCESSING');

      const f = clickForm('1', co.payment_id, som, { click_trans_id: ct, merchant_prepare_id: String(prep.merchant_prepare_id) });
      const done = await click('complete', f);
      expect(done).toMatchObject({ error: 0, merchant_confirm_id: prep.merchant_prepare_id });
      expect(await bookingOf(customer, booking.id)).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID', paid_amount: co.amount });
      const ledger = await ledgerCount(co.payment_id);

      expect((await click('complete', f)).error).toBe(-4);
      expect((await click('prepare', clickForm('0', co.payment_id, som))).error).toBe(-4);
      expect(await ledgerCount(co.payment_id)).toBe(ledger);
    });

    it('signature, amount, account and action errors', async () => {
      const { customer, co, som } = await order();
      expect((await click('prepare', clickForm('0', co.payment_id, som, { sign_string: md5('forged') }))).error).toBe(-1);
      // Imzolangandan keyin summa o'zgartirilgan
      expect((await click('prepare', { ...clickForm('0', co.payment_id, som), amount: '1.00' })).error).toBe(-1);
      expect((await click('prepare', clickForm('0', co.payment_id, (co.amount / 100 - 1).toFixed(2)))).error).toBe(-2);
      expect((await click('prepare', clickForm('0', co.payment_id, 'abc'))).error).toBe(-2);
      expect((await click('prepare', clickForm('0', randomUUID(), som))).error).toBe(-5);
      expect((await click('prepare', clickForm('0', co.payment_id, som, { service_id: '1' }))).error).toBe(-8);
      expect((await click('complete', clickForm('0', co.payment_id, som))).error).toBe(-3);
      expect((await paymentOf(customer, co.payment_id)).status).toBe('PENDING');
    });

    it('complete without matching prepare → -6; Click-side error → payment FAILED (-9)', async () => {
      const { customer, booking, co, som } = await order();
      expect((await click('complete', clickForm('1', co.payment_id, som, { merchant_prepare_id: '123' }))).error).toBe(-6);
      const ct = clickTxId();
      const prep = await click('prepare', clickForm('0', co.payment_id, som, { click_trans_id: ct }));
      expect((await click('complete', clickForm('1', co.payment_id, som, { click_trans_id: ct, merchant_prepare_id: String(Number(prep.merchant_prepare_id) + 1) }))).error).toBe(-6);
      const r = await click('complete', clickForm('1', co.payment_id, som, { click_trans_id: ct, merchant_prepare_id: String(prep.merchant_prepare_id), error: '-5017' }));
      expect(r.error).toBe(-9);
      expect((await paymentOf(customer, co.payment_id)).status).toBe('FAILED');
      expect((await bookingOf(customer, booking.id)).status).toBe('PENDING_PAYMENT');
      expect((await click('prepare', clickForm('0', co.payment_id, som))).error).toBe(-9);
    });
  });

  it('other club staff cannot see or refund an online payment', async () => {
    const { customer, booking } = await book();
    const co = await checkout(customer, booking.id, 'DEMO');
    await demoHook({ event_id: `ev-${randomUUID()}`, payment_id: co.payment_id, status: 'PAID' }).expect(201);
    await h.http.get(api(`/payments/${co.payment_id}`)).set(bearer(otherClub.owner)).expect(404);
    await h.http.post(api(`/payments/${co.payment_id}/refund`)).set(bearer(otherClub.owner)).send({ reason: 'x' }).expect(404);
    expect((await paymentOf(customer, co.payment_id)).status).toBe('PAID');
  });
});
