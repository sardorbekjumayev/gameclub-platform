import { PrismaService } from '../src/database/prisma.service';
import { api, bearer, Harness, slot, TestClub } from './utils/harness';

jest.setTimeout(120_000);

/** Phase 3: tariflar CRUD, xona tarifi, narx hisoblash (price-quote), scope va audit. */
describe('Tariffs & price quote (e2e)', () => {
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
  let badminA2: string;
  let customer: string;
  let roomA1: string;
  let roomB: string;

  const denied = (status: number) => expect([403, 404]).toContain(status);
  const PRICE = 1_200_000;

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    A = await h.club({ devices: 3, pricePerHour: PRICE });
    B = await h.club({ devices: 1 });
    branchA2 = (await h.http.post(api(`/clubs/${A.clubId}/branches`)).set(bearer(A.owner))
      .send({ name: 'Filial 2', address: 'Toshkent, Olmazor 3', latitude: 41.33, longitude: 69.21, working_hours: { always_open: true } }).expect(201)).body.data.id;
    opA1 = (await h.staff(A, 'OPERATOR', A.branchId)).token;
    badminA2 = (await h.staff(A, 'BRANCH_ADMIN', branchA2)).token;
    customer = (await h.customer()).token;
    roomA1 = (await h.http.post(api(`/branches/${A.branchId}/rooms`)).set(bearer(A.owner)).send({ name: 'VIP' }).expect(201)).body.data.id;
    roomB = (await h.http.post(api(`/branches/${B.branchId}/rooms`)).set(bearer(B.owner)).send({ name: 'B VIP' }).expect(201)).body.data.id;
  });

  afterAll(() => h.stop());

  describe('CRUD + validation', () => {
    let tNight: string;

    it('creates a tariff with rules; money stays integer tiyin', async () => {
      const r = await h.http.post(api(`/branches/${A.branchId}/tariffs`)).set(bearer(A.owner)).send({
        name: 'Tungi', price_per_hour: 900_000, device_type: 'PS5', priority: 5, min_minutes: 60,
        rules: [{ days_of_week: [1, 2, 3, 4, 5], start_time: '22:00', end_time: '08:00', price_per_hour: 600_000, kind: 'NIGHT' }],
      }).expect(201);
      tNight = r.body.data.id;
      expect(r.body.data).toMatchObject({ name: 'Tungi', price_per_hour: 900_000, device_type: 'PS5', priority: 5, is_active: true, club_id: A.clubId, branch_id: A.branchId });
      expect(r.body.data.rules).toHaveLength(1);
      expect(r.body.data.rules[0]).toMatchObject({ kind: 'NIGHT', price_per_hour: 600_000, start_time: '22:00' });
      const audits = await prisma.audit_logs.findMany({ where: { action: 'tariff.create', target_id: tNight } });
      expect(audits).toHaveLength(1);
    });

    it('rejects invalid payloads', async () => {
      const url = api(`/branches/${A.branchId}/tariffs`);
      for (const body of [
        { name: 'Neg', price_per_hour: -1 },
        { name: 'Frac', price_per_hour: 10.5 },
        { name: 'Str', price_per_hour: 'abc' },
        { name: '', price_per_hour: 1000 },
        { name: 'Enum', price_per_hour: 1000, device_type: 'NINTENDO' },
        { name: 'Min', price_per_hour: 1000, min_minutes: 10 },
        { name: 'Extra', price_per_hour: 1000, club_id: B.clubId },
        { name: 'Rule time', price_per_hour: 1000, rules: [{ days_of_week: [1], start_time: '25:00', end_time: '08:00', price_per_hour: 1, kind: 'NIGHT' }] },
        { name: 'Rule day', price_per_hour: 1000, rules: [{ days_of_week: [8], start_time: '20:00', end_time: '08:00', price_per_hour: 1, kind: 'NIGHT' }] },
        { name: 'Rule kind', price_per_hour: 1000, rules: [{ days_of_week: [1], start_time: '20:00', end_time: '08:00', price_per_hour: 1, kind: 'MIDNIGHT' }] },
        { name: 'Rule neg', price_per_hour: 1000, rules: [{ days_of_week: [1], start_time: '20:00', end_time: '08:00', price_per_hour: -5, kind: 'NIGHT' }] },
        { name: 'Pkg', price_per_hour: 1000, packages: [{ name: '10m', duration_minutes: 10, price: 100 }] },
      ]) {
        const r = await h.http.post(url).set(bearer(A.owner)).send(body);
        expect({ name: body.name, status: r.status }).toEqual({ name: body.name, status: 422 });
        expect(r.body.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('rejects references from another branch or club', async () => {
      const url = api(`/branches/${A.branchId}/tariffs`);
      const room = await h.http.post(url).set(bearer(A.owner)).send({ name: 'R', price_per_hour: 1000, room_id: roomB }).expect(422);
      expect(room.body.error.details.field).toBe('room_id');
      const dev = await h.http.post(url).set(bearer(A.owner)).send({ name: 'D', price_per_hour: 1000, device_id: B.devices[0] }).expect(422);
      expect(dev.body.error.details.field).toBe('device_id');
      expect(await prisma.tariffs.count({ where: { branch_id: A.branchId, name: { in: ['R', 'D'] } } })).toBe(0);

      // PATCH ham xuddi shunday tekshiriladi
      for (const body of [{ room_id: roomB }, { device_id: B.devices[0] }]) {
        await h.http.patch(api(`/tariffs/${tNight}`)).set(bearer(A.owner)).send(body).expect(422);
      }
      const t = await prisma.tariffs.findUnique({ where: { id: tNight } });
      expect(t?.room_id).toBeNull();
      expect(t?.device_id).toBeNull();
    });

    it('updates price/rules; audit keeps old and new value', async () => {
      const u = await h.http.patch(api(`/tariffs/${tNight}`)).set(bearer(A.owner)).send({ price_per_hour: 950_000, rules: [] }).expect(200);
      expect(u.body.data.price_per_hour).toBe(950_000);
      expect(u.body.data.rules).toEqual([]);
      expect(u.body.data.name).toBe('Tungi');
      await h.http.patch(api(`/tariffs/${tNight}`)).set(bearer(A.owner)).send({ price_per_hour: -10 }).expect(422);
      const logs = await prisma.audit_logs.findMany({ where: { action: 'tariff.update', target_id: tNight }, orderBy: { at: 'desc' } });
      expect(logs).toHaveLength(1);
      expect(logs[0].club_id).toBe(A.clubId);
      expect(Number((logs[0].old_value as { price_per_hour: unknown }).price_per_hour)).toBe(900_000);
      expect((logs[0].new_value as { price_per_hour: number }).price_per_hour).toBe(950_000);
    });

    it('public list shows only active tariffs; manage list shows all', async () => {
      const off = (await h.http.post(api(`/branches/${A.branchId}/tariffs`)).set(bearer(A.owner)).send({ name: 'Yopiq', price_per_hour: 1, is_active: false }).expect(201)).body.data.id;
      const pub = await h.http.get(api(`/branches/${A.branchId}/tariffs`)).expect(200);
      const pubIds = pub.body.data.map((t: { id: string }) => t.id);
      expect(pubIds).toEqual(expect.arrayContaining([A.tariffId, tNight]));
      expect(pubIds).not.toContain(off);
      const manage = await h.http.get(api(`/branches/${A.branchId}/tariffs/manage`)).set(bearer(A.owner)).expect(200);
      expect(manage.body.data.map((t: { id: string }) => t.id)).toEqual(expect.arrayContaining([A.tariffId, tNight, off]));
      // Faol emas tarif minimal narxga ta'sir qilmaydi
      const branch = await h.http.get(api(`/branches/${A.branchId}`)).expect(200);
      expect(branch.body.data.min_price_per_hour).toBe(950_000);
    });

    it('delete removes the tariff everywhere', async () => {
      await h.http.delete(api(`/tariffs/${tNight}`)).set(bearer(A.owner)).expect(200);
      await h.http.delete(api(`/tariffs/${tNight}`)).set(bearer(A.owner)).expect(404);
      await h.http.patch(api(`/tariffs/${tNight}`)).set(bearer(A.owner)).send({ name: 'Zombie' }).expect(404);
      const manage = await h.http.get(api(`/branches/${A.branchId}/tariffs/manage`)).set(bearer(A.owner)).expect(200);
      expect(manage.body.data.map((t: { id: string }) => t.id)).not.toContain(tNight);
      expect(await prisma.audit_logs.count({ where: { action: 'tariff.delete', target_id: tNight } })).toBe(1);
    });
  });

  describe('room tariff', () => {
    let tVip: string;
    let tVip2: string;

    it('binds a tariff to a room; the previous room tariff is detached and deactivated', async () => {
      tVip = (await h.http.post(api(`/branches/${A.branchId}/tariffs`)).set(bearer(A.owner)).send({ name: 'VIP', price_per_hour: 2_000_000, device_type: 'PC' }).expect(201)).body.data.id;
      tVip2 = (await h.http.post(api(`/branches/${A.branchId}/tariffs`)).set(bearer(A.owner)).send({ name: 'VIP 2', price_per_hour: 2_500_000 }).expect(201)).body.data.id;
      const r = await h.http.put(api(`/rooms/${roomA1}/tariff`)).set(bearer(A.owner)).send({ tariff_id: tVip }).expect(200);
      expect(r.body.data).toEqual({ room_id: roomA1, tariff_id: tVip });
      expect(await prisma.tariffs.findUnique({ where: { id: tVip } })).toMatchObject({ room_id: roomA1, device_type: null, is_active: true });

      await h.http.put(api(`/rooms/${roomA1}/tariff`)).set(bearer(A.owner)).send({ tariff_id: tVip2 }).expect(200);
      expect(await prisma.tariffs.findUnique({ where: { id: tVip } })).toMatchObject({ room_id: null, is_active: false });
      expect(await prisma.tariffs.findUnique({ where: { id: tVip2 } })).toMatchObject({ room_id: roomA1, is_active: true });
      expect(await prisma.audit_logs.count({ where: { action: 'room.tariff', target_id: roomA1 } })).toBe(2);
    });

    it('room device is priced by the room tariff', async () => {
      await h.http.patch(api(`/devices/${A.devices[2]}`)).set(bearer(A.owner)).send({ room_id: roomA1 }).expect(200);
      const q = await h.http.post(api(`/branches/${A.branchId}/price-quote`)).send({ device_ids: [A.devices[2], A.devices[1]], start_at: slot(120), duration_minutes: 60 }).expect(201);
      const byId = Object.fromEntries(q.body.data.items.map((i: { device_id: string; amount: number }) => [i.device_id, i.amount]));
      expect(byId[A.devices[2]]).toBe(2_500_000);
      expect(byId[A.devices[1]]).toBe(PRICE);
      expect(q.body.data.total).toBe(2_500_000 + PRICE);
      await h.http.patch(api(`/devices/${A.devices[2]}`)).set(bearer(A.owner)).send({ room_id: null }).expect(200);
    });

    it('rejects tariffs of another branch/club and foreign rooms; null detaches', async () => {
      const tA2 = (await h.http.post(api(`/branches/${branchA2}/tariffs`)).set(bearer(A.owner)).send({ name: 'A2', price_per_hour: 1000 }).expect(201)).body.data.id;
      await h.http.put(api(`/rooms/${roomA1}/tariff`)).set(bearer(A.owner)).send({ tariff_id: tA2 }).expect(404);
      await h.http.put(api(`/rooms/${roomA1}/tariff`)).set(bearer(A.owner)).send({ tariff_id: B.tariffId }).expect(404);
      await h.http.put(api(`/rooms/${roomA1}/tariff`)).set(bearer(A.owner)).send({ tariff_id: 'nope' }).expect(422);
      denied((await h.http.put(api(`/rooms/${roomB}/tariff`)).set(bearer(A.owner)).send({ tariff_id: null })).status);
      denied((await h.http.put(api(`/rooms/${roomA1}/tariff`)).set(bearer(B.owner)).send({ tariff_id: null })).status);
      denied((await h.http.put(api(`/rooms/${roomA1}/tariff`)).set(bearer(badminA2)).send({ tariff_id: null })).status);
      expect((await prisma.tariffs.findUnique({ where: { id: tVip2 } }))?.room_id).toBe(roomA1);

      await h.http.put(api(`/rooms/${roomA1}/tariff`)).set(bearer(A.owner)).send({ tariff_id: null }).expect(200);
      expect(await prisma.tariffs.findUnique({ where: { id: tVip2 } })).toMatchObject({ room_id: null, is_active: false });
    });
  });

  describe('price quote', () => {
    it('quotes the default tariff; device tariff has priority', async () => {
      const q = await h.http.post(api(`/branches/${A.branchId}/price-quote`)).send({ device_ids: [A.devices[0]], start_at: slot(120), duration_minutes: 90 }).expect(201);
      expect(q.body.data).toMatchObject({ subtotal: PRICE * 1.5, discount: 0, total: PRICE * 1.5, promo: null });

      const dt = (await h.http.post(api(`/branches/${A.branchId}/tariffs`)).set(bearer(A.owner)).send({ name: 'Bitta PC', price_per_hour: 500_000, device_id: A.devices[0] }).expect(201)).body.data.id;
      const q2 = await h.http.post(api(`/branches/${A.branchId}/price-quote`)).set(bearer(customer)).send({ device_ids: [A.devices[0], A.devices[1]], start_at: slot(120), duration_minutes: 60 }).expect(201);
      const byId = Object.fromEntries(q2.body.data.items.map((i: { device_id: string; amount: number }) => [i.device_id, i.amount]));
      expect(byId).toEqual({ [A.devices[0]]: 500_000, [A.devices[1]]: PRICE });
      await h.http.delete(api(`/tariffs/${dt}`)).set(bearer(A.owner)).expect(200);
    });

    it('ignores devices of another club; validates input', async () => {
      const url = api(`/branches/${A.branchId}/price-quote`);
      const foreign = await h.http.post(url).send({ device_ids: [B.devices[0]], start_at: slot(120), duration_minutes: 60 }).expect(422);
      expect(foreign.body.error.code).toBe('VALIDATION_ERROR');
      const mixed = await h.http.post(url).send({ device_ids: [B.devices[0], A.devices[1]], start_at: slot(120), duration_minutes: 60 }).expect(201);
      expect(mixed.body.data.items.map((i: { device_id: string }) => i.device_id)).toEqual([A.devices[1]]);
      await h.http.post(url).send({ start_at: slot(120), duration_minutes: 60 }).expect(422);
      await h.http.post(url).send({ device_ids: [A.devices[1]], start_at: slot(120), duration_minutes: 10 }).expect(422);
      await h.http.post(url).send({ device_ids: [A.devices[1]], start_at: 'tomorrow', duration_minutes: 60 }).expect(422);
      await h.http.post(url).send({ device_ids: [A.devices[1]], start_at: slot(120), duration_minutes: 60, extra: true }).expect(422);
      await h.http.post(api('/branches/00000000-0000-4000-8000-000000000000/price-quote')).send({ device_ids: [A.devices[1]], start_at: slot(120), duration_minutes: 60 }).expect(404);
    });
  });

  describe('scope', () => {
    it('B owner / operator / other-branch admin / customer cannot read manage list or modify club A tariffs', async () => {
      for (const t of [B.owner, opA1, badminA2, customer]) {
        denied((await h.http.get(api(`/branches/${A.branchId}/tariffs/manage`)).set(bearer(t))).status);
        denied((await h.http.post(api(`/branches/${A.branchId}/tariffs`)).set(bearer(t)).send({ name: 'Hack', price_per_hour: 1 })).status);
        denied((await h.http.patch(api(`/tariffs/${A.tariffId}`)).set(bearer(t)).send({ price_per_hour: 1 })).status);
        denied((await h.http.delete(api(`/tariffs/${A.tariffId}`)).set(bearer(t))).status);
      }
      const t = await prisma.tariffs.findUnique({ where: { id: A.tariffId } });
      expect(t).toMatchObject({ price_per_hour: BigInt(PRICE), deleted_at: null, is_active: true });
      expect(await prisma.tariffs.count({ where: { branch_id: A.branchId, name: 'Hack' } })).toBe(0);
    });

    it('branch admin manages tariffs of own branch', async () => {
      const r = await h.http.post(api(`/branches/${branchA2}/tariffs`)).set(bearer(badminA2)).send({ name: 'BA', price_per_hour: 700_000 }).expect(201);
      await h.http.patch(api(`/tariffs/${r.body.data.id}`)).set(bearer(badminA2)).send({ price_per_hour: 800_000 }).expect(200);
      await h.http.get(api(`/branches/${branchA2}/tariffs/manage`)).set(bearer(badminA2)).expect(200);
      await h.http.delete(api(`/tariffs/${r.body.data.id}`)).set(bearer(badminA2)).expect(200);
    });
  });
});
