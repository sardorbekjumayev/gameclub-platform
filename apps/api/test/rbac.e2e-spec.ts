import { PrismaService } from '../src/database/prisma.service';
import { SYSTEM_ROLES } from '../src/modules/rbac/catalog';
import { RbacService } from '../src/modules/rbac/rbac.service';
import { uuidv7 } from '../src/common/utils/id';
import { api, bearer, Harness, rndPhone, TestClub } from './utils/harness';
import { newClub, newCustomer } from './utils/flows';

/**
 * RBAC va tenancy (docs/01-API.md §5): DB rollari katalog bilan mos, /auth/me permissionlari, filial scope'i,
 * rol olib tashlanganda kesh invalidatsiyasi, privilege escalation, muddati o'tgan rol, platforma rollari.
 */
describe('RBAC & tenancy (e2e)', () => {
  const h = new Harness();
  let prisma: PrismaService;
  let A: TestClub;
  let B: TestClub;
  let branchA2: string;
  const extraRoles: string[] = [];

  const me = async (token: string) => (await h.http.get(api('/auth/me')).set(bearer(token)).expect(200)).body.data;

  beforeAll(async () => {
    await h.start();
    prisma = h.get(PrismaService);
    [A, B] = [await newClub(h, { devices: 1 }), await newClub(h, { devices: 1 })];
    const br = await h.http
      .post(api(`/clubs/${A.clubId}/branches`))
      .set(bearer(A.owner))
      .send({ name: 'Ikkinchi', address: 'Toshkent, Sergeli 2', latitude: 41.22, longitude: 69.22, working_hours: { always_open: true } })
      .expect(201);
    branchA2 = br.body.data.id;
  }, 120_000);

  afterAll(async () => {
    if (extraRoles.length) await prisma.user_roles.deleteMany({ where: { id: { in: extraRoles } } });
    await h.stop();
  });

  it('system roles in DB match catalog.ts (seed is in sync)', async () => {
    const roles = await prisma.roles.findMany({
      where: { code: { in: SYSTEM_ROLES.map((r) => r.code) }, club_id: null },
      include: { role_permissions: { include: { permission: true } } },
    });
    for (const r of SYSTEM_ROLES) {
      const db = roles.find((x) => x.code === r.code);
      expect(db).toBeDefined();
      expect({ code: r.code, scope: db!.scope_type }).toEqual({ code: r.code, scope: r.scope_type });
      expect({ code: r.code, perms: db!.role_permissions.map((p) => p.permission.code).sort() }).toEqual({ code: r.code, perms: [...r.permissions].sort() });
    }
  });

  it('/auth/me exposes roles with scope and the permission set (no secrets)', async () => {
    const owner = await me(A.owner);
    expect(owner.roles).toEqual(expect.arrayContaining([{ role: 'CLUB_OWNER', scope_type: 'CLUB', club_id: A.clubId, branch_id: null }]));
    const ownerPerms = SYSTEM_ROLES.find((r) => r.code === 'CLUB_OWNER')!.permissions;
    expect(owner.permissions).toEqual(expect.arrayContaining([...ownerPerms]));
    expect(owner.permissions.some((p: string) => p.startsWith('platform.'))).toBe(false);
    expect(owner).not.toHaveProperty('password_hash');

    const c = await newCustomer(h);
    const cm = await me(c.token);
    expect(cm.roles).toEqual([{ role: 'CUSTOMER', scope_type: 'PLATFORM', club_id: null, branch_id: null }]);
    expect(cm.permissions).toEqual([]);

    const op = await h.staff(A, 'OPERATOR', A.branchId);
    const om = await me(op.token);
    expect(om.roles).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'OPERATOR', scope_type: 'BRANCH', branch_id: A.branchId, club_id: A.clubId })]));
    expect(om.permissions).not.toContain('reports.view');
  });

  it('branch-scoped operator: own branch only (not sibling branch, not other club)', async () => {
    const op = await h.staff(A, 'OPERATOR', A.branchId);
    await h.http.get(api(`/branches/${A.branchId}/live`)).set(bearer(op.token)).expect(200);
    await h.http.get(api(`/branches/${A.branchId}/devices`)).set(bearer(op.token)).expect(200);
    // Resursga bog'liq scope service'da: boshqa filial "mavjud emas" (404)
    expect((await h.http.get(api(`/branches/${branchA2}/live`)).set(bearer(op.token)).expect(404)).body.error.code).toBe('NOT_FOUND');
    await h.http.get(api(`/branches/${branchA2}/devices`)).set(bearer(op.token)).expect(403);
    await h.http.get(api(`/branches/${B.branchId}/live`)).set(bearer(op.token)).expect(404);
    await h.http.get(api(`/branches/${B.branchId}/devices`)).set(bearer(op.token)).expect(403);
    // Operator xodimlar ro'yxatini ko'rmaydi
    await h.http.get(api(`/clubs/${A.clubId}/staff`)).set(bearer(op.token)).expect(403);
  });

  it('club owners are isolated from each other', async () => {
    await h.http.get(api(`/clubs/${A.clubId}/staff`)).set(bearer(B.owner)).expect(403);
    await h.http.get(api(`/branches/${A.branchId}/live`)).set(bearer(B.owner)).expect(404);
    await h.http.get(api(`/branches/${A.branchId}/devices`)).set(bearer(B.owner)).expect(403);
    await h.http.post(api(`/clubs/${A.clubId}/staff/invitations`)).set(bearer(B.owner)).send({ phone: rndPhone(), role: 'OPERATOR', branch_id: A.branchId }).expect(403);
    // B o'z klubiga A filialini biriktira olmaydi
    await h.http.post(api(`/clubs/${B.clubId}/staff/invitations`)).set(bearer(B.owner)).send({ phone: rndPhone(), role: 'OPERATOR', branch_id: A.branchId }).expect(404);
    await h.http.post(api(`/admin/clubs/${A.clubId}/approve`)).set(bearer(B.owner)).expect(403);
  });

  it('branch admin sees only own-branch staff; club admin cannot escalate', async () => {
    const ba = await h.staff(A, 'BRANCH_ADMIN', A.branchId);
    await h.staff(A, 'OPERATOR', branchA2);
    const list = await h.http.get(api(`/clubs/${A.clubId}/staff`)).set(bearer(ba.token)).expect(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    expect(list.body.data.every((s: { branch_id: string | null }) => s.branch_id === A.branchId)).toBe(true);

    const ca = await h.staff(A, 'CLUB_ADMIN');
    const r = await h.http.post(api(`/clubs/${A.clubId}/staff/invitations`)).set(bearer(ca.token)).send({ phone: rndPhone(), role: 'CLUB_ADMIN' }).expect(403);
    expect(r.body.error.code).toBe('FORBIDDEN');
    // Egalik rolini taklif orqali berib bo'lmaydi
    await h.http.post(api(`/clubs/${A.clubId}/staff/invitations`)).set(bearer(ca.token)).send({ phone: rndPhone(), role: 'CLUB_OWNER' }).expect(422);
    await h.http.post(api(`/clubs/${A.clubId}/staff/invitations`)).set(bearer(A.owner)).send({ phone: rndPhone(), role: 'CLUB_OWNER' }).expect(422);
    await h.http.post(api(`/clubs/${A.clubId}/staff/invitations`)).set(bearer(ca.token)).send({ phone: rndPhone(), role: 'OPERATOR', branch_id: A.branchId }).expect(201);
    await h.http.post(api(`/clubs/${A.clubId}/staff/invitations`)).set(bearer(A.owner)).send({ phone: rndPhone(), role: 'SUPER_ADMIN' }).expect(422);
    await h.http.post(api(`/clubs/${A.clubId}/staff/invitations`)).set(bearer(A.owner)).send({ phone: rndPhone(), role: 'OPERATOR' }).expect(422);
  });

  it('removing a role takes effect immediately (grants cache invalidated)', async () => {
    const op = await h.staff(A, 'OPERATOR', A.branchId);
    await h.http.get(api(`/branches/${A.branchId}/live`)).set(bearer(op.token)).expect(200); // kesh to'ldi
    const staff = await h.http.get(api(`/clubs/${A.clubId}/staff`)).set(bearer(A.owner)).expect(200);
    const row = staff.body.data.find((s: { user: { phone: string } }) => s.user.phone === op.phone);
    // B egasi A xodimini o'chira olmaydi
    await h.http.delete(api(`/clubs/${A.clubId}/staff/${row.id}`)).set(bearer(B.owner)).expect(403);
    await h.http.delete(api(`/clubs/${B.clubId}/staff/${row.id}`)).set(bearer(B.owner)).expect(404);
    await h.http.delete(api(`/clubs/${A.clubId}/staff/${row.id}`)).set(bearer(A.owner)).expect(200);
    await h.http.get(api(`/branches/${A.branchId}/live`)).set(bearer(op.token)).expect(403);
    expect((await me(op.token)).permissions).toEqual([]);
  });

  it('expired role assignments grant nothing', async () => {
    const c = await newCustomer(h);
    const uid = (await me(c.token)).id;
    const role = await prisma.roles.findFirstOrThrow({ where: { code: 'CLUB_ADMIN', club_id: null } });
    const id = uuidv7();
    await prisma.user_roles.create({ data: { id, user_id: uid, role_id: role.id, club_id: A.clubId, expires_at: new Date(Date.now() - 60_000) } });
    extraRoles.push(id);
    await h.get<RbacService>(RbacService).invalidate(uid);
    await h.http.get(api(`/clubs/${A.clubId}/staff`)).set(bearer(c.token)).expect(403);
    await prisma.user_roles.update({ where: { id }, data: { expires_at: new Date(Date.now() + 3600_000) } });
    await h.get<RbacService>(RbacService).invalidate(uid);
    await h.http.get(api(`/clubs/${A.clubId}/staff`)).set(bearer(c.token)).expect(200);
    await h.http.get(api(`/clubs/${B.clubId}/staff`)).set(bearer(c.token)).expect(403);
  });

  it('SUPPORT role: users/reviews/tickets yes; settings, analytics, club approval no', async () => {
    const c = await newCustomer(h);
    const uid = (await me(c.token)).id;
    const role = await prisma.roles.findFirstOrThrow({ where: { code: 'SUPPORT', club_id: null } });
    const id = uuidv7();
    await prisma.user_roles.create({ data: { id, user_id: uid, role_id: role.id } });
    extraRoles.push(id);
    await h.get<RbacService>(RbacService).invalidate(uid);

    await h.http.get(api('/admin/users?limit=1')).set(bearer(c.token)).expect(200);
    await h.http.get(api('/admin/reviews?limit=1')).set(bearer(c.token)).expect(200);
    await h.http.get(api('/admin/support/stats')).set(bearer(c.token)).expect(200);
    await h.http.get(api('/admin/settings/social')).set(bearer(c.token)).expect(403);
    await h.http.get(api('/analytics/platform/overview')).set(bearer(c.token)).expect(403);
    await h.http.post(api('/admin/broadcasts')).set(bearer(c.token)).send({ title: 'Yo\'q', body: 'Ruxsat yo\'q' }).expect(403);
    await h.http.post(api(`/admin/clubs/${A.clubId}/approve`)).set(bearer(c.token)).expect(403);
    // Platforma roli klub ichki resurslariga avtomatik kirmaydi (permission yo'q)
    await h.http.get(api(`/clubs/${A.clubId}/staff`)).set(bearer(c.token)).expect(403);
  });

  it("customers only see their own bookings", async () => {
    const a = await newCustomer(h);
    const b = await newCustomer(h);
    const start = new Date(Date.now() + 3 * 3600_000);
    start.setUTCMinutes(Math.ceil(start.getUTCMinutes() / 30) * 30, 0, 0);
    const bk = await h.http.post(api('/bookings')).set(bearer(a.token)).send({ branch_id: A.branchId, start_at: start.toISOString(), duration_minutes: 60, items: [{ device_id: A.devices[0] }] }).expect(201);
    await h.http.get(api(`/bookings/${bk.body.data.id}`)).set(bearer(b.token)).expect(404);
    await h.http.post(api(`/bookings/${bk.body.data.id}/cancel`)).set(bearer(b.token)).send({}).expect(404);
    await h.http.get(api(`/bookings/${bk.body.data.id}`)).set(bearer(B.owner)).expect(404);
    await h.http.get(api(`/bookings/${bk.body.data.id}`)).set(bearer(A.owner)).expect(200);
    const list = await h.http.get(api('/bookings')).set(bearer(b.token)).expect(200);
    expect(list.body.data.map((x: { id: string }) => x.id)).not.toContain(bk.body.data.id);
    await h.http.post(api(`/bookings/${bk.body.data.id}/cancel`)).set(bearer(a.token)).send({}).expect(201);
  });
});
