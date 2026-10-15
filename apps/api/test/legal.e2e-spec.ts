import { PrismaService } from '../src/database/prisma.service';
import { LEGAL_DEFAULTS, LEGAL_DOCS } from '../src/modules/legal/defaults';
import { LEGAL_BODY_MAX } from '../src/modules/legal/legal.dto';
import { Harness, api, bearer } from './utils/harness';

/**
 * Huquqiy hujjatlar: ommaviy o'qish (qoralama + til fallback), faqat super admin tahrirlaydi,
 * tahrir versiyani oshiradi va audit'ga yoziladi.
 */
describe('Legal documents (e2e)', () => {
  const h = new Harness();
  let prisma: PrismaService;
  let owner: string;
  let customer: string;
  // Dev bazadagi haqiqiy matnlarni test oxirida tiklaymiz
  const original = new Map<string, unknown>();

  beforeAll(async () => {
    await h.start();
    prisma = h.get<PrismaService>(PrismaService);
    const rows = await prisma.platform_settings.findMany({ where: { key: { startsWith: 'legal.' } } });
    for (const r of rows) original.set(r.key, r.value);
    // Qoralama holatidan boshlaymiz (faqat `terms` — boshqa hujjatlarga tegmaymiz)
    await prisma.platform_settings.deleteMany({ where: { key: 'legal.terms' } });
    owner = (await h.club({ devices: 0, pricePerHour: null, approve: false })).owner;
    customer = (await h.customer()).token;
  });

  afterAll(async () => {
    await prisma.platform_settings.deleteMany({ where: { key: 'legal.terms' } });
    const prev = original.get('legal.terms');
    if (prev !== undefined) await prisma.platform_settings.create({ data: { id: crypto.randomUUID(), key: 'legal.terms', value: prev as object } });
    await h.stop();
  });

  it('public GET returns drafts in every language; unknown language falls back to uz', async () => {
    for (const lang of ['uz', 'ru', 'en'] as const) {
      const r = await h.http.get(api(`/legal/terms?lang=${lang}`)).expect(200);
      expect(r.body.data).toMatchObject({ doc: 'terms', lang, title: LEGAL_DEFAULTS.terms[lang].title, body_markdown: LEGAL_DEFAULTS.terms[lang].body, version: 1 });
      expect(typeof r.body.data.updated_at).toBe('string');
    }
    const fb = await h.http.get(api('/legal/terms?lang=de')).expect(200);
    expect(fb.body.data).toMatchObject({ lang: 'uz', title: LEGAL_DEFAULTS.terms.uz.title });
    const none = await h.http.get(api('/legal/terms')).expect(200);
    expect(none.body.data.lang).toBe('uz');
    // Barcha hujjatlar anonim ochiladi
    for (const doc of LEGAL_DOCS) {
      const r = await h.http.get(api(`/legal/${doc}?lang=ru`)).expect(200);
      expect(r.body.data).toMatchObject({ doc, lang: 'ru' });
      expect(r.body.data.body_markdown.length).toBeGreaterThan(0);
    }
  });

  it('unknown document is 404', async () => {
    const r = await h.http.get(api('/legal/cookies')).expect(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
    await h.http.get(api('/admin/legal/cookies')).set(bearer(h.admin)).expect(404);
  });

  it('only super admin can read/edit via admin endpoints (club owner and customer 403, anonymous 401)', async () => {
    const body = { lang: 'uz', title: 'Foydalanish shartlari', body_markdown: '## 1. Test\n\nBuzg\'unchi matn — saqlanmasligi kerak.' };
    await h.http.put(api('/admin/legal/terms')).set(bearer(owner)).send(body).expect(403);
    await h.http.put(api('/admin/legal/terms')).set(bearer(customer)).send(body).expect(403);
    await h.http.get(api('/admin/legal/terms')).set(bearer(owner)).expect(403);
    await h.http.put(api('/admin/legal/terms')).send(body).expect(401);
    const pub = await h.http.get(api('/legal/terms?lang=uz')).expect(200);
    expect(pub.body.data.version).toBe(1);
  });

  it('validation: bad language, empty/oversized body', async () => {
    const ok = { lang: 'uz', title: 'Foydalanish shartlari', body_markdown: '## 1. Umumiy\n\nMatn.'.padEnd(40, '.') };
    await h.http.put(api('/admin/legal/terms')).set(bearer(h.admin)).send({ ...ok, lang: 'de' }).expect(422);
    await h.http.put(api('/admin/legal/terms')).set(bearer(h.admin)).send({ ...ok, body_markdown: '' }).expect(422);
    await h.http.put(api('/admin/legal/terms')).set(bearer(h.admin)).send({ ...ok, title: 'x'.repeat(201) }).expect(422);
    const big = await h.http.put(api('/admin/legal/terms')).set(bearer(h.admin)).send({ ...ok, body_markdown: 'a'.repeat(LEGAL_BODY_MAX + 1) }).expect(422);
    expect(big.body.error.code).toBe('VALIDATION_ERROR');
    await h.http.put(api('/admin/legal/terms')).set(bearer(h.admin)).send({ ...ok, extra: 1 }).expect(422);
    // Express JSON limiti (100 KB) dan katta so'rov ham rad etiladi
    const huge = await h.http.put(api('/admin/legal/terms')).set(bearer(h.admin)).send({ ...ok, body_markdown: 'a'.repeat(200_000) });
    expect(huge.status).toBe(413);
    const pub = await h.http.get(api('/legal/terms')).expect(200);
    expect(pub.body.data.version).toBe(1);
  });

  it('PUT bumps version, writes audit; public GET returns edited text; other languages keep the draft', async () => {
    const since = new Date();
    const ru = '## 1. Общие положения\n\n1.1. Отредактированный текст для e2e.';
    const r1 = await h.http.put(api('/admin/legal/terms')).set(bearer(h.admin)).send({ lang: 'ru', title: 'Условия (ред.)', body_markdown: ru, expected_version: 1 }).expect(200);
    expect(r1.body.data).toMatchObject({ doc: 'terms', version: 2 });
    expect(r1.body.data.texts.ru).toEqual({ title: 'Условия (ред.)', body_markdown: ru, is_default: false });
    expect(r1.body.data.texts.uz.is_default).toBe(true);

    const pub = await h.http.get(api('/legal/terms?lang=ru')).expect(200);
    expect(pub.body.data).toMatchObject({ lang: 'ru', title: 'Условия (ред.)', body_markdown: ru, version: 2 });
    expect(new Date(pub.body.data.updated_at).getTime()).toBeGreaterThanOrEqual(since.getTime() - 1000);
    const uz = await h.http.get(api('/legal/terms?lang=uz')).expect(200);
    expect(uz.body.data).toMatchObject({ body_markdown: LEGAL_DEFAULTS.terms.uz.body, version: 2 });

    const audit = await prisma.audit_logs.findFirst({ where: { action: 'admin.legal.update', target_id: 'legal.terms', at: { gte: new Date(since.getTime() - 1000) } }, orderBy: { at: 'desc' } });
    expect(audit).toBeTruthy();
    expect(audit!.old_value).toMatchObject({ version: 1, lang: 'ru', is_default: true });
    expect(audit!.new_value).toMatchObject({ version: 2, lang: 'ru', body_markdown: ru });

    // Eskirgan versiya bilan saqlash — CONFLICT
    const stale = await h.http.put(api('/admin/legal/terms')).set(bearer(h.admin)).send({ lang: 'uz', title: 'Shartlar', body_markdown: ru, expected_version: 1 }).expect(409);
    expect(stale.body.error.details).toMatchObject({ reason: 'VERSION_MISMATCH', version: 2 });

    const r2 = await h.http.put(api('/admin/legal/terms')).set(bearer(h.admin)).send({ lang: 'uz', title: 'Shartlar', body_markdown: '## 1. Umumiy\n\nYangi matn (e2e).' }).expect(200);
    expect(r2.body.data.version).toBe(3);
    const admin = await h.http.get(api('/admin/legal/terms')).set(bearer(h.admin)).expect(200);
    expect(admin.body.data).toMatchObject({ version: 3, texts: { uz: { title: 'Shartlar', is_default: false }, ru: { is_default: false }, en: { is_default: true } } });
  });
});
