import ExcelJS from 'exceljs';
import { PrismaService } from '../src/database/prisma.service';
import { DailyStatsService } from '../src/modules/analytics/daily-stats.service';
import { api, bearer, Harness, TestClub } from './utils/harness';
import { closeShift, completedBooking, newClub, newCustomer } from './utils/flows';

/**
 * Analitika (docs/01-API.md §6.17): klub KPI faqat o'z klubi (va filial roli — o'z filiali) ma'lumotidan;
 * platforma ko'rsatkichlari global (boshqa testlar ham yozadi — nisbiy tekshiruv); eksport CSV/XLSX.
 */
describe('Analytics & reports (e2e)', () => {
  const h = new Harness();
  const PRICE_A = 1_200_000;
  const PRICE_B = 900_000;
  let A: TestClub;
  let B: TestClub;
  let a2: { branchId: string; devices: string[] };
  let prisma: PrismaService;
  const codesA: string[] = [];
  const codesB: string[] = [];
  let branchAdmin2: string;

  const get = (path: string, token: string) => h.http.get(api(path)).set(bearer(token));

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    A = await newClub(h, { pricePerHour: PRICE_A });
    B = await newClub(h, { pricePerHour: PRICE_B });

    // A klubning ikkinchi filiali
    const br = await h.http
      .post(api(`/clubs/${A.clubId}/branches`))
      .set(bearer(A.owner))
      .send({ name: 'Ikkinchi', address: 'Toshkent, Yunusobod 4', latitude: 41.35, longitude: 69.28, working_hours: { always_open: true } })
      .expect(201);
    const branch2 = br.body.data.id as string;
    await h.http.post(api(`/branches/${branch2}/devices/bulk`)).set(bearer(A.owner)).send({ prefix: 'PC-', from: 1, to: 2, type: 'PC' }).expect(201);
    await h.http.post(api(`/branches/${branch2}/tariffs`)).set(bearer(A.owner)).send({ name: 'Standart', price_per_hour: PRICE_A, device_type: 'PC' }).expect(201);
    const devs = await h.http.get(api(`/branches/${branch2}/devices`)).set(bearer(A.owner)).expect(200);
    a2 = { branchId: branch2, devices: devs.body.data.map((d: { id: string }) => d.id) };

    const c1 = await newCustomer(h);
    const c2 = await newCustomer(h);
    const c3 = await newCustomer(h);
    // A: asosiy filialda 2 ta, ikkinchisida 1 ta yakunlangan bron (naqd); B: 1 ta
    for (const [i, phone] of [c1.phone, c2.phone].entries()) {
      const b = await completedBooking(h, A, phone, i);
      codesA.push((await prisma.bookings.findUniqueOrThrow({ where: { id: b.bookingId } })).code);
    }
    branchAdmin2 = (await h.staff(A, 'BRANCH_ADMIN', a2.branchId)).token;
    const a2Club: TestClub = { ...A, branchId: a2.branchId, devices: a2.devices };
    const b2 = await completedBooking(h, a2Club, c1.phone, 0, 60, branchAdmin2);
    codesA.push((await prisma.bookings.findUniqueOrThrow({ where: { id: b2.bookingId } })).code);
    const bb = await completedBooking(h, B, c3.phone, 0);
    codesB.push((await prisma.bookings.findUniqueOrThrow({ where: { id: bb.bookingId } })).code);
  }, 180_000);

  afterAll(async () => {
    if (branchAdmin2) await closeShift(h, branchAdmin2);
    await h.stop();
  });

  describe('club overview', () => {
    it('counts only own club data (integer tiyin)', async () => {
      const r = await get(`/analytics/club/overview?club_id=${A.clubId}`, A.owner).expect(200);
      const d = r.body.data;
      expect(d).toMatchObject({
        gmv: 3 * PRICE_A,
        collected: 3 * PRICE_A,
        refunds: 0,
        net: 3 * PRICE_A,
        commission: 0,
        club_revenue: 3 * PRICE_A,
        payments_count: 3,
        bookings_total: 3,
        bookings_confirmed: 3,
        avg_booking_value: PRICE_A,
        cancellation_rate: 0,
        active_sessions: 0,
      });
      expect(d.bookings_by_status).toEqual({ COMPLETED: 3 });
      expect(d.customers).toMatchObject({ unique: 2, returning: 0, new: 2 });
      expect(Number.isInteger(d.gmv)).toBe(true);
      expect(d.occupancy.capacity_minutes).toBeGreaterThan(0);
      // Band vaqt davr ("bugun", filial vaqti) bilan kesiladi — yarim tunga yaqin bron ertangi kunga o'tadi
      const from = new Date(d.range.from).getTime();
      const to = new Date(d.range.to).getTime();
      const items = await prisma.booking_items.findMany({ where: { booking: { code: { in: codesA } } }, select: { start_at: true, end_at: true } });
      const expectedBusy = items.reduce((m, it) => m + Math.max(0, Math.min(it.end_at.getTime(), to) - Math.max(it.start_at.getTime(), from)) / 60_000, 0);
      expect(items).toHaveLength(3);
      expect(Math.abs(d.occupancy.busy_minutes - expectedBusy)).toBeLessThanOrEqual(1);
      expect(d.previous).toMatchObject({ gmv: 0, collected: 0 });

      const rb = await get(`/analytics/club/overview?club_id=${B.clubId}`, B.owner).expect(200);
      expect(rb.body.data).toMatchObject({ gmv: PRICE_B, collected: PRICE_B, bookings_confirmed: 1, payments_count: 1 });
    });

    it('branch filter', async () => {
      const r = await get(`/analytics/club/overview?club_id=${A.clubId}&branch_id=${a2.branchId}`, A.owner).expect(200);
      expect(r.body.data).toMatchObject({ gmv: PRICE_A, collected: PRICE_A, bookings_confirmed: 1 });
      const main = await get(`/analytics/club/overview?club_id=${A.clubId}&branch_id=${A.branchId}`, A.owner).expect(200);
      expect(main.body.data).toMatchObject({ gmv: 2 * PRICE_A, collected: 2 * PRICE_A, bookings_confirmed: 2 });
    });

    it('club B cannot read club A analytics; no leak via own club + foreign branch', async () => {
      const cross = await get(`/analytics/club/overview?club_id=${A.clubId}`, B.owner).expect(404);
      expect(cross.body.error.code).toBe('NOT_FOUND');
      for (const p of ['revenue', 'peak-hours', 'devices/popular', 'daily', 'branches/compare']) {
        await get(`/analytics/club/${p}?club_id=${A.clubId}`, B.owner).expect(404);
      }
      const mixed = await get(`/analytics/club/overview?club_id=${B.clubId}&branch_id=${A.branchId}`, B.owner);
      if (mixed.status === 200) expect(mixed.body.data).toMatchObject({ gmv: 0, collected: 0, bookings_total: 0 });
      else expect(mixed.status).toBe(404);
    });

    it('customers and operators (no reports.view) are forbidden', async () => {
      const c = await newCustomer(h);
      await get(`/analytics/club/overview?club_id=${A.clubId}`, c.token).expect(403);
      const op = await h.staff(A, 'OPERATOR', A.branchId);
      await get(`/analytics/club/overview?club_id=${A.clubId}`, op.token).expect(403);
      await h.http.get(api(`/analytics/club/overview?club_id=${A.clubId}`)).expect(401);
    });

    it('branch admin sees only own branch numbers', async () => {
      const r = await get(`/analytics/club/overview?club_id=${A.clubId}`, branchAdmin2).expect(200);
      expect(r.body.data).toMatchObject({ gmv: PRICE_A, collected: PRICE_A, bookings_confirmed: 1 });
      await get(`/analytics/club/overview?club_id=${A.clubId}&branch_id=${A.branchId}`, branchAdmin2).expect(404);
      const cmp = await get(`/analytics/club/branches/compare?club_id=${A.clubId}`, branchAdmin2).expect(200);
      expect(cmp.body.data.map((x: { branch: { id: string } }) => x.branch.id)).toEqual([a2.branchId]);
    });

    it('validates query: club_id required, range sane', async () => {
      await get('/analytics/club/overview', A.owner).expect(422);
      const from = new Date().toISOString();
      const to = new Date(Date.now() - 86400_000).toISOString();
      const bad = await get(`/analytics/club/overview?club_id=${A.clubId}&from=${from}&to=${to}`, A.owner).expect(422);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
      await get(`/analytics/club/overview?club_id=${A.clubId}&from=2024-01-01T00:00:00Z&to=2026-01-01T00:00:00Z`, A.owner).expect(422);
      await get(`/analytics/club/revenue?club_id=${A.clubId}&group=year`, A.owner).expect(422);
    });
  });

  describe('club series', () => {
    it('revenue: daily buckets sum to totals; week grouping', async () => {
      const r = await get(`/analytics/club/revenue?club_id=${A.clubId}`, A.owner).expect(200);
      const days = r.body.data as { date: string; collected: number; gmv: number; net: number; bookings: number; payments: number }[];
      expect(days.length).toBeGreaterThanOrEqual(30);
      expect(days.reduce((s, d) => s + d.collected, 0)).toBe(3 * PRICE_A);
      expect(days.reduce((s, d) => s + d.gmv, 0)).toBe(3 * PRICE_A);
      expect(days.reduce((s, d) => s + d.payments, 0)).toBe(3);
      expect(days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true);
      const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
      expect(days.map((d) => d.date)).toEqual(sorted.map((d) => d.date));

      const w = await get(`/analytics/club/revenue?club_id=${A.clubId}&group=week`, A.owner).expect(200);
      expect(w.body.data.length).toBeLessThan(days.length);
      expect(w.body.data.reduce((s: number, d: { collected: number }) => s + d.collected, 0)).toBe(3 * PRICE_A);

      const b = await get(`/analytics/club/revenue?club_id=${A.clubId}&branch_id=${a2.branchId}`, A.owner).expect(200);
      expect(b.body.data.reduce((s: number, d: { collected: number }) => s + d.collected, 0)).toBe(PRICE_A);
    });

    it('peak hours heatmap is a valid dow×hour grid with own bookings only', async () => {
      const r = await get(`/analytics/club/peak-hours?club_id=${A.clubId}`, A.owner).expect(200);
      const cells = r.body.data as { dow: number; hour: number; value: number }[];
      expect(cells.length).toBeGreaterThan(0);
      for (const c of cells) {
        expect(c.dow).toBeGreaterThanOrEqual(1);
        expect(c.dow).toBeLessThanOrEqual(7);
        expect(c.hour).toBeGreaterThanOrEqual(0);
        expect(c.hour).toBeLessThanOrEqual(23);
      }
      const total = cells.reduce((s, c) => s + c.value, 0);
      expect(total).toBeGreaterThanOrEqual(3);
      expect(total).toBeLessThanOrEqual(6); // 3 ta bron × ko'pi bilan 2 soat katakchasi
    });

    it('popular devices: only own devices; revenue in tiyin', async () => {
      const r = await get(`/analytics/club/devices/popular?club_id=${A.clubId}`, A.owner).expect(200);
      const rows = r.body.data as { device: { id: string; branch_id: string }; bookings: number; revenue: number }[];
      const own = new Set([...A.devices, ...a2.devices]);
      expect(rows.length).toBe(3);
      expect(rows.every((x) => own.has(x.device.id))).toBe(true);
      expect(rows.reduce((s, x) => s + x.revenue, 0)).toBe(3 * PRICE_A);
    });

    it('branches compare', async () => {
      const r = await get(`/analytics/club/branches/compare?club_id=${A.clubId}`, A.owner).expect(200);
      const by = new Map((r.body.data as { branch: { id: string }; gmv: number; bookings: number }[]).map((x) => [x.branch.id, x]));
      expect(by.size).toBe(2);
      expect(by.get(A.branchId)).toMatchObject({ gmv: 2 * PRICE_A, bookings: 2 });
      expect(by.get(a2.branchId)).toMatchObject({ gmv: PRICE_A, bookings: 1 });
    });

    it('daily aggregates (daily_branch_stats) — own club only', async () => {
      const stats = h.get<DailyStatsService>(DailyStatsService);
      // Boshqa jarayon lock'ni ushlab turgan bo'lishi mumkin — biroz kutamiz
      let ran = false;
      for (let i = 0; i < 30 && !ran; i++) {
        const res = (await stats.run(1)) as { skipped?: boolean };
        ran = !res?.skipped;
        if (!ran) await new Promise((r) => setTimeout(r, 1000));
      }
      const r = await get(`/analytics/club/daily?club_id=${A.clubId}`, A.owner).expect(200);
      expect(r.body.data).toHaveProperty('days');
      if (ran) {
        const sum = (k: string) => r.body.data.days.reduce((s: number, d: Record<string, number>) => s + Number(d[k] ?? 0), 0);
        expect(sum('gmv')).toBe(3 * PRICE_A);
        expect(sum('collected')).toBe(3 * PRICE_A);
        expect(sum('completed_count')).toBe(3);
        expect(r.body.data.computed_at).toBeTruthy();
      }
      const b = await get(`/analytics/club/daily?club_id=${B.clubId}`, B.owner).expect(200);
      if (ran) expect(b.body.data.days.reduce((s: number, d: { gmv: number }) => s + Number(d.gmv), 0)).toBe(PRICE_B);
    }, 60_000);
  });

  describe('platform', () => {
    it('only platform.analytics.view', async () => {
      await get('/analytics/platform/overview', A.owner).expect(403);
      await get('/analytics/platform/growth', A.owner).expect(403);
      const c = await newCustomer(h);
      await get('/analytics/platform/overview', c.token).expect(403);
    });

    it('overview includes our clubs (relational: other tests write concurrently)', async () => {
      const r = await get('/analytics/platform/overview', h.admin).expect(200);
      const d = r.body.data;
      expect(d.collected).toBeGreaterThanOrEqual(3 * PRICE_A + PRICE_B);
      expect(d.gmv).toBeGreaterThanOrEqual(3 * PRICE_A + PRICE_B);
      expect(d.bookings_confirmed).toBeGreaterThanOrEqual(4);
      expect(d.clubs_by_status.ACTIVE).toBeGreaterThanOrEqual(2);
      expect(d.users_by_type.CUSTOMER).toBeGreaterThanOrEqual(3);
      expect(d.new_customers).toBeGreaterThanOrEqual(3);
      expect(d.devices).toBeGreaterThanOrEqual(A.devices.length + a2.devices.length + B.devices.length);
      expect(d.queues).toEqual({ pending_clubs: expect.any(Number), open_tickets: expect.any(Number), reviews_to_moderate: expect.any(Number) });
      expect(d.top_clubs.length).toBeLessThanOrEqual(10);
      expect(Number.isInteger(d.collected)).toBe(true);
    });

    it('growth: one entry per day, today includes our bookings and users', async () => {
      const r = await get('/analytics/platform/growth', h.admin).expect(200);
      const days = r.body.data as { date: string; bookings: number; gmv: number; new_users: number }[];
      expect(days.length).toBeGreaterThanOrEqual(30);
      expect(new Set(days.map((d) => d.date)).size).toBe(days.length);
      const total = days.reduce((s, d) => s + d.bookings, 0);
      expect(total).toBeGreaterThanOrEqual(4);
      expect(days.reduce((s, d) => s + d.new_users, 0)).toBeGreaterThanOrEqual(3);
    });
  });

  describe('exports', () => {
    const parseCsv = (text: string) => text.replace(/^﻿/, '').split('\n').map((l) => l.split(','));

    it('bookings CSV: header row, correct content-type, own club only', async () => {
      const r = await get(`/reports/bookings?club_id=${A.clubId}`, A.owner).expect(200);
      expect(r.headers['content-type']).toMatch(/^text\/csv/);
      expect(r.headers['content-disposition']).toMatch(/attachment; filename="bookings-\d{4}-\d{2}-\d{2}\.csv"/);
      const rows = parseCsv(r.text);
      expect(rows[0]).toEqual(['code', 'status', 'source', 'start_at', 'end_at', 'duration_min', 'subtotal_som', 'discount_som', 'total_som', 'paid_som', 'payment_status', 'guest_name', 'created_at']);
      const codes = rows.slice(1).map((x) => x[0]);
      expect(codes.sort()).toEqual([...codesA].sort());
      expect(codes).not.toContain(codesB[0]);
      // Summalar so'mda (tiyin / 100)
      const total = rows.slice(1).map((x) => Number(x[8]));
      expect(total.every((t) => t === PRICE_A / 100)).toBe(true);
    });

    it('payments CSV and shifts CSV', async () => {
      const p = await get(`/reports/payments?club_id=${A.clubId}&format=csv`, A.owner).expect(200);
      const rows = parseCsv(p.text);
      expect(rows[0][0]).toBe('id');
      expect(rows.length - 1).toBe(3);
      expect(rows.slice(1).every((x) => x[1] === 'PAID' && x[2] === 'CASH')).toBe(true);
      const s = await get(`/reports/shifts?club_id=${A.clubId}`, A.owner).expect(200);
      const sr = parseCsv(s.text);
      expect(sr[0]).toContain('opening_cash_som');
      expect(sr.length - 1).toBeGreaterThanOrEqual(1);
    });

    it('xlsx is a valid workbook (PK magic) with header row', async () => {
      const r = await get(`/reports/bookings?club_id=${A.clubId}&format=xlsx`, A.owner)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(r.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const buf = r.body as Buffer;
      expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const ws = wb.getWorksheet('bookings')!;
      expect(ws.getRow(1).getCell(1).value).toBe('code');
      expect(ws.rowCount).toBe(1 + codesA.length);
    });

    it('CSV neutralises spreadsheet formulas in text cells', async () => {
      await h.openShift(A.owner, A.branchId);
      const w = await h.http
        .post(api('/bookings/walk-in'))
        .set(bearer(A.owner))
        .send({ branch_id: A.branchId, device_ids: [A.devices[2]], duration_minutes: 30, payment_method: 'LATER', guest_name: '=HYPERLINK("http://evil.example","x")', start_now: false })
        .expect(201);
      const r = await get(`/reports/bookings?club_id=${A.clubId}`, A.owner).expect(200);
      const line = r.text.split('\n').find((l) => l.startsWith(w.body.data.code))!;
      expect(line).toBeDefined();
      expect(line).not.toMatch(/,"?=HYPERLINK/);
      await h.http.post(api(`/bookings/${w.body.data.id}/cancel`)).set(bearer(A.owner)).send({ reason: 'e2e' });
    });

    it('scope & permissions: club B 404, branch admin (no reports.export) 403, unknown kind 404, bad format 422', async () => {
      await get(`/reports/bookings?club_id=${A.clubId}`, B.owner).expect(404);
      await get(`/reports/bookings?club_id=${A.clubId}`, branchAdmin2).expect(403);
      const c = await newCustomer(h);
      await get(`/reports/bookings?club_id=${A.clubId}`, c.token).expect(403);
      await get(`/reports/users?club_id=${A.clubId}`, A.owner).expect(404);
      await get(`/reports/bookings?club_id=${A.clubId}&format=pdf`, A.owner).expect(422);
      const ca = await h.staff(A, 'CLUB_ADMIN');
      const ok = await get(`/reports/payments?club_id=${A.clubId}`, ca.token).expect(200);
      expect(parseCsv(ok.text).length - 1).toBe(3);
      // B eksporti A ma'lumotini o'z ichiga olmaydi
      const bx = await get(`/reports/bookings?club_id=${B.clubId}`, B.owner).expect(200);
      expect(parseCsv(bx.text).slice(1).map((x) => x[0])).toEqual(codesB);
    });
  });
});
