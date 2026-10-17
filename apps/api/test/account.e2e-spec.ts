import { PrismaService } from '../src/database/prisma.service';
import { Harness, api, bearer } from './utils/harness';

/**
 * Maxfiylik: rozilik (consent) yozib qo'yish, shaxsiy ma'lumot eksporti,
 * akkauntni o'chirish (anonimlashtirish + sessiyalarni bekor qilish).
 */
describe('Account lifecycle & consent (e2e)', () => {
  const h = new Harness();
  let prisma: PrismaService;

  beforeAll(async () => {
    await h.start();
    prisma = h.get<PrismaService>(PrismaService);
  });
  afterAll(() => h.stop());

  const meId = async (token: string) => (await h.http.get(api('/users/me')).set(bearer(token)).expect(200)).body.data.id as string;

  it('records consent to the current doc version; GET /me/consents reflects it; repeat is idempotent', async () => {
    const { token } = await h.customer();
    const r1 = await h.http.post(api('/legal/privacy/consent')).set(bearer(token)).expect(200);
    expect(r1.body.data).toMatchObject({ doc: 'privacy', version: '1' });
    expect(typeof r1.body.data.accepted_at).toBe('string');

    const r2 = await h.http.post(api('/legal/privacy/consent')).set(bearer(token)).expect(200);
    expect(r2.body.data.accepted_at).toBe(r1.body.data.accepted_at); // idempotent — yangi qator yaratilmaydi

    const list = await h.http.get(api('/me/consents')).set(bearer(token)).expect(200);
    const privacy = (list.body.data as { doc: string; version: string | null }[]).find((c) => c.doc === 'privacy');
    expect(privacy).toMatchObject({ doc: 'privacy', version: '1' });
    // Faqat bitta qator saqlanadi
    const id = await meId(token);
    expect(await prisma.consents.count({ where: { user_id: id, document_type: 'PRIVACY' } })).toBe(1);
  });

  it('consent rejects non-consentable doc (partner) and anonymous access', async () => {
    const { token } = await h.customer();
    const bad = await h.http.post(api('/legal/partner/consent')).set(bearer(token)).expect(422);
    expect(bad.body.error.details).toMatchObject({ reason: 'NOT_CONSENTABLE' });
    await h.http.post(api('/legal/privacy/consent')).expect(401);
    await h.http.post(api('/legal/cookies/consent')).set(bearer(token)).expect(404);
  });

  it('exports the user\'s own personal data', async () => {
    const { token, phone } = await h.customer();
    await h.http.post(api('/legal/terms/consent')).set(bearer(token)).expect(200);
    const r = await h.http.get(api('/users/me/export')).set(bearer(token)).expect(200);
    expect(r.body.data.user).toMatchObject({ phone, type: 'CUSTOMER' });
    expect(Array.isArray(r.body.data.bookings)).toBe(true);
    expect(Array.isArray(r.body.data.payments)).toBe(true);
    expect(r.body.data.consents.some((c: { document_type: string }) => c.document_type === 'TERMS')).toBe(true);
    expect(typeof r.body.data.exported_at).toBe('string');
  });

  it('deletes account: requires confirm, anonymizes, revokes sessions, frees the phone', async () => {
    const { token, phone } = await h.customer();
    const id = await meId(token);

    await h.http.delete(api('/users/me')).set(bearer(token)).send({}).expect(422); // confirm majburiy
    await h.http.delete(api('/users/me')).set(bearer(token)).send({ confirm: false }).expect(422);

    const del = await h.http.delete(api('/users/me')).set(bearer(token)).send({ confirm: true, reason: 'e2e' }).expect(200);
    expect(del.body.data.deleted).toBe(true);

    const row = await prisma.users.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('DELETED');
    expect(row.deleted_at).toBeTruthy();
    expect(row.phone).toBeNull();
    expect(row.first_name).toBeNull();
    expect(row.password_hash).toBeNull();
    expect(row.email).toBe(`deleted-${id}@deleted.invalid`); // shaxssiz sintetik email (users_login_chk)
    expect(await prisma.refresh_tokens.count({ where: { user_id: id, revoked_at: null } })).toBe(0); // sessiyalar bekor

    // Audit yozuvi bor (sabab bilan)
    const audit = await prisma.audit_logs.findFirst({ where: { action: 'account.deleted', target_id: id } });
    expect(audit).toBeTruthy();
    expect(audit!.new_value).toMatchObject({ reason: 'e2e' });

    // Telefon bo'shadi — o'sha raqam bilan qayta ro'yxatdan o'tish mumkin, yangi akkaunt
    const fresh = await h.otpLogin(phone);
    const newId = await meId(fresh);
    expect(newId).not.toBe(id);
  });

  it('staff/platform accounts cannot self-delete', async () => {
    const admin = h.admin;
    const d = await h.http.delete(api('/users/me')).set(bearer(admin)).send({ confirm: true }).expect(403);
    expect(d.body.error.details).toMatchObject({ reason: 'STAFF_ACCOUNT' });
    // Super admin hali ham ishlayapti
    await h.http.get(api('/users/me')).set(bearer(admin)).expect(200);
  });
});
