import { PrismaService } from '../src/database/prisma.service';
import { api, bearer, Harness, rndPhone, TestClub } from './utils/harness';

jest.setTimeout(120_000);

/**
 * Tarif rejalari va limitlar (EntitlementsGuard). Faqat shu test yaratgan rejalar o'zgartiriladi —
 * global sinov rejasi va mavjud rejalarga tegilmaydi (testlar parallel ishlaydi).
 */
describe('Plans & entitlements (e2e)', () => {
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
  let customer: string;
  const created: string[] = [];
  const code = (p: string) => `E2E_${p}_${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
  const limits = (o: Partial<Record<string, number | null | boolean>> = {}) => ({ branches: 1, devices: 4, staff: 1, analytics: false, online_booking: true, api_access: false, pc_agent: false, ...o });
  const denied = (status: number) => expect([403, 404]).toContain(status);

  const createPlan = async (body: Record<string, unknown>) => {
    const r = await h.http.post(api('/admin/plans')).set(bearer(h.admin)).send(body).expect(201);
    created.push(r.body.data.id);
    return r.body.data as { id: string; code: string };
  };

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    A = await h.club({ devices: 3 });
    B = await h.club({ devices: 1 });
    customer = (await h.customer()).token;
  });

  afterAll(async () => {
    // O'z rejalarimizni ommaviy ro'yxatdan olib tashlaymiz (obunasi borlarini o'chirib bo'lmaydi)
    for (const id of created) await h.http.patch(api(`/admin/plans/${id}`)).set(bearer(h.admin)).send({ is_active: false });
    await h.stop();
  });

  describe('admin plans CRUD', () => {
    let planId: string;

    it('creates a plan; duplicate code → 409; audit written', async () => {
      const c = code('CRUD');
      const p = await createPlan({ code: c, name: 'E2E reja', price_per_month: 9_900_000, limits: limits() });
      planId = p.id;
      expect(p).toMatchObject({ code: c, price_per_month: 9_900_000, is_active: true, limits: { devices: 4 } });
      const dup = await h.http.post(api('/admin/plans')).set(bearer(h.admin)).send({ code: c, name: 'Dup', price_per_month: 1, limits: limits() }).expect(409);
      expect(dup.body.error.details.field).toBe('code');
      expect(await prisma.audit_logs.count({ where: { action: 'admin.plan.create', target_id: planId } })).toBe(1);
    });

    it('validates payloads', async () => {
      const base = { code: code('V'), name: 'Valid', price_per_month: 1, limits: limits() };
      for (const patch of [
        { code: 'lowercase' },
        { code: 'A' },
        { code: 'WITH-DASH' },
        { name: 'x' },
        { price_per_month: -1 },
        { price_per_month: 1.5 },
        { limits: undefined },
        { limits: { ...limits(), devices: -1 } },
        { limits: { ...limits(), branches: 'many' } },
        { limits: { ...limits(), analytics: 'yes' } },
        { limits: { branches: 1 } },
        { is_active: 'true' },
        { features: [] },
      ]) {
        const r = await h.http.post(api('/admin/plans')).set(bearer(h.admin)).send({ ...base, ...patch });
        expect({ patch, status: r.status }).toEqual({ patch, status: 422 });
      }
      expect(await prisma.plans.count({ where: { code: base.code } })).toBe(0);
    });

    it('lists, updates and shows active clubs count; public list hides inactive plans and internals', async () => {
      const list = await h.http.get(api('/admin/plans')).set(bearer(h.admin)).expect(200);
      expect(list.body.data.find((p: { id: string }) => p.id === planId)).toMatchObject({ active_clubs: 0, is_trial_plan: false });

      const u = await h.http.patch(api(`/admin/plans/${planId}`)).set(bearer(h.admin)).send({ name: 'E2E reja 2', price_per_month: 5_000_000 }).expect(200);
      expect(u.body.data).toMatchObject({ name: 'E2E reja 2', price_per_month: 5_000_000, code: expect.any(String) });
      await h.http.patch(api(`/admin/plans/${planId}`)).set(bearer(h.admin)).send({ code: 'RENAMED' }).expect(422);
      await h.http.patch(api(`/admin/plans/${planId}`)).set(bearer(h.admin)).send({ price_per_month: -5 }).expect(422);
      await h.http.patch(api('/admin/plans/00000000-0000-4000-8000-000000000000')).set(bearer(h.admin)).send({ name: 'Nope' }).expect(404);
      const log = await prisma.audit_logs.findFirst({ where: { action: 'admin.plan.update', target_id: planId } });
      expect(log?.old_value).toMatchObject({ name: 'E2E reja', price_per_month: 9_900_000 });

      let pub = await h.http.get(api('/plans')).expect(200);
      const row = pub.body.data.find((p: { id: string }) => p.id === planId);
      expect(Object.keys(row).sort()).toEqual(['code', 'id', 'limits', 'name', 'price_per_month']);
      const prices = pub.body.data.map((p: { price_per_month: number }) => p.price_per_month);
      expect(prices).toEqual([...prices].sort((a: number, b: number) => a - b));

      await h.http.patch(api(`/admin/plans/${planId}`)).set(bearer(h.admin)).send({ is_active: false }).expect(200);
      pub = await h.http.get(api('/plans')).expect(200);
      expect(pub.body.data.map((p: { id: string }) => p.id)).not.toContain(planId);
    });

    it('unused plan can be deleted; plan in use cannot', async () => {
      const tmp = await createPlan({ code: code('DEL'), name: 'Temp', price_per_month: 0, limits: limits() });
      await h.http.delete(api(`/admin/plans/${tmp.id}`)).set(bearer(h.admin)).expect(200);
      expect(await prisma.plans.findUnique({ where: { id: tmp.id } })).toBeNull();
      expect(await prisma.audit_logs.count({ where: { action: 'admin.plan.delete', target_id: tmp.id } })).toBe(1);
      await h.http.delete(api(`/admin/plans/${tmp.id}`)).set(bearer(h.admin)).expect(404);

      const used = await createPlan({ code: code('USED'), name: 'Used', price_per_month: 0, limits: limits({ devices: null, branches: null, staff: null }) });
      await h.http.post(api(`/admin/clubs/${B.clubId}/subscription`)).set(bearer(h.admin)).send({ plan_id: used.id, status: 'ACTIVE', days: 30 }).expect(201);
      const r = await h.http.delete(api(`/admin/plans/${used.id}`)).set(bearer(h.admin)).expect(409);
      expect(r.body.error.details.reason).toBe('PLAN_IN_USE');
    });

    it('non-admins cannot manage plans or subscriptions', async () => {
      for (const t of [A.owner, customer]) {
        denied((await h.http.get(api('/admin/plans')).set(bearer(t))).status);
        denied((await h.http.post(api('/admin/plans')).set(bearer(t)).send({ code: code('HACK'), name: 'Hack', price_per_month: 0, limits: limits({ devices: null }) })).status);
        denied((await h.http.patch(api(`/admin/plans/${planId}`)).set(bearer(t)).send({ price_per_month: 0 })).status);
        denied((await h.http.delete(api(`/admin/plans/${planId}`)).set(bearer(t))).status);
        denied((await h.http.get(api('/admin/plans/trial')).set(bearer(t))).status);
        denied((await h.http.put(api('/admin/plans/trial')).set(bearer(t)).send({ plan_id: planId, days: 365 })).status);
        denied((await h.http.get(api('/admin/subscriptions')).set(bearer(t))).status);
        denied((await h.http.post(api(`/admin/clubs/${A.clubId}/subscription`)).set(bearer(t)).send({ plan_id: planId, status: 'ACTIVE', days: 3000 })).status);
      }
      await h.http.get(api('/admin/plans')).expect(401);
    });
  });

  describe('assign plan + limits', () => {
    let plan: { id: string; code: string };

    it('assigning a plan cancels the previous subscription; owner sees usage', async () => {
      plan = await createPlan({ code: code('LIM'), name: 'Kichik', price_per_month: 0, limits: limits({ branches: 1, devices: 4, staff: 1 }) });
      const before = await prisma.subscriptions.findMany({ where: { club_id: A.clubId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } } });

      await h.http.post(api(`/admin/clubs/${A.clubId}/subscription`)).set(bearer(h.admin)).send({ plan_id: plan.id, status: 'ACTIVE', days: 0 }).expect(422);
      await h.http.post(api(`/admin/clubs/${A.clubId}/subscription`)).set(bearer(h.admin)).send({ plan_id: plan.id, status: 'EXPIRED', days: 30 }).expect(422);
      await h.http.post(api(`/admin/clubs/${A.clubId}/subscription`)).set(bearer(h.admin)).send({ plan_id: '00000000-0000-4000-8000-000000000000', status: 'ACTIVE', days: 30 }).expect(404);
      await h.http.post(api('/admin/clubs/00000000-0000-4000-8000-000000000000/subscription')).set(bearer(h.admin)).send({ plan_id: plan.id, status: 'ACTIVE', days: 30 }).expect(404);
      // Nofaol reja biriktirilmaydi
      const inactive = await createPlan({ code: code('OFF'), name: 'Nofaol', price_per_month: 0, limits: limits({ branches: 1, devices: 4, staff: 1 }), is_active: false });
      await h.http.post(api(`/admin/clubs/${A.clubId}/subscription`)).set(bearer(h.admin)).send({ plan_id: inactive.id, status: 'ACTIVE', days: 30 }).expect(422);

      const r = await h.http.post(api(`/admin/clubs/${A.clubId}/subscription`)).set(bearer(h.admin)).send({ plan_id: plan.id, status: 'ACTIVE', days: 30 }).expect(201);
      expect(r.body.data).toMatchObject({ club_id: A.clubId, plan_id: plan.id, status: 'ACTIVE', plan: { code: plan.code } });
      for (const s of before) expect((await prisma.subscriptions.findUnique({ where: { id: s.id } }))?.status).toBe('CANCELLED');
      const log = await prisma.audit_logs.findFirst({ where: { action: 'admin.subscription.assign', target_id: r.body.data.id } });
      expect(log).toMatchObject({ club_id: A.clubId, new_value: { plan: plan.code, status: 'ACTIVE', days: 30 } });

      const sub = await h.http.get(api(`/clubs/${A.clubId}/subscription`)).set(bearer(A.owner)).expect(200);
      expect(sub.body.data.subscription.plan.code).toBe(plan.code);
      expect(sub.body.data.usage).toEqual({ branches: 1, devices: 3, staff: 0 });

      const subs = await h.http.get(api('/admin/subscriptions')).query({ plan_id: plan.id }).set(bearer(h.admin)).expect(200);
      expect(subs.body.data.map((s: { club: { id: string } }) => s.club.id)).toEqual([A.clubId]);
      const list = await h.http.get(api('/admin/plans')).set(bearer(h.admin)).expect(200);
      expect(list.body.data.find((p: { id: string }) => p.id === plan.id).active_clubs).toBe(1);
    });

    it('other club owner / customer cannot read club A subscription', async () => {
      for (const t of [B.owner, customer]) denied((await h.http.get(api(`/clubs/${A.clubId}/subscription`)).set(bearer(t))).status);
    });

    it('device limit: single create and bulk are blocked at the limit', async () => {
      await h.http.post(api(`/branches/${A.branchId}/devices`)).set(bearer(A.owner)).send({ name: 'LIM-4', type: 'PC' }).expect(201);
      const one = await h.http.post(api(`/branches/${A.branchId}/devices`)).set(bearer(A.owner)).send({ name: 'LIM-5', type: 'PC' }).expect(403);
      expect(one.body.error).toMatchObject({ code: 'PLAN_LIMIT_REACHED', details: { key: 'devices', limit: 4, used: 4 } });
      const bulk = await h.http.post(api(`/branches/${A.branchId}/devices/bulk`)).set(bearer(A.owner)).send({ prefix: 'LB-', from: 1, to: 2, type: 'PC' }).expect(403);
      expect(bulk.body.error.code).toBe('PLAN_LIMIT_REACHED');
      expect(await prisma.devices.count({ where: { club_id: A.clubId, deleted_at: null } })).toBe(4);

      // Bitta o'chirilsa — yana bitta qo'shish mumkin, lekin bulk 2 ta emas
      const dev = await prisma.devices.findFirstOrThrow({ where: { club_id: A.clubId, name: 'LIM-4' } });
      await h.http.delete(api(`/devices/${dev.id}`)).set(bearer(A.owner)).expect(200);
      const bulk2 = await h.http.post(api(`/branches/${A.branchId}/devices/bulk`)).set(bearer(A.owner)).send({ prefix: 'LB-', from: 1, to: 2, type: 'PC' }).expect(403);
      expect(bulk2.body.error.details).toMatchObject({ key: 'devices', limit: 4, used: 3 });
      await h.http.post(api(`/branches/${A.branchId}/devices/bulk`)).set(bearer(A.owner)).send({ prefix: 'LB-', from: 1, to: 1, type: 'PC' }).expect(201);
    });

    it('branch limit', async () => {
      const r = await h.http.post(api(`/clubs/${A.clubId}/branches`)).set(bearer(A.owner))
        .send({ name: 'Ortiqcha', address: 'Toshkent, Yakkasaroy 1', latitude: 41.29, longitude: 69.25 }).expect(403);
      expect(r.body.error).toMatchObject({ code: 'PLAN_LIMIT_REACHED', details: { key: 'branches', limit: 1, used: 1 } });
      expect(await prisma.branches.count({ where: { club_id: A.clubId, deleted_at: null } })).toBe(1);
    });

    it('staff limit (direct add and invitations)', async () => {
      await h.http.post(api(`/clubs/${A.clubId}/staff`)).set(bearer(A.owner)).send({ phone: rndPhone(), role: 'OPERATOR', branch_id: A.branchId, password: 'StaffPass#2026' }).expect(201);
      const add = await h.http.post(api(`/clubs/${A.clubId}/staff`)).set(bearer(A.owner)).send({ phone: rndPhone(), role: 'OPERATOR', branch_id: A.branchId, password: 'StaffPass#2026' }).expect(403);
      expect(add.body.error).toMatchObject({ code: 'PLAN_LIMIT_REACHED', details: { key: 'staff', limit: 1 } });
      const inv = await h.http.post(api(`/clubs/${A.clubId}/staff/invitations`)).set(bearer(A.owner)).send({ phone: rndPhone(), role: 'CLUB_ADMIN' }).expect(403);
      expect(inv.body.error.code).toBe('PLAN_LIMIT_REACHED');
    });

    it('limits are per club: club B on an unlimited plan is unaffected', async () => {
      await h.http.post(api(`/branches/${B.branchId}/devices/bulk`)).set(bearer(B.owner)).send({ prefix: 'UB-', from: 1, to: 10, type: 'PC' }).expect(201);
    });

    it('raising the limit (new plan) unblocks creation', async () => {
      const bigger = await createPlan({ code: code('BIG'), name: 'Katta', price_per_month: 0, limits: limits({ branches: 2, devices: 10, staff: 5 }) });
      await h.http.post(api(`/admin/clubs/${A.clubId}/subscription`)).set(bearer(h.admin)).send({ plan_id: bigger.id, status: 'TRIALING', days: 7 }).expect(201);
      await h.http.post(api(`/branches/${A.branchId}/devices`)).set(bearer(A.owner)).send({ name: 'LIM-6', type: 'PC' }).expect(201);
      const sub = await h.http.get(api(`/clubs/${A.clubId}/subscription`)).set(bearer(A.owner)).expect(200);
      expect(sub.body.data.subscription).toMatchObject({ status: 'TRIALING', plan: { code: bigger.code } });
      expect(sub.body.data.subscription.trial_ends_at).toBeTruthy();
      expect(sub.body.data.usage).toEqual({ branches: 1, devices: 5, staff: 1 });
      expect(await prisma.subscriptions.count({ where: { club_id: A.clubId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } } })).toBe(1);
    });
  });
});
