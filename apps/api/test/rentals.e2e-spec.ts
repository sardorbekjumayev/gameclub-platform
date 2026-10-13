import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import { PrismaService } from '../src/database/prisma.service';
import { api, bearer, Harness, slot, TestClub } from './utils/harness';
import { closeShift, newClub, newCustomer } from './utils/flows';

/**
 * Konsol arendasi (docs/01-API.md "Konsol arendasi"): inventar CRUD (scope), quote/slots, so'rov (Idempotency-Key, dona hisobi,
 * limitlar) → tasdiq/rad → topshirish (to'lov + garov) → qaytarish (kechikish haqi, garov), bekor qilish; klub scope.
 */
describe('Rentals (e2e)', () => {
  const h = new Harness();
  const HOUR = 3_000_000; // 30 000 so'm/soat (tiyin)
  const DAY = 15_000_000;
  const DEPOSIT = 50_000_000;
  const DELIVERY = 2_000_000;
  let A: TestClub;
  let B: TestClub;
  let prisma: PrismaService;
  let alice: { token: string; phone: string };
  let bob: { token: string; phone: string };
  let carol: { token: string; phone: string };
  let operator: string;
  let itemId: string;
  let dailyOnlyId: string;
  let r1: string; // alice
  let r2: string; // bob
  const W1 = slot(120);

  const rent = (token: string, body: Record<string, unknown>, key?: string) => {
    const req = h.http.post(api('/rentals')).set(bearer(token));
    if (key) req.set('Idempotency-Key', key);
    return req.send({ item_id: itemId, rate_unit: 'HOUR', units: 3, start_at: W1, ...body });
  };

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    [A, B] = [await newClub(h, { devices: 1 }), await newClub(h, { devices: 1 })];
    [alice, bob, carol] = [await newCustomer(h), await newCustomer(h), await newCustomer(h)];
    operator = (await h.staff(A, 'OPERATOR', A.branchId)).token;
  }, 120_000);

  afterAll(async () => {
    await closeShift(h, operator);
    await h.stop();
  });

  describe('inventory', () => {
    it('owner creates items; money in integer tiyin; pricing required', async () => {
      const r = await h.http
        .post(api(`/branches/${A.branchId}/rental-items`))
        .set(bearer(A.owner))
        .send({ name: 'PlayStation 5 + 2 joystick', type: 'PS5', quantity: 2, price_per_hour: HOUR, price_per_day: DAY, min_hours: 2, max_days: 7, deposit_amount: DEPOSIT, delivery_available: true, delivery_fee: DELIVERY, games: ['FC 25'] })
        .expect(201);
      itemId = r.body.data.id;
      expect(r.body.data).toMatchObject({ club_id: A.clubId, branch_id: A.branchId, quantity: 2, price_per_hour: HOUR, deposit_amount: DEPOSIT, status: 'ACTIVE' });

      const noPrice = await h.http.post(api(`/branches/${A.branchId}/rental-items`)).set(bearer(A.owner)).send({ name: 'Xbox', type: 'XBOX' }).expect(422);
      expect(noPrice.body.error.details.field).toBe('price_per_hour');
      await h.http.post(api(`/branches/${A.branchId}/rental-items`)).set(bearer(A.owner)).send({ name: 'Xbox', type: 'GAMEBOY', price_per_day: DAY }).expect(422);
      await h.http.post(api(`/branches/${A.branchId}/rental-items`)).set(bearer(A.owner)).send({ name: 'Xbox', type: 'XBOX', price_per_day: 10.5 }).expect(422);

      const d = await h.http.post(api(`/branches/${A.branchId}/rental-items`)).set(bearer(A.owner)).send({ name: 'Xbox Series X', type: 'XBOX', price_per_day: DAY }).expect(201);
      dailyOnlyId = d.body.data.id;
      expect(await prisma.audit_logs.count({ where: { action: 'rental_item.create', target_id: itemId } })).toBe(1);
    });

    it('club B / customer / operator cannot manage club A inventory', async () => {
      const body = { name: 'Begona', type: 'PS4', price_per_day: DAY };
      await h.http.post(api(`/branches/${A.branchId}/rental-items`)).set(bearer(B.owner)).send(body).expect(403);
      await h.http.post(api(`/branches/${A.branchId}/rental-items`)).set(bearer(alice.token)).send(body).expect(403);
      await h.http.post(api(`/branches/${A.branchId}/rental-items`)).set(bearer(operator)).send(body).expect(403);
      await h.http.patch(api(`/rental-items/${itemId}`)).set(bearer(B.owner)).send({ quantity: 50 }).expect(404);
      await h.http.delete(api(`/rental-items/${itemId}`)).set(bearer(B.owner)).expect(404);
      await h.http.patch(api(`/rental-items/${itemId}`)).set(bearer(alice.token)).send({ quantity: 50 }).expect(403);
      await h.http.get(api(`/branches/${A.branchId}/rental-items/manage`)).set(bearer(B.owner)).expect(403);

      // Operator ko'radi (rentals.view)
      const m = await h.http.get(api(`/branches/${A.branchId}/rental-items/manage`)).set(bearer(operator)).expect(200);
      expect(m.body.data.map((x: { id: string }) => x.id).sort()).toEqual([itemId, dailyOnlyId].sort());
      expect(m.body.data.find((x: { id: string }) => x.id === itemId)).toMatchObject({ available_now: 2, requested_count: 0, open_count: 0 });
    });

    it('PATCH keeps at least one price', async () => {
      await h.http.patch(api(`/rental-items/${dailyOnlyId}`)).set(bearer(A.owner)).send({ price_per_day: null }).expect(422);
      const u = await h.http.patch(api(`/rental-items/${dailyOnlyId}`)).set(bearer(A.owner)).send({ description: 'Ikki joystick' }).expect(200);
      expect(u.body.data.description).toBe('Ikki joystick');
    });

    it('public catalog lists only active items of active clubs', async () => {
      const r = await h.http.get(api(`/rental-items?club_id=${A.clubId}`)).expect(200);
      expect(r.body.data.map((x: { id: string }) => x.id).sort()).toEqual([itemId, dailyOnlyId].sort());
      const one = r.body.data.find((x: { id: string }) => x.id === itemId);
      expect(one).toMatchObject({ available_now: 2, branch: { id: A.branchId } });
      expect(one).not.toHaveProperty('deleted_at');
      const hourly = await h.http.get(api(`/rental-items?club_id=${A.clubId}&rate_unit=HOUR`)).expect(200);
      expect(hourly.body.data.map((x: { id: string }) => x.id)).toEqual([itemId]);
      const bList = await h.http.get(api(`/rental-items?club_id=${B.clubId}`)).expect(200);
      expect(bList.body.data).toHaveLength(0);

      const detail = await h.http.get(api(`/rental-items/${itemId}`)).expect(200);
      expect(detail.body.data.branch).toHaveProperty('is_open');
    });
  });

  describe('quote & slots', () => {
    it('quote: unit × units × quantity (+ delivery); deposit separate', async () => {
      const q = await h.http.get(api(`/rental-items/${itemId}/quote?rate_unit=HOUR&units=3&quantity=2&start_at=${encodeURIComponent(W1)}`)).expect(200);
      expect(q.body.data).toMatchObject({ unit_price: HOUR, subtotal: HOUR * 3 * 2, delivery_fee: 0, total: HOUR * 6, deposit: DEPOSIT * 2, available_units: 2, is_available: true });
      expect(new Date(q.body.data.end_at).getTime() - new Date(q.body.data.start_at).getTime()).toBe(3 * 3600_000);
      const d = await h.http.get(api(`/rental-items/${itemId}/quote?rate_unit=DAY&units=2&fulfillment=DELIVERY&start_at=${encodeURIComponent(W1)}`)).expect(200);
      expect(d.body.data).toMatchObject({ subtotal: DAY * 2, delivery_fee: DELIVERY, total: DAY * 2 + DELIVERY, deposit: DEPOSIT });
    });

    it('quote rejects: min hours, max days, unit not offered, no delivery, past start', async () => {
      const reason = async (path: string) => (await h.http.get(api(path)).expect(422)).body.error.details?.reason;
      const s = encodeURIComponent(W1);
      expect(await reason(`/rental-items/${itemId}/quote?rate_unit=HOUR&units=1&start_at=${s}`)).toBe('MIN_HOURS');
      expect(await reason(`/rental-items/${itemId}/quote?rate_unit=DAY&units=8&start_at=${s}`)).toBe('MAX_DAYS');
      expect(await reason(`/rental-items/${dailyOnlyId}/quote?rate_unit=HOUR&units=3&start_at=${s}`)).toBe('UNIT_NOT_OFFERED');
      expect(await reason(`/rental-items/${dailyOnlyId}/quote?rate_unit=DAY&units=1&fulfillment=DELIVERY&start_at=${s}`)).toBe('NO_DELIVERY');
      const past = await h.http.get(api(`/rental-items/${itemId}/quote?rate_unit=HOUR&units=3&start_at=${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}`)).expect(422);
      expect(past.body.error.code).toBe('BOOKING_TOO_EARLY');
      const late = await h.http.get(api(`/rental-items/${itemId}/quote?rate_unit=HOUR&units=3&start_at=${encodeURIComponent(new Date(Date.now() + 61 * 86400_000).toISOString())}`)).expect(422);
      expect(late.body.error.code).toBe('BOOKING_TOO_LATE');
    });

    it('slots: 30-min steps from now+15m, within availability', async () => {
      const tomorrow = DateTime.now().setZone('Asia/Tashkent').plus({ days: 1 }).toISODate();
      const r = await h.http.get(api(`/rental-items/${itemId}/slots?date=${tomorrow}&rate_unit=HOUR&units=2`)).expect(200);
      expect(r.body.data.timezone).toBe('Asia/Tashkent');
      expect(r.body.data.slots).toHaveLength(48); // 24/7 filial, butun kun
      for (const s of r.body.data.slots) {
        expect(new Date(s.start_at).getUTCMinutes() % 30).toBe(0);
        expect(s.available_units).toBe(2);
      }
      const today = DateTime.now().setZone('Asia/Tashkent').toISODate();
      const t = await h.http.get(api(`/rental-items/${itemId}/slots?date=${today}&rate_unit=HOUR&units=2`)).expect(200);
      expect(t.body.data.slots.every((s: { start_at: string }) => new Date(s.start_at).getTime() >= Date.now() + 14 * 60_000)).toBe(true);
      await h.http.get(api(`/rental-items/${itemId}/slots?date=13-10-2026&rate_unit=HOUR&units=2`)).expect(422);
    });
  });

  describe('requests', () => {
    it('Idempotency-Key: same key + body → same rental, different body → IDEMPOTENCY_CONFLICT', async () => {
      const key = randomUUID();
      const a = await rent(alice.token, { notes: 'Kechqurun olaman' }, key).expect(201);
      r1 = a.body.data.id;
      expect(a.body.data).toMatchObject({ status: 'REQUESTED', quantity: 1, total_amount: HOUR * 3, deposit_amount: DEPOSIT, paid_amount: 0, amount_due: HOUR * 3, can_cancel: true, contact_phone: alice.phone });
      expect(a.body.data.code).toMatch(/^RN-/);
      expect(a.body.data).not.toHaveProperty('idempotency_key');
      expect(a.body.data).not.toHaveProperty('customer');

      const again = await rent(alice.token, { notes: 'Kechqurun olaman' }, key);
      expect([200, 201]).toContain(again.status);
      expect(again.body.data.id).toBe(r1);
      const conflict = await rent(alice.token, { notes: 'Boshqa' }, key).expect(409);
      expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(await prisma.rentals.count({ where: { customer_id: (await prisma.users.findUniqueOrThrow({ where: { phone: alice.phone } })).id } })).toBe(1);
    });

    it('validation: DELIVERY needs address and an offering item; bad payloads 422; anonymous 401', async () => {
      expect((await rent(bob.token, { fulfillment: 'DELIVERY' }).expect(422)).body.error.details.reason).toBe('ADDRESS_REQUIRED');
      await rent(bob.token, { units: 3.5 }).expect(422);
      await rent(bob.token, { quantity: 11 }).expect(422);
      await rent(bob.token, { contact_phone: '+15551234567' }).expect(422);
      await h.http.post(api('/rentals')).send({ item_id: itemId, rate_unit: 'HOUR', units: 3, start_at: W1 }).expect(401);
      await rent(bob.token, { item_id: '00000000-0000-7000-8000-000000000000' }).expect(404);
    });

    it('units are never oversold', async () => {
      const b = await rent(bob.token, {}, randomUUID()).expect(201);
      r2 = b.body.data.id;
      const full = await rent(carol.token, {}).expect(409);
      expect(full.body.error).toMatchObject({ code: 'DEVICE_NOT_AVAILABLE', details: { reason: 'NO_UNITS', available: 0 } });
      const q = await h.http.get(api(`/rental-items/${itemId}/quote?rate_unit=HOUR&units=3&start_at=${encodeURIComponent(W1)}`)).expect(200);
      expect(q.body.data).toMatchObject({ available_units: 0, is_available: false });
      // Boshqa vaqtda bo'sh
      const later = slot(24 * 60);
      const q2 = await h.http.get(api(`/rental-items/${itemId}/quote?rate_unit=HOUR&units=3&start_at=${encodeURIComponent(later)}`)).expect(200);
      expect(q2.body.data.available_units).toBe(2);
    });

    it('parallel requests for the last unit: exactly one succeeds', async () => {
      const at = slot(5 * 24 * 60);
      const users = [carol, ...(await Promise.all([newCustomer(h), newCustomer(h), newCustomer(h)]))];
      const res = await Promise.all(users.map((u) => rent(u.token, { start_at: at, quantity: 1 })));
      // quantity 2: aynan ikkitasi o'tadi
      expect(res.filter((r) => r.status === 201)).toHaveLength(2);
      expect(res.filter((r) => r.status === 409).every((r) => r.body.error.details.reason === 'NO_UNITS')).toBe(true);
      for (const r of res.filter((x) => x.status === 201)) {
        await h.http.post(api(`/rentals/${r.body.data.id}/reject`)).set(bearer(A.owner)).send({ reason: 'e2e tozalash' }).expect(201);
      }
    });

    it('max 3 open rentals per customer', async () => {
      const dave = await newCustomer(h);
      const ids: string[] = [];
      for (const d of [10, 11, 12]) ids.push((await rent(dave.token, { start_at: slot(d * 24 * 60) }).expect(201)).body.data.id);
      const r = await rent(dave.token, { start_at: slot(13 * 24 * 60) }).expect(409);
      expect(r.body.error.details).toMatchObject({ reason: 'MAX_OPEN_RENTALS', limit: 3 });
      for (const id of ids) await h.http.post(api(`/rentals/${id}/cancel`)).set(bearer(dave.token)).send({}).expect(201);
      await rent(dave.token, { start_at: slot(13 * 24 * 60) }).expect(201).then((x) => h.http.post(api(`/rentals/${x.body.data.id}/cancel`)).set(bearer(dave.token)).send({}).expect(201));
    });

    it('blocked customer cannot request', async () => {
      const eve = await newCustomer(h);
      await prisma.users.update({ where: { phone: eve.phone }, data: { booking_blocked_until: new Date(Date.now() + 86400_000) } });
      const r = await rent(eve.token, { start_at: slot(20 * 24 * 60) }).expect(403);
      expect(r.body.error.code).toBe('CUSTOMER_BOOKING_BLOCKED');
    });
  });

  describe('scope', () => {
    it("customers see only their own rentals", async () => {
      await h.http.get(api(`/rentals/${r1}`)).set(bearer(bob.token)).expect(404);
      await h.http.post(api(`/rentals/${r1}/cancel`)).set(bearer(bob.token)).send({}).expect(404);
      const mine = await h.http.get(api('/rentals')).set(bearer(bob.token)).expect(200);
      expect(mine.body.data.map((x: { id: string }) => x.id)).toEqual([r2]);
      expect(mine.body.data[0]).not.toHaveProperty('customer');
      await h.http.get(api('/rentals?staff=true')).set(bearer(bob.token)).expect(403);
    });

    it('club B cannot read or process club A rentals', async () => {
      await h.http.get(api(`/rentals/${r1}`)).set(bearer(B.owner)).expect(404);
      await h.http.post(api(`/rentals/${r1}/confirm`)).set(bearer(B.owner)).expect(404);
      await h.http.post(api(`/rentals/${r1}/handover`)).set(bearer(B.owner)).send({ payment_method: 'CASH' }).expect(404);
      await h.http.post(api(`/rentals/${r1}/return`)).set(bearer(B.owner)).send({ payment_method: 'CASH', deposit: 'RETURNED' }).expect(404);
      await h.http.post(api(`/rentals/${r1}/reject`)).set(bearer(B.owner)).send({ reason: 'begona' }).expect(404);
      await h.http.post(api(`/rentals/${r1}/cancel`)).set(bearer(B.owner)).send({}).expect(404);
      const list = await h.http.get(api(`/rentals?staff=true&club_id=${A.clubId}`)).set(bearer(B.owner)).expect(200);
      expect(list.body.data).toHaveLength(0);
      const listB = await h.http.get(api('/rentals?staff=true')).set(bearer(B.owner)).expect(200);
      expect(listB.body.data.every((x: { club_id: string }) => x.club_id === B.clubId)).toBe(true);
      expect((await h.http.get(api(`/rentals/${r1}`)).set(bearer(alice.token)).expect(200)).body.data.status).toBe('REQUESTED');
    });

    it('customers cannot process (403); staff list shows customer with phone', async () => {
      await h.http.post(api(`/rentals/${r1}/confirm`)).set(bearer(alice.token)).expect(403);
      const list = await h.http.get(api(`/rentals?staff=true&status=OPEN&branch_id=${A.branchId}`)).set(bearer(operator)).expect(200);
      const row = list.body.data.find((x: { id: string }) => x.id === r1);
      expect(row.customer).toMatchObject({ phone: alice.phone });
      expect(row).not.toHaveProperty('idempotency_key');
      const byCode = await h.http.get(api(`/rentals?staff=true&q=${row.code.toLowerCase()}`)).set(bearer(operator)).expect(200);
      expect(byCode.body.data.map((x: { id: string }) => x.id)).toEqual([r1]);
    });
  });

  describe('lifecycle', () => {
    it('reject requires reason; rejected cannot be cancelled', async () => {
      await h.http.post(api(`/rentals/${r2}/reject`)).set(bearer(operator)).send({}).expect(422);
      const r = await h.http.post(api(`/rentals/${r2}/reject`)).set(bearer(operator)).send({ reason: 'Konsol ta\'mirda' }).expect(201);
      expect(r.body.data).toMatchObject({ status: 'REJECTED', cancel_reason: 'Konsol ta\'mirda', can_cancel: false, amount_due: 0 });
      const c = await h.http.post(api(`/rentals/${r2}/cancel`)).set(bearer(bob.token)).send({}).expect(409);
      expect(c.body.error.code).toBe('BOOKING_NOT_CANCELLABLE');
      expect(await prisma.audit_logs.count({ where: { action: 'rental.reject', target_id: r2 } })).toBe(1);
      expect((await prisma.notifications.count({ where: { type: 'RENTAL_REJECTED', data: { path: ['rental_id'], equals: r2 } } }))).toBe(1);
    });

    it('confirm (Idempotency-Key replays, second confirm conflicts)', async () => {
      const key = randomUUID();
      const c = await h.http.post(api(`/rentals/${r1}/confirm`)).set(bearer(operator)).set('Idempotency-Key', key).expect(201);
      expect(c.body.data.status).toBe('CONFIRMED');
      expect(c.body.data.customer.phone).toBe(alice.phone);
      // Darhol takrorlangan so'rov saqlangan javobni oladi (qayta tasdiqlamaydi)
      const replay = await h.http.post(api(`/rentals/${r1}/confirm`)).set(bearer(operator)).set('Idempotency-Key', key);
      expect([200, 201]).toContain(replay.status);
      expect(replay.body.data.status).toBe('CONFIRMED');
      await h.http.post(api(`/rentals/${r1}/confirm`)).set(bearer(operator)).expect(409);
    });

    it('handover needs an open shift for cash; records payment and holds deposit', async () => {
      const noShift = await h.http.post(api(`/rentals/${r1}/handover`)).set(bearer(operator)).send({ payment_method: 'CASH' }).expect(409);
      expect(noShift.body.error.details.reason).toBe('SHIFT_REQUIRED');
      expect((await prisma.rentals.findUniqueOrThrow({ where: { id: r1 } })).status).toBe('CONFIRMED'); // tranzaksiya qaytdi

      await h.openShift(operator, A.branchId);
      await h.http.post(api(`/rentals/${r1}/handover`)).set(bearer(operator)).send({ payment_method: 'BITCOIN' }).expect(422);
      const r = await h.http.post(api(`/rentals/${r1}/handover`)).set(bearer(operator)).set('Idempotency-Key', randomUUID()).send({ payment_method: 'CASH', deposit_collected: true }).expect(201);
      expect(r.body.data).toMatchObject({ status: 'ACTIVE', deposit_status: 'HELD', paid_amount: HOUR * 3, payment_status: 'PAID', amount_due: 0, can_cancel: false, is_overdue: false });
      expect(r.body.data.payments).toHaveLength(1);
      expect(r.body.data.payments[0]).toMatchObject({ amount: HOUR * 3, method: 'CASH', status: 'PAID' });
      // Faol arendani mijoz bekor qila olmaydi
      await h.http.post(api(`/rentals/${r1}/cancel`)).set(bearer(alice.token)).send({}).expect(409);
      await h.http.post(api(`/rentals/${r1}/handover`)).set(bearer(operator)).send({ payment_method: 'CASH' }).expect(409);
    });

    it('overdue: flagged after 15 min grace with suggested late fee (hourly snapshot price)', async () => {
      await prisma.rentals.update({ where: { id: r1 }, data: { start_at: new Date(Date.now() - 250 * 60_000), end_at: new Date(Date.now() - 70 * 60_000) } });
      const d = await h.http.get(api(`/rentals/${r1}`)).set(bearer(operator)).expect(200);
      expect(d.body.data.is_overdue).toBe(true);
      expect(d.body.data.overdue_minutes).toBeGreaterThanOrEqual(70);
      expect(d.body.data.suggested_late_fee).toBe(HOUR * 2); // 70 daq → 2 boshlangan soat × 1 dona
      const list = await h.http.get(api(`/rentals?staff=true&status=OVERDUE`)).set(bearer(operator)).expect(200);
      expect(list.body.data.map((x: { id: string }) => x.id)).toContain(r1);
      // Narx o'zgarsa ham tavsiya snapshot bo'yicha
      await h.http.patch(api(`/rental-items/${itemId}`)).set(bearer(A.owner)).send({ price_per_hour: HOUR * 10 }).expect(200);
      expect((await h.http.get(api(`/rentals/${r1}`)).set(bearer(operator)).expect(200)).body.data.suggested_late_fee).toBe(HOUR * 2);
      await h.http.patch(api(`/rental-items/${itemId}`)).set(bearer(A.owner)).send({ price_per_hour: HOUR }).expect(200);
    });

    it('cannot delete an item with open rentals', async () => {
      const r = await h.http.delete(api(`/rental-items/${itemId}`)).set(bearer(A.owner)).expect(409);
      expect(r.body.error.details).toMatchObject({ reason: 'OPEN_RENTALS', count: 1 });
    });

    it('return: deposit decision required; late fee must be collected; totals add up', async () => {
      const noDeposit = await h.http.post(api(`/rentals/${r1}/return`)).set(bearer(operator)).send({}).expect(422);
      expect(noDeposit.body.error.details.field).toBe('deposit');
      const unpaid = await h.http.post(api(`/rentals/${r1}/return`)).set(bearer(operator)).send({ late_fee: HOUR * 2, deposit: 'RETURNED' }).expect(422);
      expect(unpaid.body.error.details).toMatchObject({ field: 'payment_method', amount_due: HOUR * 2 });
      await h.http.post(api(`/rentals/${r1}/return`)).set(bearer(operator)).send({ late_fee: -1, payment_method: 'CASH', deposit: 'RETURNED' }).expect(422);

      const r = await h.http
        .post(api(`/rentals/${r1}/return`))
        .set(bearer(operator))
        .set('Idempotency-Key', randomUUID())
        .send({ late_fee: HOUR * 2, payment_method: 'CASH', deposit: 'RETURNED', note: 'Joystick tirnalgan' })
        .expect(201);
      expect(r.body.data).toMatchObject({
        status: 'RETURNED', late_fee_amount: HOUR * 2, total_amount: HOUR * 5, paid_amount: HOUR * 5, payment_status: 'PAID', deposit_status: 'RETURNED', amount_due: 0, is_overdue: false,
      });
      expect(r.body.data.notes).toContain('Joystick tirnalgan');
      expect(r.body.data.payments.map((p: { amount: number }) => p.amount)).toEqual([HOUR * 3, HOUR * 2]);
      await h.http.post(api(`/rentals/${r1}/return`)).set(bearer(operator)).send({ payment_method: 'CASH', deposit: 'RETURNED' }).expect(409);
      expect(await prisma.audit_logs.count({ where: { action: 'rental.return', target_id: r1 } })).toBe(1);
      const hist = await h.http.get(api('/rentals?status=HISTORY')).set(bearer(alice.token)).expect(200);
      expect(hist.body.data.map((x: { id: string }) => x.id)).toContain(r1);
    });

    it('LATER handover, then KEPT deposit and collection at return', async () => {
      const r = await rent(carol.token, { start_at: slot(3 * 24 * 60), units: 2 }).expect(201);
      const id = r.body.data.id;
      // Xodim tasdiqlamasdan ham topshira oladi (avtomatik tasdiq)
      const ho = await h.http.post(api(`/rentals/${id}/handover`)).set(bearer(operator)).send({ payment_method: 'LATER', deposit_collected: true }).expect(201);
      expect(ho.body.data).toMatchObject({ status: 'ACTIVE', paid_amount: 0, amount_due: HOUR * 2, deposit_status: 'HELD' });
      expect(ho.body.data.confirmed_at).toBeTruthy();
      await h.http.post(api(`/rentals/${id}/return`)).set(bearer(operator)).send({ payment_method: 'LATER', deposit: 'KEPT' }).expect(422);
      const done = await h.http.post(api(`/rentals/${id}/return`)).set(bearer(operator)).send({ payment_method: 'TERMINAL', deposit: 'KEPT' }).expect(201);
      expect(done.body.data).toMatchObject({ status: 'RETURNED', deposit_status: 'KEPT', late_fee_amount: 0, paid_amount: HOUR * 2, total_amount: HOUR * 2 });
    });

    it('customer cancels own REQUESTED rental; staff cancel is audited', async () => {
      const a = await rent(carol.token, { start_at: slot(4 * 24 * 60) }).expect(201);
      const c = await h.http.post(api(`/rentals/${a.body.data.id}/cancel`)).set(bearer(carol.token)).set('Idempotency-Key', randomUUID()).send({ reason: 'Rejalar o\'zgardi' }).expect(201);
      expect(c.body.data).toMatchObject({ status: 'CANCELLED', cancel_reason: 'Rejalar o\'zgardi' });
      expect(await prisma.audit_logs.count({ where: { action: 'rental.cancel', target_id: a.body.data.id } })).toBe(0);

      const b = await rent(carol.token, { start_at: slot(4 * 24 * 60) }).expect(201);
      await h.http.post(api(`/rentals/${b.body.data.id}/cancel`)).set(bearer(operator)).send({ reason: 'Mijoz qo\'ng\'iroq qildi' }).expect(201);
      expect(await prisma.audit_logs.count({ where: { action: 'rental.cancel', target_id: b.body.data.id } })).toBe(1);
    });

    it('item without open rentals can be deleted and disappears from the catalog', async () => {
      await h.http.delete(api(`/rental-items/${dailyOnlyId}`)).set(bearer(operator)).expect(403);
      await h.http.delete(api(`/rental-items/${dailyOnlyId}`)).set(bearer(A.owner)).expect(200);
      await h.http.get(api(`/rental-items/${dailyOnlyId}`)).expect(404);
      const cat = await h.http.get(api(`/rental-items?club_id=${A.clubId}`)).expect(200);
      expect(cat.body.data.map((x: { id: string }) => x.id)).toEqual([itemId]);
    });
  });
});
