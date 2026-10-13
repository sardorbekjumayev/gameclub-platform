import { PrismaService } from '../src/database/prisma.service';
import { api, bearer, Harness, slot, TestClub } from './utils/harness';

jest.setTimeout(120_000);

/** Phase 3: qurilmalar, kategoriyalar, bulk, status, layout, texnik xizmat + scope va audit. */
describe('Devices (e2e)', () => {
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
  let opA2: string;
  let badminA1: string;
  let customer: string;
  let roomA1: string;
  let roomB: string;

  const denied = (status: number) => expect([403, 404]).toContain(status);
  const audit = (action: string, target_id: string) => prisma.audit_logs.findMany({ where: { action, target_id } });

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    A = await h.club({ devices: 3 });
    B = await h.club({ devices: 1 });
    const b2 = await h.http
      .post(api(`/clubs/${A.clubId}/branches`))
      .set(bearer(A.owner))
      .send({ name: 'Ikkinchi', address: 'Toshkent, Sergeli 2', latitude: 41.22, longitude: 69.22, working_hours: { always_open: true } })
      .expect(201);
    branchA2 = b2.body.data.id;
    opA2 = (await h.staff(A, 'OPERATOR', branchA2)).token;
    badminA1 = (await h.staff(A, 'BRANCH_ADMIN', A.branchId)).token;
    customer = (await h.customer()).token;
    roomA1 = (await h.http.post(api(`/branches/${A.branchId}/rooms`)).set(bearer(A.owner)).send({ name: 'VIP', type: 'VIP' }).expect(201)).body.data.id;
    roomB = (await h.http.post(api(`/branches/${B.branchId}/rooms`)).set(bearer(B.owner)).send({ name: 'B-zal' }).expect(201)).body.data.id;
  });

  afterAll(() => h.stop());

  describe('categories', () => {
    let catA: string;

    it('owner creates a category; DTO is validated', async () => {
      const c = await h.http.post(api(`/branches/${A.branchId}/device-categories`)).set(bearer(A.owner)).send({ name: 'Pro PC', device_type: 'PC', position: 1 }).expect(201);
      catA = c.body.data.id;
      expect(c.body.data).toMatchObject({ name: 'Pro PC', device_type: 'PC', club_id: A.clubId, branch_id: A.branchId });

      const bad = await h.http.post(api(`/branches/${A.branchId}/device-categories`)).set(bearer(A.owner)).send({ name: 'X', device_type: 'NINTENDO' }).expect(422);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
      await h.http.post(api(`/branches/${A.branchId}/device-categories`)).set(bearer(A.owner)).send({ name: 'X', device_type: 'PC', club_id: B.clubId }).expect(422);
      await h.http.post(api(`/branches/${A.branchId}/device-categories`)).set(bearer(A.owner)).send({ name: '', device_type: 'PC' }).expect(422);

      const pub = await h.http.get(api(`/branches/${A.branchId}/device-categories`)).expect(200);
      expect(pub.body.data.map((x: { id: string }) => x.id)).toContain(catA);
      // Boshqa klub kategoriyasi aralashmaydi
      const pubB = await h.http.get(api(`/branches/${B.branchId}/device-categories`)).expect(200);
      expect(pubB.body.data.map((x: { id: string }) => x.id)).not.toContain(catA);
    });

    it('unknown branch → 404 (not 500)', async () => {
      const r = await h.http.get(api('/branches/00000000-0000-4000-8000-000000000000/device-categories'));
      expect(r.status).toBe(404);
    });

    it('other club / operator cannot create, update or delete categories', async () => {
      denied((await h.http.post(api(`/branches/${A.branchId}/device-categories`)).set(bearer(B.owner)).send({ name: 'Hack', device_type: 'PC' })).status);
      denied((await h.http.post(api(`/branches/${A.branchId}/device-categories`)).set(bearer(opA2)).send({ name: 'Hack', device_type: 'PC' })).status);
      denied((await h.http.patch(api(`/device-categories/${catA}`)).set(bearer(B.owner)).send({ name: 'Hack', device_type: 'PC' })).status);
      denied((await h.http.delete(api(`/device-categories/${catA}`)).set(bearer(B.owner))).status);
      denied((await h.http.delete(api(`/device-categories/${catA}`)).set(bearer(customer))).status);
      const still = await prisma.device_categories.findUnique({ where: { id: catA } });
      expect(still?.name).toBe('Pro PC');
      expect(still?.deleted_at).toBeNull();
    });

    it('device uses category; deleting category detaches devices; audit written', async () => {
      const d = await h.http.post(api(`/branches/${A.branchId}/devices`)).set(bearer(A.owner)).send({ name: 'CAT-1', type: 'PC', category_id: catA }).expect(201);
      // Boshqa klub kategoriyasini ulab bo'lmaydi
      const catB = (await h.http.post(api(`/branches/${B.branchId}/device-categories`)).set(bearer(B.owner)).send({ name: 'B cat', device_type: 'PC' }).expect(201)).body.data.id;
      const cross = await h.http.post(api(`/branches/${A.branchId}/devices`)).set(bearer(A.owner)).send({ name: 'CAT-X', type: 'PC', category_id: catB }).expect(422);
      expect(cross.body.error.details.field).toBe('category_id');

      await h.http.patch(api(`/device-categories/${catA}`)).set(bearer(A.owner)).send({ name: 'Pro PC 2', device_type: 'PC' }).expect(200);
      await h.http.delete(api(`/device-categories/${catA}`)).set(bearer(A.owner)).expect(200);
      const dev = await prisma.devices.findUnique({ where: { id: d.body.data.id } });
      expect(dev?.category_id).toBeNull();
      const pub = await h.http.get(api(`/branches/${A.branchId}/device-categories`)).expect(200);
      expect(pub.body.data.map((x: { id: string }) => x.id)).not.toContain(catA);
      await h.http.patch(api(`/device-categories/${catA}`)).set(bearer(A.owner)).send({ name: 'Again', device_type: 'PC' }).expect(404);
      expect(await audit('device_category.create', catA)).toHaveLength(1);
      expect(await audit('device_category.delete', catA)).toHaveLength(1);
      await h.http.delete(api(`/devices/${d.body.data.id}`)).set(bearer(A.owner)).expect(200);
    });
  });

  describe('CRUD', () => {
    let devId: string;

    it('creates a device with specs and room; unique name per branch', async () => {
      const r = await h.http.post(api(`/branches/${A.branchId}/devices`)).set(bearer(A.owner))
        .send({ name: 'PC-VIP-1', type: 'PC', room_id: roomA1, specs: { gpu: 'RTX 4090', ram: '32GB' } }).expect(201);
      devId = r.body.data.id;
      expect(r.body.data).toMatchObject({ name: 'PC-VIP-1', type: 'PC', room_id: roomA1, club_id: A.clubId, branch_id: A.branchId, operational_status: 'ACTIVE', specs: { gpu: 'RTX 4090' } });

      const dup = await h.http.post(api(`/branches/${A.branchId}/devices`)).set(bearer(A.owner)).send({ name: 'PC-VIP-1', type: 'PC' }).expect(409);
      expect(dup.body.error.code).toBe('CONFLICT');
      // Boshqa filialda shu nom bo'lishi mumkin
      await h.http.post(api(`/branches/${branchA2}/devices`)).set(bearer(A.owner)).send({ name: 'PC-VIP-1', type: 'PC' }).expect(201);

      const audits = await audit('device.create', devId);
      expect(audits).toHaveLength(1);
      expect(audits[0].club_id).toBe(A.clubId);
    });

    it('rejects invalid payloads (enum, empty name, extra fields, foreign room)', async () => {
      const url = api(`/branches/${A.branchId}/devices`);
      for (const body of [
        { name: 'X1', type: 'NINTENDO' },
        { name: '', type: 'PC' },
        { name: 'X2', type: 'PC', operational_status: 'ACTIVE' },
        { name: 'X3', type: 'PC', club_id: B.clubId },
        { name: 'X4', type: 'PC', room_id: 'not-a-uuid' },
        { name: 'X5', type: 'PC', specs: 'gpu' },
        { name: 'x'.repeat(41), type: 'PC' },
      ]) {
        const r = await h.http.post(url).set(bearer(A.owner)).send(body);
        expect(r.status).toBe(422);
        expect(r.body.error.code).toBe('VALIDATION_ERROR');
      }
      const foreign = await h.http.post(url).set(bearer(A.owner)).send({ name: 'X6', type: 'PC', room_id: roomB }).expect(422);
      expect(foreign.body.error.details.field).toBe('room_id');
      expect(await prisma.devices.count({ where: { branch_id: A.branchId, name: { startsWith: 'X' } } })).toBe(0);
    });

    it('updates a device; renaming to an existing name → 409', async () => {
      const u = await h.http.patch(api(`/devices/${devId}`)).set(bearer(A.owner)).send({ name: 'PC-VIP-01', specs: { gpu: 'RTX 5090' }, position_order: 99 }).expect(200);
      expect(u.body.data).toMatchObject({ name: 'PC-VIP-01', specs: { gpu: 'RTX 5090' }, position_order: 99 });
      const other = (await prisma.devices.findUnique({ where: { id: A.devices[0] } }))!.name;
      const dup = await h.http.patch(api(`/devices/${devId}`)).set(bearer(A.owner)).send({ name: other }).expect(409);
      expect(dup.body.error.code).toBe('CONFLICT');
      await h.http.patch(api(`/devices/${devId}`)).set(bearer(A.owner)).send({ room_id: roomB }).expect(422);
      await h.http.patch(api(`/devices/${devId}`)).set(bearer(A.owner)).send({ type: 'TOASTER' }).expect(422);
      await h.http.patch(api(`/devices/${devId}`)).set(bearer(A.owner)).send({ branch_id: branchA2 }).expect(422);
      const row = await prisma.devices.findUnique({ where: { id: devId } });
      expect(row).toMatchObject({ name: 'PC-VIP-01', branch_id: A.branchId, room_id: roomA1 });
      expect(await audit('device.update', devId)).toHaveLength(1);
    });

    it('branch admin manages own branch devices only', async () => {
      const r = await h.http.post(api(`/branches/${A.branchId}/devices`)).set(bearer(badminA1)).send({ name: 'BA-1', type: 'PS5' }).expect(201);
      await h.http.patch(api(`/devices/${r.body.data.id}`)).set(bearer(badminA1)).send({ name: 'BA-01' }).expect(200);
      denied((await h.http.post(api(`/branches/${branchA2}/devices`)).set(bearer(badminA1)).send({ name: 'BA-2', type: 'PC' })).status);
      const a2dev = await prisma.devices.findFirstOrThrow({ where: { branch_id: branchA2, deleted_at: null } });
      denied((await h.http.patch(api(`/devices/${a2dev.id}`)).set(bearer(badminA1)).send({ name: 'Hijack' })).status);
      denied((await h.http.delete(api(`/devices/${a2dev.id}`)).set(bearer(badminA1))).status);
      await h.http.delete(api(`/devices/${r.body.data.id}`)).set(bearer(badminA1)).expect(200);
    });

    it('list returns room/category and only branch devices; public list hides DISABLED and private fields', async () => {
      const list = await h.http.get(api(`/branches/${A.branchId}/devices`)).set(bearer(A.owner)).expect(200);
      const ids = list.body.data.map((d: { id: string }) => d.id);
      expect(ids).toEqual(expect.arrayContaining([...A.devices, devId]));
      expect(list.body.data.every((d: { branch_id: string }) => d.branch_id === A.branchId)).toBe(true);
      expect(list.body.data.find((d: { id: string }) => d.id === devId).room).toEqual({ id: roomA1, name: 'VIP' });

      await h.http.patch(api(`/devices/${A.devices[2]}/status`)).set(bearer(A.owner)).send({ operational_status: 'DISABLED', reason: 'broken' }).expect(200);
      const pub = await h.http.get(api(`/branches/${A.branchId}/devices/public`)).expect(200);
      const pubIds = pub.body.data.map((d: { id: string }) => d.id);
      expect(pubIds).toContain(devId);
      expect(pubIds).not.toContain(A.devices[2]);
      for (const d of pub.body.data) {
        expect(Object.keys(d).sort()).toEqual(['category_id', 'id', 'layout', 'name', 'operational_status', 'room_id', 'specs', 'type']);
      }
      await h.http.patch(api(`/devices/${A.devices[2]}/status`)).set(bearer(A.owner)).send({ operational_status: 'ACTIVE' }).expect(200);
    });

    it('deleted device disappears and cannot be modified', async () => {
      const d = await h.http.post(api(`/branches/${A.branchId}/devices`)).set(bearer(A.owner)).send({ name: 'TMP-1', type: 'XBOX' }).expect(201);
      await h.http.delete(api(`/devices/${d.body.data.id}`)).set(bearer(A.owner)).expect(200);
      await h.http.delete(api(`/devices/${d.body.data.id}`)).set(bearer(A.owner)).expect(404);
      await h.http.patch(api(`/devices/${d.body.data.id}`)).set(bearer(A.owner)).send({ name: 'Zombie' }).expect(404);
      const list = await h.http.get(api(`/branches/${A.branchId}/devices`)).set(bearer(A.owner)).expect(200);
      expect(list.body.data.map((x: { id: string }) => x.id)).not.toContain(d.body.data.id);
      // Nom yana bo'shaydi (partial unique index)
      await h.http.post(api(`/branches/${A.branchId}/devices`)).set(bearer(A.owner)).send({ name: 'TMP-1', type: 'XBOX' }).expect(201);
      expect(await audit('device.delete', d.body.data.id)).toHaveLength(1);
    });
  });

  describe('bulk', () => {
    it('creates zero-padded range; validates bounds', async () => {
      const r = await h.http.post(api(`/branches/${A.branchId}/devices/bulk`)).set(bearer(A.owner)).send({ prefix: 'BK-', from: 8, to: 10, type: 'PS5', room_id: roomA1 }).expect(201);
      expect(r.body.data).toEqual({ created: 3, names: ['BK-08', 'BK-09', 'BK-10'] });
      const rows = await prisma.devices.findMany({ where: { branch_id: A.branchId, name: { startsWith: 'BK-' }, deleted_at: null } });
      expect(rows).toHaveLength(3);
      expect(rows.every((d) => d.type === 'PS5' && d.room_id === roomA1 && d.club_id === A.clubId)).toBe(true);

      const wide = await h.http.post(api(`/branches/${A.branchId}/devices/bulk`)).set(bearer(A.owner)).send({ prefix: 'W', from: 99, to: 100, type: 'OTHER' }).expect(201);
      expect(wide.body.data.names).toEqual(['W099', 'W100']);

      const audits = await prisma.audit_logs.findMany({ where: { action: 'device.bulk_create', target_id: A.branchId } });
      expect(audits.some((a) => JSON.stringify(a.new_value).includes('BK-08'))).toBe(true);
    });

    it('rejects reversed, oversized and out-of-range requests', async () => {
      const url = api(`/branches/${A.branchId}/devices/bulk`);
      const rev = await h.http.post(url).set(bearer(A.owner)).send({ prefix: 'R-', from: 5, to: 2, type: 'PC' }).expect(422);
      expect(rev.body.error.details.field).toBe('to');
      const big = await h.http.post(url).set(bearer(A.owner)).send({ prefix: 'R-', from: 1, to: 201, type: 'PC' }).expect(422);
      expect(big.body.error.details.field).toBe('to');
      await h.http.post(url).set(bearer(A.owner)).send({ prefix: 'R-', from: 0, to: 2, type: 'PC' }).expect(422);
      await h.http.post(url).set(bearer(A.owner)).send({ prefix: 'R-', from: 1, to: 1000, type: 'PC' }).expect(422);
      await h.http.post(url).set(bearer(A.owner)).send({ prefix: '', from: 1, to: 2, type: 'PC' }).expect(422);
      await h.http.post(url).set(bearer(A.owner)).send({ prefix: 'R-', from: 1, to: 2, type: 'PC', extra: 1 }).expect(422);
      await h.http.post(url).set(bearer(A.owner)).send({ prefix: 'R-', from: 1, to: 2, type: 'PC', room_id: roomB }).expect(422);
      expect(await prisma.devices.count({ where: { branch_id: A.branchId, name: { startsWith: 'R-' } } })).toBe(0);
    });

    it('overlapping names → 409 and nothing is created (all-or-nothing)', async () => {
      const r = await h.http.post(api(`/branches/${A.branchId}/devices/bulk`)).set(bearer(A.owner)).send({ prefix: 'BK-', from: 10, to: 12, type: 'PS5' }).expect(409);
      expect(r.body.error.details.names).toEqual(['BK-10']);
      expect(await prisma.devices.count({ where: { branch_id: A.branchId, name: { in: ['BK-11', 'BK-12'] } } })).toBe(0);
    });

    it('other club / operator / customer cannot bulk create in club A', async () => {
      for (const t of [B.owner, opA2, customer]) {
        denied((await h.http.post(api(`/branches/${A.branchId}/devices/bulk`)).set(bearer(t)).send({ prefix: 'H-', from: 1, to: 2, type: 'PC' })).status);
      }
      expect(await prisma.devices.count({ where: { branch_id: A.branchId, name: { startsWith: 'H-' } } })).toBe(0);
    });
  });

  describe('status & future bookings', () => {
    let target: string;
    let bookingId: string;

    beforeAll(async () => {
      target = (await h.http.post(api(`/branches/${A.branchId}/devices`)).set(bearer(A.owner)).send({ name: 'BOOKED-1', type: 'PC' }).expect(201)).body.data.id;
      const b = await h.http.post(api('/bookings')).set(bearer(customer)).send({ branch_id: A.branchId, start_at: slot(240), duration_minutes: 60, items: [{ device_id: target }] }).expect(201);
      bookingId = b.body.data.id;
    });

    it('validates status enum', async () => {
      await h.http.patch(api(`/devices/${target}/status`)).set(bearer(A.owner)).send({ operational_status: 'BROKEN' }).expect(422);
      await h.http.patch(api(`/devices/${target}/status`)).set(bearer(A.owner)).send({ operational_status: 'MAINTENANCE', resolve: 'ignore' }).expect(422);
    });

    it('device with a future booking cannot be deleted', async () => {
      const r = await h.http.delete(api(`/devices/${target}`)).set(bearer(A.owner)).expect(409);
      expect(r.body.error.details.bookings).toBeGreaterThan(0);
      expect((await prisma.devices.findUnique({ where: { id: target } }))?.deleted_at).toBeNull();
    });

    it('MAINTENANCE with upcoming booking → 409 listing it; resolve=cancel cancels it', async () => {
      const c = await h.http.patch(api(`/devices/${target}/status`)).set(bearer(A.owner)).send({ operational_status: 'MAINTENANCE' }).expect(409);
      expect(c.body.error.details.bookings.map((b: { id: string }) => b.id)).toContain(bookingId);
      expect((await prisma.devices.findUnique({ where: { id: target } }))?.operational_status).toBe('ACTIVE');

      const ok = await h.http.patch(api(`/devices/${target}/status`)).set(bearer(A.owner)).send({ operational_status: 'MAINTENANCE', reason: 'GPU', resolve: 'cancel' }).expect(200);
      expect(ok.body.data.operational_status).toBe('MAINTENANCE');
      const booking = await prisma.bookings.findUnique({ where: { id: bookingId } });
      expect(booking?.status).toBe('CANCELLED');

      const logs = await audit('device.status', target);
      expect(logs.at(-1)?.old_value).toEqual({ operational_status: 'ACTIVE' });
      expect(logs.at(-1)?.new_value).toMatchObject({ operational_status: 'MAINTENANCE', reason: 'GPU' });

      // Endi o'chirsa bo'ladi
      await h.http.delete(api(`/devices/${target}`)).set(bearer(A.owner)).expect(200);
    });

    it('operator changes status only in own branch', async () => {
      const a2dev = await prisma.devices.findFirstOrThrow({ where: { branch_id: branchA2, deleted_at: null } });
      await h.http.patch(api(`/devices/${a2dev.id}/status`)).set(bearer(opA2)).send({ operational_status: 'MAINTENANCE' }).expect(200);
      await h.http.patch(api(`/devices/${a2dev.id}/status`)).set(bearer(opA2)).send({ operational_status: 'ACTIVE' }).expect(200);
      denied((await h.http.patch(api(`/devices/${A.devices[0]}/status`)).set(bearer(opA2)).send({ operational_status: 'DISABLED' })).status);
      denied((await h.http.patch(api(`/devices/${A.devices[0]}/status`)).set(bearer(B.owner)).send({ operational_status: 'DISABLED' })).status);
      denied((await h.http.patch(api(`/devices/${A.devices[0]}/status`)).set(bearer(customer)).send({ operational_status: 'DISABLED' })).status);
      // Operatorda devices.update yo'q
      denied((await h.http.patch(api(`/devices/${a2dev.id}`)).set(bearer(opA2)).send({ name: 'Renamed' })).status);
      expect((await prisma.devices.findUnique({ where: { id: A.devices[0] } }))?.operational_status).toBe('ACTIVE');
    });
  });

  describe('layout', () => {
    it('saves positions, moves devices between own rooms, skips foreign devices', async () => {
      const r = await h.http.put(api(`/branches/${A.branchId}/layout`)).set(bearer(A.owner)).send({
        items: [
          { device_id: A.devices[0], x: 1, y: 2, room_id: roomA1 },
          { device_id: A.devices[1], x: 3, y: 4 },
          { device_id: B.devices[0], x: 5, y: 5 },
        ],
      }).expect(200);
      expect(r.body.data).toEqual({ updated: 2, skipped: [B.devices[0]] });
      const d0 = await prisma.devices.findUnique({ where: { id: A.devices[0] } });
      expect(d0).toMatchObject({ layout: { x: 1, y: 2 }, room_id: roomA1 });
      expect((await prisma.devices.findUnique({ where: { id: B.devices[0] } }))?.layout).not.toEqual({ x: 5, y: 5 });

      await h.http.put(api(`/branches/${A.branchId}/layout`)).set(bearer(A.owner)).send({ items: [{ device_id: A.devices[0], x: 1, y: 2, room_id: null }] }).expect(200);
      expect((await prisma.devices.findUnique({ where: { id: A.devices[0] } }))?.room_id).toBeNull();
      expect((await prisma.audit_logs.count({ where: { action: 'branch.layout', target_id: A.branchId } }))).toBeGreaterThanOrEqual(2);
    });

    it('rejects foreign room and out-of-range coordinates', async () => {
      const r = await h.http.put(api(`/branches/${A.branchId}/layout`)).set(bearer(A.owner)).send({ items: [{ device_id: A.devices[0], x: 1, y: 1, room_id: roomB }] }).expect(422);
      expect(r.body.error.details.field).toBe('room_id');
      await h.http.put(api(`/branches/${A.branchId}/layout`)).set(bearer(A.owner)).send({ items: [{ device_id: A.devices[0], x: 101, y: 1 }] }).expect(422);
      await h.http.put(api(`/branches/${A.branchId}/layout`)).set(bearer(A.owner)).send({ items: [{ device_id: A.devices[0], x: -1, y: 1 }] }).expect(422);
      await h.http.put(api(`/branches/${A.branchId}/layout`)).set(bearer(A.owner)).send({ items: 'nope' }).expect(422);
    });

    it('club B owner / operator cannot change club A layout', async () => {
      for (const t of [B.owner, opA2, customer]) {
        denied((await h.http.put(api(`/branches/${A.branchId}/layout`)).set(bearer(t)).send({ items: [{ device_id: A.devices[1], x: 9, y: 9 }] })).status);
      }
      // B o'z filiali orqali A qurilmasini siljita olmaydi
      const r = await h.http.put(api(`/branches/${B.branchId}/layout`)).set(bearer(B.owner)).send({ items: [{ device_id: A.devices[1], x: 9, y: 9 }] }).expect(200);
      expect(r.body.data.skipped).toEqual([A.devices[1]]);
      expect((await prisma.devices.findUnique({ where: { id: A.devices[1] } }))?.layout).toEqual({ x: 3, y: 4 });
    });
  });

  describe('maintenance', () => {
    let ticket: string;

    it('report → in progress → done', async () => {
      const m = await h.http.post(api(`/devices/${A.devices[1]}/maintenance`)).set(bearer(A.owner)).send({ title: 'Sichqoncha ishlamaydi', description: 'chap tugma' }).expect(201);
      ticket = m.body.data.id;
      expect(m.body.data).toMatchObject({ device_id: A.devices[1], club_id: A.clubId, status: 'OPEN' });

      const list = await h.http.get(api(`/branches/${A.branchId}/maintenance`)).set(bearer(A.owner)).expect(200);
      expect(list.body.data.find((x: { id: string }) => x.id === ticket).device.id).toBe(A.devices[1]);
      const devs = await h.http.get(api(`/branches/${A.branchId}/devices`)).set(bearer(A.owner)).expect(200);
      expect(devs.body.data.find((d: { id: string }) => d.id === A.devices[1]).maintenance.map((x: { id: string }) => x.id)).toContain(ticket);

      const p = await h.http.patch(api(`/maintenance/${ticket}`)).set(bearer(A.owner)).send({ status: 'IN_PROGRESS' }).expect(200);
      expect(p.body.data.started_at).toBeTruthy();
      const d = await h.http.patch(api(`/maintenance/${ticket}`)).set(bearer(A.owner)).send({ status: 'DONE', description: 'almashtirildi' }).expect(200);
      expect(d.body.data).toMatchObject({ status: 'DONE', description: 'almashtirildi' });
      expect(d.body.data.resolved_at).toBeTruthy();
      expect(await audit('device.maintenance.update', ticket)).toHaveLength(2);
    });

    it('validates payloads', async () => {
      await h.http.post(api(`/devices/${A.devices[1]}/maintenance`)).set(bearer(A.owner)).send({ title: 'x' }).expect(422);
      await h.http.patch(api(`/maintenance/${ticket}`)).set(bearer(A.owner)).send({ status: 'CLOSED' }).expect(422);
      await h.http.patch(api('/maintenance/00000000-0000-4000-8000-000000000000')).set(bearer(A.owner)).send({ status: 'DONE' }).expect(404);
    });

    it('scope: other club / other-branch operator cannot see or touch tickets', async () => {
      denied((await h.http.get(api(`/branches/${A.branchId}/maintenance`)).set(bearer(B.owner))).status);
      denied((await h.http.get(api(`/branches/${A.branchId}/maintenance`)).set(bearer(opA2))).status);
      denied((await h.http.post(api(`/devices/${A.devices[1]}/maintenance`)).set(bearer(B.owner)).send({ title: 'Hack hack' })).status);
      denied((await h.http.post(api(`/devices/${A.devices[1]}/maintenance`)).set(bearer(opA2)).send({ title: 'Hack hack' })).status);
      denied((await h.http.patch(api(`/maintenance/${ticket}`)).set(bearer(B.owner)).send({ status: 'OPEN' })).status);
      denied((await h.http.patch(api(`/maintenance/${ticket}`)).set(bearer(opA2)).send({ status: 'OPEN' })).status);
      expect((await prisma.device_maintenance.findUnique({ where: { id: ticket } }))?.status).toBe('DONE');
    });
  });

  describe('scope: listing and modifying club A devices', () => {
    it('B owner, branch-2 operator and customer cannot list club A branch-1 devices', async () => {
      for (const t of [B.owner, opA2, customer]) {
        denied((await h.http.get(api(`/branches/${A.branchId}/devices`)).set(bearer(t))).status);
      }
      await h.http.get(api(`/branches/${A.branchId}/devices`)).expect(401);
      await h.http.get(api(`/branches/${branchA2}/devices`)).set(bearer(opA2)).expect(200);
    });

    it('B owner cannot update/delete club A devices or create in club A branch', async () => {
      denied((await h.http.patch(api(`/devices/${A.devices[0]}`)).set(bearer(B.owner)).send({ name: 'pwned' })).status);
      denied((await h.http.delete(api(`/devices/${A.devices[0]}`)).set(bearer(B.owner))).status);
      denied((await h.http.post(api(`/branches/${A.branchId}/devices`)).set(bearer(B.owner)).send({ name: 'Trojan', type: 'PC' })).status);
      denied((await h.http.delete(api(`/devices/${A.devices[0]}`)).set(bearer(customer))).status);
      const d = await prisma.devices.findUnique({ where: { id: A.devices[0] } });
      expect(d?.deleted_at).toBeNull();
      expect(d?.name).not.toBe('pwned');
      expect(await prisma.devices.count({ where: { branch_id: A.branchId, name: 'Trojan' } })).toBe(0);
    });
  });
});
