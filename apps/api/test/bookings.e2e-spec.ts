import { DateTime } from 'luxon';
import { PrismaService } from '../src/database/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { api, bearer, Harness, rndPhone, TestClub } from './utils/harness';

/**
 * Bronlar (docs/01-API.md §6.8, §6.9, §7): ommaviy availability/slotlar, yaratish validatsiyasi,
 * PENDING_PAYMENT/CONFIRMED oqimlari, o'qish, QR, timeline, bekor qilish va refund, ko'chirish, no-show,
 * Idempotency-Key va scope (mijoz ↔ mijoz, klub ↔ klub, filial ↔ filial).
 */
jest.setTimeout(30_000);

describe('Bookings (e2e)', () => {
  const h = new Harness();
  const TZ = 'Asia/Tashkent';
  const PRICE = 1_200_000; // 12 000 so'm/soat (tiyin)

  let prisma: PrismaService;
  let A: TestClub; // 4 ta PC, 24/7
  let B: TestClub; // boshqa klub, 1 ta PC
  let A2: { branchId: string; devices: string[]; categoryId: string };
  let op1: string; // A klub, 1-filial operatori

  /** Filial vaqtida (Toshkent) `days` kundan keyin soat `hour:minute` — UTC ISO. */
  const at = (days: number, hour: number, minute = 0) =>
    DateTime.now().setZone(TZ).plus({ days }).set({ hour, minute, second: 0, millisecond: 0 }).toUTC().toISO()!;
  const localDate = (days: number) => DateTime.now().setZone(TZ).plus({ days }).toISODate()!;
  const plusMin = (iso: string, m: number) => new Date(new Date(iso).getTime() + m * 60_000).toISOString();
  /** Joriy vaqtdan keyingi 30 daqiqalik slot (+`minutes`). */
  const soon = (minutes: number) => {
    const d = new Date(Date.now() + minutes * 60_000);
    d.setUTCMinutes(Math.ceil(d.getUTCMinutes() / 30) * 30, 0, 0);
    return d.toISOString();
  };

  /** OTP login — har safar boshqa IP (parallel ishlayotgan testlar umumiy IP limitiga urilmasin). */
  const login = async (phone = rndPhone()) => {
    const ip = `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
    await h.redis.del(`otp:cooldown:${phone}`);
    await h.http.post(api('/auth/send-otp')).set('X-Forwarded-For', ip).send({ phone, purpose: 'LOGIN' }).expect(200);
    const r = await h.http.post(api('/auth/verify-otp')).set('X-Forwarded-For', ip).send({ phone, code: '000000' }).expect(200);
    return r.body.data.access_token as string;
  };
  const customer = async () => {
    const phone = rndPhone();
    return { token: await login(phone), phone };
  };
  const club = async (opts: Parameters<Harness['club']>[0] = {}) => {
    await h.resetRateLimits();
    return h.club(opts);
  };

  const book = (token: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    h.http.post(api('/bookings')).set(bearer(token)).set(headers).send(body);
  /** Klubda to'lanadigan (darhol CONFIRMED) bron. */
  const confirmed = async (token: string, deviceId: string, start: string, duration = 60, branchId = A.branchId) => {
    const r = await book(token, { branch_id: branchId, start_at: start, duration_minutes: duration, items: [{ device_id: deviceId }], payment_mode: 'AT_CLUB' });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('CONFIRMED');
    return r.body.data as { id: string; code: string; total_amount: number; start_at: string; end_at: string };
  };
  /** Online (hold) bron va naqd to'lov — paid_amount = total. */
  const paid = async (token: string, deviceId: string, start: string, duration = 60) => {
    const r = await book(token, { branch_id: A.branchId, start_at: start, duration_minutes: duration, items: [{ device_id: deviceId }] }).expect(201);
    expect(r.body.data.status).toBe('PENDING_PAYMENT');
    await h.http.post(api('/payments/cash')).set(bearer(A.owner)).send({ booking_id: r.body.data.id, method: 'CASH' }).expect(201);
    const d = await h.http.get(api(`/bookings/${r.body.data.id}`)).set(bearer(token)).expect(200);
    expect(d.body.data).toMatchObject({ status: 'CONFIRMED', payment_status: 'PAID', paid_amount: d.body.data.total_amount, amount_due: 0 });
    return d.body.data as { id: string; total_amount: number };
  };
  const availability = (branchId: string, start: string, duration: number, extra = '') =>
    h.http.get(api(`/branches/${branchId}/availability?start_at=${encodeURIComponent(start)}&duration=${duration}${extra}`));
  const deviceStatus = async (deviceId: string, start: string, duration: number) => {
    const r = await availability(A.branchId, start, duration).expect(200);
    return r.body.data.devices.find((d: { id: string }) => d.id === deviceId).status as string;
  };

  beforeAll(async () => {
    await h.start();
    prisma = h.get<PrismaService>(PrismaService);
    A = await club({ devices: 4, pricePerHour: PRICE });
    B = await club({ devices: 1, pricePerHour: PRICE });

    // A klubning 2-filiali: kategoriya bilan 2 ta qurilma
    const br = await h.http
      .post(api(`/clubs/${A.clubId}/branches`))
      .set(bearer(A.owner))
      .send({ name: 'Ikkinchi', address: 'Toshkent, Yunusobod 2', latitude: 41.36, longitude: 69.28, working_hours: { always_open: true } })
      .expect(201);
    const branchId = br.body.data.id as string;
    const cat = await h.http.post(api(`/branches/${branchId}/device-categories`)).set(bearer(A.owner)).send({ name: 'VIP', device_type: 'PC' }).expect(201);
    await h.http.post(api(`/branches/${branchId}/devices/bulk`)).set(bearer(A.owner)).send({ prefix: 'CAT-', from: 1, to: 2, type: 'PC', category_id: cat.body.data.id }).expect(201);
    await h.http.post(api(`/branches/${branchId}/tariffs`)).set(bearer(A.owner)).send({ name: 'VIP', price_per_hour: 2 * PRICE, device_type: 'PC' }).expect(201);
    const list = await h.http.get(api(`/branches/${branchId}/devices`)).set(bearer(A.owner)).expect(200);
    A2 = { branchId, categoryId: cat.body.data.id, devices: (list.body.data as { id: string; name: string }[]).sort((a, b) => a.name.localeCompare(b.name)).map((d) => d.id) };

    op1 = (await h.staff(A, 'OPERATOR', A.branchId)).token;
    await h.openShift(A.owner, A.branchId);
  }, 120_000);

  afterAll(async () => {
    await h.stop();
  });

  // ---------------- Availability va slotlar (ommaviy) ----------------

  describe('availability & slots (public)', () => {
    it('availability without auth: every device AVAILABLE with an hourly quote', async () => {
      const start = at(1, 12);
      const r = await availability(A.branchId, start, 90).expect(200);
      const d = r.body.data;
      expect(d).toMatchObject({
        branch_id: A.branchId, start_at: start, end_at: plusMin(start, 90), within_working_hours: true, hold_minutes: 10,
        mode: { specific_device: true, category: true }, suggested_slots: [], package: null,
      });
      expect(d.devices).toHaveLength(4);
      for (const dev of d.devices) {
        expect(dev.status).toBe('AVAILABLE');
        expect(dev.price_quote).toMatchObject({ amount: (PRICE * 3) / 2, tariff_id: A.tariffId });
      }
    });

    it('a booking makes the device RESERVED only for overlapping ranges', async () => {
      const c = await customer();
      const start = at(1, 14);
      await confirmed(c.token, A.devices[0], start);
      expect(await deviceStatus(A.devices[0], start, 60)).toBe('RESERVED');
      expect(await deviceStatus(A.devices[0], at(1, 14, 30), 30)).toBe('RESERVED');
      expect(await deviceStatus(A.devices[0], at(1, 13), 120)).toBe('RESERVED');
      expect(await deviceStatus(A.devices[0], at(1, 15), 60)).toBe('AVAILABLE'); // [end, ...) — chegara band emas
      expect(await deviceStatus(A.devices[0], at(1, 13), 60)).toBe('AVAILABLE');
      expect(await deviceStatus(A.devices[1], start, 60)).toBe('AVAILABLE');
    });

    it('fully booked: suggests the next 3 free start times', async () => {
      const c = await customer();
      await confirmed(c.token, B.devices[0], at(2, 12), 60, B.branchId);
      const r = await availability(B.branchId, at(2, 12), 60).expect(200);
      expect(r.body.data.devices[0].status).toBe('RESERVED');
      expect(r.body.data.suggested_slots).toEqual([
        { start_at: at(2, 13), available_count: 1 },
        { start_at: at(2, 13, 30), available_count: 1 },
        { start_at: at(2, 14), available_count: 1 },
      ]);
    });

    it('availability validation: 422 for bad query, 400 for bad id, 404 for unknown branch', async () => {
      await availability(A.branchId, at(1, 12), 10).expect(422);
      await availability(A.branchId, at(1, 12), 1441).expect(422);
      await availability(A.branchId, 'tomorrow', 60).expect(422);
      await h.http.get(api(`/branches/${A.branchId}/availability?duration=60`)).expect(422);
      await h.http.get(api(`/branches/not-a-uuid/availability?start_at=${encodeURIComponent(at(1, 12))}&duration=60`)).expect(400);
      const r = await availability('0190a000-0000-7000-8000-000000000000', at(1, 12), 60).expect(404);
      expect(r.body.error.code).toBe('NOT_FOUND');
    });

    it('slots: 30-minute grid for the whole day on a 24/7 branch; booked slots count one less', async () => {
      const date = localDate(3);
      const before = await h.http.get(api(`/branches/${A.branchId}/slots?date=${date}&duration=60`)).expect(200);
      expect(before.body.data).toMatchObject({ date, timezone: TZ, slot_minutes: 30, total_devices: 4 });
      expect(before.body.data.slots).toHaveLength(48);
      expect(before.body.data.slots[0].start_at).toBe(DateTime.fromISO(date, { zone: TZ }).toUTC().toISO());

      const c = await customer();
      await confirmed(c.token, A.devices[1], at(3, 12));
      const after = await h.http.get(api(`/branches/${A.branchId}/slots?date=${date}&duration=60`)).expect(200);
      const count = (iso: string) => after.body.data.slots.find((s: { start_at: string }) => s.start_at === iso).available_count;
      expect(count(at(3, 11))).toBe(4);
      expect(count(at(3, 11, 30))).toBe(3);
      expect(count(at(3, 12))).toBe(3);
      expect(count(at(3, 12, 30))).toBe(3);
      expect(count(at(3, 13))).toBe(4);
      // Faqat PC turi bo'yicha; boshqa tur — qurilma yo'q
      const ps = await h.http.get(api(`/branches/${A.branchId}/slots?date=${date}&duration=60&device_type=PS5`)).expect(200);
      expect(ps.body.data.total_devices).toBe(0);
    });

    it('a paused session past its expected end blocks slots exactly like availability and create', async () => {
      const Z = await club({ devices: 1 });
      await h.http.post(api('/bookings/walk-in')).set(bearer(Z.owner)).send({ branch_id: Z.branchId, device_ids: [Z.devices[0]], duration_minutes: 60, payment_method: 'LATER', guest_name: 'Pauza' }).expect(201);
      const session = await prisma.sessions.findFirstOrThrow({ where: { device_id: Z.devices[0], status: { in: ['WAITING', 'ACTIVE'] } } });
      await h.http.post(api(`/sessions/${session.id}/pause`)).set(bearer(Z.owner)).send({}).expect(201);
      // Pauzadagi sessiyaning rejalashtirilgan tugashi allaqachon o'tib ketgan
      await prisma.sessions.update({ where: { id: session.id }, data: { expected_end_at: new Date(Date.now() - 10 * 60_000) } });

      const start = at(1, 12);
      const av = await availability(Z.branchId, start, 60).expect(200);
      expect(av.body.data.devices[0].status).toBe('OCCUPIED');
      const slots = await h.http.get(api(`/branches/${Z.branchId}/slots?date=${localDate(1)}&duration=60`)).expect(200);
      expect(slots.body.data.slots.find((x: { start_at: string }) => x.start_at === start).available_count).toBe(0);
      expect(slots.body.data.slots.every((x: { available_count: number }) => x.available_count === 0)).toBe(true);
      const c = await customer();
      await book(c.token, { branch_id: Z.branchId, start_at: start, duration_minutes: 60, items: [{ device_id: Z.devices[0] }] }).expect(409);

      // Davom ettirilsa (pauza emas) — tugash vaqtidan keyingi slotlar yana bo'sh
      await prisma.sessions.update({ where: { id: session.id }, data: { status: 'ACTIVE' } });
      const after = await h.http.get(api(`/branches/${Z.branchId}/slots?date=${localDate(1)}&duration=60`)).expect(200);
      expect(after.body.data.slots.find((x: { start_at: string }) => x.start_at === start).available_count).toBe(1);
      expect((await availability(Z.branchId, start, 60).expect(200)).body.data.devices[0].status).toBe('AVAILABLE');
    });

    it('slots validation', async () => {
      await h.http.get(api(`/branches/${A.branchId}/slots?date=2026/10/10&duration=60`)).expect(422);
      await h.http.get(api(`/branches/${A.branchId}/slots?date=${localDate(1)}`)).expect(422);
      await h.http.get(api(`/branches/${A.branchId}/slots?date=${localDate(1)}&duration=5`)).expect(422);
    });

    it('working hours and exceptions shape slots and availability; booking outside hours is rejected', async () => {
      const day = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '10:00', close: '22:00' }]]));
      const H = await club({ devices: 1, branch: { working_hours: day } });
      const slots = await h.http.get(api(`/branches/${H.branchId}/slots?date=${localDate(3)}&duration=60`)).expect(200);
      const starts = slots.body.data.slots.map((s: { start_at: string }) => s.start_at);
      expect(starts).toHaveLength(23); // 10:00 … 21:00
      expect(starts[0]).toBe(at(3, 10));
      expect(starts[starts.length - 1]).toBe(at(3, 21));

      const c = await customer();
      const outside = await book(c.token, { branch_id: H.branchId, start_at: at(3, 21, 30), duration_minutes: 60, items: [{ device_id: H.devices[0] }] }).expect(422);
      expect(outside.body.error.code).toBe('BOOKING_OUTSIDE_WORKING_HOURS');
      const early = await book(c.token, { branch_id: H.branchId, start_at: at(3, 9, 30), duration_minutes: 60, items: [{ device_id: H.devices[0] }] }).expect(422);
      expect(early.body.error.code).toBe('BOOKING_OUTSIDE_WORKING_HOURS');
      await book(c.token, { branch_id: H.branchId, start_at: at(3, 21), duration_minutes: 60, items: [{ device_id: H.devices[0] }], payment_mode: 'AT_CLUB' }).expect(201);

      // Istisno: 4-kun yopiq
      await h.http.post(api(`/branches/${H.branchId}/hours-exceptions`)).set(bearer(H.owner)).send({ date: localDate(4), is_closed: true, reason: 'Ta\'mir' }).expect(201);
      const closed = await h.http.get(api(`/branches/${H.branchId}/slots?date=${localDate(4)}&duration=60`)).expect(200);
      expect(closed.body.data.slots).toEqual([]);
      const av = await availability(H.branchId, at(4, 12), 60).expect(200);
      expect(av.body.data.within_working_hours).toBe(false);
      expect(av.body.data.devices[0].status).toBe('UNAVAILABLE');
      const r = await book(c.token, { branch_id: H.branchId, start_at: at(4, 12), duration_minutes: 60, items: [{ device_id: H.devices[0] }] }).expect(422);
      expect(r.body.error.code).toBe('BOOKING_OUTSIDE_WORKING_HOURS');
    });

    it('inactive club / closed branch: availability, slots and create → 409 CLUB_NOT_ACTIVE', async () => {
      const X = await club({ devices: 1, approve: false });
      const c = await customer();
      expect((await availability(X.branchId, at(1, 12), 60).expect(409)).body.error.code).toBe('CLUB_NOT_ACTIVE');
      await h.http.get(api(`/branches/${X.branchId}/slots?date=${localDate(1)}&duration=60`)).expect(409);
      const r = await book(c.token, { branch_id: X.branchId, start_at: at(1, 12), duration_minutes: 60, items: [{ device_id: X.devices[0] }] }).expect(409);
      expect(r.body.error.code).toBe('CLUB_NOT_ACTIVE');

      const Y = await club({ devices: 1 });
      await h.http.patch(api(`/branches/${Y.branchId}`)).set(bearer(Y.owner)).send({ status: 'TEMPORARILY_CLOSED' }).expect(200);
      const r2 = await book(c.token, { branch_id: Y.branchId, start_at: at(1, 12), duration_minutes: 60, items: [{ device_id: Y.devices[0] }] }).expect(409);
      expect(r2.body.error.code).toBe('CLUB_NOT_ACTIVE');
    });
  });

  // ---------------- Yaratish ----------------

  describe('create', () => {
    it('401 without a token', async () => {
      await h.http.post(api('/bookings')).send({ branch_id: A.branchId, start_at: at(5, 10), duration_minutes: 60, items: [{ device_id: A.devices[0] }] }).expect(401);
    });

    it('422 for malformed bodies (DTO validation)', async () => {
      const c = await customer();
      const ok = { branch_id: A.branchId, start_at: at(5, 10), duration_minutes: 60, items: [{ device_id: A.devices[0] }] };
      const bad: Record<string, unknown>[] = [
        { ...ok, branch_id: 'x' },
        { ...ok, start_at: 'tomorrow' },
        { ...ok, duration_minutes: 10 },
        { ...ok, duration_minutes: 1441 },
        { ...ok, duration_minutes: 60.5 },
        { ...ok, items: [] },
        { ...ok, items: 'all' },
        { ...ok, items: [{ device_id: 'nope' }] },
        { ...ok, items: Array.from({ length: 6 }, () => ({ category_id: A2.categoryId })) },
        { ...ok, source: 'WALK_IN' },
        { ...ok, payment_mode: 'CREDIT' },
        { ...ok, guest_phone: '12345' },
        { ...ok, promo_code: 'X'.repeat(41) },
        { ...ok, package_id: 'p' },
        { ...ok, hacker: true },
        { branch_id: A.branchId, start_at: at(5, 10), items: [{ device_id: A.devices[0] }] },
      ];
      for (const body of bad) {
        const r = await book(c.token, body);
        expect({ body, status: r.status, code: r.body.error?.code }).toEqual({ body, status: 422, code: 'VALIDATION_ERROR' });
      }
      // Hech biri bron yaratmagan
      const mine = await h.http.get(api('/bookings')).set(bearer(c.token)).expect(200);
      expect(mine.body.data).toHaveLength(0);
    });

    it('422 business validation: empty item, duplicate devices, misaligned start, past, too far, below minimum', async () => {
      const c = await customer();
      const base = { branch_id: A.branchId, duration_minutes: 60, items: [{ device_id: A.devices[0] }] };
      const expectErr = async (body: Record<string, unknown>, code: string) => {
        const r = await book(c.token, body);
        expect({ status: r.status, code: r.body.error?.code }).toEqual({ status: 422, code });
        return r.body.error.details;
      };
      await expectErr({ ...base, start_at: at(5, 10), items: [{}] }, 'VALIDATION_ERROR');
      await expectErr({ ...base, start_at: at(5, 10), items: [{ device_id: A.devices[0] }, { device_id: A.devices[0] }] }, 'VALIDATION_ERROR');
      expect(await expectErr({ ...base, start_at: at(5, 10, 10) }, 'VALIDATION_ERROR')).toEqual({ slot_minutes: 30 });
      await expectErr({ ...base, start_at: plusMin(at(5, 10), 0.5) }, 'VALIDATION_ERROR'); // 30 soniya
      await expectErr({ ...base, start_at: soon(-120) }, 'BOOKING_TOO_EARLY');
      expect(await expectErr({ ...base, start_at: at(16, 10) }, 'BOOKING_TOO_LATE')).toEqual({ max_advance_days: 14 });
      expect(await expectErr({ ...base, start_at: at(5, 10), duration_minutes: 30 }, 'BOOKING_TOO_EARLY')).toEqual({ min_minutes: 60 });
    });

    it('409 for a device of another branch, unknown device, 422 for unknown package / invalid promo', async () => {
      const c = await customer();
      const base = { branch_id: A.branchId, start_at: at(5, 11), duration_minutes: 60 };
      const r1 = await book(c.token, { ...base, items: [{ device_id: B.devices[0] }] }).expect(409);
      expect(r1.body.error.code).toBe('DEVICE_NOT_AVAILABLE');
      await book(c.token, { ...base, items: [{ device_id: A2.devices[0] }] }).expect(409);
      await book(c.token, { ...base, items: [{ device_id: '0190a000-0000-7000-8000-000000000000' }] }).expect(409);
      const r2 = await book(c.token, { ...base, items: [{ device_id: A.devices[0] }], package_id: '0190a000-0000-7000-8000-000000000000' }).expect(422);
      expect(r2.body.error.details).toMatchObject({ field: 'package_id', reason: 'PACKAGE_NOT_FOUND' });
      const r3 = await book(c.token, { ...base, items: [{ device_id: A.devices[0] }], promo_code: 'NO-SUCH-CODE' }).expect(422);
      expect(r3.body.error).toMatchObject({ code: 'PROMO_INVALID', details: { reason: 'NOT_FOUND' } });
      const mine = await h.http.get(api('/bookings')).set(bearer(c.token)).expect(200);
      expect(mine.body.data).toHaveLength(0);
    });

    it('online booking: PENDING_PAYMENT hold with price snapshot and breakdown', async () => {
      const c = await customer();
      const start = at(5, 12);
      const t0 = Date.now();
      const r = await book(c.token, { branch_id: A.branchId, start_at: start, duration_minutes: 90, items: [{ device_id: A.devices[0] }, { device_id: A.devices[1] }], notes: 'Do\'stlar bilan' }).expect(201);
      const b = r.body.data;
      expect(b).toMatchObject({
        status: 'PENDING_PAYMENT', payment_status: 'UNPAID', source: 'APP', start_at: start, end_at: plusMin(start, 90), duration_minutes: 90,
        subtotal_amount: 2 * 1_800_000, discount_amount: 0, total_amount: 2 * 1_800_000, paid_amount: 0, amount_due: 2 * 1_800_000,
        club_id: A.clubId, branch_id: A.branchId, notes: 'Do\'stlar bilan', can_cancel: true, can_reschedule: true, package: null,
      });
      expect(b.code).toMatch(/^GC-[0-9A-Z]{6}$/);
      const hold = new Date(b.hold_expires_at).getTime();
      expect(hold).toBeGreaterThanOrEqual(t0 + 10 * 60_000 - 1000);
      expect(hold).toBeLessThanOrEqual(Date.now() + 10 * 60_000 + 1000);
      expect(b.items).toHaveLength(2);
      expect(b.items.map((i: { device_id: string }) => i.device_id).sort()).toEqual([A.devices[0], A.devices[1]].sort());
      expect(b.items[0]).toMatchObject({ active: true, price_amount: 1_800_000, tariff_id: A.tariffId, price_breakdown: { rounding: 'CEIL', currency: 'UZS' } });
      expect(b.items[0].price_breakdown.segments).toEqual([expect.objectContaining({ rule: 'BASE', minutes: 90, amount: 1_800_000, price_per_hour: PRICE })]);
      expect(b.price_snapshot).toMatchObject({ payment_mode: 'ONLINE', promo: null, cancellation_policy: { rules: expect.any(Array) } });
      expect(b.refund_preview).toEqual({ percent: 100, amount: 0 });
      expect(b.checkin_window).toEqual({ from: plusMin(start, -15), to: plusMin(start, 15) });
    });

    it('AT_CLUB → CONFIRMED without hold; WEB source kept; club requiring online payment rejects AT_CLUB', async () => {
      const c = await customer();
      const r = await book(c.token, { branch_id: A.branchId, start_at: at(5, 15), duration_minutes: 60, items: [{ device_id: A.devices[2] }], payment_mode: 'AT_CLUB', source: 'WEB' }).expect(201);
      expect(r.body.data).toMatchObject({ status: 'CONFIRMED', hold_expires_at: null, payment_status: 'UNPAID', source: 'WEB', amount_due: PRICE, price_snapshot: { payment_mode: 'AT_CLUB' } });

      const O = await club({ devices: 1 });
      await h.http.patch(api(`/clubs/${O.clubId}/settings`)).set(bearer(O.owner)).send({ settings: { allow_pay_at_club: false } }).expect(200);
      const r2 = await book(c.token, { branch_id: O.branchId, start_at: at(6, 15), duration_minutes: 60, items: [{ device_id: O.devices[0] }], payment_mode: 'AT_CLUB' }).expect(422);
      expect(r2.body.error.details).toEqual({ field: 'payment_mode' });
      await book(c.token, { branch_id: O.branchId, start_at: at(6, 15), duration_minutes: 60, items: [{ device_id: O.devices[0] }] }).expect(201);
    });

    it('staff phone booking: CONFIRMED guest booking without customer; a customer cannot fake PHONE', async () => {
      const r = await book(A.owner, { branch_id: A.branchId, start_at: at(5, 17), duration_minutes: 60, items: [{ device_id: A.devices[3] }], source: 'PHONE', guest_name: 'Telefon mehmon', guest_phone: '+998901112233' }).expect(201);
      expect(r.body.data).toMatchObject({ status: 'CONFIRMED', source: 'PHONE', customer_id: null, guest_name: 'Telefon mehmon', guest_phone: '+998901112233' });
      const tl = await h.http.get(api(`/bookings/${r.body.data.id}/timeline`)).set(bearer(A.owner)).expect(200);
      expect(tl.body.data[0]).toMatchObject({ type: 'CREATED', data: { source: 'PHONE', status: 'CONFIRMED' } });

      // Xodim telefon orqali bo'lsa slotga tekislash shart emas
      await book(A.owner, { branch_id: A.branchId, start_at: at(5, 19, 10), duration_minutes: 50, items: [{ device_id: A.devices[3] }], source: 'PHONE', guest_name: 'X' }).expect(201);

      const c = await customer();
      const fake = await book(c.token, { branch_id: A.branchId, start_at: at(5, 21), duration_minutes: 60, items: [{ device_id: A.devices[3] }], source: 'PHONE', guest_name: 'Men' }).expect(201);
      expect(fake.body.data.source).toBe('APP');
      expect(fake.body.data.customer_id).not.toBeNull();
      expect(fake.body.data.status).toBe('PENDING_PAYMENT');
      // Mijoz uchun tekislash/minimal qoidalar o'z kuchida
      const r2 = await book(c.token, { branch_id: A.branchId, start_at: at(5, 22, 10), duration_minutes: 60, items: [{ device_id: A.devices[3] }], source: 'PHONE' }).expect(422);
      expect(r2.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('the same device cannot be booked twice for overlapping time (409 BOOKING_SLOT_TAKEN)', async () => {
      const [c1, c2] = [await customer(), await customer()];
      await confirmed(c1.token, A.devices[0], at(6, 10), 120);
      const r = await book(c2.token, { branch_id: A.branchId, start_at: at(6, 11), duration_minutes: 60, items: [{ device_id: A.devices[0] }] }).expect(409);
      expect(r.body.error).toMatchObject({ code: 'BOOKING_SLOT_TAKEN', details: { device_id: A.devices[0] } });
      // Ikki qurilmali bronda bittasi band — butun bron rad etiladi, ikkinchi qurilma band qilinmaydi
      await book(c2.token, { branch_id: A.branchId, start_at: at(6, 11), duration_minutes: 60, items: [{ device_id: A.devices[1] }, { device_id: A.devices[0] }] }).expect(409);
      expect(await deviceStatus(A.devices[1], at(6, 11), 60)).toBe('AVAILABLE');
      // Tutash oraliq — mumkin
      await confirmed(c2.token, A.devices[0], at(6, 12));
    });

    it('one customer: no overlapping bookings, at most N unpaid holds', async () => {
      const c = await customer();
      await confirmed(c.token, A.devices[0], at(7, 10));
      const ov = await book(c.token, { branch_id: A.branchId, start_at: at(7, 10, 30), duration_minutes: 60, items: [{ device_id: A.devices[1] }] }).expect(409);
      expect(ov.body.error).toMatchObject({ code: 'CONFLICT', details: { reason: 'OVERLAP' } });
      // Boshqa klubda ham bir vaqtda bo'lmaydi
      await book(c.token, { branch_id: B.branchId, start_at: at(7, 10), duration_minutes: 60, items: [{ device_id: B.devices[0] }] }).expect(409);

      const limit = (await h.get<SettingsService>(SettingsService).get<number>('booking.max_parallel_holds')) ?? 2;
      for (let i = 0; i < limit; i++) {
        await book(c.token, { branch_id: A.branchId, start_at: at(7, 12 + 2 * i), duration_minutes: 60, items: [{ device_id: A.devices[1] }] }).expect(201);
      }
      const r = await book(c.token, { branch_id: A.branchId, start_at: at(7, 12 + 2 * limit), duration_minutes: 60, items: [{ device_id: A.devices[1] }] }).expect(409);
      expect(r.body.error.details).toEqual({ reason: 'MAX_HOLDS' });
    });

    it('cash payment confirms a hold', async () => {
      const c = await customer();
      const b = await paid(c.token, A.devices[2], at(7, 15));
      const tl = await h.http.get(api(`/bookings/${b.id}/timeline`)).set(bearer(A.owner)).expect(200);
      expect(tl.body.data.map((e: { type: string }) => e.type)).toEqual(['CREATED', 'PAYMENT']);
    });

    it('category booking picks a free device of the category; full category → 409', async () => {
      const [c1, c2, c3] = [await customer(), await customer(), await customer()];
      const body = { branch_id: A2.branchId, start_at: at(8, 12), duration_minutes: 60, items: [{ category_id: A2.categoryId }], payment_mode: 'AT_CLUB' };
      const r1 = await book(c1.token, body).expect(201);
      const r2 = await book(c2.token, body).expect(201);
      const d1 = r1.body.data.items[0];
      const d2 = r2.body.data.items[0];
      expect(d1).toMatchObject({ requested_category_id: A2.categoryId, category_id: A2.categoryId, price_amount: 2 * PRICE });
      expect(A2.devices).toContain(d1.device_id);
      expect(A2.devices).toContain(d2.device_id);
      expect(d1.device_id).not.toBe(d2.device_id);
      const r3 = await book(c3.token, body).expect(409);
      expect(r3.body.error.code).toBe('BOOKING_SLOT_TAKEN');
    });

    it('promo code: discount applied, 100% → CONFIRMED & PAID; cancel releases the redemption', async () => {
      const code = `E2E${Date.now()}${(Math.random() * 1000) | 0}`.slice(0, 30);
      await h.http.post(api(`/clubs/${A.clubId}/promotions`)).set(bearer(A.owner)).send({ code: `${code}F`, type: 'FIXED', value: 200_000 }).expect(201);
      await h.http.post(api(`/clubs/${A.clubId}/promotions`)).set(bearer(A.owner)).send({ code: `${code}P`, type: 'PERCENT', value: 100, usage_limit: 1 }).expect(201);
      const c = await customer();
      const r = await book(c.token, { branch_id: A.branchId, start_at: at(8, 10), duration_minutes: 60, items: [{ device_id: A.devices[0] }], promo_code: `${code}f`.toLowerCase() }).expect(201);
      expect(r.body.data).toMatchObject({ subtotal_amount: PRICE, discount_amount: 200_000, total_amount: PRICE - 200_000, status: 'PENDING_PAYMENT', price_snapshot: { promo: { code: `${code}F`, discount: 200_000, funded_by: 'CLUB' } } });

      const c2 = await customer();
      const free = await book(c2.token, { branch_id: A.branchId, start_at: at(8, 14), duration_minutes: 60, items: [{ device_id: A.devices[0] }], promo_code: `${code}P` }).expect(201);
      expect(free.body.data).toMatchObject({ total_amount: 0, status: 'CONFIRMED', payment_status: 'PAID', hold_expires_at: null });
      // Limit 1: ikkinchi foydalanish rad etiladi
      const c3 = await customer();
      const lim = await book(c3.token, { branch_id: A.branchId, start_at: at(8, 16), duration_minutes: 60, items: [{ device_id: A.devices[0] }], promo_code: `${code}P` }).expect(422);
      expect(lim.body.error.details).toEqual({ reason: 'LIMIT_REACHED' });
      // Bekor qilinsa promo qaytadi
      await h.http.post(api(`/bookings/${free.body.data.id}/cancel`)).set(bearer(c2.token)).send({}).expect(201);
      await book(c3.token, { branch_id: A.branchId, start_at: at(8, 16), duration_minutes: 60, items: [{ device_id: A.devices[0] }], promo_code: `${code}P` }).expect(201);
      // Promo boshqa klubda ishlamaydi
      const c4 = await customer();
      const other = await book(c4.token, { branch_id: B.branchId, start_at: at(8, 16), duration_minutes: 60, items: [{ device_id: B.devices[0] }], promo_code: `${code}F` }).expect(422);
      expect(other.body.error.details).toEqual({ reason: 'OTHER_CLUB' });
    });

    it('package booking: fixed duration and price, snapshot kept', async () => {
      const P = await club({ devices: 1 });
      const t = await h.http.patch(api(`/tariffs/${P.tariffId}`)).set(bearer(P.owner)).send({ packages: [{ name: '2 soat', duration_minutes: 120, price: 2_000_000 }] }).expect(200);
      const pkgId = t.body.data.packages[0].id;
      const c = await customer();
      const r = await book(c.token, { branch_id: P.branchId, start_at: at(9, 10), duration_minutes: 60, items: [{ device_id: P.devices[0] }], package_id: pkgId }).expect(201);
      expect(r.body.data).toMatchObject({ duration_minutes: 120, end_at: at(9, 12), total_amount: 2_000_000, package: { id: pkgId, price: 2_000_000, duration_minutes: 120 } });
      expect(r.body.data.items[0].price_breakdown.package).toMatchObject({ id: pkgId, regular_amount: 2 * 1_200_000 });
      // Boshqa filial paketi bu filialda topilmaydi
      await book(c.token, { branch_id: A.branchId, start_at: at(9, 14), duration_minutes: 60, items: [{ device_id: A.devices[0] }], package_id: pkgId }).expect(422);
    });
  });

  // ---------------- Idempotency ----------------

  describe('Idempotency-Key', () => {
    it('replay with the same key and body returns the same booking; another body → 409 IDEMPOTENCY_CONFLICT', async () => {
      const c = await customer();
      const key = crypto.randomUUID();
      const body = { branch_id: A.branchId, start_at: at(9, 18), duration_minutes: 60, items: [{ device_id: A.devices[0] }] };
      const r1 = await book(c.token, body, { 'Idempotency-Key': key }).expect(201);
      const r2 = await book(c.token, body, { 'Idempotency-Key': key });
      expect([200, 201]).toContain(r2.status);
      expect(r2.body.data.id).toBe(r1.body.data.id);
      expect(r2.body.data.code).toBe(r1.body.data.code);
      const r3 = await book(c.token, { ...body, duration_minutes: 90 }, { 'Idempotency-Key': key }).expect(409);
      expect(r3.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
      const mine = await h.http.get(api('/bookings')).set(bearer(c.token)).expect(200);
      expect(mine.body.data).toHaveLength(1);
      expect(await prisma.bookings.count({ where: { customer_id: r1.body.data.customer_id } })).toBe(1);
    });

    it('a failed request does not burn the key; the same key works for another user independently', async () => {
      const c = await customer();
      const key = crypto.randomUUID();
      const body = { branch_id: A.branchId, start_at: at(9, 20), duration_minutes: 60, items: [{ device_id: A.devices[1] }] };
      // Avval xato (o'tib ketgan vaqt) — key band qolmaydi
      await book(c.token, { ...body, start_at: soon(-120) }, { 'Idempotency-Key': key }).expect(422);
      const ok = await book(c.token, body, { 'Idempotency-Key': key }).expect(201);
      const other = await customer();
      const r = await book(other.token, { ...body, items: [{ device_id: A.devices[2] }] }, { 'Idempotency-Key': key }).expect(201);
      expect(r.body.data.id).not.toBe(ok.body.data.id);
    });

    it('cancel replay with the same key returns the stored result', async () => {
      const c = await customer();
      const b = await confirmed(c.token, A.devices[3], at(9, 22));
      const key = crypto.randomUUID();
      const r1 = await h.http.post(api(`/bookings/${b.id}/cancel`)).set(bearer(c.token)).set('Idempotency-Key', key).send({ reason: 'Reja o\'zgardi' }).expect(201);
      const r2 = await h.http.post(api(`/bookings/${b.id}/cancel`)).set(bearer(c.token)).set('Idempotency-Key', key).send({ reason: 'Reja o\'zgardi' });
      expect([200, 201]).toContain(r2.status);
      expect(r2.body.data).toMatchObject({ id: b.id, status: 'CANCELLED' });
      expect(r1.body.data.status).toBe('CANCELLED');
      // Kalitsiz takror — 409
      await h.http.post(api(`/bookings/${b.id}/cancel`)).set(bearer(c.token)).send({}).expect(409);
    });
  });

  // ---------------- O'qish va scope ----------------

  describe('read, QR, timeline and scope', () => {
    let cA: { token: string; phone: string };
    let cB: { token: string; phone: string };
    let bookingA: { id: string; code: string };
    let bookingA2: { id: string; code: string };
    let cancelledA: { id: string; code: string };
    let opA2: string;

    beforeAll(async () => {
      cA = await customer();
      cB = await customer();
      bookingA = await confirmed(cA.token, A.devices[0], at(10, 10));
      bookingA2 = await confirmed(cA.token, A2.devices[0], at(10, 14), 60, A2.branchId);
      cancelledA = await confirmed(cA.token, A.devices[1], at(10, 18));
      await h.http.post(api(`/bookings/${cancelledA.id}/cancel`)).set(bearer(cA.token)).send({ reason: 'test' }).expect(201);
      await confirmed(cB.token, B.devices[0], at(10, 10), 60, B.branchId);
      opA2 = (await h.staff(A, 'OPERATOR', A2.branchId)).token;
    }, 60_000);

    it('customer list shows only own bookings; status filters work', async () => {
      const mine = await h.http.get(api('/bookings')).set(bearer(cA.token)).expect(200);
      expect(mine.body.data.map((b: { id: string }) => b.id).sort()).toEqual([bookingA.id, bookingA2.id, cancelledA.id].sort());
      expect(mine.body.meta).toMatchObject({ page: 1, limit: 20, total: 3 });
      expect(mine.body.data[0].branch).toMatchObject({ club: { id: A.clubId } });
      expect(mine.body.data[0].customer).toBeUndefined();
      const up = await h.http.get(api('/bookings?status=UPCOMING')).set(bearer(cA.token)).expect(200);
      expect(up.body.data.map((b: { id: string }) => b.id)).toEqual([bookingA.id, bookingA2.id]); // start bo'yicha o'sish
      const past = await h.http.get(api('/bookings?status=PAST')).set(bearer(cA.token)).expect(200);
      expect(past.body.data.map((b: { id: string }) => b.id)).toEqual([cancelledA.id]);
      const can = await h.http.get(api('/bookings?status=CANCELLED')).set(bearer(cA.token)).expect(200);
      expect(can.body.data).toHaveLength(1);
      const range = await h.http.get(api(`/bookings?from=${encodeURIComponent(at(10, 12))}&to=${encodeURIComponent(at(10, 16))}`)).set(bearer(cA.token)).expect(200);
      expect(range.body.data.map((b: { id: string }) => b.id)).toEqual([bookingA2.id]);
      await h.http.get(api('/bookings?status=WHATEVER')).set(bearer(cA.token)).expect(422);
      const other = await h.http.get(api('/bookings')).set(bearer(cB.token)).expect(200);
      expect(other.body.data.map((b: { id: string }) => b.id)).not.toContain(bookingA.id);
    });

    it('customer cannot use staff=true (403)', async () => {
      const r = await h.http.get(api('/bookings?staff=true')).set(bearer(cA.token)).expect(403);
      expect(r.body.error.code).toBe('FORBIDDEN');
    });

    it('owner staff list: own club only with full customer phone; other club owner never sees them', async () => {
      const own = await h.http.get(api(`/bookings?staff=true&limit=100&from=${encodeURIComponent(at(10, 0))}&to=${encodeURIComponent(at(11, 0))}`)).set(bearer(A.owner)).expect(200);
      const ids = own.body.data.map((b: { id: string }) => b.id);
      expect(ids).toEqual(expect.arrayContaining([bookingA.id, bookingA2.id, cancelledA.id]));
      for (const b of own.body.data) expect(b.club_id).toBe(A.clubId);
      expect(own.body.data.find((b: { id: string }) => b.id === bookingA.id).customer.phone).toBe(cA.phone);
      const byBranch = await h.http.get(api(`/bookings?staff=true&branch_id=${A2.branchId}&from=${encodeURIComponent(at(10, 0))}&to=${encodeURIComponent(at(11, 0))}`)).set(bearer(A.owner)).expect(200);
      expect(byBranch.body.data.map((b: { id: string }) => b.id)).toEqual([bookingA2.id]);
      const search = await h.http.get(api(`/bookings?staff=true&q=${bookingA.code.toLowerCase()}`)).set(bearer(A.owner)).expect(200);
      expect(search.body.data.map((b: { id: string }) => b.id)).toEqual([bookingA.id]);

      for (const qs of ['', `&club_id=${A.clubId}`, `&branch_id=${A.branchId}`, '&status=PAST', '&status=UPCOMING', `&q=${bookingA.code}`, `&q=${cancelledA.code}&status=PAST`, '&q=GC-']) {
        const r = await h.http.get(api(`/bookings?staff=true&limit=100${qs}`)).set(bearer(B.owner)).expect(200);
        for (const b of r.body.data) expect({ qs, club: b.club_id }).toEqual({ qs, club: B.clubId });
      }
    });

    it('operator list is limited to own branch (even with branch_id/club_id filters) and phones are masked', async () => {
      const r = await h.http.get(api('/bookings?staff=true&limit=100')).set(bearer(op1)).expect(200);
      const ids = r.body.data.map((b: { id: string }) => b.id);
      expect(ids).toContain(bookingA.id);
      expect(ids).not.toContain(bookingA2.id);
      for (const b of r.body.data) expect(b.branch_id).toBe(A.branchId);
      const mine = r.body.data.find((b: { id: string }) => b.id === bookingA.id);
      expect(mine.customer.phone).not.toBe(cA.phone);
      expect(mine.customer.phone).toMatch(/\*\*\*/);
      for (const qs of [`&branch_id=${A2.branchId}`, `&club_id=${A.clubId}`, '&status=PAST', `&q=${bookingA2.code}`]) {
        const x = await h.http.get(api(`/bookings?staff=true&limit=100${qs}`)).set(bearer(op1)).expect(200);
        for (const b of x.body.data) expect({ qs, branch: b.branch_id }).toEqual({ qs, branch: A.branchId });
      }
    });

    it('get by id: owner sees customer, customer sees own; others get 404', async () => {
      const own = await h.http.get(api(`/bookings/${bookingA.id}`)).set(bearer(cA.token)).expect(200);
      expect(own.body.data).toMatchObject({ id: bookingA.id, branch: { id: A.branchId }, club: { id: A.clubId }, can_cancel: true, is_open: false });
      expect(own.body.data.customer).toBeUndefined();
      expect(own.body.data.items[0].device).toMatchObject({ id: A.devices[0], type: 'PC' });
      const staff = await h.http.get(api(`/bookings/${bookingA.id}`)).set(bearer(A.owner)).expect(200);
      expect(staff.body.data.customer).toMatchObject({ phone: cA.phone, no_show_count: 0 });
      const op = await h.http.get(api(`/bookings/${bookingA.id}`)).set(bearer(op1)).expect(200);
      expect(op.body.data.customer.phone).not.toBe(cA.phone);

      for (const [who, token, id] of [['customer B', cB.token, bookingA.id], ['club B owner', B.owner, bookingA.id], ['operator branch 1', op1, bookingA2.id], ['operator branch 2', opA2, bookingA.id]] as const) {
        const r = await h.http.get(api(`/bookings/${id}`)).set(bearer(token));
        expect({ who, status: r.status }).toEqual({ who, status: 404 });
      }
      await h.http.get(api('/bookings/0190a000-0000-7000-8000-000000000000')).set(bearer(cA.token)).expect(404);
      await h.http.get(api('/bookings/not-a-uuid')).set(bearer(cA.token)).expect(400);
      await h.http.get(api(`/bookings/${bookingA.id}`)).expect(401);
    });

    it('QR: signed payload for own active booking; 404 for others; 409 for cancelled', async () => {
      const r = await h.http.get(api(`/bookings/${bookingA.id}/qr`)).set(bearer(cA.token)).expect(200);
      expect(r.body.data.code).toBe(bookingA.code);
      expect(r.body.data.qr_payload).toMatch(new RegExp(`^gc1\\.${bookingA.id}\\.\\d+\\.[A-Za-z0-9_-]+$`));
      expect(typeof r.body.data.expires_at).toBe('string');
      // Imzo taxmin qilib bo'lmaydi: boshqa bron payloadi boshqacha
      const r2 = await h.http.get(api(`/bookings/${bookingA2.id}/qr`)).set(bearer(cA.token)).expect(200);
      expect(r2.body.data.qr_payload.split('.')[3]).not.toBe(r.body.data.qr_payload.split('.')[3]);
      await h.http.get(api(`/bookings/${bookingA.id}/qr`)).set(bearer(cB.token)).expect(404);
      await h.http.get(api(`/bookings/${bookingA.id}/qr`)).set(bearer(B.owner)).expect(404);
      await h.http.get(api(`/bookings/${cancelledA.id}/qr`)).set(bearer(cA.token)).expect(409);
    });

    it('timeline: staff of the branch only', async () => {
      const r = await h.http.get(api(`/bookings/${cancelledA.id}/timeline`)).set(bearer(A.owner)).expect(200);
      expect(r.body.data.map((e: { type: string }) => e.type)).toEqual(['CREATED', 'CANCELLED']);
      expect(r.body.data[1].data).toMatchObject({ reason: 'test', refund_percent: 100, refunded: 0 });
      await h.http.get(api(`/bookings/${bookingA.id}/timeline`)).set(bearer(op1)).expect(200);
      await h.http.get(api(`/bookings/${bookingA.id}/timeline`)).set(bearer(cA.token)).expect(404);
      await h.http.get(api(`/bookings/${bookingA.id}/timeline`)).set(bearer(B.owner)).expect(404);
      await h.http.get(api(`/bookings/${bookingA2.id}/timeline`)).set(bearer(op1)).expect(404);
    });

    it('nobody outside scope can cancel / reschedule / no-show; the booking stays intact', async () => {
      const actors = [['customer B', cB.token], ['club B owner', B.owner], ['operator branch 1', op1]] as const;
      for (const [who, token] of actors) {
        const target = who === 'operator branch 1' ? bookingA2.id : bookingA.id;
        const c = await h.http.post(api(`/bookings/${target}/cancel`)).set(bearer(token)).send({ reason: 'x' });
        const rs = await h.http.post(api(`/bookings/${target}/reschedule`)).set(bearer(token)).send({ start_at: at(11, 10) });
        const ns = await h.http.post(api(`/bookings/${target}/no-show`)).set(bearer(token)).send({});
        expect({ who, cancel: c.status, reschedule: rs.status, noShow: ns.status }).toEqual({ who, cancel: 404, reschedule: 404, noShow: 404 });
      }
      for (const id of [bookingA.id, bookingA2.id]) {
        const d = await h.http.get(api(`/bookings/${id}`)).set(bearer(cA.token)).expect(200);
        expect(d.body.data).toMatchObject({ status: 'CONFIRMED', reschedule_count: 0 });
      }
      // Mijoz o'z bronini no-show qila olmaydi
      await h.http.post(api(`/bookings/${bookingA.id}/no-show`)).set(bearer(cA.token)).send({}).expect(404);
    });
  });

  // ---------------- Bekor qilish ----------------

  describe('cancel', () => {
    it('customer cancels an unpaid booking: CANCELLED, items released, slot bookable again', async () => {
      const c = await customer();
      const start = at(11, 10);
      const b = await confirmed(c.token, A.devices[0], start);
      const r = await h.http.post(api(`/bookings/${b.id}/cancel`)).set(bearer(c.token)).send({ reason: 'Vaqtim yo\'q' }).expect(201);
      expect(r.body.data).toMatchObject({ status: 'CANCELLED', cancellation_reason: 'Vaqtim yo\'q', refund_percent: 100, refunded_amount: 0, can_cancel: false, can_reschedule: false, amount_due: 0 });
      expect(r.body.data.items.every((i: { active: boolean }) => !i.active)).toBe(true);
      expect(await deviceStatus(A.devices[0], start, 60)).toBe('AVAILABLE');
      const c2 = await customer();
      await confirmed(c2.token, A.devices[0], start);
      // Qayta bekor qilish — 409
      const again = await h.http.post(api(`/bookings/${b.id}/cancel`)).set(bearer(c.token)).send({}).expect(409);
      expect(again.body.error.code).toBe('BOOKING_NOT_CANCELLABLE');
    });

    it('customer cancel far ahead refunds 100% of the paid amount', async () => {
      const c = await customer();
      const b = await paid(c.token, A.devices[1], at(11, 12));
      const r = await h.http.post(api(`/bookings/${b.id}/cancel`)).set(bearer(c.token)).send({}).expect(201);
      expect(r.body.data).toMatchObject({ status: 'CANCELLED', refund_percent: 100, refunded_amount: b.total_amount, payment_status: 'REFUNDED' });
      expect(r.body.data.payments[0]).toMatchObject({ status: 'REFUNDED', refunded_amount: b.total_amount });
    });

    it('customer cancel 30–120 min before start refunds 50%; staff cancel refunds 100%', async () => {
      const [c1, c2] = [await customer(), await customer()];
      const start = soon(60); // 60–90 daqiqa qoldi
      const b1 = await paid(c1.token, A.devices[2], start);
      const preview = await h.http.get(api(`/bookings/${b1.id}`)).set(bearer(c1.token)).expect(200);
      expect(preview.body.data.refund_preview).toEqual({ percent: 50, amount: b1.total_amount / 2 });
      const r1 = await h.http.post(api(`/bookings/${b1.id}/cancel`)).set(bearer(c1.token)).send({}).expect(201);
      expect(r1.body.data).toMatchObject({ refund_percent: 50, refunded_amount: b1.total_amount / 2, payment_status: 'PARTIALLY_REFUNDED' });

      const b2 = await paid(c2.token, A.devices[3], start);
      const r2 = await h.http.post(api(`/bookings/${b2.id}/cancel`)).set(bearer(op1)).send({ reason: 'Qurilma nosoz' }).expect(201);
      expect(r2.body.data).toMatchObject({ status: 'CANCELLED', refund_percent: 100, refunded_amount: b2.total_amount, cancelled_by: expect.any(String) });
      const tl = await h.http.get(api(`/bookings/${b2.id}/timeline`)).set(bearer(A.owner)).expect(200);
      expect(tl.body.data.map((e: { type: string }) => e.type)).toEqual(['CREATED', 'PAYMENT', 'CANCELLED']);
    });

    it('refund follows the policy snapshot taken at booking time', async () => {
      const P = await club({ devices: 1 });
      await h.openShift(P.owner, P.branchId);
      const c = await customer();
      const r = await book(c.token, { branch_id: P.branchId, start_at: at(11, 16), duration_minutes: 60, items: [{ device_id: P.devices[0] }] }).expect(201);
      await h.http.post(api('/payments/cash')).set(bearer(P.owner)).send({ booking_id: r.body.data.id, method: 'CASH' }).expect(201);
      // Klub keyin siyosatni "hech qaytarilmaydi" ga o'zgartiradi
      await h.http.patch(api(`/clubs/${P.clubId}/settings`)).set(bearer(P.owner)).send({ cancellation_policy: { free_cancel_minutes_before: 0, rules: [{ min_minutes_before_start: 0, refund_percent: 0 }], platform_fee_refundable: false, no_show_refund_percent: 0 } }).expect(200);
      const x = await h.http.post(api(`/bookings/${r.body.data.id}/cancel`)).set(bearer(c.token)).send({}).expect(201);
      expect(x.body.data).toMatchObject({ refund_percent: 100, refunded_amount: PRICE });
      // Yangi bron yangi siyosat bilan
      const r2 = await book(c.token, { branch_id: P.branchId, start_at: at(11, 18), duration_minutes: 60, items: [{ device_id: P.devices[0] }] }).expect(201);
      await h.http.post(api('/payments/cash')).set(bearer(P.owner)).send({ booking_id: r2.body.data.id, method: 'CASH' }).expect(201);
      const y = await h.http.post(api(`/bookings/${r2.body.data.id}/cancel`)).set(bearer(c.token)).send({}).expect(201);
      expect(y.body.data).toMatchObject({ refund_percent: 0, refunded_amount: 0 });
    });
  });

  // ---------------- Ko'chirish ----------------

  describe('reschedule', () => {
    it('customer moves a booking to a free time; overlapping own range is fine', async () => {
      const c = await customer();
      const b = await confirmed(c.token, A.devices[0], at(12, 10));
      const r = await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c.token)).send({ start_at: at(12, 10, 30) }).expect(201);
      expect(r.body.data).toMatchObject({ start_at: at(12, 10, 30), end_at: at(12, 11, 30), reschedule_count: 1, status: 'CONFIRMED' });
      expect(r.body.data.items[0]).toMatchObject({ start_at: at(12, 10, 30), end_at: at(12, 11, 30), active: true });
      expect(await deviceStatus(A.devices[0], at(12, 10), 30)).toBe('AVAILABLE');
      expect(await deviceStatus(A.devices[0], at(12, 11), 30)).toBe('RESERVED');
      const tl = await h.http.get(api(`/bookings/${b.id}/timeline`)).set(bearer(A.owner)).expect(200);
      expect(tl.body.data.at(-1)).toMatchObject({ type: 'RESCHEDULED', data: { from: at(12, 10), to: at(12, 10, 30), device_id: null } });
    });

    it('taken slot → 409; another device of the branch is allowed; foreign device → 409', async () => {
      const [c1, c2] = [await customer(), await customer()];
      await confirmed(c1.token, A.devices[1], at(12, 14));
      const b = await confirmed(c2.token, A.devices[2], at(12, 16));
      const taken = await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c2.token)).send({ start_at: at(12, 14), device_id: A.devices[1] }).expect(409);
      expect(taken.body.error.code).toBe('BOOKING_SLOT_TAKEN');
      await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c2.token)).send({ start_at: at(12, 14), device_id: B.devices[0] }).expect(409);
      await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c2.token)).send({ start_at: at(12, 14), device_id: A2.devices[0] }).expect(409);
      const ok = await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c2.token)).send({ start_at: at(12, 14), device_id: A.devices[2] }).expect(201);
      expect(ok.body.data.items[0].device_id).toBe(A.devices[2]);
      const unchanged = await h.http.get(api(`/bookings/${b.id}`)).set(bearer(c2.token)).expect(200);
      expect(unchanged.body.data.reschedule_count).toBe(1); // muvaffaqiyatsiz urinishlar hisoblanmaydi
    });

    it('validation: misaligned / past / outside hours / bad body', async () => {
      const c = await customer();
      const b = await confirmed(c.token, A.devices[3], at(12, 18));
      await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c.token)).send({ start_at: at(12, 19, 10) }).expect(422);
      await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c.token)).send({ start_at: soon(-120) }).expect(422);
      await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c.token)).send({ start_at: at(16, 10) }).expect(422);
      await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c.token)).send({}).expect(422);
      await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c.token)).send({ start_at: at(12, 19), duration_minutes: 5 }).expect(422);
      const d = await h.http.get(api(`/bookings/${b.id}`)).set(bearer(c.token)).expect(200);
      expect(d.body.data).toMatchObject({ start_at: at(12, 18), reschedule_count: 0 });
    });

    it('customer limit: at most 2 reschedules; staff can still move it', async () => {
      const c = await customer();
      const b = await confirmed(c.token, A.devices[0], at(13, 10));
      await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c.token)).send({ start_at: at(13, 11) }).expect(201);
      const second = await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c.token)).send({ start_at: at(13, 12) }).expect(201);
      expect(second.body.data.can_reschedule).toBe(false);
      const r = await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c.token)).send({ start_at: at(13, 13) }).expect(409);
      expect(r.body.error.details).toEqual({ reason: 'LIMIT' });
      await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(A.owner)).send({ start_at: at(13, 13) }).expect(201);
    });

    it('too late: less than 60 minutes before start → 409 TOO_LATE', async () => {
      const c = await customer();
      const b = await confirmed(c.token, A.devices[1], soon(30)); // 30–60 daqiqa qoldi
      const r = await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c.token)).send({ start_at: at(13, 15) }).expect(409);
      expect(r.body.error.details).toEqual({ reason: 'TOO_LATE' });
    });

    it('price difference: longer → amount_due; shorter → refund of the difference', async () => {
      const c = await customer();
      const b = await paid(c.token, A.devices[2], at(13, 10), 120);
      const longer = await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c.token)).send({ start_at: at(13, 10), duration_minutes: 180 }).expect(201);
      expect(longer.body.data).toMatchObject({ total_amount: 3 * PRICE, paid_amount: 2 * PRICE, amount_due: PRICE, duration_minutes: 180 });
      const shorter = await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c.token)).send({ start_at: at(13, 10), duration_minutes: 60 }).expect(201);
      expect(shorter.body.data).toMatchObject({ total_amount: PRICE, paid_amount: PRICE, amount_due: 0 });
    });

    it('cannot reschedule cancelled bookings', async () => {
      const c = await customer();
      const b = await confirmed(c.token, A.devices[3], at(13, 20));
      await h.http.post(api(`/bookings/${b.id}/cancel`)).set(bearer(c.token)).send({}).expect(201);
      await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c.token)).send({ start_at: at(13, 22) }).expect(409);
    });

    it('cannot move a booking onto a time when the same customer already has another booking', async () => {
      const c = await customer();
      await confirmed(c.token, A.devices[0], at(13, 16));
      const b = await confirmed(c.token, A.devices[1], at(13, 18));
      const r = await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c.token)).send({ start_at: at(13, 16, 30) }).expect(409);
      expect(r.body.error.details).toEqual({ reason: 'OVERLAP' });
      const d = await h.http.get(api(`/bookings/${b.id}`)).set(bearer(c.token)).expect(200);
      expect(d.body.data.start_at).toBe(at(13, 18));
      // Xodim ko'chirsa ham mijozning boshqa broni bilan ustma-ust tushmaydi
      await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(A.owner)).send({ start_at: at(13, 16, 30) }).expect(409);
      // O'z oralig'iga yaqin siljitish — mumkin
      await h.http.post(api(`/bookings/${b.id}/reschedule`)).set(bearer(c.token)).send({ start_at: at(13, 17) }).expect(201);
    });

    it('an expired hold cannot be rescheduled', async () => {
      const c = await customer();
      const r = await book(c.token, { branch_id: A.branchId, start_at: at(13, 14), duration_minutes: 60, items: [{ device_id: A.devices[3] }] }).expect(201);
      await prisma.bookings.update({ where: { id: r.body.data.id }, data: { hold_expires_at: new Date(Date.now() - 1000) } });
      const x = await h.http.post(api(`/bookings/${r.body.data.id}/reschedule`)).set(bearer(c.token)).send({ start_at: at(13, 16) });
      expect(x.status).toBe(409);
      expect(['BOOKING_HOLD_EXPIRED', 'CONFLICT']).toContain(x.body.error.code);
      const d = await h.http.get(api(`/bookings/${r.body.data.id}`)).set(bearer(c.token)).expect(200);
      expect(d.body.data.start_at).toBe(at(13, 14));
      expect(d.body.data.reschedule_count).toBe(0);
    });
  });

  // ---------------- No-show ----------------

  describe('no-show', () => {
    it('staff marks a started booking NO_SHOW: device released, customer counter incremented', async () => {
      const c = await customer();
      const b = await confirmed(c.token, A.devices[3], at(13, 8));
      // Bron allaqachon boshlangan (sweeper 5 daqiqadan keyin oladi — undan oldin)
      const start = new Date(Date.now() - 2 * 60_000);
      await prisma.bookings.update({ where: { id: b.id }, data: { start_at: start, end_at: new Date(start.getTime() + 3600_000) } });
      const r = await h.http.post(api(`/bookings/${b.id}/no-show`)).set(bearer(op1)).send({}).expect(201);
      expect(r.body.data.status).toBe('NO_SHOW');
      expect(r.body.data.no_show_marked_at).toEqual(expect.any(String));
      expect(r.body.data.items.every((i: { active: boolean }) => !i.active)).toBe(true);
      const user = await prisma.users.findUniqueOrThrow({ where: { id: r.body.data.customer_id } });
      expect(user.no_show_count).toBe(1);
      const tl = await h.http.get(api(`/bookings/${b.id}/timeline`)).set(bearer(A.owner)).expect(200);
      expect(tl.body.data.at(-1).type).toBe('NO_SHOW');
      // Takror — 409; bekor qilib ham bo'lmaydi
      await h.http.post(api(`/bookings/${b.id}/no-show`)).set(bearer(op1)).send({}).expect(409);
      await h.http.post(api(`/bookings/${b.id}/cancel`)).set(bearer(c.token)).send({}).expect(409);
    });

    it('future or unpaid-hold bookings cannot be marked NO_SHOW', async () => {
      const c = await customer();
      const future = await confirmed(c.token, A.devices[0], at(13, 22));
      const r = await h.http.post(api(`/bookings/${future.id}/no-show`)).set(bearer(A.owner)).send({}).expect(409);
      expect(r.body.error.code).toBe('CONFLICT');
      const hold = await book(c.token, { branch_id: A.branchId, start_at: at(12, 22), duration_minutes: 60, items: [{ device_id: A.devices[0] }] }).expect(201);
      await h.http.post(api(`/bookings/${hold.body.data.id}/no-show`)).set(bearer(A.owner)).send({}).expect(409);
    });

    it('phone booking that already started can be marked no-show by staff', async () => {
      const ok = await book(A.owner, { branch_id: A2.branchId, start_at: new Date(Date.now() - 2 * 60_000).toISOString(), duration_minutes: 60, items: [{ device_id: A2.devices[1] }], source: 'PHONE', guest_name: 'Kelmadi' }).expect(201);
      // 1-filial operatori 2-filial bronini belgilay olmaydi
      await h.http.post(api(`/bookings/${ok.body.data.id}/no-show`)).set(bearer(op1)).send({}).expect(404);
      const x = await h.http.post(api(`/bookings/${ok.body.data.id}/no-show`)).set(bearer(A.owner)).send({}).expect(201);
      expect(x.body.data.status).toBe('NO_SHOW');
    });
  });
});
