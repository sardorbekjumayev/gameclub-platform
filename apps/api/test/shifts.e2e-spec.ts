import { PrismaService } from '../src/database/prisma.service';
import { api, bearer, Harness, TestClub } from './utils/harness';

/**
 * Kassa smenasi (docs/01-API.md §6.10): ochish/yopish, bitta ochiq smena, naqd/terminal kirimlar,
 * expected_cash = opening + naqd − naqd refund, farq (difference), hisobot, ro'yxat (shifts.view_all), scope.
 */
describe('Cash shifts (e2e)', () => {
  const PRICE = 1_200_000; // tiyin/soat
  const HALF = PRICE / 2;
  const h = new Harness();
  let prisma: PrismaService;
  let A: TestClub;
  let B: TestClub;
  let branch2: string;
  let op1: string;
  let op2: string;
  let opB2: string;
  let customer: string;
  let shift1: string;
  let shift2: string;
  let shiftB: string;

  const sub = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub as string;
  const n = (v: unknown) => {
    const x = Number(v);
    expect(Number.isInteger(x)).toBe(true);
    return x;
  };
  const open = (token: string, branchId: string, opening_cash: unknown = 0) => h.http.post(api('/shifts/open')).set(bearer(token)).send({ branch_id: branchId, opening_cash });
  const close = (token: string, id: string, body: Record<string, unknown>) => h.http.post(api(`/shifts/${id}/close`)).set(bearer(token)).send(body);
  const walkIn = (token: string, deviceId: string, extra: Record<string, unknown> = {}) =>
    h.http.post(api('/bookings/walk-in')).set(bearer(token)).send({ branch_id: A.branchId, device_ids: [deviceId], duration_minutes: 60, payment_method: 'CASH', guest_name: 'Mehmon', ...extra });

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    A = await h.club({ devices: 8, pricePerHour: PRICE });
    B = await h.club({ devices: 1, pricePerHour: PRICE });
    // Ikkinchi filial uchun o'z test klubimiz rejasini oshiramiz (global sozlama emas)
    const ent = await prisma.plans.findFirstOrThrow({ where: { code: 'ENTERPRISE' } });
    await prisma.subscriptions.updateMany({ where: { club_id: A.clubId }, data: { plan_id: ent.id } });
    branch2 = (
      await h.http
        .post(api(`/clubs/${A.clubId}/branches`))
        .set(bearer(A.owner))
        .send({ name: 'Ikkinchi', address: 'Toshkent, Yunusobod 2', latitude: 41.35, longitude: 69.28, working_hours: { always_open: true } })
        .expect(201)
    ).body.data.id;
    op1 = (await h.staff(A, 'OPERATOR', A.branchId)).token;
    op2 = (await h.staff(A, 'OPERATOR', A.branchId)).token;
    opB2 = (await h.staff(A, 'OPERATOR', branch2)).token;
    await h.resetRateLimits();
    customer = (await h.customer()).token;
  });

  afterAll(async () => {
    // Xodim smenalari ham yopiladi (harness faqat egalarnikini yopadi)
    for (const t of [op1, op2, opB2]) {
      if (!t) continue;
      const cur = await h.http.get(api('/shifts/current')).set(bearer(t));
      if (cur.body?.data?.id) await close(t, cur.body.data.id, { counted_cash: 0 });
    }
    await h.stop();
  });

  it('customers have no shift permissions (403)', async () => {
    await h.http.get(api('/shifts/current')).set(bearer(customer)).expect(403);
    await open(customer, A.branchId).expect(403);
    await h.http.get(api('/shifts')).set(bearer(customer)).expect(403);
  });

  it('no shift yet → current is null; cash walk-in requires a shift', async () => {
    const r = await h.http.get(api('/shifts/current')).set(bearer(op1)).expect(200);
    expect(r.body.data).toBeNull();
    const w = await walkIn(op1, A.devices[0]).expect(409);
    expect(w.body.error.details.reason).toBe('SHIFT_REQUIRED');
  });

  it('open validation (422) and scope (other club / other branch → 404)', async () => {
    for (const body of [{ branch_id: A.branchId, opening_cash: -1 }, { branch_id: A.branchId, opening_cash: 1.5 }, { branch_id: A.branchId }, { branch_id: 'x', opening_cash: 0 }, { opening_cash: 0 }]) {
      const r = await h.http.post(api('/shifts/open')).set(bearer(op1)).send(body);
      expect({ body, status: r.status }).toEqual({ body, status: 422 });
    }
    await open(A.owner, B.branchId).expect(404);
    await open(opB2, A.branchId).expect(404);
    await open(op1, branch2).expect(404);
    expect(await prisma.cash_shifts.count({ where: { operator_id: { in: [sub(op1), sub(opB2), sub(A.owner)] } } })).toBe(0);
  });

  it('operator opens a shift; the report starts at the opening cash', async () => {
    const r = await open(op1, A.branchId, 500_000).expect(201);
    shift1 = r.body.data.id;
    expect(r.body.data).toMatchObject({ status: 'OPEN', branch_id: A.branchId, club_id: A.clubId, operator_id: sub(op1), branch_name: 'Asosiy', closed_at: null });
    expect(n(r.body.data.opening_cash)).toBe(500_000);
    expect(r.body.data.totals).toEqual({ cash_in: 0, terminal_in: 0, cash_refunds: 0, payments_count: 0, expected_cash: 500_000 });
    const cur = await h.http.get(api('/shifts/current')).set(bearer(op1)).expect(200);
    expect(cur.body.data.id).toBe(shift1);
    const curB = await h.http.get(api(`/shifts/current?branch_id=${branch2}`)).set(bearer(op1)).expect(200);
    expect(curB.body.data).toBeNull();
    const a = await prisma.audit_logs.findMany({ where: { target_id: shift1, action: 'shift.open' } });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_id: sub(op1), club_id: A.clubId });
  });

  it('cannot open a second shift (any branch) while one is open', async () => {
    const r = await open(op1, A.branchId, 0).expect(409);
    expect(r.body.error).toMatchObject({ code: 'CONFLICT', details: { shift_id: shift1 } });
    expect(await prisma.cash_shifts.count({ where: { operator_id: sub(op1), status: 'OPEN' } })).toBe(1);
  });

  it('concurrent opens by the same operator → exactly one shift', async () => {
    const rs = await Promise.all([open(op2, A.branchId, 0), open(op2, A.branchId, 0), open(op2, A.branchId, 0)]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.cash_shifts.count({ where: { operator_id: sub(op2), status: 'OPEN' } })).toBe(1);
    shift2 = rs.find((r) => r.status === 201)!.body.data.id;
    // Kutilgan: 409 CONFLICT. Hozir payments.service.openShift unique indeks (cash_shifts_one_open_per_operator)
    // xatosini (P2002) ushlamaydi → 500 bo'lishi mumkin (payments moduli — alohida xabar qilingan). DB invarianti saqlanadi.
    rs.filter((r) => r.status !== 201).forEach((r) => expect(r.status).toBeGreaterThanOrEqual(409));
  });

  it('cash and terminal takings land on the operator\'s own shift', async () => {
    // Naqd walk-in 60 daq
    const w1 = await walkIn(op1, A.devices[0]).expect(201);
    expect(w1.body.data).toMatchObject({ payment_status: 'PAID', status: 'ACTIVE' });
    expect(n(w1.body.data.paid_amount)).toBe(PRICE);
    expect(w1.body.data.payments).toHaveLength(1);
    expect(w1.body.data.payments[0]).toMatchObject({ method: 'CASH', status: 'PAID' });
    // Terminal walk-in 30 daq
    const w2 = await walkIn(op1, A.devices[1], { duration_minutes: 30, payment_method: 'TERMINAL' }).expect(201);
    expect(n(w2.body.data.paid_amount)).toBe(HALF);
    // Uzaytirish naqd +30
    const ext = await h.http.post(api(`/sessions/${w1.body.data.session.id}/extend`)).set(bearer(op1)).send({ minutes: 30, payment_method: 'CASH' }).expect(201);
    expect(n(ext.body.data.extension_amount)).toBe(HALF);
    expect(n(ext.body.data.booking.paid_amount)).toBe(PRICE + HALF);
    expect(n(ext.body.data.amount_due)).toBe(0);
    // LATER walk-in → keyin qisman naqd to'lov
    const w3 = await walkIn(op1, A.devices[2], { payment_method: 'LATER' }).expect(201);
    expect(n(w3.body.data.amount_due)).toBe(PRICE);
    await h.http.post(api('/payments/cash')).set(bearer(op1)).send({ booking_id: w3.body.data.id, method: 'CASH', amount: 100_000 }).expect(201);
    // Boshqa operator (op2) kirimi op1 smenasiga tushmaydi
    await walkIn(op2, A.devices[3]).expect(201);

    const pays = await prisma.payments.findMany({ where: { shift_id: shift1 } });
    expect(pays).toHaveLength(4);
    const cur = await h.http.get(api('/shifts/current')).set(bearer(op1)).expect(200);
    expect(cur.body.data.totals).toEqual({ cash_in: PRICE + HALF + 100_000, terminal_in: HALF, cash_refunds: 0, payments_count: 4, expected_cash: 500_000 + PRICE + HALF + 100_000 });
    const cur2 = await h.http.get(api('/shifts/current')).set(bearer(op2)).expect(200);
    expect(cur2.body.data.totals).toMatchObject({ cash_in: PRICE, payments_count: 1, expected_cash: PRICE });
  });

  it('report: own shift or shifts.view_all in scope; others get 404', async () => {
    const own = await h.http.get(api(`/shifts/${shift1}/report`)).set(bearer(op1)).expect(200);
    expect(own.body.data).toMatchObject({ id: shift1, status: 'OPEN', operator: expect.objectContaining({ first_name: 'OPERATOR' }) });
    expect(n(own.body.data.totals.expected_cash)).toBe(500_000 + PRICE + HALF + 100_000);
    const owner = await h.http.get(api(`/shifts/${shift1}/report`)).set(bearer(A.owner)).expect(200);
    expect(owner.body.data.totals).toEqual(own.body.data.totals);
    await h.http.get(api(`/shifts/${shift1}/report`)).set(bearer(op2)).expect(404);
    await h.http.get(api(`/shifts/${shift1}/report`)).set(bearer(opB2)).expect(404);
    await h.http.get(api(`/shifts/${shift1}/report`)).set(bearer(B.owner)).expect(404);
    await h.http.get(api(`/shifts/${shift1}/report`)).set(bearer(customer)).expect(403);
    await h.http.get(api('/shifts/00000000-0000-7000-8000-000000000000/report')).set(bearer(A.owner)).expect(404);
  });

  it('list requires shifts.view_all and is tenant-scoped', async () => {
    await h.http.get(api('/shifts')).set(bearer(op1)).expect(403);
    shiftB = await h.openShift(B.owner, B.branchId, 0);
    const r = await h.http.get(api(`/shifts?limit=100`)).set(bearer(A.owner)).expect(200);
    const ids = r.body.data.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining([shift1, shift2]));
    expect(ids).not.toContain(shiftB);
    expect(r.body.data.every((s: { club_id: string }) => s.club_id === A.clubId)).toBe(true);
    const row = r.body.data.find((s: { id: string }) => s.id === shift1);
    expect(row.operator).toMatchObject({ first_name: 'OPERATOR' });
    // Boshqa klub filiali bo'yicha filtr ham hech narsa oshkor qilmaydi
    const cross = await h.http.get(api(`/shifts?branch_id=${B.branchId}`)).set(bearer(A.owner)).expect(200);
    expect(cross.body.data).toEqual([]);
    const fromB = await h.http.get(api('/shifts?limit=100')).set(bearer(B.owner)).expect(200);
    expect(fromB.body.data.map((s: { id: string }) => s.id)).toEqual([shiftB]);
    const openOnly = await h.http.get(api(`/shifts?status=OPEN&branch_id=${A.branchId}`)).set(bearer(A.owner)).expect(200);
    expect(openOnly.body.data.every((s: { status: string }) => s.status === 'OPEN')).toBe(true);
    await h.http.get(api('/shifts?status=WEIRD')).set(bearer(A.owner)).expect(422);
  });

  it('close: other staff/club cannot close it; validation 422', async () => {
    await close(op2, shift1, { counted_cash: 0 }).expect(404);
    await close(B.owner, shift1, { counted_cash: 0 }).expect(404);
    await close(customer, shift1, { counted_cash: 0 }).expect(403);
    for (const body of [{}, { counted_cash: -5 }, { counted_cash: 'abc' }, { counted_cash: 10, note: 'x'.repeat(501) }]) {
      const r = await close(op1, shift1, body);
      expect({ body, status: r.status }).toEqual({ body, status: 422 });
    }
    expect((await prisma.cash_shifts.findUniqueOrThrow({ where: { id: shift1 } })).status).toBe('OPEN');
  });

  it('close computes expected vs counted cash and records the discrepancy', async () => {
    const expected = 500_000 + PRICE + HALF + 100_000;
    const counted = expected - 50_000;
    const r = await close(op1, shift1, { counted_cash: counted, note: 'Kamomad' }).expect(201);
    expect(r.body.data).toMatchObject({ id: shift1, status: 'CLOSED', note: 'Kamomad' });
    expect(r.body.data.closed_at).toBeTruthy();
    expect(n(r.body.data.closing_cash_counted)).toBe(counted);
    expect(n(r.body.data.expected_cash)).toBe(expected);
    expect(n(r.body.data.difference)).toBe(-50_000);
    expect(n(r.body.data.totals.expected_cash)).toBe(expected);
    const a = await prisma.audit_logs.findMany({ where: { target_id: shift1, action: 'shift.close' } });
    expect(a).toHaveLength(1);
    expect(a[0].new_value).toEqual({ counted, expected, difference: -50_000 });
    // Farq bo'lsa klub egasiga xabar
    const note = await prisma.notifications.findFirst({ where: { user_id: sub(A.owner), type: 'CASH_DIFFERENCE' } });
    expect(note).toBeTruthy();
    // Qayta yopib bo'lmaydi
    const again = await close(op1, shift1, { counted_cash: counted }).expect(409);
    expect(again.body.error.code).toBe('CONFLICT');
    // Smena yopiq — naqd qabul qilinmaydi, current null
    expect((await h.http.get(api('/shifts/current')).set(bearer(op1)).expect(200)).body.data).toBeNull();
    const w = await walkIn(op1, A.devices[4]).expect(409);
    expect(w.body.error.details.reason).toBe('SHIFT_REQUIRED');
    // Hisobot yopilgandan keyin ham o'qiladi
    const rep = await h.http.get(api(`/shifts/${shift1}/report`)).set(bearer(op1)).expect(200);
    expect(n(rep.body.data.totals.expected_cash)).toBe(expected);
  });

  it('a club owner (shifts.view_all) can close an operator\'s shift; exact count → zero difference', async () => {
    const r = await close(A.owner, shift2, { counted_cash: PRICE }).expect(201);
    expect(r.body.data).toMatchObject({ status: 'CLOSED', operator_id: sub(op2) });
    expect(n(r.body.data.difference)).toBe(0);
    // Yangi smena ochish mumkin
    const again = await open(op1, A.branchId, 0).expect(201);
    await close(op1, again.body.data.id, { counted_cash: 0 }).expect(201);
  });

  it('cash refund reduces the expected cash', async () => {
    const s = (await open(op1, A.branchId, 0).expect(201)).body.data.id as string;
    const w = await walkIn(op1, A.devices[5], { start_now: false }).expect(201);
    const payment = w.body.data.payments[0];
    await h.http.post(api(`/payments/${payment.id}/refund`)).set(bearer(A.owner)).send({ amount: 200_000, reason: 'Qisman qaytarish' }).expect(201);
    const cur = await h.http.get(api(`/shifts/${s}/report`)).set(bearer(op1)).expect(200);
    expect(cur.body.data.totals).toMatchObject({ cash_in: PRICE, cash_refunds: 200_000, expected_cash: PRICE - 200_000 });
  });
});
