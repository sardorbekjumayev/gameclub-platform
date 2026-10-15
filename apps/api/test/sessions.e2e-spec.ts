import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service';
import { RealtimeGateway } from '../src/modules/realtime/realtime.gateway';
import { RealtimeService } from '../src/modules/realtime/realtime.service';
import { api, bearer, Harness, slot, TestClub } from './utils/harness';

/**
 * Sessiyalar (docs/01-API.md §6.9 check-in/walk-in, §6.11 sessions, §9 realtime):
 * to'liq hayot sikli, pauza/davom, uzaytirish, ko'chirish, yakunlash, overtime, idempotentlik,
 * parallel so'rovlar, scope/permission va audit.
 * Vaqtga bog'liq holatlar `sleep` o'rniga DB vaqt belgilarini siljitish orqali.
 */
describe('Sessions (e2e)', () => {
  const PRICE = 1_200_000; // 12 000 so'm/soat (tiyin)
  const HALF = PRICE / 2;
  const h = new Harness();
  let prisma: PrismaService;
  let A: TestClub;
  let B: TestClub;
  let d: string[];
  let branch2: string;
  let customer: { token: string; phone: string };
  let other: { token: string; phone: string };
  let op1: string;
  let op2: string;
  const customRoles: string[] = [];
  let aheadSeq = 0;

  const sub = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub as string;
  const n = (v: unknown) => {
    const x = Number(v);
    expect(Number.isInteger(x)).toBe(true);
    return x;
  };
  const idem = () => ({ 'Idempotency-Key': randomUUID() });
  /**
   * IdempotencyInterceptor javobni `void` bilan (javob yuborilgandan keyin) saqlaydi — darhol takrorlansa
   * "in progress" 409 qaytishi mumkin. Takroriy natijani tekshirishdan oldin saqlanishini kutamiz.
   */
  const stored = async (headers: Record<string, string>) => {
    for (let i = 0; i < 100; i++) {
      const row = await prisma.idempotency_keys.findFirst({ where: { key: headers['Idempotency-Key'] } });
      if (row?.response_body != null) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('idempotent response was never stored');
  };

  /** Mijoz klubda to'lash sharti bilan bron qiladi (CONFIRMED). Har biri alohida kelajak slotida. */
  const book = async (token: string, deviceId: string, duration = 60) => {
    const r = await h.http
      .post(api('/bookings'))
      .set(bearer(token))
      .send({ branch_id: A.branchId, start_at: slot(24 * 60 + 180 * aheadSeq++), duration_minutes: duration, items: [{ device_id: deviceId }], payment_mode: 'AT_CLUB' });
    expect(r.status).toBe(201);
    return r.body.data;
  };
  /** Bronni hozirgi vaqtga (check-in oynasiga) siljitish. */
  const shiftToNow = async (bookingId: string, offsetMin = 0) => {
    const b = await prisma.bookings.findUniqueOrThrow({ where: { id: bookingId } });
    const start = new Date(Date.now() + offsetMin * 60_000);
    const end = new Date(start.getTime() + b.duration_minutes * 60_000);
    await prisma.$transaction([
      prisma.booking_items.updateMany({ where: { booking_id: bookingId }, data: { start_at: start, end_at: end, blocked_until: end } }),
      prisma.bookings.update({ where: { id: bookingId }, data: { start_at: start, end_at: end } }),
    ]);
  };
  const walkIn = (token: string, deviceId: string | string[], extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    h.http
      .post(api('/bookings/walk-in'))
      .set(bearer(token))
      .set(headers)
      .send({ branch_id: A.branchId, device_ids: Array.isArray(deviceId) ? deviceId : [deviceId], duration_minutes: 60, payment_method: 'LATER', guest_name: 'Mehmon', ...extra });
  /** Walk-in (LATER) + sessiya id. */
  const startWalkIn = async (deviceId: string, token = A.owner, duration = 60) => {
    const r = await walkIn(token, deviceId, { duration_minutes: duration });
    expect(r.status).toBe(201);
    expect(r.body.data.session?.status).toBe('ACTIVE');
    return { bookingId: r.body.data.id as string, sessionId: r.body.data.session.id as string };
  };
  const live = async (token = A.owner, branchId = A.branchId) => {
    const r = await h.http.get(api(`/branches/${branchId}/live`)).set(bearer(token)).expect(200);
    return r.body.data;
  };
  const liveDevice = async (deviceId: string) => (await live()).devices.find((x: { id: string }) => x.id === deviceId);
  const act = (token: string, sessionId: string, action: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    h.http.post(api(`/sessions/${sessionId}/${action}`)).set(bearer(token)).set(headers).send(body);
  const audits = (targetId: string, action?: string) => prisma.audit_logs.findMany({ where: { target_id: targetId, ...(action ? { action } : {}) } });

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    await h.resetRateLimits();
    A = await h.club({ devices: 0, pricePerHour: PRICE });
    B = await h.club({ devices: 2, pricePerHour: PRICE });
    // Plan limitlariga urilmaslik uchun o'z test klubimiz ENTERPRISE rejaga o'tkaziladi (global sozlama emas)
    const ent = await prisma.plans.findFirstOrThrow({ where: { code: 'ENTERPRISE' } });
    await prisma.subscriptions.updateMany({ where: { club_id: A.clubId }, data: { plan_id: ent.id } });
    await h.http.post(api(`/branches/${A.branchId}/devices/bulk`)).set(bearer(A.owner)).send({ prefix: 'PC-', from: 1, to: 20, type: 'PC' }).expect(201);
    const list = await h.http.get(api(`/branches/${A.branchId}/devices`)).set(bearer(A.owner)).expect(200);
    d = (list.body.data as { id: string; name: string }[]).sort((a, b) => a.name.localeCompare(b.name)).map((x) => x.id);
    expect(d).toHaveLength(20);
    branch2 = (
      await h.http
        .post(api(`/clubs/${A.clubId}/branches`))
        .set(bearer(A.owner))
        .send({ name: 'Ikkinchi', address: 'Toshkent, Yunusobod 2', latitude: 41.35, longitude: 69.28, working_hours: { always_open: true } })
        .expect(201)
    ).body.data.id;
    await h.resetRateLimits();
    customer = await h.customer();
    other = await h.customer();
    op1 = (await h.staff(A, 'OPERATOR', A.branchId)).token;
    op2 = (await h.staff(A, 'OPERATOR', branch2)).token;
  });

  afterAll(async () => {
    if (prisma && customRoles.length) {
      await prisma.user_roles.deleteMany({ where: { role_id: { in: customRoles } } });
      await prisma.roles.deleteMany({ where: { id: { in: customRoles } } });
    }
    await h.stop();
  });

  // ---------------------------------------------------------------- hayot sikli

  describe('full lifecycle: book → check-in → start → pause/resume → extend → move → stop', () => {
    let booking: { id: string; code: string };
    let sessionId: string;
    let endBeforePause: number;
    let remainingAtPause: number;

    it('customer books (pay at club) — CONFIRMED with the server-computed integer price', async () => {
      booking = await book(customer.token, d[0]);
      expect(booking).toMatchObject({ status: 'CONFIRMED', source: 'APP' });
      expect(n((booking as unknown as { total_amount: number }).total_amount)).toBe(PRICE);
    });

    it('check-in outside the window is rejected; customer cannot check in at the desk endpoint', async () => {
      const r = await h.http.post(api(`/bookings/${booking.id}/check-in`)).set(bearer(A.owner)).send({}).expect(409);
      expect(r.body.error.code).toBe('BOOKING_CHECKIN_WINDOW_CLOSED');
      await h.http.post(api(`/bookings/${booking.id}/check-in`)).set(bearer(customer.token)).send({}).expect(403);
    });

    it('staff checks in by id inside the window (repeat is a no-op)', async () => {
      await shiftToNow(booking.id, 5);
      const r = await h.http.post(api(`/bookings/${booking.id}/check-in`)).set(bearer(op1)).set(idem()).send({}).expect(201);
      expect(r.body.data.status).toBe('CHECKED_IN');
      expect(r.body.data.checked_in_by).toBe(sub(op1));
      const again = await h.http.post(api(`/bookings/${booking.id}/check-in`)).set(bearer(op1)).send({}).expect(201);
      expect(again.body.data.status).toBe('CHECKED_IN');
      expect(await audits(booking.id, 'booking.checkin')).toHaveLength(1);
    });

    it('customer cannot start the session (403); staff starts it — full booked duration from now', async () => {
      await h.http.post(api('/sessions')).set(bearer(customer.token)).send({ booking_id: booking.id }).expect(403);
      const before = Date.now();
      const r = await h.http.post(api('/sessions')).set(bearer(op1)).set(idem()).send({ booking_id: booking.id }).expect(201);
      expect(Array.isArray(r.body.data)).toBe(true);
      const s = r.body.data[0];
      sessionId = s.id;
      expect(s).toMatchObject({ status: 'ACTIVE', device_id: d[0], booking_id: booking.id, customer_id: sub(customer.token), is_open: false });
      // 5 daqiqa erta boshlansa ham to'liq 60 daqiqa beriladi
      const end = new Date(s.expected_end_at).getTime();
      expect(end).toBeGreaterThanOrEqual(before + 60 * 60_000 - 1000);
      expect(end).toBeLessThanOrEqual(Date.now() + 60 * 60_000 + 1000);
      expect(s.remaining_seconds).toBeGreaterThan(59 * 60);
      expect(s.booking.status).toBe('ACTIVE');
      expect(await audits(sessionId, 'session.start')).toHaveLength(1);

      // Takroriy start yangi sessiya yaratmaydi
      const again = await h.http.post(api('/sessions')).set(bearer(op1)).send({ booking_id: booking.id }).expect(201);
      expect(again.body.data[0].id).toBe(sessionId);
      expect(await prisma.sessions.count({ where: { booking_id: booking.id } })).toBe(1);
    });

    it('live board shows the device OCCUPIED with remaining time and the session in KPIs', async () => {
      const board = await live(op1);
      const dev = board.devices.find((x: { id: string }) => x.id === d[0]);
      expect(dev.occupancy).toBe('OCCUPIED');
      expect(dev.session).toMatchObject({ id: sessionId, status: 'ACTIVE', booking_code: booking.code, is_open: false });
      expect(dev.session.remaining_seconds).toBeGreaterThan(59 * 60);
      expect(n(dev.session.amount_due)).toBe(PRICE);
      expect(board.stats.active_sessions).toBeGreaterThanOrEqual(1);
      expect(board.stats.total_devices).toBe(20);
    });

    it('customer sees own session (GET /sessions/:id, /sessions/active); another customer gets 404', async () => {
      const g = await h.http.get(api(`/sessions/${sessionId}`)).set(bearer(customer.token)).expect(200);
      expect(g.body.data).toMatchObject({ id: sessionId, status: 'ACTIVE' });
      expect(n(g.body.data.amount_due)).toBe(PRICE);
      const mine = await h.http.get(api('/sessions/active')).set(bearer(customer.token)).expect(200);
      expect(mine.body.data.map((x: { id: string }) => x.id)).toContain(sessionId);
      expect(mine.body.data.find((x: { id: string }) => x.id === sessionId).branch.id).toBe(A.branchId);
      await h.http.get(api(`/sessions/${sessionId}`)).set(bearer(other.token)).expect(404);
      const theirs = await h.http.get(api('/sessions/active')).set(bearer(other.token)).expect(200);
      expect(theirs.body.data).toEqual([]);
      const staffList = await h.http.get(api(`/sessions/active?branch_id=${A.branchId}`)).set(bearer(op1)).expect(200);
      expect(staffList.body.data.map((x: { id: string }) => x.id)).toContain(sessionId);
    });

    it('pause freezes the remaining time; double pause is a conflict', async () => {
      const r = await act(op1, sessionId, 'pause', {}, idem()).expect(201);
      expect(r.body.data.status).toBe('PAUSED');
      endBeforePause = new Date(r.body.data.expected_end_at).getTime();
      const remaining = r.body.data.remaining_seconds as number;
      const again = await act(op1, sessionId, 'pause').expect(409);
      expect(again.body.error.code).toBe('CONFLICT');
      // 10 daqiqa pauzada turdi
      const s = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      await prisma.sessions.update({ where: { id: sessionId }, data: { paused_at: new Date(s.paused_at!.getTime() - 10 * 60_000) } });
      // Pauza paytida qolgan vaqt = expected_end − paused_at (vaqt o'tsa ham o'zgarmaydi)
      const g = await h.http.get(api(`/sessions/${sessionId}`)).set(bearer(op1)).expect(200);
      expect(Math.abs(g.body.data.remaining_seconds - (remaining + 600))).toBeLessThanOrEqual(5);
      const dev = await liveDevice(d[0]);
      expect(dev.session.status).toBe('PAUSED');
      expect(Math.abs(dev.session.remaining_seconds - (remaining + 600))).toBeLessThanOrEqual(5);
      remainingAtPause = remaining + 600;
    });

    it('resume pushes expected_end_at by the paused time and keeps remaining time', async () => {
      const r = await act(op1, sessionId, 'resume', {}, idem()).expect(201);
      expect(r.body.data).toMatchObject({ status: 'ACTIVE', paused_at: null, warning: null });
      const end = new Date(r.body.data.expected_end_at).getTime();
      expect(Math.abs(end - (endBeforePause + 10 * 60_000))).toBeLessThanOrEqual(5_000);
      expect(Math.abs(r.body.data.total_paused_seconds - 600)).toBeLessThanOrEqual(5);
      expect(Math.abs(r.body.data.remaining_seconds - remainingAtPause)).toBeLessThanOrEqual(5);
      // booking_item ham cho'zilgan (qurilma shu vaqtgacha band)
      const s = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      const item = await prisma.booking_items.findUniqueOrThrow({ where: { id: s.booking_item_id! } });
      expect(item.end_at.getTime()).toBe(end);
      await act(op1, sessionId, 'resume').expect(409);
      expect(await audits(sessionId, 'session.pause')).toHaveLength(1);
      expect(await audits(sessionId, 'session.resume')).toHaveLength(1);
    });

    it('extend validation: 422 on bad minutes / payment method', async () => {
      for (const body of [{ minutes: 10 }, { minutes: 721 }, { minutes: 'x' }, {}, { minutes: 30, payment_method: 'BITCOIN' }]) {
        const r = await act(op1, sessionId, 'extend', body);
        expect(r.status).toBe(422);
        expect(r.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('extend with CASH needs an open shift — nothing is applied without it', async () => {
      const before = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      const r = await act(op1, sessionId, 'extend', { minutes: 30, payment_method: 'CASH' }).expect(409);
      expect(r.body.error.details.reason).toBe('SHIFT_REQUIRED');
      const after = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      expect(after.expected_end_at!.getTime()).toBe(before.expected_end_at!.getTime());
      expect(await prisma.session_charges.count({ where: { session_id: sessionId } })).toBe(0);
      expect(n((await prisma.bookings.findUniqueOrThrow({ where: { id: booking.id } })).total_amount)).toBe(PRICE);
    });

    it('extend +30 min adds the tariff price (integer tiyin) and moves the end', async () => {
      const before = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      const r = await act(op1, sessionId, 'extend', { minutes: 30, payment_method: 'LATER' }, idem()).expect(201);
      expect(n(r.body.data.extension_amount)).toBe(HALF);
      expect(new Date(r.body.data.expected_end_at).getTime()).toBe(before.expected_end_at!.getTime() + 30 * 60_000);
      expect(n(r.body.data.booking.total_amount)).toBe(PRICE + HALF);
      expect(n(r.body.data.amount_due)).toBe(PRICE + HALF);
      expect(r.body.data.charges).toHaveLength(1);
      expect(r.body.data.charges[0]).toMatchObject({ type: 'EXTENSION', minutes: 30 });
      expect(n(r.body.data.charges[0].amount)).toBe(HALF);
      const b = await prisma.bookings.findUniqueOrThrow({ where: { id: booking.id } });
      expect(b.duration_minutes).toBe(90);
      expect(b.end_at.getTime()).toBe(before.expected_end_at!.getTime() + 30 * 60_000);
      const a = await audits(sessionId, 'session.extend');
      expect(a).toHaveLength(1);
      expect(a[0].new_value).toMatchObject({ minutes: 30, amount: HALF });
    });

    it('extend is blocked when the next booking starts right after (SESSION_EXTEND_CONFLICT)', async () => {
      const s = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      await h.http
        .post(api('/bookings'))
        .set(bearer(A.owner))
        .send({ branch_id: A.branchId, start_at: s.expected_end_at!.toISOString(), duration_minutes: 60, items: [{ device_id: d[0] }], source: 'PHONE', guest_name: 'Keyingi' })
        .expect(201);
      const r = await act(op1, sessionId, 'extend', { minutes: 15 }).expect(409);
      expect(r.body.error.code).toBe('SESSION_EXTEND_CONFLICT');
      const after = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      expect(after.expected_end_at!.getTime()).toBe(s.expected_end_at!.getTime());
      expect(await prisma.session_charges.count({ where: { session_id: sessionId } })).toBe(1);
      expect(n((await prisma.bookings.findUniqueOrThrow({ where: { id: booking.id } })).total_amount)).toBe(PRICE + HALF);
    });

    it('move is blocked when the target is busy, unknown or in another branch/club', async () => {
      await startWalkIn(d[2]);
      const busy = await act(op1, sessionId, 'move', { to_device_id: d[2] }).expect(409);
      expect(busy.body.error.code).toBe('DEVICE_NOT_AVAILABLE');
      for (const target of [B.devices[0], randomUUID()]) {
        const r = await act(op1, sessionId, 'move', { to_device_id: target }).expect(409);
        expect(r.body.error.code).toBe('DEVICE_NOT_AVAILABLE');
      }
      await act(op1, sessionId, 'move', { to_device_id: 'nope' }).expect(422);
      expect((await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } })).device_id).toBe(d[0]);
    });

    it('move to a free device: session and booking item follow, the old PC becomes free', async () => {
      const r = await act(op1, sessionId, 'move', { to_device_id: d[1] }, idem()).expect(201);
      expect(r.body.data).toMatchObject({ id: sessionId, device_id: d[1], status: 'ACTIVE' });
      const s = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      expect((await prisma.booking_items.findUniqueOrThrow({ where: { id: s.booking_item_id! } })).device_id).toBe(d[1]);
      const board = await live(op1);
      const oldDev = board.devices.find((x: { id: string }) => x.id === d[0]);
      const newDev = board.devices.find((x: { id: string }) => x.id === d[1]);
      expect(oldDev.session).toBeNull();
      expect(oldDev.occupancy).not.toBe('OCCUPIED');
      expect(newDev.occupancy).toBe('OCCUPIED');
      expect(newDev.session.id).toBe(sessionId);
      const a = await audits(sessionId, 'session.move');
      expect(a).toHaveLength(1);
      expect(await prisma.booking_events.count({ where: { booking_id: booking.id, type: 'SESSION_MOVED' } })).toBe(1);
    });

    it('customer cannot stop (403); staff stops — COMPLETED, device free, amounts in integer tiyin', async () => {
      await act(customer.token, sessionId, 'stop').expect(403);
      const r = await act(op1, sessionId, 'stop', {}, idem()).expect(201);
      expect(r.body.data).toMatchObject({ id: sessionId, status: 'COMPLETED', end_reason: 'COMPLETED', overtime_minutes: 0, remaining_seconds: null });
      expect(n(r.body.data.overtime_amount)).toBe(0);
      expect(r.body.data.ended_at).toBeTruthy();
      expect(r.body.data.ended_by).toBe(sub(op1));
      expect(r.body.data.booking.status).toBe('COMPLETED');
      expect(n(r.body.data.booking.total_amount)).toBe(PRICE + HALF);
      expect(n(r.body.data.booking.paid_amount)).toBe(0);
      expect(n(r.body.data.amount_due)).toBe(PRICE + HALF);
      const s = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      expect((await prisma.booking_items.findUniqueOrThrow({ where: { id: s.booking_item_id! } })).active).toBe(false);
      const dev = await liveDevice(d[1]);
      expect(dev.session).toBeNull();
      expect(dev.occupancy).toBe('AVAILABLE');
      expect(await audits(sessionId, 'session.stop')).toHaveLength(1);
      const again = await act(op1, sessionId, 'stop').expect(409);
      expect(again.body.error.code).toBe('CONFLICT');
      // Yakunlangan sessiyani boshqarib bo'lmaydi
      await act(op1, sessionId, 'pause').expect(409);
      await act(op1, sessionId, 'extend', { minutes: 30 }).expect(409);
      await act(op1, sessionId, 'move', { to_device_id: d[3] }).expect(409);
      // Mijozning faol sessiyalari ro'yxatidan chiqdi
      const mine = await h.http.get(api('/sessions/active')).set(bearer(customer.token)).expect(200);
      expect(mine.body.data.map((x: { id: string }) => x.id)).not.toContain(sessionId);
    });

    it('the freed device can immediately take a new walk-in', async () => {
      await startWalkIn(d[1]);
    });
  });

  // ---------------------------------------------------------------- QR / kod bo'yicha check-in

  describe('check-in/scan', () => {
    it('QR payload from the customer app → check-in and start in one step', async () => {
      const b = await book(customer.token, d[3]);
      await shiftToNow(b.id, -2);
      const qr = await h.http.get(api(`/bookings/${b.id}/qr`)).set(bearer(customer.token)).expect(200);
      expect(qr.body.data.qr_payload).toMatch(/^gc1\./);
      const r = await h.http.post(api('/bookings/check-in/scan')).set(bearer(op1)).send({ qr_payload: qr.body.data.qr_payload, start_session: true }).expect(201);
      expect(Array.isArray(r.body.data)).toBe(true);
      expect(r.body.data[0]).toMatchObject({ status: 'ACTIVE', device_id: d[3], booking_id: b.id });
      const booking = await prisma.bookings.findUniqueOrThrow({ where: { id: b.id } });
      expect(booking.status).toBe('ACTIVE');
      expect(booking.checked_in_by).toBe(sub(op1));
      expect((await liveDevice(d[3])).occupancy).toBe('OCCUPIED');
    });

    it('booking code (case/space-insensitive) → CHECKED_IN without a session', async () => {
      const b = await book(customer.token, d[4]);
      await shiftToNow(b.id, 10);
      const r = await h.http.post(api('/bookings/check-in/scan')).set(bearer(op1)).send({ qr_payload: `  ${b.code.toLowerCase()} ` }).expect(201);
      expect(r.body.data).toMatchObject({ id: b.id, status: 'CHECKED_IN' });
      expect(r.body.data.session).toBeNull();
      expect(await prisma.sessions.count({ where: { booking_id: b.id } })).toBe(0);
    });

    it('invalid QR → 422, unknown code → 404, other club / customer cannot scan', async () => {
      const bad = await h.http.post(api('/bookings/check-in/scan')).set(bearer(op1)).send({ qr_payload: 'gc1.forged.123.abc' }).expect(422);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
      await h.http.post(api('/bookings/check-in/scan')).set(bearer(op1)).send({ qr_payload: 'GC-ZZZZZZ' }).expect(404);
      await h.http.post(api('/bookings/check-in/scan')).set(bearer(op1)).send({}).expect(422);
      const b = await book(customer.token, d[5]);
      await shiftToNow(b.id, 5);
      await h.http.post(api('/bookings/check-in/scan')).set(bearer(B.owner)).send({ qr_payload: b.code }).expect(404);
      await h.http.post(api('/bookings/check-in/scan')).set(bearer(op2)).send({ qr_payload: b.code }).expect(404);
      await h.http.post(api('/bookings/check-in/scan')).set(bearer(customer.token)).send({ qr_payload: b.code }).expect(403);
      expect((await prisma.bookings.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('CONFIRMED');
      // Sessiyasiz qolmasin: bekor qilinadi
      await h.http.post(api(`/bookings/${b.id}/cancel`)).set(bearer(A.owner)).send({ reason: 'e2e' });
    });
  });

  // ---------------------------------------------------------------- overtime

  describe('stop: overtime', () => {
    const ageSession = async (sessionId: string, overMinutes: number) => {
      const end = new Date(Date.now() - overMinutes * 60_000);
      await prisma.sessions.update({ where: { id: sessionId }, data: { started_at: new Date(end.getTime() - 60 * 60_000), expected_end_at: end } });
    };

    it('stopping 40 min late charges OVERTIME at the tariff (integer tiyin)', async () => {
      const { bookingId, sessionId } = await startWalkIn(d[6]);
      await ageSession(sessionId, 40);
      const r = await act(op1, sessionId, 'stop').expect(201);
      expect(r.body.data.overtime_minutes).toBe(40);
      expect(n(r.body.data.overtime_amount)).toBe((PRICE * 40) / 60);
      expect(r.body.data.charges.map((c: { type: string }) => c.type)).toEqual(['OVERTIME']);
      const b = await prisma.bookings.findUniqueOrThrow({ where: { id: bookingId } });
      expect(n(b.total_amount)).toBe(PRICE + (PRICE * 40) / 60);
      expect(b.status).toBe('COMPLETED');
    });

    it('within the grace period or with waive_overtime → no charge; reason marks FORCE_STOPPED', async () => {
      const a = await startWalkIn(d[7]);
      await ageSession(a.sessionId, 3);
      const r1 = await act(op1, a.sessionId, 'stop').expect(201);
      expect(r1.body.data.overtime_minutes).toBe(0);
      expect(r1.body.data.charges).toEqual([]);

      const b = await startWalkIn(d[7]);
      await ageSession(b.sessionId, 45);
      const r2 = await act(op1, b.sessionId, 'stop', { waive_overtime: true, reason: 'Mijoz shikoyati' }).expect(201);
      expect(r2.body.data).toMatchObject({ overtime_minutes: 0, end_reason: 'FORCE_STOPPED' });
      expect(n((await prisma.bookings.findUniqueOrThrow({ where: { id: b.bookingId } })).total_amount)).toBe(PRICE);
    });

    it('stopping a paused session completes it and clears paused_at', async () => {
      const { sessionId } = await startWalkIn(d[8]);
      await act(op1, sessionId, 'pause').expect(201);
      const r = await act(op1, sessionId, 'stop').expect(201);
      expect(r.body.data).toMatchObject({ status: 'COMPLETED', paused_at: null });
    });
  });

  describe('open (VIP) session pause/resume', () => {
    it('paused time is excluded from billable time and the session stays open-ended', async () => {
      const r = await walkIn(op1, d[7], { open: true, duration_minutes: undefined }).expect(201);
      const sessionId = r.body.data.session.id as string;
      // 48 daqiqa oldin boshlangan, 20 daqiqasi pauzada → 28 daqiqa o'ynalgan
      await prisma.sessions.update({ where: { id: sessionId }, data: { started_at: new Date(Date.now() - 48 * 60_000) } });
      await act(op1, sessionId, 'pause').expect(201);
      await prisma.sessions.update({ where: { id: sessionId }, data: { paused_at: new Date(Date.now() - 20 * 60_000) } });
      const rs = await Promise.all([act(op1, sessionId, 'resume'), act(A.owner, sessionId, 'resume')]);
      expect(rs.map((x) => x.status).sort()).toEqual([201, 409]);
      const ok = rs.find((x) => x.status === 201)!;
      expect(ok.body.data).toMatchObject({ status: 'ACTIVE', expected_end_at: null, is_open: true });
      expect(Math.abs(ok.body.data.total_paused_seconds - 1200)).toBeLessThanOrEqual(5);
      // Minimal 30 daqiqa → yarim soat narxi (pauza hisobga olinmaydi)
      const stop = await act(op1, sessionId, 'stop', { payment_method: 'LATER' }).expect(201);
      expect(stop.body.data.open_minutes).toBe(30);
      expect(n(stop.body.data.open_amount)).toBe(HALF);
    });
  });

  // ---------------------------------------------------------------- walk-in

  describe('walk-in', () => {
    it('CASH without an open shift → 409 SHIFT_REQUIRED and nothing is created', async () => {
      const r = await walkIn(op1, d[9], { payment_method: 'CASH' }).expect(409);
      expect(r.body.error.details.reason).toBe('SHIFT_REQUIRED');
      expect(await prisma.booking_items.count({ where: { device_id: d[9] } })).toBe(0);
      expect(await prisma.sessions.count({ where: { device_id: d[9] } })).toBe(0);
    });

    it('LATER: booking WALK_IN + session started, the debt stays as amount_due', async () => {
      const r = await walkIn(op1, d[9], { duration_minutes: 90, guest_phone: customer.phone }, idem()).expect(201);
      expect(r.body.data).toMatchObject({ source: 'WALK_IN', status: 'ACTIVE', payment_status: 'UNPAID', customer_id: sub(customer.token), duration_minutes: 90 });
      expect(n(r.body.data.total_amount)).toBe(PRICE + HALF);
      expect(n(r.body.data.amount_due)).toBe(PRICE + HALF);
      expect(r.body.data.session).toMatchObject({ status: 'ACTIVE', device_id: d[9] });
      expect(r.body.data.payments).toEqual([]);
      const a = await audits(r.body.data.id, 'booking.walk_in');
      expect(a).toHaveLength(1);
      expect(a[0].actor_id).toBe(sub(op1));
      // Telefon bo'yicha topilgan mijoz o'z sessiyasini ko'radi
      const mine = await h.http.get(api('/sessions/active')).set(bearer(customer.token)).expect(200);
      expect(mine.body.data.map((x: { id: string }) => x.id)).toContain(r.body.data.session.id);
    });

    it('start_now=false: CHECKED_IN without a session, started later via POST /sessions', async () => {
      const r = await walkIn(op1, d[10], { start_now: false }).expect(201);
      expect(r.body.data).toMatchObject({ status: 'CHECKED_IN', session: null });
      const s = await h.http.post(api('/sessions')).set(bearer(op1)).send({ booking_id: r.body.data.id, device_id: d[10] }).expect(201);
      expect(s.body.data[0]).toMatchObject({ status: 'ACTIVE', device_id: d[10] });
    });

    it('occupied device → 409 BOOKING_SLOT_TAKEN', async () => {
      const r = await walkIn(op1, d[10]).expect(409);
      expect(r.body.error.code).toBe('BOOKING_SLOT_TAKEN');
    });

    it('422 on invalid payloads', async () => {
      const cases: Record<string, unknown>[] = [
        { duration_minutes: undefined },
        { duration_minutes: 10 },
        { duration_minutes: 1441 },
        { payment_method: 'BITCOIN' },
        { payment_method: undefined },
        { device_ids: [] },
        { device_ids: ['not-a-uuid'] },
        { branch_id: 'x' },
        { guest_phone: '12345' },
        { guest_name: 'x'.repeat(81) },
        { open: true, package_id: randomUUID() },
      ];
      for (const c of cases) {
        const r = await walkIn(op1, d[11], c);
        expect({ c, status: r.status }).toEqual({ c, status: 422 });
        expect(r.body.error.code).toBe('VALIDATION_ERROR');
      }
      expect(await prisma.booking_items.count({ where: { device_id: d[11] } })).toBe(0);
    });

    it('device of another branch/club → 404', async () => {
      await walkIn(A.owner, B.devices[0]).expect(404);
    });
  });

  // ---------------------------------------------------------------- idempotentlik

  describe('Idempotency-Key', () => {
    it('extend replayed with the same key extends once and returns the same result', async () => {
      const { bookingId, sessionId } = await startWalkIn(d[12]);
      const before = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      const key = { 'Idempotency-Key': randomUUID() };
      const r1 = await act(op1, sessionId, 'extend', { minutes: 30 }, key).expect(201);
      await stored(key);
      const r2 = await act(op1, sessionId, 'extend', { minutes: 30 }, key);
      expect(r2.status).toBe(201);
      expect(r2.body.data.expected_end_at).toBe(r1.body.data.expected_end_at);
      expect(r2.body.data.extension_amount).toBe(r1.body.data.extension_amount);
      const after = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      expect(after.expected_end_at!.getTime()).toBe(before.expected_end_at!.getTime() + 30 * 60_000);
      expect(await prisma.session_charges.count({ where: { session_id: sessionId } })).toBe(1);
      expect(n((await prisma.bookings.findUniqueOrThrow({ where: { id: bookingId } })).total_amount)).toBe(PRICE + HALF);
      // Bir xil key, boshqa body → IDEMPOTENCY_CONFLICT
      const r3 = await act(op1, sessionId, 'extend', { minutes: 60 }, key).expect(409);
      expect(r3.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
      // Yangi key — yangi amal
      await act(op1, sessionId, 'extend', { minutes: 30 }, idem()).expect(201);
      expect(await prisma.session_charges.count({ where: { session_id: sessionId } })).toBe(2);
      // Boshqa foydalanuvchi bilan bir xil key — alohida
      await act(A.owner, sessionId, 'extend', { minutes: 30 }, key).expect(201);
      expect(await prisma.session_charges.count({ where: { session_id: sessionId } })).toBe(3);
    });

    it('an immediate replay (still in flight) never applies the action twice', async () => {
      const { sessionId } = await startWalkIn(d[11]);
      const key = { 'Idempotency-Key': randomUUID() };
      const rs = await Promise.all([act(op1, sessionId, 'extend', { minutes: 30 }, key), act(op1, sessionId, 'extend', { minutes: 30 }, key)]);
      expect(rs.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
      // Kutilgan: 409 "in progress". Hozir interceptor bir vaqtdagi create'da P2002 ni ushlamaydi → 500 bo'lishi mumkin
      // (idempotency.interceptor.ts — sessiya modulidan tashqarida, alohida xabar qilingan). Asosiysi — ikki marta qo'llanmaydi.
      rs.filter((r) => r.status !== 201).forEach((r) => expect(r.status).toBeGreaterThanOrEqual(409));
      expect(await prisma.session_charges.count({ where: { session_id: sessionId } })).toBe(1);
      await act(op1, sessionId, 'stop').expect(201);
    });

    it('walk-in replayed with the same key creates one booking', async () => {
      const key = { 'Idempotency-Key': randomUUID() };
      const r1 = await walkIn(op1, d[13], {}, key).expect(201);
      await stored(key);
      const r2 = await walkIn(op1, d[13], {}, key);
      expect(r2.status).toBe(201);
      expect(r2.body.data.id).toBe(r1.body.data.id);
      expect(await prisma.booking_items.count({ where: { device_id: d[13] } })).toBe(1);
      expect(await prisma.sessions.count({ where: { device_id: d[13] } })).toBe(1);
    });

    it('pause/resume/stop replays return the original result instead of a conflict', async () => {
      const { sessionId } = await startWalkIn(d[14]);
      const kp = { 'Idempotency-Key': randomUUID() };
      await act(op1, sessionId, 'pause', {}, kp).expect(201);
      await stored(kp);
      const p2 = await act(op1, sessionId, 'pause', {}, kp);
      expect(p2.status).toBe(201);
      expect(p2.body.data.status).toBe('PAUSED');
      const kr = { 'Idempotency-Key': randomUUID() };
      await act(op1, sessionId, 'resume', {}, kr).expect(201);
      await stored(kr);
      expect((await act(op1, sessionId, 'resume', {}, kr)).status).toBe(201);
      expect(await audits(sessionId, 'session.resume')).toHaveLength(1);
      const ks = { 'Idempotency-Key': randomUUID() };
      const s1 = await act(op1, sessionId, 'stop', {}, ks).expect(201);
      await stored(ks);
      const s2 = await act(op1, sessionId, 'stop', {}, ks);
      expect(s2.status).toBe(201);
      expect(s2.body.data.ended_at).toBe(s1.body.data.ended_at);
      expect(await audits(sessionId, 'session.stop')).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------- parallel so'rovlar

  describe('concurrency', () => {
    it('two concurrent stops → one wins, the session is ended exactly once', async () => {
      const { bookingId, sessionId } = await startWalkIn(d[15]);
      // Overtime bilan — ikki marta hisoblanmasligi ham tekshiriladi
      const end = new Date(Date.now() - 30 * 60_000);
      await prisma.sessions.update({ where: { id: sessionId }, data: { started_at: new Date(end.getTime() - 3600_000), expected_end_at: end } });
      const rs = await Promise.all([act(op1, sessionId, 'stop'), act(A.owner, sessionId, 'stop')]);
      const statuses = rs.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      expect(await prisma.session_charges.count({ where: { session_id: sessionId, type: 'OVERTIME' } })).toBe(1);
      expect(await prisma.booking_events.count({ where: { booking_id: bookingId, type: 'SESSION_ENDED' } })).toBe(1);
      expect(await audits(sessionId, 'session.stop')).toHaveLength(1);
      expect(n((await prisma.bookings.findUniqueOrThrow({ where: { id: bookingId } })).total_amount)).toBe(PRICE + HALF);
    });

    it('two concurrent extends → time and money stay consistent (each charge matches the end shift)', async () => {
      const { bookingId, sessionId } = await startWalkIn(d[16]);
      const before = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      const rs = await Promise.all([act(op1, sessionId, 'extend', { minutes: 30 }), act(A.owner, sessionId, 'extend', { minutes: 30 })]);
      const ok = rs.filter((r) => r.status === 201).length;
      expect(ok).toBeGreaterThanOrEqual(1);
      rs.filter((r) => r.status !== 201).forEach((r) => expect(r.status).toBe(409));
      const after = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      const charges = await prisma.session_charges.count({ where: { session_id: sessionId, type: 'EXTENSION' } });
      expect(charges).toBe(ok);
      expect(after.expected_end_at!.getTime()).toBe(before.expected_end_at!.getTime() + ok * 30 * 60_000);
      const b = await prisma.bookings.findUniqueOrThrow({ where: { id: bookingId } });
      expect(n(b.total_amount)).toBe(PRICE + ok * HALF);
      expect(b.duration_minutes).toBe(60 + ok * 30);
      const item = await prisma.booking_items.findFirstOrThrow({ where: { booking_id: bookingId } });
      expect(item.end_at.getTime()).toBe(after.expected_end_at!.getTime());
    });

    it('concurrent stop and extend → stopped session carries no orphan extension', async () => {
      const { bookingId, sessionId } = await startWalkIn(d[17]);
      const rs = await Promise.all([act(op1, sessionId, 'stop'), act(A.owner, sessionId, 'extend', { minutes: 30 })]);
      expect(rs[0].status).toBe(201);
      const s = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      expect(s.status).toBe('COMPLETED');
      const ext = await prisma.session_charges.count({ where: { session_id: sessionId, type: 'EXTENSION' } });
      expect(ext).toBe(rs[1].status === 201 ? 1 : 0);
      expect(n((await prisma.bookings.findUniqueOrThrow({ where: { id: bookingId } })).total_amount)).toBe(PRICE + ext * HALF);
      // Yakunlangan sessiyaga keyin uzaytirish qo'shilmasligi kerak
      if (rs[1].status === 201) expect(new Date(rs[1].body.data.expected_end_at).getTime()).toBe(s.expected_end_at!.getTime());
    });

    it('two concurrent resumes add the paused time once', async () => {
      const { sessionId } = await startWalkIn(d[18]);
      await act(op1, sessionId, 'pause').expect(201);
      const s = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      await prisma.sessions.update({ where: { id: sessionId }, data: { paused_at: new Date(s.paused_at!.getTime() - 20 * 60_000) } });
      const rs = await Promise.all([act(op1, sessionId, 'resume'), act(A.owner, sessionId, 'resume')]);
      expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
      const after = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      expect(Math.abs(after.total_paused_seconds - 1200)).toBeLessThanOrEqual(5);
      expect(Math.abs(after.expected_end_at!.getTime() - (s.expected_end_at!.getTime() + 1200_000))).toBeLessThanOrEqual(5_000);
    });

    it('five concurrent walk-ins on the same device → exactly one succeeds', async () => {
      const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => walkIn(i % 2 ? A.owner : op1, d[19])));
      const ok = rs.filter((r) => r.status === 201);
      expect(ok).toHaveLength(1);
      rs.filter((r) => r.status !== 201).forEach((r) => {
        expect(r.status).toBe(409);
        expect(['BOOKING_SLOT_TAKEN', 'SESSION_ALREADY_ACTIVE']).toContain(r.body.error.code);
      });
      expect(await prisma.sessions.count({ where: { device_id: d[19], status: { in: ['WAITING', 'ACTIVE', 'PAUSED'] } } })).toBe(1);
      expect(await prisma.booking_items.count({ where: { device_id: d[19], active: true } })).toBe(1);
    });
  });

  // ---------------------------------------------------------------- scope / permission

  describe('scope and permissions', () => {
    let sessionId: string;
    let bookingId: string;

    beforeAll(async () => {
      // d[2] da lifecycle testida boshlangan walk-in sessiyasi
      const s = await prisma.sessions.findFirstOrThrow({ where: { device_id: d[2], status: 'ACTIVE' } });
      sessionId = s.id;
      bookingId = s.booking_id!;
    });

    it('club B owner cannot see or act on club A sessions (404)', async () => {
      await h.http.get(api(`/sessions/${sessionId}`)).set(bearer(B.owner)).expect(404);
      for (const [action, body] of [['pause', {}], ['resume', {}], ['extend', { minutes: 30 }], ['move', { to_device_id: d[0] }], ['stop', {}]] as const) {
        const r = await act(B.owner, sessionId, action, body);
        expect({ action, status: r.status }).toEqual({ action, status: 404 });
      }
      await h.http.post(api('/sessions')).set(bearer(B.owner)).send({ booking_id: bookingId }).expect(404);
      await h.http.post(api(`/bookings/${bookingId}/check-in`)).set(bearer(B.owner)).send({}).expect(404);
      await h.http.get(api(`/branches/${A.branchId}/live`)).set(bearer(B.owner)).expect(404);
      await h.http.get(api(`/sessions/active?branch_id=${A.branchId}`)).set(bearer(B.owner)).expect(404);
      await walkIn(B.owner, d[0]).expect(404);
      // B o'z filialini ko'radi, A sessiyasi u yerda yo'q
      const bl = await live(B.owner, B.branchId);
      expect(bl.devices.every((x: { session: unknown }) => x.session === null)).toBe(true);
    });

    it('branch-2 operator of the same club cannot act on branch-1 sessions (404)', async () => {
      await h.http.get(api(`/sessions/${sessionId}`)).set(bearer(op2)).expect(404);
      for (const [action, body] of [['pause', {}], ['extend', { minutes: 30 }], ['move', { to_device_id: d[0] }], ['stop', {}]] as const) {
        const r = await act(op2, sessionId, action, body);
        expect({ action, status: r.status }).toEqual({ action, status: 404 });
      }
      await h.http.get(api(`/branches/${A.branchId}/live`)).set(bearer(op2)).expect(404);
      await h.http.get(api(`/sessions/active?branch_id=${A.branchId}`)).set(bearer(op2)).expect(404);
      await walkIn(op2, d[0]).expect(404);
      // O'z filiali — ruxsat
      const own = await live(op2, branch2);
      expect(own.branch.id).toBe(branch2);
      const s = await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } });
      expect(s.status).toBe('ACTIVE');
    });

    it('customers have no staff permissions (403)', async () => {
      for (const [action, body] of [['pause', {}], ['resume', {}], ['extend', { minutes: 30 }], ['move', { to_device_id: d[0] }], ['stop', {}]] as const) {
        const r = await act(customer.token, sessionId, action, body);
        expect({ action, status: r.status }).toEqual({ action, status: 403 });
      }
      await walkIn(customer.token, d[0]).expect(403);
      await h.http.get(api(`/branches/${A.branchId}/live`)).set(bearer(customer.token)).expect(403);
      await h.http.get(api(`/sessions/active?branch_id=${A.branchId}`)).set(bearer(customer.token)).expect(404);
    });

    it('role permissions are respected: a branch role without sessions.stop/extend gets 403', async () => {
      const staff = await h.staff(A, 'OPERATOR', A.branchId);
      const userId = sub(staff.token);
      const perms = await prisma.permissions.findMany({
        where: { code: { in: ['sessions.view', 'sessions.pause', 'bookings.create', 'bookings.checkin'] } },
      });
      const roleId = randomUUID();
      customRoles.push(roleId);
      await prisma.roles.create({ data: { id: roleId, code: `E2E_LIMITED_${roleId.slice(0, 8)}`, name: 'Cheklangan operator', scope_type: 'BRANCH', club_id: A.clubId } });
      await prisma.role_permissions.createMany({ data: perms.map((p) => ({ role_id: roleId, permission_id: p.id })) });
      await prisma.user_roles.updateMany({ where: { user_id: userId, club_id: A.clubId }, data: { role_id: roleId } });
      await h.redis.del(`rbac:grants:${userId}`);

      await act(staff.token, sessionId, 'stop').expect(403);
      await act(staff.token, sessionId, 'extend', { minutes: 30 }).expect(403);
      await act(staff.token, sessionId, 'move', { to_device_id: d[0] }).expect(403);
      await h.http.post(api('/sessions')).set(bearer(staff.token)).send({ booking_id: bookingId }).expect(403);
      await h.http.get(api('/shifts')).set(bearer(staff.token)).expect(403);
      // Ruxsat berilganlari ishlaydi
      await act(staff.token, sessionId, 'pause').expect(201);
      await act(staff.token, sessionId, 'resume').expect(201);
      await h.http.get(api(`/sessions/${sessionId}`)).set(bearer(staff.token)).expect(200);
      expect((await prisma.sessions.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe('ACTIVE');
    });

    it('unauthenticated → 401; malformed id → 422/400', async () => {
      await h.http.post(api(`/sessions/${sessionId}/stop`)).send({}).expect(401);
      const r = await h.http.post(api('/sessions/not-a-uuid/stop')).set(bearer(op1)).send({});
      expect([400, 422]).toContain(r.status);
      await h.http.get(api(`/sessions/${randomUUID()}`)).set(bearer(op1)).expect(404);
    });
  });

  // ---------------------------------------------------------------- realtime

  describe('realtime', () => {
    it('session actions emit branch and customer events with server_time', async () => {
      const rt = h.get<RealtimeService>(RealtimeService);
      const spy = jest.spyOn(rt, 'emit');
      try {
        const b = await book(customer.token, d[5]);
        await shiftToNow(b.id, 0);
        const r = await h.http.post(api(`/bookings/${b.id}/check-in`)).set(bearer(op1)).send({ start_session: true }).expect(201);
        const sessionId = r.body.data[0].id as string;
        await act(op1, sessionId, 'stop').expect(201);
        const calls = spy.mock.calls.map(([room, event, data]) => ({ room, event, data: data as Record<string, unknown> }));
        const branchRoom = `branch:${A.branchId}`;
        const userRoom = `user:${sub(customer.token)}`;
        expect(calls.some((c) => c.room === branchRoom && c.event === 'booking.updated' && c.data.booking_id === b.id)).toBe(true);
        const started = calls.find((c) => c.room === branchRoom && c.event === 'session.started' && c.data.session_id === sessionId);
        expect(started?.data).toMatchObject({ device_id: d[5], branch_id: A.branchId });
        expect(typeof started?.data.server_time).toBe('string');
        expect(calls.some((c) => c.room === userRoom && c.event === 'session.started')).toBe(true);
        expect(calls.some((c) => c.room === branchRoom && c.event === 'session.ended' && c.data.session_id === sessionId)).toBe(true);
        expect(calls.some((c) => c.room === userRoom && c.event === 'session.ended')).toBe(true);
        expect(calls.filter((c) => c.room === branchRoom && c.event === 'device.status.changed' && c.data.device_id === d[5]).length).toBeGreaterThanOrEqual(2);
      } finally {
        spy.mockRestore();
      }
    });

    it('socket room subscription is permission-checked (branch:{id} needs sessions.view in that branch)', async () => {
      const gw = h.get<RealtimeGateway>(RealtimeGateway);
      const sock = (token: string) => ({ data: { userId: sub(token) }, join: jest.fn(async () => undefined) }) as never;
      const ok = await gw.subscribe(sock(op1), { room: `branch:${A.branchId}` });
      expect(ok).toMatchObject({ ok: true, room: `branch:${A.branchId}` });
      expect(await gw.subscribe(sock(op2), { room: `branch:${A.branchId}` })).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await gw.subscribe(sock(B.owner), { room: `branch:${A.branchId}` })).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await gw.subscribe(sock(customer.token), { room: `branch:${A.branchId}` })).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await gw.subscribe(sock(B.owner), { room: `club:${A.clubId}` })).toEqual({ ok: false, error: 'FORBIDDEN' });
      expect(await gw.subscribe(sock(A.owner), { room: `club:${A.clubId}` })).toMatchObject({ ok: true });
      expect(await gw.subscribe(sock(op1), { room: `user:${sub(customer.token)}` })).toEqual({ ok: false, error: 'VALIDATION_ERROR' });
      expect(await gw.subscribe(sock(op1), { room: 'platform' })).toEqual({ ok: false, error: 'FORBIDDEN' });
    });
  });
});
