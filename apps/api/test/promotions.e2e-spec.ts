import { DateTime } from 'luxon';
import { PrismaService } from '../src/database/prisma.service';
import { api, bearer, Harness, slot, TestClub } from './utils/harness';
import { newClub, newCustomer } from './utils/flows';

/**
 * Promo kodlar (docs/01-API.md §6.12): klub CRUD (scope), platforma promo, validate qoidalari
 * (muddat, limitlar, min summa, max chegirma, filial/qurilma turi/hafta kuni, boshqa klub), bronga qo'llash.
 */
describe('Promotions (e2e)', () => {
  const h = new Harness();
  let A: TestClub;
  let B: TestClub;
  let customer: { token: string; phone: string };
  let prisma: PrismaService;
  const PRICE = 1_200_000;
  const code = (p = 'E2E') => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`.toUpperCase().slice(0, 32);
  const validate = (body: Record<string, unknown>, token = customer.token) => h.http.post(api('/promotions/validate')).set(bearer(token)).send(body);
  const create = (club: TestClub, body: Record<string, unknown>) => h.http.post(api(`/clubs/${club.clubId}/promotions`)).set(bearer(club.owner)).send(body);

  let pctId: string;
  let pctCode: string;
  let platformId: string | undefined;

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    [A, B] = [await newClub(h, { pricePerHour: PRICE }), await newClub(h, { pricePerHour: PRICE })];
    customer = await newCustomer(h);
  }, 120_000);

  afterAll(async () => {
    if (platformId) await prisma.promotions.updateMany({ where: { id: platformId }, data: { deleted_at: new Date(), is_active: false } });
    await h.stop();
  });

  describe('CRUD & scope', () => {
    it('club owner creates; money in integer tiyin; validation', async () => {
      pctCode = code('PCT');
      const r = await create(A, { code: pctCode, type: 'PERCENT', value: 10, max_discount_amount: 500_000, min_order_amount: 100_000 }).expect(201);
      pctId = r.body.data.id;
      expect(r.body.data).toMatchObject({ club_id: A.clubId, code: pctCode, type: 'PERCENT', value: 10, max_discount_amount: 500_000, funded_by: 'CLUB', is_active: true, used_count: 0 });

      await create(A, { code: code(), type: 'PERCENT', value: 150 }).expect(422);
      await create(A, { code: 'lower-case', type: 'PERCENT', value: 10 }).expect(422);
      await create(A, { code: code(), type: 'BOGO', value: 10 }).expect(422);
      await create(A, { code: code(), type: 'FIXED', value: 10.5 }).expect(422);
      await create(A, { code: code(), type: 'FIXED', value: 0 }).expect(422);
      const dup = await create(B, { code: pctCode, type: 'FIXED', value: 1000 }).expect(409);
      expect(dup.body.error.code).toBe('CONFLICT');
    });

    it('club B, customers and operators cannot list/create club A promotions', async () => {
      await h.http.get(api(`/clubs/${A.clubId}/promotions`)).set(bearer(B.owner)).expect(403);
      await h.http.post(api(`/clubs/${A.clubId}/promotions`)).set(bearer(B.owner)).send({ code: code(), type: 'FIXED', value: 1000 }).expect(403);
      await h.http.get(api(`/clubs/${A.clubId}/promotions`)).set(bearer(customer.token)).expect(403);
      const op = await h.staff(A, 'OPERATOR', A.branchId);
      await h.http.get(api(`/clubs/${A.clubId}/promotions`)).set(bearer(op.token)).expect(403);
      // BRANCH_ADMIN ko'radi, lekin boshqara olmaydi
      const ba = await h.staff(A, 'BRANCH_ADMIN', A.branchId);
      const seen = await h.http.get(api(`/clubs/${A.clubId}/promotions`)).set(bearer(ba.token)).expect(200);
      expect(seen.body.data.map((p: { id: string }) => p.id)).toContain(pctId);
      await h.http.post(api(`/clubs/${A.clubId}/promotions`)).set(bearer(ba.token)).send({ code: code(), type: 'FIXED', value: 1000 }).expect(403);
      await h.http.patch(api(`/promotions/${pctId}`)).set(bearer(ba.token)).send({ value: 20 }).expect(404);

      const own = await h.http.get(api(`/clubs/${A.clubId}/promotions?q=${pctCode.slice(0, 6).toLowerCase()}`)).set(bearer(A.owner)).expect(200);
      expect(own.body.data.map((p: { id: string }) => p.id)).toContain(pctId);
      expect(own.body.data.every((p: { club_id: string }) => p.club_id === A.clubId)).toBe(true);
      const bList = await h.http.get(api(`/clubs/${B.clubId}/promotions`)).set(bearer(B.owner)).expect(200);
      expect(bList.body.data.map((p: { id: string }) => p.id)).not.toContain(pctId);
    });

    it('PATCH/DELETE: other club/customer get 404; owner updates (audited)', async () => {
      await h.http.patch(api(`/promotions/${pctId}`)).set(bearer(B.owner)).send({ value: 50 }).expect(404);
      await h.http.patch(api(`/promotions/${pctId}`)).set(bearer(customer.token)).send({ value: 50 }).expect(404);
      await h.http.delete(api(`/promotions/${pctId}`)).set(bearer(B.owner)).expect(404);
      const u = await h.http.patch(api(`/promotions/${pctId}`)).set(bearer(A.owner)).send({ value: 20 }).expect(200);
      expect(u.body.data.value).toBe(20);
      expect(await prisma.audit_logs.count({ where: { action: 'promotion.update', target_id: pctId } })).toBe(1);
    });

    it('PATCH cannot push a PERCENT promotion above 100%', async () => {
      const r = await h.http.patch(api(`/promotions/${pctId}`)).set(bearer(A.owner)).send({ value: 500 }).expect(422);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
      expect(Number((await prisma.promotions.findUniqueOrThrow({ where: { id: pctId } })).value)).toBe(20);
    });

    it('platform promotions: only platform.settings.manage; club cannot edit them', async () => {
      await h.http.post(api('/admin/promotions')).set(bearer(A.owner)).send({ code: code(), type: 'FIXED', value: 1000 }).expect(403);
      await h.http.get(api('/admin/promotions')).set(bearer(A.owner)).expect(403);
      const r = await h.http.post(api('/admin/promotions')).set(bearer(h.admin)).send({ code: code('PLT'), type: 'FIXED', value: 50_000, per_user_limit: 1 }).expect(201);
      platformId = r.body.data.id;
      expect(r.body.data).toMatchObject({ club_id: null, funded_by: 'PLATFORM' });
      await h.http.patch(api(`/promotions/${platformId}`)).set(bearer(A.owner)).send({ value: 1 }).expect(404);
      await h.http.delete(api(`/promotions/${platformId}`)).set(bearer(A.owner)).expect(404);
      // Klub ro'yxatida platforma promo yo'q
      const list = await h.http.get(api(`/clubs/${A.clubId}/promotions`)).set(bearer(A.owner)).expect(200);
      expect(list.body.data.map((p: { id: string }) => p.id)).not.toContain(platformId);
      // Har qanday klubda amal qiladi
      const v = await validate({ code: r.body.data.code, branch_id: B.branchId, amount: PRICE }).expect(201);
      expect(v.body.data).toEqual({ valid: true, code: r.body.data.code, discount: 50_000, total: PRICE - 50_000 });
    });
  });

  describe('validate', () => {
    it('computes percent discount with max cap; code is case-insensitive', async () => {
      const v = await validate({ code: pctCode.toLowerCase(), branch_id: A.branchId, amount: 1_000_000 }).expect(201);
      expect(v.body.data).toEqual({ valid: true, code: pctCode, discount: 200_000, total: 800_000 });
      const capped = await validate({ code: pctCode, branch_id: A.branchId, amount: 10_000_000 }).expect(201);
      expect(capped.body.data.discount).toBe(500_000);
    });

    it('rejects: other club, unknown, min amount, inactive', async () => {
      const reason = async (body: Record<string, unknown>) => {
        const r = await validate(body).expect(422);
        expect(r.body.error.code).toBe('PROMO_INVALID');
        return r.body.error.details.reason;
      };
      expect(await reason({ code: pctCode, branch_id: B.branchId, amount: 1_000_000 })).toBe('OTHER_CLUB');
      expect(await reason({ code: 'NOPE-DOES-NOT-EXIST', branch_id: A.branchId, amount: 1_000_000 })).toBe('NOT_FOUND');
      expect(await reason({ code: pctCode, branch_id: A.branchId, amount: 50_000 })).toBe('MIN_AMOUNT');
      await h.http.post(api('/promotions/validate')).send({ code: pctCode, branch_id: A.branchId, amount: 1 }).expect(401);
      await validate({ code: pctCode, branch_id: A.branchId, amount: -1 }).expect(422);
      await validate({ code: pctCode, branch_id: '00000000-0000-7000-8000-000000000000', amount: 1 }).expect(404);

      const c = code('OFF');
      const off = await create(A, { code: c, type: 'FIXED', value: 1000, is_active: false }).expect(201);
      expect(await reason({ code: c, branch_id: A.branchId, amount: 1_000_000 })).toBe('NOT_FOUND');
      await h.http.patch(api(`/promotions/${off.body.data.id}`)).set(bearer(A.owner)).send({ is_active: true }).expect(200);
      await validate({ code: c, branch_id: A.branchId, amount: 1_000_000 }).expect(201);
    });

    it('rejects: expired / not started, usage limit reached', async () => {
      const exp = code('EXP');
      await create(A, { code: exp, type: 'FIXED', value: 1000, ends_at: new Date(Date.now() - 3600_000).toISOString() }).expect(201);
      expect((await validate({ code: exp, branch_id: A.branchId, amount: 100_000 }).expect(422)).body.error.details.reason).toBe('EXPIRED');
      const fut = code('FUT');
      await create(A, { code: fut, type: 'FIXED', value: 1000, starts_at: new Date(Date.now() + 86400_000).toISOString() }).expect(201);
      expect((await validate({ code: fut, branch_id: A.branchId, amount: 100_000 }).expect(422)).body.error.details.reason).toBe('EXPIRED');

      const lim = code('LIM');
      const l = await create(A, { code: lim, type: 'FIXED', value: 1000, usage_limit: 1 }).expect(201);
      await prisma.promotions.update({ where: { id: l.body.data.id }, data: { used_count: 1 } });
      expect((await validate({ code: lim, branch_id: A.branchId, amount: 100_000 }).expect(422)).body.error.details.reason).toBe('LIMIT_REACHED');
    });

    it('applies_to: branch, device type and weekday filters', async () => {
      const br = code('BR');
      await create(A, { code: br, type: 'FIXED', value: 1000, applies_to: { branch_ids: ['00000000-0000-7000-8000-000000000001'] } }).expect(201);
      expect((await validate({ code: br, branch_id: A.branchId, amount: 100_000 }).expect(422)).body.error.details.reason).toBe('BRANCH');

      const dt = code('DT');
      await create(A, { code: dt, type: 'FIXED', value: 1000, applies_to: { device_types: ['PS5'] } }).expect(201);
      expect((await validate({ code: dt, branch_id: A.branchId, amount: 100_000, device_ids: [A.devices[0]] }).expect(422)).body.error.details.reason).toBe('DEVICE_TYPE');

      const start = slot(24 * 60);
      const wd = DateTime.fromISO(start, { zone: 'Asia/Tashkent' }).weekday;
      const other = (wd % 7) + 1;
      const w = code('WD');
      await create(A, { code: w, type: 'FIXED', value: 1000, applies_to: { weekdays: [other] } }).expect(201);
      expect((await validate({ code: w, branch_id: A.branchId, amount: 100_000, start_at: start }).expect(422)).body.error.details.reason).toBe('WEEKDAY');
      const w2 = code('WD');
      await create(A, { code: w2, type: 'FIXED', value: 1000, applies_to: { weekdays: [wd], device_types: ['PC'] } }).expect(201);
      await validate({ code: w2, branch_id: A.branchId, amount: 100_000, start_at: start, device_ids: [A.devices[0]] }).expect(201);
    });

    it('FIXED discount never exceeds the amount', async () => {
      const big = code('BIG');
      await create(A, { code: big, type: 'FIXED', value: 5_000_000 }).expect(201);
      const v = await validate({ code: big, branch_id: A.branchId, amount: 300_000 }).expect(201);
      expect(v.body.data).toMatchObject({ discount: 300_000, total: 0 });
    });
  });

  it('booking with a promo code gets the discount; deleted promo no longer valid', async () => {
    const c = code('BK');
    const p = await create(A, { code: c, type: 'PERCENT', value: 25 }).expect(201);
    const b = await h.http
      .post(api('/bookings'))
      .set(bearer(customer.token))
      .send({ branch_id: A.branchId, start_at: slot(240), duration_minutes: 60, items: [{ device_id: A.devices[1] }], promo_code: c })
      .expect(201);
    expect(Number(b.body.data.subtotal_amount)).toBe(PRICE);
    expect(Number(b.body.data.discount_amount)).toBe(PRICE / 4);
    expect(Number(b.body.data.total_amount)).toBe(PRICE - PRICE / 4);

    await h.http.delete(api(`/promotions/${p.body.data.id}`)).set(bearer(A.owner)).expect(200);
    expect((await validate({ code: c, branch_id: A.branchId, amount: 100_000 }).expect(422)).body.error.details.reason).toBe('NOT_FOUND');
    await h.http.patch(api(`/promotions/${p.body.data.id}`)).set(bearer(A.owner)).send({ value: 30 }).expect(404);
    const list = await h.http.get(api(`/clubs/${A.clubId}/promotions?limit=100`)).set(bearer(A.owner)).expect(200);
    expect(list.body.data.map((x: { id: string }) => x.id)).not.toContain(p.body.data.id);
  });
});
