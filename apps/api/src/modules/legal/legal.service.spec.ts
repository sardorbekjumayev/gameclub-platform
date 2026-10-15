import { LEGAL_DEFAULTS, LEGAL_DOCS, LEGAL_LANGS } from './defaults';
import { LEGAL_BODY_MAX, LEGAL_TITLE_MAX } from './legal.dto';
import { legalLang, legalText, type StoredLegal } from './legal.service';

describe('legal', () => {
  it('unknown/empty language falls back to uz', () => {
    expect(legalLang('ru')).toBe('ru');
    expect(legalLang(' EN ')).toBe('en');
    expect(legalLang('de')).toBe('uz');
    expect(legalLang(undefined)).toBe('uz');
  });

  it('edited language overrides the draft, others keep the draft', () => {
    const s: StoredLegal = { version: 2, updated_at: '2026-10-15T10:00:00.000Z', texts: { ru: { title: 'Оферта', body_markdown: 'Новый текст' } } };
    expect(legalText('offer', s, 'ru')).toEqual({ title: 'Оферта', body_markdown: 'Новый текст', is_default: false });
    expect(legalText('offer', s, 'uz')).toMatchObject({ title: LEGAL_DEFAULTS.offer.uz.title, is_default: true });
  });

  it.each(LEGAL_DOCS.flatMap((d) => LEGAL_LANGS.map((l) => [d, l] as const)))('draft %s/%s is complete and within limits', (doc, lang) => {
    const t = LEGAL_DEFAULTS[doc][lang];
    expect(t.title.length).toBeLessThanOrEqual(LEGAL_TITLE_MAX);
    expect(t.body.length).toBeLessThanOrEqual(LEGAL_BODY_MAX);
    expect(t.body).toMatch(/^## 1\. /m);
    // Kompaniya rekvizitlari — egasi to'ldiradigan aniq placeholder'lar
    for (const p of ['[Kompaniya nomi]', '[STIR]', '[Yuridik manzil]', '[Aloqa email]', '[Tahrir sanasi]']) expect(t.body).toContain(p);
    // Xom HTML yo'q
    expect(t.body).not.toMatch(/<[a-z!/]/i);
  });
});
