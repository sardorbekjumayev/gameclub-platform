import { PrismaService } from '../src/database/prisma.service';
import { api, bearer, Harness, slot, TestClub, uniq } from './utils/harness';

jest.setTimeout(120_000);

/** Klub hayot sikli: reject → resubmit → approve, suspend/reactivate, close; ommaviy ko'rinish va audit. */
describe('Club lifecycle & platform admin (e2e)', () => {
  const h = new Harness();
  // OTP IP limiti (10/soat) parallel ishlayotgan suite'lar orasida tugab qolmasin
  const otpLogin = h.otpLogin.bind(h);
  h.otpLogin = async (phone?: string) => {
    await h.resetRateLimits();
    return otpLogin(phone);
  };
  let prisma: PrismaService;
  let adminId: string;
  let customer: string;

  const denied = (status: number) => expect([403, 404]).toContain(status);
  const lastAudit = (clubId: string, action: string) => prisma.audit_logs.findFirst({ where: { club_id: clubId, action }, orderBy: { at: 'desc' } });

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    adminId = (await prisma.users.findFirstOrThrow({ where: { email: process.env.SUPER_ADMIN_EMAIL } })).id;
    customer = (await h.customer()).token;
  });

  afterAll(() => h.stop());

  describe('reject → resubmit → approve', () => {
    let C: TestClub;

    beforeAll(async () => {
      C = await h.club({ approve: false, name: `E2E Reject ${uniq()}` });
    });

    it('DRAFT club is not public and cannot be approved before submit', async () => {
      expect((await prisma.clubs.findUnique({ where: { id: C.clubId } }))?.status).toBe('DRAFT');
      await h.http.get(api(`/clubs/${C.clubId}/public`)).expect(404);
      await h.http.get(api(`/branches/${C.branchId}`)).expect(404);
      const r = await h.http.post(api(`/admin/clubs/${C.clubId}/approve`)).set(bearer(h.admin)).expect(409);
      expect(r.body.error.code).toBe('CONFLICT');
      // Draft klubda bron qilib bo'lmaydi
      const bk = await h.http.post(api('/bookings')).set(bearer(customer)).send({ branch_id: C.branchId, start_at: slot(120), duration_minutes: 60, items: [{ device_id: C.devices[0] }] }).expect(409);
      expect(bk.body.error.code).toBe('CLUB_NOT_ACTIVE');
    });

    it('reject requires a reason; rejected club shows the reason to its owner', async () => {
      await h.http.post(api(`/clubs/${C.clubId}/submit`)).set(bearer(C.owner)).expect(201);
      await h.http.post(api(`/clubs/${C.clubId}/submit`)).set(bearer(C.owner)).expect(409);
      const noReason = await h.http.post(api(`/admin/clubs/${C.clubId}/reject`)).set(bearer(h.admin)).send({}).expect(422);
      expect(noReason.body.error.details.field).toBe('reason');
      await h.http.post(api(`/admin/clubs/${C.clubId}/reject`)).set(bearer(h.admin)).send({ reason: 'x'.repeat(501) }).expect(422);
      await h.http.post(api(`/admin/clubs/${C.clubId}/reject`)).set(bearer(h.admin)).send({ reason: 'Hujjat yetishmaydi', extra: 1 }).expect(422);
      const r = await h.http.post(api(`/admin/clubs/${C.clubId}/reject`)).set(bearer(h.admin)).send({ reason: 'Hujjat yetishmaydi' }).expect(201);
      expect(r.body.data).toMatchObject({ status: 'REJECTED', rejection_reason: 'Hujjat yetishmaydi' });

      const mine = await h.http.get(api('/clubs/mine')).set(bearer(C.owner)).expect(200);
      expect(mine.body.data.find((x: { id: string }) => x.id === C.clubId)).toMatchObject({ status: 'REJECTED', rejection_reason: 'Hujjat yetishmaydi' });
      await h.http.post(api(`/admin/clubs/${C.clubId}/approve`)).set(bearer(h.admin)).expect(409);

      const log = await lastAudit(C.clubId, 'admin.club.reject');
      expect(log).toMatchObject({ actor_id: adminId, target_type: 'club', target_id: C.clubId, old_value: { status: 'PENDING_APPROVAL' }, new_value: { status: 'REJECTED', reason: 'Hujjat yetishmaydi' } });
      // Egasiga bildirishnoma
      const n = await prisma.notifications.findFirst({ where: { type: 'CLUB_REJECTED', user_id: (await prisma.clubs.findUniqueOrThrow({ where: { id: C.clubId } })).owner_id } });
      expect(n).not.toBeNull();
    });

    it('owner fixes and resubmits; reason is cleared; admin approves', async () => {
      await h.http.patch(api(`/clubs/${C.clubId}`)).set(bearer(C.owner)).send({ description: 'Yangilangan' }).expect(200);
      const s = await h.http.post(api(`/clubs/${C.clubId}/submit`)).set(bearer(C.owner)).expect(201);
      expect(s.body.data).toMatchObject({ status: 'PENDING_APPROVAL', rejection_reason: null });
      const queue = await h.http.get(api('/admin/clubs')).query({ status: 'PENDING_APPROVAL', limit: 100 }).set(bearer(h.admin)).expect(200);
      expect(queue.body.data.every((x: { status: string }) => x.status === 'PENDING_APPROVAL')).toBe(true);
      const a = await h.http.post(api(`/admin/clubs/${C.clubId}/approve`)).set(bearer(h.admin)).expect(201);
      expect(a.body.data.status).toBe('ACTIVE');
      expect(a.body.data.approved_by).toBe(adminId);
      expect(await lastAudit(C.clubId, 'admin.club.approve')).toMatchObject({ actor_id: adminId, new_value: { status: 'ACTIVE' } });
      expect(await lastAudit(C.clubId, 'club.submit')).not.toBeNull();
      await h.http.get(api(`/clubs/${C.clubId}/public`)).expect(200);
    });
  });

  describe('suspend → reactivate', () => {
    let C: TestClub;
    let name: string;

    beforeAll(async () => {
      name = `E2E Suspend ${uniq()}`;
      C = await h.club({ name, branch: { latitude: 40.123456, longitude: 64.654321 } });
    });

    const visible = async () => {
      const list = await h.http.get(api('/clubs')).query({ q: name }).expect(200);
      const club = await h.http.get(api(`/clubs/${C.clubId}/public`));
      const branch = await h.http.get(api(`/branches/${C.branchId}`));
      const branches = await h.http.get(api(`/clubs/${C.clubId}/branches`)).expect(200);
      const summary = await h.http.get(api(`/branches/${C.branchId}/summary`));
      const nearby = await h.http.get(api('/branches/nearby')).query({ lat: 40.123456, lng: 64.654321, radius: 1000 }).expect(200);
      const devices = await h.http.get(api(`/branches/${C.branchId}/devices/public`)).expect(200);
      return {
        list: list.body.data.some((x: { id: string }) => x.id === C.clubId),
        club: club.status,
        branch: branch.status,
        branches: branches.body.data.length,
        summary: summary.status,
        nearby: nearby.body.data.some((x: { id: string }) => x.id === C.branchId),
        devices: devices.body.data.length,
      };
    };

    it('active club is visible everywhere', async () => {
      expect(await visible()).toEqual({ list: true, club: 200, branch: 200, branches: 1, summary: 200, nearby: true, devices: 3 });
    });

    it('suspend requires reason; only platform admins can suspend', async () => {
      await h.http.post(api(`/admin/clubs/${C.clubId}/suspend`)).set(bearer(h.admin)).send({}).expect(422);
      denied((await h.http.post(api(`/admin/clubs/${C.clubId}/suspend`)).set(bearer(C.owner)).send({ reason: 'self' })).status);
      denied((await h.http.post(api(`/admin/clubs/${C.clubId}/suspend`)).set(bearer(customer)).send({ reason: 'x' })).status);
      await h.http.post(api(`/admin/clubs/${C.clubId}/suspend`)).send({ reason: 'x' }).expect(401);
      const r = await h.http.post(api(`/admin/clubs/${C.clubId}/suspend`)).set(bearer(h.admin)).send({ reason: 'Shikoyatlar' }).expect(201);
      expect(r.body.data).toMatchObject({ status: 'SUSPENDED', suspended_reason: 'Shikoyatlar' });
      expect(await lastAudit(C.clubId, 'admin.club.suspend')).toMatchObject({ actor_id: adminId, old_value: { status: 'ACTIVE' }, new_value: { status: 'SUSPENDED', reason: 'Shikoyatlar' } });
      await h.http.post(api(`/admin/clubs/${C.clubId}/suspend`)).set(bearer(h.admin)).send({ reason: 'again' }).expect(409);
    });

    it('suspended club is hidden from the public catalog and discovery', async () => {
      expect(await visible()).toEqual({ list: false, club: 404, branch: 404, branches: 0, summary: 404, nearby: false, devices: 0 });
    });

    it('suspended club accepts no new bookings; owner still manages it', async () => {
      const r = await h.http.post(api('/bookings')).set(bearer(customer)).send({ branch_id: C.branchId, start_at: slot(120), duration_minutes: 60, items: [{ device_id: C.devices[0] }] }).expect(409);
      expect(r.body.error.code).toBe('CLUB_NOT_ACTIVE');
      const own = await h.http.get(api(`/clubs/${C.clubId}`)).set(bearer(C.owner)).expect(200);
      expect(own.body.data.status).toBe('SUSPENDED');
      const mine = await h.http.get(api('/clubs/mine')).set(bearer(C.owner)).expect(200);
      expect(mine.body.data.find((x: { id: string }) => x.id === C.clubId).suspended_reason).toBe('Shikoyatlar');
    });

    it('reactivate restores visibility and bookings', async () => {
      denied((await h.http.post(api(`/admin/clubs/${C.clubId}/reactivate`)).set(bearer(C.owner)).send({})).status);
      const r = await h.http.post(api(`/admin/clubs/${C.clubId}/reactivate`)).set(bearer(h.admin)).send({}).expect(201);
      expect(r.body.data).toMatchObject({ status: 'ACTIVE', suspended_reason: null });
      expect(await lastAudit(C.clubId, 'admin.club.reactivate')).toMatchObject({ actor_id: adminId, new_value: { status: 'ACTIVE' } });
      await h.http.post(api(`/admin/clubs/${C.clubId}/reactivate`)).set(bearer(h.admin)).send({}).expect(409);
      expect(await visible()).toEqual({ list: true, club: 200, branch: 200, branches: 1, summary: 200, nearby: true, devices: 3 });
      await h.http.post(api('/bookings')).set(bearer(customer)).send({ branch_id: C.branchId, start_at: slot(120), duration_minutes: 60, items: [{ device_id: C.devices[0] }] }).expect(201);
    });

    it('close is terminal', async () => {
      await h.http.post(api(`/admin/clubs/${C.clubId}/close`)).set(bearer(h.admin)).send({}).expect(422);
      const r = await h.http.post(api(`/admin/clubs/${C.clubId}/close`)).set(bearer(h.admin)).send({ reason: 'Egasi yopdi' }).expect(201);
      expect(r.body.data.status).toBe('CLOSED');
      for (const action of ['approve', 'reactivate', 'suspend', 'close']) {
        await h.http.post(api(`/admin/clubs/${C.clubId}/${action}`)).set(bearer(h.admin)).send({ reason: 'x' }).expect(409);
      }
      await h.http.post(api(`/clubs/${C.clubId}/submit`)).set(bearer(C.owner)).expect(409);
      const v = await visible();
      expect(v).toMatchObject({ list: false, club: 404, branch: 404, summary: 404, nearby: false, devices: 0 });
      expect(await lastAudit(C.clubId, 'admin.club.close')).toMatchObject({ new_value: { status: 'CLOSED', reason: 'Egasi yopdi' } });
    });
  });

  describe('admin endpoints & private data', () => {
    let C: TestClub;
    let D: TestClub;

    beforeAll(async () => {
      C = await h.club({ devices: 1 });
      D = await h.club({ devices: 1 });
    });

    it('only platform admins can list/get clubs in admin API', async () => {
      for (const t of [C.owner, customer]) {
        denied((await h.http.get(api('/admin/clubs')).set(bearer(t))).status);
        denied((await h.http.get(api(`/admin/clubs/${C.clubId}`)).set(bearer(t))).status);
        denied((await h.http.post(api(`/admin/clubs/${D.clubId}/approve`)).set(bearer(t))).status);
      }
      await h.http.get(api('/admin/clubs')).query({ status: 'WHATEVER' }).set(bearer(h.admin)).expect(422);
      await h.http.get(api('/admin/clubs')).query({ limit: 1000 }).set(bearer(h.admin)).expect(422);
      const g = await h.http.get(api(`/admin/clubs/${C.clubId}`)).set(bearer(h.admin)).expect(200);
      expect(g.body.data.owner.phone).toBe(C.ownerPhone);
      expect(JSON.stringify(g.body.data)).not.toMatch(/password_hash|token_hash/);
      await h.http.get(api('/admin/clubs/00000000-0000-4000-8000-000000000000')).set(bearer(h.admin)).expect(404);
      await h.http.post(api('/admin/clubs/00000000-0000-4000-8000-000000000000/suspend')).set(bearer(h.admin)).send({ reason: 'x' }).expect(404);
    });

    it('public club payload has no owner/internal fields', async () => {
      const p = await h.http.get(api(`/clubs/${C.clubId}/public`)).expect(200);
      for (const k of ['owner_id', 'transfer_card_number', 'transfer_card_holder', 'commission_bps', 'settings', 'rejection_reason', 'suspended_reason', 'approved_by']) {
        expect(p.body.data).not.toHaveProperty(k);
      }
      const b = await h.http.get(api(`/branches/${C.branchId}`)).expect(200);
      expect(b.body.data.club).not.toHaveProperty('owner_id');
      expect(b.body.data.club).not.toHaveProperty('transfer_card_number');
      const list = await h.http.get(api('/clubs')).query({ limit: 100 }).expect(200);
      expect(list.body.data.every((x: { status: string }) => x.status === 'ACTIVE')).toBe(true);
      expect(JSON.stringify(list.body.data)).not.toMatch(/owner_id|transfer_card/);
    });

    it('club update: validated and scoped', async () => {
      await h.http.patch(api(`/clubs/${C.clubId}`)).set(bearer(C.owner)).send({ website: 'not a url' }).expect(422);
      await h.http.patch(api(`/clubs/${C.clubId}`)).set(bearer(C.owner)).send({ status: 'ACTIVE' }).expect(422);
      await h.http.patch(api(`/clubs/${C.clubId}`)).set(bearer(C.owner)).send({ min_booking_minutes: 5 }).expect(422);
      const u = await h.http.patch(api(`/clubs/${C.clubId}`)).set(bearer(C.owner)).send({ instagram: 'e2e_club', min_booking_minutes: 30 }).expect(200);
      expect(u.body.data).toMatchObject({ instagram: 'e2e_club', min_booking_minutes: 30 });
      expect(await lastAudit(C.clubId, 'club.update')).toMatchObject({ new_value: { instagram: 'e2e_club' } });
      for (const t of [D.owner, customer]) {
        denied((await h.http.patch(api(`/clubs/${C.clubId}`)).set(bearer(t)).send({ name: 'Hijacked' })).status);
        denied((await h.http.get(api(`/clubs/${C.clubId}`)).set(bearer(t))).status);
        denied((await h.http.post(api(`/clubs/${C.clubId}/submit`)).set(bearer(t))).status);
      }
      expect((await prisma.clubs.findUnique({ where: { id: C.clubId } }))?.name).not.toBe('Hijacked');
    });

    it('platform staff cannot create a club for themselves', async () => {
      const r = await h.http.post(api('/clubs')).set(bearer(h.admin)).send({ name: 'Admin club' }).expect(403);
      expect(r.body.error.details.reason).toBe('PLATFORM_STAFF_CANNOT_OWN_CLUB');
    });
  });
});
