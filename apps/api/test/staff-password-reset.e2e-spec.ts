import { PrismaService } from '../src/database/prisma.service';
import { uuidv7 } from '../src/common/utils/id';
import { RbacService } from '../src/modules/rbac/rbac.service';
import { api, bearer, Harness, rndPhone, TestClub, uniq } from './utils/harness';
import { newClub } from './utils/flows';

jest.setTimeout(120_000);

const STAFF_PASS = 'StaffPass#2026';
const OWNER_PASS = 'StrongPass#2026';
const TEMP_RE = /^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/;
/** Access JWT `iat` sekundlarda — tiklashdan oldingi token boshqa sekundda berilgan bo'lsin. */
const nextSecond = () => new Promise((r) => setTimeout(r, 1100));

/**
 * Xodim parolini ierarxiya bo'yicha tiklash (docs/01-API.md §4.2): super admin → klub egasi/admin,
 * klub boshqaruvchisi → o'z klubi xodimi. Scope (klub A ↔ B), o'zini/platforma akkauntini tiklash rad,
 * eski parol/sessiyalar bekor, vaqtinchalik parol + `must_change_password`, audit, bildirishnoma, Idempotency-Key.
 */
describe('Staff password reset (e2e)', () => {
  const h = new Harness();
  let prisma: PrismaService;
  let A: TestClub;
  let B: TestClub;
  let adminId: string;
  let ownerA: string;
  let clubAdmin: { token: string; phone: string; id: string };
  let clubAdmin2: { token: string; phone: string; id: string };
  let operator: { token: string; phone: string; id: string };
  let branchAdmin: { token: string; phone: string; id: string };
  const cleanupUsers: string[] = [];

  const meId = async (token: string) => (await h.http.get(api('/auth/me')).set(bearer(token)).expect(200)).body.data.id as string;
  const staff = async (club: TestClub, role: string, branchId?: string) => {
    const s = await h.staff(club, role, branchId);
    return { ...s, id: await meId(s.token) };
  };
  const reset = (token: string, clubId: string, userId: string, body: Record<string, unknown> = {}) =>
    h.http.post(api(`/clubs/${clubId}/staff/users/${userId}/reset-password`)).set(bearer(token)).send(body);
  const login = (loginId: string, password: string) => h.http.post(api('/auth/login')).send({ login: loginId, password });

  beforeAll(async () => {
    await h.start();
    prisma = h.get<PrismaService>(PrismaService);
    adminId = await meId(h.admin);
    // Yangi permission (staff.reset_password) migratsiyadan oldingi kesh bilan yo'qolmasin
    await h.get<RbacService>(RbacService).invalidate(adminId);
    [A, B] = [await newClub(h, { devices: 0, pricePerHour: null }), await newClub(h, { devices: 0, pricePerHour: null })];
    ownerA = await meId(A.owner);
    clubAdmin = await staff(A, 'CLUB_ADMIN');
    clubAdmin2 = await staff(A, 'CLUB_ADMIN');
    operator = await staff(A, 'OPERATOR', A.branchId);
    branchAdmin = await staff(A, 'BRANCH_ADMIN', A.branchId);
  }, 180_000);

  afterAll(async () => {
    if (cleanupUsers.length) await prisma.user_roles.deleteMany({ where: { user_id: { in: cleanupUsers } } });
    await h.stop();
  });

  it('owner resets an operator: temp password once, old password/sessions dead, forced change, audit + notification', async () => {
    // Tiklashdan oldingi sessiya (refresh + access)
    const before = await login(operator.phone, STAFF_PASS).expect(200);
    expect(before.body.data.must_change_password).toBe(false);
    await nextSecond();

    const r = await reset(A.owner, A.clubId, operator.id).expect(201);
    const temp = r.body.data.temporary_password as string;
    expect(temp).toMatch(TEMP_RE);
    expect(r.body.data).toMatchObject({ user_id: operator.id, generated: true, must_change_password: true });
    expect(r.body.data.sessions_revoked).toBeGreaterThanOrEqual(2);

    // Eski parol ishlamaydi, eski refresh va access token bekor
    await login(operator.phone, STAFF_PASS).expect(401);
    await h.http.post(api('/auth/refresh')).send({ refresh_token: before.body.data.refresh_token }).expect(401);
    await h.http.get(api('/auth/me')).set(bearer(before.body.data.access_token)).expect(401);
    await h.http.get(api('/auth/me')).set(bearer(operator.token)).expect(401);

    // Vaqtinchalik parol bilan kirish → majburiy almashtirish
    const tmp = await login(operator.phone, temp).expect(200);
    expect(tmp.body.data.must_change_password).toBe(true);
    expect(tmp.body.data.user.must_change_password).toBe(true);
    const tok = tmp.body.data.access_token as string;
    expect((await h.http.get(api('/auth/me')).set(bearer(tok)).expect(200)).body.data.must_change_password).toBe(true);

    // Vaqtinchalik parolni o'zini qayta o'rnatib bo'lmaydi; zaif parol rad
    const same = await h.http.post(api('/auth/password')).set(bearer(tok)).send({ password: temp }).expect(422);
    expect(same.body.error.details.reason).toBe('SAME_AS_TEMPORARY');
    await h.http.post(api('/auth/password')).set(bearer(tok)).send({ password: '12345678' }).expect(422);
    await h.http.post(api('/auth/password')).set(bearer(tok)).send({ password: 'NewOperator#2026' }).expect(200);
    expect((await h.http.get(api('/auth/me')).set(bearer(tok)).expect(200)).body.data.must_change_password).toBe(false);
    await login(operator.phone, temp).expect(401);
    const fresh = await login(operator.phone, 'NewOperator#2026').expect(200);
    expect(fresh.body.data.must_change_password).toBe(false);
    operator.token = fresh.body.data.access_token;

    // Audit: kim, kimni, qaysi klub — parolsiz
    const audit = await prisma.audit_logs.findFirst({ where: { action: 'staff.password_reset', target_id: operator.id }, orderBy: { at: 'desc' } });
    expect(audit).toMatchObject({ actor_id: ownerA, club_id: A.clubId, target_type: 'user' });
    expect(audit!.new_value).toMatchObject({ roles: ['OPERATOR'], generated: true });
    expect(JSON.stringify(audit)).not.toContain(temp);
    // Bildirishnoma (IN_APP; Telegram bog'langan bo'lsa u ham) — parol yo'q
    const n = await prisma.notifications.findFirst({ where: { user_id: operator.id, type: 'PASSWORD_RESET_BY_ADMIN' }, orderBy: { created_at: 'desc' } });
    expect(n).toBeTruthy();
    expect(`${n!.title} ${n!.body} ${JSON.stringify(n!.data)}`).not.toContain(temp);

    // Xodimlar ro'yxatida bayroq ko'rinadi
    const list = await h.http.get(api(`/clubs/${A.clubId}/staff`)).set(bearer(A.owner)).expect(200);
    expect(list.body.data.find((x: { user: { id: string } }) => x.user.id === operator.id).user.must_change_password).toBe(false);
  });

  it('owner resets a club admin with a typed password; weak password rejected', async () => {
    await reset(A.owner, A.clubId, clubAdmin2.id, { password: '12345678' }).expect(422);
    await reset(A.owner, A.clubId, clubAdmin2.id, { password: 'short' }).expect(422);
    const r = await reset(A.owner, A.clubId, clubAdmin2.id, { password: 'Typed#Pass2026' }).expect(201);
    expect(r.body.data).toMatchObject({ temporary_password: 'Typed#Pass2026', generated: false, must_change_password: true });
    const l = await login(clubAdmin2.phone, 'Typed#Pass2026').expect(200);
    expect(l.body.data.must_change_password).toBe(true);
    const list = await h.http.get(api(`/clubs/${A.clubId}/staff`)).set(bearer(A.owner)).expect(200);
    expect(list.body.data.find((x: { user: { id: string } }) => x.user.id === clubAdmin2.id).user.must_change_password).toBe(true);
  });

  it('club admin: operator/branch admin OK; owner and another club admin forbidden', async () => {
    const own = await reset(clubAdmin.token, A.clubId, ownerA).expect(403);
    expect(own.body.error.details.reason).toBe('RANK');
    await reset(clubAdmin.token, A.clubId, clubAdmin2.id).expect(403);
    await reset(clubAdmin.token, A.clubId, branchAdmin.id).expect(201);
    const r = await reset(clubAdmin.token, A.clubId, operator.id).expect(201);
    operator.token = (await login(operator.phone, r.body.data.temporary_password).expect(200)).body.data.access_token;
  });

  it('operator and branch admin cannot reset anyone (no permission)', async () => {
    for (const target of [ownerA, clubAdmin.id, branchAdmin.id]) {
      expect((await reset(operator.token, A.clubId, target).expect(403)).body.error.code).toBe('FORBIDDEN');
    }
    const ba = (await login(branchAdmin.phone, (await reset(A.owner, A.clubId, branchAdmin.id).expect(201)).body.data.temporary_password).expect(200)).body.data.access_token;
    await reset(ba, A.clubId, operator.id).expect(403);
  });

  it('scope: club B owner can never reset club A staff', async () => {
    // A klubi marshruti — permission guard (boshqa klub) 403
    await reset(B.owner, A.clubId, operator.id).expect(403);
    await reset(B.owner, A.clubId, clubAdmin.id).expect(403);
    // O'z klubi marshruti orqali — A xodimi "mavjud emas"
    expect((await reset(B.owner, B.clubId, operator.id).expect(404)).body.error.code).toBe('NOT_FOUND');
    expect((await reset(B.owner, B.clubId, ownerA).expect(404)).body.error.code).toBe('NOT_FOUND');
    // Mavjud bo'lmagan foydalanuvchi ham 404
    await reset(A.owner, A.clubId, uuidv7()).expect(404);
    // A xodimining paroli o'zgarmagan (oxirgi audit A egasi/adminidan)
    const last = await prisma.audit_logs.findFirst({ where: { action: 'staff.password_reset', target_id: operator.id }, orderBy: { at: 'desc' } });
    expect(last!.club_id).toBe(A.clubId);
  });

  it('self-reset is rejected (owner and super admin)', async () => {
    expect((await reset(A.owner, A.clubId, ownerA).expect(403)).body.error.details.reason).toBe('SELF_RESET');
    expect((await reset(h.admin, A.clubId, adminId).expect(403)).body.error.details.reason).toBe('SELF_RESET');
  });

  it('platform staff accounts are never reset through this endpoint', async () => {
    // Super admin A klubi xodimi emas — 404
    await reset(A.owner, A.clubId, adminId).expect(404);
    // SUPPORT + A klubida operator bo'lgan akkaunt: hech kim tiklay olmaydi
    const support = await prisma.roles.findUniqueOrThrow({ where: { code: 'SUPPORT' } });
    const op = await prisma.roles.findUniqueOrThrow({ where: { code: 'OPERATOR' } });
    const u = await prisma.users.create({ data: { id: uuidv7(), type: 'STAFF', phone: rndPhone(), first_name: 'Support', status: 'ACTIVE' } });
    cleanupUsers.push(u.id);
    await prisma.user_roles.createMany({
      data: [
        { id: uuidv7(), user_id: u.id, role_id: support.id },
        { id: uuidv7(), user_id: u.id, role_id: op.id, club_id: A.clubId, branch_id: A.branchId },
      ],
    });
    expect((await reset(h.admin, A.clubId, u.id).expect(403)).body.error.details.reason).toBe('PLATFORM_ACCOUNT');
    expect((await reset(A.owner, A.clubId, u.id).expect(403)).body.error.details.reason).toBe('PLATFORM_ACCOUNT');
  });

  it('staff of two clubs: only platform can reset (club A cannot take over a club B account)', async () => {
    const s = await staff(A, 'OPERATOR', A.branchId);
    // Shu telefon B klubiga ham taklif qilinadi (mavjud akkaunt o'z paroli bilan qabul qiladi)
    const inv = await h.http.post(api(`/clubs/${B.clubId}/staff/invitations`)).set(bearer(B.owner)).send({ phone: s.phone, role: 'OPERATOR', branch_id: B.branchId }).expect(201);
    await h.http.post(api('/auth/invitations/accept')).send({ token: inv.body.data.token, password: STAFF_PASS }).expect(200);
    expect((await reset(A.owner, A.clubId, s.id).expect(403)).body.error.details.reason).toBe('OTHER_CLUB');
    expect((await reset(B.owner, B.clubId, s.id).expect(403)).body.error.details.reason).toBe('OTHER_CLUB');
    await reset(h.admin, A.clubId, s.id).expect(201);
  });

  it('Idempotency-Key: replay returns the stored result without the password and does not reset again', async () => {
    const key = uniq('idem');
    const count = () => prisma.audit_logs.count({ where: { action: 'staff.password_reset', target_id: clubAdmin2.id } });
    const n0 = await count();
    const first = await reset(A.owner, A.clubId, clubAdmin2.id).set('Idempotency-Key', key).expect(201);
    const temp = first.body.data.temporary_password as string;
    expect(temp).toMatch(TEMP_RE);
    const again = await reset(A.owner, A.clubId, clubAdmin2.id).set('Idempotency-Key', key);
    expect(again.status).toBeLessThan(300);
    expect(again.body.data).toMatchObject({ user_id: clubAdmin2.id, temporary_password: null });
    expect(await count()).toBe(n0 + 1);
    // Saqlangan javobda parol yo'q; parol hali ham birinchi javobdagi
    const stored = await prisma.idempotency_keys.findFirst({ where: { key } });
    expect(JSON.stringify(stored?.response_body)).not.toContain(temp);
    await login(clubAdmin2.phone, temp).expect(200);
  });

  it('super admin resets a club owner (platform → club manager)', async () => {
    const C = await newClub(h, { devices: 0, pricePerHour: null });
    const ownerC = await meId(C.owner);
    await nextSecond();
    const r = await reset(h.admin, C.clubId, ownerC).expect(201);
    const temp = r.body.data.temporary_password as string;
    expect(temp).toMatch(TEMP_RE);
    await login(C.ownerPhone, OWNER_PASS).expect(401);
    await h.http.get(api('/auth/me')).set(bearer(C.owner)).expect(401);
    const l = await login(C.ownerPhone, temp).expect(200);
    expect(l.body.data.must_change_password).toBe(true);
    const audit = await prisma.audit_logs.findFirst({ where: { action: 'staff.password_reset', target_id: ownerC }, orderBy: { at: 'desc' } });
    expect(audit).toMatchObject({ actor_id: adminId, club_id: C.clubId });
    expect(audit!.new_value).toMatchObject({ roles: ['CLUB_OWNER'] });
    // Klub egasi C endi o'z klub adminini tiklay oladi (yangi parol o'rnatgach)
    await h.http.post(api('/auth/password')).set(bearer(l.body.data.access_token)).send({ password: 'OwnerNew#2026' }).expect(200);
  });
});
