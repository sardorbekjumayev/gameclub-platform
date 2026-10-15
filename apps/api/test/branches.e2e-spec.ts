import { PrismaService } from '../src/database/prisma.service';
import { api, bearer, Harness, rndPhone, slot, TestClub } from './utils/harness';

jest.setTimeout(120_000);

/** Phase 2: filiallar, ish vaqti istisnolari, xonalar, sozlamalar, hujjatlar, xodimlar, mijozlar — scope bilan. */
describe('Branches, rooms, settings, staff, customers (e2e)', () => {
  const h = new Harness();
  // OTP IP limiti (10/soat) parallel ishlayotgan suite'lar orasida tugab qolmasin
  const otpLogin = h.otpLogin.bind(h);
  h.otpLogin = async (phone?: string) => {
    await h.resetRateLimits();
    return otpLogin(phone);
  };
  let prisma: PrismaService;
  let A: TestClub;
  let B: TestClub;
  let branchA2: string;
  let opA1: string;
  let opA2: string;
  let badminA1: string;
  let cust: { token: string; phone: string };

  const denied = (status: number) => expect([403, 404]).toContain(status);
  const branchBody = { name: 'Yangi filial', address: 'Toshkent, Mirobod 5', latitude: 41.3, longitude: 69.27, working_hours: { always_open: true } };

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    A = await h.club({ devices: 2 });
    B = await h.club({ devices: 1 });
    branchA2 = (await h.http.post(api(`/clubs/${A.clubId}/branches`)).set(bearer(A.owner)).send({ ...branchBody, name: 'A2' }).expect(201)).body.data.id;
    opA1 = (await h.staff(A, 'OPERATOR', A.branchId)).token;
    opA2 = (await h.staff(A, 'OPERATOR', branchA2)).token;
    badminA1 = (await h.staff(A, 'BRANCH_ADMIN', A.branchId)).token;
    cust = await h.customer();
  });

  afterAll(() => h.stop());

  describe('branches', () => {
    let tmp: string;

    it('validates coordinates, phone, working hours and extra fields', async () => {
      const url = api(`/clubs/${A.clubId}/branches`);
      for (const patch of [
        { latitude: 91 },
        { latitude: -90.5 },
        { longitude: 181 },
        { longitude: 'abc' },
        { address: undefined },
        { name: 'x' },
        { phone: '12345' },
        { images: ['not a url'] },
        { booking_settings: { slot_minutes: 20 } },
        { booking_settings: { hold_minutes: 1 } },
        { booking_settings: { unknown_flag: true } },
        { status: 'ACTIVE' },
        { club_id: B.clubId },
      ]) {
        const r = await h.http.post(url).set(bearer(A.owner)).send({ ...branchBody, ...patch });
        expect({ patch, status: r.status }).toEqual({ patch, status: 422 });
      }
      const wh = await h.http.post(url).set(bearer(A.owner)).send({ ...branchBody, working_hours: { mon: [{ open: '25:00', close: '10:00' }] } }).expect(422);
      expect(wh.body.error.details.field).toBe('working_hours');
    });

    it('creates with defaults; slug is unique inside the club', async () => {
      const r = await h.http.post(api(`/clubs/${A.clubId}/branches`)).set(bearer(A.owner)).send({ ...branchBody, working_hours: undefined, booking_settings: { slot_minutes: 60 } }).expect(201);
      tmp = r.body.data.id;
      expect(r.body.data).toMatchObject({ club_id: A.clubId, status: 'ACTIVE', timezone: 'Asia/Tashkent' });
      expect(r.body.data.booking_settings).toMatchObject({ slot_minutes: 60, hold_minutes: 10 });
      expect(r.body.data.working_hours.mon).toEqual([{ open: '10:00', close: '02:00' }]);
      const r2 = await h.http.post(api(`/clubs/${A.clubId}/branches`)).set(bearer(A.owner)).send(branchBody).expect(201);
      expect(r2.body.data.slug).not.toBe(r.body.data.slug);
      expect(await prisma.audit_logs.count({ where: { action: 'branch.create', target_id: tmp } })).toBe(1);
      await h.http.delete(api(`/branches/${r2.body.data.id}`)).set(bearer(A.owner)).expect(200);
    });

    it('updates coordinates and booking settings (merged); generated PostGIS location follows', async () => {
      const u = await h.http.patch(api(`/branches/${tmp}`)).set(bearer(A.owner)).send({ latitude: 41.31, longitude: 69.28, booking_settings: { buffer_minutes: 10 } }).expect(200);
      expect(u.body.data.booking_settings).toMatchObject({ slot_minutes: 60, buffer_minutes: 10 });
      const [loc] = await prisma.$queryRaw<{ lat: number; lng: number }[]>`SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM branches WHERE id = ${tmp}::uuid`;
      expect(loc.lat).toBeCloseTo(41.31, 5);
      expect(loc.lng).toBeCloseTo(69.28, 5);
      await h.http.patch(api(`/branches/${tmp}`)).set(bearer(A.owner)).send({ latitude: 100 }).expect(422);
      await h.http.patch(api(`/branches/${tmp}`)).set(bearer(A.owner)).send({ status: 'DELETED' }).expect(422);
      const log = await prisma.audit_logs.findFirst({ where: { action: 'branch.update', target_id: tmp } });
      expect(log?.old_value).toMatchObject({ latitude: 41.3 });
    });

    it('INACTIVE branch is hidden from public pages; staff still sees it', async () => {
      await h.http.patch(api(`/branches/${tmp}`)).set(bearer(A.owner)).send({ status: 'INACTIVE' }).expect(200);
      await h.http.get(api(`/branches/${tmp}`)).expect(404);
      const pub = await h.http.get(api(`/clubs/${A.clubId}/branches`)).expect(200);
      expect(pub.body.data.map((b: { id: string }) => b.id)).not.toContain(tmp);
      const staff = await h.http.get(api(`/clubs/${A.clubId}/branches`)).set(bearer(A.owner)).expect(200);
      expect(staff.body.data.map((b: { id: string }) => b.id)).toContain(tmp);
      // Filial operatori faqat o'z filialini ko'radi
      const op = await h.http.get(api(`/clubs/${A.clubId}/branches`)).set(bearer(badminA1)).expect(200);
      expect(op.body.data.map((b: { id: string }) => b.id)).toEqual([A.branchId]);
      await h.http.patch(api(`/branches/${tmp}`)).set(bearer(A.owner)).send({ status: 'ACTIVE' }).expect(200);
      await h.http.get(api(`/branches/${tmp}`)).expect(200);
    });

    it('branch with an active booking cannot be deleted', async () => {
      const dev = (await h.http.post(api(`/branches/${tmp}/devices`)).set(bearer(A.owner)).send({ name: 'D1', type: 'PC' }).expect(201)).body.data.id;
      await h.http.post(api(`/branches/${tmp}/tariffs`)).set(bearer(A.owner)).send({ name: 'T', price_per_hour: 1_000_000 }).expect(201);
      // Filial ish vaqti 10:00–02:00 — 24/7 qilamiz
      await h.http.patch(api(`/branches/${tmp}`)).set(bearer(A.owner)).send({ working_hours: { always_open: true } }).expect(200);
      // slot_minutes=60 saqlangan (PATCH buffer_minutes uni o'chirmagan) — 30 daqiqalik boshlanish rad etiladi
      const s = new Date(Date.now() + 300 * 60_000);
      s.setUTCMinutes(30, 0, 0);
      const misaligned = await h.http.post(api('/bookings')).set(bearer(cust.token)).send({ branch_id: tmp, start_at: s.toISOString(), duration_minutes: 60, items: [{ device_id: dev }] }).expect(422);
      expect(misaligned.body.error.details.slot_minutes).toBe(60);
      s.setUTCMinutes(60, 0, 0);
      const bk = await h.http.post(api('/bookings')).set(bearer(cust.token)).send({ branch_id: tmp, start_at: s.toISOString(), duration_minutes: 60, items: [{ device_id: dev }] }).expect(201);
      const r = await h.http.delete(api(`/branches/${tmp}`)).set(bearer(A.owner)).expect(409);
      expect(r.body.error.details.active_bookings).toBe(1);
      await h.http.post(api(`/bookings/${bk.body.data.id}/cancel`)).set(bearer(cust.token)).send({ reason: 'test' }).expect(201);
      await h.http.delete(api(`/branches/${tmp}`)).set(bearer(A.owner)).expect(200);
      await h.http.get(api(`/branches/${tmp}`)).expect(404);
      await h.http.patch(api(`/branches/${tmp}`)).set(bearer(A.owner)).send({ name: 'Zombie' }).expect(404);
      expect(await prisma.audit_logs.count({ where: { action: 'branch.delete', target_id: tmp } })).toBe(1);
    });

    it('scope: other club, operators and customers cannot create/update/delete', async () => {
      for (const t of [B.owner, opA1, badminA1, cust.token]) {
        denied((await h.http.post(api(`/clubs/${A.clubId}/branches`)).set(bearer(t)).send(branchBody)).status);
        denied((await h.http.delete(api(`/branches/${A.branchId}`)).set(bearer(t))).status);
      }
      for (const t of [B.owner, opA1, opA2, cust.token]) {
        denied((await h.http.patch(api(`/branches/${A.branchId}`)).set(bearer(t)).send({ name: 'Hacked' })).status);
      }
      // BRANCH_ADMIN'da branches.update yo'q
      denied((await h.http.patch(api(`/branches/${A.branchId}`)).set(bearer(badminA1)).send({ name: 'Hacked' })).status);
      expect((await prisma.branches.findUnique({ where: { id: A.branchId } }))?.name).toBe('Asosiy');
    });
  });

  describe('hours exceptions', () => {
    let exId: string;

    it('adds (upsert per date), lists and deletes', async () => {
      const url = api(`/branches/${A.branchId}/hours-exceptions`);
      const r = await h.http.post(url).set(bearer(A.owner)).send({ date: '2027-01-01', is_closed: true, reason: 'Yangi yil' }).expect(201);
      exId = r.body.data.id;
      const again = await h.http.post(url).set(bearer(A.owner)).send({ date: '2027-01-01', is_closed: false, open_time: '12:00', close_time: '18:00' }).expect(201);
      expect(again.body.data.id).toBe(exId);
      expect(again.body.data).toMatchObject({ is_closed: false, open_time: '12:00', close_time: '18:00' });
      const list = await h.http.get(url).set(bearer(A.owner)).expect(200);
      expect(list.body.data.filter((e: { id: string }) => e.id === exId)).toHaveLength(1);
      // Ommaviy filial sahifasida ko'rinadi
      const pub = await h.http.get(api(`/branches/${A.branchId}`)).expect(200);
      expect(pub.body.data.exceptions.map((e: { id: string }) => e.id)).toContain(exId);
      expect(await prisma.audit_logs.count({ where: { action: 'branch.hours_exception.set', target_id: A.branchId } })).toBe(2);
    });

    it('validates payload', async () => {
      const url = api(`/branches/${A.branchId}/hours-exceptions`);
      await h.http.post(url).set(bearer(A.owner)).send({ date: '2027-01-02', is_closed: false }).expect(422);
      await h.http.post(url).set(bearer(A.owner)).send({ date: '01.01.2027', is_closed: true }).expect(422);
      await h.http.post(url).set(bearer(A.owner)).send({ date: '2027-01-02', is_closed: false, open_time: '9:00', close_time: '18:00' }).expect(422);
      await h.http.post(url).set(bearer(A.owner)).send({ date: '2027-01-02', is_closed: 'yes' }).expect(422);
    });

    it('scope: other club / operator cannot list, add or delete', async () => {
      for (const t of [B.owner, opA2, cust.token]) {
        denied((await h.http.get(api(`/branches/${A.branchId}/hours-exceptions`)).set(bearer(t))).status);
      }
      for (const t of [B.owner, opA1, badminA1, cust.token]) {
        denied((await h.http.post(api(`/branches/${A.branchId}/hours-exceptions`)).set(bearer(t)).send({ date: '2027-02-01', is_closed: true })).status);
        denied((await h.http.delete(api(`/branches/${A.branchId}/hours-exceptions/${exId}`)).set(bearer(t))).status);
      }
      // B o'z filiali yo'li orqali A istisnosini o'chira olmaydi
      await h.http.delete(api(`/branches/${B.branchId}/hours-exceptions/${exId}`)).set(bearer(B.owner)).expect(200);
      expect(await prisma.branch_hours_exceptions.findUnique({ where: { id: exId } })).not.toBeNull();
      await h.http.delete(api(`/branches/${A.branchId}/hours-exceptions/${exId}`)).set(bearer(A.owner)).expect(200);
      expect(await prisma.branch_hours_exceptions.findUnique({ where: { id: exId } })).toBeNull();
    });
  });

  describe('rooms', () => {
    let room: string;

    it('creates, lists with device count, updates (grid + decor), validates', async () => {
      const url = api(`/branches/${A.branchId}/rooms`);
      const r = await h.http.post(url).set(bearer(A.owner)).send({ name: 'Bootcamp', type: 'BOOTCAMP', capacity: 10, grid_cols: 8, grid_rows: 6 }).expect(201);
      room = r.body.data.id;
      expect(r.body.data).toMatchObject({ club_id: A.clubId, branch_id: A.branchId, type: 'BOOTCAMP', grid_cols: 8 });
      for (const body of [
        { name: 'X', type: 'LOUNGE' },
        { name: 'X', capacity: 0 },
        { name: 'X', grid_cols: 41 },
        { name: 'X', grid_rows: 1 },
        { name: 'X', decor: [{ kind: 'DOOR', x: 1, y: 1 }] },
        { name: 'X', decor: [{ kind: 'WC', x: 40, y: 1 }] },
        { name: '' },
        { name: 'X', club_id: B.clubId },
      ]) {
        const res = await h.http.post(url).set(bearer(A.owner)).send(body);
        expect({ body, status: res.status }).toEqual({ body, status: 422 });
      }
      await h.http.patch(api(`/devices/${A.devices[0]}`)).set(bearer(A.owner)).send({ room_id: room }).expect(200);
      const list = await h.http.get(url).set(bearer(A.owner)).expect(200);
      expect(list.body.data.find((x: { id: string }) => x.id === room)._count.devices).toBe(1);

      const u = await h.http.patch(api(`/rooms/${room}`)).set(bearer(A.owner)).send({ name: 'Bootcamp 2', status: 'INACTIVE', decor: [{ kind: 'ENTRANCE', x: 0, y: 0 }] }).expect(200);
      expect(u.body.data).toMatchObject({ name: 'Bootcamp 2', status: 'INACTIVE', decor: [{ kind: 'ENTRANCE', x: 0, y: 0 }] });
      await h.http.patch(api(`/rooms/${room}`)).set(bearer(A.owner)).send({ status: 'CLOSED' }).expect(422);
      // Nofaol xona ommaviy sahifada yo'q
      const pub = await h.http.get(api(`/branches/${A.branchId}`)).expect(200);
      expect(pub.body.data.rooms.map((x: { id: string }) => x.id)).not.toContain(room);
      expect(await prisma.audit_logs.count({ where: { action: { in: ['room.create', 'room.update'] }, target_id: room } })).toBe(2);
    });

    it('room with devices cannot be deleted', async () => {
      const r = await h.http.delete(api(`/rooms/${room}`)).set(bearer(A.owner)).expect(409);
      expect(r.body.error.details.devices).toBe(1);
      await h.http.patch(api(`/devices/${A.devices[0]}`)).set(bearer(A.owner)).send({ room_id: null }).expect(200);
    });

    it('scope: other club / other-branch admin / operator cannot touch rooms', async () => {
      for (const t of [B.owner, opA1, cust.token]) {
        denied((await h.http.get(api(`/branches/${A.branchId}/rooms`)).set(bearer(t))).status);
        denied((await h.http.post(api(`/branches/${A.branchId}/rooms`)).set(bearer(t)).send({ name: 'Hack' })).status);
        denied((await h.http.patch(api(`/rooms/${room}`)).set(bearer(t)).send({ name: 'Hack' })).status);
        denied((await h.http.delete(api(`/rooms/${room}`)).set(bearer(t))).status);
      }
      const badminA2 = (await h.staff(A, 'BRANCH_ADMIN', branchA2)).token;
      denied((await h.http.patch(api(`/rooms/${room}`)).set(bearer(badminA2)).send({ name: 'Hack' })).status);
      // Filial admini o'z filialida ishlaydi
      await h.http.patch(api(`/rooms/${room}`)).set(bearer(badminA1)).send({ name: 'BA edit' }).expect(200);
      expect((await prisma.rooms.findUnique({ where: { id: room } }))?.name).toBe('BA edit');
      await h.http.delete(api(`/rooms/${room}`)).set(bearer(A.owner)).expect(200);
      await h.http.patch(api(`/rooms/${room}`)).set(bearer(A.owner)).send({ name: 'x' }).expect(404);
    });
  });

  describe('club settings', () => {
    const card = '8600123412345678';

    it('validates cancellation policy and transfer card', async () => {
      const url = api(`/clubs/${A.clubId}/settings`);
      const dupe = await h.http.patch(url).set(bearer(A.owner)).send({
        cancellation_policy: { free_cancel_minutes_before: 60, rules: [{ min_minutes_before_start: 60, refund_percent: 100 }, { min_minutes_before_start: 60, refund_percent: 50 }], platform_fee_refundable: false, no_show_refund_percent: 0 },
      }).expect(422);
      expect(dupe.body.error.details.field).toBe('cancellation_policy.rules');
      await h.http.patch(url).set(bearer(A.owner)).send({ cancellation_policy: { free_cancel_minutes_before: 60, rules: [{ min_minutes_before_start: 60, refund_percent: 150 }], platform_fee_refundable: false, no_show_refund_percent: 0 } }).expect(422);
      await h.http.patch(url).set(bearer(A.owner)).send({ transfer_card: { number: '8600 1234', holder: 'X Y' } }).expect(422);
      await h.http.patch(url).set(bearer(A.owner)).send({ commission_bps: 0 }).expect(422);
    });

    it('stores the card; it is visible only via settings, never publicly or in audit', async () => {
      const r = await h.http.patch(api(`/clubs/${A.clubId}/settings`)).set(bearer(A.owner)).send({
        transfer_card: { number: card, holder: ' ali valiyev ' },
        cancellation_policy: { free_cancel_minutes_before: 120, rules: [{ min_minutes_before_start: 120, refund_percent: 100 }, { min_minutes_before_start: 0, refund_percent: 0 }], platform_fee_refundable: true, no_show_refund_percent: 0 },
      }).expect(200);
      expect(r.body.data.transfer_card).toEqual({ number: card, holder: 'ALI VALIYEV' });
      expect(r.body.data.cancellation_policy.free_cancel_minutes_before).toBe(120);

      const club = await h.http.get(api(`/clubs/${A.clubId}`)).set(bearer(A.owner)).expect(200);
      expect(club.body.data.has_transfer_card).toBe(true);
      expect(JSON.stringify(club.body.data)).not.toContain(card);
      const pub = await h.http.get(api(`/branches/${A.branchId}`)).expect(200);
      expect(pub.body.data.payment_options.card_transfer).toBe(true);
      expect(JSON.stringify(pub.body.data)).not.toContain(card);
      const clubPub = await h.http.get(api(`/clubs/${A.clubId}/public`)).expect(200);
      expect(JSON.stringify(clubPub.body.data)).not.toContain(card);

      const logs = await prisma.audit_logs.findMany({ where: { action: 'club.settings.update', club_id: A.clubId } });
      expect(logs.length).toBeGreaterThan(0);
      expect(JSON.stringify(logs.map((l) => [l.old_value, l.new_value]))).not.toContain(card);

      await h.http.patch(api(`/clubs/${A.clubId}/settings`)).set(bearer(A.owner)).send({ transfer_card: null }).expect(200);
      expect((await h.http.get(api(`/clubs/${A.clubId}/settings`)).set(bearer(A.owner)).expect(200)).body.data.transfer_card).toBeNull();
    });

    it('scope: other club owner, branch staff and customers cannot read or change settings', async () => {
      for (const t of [B.owner, badminA1, opA1, cust.token]) {
        denied((await h.http.get(api(`/clubs/${A.clubId}/settings`)).set(bearer(t))).status);
        denied((await h.http.patch(api(`/clubs/${A.clubId}/settings`)).set(bearer(t)).send({ transfer_card: { number: '4444333322221111', holder: 'HACKER' } })).status);
      }
      expect((await prisma.clubs.findUnique({ where: { id: A.clubId } }))?.transfer_card_number).toBeNull();
    });
  });

  describe('documents', () => {
    let doc: string;

    it('owner uploads; super admin reviews', async () => {
      const url = api(`/clubs/${A.clubId}/documents`);
      await h.http.post(url).set(bearer(A.owner)).send({ type: 'DIPLOMA', file_url: 'https://files.example.com/a.pdf' }).expect(422);
      await h.http.post(url).set(bearer(A.owner)).send({ type: 'LICENSE', file_url: 'not-a-url' }).expect(422);
      const r = await h.http.post(url).set(bearer(A.owner)).send({ type: 'LICENSE', file_url: 'https://files.example.com/license.pdf' }).expect(201);
      doc = r.body.data.id;
      expect(r.body.data).toMatchObject({ club_id: A.clubId, type: 'LICENSE' });
      const list = await h.http.get(url).set(bearer(A.owner)).expect(200);
      expect(list.body.data.map((d: { id: string }) => d.id)).toContain(doc);

      denied((await h.http.patch(api(`/admin/clubs/documents/${doc}`)).set(bearer(A.owner)).send({ status: 'APPROVED' })).status);
      await h.http.patch(api(`/admin/clubs/documents/${doc}`)).set(bearer(h.admin)).send({ status: 'MAYBE' }).expect(422);
      const rv = await h.http.patch(api(`/admin/clubs/documents/${doc}`)).set(bearer(h.admin)).send({ status: 'APPROVED', note: 'ok' }).expect(200);
      expect(rv.body.data.status).toBe('APPROVED');
      expect(await prisma.audit_logs.count({ where: { action: 'admin.club.document.review', target_id: doc } })).toBe(1);
      expect(await prisma.audit_logs.count({ where: { action: 'club.document.add', target_id: doc } })).toBe(1);
    });

    it('scope: other club / staff / customer cannot read or upload documents', async () => {
      for (const t of [B.owner, badminA1, opA1, cust.token]) {
        denied((await h.http.get(api(`/clubs/${A.clubId}/documents`)).set(bearer(t))).status);
        denied((await h.http.post(api(`/clubs/${A.clubId}/documents`)).set(bearer(t)).send({ type: 'OTHER', file_url: 'https://evil.example.com/x.pdf' })).status);
      }
      expect(await prisma.club_documents.count({ where: { club_id: A.clubId, file_url: { contains: 'evil' } } })).toBe(0);
    });
  });

  describe('staff', () => {
    let assignment: string;
    const phone = rndPhone();

    it('owner adds a new staff member with a password; duplicates and bad roles rejected', async () => {
      const url = api(`/clubs/${A.clubId}/staff`);
      const r = await h.http.post(url).set(bearer(A.owner)).send({ phone, role: 'OPERATOR', branch_id: A.branchId, password: 'OperPass#2026', first_name: 'Ali' }).expect(201);
      assignment = r.body.data.user_role_id;
      await h.http.post(url).set(bearer(A.owner)).send({ phone, role: 'OPERATOR', branch_id: A.branchId, password: 'OperPass#2026' }).expect(409);
      await h.http.post(url).set(bearer(A.owner)).send({ phone: rndPhone(), role: 'CLUB_OWNER', password: 'OperPass#2026' }).expect(422);
      await h.http.post(url).set(bearer(A.owner)).send({ phone: rndPhone(), role: 'OPERATOR', password: 'OperPass#2026' }).expect(422);
      await h.http.post(url).set(bearer(A.owner)).send({ phone: rndPhone(), role: 'CLUB_ADMIN' }).expect(422); // yangi xodimga parol kerak
      await h.http.post(url).set(bearer(A.owner)).send({ phone: '998901234567', role: 'CLUB_ADMIN', password: 'OperPass#2026' }).expect(422);
      await h.http.post(url).set(bearer(A.owner)).send({ phone: rndPhone(), role: 'OPERATOR', branch_id: B.branchId, password: 'OperPass#2026' }).expect(404);

      const login = await h.http.post(api('/auth/login')).send({ login: phone, password: 'OperPass#2026' }).expect(200);
      expect(login.body.data.user.roles.some((x: { role: string; branch_id: string }) => x.role === 'OPERATOR' && x.branch_id === A.branchId)).toBe(true);
      expect(await prisma.audit_logs.count({ where: { action: 'staff.add', club_id: A.clubId, target_id: r.body.data.user_id } })).toBe(1);
    });

    it('list contains no secrets', async () => {
      const list = await h.http.get(api(`/clubs/${A.clubId}/staff`)).set(bearer(A.owner)).expect(200);
      const row = list.body.data.find((x: { id: string }) => x.id === assignment);
      expect(row).toMatchObject({ role: 'OPERATOR', branch_id: A.branchId, branch_name: 'Asosiy' });
      const json = JSON.stringify(list.body.data);
      expect(json).not.toMatch(/password|token_hash|refresh/i);
      // Filial admini faqat o'z filiali xodimlarini ko'radi
      const ba = await h.http.get(api(`/clubs/${A.clubId}/staff`)).set(bearer(badminA1)).expect(200);
      expect(ba.body.data.every((x: { branch_id: string }) => x.branch_id === A.branchId)).toBe(true);
    });

    it('owner updates role/branch; escalation is impossible', async () => {
      const u = await h.http.patch(api(`/clubs/${A.clubId}/staff/${assignment}`)).set(bearer(A.owner)).send({ role: 'BRANCH_ADMIN', branch_id: branchA2 }).expect(200);
      expect(u.body.data.branch_id).toBe(branchA2);
      await h.http.patch(api(`/clubs/${A.clubId}/staff/${assignment}`)).set(bearer(A.owner)).send({ role: 'SUPER_ADMIN' }).expect(422);
      const ownerRow = await prisma.user_roles.findFirstOrThrow({ where: { club_id: A.clubId, role: { code: 'CLUB_OWNER' } } });
      await h.http.patch(api(`/clubs/${A.clubId}/staff/${ownerRow.id}`)).set(bearer(A.owner)).send({ role: 'OPERATOR', branch_id: A.branchId }).expect(403);
      await h.http.delete(api(`/clubs/${A.clubId}/staff/${ownerRow.id}`)).set(bearer(A.owner)).expect(403);

      // CLUB_ADMIN o'ziga teng rol bera olmaydi
      const ca = (await h.staff(A, 'CLUB_ADMIN')).token;
      await h.http.post(api(`/clubs/${A.clubId}/staff`)).set(bearer(ca)).send({ phone: rndPhone(), role: 'CLUB_ADMIN', password: 'Whatever#2026' }).expect(403);
      await h.http.patch(api(`/clubs/${A.clubId}/staff/${assignment}`)).set(bearer(ca)).send({ role: 'CLUB_ADMIN' }).expect(403);
      // Operator xodim qo'sha olmaydi
      denied((await h.http.post(api(`/clubs/${A.clubId}/staff`)).set(bearer(opA1)).send({ phone: rndPhone(), role: 'OPERATOR', branch_id: A.branchId, password: 'Whatever#2026' })).status);
      const log = await prisma.audit_logs.findFirst({ where: { action: 'staff.update', club_id: A.clubId }, orderBy: { at: 'desc' } });
      expect(log?.old_value).toMatchObject({ role: 'OPERATOR', branch_id: A.branchId });
    });

    it('scope: other club owner cannot list/update/delete club A staff', async () => {
      for (const t of [B.owner, cust.token]) {
        denied((await h.http.get(api(`/clubs/${A.clubId}/staff`)).set(bearer(t))).status);
        denied((await h.http.patch(api(`/clubs/${A.clubId}/staff/${assignment}`)).set(bearer(t)).send({ role: 'OPERATOR', branch_id: A.branchId })).status);
        denied((await h.http.delete(api(`/clubs/${A.clubId}/staff/${assignment}`)).set(bearer(t))).status);
      }
      // B o'z klubi yo'li orqali A tayinlovini o'zgartira olmaydi
      await h.http.delete(api(`/clubs/${B.clubId}/staff/${assignment}`)).set(bearer(B.owner)).expect(404);
      await h.http.post(api(`/clubs/${B.clubId}/staff`)).set(bearer(B.owner)).send({ phone: rndPhone(), role: 'OPERATOR', branch_id: A.branchId, password: 'Whatever#2026' }).expect(404);
      expect(await prisma.user_roles.findUnique({ where: { id: assignment } })).not.toBeNull();
    });

    it('owner removes the assignment; user is kept', async () => {
      await h.http.delete(api(`/clubs/${A.clubId}/staff/${assignment}`)).set(bearer(A.owner)).expect(200);
      expect(await prisma.user_roles.findUnique({ where: { id: assignment } })).toBeNull();
      expect(await prisma.users.findUnique({ where: { phone } })).not.toBeNull();
      await h.http.delete(api(`/clubs/${A.clubId}/staff/${assignment}`)).set(bearer(A.owner)).expect(404);
    });
  });

  describe('customers & notes', () => {
    let custId: string;

    beforeAll(async () => {
      await h.http.post(api('/bookings')).set(bearer(cust.token)).send({ branch_id: A.branchId, start_at: slot(360), duration_minutes: 60, items: [{ device_id: A.devices[1] }] }).expect(201);
      custId = (await prisma.users.findUniqueOrThrow({ where: { phone: cust.phone } })).id;
    });

    it('owner sees full phone; branch-1 operator sees masked; branch-2 operator does not see the customer', async () => {
      const own = await h.http.get(api(`/clubs/${A.clubId}/customers`)).set(bearer(A.owner)).expect(200);
      const row = own.body.data.find((c: { id: string }) => c.id === custId);
      // Ikki bron: o'chirilgan filialdagi bekor qilingani + hozirgisi (ikkalasi ham klub A)
      expect(row).toMatchObject({ phone: cust.phone, bookings_count: 2, note: null });
      expect(JSON.stringify(row)).not.toMatch(/password|token/i);

      const op = await h.http.get(api(`/clubs/${A.clubId}/customers`)).set(bearer(opA1)).expect(200);
      const masked = op.body.data.find((c: { id: string }) => c.id === custId);
      expect(masked.phone).not.toBe(cust.phone);
      expect(masked.phone).toContain('***');

      const op2 = await h.http.get(api(`/clubs/${A.clubId}/customers`)).set(bearer(opA2)).expect(200);
      expect(op2.body.data.map((c: { id: string }) => c.id)).not.toContain(custId);
    });

    it('owner sets a private note; others cannot', async () => {
      const url = api(`/clubs/${A.clubId}/customers/${custId}/notes`);
      await h.http.put(url).set(bearer(A.owner)).send({ note: 'x'.repeat(2001) }).expect(422);
      await h.http.put(url).set(bearer(A.owner)).send({}).expect(422);
      const r = await h.http.put(url).set(bearer(A.owner)).send({ note: 'Muammoli mijoz' }).expect(200);
      expect(r.body.data).toMatchObject({ club_id: A.clubId, user_id: custId, note: 'Muammoli mijoz' });
      const own = await h.http.get(api(`/clubs/${A.clubId}/customers`)).set(bearer(A.owner)).expect(200);
      expect(own.body.data.find((c: { id: string }) => c.id === custId).note).toBe('Muammoli mijoz');

      for (const t of [B.owner, opA1, badminA1, cust.token]) {
        denied((await h.http.put(url).set(bearer(t)).send({ note: 'hacked' })).status);
      }
      // B o'z klubida bu mijozga yozuv qila olmaydi (u B'da bron qilmagan)
      await h.http.put(api(`/clubs/${B.clubId}/customers/${custId}/notes`)).set(bearer(B.owner)).send({ note: 'spy' }).expect(404);
      expect((await prisma.customer_notes.findFirst({ where: { club_id: A.clubId, user_id: custId } }))?.note).toBe('Muammoli mijoz');
      expect(await prisma.customer_notes.count({ where: { club_id: B.clubId, user_id: custId } })).toBe(0);
      // Yozuv matni audit log'ga tushmaydi, faqat amal
      const log = await prisma.audit_logs.findFirst({ where: { action: 'customer.note.set', club_id: A.clubId, target_id: custId } });
      expect(log).not.toBeNull();
    });

    it("club B and the customer can't list club A customers; customer's own views don't leak notes", async () => {
      for (const t of [B.owner, cust.token]) denied((await h.http.get(api(`/clubs/${A.clubId}/customers`)).set(bearer(t))).status);
      const b = await h.http.get(api(`/clubs/${B.clubId}/customers`)).set(bearer(B.owner)).expect(200);
      expect(b.body.data.map((c: { id: string }) => c.id)).not.toContain(custId);
      const me = await h.http.get(api('/users/me')).set(bearer(cust.token)).expect(200);
      expect(JSON.stringify(me.body.data)).not.toContain('Muammoli');
      const bookings = await h.http.get(api('/bookings')).set(bearer(cust.token)).expect(200);
      expect(JSON.stringify(bookings.body.data)).not.toContain('Muammoli');
    });
  });
});
